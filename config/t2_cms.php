<?php
// Path: T2Editor/config/t2_cms.php
// Developer note: 이 파일은 10.4.0 공개 함수 호환 파사드다. CMS 구현은 integration/cms/adapters에 둔다.
/** T2Editor CMS compatibility facade. */

if (!defined('T2EDITOR_CMS_DETECT_MAX_DEPTH')) define('T2EDITOR_CMS_DETECT_MAX_DEPTH', 6);
if (!defined('T2EDITOR_CMS_CACHE_TTL')) define('T2EDITOR_CMS_CACHE_TTL', 3600);
require_once dirname(__DIR__) . '/integration/cms/bootstrap.php';

if (!function_exists('t2editor_detect_cms')) {
    function t2editor_detect_cms($editorPath = null, $refresh = false)
    {
        return t2editor_cms_detect($editorPath !== null ? $editorPath : t2editor_cms_base_editor_path(dirname(__DIR__)), $refresh);
    }
}

if (!function_exists('t2editor_cms_environment')) {
    function t2editor_cms_environment($editorPath = null)
    {
        $context = t2editor_detect_cms($editorPath);
        return isset($context['id']) ? (string)$context['id'] : 'standalone';
    }
}

if (!function_exists('t2editor_cms_bootstrap_compat_constants')) {
    function t2editor_cms_bootstrap_compat_constants($editorPath = null)
    {
        $context = t2editor_detect_cms($editorPath);
        $adapter = t2editor_cms_adapter($context['id'] ?? 'standalone');
        t2editor_cms_call($adapter, 'bootstrap_compat', array($context), null);
        return $context;
    }
}

if (!function_exists('t2editor_cms_editor_bootstrap_html')) {
    function t2editor_cms_editor_bootstrap_html()
    {
        return t2editor_cms_collect_html('editor_html');
    }
}

if (!function_exists('t2editor_cms_upload_delegate')) {
    function t2editor_cms_upload_delegate($fileField, $kind)
    {
        return t2editor_cms_delegate_upload($fileField, $kind);
    }
}

require_once dirname(__DIR__) . '/integration/cms/legacy-php-api.php';

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
