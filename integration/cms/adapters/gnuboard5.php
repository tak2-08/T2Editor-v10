<?php
// Path: T2Editor/integration/cms/adapters/gnuboard5.php
// Developer note: 그누보드 상수·세션·관리자 경로 처리는 이 어댑터 밖으로 복제하지 않는다.

if (!function_exists('t2editor_g5_root_matches')) {
    function t2editor_g5_root_matches($root, $editorPath)
    {
        $root = t2editor_cms_real_path($root);
        $editorPath = t2editor_cms_real_path($editorPath);
        if (!t2editor_cms_path_is_inside($editorPath, $root . '/plugin/editor')) return false;
        if (!is_file($root . '/config.php') || !is_file($root . '/common.php') || !is_file($root . '/lib/common.lib.php')) return false;
        return t2editor_cms_file_contains($root . '/config.php', array("define('_GNUBOARD_'", 'define("_GNUBOARD_"', '_GNUBOARD_'));
    }
}

if (!function_exists('t2editor_g5_bootstrap')) {
    function t2editor_g5_bootstrap($context)
    {
        $root = rtrim((string)($context['root_path'] ?? ''), '/\\');
        if (defined('_GNUBOARD_') || !is_file($root . '/common.php')) return;
        $level = ob_get_level();
        ob_start();
        try {
            require_once $root . '/common.php';
            foreach (array('is_admin', 'member', 'config', 'g5') as $name) {
                if (isset(${$name})) $GLOBALS[$name] = ${$name};
            }
        } catch (Throwable $e) {
            error_log('[T2Editor] Gnuboard5 bootstrap failed: ' . $e->getMessage());
        }
        while (ob_get_level() > $level) @ob_end_clean();
    }
}

if (!function_exists('t2editor_g5_is_admin')) {
    function t2editor_g5_is_admin($context)
    {
        global $is_admin, $member, $config;
        if (isset($is_admin) && $is_admin === 'super') return true;
        return isset($member['mb_id'], $config['cf_admin']) && (string)$member['mb_id'] !== ''
            && hash_equals((string)$config['cf_admin'], (string)$member['mb_id']);
    }
}

if (!function_exists('t2editor_g5_is_admin_page')) {
    function t2editor_g5_is_admin_page()
    {
        global $is_admin, $g5;
        if (empty($is_admin)) return false;
        $adminPath = '/adm';
        if (!empty($g5['admin_url'])) {
            $parsed = parse_url($g5['admin_url'], PHP_URL_PATH);
            if ($parsed) $adminPath = rtrim($parsed, '/');
        }
        $uri = isset($_SERVER['REQUEST_URI']) ? (string)$_SERVER['REQUEST_URI'] : '';
        return $uri === $adminPath || strpos($uri, $adminPath . '/') === 0 || strpos($uri, $adminPath . '?') === 0 || strpos($uri, '/adm/') !== false;
    }
}

if (!function_exists('t2editor_g5_editor_html')) {
    function t2editor_g5_editor_html()
    {
        static $done = false;
        $context = t2editor_detect_cms(t2editor_cms_base_editor_path(dirname(__DIR__, 3)));
        if ($done || ($context['id'] ?? '') !== 'gnuboard5' || !t2editor_g5_is_admin_page()) return '';
        $done = true;
        return <<<'HTML'
<script>
(function () {
    if (!window.T2Editor || !T2Editor.prototype) return;
    T2Editor.prototype.loadAutoSave = function () {};
    var original = T2Editor.prototype.setupAutoSaveToggle;
    T2Editor.prototype.setupAutoSaveToggle = function () {
        original.call(this);
        var toggle = this.container.querySelector('.t2-autosave-toggle');
        if (!toggle) return;
        var checkbox = toggle.querySelector('input[type="checkbox"]');
        if (checkbox) { checkbox.checked = false; checkbox.disabled = true; }
        toggle.style.opacity = '0.4';
        toggle.style.pointerEvents = 'none';
        toggle.style.cursor = 'not-allowed';
        toggle.title = (window.T2I18N && T2I18N.t) ? T2I18N.t('editor.autosave_admin_disabled') : 'Auto-save is not available on admin pages.';
        toggle.querySelectorAll('label').forEach(function (label) { label.style.cursor = 'not-allowed'; });
    };
})();
</script>
HTML;
    }
}

t2editor_cms_register_adapter('gnuboard5', array(
    'label' => '그누보드5',
    'priority' => 300,
    'runtime_root' => function ($editorPath) { return defined('G5_PATH') ? (string)G5_PATH : null; },
    'matches_root' => 't2editor_g5_root_matches',
    'validate_context' => function ($context, $editorPath) { return t2editor_g5_root_matches($context['root_path'] ?? '', $editorPath); },
    'root_url' => function ($root, $editorPath) { return defined('G5_URL') ? rtrim((string)G5_URL, '/') : rtrim(t2editor_cms_url_from_path($root), '/'); },
    'bootstrap_compat' => function ($context) {
        $root = rtrim((string)$context['root_path'], '/\\');
        $base = rtrim((string)$context['root_url'], '/');
        if (!defined('G5_PATH')) define('G5_PATH', $root);
        if (!defined('G5_DATA_PATH')) define('G5_DATA_PATH', $root . '/data');
        if (!defined('G5_PLUGIN_PATH')) define('G5_PLUGIN_PATH', $root . '/plugin');
        if (!defined('G5_URL')) define('G5_URL', $base);
        if (!defined('G5_DATA_URL')) define('G5_DATA_URL', $base . '/data');
        if (!defined('G5_PLUGIN_URL')) define('G5_PLUGIN_URL', $base . '/plugin');
    },
    'data_layout' => function ($context, $editorPath, $editorUrl) {
        $root = rtrim((string)$context['root_path'], '/\\');
        $base = rtrim((string)$context['root_url'], '/');
        return array(
            'data_path' => defined('G5_DATA_PATH') ? rtrim((string)G5_DATA_PATH, '/\\') . '/editor' : $root . '/data/editor',
            'data_url' => defined('G5_DATA_URL') ? rtrim((string)G5_DATA_URL, '/') . '/editor' : $base . '/data/editor',
            'dir_permission' => defined('G5_DIR_PERMISSION') ? (int)G5_DIR_PERMISSION : 0755,
            'file_permission' => defined('G5_FILE_PERMISSION') ? (int)G5_FILE_PERMISSION : 0644,
        );
    },
    'auth_bootstrap' => 't2editor_g5_bootstrap',
    'auth_authorize' => 't2editor_g5_is_admin',
    'editor_html' => 't2editor_g5_editor_html',
));

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
