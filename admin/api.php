<?php
/**
 * T2Editor Admin API
 * Path: t2editor/admin/api.php
 *
 * 모든 관리자 AJAX 요청을 처리하는 REST API 엔드포인트.
 * 직접 접근 시 JSON 응답 반환.
 */

define('T2ADMIN_API', true);
@session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

$_ROOT = dirname(__DIR__);  // t2editor/

// editor.lib.php 를 통해 t2_config.php 로드 + 라이선스 검증 함수(_t2e_get_status 등) 확보
require_once $_ROOT . '/editor.lib.php';

define('T2ADMIN_DATA_PATH', T2EDITOR_DATA_PATH);
define('T2ADMIN_SETTINGS_FILE', T2ADMIN_DATA_PATH . '/admin_settings.json');
define('T2ADMIN_AUTH_FILE', T2ADMIN_DATA_PATH . '/admin_auth.json');
define('T2ADMIN_KEY_FILE', __DIR__ . '/t2admin.key');
define('T2ADMIN_KEY_TXT',  __DIR__ . '/t2admin.key.txt');

// ── 헬퍼 함수 ────────────────────────────────────────────────────────────
function t2a_json(bool $ok, $data = null, string $msg = ''): void {
    echo json_encode(['ok' => $ok, 'data' => $data, 'msg' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function t2a_key_active(): bool {
    return file_exists(T2ADMIN_KEY_FILE);
}

function t2a_auth_exists(): bool {
    if (!file_exists(T2ADMIN_AUTH_FILE)) return false;
    $d = @json_decode(@file_get_contents(T2ADMIN_AUTH_FILE), true);
    return !empty($d['password_hash']) && !empty($d['setup_complete']);
}

function t2a_is_logged_in(): bool {
    return !empty($_SESSION['t2admin_logged_in']) && $_SESSION['t2admin_logged_in'] === true;
}

function t2a_csrf_valid(): bool {
    $token = $_SERVER['HTTP_X_T2ADMIN_CSRF'] ?? ($_POST['_csrf'] ?? '');
    return !empty($_SESSION['t2admin_csrf'])
        && hash_equals($_SESSION['t2admin_csrf'], $token);
}

function t2a_get_csrf(): string {
    if (empty($_SESSION['t2admin_csrf'])) {
        $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['t2admin_csrf'];
}

function t2a_read_settings(): array {
    if (!file_exists(T2ADMIN_SETTINGS_FILE)) return t2a_default_settings();
    $d = @json_decode(@file_get_contents(T2ADMIN_SETTINGS_FILE), true);
    if (!is_array($d)) return t2a_default_settings();
    return array_replace_recursive(t2a_default_settings(), $d);
}

function t2a_write_settings(array $data): bool {
    $dir = T2ADMIN_DATA_PATH;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (!is_writable($dir)) return false;
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents(T2ADMIN_SETTINGS_FILE, $json, LOCK_EX) !== false;
}

function t2a_default_settings(): array {
    return [
        '_version' => '1.0',
        'editor' => [
            'css_min' => true,
            'js_min' => false,
            'darkmode_button_enabled' => true,
            'darkmode_forced_theme' => null,
            'migration_mode' => false,
            'video_player_enabled' => true,
        ],
        'nsfw' => [
            'enabled' => false,
            'mode' => 'browser',
            'allow_suspicious' => true,
            'browser_backend_priority' => 'webgpu,webgl,wasm,cpu',
        ],
        'plugins' => [
            'active' => ['link','image','video','file','table','code','export','search','draw','collab','ai_complex','clipurl','meme'],
            'priority' => ['image'=>0,'video'=>1,'link'=>2,'ai_complex'=>3,'file'=>4,'code'=>4,'search'=>4,'table'=>5,'draw'=>6,'collab'=>6,'meme'=>8,'export'=>9,'clipurl'=>9],
            'button_order' => [],
        ],
        'domains' => [
            'extra_url_domains' => [],
            'iframe_domains' => null,
            'custom_iframe_domains' => [],
        ],
        'upload' => [
            'max_size_mb' => 50,
            'strict_webp' => true,
            'max_image_pixels' => 50000000,
            'extensions' => [
                'document' => ['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','hwp','odt','ods','odp','rtf'],
                'image' => ['jpg','jpeg','png','gif','webp','bmp'],
                'video' => ['mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v'],
                'other' => ['zip','rar','7z','tar','gz','bz2','mp3','m4a','wav','flac','aac','wma','json','xml','csv'],
            ],
        ],
        'icons' => [],            // command => {type, name, style}
        'toolbar_groups' => null, // null = toolbar.js 내장 기본값 사용
    ];
}

function t2a_builtin_iframe_domains(): array {
    return [
        'youtube.com','www.youtube.com','m.youtube.com','youtu.be',
        'youtube-nocookie.com','www.youtube-nocookie.com',
        'vimeo.com','www.vimeo.com','player.vimeo.com',
        'dailymotion.com','www.dailymotion.com','geo.dailymotion.com',
        'twitch.tv','www.twitch.tv','player.twitch.tv','clips.twitch.tv',
        'tiktok.com','www.tiktok.com',
        'tv.kakao.com','play.kakao.com','tv.naver.com',
        'streamable.com','embed.streamable.com',
        'wistia.com','fast.wistia.com','wistia.net','fast.wistia.net',
        'w.soundcloud.com','open.spotify.com','player.bilibili.com',
        'rumble.com','www.rumble.com','www.loom.com',
        'embed.vidyard.com','play.vidyard.com',
        'gfycat.com','www.gfycat.com','coub.com','www.coub.com',
    ];
}

// 에디터 코어 명령(undo/bold 등) — editor.lib.php 내부에 고정 정의된 기본 포맷 버튼.
// 플러그인처럼 디렉토리 확장이 일어나는 대상이 아니므로 여기서만 최소 목록 유지.
function t2a_core_buttons(): array {
    return [
        ['command'=>'undo',           'label'=>'undo',                       'icon'=>'undo',                  'icon_type'=>'material-icons'],
        ['command'=>'redo',           'label'=>'redo',                       'icon'=>'redo',                  'icon_type'=>'material-icons'],
        ['command'=>'bold',           'label'=>'format bold',                'icon'=>'format_bold',           'icon_type'=>'material-icons'],
        ['command'=>'italic',         'label'=>'format italic',              'icon'=>'format_italic',         'icon_type'=>'material-icons'],
        ['command'=>'underline',      'label'=>'format underline',           'icon'=>'format_underlined',     'icon_type'=>'material-icons'],
        ['command'=>'strikeThrough',  'label'=>'format strikethrough',       'icon'=>'format_strikethrough',  'icon_type'=>'material-icons'],
        ['command'=>'justifyContent', 'label'=>'format align left',          'icon'=>'format_align_left',     'icon_type'=>'material-icons'],
        ['command'=>'fontSize',       'label'=>'format font size',           'icon'=>'format_size',           'icon_type'=>'material-icons'],
        ['command'=>'foreColor',      'label'=>'format text color',          'icon'=>'format_color_text',     'icon_type'=>'material-icons'],
        ['command'=>'backColor',      'label'=>'format text background color','icon'=>'format_color_fill',    'icon_type'=>'material-icons'],
    ];
}

// 플러그인 동적 스캔 (plugin/ 디렉토리 기반) — button.json 의 모든 버튼을 수집
function t2a_scan_plugins(): array {
    $plugin_dir = T2EDITOR_PATH . '/plugin';
    if (!is_dir($plugin_dir)) return [];
    $plugins = [];
    foreach (glob($plugin_dir . '/*/') as $dir) {
        $name = basename($dir);
        if (!preg_match('/^[a-zA-Z0-9_-]+$/', $name)) continue;
        $info = ['name' => $name, 'buttons' => []];
        $btn_file = $dir . 'button.json';
        if (file_exists($btn_file)) {
            $btn = @json_decode(@file_get_contents($btn_file), true);
            if (is_array($btn) && !empty($btn['buttons'])) {
                foreach ($btn['buttons'] as $b) {
                    $info['buttons'][] = [
                        'command'   => $b['command'] ?? '',
                        'label'     => $b['ariaLabel'] ?? ($b['command'] ?? $name),
                        'icon'      => $b['icon']['name'] ?? null,
                        'icon_type' => $b['icon']['type'] ?? 'material-icons',
                        'icon_style'=> $b['icon']['style'] ?? null,
                        'btn_style' => $b['style'] ?? null,
                        'order'     => $b['order'] ?? 999,
                    ];
                }
            }
        }
        $plugins[$name] = $info;
    }
    ksort($plugins);
    return $plugins;
}

// 아이콘 매니저 / 반응형 툴바 패널이 공통으로 쓰는 전체 버튼 목록(코어+플러그인, 평탄화)
function t2a_all_buttons_flat(): array {
    $out = [];
    foreach (t2a_core_buttons() as $b) {
        $b['plugin'] = null;
        $b['source'] = 'core';
        $out[] = $b;
    }
    foreach (t2a_scan_plugins() as $pname => $pinfo) {
        foreach ($pinfo['buttons'] as $b) {
            if ($b['command'] === '') continue;
            $b['plugin'] = $pname;
            $b['source'] = 'plugin';
            $out[] = $b;
        }
    }
    return $out;
}

// extend 현황 스캔
function t2a_scan_extend(): array {
    $result = ['php' => [], 'js' => []];
    foreach (['php', 'js'] as $type) {
        $dir = T2EDITOR_PATH . '/extend/' . $type;
        if (!is_dir($dir)) continue;
        foreach (glob($dir . '/*.' . $type) as $f) {
            $base = basename($f);
            if (stripos($base, 'README') === 0) continue;
            $result[$type][] = [
                'file' => $base,
                'size' => filesize($f),
                'mtime' => filemtime($f),
                'is_admin' => str_starts_with($base, 't2admin_'),
            ];
        }
        usort($result[$type], fn($a,$b) => strcmp($a['file'], $b['file']));
    }
    return $result;
}

// ── extend/js 자동 생성 ───────────────────────────────────────────────────

// ── 액션 라우터 ───────────────────────────────────────────────────────────
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

$json_body = null;
if ($method === 'POST' && strpos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== false) {
    $json_body = @json_decode(file_get_contents('php://input'), true);
}

// ── 공개 액션 (인증 불필요) ──────────────────────────────────────────────
if ($action === 'status') {
    t2a_json(true, [
        'key_active'   => t2a_key_active(),
        'key_txt'      => file_exists(T2ADMIN_KEY_TXT),
        'auth_exists'  => t2a_auth_exists(),
        'logged_in'    => t2a_is_logged_in(),
        'csrf'         => t2a_get_csrf(),
        'data_writable'=> is_writable(T2ADMIN_DATA_PATH),
        'data_path'    => T2ADMIN_DATA_PATH,
        'version'      => function_exists('get_readme_version') ? get_readme_version() : null,
    ]);
}

if ($action === 'setup' && $method === 'POST') {
    if (!t2a_key_active()) t2a_json(false, null, '관리자 키 파일이 활성화되지 않았습니다.');
    if (t2a_auth_exists()) t2a_json(false, null, '이미 설정이 완료되었습니다. 로그인하세요.');
    $pw = $json_body['password'] ?? $_POST['password'] ?? '';
    if (strlen($pw) < 8) t2a_json(false, null, '비밀번호는 8자 이상이어야 합니다.');
    if (!is_dir(T2ADMIN_DATA_PATH)) @mkdir(T2ADMIN_DATA_PATH, 0755, true);
    if (!is_writable(T2ADMIN_DATA_PATH)) t2a_json(false, null, 'data 디렉토리에 쓰기 권한이 없습니다.');
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $auth = ['password_hash' => $hash, 'setup_complete' => true, 'created_at' => date('c')];
    if (!file_put_contents(T2ADMIN_AUTH_FILE, json_encode($auth, JSON_PRETTY_PRINT), LOCK_EX)) {
        t2a_json(false, null, '인증 파일 저장에 실패했습니다.');
    }
    if (!file_exists(T2ADMIN_SETTINGS_FILE)) {
        t2a_write_settings(t2a_default_settings());
    }
    $_SESSION['t2admin_logged_in'] = true;
    $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
    t2a_json(true, ['csrf' => $_SESSION['t2admin_csrf']], '관리자 설정이 완료되었습니다.');
}

if ($action === 'login' && $method === 'POST') {
    if (!t2a_key_active()) t2a_json(false, null, '관리자 키 파일이 활성화되지 않았습니다.');
    if (!t2a_auth_exists()) t2a_json(false, null, '먼저 관리자 설정을 완료하세요.');
    $pw = $json_body['password'] ?? $_POST['password'] ?? '';
    $auth = @json_decode(@file_get_contents(T2ADMIN_AUTH_FILE), true);
    if (!password_verify($pw, $auth['password_hash'] ?? '')) {
        sleep(1);
        t2a_json(false, null, '비밀번호가 올바르지 않습니다.');
    }
    session_regenerate_id(true);
    $_SESSION['t2admin_logged_in'] = true;
    $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
    $auth['last_login'] = date('c');
    @file_put_contents(T2ADMIN_AUTH_FILE, json_encode($auth, JSON_PRETTY_PRINT), LOCK_EX);
    t2a_json(true, ['csrf' => $_SESSION['t2admin_csrf']]);
}

// ── 인증 필요 액션 ────────────────────────────────────────────────────────
if (!t2a_is_logged_in()) {
    t2a_json(false, null, '인증이 필요합니다.');
}

if ($action === 'logout') {
    session_destroy();
    t2a_json(true);
}

if ($action === 'get_settings') {
    $settings = t2a_read_settings();
    $settings['_builtin_iframe_domains'] = t2a_builtin_iframe_domains();
    t2a_json(true, $settings);
}

if ($action === 'save_settings' && $method === 'POST') {
    if (!t2a_csrf_valid()) t2a_json(false, null, 'CSRF 검증 실패');
    $new = $json_body ?? [];
    unset($new['_builtin_iframe_domains']);
    if (!is_writable(T2ADMIN_DATA_PATH)) t2a_json(false, null, 'data 디렉토리에 쓰기 권한이 없습니다.');

    // 섹션 단위 전체 교체(얕은 병합) — 시퀀셜 배열(plugins.active 등) 누적 오염 방지.
    // 요청에 포함된 최상위 키만 통째로 덮어쓰고, 포함되지 않은 섹션은 기존 값을 보존한다.
    $current = t2a_read_settings();
    $merged  = $current;
    foreach ($new as $section => $value) {
        if ($section === '_version') continue;
        $merged[$section] = $value;
    }
    $merged['_version'] = $current['_version'] ?? '1.0';

    if (!t2a_write_settings($merged)) {
        t2a_json(false, null, '설정 저장에 실패했습니다. data/ 폴더 쓰기 권한을 확인하세요.');
    }
    t2a_json(true, null, '설정이 저장되었습니다.');
}

if ($action === 'get_extend') {
    t2a_json(true, t2a_scan_extend());
}

if ($action === 'get_plugins') {
    t2a_json(true, t2a_scan_plugins());
}

if ($action === 'get_all_buttons') {
    t2a_json(true, t2a_all_buttons_flat());
}

if ($action === 'get_license') {
    $valid = false;
    $msg = '라이선스 확인 함수를 찾을 수 없습니다.';
    if (function_exists('_t2e_get_status')) {
        [$valid, $msg] = _t2e_get_status();
    }
    t2a_json(true, [
        'valid'   => $valid,
        'msg'     => $valid ? '' : $msg,
        'version' => function_exists('get_readme_version') ? get_readme_version() : '',
    ]);
}

if ($action === 'get_system_info') {
    t2a_json(true, [
        'php_version'   => PHP_VERSION,
        'data_path'     => T2ADMIN_DATA_PATH,
        'data_writable' => is_writable(T2ADMIN_DATA_PATH),
        'editor_path'   => T2EDITOR_PATH,
        'editor_url'    => T2EDITOR_URL,
        'runtime_js_present' => file_exists(T2EDITOR_PATH . '/extend/js/t2admin_runtime.js'),
        'gd_info'       => function_exists('gd_info') ? array_keys(gd_info()) : [],
        'settings_file' => file_exists(T2ADMIN_SETTINGS_FILE) ? 'exists' : 'not_found',
    ]);
}

if ($action === 'change_password' && $method === 'POST') {
    if (!t2a_csrf_valid()) t2a_json(false, null, 'CSRF 검증 실패');
    $cur = $json_body['current_password'] ?? '';
    $new = $json_body['new_password'] ?? '';
    if (strlen($new) < 8) t2a_json(false, null, '새 비밀번호는 8자 이상이어야 합니다.');
    $auth = @json_decode(@file_get_contents(T2ADMIN_AUTH_FILE), true);
    if (!password_verify($cur, $auth['password_hash'] ?? '')) {
        t2a_json(false, null, '현재 비밀번호가 올바르지 않습니다.');
    }
    $auth['password_hash'] = password_hash($new, PASSWORD_DEFAULT);
    $auth['changed_at'] = date('c');
    if (!file_put_contents(T2ADMIN_AUTH_FILE, json_encode($auth, JSON_PRETTY_PRINT), LOCK_EX)) {
        t2a_json(false, null, '비밀번호 변경에 실패했습니다.');
    }
    t2a_json(true, null, '비밀번호가 변경되었습니다.');
}

if ($action === 'reset_settings' && $method === 'POST') {
    if (!t2a_csrf_valid()) t2a_json(false, null, 'CSRF 검증 실패');
    if (t2a_write_settings(t2a_default_settings())) {
        t2a_json(true, null, '설정이 초기화되었습니다.');
    } else {
        t2a_json(false, null, '초기화에 실패했습니다.');
    }
}

t2a_json(false, null, '알 수 없는 요청: ' . htmlspecialchars($action));
