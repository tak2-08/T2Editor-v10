<?php
// Path: T2Editor/integration/cms/adapters/rhymix.php
// Developer note: 라이믹스 Context·파일 모듈·스킨 전용 값은 이 어댑터와 integration/cms/rhymix에만 둔다.

if (!function_exists('t2editor_rx_root_matches')) {
    function t2editor_rx_root_matches($root, $editorPath)
    {
        $root = t2editor_cms_real_path($root);
        $editorPath = t2editor_cms_real_path($editorPath);
        if (!t2editor_cms_path_is_inside($editorPath, $root . '/modules/editor/skins')) return false;
        if (!is_file($root . '/config/config.inc.php')) return false;
        return is_file($root . '/common/autoload.php') || is_file($root . '/defaults/config.php') || is_file($root . '/common/defaults/config.php');
    }
}

if (!function_exists('t2editor_rx_root_url')) {
    function t2editor_rx_root_url($root, $editorPath)
    {
        if (defined('T2EDITOR_RHYMIX_BASE_URL') && T2EDITOR_RHYMIX_BASE_URL) return rtrim((string)T2EDITOR_RHYMIX_BASE_URL, '/');
        if (defined('RX_BASEURL')) {
            $base = (string)RX_BASEURL;
            if (preg_match('#^https?://#i', $base)) return rtrim($base, '/');
            $origin = preg_replace('#/+$#', '', t2editor_cms_url_from_path(isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] : $root));
            return rtrim($origin . '/' . ltrim($base, '/'), '/');
        }
        return rtrim(t2editor_cms_url_from_path($root), '/');
    }
}

if (!function_exists('t2editor_rx_bootstrap')) {
    function t2editor_rx_bootstrap($context)
    {
        $root = rtrim((string)($context['root_path'] ?? ''), '/\\');
        try {
            if (!defined('RX_VERSION') && is_file($root . '/common/autoload.php')) require_once $root . '/common/autoload.php';
            if (class_exists('Context', false)) Context::init();
        } catch (Throwable $e) {
            error_log('[T2Editor] Rhymix bootstrap failed: ' . $e->getMessage());
        }
    }
}

if (!function_exists('t2editor_rx_is_admin')) {
    function t2editor_rx_is_admin($context)
    {
        if (!class_exists('Context', false)) return false;
        $info = Context::get('logged_info');
        if (!is_object($info)) return false;
        if (method_exists($info, 'isAdmin')) return (bool)$info->isAdmin();
        return isset($info->is_admin) && (string)$info->is_admin === 'Y';
    }
}

if (!function_exists('t2editor_rx_editor_html')) {
    function t2editor_rx_editor_html()
    {
        if (!array_key_exists('t2editor_rx_editor_sequence', $GLOBALS)) return '';
        $map = array(
            'T2EDITOR_RHYMIX_EDITOR_SEQUENCE' => (string)($GLOBALS['t2editor_rx_editor_sequence'] ?? ''),
            'T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL' => (string)($GLOBALS['t2editor_rx_upload_target_srl'] ?? ''),
            'T2EDITOR_RHYMIX_MODULE_SRL' => (string)($GLOBALS['t2editor_rx_module_srl'] ?? ''),
            'T2EDITOR_RHYMIX_MID' => (string)($GLOBALS['t2editor_rx_mid'] ?? ''),
            'T2EDITOR_RHYMIX_CSRF_TOKEN' => (string)($GLOBALS['t2editor_rx_csrf_token'] ?? ''),
        );
        $json = json_encode($map, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
        return '<script>(function(c){Object.keys(c).forEach(function(k){window[k]=c[k];});window.T2EDITOR_HOST=Object.assign({},window.T2EDITOR_HOST||{},{id:"rhymix",bridge:c});})(' . $json . ');</script>';
    }
}

if (!function_exists('t2editor_rx_base_url')) {
    function t2editor_rx_base_url()
    {
        $context = t2editor_detect_cms(t2editor_cms_base_editor_path(dirname(__DIR__, 3)));
        if (($context['id'] ?? '') === 'rhymix' && !empty($context['root_url'])) return rtrim((string)$context['root_url'], '/');
        $proto = !empty($_SERVER['HTTP_X_FORWARDED_PROTO'])
            ? strtolower(trim(explode(',', (string)$_SERVER['HTTP_X_FORWARDED_PROTO'])[0]))
            : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        if (!preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', (string)$host)) $host = 'localhost';
        $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
        $pos = strpos($script, '/modules/editor/skins/');
        $basePath = $pos !== false ? substr($script, 0, $pos) : '';
        return $proto . '://' . $host . ($basePath === '' ? '' : '/' . trim($basePath, '/'));
    }
}

if (!function_exists('t2editor_rx_proxy_upload')) {
    function t2editor_rx_proxy_upload($fileField)
    {
        if (!function_exists('curl_init')) return array('success' => false, 'raw' => null, 'message' => 'cURL extension is required to bridge uploads to Rhymix.');
        if (!isset($_FILES[$fileField])) return array('success' => false, 'raw' => null, 'message' => 'No file to upload.');
        $f = $_FILES[$fileField];
        $name = is_array($f['name']) ? ($f['name'][0] ?? '') : $f['name'];
        $tmp = is_array($f['tmp_name']) ? ($f['tmp_name'][0] ?? '') : $f['tmp_name'];
        $error = is_array($f['error']) ? ($f['error'][0] ?? UPLOAD_ERR_NO_FILE) : $f['error'];
        $type = is_array($f['type']) ? ($f['type'][0] ?? '') : $f['type'];
        if ($error !== UPLOAD_ERR_OK || !$tmp || !is_uploaded_file($tmp)) return array('success' => false, 'raw' => null, 'message' => 'PHP upload error.');
        $sequence = $_POST['editor_sequence'] ?? '';
        $moduleSrl = $_POST['module_srl'] ?? '';
        if (!preg_match('/^[0-9]+$/', (string)$sequence)) return array('success' => false, 'raw' => null, 'message' => 'Missing or invalid editor_sequence for Rhymix upload.');
        if (!preg_match('/^[0-9]+$/', (string)$moduleSrl)) return array('success' => false, 'raw' => null, 'message' => 'Missing or invalid module_srl for Rhymix upload.');
        $fields = array(
            'Filedata' => new CURLFile($tmp, $type ?: 'application/octet-stream', $name ?: 'upload.bin'),
            'editor_sequence' => $sequence,
            'module_srl' => $moduleSrl,
        );
        foreach (array('uploadTargetSrl', 'upload_target_srl', 'mid') as $key) if (!empty($_POST[$key])) $fields[$key] = $_POST[$key];
        $headers = array('Cookie: ' . ($_SERVER['HTTP_COOKIE'] ?? ''), 'Accept: application/json', 'X-Requested-With: XMLHttpRequest');
        if (!empty($_POST['_rx_csrf_token'])) {
            $headers[] = 'X-CSRF-Token: ' . $_POST['_rx_csrf_token'];
            $fields['_rx_csrf_token'] = $_POST['_rx_csrf_token'];
        }
        $ch = curl_init(t2editor_rx_base_url() . '/index.php?module=file&act=procFileUpload');
        curl_setopt_array($ch, array(CURLOPT_POST => true, CURLOPT_POSTFIELDS => $fields, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 60, CURLOPT_SSL_VERIFYPEER => true));
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $errorText = curl_error($ch);
        curl_close($ch);
        if ($body === false) return array('success' => false, 'raw' => null, 'message' => 'Failed to reach Rhymix file module: ' . $errorText);
        if ($status >= 400) return array('success' => false, 'raw' => null, 'message' => 'Rhymix file module returned HTTP ' . $status);
        $decoded = json_decode(trim((string)$body), true);
        if (!is_array($decoded)) return array('success' => false, 'raw' => null, 'message' => 'Rhymix returned a non-JSON response.');
        if ((int)($decoded['error'] ?? 0) !== 0) return array('success' => false, 'raw' => $decoded, 'message' => $decoded['message'] ?? 'Rhymix rejected the upload.');
        return array('success' => true, 'raw' => $decoded, 'message' => '');
    }
}

if (!function_exists('t2editor_rx_upload')) {
    function t2editor_rx_upload($fileField, $kind)
    {
        if (function_exists('check_request_origin') && !check_request_origin()) return array('status' => 403, 'body' => array('success' => false, 'message' => 'Invalid access.'));
        $proxy = t2editor_rx_proxy_upload($fileField);
        if (!$proxy['success']) return array('status' => 400, 'body' => array('success' => false, 'message' => $proxy['message']));
        $rx = $proxy['raw'];
        $url = $rx['download_url'] ?? ($rx['url'] ?? '');
        $meta = array(
            'file_srl' => (int)($rx['file_srl'] ?? 0),
            'upload_target_srl' => (int)($rx['upload_target_srl'] ?? 0),
            'source_filename' => (string)($rx['source_filename'] ?? ''),
            'download_url' => (string)$url,
            'mime_type' => (string)($rx['mime_type'] ?? ''),
        );
        if ($kind === 'image') {
            return array('status' => 200, 'body' => array('success' => true, 'files' => array(array('url' => $url, 'width' => (int)($rx['width'] ?? 0), 'height' => (int)($rx['height'] ?? 0))), 'failures' => array(), 'host' => array_merge(array('id' => 'rhymix'), $meta), 'rhymix' => $meta));
        }
        $original = $rx['source_filename'] ?? ($rx['uploaded_filename'] ?? 'file');
        $meta['source_filename'] = (string)$original;
        return array('status' => 200, 'body' => array('success' => true, 'file' => array('url' => $url, 'original_name' => $original, 'size' => (int)($rx['file_size'] ?? 0), 'type' => strtolower(pathinfo($original, PATHINFO_EXTENSION))), 'host' => array_merge(array('id' => 'rhymix'), $meta), 'rhymix' => $meta));
    }
}

t2editor_cms_register_adapter('rhymix', array(
    'label' => '라이믹스',
    'priority' => 250,
    'runtime_root' => function ($editorPath) { return defined('RX_BASEDIR') ? (string)RX_BASEDIR : null; },
    'matches_root' => 't2editor_rx_root_matches',
    'validate_context' => function ($context, $editorPath) { return t2editor_rx_root_matches($context['root_path'] ?? '', $editorPath); },
    'root_url' => 't2editor_rx_root_url',
    'data_layout' => function ($context, $editorPath, $editorUrl) {
        return array('data_path' => rtrim((string)$context['root_path'], '/\\') . '/files', 'data_url' => rtrim((string)$context['root_url'], '/') . '/files', 'dir_permission' => 0755, 'file_permission' => 0644);
    },
    'auth_bootstrap' => 't2editor_rx_bootstrap',
    'auth_authorize' => 't2editor_rx_is_admin',
    'editor_html' => 't2editor_rx_editor_html',
    'handles_upload' => function ($fileField, $kind) {
        $context = t2editor_detect_cms(t2editor_cms_base_editor_path(dirname(__DIR__, 3)));
        return ($context['id'] ?? '') === 'rhymix';
    },
    'upload' => 't2editor_rx_upload',
));

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
