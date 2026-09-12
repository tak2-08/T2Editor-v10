<?php
// Path: T2Editor/integration/cms/registry.php
// Developer note: 코어는 CMS 이름을 분기하지 않는다. 새 CMS는 어댑터 capability만 등록한다.
/** T2Editor host-integration registry. PHP 7.4+. */

if (!function_exists('t2editor_cms_normalize_path')) {
    function t2editor_cms_normalize_path($path)
    {
        $path = str_replace('\\', '/', (string)$path);
        return $path === '/' ? '/' : rtrim($path, '/');
    }
}

if (!function_exists('t2editor_cms_base_editor_path')) {
    function t2editor_cms_base_editor_path($fallback = null)
    {
        if (defined('T2EDITOR_BASE_PATH') && (string)T2EDITOR_BASE_PATH !== '') {
            return t2editor_cms_normalize_path((string)T2EDITOR_BASE_PATH);
        }
        if ($fallback !== null && (string)$fallback !== '') {
            return t2editor_cms_normalize_path((string)$fallback);
        }
        return t2editor_cms_normalize_path(dirname(__DIR__, 2));
    }
}

if (!function_exists('t2editor_cms_real_path')) {
    function t2editor_cms_real_path($path)
    {
        $real = @realpath((string)$path);
        return t2editor_cms_normalize_path($real !== false ? $real : $path);
    }
}

if (!function_exists('t2editor_cms_path_is_inside')) {
    function t2editor_cms_path_is_inside($path, $root)
    {
        $path = t2editor_cms_normalize_path($path);
        $root = t2editor_cms_normalize_path($root);
        if ($path === '' || $root === '') return false;
        return $path === $root || strncmp($path . '/', $root . '/', strlen($root) + 1) === 0;
    }
}

if (!function_exists('t2editor_cms_url_from_path')) {
    function t2editor_cms_url_from_path($path)
    {
        $scheme = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') ? 'https://' : 'http://';
        $host = isset($_SERVER['HTTP_HOST']) ? (string)$_SERVER['HTTP_HOST'] : 'localhost';
        if ($host === '' || !preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $host)) $host = 'localhost';
        $actual = t2editor_cms_real_path($path);
        $docroot = isset($_SERVER['DOCUMENT_ROOT']) ? t2editor_cms_real_path($_SERVER['DOCUMENT_ROOT']) : '';
        $relative = ($docroot !== '' && t2editor_cms_path_is_inside($actual, $docroot)) ? substr($actual, strlen($docroot)) : '';
        if ($relative !== '' && $relative[0] !== '/') $relative = '/' . $relative;
        return $scheme . $host . $relative;
    }
}

if (!function_exists('t2editor_cms_file_contains')) {
    function t2editor_cms_file_contains($file, array $needles, $maxBytes = 131072)
    {
        if (!is_file($file) || !$needles) return false;
        $handle = @fopen($file, 'rb');
        if ($handle === false) return false;
        $buffer = (string)@fread($handle, max(1024, (int)$maxBytes));
        @fclose($handle);
        foreach ($needles as $needle) {
            if ($needle !== '' && strpos($buffer, (string)$needle) !== false) return true;
        }
        return false;
    }
}

if (!function_exists('t2editor_cms_register_adapter')) {
    function t2editor_cms_register_adapter($id, array $adapter)
    {
        $id = strtolower(trim((string)$id));
        if ($id === '' || !preg_match('/^[a-z0-9_-]+$/', $id)) return false;
        $adapter['id'] = $id;
        $adapter['priority'] = isset($adapter['priority']) ? (int)$adapter['priority'] : 0;
        if (!isset($GLOBALS['T2EDITOR_CMS_ADAPTERS']) || !is_array($GLOBALS['T2EDITOR_CMS_ADAPTERS'])) {
            $GLOBALS['T2EDITOR_CMS_ADAPTERS'] = array();
        }
        $GLOBALS['T2EDITOR_CMS_ADAPTERS'][$id] = $adapter;
        return true;
    }
}

if (!function_exists('t2editor_cms_adapters')) {
    function t2editor_cms_adapters()
    {
        $rows = isset($GLOBALS['T2EDITOR_CMS_ADAPTERS']) && is_array($GLOBALS['T2EDITOR_CMS_ADAPTERS'])
            ? $GLOBALS['T2EDITOR_CMS_ADAPTERS'] : array();
        uasort($rows, function ($a, $b) {
            return ((int)($b['priority'] ?? 0)) <=> ((int)($a['priority'] ?? 0));
        });
        return $rows;
    }
}

if (!function_exists('t2editor_cms_adapter')) {
    function t2editor_cms_adapter($id)
    {
        $rows = t2editor_cms_adapters();
        $id = strtolower(trim((string)$id));
        return isset($rows[$id]) && is_array($rows[$id]) ? $rows[$id] : null;
    }
}

if (!function_exists('t2editor_cms_call')) {
    function t2editor_cms_call($adapter, $capability, array $args = array(), $default = null)
    {
        if (!is_array($adapter) || empty($adapter[$capability]) || !is_callable($adapter[$capability])) return $default;
        try {
            return call_user_func_array($adapter[$capability], $args);
        } catch (Throwable $e) {
            $id = isset($adapter['id']) ? (string)$adapter['id'] : 'unknown';
            error_log('[T2Editor] CMS adapter failure (' . $id . ':' . $capability . '): ' . $e->getMessage());
            return $default;
        }
    }
}

if (!function_exists('t2editor_cms_context_row')) {
    function t2editor_cms_context_row($id, $root, $editorPath, $source, array $extra = array())
    {
        $adapter = t2editor_cms_adapter($id);
        $root = t2editor_cms_real_path($root);
        $editorPath = t2editor_cms_real_path($editorPath);
        $rootUrl = t2editor_cms_call($adapter, 'root_url', array($root, $editorPath), '');
        if ($rootUrl === '') $rootUrl = rtrim(t2editor_cms_url_from_path($root), '/');
        return array_replace(array(
            'id' => (string)$id,
            'label' => (string)($adapter['label'] ?? $id),
            'root_path' => $root,
            'root_url' => rtrim((string)$rootUrl, '/'),
            'editor_path' => $editorPath,
            'source' => (string)$source,
            'detected_at' => time(),
        ), $extra);
    }
}

if (!function_exists('t2editor_cms_context_valid')) {
    function t2editor_cms_context_valid($context, $editorPath)
    {
        if (!is_array($context) || empty($context['id']) || empty($context['editor_path'])) return false;
        $detectedAt = isset($context['detected_at']) ? (int)$context['detected_at'] : 0;
        $ttl = defined('T2EDITOR_CMS_CACHE_TTL') ? (int)T2EDITOR_CMS_CACHE_TTL : 3600;
        if ($detectedAt <= 0 || (time() - $detectedAt) > $ttl) return false;
        if (t2editor_cms_real_path($context['editor_path']) !== t2editor_cms_real_path($editorPath)) return false;
        $adapter = t2editor_cms_adapter($context['id']);
        if (!$adapter) return false;
        return (bool)t2editor_cms_call($adapter, 'validate_context', array($context, $editorPath), true);
    }
}

if (!function_exists('t2editor_cms_cache_get')) {
    function t2editor_cms_cache_get($key, $editorPath)
    {
        if (isset($GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'][$key]) && t2editor_cms_context_valid($GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'][$key], $editorPath)) {
            return $GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'][$key];
        }
        if (session_status() === PHP_SESSION_ACTIVE && isset($_SESSION['t2editor_cms_context'][$key]) && t2editor_cms_context_valid($_SESSION['t2editor_cms_context'][$key], $editorPath)) {
            return $_SESSION['t2editor_cms_context'][$key];
        }
        if (function_exists('apcu_fetch')) {
            $hit = false;
            $row = @apcu_fetch('t2editor:cms:' . $key, $hit);
            if ($hit && t2editor_cms_context_valid($row, $editorPath)) return $row;
        }
        return null;
    }
}

if (!function_exists('t2editor_cms_cache_put')) {
    function t2editor_cms_cache_put($key, array $context)
    {
        if (!isset($GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE']) || !is_array($GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'])) $GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'] = array();
        $GLOBALS['T2EDITOR_CMS_CONTEXT_CACHE'][$key] = $context;
        if (session_status() === PHP_SESSION_ACTIVE) {
            if (!isset($_SESSION['t2editor_cms_context']) || !is_array($_SESSION['t2editor_cms_context'])) $_SESSION['t2editor_cms_context'] = array();
            $_SESSION['t2editor_cms_context'][$key] = $context;
        }
        if (function_exists('apcu_store')) {
            $ttl = defined('T2EDITOR_CMS_CACHE_TTL') ? (int)T2EDITOR_CMS_CACHE_TTL : 3600;
            @apcu_store('t2editor:cms:' . $key, $context, $ttl);
        }
    }
}

if (!function_exists('t2editor_cms_detect')) {
    function t2editor_cms_detect($editorPath, $refresh = false)
    {
        $editorPath = t2editor_cms_real_path($editorPath);
        $key = hash('sha256', $editorPath);
        if (!$refresh) {
            $cached = t2editor_cms_cache_get($key, $editorPath);
            if (is_array($cached)) return $cached;
        }

        $adapters = t2editor_cms_adapters();
        foreach ($adapters as $id => $adapter) {
            if ($id === 'standalone') continue;
            $runtimeRoot = t2editor_cms_call($adapter, 'runtime_root', array($editorPath), null);
            if (is_string($runtimeRoot) && $runtimeRoot !== '' && t2editor_cms_call($adapter, 'matches_root', array($runtimeRoot, $editorPath), false)) {
                $context = t2editor_cms_context_row($id, $runtimeRoot, $editorPath, 'runtime');
                t2editor_cms_cache_put($key, $context);
                return $context;
            }
        }

        $maxDepth = defined('T2EDITOR_CMS_DETECT_MAX_DEPTH') ? (int)T2EDITOR_CMS_DETECT_MAX_DEPTH : 6;
        $cursor = $editorPath;
        for ($depth = 0; $depth <= $maxDepth; $depth++) {
            foreach ($adapters as $id => $adapter) {
                if ($id === 'standalone') continue;
                if (t2editor_cms_call($adapter, 'matches_root', array($cursor, $editorPath), false)) {
                    $context = t2editor_cms_context_row($id, $cursor, $editorPath, 'filesystem');
                    t2editor_cms_cache_put($key, $context);
                    return $context;
                }
            }
            $parent = dirname($cursor);
            if ($parent === $cursor) break;
            $cursor = t2editor_cms_normalize_path($parent);
        }

        $context = t2editor_cms_context_row('standalone', $editorPath, $editorPath, 'fallback');
        t2editor_cms_cache_put($key, $context);
        return $context;
    }
}

if (!function_exists('t2editor_cms_collect_html')) {
    function t2editor_cms_collect_html($capability, array $args = array())
    {
        $html = '';
        foreach (t2editor_cms_adapters() as $adapter) {
            $chunk = t2editor_cms_call($adapter, $capability, $args, '');
            if (is_string($chunk) && $chunk !== '') $html .= $chunk;
        }
        return $html;
    }
}

if (!function_exists('t2editor_cms_delegate_upload')) {
    function t2editor_cms_delegate_upload($fileField, $kind)
    {
        foreach (t2editor_cms_adapters() as $adapter) {
            if (!t2editor_cms_call($adapter, 'handles_upload', array($fileField, $kind), false)) continue;
            $result = t2editor_cms_call($adapter, 'upload', array($fileField, $kind), null);
            if (is_array($result)) return $result;
        }
        return null;
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
