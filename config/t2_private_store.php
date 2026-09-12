<?php
/**
 * T2Editor private storage helper (PHP 7.4+).
 *
 * Stored values are PHP return files guarded against direct HTTP execution.
 * Values are cached only for the lifetime of the current PHP request. Writes
 * update the request cache immediately and invalidate OPcache/stat metadata so
 * an API that writes and reads the same state file always observes the change.
 */
if (!function_exists('t2_private_store_cache_key')) {
    function t2_private_store_cache_key($file)
    {
        return str_replace('\\', '/', (string)$file);
    }
}

if (!function_exists('t2_private_store_forget')) {
    function t2_private_store_forget($file = null)
    {
        if ($file === null) {
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'] = array();
            return;
        }
        $key = t2_private_store_cache_key($file);
        if (isset($GLOBALS['_T2_PRIVATE_STORE_CACHE']) && is_array($GLOBALS['_T2_PRIVATE_STORE_CACHE'])) {
            unset($GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key]);
        }
        clearstatcache(true, (string)$file);
        if (function_exists('opcache_invalidate')) @opcache_invalidate((string)$file, true);
    }
}

if (!function_exists('t2_private_store_read')) {
    function t2_private_store_read($file, $fallback = null)
    {
        if (!is_string($file) || $file === '') return $fallback;
        $key = t2_private_store_cache_key($file);
        if (!isset($GLOBALS['_T2_PRIVATE_STORE_CACHE']) || !is_array($GLOBALS['_T2_PRIVATE_STORE_CACHE'])) {
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'] = array();
        }
        if (array_key_exists($key, $GLOBALS['_T2_PRIVATE_STORE_CACHE'])) {
            $cached = $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key];
            return !empty($cached['exists']) ? $cached['value'] : $fallback;
        }
        if (!is_file($file)) {
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key] = array('exists' => false, 'value' => null);
            return $fallback;
        }
        if (!defined('T2_PRIVATE_STORAGE_INTERNAL')) define('T2_PRIVATE_STORAGE_INTERNAL', true);
        try {
            $value = include $file;
            if ($value === 1) {
                $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key] = array('exists' => false, 'value' => null);
                return $fallback;
            }
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key] = array('exists' => true, 'value' => $value);
            return $value;
        } catch (Throwable $e) {
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key] = array('exists' => false, 'value' => null);
            return $fallback;
        }
    }
}

if (!function_exists('t2_private_store_write')) {
    function t2_private_store_write($file, $value)
    {
        if (!is_string($file) || $file === '') return false;
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return false;
        @chmod($dir, 0700);
        try {
            $random = bin2hex(random_bytes(6));
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

        $key = t2_private_store_cache_key($file);
        if (!isset($GLOBALS['_T2_PRIVATE_STORE_CACHE']) || !is_array($GLOBALS['_T2_PRIVATE_STORE_CACHE'])) {
            $GLOBALS['_T2_PRIVATE_STORE_CACHE'] = array();
        }
        $GLOBALS['_T2_PRIVATE_STORE_CACHE'][$key] = array('exists' => true, 'value' => $value);
        clearstatcache(true, $file);
        if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
        return true;
    }
}

if (!function_exists('t2_private_store_delete')) {
    function t2_private_store_delete($file)
    {
        if (!is_string($file) || $file === '') return false;
        $ok = !file_exists($file) || @unlink($file);
        t2_private_store_forget($file);
        return $ok;
    }
}

if (!function_exists('t2_private_store_import_legacy')) {
    function t2_private_store_import_legacy($target, $sources, $format)
    {
        if (is_file($target)) return true;
        foreach ((array)$sources as $source) {
            if (!is_string($source) || !is_file($source)) continue;
            $raw = @file_get_contents($source);
            if ($raw === false) continue;
            if ($format === 'json') {
                $value = json_decode($raw, true);
                if (!is_array($value)) continue;
            } else {
                $value = trim($raw);
                if ($value === '') continue;
            }
            if (t2_private_store_write($target, $value)) {
                @unlink($source);
                return true;
            }
        }
        return false;
    }
}
