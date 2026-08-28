<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Version du proxy, exposée par GET /__proxy-status.
 *
 * Ces fichiers ne passent PAS par le pipeline CI/CD : ils sont déposés à la
 * main sur l'hébergement mutualisé. Ce marqueur est le seul moyen simple de
 * vérifier de l'extérieur que la version en ligne est bien celle du dépôt —
 * un décalage ici a déjà coûté une longue chasse au bug d'upload.
 */
const PROXY_VERSION = '2026-08-29';

/**
 * Construit l'URL distante en conservant :
 * - le chemin demandé
 * - les paramètres GET
 */
function buildRemoteUrl(): string
{
    $requestUri = $_SERVER['REQUEST_URI'] ?? '/';

    // Supprime éventuellement chemin du script si le projet est installé
    // dans un sous-répertoire.
    $path = parse_url($requestUri, PHP_URL_PATH) ?: '/';
    $query = parse_url($requestUri, PHP_URL_QUERY);

    $remoteUrl = rtrim(REMOTE_SERVER, '/') . $path;

    if ($query !== null && $query !== '') {
        $remoteUrl .= '?' . $query;
    }

    return $remoteUrl;
}

/**
 * Récupère les headers entrants.
 */
function getRequestHeaders(): array
{
    $headers = [];

    foreach ($_SERVER as $name => $value) {
        if (!is_string($value)) {
            continue;
        }

        if (str_starts_with($name, 'HTTP_')) {
            $headerName = str_replace(
                ' ',
                '-',
                ucwords(
                    strtolower(
                        str_replace('_', ' ', substr($name, 5))
                    )
                )
            );

            $headers[$headerName] = $value;
        }
    }

    // Headers non présents sous HTTP_*
    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers['Content-Type'] = $_SERVER['CONTENT_TYPE'];
    }

    if (isset($_SERVER['CONTENT_LENGTH'])) {
        $headers['Content-Length'] = $_SERVER['CONTENT_LENGTH'];
    }

    return $headers;
}

/**
 * Construit les headers HTTP à envoyer au serveur distant.
 *
 * @param string|null $overrideContentType Content-Type à substituer à celui de
 *        la requête entrante. Sert au corps multipart reconstruit : la
 *        frontière d'origine ne correspond alors plus à rien.
 */
function buildForwardHeaders(?string $overrideContentType = null): array
{
    $incomingHeaders = getRequestHeaders();
    $headers = [];

    // Ces headers sont gérés par cURL ou doivent être remplacés.
    $skipped = ['host', 'content-length', 'connection', 'accept-encoding'];

    if ($overrideContentType !== null) {
        $skipped[] = 'content-type';
    }

    foreach ($incomingHeaders as $name => $value) {
        $lowerName = strtolower($name);

        // Ces headers sont gérés par cURL ou doivent être remplacés.
        if (in_array($lowerName, [
            'host',
            'content-length',
            'connection',
            'accept-encoding',
        ], true)) {
            continue;
        }

        $headers[] = $name . ': ' . $value;
    }

    if ($overrideContentType !== null) {
        $headers[] = 'Content-Type: ' . $overrideContentType;
    }

    // Expect: 100-continue est ajouté d'office par cURL au-delà de 1 Ko de
    // corps. Il n'apporte rien ici et ajoute un aller-retour à chaque upload
    // de photo : on le neutralise (un header sans valeur supprime celui de
    // cURL).
    $headers[] = 'Expect:';

    // Proxy
    // Permet au serveur distant de connaître l'origine de la requête.
    if (!empty($_SERVER['REMOTE_ADDR'])) {
        $headers[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
    }

    if (!empty($_SERVER['HTTP_HOST'])) {
        $headers[] = 'X-Forwarded-Host: ' . $_SERVER['HTTP_HOST'];
    }

    if (!empty($_SERVER['REQUEST_SCHEME'])) {
        $headers[] = 'X-Forwarded-Proto: ' . $_SERVER['REQUEST_SCHEME'];
    }

    return $headers;
}

/**
 * Ajoute un champ texte au corps multipart en cours de construction.
 */
function appendTextPart(
    string &$body,
    string $boundary,
    string $name,
    string $value
): void {
    $body .= '--' . $boundary . "\r\n";
    $body .= 'Content-Disposition: form-data; name="' . $name . '"' . "\r\n\r\n";
    $body .= $value . "\r\n";
}

/**
 * Aplatit un champ $_POST (scalaire ou tableau imbriqué) en parties texte.
 */
function appendPostField(
    string &$body,
    string $boundary,
    string $name,
    mixed $value
): void {
    if (is_array($value)) {
        foreach ($value as $key => $item) {
            appendPostField($body, $boundary, $name . '[' . $key . ']', $item);
        }

        return;
    }

    if (is_scalar($value) || $value === null) {
        appendTextPart($body, $boundary, $name, (string) $value);
    }
}

/**
 * Normalise une entrée de $_FILES.
 *
 * PHP l'expose sous deux formes selon le nom du champ : « photo » donne des
 * chaînes, « photos[] » donne des tableaux parallèles. On ramène les deux à
 * une liste de fichiers pour les traiter de la même façon.
 *
 * @return array<int, array{name: string, type: string, tmp_name: string, error: int}>
 */
function normaliseUploadedFiles(array $file): array
{
    if (!isset($file['tmp_name'])) {
        return [];
    }

    if (!is_array($file['tmp_name'])) {
        return [[
            'name' => (string) ($file['name'] ?? 'upload'),
            'type' => (string) ($file['type'] ?? ''),
            'tmp_name' => (string) $file['tmp_name'],
            'error' => (int) ($file['error'] ?? UPLOAD_ERR_OK),
        ]];
    }

    $files = [];

    foreach (array_keys($file['tmp_name']) as $index) {
        $files[] = [
            'name' => (string) ($file['name'][$index] ?? 'upload'),
            'type' => (string) ($file['type'][$index] ?? ''),
            'tmp_name' => (string) $file['tmp_name'][$index],
            'error' => (int) ($file['error'][$index] ?? UPLOAD_ERR_OK),
        ];
    }

    return $files;
}

/**
 * Reconstruit un corps multipart que PHP a déjà consommé.
 *
 * Filet de sécurité : voir la note sur enable_post_data_reading dans
 * proxyRequest(). Le corps est réassemblé à la main plutôt que confié au
 * tableau CURLOPT_POSTFIELDS de cURL, parce qu'un tableau PHP ne peut pas
 * porter deux fois la même clef : plusieurs photos envoyées dans un champ
 * « photos » y perdaient tout sauf un fichier. Ici chaque fichier devient une
 * partie distincte et les noms de champ répétés survivent.
 *
 * @return array{body: string, contentType: string}|null null si rien à envoyer.
 */
function rebuildMultipartBody(): ?array
{
    $boundary = '----proxyBoundary' . bin2hex(random_bytes(16));
    $body = '';
    $hasPart = false;

    foreach ($_POST as $name => $value) {
        appendPostField($body, $boundary, (string) $name, $value);
        $hasPart = true;
    }

    foreach ($_FILES as $name => $file) {
        foreach (normaliseUploadedFiles($file) as $uploaded) {
            if ($uploaded['error'] !== UPLOAD_ERR_OK || $uploaded['tmp_name'] === '') {
                continue;
            }

            $content = @file_get_contents($uploaded['tmp_name']);

            if ($content === false) {
                continue;
            }

            // Un guillemet ou un saut de ligne dans le nom de fichier
            // casserait l'en-tête de la partie (et permettrait d'en injecter
            // une autre) : ils sont retirés, le nom n'a qu'une valeur
            // indicative pour le serveur distant.
            $filename = str_replace(['"', "\r", "\n"], '', $uploaded['name']);
            $type = $uploaded['type'] !== ''
                ? $uploaded['type']
                : 'application/octet-stream';

            $body .= '--' . $boundary . "\r\n";
            $body .= 'Content-Disposition: form-data; name="' . $name
                . '"; filename="' . ($filename !== '' ? $filename : 'upload') . '"' . "\r\n";
            $body .= 'Content-Type: ' . $type . "\r\n\r\n";
            $body .= $content . "\r\n";
            $hasPart = true;
        }
    }

    if (!$hasPart) {
        return null;
    }

    $body .= '--' . $boundary . '--' . "\r\n";

    return [
        'body' => $body,
        'contentType' => 'multipart/form-data; boundary=' . $boundary,
    ];
}

/**
 * GET /__proxy-status : état du proxy lui-même, sans toucher au serveur
 * distant. Permet de vérifier d'un simple curl que la version déployée est à
 * jour et que le corps des requêtes traverse bien : enablePostDataReading doit
 * valoir false, sinon c'est le chemin de reconstruction qui travaille.
 */
function proxyStatus(): void
{
    header('Content-Type: application/json');
    header('Cache-Control: no-store');

    echo json_encode([
        'proxyVersion' => PROXY_VERSION,
        'phpVersion' => PHP_VERSION,
        'sapi' => PHP_SAPI,
        'enablePostDataReading' => (bool) ini_get('enable_post_data_reading'),
        'fileUploads' => (bool) ini_get('file_uploads'),
        'postMaxSize' => ini_get('post_max_size'),
        'uploadMaxFilesize' => ini_get('upload_max_filesize'),
        'curl' => extension_loaded('curl'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
}

/**
 * Transmet la requête au serveur distant.
 */
function proxyRequest(): void
{
    $remoteUrl = buildRemoteUrl();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    $body = file_get_contents('php://input');

    if ($body === false) {
        $body = '';
    }

    // Corps multipart (upload de photo).
    //
    // Par défaut, PHP lit et découpe lui-même un corps multipart/form-data
    // vers $_POST / $_FILES, et php://input est alors VIDE. Un proxy qui se
    // contente de relayer php://input transmet donc une requête sans corps :
    // le serveur distant répond « photo (fichier image) est requis » et
    // l'upload d'images ne fonctionne jamais à travers ce proxy.
    //
    // Deux défenses, dans cet ordre :
    //  1. enable_post_data_reading=0 (voir .user.ini et .htaccess) : PHP ne
    //     touche plus au corps, php://input redevient lisible, et la requête
    //     traverse à l'identique, octet pour octet. C'est le chemin normal.
    //  2. Si la directive n'a pas pu être appliquée — .user.ini absent du
    //     dépôt FTP (les clients FTP masquent volontiers les fichiers dont le
    //     nom commence par un point), hébergement qui l'ignore — le corps est
    //     reconstruit depuis $_POST / $_FILES. Plus coûteux, mais l'upload
    //     fonctionne quand même.
    // GET /__proxy-status indique laquelle des deux est active.
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    $isMultipart = stripos($contentType, 'multipart/form-data') !== false;
    $rebuilt = null;

    if ($body === '' && $isMultipart && ($_POST !== [] || $_FILES !== [])) {
        $rebuilt = rebuildMultipartBody();
    }

    $curl = curl_init();

    if ($curl === false) {
        http_response_code(500);
        echo 'Impossible d initialiser le proxy.';
        return;
    }

    curl_setopt_array($curl, [
        CURLOPT_URL => $remoteUrl,

        CURLOPT_CUSTOMREQUEST => $method,

        CURLOPT_HTTPHEADER => buildForwardHeaders($rebuilt['contentType'] ?? null),

        CURLOPT_RETURNTRANSFER => false,

        CURLOPT_HEADER => false,

        CURLOPT_CONNECTTIMEOUT => CONNECT_TIMEOUT,

        CURLOPT_TIMEOUT => REQUEST_TIMEOUT,

        CURLOPT_FOLLOWLOCATION => false,

        CURLOPT_ENCODING => '',

        CURLOPT_WRITEFUNCTION => function (
            $curlHandle,
            string $data
        ): int {
            echo $data;

            if (function_exists('ob_flush')) {
                @ob_flush();
            }

            flush();

            return strlen($data);
        },

        CURLOPT_HEADERFUNCTION => function (
            $curlHandle,
            string $headerLine
        ): int {
            $headerLength = strlen($headerLine);
            $header = trim($headerLine);

            if ($header === '') {
                return $headerLength;
            }

            // Extraction du status HTTP
            if (preg_match(
                '#^HTTP/\d(?:\.\d)?\s+(\d{3})#i',
                $header,
                $matches
            )) {
                http_response_code((int) $matches[1]);

                return $headerLength;
            }

            // Headers à ne pas retransmettre directement
            $parts = explode(':', $header, 2);

            if (count($parts) !== 2) {
                return $headerLength;
            }

            $name = trim($parts[0]);
            $value = trim($parts[1]);

            $excludedHeaders = [
                'transfer-encoding',
                'content-length',
                'connection',
                'keep-alive',
                'content-encoding',
            ];

            if (
                in_array(
                    strtolower($name),
                    $excludedHeaders,
                    true
                )
            ) {
                return $headerLength;
            }

            header($name . ': ' . $value, false);

            return $headerLength;
        },
    ]);

    // Envoie le body pour les requêtes POST, PUT, PATCH, etc.
    if (
        $body !== false &&
        $body !== '' &&
        !in_array($method, ['GET', 'HEAD'], true)
    ) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        if ($rebuilt !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $rebuilt['body']);
        } elseif ($body !== '') {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
    }

    $success = curl_exec($curl);

    if ($success === false) {
        $error = curl_error($curl);
        $errorCode = curl_errno($curl);

        curl_close($curl);

        if (!headers_sent()) {
            http_response_code(502);
            header('Content-Type: application/json');
        }

        echo json_encode([
            'error' => 'Bad Gateway',
            'message' => 'Le serveur distant est inaccessible.',
            'code' => $errorCode,
            'details' => $error,
        ]);

        return;
    }

    curl_close($curl);
}

if ((parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/') === '/__proxy-status') {
    proxyStatus();
} else {
    proxyRequest();
}

