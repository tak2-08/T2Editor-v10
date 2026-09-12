<?php
// Path: T2Editor/editor.core.php

// Developer settings: register plugins and toolbar order in config/t2_config.php; keep command IDs compatible with 10.4.0 button names.

// Loaded only through the immutable editor.lib.php bootstrap.
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }
t2_extend_load_php();

include T2EDITOR_PATH . '/config/t2_config.php';

// Template integrations may include this file in method scope; publish public configuration arrays explicitly.
foreach (['T2EDITOR_PLUGINS', 'T2EDITOR_PLUGIN_PRIORITY', 'T2EDITOR_BUTTON_ORDER', 'T2EDITOR_LEGACY_BUTTONS'] as $_t2_cfg_name) {
    if (isset(${$_t2_cfg_name})) {
        $GLOBALS[$_t2_cfg_name] = ${$_t2_cfg_name};
    } elseif (!isset($GLOBALS[$_t2_cfg_name])) {
        $GLOBALS[$_t2_cfg_name] = [];
    }
}
unset($_t2_cfg_name);

if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', __DIR__);
if (!defined('T2EDITOR_URL'))  define('T2EDITOR_URL', '/t2editor');

// Load upload policy at file scope so constants/functions exist even when editor_html() skips JS rendering.
if (!function_exists('get_video_extensions')) {
    $_t2_upload_cfg = T2EDITOR_PATH . '/config/upload_config.php';
    if (file_exists($_t2_upload_cfg)) {
        // @ : extend/php 가 먼저 define() 한 상수와의 충돌 E_WARNING 억제
        @require_once $_t2_upload_cfg;
    }
    unset($_t2_upload_cfg);
}

// extend/php 가 예약한 확장자 설정을 upload_config.php 로드 이후 최종 반영
if (!empty($GLOBALS['_t2a_ext_override']) && is_array($GLOBALS['t2editor_allowed_extensions'] ?? null)) {
    foreach ($GLOBALS['_t2a_ext_override'] as $_t2a_cat => $_t2a_exts) {
        if (isset($GLOBALS['t2editor_allowed_extensions'][$_t2a_cat])) {
            $GLOBALS['t2editor_allowed_extensions'][$_t2a_cat] = $_t2a_exts;
        }
    }
    unset($_t2a_cat, $_t2a_exts, $GLOBALS['_t2a_ext_override']);
}

// Keep the historical local variable available to templates while the global registry remains authoritative.
if (!isset($GLOBALS['t2editor_allowed_extensions']) || !is_array($GLOBALS['t2editor_allowed_extensions'])) {
    $GLOBALS['t2editor_allowed_extensions'] = function_exists('t2editor_default_upload_extensions')
        ? t2editor_default_upload_extensions() : [];
}
$t2editor_allowed_extensions =& $GLOBALS['t2editor_allowed_extensions'];

// 압축 설정
if (!defined('T2_CSS_MIN')) define('T2_CSS_MIN', true); //true 권장
if (!defined('T2_JS_MIN'))  define('T2_JS_MIN', false); //사양이 낮은 서버의 경우 과부하가 올 수 있음

// 마이그레이션 옵션
// 'auto'   : 묻지 않고 즉시 T2Editor 형식으로 자동 변환
// 'prompt' : 타 에디터 콘텐츠 감지 시 변환 여부 팝업 표시
// false    : 감지/변환 비활성화 (기본값)
if (!defined('T2_MIGRATION_MODE')) define('T2_MIGRATION_MODE', false);

// NSFW 필터 설정
// T2_NSFW_ENABLED: NSFW 필터 사용 여부
// true: 사용
// false: 미사용 (기본값)
if (!defined('T2_NSFW_ENABLED')) define('T2_NSFW_ENABLED', false);

// T2_NSFW_MODE: 필터 작동 방식
// 'browser': 브라우저 추론
if (!defined('T2_NSFW_MODE')) define('T2_NSFW_MODE', 'browser');

// T2_NSFW_ALLOW_SUSPICIOUS: 19금 의심 이미지 업로드 허용 여부
// true  → 경고 팝업 표시 후 업로드 허용 (법적 책임 경고) (기본값)
// false → 해당 이미지 업로드 취소 처리
if (!defined('T2_NSFW_ALLOW_SUSPICIOUS')) define('T2_NSFW_ALLOW_SUSPICIOUS', true);

// 브라우저 NSFW 런타임/모델 설정
// 기본값은 자체 호스팅 경로를 사용합니다.
// vendor 폴더에 tfjs / backend / nsfwjs / model 파일을 배치하면 바로 동작합니다.
if (!defined('T2_NSFW_RUNTIME_ASSET_BASE')) define('T2_NSFW_RUNTIME_ASSET_BASE', rtrim((string)(defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : T2EDITOR_URL), '/') . '/vendor');
if (!defined('T2_NSFW_BROWSER_MODEL')) define('T2_NSFW_BROWSER_MODEL', 'MobileNetV2Mid');
if (!defined('T2_NSFW_BROWSER_MODEL_TYPE')) define('T2_NSFW_BROWSER_MODEL_TYPE', 'graph');
if (!defined('T2_NSFW_BROWSER_MODEL_URL')) define('T2_NSFW_BROWSER_MODEL_URL', rtrim((string)T2_NSFW_RUNTIME_ASSET_BASE, '/') . '/nsfwjs/models/mobilenet_v2_mid/model.json');
if (!defined('T2_NSFW_BROWSER_BACKEND_PRIORITY')) define('T2_NSFW_BROWSER_BACKEND_PRIORITY', 'webgpu,webgl,wasm,cpu');

// Developer setting: T2EDITOR_USE_CUSTOM_VIDEO_PLAYER selects the internal player for uploaded/direct media.
// External embeds are unaffected; host-specific iframe registration belongs to the selected integration adapter.
if (!defined('T2_VIDEO_PLAYER_ENABLED')) define('T2_VIDEO_PLAYER_ENABLED', true);

// 작성 영역 기본 높이(px). 관리자의 설정은 extend/php/t2admin_settings_loader.php가 선반영한다.
if (!defined('T2EDITOR_CONTENT_HEIGHT')) define('T2EDITOR_CONTENT_HEIGHT', 350);


// 플러그인 등록
// if(!isset) guard — extend/php 가 먼저 설정한 값이 있으면 그대로 보존
if (!isset($T2EDITOR_PLUGINS)) $T2EDITOR_PLUGINS = [
    'link',
    'image',
    'video',
    'file',
    'table',
    'code',
    'linkcard', // Keep the core command ID aligned with button.json and plugin registration.
    'export',
    'search',
    'draw',
    'collab',
    'ai_complex', // v10.2.0: ai + ai_rearrange 통폐합 (T2LLM 연동)
    'clipurl',
    'meme'
];

// 플러그인 로딩 순서 설정
if (!isset($T2EDITOR_PLUGIN_PRIORITY)) $T2EDITOR_PLUGIN_PRIORITY = [
    'image' => 0,
    'video' => 1,
    'link' => 2,
    'ai_complex' => 3,
    'file' => 4,
    'code' => 4,
    'search' => 4,
    'linkcard' => 6, // plugin/linkcard/plugin.json 의 priority 값과 동일하게 유지
    'table' => 5,
    'draw' => 6,
    'collab' => 6,
    'meme' => 8,
    'export' => 9,
    'clipurl' => 9
];

// v10+: 버튼 순서 Override (선택사항)
// command 문자열 배열로 출력 순서를 명시적으로 지정.
// 비워두면 $T2EDITOR_PLUGIN_PRIORITY 기반 자동 정렬 사용.
// 예: $T2EDITOR_BUTTON_ORDER = ['createLink', 'insertImage', 'insertYouTube'];
if (!isset($T2EDITOR_BUTTON_ORDER)) $T2EDITOR_BUTTON_ORDER = [];

// v10+: 레거시 버튼 (button.json 미제공 서드파티 플러그인용)
// button.json을 아직 추가하지 않은 플러그인의 버튼을 수동으로 등록.
// v10.0.0 기본 제공 플러그인은 모두 button.json으로 이전 완료 → 기본 비어있음.
if (!isset($T2EDITOR_LEGACY_BUTTONS)) $T2EDITOR_LEGACY_BUTTONS = [];

// button.json 로더
/**
 * 단일 플러그인의 button.json을 읽어 버튼 배열 반환.
 * JSON 파일이 없거나 파싱 실패 시 빈 배열 반환 (오류 무시).
 */
function _t2e_load_plugin_buttons(string $plugin_name): array {
    // Security: 플러그인 이름은 영숫자·언더스코어·하이픈만 허용 (경로 탈출 방지)
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $plugin_name)) return [];

    $descriptor = function_exists('t2_extend_plugin_descriptor') ? t2_extend_plugin_descriptor($plugin_name) : null;
    $path = is_array($descriptor) ? rtrim((string)$descriptor['path'], '/\\') . '/button.json' : T2EDITOR_PATH . '/plugin/' . $plugin_name . '/button.json';
    if (!file_exists($path)) return [];

    $raw = file_get_contents($path);
    if ($raw === false) return [];

    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        error_log("[T2Editor] {$plugin_name}/button.json parse error: " . json_last_error_msg());
        return [];
    }

    return (isset($decoded['buttons']) && is_array($decoded['buttons']))
        ? $decoded['buttons']
        : [];
}

// [v10+] 버튼 렌더러
/**
 * button.json의 단일 버튼 정의 배열을 받아 HTML 문자열 반환.
 * 코어 버튼(shorthand)과 플러그인 버튼(full spec) 모두 처리.
 */
function _t2e_render_button(array $btn): string {
    $e = fn($s) => htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');

    $cmd      = $e($btn['command']   ?? '');
    $plugin   = $e($btn['plugin']    ?? '');
    $aria     = $e($btn['ariaLabel'] ?? $btn['aria'] ?? $cmd);
    $toolbar_i18n_keys = [
        'undo'=>'toolbar.command_undo', 'redo'=>'toolbar.command_redo',
        'bold'=>'toolbar.command_bold', 'italic'=>'toolbar.command_italic',
        'underline'=>'toolbar.command_underline', 'strikeThrough'=>'toolbar.command_strikethrough',
        'justifyContent'=>'toolbar.command_alignment', 'fontSize'=>'toolbar.command_font_size',
        'foreColor'=>'toolbar.command_text_color', 'backColor'=>'toolbar.command_background_color',
        'createLink'=>'toolbar.command_link', 'insertImage'=>'toolbar.command_image',
        'insertYouTube'=>'toolbar.command_video', 'insertTable'=>'toolbar.command_table',
        'attachFile'=>'toolbar.command_file', 'insertCodeBlock'=>'toolbar.command_code',
        'search'=>'toolbar.command_search', 'openAiComplex'=>'toolbar.command_ai',
        'insertMeme'=>'toolbar.command_meme', 'createClipUrl'=>'toolbar.command_clipurl',
        'collab'=>'toolbar.command_collab', 'insertDrawing'=>'toolbar.command_draw',
        'exportHTML'=>'toolbar.command_export',
    ];
    $i18n_key = isset($btn['i18nKey']) ? $e($btn['i18nKey']) : ($toolbar_i18n_keys[$btn['command'] ?? ''] ?? '');
    $i18n_attrs = $i18n_key !== ''
        ? ' data-i18n-title="' . $i18n_key . '" data-i18n-aria-label="' . $i18n_key . '"'
        : '';
    $style    = isset($btn['style'])    ? ' style="' . $e($btn['style'])    . '"' : '';
    $disabled = !empty($btn['disabled']) ? ' disabled' : '';
    $data_plugin = $plugin ? ' data-plugin="' . $plugin . '"' : '';

    $icon_html = '';
    $icon = $btn['icon'] ?? null;

    if (is_string($icon)) {
        // 코어 버튼 shorthand: "icon" => "undo"
        $icon_html = '<span class="material-icons">' . $e($icon) . '</span>';
    } elseif (is_array($icon)) {
        $icon_type = $icon['type'] ?? 'material-icons';
        $allowed_types = ['material-icons', 'material-icons-outlined'];

        if ($icon_type === 'html') {
            // 개발자 직접 HTML — plugin JSON은 신뢰 소스이므로 허용
            // 프로덕션 강화 시 strip_tags() whitelist 적용 권장
            $icon_html = $icon['html'] ?? '';
        } elseif (in_array($icon_type, $allowed_types, true)) {
            $safe_type = $e($icon_type);
            $safe_name = $e($icon['name'] ?? '');
            $icon_style_attr = '';
            if (!empty($icon['style'])) {
                $icon_style_attr = ' style="' . $e($icon['style']) . '"';
            }
            $icon_html = '<span class="' . $safe_type . '"' . $icon_style_attr . '>' . $safe_name . '</span>';
        }
    }

    $extra = '';
    if (!empty($btn['extraAttributes']) && is_array($btn['extraAttributes'])) {
        foreach ($btn['extraAttributes'] as $k => $v) {
            // Security: attribute 이름을 영숫자·하이픈으로 제한
            if (preg_match('/^[a-zA-Z][a-zA-Z0-9\-]*$/', (string)$k)) {
                $extra .= ' ' . $e($k) . '="' . $e($v) . '"';
            }
        }
    }

    return '<button class="t2-btn" data-command="' . $cmd . '"'
        . $data_plugin . $style . $disabled . $extra . $i18n_attrs
        . ' aria-label="' . $aria . '" title="' . $aria . '">' . $icon_html . '</button>';
}

/**
 * 코어 버튼 + 플러그인 버튼을 순서에 따라 조합하여 툴바 HTML 반환.
 */
function _t2e_build_toolbar_html(
    array $plugins,
    array $priority,
    array $button_order,
    array $legacy_buttons
): string {
    // 코어 버튼 (플러그인 무관, 항상 앞에)
    $core_buttons = [
        ['command'=>'undo',          'icon'=>'undo',               'disabled'=>true, 'aria'=>'undo'],
        ['command'=>'redo',          'icon'=>'redo',               'disabled'=>true, 'aria'=>'redo'],
        ['command'=>'bold',          'icon'=>'format_bold',                          'aria'=>'format bold'],
        ['command'=>'italic',        'icon'=>'format_italic',                        'aria'=>'format italic'],
        ['command'=>'underline',     'icon'=>'format_underlined',                    'aria'=>'format underline'],
        ['command'=>'strikeThrough', 'icon'=>'format_strikethrough',                 'aria'=>'format strikethrough'],
        ['command'=>'justifyContent','icon'=>'format_align_left',                    'aria'=>'format align left'],
        ['command'=>'fontSize',      'icon'=>'format_size',                          'aria'=>'format font size'],
        ['command'=>'foreColor',     'icon'=>'format_color_text',                    'aria'=>'format text color'],
        ['command'=>'backColor',     'icon'=>'format_color_fill',                    'aria'=>'format text background color'],
    ];

    $html = '';
    foreach ($core_buttons as $btn) {
        $html .= _t2e_render_button($btn);
    }

    // 플러그인 버튼 수집 + 순서 계산
    $plugin_buttons = []; // [['order' => int, 'html' => string], ...]

    // button.json 기반 버튼
    foreach ($plugins as $plugin_name) {
        foreach (_t2e_load_plugin_buttons($plugin_name) as $btn_def) {
            $btn_def['plugin'] = $btn_def['plugin'] ?? $plugin_name;
            $cmd = $btn_def['command'] ?? '';

            $order = 999;
            if (!empty($button_order) && ($pos = array_search($cmd, $button_order)) !== false) {
                $order = (int)$pos;
            } elseif (isset($btn_def['order'])) {
                $order = (int)$btn_def['order'];
            } elseif (isset($priority[$plugin_name])) {
                $order = (int)$priority[$plugin_name] * 10;
            }

            $plugin_buttons[] = ['order' => $order, 'html' => _t2e_render_button($btn_def)];
        }
    }

    // Legacy buttons ($T2EDITOR_LEGACY_BUTTONS) — same ordering logic as button.json
    foreach ($legacy_buttons as $btn_def) {
        $cmd = $btn_def['command'] ?? '';
        $plugin_name = $btn_def['plugin'] ?? '';

        $order = 999;
        if (!empty($button_order) && ($pos = array_search($cmd, $button_order)) !== false) {
            $order = (int)$pos;
        } elseif (isset($btn_def['order'])) {
            $order = (int)$btn_def['order'];
        } elseif (isset($priority[$plugin_name])) {
            $order = (int)$priority[$plugin_name] * 10;
        }

        $plugin_buttons[] = ['order' => $order, 'html' => _t2e_render_button($btn_def)];
    }

    // 정렬 (order ASC, 동점은 입력 순 유지)
    usort($plugin_buttons, fn($a, $b) => $a['order'] <=> $b['order']);
    foreach ($plugin_buttons as $pb) {
        $html .= $pb['html'];
    }

    return $html;
}

// 라이센스 검증 함수
function _t2e_hash($s) { return hash('sha256', $s); }
function _t2e_b64d($s) { return base64_decode($s); }
function _t2e_b64e($d) { return base64_encode($d); }

function _t2e_norm($s) {
    $s = preg_replace("/\r\n|\r|\n/", "\n", $s);
    $s = preg_replace("/[ \t]+/u", " ", $s);
    $s = preg_replace("/\n{2,}/u", "\n\n", $s);
    return trim($s);
}

function _t2e_extract_kor($content) {
    if (preg_match('/사용 권한:[\s\S]*?(?=제한사항:|배포 및 문의:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    if (preg_match('/사용 권한:[\s\S]*?b\)[\s\S]*?(?=(\n){2}|배포:|Usage Rights:|$)/iu', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    return '';
}

function _t2e_extract_eng($content) {
    if (preg_match('/Usage Rights:[\s\S]*?(?=Restrictions:|Distribution and Contact:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    if (preg_match('/Usage Rights:[\s\S]*?b\)[\s\S]*?(?=(\n){2}|Distribution:|$)/u', $content, $m)) {
        return _t2e_norm($m[0]);
    }
    return '';
}

function _t2e_extract_fileline($content) {
    if (preg_match('/The_first\.license_License_ko\.txt\s*&\s*License_en\.txt/i', $content, $m)) {
        return trim($m[0]);
    }
    if (strpos($content, 'The_first.license_License_ko.txt') !== false) {
        return 'The_first.license_License_ko.txt & License_en.txt';
    }
    return '';
}

function _t2e_validate_readme($path) {
    if (!file_exists($path)) return array(false, 'License file does not exist.');
    $content = file_get_contents($path);

    $kor_block = _t2e_extract_kor($content);
    $eng_block = _t2e_extract_eng($content);
    $file_line = _t2e_extract_fileline($content);

    if ($kor_block === '') return array(false, 'License content (KO) missing');
    if ($eng_block === '') return array(false, 'License content (EN) missing');
    if ($file_line === '') return array(false, 'License file reference info missing');

    $kor_hash = hash('sha256', $kor_block);
    $eng_hash = hash('sha256', $eng_block);
    $file_hash = hash('sha256', $file_line);

    $KOR_PARTS = [
        'ZDZkMWVmNGE=', 'YTRjMjNmMzM=', 'YTUzYzI3NDU=', 'OTgyZDU5NTU=',
        'ODIyNWEwZDM=', 'YWEyOTgxZTE=', 'YTA1Y2MzZmI=', 'MzRhY2U4ODU=',
    ];
    $ENG_PARTS = [
        'OGZlNmM2Y2Y=', 'ZWI5ZjJkZmY=', 'ZDJjMTkxMjQ=', 'MWVkY2E5ZDc=',
        'NjQwYmVhMDk=', 'Mjk2ZGU2MmE=', 'NTA2MWYwOWY=', 'NDgxMDczYTI=',
    ];
    $FILE_PARTS = [
        'Yzg0YmQxODA=', 'YmJmYTA4ZTc=', 'ZTUyYjIxNmE=', 'NGM3OTNhMmU=',
        'MDlkY2FiYTY=', 'MGU1NjAyZDU=', 'NzM4ZWZhNDc=', 'YWY1MTRiOTQ=',
    ];

    $rebuild = function($parts){
        $out = '';
        foreach($parts as $p){
            $d = base64_decode($p);
            $out .= strrev($d);
        }
        return $out;
    };

    $expected_kor = $rebuild($KOR_PARTS);
    $expected_eng = $rebuild($ENG_PARTS);
    $expected_file = $rebuild($FILE_PARTS);

    if (!hash_equals($expected_kor, $kor_hash)) return array(false, 'License content (KO) mismatch');
    if (!hash_equals($expected_eng, $eng_hash)) return array(false, 'License content (EN) mismatch');
    if (!hash_equals($expected_file, $file_hash)) return array(false, 'License file reference info mismatch');

    return array(true, '');
}

function _t2e_get_status() {
    $p = T2EDITOR_PATH . '/';
    $readme = $p . 'readme.txt';
    return _t2e_validate_readme($readme);
}

function get_readme_version() {
    $readme_path = T2EDITOR_PATH . '/readme.txt';
    if (file_exists($readme_path)) {
        $content = file_get_contents($readme_path);
        if (preg_match('/ver_([0-9.]+)/', $content, $matches)) {
            return $matches[1];
        }
    }
    return '';
}

// Security: escape only quotes, backslashes and line breaks in CSS URL strings.
// Do not rawurlencode the full base URL or its scheme/query structure will break.
function _t2e_css_url($url) {
    $url = str_replace('\\', '\\\\', $url);       // \ → \\ (반드시 먼저)
    $url = str_replace('"',  '\\"',  $url);        // " → \"
    $url = str_replace(["\n", "\r"], '', $url);    // 개행 제거
    return $url;
}

function _t2e_css_link($editor_url, $path, $ver) {
    // Security: URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');
    $can_minify = T2_CSS_MIN && rtrim((string)$editor_url, '/') === rtrim((string)T2EDITOR_BASE_URL, '/');
    if ($can_minify) {
        return '<link rel="stylesheet" href="' . $e_url . '/t2_css_min.php?f=' . $e_path . '&amp;v=' . $e_ver . '">';
    } else {
        return '<link rel="stylesheet" href="' . $e_url . '/' . $e_path . '?v=' . $e_ver . '">';
    }
}

function _t2e_js_script($editor_url, $path, $ver) {
    // Security: URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');

    // 데이터 릴리스와 데이터 확장 슬롯은 URL 자체가 불변 리비전을 포함한다.
    // 이 경우 파일별 stat/filemtime 호출을 하지 않고 런타임 ID를 공통 리비전으로
    // 사용한다. 직접 설치와 기본 복구 파일만 기존 수정 시각 방식을 유지한다.
    $revision = '';
    $normalized_path = str_replace('\\', '/', (string)$path);
    $normalized_url = rtrim((string)$editor_url, '/');
    $runtime_asset_url = defined('T2EDITOR_ASSET_URL') ? rtrim((string)T2EDITOR_ASSET_URL, '/') : '';
    $data_asset_url = defined('T2EDITOR_DB_URL') ? rtrim((string)T2EDITOR_DB_URL, '/') . '/t2pack/assets/' : '';
    if (defined('T2EDITOR_RUNTIME_ID') && (string)T2EDITOR_RUNTIME_ID !== 'base'
        && $runtime_asset_url !== '' && strpos($normalized_url . '/', $runtime_asset_url . '/') === 0) {
        $revision = (string)T2EDITOR_RUNTIME_ID;
    } elseif ($data_asset_url !== '' && strpos($normalized_url . '/', $data_asset_url) === 0) {
        $revision = 'immutable';
    } elseif (strpos($normalized_path, '..') === false) {
        $asset_file = '';
        if (defined('T2EDITOR_BASE_URL') && strpos($normalized_url . '/', rtrim((string)T2EDITOR_BASE_URL, '/') . '/') === 0) {
            $asset_file = rtrim((string)T2EDITOR_BASE_PATH, '/\\') . '/' . ltrim($normalized_path, '/');
        } elseif (defined('T2EDITOR_PATH')) {
            $asset_file = rtrim((string)T2EDITOR_PATH, '/\\') . '/' . ltrim($normalized_path, '/');
        }
        if ($asset_file !== '' && is_file($asset_file)) {
            $mtime = @filemtime($asset_file);
            if ($mtime !== false) $revision = (string)$mtime;
        }
    }
    $revision_query = $revision !== ''
        ? '&amp;r=' . htmlspecialchars($revision, ENT_QUOTES, 'UTF-8')
        : '';

    $can_minify = T2_JS_MIN && rtrim((string)$editor_url, '/') === rtrim((string)T2EDITOR_BASE_URL, '/');
    if ($can_minify) {
        return '<script src="' . $e_url . '/t2_js_min.php?f=' . $e_path . '&amp;v=' . $e_ver . $revision_query . '"></script>';
    } else {
        return '<script src="' . $e_url . '/' . $e_path . '?v=' . $e_ver . $revision_query . '"></script>';
    }
}

function _t2e_current_admin_link() {
    static $resolved = false;
    static $url = null;
    if ($resolved) return $url;
    $resolved = true;

    $authFile = T2EDITOR_PATH . '/config/t2_cms_auth.php';
    if (!is_file($authFile)) return null;
    $sessionWasActive = session_status() === PHP_SESSION_ACTIVE;
    try {
        require_once $authFile;
        // Local-auth guests without a session cookie cannot be authorized. Avoid creating
        // a PHP session for every public editor render just to prove that negative.
        if (function_exists('t2editor_admin_requires_local_credentials')
            && t2editor_admin_requires_local_credentials()) {
            // A session closed earlier in the same request still leaves its verified data in $_SESSION.
            if (!empty($_SESSION['t2admin_logged_in']) && $_SESSION['t2admin_logged_in'] === true) {
                return rtrim((string)T2EDITOR_URL, '/') . '/admin/';
            }
            if (!$sessionWasActive) {
                $sessionCookie = session_name();
                if ($sessionCookie === '' || empty($_COOKIE[$sessionCookie])) return null;
            }
        }
        if (function_exists('t2editor_admin_is_authorized') && t2editor_admin_is_authorized()) {
            $url = rtrim((string)T2EDITOR_URL, '/') . '/admin/';
        }
    } catch (Throwable $e) {
        error_log('[T2Editor] Admin-link authorization check failed: ' . $e->getMessage());
    }
    if (!$sessionWasActive && session_status() === PHP_SESSION_ACTIVE && function_exists('t2editor_admin_session_unlock')) {
        t2editor_admin_session_unlock();
    }
    return $url;
}

function editor_html($id, $content, $is_dhtml_editor=true) {
    global $config, $T2EDITOR_PLUGINS, $T2EDITOR_PLUGIN_PRIORITY,
           $T2EDITOR_BUTTON_ORDER, $T2EDITOR_LEGACY_BUTTONS;

    static $js = true;

    // Be defensive against third-party loaders and cached template scopes.
    $T2EDITOR_PLUGINS = is_array($T2EDITOR_PLUGINS ?? null) ? $T2EDITOR_PLUGINS : [];
    $T2EDITOR_PLUGIN_PRIORITY = is_array($T2EDITOR_PLUGIN_PRIORITY ?? null) ? $T2EDITOR_PLUGIN_PRIORITY : [];
    $T2EDITOR_BUTTON_ORDER = is_array($T2EDITOR_BUTTON_ORDER ?? null) ? $T2EDITOR_BUTTON_ORDER : [];
    $T2EDITOR_LEGACY_BUTTONS = is_array($T2EDITOR_LEGACY_BUTTONS ?? null) ? $T2EDITOR_LEGACY_BUTTONS : [];

    list($valid, $msg) = _t2e_get_status();
    if (!$valid) {
        return '<div class="alert alert-danger"><strong>Error:</strong> '.$msg.'</div>';
    }

    $editor_url = defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : T2EDITOR_URL;
    $endpoint_url = T2EDITOR_URL;
    $ver = get_readme_version();
    $t2_admin_url = _t2e_current_admin_link();
    $t2_local_admin_url = (function_exists('t2editor_admin_requires_local_credentials')
        && t2editor_admin_requires_local_credentials())
        ? rtrim((string)T2EDITOR_URL, '/') . '/admin/'
        : null;
    $t2_local_admin_authorized = $t2_local_admin_url !== null && $t2_admin_url !== null;


    $html = "<span class=\"sound_only\" style=\"display:none\">" . htmlspecialchars(
        (function_exists('t2editor_detect_user_lang') && function_exists('t2editor_get_messages'))
            ? (t2editor_get_messages(t2editor_detect_user_lang())['editor.start'] ?? '웹에디터 시작')
            : '웹에디터 시작',
        ENT_QUOTES, 'UTF-8'
    ) . "</span>";

    if ($js && $ver) {
        // Core CSS
        $html .= "\n" . _t2e_css_link($editor_url, 'css/core.css', $ver);
        $html .= "\n" . _t2e_css_link($editor_url, 'css/dark.css', $ver);
        if (function_exists('t2_extend_asset_files')) {
            foreach (t2_extend_asset_files('css') as $_t2_ext_css) {
                $html .= "\n" . _t2e_css_link(dirname((string)$_t2_ext_css['url']), basename((string)$_t2_ext_css['url']), $ver);
            }
            unset($_t2_ext_css);
        }

        $sorted_plugins = [];
        foreach ($T2EDITOR_PLUGINS as $plugin) {
            $priority = isset($T2EDITOR_PLUGIN_PRIORITY[$plugin]) ? $T2EDITOR_PLUGIN_PRIORITY[$plugin] : 999;
            if (!isset($sorted_plugins[$priority])) $sorted_plugins[$priority] = [];
            $sorted_plugins[$priority][] = $plugin;
        }
        ksort($sorted_plugins);

        // Main plugin scripts are loaded only by core.js priority loading; eager output caused duplicate ES6 class declarations.
        // hooks.js remains eager so submit/restore hooks exist before form submission.
        $plugin_scripts = "";
        foreach ($sorted_plugins as $priority_val => $plugins_in_group) {
            foreach ($plugins_in_group as $plugin) {
                $_t2_plugin_desc = function_exists('t2_extend_plugin_descriptor') ? t2_extend_plugin_descriptor($plugin) : null;
                $_t2_plugin_path = is_array($_t2_plugin_desc) ? rtrim((string)$_t2_plugin_desc['path'], '/\\') : T2EDITOR_PATH . '/plugin/' . $plugin;
                $_t2_plugin_url = is_array($_t2_plugin_desc) && !empty($_t2_plugin_desc['url']) ? rtrim((string)$_t2_plugin_desc['url'], '/') : $editor_url . '/plugin/' . rawurlencode($plugin);
                if (file_exists($_t2_plugin_path . "/{$plugin}.css")) {
                    $html .= "\n" . _t2e_css_link($_t2_plugin_url, $plugin . '.css', $ver);
                }
                // hooks.js — submit/restore 훅 등록소. 존재할 때만 자동 로드.
                if (file_exists($_t2_plugin_path . "/hooks.js")) {
                    $plugin_scripts .= "\n" . _t2e_js_script($_t2_plugin_url, 'hooks.js', $ver);
                }
                unset($_t2_plugin_desc, $_t2_plugin_path, $_t2_plugin_url);
            }
        }

        // I18N bootstrap values must be emitted before i18n.js or it initializes with an empty catalog.
        $t2_i18n_enabled = defined('T2EDITOR_I18N_ENABLED') ? (bool)T2EDITOR_I18N_ENABLED : true;
        $t2_i18n_supported = function_exists('t2editor_get_supported_langs')
            ? t2editor_get_supported_langs() : array();
        $t2_i18n_default = function_exists('t2editor_get_default_lang')
            ? t2editor_get_default_lang()
            : (!empty($t2_i18n_supported) ? (string)$t2_i18n_supported[0] : 'en');
        // 클라이언트 주입값은 실제 쿠키/Accept-Language 일치가 있을 때만 설정한다.
        // 일치가 없으면 null을 내려 i18n.js가 navigator.languages를 검사하고,
        // 그것도 지원되지 않으면 영어 기본값으로 폴백한다.
        $t2_user_lang = function_exists('t2editor_detect_requested_lang')
            ? t2editor_detect_requested_lang()
            : (function_exists('t2editor_detect_user_lang') ? t2editor_detect_user_lang() : null);
        // 초기 HTML에는 실제 시작 언어와 필요한 기본 폴백만 포함한다.
        // 나머지 언어는 설치 시 생성한 정적 JSON을 언어 전환 시 지연 로드한다.
        $t2_initial_lang = $t2_user_lang !== null ? $t2_user_lang : $t2_i18n_default;
        $t2_initial_messages = array();
        if (function_exists('t2editor_get_messages')) {
            $t2_initial_messages[$t2_initial_lang] = t2editor_get_messages($t2_initial_lang);
            if ($t2_i18n_default !== $t2_initial_lang) {
                $t2_initial_messages[$t2_i18n_default] = t2editor_get_messages($t2_i18n_default);
            }
        }
        $t2_locale_urls = function_exists('t2editor_i18n_locale_urls') ? t2editor_i18n_locale_urls() : array();
        $t2_locale_endpoint = $endpoint_url . '/config/get_locale.php';
        $t2_polyfill_script_url = defined('T2EDITOR_I18N_POLYFILL_URL')
            ? T2EDITOR_I18N_POLYFILL_URL
            : $editor_url . '/vendor/formatjs/t2i18n-polyfill.js';
        $t2_lang_display = function_exists('t2editor_get_language_display_map')
            ? t2editor_get_language_display_map() : array();
        $t2_locale_aliases = function_exists('t2editor_get_locale_aliases')
            ? t2editor_get_locale_aliases() : array();
        $t2_locale_fallbacks = function_exists('t2editor_get_locale_fallbacks')
            ? t2editor_get_locale_fallbacks() : array();
        $t2_locale_directions = function_exists('t2editor_get_locale_directions')
            ? t2editor_get_locale_directions() : array();
        $t2_locale_registry = function_exists('t2editor_get_public_locale_registry')
            ? t2editor_get_public_locale_registry() : array();

        $html .= "\n<script>"
               . "window.T2EDITOR_I18N_ENABLED = " . ($t2_i18n_enabled ? 'true' : 'false') . ";"
               . "window.T2EDITOR_I18N_DEFAULT_LANG = " . json_encode($t2_i18n_default, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_SUPPORTED_LANGS = " . json_encode($t2_i18n_supported, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_USER_LANG = " . json_encode($t2_user_lang, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_MESSAGES = " . json_encode($t2_initial_messages, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";"
               . "window.T2EDITOR_I18N_LOCALE_URLS = " . json_encode($t2_locale_urls, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";"
               . "window.T2EDITOR_I18N_LOCALE_ENDPOINT = " . json_encode($t2_locale_endpoint, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";"
               . "window.T2EDITOR_I18N_FALLBACK_URL = " . json_encode($t2_locale_endpoint . '?all=1', JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";"
               . "window.T2EDITOR_I18N_POLYFILL_URL = " . json_encode($t2_polyfill_script_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_LANG_DISPLAY = " . json_encode($t2_lang_display, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";"
               . "window.T2EDITOR_I18N_ALIASES = " . json_encode($t2_locale_aliases, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_FALLBACKS = " . json_encode($t2_locale_fallbacks, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_DIRECTIONS = " . json_encode($t2_locale_directions, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_REGISTRY = " . json_encode($t2_locale_registry, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";"
               . "</script>";

        $html .= "\n" . _t2e_js_script($editor_url, 'js/utils.js', $ver);
        $html .= "\n" . _t2e_js_script($editor_url, 'integration/cms/browser.js', $ver);
        $html .= "\n" . _t2e_js_script($editor_url, 'integration/cms/legacy-browser-api.js', $ver);
        $html .= "\n" . _t2e_js_script($editor_url, 'vendor/formatjs/t2i18n-polyfill.js', $ver);  // [I18N] FormatJS 호환 폴리필 (자체호스팅) — i18n.js보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/i18n.js', $ver);  // [I18N] 번역 코어 (polyfill 다음, hooks 이전)
        $html .= "\n<script>if (window.T2I18N && typeof window.T2I18N.hydrateFromGlobals === 'function') { window.T2I18N.hydrateFromGlobals(); }</script>";
            $html .= "\n" . _t2e_js_script($editor_url, 'js/hooks.js', $ver);  // [v10.0.0] 훅 등록소
        $html .= "\n" . _t2e_js_script($editor_url, 'js/format-engine.js', $ver);  // [MODERNIZATION] Selection/Range 기반 서식 엔진, core.js 보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/document-model.js', $ver);  // [MODERNIZATION] Plan/Apply 기반 블록 재조정 계층, core.js 보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/core.js', $ver);
        $html .= $plugin_scripts;

        // merged /extend/js automatic loading
        if (function_exists('t2_extend_asset_files')) {
            foreach (t2_extend_asset_files('js') as $_t2_ext_js) {
                $html .= "\n" . _t2e_js_script(dirname((string)$_t2_ext_js['url']), basename((string)$_t2_ext_js['url']), $ver);
            }
            unset($_t2_ext_js);
        }

        //$html .= "\n" . _t2e_js_script($editor_url, 'js/legacy_fallback.js', $ver);  // 레거시 fallback 캡슐(Ver 10.1.0: 주석처리)

        $readme_path = T2EDITOR_PATH . '/readme.txt';
        $readme_contents = file_exists($readme_path) ? file_get_contents($readme_path) : '';
        $license_token = _t2e_hash($readme_contents . $editor_url);

        // T2_MIGRATION_MODE PHP 상수 → JS 변수 변환
        // false는 JSON false, 문자열은 JSON 문자열로 직렬화
        // Security: JSON_HEX_TAG: </script> 탈출 방지
        $migration_mode_js = (T2_MIGRATION_MODE === false) ? 'false' : json_encode(T2_MIGRATION_MODE, JSON_HEX_TAG | JSON_HEX_AMP);

        $html .= "\n<script>";
        // Security: 아래 모든 json_encode에 JSON_HEX_TAG | JSON_HEX_AMP 플래그 적용.
        // T2EDITOR_URL 등 URL 상수는 관리자 설정에 따라 변경될 수 있으므로
        // </script> 삽입으로 인한 스크립트 탈출을 방지.
        $html .= "window.T2EDITOR_LICENSE_TOKEN = " . json_encode($license_token, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGINS = " . json_encode($T2EDITOR_PLUGINS, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGIN_PRIORITY = " . json_encode($T2EDITOR_PLUGIN_PRIORITY, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_URL = " . json_encode($endpoint_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_ASSET_URL = " . json_encode($editor_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $_t2_plugin_urls = array();
        $_t2_plugin_sizes = array();
        foreach ($T2EDITOR_PLUGINS as $_t2_plugin_name) {
            $_t2_desc = function_exists('t2_extend_plugin_descriptor') ? t2_extend_plugin_descriptor($_t2_plugin_name) : null;
            $_t2_plugin_urls[$_t2_plugin_name] = is_array($_t2_desc) && !empty($_t2_desc['url'])
                ? rtrim((string)$_t2_desc['url'], '/') : rtrim($editor_url, '/') . '/plugin/' . rawurlencode($_t2_plugin_name);
            $_t2_plugin_dir = is_array($_t2_desc) && !empty($_t2_desc['path'])
                ? rtrim((string)$_t2_desc['path'], '/\\') : rtrim(T2EDITOR_PATH, '/\\') . '/plugin/' . $_t2_plugin_name;
            $_t2_plugin_file = $_t2_plugin_dir . '/' . $_t2_plugin_name . '.js';
            $_t2_plugin_sizes[$_t2_plugin_name] = is_file($_t2_plugin_file) ? (int)@filesize($_t2_plugin_file) : null;
        }
        $html .= "window.T2EDITOR_PLUGIN_URLS = " . json_encode($_t2_plugin_urls, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";";
        $html .= "window.T2EDITOR_PLUGIN_SIZES = " . json_encode($_t2_plugin_sizes, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        unset($_t2_plugin_urls, $_t2_plugin_sizes, $_t2_plugin_name, $_t2_plugin_dir, $_t2_plugin_file, $_t2_desc);
        // 동적 import 및 지연 로딩 플러그인에도 동일한 캐시 버전을 적용한다.
        $html .= "window.T2EDITOR_ASSET_VERSION = " . json_encode($ver, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_MIGRATION_MODE = " . $migration_mode_js . ";";
        $html .= "window.T2EDITOR_VIDEO_PLAYER_ENABLED = " . (T2_VIDEO_PLAYER_ENABLED ? 'true' : 'false') . ";";
        // NSFW 필터 설정 — image.js 에서 참조
        $html .= "window.T2EDITOR_NSFW_ENABLED = " . (T2_NSFW_ENABLED ? 'true' : 'false') . ";";
        $html .= "window.T2EDITOR_NSFW_MODE = " . json_encode(T2_NSFW_MODE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS = " . (T2_NSFW_ALLOW_SUSPICIOUS ? 'true' : 'false') . ";";
        // 기본 상수와 관리자 저장값이 합쳐진 실제 런타임 상태를 콘솔에서 즉시 확인할 수 있게 한다.
        $effectiveNsfwConfig = [
            'enabled' => (bool)T2_NSFW_ENABLED,
            'mode' => (string)T2_NSFW_MODE,
            'allowSuspicious' => (bool)T2_NSFW_ALLOW_SUSPICIOUS,
        ];
        $html .= "window.T2EDITOR_NSFW_EFFECTIVE_CONFIG = Object.freeze(" . json_encode($effectiveNsfwConfig, JSON_HEX_TAG | JSON_HEX_AMP) . ");";
        $nsfwAssetBase = rtrim((string)T2_NSFW_RUNTIME_ASSET_BASE, '/');
        $nsfwBackendPriority = array_values(array_filter(array_map('trim', explode(',', T2_NSFW_BROWSER_BACKEND_PRIORITY))));
        $nsfwRuntimeAssets = [
            'tfjs' => $nsfwAssetBase . '/tfjs/tf.min.js',
            'webgl' => $nsfwAssetBase . '/tfjs-backend-webgl/tf-backend-webgl.min.js',
            'webgpu' => $nsfwAssetBase . '/tfjs-backend-webgpu/tf-backend-webgpu.min.js',
            'wasm' => $nsfwAssetBase . '/tfjs-backend-wasm/tf-backend-wasm.min.js',
            'wasmBase' => $nsfwAssetBase . '/tfjs-backend-wasm/',
            'nsfwjs' => $nsfwAssetBase . '/nsfwjs/nsfwjs.min.js',
        ];

        // 자체 호스팅 graph model은 model.json뿐 아니라 weightsManifest의 모든 shard가
        // 함께 있어야 한다. 기본 로컬 모델이 불완전하면 원격 기본 모델로 조용히
        // 우회하지 않고, 누락 파일을 브라우저에 전달해 정확한 배포 오류를 표시한다.
        $nsfwModelUrl = trim((string)T2_NSFW_BROWSER_MODEL_URL);
        $nsfwModelMissingFiles = [];
        $defaultModelUrl = $nsfwAssetBase . '/nsfwjs/models/mobilenet_v2_mid/model.json';
        if (rtrim($nsfwModelUrl, '/') === rtrim($defaultModelUrl, '/')) {
            $modelRoot = rtrim((string)T2EDITOR_PATH, '/\\') . '/vendor/nsfwjs/models/mobilenet_v2_mid';
            $modelFile = $modelRoot . '/model.json';
            if (!is_file($modelFile)) {
                $nsfwModelMissingFiles[] = 'model.json';
            } else {
                $modelJson = @json_decode((string)@file_get_contents($modelFile), true);
                if (!is_array($modelJson) || empty($modelJson['weightsManifest']) || !is_array($modelJson['weightsManifest'])) {
                    $nsfwModelMissingFiles[] = 'weightsManifest';
                } else {
                    foreach ($modelJson['weightsManifest'] as $manifestGroup) {
                        foreach ((array)($manifestGroup['paths'] ?? []) as $weightPath) {
                            $weightPath = ltrim(str_replace('\\', '/', (string)$weightPath), '/');
                            if ($weightPath === '' || strpos($weightPath, '..') !== false || !is_file($modelRoot . '/' . $weightPath)) {
                                $nsfwModelMissingFiles[] = $weightPath !== '' ? $weightPath : '(empty shard path)';
                            }
                        }
                    }
                }
            }
            $nsfwModelMissingFiles = array_values(array_unique($nsfwModelMissingFiles));
        }

        $html .= "window.T2EDITOR_NSFW_SERVER_URL = " . json_encode(rtrim($endpoint_url, '/') . '/config/nsfw_api_server.php', JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $nsfwBrowserUrl = rtrim($editor_url, '/') . '/config/nsfw_api_browser.js?v=' . rawurlencode((string)$ver);
        // 일부 host rewrite는 정적 ES module 요청만 라우터로 넘겨 HTML/404를
        // 반환한다. 기본 정적 URL을 유지하되, 실패 시 실행 중인 런타임의 같은
        // 모듈을 올바른 MIME으로 전달하는 PHP 엔드포인트를 사용한다.
        $nsfwBrowserFallbackUrl = rtrim($endpoint_url, '/') . '/config/nsfw_api_browser.php?v=' . rawurlencode((string)$ver);
        $html .= "window.T2EDITOR_NSFW_ASSET_BASE = " . json_encode($nsfwAssetBase, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_URL = " . json_encode($nsfwBrowserUrl, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_FALLBACK_URL = " . json_encode($nsfwBrowserFallbackUrl, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL = " . json_encode(T2_NSFW_BROWSER_MODEL, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_TYPE = " . json_encode(T2_NSFW_BROWSER_MODEL_TYPE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_URL = " . json_encode($nsfwModelUrl, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_MODEL_FILES_OK = " . ($nsfwModelMissingFiles ? 'false' : 'true') . ";";
        $html .= "window.T2EDITOR_NSFW_MODEL_MISSING_FILES = " . json_encode($nsfwModelMissingFiles, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY = " . json_encode($nsfwBackendPriority, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_RUNTIME_ASSETS = " . json_encode($nsfwRuntimeAssets, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES) . ";";

        // Developer setting: window.T2EDITOR_UPLOAD_CONFIG is generated solely by get_js_config().
        // Keep its maxSizeMB/extensions/accept/mimeMap shape aligned with the fallback endpoint and plugins.
        if (function_exists('get_js_config')) {
            $html .= "window.T2EDITOR_UPLOAD_CONFIG = "
                   . json_encode(get_js_config(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";
        }

        // /extend/php/t2_first_run_setup.php가 제공하는 최초 설치 안내 부트스트랩.
        // 상세 서버 정보는 여기에 직접 노출하지 않고 단기 서명 토큰과 API 주소만
        // 전달한다. 완료 상태는 공용 데이터의 t2editor_db/first_run_state.php에
        // 저장되며, 완료 전에는 외부 안내 JS가 준비되는 짧은 순간도 편집을 막는다.
        if (function_exists('t2_first_run_client_bootstrap')) {
            $_t2_first_run_bootstrap = t2_first_run_client_bootstrap();
            $html .= "window.T2EDITOR_FIRST_RUN_BOOTSTRAP = "
                   . json_encode($_t2_first_run_bootstrap, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";
            if (!empty($_t2_first_run_bootstrap['required'])) {
                $html .= "document.documentElement.classList.add('t2-first-run-pending');";
            }
            $html .= "window.dispatchEvent(new Event('t2editor:first-run-bootstrap'));";
            unset($_t2_first_run_bootstrap);
        }

        // Developer setting: iframe domains come from t2editor_get_allowed_iframe_domains() in t2_config.php.
        // Add service domains there; the current hostname is appended client-side. Do not duplicate a local allowlist here.
        if (function_exists('t2editor_get_allowed_iframe_domains')) {
            // t2_config.php 에 함수가 정의된 경우 (권장 경로)
            $t2_allowed_iframe_domains = t2editor_get_allowed_iframe_domains();
        } else {
            // fallback: t2_config.php 가 아직 함수를 정의하지 않은 구버전 호환
            $t2_builtin_iframe_domains = [
                'youtube.com', 'www.youtube.com', 'm.youtube.com',
                'youtu.be',
                'youtube-nocookie.com', 'www.youtube-nocookie.com',
                'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
                'dailymotion.com', 'www.dailymotion.com', 'geo.dailymotion.com',
                'twitch.tv', 'www.twitch.tv', 'player.twitch.tv', 'clips.twitch.tv',
                'tiktok.com', 'www.tiktok.com',
                'tv.kakao.com', 'play.kakao.com',
                'tv.naver.com',
                'streamable.com', 'embed.streamable.com',
                'wistia.com', 'fast.wistia.com', 'wistia.net', 'fast.wistia.net',
                'w.soundcloud.com',
                'open.spotify.com',
                'player.bilibili.com',
                'rumble.com', 'www.rumble.com',
                'www.loom.com',
                'embed.vidyard.com', 'play.vidyard.com',
                'gfycat.com', 'www.gfycat.com',
                'coub.com', 'www.coub.com',
            ];
            $t2_user_extra_domains = is_array(T2EDITOR_ALLOWED_URL_DOMAINS)
                ? array_values(array_filter(T2EDITOR_ALLOWED_URL_DOMAINS, 'is_string'))
                : [];
            $t2_allowed_iframe_domains = array_values(array_unique(
                array_merge($t2_builtin_iframe_domains, $t2_user_extra_domains)
            ));
        }

        // Current server domain is auto-added by the client (location.hostname).
        $html .= "window.T2EDITOR_ALLOWED_IFRAME_DOMAINS = "
               . json_encode($t2_allowed_iframe_domains, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";

        // I18N: 위 값들은 i18n.js 로드 전에 이미 bootstrap script로 주입됨.
        // 여기서 다시 덮어쓰지 않는다. (로드 순서가 늦으면 빈 카탈로그로 초기화되는 회귀 방지)

        $html .= "</script>";

        $js = false;
    }

    if ($is_dhtml_editor) {
        // Security: protect ampersands inside <code> before html_entity_decode so encoded closing tags stay text.
        // The pre-decode content contains no literal < inside code, which keeps the narrow matcher safe.
        if (strpos($content, '<code') !== false) {
            $content = preg_replace_callback(
                '/<code([^>]*)>([^<]*)<\/code>/si',
                function ($m) {
                    // & → &amp; : decode 후에도 엔티티 이스케이프 유지 (이중 인코딩)
                    return '<code' . $m[1] . '>' . str_replace('&', '&amp;', $m[2]) . '</code>';
                },
                $content
            );
        }
        $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // Security: embed values with json_encode(JSON_HEX_TAG | JSON_HEX_AMP), not manual replacement.
        $json_content = json_encode($content, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

        // Security: $id를 HTML 속성에 삽입 전 이스케이프
        $safe_id = htmlspecialchars($id, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $t2_editor_content_height = max(200, min(2000, (int)T2EDITOR_CONTENT_HEIGHT));

        ob_start(); ?>
<script>
// Security: JSON_HEX_TAG: T2EDITOR_URL 의 <\/script> 조기 종료 차단
const t2editor_url = <?php echo json_encode(T2EDITOR_URL ?? "", JSON_HEX_TAG | JSON_HEX_AMP); ?>;
</script>
<?php
// Host adapters emit only their own browser bridge and page-specific patches.
if (function_exists('t2editor_cms_editor_bootstrap_html')) {
    echo t2editor_cms_editor_bootstrap_html();
}

if (isset($_SERVER['HTTP_USER_AGENT']) && stripos($_SERVER['HTTP_USER_AGENT'], 'Android') !== false) {
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">' . "\n";
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">' . "\n";
}
?>

<script>

(function() {
    const T2EditorConfig = {
        // extend/php 가 정의한 PHP 상수를 우선 사용 — 미설정 시 기존 기본값
        enableDarkModeButton: <?php echo defined('T2_DARKMODE_BUTTON_ENABLED') ? (T2_DARKMODE_BUTTON_ENABLED ? 'true' : 'false') : 'true'; ?>,
        //enableDarkModeButton: 다크모드 전환 버튼 표시 여부 (true: 표시, false: 숨김)
        forcedTheme: <?php echo (defined('T2_DARKMODE_FORCED_THEME') && T2_DARKMODE_FORCED_THEME !== null) ? json_encode(T2_DARKMODE_FORCED_THEME, JSON_HEX_TAG) : 'null'; ?>
        //forcedTheme: 테마 강제 설정 (null: 사용자 설정/시스템 따름, 'dark': 다크모드 고정, 'light': 라이트모드 고정)
    };

    var root = document.documentElement;
    var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var forcedTheme = T2EditorConfig.forcedTheme === 'dark' || T2EditorConfig.forcedTheme === 'light'
        ? T2EditorConfig.forcedTheme : null;
    // 수동 선택은 현재 문서에서만 유지한다. 새 로드와 브라우저/OS 테마 변경은
    // 항상 최신 prefers-color-scheme 값을 다시 사용한다.
    var manualTheme = null;

    function systemTheme() {
        return media && media.matches ? 'dark' : 'light';
    }

    function updateControls() {
        var visible = T2EditorConfig.enableDarkModeButton && !forcedTheme;
        document.querySelectorAll('.t2-dark-mode-toggle').forEach(function(toggle) {
            toggle.style.display = visible ? 'flex' : 'none';
        });
    }

    function applyTheme(theme, source) {
        theme = theme === 'dark' ? 'dark' : 'light';
        var previous = root.getAttribute('data-t2editor-theme');
        root.setAttribute('data-t2editor-theme', theme);
        root.style.colorScheme = theme;
        updateControls();
        if (previous !== theme) {
            document.dispatchEvent(new CustomEvent('t2editor:themechange', {
                detail: { theme: theme, source: source || 'sync' }
            }));
        }
        return theme;
    }

    function syncTheme(source) {
        return applyTheme(forcedTheme || manualTheme || systemTheme(), source);
    }

    function onSystemThemeChange() {
        // 시스템 테마가 실제로 바뀌면 오래된 수동 상태보다 현재 사용자 환경을 우선한다.
        manualTheme = null;
        syncTheme('system');
    }

    // 10.4.0 이전 값이 시스템 테마를 영구적으로 가로막지 않게 폐기한다.
    try { localStorage.removeItem('t2editor-dark-mode'); } catch (e) {}

    if (media) {
        if (typeof media.addEventListener === 'function') media.addEventListener('change', onSystemThemeChange);
        else if (typeof media.addListener === 'function') media.addListener(onSystemThemeChange);
    }

    window.addEventListener('pageshow', function(event) {
        if (event.persisted) manualTheme = null;
        syncTheme(event.persisted ? 'bfcache' : 'pageshow');
    });

    window.T2EditorTheme = {
        getTheme: function() { return root.getAttribute('data-t2editor-theme') || syncTheme('read'); },
        sync: function() { return syncTheme('sync'); },
        followSystem: function() { manualTheme = null; return syncTheme('system'); },
        toggle: function() {
            if (forcedTheme) return syncTheme('forced');
            manualTheme = (root.getAttribute('data-t2editor-theme') === 'dark') ? 'light' : 'dark';
            return applyTheme(manualTheme, 'manual');
        },
        setForcedTheme: function(theme) {
            forcedTheme = theme === 'dark' || theme === 'light' ? theme : null;
            manualTheme = null;
            return syncTheme(forcedTheme ? 'forced' : 'system');
        }
    };

    syncTheme(forcedTheme ? 'forced' : 'system');
    document.addEventListener('DOMContentLoaded', updateControls);
})();
</script>

<style>
@font-face {
  font-family: "Material Icons";
  font-style: normal;
  font-weight: 400;
  src: url("<?php echo _t2e_css_url(defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff2?v=0.14.15") format("woff2");
  font-display: block;
}
.material-icons {
  font-family: "Material Icons";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  display: inline-block;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  white-space: nowrap;
  direction: ltr;
  -webkit-font-feature-settings: "liga";
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  -moz-osx-font-smoothing: grayscale;
}

@font-face {
  font-family: "Material Icons Outlined";
  font-style: normal;
  font-weight: 400;
  src: url("<?php echo _t2e_css_url(defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : T2EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2?v=0.14.15") format("woff2");
  font-display: block;
}

.material-icons-outlined {
  font-family: "Material Icons Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: "liga";
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
</style>

<div class="t2-editor-container" id="<?php echo $safe_id ?>_container" style="--t2-editor-content-height:<?php echo (int)$t2_editor_content_height ?>px">
    <div class="t2-toolbar">
        <?php echo _t2e_build_toolbar_html(
            $T2EDITOR_PLUGINS,
            $T2EDITOR_PLUGIN_PRIORITY,
            $T2EDITOR_BUTTON_ORDER,
            $T2EDITOR_LEGACY_BUTTONS
        ); ?>
    </div>
    <div class="t2-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" autocapitalize="sentences" id="<?php echo $safe_id ?>_editor"></div>
	<textarea name="<?php echo $safe_id ?>" id="<?php echo $safe_id ?>" style="display:none;"><?php
        // Security: $content를 textarea HTML 컨텍스트에 맞게 이스케이프.
        // </textarea> 등의 삽입으로 인한 HTML injection 방지.
        echo htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
	?></textarea>
	<div class="t2-editor-status">
		<div class="t2-status-left">
            <a href="//dsclub.kr/service/editor" style="text-decoration: none !important; color: inherit !important;" onclick="this.style.color='inherit';" onmouseover="this.style.color='inherit';" onmouseout="this.style.color='inherit';">
                <div class="t2-logo" aria-label="T2Editor logo"><span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span></div>
            </a>
        </div>
        <div class="t2-dark-mode-toggle">
                <div class="t2-char-count">txt: <span>0</span></div>
            <button type="button" class="t2-dark-mode-btn" onclick="toggleT2EditorTheme(event)" aria-label="dark mode toggle">
                <span class="material-icons t2-dark-mode-icon">dark_mode</span>
                <span class="material-icons t2-light-mode-icon">light_mode</span>
            </button>
        </div>
        <?php if (defined('T2EDITOR_I18N_ENABLED') ? T2EDITOR_I18N_ENABLED : true): ?>
        <div class="t2-translate-toggle" id="<?php echo $safe_id ?>_translate_toggle">
            <button type="button" class="t2-translate-btn" onclick="toggleT2EditorTranslate(event)" aria-label="translation toggle">
                <span class="material-icons t2-translate-icon">translate</span>
            </button>
            <div class="t2-translate-menu" id="<?php echo $safe_id ?>_translate_menu" hidden>
                <div class="t2-translate-menu-title"></div>
                <ul class="t2-translate-menu-list"></ul>
            </div>
        </div>
        <?php endif; ?>
    </div>
    <div class="t2-editor-meta-links">
        <?php if ($t2_admin_url !== null): ?>
        <a class="t2-admin-link"
           href="<?php echo htmlspecialchars($t2_admin_url, ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?>"
           aria-label="T2Editor 관리자 페이지로 이동">T2E_Admin</a>
        <?php endif; ?>
        <span id="<?php echo $safe_id ?>_version_info"
              class="t2-debug-trigger"
              role="button" tabindex="0"
              onclick="showT2DebugModal(event, '<?php echo $safe_id ?>')"
              onkeydown="if(event.key==='Enter'||event.key===' '){showT2DebugModal(event, '<?php echo $safe_id ?>');}"
              aria-label="에디터 디버그 정보 보기">
            <i class="material-icons-outlined" aria-hidden="true">info</i>
            <?php
            $v = get_readme_version();
            // I18N: 버전 표시 — 번역 키가 있으면 사용, 없으면 기존 로직
            if (function_exists('t2editor_detect_user_lang') && function_exists('t2editor_get_messages')) {
                $user_lang = t2editor_detect_user_lang();
                $messages = t2editor_get_messages($user_lang);
                $version_key = 'editor.version_label';
                if (isset($messages[$version_key])) {
                    echo htmlspecialchars(str_replace('{ver}', $v, $messages[$version_key]), ENT_QUOTES, 'UTF-8');
                } else {
                    echo (strpos($v, 'Error') !== false || strpos($v, '오류') !== false) ? $v : "T2Editor Ver $v";
                }
            } else {
                echo (strpos($v, 'Error') !== false || strpos($v, '오류') !== false) ? $v : "T2Editor Ver $v";
            }
        ?>
        </span>
    </div>
</div>

<!-- [DEBUG-MODAL] 모바일 웹 디버깅용 모달 — 버전 정보(i) 클릭 시 노출.
     개발자도구를 쓰기 어려운 모바일 환경에서 현재 에디터가 들고 있는
     콘텐츠 상태(특히 비디오 블록의 style vs data-* 불일치 여부)를
     즉시 눈으로 확인하고 복사할 수 있게 한다. -->
<div class="t2-debug-modal-backdrop" id="<?php echo $safe_id ?>_debug_modal" hidden
     onclick="if(event.target===this){closeT2DebugModal('<?php echo $safe_id ?>');}">
    <div class="t2-debug-modal" role="dialog" aria-modal="true" aria-labelledby="<?php echo $safe_id ?>_debug_modal_title">
        <div class="t2-debug-modal-header">
            <strong id="<?php echo $safe_id ?>_debug_modal_title">T2Editor 디버그 정보</strong>
            <button type="button" class="t2-debug-modal-close" aria-label="닫기"
                    onclick="closeT2DebugModal('<?php echo $safe_id ?>')">&times;</button>
        </div>
        <div class="t2-debug-modal-actions">
            <button type="button" class="t2-debug-modal-copy" onclick="copyT2DebugInfo('<?php echo $safe_id ?>')">전체 복사</button>
            <button type="button" class="t2-debug-modal-refresh" onclick="renderT2DebugInfo('<?php echo $safe_id ?>')">새로고침</button>
            <?php if ($t2_local_admin_url !== null): ?>
            <a class="t2-debug-modal-admin"
               href="<?php echo htmlspecialchars($t2_local_admin_url, ENT_QUOTES | ENT_HTML5, 'UTF-8'); ?>"
               target="_blank" rel="noopener"
               aria-label="<?php echo $t2_local_admin_authorized ? 'T2Editor 관리자 페이지 열기' : 'T2Editor 관리자 로그인하기'; ?>">
                <span class="material-icons-outlined" aria-hidden="true"><?php echo $t2_local_admin_authorized ? 'admin_panel_settings' : 'login'; ?></span>
                <?php echo $t2_local_admin_authorized ? '관리자 페이지 열기' : '관리자 로그인하기'; ?>
            </a>
            <?php endif; ?>
            <span class="t2-debug-modal-copy-status" id="<?php echo $safe_id ?>_debug_copy_status"></span>
        </div>
        <pre class="t2-debug-modal-body" id="<?php echo $safe_id ?>_debug_modal_body"></pre>
    </div>
</div>

<style>
.t2-debug-modal-backdrop {
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
}
.t2-debug-modal-backdrop[hidden] { display: none; }
.t2-debug-modal {
    background: #1e1e1e; color: #eaeaea;
    width: 100%; max-width: 640px; max-height: 85vh;
    border-radius: 10px; display: flex; flex-direction: column;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
}
.t2-debug-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 1px solid #3a3a3a; font-size: 14px;
}
.t2-debug-modal-close {
    background: none; border: none; color: #eaeaea; font-size: 22px;
    line-height: 1; cursor: pointer; padding: 4px 8px;
}
.t2-debug-modal-actions {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 14px;
    border-bottom: 1px solid #3a3a3a;
}
.t2-debug-modal-copy, .t2-debug-modal-refresh, .t2-debug-modal-admin {
    font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid #4a4a4a;
    background: #2a2a2a; color: #eaeaea; cursor: pointer;
}
.t2-debug-modal-admin {
    display: inline-flex; align-items: center; gap: 5px; text-decoration: none;
    border-color: #9a5660; background: #432a2e; color: #ffc2c8; font-weight: 700;
}
.t2-debug-modal-admin:hover, .t2-debug-modal-admin:focus-visible {
    background: #523137; border-color: #c5747e; color: #ffd6da;
}
.t2-debug-modal-admin .material-icons-outlined { font-size: 15px; }
.t2-debug-modal-copy-status { font-size: 11px; color: #7ad17a; }
.t2-debug-modal-body {
    margin: 0; padding: 12px 14px; overflow: auto;
    font-family: "SFMono-Regular", Consolas, Menlo, monospace;
    font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
.t2-debug-mismatch { color: #ff6b6b; font-weight: 700; }
.t2-debug-ok { color: #7ad17a; }
</style>

<?php echo _t2e_js_script($editor_url, 'js/toolbar.js', $ver); ?>

<script>
function toggleT2EditorTheme(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (window.T2EditorTheme && typeof window.T2EditorTheme.toggle === 'function') {
        return window.T2EditorTheme.toggle();
    }
    const currentTheme = document.documentElement.getAttribute('data-t2editor-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-t2editor-theme', newTheme);
    document.documentElement.style.colorScheme = newTheme;
    return newTheme;
}

// Mobile diagnostics expose current content and media style/data mismatches where developer tools are unavailable.
function showT2DebugModal(event, safeId) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    renderT2DebugInfo(safeId);
    var modal = document.getElementById(safeId + '_debug_modal');
    if (!modal) return;
    modal.removeAttribute('hidden');
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            closeT2DebugModal(safeId);
            document.removeEventListener('keydown', escHandler);
        }
    });
}

function closeT2DebugModal(safeId) {
    var modal = document.getElementById(safeId + '_debug_modal');
    if (modal) modal.setAttribute('hidden', '');
}

function _t2DebugEscape(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderT2DebugInfo(safeId) {
    var body = document.getElementById(safeId + '_debug_modal_body');
    if (!body) return;

    var lines = [];
    var editorEl = document.getElementById(safeId + '_editor');
    var textareaEl = document.getElementById(safeId);
    var now = new Date();

    lines.push('=== T2Editor Debug Info ===');
    lines.push('생성 시각: ' + now.toLocaleString());
    lines.push('에디터 ID: ' + safeId);
    lines.push('URL: ' + location.href);
    lines.push('UA: ' + navigator.userAgent);
    lines.push('뷰포트: ' + window.innerWidth + 'x' + window.innerHeight + ' (dpr=' + (window.devicePixelRatio || 1) + ')');
    lines.push('');

    // 텍스트(글자수) 카운트
    var charCountEl = document.querySelector('#' + safeId + '_editor')
        ? document.querySelector('.t2-char-count span')
        : null;
    if (charCountEl) lines.push('표시된 글자수: ' + charCountEl.textContent);

    if (!editorEl) {
        lines.push('[오류] #' + safeId + '_editor 요소를 찾을 수 없습니다.');
        body.textContent = lines.join('\n');
        return;
    }

    // Count outer .t2-media-block wrappers once, then inspect each inner size container to avoid duplicates.
    var mediaBlocks = editorEl.querySelectorAll('.t2-media-block');
    lines.push('=== 미디어 블록 (' + mediaBlocks.length + '개) ===');
    if (mediaBlocks.length === 0) lines.push('(없음)');

    mediaBlocks.forEach(function (block, idx) {
        var container = block.querySelector('div:first-child[data-width], [data-width]') || null;
        var media = block.querySelector('iframe, video, img');
        var type = block.dataset.t2Block || block.className;
        var videoType = block.dataset.videoType || (container && container.dataset.videoType) || '';
        var videoUrl = block.dataset.videoUrl || (container && container.dataset.videoUrl) || '';
        var videoId  = block.dataset.videoId  || (container && container.dataset.videoId)  || '';

        lines.push('');
        lines.push('[블록 #' + (idx + 1) + '] type=' + type + (videoType ? (' videoType=' + videoType) : ''));
        if (videoUrl) lines.push('  url: ' + videoUrl);
        if (videoId)  lines.push('  youtubeId: ' + videoId);
        lines.push('  block-id: ' + (block.dataset.blockId || '(없음)'));

        if (container) {
            var styleW = parseInt(container.style.width, 10) || null;
            var styleH = parseInt(container.style.height, 10) || null;
            var dataW  = parseInt(container.dataset.width, 10) || null;
            var dataH  = parseInt(container.dataset.height, 10) || null;
            var origW  = parseInt(container.dataset.originalWidth, 10) || null;
            var origH  = parseInt(container.dataset.originalHeight, 10) || null;

            lines.push('  style: ' + styleW + 'x' + styleH + 'px');
            lines.push('  data-width/height: ' + dataW + 'x' + dataH);
            lines.push('  data-original-width/height: ' + origW + 'x' + origH);

            var mismatch = (styleW && dataW && styleW !== dataW) ||
                           (styleH && dataH && styleH !== dataH) ||
                           (styleW && origW && styleW !== origW) ||
                           (styleH && origH && styleH !== origH);
            lines.push('  → ' + (mismatch
                ? '⚠ 불일치! style 과 data-* 값이 다릅니다 (재편집 진입 시 크기가 튈 수 있음)'
                : '✓ 일치'));
        } else {
            lines.push('  (컨테이너 div를 찾지 못함 — 구조 이상 가능성)');
        }

        if (media) {
            var srcAttr = media.getAttribute('src') || '';
            lines.push('  실제 렌더 요소: <' + media.tagName.toLowerCase() + '> ' +
                (srcAttr ? 'src=' + srcAttr : ''));
            if (media.tagName === 'IFRAME') {
                var t2wm = srcAttr.match(/[?&]t2w=(\d+)/);
                var t2hm = srcAttr.match(/[?&]t2h=(\d+)/);
                lines.push('  src 내 크기 파라미터(t2w/t2h): ' +
                    (t2wm && t2hm ? (t2wm[1] + 'x' + t2hm[1] + ' (✓ 복구 가능)') : '(없음 — 구버전 콘텐츠이거나 필터가 쿼리스트링까지 지웠을 가능성)'));
            }
        } else {
            lines.push('  ⚠ 실제 렌더 요소(iframe/video/img)를 찾지 못함');
        }
    });

    lines.push('');
    lines.push('=== 현재 라이브 DOM (에디터 화면에 실제 그려진 HTML) ===');
    lines.push(editorEl.innerHTML);

    lines.push('');
    lines.push('=== 현재 textarea(제출 예정) 값 ===');
    lines.push(textareaEl ? textareaEl.value : '(textarea를 찾을 수 없음)');

    body.textContent = lines.join('\n');
}

function copyT2DebugInfo(safeId) {
    var body = document.getElementById(safeId + '_debug_modal_body');
    var status = document.getElementById(safeId + '_debug_copy_status');
    if (!body) return;
    var text = body.textContent;

    function showStatus(msg) {
        if (!status) return;
        status.textContent = msg;
        setTimeout(function () { status.textContent = ''; }, 2000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
            showStatus('복사됨');
        }).catch(function () {
            showStatus('복사 실패 (직접 선택해 복사해주세요)');
        });
    } else {
        // 구형 브라우저/일부 모바일 웹뷰 폴백
        var range = document.createRange();
        range.selectNodeContents(body);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try {
            document.execCommand('copy');
            showStatus('복사됨');
        } catch (e) {
            showStatus('복사 실패 (직접 선택해 복사해주세요)');
        }
        sel.removeAllRanges();
    }
}

// I18N: 번역 토글 + 언어 선택 메뉴 — T2Editor 10.2.1-beta2+
// 다크모드 토글과 텍스트 수 표시 사이에 위치한 translate 아이콘 버튼
// 클릭 시: 언어 선택 드롭다운 메뉴 토글
// 언어 선택 시: T2I18N.setLocale() 호출하여 전체 UI 번역 전환
function toggleT2EditorTranslate(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const btn = event.currentTarget;
    const toggleWrap = btn.closest('.t2-translate-toggle');
    if (!toggleWrap) return;
    const menu = toggleWrap.querySelector('.t2-translate-menu');
    if (!menu) return;

    if (menu.hasAttribute('hidden')) {
        // 모든 번역 메뉴 닫기 (다른 에디터 인스턴스의 메뉴 포함)
        document.querySelectorAll('.t2-translate-menu').forEach(function(m) {
            m.setAttribute('hidden', '');
        });
        populateT2TranslateMenu(menu);
        menu.removeAttribute('hidden');
        setTimeout(function() {
            document.addEventListener('click', closeT2TranslateMenuOnOutsideClick, { once: true });
        }, 0);
    } else {
        menu.setAttribute('hidden', '');
    }
}

function closeT2TranslateMenuOnOutsideClick(event) {
    // 클릭한 요소가 번역 메뉴 또는 번역 버튼 내부가 아니면 모든 메뉴 닫기
    if (!event.target.closest('.t2-translate-toggle')) {
        document.querySelectorAll('.t2-translate-menu').forEach(function(m) {
            m.setAttribute('hidden', '');
        });
    }
}

function populateT2TranslateMenu(menu) {
    // T2I18N 이 로드되어 있지 않으면 메뉴 구성 생략 (폴백)
    if (typeof window.T2I18N === 'undefined') {
        return;
    }
    var i18n = window.T2I18N;
    var supported = i18n.supportedLangs;
    var current = i18n.getLocale();
    var display = window.T2EDITOR_I18N_LANG_DISPLAY || {};

    var titleEl = menu.querySelector('.t2-translate-menu-title');
    if (titleEl) {
        titleEl.textContent = i18n.t('translation.menu_title');
    }

    var listEl = menu.querySelector('.t2-translate-menu-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    // 자동 감지 옵션 (최상단) — [HIDDEN] UI에서는 숨김 처리하되 기능은 유지.
    // 사유: 자동 감지는 i18n 초기화 시 이미 적용되므로 메뉴에 노출할 필요 없음.
    // 단, setLocale('auto') 경로가 다른 곳에서 참조될 수 있으므로 DOM 요소와 리스너는 그대로 유지.
    var autoItem = document.createElement('li');
    autoItem.className = 't2-translate-menu-item t2-translate-menu-item-auto' + (current === i18n.detectBrowserLang() ? ' t2-active' : '');
    autoItem.setAttribute('data-lang', 'auto');
    autoItem.setAttribute('hidden', '');
    autoItem.textContent = i18n.t('translation.menu_auto');
    autoItem.addEventListener('click', function(e) {
        e.preventDefault();
        var detected = i18n.detectBrowserLang();
        i18n.setLocale(detected);
        showT2TranslateToast();
        closeAllT2TranslateMenus();
    });
    listEl.appendChild(autoItem);

    supported.forEach(function(lang) {
        var item = document.createElement('li');
        item.className = 't2-translate-menu-item' + (lang === current ? ' t2-active' : '');
        item.setAttribute('data-lang', lang);
        // 표시명: native name 우선, 없으면 lang code
        var displayInfo = display[lang];
        var displayName = (displayInfo && displayInfo[0]) ? displayInfo[0] : lang;
        item.textContent = displayName;
        item.addEventListener('click', function(e) {
            e.preventDefault();
            i18n.setLocale(lang);
            showT2TranslateToast();
            closeAllT2TranslateMenus();
        });
        listEl.appendChild(item);
    });
}

function closeAllT2TranslateMenus() {
    document.querySelectorAll('.t2-translate-menu').forEach(function(m) {
        m.setAttribute('hidden', '');
    });
}

function showT2TranslateToast() {
    // 요구사항: "Translation is on!" 토스트 알림 (T2Editor 코어 toast 시스템 사용)
    if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
        var msg = 'Translation is on!';
        // 번역된 메시지 우선 (요구사항에 명시된 영어 메시지는 fallback)
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            var translated = window.T2I18N.t('translation.toast_on');
            // 번역 키가 조회되면 (즉, 'Translation is on!' 이 아닌 다른 값이 반환되면)
            // 단, 요구사항에 명시된 영어 메시지가 locales/ko.json 등에 그대로 있으므로
            // 항상 'Translation is on!' 사용 (요구사항 준수)
            if (translated && translated !== 'translation.toast_on') {
                msg = translated;
            }
        }
        T2Utils.showNotification(msg, 'success', 2500);
    }
}

// 페이지 로드 시 번역 언어 복원은 T2I18N 초기화 시 자동 처리되므로 여기서는 no-op

(function() {
    // Security: use raw $id with JSON_HEX_TAG/AMP for script context; $safe_id is only for HTML attributes.
    // Encoding $safe_id again would search for entity text instead of the browser-decoded DOM id.
    const editorContainerId = <?php echo json_encode($id . '_container', JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editorTextareaId  = <?php echo json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editor = new T2Editor(document.getElementById(editorContainerId));
    window[<?php echo json_encode($id . '_editor', JSON_HEX_TAG | JSON_HEX_AMP); ?>] = editor;

    if (<?php echo $json_content; ?>) {
        try {
            // Security: json_encode(JSON_HEX_TAG|JSON_HEX_AMP) 사용으로
            // <\/script> 조기 종료, \u2028/\u2029 JS 줄바꿈 문자 등 완전 차단.
            var contentToLoad = <?php echo $json_content; ?>;
            if (editor && typeof editor._sanitizeStoredContent === 'function') {
                contentToLoad = editor._sanitizeStoredContent(contentToLoad);
            }
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = contentToLoad;

            // STEP 1: 플러그인 restore 훅 실행
            T2EditorHooks.runRestore(tempDiv);

            // Legacy fallback runs only for plugins without registered hooks. Remove it only with js/legacy_fallback.js.
            if (window.T2LegacyFallback) {
                T2LegacyFallback.runRestoreFallback(tempDiv);
            }

            editor.setContent(tempDiv.innerHTML);

            // editor.setContent() already calls onContentSet() via processContentSet().
            // This setTimeout handles delayed plugin loading; idempotent design
            // (WeakSet-based) makes double-calls safe.
            setTimeout(function() {
                for (let [name, plugin] of editor.plugins) {
                    if (plugin.onContentSet) plugin.onContentSet(tempDiv.innerHTML);
                }
            }, 100);
        } catch (e) {
            console.error('Editor init error:', e);
        }
    }
})();
</script>
<?php
        $html .= ob_get_clean();
    } else {
        // Security: is_dhtml_editor=false 브랜치에서도 $id, $content 이스케이프 적용
        $safe_id_ne      = htmlspecialchars($id,      ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $safe_content_ne = htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $fallback_height = max(200, min(2000, (int)T2EDITOR_CONTENT_HEIGHT));
        $html .= "\n<textarea class=\"t2-editor-fallback\" id=\"{$safe_id_ne}\" name=\"{$safe_id_ne}\" style=\"--t2-editor-content-height:{$fallback_height}px\">{$safe_content_ne}</textarea>";
    }

    return $html;
}

function get_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // Security: T2EDITOR_URL을 JS 문자열로 안전하게 삽입:
        // json_encode(JSON_HEX_TAG)는 <, > → \u003C, \u003E로 인코딩하여
        // </script> 탈출 및 HTML 인젝션을 차단함.
        $js_editor_url = json_encode(T2EDITOR_URL, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
        // Security: JSON_HEX_TAG | JSON_HEX_AMP 추가:
        // 기본 json_encode()는 < > & 를 이스케이프하지 않으므로
        // $id 에 </script> 가 포함되면 스크립트 블록이 조기 종료되어 XSS 발생.
        // JSON_HEX_TAG: < → \u003C, > → \u003E 로 인코딩하여 탈출 차단.
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
        return "
var _submitContent = function () {
    var editorElement = document.getElementById({$js_id} + '_editor');
    var editorInstance = window[{$js_id} + '_editor'];
    var editorContent = (editorInstance && typeof editorInstance.getSanitizedContent === 'function')
        ? editorInstance.getSanitizedContent()
        : editorElement.innerHTML;
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = editorContent;

    // 코어 인스턴스를 찾지 못하는 레거시/지연 초기화 상황에서도 에디터 내부용
    // 경계 표식과 제로폭 문자가 DB HTML에 남지 않도록 제출 경계에서 한 번 더 정리.
    tempDiv.querySelectorAll('p[data-t2-boundary], p[data-t2-generated]').forEach(function (p) {
        p.removeAttribute('data-t2-boundary');
        p.removeAttribute('data-t2-generated');
        p.removeAttribute('contenteditable');
        if (!(p.textContent || '').replace(/[\u200B\uFEFF]/g, '').trim()) {
            p.innerHTML = '<br>';
        }
    });
    var zeroWidthWalker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
    var zeroWidthNodes = [];
    var zeroWidthNode;
    while ((zeroWidthNode = zeroWidthWalker.nextNode())) zeroWidthNodes.push(zeroWidthNode);
    zeroWidthNodes.forEach(function (textNode) {
        // ZWNJ(U+200C)/ZWJ(U+200D)는 언어 문자 조합·복합 이모지의 일부이므로 보존.
        textNode.nodeValue = textNode.nodeValue.replace(/[\u200B\uFEFF]/g, '');
        if (!textNode.nodeValue && textNode.parentNode) textNode.parentNode.removeChild(textNode);
    });

    // STEP 1: 전역 공통 처리 (항상 실행)
    tempDiv.querySelectorAll('.t2-move-controls').forEach(function (ctrl) { ctrl.remove(); });

    // STEP 2: 플러그인 submit 훅 실행
    T2EditorHooks.runSubmit(tempDiv);

    // STEP 2.5: 레거시 fallback
    // hooks.js 없는 서드파티/구버전 플러그인을 위해 V9 인라인 코드를 조건부 실행.
    // 캡슐 제거: js/legacy_fallback.js 삭제 + 이 블록 삭제
    if (window.T2LegacyFallback) {
        T2LegacyFallback.runSubmitFallback(tempDiv);
    }

    // STEP 3: 테이블 DB 저장 포맷 변환 (항상 실행)
    // .t2-table-wrapper → .table-responsive 변환은 hooks.js가 아닌
    // editor.lib.php가 담당. 이유: DB 저장 포맷 규약이므로 플러그인 자율 영역이 아님.
    tempDiv.querySelectorAll('.t2-table-wrapper').forEach(function (wrapper) {
        var table = wrapper.querySelector('table');
        if (!table) return;
        var isLarge = table.classList.contains('t2-table-large') || table.rows.length > 10 || (table.rows[0] && table.rows[0].cells.length > 10);
        var hasScroll = wrapper.querySelector('.t2-table-scroll-wrapper');
        var scrollContainer = document.createElement('div');
        scrollContainer.className = 'table-responsive';
        scrollContainer.style.cssText = 'display:block;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;';
        wrapper.parentNode.insertBefore(scrollContainer, wrapper);
        if (isLarge || hasScroll) {
            if (hasScroll) { hasScroll.parentNode.insertBefore(table, hasScroll); hasScroll.remove(); }
        } else { wrapper.parentNode.insertBefore(table, wrapper); }
        scrollContainer.appendChild(table);
        wrapper.remove();
    });

    // finalContent 조합
    var contentStyle = '<link href=\"' + {$js_editor_url} + '/css/content.css\" rel=\"stylesheet\">';
    var finalContent = tempDiv.innerHTML;
    // Append content.css only when absent so repeated edit/publish cycles do not accumulate duplicate links.
    if ((finalContent.indexOf('t2-media-block') !== -1 || finalContent.indexOf('t2-table') !== -1 || finalContent.indexOf('t2-code-block') !== -1 || finalContent.indexOf('t2-drawing-block') !== -1)
        && finalContent.indexOf('/css/content.css') === -1) {
        finalContent += contentStyle;
    }
    document.getElementById({$js_id}).value = finalContent;
};
_submitContent();\n";
    }
    // Security: getElementById 인수: JSON_HEX_TAG | JSON_HEX_AMP 로 </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    // Build JavaScript variable identifiers separately from JSON strings and prefix them so numeric field IDs remain valid.
    $js_var = 't2_' . preg_replace('/[^a-zA-Z0-9_]/', '_', $id);
    return "var {$js_var}_editor = document.getElementById({$js_id});\n";
}

function chk_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // Security: JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
        return "
            var editorElement = document.getElementById({$js_id} + '_editor');
            var editorInstance = window[{$js_id} + '_editor'];
            var editorContent = (editorInstance && typeof editorInstance.getSanitizedContent === 'function')
                ? editorInstance.getSanitizedContent()
                : editorElement.innerHTML;
            function hasRealContent(html) {
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                if (tempDiv.textContent.trim()) return true;
                if (tempDiv.querySelector('img, video, iframe, table, .t2-file-block, .file-container')) return true;
                return false;
            }
            if (!hasRealContent(editorContent)) {
                alert((typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.content_required') : 'Please enter some content.');
                document.getElementById({$js_id} + '_editor').focus();
                return false;
            }\n";
    }
    // Security: JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    return "if (!document.getElementById({$js_id}).value) { alert((typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.content_required') : 'Please enter some content.'); document.getElementById({$js_id}).focus(); return false; }\n";
}
// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
?>
