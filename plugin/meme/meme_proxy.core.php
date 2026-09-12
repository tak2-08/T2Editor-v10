<?php
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }
// Path: T2Editor/plugin/meme/meme_proxy.php
//
// [BUG FIX - v10.3.0] 밈 이미지 삽입 실패 수정 (서버측 이미지 프록시)
//
// ── 문제 ────────────────────────────────────────────────────────────────
// meme.js 의 _downloadImageAsFile() 은 밈 이미지를 브라우저에서 직접
// 다운로드하려고 시도한다:
//   1차: fetch(url, {mode:'cors'})            → 이미지 서버가
//   2차: Image(crossOrigin='anonymous')+canvas → Access-Control-Allow-Origin
//                                                 헤더를 보내지 않으면 둘 다 실패
//
// T2Meme API 서버(dsclub.kr)의 정적 이미지 응답에는 CORS 헤더가 없으므로
// 사용자 사이트(다른 도메인)에서는 항상 아래 오류가 발생했다:
//   "이미지 다운로드 실패 (fetch: Failed to fetch,
//    canvas: Image 로드 실패 (CORS 또는 네트워크))"
//
// ── 해결 ────────────────────────────────────────────────────────────────
// 이 파일은 같은 오리진(same-origin)에서 동작하는 서버측 이미지 프록시다.
// 서버(PHP)에는 CORS 제약이 없으므로 원격 이미지를 대신 다운로드해
// 브라우저로 스트리밍한다. meme.js 는 이 프록시를 1차로 시도하고,
// 실패 시 기존 fetch/canvas 경로로 폴백한다.
//
// ── SSRF 방어 ───────────────────────────────────────────────────────────
// 임의 URL 프록시는 SSRF(서버측 요청 위조) 공격 표면이 되므로 다음을 강제:
//   · GET 전용 + check_request_origin() (같은 사이트에서의 요청만)
//   · http(s) 스킴만 허용, userinfo(user:pass@) 포함 URL 거부
//   · 호스트 allowlist (기본: dsclub.kr 및 그 서브도메인)
//     → config/t2_config.php 에서 T2EDITOR_MEME_PROXY_HOSTS 상수(배열)로
//       오버라이드 가능. 예) define('T2EDITOR_MEME_PROXY_HOSTS', ['example.com']);
//   · IP 리터럴 호스트 거부 + DNS 해석 결과가 사설/루프백/링크로컬 대역이면 거부
//   · 리다이렉트는 최대 3회, 매 hop 마다 위 검증을 다시 수행 (자동 follow 금지)
//   · 다운로드 크기 상한 (기본 20MB) / 타임아웃 (연결 5초, 전체 20초)
//   · 응답이 실제 이미지인지 시그니처+getimagesizefromstring()으로 검증 후에만 출력
// ─────────────────────────────────────────────────────────────────────────

// 설정 상수와 공통 보안 함수(check_request_origin 등) 로드
include_once __DIR__ . '/../../config/t2_config.php';
include_once __DIR__ . '/../../config/upload_config.php';

function t2meme_proxy_fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── 요청 기본 검증 ────────────────────────────────────────────────────────
if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    t2meme_proxy_fail(405, 'Method not allowed.');
}
if (!function_exists('check_request_origin') || !check_request_origin()) {
    t2meme_proxy_fail(403, 'Access denied.');
}
$fetch_site = strtolower(trim((string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')));
if ($fetch_site === 'cross-site') {
    t2meme_proxy_fail(403, 'Cross-site proxy requests are not allowed.');
}
if (!function_exists('curl_init')) {
    t2meme_proxy_fail(500, 'cURL extension is required for the meme image proxy.');
}

$raw_url = isset($_GET['url']) ? (string)$_GET['url'] : '';
if ($raw_url === '' || strlen($raw_url) > 2048) {
    t2meme_proxy_fail(400, 'Missing or invalid url parameter.');
}

// ── 설정 ─────────────────────────────────────────────────────────────────
// 허용 호스트: T2Meme 서비스 기본 호스트 + 사이트별 오버라이드
$T2MEME_ALLOWED_HOSTS = ['dsclub.kr'];
if (defined('T2EDITOR_MEME_PROXY_HOSTS') && is_array(T2EDITOR_MEME_PROXY_HOSTS) && count(T2EDITOR_MEME_PROXY_HOSTS) > 0) {
    $T2MEME_ALLOWED_HOSTS = T2EDITOR_MEME_PROXY_HOSTS;
}
$T2MEME_MAX_BYTES    = defined('T2EDITOR_MEME_PROXY_MAX_BYTES') ? (int)T2EDITOR_MEME_PROXY_MAX_BYTES : 20 * 1024 * 1024;
$T2MEME_MAX_REDIRECT = 3;

// ── URL 검증 (매 리다이렉트 hop 마다 재호출) ─────────────────────────────
function t2meme_validate_url(string $url, array $allowed_hosts): array {
    $parts = parse_url($url);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
        return [false, 'Malformed URL.'];
    }
    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return [false, 'Only http(s) URLs are allowed.'];
    }
    // user:pass@host 형태 거부 (호스트 혼동 공격 방지)
    if (isset($parts['user']) || isset($parts['pass'])) {
        return [false, 'URLs with userinfo are not allowed.'];
    }
    // 비표준 포트 거부
    if (isset($parts['port']) && !in_array((int)$parts['port'], [80, 443], true)) {
        return [false, 'Non-standard ports are not allowed.'];
    }

    $host = strtolower(rtrim($parts['host'], '.'));

    // IP 리터럴 호스트 거부 (IPv4 / [IPv6])
    if (filter_var($host, FILTER_VALIDATE_IP) !== false || str_starts_with($host, '[')) {
        return [false, 'IP-literal hosts are not allowed.'];
    }

    // allowlist: 정확히 일치하거나 허용 도메인의 서브도메인
    $host_ok = false;
    foreach ($allowed_hosts as $allowed) {
        $allowed = strtolower(trim((string)$allowed));
        if ($allowed === '') continue;
        if ($host === $allowed || str_ends_with($host, '.' . $allowed)) {
            $host_ok = true;
            break;
        }
    }
    if (!$host_ok) {
        return [false, 'Host is not in the meme proxy allowlist.'];
    }

    // DNS 해석 결과가 사설/예약 대역이면 거부 (DNS 리바인딩 방어)
    $records = @dns_get_record($host, DNS_A + DNS_AAAA);
    if (is_array($records)) {
        foreach ($records as $rec) {
            $ip = $rec['ip'] ?? ($rec['ipv6'] ?? null);
            if ($ip === null) continue;
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                return [false, 'Host resolves to a private or reserved address.'];
            }
        }
    }

    return [true, ''];
}

// ── 단일 요청 수행 (자동 리다이렉트 없이) ─────────────────────────────────
function t2meme_fetch_once(string $url, int $max_bytes): array {
    $ch = curl_init($url);
    $body = '';
    $aborted = false;

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_FOLLOWLOCATION => false, // 리다이렉트는 호출부에서 검증 후 수동 처리
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_USERAGENT      => 'T2Editor-MemeProxy/1.0',
        CURLOPT_HTTPHEADER     => ['Accept: image/*'],
        // 스트리밍으로 받으면서 크기 상한 초과 시 즉시 중단
        CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$body, &$aborted, $max_bytes) {
            $body .= $chunk;
            if (strlen($body) > $max_bytes) {
                $aborted = true;
                return -1; // 전송 중단
            }
            return strlen($chunk);
        },
    ]);

    curl_exec($ch);
    $status       = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $redirect_url = (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $errno        = curl_errno($ch);
    curl_close($ch);

    if ($aborted) {
        return ['error' => 'Image exceeds the maximum allowed size.'];
    }
    // WRITEFUNCTION 중단(-1) 이외의 cURL 오류
    if ($errno !== 0 && $errno !== CURLE_WRITE_ERROR) {
        return ['error' => 'Upstream request failed (curl errno ' . $errno . ').'];
    }

    return ['status' => $status, 'redirect' => $redirect_url, 'body' => $body];
}

// ── 메인 흐름: 검증 → 요청 → (검증된) 리다이렉트 추적 ────────────────────
$url = $raw_url;
$response = null;

for ($hop = 0; $hop <= $T2MEME_MAX_REDIRECT; $hop++) {
    [$ok, $why] = t2meme_validate_url($url, $T2MEME_ALLOWED_HOSTS);
    if (!$ok) {
        t2meme_proxy_fail(400, $why);
    }

    $response = t2meme_fetch_once($url, $T2MEME_MAX_BYTES);
    if (isset($response['error'])) {
        t2meme_proxy_fail(502, $response['error']);
    }

    $status = $response['status'];
    if ($status >= 300 && $status < 400 && $response['redirect'] !== '') {
        if ($hop === $T2MEME_MAX_REDIRECT) {
            t2meme_proxy_fail(502, 'Too many redirects.');
        }
        $url = $response['redirect'];
        continue; // 다음 hop 도 allowlist/사설망 검증을 다시 통과해야 함
    }
    break;
}

if ($response === null || $response['status'] < 200 || $response['status'] >= 300) {
    t2meme_proxy_fail(502, 'Upstream returned HTTP ' . ($response['status'] ?? 0) . '.');
}

$body = $response['body'];
if ($body === '') {
    t2meme_proxy_fail(502, 'Upstream returned an empty body.');
}

// ── 콘텐츠 검증: upstream Content-Type은 신뢰하지 않는다 ────────────────
// Fileinfo 없이 허용 포맷의 시그니처와 PHP 이미지 헤더 판독 결과를 교차 검증한다.
$image = function_exists('t2editor_inspect_image_bytes')
    ? t2editor_inspect_image_bytes($body)
    : null;
if ($image === null) {
    t2meme_proxy_fail(415, 'Upstream content is not a valid supported image.');
}

// ── 출력 ─────────────────────────────────────────────────────────────────
header('Content-Type: ' . $image['mime']);
header('Content-Length: ' . strlen($body));
header('X-Content-Type-Options: nosniff');
header('Content-Disposition: inline');
header('Cache-Control: private, max-age=3600');
echo $body;
exit;
