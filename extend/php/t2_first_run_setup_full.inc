<?php
// Path: T2Editor/extend/php/t2_first_run_setup_full.inc
// Developer note: @t2-scope와 등록 키는 자동 로더 계약이다. 경로는 T2EDITOR_PATH/데이터 경로 헬퍼로 계산한다.
if (!function_exists('t2_first_run_client_bootstrap')) { http_response_code(404); exit('Not Found'); }

if (!function_exists('t2_first_run_ini_bytes')) {
    function t2_first_run_ini_bytes($value): int
    {
        $value = trim((string)$value);
        if ($value === '' || $value === '-1') return -1;
        $unit = strtolower(substr($value, -1));
        $number = (float)$value;
        if ($unit === 'g') $number *= 1024;
        if ($unit === 'g' || $unit === 'm') $number *= 1024;
        if ($unit === 'g' || $unit === 'm' || $unit === 'k') $number *= 1024;
        return (int)$number;
    }
}

if (!function_exists('t2_first_run_shell_quote')) {
    function t2_first_run_shell_quote(string $value): string
    {
        return "'" . str_replace("'", "'\\''", $value) . "'";
    }
}

if (!function_exists('t2_first_run_ps_quote')) {
    function t2_first_run_ps_quote(string $value): string
    {
        return "'" . str_replace("'", "''", $value) . "'";
    }
}

if (!function_exists('t2_first_run_platform')) {
    function t2_first_run_platform(): string
    {
        return function_exists('t2editor_cms_environment')
            ? t2editor_cms_environment(defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : dirname(dirname(__DIR__)))
            : 'standalone';
    }
}

if (!function_exists('t2_first_run_owner_label')) {
    function t2_first_run_owner_label(string $path): array
    {
        $uid = @fileowner($path);
        $gid = @filegroup($path);
        $user = is_int($uid) ? (string)$uid : '';
        $group = is_int($gid) ? (string)$gid : '';
        if (is_int($uid) && function_exists('posix_getpwuid')) {
            $row = @posix_getpwuid($uid);
            if (is_array($row) && !empty($row['name'])) $user = (string)$row['name'];
        }
        if (is_int($gid) && function_exists('posix_getgrgid')) {
            $row = @posix_getgrgid($gid);
            if (is_array($row) && !empty($row['name'])) $group = (string)$row['name'];
        }
        return array('user' => $user, 'group' => $group);
    }
}

if (!function_exists('t2_first_run_permission')) {
    function t2_first_run_permission(string $path): string
    {
        $mode = @fileperms($path);
        return is_int($mode) ? substr(sprintf('%04o', $mode & 0777), -3) : '';
    }
}

if (!function_exists('t2_first_run_probe_directory')) {
    /**
     * Test the effective PHP account, not only permission metadata. Missing
     * T2Editor-owned descendants are created automatically when their nearest
     * writable parent permits it. The shared data root may itself be a symlink;
     * T2Editor-owned DB/private descendants may not be symlinks.
     */
    function t2_first_run_probe_directory(string $path, int $createMode, bool $allowSymlink = false): array
    {
        $path = rtrim($path, '/\\');
        $result = array('exists' => false, 'writable' => false, 'created' => false, 'error' => '');
        if ($path === '') {
            $result['error'] = '경로가 비어 있습니다.';
            return $result;
        }
        if (!$allowSymlink && is_link($path)) {
            $result['error'] = '심볼릭 링크는 허용되지 않습니다.';
            return $result;
        }
        if (!is_dir($path)) {
            if (!@mkdir($path, $createMode, true) && !is_dir($path)) {
                $result['error'] = '디렉터리를 생성할 수 없습니다.';
                return $result;
            }
            $result['created'] = true;
            @chmod($path, $createMode);
        }
        clearstatcache(true, $path);
        if (!is_dir($path) || (!$allowSymlink && is_link($path))) {
            $result['error'] = '안전한 디렉터리로 확인되지 않았습니다.';
            return $result;
        }
        $result['exists'] = true;
        try {
            $suffix = bin2hex(random_bytes(8));
        } catch (Throwable $e) {
            $suffix = str_replace('.', '', uniqid('', true));
        }
        $probe = $path . '/.t2-first-run-write-' . $suffix;
        $written = @file_put_contents($probe, "ok\n", LOCK_EX);
        if ($written === false) {
            $result['error'] = 'PHP 실행 계정으로 시험 파일을 만들 수 없습니다.';
            return $result;
        }
        @chmod($probe, 0600);
        $removed = @unlink($probe);
        clearstatcache(true, $probe);
        if (!$removed && file_exists($probe)) {
            $result['error'] = '시험 파일을 삭제할 수 없습니다.';
            return $result;
        }
        $result['writable'] = true;
        return $result;
    }
}

if (!function_exists('t2_first_run_version')) {
    function t2_first_run_version(): string
    {
        if (function_exists('get_readme_version')) return get_readme_version();
        $file = dirname(dirname(__DIR__)) . '/readme.txt';
        $raw = is_file($file) ? (string)@file_get_contents($file) : '';
        return preg_match('/ver_([0-9.]+)/', $raw, $m) ? $m[1] : '10.5.1';
    }
}

if (!function_exists('t2_first_run_status_payload')) {
    function t2_first_run_status_payload(bool $forceLocalSetup = false): array
    {
        $root = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : (defined('T2EDITOR_PATH') ? T2EDITOR_PATH : dirname(dirname(__DIR__)));
        $data = defined('T2EDITOR_DATA_PATH') ? T2EDITOR_DATA_PATH : $root . '/data';
        $db = defined('T2EDITOR_DB_PATH') ? T2EDITOR_DB_PATH : $data . '/t2editor_db';
        $private = defined('T2EDITOR_PRIVATE_PATH') ? T2EDITOR_PRIVATE_PATH : $db . '/t2admin-private';
        $key = $root . '/admin/t2admin.key';
        $keyTxt = $root . '/admin/t2admin.key.txt';
        $auth = $private . '/admin_auth.php';
        $settings = $private . '/admin_settings.php';
        $stateFile = t2_first_run_state_file();
        $isWindows = stripos(PHP_OS_FAMILY, 'Windows') !== false;
        $localAuthRequired = $forceLocalSetup || t2editor_admin_requires_local_credentials();

        $keyActive = !$localAuthRequired || is_file($key);

        // Perform a real create/write/delete probe. is_writable() alone may be
        // stale under PHP's stat cache and falsely reports missing descendants
        // as unwritable even when the shared-data parent can create them.
        $dataProbe = t2_first_run_probe_directory($data, 0755, true);
        if (!empty($dataProbe['writable']) && function_exists('t2editor_storage_prepare')) {
            @t2editor_storage_prepare($root, $data, $db, $private);
        }
        $dbProbe = t2_first_run_probe_directory($db, 0755, false);
        $privateProbe = t2_first_run_probe_directory($private, 0700, false);
        clearstatcache();

        $dataExists = !empty($dataProbe['exists']);
        $dataWritable = !empty($dataProbe['writable']);
        $dataPermission = $dataExists ? t2_first_run_permission($data) : '';
        $dataModeOk = $dataWritable;
        $dbWritable = !empty($dbProbe['writable']);
        $privateWritable = !empty($privateProbe['writable']);

        // Read administrator state only after storage preparation so a freshly
        // created private directory is not mistaken for a broken data path.
        $authData = function_exists('t2_private_store_read') ? t2_private_store_read($auth, array()) : array();
        $authReady = !$localAuthRequired || (is_array($authData) && !empty($authData['password_hash']) && !empty($authData['setup_complete']));

        $uploadConfig = function_exists('get_js_config') ? get_js_config() : array();
        $maxMb = isset($uploadConfig['maxSizeMB']) ? (int)$uploadConfig['maxSizeMB'] : 50;
        $uploadLimit = t2_first_run_ini_bytes(ini_get('upload_max_filesize'));
        $postLimit = t2_first_run_ini_bytes(ini_get('post_max_size'));
        $effectiveLimit = ($uploadLimit < 0) ? $postLimit : (($postLimit < 0) ? $uploadLimit : min($uploadLimit, $postLimit));
        $requiredBytes = $maxMb * 1024 * 1024;
        $owner = t2_first_run_owner_label($dataExists ? $data : $root);

        $checks = array(
            array('id' => 'php', 'ok' => version_compare(PHP_VERSION, '7.4.0', '>='), 'severity' => 'error', 'value' => PHP_VERSION),
            array('id' => 'data_permission', 'ok' => $dataModeOk, 'severity' => 'error', 'value' => ($dataPermission !== '' ? $dataPermission : '확인 불가') . ($dataWritable ? ' · 실제 쓰기 성공' : ' · 실제 쓰기 실패')),
            array('id' => 'db_write', 'ok' => $dbWritable, 'severity' => 'error', 'value' => $dbWritable ? '자동 생성/쓰기 가능' : ($dbProbe['error'] !== '' ? $dbProbe['error'] . ' · ' . $db : $db)),
            array('id' => 'private_write', 'ok' => $privateWritable, 'severity' => 'error', 'value' => $privateWritable ? '자동 생성/쓰기 가능' : ($privateProbe['error'] !== '' ? $privateProbe['error'] . ' · ' . $private : $private)),
            array('id' => 'upload_limit', 'ok' => $effectiveLimit < 0 || $effectiveLimit >= $requiredBytes, 'severity' => 'warning', 'value' => $effectiveLimit < 0 ? '무제한' : round($effectiveLimit / 1048576, 1) . ' MB'),
            array('id' => 'curl', 'ok' => extension_loaded('curl'), 'severity' => 'warning', 'value' => extension_loaded('curl') ? '사용' : '사용 안 함'),
            array('id' => 'image', 'ok' => function_exists('getimagesize'), 'severity' => 'warning', 'value' => function_exists('imagewebp') ? '이미지 헤더 + WebP 지원' : (function_exists('getimagesize') ? '이미지 헤더 검사 지원' : '사용 안 함')),
            array('id' => 'admin_key', 'ok' => $keyActive, 'severity' => 'setup', 'value' => !$localAuthRequired ? 'CMS 인증 사용 · 해당 없음' : ($keyActive ? '활성화됨' : (is_file($keyTxt) ? '이름 변경 필요' : '파일 없음'))),
            array('id' => 'admin_auth', 'ok' => $authReady, 'severity' => 'setup', 'value' => !$localAuthRequired ? 'CMS 관리자 로그인 사용' : ($authReady ? '설정 완료' : '관리자 비밀번호 설정 필요')),
        );
        $blocking = 0;
        foreach ($checks as $check) {
            if (empty($check['ok']) && in_array($check['severity'], array('error', 'setup'), true)) $blocking++;
        }

        $shellKeyTxt = t2_first_run_shell_quote($root . '/admin/t2admin.key.txt');
        $shellKey = t2_first_run_shell_quote($root . '/admin/t2admin.key');
        $shellData = t2_first_run_shell_quote($data);
        $linuxCommands = array('# T2Editor detected path: ' . $root);
        if ($localAuthRequired) {
            $linuxCommands[] = 'if [ -f ' . $shellKeyTxt . ' ] && [ ! -f ' . $shellKey . ' ]; then mv -- ' . $shellKeyTxt . ' ' . $shellKey . '; fi';
            $linuxCommands[] = 'chmod 600 ' . $shellKey;
            $linuxCommands[] = 'mkdir -p ' . $shellData;
            $linuxCommands[] = $dataWritable
                ? '# PHP write test already passed: keep the current data-directory permission.'
                : 'chmod 707 ' . $shellData;
        } else {
            $linuxCommands[] = 'mkdir -p ' . t2_first_run_shell_quote($db);
            $linuxCommands[] = $dataWritable
                ? '# CMS data write test already passed: keep the current permission.'
                : '# Write test failed. Start with: chmod 707 ' . $shellData . ' (777 is unnecessary).';
        }

        $psKeyTxt = t2_first_run_ps_quote($root . '\\admin\\t2admin.key.txt');
        $psKey = t2_first_run_ps_quote($root . '\\admin\\t2admin.key');
        $psData = t2_first_run_ps_quote(str_replace('/', '\\', $data));
        $windowsCommands = array('# T2Editor detected path: ' . str_replace('/', '\\', $root));
        if ($localAuthRequired) {
            $windowsCommands[] = 'if ((Test-Path -LiteralPath ' . $psKeyTxt . ') -and -not (Test-Path -LiteralPath ' . $psKey . ')) { Rename-Item -LiteralPath ' . $psKeyTxt . ' -NewName ' . t2_first_run_ps_quote('t2admin.key') . ' }';
            $windowsCommands[] = 'New-Item -ItemType Directory -Force -Path ' . $psData . ' | Out-Null';
            if ($dataWritable) {
                $windowsCommands[] = '# PHP/IIS write test already passed: keep the current ACL.';
            } else {
                $windowsCommands[] = '# 아래 경로에만 PHP/IIS 실행 계정의 Modify 권한을 부여하세요. 전체 제어 권한은 필요하지 않습니다.';
                $windowsCommands[] = 'icacls ' . $psData . ' /grant "IIS_IUSRS:(OI)(CI)M"';
            }
        } else {
            $windowsCommands[] = $dataWritable
                ? '# CMS 데이터 쓰기 시험을 통과했습니다. 현재 ACL을 유지하세요.'
                : '# CMS 데이터 쓰기 시험에 실패했습니다. PHP/IIS 계정에 Modify 권한만 부여하세요.';
        }

        // Mirrors t2_first_run_client_bootstrap(): a stored acknowledgement alone
        // does not keep the guide closed if the admin key was never renamed or the
        // shared data directory permission regressed after the initial setup.
        $required = !t2_first_run_is_acknowledged() || ($localAuthRequired && (!$keyActive || !$authReady)) || !$dataModeOk;

        return array(
            'required' => $required,
            'can_confirm' => $keyActive && $authReady && $dataModeOk && $dbWritable && $privateWritable,
            'version' => t2_first_run_version(),
            'platform' => t2_first_run_platform(),
            'cms_managed' => !$localAuthRequired,
            'server' => array(
                'os' => PHP_OS_FAMILY,
                'sapi' => PHP_SAPI,
                'php' => PHP_VERSION,
                'editor_path' => $root,
                'editor_url' => defined('T2EDITOR_URL') ? T2EDITOR_URL : '',
                'data_path' => $data,
                'db_path' => $db,
                'private_path' => $private,
                'state_file' => $stateFile,
                'owner' => $owner,
                'supported' => $blocking === 0,
            ),
            'permissions' => array(
                'data_exists' => $dataExists,
                'data_writable' => $dataWritable,
                'data_mode' => $dataPermission,
                'data_mode_required' => '최소 권장 707 · 실제 PHP 쓰기 시험 우선',
                'data_mode_ok' => $dataModeOk,
                'db_writable' => $dbWritable,
                'private_writable' => $privateWritable,
                'data_probe_error' => (string)$dataProbe['error'],
                'db_probe_error' => (string)$dbProbe['error'],
                'private_probe_error' => (string)$privateProbe['error'],
            ),
            'admin' => array(
                'key_active' => $keyActive,
                'key_txt_exists' => $localAuthRequired && is_file($keyTxt),
                'auth_ready' => $authReady,
                'auth_mode' => array_merge(t2editor_admin_auth_mode(), $forceLocalSetup ? array(
                    'mode' => 'local',
                    'requires_local_credentials' => true,
                    'forced_local_setup' => true,
                ) : array()),
                'settings_exists' => is_file($settings),
                'admin_url' => (defined('T2EDITOR_URL') ? rtrim(T2EDITOR_URL, '/') : '') . '/admin/' . ($forceLocalSetup ? '?auth=local&setup=1' : ''),
            ),
            'upload' => $uploadConfig,
            'core' => array(
                'migration_mode' => defined('T2_MIGRATION_MODE') ? T2_MIGRATION_MODE : false,
                'video_player' => defined('T2_VIDEO_PLAYER_ENABLED') ? (bool)T2_VIDEO_PLAYER_ENABLED : true,
                'nsfw_enabled' => defined('T2_NSFW_ENABLED') ? (bool)T2_NSFW_ENABLED : false,
                'content_height' => defined('T2EDITOR_CONTENT_HEIGHT') ? (int)T2EDITOR_CONTENT_HEIGHT : 350,
                'plugins' => isset($GLOBALS['T2EDITOR_PLUGINS']) && is_array($GLOBALS['T2EDITOR_PLUGINS']) ? array_values($GLOBALS['T2EDITOR_PLUGINS']) : array(),
            ),
            'checks' => $checks,
            'commands' => array(
                'recommended' => $isWindows ? 'powershell' : 'shell',
                'shell' => implode("\n", $linuxCommands),
                'powershell' => implode("\n", $windowsCommands),
                'ftp_from' => $localAuthRequired ? str_replace('\\', '/', $root . '/admin/t2admin.key.txt') : '',
                'ftp_to' => $localAuthRequired ? str_replace('\\', '/', $root . '/admin/t2admin.key') : '',
                'chmod_path' => str_replace('\\', '/', $data),
            ),
        );
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
