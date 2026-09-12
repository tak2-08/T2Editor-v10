<?php
// Path: T2Editor/plugin/linkcard/linkcard_fetch.core.php
// Developer note: linkcard 엔드포인트 입력명·응답 JSON·보안 허용목록은 클라이언트 코드와 함께 수정한다.
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }
/**
 * T2Editor — 링크 카드 OG/메타 태그 fetch 엔드포인트
 *
 * 사용자가 붙여넣은 URL의 OG(Open Graph)/메타 태그(제목·설명·대표이미지·
 * 사이트명)를 서버가 대신 가져와 JSON으로 반환한다. 브라우저에서 직접
 * fetch() 하면 대상 사이트가 CORS(Access-Control-Allow-Origin)를 열어두지
 * 않는 한 대부분 실패하므로 서버 프록시가 필요하다.
 *
 * 이 엔드포인트는 사용자가 "이 서버로 하여금 사실상 임의의 URL에
 * 요청을 보내게" 만들 수 있다는 점에서 이 코드베이스에 새로 추가되는 공격면
 * 이다(기존 curl 사용처는 전부 고정된 신뢰 API 엔드포인트만 호출했음). 아래를
 * 전부 방어한다:
 *   · http/https 스킴만 허용 (file://, gopher://, ftp:// 등 차단)
 *   · 포트는 80/443만 허용 (내부망 포트 스캔 오라클로 악용 방지)
 *   · 호스트명을 DNS로 직접 resolve해 사설/루프백/링크로컬/예약 대역 차단
 *     (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *      169.254.0.0/16 — 클라우드 메타데이터 엔드포인트 169.254.169.254 포함 —,
 *      0.0.0.0/8, IPv6 루프백/링크로컬/ULA 등)
 *   · 리다이렉트를 curl이 자동으로 따라가게 하지 않는다(CURLOPT_FOLLOWLOCATION
 *     은 재검증 없이 새 호스트로 그대로 이동해 위 검증을 우회당할 수 있음).
 *     Location 헤더를 직접 읽어 "우리가" 처음부터 다시 검증한 뒤 요청한다
 *     (최대 3회).
 *   · 연결/전체 타임아웃, 응답 바디 크기 상한(512KB)
 *   · Content-Type 이 text/html 계열이 아니면 파싱하지 않고 즉시 중단
 *
 * 응답 형식: { success: true, data: {title, description, image, siteName, url} }
 *          | { success: false, message: string }
 */

ob_start();

function t2lc_json(array $data, int $status = 200): void {
    while (ob_get_level() > 0) { ob_end_clean(); }
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // Security: 이 응답은 fetch()로만 소비되며 브라우저에 직접 렌더링되지 않지만,
    // 방어적으로 캐시하지 않도록 명시.
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// editor.lib.php 를 거치지 않고 이 파일이 단독으로 요청되므로(다른 plugin/*_upload.php
// 들과 동일한 패턴) 필요한 설정을 직접 include 한다.
// [TEST] T2LC_TESTING 이 정의되어 있으면(단위 테스트가 순수 함수만 재사용할
// 목적으로 이 파일을 include 할 때) 실제 HTTP 요청을 전제로 하는 아래
// 진입점 처리를 건너뛴다.
if (!defined('T2LC_TESTING')) {
include_once __DIR__ . '/../../config/upload_config.php';

if (!function_exists('check_request_origin') || !check_request_origin()) {
    t2lc_json(['success' => false, 'message' => 'Invalid access.'], 403);
}

if (!function_exists('curl_init')) {
    t2lc_json(['success' => false, 'message' => 'Server does not support outbound fetch (curl extension missing).'], 500);
}

$rawUrl = isset($_GET['url']) ? trim((string)$_GET['url']) : '';
if ($rawUrl === '' || strlen($rawUrl) > 2048) {
    t2lc_json(['success' => false, 'message' => 'Missing or invalid url.'], 400);
}
}

// Security: IP 차단 판정: 사설/루프백/링크로컬/예약 대역이면 true.
// filter_var 의 NO_PRIV_RANGE + NO_RES_RANGE 플래그가 IPv4/IPv6 사설·예약
// 대역을 함께 걸러준다 (169.254.169.254 클라우드 메타데이터도 링크로컬이라
// 포함됨).
function t2lc_is_blocked_ip(string $ip): bool {
    $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
    return filter_var($ip, FILTER_VALIDATE_IP, $flags) === false;
}

/**
 * 호스트명을 IP로 resolve한 뒤 모든 레코드가 안전한 대역인지 검사한다.
 * 하나라도 차단 대역이면(= DNS rebinding 등으로 공용 IP와 사설 IP를 동시에
 * 응답하는 경우도 포함) 전체를 신뢰하지 않는다.
 * @return string|null 안전하면 사용할 IP 하나, 아니면 null.
 */
function t2lc_resolve_and_check(string $host): ?string {
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return t2lc_is_blocked_ip($host) ? null : $host;
    }

    $records = @dns_get_record($host, DNS_A + DNS_AAAA);
    if (!is_array($records) || count($records) === 0) {
        // dns_get_record 가 비활성화된 환경 대비 gethostbyname 폴백(IPv4 한정).
        $ipv4 = @gethostbyname($host);
        if ($ipv4 === $host) return null; // 해석 실패
        return t2lc_is_blocked_ip($ipv4) ? null : $ipv4;
    }

    $first = null;
    foreach ($records as $rec) {
        $ip = $rec['ip'] ?? ($rec['ipv6'] ?? null);
        if (!$ip) continue;
        if (t2lc_is_blocked_ip($ip)) return null;
        if ($first === null) $first = $ip;
    }
    return $first;
}

/** 스킴·포트가 허용 범위인지 검사. */
function t2lc_validate_url_parts(array $parts): ?string {
    if (empty($parts['host']) || empty($parts['scheme'])) return 'Invalid URL.';
    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') return 'Unsupported scheme.';
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    if (!in_array($port, [80, 443], true)) return 'Unsupported port.';
    return null;
}

/** 상대 Location 헤더를 현재 URL 기준 절대 URL로 변환. */
function t2lc_resolve_redirect(string $base, string $location): ?string {
    if (preg_match('#^https?://#i', $location)) return $location;
    $parts = parse_url($base);
    if (!$parts || empty($parts['host'])) return null;
    $scheme = $parts['scheme'] ?? 'https';
    $host   = $parts['host'];
    $port   = isset($parts['port']) ? ':' . $parts['port'] : '';
    if (strpos($location, '//') === 0) {
        return $scheme . ':' . $location;
    }
    if (strpos($location, '/') === 0) {
        return "{$scheme}://{$host}{$port}{$location}";
    }
    // 상대 경로 — 원본 경로 디렉토리 기준으로 이어붙임.
    $basePath = $parts['path'] ?? '/';
    $dir = substr($basePath, 0, strrpos($basePath, '/') + 1);
    return "{$scheme}://{$host}{$port}{$dir}{$location}";
}

/**
 * SSRF 검증을 매 홉마다 새로 수행하며 최대 $maxRedirects 회까지 직접
 * 리다이렉트를 추적하는 fetch.
 */
function t2lc_fetch_html(string $url, int $maxRedirects = 3): array {
    for ($i = 0; $i <= $maxRedirects; $i++) {
        $parts = parse_url($url);
        if ($parts === false) return ['ok' => false, 'message' => 'Invalid URL.'];
        $err = t2lc_validate_url_parts($parts);
        if ($err) return ['ok' => false, 'message' => $err];

        $ip = t2lc_resolve_and_check($parts['host']);
        if ($ip === null) return ['ok' => false, 'message' => 'Blocked or unresolvable host.'];

        $bodyBuf = '';
        $bytesRead = 0;
        $maxBytes = 512 * 1024; // 512KB 상한 — OG 태그는 보통 <head> 안에 있으므로 충분
        $responseHeaders = [];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL             => $url,
            CURLOPT_HEADER          => false,
            CURLOPT_FOLLOWLOCATION  => false, // 우리가 직접 검증하며 따라간다 (SSRF 방지 핵심)
            CURLOPT_TIMEOUT         => 6,
            CURLOPT_CONNECTTIMEOUT  => 4,
            CURLOPT_SSL_VERIFYPEER  => true,
            CURLOPT_SSL_VERIFYHOST  => 2,
            CURLOPT_USERAGENT       => 'Mozilla/5.0 (compatible; T2EditorLinkPreview/1.0; +https://dsclub.kr)',
            CURLOPT_HTTPHEADER      => ['Accept: text/html,application/xhtml+xml'],
            CURLOPT_PROTOCOLS       => defined('CURLPROTO_HTTP') ? (CURLPROTO_HTTP | CURLPROTO_HTTPS) : null,
            CURLOPT_REDIR_PROTOCOLS => defined('CURLPROTO_HTTP') ? (CURLPROTO_HTTP | CURLPROTO_HTTPS) : null,
            CURLOPT_HEADERFUNCTION  => function ($ch, $headerLine) use (&$responseHeaders) {
                $len = strlen($headerLine);
                $kv = explode(':', $headerLine, 2);
                if (count($kv) === 2) {
                    $responseHeaders[strtolower(trim($kv[0]))] = trim($kv[1]);
                }
                return $len;
            },
            CURLOPT_WRITEFUNCTION   => function ($ch, $chunk) use (&$bodyBuf, &$bytesRead, $maxBytes) {
                $bytesRead += strlen($chunk);
                if ($bytesRead > $maxBytes) {
                    return 0; // curl 은 write callback 이 실제 길이보다 작은 값을 반환하면 전송을 중단한다.
                }
                $bodyBuf .= $chunk;
                return strlen($chunk);
            },
        ]);

        $execOk = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($execOk === false && $bytesRead === 0) {
            return ['ok' => false, 'message' => $curlErr ?: 'Fetch failed.'];
        }

        if ($httpCode >= 300 && $httpCode < 400) {
            $loc = $responseHeaders['location'] ?? null;
            if (!$loc) return ['ok' => false, 'message' => 'Redirect without Location header.'];
            $next = t2lc_resolve_redirect($url, $loc);
            if (!$next) return ['ok' => false, 'message' => 'Invalid redirect target.'];
            $url = $next;
            continue; // 루프 상단에서 새 URL 에 대해 SSRF 검증부터 다시 수행
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            return ['ok' => false, 'message' => "Remote server returned HTTP {$httpCode}."];
        }

        if ($contentType !== ''
            && stripos($contentType, 'text/html') === false
            && stripos($contentType, 'application/xhtml') === false) {
            return ['ok' => false, 'message' => 'Not an HTML page.'];
        }

        return ['ok' => true, 'html' => $bodyBuf, 'finalUrl' => $url];
    }
    return ['ok' => false, 'message' => 'Too many redirects.'];
}

// OG/메타 태그 파싱
function t2lc_abs_url(string $base, string $maybeRelative): string {
    if ($maybeRelative === '') return '';
    if (preg_match('#^https?://#i', $maybeRelative)) return $maybeRelative;
    if (preg_match('#^data:#i', $maybeRelative)) return ''; // data: 이미지는 카드에서 사용 안 함
    $resolved = t2lc_resolve_redirect($base, $maybeRelative);
    return $resolved ?? '';
}

function t2lc_extract_meta(string $html, string $finalUrl): array {
    $prev = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    // 인코딩 선언이 없는 문서 대비 UTF-8 강제 지정.
    $doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);

    $xpath = new DOMXPath($doc);

    $getMeta = function (array $selectors) use ($xpath): string {
        foreach ($selectors as [$attr, $value]) {
            $nodes = $xpath->query("//meta[@{$attr}='{$value}']/@content");
            if ($nodes && $nodes->length > 0) {
                $v = trim($nodes->item(0)->nodeValue);
                if ($v !== '') return $v;
            }
        }
        return '';
    };

    $title = $getMeta([['property', 'og:title'], ['name', 'twitter:title']]);
    if ($title === '') {
        $titleNodes = $xpath->query('//title');
        if ($titleNodes && $titleNodes->length > 0) {
            $title = trim($titleNodes->item(0)->nodeValue);
        }
    }

    $description = $getMeta([
        ['property', 'og:description'],
        ['name', 'twitter:description'],
        ['name', 'description'],
    ]);

    $image = $getMeta([['property', 'og:image'], ['name', 'twitter:image']]);
    if ($image !== '') {
        $image = t2lc_abs_url($finalUrl, $image);
    }

    $siteName = $getMeta([['property', 'og:site_name']]);
    if ($siteName === '') {
        $host = parse_url($finalUrl, PHP_URL_HOST);
        $siteName = $host ?: '';
    }

    $favicon = t2lc_extract_favicon($xpath, $finalUrl);
    if ($favicon === '') {
        // <link rel="icon"> 류가 전혀 없는 사이트도 흔하다(특히 오래된/한국
        // 커뮤니티 사이트). 관례상 위치인 /favicon.ico 를 마지막으로 시도.
        $favicon = t2lc_verify_favicon_fallback($finalUrl);
    }

    // [안전] 과도하게 긴 값은 잘라낸다 (카드 레이아웃 보호 + 응답 크기 제한).
    $clip = function (string $s, int $max): string {
        $s = preg_replace('/\s+/u', ' ', trim($s)) ?? trim($s);
        if (t2_utf8_length($s) > $max) return t2_utf8_substr($s, 0, $max) . '…';
        return $s;
    };

    return [
        'title'       => $clip($title, 200),
        'description' => $clip($description, 300),
        'image'       => $image,
        'siteName'    => $clip($siteName, 100),
        'favicon'     => $favicon,
        'url'         => $finalUrl,
    ];
}

// 파비콘(사이트 아이콘) 탐색
//
// 사이트마다 표기 방식이 제각각이라 한 가지 selector만으로는 상당수를
// 놓친다. 아래 순서로 폭넓게 수집한 뒤, "종류 가중치 × 10000 + 픽셀 크기"
// 점수로 가장 좋은 후보 하나를 고른다.
//   · rel="icon" / rel="shortcut icon"           — 표준, sizes 속성이 있는
//                                                    경우가 많아 가장 신뢰도 높음
//   · rel="apple-touch-icon"                     — 보통 180x180 고정, sizes
//                                                    표기가 없어도 화질 좋음
//   · rel="apple-touch-icon-precomposed"          — 구형 iOS 대응용, 위와 동급이나 후순위
//   · rel="mask-icon"                             — 단색 SVG 마스크라 카드용
//                                                    배지로는 가장 마지막 순위
//   · (위 전부 없음) /favicon.ico                  — 관례적 고정 경로,
//                                                    HEAD 요청으로 실존 확인 후 채택

/** "32x32" 또는 "16x16 32x32 48x48"(공백 구분) 중 최대 변 길이. "any"는 SVG용 표기라 매우 큰 값으로 취급. */
function t2lc_parse_sizes(string $sizes): int {
    if ($sizes === '') return 0;
    if (stripos($sizes, 'any') !== false) return 9999;
    $max = 0;
    foreach (preg_split('/\s+/', trim($sizes)) as $pair) {
        if (preg_match('/^(\d+)x(\d+)$/i', $pair, $m)) {
            $max = max($max, (int)$m[1]);
        }
    }
    return $max;
}

function t2lc_extract_favicon(DOMXPath $xpath, string $finalUrl): string {
    $nodes = $xpath->query('//link[@rel and @href]');
    if (!$nodes || $nodes->length === 0) return '';

    $candidates = [];
    foreach ($nodes as $node) {
        // rel 은 공백으로 구분된 여러 토큰일 수 있다(예: rel="shortcut icon").
        $relTokens = preg_split('/\s+/', strtolower(trim((string)$node->getAttribute('rel'))));

        $weight = 0;
        if (in_array('icon', $relTokens, true) || in_array('shortcut', $relTokens, true)) {
            $weight = 30;
        } elseif (in_array('apple-touch-icon', $relTokens, true)) {
            $weight = 25;
        } elseif (in_array('apple-touch-icon-precomposed', $relTokens, true)) {
            $weight = 20;
        } elseif (in_array('mask-icon', $relTokens, true)) {
            $weight = 5; // 단색 SVG — 마지막 수단
        } else {
            continue; // icon 계열이 아닌 다른 rel(stylesheet 등)은 무시
        }

        $href = trim((string)$node->getAttribute('href'));
        if ($href === '') continue;
        $abs = t2lc_abs_url($finalUrl, $href);
        if ($abs === '') continue;

        $sizeVal = t2lc_parse_sizes((string)$node->getAttribute('sizes'));
        if ($sizeVal === 0 && preg_match('/\.svg(\?|$)/i', $abs)) {
            $sizeVal = 512; // SVG는 벡터라 sizes 표기가 없어도 고화질로 간주
        }

        $candidates[] = ['url' => $abs, 'score' => $weight * 10000 + $sizeVal];
    }

    if (empty($candidates)) return '';
    usort($candidates, function ($a, $b) { return $b['score'] <=> $a['score']; });
    return $candidates[0]['url'];
}

/**
 * <link rel="icon"> 류가 전혀 없을 때의 마지막 수단: 호스트 루트의
 * /favicon.ico 가 실제로 존재하는지 HEAD 요청으로 확인한다.
 * finalUrl 은 이미 t2lc_fetch_html() 이 SSRF 검증을 마친 호스트이지만,
 * "검증 없이 재사용하지 않는다"는 원칙을 지키기 위해 동일한 스킴/포트/IP
 * 검증을 여기서도 다시 수행한다.
 */
function t2lc_verify_favicon_fallback(string $finalUrl): string {
    $parts = parse_url($finalUrl);
    if (!$parts || empty($parts['host']) || empty($parts['scheme'])) return '';

    $scheme = $parts['scheme'];
    $host   = $parts['host'];
    $port   = isset($parts['port']) ? ':' . $parts['port'] : '';
    $candidate = "{$scheme}://{$host}{$port}/favicon.ico";

    $candParts = parse_url($candidate);
    if ($candParts === false || t2lc_validate_url_parts($candParts) !== null) return '';
    $ip = t2lc_resolve_and_check($host);
    if ($ip === null) return '';

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL             => $candidate,
        CURLOPT_NOBODY          => true, // HEAD — 존재/타입만 확인, 바디는 받지 않음
        CURLOPT_HEADER          => false,
        CURLOPT_FOLLOWLOCATION  => false,
        CURLOPT_TIMEOUT         => 3,
        CURLOPT_CONNECTTIMEOUT  => 2,
        CURLOPT_SSL_VERIFYPEER  => true,
        CURLOPT_SSL_VERIFYHOST  => 2,
        CURLOPT_USERAGENT       => 'Mozilla/5.0 (compatible; T2EditorLinkPreview/1.0; +https://dsclub.kr)',
        CURLOPT_PROTOCOLS       => defined('CURLPROTO_HTTP') ? (CURLPROTO_HTTP | CURLPROTO_HTTPS) : null,
        CURLOPT_REDIR_PROTOCOLS => defined('CURLPROTO_HTTP') ? (CURLPROTO_HTTP | CURLPROTO_HTTPS) : null,
    ]);
    curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($httpCode < 200 || $httpCode >= 300) return '';
    // 일부 서버는 /favicon.ico 없을 때 Content-Type: text/html 인 200 커스텀
    // 페이지(또는 SPA 라우팅 폴백)를 돌려주므로 image/* 가 아니면 신뢰하지 않는다.
    // Content-Type 자체를 안 주는 서버도 있어 빈 값은 통과시킨다.
    if ($contentType !== '' && stripos($contentType, 'image') === false) return '';
    return $candidate;
}

// 실행
// [TEST] T2LC_TESTING 상수가 정의되어 있으면(단위 테스트에서 이 파일을 함수
// 정의만 재사용할 목적으로 include 할 때) 아래 실행부를 건너뛴다.
if (!defined('T2LC_TESTING')) {
$initialParts = parse_url($rawUrl);
if ($initialParts === false) {
    t2lc_json(['success' => false, 'message' => 'Invalid URL.'], 400);
}
$err = t2lc_validate_url_parts($initialParts);
if ($err) {
    t2lc_json(['success' => false, 'message' => $err], 400);
}

$result = t2lc_fetch_html($rawUrl);
if (!$result['ok']) {
    t2lc_json(['success' => false, 'message' => $result['message']], 502);
}

$meta = t2lc_extract_meta($result['html'], $result['finalUrl']);

// 제목조차 없으면 카드로서 의미가 없다 — 실패로 처리해 클라이언트가 일반
// 링크로 폴백하도록 한다.
if ($meta['title'] === '') {
    t2lc_json(['success' => false, 'message' => 'No usable metadata found.'], 200);
}

t2lc_json(['success' => true, 'data' => $meta]);
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
