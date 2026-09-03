<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

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
 */
function buildForwardHeaders(bool $dropContentType = false): array
{
    $incomingHeaders = getRequestHeaders();
    $headers = [];

    // Ces headers sont gérés par cURL ou doivent être remplacés.
    $skipped = ['host', 'content-length', 'connection', 'accept-encoding'];

    // Corps multipart reconstruit : la frontière du Content-Type d'origine ne
    // correspond plus à rien, c'est cURL qui pose le sien.
    if ($dropContentType) {
        $skipped[] = 'content-type';
    }

    foreach ($incomingHeaders as $name => $value) {
        $lowerName = strtolower($name);

        if (in_array($lowerName, $skipped, true)) {
            continue;
        }

        $headers[] = $name . ': ' . $value;
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
 * Reconstruit un corps multipart que PHP a déjà consommé.
 *
 * Filet de sécurité : voir la note sur enable_post_data_reading dans
 * proxyRequest(). cURL regénère lui-même le corps (et sa frontière) à partir
 * du tableau renvoyé, donc l'appelant doit laisser cURL poser le
 * Content-Type.
 *
 * Limite connue : PHP n'expose qu'UN fichier par nom de champ quand ce nom ne
 * se termine pas par « [] ». Un envoi de plusieurs photos en une requête perd
 * donc tout sauf la dernière — d'où l'intérêt de désactiver complètement le
 * parsing plutôt que de dépendre de cette reconstruction.
 */
function rebuildMultipartBody(): array
{
    $fields = [];

    foreach ($_POST as $name => $value) {
        if (is_scalar($value)) {
            $fields[$name] = (string) $value;
        }
    }

    foreach ($_FILES as $name => $file) {
        if (!is_string($file['tmp_name'] ?? null) || $file['tmp_name'] === '') {
            continue;
        }

        $fields[$name] = new CURLFile(
            $file['tmp_name'],
            $file['type'] ?: 'application/octet-stream',
            $file['name'] ?: 'upload'
        );
    }

    return $fields;
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
    // Le vrai correctif est enable_post_data_reading=0 (voir .user.ini et
    // .htaccess) : PHP ne touche plus au corps, php://input redevient
    // lisible, et la requête traverse à l'identique — y compris avec
    // plusieurs fichiers. Le code ci-dessous n'est qu'un filet de sécurité si
    // cette directive n'a pas pu être appliquée sur l'hébergement.
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    $isMultipart = stripos($contentType, 'multipart/form-data') !== false;
    $rebuiltFields = null;

    if ($body === '' && $isMultipart && ($_POST !== [] || $_FILES !== [])) {
        $rebuiltFields = rebuildMultipartBody();
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

        CURLOPT_HTTPHEADER => buildForwardHeaders($rebuiltFields !== null),

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
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        if ($rebuiltFields !== null) {
            // Tableau : cURL construit lui-même le corps multipart.
            curl_setopt($curl, CURLOPT_POSTFIELDS, $rebuiltFields);
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

proxyRequest();

