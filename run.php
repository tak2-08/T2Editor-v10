<?php
/** T2Editor manifest-only package entry router. */
require_once __DIR__ . '/config/extend.php';
t2_extend_prepare_runtime();
t2_extend_load_php();
require_once T2EDITOR_PATH . '/config/t2_config.php';

$package = isset($_GET['package']) ? (string)$_GET['package'] : '';
$entry = isset($_GET['entry']) ? (string)$_GET['entry'] : '';
if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $package) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $entry)) {
    http_response_code(400); exit('Invalid package entry');
}
$descriptor = t2_extend_plugin_descriptor($package);
if (!is_array($descriptor) || empty($descriptor['path'])) { http_response_code(404); exit('Package not found'); }
$manifestFile = rtrim((string)$descriptor['path'], '/\\') . '/package.json';
if (!is_file($manifestFile)) $manifestFile = rtrim((string)$descriptor['path'], '/\\') . '/plugin.json';
$manifest = is_file($manifestFile) ? json_decode((string)@file_get_contents($manifestFile), true) : null;
$entries = is_array($manifest) && isset($manifest['entries']) && is_array($manifest['entries']) ? $manifest['entries'] : array();
$relative = isset($entries[$entry]) ? str_replace('\\', '/', (string)$entries[$entry]) : '';
if ($relative === '' || $relative[0] === '/' || preg_match('#(^|/)\.\.?(/|$)#', $relative) || substr($relative, -4) !== '.php') {
    http_response_code(404); exit('Entry not registered');
}
$target = rtrim((string)$descriptor['path'], '/\\') . '/' . $relative;
$realTarget = @realpath($target); $realRoot = @realpath((string)$descriptor['path']);
if ($realTarget === false || $realRoot === false || !t2_extend_path_is_inside($realTarget, $realRoot) || !is_file($realTarget) || is_link($realTarget)) {
    http_response_code(404); exit('Entry not found');
}
require $realTarget;
