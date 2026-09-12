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
require_once T2EDITOR_BASE_PATH . '/editor.lib.php';

define('T2ADMIN_DATA_PATH', T2EDITOR_PRIVATE_PATH);
define('T2ADMIN_SETTINGS_FILE', T2ADMIN_DATA_PATH . '/admin_settings.php');
// Shared with third_party_api.core.php (T2TP_SETTINGS_LOCK_FILE): a plugin
// install/uninstall can flip plugins.active at the same time an admin is
// saving settings from the UI, so both must serialize on this file to avoid
// a lost update (last writer silently discards the other's change).
define('T2ADMIN_SETTINGS_LOCK_FILE', T2ADMIN_DATA_PATH . '/admin_settings.lock');
define('T2ADMIN_AUTH_FILE', T2ADMIN_DATA_PATH . '/admin_auth.php');
define('T2ADMIN_KEY_FILE', T2EDITOR_BASE_PATH . '/admin/t2admin.key');
define('T2ADMIN_KEY_TXT',  T2EDITOR_BASE_PATH . '/admin/t2admin.key.txt');

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
    $d = t2_private_store_read(T2ADMIN_AUTH_FILE, array());
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
    $d = t2_private_store_read(T2ADMIN_SETTINGS_FILE, array());
    if (!is_array($d)) return t2a_default_settings();
    return array_replace_recursive(t2a_default_settings(), $d);
}

function t2a_write_settings(array $data): bool {
    $dir = T2ADMIN_DATA_PATH;
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    if (!is_writable($dir)) return false;
    // Runtime/package roots do not depend on toolbar or active-plugin
    // preferences. Translation caches contain every installed namespace, so a
    // settings-only save must not regenerate the runtime index or locale slots.
    return t2_private_store_write(T2ADMIN_SETTINGS_FILE, $data);
}

/**
 * 관리자 화면과 동일한 로컬 Material Icons 카탈로그만 저장하도록 정규화한다.
 * 원격 카탈로그나 브라우저 입력값을 신뢰하지 않는다.
 */
function t2a_normalize_icon_overrides($icons): array {
    if (!is_array($icons)) {
        throw new InvalidArgumentException('아이콘 설정 형식이 올바르지 않습니다.');
    }
    $catalogFile = __DIR__ . '/material_icon_catalog.json';
    $catalog = json_decode((string)@file_get_contents($catalogFile), true);
    if (!is_array($catalog)) {
        throw new RuntimeException('내장 아이콘 카탈로그를 읽을 수 없습니다.');
    }
    $supported = array_fill_keys($catalog, true);
    $normalized = [];
    foreach ($icons as $command => $override) {
        if (!is_string($command) || $command === '' || strlen($command) > 160 || preg_match('/[\x00-\x1F\x7F]/', $command)) {
            throw new InvalidArgumentException('아이콘 적용 대상 이름이 올바르지 않습니다.');
        }
        if (!is_array($override)) {
            throw new InvalidArgumentException($command . ': 아이콘 설정 형식이 올바르지 않습니다.');
        }
        $type = isset($override['type']) && is_string($override['type']) ? $override['type'] : 'material-icons';
        $name = isset($override['name']) && is_string($override['name']) ? trim($override['name']) : '';
        $style = isset($override['style']) && is_string($override['style']) ? trim($override['style']) : '';
        if (!in_array($type, ['material-icons', 'material-icons-outlined'], true)) {
            throw new InvalidArgumentException($command . ': 지원하지 않는 아이콘 종류입니다.');
        }
        if ($name === '' || !preg_match('/^[a-z0-9_]{1,80}$/', $name) || !isset($supported[$name])) {
            throw new InvalidArgumentException($command . ': 이 설치본에서 지원하지 않는 아이콘 이름입니다.');
        }
        if (strlen($style) > 500 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $style)) {
            throw new InvalidArgumentException($command . ': 아이콘 스타일 값이 너무 길거나 올바르지 않습니다.');
        }
        $normalized[$command] = ['type' => $type, 'name' => $name, 'style' => $style];
    }
    return $normalized;
}

function t2a_norm_path(string $path): string {
    return rtrim(str_replace('\\', '/', $path), '/');
}

function t2a_path_is_inside(string $path, string $root): bool {
    $path = t2a_norm_path($path);
    $root = t2a_norm_path($root);
    return $path === $root || strncmp($path . '/', $root . '/', strlen($root) + 1) === 0;
}

function t2a_tree_size(string $path): int {
    if (!file_exists($path) && !is_link($path)) return 0;
    if (is_file($path) || is_link($path)) return (int)(@filesize($path) ?: 0);
    $total = 0;
    $items = @scandir($path);
    if (!is_array($items)) return 0;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $total += t2a_tree_size($path . '/' . $item);
    }
    return $total;
}

function t2a_remove_tree_safe(string $path, string $allowedRoot): bool {
    $normalPath = t2a_norm_path($path);
    $normalRoot = t2a_norm_path($allowedRoot);
    if ($normalPath === '' || $normalRoot === '' || !t2a_path_is_inside($normalPath, $normalRoot) || $normalPath === $normalRoot) {
        return false;
    }
    if (is_link($path) || is_file($path)) return @unlink($path) || !file_exists($path);
    if (!is_dir($path)) return true;
    $items = @scandir($path);
    if (!is_array($items)) return false;
    $ok = true;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $child = $path . '/' . $item;
        if (is_dir($child) && !is_link($child)) {
            if (!t2a_remove_tree_safe($child, $allowedRoot)) $ok = false;
        } elseif (!@unlink($child) && file_exists($child)) {
            $ok = false;
        }
    }
    return (@rmdir($path) || !is_dir($path)) && $ok;
}

function t2a_cache_targets(): array {
    $compiled = function_exists('t2editor_i18n_compiled_file')
        ? t2editor_i18n_compiled_file()
        : rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/cache/compiled-locales.php';
    return [
        'cache_root' => function_exists('t2_extend_cache_root')
            ? t2_extend_cache_root()
            : rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/cache',
        'runtime_index' => function_exists('t2_extend_runtime_index_file')
            ? t2_extend_runtime_index_file()
            : rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/cache/runtime-index.php',
        'compiled_locales' => $compiled,
        'private_locale_root' => dirname($compiled) . '/locales',
        'public_locale_root' => rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets/i18n',
    ];
}

function t2a_cache_meta(string $path): array {
    $exists = file_exists($path) || is_link($path);
    return [
        'path' => $path,
        'exists' => $exists,
        'is_dir' => $exists && is_dir($path) && !is_link($path),
        'size' => $exists ? t2a_tree_size($path) : 0,
        'mtime' => $exists ? (int)(@filemtime($path) ?: 0) : 0,
    ];
}

function t2a_cache_status(): array {
    $targets = t2a_cache_targets();
    $pointer = function_exists('t2_extend_runtime_pointer') ? t2_extend_runtime_pointer() : [];
    $releaseId = (string)($pointer['release_id'] ?? 'base');
    $index = t2_private_store_read($targets['runtime_index'], null);
    $indexValid = is_array($index) && function_exists('t2_extend_index_valid')
        ? t2_extend_index_valid($index)
        : is_array($index);
    $items = [];
    foreach (['runtime_index','compiled_locales','private_locale_root','public_locale_root'] as $key) {
        $items[$key] = t2a_cache_meta($targets[$key]);
    }
    $total = 0;
    foreach ($items as $item) $total += (int)$item['size'];
    return [
        'mode' => $releaseId === 'base' ? 'base' : 'slot',
        'release_id' => $releaseId,
        'runtime_path' => (string)($pointer['runtime_path'] ?? T2EDITOR_BASE_PATH),
        'asset_url' => (string)($pointer['asset_url'] ?? T2EDITOR_BASE_URL),
        'cache_root' => $targets['cache_root'],
        'cache_root_writable' => is_dir($targets['cache_root'])
            ? is_writable($targets['cache_root'])
            : is_writable(dirname($targets['cache_root'])),
        'runtime_index_valid' => $indexValid,
        'runtime_generation' => is_array($index) ? (string)($index['generation'] ?? '') : '',
        'generated_at' => is_array($index) ? (string)($index['generated_at'] ?? '') : '',
        'items' => $items,
        'total_size' => $total,
    ];
}

function t2a_clear_cache_files(): array {
    $targets = t2a_cache_targets();
    $removed = [];
    $failed = [];

    foreach (['runtime_index','compiled_locales'] as $key) {
        $file = $targets[$key];
        $existed = file_exists($file) || is_link($file);
        $ok = true;
        if ($existed) {
            $ok = function_exists('t2_private_store_delete')
                ? t2_private_store_delete($file)
                : (@unlink($file) || !file_exists($file));
        }
        if ($ok) $removed[] = $key; else $failed[] = $key;
        if (function_exists('t2_private_store_forget')) t2_private_store_forget($file);
        if (function_exists('opcache_invalidate')) @opcache_invalidate($file, true);
    }

    $dirSpecs = [
        ['private_locale_root', rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack/cache'],
        ['public_locale_root', rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets'],
    ];
    foreach ($dirSpecs as [$key, $allowedRoot]) {
        $dir = $targets[$key];
        $ok = !file_exists($dir) || t2a_remove_tree_safe($dir, $allowedRoot);
        if ($ok) $removed[] = $key; else $failed[] = $key;
    }

    if (function_exists('t2_extend_forget_request_cache')) t2_extend_forget_request_cache();
    if (function_exists('t2editor_i18n_reset_request_cache')) t2editor_i18n_reset_request_cache();
    clearstatcache();
    return ['removed' => array_values(array_unique($removed)), 'failed' => array_values(array_unique($failed))];
}

function t2a_with_cache_admin_lock(callable $callback) {
    $targets = t2a_cache_targets();
    $root = $targets['cache_root'];
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('캐시 디렉터리를 만들 수 없습니다.');
    }
    @chmod($root, 0700);
    $lock = @fopen($root . '/admin-cache.lock', 'c+');
    if ($lock === false || !@flock($lock, LOCK_EX)) {
        if (is_resource($lock)) @fclose($lock);
        throw new RuntimeException('캐시 관리 잠금을 획득하지 못했습니다.');
    }
    try {
        return $callback();
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
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
            'content_height' => 350,
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

// 플러그인 동적 스캔 — button.json 의 모든 버튼을 수집.
// 실제 에디터 런타임이 플러그인을 찾는 것과 동일한 소스(t2_extend_plugin_index)를 사용한다.
// 단순히 T2EDITOR_PATH.'/plugin' 디렉토리만 glob 하면, "data" 설치 모드(third_party_api.core.php의
// 기본값)로 설치된 서드파티 플러그인은 t2pack/extensions 아래 별도 경로에 저장되므로 절대 보이지 않는다.
function t2a_scan_plugins(): array {
    $plugins = [];
    $index = function_exists('t2_extend_plugin_index') ? t2_extend_plugin_index() : [];
    foreach ($index as $name => $row) {
        if (!is_array($row) || empty($row['path']) || !is_dir($row['path'])) continue;
        if (!preg_match('/^[a-zA-Z0-9_-]+$/', (string)$name)) continue;
        $dir = rtrim((string)$row['path'], '/\\') . '/';
        $info = [
            'name'   => $name,
            'buttons'=> [],
            // base(코어 내장) / runtime(업데이트 릴리스) / data(서드파티 "data" 설치) — 설치 방식 구분
            'source' => $row['source'] ?? 'base',
        ];
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
    if (!is_dir(T2ADMIN_DATA_PATH)) @mkdir(T2ADMIN_DATA_PATH, 0700, true);
    if (!is_writable(T2ADMIN_DATA_PATH)) t2a_json(false, null, 'data 디렉토리에 쓰기 권한이 없습니다.');
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $auth = ['password_hash' => $hash, 'setup_complete' => true, 'created_at' => date('c')];
    if (!t2_private_store_write(T2ADMIN_AUTH_FILE, $auth)) {
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
    $auth = t2_private_store_read(T2ADMIN_AUTH_FILE, array());
    if (!password_verify($pw, $auth['password_hash'] ?? '')) {
        sleep(1);
        t2a_json(false, null, '비밀번호가 올바르지 않습니다.');
    }
    session_regenerate_id(true);
    $_SESSION['t2admin_logged_in'] = true;
    $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
    $auth['last_login'] = date('c');
    t2_private_store_write(T2ADMIN_AUTH_FILE, $auth);
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

    // 작성 영역 높이는 CSS에 직접 반영되므로 서버에서도 안전한 정수 범위로 고정한다.
    if (isset($new['editor']) && is_array($new['editor']) && array_key_exists('content_height', $new['editor'])) {
        $new['editor']['content_height'] = max(200, min(2000, (int)$new['editor']['content_height']));
    }
    if (array_key_exists('icons', $new)) {
        try {
            $new['icons'] = t2a_normalize_icon_overrides($new['icons']);
        } catch (Throwable $e) {
            t2a_json(false, null, $e->getMessage());
        }
    }
    if (!is_writable(T2ADMIN_DATA_PATH)) t2a_json(false, null, 'data 디렉토리에 쓰기 권한이 없습니다.');

    try {
        // 섹션 단위 전체 교체(얕은 병합) — 시퀀셜 배열(plugins.active 등) 누적 오염 방지.
        // 요청에 포함된 최상위 키만 통째로 덮어쓰고, 포함되지 않은 섹션은 기존 값을 보존한다.
        // 마켓에서 플러그인을 설치/제거할 때도 동일한 admin_settings.php를 갱신하므로,
        // 두 요청이 겹쳐 서로의 변경을 덮어쓰지 않도록 read → merge → write 전체를 잠금으로 묶는다.
        $saved = t2_extend_with_file_lock(T2ADMIN_SETTINGS_LOCK_FILE, '다른 설정 저장 작업과 충돌했습니다. 잠시 후 다시 시도하세요.', function () use ($new) {
            $current = t2a_read_settings();
            $merged  = $current;
            foreach ($new as $section => $value) {
                if ($section === '_version') continue;
                $merged[$section] = $value;
            }
            $merged['_version'] = $current['_version'] ?? '1.0';
            return t2a_write_settings($merged);
        });
    } catch (Throwable $e) {
        t2a_json(false, null, $e->getMessage());
    }

    if (!$saved) {
        t2a_json(false, null, '설정 저장에 실패했습니다. T2Editor의 data/ 폴더 쓰기 권한을 확인하세요.');
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

if ($action === 'get_cache_status') {
    t2a_json(true, t2a_cache_status());
}

if ($action === 'clear_cache' && $method === 'POST') {
    if (!t2a_csrf_valid()) t2a_json(false, null, 'CSRF 검증 실패');
    try {
        $result = t2a_with_cache_admin_lock(function () {
            return t2a_clear_cache_files();
        });
        if (!empty($result['failed'])) {
            t2a_json(false, ['result'=>$result, 'status'=>t2a_cache_status()], '일부 캐시를 삭제하지 못했습니다. 파일 권한을 확인하세요.');
        }
        t2a_json(true, ['result'=>$result, 'status'=>t2a_cache_status()], '캐시를 삭제했습니다.');
    } catch (Throwable $e) {
        t2a_json(false, null, '캐시 삭제 실패: ' . $e->getMessage());
    }
}

if ($action === 'rebuild_cache' && $method === 'POST') {
    if (!t2a_csrf_valid()) t2a_json(false, null, 'CSRF 검증 실패');
    try {
        $payload = t2a_with_cache_admin_lock(function () {
            $clear = t2a_clear_cache_files();
            if (!empty($clear['failed'])) throw new RuntimeException('기존 캐시 일부를 삭제하지 못했습니다.');
            $index = function_exists('t2_extend_rebuild_runtime_cache')
                ? t2_extend_rebuild_runtime_cache(null, true)
                : null;
            clearstatcache();
            $status = t2a_cache_status();
            if (!is_array($index) || empty($status['runtime_index_valid'])
                || empty($status['items']['compiled_locales']['exists'])) {
                throw new RuntimeException('생성 결과를 검증하지 못했습니다. 캐시 경로의 쓰기 권한을 확인하세요.');
            }
            return [
                'clear' => $clear,
                'persistent_created' => true,
                'generation' => is_array($index) ? (string)($index['generation'] ?? '') : '',
            ];
        });
        $status = t2a_cache_status();
        $msg = '런타임 인덱스와 번역 캐시를 생성하고 결과를 검증했습니다.';
        t2a_json(true, ['result'=>$payload, 'status'=>$status], $msg);
    } catch (Throwable $e) {
        t2a_json(false, null, '캐시 재생성 실패: ' . $e->getMessage());
    }
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
    $auth = t2_private_store_read(T2ADMIN_AUTH_FILE, array());
    if (!password_verify($cur, $auth['password_hash'] ?? '')) {
        t2a_json(false, null, '현재 비밀번호가 올바르지 않습니다.');
    }
    $auth['password_hash'] = password_hash($new, PASSWORD_DEFAULT);
    $auth['changed_at'] = date('c');
    if (!t2_private_store_write(T2ADMIN_AUTH_FILE, $auth)) {
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
