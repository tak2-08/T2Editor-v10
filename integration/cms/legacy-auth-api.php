<?php
// Path: T2Editor/integration/cms/legacy-auth-api.php
// Developer note: Authentication aliases preserve 10.4.0 extensions; CMS session logic stays in adapters.

if (!function_exists('t2editor_admin_gnuboard5_bootstrap')) {
    function t2editor_admin_gnuboard5_bootstrap(array $context)
    {
        t2editor_cms_call(t2editor_cms_adapter('gnuboard5'), 'auth_bootstrap', array($context), null);
    }
}
if (!function_exists('t2editor_admin_gnuboard5_authorize')) {
    function t2editor_admin_gnuboard5_authorize(array $context)
    {
        return (bool)t2editor_cms_call(t2editor_cms_adapter('gnuboard5'), 'auth_authorize', array($context), false);
    }
}
if (!function_exists('t2editor_admin_rhymix_bootstrap')) {
    function t2editor_admin_rhymix_bootstrap(array $context)
    {
        t2editor_cms_call(t2editor_cms_adapter('rhymix'), 'auth_bootstrap', array($context), null);
    }
}
if (!function_exists('t2editor_admin_rhymix_authorize')) {
    function t2editor_admin_rhymix_authorize(array $context)
    {
        return (bool)t2editor_cms_call(t2editor_cms_adapter('rhymix'), 'auth_authorize', array($context), false);
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
