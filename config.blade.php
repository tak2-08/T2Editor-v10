@php

/**
 * T2Editor 10.4.0 beta7 — Rhymix 2.1.x adapter configuration.
 *
 * This file is evaluated from Rhymix's compiled template cache, therefore __DIR__
 * may point to files/cache/template/... rather than this skin directory. Always
 * resolve the real skin path from RX_BASEDIR first.
 */

$_t2_skin_dir = defined('RX_BASEDIR')
    ? rtrim(RX_BASEDIR, '/\\') . '/modules/editor/skins/t2editor'
    : __DIR__;

if (is_file($_t2_skin_dir . '/t2editor_rhymix_local_config.php')) {
    require_once $_t2_skin_dir . '/t2editor_rhymix_local_config.php';
}
if (!defined('T2EDITOR_CORE_PATH')) {
    define('T2EDITOR_CORE_PATH', $_t2_skin_dir);
}
if (!is_file(rtrim(T2EDITOR_CORE_PATH, '/\\') . '/editor.lib.php')) {
    throw new RuntimeException(
        '[T2Editor] editor.lib.php was not found in T2EDITOR_CORE_PATH: ' . T2EDITOR_CORE_PATH
        . '. Install this package as modules/editor/skins/t2editor/ or set T2EDITOR_CORE_PATH.'
    );
}
require_once rtrim(T2EDITOR_CORE_PATH, '/\\') . '/editor.lib.php';

// editor.lib.php may have been included from this Blade method scope. Export any
// locally-created configuration arrays as globals for editor_html().
$_t2_defined_vars = get_defined_vars();
foreach (['T2EDITOR_PLUGINS', 'T2EDITOR_PLUGIN_PRIORITY', 'T2EDITOR_BUTTON_ORDER', 'T2EDITOR_LEGACY_BUTTONS'] as $_t2_name) {
    if (isset($_t2_defined_vars[$_t2_name]) && is_array($_t2_defined_vars[$_t2_name])) {
        $GLOBALS[$_t2_name] = $_t2_defined_vars[$_t2_name];
    } elseif (!isset($GLOBALS[$_t2_name]) || !is_array($GLOBALS[$_t2_name])) {
        $GLOBALS[$_t2_name] = [];
    }
}
unset($_t2_defined_vars, $_t2_name);

$t2editor_sequence = (int)($editor_sequence ?? 0);
$t2editor_internal_id = 't2editor_' . ($t2editor_sequence ?: preg_replace('/[^a-zA-Z0-9_]/', '_', uniqid('', true)));

// EditorModel::getEditor() has already registered the authoritative upload session.
// Prefer it over nullable template variables, especially in widgets and comments.
$_t2_upload_info = $_SESSION['upload_info'][$t2editor_sequence] ?? null;
$_t2_module_info = isset($module_info) && is_object($module_info)
    ? $module_info
    : Context::get('current_module_info');
$_t2_module_srl_fallback = is_object($_t2_module_info) ? (int)($_t2_module_info->module_srl ?? 0) : 0;
$_t2_mid_fallback = is_object($_t2_module_info) ? (string)($_t2_module_info->mid ?? '') : '';
$t2editor_module_srl = (int)(is_object($_t2_upload_info)
    ? ($_t2_upload_info->module_srl ?? 0)
    : ($module_srl ?? $_t2_module_srl_fallback));
$t2editor_upload_target_srl = (int)(is_object($_t2_upload_info)
    ? ($_t2_upload_info->upload_target_srl ?? 0)
    : ($document_srl ?? ($upload_target_srl ?? 0)));
$t2editor_mid = (string)($mid ?? ($_t2_mid_fallback ?: (Context::get('mid') ?? '')));
$t2editor_csrf_token = (string)(Context::get('_rx_csrf_token') ?? '');

// Backward-compatible globals used by older T2 plugin code. New code reads the
// per-instance data-editor-config attribute, so multiple editors remain independent.
$GLOBALS['t2editor_rx_editor_sequence'] = $t2editor_sequence;
$GLOBALS['t2editor_rx_module_srl'] = $t2editor_module_srl;
$GLOBALS['t2editor_rx_upload_target_srl'] = $t2editor_upload_target_srl;
$GLOBALS['t2editor_rx_mid'] = $t2editor_mid;
$GLOBALS['t2editor_rx_csrf_token'] = $t2editor_csrf_token;

$t2editor_colorset = in_array(($colorset ?? 'auto'), ['auto', 'light', 'dark'], true) ? $colorset : 'auto';
$t2editor_config = [
    'editorSequence' => $t2editor_sequence,
    'internalId' => $t2editor_internal_id,
    'primaryKeyName' => (string)($editor_primary_key_name ?? 'document_srl'),
    'contentKeyName' => (string)($editor_content_key_name ?? 'content'),
    'height' => max(100, (int)($editor_height ?? 300)),
    'toolbar' => (string)($editor_toolbar ?? 'default'),
    // NOTE: Rhymix's EditorModel::getEditor() already normalizes these to real PHP
    // booleans via Context::set(..., toBool($option->...)) before this skin ever runs
    // (see modules/editor/editor.model.php and compare with skins/ckeditor/config.blade.php,
    // which also assigns these directly without re-casting). Do NOT reintroduce a
    // variable-as-callable pattern here (e.g. a dollar-prefixed variable called with
    // parentheses) -- Rhymix's TemplateParser_v2 rewrites every dollar-prefixed name in
    // this file into a Context property access, so calling a variable as a function
    // becomes a method call on stdClass and fatals with "Call to undefined method
    // stdClass::name()". A plain (bool) cast on an already-boolean value, as used below,
    // makes no such call and is unaffected.
    //
    // WARNING TO FUTURE EDITORS: never write the literal directive-close token that
    // begins with "@end" followed by "php" anywhere in this file, even inside a comment
    // or string -- Rhymix's template compiler locates the end of this PHP block with a
    // plain text search, not a real parser, and will truncate the block at the first
    // occurrence of that token regardless of context (comment, string, or code).
    'hideToolbar' => (bool)($editor_toolbar_hide ?? false),
    'focus' => (bool)($editor_focus ?? false),
    'allowUpload' => (bool)($allow_fileupload ?? false),
    'enableAutosave' => (bool)($enable_autosave ?? false),
    'colorset' => $t2editor_colorset,
    'moduleSrl' => $t2editor_module_srl,
    'uploadTargetSrl' => $t2editor_upload_target_srl,
    'mid' => $t2editor_mid,
    'csrfToken' => $t2editor_csrf_token,
];
$t2editor_config_json = json_encode(
    $t2editor_config,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
);

// Existing content is loaded from Rhymix's real form field by js/rhymix.js.
// An internal ID avoids duplicate name/id collisions and supports multiple editors.
$t2editor_rendered_html = editor_html($t2editor_internal_id, '', true);
$t2editor_submit_js = get_editor_js($t2editor_internal_id, true);

unset($_t2_upload_info, $_t2_module_info, $_t2_module_srl_fallback, $_t2_mid_fallback, $_t2_skin_dir);

@endphp
