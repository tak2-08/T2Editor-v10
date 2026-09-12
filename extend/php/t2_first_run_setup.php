<?php
// Path: T2Editor/extend/php/t2_first_run_setup.php
// Developer note: @t2-scope와 등록 키는 자동 로더 계약이다. 경로는 T2EDITOR_PATH/데이터 경로 헬퍼로 계산한다.
/**
 * T2Editor first-run installation guide support.
 * Loaded automatically by editor.lib.php through /extend/php.
 * @t2-scope editor,admin,endpoint
 *
 * 스코프 주의: 이 파일은 t2_extend_load_php()가 함수 내부(t2_extend_endpoint_target()
 * 등)에서 include_once로 자동 로드한다. 따라서 여기서 config/t2_cms_auth.php를
 * require하면 그 파일 하단의 "호스트 CMS(예: 그누보드5 common.php)를 진짜
 * 최상위 스코프에서 require"하는 로직이 이 함수 스코프에 갇히고, 이후 각
 * admin/*.core.php·api.core.php가 자기 파일의 진짜 최상위에서 다시
 * require_once해도 "이미 로드됨"으로 스킵되어 근본적인 스코프 보호가 무력화된다
 * (관리자 세션이 항상 "로그인 필요"로 오판되는 원인 — 상세 배경은
 * config/t2_cms_auth.php와 integration/cms/adapters/gnuboard5.php의
 * t2editor_g5_common_path() 주석 참고). 아래 함수들이 쓰는 t2editor_admin_*
 * 헬퍼는 전부 함수 "본문 안"에서 지연 호출되며, 실제 호출 시점에는 각 진입점이
 * 이미 자기 자신의 진짜 최상위에서 config/t2_cms_auth.php를 안전하게 require해
 * 둔 뒤이므로, 이 파일이 스스로 그 파일을 require할 필요가 없다. 여기서는
 * function_exists로만 확인하고 절대 require하지 않는다.
 */

if (!function_exists('t2_first_run_db_path')) {
    function t2_first_run_db_path(): string
    {
        if (defined('T2EDITOR_DB_PATH')) return rtrim((string)T2EDITOR_DB_PATH, '/\\');
        if (defined('T2EDITOR_DATA_PATH')) return rtrim((string)T2EDITOR_DATA_PATH, '/\\') . '/t2editor_db';
        return dirname(dirname(__DIR__)) . '/data/t2editor_db';
    }
}

if (!function_exists('t2_first_run_private_path')) {
    function t2_first_run_private_path(): string
    {
        if (defined('T2EDITOR_PRIVATE_PATH')) return rtrim((string)T2EDITOR_PRIVATE_PATH, '/\\');
        return t2_first_run_db_path() . '/t2admin-private';
    }
}

if (!function_exists('t2_first_run_state_file')) {
    function t2_first_run_state_file(): string
    {
        // The acknowledgement is installation-wide public state (not a secret),
        // so keep it directly below the isolated T2Editor DB root as requested.
        return t2_first_run_db_path() . '/first_run_state.php';
    }
}

if (!function_exists('t2_first_run_legacy_state_file')) {
    function t2_first_run_legacy_state_file(): string
    {
        return t2_first_run_private_path() . '/first_run_state.php';
    }
}

if (!function_exists('t2_first_run_secret_file')) {
    function t2_first_run_secret_file(): string
    {
        return t2_first_run_private_path() . '/first_run_secret.php';
    }
}

if (!function_exists('t2_first_run_write_state_file')) {
    /**
     * Write the public first-run state without chmod'ing T2EDITOR_DB_PATH to 0700.
     * t2_private_store_write() intentionally hardens its parent directory, which
     * is correct for private state but would break public t2pack assets here.
     */
    function t2_first_run_write_state_file(string $file, array $value): bool
    {
        $dir = dirname($file);
        if (is_link($dir) || is_link($file)) return false;
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return false;
        if (!is_writable($dir)) return false;

        try {
            $random = bin2hex(random_bytes(8));
        } catch (Throwable $e) {
            $random = str_replace('.', '', uniqid('', true));
        }
        $tmp = $file . '.tmp.' . $random;
        $payload = "<?php\n"
            . "if (!defined('T2_PRIVATE_STORAGE_INTERNAL')) { http_response_code(404); header('Cache-Control: no-store'); exit('Not Found'); }\n"
            . 'return ' . var_export($value, true) . ";\n";
        if (@file_put_contents($tmp, $payload, LOCK_EX) === false) return false;
        @chmod($tmp, 0600);
        if (!@rename($tmp, $file)) {
            @unlink($tmp);
            return false;
        }
        @chmod($file, 0600);
        clearstatcache(true, $file);
        if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
        if (function_exists('t2_private_store_forget')) t2_private_store_forget($file);
        return true;
    }
}

if (!function_exists('t2_first_run_read_state')) {
    function t2_first_run_read_state(): array
    {
        if (!function_exists('t2_private_store_read')) {
            require_once dirname(dirname(__DIR__)) . '/config/t2_private_store.php';
        }
        $state = t2_private_store_read(t2_first_run_state_file(), array());
        if (is_array($state) && !empty($state['acknowledged'])) return $state;

        // Preserve acknowledgement made by the earlier private-path prototype,
        // then migrate it to the requested t2editor_db root when possible.
        $legacy = t2_private_store_read(t2_first_run_legacy_state_file(), array());
        if (is_array($legacy) && !empty($legacy['acknowledged'])) {
            $legacy['migrated_at'] = gmdate('c');
            t2_first_run_write_state_file(t2_first_run_state_file(), $legacy);
            return $legacy;
        }
        return is_array($state) ? $state : array();
    }
}

if (!function_exists('t2_first_run_is_acknowledged')) {
    function t2_first_run_is_acknowledged(): bool
    {
        $state = t2_first_run_read_state();
        return !empty($state['acknowledged']);
    }
}

if (!function_exists('t2_first_run_quick_data_check')) {
    /**
     * Cheap, read-only usability check for the shared data directory, safe to
     * run on every page load (unlike t2_first_run_probe_directory(), which
     * creates/writes/deletes a probe file and is reserved for the authenticated
     * first-run API). Used so a permission regression after the initial
     * acknowledgement re-opens the install guide when write access is lost.
     */
    function t2_first_run_quick_data_check(string $data): bool
    {
        $data = rtrim($data, '/\\');
        return $data !== '' && !is_link($data) && is_dir($data) && @is_writable($data);
    }
}

if (!function_exists('t2_first_run_mark_duplicate_key_notice')) {
    /**
     * Records that the "delete admin/t2admin.key.txt" one-time notice was
     * already shown, so it is not repeated on every subsequent page load.
     */
    function t2_first_run_mark_duplicate_key_notice(): bool
    {
        $state = t2_first_run_read_state();
        if (!empty($state['dup_key_notice_shown'])) return true;
        $state['dup_key_notice_shown'] = true;
        $state['dup_key_notice_shown_at'] = gmdate('c');
        return t2_first_run_write_state_file(t2_first_run_state_file(), $state);
    }
}

if (!function_exists('t2_first_run_write_acknowledgement')) {
    function t2_first_run_write_acknowledgement(bool $forceLocalSetup = false): bool
    {
        $root = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : dirname(dirname(__DIR__));
        $data = defined('T2EDITOR_DATA_PATH') ? T2EDITOR_DATA_PATH : $root . '/data';
        $mode = @fileperms($data);
        return t2_first_run_write_state_file(t2_first_run_state_file(), array(
            'acknowledged' => true,
            'acknowledged_at' => gmdate('c'),
            'guide_revision' => 3,
            'editor_version' => function_exists('get_readme_version') ? get_readme_version() : '10.5.1',
            'admin_key_active' => (!$forceLocalSetup && !t2editor_admin_requires_local_credentials()) || is_file($root . '/admin/t2admin.key'),
            'admin_setup_complete' => true,
            'local_setup_requested' => $forceLocalSetup,
            'data_path' => str_replace('\\', '/', (string)$data),
            'data_permission' => is_int($mode) ? substr(sprintf('%04o', $mode & 0777), -3) : '',
            'read_complete' => true,
        ));
    }
}

if (!function_exists('t2_first_run_get_secret')) {
    function t2_first_run_get_secret(): string
    {
        if (!function_exists('t2_private_store_read') || !function_exists('t2_private_store_write')) {
            require_once dirname(dirname(__DIR__)) . '/config/t2_private_store.php';
        }
        $file = t2_first_run_secret_file();
        $secret = t2_private_store_read($file, '');
        if (is_string($secret) && preg_match('/^[a-f0-9]{64}$/', $secret)) return $secret;

        try {
            $secret = bin2hex(random_bytes(32));
        } catch (Throwable $e) {
            $secret = hash('sha256', __FILE__ . '|' . microtime(true) . '|' . mt_rand());
        }
        if (t2_private_store_write($file, $secret)) return $secret;

        // The guide must still open before data permissions are fixed, because
        // it contains the exact server-specific command needed to fix them.
        $root = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : (defined('T2EDITOR_PATH') ? T2EDITOR_PATH : dirname(dirname(__DIR__)));
        $keyCandidate = is_file($root . '/admin/t2admin.key')
            ? $root . '/admin/t2admin.key'
            : $root . '/admin/t2admin.key.txt';
        $keyHash = is_file($keyCandidate) ? (string)@hash_file('sha256', $keyCandidate) : '';
        $host = function_exists('php_uname') ? (string)@php_uname('n') : '';
        return hash('sha256', 'T2Editor:first-run:fallback:v2|' . $root . '|' . $host . '|' . $keyHash);
    }
}

if (!function_exists('t2_first_run_b64url_encode')) {
    function t2_first_run_b64url_encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}

if (!function_exists('t2_first_run_b64url_decode')) {
    function t2_first_run_b64url_decode(string $value): string
    {
        $padding = strlen($value) % 4;
        if ($padding) $value .= str_repeat('=', 4 - $padding);
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        return is_string($decoded) ? $decoded : '';
    }
}

if (!function_exists('t2_first_run_issue_token')) {
    function t2_first_run_issue_token(int $ttl = 3600): string
    {
        $secret = t2_first_run_get_secret();
        if ($secret === '') return '';
        try {
            $nonce = bin2hex(random_bytes(12));
        } catch (Throwable $e) {
            $nonce = substr(hash('sha256', microtime(true) . '|' . mt_rand()), 0, 24);
        }
        $payload = json_encode(array(
            'exp' => time() + max(300, min(7200, $ttl)),
            'nonce' => $nonce,
        ), JSON_UNESCAPED_SLASHES);
        $encoded = t2_first_run_b64url_encode((string)$payload);
        return $encoded . '.' . hash_hmac('sha256', $encoded, $secret);
    }
}

if (!function_exists('t2_first_run_validate_token')) {
    function t2_first_run_validate_token(string $token): bool
    {
        if (!preg_match('/^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/', $token, $matches)) return false;
        $secret = t2_first_run_get_secret();
        if ($secret === '') return false;
        $expected = hash_hmac('sha256', $matches[1], $secret);
        if (!hash_equals($expected, $matches[2])) return false;
        $payload = json_decode(t2_first_run_b64url_decode($matches[1]), true);
        return is_array($payload) && isset($payload['exp']) && (int)$payload['exp'] >= time();
    }
}

if (!function_exists('t2_first_run_local_auth_ready')) {
    function t2_first_run_local_auth_ready(string $root = ''): bool
    {
        if ($root === '') $root = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : dirname(dirname(__DIR__));
        $private = defined('T2EDITOR_PRIVATE_PATH') ? rtrim((string)T2EDITOR_PRIVATE_PATH, '/\\') : t2_first_run_private_path();
        $file = $private . '/admin_auth.php';
        if (!is_file($file)) return false;
        if (!function_exists('t2_private_store_read')) require_once dirname(dirname(__DIR__)) . '/config/t2_private_store.php';
        $auth = t2_private_store_read($file, array());
        return is_array($auth) && !empty($auth['password_hash']) && !empty($auth['setup_complete']);
    }
}

if (!function_exists('t2_first_run_client_bootstrap')) {
    function t2_first_run_client_bootstrap(bool $forceLocalSetup = false): array
    {
        $rootUrl = defined('T2EDITOR_URL') ? rtrim(T2EDITOR_URL, '/') : '';
        $root = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : (defined('T2EDITOR_PATH') ? T2EDITOR_PATH : dirname(dirname(__DIR__)));
        $data = defined('T2EDITOR_DATA_PATH') ? T2EDITOR_DATA_PATH : $root . '/data';

        $state = t2_first_run_read_state();
        $acknowledged = !empty($state['acknowledged']);
        $localAuthRequired = $forceLocalSetup || t2editor_admin_requires_local_credentials();
        $keyActive = !$localAuthRequired || is_file($root . '/admin/t2admin.key');
        $keyTxtExists = $localAuthRequired && is_file($root . '/admin/t2admin.key.txt');
        $authReady = !$localAuthRequired || t2_first_run_local_auth_ready($root);
        $dataUsable = t2_first_run_quick_data_check($data);

        // Explicit local setup in a CMS must not inherit the CMS-only acknowledgement.
        $required = !$acknowledged || ($localAuthRequired && (!$keyActive || !$authReady)) || !$dataUsable;

        // When everything else is fine but the leftover t2admin.key.txt still sits
        // next to the active t2admin.key, skip the full guide and instead surface a
        // short one-time reminder to delete the leftover file.
        $dupNotice = $localAuthRequired && $acknowledged && !$required && $keyTxtExists && empty($state['dup_key_notice_shown']);

        return array(
            'required' => $required,
            'endpoint' => $rootUrl . '/config/first_run_api.php' . ($forceLocalSetup ? '?mode=local' : ''),
            'locale' => 'ko',
            'token' => ($required || $dupNotice) ? t2_first_run_issue_token(7200) : '',
            'guide_revision' => 3,
            'duplicate_key_notice' => $dupNotice,
            'auth_mode' => array_merge(t2editor_admin_auth_mode(), $forceLocalSetup ? array(
                'mode' => 'local',
                'requires_local_credentials' => true,
                'forced_local_setup' => true,
            ) : array()),
            'forced_local_setup' => $forceLocalSetup,
        );
    }
}

// Detailed diagnostics are only needed by the authenticated first-run API.
$_t2_first_run_script = str_replace('\\', '/', isset($_SERVER['SCRIPT_FILENAME']) ? (string)$_SERVER['SCRIPT_FILENAME'] : '');
if (basename($_t2_first_run_script) === 'first_run_api.php') {
    require_once __DIR__ . '/t2_first_run_setup_full.inc';
}
unset($_t2_first_run_script);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
