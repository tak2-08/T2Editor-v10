<?php
// Path: T2Editor/config/t2_cms_data.php
// Developer note: 데이터 위치는 선택된 어댑터 capability로만 결정하며 t2_config.php에 CMS 분기를 추가하지 않는다.
/** T2Editor CMS data-path compatibility facade. */
require_once __DIR__ . '/t2_cms.php';

if (!function_exists('t2editor_cms_editor_url')) {
    function t2editor_cms_editor_url(array $context, $editorPath)
    {
        $editorPath = t2editor_cms_real_path($editorPath);
        $root = t2editor_cms_real_path($context['root_path'] ?? $editorPath);
        $rootUrl = rtrim((string)($context['root_url'] ?? ''), '/');
        if ($rootUrl !== '' && t2editor_cms_path_is_inside($editorPath, $root)) return $rootUrl . substr($editorPath, strlen($root));
        return rtrim(t2editor_cms_url_from_path($editorPath), '/');
    }
}

if (!function_exists('t2editor_resolve_data_layout')) {
    function t2editor_resolve_data_layout($editorPath = null, $editorUrl = null, ?array $context = null)
    {
        $editorPath = t2editor_cms_real_path($editorPath !== null ? $editorPath : t2editor_cms_base_editor_path(dirname(__DIR__)));
        if ($context === null) $context = t2editor_detect_cms($editorPath);
        if ($editorUrl === null || $editorUrl === '') $editorUrl = t2editor_cms_editor_url($context, $editorPath);
        $editorUrl = rtrim((string)$editorUrl, '/');
        $adapter = t2editor_cms_adapter($context['id'] ?? 'standalone');
        $layout = t2editor_cms_call($adapter, 'data_layout', array($context, $editorPath, $editorUrl), array());
        if (!is_array($layout) || empty($layout['data_path'])) {
            $layout = array('data_path' => $editorPath . '/data', 'data_url' => $editorUrl . '/data', 'dir_permission' => 0755, 'file_permission' => 0644);
        }
        $dataPath = defined('T2EDITOR_DATA_PATH') ? (string)T2EDITOR_DATA_PATH : (string)$layout['data_path'];
        $dataUrl = defined('T2EDITOR_DATA_URL') ? (string)T2EDITOR_DATA_URL : (string)$layout['data_url'];
        // Adapters may isolate the T2 DB tree away from the media data folder
        // (e.g. gnuboard5 keeps uploads under <공용 데이터>/editor but the DB
        // tree directly under <공용 데이터>). Fall back to the historical
        // "<data_path>/t2editor_db" location when an adapter does not care.
        $dbPath = defined('T2EDITOR_DB_PATH') ? (string)T2EDITOR_DB_PATH
            : (!empty($layout['db_path']) ? (string)$layout['db_path'] : rtrim($dataPath, '/\\') . '/t2editor_db');
        $dbUrl = defined('T2EDITOR_DB_URL') ? (string)T2EDITOR_DB_URL
            : (!empty($layout['db_url']) ? (string)$layout['db_url'] : rtrim($dataUrl, '/') . '/t2editor_db');
        $privatePath = defined('T2EDITOR_PRIVATE_PATH') ? (string)T2EDITOR_PRIVATE_PATH : rtrim($dbPath, '/\\') . '/t2admin-private';
        return array(
            'cms' => $context,
            'base_path' => $editorPath,
            'base_url' => $editorUrl,
            'data_path' => t2editor_cms_normalize_path($dataPath),
            'data_url' => rtrim($dataUrl, '/'),
            'db_path' => t2editor_cms_normalize_path($dbPath),
            'db_url' => rtrim($dbUrl, '/'),
            'private_path' => t2editor_cms_normalize_path($privatePath),
            'dir_permission' => isset($layout['dir_permission']) ? (int)$layout['dir_permission'] : 0755,
            'file_permission' => isset($layout['file_permission']) ? (int)$layout['file_permission'] : 0644,
        );
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
