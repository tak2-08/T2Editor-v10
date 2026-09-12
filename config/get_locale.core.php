<?php
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }
require_once T2EDITOR_BASE_PATH . '/editor.lib.php';
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=300, stale-while-revalidate=86400');

$plugins = function_exists('t2_extend_plugin_index') ? array_keys(t2_extend_plugin_index()) : array();
$all = isset($_GET['all']) && (string)$_GET['all'] === '1';
if ($all) {
    $payload = array();
    foreach (t2editor_get_supported_langs() as $code) {
        $payload[$code] = t2editor_i18n_build_messages_for_plugins($code, $plugins);
    }
} else {
    $lang = isset($_GET['lang']) ? (string)$_GET['lang'] : '';
    $resolved = function_exists('t2editor_resolve_locale') ? t2editor_resolve_locale($lang) : null;
    if ($resolved === null) {
        http_response_code(404);
        echo '{}';
        exit;
    }
    $payload = t2editor_i18n_build_messages_for_plugins($resolved, $plugins);
}
$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | (defined('JSON_INVALID_UTF8_SUBSTITUTE') ? JSON_INVALID_UTF8_SUBSTITUTE : 0));
if (!is_string($json)) { http_response_code(500); echo '{}'; exit; }
$etag = '"' . hash('sha256', $json) . '"';
header('ETag: ' . $etag);
if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim((string)$_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}
echo $json;
