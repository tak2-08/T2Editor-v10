<?php
// Path: T2Editor/integration/cms/adapters/standalone.php
// Developer note: 독립 환경은 항상 최종 fallback이며 CMS 전용 상수나 런타임을 로드하지 않는다.

t2editor_cms_register_adapter('standalone', array(
    'label' => '독립환경',
    'priority' => -1000,
    'validate_context' => function ($context, $editorPath) { return true; },
    'root_url' => function ($root, $editorPath) { return rtrim(t2editor_cms_url_from_path($editorPath), '/'); },
    'data_layout' => function ($context, $editorPath, $editorUrl) {
        return array('data_path' => $editorPath . '/data', 'data_url' => rtrim($editorUrl, '/') . '/data', 'dir_permission' => 0755, 'file_permission' => 0644);
    },
));

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
