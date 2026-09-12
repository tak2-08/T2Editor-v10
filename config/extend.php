<?php
/**
 * T2Editor Extend Bootstrap ABI 2
 *
 * This file is intentionally small and update-agnostic. It resolves the
 * immutable installation root, shared data roots, the selected runtime, and
 * merged Extend/plugin/locale/asset roots. Package management itself lives in
 * the t2pack Extend.
 */

if (!defined('T2_EXTEND_BOOTSTRAP_ABI')) define('T2_EXTEND_BOOTSTRAP_ABI', 2);

require_once __DIR__ . '/t2_storage.php';

// Must run before any T2EDITOR_* path constant is computed below — see
// t2editor_bootstrap_host_cms() in t2_storage.php for why this is needed on
// every request, not only the one that renders the editor skin.
t2editor_bootstrap_host_cms();

/**
 * Shared flock() helper used by every admin endpoint (api.core.php,
 * third_party_api.core.php, update_api.core.php) so that unrelated features
 * pointed at the same lock file are guaranteed mutual exclusion, e.g. a
 * direct-mode core update applying file changes while a third-party
 * plugin/extend/locales package is being installed or removed at the same
 * time under T2EDITOR_PATH.
 */
if (!function_exists('t2_extend_with_file_lock')) {
    function t2_extend_with_file_lock($lockFile, $errorMessage, $callback, $blocking = true)
    {
        $dir = dirname((string)$lockFile);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException('잠금 디렉터리를 만들 수 없습니다: ' . basename($dir));
        }
        @chmod($dir, 0700);
        $lock = @fopen($lockFile, 'c+');
        if ($lock === false) throw new RuntimeException((string)$errorMessage);
        // Long-running operations (core update apply, package download/install)
        // use a non-blocking attempt so a concurrent request fails fast with a
        // clear message instead of tying up a PHP worker for minutes. Quick
        // read-modify-write operations (settings save) block briefly instead
        // so they simply queue up rather than erroring out.
        $acquired = $blocking ? @flock($lock, LOCK_EX) : @flock($lock, LOCK_EX | LOCK_NB);
        if (!$acquired) {
            @fclose($lock);
            throw new RuntimeException((string)$errorMessage);
        }
        try {
            return $callback();
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }
}

if (!function_exists('t2_extend_norm_path')) {
    function t2_extend_norm_path($path)
    {
        $path = str_replace('\\', '/', (string)$path);
        return rtrim($path, '/');
    }
}

if (!function_exists('t2_extend_path_is_inside')) {
    function t2_extend_path_is_inside($path, $root)
    {
        $path = t2_extend_norm_path($path);
        $root = t2_extend_norm_path($root);
        return $path === $root || strncmp($path . '/', $root . '/', strlen($root) + 1) === 0;
    }
}

if (!function_exists('t2_extend_detect_base_url')) {
    function t2_extend_detect_base_url($basePath)
    {
        if (defined('G5_PLUGIN_PATH') && defined('G5_PLUGIN_URL')) {
            $actual = @realpath($basePath);
            $plugin = @realpath(G5_PLUGIN_PATH);
            if ($actual !== false && $plugin !== false && t2_extend_path_is_inside($actual, $plugin)) {
                $suffix = substr(t2_extend_norm_path($actual), strlen(t2_extend_norm_path($plugin)));
                return rtrim((string)G5_PLUGIN_URL, '/') . $suffix;
            }
        }

        $protocol = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') ? 'https://' : 'http://';
        $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : 'localhost';
        if ($host === '' || !preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $host)) $host = 'localhost';
        $docroot = isset($_SERVER['DOCUMENT_ROOT']) ? @realpath((string)$_SERVER['DOCUMENT_ROOT']) : false;
        $actual = @realpath($basePath);
        $relative = '';
        if ($docroot !== false && $actual !== false && t2_extend_path_is_inside($actual, $docroot)) {
            $relative = substr(t2_extend_norm_path($actual), strlen(t2_extend_norm_path($docroot)));
        } else {
            $rawDoc = t2_extend_norm_path(isset($_SERVER['DOCUMENT_ROOT']) ? (string)$_SERVER['DOCUMENT_ROOT'] : '');
            $rawBase = t2_extend_norm_path($basePath);
            if ($rawDoc !== '' && t2_extend_path_is_inside($rawBase, $rawDoc)) $relative = substr($rawBase, strlen($rawDoc));
        }
        if ($relative !== '' && $relative[0] !== '/') $relative = '/' . $relative;
        return $protocol . $host . $relative;
    }
}

if (!function_exists('t2_extend_minimal_config')) {
    function t2_extend_minimal_config($basePath)
    {
        $basePath = t2_extend_norm_path($basePath);
        $baseUrl = defined('T2EDITOR_BASE_URL') ? (string)T2EDITOR_BASE_URL : t2_extend_detect_base_url($basePath);
        if (defined('T2EDITOR_DATA_PATH')) {
            $dataPath = (string)T2EDITOR_DATA_PATH;
        } elseif (defined('G5_DATA_PATH') && defined('G5_PLUGIN_PATH')) {
            $actual = @realpath($basePath);
            $plugin = @realpath(G5_PLUGIN_PATH);
            $dataPath = ($actual !== false && $plugin !== false && t2_extend_path_is_inside($actual, $plugin))
                ? rtrim((string)G5_DATA_PATH, '/\\') . '/editor'
                : $basePath . '/data';
        } else {
            $dataPath = $basePath . '/data';
        }
        if (defined('T2EDITOR_DATA_URL')) {
            $dataUrl = (string)T2EDITOR_DATA_URL;
        } elseif (defined('G5_DATA_URL') && defined('G5_PLUGIN_PATH')) {
            $actual = @realpath($basePath);
            $plugin = @realpath(G5_PLUGIN_PATH);
            $dataUrl = ($actual !== false && $plugin !== false && t2_extend_path_is_inside($actual, $plugin))
                ? rtrim((string)G5_DATA_URL, '/') . '/editor'
                : rtrim($baseUrl, '/') . '/data';
        } else {
            $dataUrl = rtrim($baseUrl, '/') . '/data';
        }
        $dbPath = defined('T2EDITOR_DB_PATH')
            ? (string)T2EDITOR_DB_PATH
            : rtrim($dataPath, '/\\') . '/t2editor_db';
        $dbUrl = defined('T2EDITOR_DB_URL')
            ? (string)T2EDITOR_DB_URL
            : rtrim($dataUrl, '/') . '/t2editor_db';
        $privatePath = defined('T2EDITOR_PRIVATE_PATH')
            ? (string)T2EDITOR_PRIVATE_PATH
            : rtrim($dbPath, '/\\') . '/t2admin-private';
        return array(
            'base_path' => $basePath,
            'base_url' => rtrim($baseUrl, '/'),
            'data_path' => t2_extend_norm_path($dataPath),
            'data_url' => rtrim($dataUrl, '/'),
            'db_path' => t2_extend_norm_path($dbPath),
            'db_url' => rtrim($dbUrl, '/'),
            'private_path' => t2_extend_norm_path($privatePath),
        );
    }
}

$_t2_extend_cfg = t2_extend_minimal_config(dirname(__DIR__));
if (!defined('T2EDITOR_BASE_PATH')) define('T2EDITOR_BASE_PATH', $_t2_extend_cfg['base_path']);
if (!defined('T2EDITOR_BASE_URL')) define('T2EDITOR_BASE_URL', $_t2_extend_cfg['base_url']);
if (!defined('T2EDITOR_DATA_PATH')) define('T2EDITOR_DATA_PATH', $_t2_extend_cfg['data_path']);
if (!defined('T2EDITOR_DATA_URL')) define('T2EDITOR_DATA_URL', $_t2_extend_cfg['data_url']);
if (!defined('T2EDITOR_DB_PATH')) define('T2EDITOR_DB_PATH', $_t2_extend_cfg['db_path']);
if (!defined('T2EDITOR_DB_URL')) define('T2EDITOR_DB_URL', $_t2_extend_cfg['db_url']);
if (!defined('T2EDITOR_PRIVATE_PATH')) define('T2EDITOR_PRIVATE_PATH', $_t2_extend_cfg['private_path']);
if (!defined('T2EDITOR_LEGACY_PRIVATE_PATH')) define('T2EDITOR_LEGACY_PRIVATE_PATH', rtrim(T2EDITOR_DATA_PATH, '/\\') . '/t2admin-private');
if (!defined('T2EDITOR_DIR_PERMISSION')) define('T2EDITOR_DIR_PERMISSION', 0755);
if (!defined('T2EDITOR_FILE_PERMISSION')) define('T2EDITOR_FILE_PERMISSION', 0644);
t2editor_storage_prepare(T2EDITOR_BASE_PATH, T2EDITOR_DATA_PATH, T2EDITOR_DB_PATH, T2EDITOR_PRIVATE_PATH);
unset($_t2_extend_cfg);

require_once T2EDITOR_BASE_PATH . '/config/t2_private_store.php';
t2editor_storage_rewrite_runtime_state(T2EDITOR_DATA_PATH, T2EDITOR_DATA_URL, T2EDITOR_DB_PATH, T2EDITOR_DB_URL, T2EDITOR_PRIVATE_PATH);

if (!function_exists('t2_extend_runtime_file')) {
    function t2_extend_runtime_file()
    {
        return rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/runtime.php';
    }
}

if (!function_exists('t2_extend_t2pack_root')) {
    function t2_extend_t2pack_root()
    {
        return rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack';
    }
}

if (!function_exists('t2_extend_runtime_pointer')) {
    function t2_extend_runtime_pointer()
    {
        $fallback = array(
            'provider' => 'base',
            'release_id' => 'base',
            'runtime_path' => T2EDITOR_BASE_PATH,
            'asset_url' => T2EDITOR_BASE_URL,
            'status' => 'active',
        );
        $row = t2_private_store_read(t2_extend_runtime_file(), null);
        if (!is_array($row) && defined('T2EDITOR_LEGACY_PRIVATE_PATH')) {
            $legacyFile = rtrim((string)T2EDITOR_LEGACY_PRIVATE_PATH, '/\\') . '/runtime.php';
            if (!t2_extend_path_is_inside($legacyFile, T2EDITOR_PRIVATE_PATH)) $row = t2_private_store_read($legacyFile, null);
        }
        if (!is_array($row)) return $fallback;
        $provider = isset($row['provider']) ? (string)$row['provider'] : '';
        $runtime = isset($row['runtime_path']) ? (string)$row['runtime_path'] : '';
        $assetUrl = isset($row['asset_url']) ? rtrim((string)$row['asset_url'], '/') : '';
        $releaseId = isset($row['release_id']) ? (string)$row['release_id'] : '';
        if ($provider === 'base') return $fallback;
        $allowedRoots = array(t2_extend_t2pack_root() . '/releases');
        if (defined('T2EDITOR_LEGACY_PRIVATE_PATH')) $allowedRoots[] = rtrim((string)T2EDITOR_LEGACY_PRIVATE_PATH, '/\\') . '/t2pack/releases';
        $realRuntime = @realpath($runtime);
        $insideAllowed = false;
        if ($realRuntime !== false) {
            foreach ($allowedRoots as $allowedRoot) {
                $realAllowed = @realpath($allowedRoot);
                if ($realAllowed !== false && t2_extend_path_is_inside($realRuntime, $realAllowed)) { $insideAllowed = true; break; }
            }
        }
        if ($realRuntime === false || !$insideAllowed) return $fallback;
        if (!is_file($realRuntime . '/editor.core.php') || !is_file($realRuntime . '/config/t2_config.php')) return $fallback;
        if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', $releaseId)) return $fallback;
        $assetPrefixes = array(rtrim(T2EDITOR_DB_URL, '/') . '/t2pack/assets/');
        $assetPrefixes[] = rtrim(T2EDITOR_DATA_URL, '/') . '/t2pack/assets/';
        $assetAllowed = false;
        foreach (array_unique($assetPrefixes) as $prefix) {
            if ($assetUrl !== '' && strpos($assetUrl, $prefix) === 0) { $assetAllowed = true; break; }
        }
        if (!$assetAllowed) return $fallback;
        $row['runtime_path'] = t2_extend_norm_path($realRuntime);
        $row['asset_url'] = $assetUrl;
        return $row;
    }
}

if (!function_exists('t2_extend_write_runtime_pointer')) {
    function t2_extend_write_runtime_pointer($row)
    {
        $ok = t2_private_store_write(t2_extend_runtime_file(), $row);
        if ($ok) {
            if (function_exists('t2_extend_forget_request_cache')) t2_extend_forget_request_cache();
            unset($GLOBALS['_T2_EXTEND_RUNTIME_POINTER']);
        }
        return $ok;
    }
}

if (!function_exists('t2_extend_active_state_file')) {
    function t2_extend_active_state_file()
    {
        return t2_extend_t2pack_root() . '/active.php';
    }
}

if (!function_exists('t2_extend_health_state_file')) {
    function t2_extend_health_state_file()
    {
        return t2_extend_t2pack_root() . '/health.php';
    }
}

if (!function_exists('t2_extend_pending_shutdown_guard')) {
    function t2_extend_pending_shutdown_guard($pointer)
    {
        if (!is_array($pointer) || (isset($pointer['status']) ? (string)$pointer['status'] : '') !== 'pending') return;
        if (!empty($GLOBALS['_T2_EXTEND_PENDING_GUARD'])) return;
        $GLOBALS['_T2_EXTEND_PENDING_GUARD'] = true;
        register_shutdown_function(function () use ($pointer) {
            $error = error_get_last();
            $fatal = is_array($error) && in_array((int)$error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true);
            if (!$fatal) {
                t2_extend_mark_runtime_success();
                return;
            }
            $activeFile = t2_extend_active_state_file();
            $active = t2_private_store_read($activeFile, array());
            if (!is_array($active)
                || (string)($active['release_id'] ?? '') !== (string)($pointer['release_id'] ?? '')
                || (string)($active['status'] ?? '') !== 'pending') return;
            $active['status'] = 'failed';
            $active['failed_at'] = gmdate('c');
            $active['failure'] = array(
                'type' => (int)$error['type'],
                'message' => substr((string)$error['message'], 0, 800),
                'file' => basename((string)$error['file']),
                'line' => (int)$error['line'],
            );
            t2_private_store_write($activeFile, $active);
            t2_private_store_write(t2_extend_health_state_file(), array(
                'release_id' => (string)($pointer['release_id'] ?? ''),
                'status' => 'failed',
                'checked_at' => gmdate('c'),
                'failure' => $active['failure'],
            ));
            $previous = isset($active['previous']) && is_array($active['previous']) ? $active['previous'] : array();
            if (!empty($previous['runtime_path']) && !empty($previous['asset_url']) && is_file(rtrim((string)$previous['runtime_path'], '/\\') . '/editor.core.php')) {
                $previous['status'] = 'active';
                $previous['provider'] = isset($previous['provider']) ? $previous['provider'] : 't2pack';
                t2_extend_write_runtime_pointer($previous);
            } else {
                t2_extend_write_runtime_pointer(array(
                    'provider'=>'base','release_id'=>'base','runtime_path'=>T2EDITOR_BASE_PATH,
                    'asset_url'=>T2EDITOR_BASE_URL,'status'=>'active','recovered_at'=>gmdate('c'),
                ));
            }
        });
    }
}

if (!function_exists('t2_extend_mark_runtime_success')) {
    function t2_extend_mark_runtime_success()
    {
        $pointer = t2_extend_runtime_pointer();
        if ((string)($pointer['status'] ?? '') !== 'pending' || (string)($pointer['provider'] ?? '') === 'base') return;
        $activeFile = t2_extend_active_state_file();
        $active = t2_private_store_read($activeFile, array());
        if (!is_array($active)
            || (string)($active['release_id'] ?? '') !== (string)($pointer['release_id'] ?? '')
            || (string)($active['status'] ?? '') !== 'pending') return;
        $active['status'] = 'active';
        $active['activated_at'] = gmdate('c');
        unset($active['failure']);
        t2_private_store_write($activeFile, $active);
        t2_private_store_write(t2_extend_health_state_file(), array(
            'release_id' => (string)($pointer['release_id'] ?? ''),
            'status' => 'active',
            'checked_at' => $active['activated_at'],
        ));
        $pointer['status'] = 'active';
        $pointer['activated_at'] = $active['activated_at'];
        t2_extend_write_runtime_pointer($pointer);
    }
}

if (!function_exists('t2_extend_prepare_runtime')) {
    function t2_extend_prepare_runtime()
    {
        $pointer = t2_extend_runtime_pointer();
        if (!defined('T2EDITOR_RUNTIME_PATH')) define('T2EDITOR_RUNTIME_PATH', (string)$pointer['runtime_path']);
        if (!defined('T2EDITOR_RUNTIME_ID')) define('T2EDITOR_RUNTIME_ID', (string)$pointer['release_id']);
        if (!defined('T2EDITOR_ASSET_URL')) define('T2EDITOR_ASSET_URL', rtrim((string)$pointer['asset_url'], '/'));
        if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', T2EDITOR_RUNTIME_PATH);
        if (!defined('T2EDITOR_URL')) define('T2EDITOR_URL', T2EDITOR_BASE_URL);
        t2_extend_pending_shutdown_guard($pointer);
        return $pointer;
    }
}

if (!function_exists('t2_extend_bootstrap_editor')) {
    function t2_extend_bootstrap_editor($entryFile)
    {
        $pointer = t2_extend_prepare_runtime();
        $target = rtrim((string)$pointer['runtime_path'], '/\\') . '/editor.core.php';
        if (!is_file($target) || is_link($target)) {
            $target = T2EDITOR_BASE_PATH . '/editor.core.php';
        }
        if (!is_file($target) || is_link($target)) {
            throw new RuntimeException('T2Editor 런타임 구현 파일(editor.core.php)이 없습니다.');
        }
        if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) define('T2_EXTEND_RUNTIME_INTERNAL', true);
        require $target;
        return true;
    }
}

if (!function_exists('t2_extend_runtime_core_relative')) {
    function t2_extend_runtime_core_relative($relative)
    {
        $relative = ltrim(str_replace('\\', '/', (string)$relative), '/');
        if (!preg_match('/^[A-Za-z0-9._\\/-]+\\.php$/', $relative) || strpos($relative, '..') !== false) return '';
        return substr($relative, 0, -4) . '.core.php';
    }
}

if (!function_exists('t2_extend_endpoint_target')) {
    function t2_extend_endpoint_target($wrapperFile)
    {
        $pointer = t2_extend_prepare_runtime();
        $current = t2_extend_norm_path((string)$wrapperFile);
        $base = t2_extend_norm_path(T2EDITOR_BASE_PATH);
        $runtime = t2_extend_norm_path((string)$pointer['runtime_path']);
        if (t2_extend_path_is_inside($current, $base)) {
            $relative = ltrim(substr($current, strlen($base)), '/');
        } elseif (t2_extend_path_is_inside($current, $runtime)) {
            $relative = ltrim(substr($current, strlen($runtime)), '/');
        } else {
            throw new RuntimeException('T2Editor 엔드포인트 경로가 설치 루트 밖에 있습니다.');
        }
        $coreRelative = t2_extend_runtime_core_relative($relative);
        if ($coreRelative === '') throw new RuntimeException('T2Editor 엔드포인트 경로가 올바르지 않습니다.');
        $target = $runtime . '/' . $coreRelative;
        if (!is_file($target) || is_link($target)) $target = $base . '/' . $coreRelative;
        if (!is_file($target) || is_link($target)) throw new RuntimeException('T2Editor 엔드포인트 구현 파일이 없습니다: ' . basename($coreRelative));
        if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) define('T2_EXTEND_RUNTIME_INTERNAL', true);
        t2_extend_load_php();
        return $target;
    }
}

if (!function_exists('t2_extend_run_endpoint')) {
    function t2_extend_run_endpoint($wrapperFile)
    {
        // Legacy callers still work, but the immutable wrappers for endpoints
        // with top-level state should require t2_extend_endpoint_target() at
        // file scope so included variables remain in the global symbol table.
        require t2_extend_endpoint_target($wrapperFile);
        return true;
    }
}

if (!function_exists('t2_extend_forward_current_file')) {
    function t2_extend_forward_current_file($currentFile)
    {
        return t2_extend_run_endpoint($currentFile);
    }
}

if (!defined('T2_RUNTIME_INDEX_ABI')) define('T2_RUNTIME_INDEX_ABI', 2);

if (!function_exists('t2_extend_cache_root')) {
    function t2_extend_cache_root()
    {
        return t2_extend_t2pack_root() . '/cache';
    }
}

if (!function_exists('t2_extend_runtime_index_file')) {
    function t2_extend_runtime_index_file()
    {
        return t2_extend_cache_root() . '/runtime-index.php';
    }
}

if (!function_exists('t2_extend_registry_file')) {
    function t2_extend_registry_file()
    {
        return rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/third_party_installed.php';
    }
}

if (!function_exists('t2_extend_file_signature')) {
    function t2_extend_file_signature($path)
    {
        if (!is_string($path) || $path === '' || !file_exists($path)) return 'missing';
        $stat = @stat($path);
        if (!is_array($stat)) return 'unknown';
        $hash = @hash_file('sha256', $path);
        return implode(':', array(
            isset($stat['mtime']) ? (string)$stat['mtime'] : '0',
            isset($stat['ctime']) ? (string)$stat['ctime'] : '0',
            isset($stat['size']) ? (string)$stat['size'] : '0',
            isset($stat['ino']) ? (string)$stat['ino'] : '0',
            is_string($hash) ? $hash : 'unhashed',
        ));
    }
}

if (!function_exists('t2_extend_request_scope')) {
    function t2_extend_request_scope()
    {
        if (defined('T2ADMIN_UI') || defined('T2ADMIN_API') || defined('T2ADMIN_THIRD_PARTY_API')) return 'admin';
        $script = str_replace('\\', '/', isset($_SERVER['SCRIPT_FILENAME']) ? (string)$_SERVER['SCRIPT_FILENAME'] : '');
        $scriptName = str_replace('\\', '/', isset($_SERVER['SCRIPT_NAME']) ? (string)$_SERVER['SCRIPT_NAME'] : '');
        if (strpos($script, '/admin/') !== false || strpos($scriptName, '/admin/') !== false) return 'admin';
        $base = t2_extend_norm_path(T2EDITOR_BASE_PATH);
        if ($script !== '' && t2_extend_path_is_inside($script, $base)) {
            $relative = ltrim(substr(t2_extend_norm_path($script), strlen($base)), '/');
            if ($relative !== '' && !in_array($relative, array('editor.lib.php', 'editor.html'), true)) return 'endpoint';
        }
        return 'editor';
    }
}

if (!function_exists('t2_extend_parse_scopes')) {
    function t2_extend_parse_scopes($file)
    {
        $raw = @file_get_contents($file, false, null, 0, 4096);
        if (!is_string($raw) || !preg_match('/@t2-scope\s+([^\r\n*]+)/i', $raw, $m)) {
            return array('bootstrap','editor','admin','endpoint');
        }
        $allowed = array('bootstrap','editor','admin','endpoint');
        $scopes = array();
        foreach (preg_split('/[\s,|]+/', strtolower(trim($m[1]))) as $scope) {
            if (in_array($scope, $allowed, true) && !in_array($scope, $scopes, true)) $scopes[] = $scope;
        }
        return $scopes ? $scopes : $allowed;
    }
}

if (!function_exists('t2_extend_index_valid')) {
    function t2_extend_index_valid($index)
    {
        if (!is_array($index) || (int)($index['abi'] ?? 0) !== T2_RUNTIME_INDEX_ABI) return false;
        if (!defined('T2EDITOR_RUNTIME_ID') || !defined('T2EDITOR_RUNTIME_PATH') || !defined('T2EDITOR_ASSET_URL')) return false;
        if ((string)($index['release_id'] ?? '') !== (string)T2EDITOR_RUNTIME_ID) return false;
        if (t2_extend_norm_path((string)($index['runtime_path'] ?? '')) !== t2_extend_norm_path(T2EDITOR_RUNTIME_PATH)) return false;
        if (rtrim((string)($index['asset_url'] ?? ''), '/') !== rtrim((string)T2EDITOR_ASSET_URL, '/')) return false;
        if ((string)($index['installed_signature'] ?? '') !== t2_extend_file_signature(t2_extend_registry_file())) return false;
        if (isset($index['watched_signatures']) && is_array($index['watched_signatures'])) {
            foreach ($index['watched_signatures'] as $path => $signature) {
                if (t2_extend_file_signature((string)$path) !== (string)$signature) return false;
            }
        }
        return true;
    }
}

if (!function_exists('t2_extend_runtime_index')) {
    function t2_extend_runtime_index()
    {
        if (!empty($GLOBALS['_T2_EXTEND_BUILDING_INDEX'])) return null;
        if (array_key_exists('_T2_EXTEND_RUNTIME_INDEX', $GLOBALS)) return $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'];
        if (!defined('T2EDITOR_RUNTIME_ID')) {
            $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'] = null;
            return null;
        }
        $index = t2_private_store_read(t2_extend_runtime_index_file(), null);
        $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'] = t2_extend_index_valid($index) ? $index : null;
        return $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'];
    }
}

if (!function_exists('t2_extend_forget_request_cache')) {
    function t2_extend_forget_request_cache()
    {
        foreach (array(
            '_T2_EXTEND_RUNTIME_INDEX','_T2_EXTEND_INSTALLED_REGISTRY','_T2_EXTEND_DATA_ROOTS',
            '_T2_EXTEND_PHP_FILES','_T2_EXTEND_PLUGIN_DESCRIPTORS','_T2_EXTEND_ASSET_FILES',
            '_T2_EXTEND_LOCALE_ROOTS'
        ) as $key) unset($GLOBALS[$key]);
        if (function_exists('t2editor_i18n_reset_request_cache')) t2editor_i18n_reset_request_cache();
    }
}

if (!function_exists('t2_extend_installed_registry')) {
    function t2_extend_installed_registry()
    {
        if (isset($GLOBALS['_T2_EXTEND_INSTALLED_REGISTRY']) && is_array($GLOBALS['_T2_EXTEND_INSTALLED_REGISTRY'])) {
            return $GLOBALS['_T2_EXTEND_INSTALLED_REGISTRY'];
        }
        $rows = t2_private_store_read(t2_extend_registry_file(), array());
        $GLOBALS['_T2_EXTEND_INSTALLED_REGISTRY'] = is_array($rows) ? $rows : array();
        return $GLOBALS['_T2_EXTEND_INSTALLED_REGISTRY'];
    }
}

if (!function_exists('t2_extend_dynamic_data_extension_roots')) {
    function t2_extend_dynamic_data_extension_roots($kind)
    {
        $roots = array();
        foreach (t2_extend_installed_registry() as $id => $item) {
            if (!is_array($item) || (string)($item['storage_mode'] ?? '') !== 'data') continue;
            $type = (string)($item['type'] ?? '');
            $private = isset($item['private_path']) ? (string)$item['private_path'] : '';
            $public = isset($item['public_path']) ? (string)$item['public_path'] : '';
            $publicUrl = isset($item['public_url']) ? (string)$item['public_url'] : '';
            if ($kind === 'plugin' && $type === 'plugin' && is_dir($private)) {
                $roots[] = array('id'=>(string)$id,'path'=>$private,'url'=>$publicUrl,'priority'=>30,'source'=>'data');
            } elseif ($kind === 'extend-php' && $type === 'extend-php' && is_dir($private)) {
                $roots[] = array('id'=>(string)$id,'path'=>$private,'url'=>'','priority'=>30,'source'=>'data');
            } elseif ($kind === 'extend-js' && $type === 'extend-js' && is_dir($public)) {
                $roots[] = array('id'=>(string)$id,'path'=>$public,'url'=>$publicUrl,'priority'=>30,'source'=>'data');
            } elseif ($kind === 'locales' && $type === 'locales' && is_dir($private)) {
                $roots[] = array('id'=>(string)$id,'path'=>$private,'url'=>$publicUrl,'priority'=>30,'source'=>'data');
            }
        }
        return $roots;
    }
}

if (!function_exists('t2_extend_data_extension_roots')) {
    function t2_extend_data_extension_roots($kind)
    {
        $kind = (string)$kind;
        if (!isset($GLOBALS['_T2_EXTEND_DATA_ROOTS']) || !is_array($GLOBALS['_T2_EXTEND_DATA_ROOTS'])) {
            $GLOBALS['_T2_EXTEND_DATA_ROOTS'] = array();
        }
        if (array_key_exists($kind, $GLOBALS['_T2_EXTEND_DATA_ROOTS'])) return $GLOBALS['_T2_EXTEND_DATA_ROOTS'][$kind];
        $index = t2_extend_runtime_index();
        if (is_array($index) && isset($index['data_roots'][$kind]) && is_array($index['data_roots'][$kind])) {
            return $GLOBALS['_T2_EXTEND_DATA_ROOTS'][$kind] = $index['data_roots'][$kind];
        }
        return $GLOBALS['_T2_EXTEND_DATA_ROOTS'][$kind] = t2_extend_dynamic_data_extension_roots($kind);
    }
}

if (!function_exists('t2_extend_dynamic_php_files')) {
    function t2_extend_dynamic_php_files()
    {
        $roots = array(array('path'=>T2EDITOR_BASE_PATH . '/extend/php','priority'=>10,'source'=>'base'));
        if (t2_extend_norm_path(T2EDITOR_RUNTIME_PATH) !== t2_extend_norm_path(T2EDITOR_BASE_PATH)) {
            $roots[] = array('path'=>T2EDITOR_RUNTIME_PATH . '/extend/php','priority'=>20,'source'=>'runtime');
        }
        foreach (t2_extend_dynamic_data_extension_roots('extend-php') as $row) $roots[] = $row;
        $override = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/override/extend/php';
        if (is_dir($override)) $roots[] = array('path'=>$override,'priority'=>40,'source'=>'override');
        $selected = array();
        // The first-run gate is part of the immutable installation bootstrap.
        // Never let an older active data release or third-party override replace
        // its server-side status/authentication policy.
        $basePinned = array('t2_first_run_setup.php' => true);
        foreach ($roots as $root) {
            if (!is_dir($root['path'])) continue;
            $files = glob(rtrim($root['path'], '/\\') . '/*.php');
            if (!$files) continue;
            sort($files, SORT_STRING);
            foreach ($files as $file) {
                $name = basename($file);
                if (stripos($name, 'README') === 0) continue;
                if (isset($basePinned[$name]) && (string)$root['source'] !== 'base') continue;
                if (!isset($selected[$name]) || (int)$root['priority'] >= (int)$selected[$name]['priority']) {
                    $selected[$name] = array(
                        'file'=>$file,'priority'=>(int)$root['priority'],'source'=>$root['source'],
                        'scopes'=>t2_extend_parse_scopes($file),
                    );
                }
            }
        }
        ksort($selected, SORT_STRING);
        return array_values($selected);
    }
}

if (!function_exists('t2_extend_php_files')) {
    function t2_extend_php_files($scope = null)
    {
        $scope = is_string($scope) && $scope !== '' ? strtolower($scope) : t2_extend_request_scope();
        $cacheKey = $scope;
        if (isset($GLOBALS['_T2_EXTEND_PHP_FILES'][$cacheKey]) && is_array($GLOBALS['_T2_EXTEND_PHP_FILES'][$cacheKey])) {
            return $GLOBALS['_T2_EXTEND_PHP_FILES'][$cacheKey];
        }
        $index = t2_extend_runtime_index();
        $rows = is_array($index) && isset($index['extend_php']) && is_array($index['extend_php'])
            ? $index['extend_php'] : t2_extend_dynamic_php_files();
        $filtered = array();
        foreach ($rows as $row) {
            if (!is_array($row) || empty($row['file'])) continue;
            $scopes = isset($row['scopes']) && is_array($row['scopes']) ? $row['scopes'] : array('bootstrap','editor','admin','endpoint');
            if (in_array('bootstrap', $scopes, true) || in_array($scope, $scopes, true)) $filtered[] = $row;
        }
        if (!isset($GLOBALS['_T2_EXTEND_PHP_FILES']) || !is_array($GLOBALS['_T2_EXTEND_PHP_FILES'])) $GLOBALS['_T2_EXTEND_PHP_FILES'] = array();
        return $GLOBALS['_T2_EXTEND_PHP_FILES'][$cacheKey] = $filtered;
    }
}

if (!function_exists('t2_extend_load_php')) {
    function t2_extend_load_php($scope = null)
    {
        $scope = is_string($scope) && $scope !== '' ? strtolower($scope) : t2_extend_request_scope();
        if (!isset($GLOBALS['_T2_EXTEND_PHP_LOADED_SCOPES']) || !is_array($GLOBALS['_T2_EXTEND_PHP_LOADED_SCOPES'])) {
            $GLOBALS['_T2_EXTEND_PHP_LOADED_SCOPES'] = array();
        }
        if (!empty($GLOBALS['_T2_EXTEND_PHP_LOADED_SCOPES'][$scope])) return;
        $GLOBALS['_T2_EXTEND_PHP_LOADED_SCOPES'][$scope] = true;
        foreach (t2_extend_php_files($scope) as $row) include_once $row['file'];
    }
}

if (!function_exists('t2_extend_dynamic_plugin_map')) {
    function t2_extend_dynamic_plugin_map($runtimePath = null, $assetUrl = null, $dataRoots = null)
    {
        $runtimePath = $runtimePath !== null ? rtrim((string)$runtimePath, '/\\') : T2EDITOR_RUNTIME_PATH;
        $assetUrl = $assetUrl !== null ? rtrim((string)$assetUrl, '/') : T2EDITOR_ASSET_URL;
        $dataRoots = is_array($dataRoots) ? $dataRoots : t2_extend_dynamic_data_extension_roots('plugin');
        $selected = array();
        $addDir = function ($parent, $url, $priority, $source) use (&$selected) {
            if (!is_dir($parent)) return;
            $entries = @scandir($parent);
            if (!is_array($entries)) return;
            sort($entries, SORT_STRING);
            foreach ($entries as $name) {
                if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', (string)$name)) continue;
                $path = rtrim($parent, '/\\') . '/' . $name;
                if (!is_dir($path) || is_link($path)) continue;
                if (!isset($selected[$name]) || $priority >= (int)$selected[$name]['priority']) {
                    $row = array('id'=>$name,'path'=>$path,'url'=>rtrim($url, '/') . '/' . rawurlencode($name),'priority'=>$priority,'source'=>$source);
                    $manifestFile = $path . '/plugin.json';
                    if (is_file($manifestFile) && filesize($manifestFile) <= 262144) {
                        $manifest = json_decode((string)@file_get_contents($manifestFile), true);
                        if (is_array($manifest)) {
                            $row['autoload'] = !empty($manifest['autoload']);
                            if (isset($manifest['priority']) && is_numeric($manifest['priority'])) $row['autoload_priority'] = (int)$manifest['priority'];
                        }
                    }
                    $selected[$name] = $row;
                }
            }
        };
        $addDir(T2EDITOR_BASE_PATH . '/plugin', rtrim(T2EDITOR_BASE_URL, '/') . '/plugin', 10, 'base');
        if (t2_extend_norm_path($runtimePath) !== t2_extend_norm_path(T2EDITOR_BASE_PATH)) {
            $addDir($runtimePath . '/plugin', $assetUrl . '/plugin', 20, 'runtime');
        }
        foreach ($dataRoots as $row) {
            if (!is_array($row) || empty($row['id']) || empty($row['path']) || !is_dir($row['path'])) continue;
            $name = (string)$row['id'];
            if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $name)) continue;
            $candidate = $row;
            $candidate['priority'] = 30;
            $manifestFile = rtrim((string)$row['path'], '/\\') . '/plugin.json';
            if (is_file($manifestFile) && filesize($manifestFile) <= 262144) {
                $manifest = json_decode((string)@file_get_contents($manifestFile), true);
                if (is_array($manifest)) {
                    $candidate['autoload'] = !empty($manifest['autoload']);
                    if (isset($manifest['priority']) && is_numeric($manifest['priority'])) $candidate['autoload_priority'] = (int)$manifest['priority'];
                }
            }
            $selected[$name] = $candidate;
        }
        ksort($selected, SORT_STRING);
        return $selected;
    }
}

if (!function_exists('t2_extend_plugin_descriptor')) {
    function t2_extend_plugin_descriptor($name)
    {
        $name = (string)$name;
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $name)) return null;
        if (isset($GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS']) && array_key_exists($name, $GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS'])) {
            return $GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS'][$name];
        }
        $index = t2_extend_runtime_index();
        if (is_array($index) && isset($index['plugins']) && is_array($index['plugins'])) {
            $row = isset($index['plugins'][$name]) && is_array($index['plugins'][$name]) ? $index['plugins'][$name] : null;
        } else {
            $map = t2_extend_dynamic_plugin_map();
            $row = isset($map[$name]) ? $map[$name] : null;
        }
        if (!isset($GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS']) || !is_array($GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS'])) $GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS'] = array();
        $GLOBALS['_T2_EXTEND_PLUGIN_DESCRIPTORS'][$name] = $row;
        return $row;
    }
}

if (!function_exists('t2_extend_plugin_index')) {
    function t2_extend_plugin_index()
    {
        $index = t2_extend_runtime_index();
        return is_array($index) && isset($index['plugins']) && is_array($index['plugins'])
            ? $index['plugins'] : t2_extend_dynamic_plugin_map();
    }
}

if (!function_exists('t2_extend_dynamic_asset_files')) {
    function t2_extend_dynamic_asset_files($kind, $runtimePath = null, $assetUrl = null, $dataRoots = null)
    {
        $kind = (string)$kind;
        if (!in_array($kind, array('js','css'), true)) return array();
        $runtimePath = $runtimePath !== null ? rtrim((string)$runtimePath, '/\\') : T2EDITOR_RUNTIME_PATH;
        $assetUrl = $assetUrl !== null ? rtrim((string)$assetUrl, '/') : T2EDITOR_ASSET_URL;
        $roots = array(array('path'=>T2EDITOR_BASE_PATH . '/extend/' . $kind,'url'=>T2EDITOR_BASE_URL . '/extend/' . $kind,'priority'=>10,'source'=>'base'));
        if (t2_extend_norm_path($runtimePath) !== t2_extend_norm_path(T2EDITOR_BASE_PATH)) {
            $roots[] = array('path'=>$runtimePath . '/extend/' . $kind,'url'=>$assetUrl . '/extend/' . $kind,'priority'=>20,'source'=>'runtime');
        }
        $dataRoots = is_array($dataRoots) ? $dataRoots : t2_extend_dynamic_data_extension_roots('extend-' . $kind);
        foreach ($dataRoots as $row) $roots[] = $row;
        $selected = array();
        // Keep the blocking first-run UI on the immutable base revision. An
        // older active data release used to reintroduce the retired password
        // prompt because runtime assets had a higher priority than base assets.
        $basePinned = $kind === 'js' ? array('t2_first_run_guide.js' => true) : array();
        foreach ($roots as $root) {
            if (!is_dir($root['path'])) continue;
            $files = glob(rtrim($root['path'], '/\\') . '/*.' . $kind);
            if (!$files) continue;
            sort($files, SORT_STRING);
            foreach ($files as $file) {
                $name = basename($file);
                if (stripos($name, 'README') === 0) continue;
                if (isset($basePinned[$name]) && (string)$root['source'] !== 'base') continue;
                if (!isset($selected[$name]) || (int)$root['priority'] >= (int)$selected[$name]['priority']) {
                    $selected[$name] = array('file'=>$file,'url'=>rtrim((string)$root['url'], '/') . '/' . rawurlencode($name),'priority'=>(int)$root['priority'],'source'=>$root['source']);
                }
            }
        }
        ksort($selected, SORT_STRING);
        return array_values($selected);
    }
}

if (!function_exists('t2_extend_asset_files')) {
    function t2_extend_asset_files($kind)
    {
        $kind = (string)$kind;
        if (!in_array($kind, array('js','css'), true)) return array();
        if (isset($GLOBALS['_T2_EXTEND_ASSET_FILES'][$kind]) && is_array($GLOBALS['_T2_EXTEND_ASSET_FILES'][$kind])) return $GLOBALS['_T2_EXTEND_ASSET_FILES'][$kind];
        $index = t2_extend_runtime_index();
        $rows = is_array($index) && isset($index['assets'][$kind]) && is_array($index['assets'][$kind])
            ? $index['assets'][$kind] : t2_extend_dynamic_asset_files($kind);
        if (!isset($GLOBALS['_T2_EXTEND_ASSET_FILES']) || !is_array($GLOBALS['_T2_EXTEND_ASSET_FILES'])) $GLOBALS['_T2_EXTEND_ASSET_FILES'] = array();
        return $GLOBALS['_T2_EXTEND_ASSET_FILES'][$kind] = $rows;
    }
}

if (!function_exists('t2_extend_dynamic_locale_roots')) {
    function t2_extend_dynamic_locale_roots($runtimePath = null, $dataRoots = null)
    {
        $runtimePath = $runtimePath !== null ? rtrim((string)$runtimePath, '/\\') : T2EDITOR_RUNTIME_PATH;
        $roots = array();
        $base = T2EDITOR_BASE_PATH . '/locales';
        if (is_dir($base)) $roots[] = array('path'=>$base,'priority'=>10,'source'=>'base');
        $runtime = $runtimePath . '/locales';
        if (is_dir($runtime) && t2_extend_norm_path($runtime) !== t2_extend_norm_path($base)) $roots[] = array('path'=>$runtime,'priority'=>20,'source'=>'runtime');
        $dataRoots = is_array($dataRoots) ? $dataRoots : t2_extend_dynamic_data_extension_roots('locales');
        foreach ($dataRoots as $row) $roots[] = $row;
        return $roots;
    }
}

if (!function_exists('t2_extend_locale_roots')) {
    function t2_extend_locale_roots()
    {
        if (isset($GLOBALS['_T2_EXTEND_LOCALE_ROOTS']) && is_array($GLOBALS['_T2_EXTEND_LOCALE_ROOTS'])) return $GLOBALS['_T2_EXTEND_LOCALE_ROOTS'];
        $index = t2_extend_runtime_index();
        $rows = is_array($index) && isset($index['locale_roots']) && is_array($index['locale_roots'])
            ? $index['locale_roots'] : t2_extend_dynamic_locale_roots();
        return $GLOBALS['_T2_EXTEND_LOCALE_ROOTS'] = $rows;
    }
}

if (!function_exists('t2_extend_build_runtime_index')) {
    function t2_extend_build_runtime_index($pointer = null)
    {
        $pointer = is_array($pointer) ? $pointer : t2_extend_runtime_pointer();
        $runtimePath = rtrim((string)($pointer['runtime_path'] ?? T2EDITOR_BASE_PATH), '/\\');
        $assetUrl = rtrim((string)($pointer['asset_url'] ?? T2EDITOR_BASE_URL), '/');
        $releaseId = (string)($pointer['release_id'] ?? 'base');
        $GLOBALS['_T2_EXTEND_BUILDING_INDEX'] = true;
        t2_extend_forget_request_cache();
        try {
            $dataRoots = array();
            foreach (array('plugin','extend-php','extend-js','extend-css','locales') as $kind) {
                $dataRoots[$kind] = t2_extend_dynamic_data_extension_roots($kind);
            }
            $oldRuntime = defined('T2EDITOR_RUNTIME_PATH') ? T2EDITOR_RUNTIME_PATH : null;
            $oldAsset = defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : null;
            // Build with explicit paths so an updater request may index the newly
            // activated release even though PHP constants still point at the old one.
            $roots = array(array('path'=>T2EDITOR_BASE_PATH . '/extend/php','priority'=>10,'source'=>'base'));
            if (t2_extend_norm_path($runtimePath) !== t2_extend_norm_path(T2EDITOR_BASE_PATH)) $roots[] = array('path'=>$runtimePath . '/extend/php','priority'=>20,'source'=>'runtime');
            foreach ($dataRoots['extend-php'] as $row) $roots[] = $row;
            $override = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/override/extend/php';
            if (is_dir($override)) $roots[] = array('path'=>$override,'priority'=>40,'source'=>'override');
            $selectedPhp = array();
            foreach ($roots as $root) {
                if (!is_dir($root['path'])) continue;
                $files = glob(rtrim($root['path'], '/\\') . '/*.php');
                if (!$files) continue;
                sort($files, SORT_STRING);
                foreach ($files as $file) {
                    $name = basename($file);
                    if (stripos($name, 'README') === 0) continue;
                    if (!isset($selectedPhp[$name]) || (int)$root['priority'] >= (int)$selectedPhp[$name]['priority']) {
                        $selectedPhp[$name] = array('file'=>$file,'priority'=>(int)$root['priority'],'source'=>$root['source'],'scopes'=>t2_extend_parse_scopes($file));
                    }
                }
            }
            ksort($selectedPhp, SORT_STRING);
            $assetsJs = t2_extend_dynamic_asset_files('js', $runtimePath, $assetUrl, $dataRoots['extend-js']);
            $assetsCss = t2_extend_dynamic_asset_files('css', $runtimePath, $assetUrl, $dataRoots['extend-css']);
            $plugins = t2_extend_dynamic_plugin_map($runtimePath, $assetUrl, $dataRoots['plugin']);
            $localeRoots = t2_extend_dynamic_locale_roots($runtimePath, $dataRoots['locales']);
            $watchedSignatures = array();
            foreach (array_values($selectedPhp) as $row) {
                if (in_array((string)($row['source'] ?? ''), array('base','override'), true)) $watchedSignatures[(string)$row['file']] = t2_extend_file_signature((string)$row['file']);
            }
            foreach (array($assetsJs, $assetsCss) as $assetRows) {
                foreach ($assetRows as $row) {
                    if (in_array((string)($row['source'] ?? ''), array('base','override'), true)) {
                        $watchedSignatures[(string)$row['file']] = t2_extend_file_signature((string)$row['file']);
                    }
                }
            }
            foreach (array(
                T2EDITOR_BASE_PATH . '/plugin',
                T2EDITOR_BASE_PATH . '/extend/php',
                T2EDITOR_BASE_PATH . '/extend/js',
                T2EDITOR_BASE_PATH . '/extend/css',
                rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/override/extend/php'
            ) as $watchDirectory) {
                if (is_dir($watchDirectory)) $watchedSignatures[$watchDirectory] = t2_extend_file_signature($watchDirectory);
            }
            // Base installations also use the persistent index. Watch the
            // directories for additions/removals and the metadata/locale files
            // whose contents affect the cached plugin and translation maps.
            foreach ($plugins as $plugin) {
                if (!is_array($plugin) || empty($plugin['path'])
                    || !in_array((string)($plugin['source'] ?? ''), array('base','override'), true)) continue;
                $pluginPath = rtrim((string)$plugin['path'], '/\\');
                $watchedSignatures[$pluginPath] = t2_extend_file_signature($pluginPath);
                $manifest = $pluginPath . '/plugin.json';
                if (is_file($manifest)) $watchedSignatures[$manifest] = t2_extend_file_signature($manifest);
                $pluginLocales = glob($pluginPath . '/locales/*.json');
                if (is_array($pluginLocales)) foreach ($pluginLocales as $file) {
                    $watchedSignatures[$file] = t2_extend_file_signature($file);
                }
            }
            foreach ($localeRoots as $root) {
                if (!is_array($root) || empty($root['path'])
                    || !in_array((string)($root['source'] ?? ''), array('base','override'), true)) continue;
                $localeRoot = rtrim((string)$root['path'], '/\\');
                $watchedSignatures[$localeRoot] = t2_extend_file_signature($localeRoot);
                $localeFiles = glob($localeRoot . '/*.json');
                if (is_array($localeFiles)) foreach ($localeFiles as $file) {
                    $watchedSignatures[$file] = t2_extend_file_signature($file);
                }
            }
            $generation = preg_replace('/[^A-Za-z0-9._-]/', '-', $releaseId) . '-' . substr(hash('sha256', serialize($dataRoots) . '|' . microtime(true)), 0, 12);
            $localePublicPath = rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets/i18n/' . $generation;
            $localePublicUrl = rtrim(T2EDITOR_DB_URL, '/') . '/t2pack/assets/i18n/' . rawurlencode($generation);
            $index = array(
                'abi'=>T2_RUNTIME_INDEX_ABI,
                'bootstrap_abi'=>defined('T2_EXTEND_BOOTSTRAP_ABI') ? T2_EXTEND_BOOTSTRAP_ABI : 0,
                'generated_at'=>gmdate('c'),
                'generation'=>$generation,
                'release_id'=>$releaseId,
                'runtime_path'=>$runtimePath,
                'asset_url'=>$assetUrl,
                'installed_signature'=>t2_extend_file_signature(t2_extend_registry_file()),
                'watched_signatures'=>$watchedSignatures,
                'data_roots'=>$dataRoots,
                'extend_php'=>array_values($selectedPhp),
                'assets'=>array(
                    'js'=>$assetsJs,
                    'css'=>$assetsCss,
                ),
                'plugins'=>$plugins,
                'locale_roots'=>$localeRoots,
                'locale_public_path'=>$localePublicPath,
                'locale_public_url'=>$localePublicUrl,
                'locale_urls'=>array(),
            );
            $dir = t2_extend_cache_root();
            if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('런타임 캐시 디렉터리를 만들 수 없습니다.');
            @chmod($dir, 0700);
            if (!t2_private_store_write(t2_extend_runtime_index_file(), $index)) throw new RuntimeException('런타임 인덱스를 저장하지 못했습니다.');
            $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'] = $index;
            return $index;
        } finally {
            unset($GLOBALS['_T2_EXTEND_BUILDING_INDEX']);
        }
    }
}

if (!function_exists('t2_extend_rebuild_runtime_cache')) {
    function t2_extend_rebuild_runtime_cache($pointer = null, $compileLocales = true)
    {
        $explicitPointer = is_array($pointer);
        $pointer = $explicitPointer ? $pointer : t2_extend_runtime_pointer();
        $releaseId = (string)($pointer['release_id'] ?? 'base');
        $runtimePath = rtrim((string)($pointer['runtime_path'] ?? T2EDITOR_BASE_PATH), '/\\');
        $cacheRoot = t2_extend_cache_root();
        if (!is_dir($cacheRoot) && !@mkdir($cacheRoot, 0700, true) && !is_dir($cacheRoot)) {
            throw new RuntimeException('런타임 캐시 디렉터리를 만들 수 없습니다.');
        }
        @chmod($cacheRoot, 0700);
        $lock = @fopen($cacheRoot . '/runtime-cache.lock', 'c+');
        if ($lock === false || !@flock($lock, LOCK_EX)) {
            if (is_resource($lock)) @fclose($lock);
            throw new RuntimeException('런타임 캐시 잠금을 획득하지 못했습니다.');
        }
        try {
            if (!$explicitPointer) {
                // Re-read under the lock so a concurrent activation cannot
                // leave an index for a release that has already been replaced.
                $pointer = t2_extend_runtime_pointer();
                $releaseId = (string)($pointer['release_id'] ?? 'base');
                $runtimePath = rtrim((string)($pointer['runtime_path'] ?? T2EDITOR_BASE_PATH), '/\\');
            }
            $index = t2_extend_build_runtime_index($pointer);
            $sameRuntime = defined('T2EDITOR_RUNTIME_PATH')
                && t2_extend_norm_path(T2EDITOR_RUNTIME_PATH) === t2_extend_norm_path((string)$index['runtime_path']);
            if ($compileLocales && $sameRuntime && function_exists('t2editor_i18n_ensure_compiled_catalogs')) {
                $compiled = t2editor_i18n_ensure_compiled_catalogs();
                if (!is_array($compiled)) throw new RuntimeException('번역 캐시를 생성하지 못했습니다. 데이터 경로의 쓰기 권한을 확인하세요.');
                $freshIndex = t2_extend_runtime_index();
                if (is_array($freshIndex)) $index = $freshIndex;
            }
            t2_extend_forget_request_cache();
            $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'] = $index;
            return $index;
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }
}

if (!function_exists('t2_extend_invalidate_runtime_cache')) {
    function t2_extend_invalidate_runtime_cache()
    {
        t2_private_store_delete(t2_extend_runtime_index_file());
        t2_extend_forget_request_cache();
    }
}
