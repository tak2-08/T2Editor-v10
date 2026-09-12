<?php
// Path: T2Editor/extend/php/t2admin_settings_loader.php
// Developer note: @t2-scope와 등록 키는 자동 로더 계약이다. 경로는 T2EDITOR_PATH/데이터 경로 헬퍼로 계산한다.
/**
 * @t2-scope bootstrap,editor,admin,endpoint
 * T2Editor Admin — Settings Loader
 *
 * extend/php 자동 로더에 의해 config 파일들보다 먼저 실행되어,
 * <공용 데이터>/t2editor_db/t2admin-private/admin_settings.php 의 값으로 각 config의 상수·전역 변수 기본값을 override한다.
 * IIFE 클로저 내부 실행이므로 전역 변수 접근 시 global 선언 필요.
 */

$_t2s_root = defined('T2EDITOR_PATH') ? T2EDITOR_PATH : dirname(dirname(__DIR__));
require_once $_t2s_root . '/config/t2_private_store.php';
require_once $_t2s_root . '/config/t2_cms_data.php';

// This loader executes before t2_config.php. Resolve exactly the same CMS and
// shared-data layout here instead of reimplementing host detection locally.
$_t2s_context = t2editor_detect_cms($_t2s_root);
$_t2s_layout = t2editor_resolve_data_layout($_t2s_root, null, $_t2s_context);
$_t2s_data_root = defined('T2EDITOR_DATA_PATH')
    ? T2EDITOR_DATA_PATH
    : $_t2s_layout['data_path'];
$_t2s_db_root = defined('T2EDITOR_DB_PATH')
    ? T2EDITOR_DB_PATH
    : $_t2s_layout['db_path'];
$_t2s_private_root = defined('T2EDITOR_PRIVATE_PATH')
    ? T2EDITOR_PRIVATE_PATH
    : rtrim($_t2s_db_root, '/\\') . '/t2admin-private';
$_t2s_settings = rtrim($_t2s_private_root, '/\\') . '/admin_settings.php';
$_t2s_cfg = t2_private_store_read($_t2s_settings, null);
if (!is_array($_t2s_cfg)) {
    $_t2s_legacy_settings = rtrim($_t2s_data_root, '/\\') . '/t2admin-private/admin_settings.php';
    $_t2s_cfg = t2_private_store_read($_t2s_legacy_settings, array());
    unset($_t2s_legacy_settings);
}
if (!is_array($_t2s_cfg)) {
    unset($_t2s_root, $_t2s_context, $_t2s_layout, $_t2s_data_root, $_t2s_db_root, $_t2s_private_root, $_t2s_settings, $_t2s_cfg);
    return;
}

// 도메인
if (isset($_t2s_cfg['domains'])) {
    $_t2s_d = $_t2s_cfg['domains'];

    if (!defined('T2EDITOR_ALLOWED_URL_DOMAINS')
        && isset($_t2s_d['extra_url_domains'])
        && is_array($_t2s_d['extra_url_domains'])) {
        define('T2EDITOR_ALLOWED_URL_DOMAINS', $_t2s_d['extra_url_domains']);
    }

    if (!defined('T2EDITOR_ALLOWED_IFRAME_DOMAINS')
        && isset($_t2s_d['iframe_domains'])
        && is_array($_t2s_d['iframe_domains'])) {
        $__t2s_custom = (isset($_t2s_d['custom_iframe_domains']) && is_array($_t2s_d['custom_iframe_domains']))
            ? $_t2s_d['custom_iframe_domains'] : [];
        define('T2EDITOR_ALLOWED_IFRAME_DOMAINS',
            array_values(array_unique(array_merge($_t2s_d['iframe_domains'], $__t2s_custom))));
        unset($__t2s_custom);
    }
    unset($_t2s_d);
}

// 업로드 — upload_config.php 는 @require_once 로 로드되므로 중복 define() 경고는 억제됨
if (isset($_t2s_cfg['upload'])) {
    $_t2s_u = $_t2s_cfg['upload'];
    if (!defined('T2EDITOR_MAX_UPLOAD_SIZE') && isset($_t2s_u['max_size_mb'])) {
        define('T2EDITOR_MAX_UPLOAD_SIZE', (int)$_t2s_u['max_size_mb']);
    }
    if (!defined('T2EDITOR_STRICT_WEBP_CONVERSION') && isset($_t2s_u['strict_webp'])) {
        define('T2EDITOR_STRICT_WEBP_CONVERSION', (bool)$_t2s_u['strict_webp']);
    }
    if (!defined('T2EDITOR_MAX_IMAGE_PIXELS') && isset($_t2s_u['max_image_pixels'])) {
        define('T2EDITOR_MAX_IMAGE_PIXELS', (int)$_t2s_u['max_image_pixels']);
    }

    // 확장자는 upload_config.php가 변수를 무조건 덮어쓰므로 지연 적용
    if (isset($_t2s_u['extensions']) && is_array($_t2s_u['extensions'])) {
        $GLOBALS['_t2a_ext_override'] = array_map(
            fn($list) => array_values(array_filter(
                (array)$list,
                fn($e) => is_string($e) && preg_match('/^[a-zA-Z0-9]+$/', $e)
            )),
            $_t2s_u['extensions']
        );
    }
    unset($_t2s_u);
}

// 에디터 기본
if (isset($_t2s_cfg['editor'])) {
    $_t2s_e = $_t2s_cfg['editor'];

    if (!defined('T2_CSS_MIN') && isset($_t2s_e['css_min'])) {
        define('T2_CSS_MIN', (bool)$_t2s_e['css_min']);
    }
    if (!defined('T2_JS_MIN') && isset($_t2s_e['js_min'])) {
        define('T2_JS_MIN', (bool)$_t2s_e['js_min']);
    }
    if (!defined('T2_MIGRATION_MODE') && isset($_t2s_e['migration_mode'])) {
        $__t2s_mm = $_t2s_e['migration_mode'];
        if ($__t2s_mm === false || $__t2s_mm === 'auto' || $__t2s_mm === 'prompt') {
            define('T2_MIGRATION_MODE', $__t2s_mm);
        }
        unset($__t2s_mm);
    }
    if (!defined('T2_VIDEO_PLAYER_ENABLED') && isset($_t2s_e['video_player_enabled'])) {
        define('T2_VIDEO_PLAYER_ENABLED', (bool)$_t2s_e['video_player_enabled']);
    }
    if (!defined('T2EDITOR_CONTENT_HEIGHT') && isset($_t2s_e['content_height'])) {
        define('T2EDITOR_CONTENT_HEIGHT', max(200, min(2000, (int)$_t2s_e['content_height'])));
    }
    if (!defined('T2_DARKMODE_BUTTON_ENABLED') && isset($_t2s_e['darkmode_button_enabled'])) {
        define('T2_DARKMODE_BUTTON_ENABLED', (bool)$_t2s_e['darkmode_button_enabled']);
    }
    if (!defined('T2_DARKMODE_FORCED_THEME') && array_key_exists('darkmode_forced_theme', $_t2s_e)) {
        $__t2s_th = $_t2s_e['darkmode_forced_theme'];
        if ($__t2s_th === null || $__t2s_th === 'dark' || $__t2s_th === 'light') {
            define('T2_DARKMODE_FORCED_THEME', $__t2s_th);
        }
        unset($__t2s_th);
    }
    unset($_t2s_e);
}


// NSFW
if (isset($_t2s_cfg['nsfw'])) {
    $_t2s_n = $_t2s_cfg['nsfw'];
    if (!defined('T2_NSFW_ENABLED') && isset($_t2s_n['enabled'])) {
        define('T2_NSFW_ENABLED', (bool)$_t2s_n['enabled']);
    }
    if (!defined('T2_NSFW_MODE') && isset($_t2s_n['mode'])
        && in_array($_t2s_n['mode'], ['browser','server'], true)) {
        define('T2_NSFW_MODE', $_t2s_n['mode']);
    }
    if (!defined('T2_NSFW_ALLOW_SUSPICIOUS') && isset($_t2s_n['allow_suspicious'])) {
        define('T2_NSFW_ALLOW_SUSPICIOUS', (bool)$_t2s_n['allow_suspicious']);
    }
    if (!defined('T2_NSFW_BROWSER_BACKEND_PRIORITY') && isset($_t2s_n['browser_backend_priority'])) {
        $__t2s_bp = array_filter(
            array_map('trim', explode(',', (string)$_t2s_n['browser_backend_priority'])),
            fn($b) => in_array($b, ['webgpu','webgl','wasm','cpu'], true)
        );
        if ($__t2s_bp) define('T2_NSFW_BROWSER_BACKEND_PRIORITY', implode(',', $__t2s_bp));
        unset($__t2s_bp);
    }
    unset($_t2s_n);
}

// 플러그인 — editor.lib.php 의 if(!isset) guard 에 의해 보존됨
if (isset($_t2s_cfg['plugins'])) {
    $_t2s_p = $_t2s_cfg['plugins'];

    if (isset($_t2s_p['active']) && is_array($_t2s_p['active'])) {
        global $T2EDITOR_PLUGINS;
        $T2EDITOR_PLUGINS = array_values(array_filter(
            $_t2s_p['active'],
            fn($n) => is_string($n) && preg_match('/^[a-zA-Z0-9_-]+$/', $n)
        ));
    }
    if (isset($_t2s_p['priority']) && is_array($_t2s_p['priority'])) {
        global $T2EDITOR_PLUGIN_PRIORITY;
        $T2EDITOR_PLUGIN_PRIORITY = [];
        foreach ($_t2s_p['priority'] as $k => $v) {
            if (is_string($k) && preg_match('/^[a-zA-Z0-9_-]+$/', $k)) {
                $T2EDITOR_PLUGIN_PRIORITY[$k] = (int)$v;
            }
        }
    }
    if (isset($_t2s_p['button_order']) && is_array($_t2s_p['button_order'])) {
        global $T2EDITOR_BUTTON_ORDER;
        $T2EDITOR_BUTTON_ORDER = array_values(array_filter(
            $_t2s_p['button_order'],
            fn($c) => is_string($c) && preg_match('/^[a-zA-Z0-9_-]+$/', $c)
        ));
    }
    unset($_t2s_p);
}

unset($_t2s_root, $_t2s_context, $_t2s_layout, $_t2s_data_root, $_t2s_db_root, $_t2s_private_root, $_t2s_settings, $_t2s_raw, $_t2s_cfg);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
