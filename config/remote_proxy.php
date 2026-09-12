<?php
// Path: T2Editor/config/remote_proxy.php
// Fixed-upstream same-origin proxy helpers for T2Search/T2Meme.

include_once __DIR__ . '/t2_config.php';
include_once __DIR__ . '/upload_config.php';

if (!function_exists('t2proxy_fail')) {
    function t2proxy_fail(int $status, string $message): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        echo json_encode(['success' => false, 'message' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

if (!function_exists('t2proxy_require_same_origin')) {
    function t2proxy_require_same_origin(): void
    {
        if (!function_exists('check_request_origin') || !check_request_origin()) {
            t2proxy_fail(403, 'Access denied.');
        }

        // Origin이 생략될 수 있는 GET에서도 최신 브라우저가 cross-site로
        // 표시한 요청은 차단한다. 구형 Safari/웹뷰는 헤더가 없어도 허용한다.
        $fetch_site = strtolower(trim((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')));
        if ($fetch_site === 'cross-site') {
            t2proxy_fail(403, 'Cross-site proxy requests are not allowed.');
        }
    }
}

if (!function_exists('t2proxy_read_json_body')) {
    function t2proxy_read_json_body(int $max_bytes = 2097152): array
    {
        $declared = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
        if ($declared > $max_bytes) {
            t2proxy_fail(413, 'Request body is too large.');
        }

        $raw = file_get_contents('php://input', false, null, 0, $max_bytes + 1);
        if ($raw === false || strlen($raw) > $max_bytes) {
            t2proxy_fail(413, 'Request body is too large.');
        }

        $data = json_decode($raw, true);
        if (!is_array($data) || json_last_error() !== JSON_ERROR_NONE) {
            t2proxy_fail(400, 'Invalid JSON request body.');
        }
        return $data;
    }
}

if (!function_exists('t2proxy_fetch_json')) {
    function t2proxy_fetch_json(
        string $url,
        string $method = 'GET',
        array $headers = [],
        ?string $body = null,
        int $max_bytes = 5242880
    ): array {
        if (!function_exists('curl_init')) {
            return ['error' => 'The PHP cURL extension is required.'];
        }

        $response_body = '';
        $too_large = false;
        $ch = curl_init($url);
        $options = [
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'T2Editor-RemoteProxy/1.0',
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_WRITEFUNCTION => function ($curl, $chunk) use (&$response_body, &$too_large, $max_bytes) {
                if (strlen($response_body) + strlen($chunk) > $max_bytes) {
                    $too_large = true;
                    return 0;
                }
                $response_body .= $chunk;
                return strlen($chunk);
            },
        ];

        $method = strtoupper($method);
        if ($method === 'POST') {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = $body ?? '';
        } elseif ($method !== 'GET') {
            $options[CURLOPT_CUSTOMREQUEST] = $method;
            if ($body !== null) $options[CURLOPT_POSTFIELDS] = $body;
        }

        curl_setopt_array($ch, $options);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $errno = curl_errno($ch);
        curl_close($ch);

        if ($too_large) return ['error' => 'Upstream response is too large.'];
        if ($errno !== 0 && $errno !== CURLE_WRITE_ERROR) {
            return ['error' => 'Upstream request failed (curl errno ' . $errno . ').'];
        }
        if ($status < 100) return ['error' => 'Upstream did not return a valid HTTP response.'];

        json_decode($response_body, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return ['error' => 'Upstream returned invalid JSON.', 'status' => $status];
        }

        return ['status' => $status, 'body' => $response_body];
    }
}

if (!function_exists('t2proxy_output_json_response')) {
    function t2proxy_output_json_response(array $response): void
    {
        if (isset($response['error'])) {
            t2proxy_fail(502, (string)$response['error']);
        }

        $status = isset($response['status']) ? (int)$response['status'] : 502;
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        echo (string)($response['body'] ?? '');
        exit;
    }
}
