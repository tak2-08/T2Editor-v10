<?php
// Path: T2Editor/admin/third_party_api.core.php
// Developer note: 관리자 action·필드명 변경 시 프런트 요청과 CSRF/권한 검사를 함께 맞춘다.
/**
 * T2Editor Third-party Installer API.
 * Administrator approval is re-verified for every install/download.
 * The password is never sent to a market server.
 * PHP 7.4 - 8.4 compatible.
 */

define('T2ADMIN_THIRD_PARTY_API', true);
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
@ini_set('log_errors', '1');
$T2TP_LOCAL_BUFFER_LEVEL = ob_get_level();
// Loaded through the endpoint bridge; response helpers access this via global.
$GLOBALS['T2TP_LOCAL_BUFFER_LEVEL'] = $T2TP_LOCAL_BUFFER_LEVEL;
ob_start();
require_once dirname(__DIR__) . '/config/t2_cms_auth.php';
t2editor_admin_auth_bootstrap();
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store');

$root = dirname(__DIR__);
require_once $root . '/editor.lib.php';
require_once $root . '/config/t2_browser_archive.php';

$T2TP_PRIVATE_ROOT = trim((string)T2EDITOR_PRIVATE_PATH);
if ($T2TP_PRIVATE_ROOT === '') {
    $T2TP_PRIVATE_ROOT = rtrim((string)T2EDITOR_DB_PATH, '/\\') . '/t2admin-private';
}
$T2TP_PRIVATE_ROOT = rtrim($T2TP_PRIVATE_ROOT, '/\\');
define('T2TP_DATA_DIR', $T2TP_PRIVATE_ROOT);
unset($T2TP_PRIVATE_ROOT);
define('T2TP_AUTH_FILE', T2TP_DATA_DIR . '/admin_auth.php');
define('T2TP_MARKETS_FILE', T2TP_DATA_DIR . '/third_party_markets.php');
define('T2TP_INSTALLED_FILE', T2TP_DATA_DIR . '/third_party_installed.php');
define('T2TP_CLIENT_FILE', T2TP_DATA_DIR . '/third_party_client.php');
define('T2TP_TMP_DIR', T2TP_DATA_DIR . '/third_party_tmp');
define('T2TP_BACKUP_DIR', T2TP_DATA_DIR . '/third_party_backups');
define('T2TP_T2PACK_ROOT', rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack');
// Shared with update_api.core.php ($T2U_LOCK_FILE): "direct" mode core updates
// and "direct" mode third-party plugin/extend/locales installs both mutate
// T2EDITOR_PATH, so they must serialize on the same lock file to prevent a
// concurrent update-apply and install/uninstall from corrupting each other's
// in-flight file changes or backups.
define('T2TP_INSTALL_LOCK_FILE', T2TP_T2PACK_ROOT . '/install.lock');
// Shared with api.core.php ($T2ADMIN_SETTINGS_LOCK_FILE): both read-modify-write
// admin_settings.php (plugins.active), so concurrent saves must not race.
define('T2TP_SETTINGS_LOCK_FILE', T2TP_DATA_DIR . '/admin_settings.lock');
define('T2TP_MODE_FILE', T2TP_T2PACK_ROOT . '/mode.php');
define('T2TP_EXTENSION_ROOT', T2TP_T2PACK_ROOT . '/extensions');
define('T2TP_PUBLIC_EXTENSION_ROOT', rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets/extensions');
define('T2TP_MAX_PACKAGE_BYTES', 30 * 1024 * 1024);
define('T2TP_BROWSER_JOB_TTL', 7200);
define('T2TP_BROWSER_CHUNK_BYTES', 524288);

define('T2TP_DEFAULT_MARKET', 'https://dsclub.kr/api/t2editor/third_party/index.php');
define('T2TP_CERTIFIED_REGISTRY', 'https://dsclub.kr/api/t2editor/version/third_party/certified/index.php');
define('T2TP_CERTIFIED_CACHE_TTL', 21600); // 6h
define('T2TP_CERTIFIED_CACHE_FILE', T2TP_DATA_DIR . '/third_party_certified_cache.php');

function t2tp_response($ok, $data, $message, $status) {
    global $T2TP_LOCAL_BUFFER_LEVEL;
    while (ob_get_level() > $T2TP_LOCAL_BUFFER_LEVEL) ob_end_clean();
    http_response_code((int)$status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('ok' => (bool)$ok, 'data' => $data, 'msg' => (string)$message), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | (defined('JSON_INVALID_UTF8_SUBSTITUTE') ? JSON_INVALID_UTF8_SUBSTITUTE : 0));
    exit;
}

function t2tp_input() {
    $raw = file_get_contents('php://input');
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : $_POST;
}

function t2tp_logged_in() {
    return t2editor_admin_is_authorized();
}

function t2tp_csrf_valid() {
    $token = isset($_SERVER['HTTP_X_T2ADMIN_CSRF']) ? $_SERVER['HTTP_X_T2ADMIN_CSRF'] : (isset($_POST['_csrf']) ? $_POST['_csrf'] : '');
    return !empty($_SESSION['t2admin_csrf']) && is_string($token) && hash_equals((string)$_SESSION['t2admin_csrf'], $token);
}

function t2tp_verify_password($password) {
    return t2editor_admin_verify_local_or_cms($password, T2TP_AUTH_FILE);
}

function t2tp_install_mode() {
    $row=t2_private_store_read(T2TP_MODE_FILE,array('core'=>'data','third_party'=>'data'));
    $mode=is_array($row)?(string)($row['third_party']??'data'):'data';
    return in_array($mode,array('data','direct'),true)?$mode:'data';
}

function t2tp_ensure_dirs() {
    $dirs=array(T2TP_DATA_DIR,T2TP_TMP_DIR,T2TP_BACKUP_DIR,T2TP_T2PACK_ROOT,T2TP_EXTENSION_ROOT,T2TP_PUBLIC_EXTENSION_ROOT);
    if(t2tp_install_mode()==='direct')$dirs[]=T2EDITOR_PATH.'/locales';
    foreach($dirs as $dir){if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('설치 디렉터리를 만들 수 없습니다: '.basename($dir));}
    foreach(array(T2TP_TMP_DIR,T2TP_BACKUP_DIR,T2TP_T2PACK_ROOT,T2TP_EXTENSION_ROOT) as $dir)@chmod($dir,0700);
    foreach(array(T2TP_TMP_DIR,T2TP_BACKUP_DIR) as $dir){$guard=$dir.'/index.php';if(!file_exists($guard))@file_put_contents($guard,"<?php
http_response_code(404);
exit('Not Found');
",LOCK_EX);}
}

function t2tp_read_json_file($file, $fallback) {
    $data = t2_private_store_read($file, $fallback);
    return is_array($data) ? $data : $fallback;
}

function t2tp_write_json_file($file, $data) {
    $ok = t2_private_store_write($file, $data);
    if ($ok && str_replace('\\','/',(string)$file) === str_replace('\\','/',T2TP_INSTALLED_FILE)
        && function_exists('t2_extend_rebuild_runtime_cache')) {
        try { t2_extend_rebuild_runtime_cache(null, true); }
        catch (Throwable $e) { error_log('[T2Editor] Runtime cache refresh after package change failed: ' . $e->getMessage()); }
    }
    return $ok;
}

function t2tp_default_markets() {
    return array(array(
        'id' => 'official-dsclub',
        'name' => 'Open T2Editor',
        'operator' => 'DSc',
        'domain' => 'dsclub.kr',
        'url' => T2TP_DEFAULT_MARKET,
        'enabled' => true,
        'official' => true,
        'certified' => false,
        'group' => 'official',
    ));
}

/** Tolerant extraction of provider list; registry key nesting is owned by DSc, not this plugin. */
function t2tp_extract_registry_providers($decoded) {
    if (!is_array($decoded)) return array();
    if (isset($decoded['registry']['providers']) && is_array($decoded['registry']['providers'])) return $decoded['registry']['providers'];
    if (isset($decoded['providers']) && is_array($decoded['providers'])) return $decoded['providers'];
    if (isset($decoded['registry']['items']) && is_array($decoded['registry']['items'])) return $decoded['registry']['items'];
    if (isset($decoded['items']) && is_array($decoded['items'])) return $decoded['items'];
    if (isset($decoded['certified']) && is_array($decoded['certified'])) return $decoded['certified'];
    return array();
}

function t2tp_fetch_certified_registry($url) {
    if (!extension_loaded('curl')) throw new RuntimeException('cURL 확장이 필요합니다.');
    // 호출자가 바뀌더라도 DSc 차단 설정을 우회해 레지스트리를 조회하지 못하게 한다.
    t2tp_assert_dsclub_api_allowed($url);
    $endpoint = t2tp_market_endpoint($url);
    $ch = curl_init($endpoint['url']);
    if ($ch === false) throw new RuntimeException('인증 저장소 레지스트리 연결을 초기화하지 못했습니다.');
    $responseHeaders = array();
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 7,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => array('Accept: application/json', 'Accept-Encoding: identity', 'User-Agent: T2Editor-ThirdPartyInstaller/1.1.1'),
        CURLOPT_RESOLVE => array($endpoint['resolve']),
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$responseHeaders) { $responseHeaders[] = rtrim((string)$line, "\r\n"); return strlen($line); },
    ));
    $body = curl_exec($ch);
    $error = $body === false ? curl_error($ch) : '';
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($body === false) throw new RuntimeException('인증 저장소 레지스트리 연결 실패: ' . $error);
    if (strlen((string)$body) > 4 * 1024 * 1024) throw new RuntimeException('레지스트리 응답이 너무 큽니다.');
    $decoded = t2tp_decode_json_response($body, $status, $contentType, $responseHeaders);
    if ($status < 200 || $status >= 300 || empty($decoded['success'])) {
        $msg = isset($decoded['error']['message']) ? (string)$decoded['error']['message'] : ('HTTP ' . $status);
        throw new RuntimeException('레지스트리 요청 실패: ' . $msg);
    }
    return $decoded;
}

function t2tp_certified_markets() {
    $cache = t2tp_read_json_file(T2TP_CERTIFIED_CACHE_FILE, array('fetched_at' => 0, 'providers' => array()));
    if (!is_array($cache)) $cache = array('fetched_at' => 0, 'providers' => array());
    $fresh = isset($cache['fetched_at']) && (time() - (int)$cache['fetched_at']) < T2TP_CERTIFIED_CACHE_TTL;
    // DSc API가 꺼져 있으면 마지막 로컬 캐시만 사용한다.
    if (!$fresh && t2tp_dsclub_api_enabled()) {
        try {
            $decoded = t2tp_fetch_certified_registry(T2TP_CERTIFIED_REGISTRY . '?action=list&type=extension_hub');
            $scope = isset($decoded['registry']['scope']) ? (string)$decoded['registry']['scope'] : '';
            $compatibility = isset($decoded['api']['compatibility']) ? (string)$decoded['api']['compatibility'] : '';
            if ($scope !== '' && $scope !== 'extension_hub') throw new RuntimeException('인증 서드파티 마켓 레지스트리 범위가 올바르지 않습니다.');
            if ($compatibility !== '' && $compatibility !== 't2editor-extension-hub/1') throw new RuntimeException('인증 서드파티 마켓 레지스트리 규격이 올바르지 않습니다.');
            $raw = t2tp_extract_registry_providers($decoded);
            $providers = array();
            foreach ($raw as $p) {
                if (!is_array($p)) continue;
                $url = isset($p['url']) ? (string)$p['url'] : (isset($p['api_url']) ? (string)$p['api_url'] : '');
                if ($url === '') continue;
                try { $verifiedEndpoint = t2tp_market_endpoint($url); } catch (Throwable $e) { continue; }
                $domain = strtolower((string)$verifiedEndpoint['host']);
                $declaredDomain = strtolower(trim(isset($p['domain']) ? (string)$p['domain'] : ''));
                if ($declaredDomain !== '' && $domain !== $declaredDomain
                    && substr($domain, -strlen('.' . $declaredDomain)) !== '.' . $declaredDomain) continue;
                $operator = t2tp_clean_text(isset($p['name']) ? $p['name'] : $domain, 80);
                $providers[] = array(
                    'id' => 'certified-' . substr(hash('sha256', $url), 0, 16),
                    'name' => $operator,
                    'operator' => $operator,
                    'url' => $url,
                    'domain' => t2tp_clean_text($domain, 120),
                );
                if (count($providers) >= 40) break;
            }
            $cache = array('fetched_at' => time(), 'providers' => $providers);
            t2tp_write_json_file(T2TP_CERTIFIED_CACHE_FILE, $cache);
        } catch (Throwable $e) {
            error_log('[T2EditorThirdPartyInstaller] certified registry fetch failed: ' . $e->getMessage());
        }
    }
    $providers = isset($cache['providers']) && is_array($cache['providers']) ? $cache['providers'] : array();
    foreach ($providers as $i => $provider) {
        if (!is_array($provider)) continue;
        $host = strtolower((string)parse_url(isset($provider['url']) ? (string)$provider['url'] : '', PHP_URL_HOST));
        if ($host !== '') $providers[$i]['domain'] = $host;
    }
    return $providers;
}

function t2tp_markets_raw() {
    $stored = t2tp_read_json_file(T2TP_MARKETS_FILE, array('custom' => array(), 'certified_disabled' => array(), 'official_enabled' => true));
    if (!is_array($stored)) $stored = array('custom' => array(), 'certified_disabled' => array(), 'official_enabled' => true);
    // Backward compatibility with the pre-v10.4 flat-array market format.
    if (!isset($stored['custom']) && !isset($stored['certified_disabled'])) {
        $migrated = array();
        foreach ($stored as $market) {
            if (is_array($market) && isset($market['url']) && (string)$market['url'] !== T2TP_DEFAULT_MARKET) $migrated[] = $market;
        }
        $stored = array('custom' => $migrated, 'certified_disabled' => array(), 'official_enabled' => true);
    }
    if (!isset($stored['custom']) || !is_array($stored['custom'])) $stored['custom'] = array();
    if (!isset($stored['certified_disabled']) || !is_array($stored['certified_disabled'])) $stored['certified_disabled'] = array();
    $stored['official_enabled'] = !array_key_exists('official_enabled', $stored) || !empty($stored['official_enabled']);
    return $stored;
}

function t2tp_dsclub_api_enabled() {
    $raw = t2tp_markets_raw();
    return !empty($raw['official_enabled']);
}

function t2tp_markets() {
    $raw = t2tp_markets_raw();
    $certifiedDisabled = array_map('strval', $raw['certified_disabled']);

    $official = t2tp_default_markets();
    foreach ($official as $i => $market) $official[$i]['enabled'] = !empty($raw['official_enabled']);

    $certified = array();
    $certifiedUrls = array();
    foreach (t2tp_certified_markets() as $c) {
        $c['enabled'] = !in_array((string)$c['id'], $certifiedDisabled, true);
        $c['official'] = false;
        $c['certified'] = true;
        $c['group'] = 'certified';
        $certified[] = $c;
        $certifiedUrls[] = $c['url'];
    }

    $custom = array();
    foreach ($raw['custom'] as $market) {
        if (!is_array($market)) continue;
        $url = isset($market['url']) ? (string)$market['url'] : '';
        if ($url === T2TP_DEFAULT_MARKET || in_array($url, $certifiedUrls, true)) continue;
        $market['official'] = false;
        $market['certified'] = false;
        $market['group'] = 'custom';
        $market['operator'] = isset($market['name']) ? (string)$market['name'] : '';
        $market['domain'] = (string)parse_url($url, PHP_URL_HOST);
        $custom[] = $market;
    }

    return array_values(array_merge($official, $certified, $custom));
}

function t2tp_client_id() {
    $id = t2_private_store_read(T2TP_CLIENT_FILE, '');
    $id = is_string($id) ? trim($id) : '';
    if (preg_match('/^t2e-[a-f0-9]{48}$/', $id)) return $id;
    $id = 't2e-' . bin2hex(random_bytes(24));
    t2_private_store_write(T2TP_CLIENT_FILE, $id);
    return $id;
}

function t2tp_is_public_ip($ip) {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function t2tp_market_endpoint($url) {
    $url = trim((string)$url);
    if (strlen($url) > 2048 || filter_var($url, FILTER_VALIDATE_URL) === false) throw new RuntimeException('마켓 URL 형식이 올바르지 않습니다.');
    $parts = parse_url($url);
    if (!is_array($parts) || strtolower(isset($parts['scheme']) ? $parts['scheme'] : '') !== 'https') throw new RuntimeException('마켓 API는 HTTPS만 허용됩니다.');
    if (!empty($parts['user']) || !empty($parts['pass']) || !empty($parts['fragment'])) throw new RuntimeException('마켓 URL에 사용자 정보나 fragment를 넣을 수 없습니다.');
    $host = strtolower(isset($parts['host']) ? $parts['host'] : '');
    if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false || $host === 'localhost' || substr($host, -6) === '.local') {
        throw new RuntimeException('공인 도메인 이름을 사용해야 합니다.');
    }
    $port = isset($parts['port']) ? (int)$parts['port'] : 443;
    if ($port !== 443) throw new RuntimeException('마켓 API는 HTTPS 기본 포트만 허용됩니다.');
    $records = @dns_get_record($host, DNS_A | DNS_AAAA);
    $ips = array();
    if (is_array($records)) {
        foreach ($records as $record) {
            $ip = isset($record['ip']) ? $record['ip'] : (isset($record['ipv6']) ? $record['ipv6'] : '');
            if ($ip !== '') $ips[] = $ip;
        }
    }
    if (!$ips) {
        $fallback = @gethostbyname($host);
        if ($fallback && $fallback !== $host) $ips[] = $fallback;
    }
    if (!$ips) throw new RuntimeException('마켓 호스트 DNS를 확인할 수 없습니다.');
    foreach ($ips as $ip) {
        if (!t2tp_is_public_ip($ip)) throw new RuntimeException('사설·예약 IP로 연결되는 마켓은 허용되지 않습니다.');
    }
    $pinned = $ips[0];
    $resolveIp = strpos($pinned, ':') !== false ? '[' . $pinned . ']' : $pinned;
    return array('url' => $url, 'host' => $host, 'resolve' => $host . ':443:' . $resolveIp);
}

function t2tp_market_url_with_action($base, $action, $query) {
    $separator = strpos($base, '?') === false ? '?' : '&';
    $params = array_merge(array('action' => $action), $query);
    return $base . $separator . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function t2tp_is_dsclub_official_market($url) {
    $parts=@parse_url((string)$url);if(!is_array($parts))return false;$host=strtolower((string)($parts['host']??''));$path=(string)($parts['path']??'');return in_array($host,array('dsclub.kr','www.dsclub.kr'),true)&&$path==='/api/t2editor/third_party/index.php';
}
function t2tp_is_dsclub_api_url($url) {
    $parts = @parse_url((string)$url);
    if (!is_array($parts)) return false;
    $host = strtolower((string)($parts['host'] ?? ''));
    $path = (string)($parts['path'] ?? '');
    return in_array($host, array('dsclub.kr','www.dsclub.kr'), true) && strpos($path, '/api/t2editor/') === 0;
}
function t2tp_assert_dsclub_api_allowed($url) {
    if (t2tp_is_dsclub_api_url($url) && !t2tp_dsclub_api_enabled()) {
        throw new RuntimeException('관리자 설정에서 DSc Open T2Editor 마켓 API가 꺼져 있습니다.');
    }
}
function t2tp_detect_host_environment() {
    return function_exists('t2editor_cms_environment')
        ? t2editor_cms_environment(T2EDITOR_BASE_PATH)
        : 'standalone';
}

function t2tp_dsclub_telemetry_headers($marketUrl, $purpose) {
    if(!in_array((string)$purpose,array('challenge','download'),true)||!t2tp_is_dsclub_official_market($marketUrl)||!t2tp_dsclub_api_enabled())return array();
    return array(
        'X-DSc-T2Editor-Version: '.t2tp_editor_version(),
        'X-DSc-Install-Id: '.t2tp_client_id(),
        'X-DSc-PHP-Version: '.PHP_VERSION,
        'X-DSc-Platform: '.substr(PHP_OS_FAMILY.' / '.php_uname('m'),0,80),
        'X-DSc-Host-Environment: '.t2tp_detect_host_environment()
    );
}

function t2tp_header_value($headers, $name) {
    if (!is_array($headers)) return '';
    $wanted = strtolower((string)$name);
    $value = '';
    foreach ($headers as $line) {
        $pos = strpos((string)$line, ':');
        if ($pos === false) continue;
        if (strtolower(trim(substr((string)$line, 0, $pos))) === $wanted) $value = trim(substr((string)$line, $pos + 1));
    }
    return $value;
}

function t2tp_decode_json_response($body, $status, $contentType, $headers) {
    $raw = (string)$body;
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") $raw = substr($raw, 3);
    $raw = trim($raw);
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) return $decoded;

    $requestId = t2tp_header_value($headers, 'X-T2-Request-Id');
    $meta = 'HTTP ' . (int)$status;
    if ((string)$contentType !== '') $meta .= ', ' . substr((string)$contentType, 0, 80);
    if ($requestId !== '') $meta .= ', 요청 ID ' . substr($requestId, 0, 80);

    if ($raw === '') throw new RuntimeException('마켓이 빈 응답을 반환했습니다 (' . $meta . ').');
    if (preg_match('/^\s*</', $raw) || stripos((string)$contentType, 'text/html') !== false) {
        throw new RuntimeException('마켓이 JSON 대신 HTML 오류 문서를 반환했습니다 (' . $meta . '). 마켓 API 경로와 서버 PHP 오류 로그를 확인하세요.');
    }
    if ((int)$status >= 300 && (int)$status < 400) {
        throw new RuntimeException('마켓이 리다이렉트 응답을 반환했습니다 (' . $meta . '). 리다이렉트 없는 최종 HTTPS API 주소를 사용하세요.');
    }
    if (in_array((int)$status, array(401, 403), true)) {
        throw new RuntimeException('마켓 접근이 거부되었습니다 (' . $meta . '). 방화벽·봇 차단·접근 권한을 확인하세요.');
    }
    $jsonError = function_exists('json_last_error_msg') ? json_last_error_msg() : ('JSON error ' . json_last_error());
    throw new RuntimeException('마켓 JSON 해석에 실패했습니다 (' . $meta . ', ' . $jsonError . ').');
}

function t2tp_curl_json($marketUrl, $action, $query, $payload) {
    if (!extension_loaded('curl')) throw new RuntimeException('cURL 확장이 필요합니다.');
    t2tp_assert_dsclub_api_allowed($marketUrl);
    $endpoint = t2tp_market_endpoint($marketUrl);
    $url = t2tp_market_url_with_action($endpoint['url'], $action, $query);
    $ch = curl_init($url);
    if ($ch === false) throw new RuntimeException('마켓 연결을 초기화하지 못했습니다.');
    $responseHeaders = array();
    $headers = array_merge(array(
        'Accept: application/json',
        'Accept-Encoding: identity',
        'Cache-Control: no-cache',
        'User-Agent: T2Editor-ThirdPartyInstaller/1.1.1',
    ), t2tp_dsclub_telemetry_headers($marketUrl,$action));
    $options = array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 7,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RESOLVE => array($endpoint['resolve']),
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$responseHeaders) {
            $responseHeaders[] = rtrim((string)$line, "\r\n");
            return strlen($line);
        },
    );
    if (defined('CURLOPT_ENCODING')) $options[CURLOPT_ENCODING] = 'identity';
    if (defined('CURLOPT_HTTP_VERSION') && defined('CURL_HTTP_VERSION_1_1')) $options[CURLOPT_HTTP_VERSION] = CURL_HTTP_VERSION_1_1;
    if ($payload !== null) {
        $requestBody = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = $requestBody;
        $options[CURLOPT_HTTPHEADER] = array_merge(array(
            'Accept: application/json',
            'Accept-Encoding: identity',
            'Cache-Control: no-cache',
            'Content-Type: application/json',
            'User-Agent: T2Editor-ThirdPartyInstaller/1.1.1',
        ), t2tp_dsclub_telemetry_headers($marketUrl,$action));
    }
    curl_setopt_array($ch, $options);
    $body = curl_exec($ch);
    $error = $body === false ? curl_error($ch) : '';
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($body === false) throw new RuntimeException('마켓 연결 실패: ' . $error);
    if (strlen((string)$body) > 4 * 1024 * 1024) throw new RuntimeException('마켓 JSON 응답이 너무 큽니다.');
    $decoded = t2tp_decode_json_response($body, $status, $contentType, $responseHeaders);
    if ($status < 200 || $status >= 300 || empty($decoded['ok'])) {
        $msg = isset($decoded['error']['message']) ? (string)$decoded['error']['message'] : ('HTTP ' . $status);
        $errorCode = isset($decoded['error']['code']) ? (string)$decoded['error']['code'] : (isset($decoded['data']['diagnostic_code']) ? (string)$decoded['data']['diagnostic_code'] : '');
        if ($errorCode !== '') $msg .= ' [오류 코드: ' . substr($errorCode, 0, 80) . ']';
        $requestId = isset($decoded['request_id']) ? (string)$decoded['request_id'] : t2tp_header_value($responseHeaders, 'X-T2-Request-Id');
        if ($requestId !== '') $msg .= ' [요청 ID: ' . substr($requestId, 0, 80) . ']';
        throw new RuntimeException('마켓 요청 실패: ' . $msg);
    }
    if (!isset($decoded['api']) || $decoded['api'] !== 't2editor-third-party-market' || !isset($decoded['api_version']) || substr((string)$decoded['api_version'], 0, 2) !== '1.') {
        throw new RuntimeException('호환되지 않는 마켓 API입니다.');
    }
    return t2tp_normalize_market_data(isset($decoded['data']) ? $decoded['data'] : array());
}

function t2tp_download_package($marketUrl, $packageId, $releaseId, $clientId, $ticket, $target) {
    t2tp_assert_dsclub_api_allowed($marketUrl);
    $endpoint = t2tp_market_endpoint($marketUrl);
    $url = t2tp_market_url_with_action($endpoint['url'], 'download', array());
    $fp = fopen($target, 'wb');
    if ($fp === false) throw new RuntimeException('임시 패키지 파일을 만들 수 없습니다.');
    $written = 0;
    $ch = curl_init($url);
    if ($ch === false) { fclose($fp); throw new RuntimeException('다운로드 연결을 초기화하지 못했습니다.'); }
    $payload = json_encode(array('package_id' => $packageId, 'release_id' => $releaseId, 'client_id' => $clientId, 'ticket' => $ticket), JSON_UNESCAPED_SLASHES);
    curl_setopt_array($ch, array(
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 7,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => array_merge(array('Accept: application/zip', 'Accept-Encoding: identity', 'Content-Type: application/json', 'User-Agent: T2Editor-ThirdPartyInstaller/1.1.1'), t2tp_dsclub_telemetry_headers($marketUrl,'download')),
        CURLOPT_RESOLVE => array($endpoint['resolve']),
        CURLOPT_ENCODING => 'identity',
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_WRITEFUNCTION => function($ch, $chunk) use ($fp, &$written) {
            $len = strlen($chunk);
            $written += $len;
            if ($written > T2TP_MAX_PACKAGE_BYTES) return 0;
            return fwrite($fp, $chunk);
        }
    ));
    $ok = curl_exec($ch);
    $error = $ok === false ? curl_error($ch) : '';
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    fclose($fp);
    if ($ok === false || $status < 200 || $status >= 300 || $written < 1 || $written > T2TP_MAX_PACKAGE_BYTES || stripos($contentType, 'json') !== false) {
        @unlink($target);
        throw new RuntimeException('패키지 다운로드 실패: ' . ($error !== '' ? $error : 'HTTP ' . $status));
    }
}

function t2tp_clean_text($value, $max) {
    $value = trim(strip_tags((string)$value));
    return t2_utf8_substr($value, 0, $max);
}

function t2tp_valid_version($value) {
    return preg_match('/^[0-9]+(?:\.[0-9]+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/', (string)$value) === 1;
}

function t2tp_normalize_type($type) {
    $type = strtolower(trim((string)$type));
    return $type === 'locale' ? 'locales' : $type;
}

function t2tp_normalize_manifest($manifest) {
    if (!is_array($manifest)) return array();
    if (isset($manifest['type'])) $manifest['type'] = t2tp_normalize_type($manifest['type']);
    if (isset($manifest['install']) && is_array($manifest['install'])) {
        if (isset($manifest['install']['base']) && (string)$manifest['install']['base'] === '/locale') $manifest['install']['base'] = '/locales';
        if (isset($manifest['install']['target']) && strpos((string)$manifest['install']['target'], '/locale/') === 0) {
            $manifest['install']['target'] = '/locales/' . substr((string)$manifest['install']['target'], 8);
        }
    }
    return $manifest;
}

function t2tp_normalize_market_data($value) {
    if (!is_array($value)) return $value;
    foreach ($value as $key => $item) {
        if (($key === 'type' || $key === 'extension_type') && is_string($item)) $value[$key] = t2tp_normalize_type($item);
        elseif ($key === 'manifest' && is_array($item)) $value[$key] = t2tp_normalize_manifest($item);
        else $value[$key] = t2tp_normalize_market_data($item);
    }
    return $value;
}

function t2tp_merge_tree_without_overwrite($source, $target) {
    if (!is_dir($source)) return;
    if (!is_dir($target)) @mkdir($target, 0755, true);
    $items = @scandir($source);
    if (!is_array($items)) return;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $src = $source . '/' . $item; $dst = $target . '/' . $item;
        if (is_dir($src)) t2tp_merge_tree_without_overwrite($src, $dst);
        elseif (is_file($src) && !file_exists($dst)) @copy($src, $dst);
    }
}

function t2tp_migrate_locales_layout() {
    $oldRoot = T2EDITOR_PATH . '/locale';
    $newRoot = T2EDITOR_PATH . '/locales';
    if (!is_dir($newRoot)) @mkdir($newRoot, 0755, true);
    if (is_dir($oldRoot)) {
        $items = @scandir($oldRoot);
        if (is_array($items)) foreach ($items as $item) {
            if ($item === '.' || $item === '..' || !preg_match('/^[a-z0-9][a-z0-9._-]{2,79}$/', $item)) continue;
            $src = $oldRoot . '/' . $item; $dst = $newRoot . '/' . $item;
            if (!is_dir($src)) continue;
            if (!file_exists($dst) && @rename($src, $dst)) continue;
            t2tp_merge_tree_without_overwrite($src, $dst);
            t2tp_remove_tree($src);
        }
        foreach (array('README.txt','README_THIRD_PARTY.txt') as $legacyReadme) {
            $legacyFile = $oldRoot . '/' . $legacyReadme;
            if (is_file($legacyFile)) @unlink($legacyFile);
        }
        $left = @scandir($oldRoot);
        if (is_array($left) && count(array_diff($left, array('.','..'))) === 0) @rmdir($oldRoot);
    }

    $registry = t2tp_read_json_file(T2TP_INSTALLED_FILE, array());
    $changed = false;
    foreach ($registry as $id => $item) {
        if (!is_array($item)) continue;
        if (isset($item['type']) && (string)$item['type'] === 'locale') { $item['type'] = 'locales'; $changed = true; }
        if (isset($item['manifest']) && is_array($item['manifest'])) {
            $normalized = t2tp_normalize_manifest($item['manifest']);
            if ($normalized !== $item['manifest']) { $item['manifest'] = $normalized; $changed = true; }
        }
        if (isset($item['targets']) && is_array($item['targets'])) foreach ($item['targets'] as $k => $target) {
            if (!is_array($target) || empty($target['relative'])) continue;
            $relative = (string)$target['relative'];
            if (strpos($relative, 'locale/') === 0) { $item['targets'][$k]['relative'] = 'locales/' . substr($relative, 7); $changed = true; }
        }
        $registry[$id] = $item;
    }
    if ($changed) t2tp_write_json_file(T2TP_INSTALLED_FILE, $registry);
}

function t2tp_expected_install($type, $id) {
    $type = t2tp_normalize_type($type);
    if ($type === 'plugin') return array('base'=>'/plugin','source'=>$id.'/','target'=>'/plugin/'.$id,'entry'=>$id.'/hooks.js');
    if ($type === 'extend-js') return array('base'=>'/extend/js','source'=>$id.'.js','target'=>'/extend/js/'.$id.'.js');
    if ($type === 'extend-php') return array('base'=>'/extend/php','source'=>$id.'.php','target'=>'/extend/php/'.$id.'.php');
    if ($type === 'locales') return array('base'=>'/locales','source'=>$id.'/','target'=>'/locales/'.$id);
    throw new RuntimeException('지원하지 않는 배포 유형입니다.');
}

function t2tp_normalize_zip_name($name) {
    $name=str_replace('\\','/',(string)$name);
    while(strpos($name,'//')!==false)$name=str_replace('//','/',$name);
    while(strpos($name,'./')===0)$name=substr($name,2);
    return $name;
}

function t2tp_safe_zip_path($name, $directory) {
    $name=t2tp_normalize_zip_name($name);
    if($name===''||strpos($name,"\0")!==false||$name[0]==='/'||preg_match('#^[A-Za-z]:/#',$name)||preg_match('#(^|/)\.\.?(/|$)#',$name))return false;
    if($directory&&substr($name,-1)!=='/')$name.='/';
    return $name;
}

function t2tp_ignore_zip_entry($name) {
    $name=t2tp_normalize_zip_name($name);$base=basename(rtrim($name,'/'));
    if($name==='__MACOSX'||strpos($name,'__MACOSX/')===0)return true;
    if($base==='.DS_Store'||$base==='Thumbs.db'||$base==='desktop.ini')return true;
    return strpos($base,'._')===0;
}

function t2tp_validate_manifest($manifest) {
    $manifest = t2tp_normalize_manifest($manifest);
    if (!is_array($manifest) || (isset($manifest['schema']) ? (string)$manifest['schema'] : '') !== 't2editor-third-party-v1') throw new RuntimeException('지원하지 않는 마켓 매니페스트입니다.');
    $id = isset($manifest['id']) ? (string)$manifest['id'] : '';
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,79}$/', $id)) throw new RuntimeException('설치 ID가 올바르지 않습니다.');
    if (t2tp_clean_text(isset($manifest['name']) ? $manifest['name'] : '', 100) === '') throw new RuntimeException('프로그램 이름이 필요합니다.');
    if (!t2tp_valid_version(isset($manifest['version']) ? $manifest['version'] : '')) throw new RuntimeException('배포 버전 형식이 올바르지 않습니다.');
    $type = t2tp_normalize_type(isset($manifest['type']) ? $manifest['type'] : '');
    if (!in_array($type, array('plugin','extend-js','extend-php','locales'), true)) throw new RuntimeException('지원하지 않는 배포 유형입니다.');
    if ($type === 'plugin' && !preg_match('/^[a-z0-9][a-z0-9_-]{2,79}$/', $id)) throw new RuntimeException('Plugin 설치 ID에는 점(.)을 사용할 수 없습니다.');
    if (!isset($manifest['install']) || !is_array($manifest['install'])) throw new RuntimeException('install 정보가 필요합니다.');
    $expected = t2tp_expected_install($type, $id);$install=$manifest['install'];
    foreach(array('base','target') as $key)if(!isset($install[$key])||(string)$install[$key]!==$expected[$key])throw new RuntimeException('설치 경로 정보가 규격과 일치하지 않습니다: install.'.$key);
    if($type==='plugin'){
        $source=isset($install['source'])?t2tp_safe_zip_path($install['source'],true):false;
        $entry=isset($install['entry'])?t2tp_safe_zip_path($install['entry'],false):false;
        if($source===false||$entry===false||($entry!==$source.'hooks.js'))throw new RuntimeException('플러그인 source 또는 hooks.js 경로가 올바르지 않습니다.');
        $manifest['install']['source']=$source;$manifest['install']['entry']=$entry;
    }elseif($type==='locales'){
        $source=isset($install['source'])?t2tp_safe_zip_path($install['source'],true):false;
        if($source===false)throw new RuntimeException('번역 source 경로가 올바르지 않습니다.');
        $manifest['install']['source']=$source;
    }else{
        foreach(array('source') as $key)if(!isset($install[$key])||(string)$install[$key]!==$expected[$key])throw new RuntimeException('설치 경로 정보가 규격과 일치하지 않습니다: install.'.$key);
    }
    $req = isset($manifest['requires']) && is_array($manifest['requires']) ? $manifest['requires'] : array();
    foreach (array('php_min','php_max','t2editor_min') as $key) if (!isset($req[$key]) || !t2tp_valid_version($req[$key])) throw new RuntimeException('필수 호환 버전 정보가 없습니다: '.$key);
    if (version_compare((string)$req['php_min'], (string)$req['php_max'], '>')) throw new RuntimeException('PHP 최소 버전이 최대 버전보다 높습니다.');
    if (!isset($manifest['license']) || !is_array($manifest['license']) || empty($manifest['license']['id']) || empty($manifest['license']['name'])) throw new RuntimeException('라이선스 정보가 필요합니다.');
    if (isset($manifest['release'])) {
        if (!is_array($manifest['release'])) throw new RuntimeException('release 정보 형식이 올바르지 않습니다.');
        $releaseType=isset($manifest['release']['type'])?(string)$manifest['release']['type']:'';
        if (!in_array($releaseType,array('initial','patch','minor_update','minor_upgrade'),true)) throw new RuntimeException('지원하지 않는 릴리즈 유형입니다.');
        if (t2tp_clean_text(isset($manifest['release']['notes'])?$manifest['release']['notes']:'',6000)==='') throw new RuntimeException('릴리즈 변경 내역이 필요합니다.');
    }
    if (!empty($manifest['test_version']) && !t2tp_valid_version($manifest['test_version'])) throw new RuntimeException('테스트 버전 형식이 올바르지 않습니다.');
    if (!empty($manifest['demo_url'])) {
        $url=(string)$manifest['demo_url'];$scheme=strtolower((string)parse_url($url,PHP_URL_SCHEME));
        if (filter_var($url,FILTER_VALIDATE_URL)===false || !in_array($scheme,array('http','https'),true)) throw new RuntimeException('데모 링크 형식이 올바르지 않습니다.');
    }
    return true;
}

function t2tp_zip_entries_pure($path) {
    $size=@filesize($path);
    if($size===false||$size<22||$size>T2TP_MAX_PACKAGE_BYTES)throw new RuntimeException('ZIP 파일 크기가 올바르지 않습니다.');
    $fp=@fopen($path,'rb');if($fp===false)throw new RuntimeException('ZIP 파일을 열 수 없습니다.');
    $tailSize=min($size,22+65535+20);fseek($fp,$size-$tailSize);$tail=(string)fread($fp,$tailSize);$eocd=strrpos($tail,"PK\x05\x06");
    if($eocd===false||strlen($tail)<$eocd+22){fclose($fp);throw new RuntimeException('ZIP 중앙 디렉터리를 찾을 수 없습니다.');}
    $e=unpack('vdisk/vcd_disk/ventries_disk/ventries/Vcd_size/Vcd_offset/vcomment',substr($tail,$eocd+4,18));
    if(!is_array($e)||$e['disk']!==0||$e['cd_disk']!==0||$e['entries']!==$e['entries_disk']||$e['entries']<1||$e['entries']>2000||$e['cd_offset']+$e['cd_size']>$size){fclose($fp);throw new RuntimeException('ZIP64·분할 ZIP 또는 과도한 파일 수는 지원하지 않습니다.');}
    fseek($fp,$e['cd_offset']);$entries=array();$total=0;
    for($i=0;$i<$e['entries'];$i++){
        $head=(string)fread($fp,46);
        if(strlen($head)!==46||substr($head,0,4)!=="PK\x01\x02"){fclose($fp);throw new RuntimeException('ZIP 중앙 디렉터리가 손상되었습니다.');}
        $h=unpack('vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/vname_len/vextra_len/vcomment_len/vdisk/vinternal/Vexternal/Vlocal_offset',substr($head,4));
        if(!is_array($h)||$h['compressed']===0xFFFFFFFF||$h['uncompressed']===0xFFFFFFFF||$h['local_offset']===0xFFFFFFFF){fclose($fp);throw new RuntimeException('ZIP64 형식은 지원하지 않습니다.');}
        $name=(string)fread($fp,$h['name_len']);if($h['extra_len']>0)fseek($fp,$h['extra_len'],SEEK_CUR);if($h['comment_len']>0)fseek($fp,$h['comment_len'],SEEK_CUR);
        $total+=(int)$h['uncompressed'];if($total>120*1024*1024){fclose($fp);throw new RuntimeException('압축 해제 제한을 초과했습니다.');}
        $entries[]=array('name'=>$name,'flags'=>(int)$h['flags'],'method'=>(int)$h['method'],'crc'=>(int)$h['crc'],'compressed'=>(int)$h['compressed'],'uncompressed'=>(int)$h['uncompressed'],'external'=>(int)$h['external'],'local_offset'=>(int)$h['local_offset']);
    }
    fclose($fp);return $entries;
}

function t2tp_zip_entries($path) {
    if(!class_exists('ZipArchive'))return t2tp_zip_entries_pure($path);
    $zip=new ZipArchive();if($zip->open($path)!==true)throw new RuntimeException('ZIP 배포물을 열 수 없습니다.');
    $entries=array();$total=0;
    try{
        if($zip->numFiles<1||$zip->numFiles>2000)throw new RuntimeException('ZIP 파일 수가 허용 범위를 벗어났습니다.');
        for($i=0;$i<$zip->numFiles;$i++){
            $stat=$zip->statIndex($i,ZipArchive::FL_UNCHANGED);if(!is_array($stat))throw new RuntimeException('ZIP 항목 정보를 읽을 수 없습니다.');
            $opsys=0;$attr=0;$zip->getExternalAttributesIndex($i,$opsys,$attr);$size=isset($stat['size'])?(int)$stat['size']:0;$total+=$size;
            if($total>120*1024*1024)throw new RuntimeException('압축 해제 제한을 초과했습니다.');
            $entries[]=array('name'=>(string)$stat['name'],'index'=>$i,'flags'=>0,'method'=>isset($stat['comp_method'])?(int)$stat['comp_method']:0,'crc'=>isset($stat['crc'])?(int)$stat['crc']:0,'compressed'=>isset($stat['comp_size'])?(int)$stat['comp_size']:0,'uncompressed'=>$size,'external'=>(int)$attr,'encryption_method'=>isset($stat['encryption_method'])?(int)$stat['encryption_method']:0);
        }
    }finally{$zip->close();}
    return $entries;
}

function t2tp_allowed_zip_name($name, $manifest, $isDirectory) {
    $name=t2tp_normalize_zip_name($name);$type=(string)$manifest['type'];$source=t2tp_normalize_zip_name((string)$manifest['install']['source']);
    if ($type==='plugin' || $type==='locales') {
        if(strpos($name,$source)===0)return true;
        if($isDirectory&&strpos($source,rtrim($name,'/').'/')===0)return true;
        return false;
    }
    if ($type==='extend-js' || $type==='extend-php') return !$isDirectory&&$name===$source;
    return false;
}

function t2tp_read_validate_package($path, $manifest) {
    $manifest=t2tp_normalize_manifest($manifest);t2tp_validate_manifest($manifest);
    $size=@filesize($path);if($size===false||$size<1||$size>T2TP_MAX_PACKAGE_BYTES)throw new RuntimeException('배포물 크기가 올바르지 않습니다.');
    $entries=t2tp_zip_entries($path);$files=array();$total=0;
    foreach($entries as $entry){
        $rawName=(string)$entry['name'];if(!t2browser_utf8_valid($rawName))throw new RuntimeException('ZIP 파일 이름은 UTF-8이어야 합니다.');
        $name=t2tp_normalize_zip_name($rawName);$isDirectory=substr($name,-1)==='/';
        if(t2tp_safe_zip_path($name,$isDirectory)===false)throw new RuntimeException('안전하지 않은 ZIP 경로입니다.');
        if((((int)$entry['external']>>16)&0xF000)===0xA000)throw new RuntimeException('심볼릭 링크는 설치할 수 없습니다.');
        if(!empty($entry['encryption_method'])||(((int)$entry['flags']&1)===1))throw new RuntimeException('암호화된 ZIP 항목은 설치할 수 없습니다.');
        if(!in_array((int)$entry['method'],array(0,8),true)&&!$isDirectory)throw new RuntimeException('지원하지 않는 ZIP 압축 방식입니다: '.(int)$entry['method']);
        if(t2tp_ignore_zip_entry($name))continue;
        if(preg_match('#(^|/)(\.htaccess|\.user\.ini|web\.config|php\.ini)$#i',$name))throw new RuntimeException('서버 설정 파일은 설치할 수 없습니다.');
        if(!t2tp_allowed_zip_name($name,$manifest,$isDirectory)){if($isDirectory)continue;throw new RuntimeException('배포 유형의 설치 구조와 일치하지 않는 파일입니다: '.$name);}
        if(!$isDirectory){if(in_array($name,$files,true))throw new RuntimeException('ZIP에 동일한 파일 경로가 중복되어 있습니다: '.$name);$files[]=$name;$total+=(int)$entry['uncompressed'];if(count($files)>2000||$total>120*1024*1024)throw new RuntimeException('압축 해제 제한을 초과했습니다.');}
    }
    if(!$files)throw new RuntimeException('ZIP 안에 설치 파일이 없습니다.');
    $type=(string)$manifest['type'];$entry=isset($manifest['install']['entry'])?t2tp_normalize_zip_name($manifest['install']['entry']):'';$source=t2tp_normalize_zip_name((string)$manifest['install']['source']);
    if($type==='plugin'&&!in_array($entry,$files,true))throw new RuntimeException('마켓에서 확인한 hooks.js를 ZIP에서 찾지 못했습니다: '.$entry);
    if($type==='extend-js'&&(count($files)!==1||$files[0]!==$source))throw new RuntimeException('Extend JS ZIP에는 '.$source.' 파일 하나만 있어야 합니다.');
    if($type==='extend-php'&&(count($files)!==1||$files[0]!==$source))throw new RuntimeException('Extend PHP ZIP에는 '.$source.' 파일 하나만 있어야 합니다.');
    if($type==='locales'){
        $jsonCount=0;
        foreach($files as $file){$relative=substr($file,strlen($source));$base=basename($relative);if(preg_match('/^[a-z]{2}(?:-[A-Za-z0-9]+)?\.json$/',$base)){$jsonCount++;continue;}if(!preg_match('/^(?:README(?:\.[A-Za-z0-9]+)?|LICENSE(?:\.[A-Za-z0-9]+)?)$/i',$base))throw new RuntimeException('Locales ZIP에는 언어코드 JSON과 README/LICENSE 파일만 넣을 수 있습니다: '.$file);}
        if($jsonCount<1)throw new RuntimeException('Locales ZIP에는 ko.json, en.json 같은 언어코드 JSON 파일이 하나 이상 필요합니다.');
    }
    return $manifest;
}

function t2tp_editor_version() {
    foreach (array(T2EDITOR_PATH.'/readme.txt',T2EDITOR_PATH.'/README.md',T2EDITOR_PATH.'/version.txt') as $file) {
        $raw=is_file($file)?(string)@file_get_contents($file):'';
        if(preg_match('/(?:ver[_ -]?|version[ :]+)?([0-9]+(?:\.[0-9]+){1,3})/i',$raw,$m))return$m[1];
    }
    return '0.0.0';
}

function t2tp_version_major($version) {
    return preg_match('/^v?([0-9]+)(?:\.|$)/i', trim((string)$version), $m) && (int)$m[1] > 0 ? (int)$m[1] : null;
}

function t2tp_major_version_mismatch($currentVersion, $supportedVersion) {
    $currentMajor=t2tp_version_major($currentVersion);$supportedMajor=t2tp_version_major($supportedVersion);
    return $currentMajor!==null&&$supportedMajor!==null&&$currentMajor!==$supportedMajor;
}

function t2tp_require_major_version_warning_ack($manifest, $acknowledged) {
    $current=t2tp_editor_version();$supported=(string)$manifest['requires']['t2editor_min'];
    if(t2tp_major_version_mismatch($current,$supported)&&!$acknowledged)throw new RuntimeException('현재 T2Editor '.$current.'와 이 서드파티의 지원 기준 T2Editor '.$supported.'의 메이저 버전이 다릅니다. 관리자 화면에서 호환성 경고를 확인한 뒤 다시 설치하세요.');
}

function t2tp_check_requirements($manifest) {
    $req=$manifest['requires'];
    if(version_compare(PHP_VERSION,(string)$req['php_min'],'<'))throw new RuntimeException('PHP '.$req['php_min'].' 이상이 필요합니다.');
    if(version_compare(PHP_VERSION,(string)$req['php_max'],'>'))throw new RuntimeException('이 배포물은 PHP '.$req['php_max'].' 이하를 지원합니다.');
    $editor=t2tp_editor_version();if(version_compare($editor,(string)$req['t2editor_min'],'<'))throw new RuntimeException('T2Editor '.$req['t2editor_min'].' 이상이 필요합니다. 현재 감지 버전: '.$editor);
}

function t2tp_remove_tree($path) {
    if(!file_exists($path)&&!is_link($path))return;if(is_file($path)||is_link($path)){@unlink($path);return;}$items=scandir($path);if(is_array($items))foreach($items as $item){if($item==='.'||$item==='..')continue;t2tp_remove_tree($path.'/'.$item);}@rmdir($path);
}

function t2tp_copy_tree($source,$target) {
    if(is_file($source)){$dir=dirname($target);if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('대상 디렉터리를 만들 수 없습니다.');if(!@copy($source,$target))throw new RuntimeException('파일 복사에 실패했습니다: '.basename($target));@chmod($target,0644);return;}
    if(!is_dir($source))throw new RuntimeException('설치 원본이 없습니다: '.$source);if(!is_dir($target)&&!@mkdir($target,0755,true)&&!is_dir($target))throw new RuntimeException('대상 디렉터리를 만들 수 없습니다.');$items=scandir($source);if(!is_array($items))throw new RuntimeException('설치 원본을 읽을 수 없습니다.');foreach($items as $item){if($item==='.'||$item==='..')continue;t2tp_copy_tree($source.'/'.$item,$target.'/'.$item);}
}

function t2tp_static_asset_allowed($relative) {
    $ext=strtolower(pathinfo((string)$relative,PATHINFO_EXTENSION));
    return in_array($ext,array('js','css','map','png','jpg','jpeg','gif','webp','svg','ico','woff','woff2','ttf','otf','eot','json','wasm','bin','model','txt','html','htm','mp3','mp4','webm','ogg'),true);
}

function t2tp_project_static_tree($source,$target) {
    if(is_file($source)){
        if(!t2tp_static_asset_allowed($source))return 0;
        t2tp_copy_tree($source,$target);return 1;
    }
    if(!is_dir($source))return 0;
    $count=0;$it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source,FilesystemIterator::SKIP_DOTS));
    $root=rtrim(str_replace('\\','/',$source),'/');
    foreach($it as $info){if(!$info->isFile()||$info->isLink())continue;$full=str_replace('\\','/',$info->getPathname());$relative=ltrim(substr($full,strlen($root)),'/');if(!t2tp_static_asset_allowed($relative))continue;t2tp_copy_tree($info->getPathname(),rtrim($target,'/\\').'/'.$relative);$count++;}
    return $count;
}

function t2tp_data_type_dir($type) {
    $map=array('plugin'=>'plugin','extend-js'=>'extend-js','extend-php'=>'extend-php','locales'=>'locales');
    if(!isset($map[$type]))throw new RuntimeException('지원하지 않는 데이터 설치 유형입니다.');
    return $map[$type];
}

function t2tp_unique_revision($manifest,$zipPath) {
    $base=preg_replace('/[^A-Za-z0-9._-]/','-',(string)$manifest['version']).'-'.substr((string)hash_file('sha256',$zipPath),0,8);
    $dir=T2TP_EXTENSION_ROOT.'/'.t2tp_data_type_dir((string)$manifest['type']).'/'.$manifest['id'].'/'.$base;$rev=$base;$n=1;
    while(file_exists($dir)){++$n;$rev=$base.'-r'.$n;$dir=T2TP_EXTENSION_ROOT.'/'.t2tp_data_type_dir((string)$manifest['type']).'/'.$manifest['id'].'/'.$rev;}
    return $rev;
}

function t2tp_write_package_router_manifest($privatePath,$manifest) {
    if((string)$manifest['type']!=='plugin')return;
    $entries=array();
    if(isset($manifest['runtime']['entries'])&&is_array($manifest['runtime']['entries'])){
        foreach($manifest['runtime']['entries'] as $name=>$relative){$name=(string)$name;$relative=t2tp_normalize_zip_name((string)$relative);if(preg_match('/^[A-Za-z0-9._-]{1,80}$/',$name)&&t2tp_safe_zip_path($relative,false)!==false&&substr(strtolower($relative),-4)==='.php'&&is_file($privatePath.'/'.$relative))$entries[$name]=$relative;}
    }
    @file_put_contents($privatePath.'/package.json',json_encode(array('id'=>$manifest['id'],'version'=>$manifest['version'],'entries'=>$entries),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT),LOCK_EX);
}

function t2tp_extract_package($zipPath,$manifest,$stage) {
    $entries=t2tp_zip_entries($zipPath);if(!is_dir($stage)&&!@mkdir($stage,0700,true)&&!is_dir($stage))throw new RuntimeException('설치 임시 디렉터리를 만들 수 없습니다.');
    if(class_exists('ZipArchive')){
        $zip=new ZipArchive();if($zip->open($zipPath)!==true)throw new RuntimeException('ZIP 배포물을 열 수 없습니다.');
        try{
            foreach($entries as $entry){$name=t2tp_normalize_zip_name((string)$entry['name']);$isDirectory=substr($name,-1)==='/';if(t2tp_ignore_zip_entry($name)||!t2tp_allowed_zip_name($name,$manifest,$isDirectory))continue;if($isDirectory){@mkdir($stage.'/'.$name,0755,true);continue;}$target=$stage.'/'.$name;$dir=dirname($target);if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('임시 디렉터리를 만들 수 없습니다.');$in=$zip->getStream((string)$entry['name']);if($in===false)throw new RuntimeException('ZIP 항목을 읽을 수 없습니다: '.$name);$out=@fopen($target,'wb');if($out===false){fclose($in);throw new RuntimeException('임시 파일을 만들 수 없습니다.');}$written=stream_copy_to_stream($in,$out,(int)$entry['uncompressed']+1);fclose($in);fclose($out);if($written===false||(int)$written!==(int)$entry['uncompressed'])throw new RuntimeException('ZIP 항목 크기 검증에 실패했습니다: '.$name);$crc=strtolower((string)@hash_file('crc32b',$target));$expected=strtolower(sprintf('%08x',((int)$entry['crc'])&0xffffffff));if($crc===''||!hash_equals($expected,$crc))throw new RuntimeException('ZIP CRC 검증에 실패했습니다: '.$name);@chmod($target,0644);}
        }finally{$zip->close();}
        return;
    }
    $fp=@fopen($zipPath,'rb');if($fp===false)throw new RuntimeException('ZIP 파일을 열 수 없습니다.');
    try{
        foreach($entries as $entry){$name=t2tp_normalize_zip_name((string)$entry['name']);$isDirectory=substr($name,-1)==='/';if(t2tp_ignore_zip_entry($name)||!t2tp_allowed_zip_name($name,$manifest,$isDirectory))continue;if($isDirectory){@mkdir($stage.'/'.$name,0755,true);continue;}fseek($fp,(int)$entry['local_offset']);$local=(string)fread($fp,30);if(strlen($local)!==30||substr($local,0,4)!=="PK\x03\x04")throw new RuntimeException('ZIP 로컬 헤더가 손상되었습니다.');$lh=unpack('vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/vname_len/vextra_len',substr($local,4));fseek($fp,(int)$lh['name_len']+(int)$lh['extra_len'],SEEK_CUR);$compressedSize=(int)$entry['compressed'];$compressed=$compressedSize>0?(string)fread($fp,$compressedSize):'';if(strlen($compressed)!==$compressedSize)throw new RuntimeException('ZIP 압축 데이터를 모두 읽지 못했습니다: '.$name);if((int)$entry['method']===0)$data=$compressed;elseif((int)$entry['method']===8&&function_exists('gzinflate'))$data=@gzinflate($compressed,(int)$entry['uncompressed']+1);else throw new RuntimeException('이 ZIP을 해제하려면 zlib 또는 ZipArchive가 필요합니다.');if(!is_string($data)||strlen($data)!==(int)$entry['uncompressed'])throw new RuntimeException('ZIP 항목 해제 크기가 일치하지 않습니다: '.$name);$expected=strtolower(sprintf('%08x',((int)$entry['crc'])&0xffffffff));if(!hash_equals($expected,strtolower(hash('crc32b',$data))))throw new RuntimeException('ZIP CRC 검증에 실패했습니다: '.$name);$target=$stage.'/'.$name;$dir=dirname($target);if(!is_dir($dir)&&!@mkdir($dir,0755,true)&&!is_dir($dir))throw new RuntimeException('임시 디렉터리를 만들 수 없습니다.');if(@file_put_contents($target,$data,LOCK_EX)===false)throw new RuntimeException('임시 파일을 저장하지 못했습니다: '.$name);@chmod($target,0644);unset($data,$compressed);}
    }finally{fclose($fp);}
}

function t2tp_targets($manifest) {
    $manifest=t2tp_normalize_manifest($manifest);$install=$manifest['install'];return array(array('kind'=>$manifest['type'],'name'=>$manifest['id'],'source'=>rtrim((string)$install['source'],'/'),'relative'=>ltrim((string)$install['target'],'/')));
}

function t2tp_capture_file($file) {
    return array('exists'=>is_file($file),'content'=>is_file($file)?(string)@file_get_contents($file):'');
}

function t2tp_restore_file($file,$snapshot) {
    if(!is_array($snapshot)||empty($snapshot['exists'])){@unlink($file);return;}
    $dir=dirname($file);if(!is_dir($dir))@mkdir($dir,0700,true);
    @file_put_contents($file,(string)$snapshot['content'],LOCK_EX);@chmod($file,0600);
}

function t2tp_enable_plugins($manifest) {
    if($manifest['type']!=='plugin')return;
    $plugin=(string)$manifest['id'];
    t2_extend_with_file_lock(T2TP_SETTINGS_LOCK_FILE,'다른 설정 저장 작업과 충돌하여 플러그인을 활성화하지 못했습니다. 잠시 후 다시 시도하세요.',function() use ($plugin) {
        $settingsFile=T2TP_DATA_DIR.'/admin_settings.php';$settings=t2tp_read_json_file($settingsFile,array());
        if(!isset($settings['plugins'])||!is_array($settings['plugins']))$settings['plugins']=array();
        if(!isset($settings['plugins']['active'])||!is_array($settings['plugins']['active']))$settings['plugins']['active']=array();
        if(!in_array($plugin,$settings['plugins']['active'],true))$settings['plugins']['active'][]=$plugin;
        if(!t2tp_write_json_file($settingsFile,$settings))throw new RuntimeException('플러그인 활성화 설정 저장에 실패했습니다.');
    });
}

function t2tp_install_direct($zipPath,$manifest,$market,$catalogItem) {
    $manifest=t2tp_normalize_manifest($manifest);t2tp_validate_manifest($manifest);t2tp_check_requirements($manifest);
    $stage=T2TP_TMP_DIR.'/stage-'.bin2hex(random_bytes(12));
    $backup=T2TP_BACKUP_DIR.'/'.preg_replace('/[^A-Za-z0-9._-]/','_',$manifest['id']).'-'.date('Ymd-His').'-'.bin2hex(random_bytes(4));
    $targets=t2tp_targets($manifest);$registry=t2tp_read_json_file(T2TP_INSTALLED_FILE,array());$owners=array();
    $settingsFile=T2TP_DATA_DIR.'/admin_settings.php';$settingsSnapshot=t2tp_capture_file($settingsFile);
    foreach($registry as $ownerId=>$ownerItem)if(is_array($ownerItem)&&!empty($ownerItem['targets'])&&is_array($ownerItem['targets']))foreach($ownerItem['targets'] as $owned)if(is_array($owned)&&!empty($owned['relative']))$owners[(string)$owned['relative']]=(string)$ownerId;
    foreach($targets as $target){$relative=$target['relative'];$dest=T2EDITOR_PATH.'/'.$relative;if(file_exists($dest)){if(!isset($owners[$relative]))throw new RuntimeException('T2Editor 코어 또는 수동 설치 파일은 덮어쓸 수 없습니다: '.$relative);if($owners[$relative]!==$manifest['id'])throw new RuntimeException('다른 서드파티 프로그램이 사용하는 경로입니다: '.$relative);}}
    $changed=array();
    try{
        t2tp_extract_package($zipPath,$manifest,$stage);
        if(!is_dir($backup)&&!@mkdir($backup,0700,true)&&!is_dir($backup))throw new RuntimeException('백업 디렉터리를 만들 수 없습니다.');
        foreach($targets as $target){$dest=T2EDITOR_PATH.'/'.$target['relative'];$src=$stage.'/'.$target['source'];if(!file_exists($src))throw new RuntimeException('ZIP의 설치 원본을 찾을 수 없습니다: '.$target['source']);if(file_exists($dest))t2tp_copy_tree($dest,$backup.'/'.$target['relative']);}
        foreach($targets as $target){
            $dest=T2EDITOR_PATH.'/'.$target['relative'];$src=$stage.'/'.$target['source'];
            $changed[]=$target; // destructive step 전에 기록하여 부분 복사 실패도 복구
            if(file_exists($dest))t2tp_remove_tree($dest);
            t2tp_copy_tree($src,$dest);
        }
        t2tp_enable_plugins($manifest);
        $registry[$manifest['id']]=array('id'=>$manifest['id'],'name'=>$manifest['name'],'version'=>$manifest['version'],'type'=>$manifest['type'],'release_id'=>isset($catalogItem['id'])?(string)$catalogItem['id']:'','release_type'=>isset($catalogItem['release_type'])?(string)$catalogItem['release_type']:(isset($manifest['release']['type'])?(string)$manifest['release']['type']:''),'manifest'=>$manifest,'market'=>array('id'=>isset($market['id'])?$market['id']:'','name'=>isset($market['name'])?$market['name']:'','url'=>isset($market['url'])?$market['url']:''),'sha256'=>isset($catalogItem['sha256'])?$catalogItem['sha256']:hash_file('sha256',$zipPath),'targets'=>$targets,'backup_dir'=>$backup,'installed_at'=>date('c'));
        if(!t2tp_write_json_file(T2TP_INSTALLED_FILE,$registry))throw new RuntimeException('설치 기록 저장에 실패했습니다.');
        return$registry[$manifest['id']];
    }catch(Exception $e){
        foreach(array_reverse($changed) as $target){$dest=T2EDITOR_PATH.'/'.$target['relative'];t2tp_remove_tree($dest);$old=$backup.'/'.$target['relative'];if(file_exists($old))t2tp_copy_tree($old,$dest);}
        t2tp_restore_file($settingsFile,$settingsSnapshot);
        t2tp_remove_tree($backup);
        throw$e;
    }finally{t2tp_remove_tree($stage);}
}

function t2tp_install_data($zipPath,$manifest,$market,$catalogItem) {
    $manifest=t2tp_normalize_manifest($manifest);t2tp_validate_manifest($manifest);t2tp_check_requirements($manifest);
    $stage=T2TP_TMP_DIR.'/stage-'.bin2hex(random_bytes(12));$registry=t2tp_read_json_file(T2TP_INSTALLED_FILE,array());$revision=t2tp_unique_revision($manifest,$zipPath);$typeDir=t2tp_data_type_dir((string)$manifest['type']);
    $privatePath=T2TP_EXTENSION_ROOT.'/'.$typeDir.'/'.$manifest['id'].'/'.$revision;$publicPath=T2TP_PUBLIC_EXTENSION_ROOT.'/'.$typeDir.'/'.$manifest['id'].'/'.$revision;
    try{
        t2tp_extract_package($zipPath,$manifest,$stage);$source=$stage.'/'.rtrim((string)$manifest['install']['source'],'/');if(!file_exists($source))throw new RuntimeException('ZIP의 설치 원본을 찾을 수 없습니다.');
        if(is_file($source)){
            if(!is_dir($privatePath)&&!@mkdir($privatePath,0700,true)&&!is_dir($privatePath))throw new RuntimeException('비공개 확장 슬롯을 만들 수 없습니다.');
            t2tp_copy_tree($source,$privatePath.'/'.basename($source));
            $assetCount=0;
            if(t2tp_static_asset_allowed($source)){
                if(!is_dir($publicPath)&&!@mkdir($publicPath,0755,true)&&!is_dir($publicPath))throw new RuntimeException('공개 자산 슬롯을 만들 수 없습니다.');
                t2tp_copy_tree($source,$publicPath.'/'.basename($source));$assetCount=1;
            }
        }else{
            t2tp_copy_tree($source,$privatePath);$assetCount=t2tp_project_static_tree($source,$publicPath);
        }
        t2tp_write_package_router_manifest($privatePath,$manifest);t2tp_enable_plugins($manifest);
        $publicUrl=rtrim(T2EDITOR_DB_URL,'/').'/t2pack/assets/extensions/'.$typeDir.'/'.rawurlencode((string)$manifest['id']).'/'.rawurlencode($revision);
        $registry[$manifest['id']]=array('id'=>$manifest['id'],'name'=>$manifest['name'],'version'=>$manifest['version'],'type'=>$manifest['type'],'storage_mode'=>'data','revision'=>$revision,'private_path'=>$privatePath,'public_path'=>$publicPath,'public_url'=>$publicUrl,'asset_files'=>$assetCount,'release_id'=>isset($catalogItem['id'])?(string)$catalogItem['id']:'','release_type'=>isset($catalogItem['release_type'])?(string)$catalogItem['release_type']:(isset($manifest['release']['type'])?(string)$manifest['release']['type']:''),'manifest'=>$manifest,'market'=>array('id'=>isset($market['id'])?$market['id']:'','name'=>isset($market['name'])?$market['name']:'','url'=>isset($market['url'])?$market['url']:''),'sha256'=>isset($catalogItem['sha256'])?$catalogItem['sha256']:hash_file('sha256',$zipPath),'targets'=>array(),'installed_at'=>date('c'));
        if(!t2tp_write_json_file(T2TP_INSTALLED_FILE,$registry))throw new RuntimeException('설치 기록 저장에 실패했습니다.');return $registry[$manifest['id']];
    }catch(Throwable $e){t2tp_remove_tree($privatePath);t2tp_remove_tree($publicPath);throw $e;}finally{t2tp_remove_tree($stage);}
}

function t2tp_install($zipPath,$manifest,$market,$catalogItem) {
    return t2tp_install_mode()==='data'?t2tp_install_data($zipPath,$manifest,$market,$catalogItem):t2tp_install_direct($zipPath,$manifest,$market,$catalogItem);
}

function t2tp_uninstall($id) {
    $installed=t2tp_read_json_file(T2TP_INSTALLED_FILE,array());
    if(!isset($installed[$id])||!is_array($installed[$id]))throw new RuntimeException('설치 기록을 찾을 수 없습니다.');
    $item=$installed[$id];
    if(isset($item['storage_mode'])&&$item['storage_mode']==='data'){
        $typeDir=t2tp_data_type_dir((string)$item['type']);
        t2tp_remove_tree(T2TP_EXTENSION_ROOT.'/'.$typeDir.'/'.$id);
        t2tp_remove_tree(T2TP_PUBLIC_EXTENSION_ROOT.'/'.$typeDir.'/'.$id);
        if(isset($item['type'])&&$item['type']==='plugin'){
            t2_extend_with_file_lock(T2TP_SETTINGS_LOCK_FILE,'다른 설정 저장 작업과 충돌하여 플러그인을 비활성화하지 못했습니다. 잠시 후 다시 시도하세요.',function() use ($id) {
                $settingsFile=T2TP_DATA_DIR.'/admin_settings.php';$settings=t2tp_read_json_file($settingsFile,array());
                if(!empty($settings['plugins']['active'])&&is_array($settings['plugins']['active']))$settings['plugins']['active']=array_values(array_filter($settings['plugins']['active'],function($name)use($id){return$name!==$id;}));
                t2tp_write_json_file($settingsFile,$settings);
            });
        }
        unset($installed[$id]);if(!t2tp_write_json_file(T2TP_INSTALLED_FILE,$installed))throw new RuntimeException('설치 기록 갱신에 실패했습니다.');return;
    }$targets=isset($item['targets'])&&is_array($item['targets'])?$item['targets']:array();
    $removeBackup=T2TP_TMP_DIR.'/remove-'.bin2hex(random_bytes(12));
    $settingsFile=T2TP_DATA_DIR.'/admin_settings.php';$settingsSnapshot=t2tp_capture_file($settingsFile);$registrySnapshot=t2tp_capture_file(T2TP_INSTALLED_FILE);
    $validTargets=array();
    foreach($targets as $target){
        if(!is_array($target)||empty($target['relative']))throw new RuntimeException('설치 기록의 대상 경로가 손상되었습니다.');
        $relative=(string)$target['relative'];
        if(!preg_match('#^(plugin/[a-z0-9][a-z0-9_-]{2,79}|extend/js/[a-z0-9][a-z0-9._-]{2,79}\\.js|extend/php/[a-z0-9][a-z0-9._-]{2,79}\\.php|locales/[a-z0-9][a-z0-9._-]{2,79}|locale/[a-z0-9][a-z0-9._-]{2,79})$#',$relative))throw new RuntimeException('안전하지 않은 제거 경로가 설치 기록에 포함되어 있습니다: '.$relative);
        $validTargets[]=array('relative'=>$relative);
    }
    try{
        if(!is_dir($removeBackup)&&!@mkdir($removeBackup,0700,true)&&!is_dir($removeBackup))throw new RuntimeException('제거 백업 디렉터리를 만들 수 없습니다.');
        foreach($validTargets as $target){$src=T2EDITOR_PATH.'/'.$target['relative'];if(file_exists($src))t2tp_copy_tree($src,$removeBackup.'/'.$target['relative']);}
        foreach($validTargets as $target)t2tp_remove_tree(T2EDITOR_PATH.'/'.$target['relative']);
        if(isset($item['type'])&&$item['type']==='plugin'){
            t2_extend_with_file_lock(T2TP_SETTINGS_LOCK_FILE,'다른 설정 저장 작업과 충돌하여 플러그인을 비활성화하지 못했습니다. 잠시 후 다시 시도하세요.',function() use ($settingsFile,$id) {
                $settings=t2tp_read_json_file($settingsFile,array());
                if(!empty($settings['plugins']['active'])&&is_array($settings['plugins']['active']))$settings['plugins']['active']=array_values(array_filter($settings['plugins']['active'],function($name)use($id){return$name!==$id;}));
                if(!t2tp_write_json_file($settingsFile,$settings))throw new RuntimeException('플러그인 비활성화 설정 저장에 실패했습니다.');
            });
        }
        unset($installed[$id]);if(!t2tp_write_json_file(T2TP_INSTALLED_FILE,$installed))throw new RuntimeException('설치 기록 갱신에 실패했습니다.');
    }catch(Exception $e){
        foreach($validTargets as $target){$dest=T2EDITOR_PATH.'/'.$target['relative'];$old=$removeBackup.'/'.$target['relative'];t2tp_remove_tree($dest);if(file_exists($old))t2tp_copy_tree($old,$dest);}
        t2tp_restore_file($settingsFile,$settingsSnapshot);t2tp_restore_file(T2TP_INSTALLED_FILE,$registrySnapshot);
        throw$e;
    }finally{t2tp_remove_tree($removeBackup);}
}


function t2tp_browser_job_file($id) {
    if(!preg_match('/^[a-f0-9]{32}$/',(string)$id))throw new RuntimeException('브라우저 압축 작업 ID가 올바르지 않습니다.');
    return T2TP_TMP_DIR.'/browser-job-'.$id.'.php';
}

function t2tp_browser_entries($archive,$manifest) {
    $entries=t2tp_zip_entries($archive);$result=array();$seen=array();
    foreach($entries as $entry){
        $rawName=(string)$entry['name'];if(!t2browser_utf8_valid($rawName))throw new RuntimeException('ZIP 파일 이름은 UTF-8이어야 합니다.');
        $name=t2tp_normalize_zip_name($rawName);$isDirectory=substr($name,-1)==='/';
        if($isDirectory||t2tp_ignore_zip_entry($name)||!t2tp_allowed_zip_name($name,$manifest,false))continue;
        if(t2tp_safe_zip_path($name,false)===false)throw new RuntimeException('안전하지 않은 ZIP 경로입니다.');
        if(!in_array((int)$entry['method'],array(0,8),true))throw new RuntimeException('브라우저 폴백이 지원하지 않는 ZIP 압축 방식입니다.');
        if(isset($seen[$name]))throw new RuntimeException('ZIP에 중복 파일 경로가 있습니다: '.$name);
        $seen[$name]=true;
        $result[]=array('index'=>count($result),'zip_name'=>$name,'path'=>$name,'size'=>(int)$entry['uncompressed'],'crc'=>strtolower(sprintf('%08x',((int)$entry['crc'])&0xffffffff)),'method'=>(int)$entry['method']);
    }
    if(!$result)throw new RuntimeException('브라우저에서 해제할 설치 파일이 없습니다.');
    return$result;
}

function t2tp_archive_requires_browser($archive,$manifest) {
    if(t2browser_archive_backend()!=='browser')return false;
    foreach(t2tp_browser_entries($archive,$manifest)as$entry)if((int)$entry['method']!==0)return true;
    return false;
}

function t2tp_browser_begin_job($archive,$manifest,$market,$selected) {
    $id=bin2hex(random_bytes(16));$token=bin2hex(random_bytes(24));
    $stage=T2TP_TMP_DIR.'/browser-stage-'.$id;$upload=T2TP_TMP_DIR.'/browser-upload-'.$id;
    try{
        if(!is_dir($stage)&&!@mkdir($stage,0700,true)&&!is_dir($stage))throw new RuntimeException('브라우저 압축 준비 폴더를 만들 수 없습니다.');
        if(!is_dir($upload)&&!@mkdir($upload,0700,true)&&!is_dir($upload))throw new RuntimeException('브라우저 업로드 폴더를 만들 수 없습니다.');
        $entries=t2tp_browser_entries($archive,$manifest);
        $job=array('id'=>$id,'token'=>$token,'created_at'=>time(),'expires_at'=>time()+T2TP_BROWSER_JOB_TTL,'archive'=>$archive,'stage'=>$stage,'upload_dir'=>$upload,'repacked'=>T2TP_TMP_DIR.'/browser-store-'.$id.'.zip','entries'=>$entries,'uploaded'=>array(),'manifest'=>$manifest,'market'=>$market,'selected'=>$selected);
        if(!t2tp_write_json_file(t2tp_browser_job_file($id),$job))throw new RuntimeException('브라우저 압축 작업을 저장하지 못했습니다.');
        return array('browser_fallback_required'=>true,'job_id'=>$id,'token'=>$token,'chunk_bytes'=>T2TP_BROWSER_CHUNK_BYTES,'packages'=>array(array('role'=>'package','archive_url'=>'third_party_api.php?action=browser_archive&job_id='.$id.'&role=package&token='.$token,'archive_bytes'=>(int)@filesize($archive),'entries'=>array_map(function($entry){return array('index'=>$entry['index'],'zip_name'=>$entry['zip_name'],'path'=>$entry['path'],'size'=>$entry['size']);},$entries))));
    }catch(Throwable$e){
        t2tp_remove_tree($stage);t2tp_remove_tree($upload);@unlink(t2tp_browser_job_file($id));
        throw$e;
    }
}

function t2tp_browser_load_job($id,$token) {
    $job=t2tp_read_json_file(t2tp_browser_job_file($id),array());
    if(!is_array($job)||empty($job['expires_at'])||(int)$job['expires_at']<time())throw new RuntimeException('브라우저 압축 작업이 만료되었거나 손상되었습니다.');
    if(!t2browser_token_valid(isset($job['token'])?$job['token']:'',(string)$token))throw new RuntimeException('브라우저 압축 작업 토큰이 올바르지 않습니다.');
    return$job;
}

function t2tp_browser_cleanup_job($job) {
    if(!is_array($job))return;
    foreach(array('archive','repacked')as$key)if(!empty($job[$key]))@unlink((string)$job[$key]);
    foreach(array('stage','upload_dir')as$key)if(!empty($job[$key]))t2tp_remove_tree((string)$job[$key]);
    if(!empty($job['id']))@unlink(t2tp_browser_job_file((string)$job['id']));
}

function t2tp_browser_cleanup_jobs() {
    foreach((array)glob(T2TP_TMP_DIR.'/browser-job-*.php')as$file){$job=t2tp_read_json_file($file,array());if(!is_array($job)||empty($job['expires_at'])||(int)$job['expires_at']<time()){t2tp_browser_cleanup_job($job);@unlink($file);}}
}

function t2tp_browser_serve_archive($id,$token) {
    global $T2TP_LOCAL_BUFFER_LEVEL;
    $job=t2tp_browser_load_job($id,$token);$file=(string)$job['archive'];
    if(!is_file($file))throw new RuntimeException('브라우저로 전달할 ZIP 파일이 없습니다.');
    while(ob_get_level()>$T2TP_LOCAL_BUFFER_LEVEL)ob_end_clean();
    if(function_exists('set_time_limit'))@set_time_limit(600);
    header('Content-Type: application/zip');header('X-Content-Type-Options: nosniff');header('Content-Length: '.(int)filesize($file));header('Content-Disposition: attachment; filename="t2editor-extension.zip"');header('Cache-Control: no-store');readfile($file);exit;
}

function t2tp_browser_upload_entry($id,$token,$entryIndex,$offset) {
    $job=t2tp_browser_load_job($id,$token);$entryIndex=(int)$entryIndex;
    if(!isset($job['entries'][$entryIndex]))throw new RuntimeException('브라우저 업로드 파일 번호가 올바르지 않습니다.');
    $entry=$job['entries'][$entryIndex];
    if(isset($job['uploaded'][(string)$entryIndex]))return array('complete'=>true,'received'=>(int)$entry['size']);
    $part=rtrim((string)$job['upload_dir'],'/\\').'/'.$entryIndex.'.part';$expected=(int)$entry['size'];
    if($expected===0){if((int)$offset!==0)throw new RuntimeException('빈 파일 업로드 위치가 올바르지 않습니다.');if(@file_put_contents($part,'')===false)throw new RuntimeException('빈 파일을 저장하지 못했습니다.');$received=0;}
    else{$data=t2browser_read_chunk(T2TP_BROWSER_CHUNK_BYTES);$received=t2browser_append_chunk($part,(int)$offset,$data,$expected);}
    if($received===$expected){
        if((int)@filesize($part)!==$expected||!hash_equals((string)$entry['crc'],t2browser_crc32_file($part)))throw new RuntimeException('브라우저가 반환한 파일 검증에 실패했습니다: '.$entry['path']);
        $target=rtrim((string)$job['stage'],'/\\').'/'.$entry['path'];$dir=dirname($target);
        if(!is_dir($dir)&&!@mkdir($dir,0700,true)&&!is_dir($dir))throw new RuntimeException('검증된 파일 경로를 만들 수 없습니다.');
        if(!@rename($part,$target))throw new RuntimeException('검증된 파일을 설치 준비 경로로 이동하지 못했습니다.');
        $job['uploaded'][(string)$entryIndex]=true;
        if(!t2tp_write_json_file(t2tp_browser_job_file($id),$job))throw new RuntimeException('브라우저 압축 작업 상태를 저장하지 못했습니다.');
        return array('complete'=>true,'received'=>$received);
    }
    return array('complete'=>false,'received'=>$received);
}

function t2tp_browser_finalize_job($id,$token) {
    if(function_exists('set_time_limit'))@set_time_limit(300);
    $job=t2tp_browser_load_job($id,$token);
    try{
        if(count((array)$job['uploaded'])!==count((array)$job['entries']))throw new RuntimeException('브라우저 압축 해제가 완료되지 않았습니다.');
        $storeEntries=array();
        foreach($job['entries']as$entry){
            $file=rtrim((string)$job['stage'],'/\\').'/'.$entry['path'];
            if(!is_file($file)||(int)@filesize($file)!==(int)$entry['size']||!hash_equals((string)$entry['crc'],t2browser_crc32_file($file)))throw new RuntimeException('브라우저 압축 해제 결과가 원본 ZIP과 일치하지 않습니다: '.$entry['path']);
            $storeEntries[]=array('name'=>$entry['zip_name'],'file'=>$file);
        }
        t2browser_write_store_zip((string)$job['repacked'],$storeEntries);
        t2tp_read_validate_package((string)$job['repacked'],$job['manifest']);
        $installed=t2_extend_with_file_lock(T2TP_INSTALL_LOCK_FILE,'다른 설치 또는 에디터 업데이트 작업이 진행 중입니다. 잠시 후 다시 시도하세요.',function()use($job){return t2tp_install((string)$job['repacked'],$job['manifest'],$job['market'],$job['selected']);},false);
        t2tp_browser_cleanup_job($job);
        return$installed;
    }catch(Throwable$e){t2tp_browser_cleanup_job($job);throw$e;}
}

if (defined('T2TP_LIBRARY_ONLY') && T2TP_LIBRARY_ONLY) return;

t2tp_ensure_dirs();
t2tp_browser_cleanup_jobs();
if(t2tp_install_mode()==='direct')t2tp_migrate_locales_layout();
if (!t2tp_logged_in()) t2tp_response(false, null, '관리자 로그인이 필요합니다.', 401);

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
$action = isset($_GET['action']) ? strtolower((string)$_GET['action']) : '';
$input = ($method === 'POST' && $action !== 'browser_upload') ? t2tp_input() : array();
t2editor_admin_session_unlock();

try {
    if ($action === 'state' && $method === 'GET') {
        $dsclubEnabled = t2tp_dsclub_api_enabled();
        t2tp_response(true, array('markets' => t2tp_markets(), 'installed' => t2tp_read_json_file(T2TP_INSTALLED_FILE, array()), 'editor_version'=>t2tp_editor_version(), 'client_id' => t2tp_client_id(), 'api_spec_url' => $dsclubEnabled ? T2TP_DEFAULT_MARKET . '?action=spec' : null, 'dsclub_api_enabled'=>$dsclubEnabled, 'dsclub_telemetry'=>array('enabled'=>$dsclubEnabled,'official_only'=>true,'fields'=>array('T2Editor version','PHP version','platform','pseudonymous install ID'),'developer_visibility'=>'aggregated_only')), '', 200);
    }

    if ($action === 'save_markets' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $markets = isset($input['markets']) && is_array($input['markets']) ? $input['markets'] : array();
        $currentMarketSettings = t2tp_markets_raw();
        $officialEnabled = array_key_exists('official_enabled', $input)
            ? !empty($input['official_enabled']) : !empty($currentMarketSettings['official_enabled']);
        $clean = array();
        foreach ($markets as $market) {
            if (!is_array($market)) continue;
            $url = isset($market['url']) ? trim((string)$market['url']) : '';
            if ($url === T2TP_DEFAULT_MARKET) continue; // official row is not user-managed here
            t2tp_market_endpoint($url);
            $id = isset($market['id']) ? preg_replace('/[^A-Za-z0-9._-]/', '-', (string)$market['id']) : '';
            if ($id === '' || strpos($id, 'certified-') === 0) $id = 'market-' . substr(hash('sha256', $url), 0, 12);
            $clean[] = array('id' => substr($id, 0, 80), 'name' => t2tp_clean_text(isset($market['name']) ? $market['name'] : $url, 80), 'url' => $url, 'enabled' => !empty($market['enabled']));
            if (count($clean) >= 20) break;
        }
        $certifiedDisabled = array();
        if (isset($input['certified_disabled']) && is_array($input['certified_disabled'])) {
            foreach ($input['certified_disabled'] as $cid) {
                $cid = preg_replace('/[^A-Za-z0-9._-]/', '', (string)$cid);
                if (strpos($cid, 'certified-') === 0 && strlen($cid) <= 80) $certifiedDisabled[] = $cid;
                if (count($certifiedDisabled) >= 40) break;
            }
        }
        if (!t2tp_write_json_file(T2TP_MARKETS_FILE, array('custom' => $clean, 'certified_disabled' => array_values(array_unique($certifiedDisabled)), 'official_enabled' => $officialEnabled))) throw new RuntimeException('마켓 목록 저장에 실패했습니다.');
        t2tp_response(true, t2tp_markets(), '마켓 목록을 저장했습니다.', 200);
    }

    if ($action === 'test_market' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $url = isset($input['url']) ? (string)$input['url'] : '';
        $spec = t2tp_curl_json($url, 'spec', array(), null);
        t2tp_response(true, $spec, '호환 가능한 마켓 API입니다.', 200);
    }

    if (($action === 'catalog' || $action === 'detail' || $action === 'reviews') && $method === 'GET') {
        $markets = t2tp_markets();
        $marketId = isset($_GET['market_id']) ? (string)$_GET['market_id'] : '';
        $market = null;
        foreach ($markets as $candidate) if (is_array($candidate) && !empty($candidate['enabled']) && (string)$candidate['id'] === $marketId) { $market = $candidate; break; }
        if (!$market) throw new RuntimeException('활성 마켓을 찾을 수 없습니다.');
        $query = array();
        foreach (array('q', 'type', 'page', 'limit', 'id') as $key) if (isset($_GET[$key])) $query[$key] = (string)$_GET[$key];
        $data = t2tp_curl_json($market['url'], $action, $query, null);
        t2tp_response(true, $data, '', 200);
    }

    if ($action === 'browser_archive' && $method === 'GET') {
        t2tp_browser_serve_archive(isset($_GET['job_id'])?(string)$_GET['job_id']:'',isset($_GET['token'])?(string)$_GET['token']:'');
    }

    if ($action === 'browser_upload' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $result=t2tp_browser_upload_entry(
            isset($_GET['job_id'])?(string)$_GET['job_id']:'',
            isset($_GET['token'])?(string)$_GET['token']:'',
            isset($_GET['entry'])?(int)$_GET['entry']:-1,
            isset($_GET['offset'])?(int)$_GET['offset']:-1
        );
        t2tp_response(true,$result,'',200);
    }

    if ($action === 'browser_finalize' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $installed=t2tp_browser_finalize_job(isset($input['job_id'])?(string)$input['job_id']:'',isset($input['token'])?(string)$input['token']:'');
        t2tp_response(true,$installed,'v'.$installed['version'].' 설치가 완료되었습니다. ('.(t2tp_install_mode()==='data'?'공용 데이터 폴더':'직접 설치').')',200);
    }

    if ($action === 'install' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2tp_verify_password($password)) { sleep(1); t2tp_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $packageId = isset($input['package_id']) ? (string)$input['package_id'] : '';
        $releaseId = isset($input['release_id']) ? (string)$input['release_id'] : '';
        $marketId = isset($input['market_id']) ? (string)$input['market_id'] : '';
        $market = null;
        foreach (t2tp_markets() as $candidate) if (is_array($candidate) && !empty($candidate['enabled']) && (string)$candidate['id'] === $marketId) { $market = $candidate; break; }
        if (!$market) throw new RuntimeException('활성 마켓을 찾을 수 없습니다.');
        $detail = t2tp_curl_json($market['url'], 'detail', array('id' => $packageId), null);
        if (!isset($detail['id']) || (string)$detail['id'] !== $packageId) throw new RuntimeException('마켓 상세 응답의 패키지 ID가 일치하지 않습니다.');
        $selected = null;
        $releases = isset($detail['releases']) && is_array($detail['releases']) ? $detail['releases'] : array();
        if ($releaseId !== '') foreach ($releases as $release) if (is_array($release) && isset($release['id']) && (string)$release['id'] === $releaseId) { $selected=$release; break; }
        if ($selected === null && $releaseId === '') {
            foreach ($releases as $release) if (is_array($release) && isset($release['id']) && (string)$release['id'] === (string)(isset($detail['current_release_id'])?$detail['current_release_id']:'')) { $selected=$release; break; }
            if ($selected === null && isset($releases[0]) && is_array($releases[0])) $selected=$releases[0];
        }
        if ($selected === null) throw new RuntimeException('선택한 릴리즈를 찾을 수 없습니다.');
        if (empty($selected['manifest']) || !is_array($selected['manifest'])) throw new RuntimeException('선택한 릴리즈에 API v1 매니페스트가 없습니다.');
        $manifest = t2tp_normalize_manifest($selected['manifest']);
        t2tp_validate_manifest($manifest);
        t2tp_require_major_version_warning_ack($manifest, !empty($input['major_version_warning_ack']));
        t2tp_check_requirements($manifest);
        if ((string)$manifest['id'] !== (string)$detail['slug']) throw new RuntimeException('매니페스트 ID가 마켓 slug와 일치하지 않습니다.');
        if ((string)$manifest['version'] !== (string)$selected['version']) throw new RuntimeException('매니페스트 버전이 선택한 릴리즈와 일치하지 않습니다.');
        $clientId = t2tp_client_id();
        $challenge = t2tp_curl_json($market['url'], 'challenge', array(), array('package_id' => $packageId, 'release_id'=>(string)$selected['id'], 'client_id' => $clientId));
        if (empty($challenge['ticket']) || empty($challenge['release_id']) || (string)$challenge['release_id'] !== (string)$selected['id']) throw new RuntimeException('선택한 릴리즈의 다운로드 티켓을 받지 못했습니다.');
        $tmp = T2TP_TMP_DIR . '/package-' . bin2hex(random_bytes(16)) . '.zip';
        try {
            t2tp_download_package($market['url'], $packageId, (string)$selected['id'], $clientId, (string)$challenge['ticket'], $tmp);
            $sha = hash_file('sha256', $tmp);
            if (empty($selected['sha256']) || !is_string($sha) || !hash_equals(strtolower((string)$selected['sha256']), strtolower($sha))) throw new RuntimeException('다운로드 배포물 SHA-256이 릴리즈 메타데이터와 다릅니다.');
            if (!empty($manifest['archive']['sha256']) && !hash_equals(strtolower((string)$manifest['archive']['sha256']), strtolower($sha))) throw new RuntimeException('매니페스트의 SHA-256과 다운로드 파일이 다릅니다.');
            t2tp_read_validate_package($tmp, $manifest);
            if (t2tp_archive_requires_browser($tmp,$manifest)) {
                $fallback=t2tp_browser_begin_job($tmp,$manifest,$market,$selected);
                $tmp='';
                t2tp_response(true,$fallback,'서버에서 DEFLATE ZIP을 해제할 수 없어 관리자 브라우저에서 처리합니다.',200);
            }
            $installed = t2_extend_with_file_lock(T2TP_INSTALL_LOCK_FILE, '다른 설치 또는 에디터 업데이트 작업이 진행 중입니다. 잠시 후 다시 시도하세요.', function () use ($tmp, $manifest, $market, $selected) {
                return t2tp_install($tmp, $manifest, $market, $selected);
            }, false);
            t2tp_response(true, $installed, 'v'.$manifest['version'].' 설치가 완료되었습니다. (' . (t2tp_install_mode()==='data'?'공용 데이터 폴더':'직접 설치') . ')', 200);
        } finally {
            @unlink($tmp);
        }
    }

    if ($action === 'uninstall' && $method === 'POST') {
        if (!t2tp_csrf_valid()) t2tp_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2tp_verify_password($password)) { sleep(1); t2tp_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $id = isset($input['id']) ? (string)$input['id'] : '';
        t2_extend_with_file_lock(T2TP_INSTALL_LOCK_FILE, '다른 설치 또는 에디터 업데이트 작업이 진행 중입니다. 잠시 후 다시 시도하세요.', function () use ($id) {
            t2tp_uninstall($id);
        }, false);
        t2tp_response(true, null, '제거가 완료되었습니다.', 200);
    }

    t2tp_response(false, null, '지원하지 않는 요청입니다.', 404);
} catch (Throwable $e) {
    error_log('T2Editor third party installer error: ' . $e->getMessage());
    t2tp_response(false, null, $e->getMessage(), 500);
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
