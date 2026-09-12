<?php
// Path: T2Editor/admin/environment_api.core.php
// Developer note: 관리자 action·필드명 변경 시 프런트 요청과 CSRF/권한 검사를 함께 맞춘다.
/**
 * T2Editor administrator environment diagnostics (PHP 7.4+).
 *
 * Reports whether the core updater and third-party installer can run on the
 * current server, and returns practical remediation instructions.  The
 * network probe is deliberately separate from the local capability check so
 * the admin screen can render immediately even when outbound HTTPS is blocked.
 */
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
@ini_set('log_errors', '1');
$T2ENV_BUFFER_LEVEL = ob_get_level();
$GLOBALS['T2ENV_RESPONSE_SENT'] = false;
ob_start();
require_once dirname(__DIR__) . '/config/t2_cms_auth.php';
t2editor_admin_auth_bootstrap();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

register_shutdown_function(function () use ($T2ENV_BUFFER_LEVEL) {
    if (!empty($GLOBALS['T2ENV_RESPONSE_SENT'])) return;
    $error = error_get_last();
    if (!is_array($error) || !in_array((int)$error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR), true)) return;
    while (ob_get_level() > $T2ENV_BUFFER_LEVEL) @ob_end_clean();
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('ok' => false, 'data' => null, 'msg' => '서버 환경 진단을 완료하지 못했습니다.', 'api_version' => '1.1.0'), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

require_once dirname(__DIR__) . '/config/t2_config.php';

const T2ENV_API_VERSION = '1.1.0';
const T2ENV_UPDATE_PROBE_URL = 'https://dsclub.kr/api/t2editor/version/index.php?action=spec';
const T2ENV_THIRD_PARTY_PROBE_URL = 'https://dsclub.kr/api/t2editor/third_party/index.php?action=spec';

function t2env_response($ok, $data, $message, $status)
{
    global $T2ENV_BUFFER_LEVEL;
    $GLOBALS['T2ENV_RESPONSE_SENT'] = true;
    while (ob_get_level() > $T2ENV_BUFFER_LEVEL) ob_end_clean();
    http_response_code((int)$status);
    echo json_encode(array(
        'ok' => (bool)$ok,
        'data' => $data,
        'msg' => (string)$message,
        'api_version' => T2ENV_API_VERSION,
    ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | (defined('JSON_INVALID_UTF8_SUBSTITUTE') ? JSON_INVALID_UTF8_SUBSTITUTE : 0));
    exit;
}

function t2env_logged_in()
{
    return t2editor_admin_is_authorized();
}

function t2env_bool_ini($name)
{
    $value = ini_get($name);
    return $value !== false && !in_array(strtolower(trim((string)$value)), array('', '0', 'off', 'false', 'no', 'none'), true);
}

function t2env_ini_bytes($value)
{
    $value = trim((string)$value);
    if ($value === '' || $value === '-1') return -1;
    $last = strtolower(substr($value, -1));
    $number = (float)$value;
    if ($last === 'g') $number *= 1024;
    if ($last === 'g' || $last === 'm') $number *= 1024;
    if ($last === 'g' || $last === 'm' || $last === 'k') $number *= 1024;
    return (int)$number;
}

function t2env_token()
{
    try { return bin2hex(random_bytes(8)); }
    catch (Throwable $e) { return str_replace('.', '', uniqid('', true)); }
}

function t2env_function_available($name)
{
    $disabled = array_filter(array_map('trim', explode(',', (string)ini_get('disable_functions'))));
    return function_exists($name) && !in_array($name, $disabled, true);
}

function t2env_nearest_existing_dir($path)
{
    $path = rtrim((string)$path, '/\\');
    for ($depth = 0; $depth < 8 && $path !== '' && !is_dir($path); $depth++) {
        $parent = dirname($path);
        if ($parent === $path) break;
        $path = $parent;
    }
    return is_dir($path) ? $path : '';
}

function t2env_writable_hint($path)
{
    $path = rtrim((string)$path, '/\\');
    if ($path === '') return array('ok' => false, 'path' => $path, 'detail' => '경로가 비어 있습니다.');
    if (is_dir($path)) {
        $ok = is_writable($path);
        return array('ok' => $ok, 'path' => $path, 'detail' => $ok ? 'PHP 프로세스에 쓰기 권한이 있습니다.' : 'PHP 프로세스에 쓰기 권한이 없습니다.');
    }
    $ancestor = t2env_nearest_existing_dir($path);
    $ok = $ancestor !== '' && is_writable($ancestor);
    return array('ok' => $ok, 'path' => $path, 'detail' => $ok ? '상위 디렉터리에 생성 권한이 있습니다.' : '대상 경로 또는 상위 디렉터리에 생성 권한이 없습니다.');
}

function t2env_check($id, $label, $ok, $severity, $detail, $fixes)
{
    return array(
        'id' => (string)$id,
        'label' => (string)$label,
        'ok' => (bool)$ok,
        'severity' => (string)$severity,
        'detail' => (string)$detail,
        'fixes' => array_values((array)$fixes),
    );
}

function t2env_feature($id, $label, $checks)
{
    $blocking = 0;
    $warnings = 0;
    $passed = 0;
    foreach ($checks as $check) {
        if (!empty($check['ok'])) $passed++;
        elseif (isset($check['severity']) && $check['severity'] === 'warning') $warnings++;
        else $blocking++;
    }
    return array(
        'id' => (string)$id,
        'label' => (string)$label,
        'available' => $blocking === 0,
        'status' => $blocking > 0 ? 'unavailable' : ($warnings > 0 ? 'limited' : 'available'),
        'passed' => $passed,
        'total' => count($checks),
        'blocking_count' => $blocking,
        'warning_count' => $warnings,
        'checks' => array_values($checks),
    );
}

function t2env_common_function_check()
{
    $required = array('file_put_contents','mkdir','rename','copy','unlink','hash_file','json_encode','json_decode','random_bytes');
    $missing = array();
    foreach ($required as $function) if (!t2env_function_available($function)) $missing[] = $function;
    return t2env_check(
        'required_functions',
        '필수 PHP 함수',
        !$missing,
        'error',
        $missing ? '비활성화되었거나 사용할 수 없는 함수: ' . implode(', ', $missing) : '업데이트·설치에 필요한 파일 및 암호화 함수를 사용할 수 있습니다.',
        array(
            'php.ini의 disable_functions에서 위 함수를 제거한 뒤 PHP-FPM 또는 웹서버를 재시작하세요.',
            '공유호스팅에서는 호스팅 관리자에게 파일 생성·이름 변경·삭제 함수 허용을 요청하세요.',
        )
    );
}

function t2env_runtime_warning_checks()
{
    $checks = array();
    $maxExecution = (int)ini_get('max_execution_time');
    $checks[] = t2env_check(
        'execution_time',
        'PHP 실행 시간',
        $maxExecution === 0 || $maxExecution >= 120,
        'warning',
        $maxExecution === 0 ? '실행 시간 제한이 없습니다.' : '현재 max_execution_time=' . $maxExecution . '초입니다. 큰 배포물에서는 시간이 부족할 수 있습니다.',
        array('php.ini 또는 호스팅 패널에서 max_execution_time을 120 이상으로 설정하세요.', 'PHP-FPM/Apache를 재시작해 변경값을 적용하세요.')
    );

    $memory = t2env_ini_bytes(ini_get('memory_limit'));
    $checks[] = t2env_check(
        'memory_limit',
        'PHP 메모리 제한',
        $memory === -1 || $memory >= 128 * 1024 * 1024,
        'warning',
        $memory === -1 ? '메모리 제한이 없습니다.' : '현재 memory_limit=' . (string)ini_get('memory_limit') . '입니다.',
        array('php.ini 또는 호스팅 패널에서 memory_limit을 128M 이상으로 설정하는 것을 권장합니다.')
    );

    return $checks;
}

function t2env_install_mode()
{
    $file = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/mode.php';
    $row = function_exists('t2_private_store_read') ? t2_private_store_read($file, array()) : array();
    return array(
        'core' => is_array($row) && isset($row['core']) && $row['core'] === 'direct' ? 'direct' : 'data',
        'third_party' => is_array($row) && isset($row['third_party']) && $row['third_party'] === 'direct' ? 'direct' : 'data',
    );
}

function t2env_dsclub_api_flags()
{
    $private = rtrim((string)T2EDITOR_PRIVATE_PATH, '/\\');
    $updater = function_exists('t2_private_store_read')
        ? t2_private_store_read($private . '/core-updater/stores.php', array()) : array();
    $market = function_exists('t2_private_store_read')
        ? t2_private_store_read($private . '/third_party_markets.php', array()) : array();
    return array(
        'updater' => !is_array($updater) || !array_key_exists('official_enabled', $updater) || !empty($updater['official_enabled']),
        'third_party' => !is_array($market) || !array_key_exists('official_enabled', $market) || !empty($market['official_enabled']),
    );
}

function t2env_local_status()
{
    $phpOk = version_compare(PHP_VERSION, '7.4.0', '>=');
    $curl = extension_loaded('curl') && t2env_function_available('curl_init');
    $openssl = extension_loaded('openssl');
    $streamTransport = $openssl && t2env_bool_ini('allow_url_fopen');
    $zipArchive = class_exists('ZipArchive');
    $zlibFallback = t2env_function_available('gzinflate');

    $mode = t2env_install_mode();
    $editorProbe = t2env_writable_hint(T2EDITOR_PATH);
    $privateProbe = t2env_writable_hint(T2EDITOR_PRIVATE_PATH);
    $assetsProbe = t2env_writable_hint(rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets');

    $extensionFailures = array();
    if ($mode['third_party'] === 'direct') {
        foreach (array(T2EDITOR_PATH . '/plugin', T2EDITOR_PATH . '/extend/js', T2EDITOR_PATH . '/extend/php', T2EDITOR_PATH . '/locales') as $target) {
            $probe = t2env_writable_hint($target);
            if (empty($probe['ok'])) $extensionFailures[] = $target;
        }
    }
    $privateChild = !empty($privateProbe['ok']) ? array('ok' => true, 'detail' => '공통 비공개 경로에서 자동 생성할 수 있습니다.') : $privateProbe;

    $phpFix = array(
        'PHP 7.4 이상으로 변경하세요. 신규 운영 환경은 PHP 8.1 또는 8.2를 권장합니다.',
        '공유호스팅에서는 호스팅 패널의 PHP 버전 선택 메뉴를 사용하거나 운영사에 변경을 요청하세요.',
    );
    $permissionFix = array(
        '공용 데이터 설치는 T2EDITOR_DB_PATH와 T2EDITOR_PRIVATE_PATH에만 읽기·쓰기·생성·이름 변경·삭제 권한을 부여하세요. 직접 설치를 선택한 경우에만 T2Editor 원본 폴더에도 같은 권한이 필요합니다.',
        'Linux에서는 데이터 경로만 웹서버 사용자 소유로 바꾸거나 setfacl로 rwX 권한을 부여하세요. T2Editor 원본은 읽기 전용으로 유지할 수 있으며 777 권한은 사용하지 마세요.',
        'SELinux 사용 서버는 파일 권한 외에 httpd_sys_rw_content_t 같은 쓰기 컨텍스트도 확인하세요.',
    );

    $updaterChecks = array(
        t2env_check('php_version', 'PHP 버전', $phpOk, 'error', '현재 PHP ' . PHP_VERSION . ' · 최소 PHP 7.4.0', $phpFix),
        t2env_common_function_check(),
        t2env_check(
            'https_transport',
            '외부 HTTPS 다운로드',
            $curl || $streamTransport,
            'error',
            $curl ? 'cURL 전송을 사용할 수 있습니다.' : ($streamTransport ? 'OpenSSL HTTPS 스트림을 사용할 수 있습니다.' : 'cURL도 없고 OpenSSL + allow_url_fopen 조합도 사용할 수 없습니다.'),
            array(
                'Debian/Ubuntu 예시: sudo apt update && sudo apt install php-curl ca-certificates',
                'RHEL/Rocky/Alma 예시: sudo dnf install php-curl ca-certificates',
                'Windows: php.ini에서 extension=curl을 활성화하거나 extension=openssl 및 allow_url_fopen=On을 설정하세요.',
            )
        ),
        t2env_check(
            'archive_reader',
            'ZIP 배포물 처리',
            $zipArchive || $zlibFallback,
            'warning',
            $zipArchive ? 'ZipArchive를 사용할 수 있습니다.' : ($zlibFallback ? '내장 zlib 기반 ZIP 처리로 동작합니다.' : '서버에서 DEFLATE ZIP을 해제할 수 없어 해당 패키지는 관리자 브라우저 폴백을 사용합니다.'),
            array(
                'STORE ZIP은 서버에서 직접 처리하며, DEFLATE ZIP만 브라우저에서 해제한 뒤 서버가 파일별 크기와 CRC를 다시 검사합니다.',
                '성능과 대용량 패키지 안정성을 위해 가능하면 php-zip을 설치하세요.',
            )
        ),
        t2env_check('install_target', $mode['core']==='data'?'공용 데이터 릴리스 경로':'에디터 파일 교체 권한', $mode['core']==='data'?(!empty($privateProbe['ok'])&&!empty($assetsProbe['ok'])):!empty($editorProbe['ok']), 'error', $mode['core']==='data'?($privateProbe['detail'].' / '.$assetsProbe['detail']):$editorProbe['detail'], $permissionFix),
        t2env_check('private_write', '공통 데이터 폴더 쓰기 권한', !empty($privateProbe['ok']), 'error', $privateProbe['detail'], $permissionFix),
        t2env_check('updater_tmp', '업데이트 임시 폴더', !empty($privateChild['ok']), 'error', $privateChild['detail'], $permissionFix),
        t2env_check('updater_backup', '업데이트 복구 백업 폴더', !empty($privateChild['ok']), 'error', $privateChild['detail'], $permissionFix),
    );
    $updaterChecks = array_merge($updaterChecks, t2env_runtime_warning_checks());

    $thirdPartyChecks = array(
        t2env_check('php_version', 'PHP 버전', $phpOk, 'error', '현재 PHP ' . PHP_VERSION . ' · 최소 PHP 7.4.0', $phpFix),
        t2env_common_function_check(),
        t2env_check(
            'curl',
            'cURL 확장',
            $curl,
            'error',
            $curl ? '서드파티 마켓 요청과 패키지 다운로드에 cURL을 사용할 수 있습니다.' : '서드파티 설치 기능은 현재 구현상 cURL 확장이 반드시 필요합니다.',
            array(
                'Debian/Ubuntu 예시: sudo apt update && sudo apt install php-curl ca-certificates',
                'RHEL/Rocky/Alma 예시: sudo dnf install php-curl ca-certificates',
                'Windows: php.ini에서 extension=curl을 활성화하고 curl.cainfo에 최신 CA 인증서 파일 경로를 지정하세요.',
            )
        ),
        t2env_check(
            'archive_reader',
            'ZIP 배포물 처리',
            $zipArchive || $zlibFallback,
            'warning',
            $zipArchive ? 'ZipArchive를 사용할 수 있습니다.' : ($zlibFallback ? '내장 ZIP 파서와 zlib 해제를 사용할 수 있습니다.' : '서버에서 DEFLATE ZIP을 해제할 수 없어 해당 패키지는 관리자 브라우저 폴백을 사용합니다.'),
            array(
                'STORE ZIP은 서버에서 직접 처리하며, DEFLATE ZIP 폴백은 설치 승인을 받은 관리자 화면에서만 실행되고 서버가 원본과 반환 파일을 다시 대조합니다.',
                '성능과 대용량 패키지 안정성을 위해 가능하면 php-zip을 설치하세요.',
            )
        ),
        t2env_check('install_target', $mode['third_party']==='data'?'공용 데이터 확장 슬롯':'에디터 확장 경로 쓰기 권한', $mode['third_party']==='data'?(!empty($privateProbe['ok'])&&!empty($assetsProbe['ok'])):(!empty($editorProbe['ok'])&&!$extensionFailures), 'error', $mode['third_party']==='data'?($privateProbe['detail'].' / '.$assetsProbe['detail']):($extensionFailures?'다음 확장 경로를 만들거나 수정할 수 없습니다: '.implode(', ',$extensionFailures):'plugin, extend, locales 경로에 설치 파일을 반영할 수 있습니다.'), $permissionFix),
        t2env_check('private_write', '공통 데이터 폴더 쓰기 권한', !empty($privateProbe['ok']), 'error', $privateProbe['detail'], $permissionFix),
        t2env_check('third_party_tmp', '서드파티 임시 폴더', !empty($privateChild['ok']), 'error', $privateChild['detail'], $permissionFix),
        t2env_check('third_party_backup', '서드파티 복구 백업 폴더', !empty($privateChild['ok']), 'error', $privateChild['detail'], $permissionFix),
    );
    $thirdPartyChecks = array_merge($thirdPartyChecks, t2env_runtime_warning_checks());

    return array(
        'checked_at' => gmdate('c'),
        'server' => array(
            'php_version' => PHP_VERSION,
            'sapi' => PHP_SAPI,
            'os' => PHP_OS_FAMILY,
            'allow_url_fopen' => t2env_bool_ini('allow_url_fopen'),
            'open_basedir' => (string)ini_get('open_basedir'),
            'editor_path' => T2EDITOR_PATH,
            'private_path' => T2EDITOR_PRIVATE_PATH,
            'data_path' => T2EDITOR_DATA_PATH,
            'db_path' => T2EDITOR_DB_PATH,
            'install_mode' => $mode,
            'environment' => t2editor_detect_cms(T2EDITOR_BASE_PATH),
            'auth_mode' => t2editor_admin_auth_mode(),
        ),
        'features' => array(
            'updater' => t2env_feature('updater', '에디터 업데이트', $updaterChecks),
            'third_party' => t2env_feature('third_party', '서드파티 설치', $thirdPartyChecks),
        ),
        'general_guidance' => array(
            'PHP 확장이나 php.ini 값을 바꾼 뒤에는 sudo systemctl restart php-fpm, apache2 또는 httpd처럼 현재 서버의 PHP-FPM·웹서버 서비스를 재시작해야 반영됩니다.',
            '공유호스팅에서는 PHP 확장, 외부 HTTPS 연결, 파일 소유권을 직접 변경하지 못할 수 있으므로 점검 결과를 호스팅 업체에 전달하세요.',
            '방화벽이나 보안그룹에서는 DNS 조회와 외부 TCP 443 연결을 허용해야 합니다.',
            '운영 서버에서 777 권한, TLS 인증서 검증 비활성화, 방화벽 전체 해제는 사용하지 마세요.',
        ),
    );
}

function t2env_http_probe_curl($url)
{
    if (!extension_loaded('curl') || !t2env_function_available('curl_init')) return array('ok' => false, 'detail' => 'cURL을 사용할 수 없습니다.', 'status' => 0);
    $ch = curl_init($url);
    if ($ch === false) return array('ok' => false, 'detail' => 'cURL 연결을 초기화할 수 없습니다.', 'status' => 0);
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => array('Accept: application/json', 'Accept-Encoding: identity', 'User-Agent: T2Editor-Environment-Check/1.0'),
        CURLOPT_ENCODING => 'identity',
    ));
    $body = curl_exec($ch);
    $error = $body === false ? curl_error($ch) : '';
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if ($body === false) return array('ok' => false, 'detail' => 'HTTPS 연결 실패: ' . ($error !== '' ? $error : '알 수 없는 cURL 오류'), 'status' => $status);
    if ($status < 200 || $status >= 300) return array('ok' => false, 'detail' => '공식 서버가 HTTP ' . $status . '을 반환했습니다.', 'status' => $status);
    $decoded = json_decode((string)$body, true);
    if (!is_array($decoded) || stripos($contentType, 'html') !== false) return array('ok' => false, 'detail' => '공식 서버 응답이 JSON API 형식이 아닙니다.', 'status' => $status);
    return array('ok' => true, 'detail' => '공식 서버에 HTTPS로 연결되고 TLS 인증서와 JSON 응답을 확인했습니다.', 'status' => $status);
}

function t2env_http_probe_stream($url)
{
    if (!extension_loaded('openssl') || !t2env_bool_ini('allow_url_fopen')) return array('ok' => false, 'detail' => 'OpenSSL HTTPS 스트림을 사용할 수 없습니다.', 'status' => 0);
    $context = stream_context_create(array('http' => array(
        'method' => 'GET',
        'timeout' => 8,
        'ignore_errors' => true,
        'follow_location' => 0,
        'header' => "Accept: application/json\r\nAccept-Encoding: identity\r\nUser-Agent: T2Editor-Environment-Check/1.0\r\nConnection: close\r\n",
    ), 'ssl' => array(
        'verify_peer' => true,
        'verify_peer_name' => true,
        'allow_self_signed' => false,
    )));
    $body = @file_get_contents($url, false, $context);
    $headers = isset($http_response_header) && is_array($http_response_header) ? $http_response_header : array();
    $status = 0;
    $contentType = '';
    foreach ($headers as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#i', (string)$line, $m)) $status = (int)$m[1];
        if (stripos((string)$line, 'Content-Type:') === 0) $contentType = trim(substr((string)$line, 13));
    }
    if ($body === false) return array('ok' => false, 'detail' => 'HTTPS 스트림 연결에 실패했습니다. 방화벽, DNS, CA 인증서 또는 open_basedir 설정을 확인하세요.', 'status' => $status);
    if ($status < 200 || $status >= 300) return array('ok' => false, 'detail' => '공식 서버가 HTTP ' . $status . '을 반환했습니다.', 'status' => $status);
    $decoded = json_decode((string)$body, true);
    if (!is_array($decoded) || stripos($contentType, 'html') !== false) return array('ok' => false, 'detail' => '공식 서버 응답이 JSON API 형식이 아닙니다.', 'status' => $status);
    return array('ok' => true, 'detail' => '공식 서버에 HTTPS 스트림으로 연결되고 TLS 인증서와 JSON 응답을 확인했습니다.', 'status' => $status);
}

function t2env_network_fix()
{
    return array(
        '서버 방화벽·클라우드 보안그룹·호스팅 정책에서 외부 TCP 443 연결과 DNS 조회를 허용하세요.',
        'Linux에서는 ca-certificates 패키지를 최신 상태로 유지하세요. Windows에서는 curl.cainfo 또는 openssl.cafile에 CA 번들 경로를 지정하세요.',
        '사내 프록시가 필수인 환경에서는 PHP/cURL이 해당 프록시를 사용하도록 서버 관리자에게 설정을 요청하세요.',
        '공식 서버만 차단된 경우 저장소 도메인(dsclub.kr)이 보안 장비의 허용 목록에 포함되어 있는지 확인하세요.',
    );
}

function t2env_network_status()
{
    $curl = extension_loaded('curl') && t2env_function_available('curl_init');
    $flags = t2env_dsclub_api_flags();
    $disabled = array('ok'=>true,'checked'=>false,'disabled'=>true,'detail'=>'관리자 설정에서 DSc API 연결을 껐습니다. 네트워크 요청을 보내지 않았습니다.','status'=>0,'url_host'=>'dsclub.kr','fixes'=>array());
    $updater = !empty($flags['updater'])
        ? ($curl ? t2env_http_probe_curl(T2ENV_UPDATE_PROBE_URL) : t2env_http_probe_stream(T2ENV_UPDATE_PROBE_URL)) : $disabled;
    $thirdParty = !empty($flags['third_party']) ? t2env_http_probe_curl(T2ENV_THIRD_PARTY_PROBE_URL) : $disabled;
    $fixes = t2env_network_fix();
    if (empty($updater['disabled'])) $updater['checked'] = true;
    $updater['url_host'] = 'dsclub.kr';
    $updater['fixes'] = empty($updater['disabled']) && empty($updater['ok']) ? $fixes : array();
    if (empty($thirdParty['disabled'])) $thirdParty['checked'] = true;
    $thirdParty['url_host'] = 'dsclub.kr';
    $thirdParty['fixes'] = empty($thirdParty['disabled']) && empty($thirdParty['ok']) ? $fixes : array();
    return array('checked_at' => gmdate('c'), 'updater' => $updater, 'third_party' => $thirdParty);
}

if (!t2env_logged_in()) t2env_response(false, null, '관리자 로그인이 필요합니다.', 401);
t2editor_admin_session_unlock();

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
$action = isset($_GET['action']) ? strtolower((string)$_GET['action']) : 'status';
if ($method !== 'GET') t2env_response(false, null, 'GET 요청만 허용됩니다.', 405);

try {
    if ($action === 'status') t2env_response(true, t2env_local_status(), '', 200);
    if ($action === 'network') t2env_response(true, t2env_network_status(), '', 200);
    t2env_response(false, null, '지원하지 않는 진단 작업입니다.', 404);
} catch (Throwable $e) {
    error_log('T2Editor environment diagnostics error: ' . $e->getMessage());
    t2env_response(false, null, '서버 환경 진단 중 오류가 발생했습니다: ' . $e->getMessage(), 500);
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
