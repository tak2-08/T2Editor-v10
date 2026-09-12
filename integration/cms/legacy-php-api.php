<?php
// Path: T2Editor/integration/cms/legacy-php-api.php
// Developer note: 10.4.0 CMS-specific public names remain here only; new code must call generic adapter capabilities.

if (!function_exists('t2editor_cms_gnuboard_root_valid')) {
    function t2editor_cms_gnuboard_root_valid($root, $editorPath)
    {
        return (bool)t2editor_cms_call(t2editor_cms_adapter('gnuboard5'), 'matches_root', array($root, $editorPath), false);
    }
}

if (!function_exists('t2editor_cms_rhymix_root_valid')) {
    function t2editor_cms_rhymix_root_valid($root, $editorPath)
    {
        return (bool)t2editor_cms_call(t2editor_cms_adapter('rhymix'), 'matches_root', array($root, $editorPath), false);
    }
}

if (!function_exists('t2editor_find_rhymix_root')) {
    function t2editor_find_rhymix_root(): ?string
    {
        $context = t2editor_detect_cms(t2editor_cms_base_editor_path(dirname(__DIR__, 2)));
        return (($context['id'] ?? '') === 'rhymix') ? (string)$context['root_path'] : null;
    }
}

if (!function_exists('t2editor_is_rhymix')) {
    function t2editor_is_rhymix(): bool
    {
        return t2editor_find_rhymix_root() !== null;
    }
}

if (!function_exists('t2editor_rhymix_base_url')) {
    function t2editor_rhymix_base_url(): string
    {
        return function_exists('t2editor_rx_base_url') ? t2editor_rx_base_url() : '';
    }
}

if (!function_exists('t2editor_rhymix_proxy_upload')) {
    function t2editor_rhymix_proxy_upload(string $fileField): array
    {
        return function_exists('t2editor_rx_proxy_upload')
            ? t2editor_rx_proxy_upload($fileField)
            : array('success' => false, 'raw' => null, 'message' => 'Rhymix adapter is unavailable.');
    }
}

if (!function_exists('t2editor_wp_bootstrap')) {
    function t2editor_wp_bootstrap(): bool
    {
        return function_exists('t2editor_wp_bootstrap_adapter') && t2editor_wp_bootstrap_adapter();
    }
}

if (!function_exists('t2editor_is_wordpress')) {
    function t2editor_is_wordpress(): bool
    {
        return function_exists('t2editor_wp_available_adapter') && t2editor_wp_available_adapter();
    }
}

if (!function_exists('t2editor_wp_handle_upload')) {
    function t2editor_wp_handle_upload(string $fileField): array
    {
        return function_exists('t2editor_wp_raw_upload_adapter')
            ? t2editor_wp_raw_upload_adapter($fileField)
            : array('success' => false, 'attachment' => null, 'message' => 'WordPress adapter is unavailable.');
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
