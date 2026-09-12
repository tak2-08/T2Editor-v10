<?php
// Path: T2Editor/integration/cms/adapters/wordpress.php
// Developer note: 워드프레스는 설치환경 감지가 아니라 선택적 업로드·브라우저 브리지 capability만 제공한다.


if (!function_exists('t2editor_wp_bridge_requested')) {
    function t2editor_wp_bridge_requested()
    {
        return defined('ABSPATH')
            || array_key_exists('t2editor_wp_nonce', $GLOBALS)
            || isset($_REQUEST['_wpnonce'])
            || isset($_SERVER['HTTP_X_WP_NONCE']);
    }
}

if (!function_exists('t2editor_wp_bootstrap_adapter')) {
    function t2editor_wp_bootstrap_adapter()
    {
        if (defined('ABSPATH')) return true;
        $dir = t2editor_cms_base_editor_path(dirname(__DIR__, 3));
        for ($i = 0; $i < 10; $i++) {
            $candidate = $dir . '/wp-load.php';
            if (is_file($candidate)) { require_once $candidate; return defined('ABSPATH'); }
            $parent = dirname($dir);
            if ($parent === $dir) break;
            $dir = $parent;
        }
        return false;
    }
}

if (!function_exists('t2editor_wp_available_adapter')) {
    function t2editor_wp_available_adapter()
    {
        static $available = null;
        if ($available === null) $available = t2editor_wp_bootstrap_adapter() && function_exists('media_handle_upload');
        return $available;
    }
}

if (!function_exists('t2editor_wp_raw_upload_adapter')) {
    function t2editor_wp_raw_upload_adapter($fileField)
    {
        if (!t2editor_wp_available_adapter()) return array('success' => false, 'attachment' => null, 'message' => 'WordPress runtime not available.');
        if (!isset($_FILES[$fileField])) return array('success' => false, 'attachment' => null, 'message' => 'No file to upload.');
        if (!function_exists('check_ajax_referer') || !check_ajax_referer('media-form', false, false)) return array('success' => false, 'attachment' => null, 'message' => 'Invalid or missing WordPress nonce (_wpnonce).');
        if (!current_user_can('upload_files')) return array('success' => false, 'attachment' => null, 'message' => 'Sorry, you are not allowed to upload files.');
        $postId = isset($_REQUEST['post_id']) ? intval($_REQUEST['post_id']) : 0;
        if ($postId && !current_user_can('edit_post', $postId)) return array('success' => false, 'attachment' => null, 'message' => 'Sorry, you are not allowed to attach files to this post.');
        if (isset($_FILES[$fileField]['name']) && is_array($_FILES[$fileField]['name'])) {
            $_FILES[$fileField] = array(
                'name' => $_FILES[$fileField]['name'][0] ?? '', 'type' => $_FILES[$fileField]['type'][0] ?? '',
                'tmp_name' => $_FILES[$fileField]['tmp_name'][0] ?? '', 'error' => $_FILES[$fileField]['error'][0] ?? UPLOAD_ERR_NO_FILE,
                'size' => $_FILES[$fileField]['size'][0] ?? 0,
            );
        }
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        $attachmentId = media_handle_upload($fileField, $postId);
        if (is_wp_error($attachmentId)) return array('success' => false, 'attachment' => null, 'message' => $attachmentId->get_error_message());
        $attachment = wp_prepare_attachment_for_js($attachmentId);
        return $attachment ? array('success' => true, 'attachment' => $attachment, 'message' => '') : array('success' => false, 'attachment' => null, 'message' => 'Failed to prepare attachment data.');
    }
}

if (!function_exists('t2editor_wp_upload_adapter')) {
    function t2editor_wp_upload_adapter($fileField, $kind)
    {
        $result = t2editor_wp_raw_upload_adapter($fileField);
        if (!$result['success']) return array('status' => 400, 'body' => array('success' => false, 'message' => $result['message']));
        $att = $result['attachment'];
        if ($kind === 'image') {
            return array('status' => 200, 'body' => array('success' => true, 'files' => array(array('url' => $att['url'] ?? '', 'width' => (int)($att['width'] ?? 0), 'height' => (int)($att['height'] ?? 0))), 'failures' => array()));
        }
        $filename = $att['filename'] ?? ($att['name'] ?? 'file');
        return array('status' => 200, 'body' => array('success' => true, 'file' => array('url' => $att['url'] ?? '', 'original_name' => $filename, 'size' => (int)($att['filesizeInBytes'] ?? 0), 'type' => strtolower(pathinfo($filename, PATHINFO_EXTENSION)))));
    }
}

if (!function_exists('t2editor_wp_editor_html_adapter')) {
    function t2editor_wp_editor_html_adapter()
    {
        if (!array_key_exists('t2editor_wp_nonce', $GLOBALS)) return '';
        $map = array('T2EDITOR_WP_NONCE' => (string)($GLOBALS['t2editor_wp_nonce'] ?? ''), 'T2EDITOR_WP_POST_ID' => (string)($GLOBALS['t2editor_wp_post_id'] ?? '0'));
        return '<script>(function(c){Object.keys(c).forEach(function(k){window[k]=c[k];});window.T2EDITOR_HOST=Object.assign({},window.T2EDITOR_HOST||{},{wordpress:c});})(' . json_encode($map, JSON_HEX_TAG | JSON_HEX_AMP) . ');</script>';
    }
}

t2editor_cms_register_adapter('wordpress', array(
    'label' => 'WordPress bridge',
    'priority' => 200,
    'validate_context' => function () { return false; },
    'editor_html' => 't2editor_wp_editor_html_adapter',
    'handles_upload' => function ($fileField, $kind) { return t2editor_wp_bridge_requested() && t2editor_wp_available_adapter(); },
    'upload' => 't2editor_wp_upload_adapter',
));

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
