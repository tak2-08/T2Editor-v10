<?php
//Path: T2Editor/editor.lib.php

// ── /extend/php 자동 로딩 ────────────────────────────────────────────────────
// config 파일보다 먼저 실행해 extend 파일이 상수·변수 기본값을 자유롭게 override 가능.
// T2EDITOR_PATH 상수는 여기서 미리 정의하지 않는다 — t2_config.php 의 전체 설정 블록이
// if(!defined('T2EDITOR_PATH')) 로 감싸져 있어, 먼저 정의해버리면 T2EDITOR_URL·
// T2EDITOR_DATA_PATH 등 나머지 상수가 통째로 정의되지 않는다. extend 로더 자신은
// 이 파일이 이미 t2editor 루트에 있으므로 __DIR__ 만으로 충분하다.
(function () {
    $_ext_dir = __DIR__ . '/extend/php';
    if (!is_dir($_ext_dir)) return;
    $_files = glob($_ext_dir . '/*.php');
    if (!$_files) return;
    sort($_files);
    foreach ($_files as $_f) {
        if (stripos(basename($_f), 'README') === 0) continue;
        include_once $_f;
    }
})();

include __DIR__ . '/config/t2_config.php';

// [RHYMIX/PHP-SCOPE-FIX] Rhymix compiles config.blade.php into a template method.
// When this file is required from that method, variables created by t2_config.php
// belong to the method scope, while editor_html() imports them from $GLOBALS.
// Export the four public configuration arrays explicitly so the result is identical
// whether editor.lib.php is loaded at file scope, function scope, or Blade cache scope.
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

// ── [UPLOAD-CONFIG] 파일 스코프에서 로드 ─────────────────────────────────
// editor_html() 의 if ($js && $ver) 블록 안에서 로드하면
// $ver 미설정·$js=false 등의 조건으로 블록이 건너뛰어질 때
// get_video_extensions() 등 함수와 T2EDITOR_MAX_UPLOAD_SIZE 상수를
// JS 주입 시점에 사용할 수 없게 되는 문제가 발생.
// 파일 스코프에서 한 번만 로드해 항상 사용 가능하도록 보장
if (!function_exists('get_video_extensions')) {
    $_t2_upload_cfg = T2EDITOR_PATH . '/config/upload_config.php';
    if (file_exists($_t2_upload_cfg)) {
        // @ : extend/php 가 먼저 define() 한 상수와의 충돌 E_WARNING 억제
        @require_once $_t2_upload_cfg;
    }
    unset($_t2_upload_cfg);
}

// extend/php 가 예약한 확장자 설정을 upload_config.php 로드 이후 최종 반영
if (!empty($GLOBALS['_t2a_ext_override']) && is_array($t2editor_allowed_extensions ?? null)) {
    foreach ($GLOBALS['_t2a_ext_override'] as $_t2a_cat => $_t2a_exts) {
        if (isset($t2editor_allowed_extensions[$_t2a_cat])) {
            $t2editor_allowed_extensions[$_t2a_cat] = $_t2a_exts;
        }
    }
    unset($_t2a_cat, $_t2a_exts, $GLOBALS['_t2a_ext_override']);
}

// upload_config.php may also have been included from a template method scope.
// Its helper functions import this table with `global`, so publish it explicitly.
if (isset($t2editor_allowed_extensions) && is_array($t2editor_allowed_extensions)) {
    $GLOBALS['t2editor_allowed_extensions'] = $t2editor_allowed_extensions;
} elseif (!isset($GLOBALS['t2editor_allowed_extensions'])) {
    $GLOBALS['t2editor_allowed_extensions'] = [];
}

// ======= 압축 설정 =======
if (!defined('T2_CSS_MIN')) define('T2_CSS_MIN', true); //true 권장
if (!defined('T2_JS_MIN'))  define('T2_JS_MIN', false); //사양이 낮은 서버의 경우 과부하가 올 수 있음

// ======= 마이그레이션 옵션 =======
// 'auto'   : 묻지 않고 즉시 T2Editor 형식으로 자동 변환
// 'prompt' : 타 에디터 콘텐츠 감지 시 변환 여부 팝업 표시
// false    : 감지/변환 비활성화 (기본값)
if (!defined('T2_MIGRATION_MODE')) define('T2_MIGRATION_MODE', false);

// ======= NSFW 필터 설정 =======
// == T2_NSFW_ENABLED: NSFW 필터 사용 여부 ==
// true: 사용
// false: 미사용 (기본값)
if (!defined('T2_NSFW_ENABLED')) define('T2_NSFW_ENABLED', false);

// == T2_NSFW_MODE: 필터 작동 방식 ==
// 'browser': 브라우저 추론
if (!defined('T2_NSFW_MODE')) define('T2_NSFW_MODE', 'browser');

// == T2_NSFW_ALLOW_SUSPICIOUS: 19금 의심 이미지 업로드 허용 여부 ==
// true  → 경고 팝업 표시 후 업로드 허용 (법적 책임 경고) (기본값)
// false → 해당 이미지 업로드 취소 처리
if (!defined('T2_NSFW_ALLOW_SUSPICIOUS')) define('T2_NSFW_ALLOW_SUSPICIOUS', true);

// == 브라우저 NSFW 런타임/모델 설정 ==
// 기본값은 자체 호스팅 경로를 사용합니다.
// vendor 폴더에 tfjs / backend / nsfwjs / model 파일을 배치하면 바로 동작합니다.
if (!defined('T2_NSFW_RUNTIME_ASSET_BASE')) define('T2_NSFW_RUNTIME_ASSET_BASE', T2EDITOR_URL . '/vendor');
if (!defined('T2_NSFW_BROWSER_MODEL')) define('T2_NSFW_BROWSER_MODEL', 'MobileNetV2Mid');
if (!defined('T2_NSFW_BROWSER_MODEL_TYPE')) define('T2_NSFW_BROWSER_MODEL_TYPE', 'graph');
if (!defined('T2_NSFW_BROWSER_MODEL_URL')) define('T2_NSFW_BROWSER_MODEL_URL', T2_NSFW_RUNTIME_ASSET_BASE . '/nsfwjs/models/mobilenet_v2_mid/model.json');
if (!defined('T2_NSFW_BROWSER_BACKEND_PRIORITY')) define('T2_NSFW_BROWSER_BACKEND_PRIORITY', 'webgpu,webgl,wasm,cpu');

// ======= 비디오 플레이어 설정 =======
// true  : 에디터 "편집 화면"에서 업로드/직접 링크 동영상을 T2Editor 전용
//         커스텀 스킨(video_player.php)의 iframe으로 미리보기 표시
// false : 에디터 편집 화면에서 기존 native video 래퍼(video_view.php)의
//         iframe으로 미리보기 표시
// YouTube 등 외부 임베드는 이 옵션과 무관하게 해당 서비스 iframe을 사용.
//
// [RHYMIX-IFRAME] 라이믹스에서는 함께 제공되는
// addons/t2editor_iframe_whitelist 애드온이 video_player.php 및
// video_view.php 두 경로만 미디어 화이트리스트에 등록한다. 따라서 직접 첨부한
// 영상도 YouTube와 동일하게 iframe으로 저장되며, 사이트 전체의 same-origin
// iframe을 무분별하게 허용하지 않는다. 애드온은 PC/모바일 모두 활성화해야 한다.
if (!defined('T2_VIDEO_PLAYER_ENABLED')) define('T2_VIDEO_PLAYER_ENABLED', true);

// ======= 플러그인 등록 =======
// if(!isset) guard — extend/php 가 먼저 설정한 값이 있으면 그대로 보존
if (!isset($T2EDITOR_PLUGINS)) $T2EDITOR_PLUGINS = [
    'link',
    'image', 
    'video',
    'file',
    'table',
    'code',
    'linkcard', // [CMS-FILTER-FIX] image/code 와 동일하게 여기 직접 등록한다.
                // plugin/linkcard/plugin.json 의 {"autoload":true} 로도
                // extend/php/t2z_plugin_autoregister.php 가 자동으로 추가해
                // 주지만, 그 경로는 extend 로더 실행 순서·다른 extend 파일의
                // 개입 여부에 암묵적으로 의존한다. image·code 등 핵심
                // 플러그인은 전부 이렇게 직접 등록되어 있으므로 linkcard도
                // 동일한 방식으로 명시해 훅이 로드되지 않는 경로를 원천 차단한다
                // (자동 등록 스캐너는 이미 등록된 이름은 건드리지 않으므로
                // 중복 문제는 없다).
    'export',
    'search',
    'draw',
    'collab',
    'ai_complex', // v10.2.0: ai + ai_rearrange 통폐합 (T2LLM 연동)
    'clipurl',
    'meme'
];

// ======= 플러그인 로딩 순서 설정 =======
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

// ======= v10+: 버튼 순서 Override (선택사항) =======
// command 문자열 배열로 출력 순서를 명시적으로 지정.
// 비워두면 $T2EDITOR_PLUGIN_PRIORITY 기반 자동 정렬 사용.
// 예: $T2EDITOR_BUTTON_ORDER = ['createLink', 'insertImage', 'insertYouTube'];
if (!isset($T2EDITOR_BUTTON_ORDER)) $T2EDITOR_BUTTON_ORDER = [];

// ======= v10+: 레거시 버튼 (button.json 미제공 서드파티 플러그인용) =======
// button.json을 아직 추가하지 않은 플러그인의 버튼을 수동으로 등록.
// v10.0.0 기본 제공 플러그인은 모두 button.json으로 이전 완료 → 기본 비어있음.
if (!isset($T2EDITOR_LEGACY_BUTTONS)) $T2EDITOR_LEGACY_BUTTONS = [];

// ── [v10.0.0] button.json 로더 ───────────────────────────────────────────────
/**
 * 단일 플러그인의 button.json을 읽어 버튼 배열 반환.
 * JSON 파일이 없거나 파싱 실패 시 빈 배열 반환 (오류 무시).
 */
function _t2e_load_plugin_buttons(string $plugin_name): array {
    // [SEC] 플러그인 이름은 영숫자·언더스코어·하이픈만 허용 (경로 탈출 방지)
    if (!preg_match('/^[a-zA-Z0-9_-]+$/', $plugin_name)) return [];

    $path = T2EDITOR_PATH . '/plugin/' . $plugin_name . '/button.json';
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

// ── [v10+] 버튼 렌더러 ────────────────────────────────────────────────────
/**
 * button.json의 단일 버튼 정의 배열을 받아 HTML 문자열 반환.
 * 코어 버튼(shorthand)과 플러그인 버튼(full spec) 모두 처리.
 */
function _t2e_render_button(array $btn): string {
    $e = fn($s) => htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');

    $cmd      = $e($btn['command']   ?? '');
    $plugin   = $e($btn['plugin']    ?? '');
    $aria     = $e($btn['ariaLabel'] ?? $btn['aria'] ?? $cmd);
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
            // [SEC] attribute 이름을 영숫자·하이픈으로 제한
            if (preg_match('/^[a-zA-Z][a-zA-Z0-9\-]*$/', (string)$k)) {
                $extra .= ' ' . $e($k) . '="' . $e($v) . '"';
            }
        }
    }

    return '<button class="t2-btn" data-command="' . $cmd . '"'
        . $data_plugin . $style . $disabled . $extra
        . ' aria-label="' . $aria . '">' . $icon_html . '</button>';
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

// === 라이센스 검증 함수 ===
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

// [SEC-CSS-INJECTION] CSS url("...") 안에서 구조를 파괴할 수 있는 문자만 최소한으로 처리.
//
// ❌ 이전 방식 rawurlencode():
//    T2EDITOR_URL 이 https://cdn.example.com 처럼 full URL 이면
//    ':' → '%3A' 로 인코딩되어 URL 자체가 깨짐 (아이콘 폰트 미적용 원인)
//
// ✅ 변경: CSS double-quoted string 컨텍스트에서 실제로 위험한 문자만 이스케이프.
//    · "  → \"  (닫는 따옴표 → CSS 이스케이프 시퀀스)
//    · \  → \\ (CSS 이스케이프 시작 문자)
//    · \n, \r → 제거 (CSS string 안에서 개행은 파싱 오류)
//    경로 구분자, 콜론, 쿼리스트링 등 URL 구조 문자는 건드리지 않음.
function _t2e_css_url($url) {
    $url = str_replace('\\', '\\\\', $url);       // \ → \\ (반드시 먼저)
    $url = str_replace('"',  '\\"',  $url);        // " → \"
    $url = str_replace(["\n", "\r"], '', $url);    // 개행 제거
    return $url;
}

function _t2e_css_link($editor_url, $path, $ver) {
    // [SEC-XSS] URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');
    if (T2_CSS_MIN) {
        return '<link rel="stylesheet" href="' . $e_url . '/t2_css_min.php?f=' . $e_path . '&amp;v=' . $e_ver . '">';
    } else {
        return '<link rel="stylesheet" href="' . $e_url . '/' . $e_path . '?v=' . $e_ver . '">';
    }
}

function _t2e_js_script($editor_url, $path, $ver) {
    // [SEC-XSS] URL 구성 요소를 HTML 속성 컨텍스트에 맞게 이스케이프
    $e_url  = htmlspecialchars($editor_url, ENT_QUOTES, 'UTF-8');
    $e_path = htmlspecialchars($path,       ENT_QUOTES, 'UTF-8');
    $e_ver  = htmlspecialchars($ver,        ENT_QUOTES, 'UTF-8');
    if (T2_JS_MIN) {
        return '<script src="' . $e_url . '/t2_js_min.php?f=' . $e_path . '&amp;v=' . $e_ver . '"></script>';
    } else {
        return '<script src="' . $e_url . '/' . $e_path . '?v=' . $e_ver . '"></script>';
    }
}

function editor_html($id, $content, $is_dhtml_editor=true) {
    global $g5, $config, $T2EDITOR_PLUGINS, $T2EDITOR_PLUGIN_PRIORITY,
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

    $editor_url = T2EDITOR_URL;
    $ver = get_readme_version();

    $html = "<span class=\"sound_only\" style=\"display:none\">" . htmlspecialchars(
        (function_exists('t2editor_detect_user_lang') && function_exists('t2editor_get_messages'))
            ? (t2editor_get_messages(t2editor_detect_user_lang())['editor.start'] ?? '웹에디터 시작')
            : '웹에디터 시작',
        ENT_QUOTES, 'UTF-8'
    ) . "</span>";

    if ($js && $ver) {
        // === Core CSS ===
        $html .= "\n" . _t2e_css_link($editor_url, 'css/core.css', $ver);
        $html .= "\n" . _t2e_css_link($editor_url, 'css/dark.css', $ver);

        $sorted_plugins = [];
        foreach ($T2EDITOR_PLUGINS as $plugin) {
            $priority = isset($T2EDITOR_PLUGIN_PRIORITY[$plugin]) ? $T2EDITOR_PLUGIN_PRIORITY[$plugin] : 999;
            if (!isset($sorted_plugins[$priority])) $sorted_plugins[$priority] = [];
            $sorted_plugins[$priority][] = $plugin;
        }
        ksort($sorted_plugins);

        // [FIX-DOUBLE-LOAD] 이전에는 여기서 각 플러그인의 메인 {$plugin}.js 를
        // <script> 태그로 "즉시(eager)" 출력하면서, 동시에 core.js 의
        // loadPluginsWithPriority()/loadPlugin() 이 window.T2EDITOR_PLUGINS 를
        // 기준으로 같은 파일을 "다시(lazy, 우선순위·지연 로딩)" 동적으로
        // <script> 삽입해 두 번 로드하고 있었다.
        //
        // 플러그인 파일들이 과거 var/function 선언 위주였을 때는 중복 로드가
        // 조용히 재정의되어 눈에 띄는 문제가 없었지만, 플러그인들이 ES6
        // `class T2XxxPlugin { ... }` (렉시컬 선언 — 같은 스코프에서 재선언 시
        // SyntaxError) 로 전환되면서, 두 번째(동적) 로드 시점에 매 페이지 로드마다
        // "Identifier 'T2XxxPlugin' has already been declared" 전역 에러가
        // 모든 플러그인에서 발생하게 되었다. 우연히 클래스 재선언 에러가 나기
        // 전에 window[className] 이 이미 정의되어 있어 loadPlugin() 은 겉으로는
        // "성공"한 것처럼 보이지만, 실제로는 매번 불필요한 네트워크 요청 +
        // 스크립트 파싱 실패 + 전역 에러가 반복되는 취약한 이중 로딩 구조였다.
        // (툴바 버튼 로딩 스피너·우선순위 지연 로딩 UX 도 이 이중 로딩 때문에
        // 무의미해진다 — 어차피 즉시 전부 로드되므로.)
        //
        // 수정: 메인 {$plugin}.js 의 즉시(eager) 출력은 제거하고, core.js 의
        // 우선순위 기반 loadPluginsWithPriority() 가 유일한 로딩 경로가 되도록
        // 한다. hooks.js(submit/restore 훅 등록)만은 IIFE 로 감싸여 있어
        // 재실행되어도 안전하지 않으므로(중복 등록 방지 목적상) 계속 즉시
        // 로드해 폼 제출 전에 반드시 등록되도록 유지한다 — 어차피 hooks.js 는
        // loadPlugin() 이 로드하지 않는 별도 파일이라 중복 로드 문제가 없다.
        $plugin_scripts = "";
        foreach ($sorted_plugins as $priority_val => $plugins_in_group) {
            foreach ($plugins_in_group as $plugin) {
                if (file_exists(T2EDITOR_PATH . "/plugin/{$plugin}/{$plugin}.css")) {
                    $html .= "\n" . _t2e_css_link($editor_url, 'plugin/' . $plugin . '/' . $plugin . '.css', $ver);
                }
                // [v10.0.0] hooks.js — submit/restore 훅 등록소. 존재할 때만 자동 로드.
                // 메인 플러그인 JS 는 더 이상 여기서 즉시 로드하지 않는다 (위 설명 참조).
                if (file_exists(T2EDITOR_PATH . "/plugin/{$plugin}/hooks.js")) {
                    $plugin_scripts .= "\n" . _t2e_js_script($editor_url, 'plugin/' . $plugin . '/hooks.js', $ver);
                }
            }
        }

        // ── [I18N-BOOTSTRAP] i18n 전역 설정을 i18n.js보다 먼저 주입 ─────────────
        // 기존에는 window.T2EDITOR_I18N_* 값이 모든 외부 JS 로드 "후"에야 주입되어,
        // i18n.js가 빈 메시지 카탈로그/기본값으로 초기화되는 순서 버그가 있었다.
        // 그 결과 플러그인 UI는 humanizeKey() 영어 폴백과 PHP 초기 렌더 한국어가 섞여
        // "영어 80% + 한국어 20%"처럼 보였다. 반드시 i18n.js 이전에 주입한다.
        $t2_i18n_enabled = defined('T2EDITOR_I18N_ENABLED') ? T2EDITOR_I18N_ENABLED : true;
        $t2_i18n_default = defined('T2EDITOR_I18N_DEFAULT_LANG') ? T2EDITOR_I18N_DEFAULT_LANG : 'en';
        $t2_i18n_supported = defined('T2EDITOR_I18N_SUPPORTED_LANGS') && is_array(T2EDITOR_I18N_SUPPORTED_LANGS)
            ? T2EDITOR_I18N_SUPPORTED_LANGS : ['ko', 'en', 'ja', 'zh'];
        $t2_user_lang = function_exists('t2editor_detect_user_lang') ? t2editor_detect_user_lang() : $t2_i18n_default;
        $t2_all_messages = function_exists('t2editor_get_all_messages') ? t2editor_get_all_messages() : [];
        $t2_polyfill_script_url = defined('T2EDITOR_I18N_POLYFILL_URL')
            ? T2EDITOR_I18N_POLYFILL_URL
            : $editor_url . '/vendor/formatjs/t2i18n-polyfill.js';
        $t2_lang_display = defined('T2EDITOR_I18N_LANG_DISPLAY') && is_array(T2EDITOR_I18N_LANG_DISPLAY)
            ? T2EDITOR_I18N_LANG_DISPLAY : [];

        $html .= "\n<script>"
               . "window.T2EDITOR_I18N_ENABLED = " . ($t2_i18n_enabled ? 'true' : 'false') . ";"
               . "window.T2EDITOR_I18N_DEFAULT_LANG = " . json_encode($t2_i18n_default, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_SUPPORTED_LANGS = " . json_encode($t2_i18n_supported, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_USER_LANG = " . json_encode($t2_user_lang, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_MESSAGES = " . json_encode($t2_all_messages, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";"
               . "window.T2EDITOR_I18N_POLYFILL_URL = " . json_encode($t2_polyfill_script_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";"
               . "window.T2EDITOR_I18N_LANG_DISPLAY = " . json_encode($t2_lang_display, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";"
               . "</script>";

        $html .= "\n" . _t2e_js_script($editor_url, 'js/utils.js', $ver);
        $html .= "\n" . _t2e_js_script($editor_url, 'vendor/formatjs/t2i18n-polyfill.js', $ver);  // [I18N] FormatJS 호환 폴리필 (자체호스팅) — i18n.js보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/i18n.js', $ver);  // [I18N] 번역 코어 (polyfill 다음, hooks 이전)
        $html .= "\n<script>if (window.T2I18N && typeof window.T2I18N.hydrateFromGlobals === 'function') { window.T2I18N.hydrateFromGlobals(); }</script>";
            $html .= "\n" . _t2e_js_script($editor_url, 'js/hooks.js', $ver);  // [v10.0.0] 훅 등록소
        $html .= "\n" . _t2e_js_script($editor_url, 'js/format-engine.js', $ver);  // [MODERNIZATION] Selection/Range 기반 서식 엔진, core.js 보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/document-model.js', $ver);  // [MODERNIZATION] Plan/Apply 기반 블록 재조정 계층, core.js 보다 먼저 로드
        $html .= "\n" . _t2e_js_script($editor_url, 'js/core.js', $ver);
        $html .= $plugin_scripts;

        // ── /extend/js 자동 로딩 ────────────────────
        // T2EDITOR_PATH/extend/js/ 폴더에 .js 파일을 올려두면 자동으로
        // <script> 태그가 출력. 파일명 알파벳 순으로 로드.
        // 로드 시점: 플러그인 JS(hooks.js 포함) 이후, legacy_fallback.js 이전
        //            → 플러그인 API를 즉시 활용할 수 있는 최적 시점
        // * README.js 처럼 파일명이 README 로 시작하는 파일은 자동 제외
        // ─────────────────────────────────────────────────────────────────────
        $_ext_js_dir = T2EDITOR_PATH . '/extend/js';
        if (is_dir($_ext_js_dir)) {
            $_ext_js_files = glob($_ext_js_dir . '/*.js');
            if ($_ext_js_files) {
                sort($_ext_js_files);
                foreach ($_ext_js_files as $_ext_js_file) {
                    if (stripos(basename($_ext_js_file), 'README') === 0) {
                        continue;
                    }
                    $_ext_js_rel = 'extend/js/' . basename($_ext_js_file);
                    $html .= "\n" . _t2e_js_script($editor_url, $_ext_js_rel, $ver);
                }
            }
        }
        unset($_ext_js_dir, $_ext_js_files, $_ext_js_file, $_ext_js_rel);

        //$html .= "\n" . _t2e_js_script($editor_url, 'js/legacy_fallback.js', $ver);  // [v10.0.0] 레거시 fallback 캡슐(Ver 10.1.0: 주석처리)

        $readme_path = T2EDITOR_PATH . '/readme.txt';
        $readme_contents = file_exists($readme_path) ? file_get_contents($readme_path) : '';
        $license_token = _t2e_hash($readme_contents . $editor_url);

        // T2_MIGRATION_MODE PHP 상수 → JS 변수 변환
        // false는 JSON false, 문자열은 JSON 문자열로 직렬화
        // [SEC-XSS] JSON_HEX_TAG: </script> 탈출 방지
        $migration_mode_js = (T2_MIGRATION_MODE === false) ? 'false' : json_encode(T2_MIGRATION_MODE, JSON_HEX_TAG | JSON_HEX_AMP);

        $html .= "\n<script>";
        // [SEC-XSS] 아래 모든 json_encode에 JSON_HEX_TAG | JSON_HEX_AMP 플래그 적용.
        // T2EDITOR_URL 등 URL 상수는 관리자 설정에 따라 변경될 수 있으므로
        // </script> 삽입으로 인한 스크립트 탈출을 방지.
        $html .= "window.T2EDITOR_LICENSE_TOKEN = " . json_encode($license_token, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGINS = " . json_encode($T2EDITOR_PLUGINS, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_PLUGIN_PRIORITY = " . json_encode($T2EDITOR_PLUGIN_PRIORITY, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_URL = " . json_encode($editor_url, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_MIGRATION_MODE = " . $migration_mode_js . ";";
        $html .= "window.T2EDITOR_VIDEO_PLAYER_ENABLED = " . (T2_VIDEO_PLAYER_ENABLED ? 'true' : 'false') . ";";
        // NSFW 필터 설정 — image.js 에서 참조
        $html .= "window.T2EDITOR_NSFW_ENABLED = " . (T2_NSFW_ENABLED ? 'true' : 'false') . ";";
        $html .= "window.T2EDITOR_NSFW_MODE = " . json_encode(T2_NSFW_MODE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_ALLOW_SUSPICIOUS = " . (T2_NSFW_ALLOW_SUSPICIOUS ? 'true' : 'false') . ";";
        $nsfwAssetBase = T2_NSFW_RUNTIME_ASSET_BASE;
        $nsfwBackendPriority = array_values(array_filter(array_map('trim', explode(',', T2_NSFW_BROWSER_BACKEND_PRIORITY))));
        $nsfwRuntimeAssets = [
            'tfjs' => $nsfwAssetBase . '/tfjs/tf.min.js',
            'webgl' => $nsfwAssetBase . '/tfjs-backend-webgl/tf-backend-webgl.min.js',
            'webgpu' => $nsfwAssetBase . '/tfjs-backend-webgpu/tf-backend-webgpu.min.js',
            'wasm' => $nsfwAssetBase . '/tfjs-backend-wasm/tf-backend-wasm.min.js',
            'wasmBase' => $nsfwAssetBase . '/tfjs-backend-wasm/',
            'nsfwjs' => $nsfwAssetBase . '/nsfwjs/nsfwjs.min.js',
        ];

        $html .= "window.T2EDITOR_NSFW_SERVER_URL = " . json_encode($editor_url . '/config/nsfw_api_server.php', JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_URL = " . json_encode($editor_url . '/config/nsfw_api_browser.js', JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL = " . json_encode(T2_NSFW_BROWSER_MODEL, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_TYPE = " . json_encode(T2_NSFW_BROWSER_MODEL_TYPE, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_MODEL_URL = " . json_encode(T2_NSFW_BROWSER_MODEL_URL, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_BROWSER_BACKEND_PRIORITY = " . json_encode($nsfwBackendPriority, JSON_HEX_TAG | JSON_HEX_AMP) . ";";
        $html .= "window.T2EDITOR_NSFW_RUNTIME_ASSETS = " . json_encode($nsfwRuntimeAssets, JSON_HEX_TAG | JSON_HEX_AMP) . ";";

        // ── [UPLOAD-CONFIG] 통합 업로드 설정 JS 주입 ────────────────────────
        // video.js · file.js 등 모든 플러그인이 window.T2EDITOR_UPLOAD_CONFIG
        // 하나만 참조하도록 통합한다.
        //
        // get_js_config() 는 upload_config.php 에 정의된 단일 소스이며,
        // get_upload_config.php fallback 엔드포인트도 같은 함수를 사용한다.
        // 따라서 window 주입 값과 fallback 응답이 항상 동일한 구조를 보장한다.
        //
        // 반환 구조 → JS 참조 키:
        //   maxSizeMB              — 최대 업로드 크기 (MB 정수)
        //   extensions.image/video/document/audio/other — 카테고리별 확장자 배열
        //   accept.image/video/file — <input accept> 속성값
        //   mimeMap                — 비디오 확장자 → 대표 MIME (video.js 전용)
        // ─────────────────────────────────────────────────────────────────────
        if (function_exists('get_js_config')) {
            $html .= "window.T2EDITOR_UPLOAD_CONFIG = "
                   . json_encode(get_js_config(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ";";
        }

        // ── [SEC-IFRAME-ALLOWLIST] ────────────────────────────────────────────
        // iframe 허용 도메인 목록을 t2_config.php 에서 통합 관리한다.
        // t2editor_get_allowed_iframe_domains() 가 built-in 스트리밍 도메인 +
        // T2EDITOR_ALLOWED_URL_DOMAINS 사용자 설정을 모두 포함한다.
        //
        // 현재 서버 도메인은 클라이언트에서 location.hostname 으로 자동 추가됨.
        //
        // ★ t2_config.php 에 아래 함수를 추가하면 이 파일에서 하드코딩 제거 완료:
        //
        //   function t2editor_get_allowed_iframe_domains() {
        //       $builtin = [
        //           'youtube.com','www.youtube.com','m.youtube.com','youtu.be',
        //           'youtube-nocookie.com','www.youtube-nocookie.com',
        //           'vimeo.com','www.vimeo.com','player.vimeo.com',
        //           'dailymotion.com','www.dailymotion.com','geo.dailymotion.com',
        //           'twitch.tv','www.twitch.tv','player.twitch.tv','clips.twitch.tv',
        //           'tiktok.com','www.tiktok.com',
        //           'tv.kakao.com','play.kakao.com','tv.naver.com',
        //           'streamable.com','embed.streamable.com',
        //           'wistia.com','fast.wistia.com','wistia.net','fast.wistia.net',
        //           'w.soundcloud.com','open.spotify.com',
        //           'player.bilibili.com',
        //           'rumble.com','www.rumble.com','www.loom.com',
        //           'embed.vidyard.com','play.vidyard.com',
        //           'gfycat.com','www.gfycat.com','coub.com','www.coub.com',
        //       ];
        //       $user = is_array(T2EDITOR_ALLOWED_URL_DOMAINS)
        //           ? array_values(array_filter(T2EDITOR_ALLOWED_URL_DOMAINS, 'is_string'))
        //           : [];
        //       return array_values(array_unique(array_merge($builtin, $user)));
        //   }
        //
        // ─────────────────────────────────────────────────────────────────────
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

        // [I18N] 위 값들은 i18n.js 로드 전에 이미 bootstrap script로 주입됨.
        // 여기서 다시 덮어쓰지 않는다. (로드 순서가 늦으면 빈 카탈로그로 초기화되는 회귀 방지)

        $html .= "</script>";

        $js = false;
    }

    if ($is_dhtml_editor) {
        // ── [FIX-XSS/구조파괴] html_entity_decode 전에 <code> 내용 보호 ────────────
        // html_entity_decode()는 &lt; → < 등 전체 콘텐츠의 HTML 엔티티를 복원.
        // <code> 안에 &lt;/code&gt; 같은 엔티티가 있으면 복원 후 실제 HTML 태그가 되어
        // JS에서 tempDiv.innerHTML = contentToLoad 실행 시 HTML 파서가 이를 닫는 태그로
        // 해석 → <pre><code> 구조 파괴 + XSS 취약 + textarea 강제 확장 발생.
        //
        // 대책: decode 전에 <code> 내부의 & 를 &amp; 로 이중 인코딩.
        //   → html_entity_decode 후에도 엔티티 이스케이프가 유지됨.
        //
        // [^<]* 를 쓰는 이유: decode 전 상태에서 <code> 내부에는 &lt; 등 엔티티만
        //   있고 실제 < 문자는 존재하지 않으므로 [^<]* 로 안전하게 매칭 가능.
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
        // [SEC-XSS] str_replace 기반 수동 이스케이프 제거 →
        // json_encode(JSON_HEX_TAG|JSON_HEX_AMP)로 교체.
        // 기존 방식은 \u2028/\u2029(JS 줄바꿈), 멀티바이트 경계,
        // </script> 대소문자 변형 등을 처리하지 못해 XSS 가능했음.
        // JSON_HEX_TAG : <, > → \u003C, \u003E (스크립트 태그 탈출 방지)
        // JSON_HEX_AMP : &  → \u0026             (HTML 엔티티 충돌 방지)
        $json_content = json_encode($content, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);

        // [SEC-XSS] $id를 HTML 속성에 삽입 전 이스케이프
        $safe_id = htmlspecialchars($id, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // ======= 그누보드5 환경 및 관리자 페이지 감지 =======
        // _GNUBOARD_ 상수: 그누보드5가 로드될 때 반드시 정의되는 식별 상수
        $is_gnuboard5 = defined('_GNUBOARD_');

        $is_gnuboard5_admin = false;
        if ($is_gnuboard5) {
            global $is_admin;

            // 그누보드5 관리자 경로: $g5['admin_url'] 기준, 없으면 기본값 /adm
            $admin_path = '/adm';
            if (!empty($g5['admin_url'])) {
                $parsed = parse_url($g5['admin_url'], PHP_URL_PATH);
                if ($parsed) $admin_path = rtrim($parsed, '/');
            }

            $request_uri = $_SERVER['REQUEST_URI'] ?? '';

            // is_admin 변수가 비어 있지 않고, 현재 URL이 관리자 경로 하위인 경우
            $is_gnuboard5_admin = !empty($is_admin)
                && (
                    strpos($request_uri, $admin_path . '/') === 0
                    || strpos($request_uri, $admin_path . '?') === 0
                    || $request_uri === $admin_path
                    || strpos($request_uri, '/adm/') !== false
                );
        }

        ob_start(); ?>
<script>
// [SEC-XSS] JSON_HEX_TAG: T2EDITOR_URL 의 <\/script> 조기 종료 차단
const t2editor_url = <?php echo json_encode(T2EDITOR_URL ?? "", JSON_HEX_TAG | JSON_HEX_AMP); ?>;
</script>
<?php
// ======= [RHYMIX] 업로드 브릿지 변수 주입 =======
// Rhymix 에디터 스킨 어댑터(editor.html)가 editor_html() 을 호출하기
// 전에 $GLOBALS['t2editor_rx_*'] 를 세팅해 두면, 그 값들을 여기서 그대로
// window.T2EDITOR_RHYMIX_* 로 브라우저에 내려보낸다.
// plugin/image/image.js·plugin/file/file.js 등은 이 값이 있을 때만
// image_upload.php/file_upload.php 요청에 editor_sequence 등을 함께 실어
// Rhymix 파일 모듈로 위임되도록 한다 (T2Utils.appendRhymixUploadFields 참고).
// 표준(독립형)·그누보드5 호출부는 이 전역을 세팅하지 않으므로 완전히 무관하다.
$_t2_rx_editor_sequence = $GLOBALS['t2editor_rx_editor_sequence'] ?? null;
if ($_t2_rx_editor_sequence !== null): ?>
<script>
window.T2EDITOR_RHYMIX_EDITOR_SEQUENCE   = <?php echo json_encode((string)$_t2_rx_editor_sequence, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
window.T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL = <?php echo json_encode((string)($GLOBALS['t2editor_rx_upload_target_srl'] ?? ''), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
window.T2EDITOR_RHYMIX_MODULE_SRL        = <?php echo json_encode((string)($GLOBALS['t2editor_rx_module_srl'] ?? ''), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
window.T2EDITOR_RHYMIX_MID               = <?php echo json_encode((string)($GLOBALS['t2editor_rx_mid'] ?? ''), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
window.T2EDITOR_RHYMIX_CSRF_TOKEN        = <?php echo json_encode((string)($GLOBALS['t2editor_rx_csrf_token'] ?? ''), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
</script>
<?php endif; ?>
<?php
// ======= [WORDPRESS] 업로드 브릿지 변수 주입 =======
// t2editor/wordpress/t2editor-bridge.php (워드프레스 플러그인)가
// editor_html() 호출 전에 $GLOBALS['t2editor_wp_*'] 를 세팅해 두면,
// 그 값을 window.T2EDITOR_WP_* 로 브라우저에 내려보낸다. Rhymix 브릿지와
// 완전히 독립적으로 동작하며, 세팅되어 있지 않으면 아무 것도 출력하지
// 않는다(=독립형/그누보드5/Rhymix 는 완전히 무관).
$_t2_wp_nonce = $GLOBALS['t2editor_wp_nonce'] ?? null;
if ($_t2_wp_nonce !== null): ?>
<script>
window.T2EDITOR_WP_NONCE   = <?php echo json_encode((string)$_t2_wp_nonce, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
window.T2EDITOR_WP_POST_ID = <?php echo json_encode((string)($GLOBALS['t2editor_wp_post_id'] ?? '0'), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
</script>
<?php endif; ?>
<?php
if (isset($_SERVER['HTTP_USER_AGENT']) && stripos($_SERVER['HTTP_USER_AGENT'], 'Android') !== false) {
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">' . "\n";
    echo '<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">' . "\n";
}
?>

<script>
<?php if ($is_gnuboard5_admin): ?>
/**
 * 그누보드5 관리자 페이지 감지
 * ① loadAutoSave  → no-op (자동 저장 복원 차단)
 * ② setupAutoSaveToggle → 원본 실행 후 토글을 비활성화 디자인으로 전환
 *    - 체크박스 unchecked + disabled
 *    - 토글 영역 opacity 0.4 / pointer-events none / cursor not-allowed
 *    - 툴팁으로 비활성 이유 안내
 * core.js / utils.js 수정 없이 editor_lib.php 단에서만 처리.
 */
T2Editor.prototype.loadAutoSave = function() {
    console.log('[T2Editor] gnuboard5 admin page — skipped auto-save restore');
};

(function() {
    var _orig = T2Editor.prototype.setupAutoSaveToggle;
    T2Editor.prototype.setupAutoSaveToggle = function() {
        _orig.call(this);

        var toggle = this.container.querySelector('.t2-autosave-toggle');
        if (!toggle) return;

        /* 체크박스: 꺼진 상태 + 이벤트 차단 */
        var checkbox = toggle.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.checked  = false;
            checkbox.disabled = true;
        }

        /* 시각적 비활성화 */
        toggle.style.opacity       = '0.4';
        toggle.style.pointerEvents = 'none';
        toggle.style.cursor        = 'not-allowed';
        toggle.title = (typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.autosave_admin_disabled') : 'Auto-save is not available on admin pages.';

        /* 레이블 cursor도 일괄 적용 */
        var labels = toggle.querySelectorAll('label');
        labels.forEach(function(label) {
            label.style.cursor = 'not-allowed';
        });
    };
})();
<?php endif; ?>
(function() {
    const T2EditorConfig = {
        // extend/php 가 정의한 PHP 상수를 우선 사용 — 미설정 시 기존 기본값
        enableDarkModeButton: <?php echo defined('T2_DARKMODE_BUTTON_ENABLED') ? (T2_DARKMODE_BUTTON_ENABLED ? 'true' : 'false') : 'true'; ?>,
        //enableDarkModeButton: 다크모드 전환 버튼 표시 여부 (true: 표시, false: 숨김)
        forcedTheme: <?php echo (defined('T2_DARKMODE_FORCED_THEME') && T2_DARKMODE_FORCED_THEME !== null) ? json_encode(T2_DARKMODE_FORCED_THEME, JSON_HEX_TAG) : 'null'; ?>
        //forcedTheme: 테마 강제 설정 (null: 사용자 설정/시스템 따름, 'dark': 다크모드 고정, 'light': 라이트모드 고정)
    };

    if (!T2EditorConfig.enableDarkModeButton && T2EditorConfig.forcedTheme) {
        document.documentElement.setAttribute('data-t2editor-theme', T2EditorConfig.forcedTheme);
        localStorage.setItem('t2editor-dark-mode', T2EditorConfig.forcedTheme === 'dark' ? 'true' : 'false');
    } else {
        var storedTheme = localStorage.getItem('t2editor-dark-mode');
        var isDarkMode = storedTheme === null
            ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
            : storedTheme === 'true';

        document.documentElement.setAttribute('data-t2editor-theme', isDarkMode ? 'dark' : 'light');
    }

    document.addEventListener('DOMContentLoaded', function() {
        var darkModeToggle = document.querySelector('.t2-dark-mode-toggle');
        if (darkModeToggle) {
            darkModeToggle.style.display = T2EditorConfig.enableDarkModeButton ? 'flex' : 'none';
        }
    });
})();
</script>

<style>
@font-face {
  font-family: "Material Icons";
  font-style: normal;
  font-weight: 400;
  src: url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.eot");
  src: local("Material Icons"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff2") format("woff2"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff") format("woff"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.ttf") format("truetype");
  font-display: swap;
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
  src: url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2") format("woff2"),
       url("<?php echo _t2e_css_url(T2EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.ttf") format("truetype");
  font-display: swap;
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

<div class="t2-editor-container" id="<?php echo $safe_id ?>_container">
    <div class="t2-toolbar">
        <?php echo _t2e_build_toolbar_html(
            $T2EDITOR_PLUGINS,
            $T2EDITOR_PLUGIN_PRIORITY,
            $T2EDITOR_BUTTON_ORDER,
            $T2EDITOR_LEGACY_BUTTONS
        ); ?>
    </div>
    <div class="t2-editor" contenteditable="true" id="<?php echo $safe_id ?>_editor"></div>
    <textarea name="<?php echo $safe_id ?>" id="<?php echo $safe_id ?>" style="display:none;"><?php
        // [SEC-XSS] $content를 textarea HTML 컨텍스트에 맞게 이스케이프.
        // </textarea> 등의 삽입으로 인한 HTML injection 방지.
        echo htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    ?></textarea>
    <div class="t2-editor-status">
        <div class="t2-status-left">
            <a href="//dsclub.kr/service/editor">
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
    <span id="<?php echo $safe_id ?>_version_info"
          class="t2-debug-trigger"
          role="button" tabindex="0"
          onclick="showT2DebugModal(event, '<?php echo $safe_id ?>')"
          onkeydown="if(event.key==='Enter'||event.key===' '){showT2DebugModal(event, '<?php echo $safe_id ?>');}"
          style="color: #7a7a7a; position: absolute; right: 5px; margin:5px 0; font-size: 11px; font-weight: 500; display: flex; align-items: center; cursor: pointer;"
          aria-label="에디터 디버그 정보 보기">
        <i class="material-icons-outlined" style="margin-right: 4px; font-size: 14px">info</i>
        <?php
        $v = get_readme_version();
        // [I18N] 버전 표시 — 번역 키가 있으면 사용, 없으면 기존 로직
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
    display: flex; align-items: center; gap: 8px; padding: 8px 14px;
    border-bottom: 1px solid #3a3a3a;
}
.t2-debug-modal-copy, .t2-debug-modal-refresh {
    font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid #4a4a4a;
    background: #2a2a2a; color: #eaeaea; cursor: pointer;
}
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
    const currentTheme = document.documentElement.getAttribute('data-t2editor-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-t2editor-theme', newTheme);
    localStorage.setItem('t2editor-dark-mode', newTheme === 'dark');
}

// ════════════════════════════════════════════════════════════════════════
// [DEBUG-MODAL] 모바일 디버깅 모달 — 버전 정보(i) 클릭 시 노출
// ───────────────────────────────────────────────────────────────────────
// 개발자도구 접근이 어려운 모바일 환경에서, 현재 에디터가 들고 있는
// 콘텐츠 상태를 텍스트로 즉시 확인/복사할 수 있게 한다.
// 특히 비디오/이미지 등 미디어 블록의 style(px) 값과 data-width 등
// data-* 값이 서로 어긋나 있는지("stale baseline" 유형 버그)를
// 한눈에 볼 수 있도록 강조 표시한다.
// ───────────────────────────────────────────────────────────────────────
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

    // ── 미디어 블록(비디오/이미지) style vs data-* 불일치 검사 ─────────────
    // [FIX-DEBUG-DUPCOUNT] '.t2-media-block, [data-t2-block]' 로 셀렉터를 잡으면
    // 바깥 wrapper div(.t2-media-block, data-t2-block 도 가짐)와 안쪽 사이즈
    // 컨테이너 div(data-t2-block 만 가짐)가 "같은 영상"인데도 각각 매치되어
    // 2개로 중복 카운트되는 버그가 있었다. wrapper 기준(.t2-media-block)으로만
    // 세고, container는 그 안에서 별도로 찾도록 수정.
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

// ════════════════════════════════════════════════════════════════════════
// [I18N] 번역 토글 + 언어 선택 메뉴 — T2Editor 10.2.1-beta2+
// ───────────────────────────────────────────────────────────────────────
// 다크모드 토글과 텍스트 수 표시 사이에 위치한 translate 아이콘 버튼
// 클릭 시: 언어 선택 드롭다운 메뉴 토글
// 언어 선택 시: T2I18N.setLocale() 호출하여 전체 UI 번역 전환
// ───────────────────────────────────────────────────────────────────────
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
    // [SEC-XSS] $safe_id는 이미 htmlspecialchars 처리됨 (< → &lt; 로 변환).
    // script 컨텍스트에서 HTML 엔티티는 디코딩되지 않으므로 &lt;/script> 는 스크립트를 닫지 않음.
    // 추가로 JSON_HEX_TAG | JSON_HEX_AMP 를 적용하여 이중 방어.
    //
    // [BUG-FIX] 이중 인코딩 수정: $safe_id 대신 raw $id 를 json_encode 에 전달.
    // $safe_id = htmlspecialchars($id) 는 HTML 속성 컨텍스트 전용이며,
    // DOM 속성 id 값은 브라우저가 엔티티를 복원하므로 실제 id = $id 임.
    // json_encode($safe_id)를 쓰면 JS 코드는 "&lt;foo&gt;" 를 탐색하지만
    // 실제 DOM id 는 "<foo>" 이므로 getElementById 가 null 을 반환하는 버그 발생.
    // json_encode(JSON_HEX_TAG) 자체가 < > 를 \u003C \u003E 로 안전하게 처리함.
    const editorContainerId = <?php echo json_encode($id . '_container', JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editorTextareaId  = <?php echo json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    const editor = new T2Editor(document.getElementById(editorContainerId));
    window[<?php echo json_encode($id . '_editor', JSON_HEX_TAG | JSON_HEX_AMP); ?>] = editor;

    if (<?php echo $json_content; ?>) {
        try {
            // [SEC-XSS] json_encode(JSON_HEX_TAG|JSON_HEX_AMP) 사용으로
            // <\/script> 조기 종료, \u2028/\u2029 JS 줄바꿈 문자 등 완전 차단.
            var contentToLoad = <?php echo $json_content; ?>;
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = contentToLoad;

            // ── [v10.0.0] STEP 1: 플러그인 restore 훅 실행 ───────────────────────────────
            T2EditorHooks.runRestore(tempDiv);

            // ── [v10.0.0] STEP 2: 레거시 fallback ───────────────────────────────────────
            // hooks.js 없는 서드파티/구버전 플러그인을 위해 V9 인라인 코드를 조건부 실행.
            // T2LegacyFallback.runRestoreFallback()은 T2EditorHooks.has()로 각 플러그인
            // 등록 여부를 확인하여 이미 hooks.js가 처리하는 플러그인은 건너뛴다.
            // 캡슐 제거: js/legacy_fallback.js 삭제 + 이 줄 삭제
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
        // [SEC-XSS] is_dhtml_editor=false 브랜치에서도 $id, $content 이스케이프 적용
        $safe_id_ne      = htmlspecialchars($id,      ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $safe_content_ne = htmlspecialchars($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $html .= "\n<textarea id=\"{$safe_id_ne}\" name=\"{$safe_id_ne}\" style=\"width:100%;height:300px\">{$safe_content_ne}</textarea>";
    }

    return $html;
}

function get_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // [SEC-XSS] T2EDITOR_URL을 JS 문자열로 안전하게 삽입:
        // json_encode(JSON_HEX_TAG)는 <, > → \u003C, \u003E로 인코딩하여
        // </script> 탈출 및 HTML 인젝션을 차단함.
        $js_editor_url = json_encode(T2EDITOR_URL, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
        // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP 추가:
        // 기본 json_encode()는 < > & 를 이스케이프하지 않으므로
        // $id 에 </script> 가 포함되면 스크립트 블록이 조기 종료되어 XSS 발생.
        // JSON_HEX_TAG: < → \u003C, > → \u003E 로 인코딩하여 탈출 차단.
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
        return "
var _submitContent = function () {
    var editorContent = document.getElementById({$js_id} + '_editor').innerHTML;
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = editorContent;

    // ── [v10.0.0] STEP 1: 전역 공통 처리 (항상 실행) ─────────────────────────
    tempDiv.querySelectorAll('.t2-move-controls').forEach(function (ctrl) { ctrl.remove(); });

    // ── [v10.0.0] STEP 2: 플러그인 submit 훅 실행 ─────────────────────────────
    T2EditorHooks.runSubmit(tempDiv);

    // ── [v10.0.0] STEP 2.5: 레거시 fallback ─────────────────────────────────────
    // hooks.js 없는 서드파티/구버전 플러그인을 위해 V9 인라인 코드를 조건부 실행.
    // 캡슐 제거: js/legacy_fallback.js 삭제 + 이 블록 삭제
    if (window.T2LegacyFallback) {
        T2LegacyFallback.runSubmitFallback(tempDiv);
    }

    // ── [v10.0.0] STEP 3: 테이블 DB 저장 포맷 변환 (항상 실행) ───────────────────
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

    // ── finalContent 조합 ──────────────────────────────────────────────────
    var contentStyle = '<link href=\"' + {$js_editor_url} + '/css/content.css\" rel=\"stylesheet\">';
    var finalContent = tempDiv.innerHTML;
    // [FIX-DUP-CSS] 기존에는 media/table/code/drawing 블록이 있으면 매번
    // contentStyle 을 무조건 append 했다. 이미 발행된 글을 다시 수정 후
    // 재발행하면 tempDiv(=에디터에 복원된 기존 콘텐츠) 안에 이전 저장에서
    // 붙인 <link href=\".../content.css\"> 가 이미 들어있는 상태에서 또
    // 붙게 되어, 수정·재발행을 반복할 때마다 동일한 <link> 태그가 계속
    // 누적되는 문제가 있었다. 이미 포함되어 있으면 다시 추가하지 않는다.
    if ((finalContent.indexOf('t2-media-block') !== -1 || finalContent.indexOf('t2-table') !== -1 || finalContent.indexOf('t2-code-block') !== -1 || finalContent.indexOf('t2-drawing-block') !== -1)
        && finalContent.indexOf('/css/content.css') === -1) {
        finalContent += contentStyle;
    }
    document.getElementById({$js_id}).value = finalContent;
};
_submitContent();\n";
    }
    // [SEC-XSS] getElementById 인수: JSON_HEX_TAG | JSON_HEX_AMP 로 </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    // [BUG-FIX] $js_id is a JSON string including quotes (e.g. "foo"),
    // so "var {$js_id}_editor" becomes var "foo"_editor — invalid identifier.
    // Build a separate safe identifier from alphanumeric/underscore characters.
    // Also, JS identifiers cannot start with a digit (ES2015 §11.6):
    // $id = "1board_content" → var 1board_content_editor ← SyntaxError.
    // Prefix "t2_" ensures all IDs produce valid identifiers.
    $js_var = 't2_' . preg_replace('/[^a-zA-Z0-9_]/', '_', $id);
    return "var {$js_var}_editor = document.getElementById({$js_id});\n";
}

function chk_editor_js($id, $is_dhtml_editor=true) {
    if ($is_dhtml_editor) {
        // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
        $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
        return "
            var editorContent = document.getElementById({$js_id} + '_editor').innerHTML;
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
    // [SEC-XSS] JSON_HEX_TAG | JSON_HEX_AMP: </script> 탈출 차단
    $js_id = json_encode($id, JSON_HEX_TAG | JSON_HEX_AMP);
    return "if (!document.getElementById({$js_id}).value) { alert((typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.content_required') : 'Please enter some content.'); document.getElementById({$js_id}).focus(); return false; }\n";
}
?>