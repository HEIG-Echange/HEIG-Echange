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
function buildForwardHeaders(): array
{
    $incomingHeaders = getRequestHeaders();
    $headers = [];

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
 * Transmet la requête au serveur distant.
 */
function proxyRequest(): void
{
    $remoteUrl = buildRemoteUrl();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    $body = file_get_contents('php://input');

    $curl = curl_init();

    if ($curl === false) {
        http_response_code(500);
        echo 'Impossible d initialiser le proxy.';
        return;
    }

    curl_setopt_array($curl, [
        CURLOPT_URL => $remoteUrl,

        CURLOPT_CUSTOMREQUEST => $method,

        CURLOPT_HTTPHEADER => buildForwardHeaders(),

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

