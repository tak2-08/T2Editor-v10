<?php
/**
 * Shared-data layout and one-time migration helpers (PHP 7.4+).
 *
 * Media payloads owned by plugin/image, plugin/file, plugin/video and
 * plugin/draw stay directly below T2EDITOR_DATA_PATH for URL compatibility.
 * All other mutable T2Editor state belongs below T2EDITOR_DB_PATH.
 */

if (!function_exists('t2editor_bootstrap_host_cms_url_base')) {
    /**
     * Same "protocol + host + docroot-relative path" derivation T2Editor
     * already uses for its own BASIC-SYSTEM URL (see t2_config.php / the
     * fallback branch of config/extend.php's t2_extend_detect_base_url()),
     * applied here to an arbitrary filesystem root instead of T2Editor's own
     * install path. Pure string/path math — no file I/O beyond realpath().
     */
    function t2editor_bootstrap_host_cms_url_base(string $rootPath): string
    {
        $protocol = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') ? 'https://' : 'http://';
        $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : 'localhost';
        if ($host === '' || !preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $host)) $host = 'localhost';

        $docroot = isset($_SERVER['DOCUMENT_ROOT']) ? @realpath((string)$_SERVER['DOCUMENT_ROOT']) : false;
        $real = @realpath($rootPath);
        $relative = '';
        if ($docroot !== false && $real !== false) {
            $normRoot = rtrim(str_replace('\\', '/', $real), '/');
            $normDoc = rtrim(str_replace('\\', '/', $docroot), '/');
            if (strncmp($normRoot . '/', $normDoc . '/', strlen($normDoc) + 1) === 0 || $normRoot === $normDoc) {
                $relative = substr($normRoot, strlen($normDoc));
            }
        }
        if ($relative !== '' && $relative[0] !== '/') $relative = '/' . $relative;
        return $protocol . $host . $relative;
    }
}

if (!function_exists('t2editor_bootstrap_host_cms')) {
    /**
     * Detect a Gnuboard5 install rooted above T2Editor's own directory and
     * define the shared-path constants T2Editor's own path resolution reads
     * (G5_DATA_PATH / G5_PLUGIN_PATH / G5_DATA_URL / G5_PLUGIN_URL) — without
     * ever executing Gnuboard5's own common.php.
     *
     * Only the very first request that renders the editor skin inline inside
     * an already-running Gnuboard5 page gets _GNUBOARD_ (and therefore these
     * G5_* constants) "for free", because Gnuboard5's own bbs/write.php
     * already included common.php before the skin runs. Every other
     * T2Editor endpoint (config/first_run_api.php, config/*.php, admin, or
     * any plugin sub-file when hit directly by the browser) is a brand-new
     * PHP process that never goes through bbs/write.php, so without this the
     * data path silently falls back to T2Editor's own bundled /data folder
     * instead of G5_DATA_PATH/editor — and any per-request secret (e.g. the
     * first-run install token) stops matching the one issued during the
     * original page render, since the two requests end up reading/writing
     * different files.
     *
     * common.php is deliberately never include()'d here: it runs a full
     * session/DB/redirect bootstrap meant to happen exactly once per
     * request from Gnuboard5's own front files, and executing that out of
     * context from a JSON/API endpoint can itself fail (observed as an
     * HTTP 500). G5_DATA_PATH ('/data') and G5_PLUGIN_PATH ('/plugin') are a
     * fixed, non-configurable layout in stock Gnuboard5 — deriving them
     * directly from the detected root is both safe and sufficient for what
     * T2Editor's own config resolution needs.
     *
     * Rhymix is intentionally left untouched here: it has no equivalent
     * fixed, includable layout, and T2Editor already treats Rhymix as BASIC
     * SYSTEM by design (see t2_config.php), delegating uploads to the
     * Rhymix file module rather than relying on RX_BASEDIR-derived paths.
     */
    function t2editor_bootstrap_host_cms(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;

        // Already bootstrapped — either the host framework's own front
        // controller ran first, or an earlier call in this request already
        // handled it.
        if (defined('_GNUBOARD_') || defined('G5_PATH') || defined('RX_BASEDIR')) return;

        $path = @realpath(dirname(__DIR__));
        if ($path === false) $path = dirname(__DIR__);

        // Walk upward from T2Editor's own root looking for Gnuboard5's
        // install markers. A bare "common.php exists" check is not enough —
        // a standalone install placed a few directories below some unrelated
        // common.php would be misdetected as a Gnuboard5 plugin. Requiring
        // lib/common.lib.php + adm/ alongside it (same markers used by the
        // admin API's environment detector) avoids that false positive, and
        // the loop stops as soon as it reaches the filesystem root.
        for ($i = 0; $i < 8; $i++) {
            if (is_file($path . '/common.php')
                && is_file($path . '/lib/common.lib.php')
                && is_dir($path . '/adm')
            ) {
                if (!defined('G5_PATH')) define('G5_PATH', $path);
                if (!defined('G5_DATA_PATH')) define('G5_DATA_PATH', $path . '/data');
                if (!defined('G5_PLUGIN_PATH')) define('G5_PLUGIN_PATH', $path . '/plugin');
                if (!defined('G5_URL')) {
                    $base = t2editor_bootstrap_host_cms_url_base($path);
                    define('G5_URL', $base);
                    if (!defined('G5_DATA_URL')) define('G5_DATA_URL', $base . '/data');
                    if (!defined('G5_PLUGIN_URL')) define('G5_PLUGIN_URL', $base . '/plugin');
                }
                return;
            }
            $parent = dirname($path);
            if ($parent === $path) break;
            $path = $parent;
        }
    }
}

if (!function_exists('t2editor_storage_normalize_path')) {
    function t2editor_storage_normalize_path($path)
    {
        return rtrim(str_replace('\\', '/', (string)$path), '/');
    }
}

if (!function_exists('t2editor_storage_same_path')) {
    function t2editor_storage_same_path($left, $right)
    {
        return t2editor_storage_normalize_path($left) === t2editor_storage_normalize_path($right);
    }
}

if (!function_exists('t2editor_storage_mkdir')) {
    function t2editor_storage_mkdir($path, $mode)
    {
        // Never accept a symlink as a writable storage directory. The configured
        // shared-data parent itself may be a symlink, but every T2Editor-owned
        // directory passed here must resolve from a real directory entry.
        if (is_link($path)) return false;
        if (!is_dir($path) && !@mkdir($path, $mode, true) && !is_dir($path)) return false;
        @chmod($path, $mode);
        return true;
    }
}

if (!function_exists('t2editor_storage_merge_tree')) {
    /**
     * Move a legacy tree into its new home without overwriting newer files.
     * Symlinks are never followed or copied. Conflicting legacy files are
     * preserved beside the newer target with a content-derived suffix.
     */
    function t2editor_storage_merge_tree($source, $target, $dirMode = 0700)
    {
        if (t2editor_storage_same_path($source, $target) || (!file_exists($source) && !is_link($source))) return true;
        if (is_link($source) || is_link($target)) return false;
        if (!is_dir($source)) return true;
        if (!file_exists($target) && @rename($source, $target)) {
            @chmod($target, $dirMode);
            return true;
        }
        if (!t2editor_storage_mkdir($target, $dirMode)) return false;
        $items = @scandir($source);
        if (!is_array($items)) return false;
        $ok = true;
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $from = rtrim($source, '/\\') . '/' . $item;
            $to = rtrim($target, '/\\') . '/' . $item;
            if (is_link($from) || is_link($to)) {
                $ok = false;
                continue;
            }
            if (is_dir($from)) {
                if (file_exists($to) && !is_dir($to)) {
                    $conflict = $to . '.legacy-dir-' . substr(hash('sha256', $from), 0, 16);
                    if (!file_exists($conflict) && @rename($from, $conflict)) {
                        @chmod($conflict, $dirMode);
                    } else {
                        $ok = false;
                    }
                    continue;
                }
                if (!t2editor_storage_merge_tree($from, $to, $dirMode)) $ok = false;
                @rmdir($from);
                continue;
            }
            if (!is_file($from)) continue;
            if (!file_exists($to)) {
                $parent = dirname($to);
                if (!t2editor_storage_mkdir($parent, $dirMode) || !@rename($from, $to)) {
                    if (!@copy($from, $to)) {
                        $ok = false;
                        continue;
                    }
                    @unlink($from);
                }
                continue;
            }

            // Preserve both versions inside the isolated DB tree. Identical
            // legacy copies are removed; differing copies receive a stable
            // suffix and never overwrite the newer target.
            $fromHash = @hash_file('sha256', $from);
            $toHash = is_file($to) ? @hash_file('sha256', $to) : false;
            if (is_string($fromHash) && is_string($toHash) && hash_equals($toHash, $fromHash)) {
                @unlink($from);
                continue;
            }
            $suffix = is_string($fromHash) && $fromHash !== '' ? substr($fromHash, 0, 16) : substr(hash('sha256', $from), 0, 16);
            $conflict = $to . '.legacy-' . $suffix;
            if (is_file($conflict) && is_string($fromHash)) {
                $conflictHash = @hash_file('sha256', $conflict);
                if (is_string($conflictHash) && hash_equals($conflictHash, $fromHash)) {
                    @unlink($from);
                    continue;
                }
            }
            if (!file_exists($conflict)) {
                if (!@rename($from, $conflict)) {
                    if (!@copy($from, $conflict)) {
                        $ok = false;
                        continue;
                    }
                    @unlink($from);
                }
                @chmod($conflict, 0600);
            } else {
                $ok = false;
            }
        }
        @rmdir($source);
        return $ok;
    }
}

if (!function_exists('t2editor_storage_migrate_file')) {
    function t2editor_storage_migrate_file($source, $target, $dirMode = 0700, $fileMode = 0600)
    {
        if (t2editor_storage_same_path($source, $target) || (!file_exists($source) && !is_link($source))) return true;
        if (is_link($source) || is_link($target)) return false;
        if (!is_file($source)) return true;
        if (!t2editor_storage_mkdir(dirname($target), $dirMode)) return false;
        if (file_exists($target)) {
            $sourceHash = @hash_file('sha256', $source);
            $targetHash = is_file($target) ? @hash_file('sha256', $target) : false;
            if (is_string($sourceHash) && is_string($targetHash) && hash_equals($targetHash, $sourceHash)) {
                return @unlink($source) || !file_exists($source);
            }
            $suffix = is_string($sourceHash) && $sourceHash !== '' ? substr($sourceHash, 0, 16) : substr(hash('sha256', $source), 0, 16);
            $conflict = $target . '.legacy-' . $suffix;
            if (is_file($conflict) && is_string($sourceHash)) {
                $conflictHash = @hash_file('sha256', $conflict);
                if (is_string($conflictHash) && hash_equals($conflictHash, $sourceHash)) {
                    return @unlink($source) || !file_exists($source);
                }
            }
            if (file_exists($conflict)) return false;
            if (!@rename($source, $conflict)) {
                if (!@copy($source, $conflict)) return false;
                @unlink($source);
            }
            @chmod($conflict, $fileMode);
            return true;
        }
        if (!@rename($source, $target)) {
            if (!@copy($source, $target)) return false;
            @unlink($source);
        }
        @chmod($target, $fileMode);
        return true;
    }
}

if (!function_exists('t2editor_storage_remove_managed_asset_php_guard')) {
    function t2editor_storage_remove_managed_asset_php_guard($assetRoot)
    {
        $file = rtrim($assetRoot, '/\\') . '/index.php';
        if (!is_file($file) || is_link($file)) return;
        $raw = (string)@file_get_contents($file);
        $compact = preg_replace('/\s+/', '', $raw);
        $managed = strpos($compact, "http_response_code(404);exit('NotFound');") !== false
            || strpos($compact, 'http_response_code(404);exit("NotFound");') !== false;
        // Previous T2Editor releases generated exactly this tiny 404 guard.
        if ($managed || hash('sha256', $raw) === 'd0dd1f939ee0daae6a7e9fad858dcec3e9849294a60c80823829391458abad42') {
            @unlink($file);
        }
    }
}


if (!function_exists('t2editor_storage_remove_executable_assets')) {
    function t2editor_storage_remove_executable_assets($root)
    {
        if (!is_dir($root) || is_link($root)) return;
        $items = @scandir($root);
        if (!is_array($items)) return;
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = rtrim($root, '/\\') . '/' . $item;
            if (is_link($path)) continue;
            if (is_dir($path)) {
                t2editor_storage_remove_executable_assets($path);
                continue;
            }
            if (!is_file($path)) continue;
            if (preg_match('/\.(?:php[0-9]*|phtml|phtm?|phar)$/i', $item)) @unlink($path);
        }
    }
}

if (!function_exists('t2editor_storage_write_public_guards')) {
    function t2editor_storage_write_public_guards($root)
    {
        if (!t2editor_storage_mkdir($root, 0755)) return false;
        $htaccess = rtrim($root, '/\\') . '/.htaccess';
        $rules = "Options -Indexes\n<FilesMatch \"\\.(?:php[0-9]*|phtml|phtm?|phar)$\">\nRequire all denied\nDeny from all\n</FilesMatch>\n";
        if (!is_file($htaccess)) @file_put_contents($htaccess, $rules, LOCK_EX);
        $index = rtrim($root, '/\\') . '/index.html';
        if (!is_file($index)) @file_put_contents($index, "<!doctype html><meta charset=\"utf-8\"><title>Not Found</title>\n", LOCK_EX);
        @chmod($htaccess, 0644);
        @chmod($index, 0644);
        return true;
    }
}

if (!function_exists('t2editor_storage_has_legacy_state')) {
    function t2editor_storage_has_legacy_state($basePath, $dataPath)
    {
        $basePath = rtrim((string)$basePath, '/\\');
        $dataPath = rtrim((string)$dataPath, '/\\');
        foreach (array(
            $dataPath . '/t2admin-private',
            $dataPath . '/collab',
            $basePath . '/collab',
            $dataPath . '/t2pack',
            $dataPath . '/webrtc_turn_config.json',
            $dataPath . '/rate_limits.json',
            $dataPath . '/limits.json',
        ) as $legacy) {
            if (file_exists($legacy) || is_link($legacy)) return true;
        }
        return false;
    }
}

if (!function_exists('t2editor_storage_prepare')) {
    /**
     * Prepare the isolated DB tree and migrate known pre-isolation locations.
     * The lock prevents concurrent first requests from moving the same files.
     */
    function t2editor_storage_prepare($basePath, $dataPath, $dbPath, $privatePath = '')
    {
        $basePath = rtrim((string)$basePath, '/\\');
        $dataPath = rtrim((string)$dataPath, '/\\');
        $dbPath = rtrim((string)$dbPath, '/\\');
        if ($basePath === '' || $dataPath === '' || $dbPath === '') return false;
        // The CMS may deliberately expose its configured shared-data root via a
        // symlink. Accept that parent only when it already resolves to a directory;
        // T2Editor-owned descendants are still rejected when they are symlinks.
        $dataReady = is_dir($dataPath) ? true : t2editor_storage_mkdir($dataPath, 0755);
        if (!$dataReady || !t2editor_storage_write_public_guards($dbPath)) return false;

        $private = $privatePath !== '' ? rtrim((string)$privatePath, '/\\') : $dbPath . '/t2admin-private';
        if (!t2editor_storage_mkdir($private, 0700)) return false;
        $marker = $private . '/storage-layout-v2';
        $legacyPending = t2editor_storage_has_legacy_state($basePath, $dataPath);
        if (is_file($marker) && !$legacyPending) {
            // Fast path after the one-time migration. Asset publishing also
            // enforces the executable-file rule, so a recursive scan is not
            // repeated on every editor request.
            return t2editor_storage_write_public_guards($dbPath);
        }

        $lock = @fopen($private . '/storage-migration.lock', 'c+');
        if ($lock === false) return false;
        if (!@flock($lock, LOCK_EX)) {
            @fclose($lock);
            return false;
        }
        try {
            // Another concurrent request may have completed while this process
            // was waiting for the migration lock.
            $legacyPending = t2editor_storage_has_legacy_state($basePath, $dataPath);
            if (is_file($marker) && !$legacyPending) return t2editor_storage_write_public_guards($dbPath);

            $ok = true;
            $ok = t2editor_storage_merge_tree($dataPath . '/t2admin-private', $private, 0700) && $ok;
            $ok = t2editor_storage_merge_tree($dataPath . '/collab', $dbPath . '/collab', 0750) && $ok;
            $ok = t2editor_storage_merge_tree($basePath . '/collab', $dbPath . '/collab', 0750) && $ok;
            $ok = t2editor_storage_merge_tree($dataPath . '/t2pack', $dbPath . '/t2pack', 0755) && $ok;
            $ok = t2editor_storage_migrate_file($dataPath . '/webrtc_turn_config.json', $dbPath . '/webrtc_turn_config.json', 0700, 0600) && $ok;
            $ok = t2editor_storage_migrate_file($dataPath . '/rate_limits.json', $dbPath . '/ai_complex/rate_limits.json', 0700, 0600) && $ok;
            $ok = t2editor_storage_migrate_file($dataPath . '/limits.json', $dbPath . '/ai_complex/limits.json', 0700, 0600) && $ok;

            $ok = t2editor_storage_write_public_guards($dbPath) && $ok;
            t2editor_storage_remove_managed_asset_php_guard($dataPath . '/t2pack/assets');
            t2editor_storage_remove_managed_asset_php_guard($dbPath . '/t2pack/assets');
            t2editor_storage_remove_executable_assets($dataPath . '/t2pack/assets');
            t2editor_storage_remove_executable_assets($dbPath . '/t2pack/assets');

            if ($ok) {
                $payload = "layout=2\ncompleted_at=" . gmdate('c') . "\n";
                if (@file_put_contents($marker, $payload, LOCK_EX) === false) return false;
                @chmod($marker, 0600);
            }
            return $ok;
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }
}

if (!function_exists('t2editor_storage_replace_prefixes')) {
    function t2editor_storage_replace_prefixes($value, array $replacements)
    {
        if (is_string($value)) {
            foreach ($replacements as $from => $to) {
                if ($from !== '' && strpos($value, $from) === 0) return $to . substr($value, strlen($from));
            }
            return $value;
        }
        if (!is_array($value)) return $value;
        foreach ($value as $key => $item) $value[$key] = t2editor_storage_replace_prefixes($item, $replacements);
        return $value;
    }
}

if (!function_exists('t2editor_storage_rewrite_runtime_state')) {
    /**
     * Rebase absolute runtime paths/asset URLs copied from the old layout.
     * Caches that still reference the legacy layout are discarded so ABI/signature checks rebuild them.
     */
    function t2editor_storage_rewrite_runtime_state($dataPath, $dataUrl, $dbPath, $dbUrl, $privatePath)
    {
        if (!function_exists('t2_private_store_read') || !function_exists('t2_private_store_write')) return;
        $legacyPrivate = rtrim((string)$dataPath, '/\\') . '/t2admin-private';
        $newPrivate = rtrim((string)$privatePath, '/\\');
        $legacyAssets = rtrim((string)$dataPath, '/\\') . '/t2pack/assets';
        $newAssets = rtrim((string)$dbPath, '/\\') . '/t2pack/assets';
        $legacyAssetUrl = rtrim((string)$dataUrl, '/') . '/t2pack/assets';
        $newAssetUrl = rtrim((string)$dbUrl, '/') . '/t2pack/assets';
        $replacements = array();
        foreach (array(
            array($legacyPrivate, $newPrivate),
            array($legacyAssets, $newAssets),
            array($legacyAssetUrl, $newAssetUrl),
        ) as $pair) {
            $from = rtrim((string)$pair[0], '/\\');
            $to = rtrim((string)$pair[1], '/\\');
            if ($from !== '') $replacements[$from] = $to;
            $normalizedFrom = t2editor_storage_normalize_path($from);
            $normalizedTo = t2editor_storage_normalize_path($to);
            if ($normalizedFrom !== '') $replacements[$normalizedFrom] = $normalizedTo;
        }

        foreach (array(
            $newPrivate . '/runtime.php',
            $newPrivate . '/t2pack/active.php',
            $newPrivate . '/t2pack/health.php',
            $newPrivate . '/third_party_installed.php',
            $newPrivate . '/core-updater/state.php',
        ) as $file) {
            if (!is_file($file)) continue;
            $value = t2_private_store_read($file, null);
            if (!is_array($value)) continue;
            $rebased = t2editor_storage_replace_prefixes($value, $replacements);
            if ($rebased !== $value) t2_private_store_write($file, $rebased);
        }

        // Caches are invalidated only when they still contain a legacy path or
        // URL. Valid v2 caches must survive ordinary requests.
        foreach (array(
            $newPrivate . '/t2pack/cache/runtime-index.php',
            $newPrivate . '/t2pack/cache/compiled-locales.php',
        ) as $cache) {
            if (!is_file($cache)) continue;
            $value = t2_private_store_read($cache, null);
            $rebased = is_array($value) ? t2editor_storage_replace_prefixes($value, $replacements) : $value;
            if ($rebased === $value) continue;
            @unlink($cache);
            if (function_exists('t2_private_store_forget')) t2_private_store_forget($cache);
        }
    }
}
