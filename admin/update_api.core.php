<?php
// Path: T2Editor/admin/update_api.core.php
// Developer note: 관리자 action·필드명 변경 시 프런트 요청과 CSRF/권한 검사를 함께 맞춘다.
/**
 * T2Editor Core Updater API (PHP 7.4+)
 *
 * - Official/third-party distribution store API support (t2editor-store-api/1)
 * - SHA-256, archive structure, path traversal, symlink and size validation
 * - Same-version baseline 3-way customisation/conflict detection
 * - Per-file and checkbox-based bulk conflict handling
 * - Local password or host-CMS administrator re-authorization
 * - Incremental apply: only changed/selected files are staged, backed up and written
 * - Transactional backup, automatic rollback and manual rollback
 * - cURL/ZipArchive optional: HTTPS stream and pure-PHP ZIP fallback
 */
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
@ini_set('log_errors', '1');
$T2U_LOCAL_BUFFER_LEVEL = ob_get_level();
// This core file is loaded by t2_extend_run_endpoint() from inside a function.
// Promote endpoint state explicitly because functions declared below use global $T2U_* variables.
$GLOBALS['T2U_LOCAL_BUFFER_LEVEL'] = $T2U_LOCAL_BUFFER_LEVEL;
ob_start();
require_once dirname(__DIR__) . '/config/t2_cms_auth.php';
t2editor_admin_auth_bootstrap();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

require_once dirname(__DIR__) . '/config/extend.php';
if (!defined('T2EDITOR_RUNTIME_PATH') || !defined('T2EDITOR_RUNTIME_ID')) t2_extend_prepare_runtime();
if (!defined('T2EDITOR_PATH')) define('T2EDITOR_PATH', T2EDITOR_BASE_PATH);
if (!defined('T2EDITOR_URL')) define('T2EDITOR_URL', T2EDITOR_BASE_URL);
if (!defined('T2EDITOR_ASSET_URL')) define('T2EDITOR_ASSET_URL', T2EDITOR_BASE_URL);
require_once T2EDITOR_RUNTIME_PATH . '/config/t2_config.php';
require_once dirname(__DIR__) . '/config/t2_browser_archive.php';

const T2U_API_VERSION = '2.0.0';
const T2U_STORE_COMPATIBILITY = 't2editor-store-api/1';
const T2U_MANIFEST_SCHEMA = 't2editor-core-update-v1';
const T2U_DEFAULT_STORE = 'https://dsclub.kr/api/t2editor/version/index.php';
const T2U_CERTIFIED_REGISTRY = 'https://dsclub.kr/api/t2editor/third_party/certified/index.php';
const T2U_CERTIFIED_CACHE_TTL = 21600; // 6h - certified provider list rarely changes
const T2U_MAX_ARCHIVE_BYTES = 134217728;       // 128 MiB
const T2U_MAX_UNCOMPRESSED_BYTES = 536870912; // 512 MiB
const T2U_MAX_FILE_BYTES = 67108864;           // 64 MiB
const T2U_MAX_FILES = 20000;
const T2U_PLAN_TTL = 3600;
const T2U_BROWSER_JOB_TTL = 7200;
const T2U_BROWSER_CHUNK_BYTES = 524288;

$T2U_PRIVATE_ROOT = trim((string)T2EDITOR_PRIVATE_PATH);
if ($T2U_PRIVATE_ROOT === '') {
    $T2U_PRIVATE_ROOT = rtrim((string)T2EDITOR_DB_PATH, '/\\') . '/t2admin-private';
}
$T2U_PRIVATE_ROOT = rtrim($T2U_PRIVATE_ROOT, '/\\');

$T2U_PRIVATE = $T2U_PRIVATE_ROOT . '/core-updater';
$T2U_STORES_FILE = $T2U_PRIVATE . '/stores.php';
$T2U_CERTIFIED_CACHE_FILE = $T2U_PRIVATE . '/certified-stores-cache.php';
$T2U_STATE_FILE = $T2U_PRIVATE . '/state.php';
$T2U_TMP_DIR = $T2U_PRIVATE . '/tmp';
$T2U_BACKUP_DIR = $T2U_PRIVATE . '/backups';
$T2U_AUTH_FILE = $T2U_PRIVATE_ROOT . '/admin_auth.php';

$T2U_T2PACK_ROOT = $T2U_PRIVATE_ROOT . '/t2pack';
// Shared with third_party_api.core.php (T2TP_INSTALL_LOCK_FILE): both features
// write into the same T2EDITOR_PATH subtrees (plugin/, extend/js, extend/php,
// locales) when running in "direct" install mode, so they must serialize on
// the same lock file to avoid a core-update apply and a third-party
// install/uninstall clobbering each other's in-flight file changes.
$T2U_LOCK_FILE = $T2U_T2PACK_ROOT . '/install.lock';
$T2U_MODE_FILE = $T2U_T2PACK_ROOT . '/mode.php';
$T2U_ACTIVE_FILE = $T2U_T2PACK_ROOT . '/active.php';
$T2U_INSTALLED_FILE = $T2U_T2PACK_ROOT . '/installed.php';
$T2U_HEALTH_FILE = $T2U_T2PACK_ROOT . '/health.php';
$T2U_RELEASES_DIR = $T2U_T2PACK_ROOT . '/releases';
$T2U_PACKAGES_DIR = $T2U_T2PACK_ROOT . '/packages';
$T2U_WORK_DIR = $T2U_T2PACK_ROOT . '/work';
$T2U_TRASH_DIR = $T2U_T2PACK_ROOT . '/trash';
$T2U_ASSETS_ROOT = rtrim((string)T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets';
$T2U_ASSET_RELEASES_DIR = $T2U_ASSETS_ROOT . '/releases';

// update_api.core.php is required from t2_extend_run_endpoint(), therefore its
// top-level variables live in the bridge function scope. Copy every value used
// through `global $T2U_*` into the real global symbol table before dispatch.
foreach (array(
    'T2U_PRIVATE', 'T2U_STORES_FILE', 'T2U_CERTIFIED_CACHE_FILE', 'T2U_STATE_FILE',
    'T2U_TMP_DIR', 'T2U_BACKUP_DIR', 'T2U_LOCK_FILE', 'T2U_AUTH_FILE',
    'T2U_T2PACK_ROOT', 'T2U_MODE_FILE', 'T2U_ACTIVE_FILE', 'T2U_INSTALLED_FILE',
    'T2U_HEALTH_FILE', 'T2U_RELEASES_DIR', 'T2U_PACKAGES_DIR', 'T2U_WORK_DIR',
    'T2U_TRASH_DIR', 'T2U_ASSETS_ROOT', 'T2U_ASSET_RELEASES_DIR'
) as $_t2u_global_name) {
    $GLOBALS[$_t2u_global_name] = ${$_t2u_global_name};
}
unset($_t2u_global_name);

function t2u_response($ok, $data, $message, $status)
{
    global $T2U_LOCAL_BUFFER_LEVEL;
    while (ob_get_level() > $T2U_LOCAL_BUFFER_LEVEL) ob_end_clean();
    http_response_code((int)$status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'ok' => (bool)$ok,
        'data' => $data,
        'msg' => (string)$message,
        'api_version' => T2U_API_VERSION,
    ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function t2u_input()
{
    $raw = (string)file_get_contents('php://input');
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : array();
}

function t2u_logged_in()
{
    return t2editor_admin_is_authorized();
}

function t2u_csrf_valid()
{
    $token = isset($_SERVER['HTTP_X_T2ADMIN_CSRF']) ? (string)$_SERVER['HTTP_X_T2ADMIN_CSRF'] : '';
    return !empty($_SESSION['t2admin_csrf']) && $token !== '' && hash_equals((string)$_SESSION['t2admin_csrf'], $token);
}

function t2u_verify_password($password)
{
    global $T2U_AUTH_FILE;
    return t2editor_admin_verify_local_or_cms((string)$password, $T2U_AUTH_FILE);
}


function t2u_install_mode()
{
    global $T2U_MODE_FILE;
    $row = t2u_read_private($T2U_MODE_FILE, array('core'=>'data','third_party'=>'data'));
    if (!is_array($row)) $row = array();
    return array(
        'core' => in_array((string)($row['core'] ?? ''), array('data','direct'), true) ? (string)$row['core'] : 'data',
        'third_party' => in_array((string)($row['third_party'] ?? ''), array('data','direct'), true) ? (string)$row['third_party'] : 'data',
    );
}

function t2u_save_install_mode($core, $thirdParty)
{
    global $T2U_MODE_FILE;
    if (!in_array($core, array('data','direct'), true) || !in_array($thirdParty, array('data','direct'), true)) {
        throw new RuntimeException('설치 방식 값이 올바르지 않습니다.');
    }
    t2u_write_private($T2U_MODE_FILE, array('core'=>$core,'third_party'=>$thirdParty,'updated_at'=>gmdate('c')));
}

function t2u_nearest_existing_parent($path)
{
    $probe = rtrim((string)$path, '/\\');
    while ($probe !== '' && !file_exists($probe) && !is_link($probe)) {
        $parent = dirname($probe);
        if ($parent === $probe) break;
        $probe = $parent;
    }
    return $probe;
}

function t2u_ensure_directory($dir, $mode, $label)
{
    $dir = rtrim((string)$dir, '/\\');
    if ($dir === '') throw new RuntimeException($label . ' 경로가 비어 있습니다.');
    if (is_link($dir)) throw new RuntimeException($label . '가 심볼릭 링크라서 사용할 수 없습니다: ' . $dir);

    if (!is_dir($dir)) {
        $parent = t2u_nearest_existing_parent($dir);
        if ($parent === '' || !is_dir($parent)) {
            throw new RuntimeException($label . '의 기존 부모 디렉터리를 찾을 수 없습니다: ' . $dir);
        }
        if (!is_writable($parent)) {
            throw new RuntimeException($label . '를 만들 수 없습니다. 기존 부모 디렉터리에 PHP 쓰기 권한이 없습니다: ' . $parent . ' (생성 대상: ' . $dir . ')');
        }
        if (!@mkdir($dir, $mode, true) && !is_dir($dir)) {
            throw new RuntimeException($label . '를 만들 수 없습니다: ' . $dir . ' (기존 부모: ' . $parent . ')');
        }
    }

    @chmod($dir, $mode);
    if (!is_dir($dir) || !is_writable($dir)) {
        throw new RuntimeException($label . '에 PHP 쓰기 권한이 없습니다: ' . $dir . '. 공용 데이터 루트뿐 아니라 이미 존재하는 중간 디렉터리의 소유권·권한도 확인하세요.');
    }
}

function t2u_ensure_t2pack_dirs()
{
    global $T2U_T2PACK_ROOT, $T2U_RELEASES_DIR, $T2U_PACKAGES_DIR, $T2U_WORK_DIR, $T2U_TRASH_DIR, $T2U_ASSETS_ROOT, $T2U_ASSET_RELEASES_DIR;
    foreach (array($T2U_T2PACK_ROOT,$T2U_RELEASES_DIR,$T2U_PACKAGES_DIR,$T2U_WORK_DIR,$T2U_TRASH_DIR) as $dir) {
        t2u_ensure_directory($dir, 0700, 'T2Pack 비공개 디렉터리');
    }
    foreach (array($T2U_ASSETS_ROOT,$T2U_ASSET_RELEASES_DIR) as $dir) {
        t2u_ensure_directory($dir, 0755, 'T2Pack 정적 자산 디렉터리');
    }
    $guard = $T2U_ASSETS_ROOT . '/.htaccess';
    if (!is_file($guard)) @file_put_contents($guard, "Options -Indexes\n<FilesMatch \"\\.(?:php[0-9]*|phtml|phtm?|phar)$\">\nRequire all denied\nDeny from all\n</FilesMatch>\n", LOCK_EX);
    $index = $T2U_ASSETS_ROOT . '/index.html';
    if (!is_file($index)) @file_put_contents($index, "<!doctype html><meta charset=\"utf-8\"><title>Not Found</title>\n", LOCK_EX);
    if (function_exists('t2editor_storage_remove_executable_assets')) {
        t2editor_storage_remove_executable_assets($T2U_ASSETS_ROOT);
        t2editor_storage_remove_executable_assets(rtrim(T2EDITOR_DATA_PATH, '/\\') . '/t2pack/assets');
    }
}

function t2u_data_install_supported()
{
    global $T2U_T2PACK_ROOT, $T2U_ASSETS_ROOT;
    try { t2u_ensure_t2pack_dirs(); } catch (Throwable $e) { return false; }
    return is_writable(T2EDITOR_PRIVATE_PATH) && is_writable($T2U_T2PACK_ROOT) && is_writable($T2U_ASSETS_ROOT);
}

function t2u_release_id($version, $archiveSha)
{
    $version = preg_replace('/[^A-Za-z0-9._-]/', '-', (string)$version);
    return substr($version, 0, 64) . '-' . substr(strtolower((string)$archiveSha), 0, 8);
}

function t2u_unique_release_id($baseId)
{
    global $T2U_RELEASES_DIR;
    $id = $baseId; $n = 1;
    while (file_exists($T2U_RELEASES_DIR . '/' . $id)) {
        $n++;
        $id = substr($baseId, 0, 116) . '-r' . $n;
    }
    return $id;
}

function t2u_copy_tree_checked($source, $target, $fileMode = 0644, $dirMode = 0755)
{
    if (is_link($source)) throw new RuntimeException('심볼릭 링크는 복사하지 않습니다.');
    if (is_file($source)) {
        $dir = dirname($target);
        if (!is_dir($dir) && !@mkdir($dir, $dirMode, true) && !is_dir($dir)) throw new RuntimeException('대상 디렉터리를 만들 수 없습니다.');
        if (!@copy($source, $target)) throw new RuntimeException('파일 복사에 실패했습니다: ' . basename($source));
        @chmod($target, $fileMode);
        return;
    }
    if (!is_dir($source)) throw new RuntimeException('복사 원본이 없습니다.');
    if (!is_dir($target) && !@mkdir($target, $dirMode, true) && !is_dir($target)) throw new RuntimeException('대상 디렉터리를 만들 수 없습니다.');
    @chmod($target, $dirMode);
    $items = @scandir($source);
    if (!is_array($items)) throw new RuntimeException('복사 원본을 읽을 수 없습니다.');
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        t2u_copy_tree_checked($source . '/' . $item, $target . '/' . $item, $fileMode, $dirMode);
    }
}

function t2u_remove_protected_stage_paths($stage)
{
    foreach (array('data','admin/t2admin.key','admin/t2admin.key.txt') as $relative) {
        $path = rtrim($stage, '/\\') . '/' . $relative;
        if (file_exists($path) || is_link($path)) t2u_remove_tree($path);
    }
}

function t2u_detect_distribution_root($stage)
{
    $stage = rtrim((string)$stage, '/\\');
    $candidates = array($stage);
    $entries = @scandir($stage);
    if (is_array($entries)) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = $stage . '/' . $entry;
            if (is_dir($path) && !is_link($path)) $candidates[] = $path;
        }
    }
    $valid = array();
    foreach ($candidates as $candidate) {
        if (is_file($candidate . '/editor.lib.php') && is_file($candidate . '/config/t2_config.php') && is_file($candidate . '/readme.txt')) $valid[] = $candidate;
    }
    if (count($valid) !== 1) throw new RuntimeException(count($valid) ? 'ZIP 안에서 T2Editor 배포 루트가 여러 개 감지되었습니다.' : 'editor.lib.php, config/t2_config.php, readme.txt가 있는 배포 루트를 찾지 못했습니다.');
    return $valid[0];
}

function t2u_distribution_bootstrap_abi($stage)
{
    $file = rtrim((string)$stage, '/\\') . '/config/extend.php';
    $raw = is_file($file) ? (string)@file_get_contents($file) : '';
    if ($raw === '' || !preg_match('/define\s*\(\s*[\"\']T2_EXTEND_BOOTSTRAP_ABI[\"\']\s*,\s*([0-9]+)/', $raw, $matches)) return 0;
    return (int)$matches[1];
}

/**
 * A store may publish a compact patch archive instead of a complete data-slot
 * runtime. Data slots, however, must always be self-contained because the
 * active pointer can switch to them independently. Seed every missing file
 * from the currently active runtime (or the immutable base installation) and
 * then let files in the downloaded archive take precedence.
 */
function t2u_data_release_seed_root($stage)
{
    $stageReal = @realpath((string)$stage);
    $candidates = array();
    if (defined('T2EDITOR_RUNTIME_PATH')) $candidates[] = (string)T2EDITOR_RUNTIME_PATH;
    if (defined('T2EDITOR_BASE_PATH')) $candidates[] = (string)T2EDITOR_BASE_PATH;
    $candidates[] = dirname(__DIR__);
    $seen = array();
    foreach ($candidates as $candidate) {
        $candidate = rtrim((string)$candidate, '/\\');
        if ($candidate === '') continue;
        $real = @realpath($candidate);
        $key = $real !== false ? str_replace('\\', '/', $real) : str_replace('\\', '/', $candidate);
        if (isset($seen[$key])) continue;
        $seen[$key] = true;
        if ($stageReal !== false && $real !== false && $stageReal === $real) continue;
        if (is_file($candidate . '/editor.core.php') && is_file($candidate . '/editor.lib.php') && is_file($candidate . '/config/t2_config.php')) {
            return $candidate;
        }
    }
    throw new RuntimeException('부분 업데이트를 완전한 데이터 릴리스로 구성할 현재 T2Editor 런타임을 찾지 못했습니다.');
}

function t2u_inherit_missing_data_release_files($stage)
{
    $stage = rtrim((string)$stage, '/\\');
    $sourceRoot = t2u_data_release_seed_root($stage);
    $copied = array();
    $walk = function ($sourceDir, $targetDir, $prefix = '') use (&$walk, &$copied) {
        $items = @scandir($sourceDir);
        if (!is_array($items)) throw new RuntimeException('현재 런타임 파일 목록을 읽을 수 없습니다.');
        foreach ($items as $name) {
            if ($name === '.' || $name === '..' || (isset($name[0]) && $name[0] === '.')) continue;
            $relative = $prefix === '' ? $name : $prefix . '/' . $name;
            if ($relative === 'update-manifest.json' || $relative === 'run.php' || t2u_protected_path($relative) || t2u_ignored_entry($relative)) continue;
            $source = $sourceDir . '/' . $name;
            $target = $targetDir . '/' . $name;
            if (is_link($source)) continue;
            if (is_dir($source)) {
                if (file_exists($target) && !is_dir($target)) continue;
                if (!is_dir($target) && !@mkdir($target, 0755, true) && !is_dir($target)) {
                    throw new RuntimeException('데이터 릴리스 보완 디렉터리를 만들 수 없습니다: ' . $relative);
                }
                $walk($source, $target, $relative);
                continue;
            }
            if (!is_file($source) || file_exists($target) || is_link($target)) continue;
            t2u_copy_tree_checked($source, $target, 0644, 0755);
            $copied[] = $relative;
            if (count($copied) > T2U_MAX_FILES) throw new RuntimeException('데이터 릴리스 보완 파일 수가 안전 검사 한도를 초과했습니다.');
        }
    };
    $walk($sourceRoot, $stage, '');
    sort($copied, SORT_STRING);
    return array('source'=>$sourceRoot, 'count'=>count($copied), 'files'=>$copied);
}

function t2u_normalize_distribution_stage($stage, $requireBootstrap = true)
{
    $root = t2u_detect_distribution_root($stage);
    $stageNorm = rtrim(str_replace('\\','/',(string)$stage), '/');
    $rootNorm = rtrim(str_replace('\\','/',(string)$root), '/');
    if ($rootNorm !== $stageNorm) {
        $normalized = $stage . '-normalized';
        t2u_remove_tree($normalized);
        if (!@rename($root, $normalized)) {
            t2u_copy_tree_checked($root, $normalized);
        }
        t2u_remove_tree($stage);
        if (!@rename($normalized, $stage)) {
            t2u_copy_tree_checked($normalized, $stage);
            t2u_remove_tree($normalized);
        }
    }
    t2u_remove_protected_stage_paths($stage);
    $inheritedRelease = array('source'=>'', 'count'=>0, 'files'=>array());
    $requiredFiles = array('editor.lib.php','config/t2_config.php','readme.txt');
    $requiredAbi = 0;
    if ($requireBootstrap) {
        $inheritedRelease = t2u_inherit_missing_data_release_files($stage);
        $requiredAbi = t2u_distribution_bootstrap_abi($stage);
        // A data-slot release is executed behind immutable entry routers in the
        // original installation directory. run.php is one of those routers and
        // is not part of the selected runtime slot, so a store archive may omit
        // it. Only files that are actually loaded from the data release are
        // required here.
        $requiredFiles = array_merge($requiredFiles, array('config/extend.php','editor.core.php'));
        if ($requiredAbi >= 2) $requiredFiles[] = 'config/t2_storage.php';
    }
    foreach ($requiredFiles as $required) {
        if (!is_file(rtrim($stage, '/\\') . '/' . $required)) throw new RuntimeException(($requireBootstrap ? '데이터 설치' : '배포본') . '에 필요한 파일이 없습니다: ' . $required);
    }
    if ($requireBootstrap) {
        $installedAbi = defined('T2_EXTEND_BOOTSTRAP_ABI') ? (int)T2_EXTEND_BOOTSTRAP_ABI : 0;
        if ($requiredAbi < 1) throw new RuntimeException('배포본에서 T2 Extend Bootstrap ABI 정보를 확인할 수 없습니다.');
        if ($requiredAbi > $installedAbi) {
            throw new RuntimeException('이번 업데이트는 T2 Extend Bootstrap ' . $requiredAbi . '이 필요합니다. editor.lib.php, config/extend.php, config/t2_storage.php, run.php와 admin/update_api.core.php를 먼저 직접 교체하세요. 현재 부트스트랩: ' . $installedAbi);
        }
    }
    return $inheritedRelease;
}

function t2u_release_manifest($root, $version, $archiveSha)
{
    $files = t2u_scan_stage($root);
    return array(
        'schema'=>'t2pack-release-v1','version'=>(string)$version,'archive_sha256'=>(string)$archiveSha,
        'created_at'=>gmdate('c'),'files'=>$files,'file_count'=>count($files),
    );
}

function t2u_static_asset_allowed($relative)
{
    $relative = str_replace('\\','/',(string)$relative);
    if (preg_match('#(^|/)(?:data|admin)(/|$)#i', $relative)) return false;
    $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
    return in_array($ext, array('js','css','map','png','jpg','jpeg','gif','webp','svg','ico','woff','woff2','ttf','otf','eot','json','wasm','bin','model','txt','html','htm','mp3','mp4','webm','ogg'), true);
}

function t2u_project_static_assets($releaseRoot, $assetRoot)
{
    t2u_remove_tree($assetRoot);
    t2u_mkdir($assetRoot);
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($releaseRoot, FilesystemIterator::SKIP_DOTS));
    $count = 0; $bytes = 0;
    foreach ($iterator as $info) {
        if (!$info->isFile() || $info->isLink()) continue;
        $full = str_replace('\\','/',$info->getPathname());
        $relative = ltrim(substr($full, strlen(rtrim(str_replace('\\','/',$releaseRoot),'/'))), '/');
        if (!t2u_static_asset_allowed($relative)) continue;
        $target = rtrim($assetRoot, '/\\') . '/' . $relative;
        t2u_copy_tree_checked($info->getPathname(), $target, 0644, 0755);
        $count++; $bytes += (int)$info->getSize();
    }
    return array('files'=>$count,'bytes'=>$bytes);
}

function t2u_data_release_list()
{
    global $T2U_RELEASES_DIR, $T2U_ACTIVE_FILE;
    $pointer = t2_extend_runtime_pointer();
    $activeId = is_array($pointer) && (string)($pointer['provider'] ?? '') === 't2pack'
        ? (string)($pointer['release_id'] ?? '') : '';
    $lastState = t2u_read_private($T2U_ACTIVE_FILE, array());
    $lastStateId = is_array($lastState) ? (string)($lastState['release_id'] ?? '') : '';
    $items = array();
    if (!is_dir($T2U_RELEASES_DIR)) return $items;
    foreach ((array)@scandir($T2U_RELEASES_DIR) as $id) {
        if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', (string)$id)) continue;
        $root = $T2U_RELEASES_DIR . '/' . $id;
        $manifest = t2u_read_private($root . '/manifest.php', array());
        if (!is_array($manifest) || !is_dir($root . '/t2editor')) continue;
        $isActive = $id === $activeId;
        $status = $isActive ? (string)($pointer['status'] ?? 'active') : 'installed';
        if (!$isActive && $id === $lastStateId && is_array($lastState)) {
            $lastStatus = (string)($lastState['status'] ?? '');
            if (in_array($lastStatus, array('failed','pending'), true)) $status = $lastStatus;
        }
        $items[] = array(
            'id'=>$id,'version'=>(string)($manifest['version'] ?? ''),'created_at'=>(string)($manifest['created_at'] ?? ''),
            'file_count'=>(int)($manifest['file_count'] ?? 0),'active'=>$isActive,
            'status'=>$status,'mode'=>'data',
        );
    }
    usort($items, function($a,$b){ return strcmp((string)$b['created_at'], (string)$a['created_at']); });
    return $items;
}

function t2u_activate_data_release($releaseId)
{
    global $T2U_RELEASES_DIR, $T2U_ASSET_RELEASES_DIR, $T2U_ACTIVE_FILE;
    if (!preg_match('/^[A-Za-z0-9._-]{1,128}$/', (string)$releaseId)) throw new RuntimeException('릴리스 ID가 올바르지 않습니다.');
    $releaseRoot = $T2U_RELEASES_DIR . '/' . $releaseId . '/t2editor';
    $assetRoot = $T2U_ASSET_RELEASES_DIR . '/' . $releaseId;
    $manifest = t2u_read_private($T2U_RELEASES_DIR . '/' . $releaseId . '/manifest.php', array());
    if (!is_dir($releaseRoot) || !is_dir($assetRoot) || !is_array($manifest)) throw new RuntimeException('활성화할 릴리스 슬롯이 없습니다.');
    $current = t2_extend_runtime_pointer();
    $active = array(
        'release_id'=>$releaseId,'version'=>(string)($manifest['version'] ?? ''),'status'=>'pending',
        'pending_at'=>gmdate('c'),'package_hash'=>(string)($manifest['archive_sha256'] ?? ''),
        'previous'=>$current,
    );
    t2u_write_private($T2U_ACTIVE_FILE, $active);
    $pointer = array(
        'provider'=>'t2pack','release_id'=>$releaseId,'runtime_path'=>$releaseRoot,
        'asset_url'=>rtrim(T2EDITOR_DB_URL, '/') . '/t2pack/assets/releases/' . rawurlencode($releaseId),
        'status'=>'pending','version'=>$active['version'],'published_at'=>gmdate('c'),
    );
    if (!t2_extend_write_runtime_pointer($pointer)) throw new RuntimeException('활성 런타임 포인터를 저장하지 못했습니다.');
    if (function_exists('t2_extend_rebuild_runtime_cache')) {
        try { t2_extend_rebuild_runtime_cache($pointer, false); }
        catch (Throwable $e) {
            error_log('[T2Editor] New release runtime index build deferred: ' . $e->getMessage());
            if (function_exists('t2_extend_invalidate_runtime_cache')) t2_extend_invalidate_runtime_cache();
        }
    }
    return $pointer;
}

function t2u_apply_data_plan($plan)
{
    global $T2U_RELEASES_DIR, $T2U_ASSET_RELEASES_DIR, $T2U_STATE_FILE, $T2U_INSTALLED_FILE;
    return t2u_with_lock(function () use ($plan, $T2U_RELEASES_DIR, $T2U_ASSET_RELEASES_DIR, $T2U_STATE_FILE, $T2U_INSTALLED_FILE) {
        t2u_ensure_t2pack_dirs();
        $stage = (string)$plan['stage'];
        if (!is_dir($stage)) throw new RuntimeException('설치 준비 디렉터리가 없습니다.');
        t2u_normalize_distribution_stage($stage);
        $baseId = t2u_release_id((string)$plan['version'], (string)$plan['archive_sha256']);
        $releaseId = t2u_unique_release_id($baseId);
        $slot = $T2U_RELEASES_DIR . '/' . $releaseId;
        $releaseRoot = $slot . '/t2editor';
        t2u_mkdir($slot);
        if (!@rename($stage, $releaseRoot)) {
            t2u_copy_tree_checked($stage, $releaseRoot);
            t2u_remove_tree($stage);
        }
        $manifest = t2u_release_manifest($releaseRoot, (string)$plan['version'], (string)$plan['archive_sha256']);
        t2u_write_private($slot . '/manifest.php', $manifest);
        $assets = t2u_project_static_assets($releaseRoot, $T2U_ASSET_RELEASES_DIR . '/' . $releaseId);
        $pointer = t2u_activate_data_release($releaseId);
        $installed = t2u_read_private($T2U_INSTALLED_FILE, array());
        if (!is_array($installed)) $installed = array();
        $installed[$releaseId] = array('id'=>$releaseId,'version'=>$plan['version'],'archive_sha256'=>$plan['archive_sha256'],'installed_at'=>gmdate('c'),'assets'=>$assets,'operation'=>(string)($plan['operation'] ?? 'update'));
        t2u_write_private($T2U_INSTALLED_FILE, $installed);
        $state = array('installed_version'=>$plan['version'],'updated_at'=>gmdate('c'),'mode'=>'data','active_release_id'=>$releaseId,'runtime'=>$pointer,'manifest'=>$manifest,'operation'=>(string)($plan['operation'] ?? 'update'));
        t2u_write_private($T2U_STATE_FILE, $state);
        return array('version'=>$plan['version'],'release_id'=>$releaseId,'mode'=>'data','status'=>'pending','changed_files'=>$manifest['file_count'],'asset_files'=>$assets['files'],'operation'=>(string)($plan['operation'] ?? 'update'));
    });
}

function t2u_rollback_data($releaseId)
{
    return t2u_with_lock(function () use ($releaseId) {
        $pointer = t2u_activate_data_release($releaseId);
        return array('release_id'=>$releaseId,'version'=>(string)($pointer['version'] ?? ''),'status'=>'pending','mode'=>'data');
    });
}

function t2u_ensure_dirs()
{
    global $T2U_PRIVATE, $T2U_TMP_DIR, $T2U_BACKUP_DIR;
    foreach (array($T2U_PRIVATE, $T2U_TMP_DIR, $T2U_BACKUP_DIR) as $dir) {
        t2u_ensure_directory($dir, 0700, '업데이트용 비공개 디렉터리');
    }
    t2u_ensure_t2pack_dirs();
}

function t2u_read_private($file, $fallback)
{
    $value = t2_private_store_read($file, $fallback);
    return $value;
}

function t2u_write_private($file, $value)
{
    if (!t2_private_store_write($file, $value)) throw new RuntimeException('업데이트 상태를 안전하게 저장하지 못했습니다.');
}

function t2u_default_stores()
{
    return array(array(
        'id' => 'dsclub-official',
        'name' => 'DSc T2Editor Store',
        'url' => T2U_DEFAULT_STORE,
        'enabled' => true,
        'official' => true,
        'certified' => false,
        'group' => 'official',
    ));
}

/**
 * Extracts a provider list from the certified-registry response body in a
 * tolerant way: the registry is maintained by DSc separately from this
 * plugin, so we accept a couple of reasonable envelope shapes rather than
 * failing outright if the exact key nesting differs from what we expect.
 */
function t2u_extract_registry_providers($decoded)
{
    if (!is_array($decoded)) return array();
    $candidates = array();
    if (isset($decoded['registry']['providers']) && is_array($decoded['registry']['providers'])) $candidates = $decoded['registry']['providers'];
    elseif (isset($decoded['providers']) && is_array($decoded['providers'])) $candidates = $decoded['providers'];
    elseif (isset($decoded['registry']['items']) && is_array($decoded['registry']['items'])) $candidates = $decoded['registry']['items'];
    elseif (isset($decoded['items']) && is_array($decoded['items'])) $candidates = $decoded['items'];
    elseif (isset($decoded['certified']) && is_array($decoded['certified'])) $candidates = $decoded['certified'];
    return $candidates;
}

function t2u_certified_stores()
{
    global $T2U_CERTIFIED_CACHE_FILE;
    $cache = t2u_read_private($T2U_CERTIFIED_CACHE_FILE, array('fetched_at' => 0, 'providers' => array()));
    if (!is_array($cache)) $cache = array('fetched_at' => 0, 'providers' => array());
    $fresh = isset($cache['fetched_at']) && (time() - (int)$cache['fetched_at']) < T2U_CERTIFIED_CACHE_TTL;
    // DSc API가 꺼져 있으면 마지막 로컬 캐시만 읽고 레지스트리를 갱신하지 않는다.
    if (!$fresh && t2u_dsclub_api_enabled()) {
        try {
            $decoded = t2u_http_get_json_raw(T2U_CERTIFIED_REGISTRY . '?action=list&type=repository');
            $scope = isset($decoded['registry']['scope']) ? (string)$decoded['registry']['scope'] : '';
            $compatibility = isset($decoded['api']['compatibility']) ? (string)$decoded['api']['compatibility'] : '';
            if ($scope !== '' && $scope !== 'repository') throw new RuntimeException('인증 에디터 저장소 레지스트리 범위가 올바르지 않습니다.');
            if ($compatibility !== '' && $compatibility !== 't2editor-third-party-repository/1') throw new RuntimeException('인증 에디터 저장소 레지스트리 규격이 올바르지 않습니다.');
            $raw = t2u_extract_registry_providers($decoded);
            $providers = array();
            foreach ($raw as $p) {
                if (!is_array($p)) continue;
                $url = isset($p['url']) ? (string)$p['url'] : (isset($p['api_url']) ? (string)$p['api_url'] : '');
                if ($url === '') continue;
                try { $verifiedEndpoint = t2u_endpoint($url); } catch (Throwable $e) { continue; }
                $domain = strtolower((string)$verifiedEndpoint['host']);
                $declaredDomain = strtolower(trim(isset($p['domain']) ? (string)$p['domain'] : ''));
                if ($declaredDomain !== '' && $domain !== $declaredDomain
                    && substr($domain, -strlen('.' . $declaredDomain)) !== '.' . $declaredDomain) continue;
                $providers[] = array(
                    'id' => 'certified-' . substr(hash('sha256', $url), 0, 16),
                    'name' => t2u_clean_text(isset($p['name']) ? $p['name'] : $domain, 80),
                    'url' => $url,
                    'domain' => t2u_clean_text($domain, 120),
                );
                if (count($providers) >= 40) break;
            }
            $cache = array('fetched_at' => time(), 'providers' => $providers);
            t2u_write_private($T2U_CERTIFIED_CACHE_FILE, $cache);
        } catch (Throwable $e) {
            // Registry outage should never block the official/custom store UI;
            // fall back to whatever was last known-good (possibly empty).
            error_log('[T2EditorCoreUpdater] certified registry fetch failed: ' . $e->getMessage());
        }
    }
    $providers = isset($cache['providers']) && is_array($cache['providers']) ? $cache['providers'] : array();
    foreach ($providers as $i => $provider) {
        if (!is_array($provider)) continue;
        $host = strtolower((string)parse_url(isset($provider['url']) ? (string)$provider['url'] : '', PHP_URL_HOST));
        if ($host !== '') $providers[$i]['domain'] = $host;
    }
    return $providers;
}

function t2u_stores_raw()
{
    global $T2U_STORES_FILE;
    $stored = t2u_read_private($T2U_STORES_FILE, array('custom' => array(), 'certified_disabled' => array(), 'official_enabled' => true));
    if (!is_array($stored)) $stored = array('custom' => array(), 'certified_disabled' => array(), 'official_enabled' => true);
    // Backward compatibility with the pre-v10.4 flat-array store format.
    if (!isset($stored['custom']) && !isset($stored['certified_disabled'])) {
        $migrated = array();
        foreach ($stored as $row) {
            if (is_array($row) && isset($row['url']) && (string)$row['url'] !== T2U_DEFAULT_STORE) $migrated[] = $row;
        }
        $stored = array('custom' => $migrated, 'certified_disabled' => array(), 'official_enabled' => true);
    }
    if (!isset($stored['custom']) || !is_array($stored['custom'])) $stored['custom'] = array();
    if (!isset($stored['certified_disabled']) || !is_array($stored['certified_disabled'])) $stored['certified_disabled'] = array();
    $stored['official_enabled'] = !array_key_exists('official_enabled', $stored) || !empty($stored['official_enabled']);
    return $stored;
}

function t2u_dsclub_api_enabled()
{
    $raw = t2u_stores_raw();
    return !empty($raw['official_enabled']);
}

function t2u_stores()
{
    $raw = t2u_stores_raw();
    $certifiedDisabled = array_map('strval', $raw['certified_disabled']);

    $official = t2u_default_stores();
    foreach ($official as $i => $store) $official[$i]['enabled'] = !empty($raw['official_enabled']);

    $certified = array();
    $certifiedUrls = array();
    foreach (t2u_certified_stores() as $c) {
        $c['enabled'] = !in_array((string)$c['id'], $certifiedDisabled, true);
        $c['official'] = false;
        $c['certified'] = true;
        $c['group'] = 'certified';
        $certified[] = $c;
        $certifiedUrls[] = $c['url'];
    }

    $custom = array();
    foreach ($raw['custom'] as $store) {
        if (!is_array($store)) continue;
        $url = isset($store['url']) ? (string)$store['url'] : '';
        if ($url === T2U_DEFAULT_STORE || in_array($url, $certifiedUrls, true)) continue;
        $store['official'] = false;
        $store['certified'] = false;
        $store['group'] = 'custom';
        $custom[] = $store;
    }

    return array_values(array_merge($official, $certified, $custom));
}

function t2u_clean_text($value, $max)
{
    $value = trim(strip_tags((string)$value));
    return t2_utf8_substr($value, 0, (int)$max);
}

function t2u_current_version()
{
    global $T2U_STATE_FILE, $T2U_ACTIVE_FILE;
    $pointer = t2_extend_runtime_pointer();
    $pointerVersion = is_array($pointer) ? (string)($pointer['version'] ?? '') : '';
    if (is_array($pointer) && (string)($pointer['provider'] ?? '') === 't2pack'
        && preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', $pointerVersion)) return $pointerVersion;
    $active = t2u_read_private($T2U_ACTIVE_FILE, array());
    $activeVersion = is_array($active) ? (string)($active['version'] ?? '') : '';
    $activeRelease = is_array($active) ? (string)($active['release_id'] ?? '') : '';
    $activeStatus = is_array($active) ? (string)($active['status'] ?? '') : '';
    if ($activeRelease !== '' && $activeRelease !== 'base' && in_array($activeStatus, array('pending','active'), true)
        && preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', $activeVersion)) return $activeVersion;
    $manifestFile = T2EDITOR_PATH . '/update-manifest.json';
    if (is_file($manifestFile)) {
        $manifest = json_decode((string)@file_get_contents($manifestFile), true);
        $version = is_array($manifest) && isset($manifest['version']) ? (string)$manifest['version'] : '';
        if (preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', $version)) return $version;
    }
    $state = t2u_read_private($T2U_STATE_FILE, array());
    $stateVersion = is_array($state) && isset($state['installed_version']) ? (string)$state['installed_version'] : '';
    if (preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', $stateVersion)) return $stateVersion;
    foreach (array(T2EDITOR_PATH . '/readme.txt', T2EDITOR_PATH . '/README.md', T2EDITOR_PATH . '/version.txt') as $file) {
        $raw = is_file($file) ? (string)@file_get_contents($file) : '';
        if (preg_match('/(?:ver[_ -]?|version[ :]+)?([0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)/i', $raw, $m)) return $m[1];
    }
    return '0.0.0';
}

function t2u_version_major($version)
{
    return preg_match('/^v?([0-9]+)(?:\.|$)/i', trim((string)$version), $m) && (int)$m[1] > 0 ? (int)$m[1] : null;
}

function t2u_major_version_mismatch($currentVersion, $targetVersion)
{
    $currentMajor = t2u_version_major($currentVersion);
    $targetMajor = t2u_version_major($targetVersion);
    return $currentMajor !== null && $targetMajor !== null && $currentMajor !== $targetMajor;
}

function t2u_recommended_version_for_current_major($versions, $currentVersion)
{
    $currentMajor = t2u_version_major($currentVersion);
    if ($currentMajor === null || !is_array($versions)) return null;
    $recommended = null;
    foreach ($versions as $candidate) {
        if (!is_array($candidate) || !isset($candidate['version'])) continue;
        if (t2u_version_major((string)$candidate['version']) !== $currentMajor) continue;
        if ($recommended === null || version_compare((string)$candidate['version'], (string)$recommended['version'], '>')) $recommended = $candidate;
    }
    return $recommended;
}

function t2u_bool_ini($name)
{
    $value = ini_get($name);
    return $value !== false && !in_array(strtolower(trim((string)$value)), array('', '0', 'off', 'false', 'no', 'none'), true);
}

function t2u_capabilities()
{
    $curl = extension_loaded('curl') && function_exists('curl_init');
    $streams = extension_loaded('openssl') && t2u_bool_ini('allow_url_fopen');
    $zip = class_exists('ZipArchive');
    $zlib = function_exists('gzinflate');
    $browser = !$zip && !$zlib;
    $transportReady = $curl || $streams;
    $archiveReady = true;
    $mode = t2u_install_mode();
    $dataReady = t2u_data_install_supported();
    $directReady = is_writable(T2EDITOR_PATH) && is_writable(T2EDITOR_PRIVATE_PATH);
    $selectedReady = $mode['core'] === 'data' ? $dataReady : $directReady;
    $warnings = array();
    if (!$transportReady) $warnings[] = array('code'=>'https_transport_missing','title'=>'HTTPS 다운로드 기능이 없습니다.','message'=>'php-curl을 설치하거나 OpenSSL 확장과 allow_url_fopen을 활성화하세요.','packages'=>array('Debian/Ubuntu: php-curl','RHEL/Rocky/Alma: php-curl','Windows: php.ini에서 extension=curl 활성화'));
    if ($browser) $warnings[] = array('code'=>'browser_zip_fallback','title'=>'브라우저 ZIP 폴백을 사용합니다.','message'=>'서버에 ZipArchive와 zlib 해제 기능이 없습니다. STORE ZIP은 서버가 직접 처리하고, DEFLATE ZIP은 관리자 브라우저가 해제한 뒤 검증된 파일을 서버로 되돌려 보냅니다. 대용량 패키지는 시간이 더 걸릴 수 있습니다.','packages'=>array('권장: php-zip 설치','대안: zlib 활성화'));
    if ($mode['core'] === 'data' && !$dataReady) $warnings[] = array('code'=>'data_path_not_writable','title'=>'공용 데이터 설치 경로를 사용할 수 없습니다.','message'=>'T2EDITOR_PRIVATE_PATH와 T2EDITOR_DB_PATH의 t2pack 디렉터리에 웹서버 쓰기 권한을 부여하세요.','packages'=>array());
    if ($mode['core'] === 'direct' && !$directReady) $warnings[] = array('code'=>'editor_not_writable','title'=>'직접 설치 경로에 쓸 수 없습니다.','message'=>'직접 설치를 사용하려면 T2Editor 원본 경로에 쓰기·이름 변경·삭제 권한이 필요합니다. 또는 공용 데이터 설치를 선택하세요.','packages'=>array());
    return array(
        'ready'=>$transportReady && $archiveReady && $selectedReady,
        'selected_mode'=>$mode['core'],
        'transport'=>array('curl'=>$curl,'https_stream'=>$streams,'selected'=>$curl?'curl':($streams?'https_stream':null)),
        'archive'=>array('ziparchive'=>$zip,'pure_php_deflate'=>$zlib,'browser_fallback'=>$browser,'selected'=>$zip?'ziparchive':($zlib?'pure_php_deflate':'browser')),
        'filesystem'=>array(
            'editor_writable'=>is_writable(T2EDITOR_PATH),
            'private_writable'=>is_writable(T2EDITOR_PRIVATE_PATH),
            'data_writable'=>is_writable(T2EDITOR_DB_PATH),
            'db_path'=>T2EDITOR_DB_PATH,
            'db_writable'=>is_writable(T2EDITOR_DB_PATH),
            'data_install_supported'=>$dataReady,
            'direct_install_supported'=>$directReady,
        ),
        'warnings'=>$warnings,
    );
}

function t2u_is_public_ip($ip)
{
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}

function t2u_endpoint($url)
{
    $url = trim((string)$url);
    if ($url === '' || strlen($url) > 4096 || filter_var($url, FILTER_VALIDATE_URL) === false) throw new RuntimeException('저장소 URL 형식이 올바르지 않습니다.');
    $parts = parse_url($url);
    if (!is_array($parts) || strtolower(isset($parts['scheme']) ? (string)$parts['scheme'] : '') !== 'https') throw new RuntimeException('업데이트 저장소는 HTTPS만 허용됩니다.');
    if (!empty($parts['user']) || !empty($parts['pass']) || !empty($parts['fragment'])) throw new RuntimeException('저장소 URL에 사용자 정보나 fragment를 넣을 수 없습니다.');
    $host = strtolower(isset($parts['host']) ? (string)$parts['host'] : '');
    if ($host === '' || filter_var($host, FILTER_VALIDATE_IP) !== false || $host === 'localhost' || substr($host, -6) === '.local') throw new RuntimeException('저장소에는 공인 도메인 이름을 사용해야 합니다.');
    $port = isset($parts['port']) ? (int)$parts['port'] : 443;
    if ($port !== 443) throw new RuntimeException('저장소는 HTTPS 기본 포트(443)만 허용됩니다.');
    $records = @dns_get_record($host, DNS_A | DNS_AAAA);
    $ips = array();
    if (is_array($records)) {
        foreach ($records as $record) {
            $ip = isset($record['ip']) ? (string)$record['ip'] : (isset($record['ipv6']) ? (string)$record['ipv6'] : '');
            if ($ip !== '' && !in_array($ip, $ips, true)) $ips[] = $ip;
        }
    }
    if (!$ips) {
        $fallback = @gethostbyname($host);
        if ($fallback && $fallback !== $host) $ips[] = $fallback;
    }
    if (!$ips) throw new RuntimeException('저장소 호스트의 DNS를 확인할 수 없습니다.');
    foreach ($ips as $ip) if (!t2u_is_public_ip($ip)) throw new RuntimeException('사설·예약 IP로 연결되는 저장소는 허용되지 않습니다.');
    $path = isset($parts['path']) && $parts['path'] !== '' ? (string)$parts['path'] : '/';
    $query = isset($parts['query']) && $parts['query'] !== '' ? '?' . (string)$parts['query'] : '';
    return array('url' => $url, 'host' => $host, 'ip' => $ips[0], 'path_query' => $path . $query);
}

function t2u_url_query($base, $params)
{
    $sep = strpos($base, '?') === false ? '?' : '&';
    return $base . $sep . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function t2u_parse_status($headers)
{
    if (!is_array($headers)) return 0;
    $status = 0;
    foreach ($headers as $line) if (preg_match('#^HTTP/\S+\s+(\d{3})#i', (string)$line, $m)) $status = (int)$m[1];
    return $status;
}

function t2u_stream_url($endpoint)
{
    $ip = strpos($endpoint['ip'], ':') !== false ? '[' . $endpoint['ip'] . ']' : $endpoint['ip'];
    return 'https://' . $ip . $endpoint['path_query'];
}

function t2u_is_dsclub_official_url($url)
{
    $parts=@parse_url((string)$url);if(!is_array($parts))return false;$host=strtolower((string)($parts['host']??''));$path=(string)($parts['path']??'');return in_array($host,array('dsclub.kr','www.dsclub.kr'),true)&&$path==='/api/t2editor/version/index.php';
}
function t2u_is_dsclub_api_url($url)
{
    $parts = @parse_url((string)$url);
    if (!is_array($parts)) return false;
    $host = strtolower((string)($parts['host'] ?? ''));
    $path = (string)($parts['path'] ?? '');
    return in_array($host, array('dsclub.kr','www.dsclub.kr'), true) && strpos($path, '/api/t2editor/') === 0;
}
function t2u_assert_dsclub_api_allowed($url)
{
    if (t2u_is_dsclub_api_url($url) && !t2u_dsclub_api_enabled()) {
        throw new RuntimeException('관리자 설정에서 DSc 에디터 업데이트 API가 꺼져 있습니다.');
    }
}
function t2u_dsclub_install_id()
{
    $file=rtrim(T2EDITOR_PRIVATE_PATH,'/\\').'/third_party_client.php';$id=t2_private_store_read($file,'');$id=is_string($id)?trim($id):'';if(preg_match('/^t2e-[a-f0-9]{48}$/',$id))return$id;$id='t2e-'.bin2hex(random_bytes(24));t2_private_store_write($file,$id);return$id;
}
function t2u_detect_host_environment() {
    return function_exists('t2editor_cms_environment')
        ? t2editor_cms_environment(T2EDITOR_BASE_PATH)
        : 'standalone';
}

function t2u_dsclub_headers($url)
{
    if(!t2u_is_dsclub_official_url($url) || !t2u_dsclub_api_enabled())return array();
    $query=array();parse_str((string)(parse_url((string)$url,PHP_URL_QUERY)?:''),$query);if((string)($query['action']??'')!=='download')return array();
    return array('X-DSc-T2Editor-Version: '.t2u_current_version(),'X-DSc-Install-Id: '.t2u_dsclub_install_id(),'X-DSc-PHP-Version: '.PHP_VERSION,'X-DSc-Platform: '.substr(PHP_OS_FAMILY.' / '.php_uname('m'),0,80),'X-DSc-Host-Environment: '.t2u_detect_host_environment());
}
function t2u_header_lines($base,$url)
{
    $lines=$base;foreach(t2u_dsclub_headers($url) as$line)$lines.=$line."\r\n";return$lines;
}

function t2u_header_value($headers, $name)
{
    if (!is_array($headers)) return '';
    $wanted = strtolower((string)$name);
    $value = '';
    foreach ($headers as $line) {
        $pos = strpos((string)$line, ':');
        if ($pos === false) continue;
        if (strtolower(trim(substr((string)$line, 0, $pos))) === $wanted) $value = trim(substr((string)$line, $pos + 1));
    }
    return $value;
}

function t2u_decode_json_response($body, $status, $contentType, $headers)
{
    $raw = (string)$body;
    if (substr($raw, 0, 3) === "\xEF\xBB\xBF") $raw = substr($raw, 3);
    $raw = trim($raw);
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) return $decoded;

    $requestId = t2u_header_value($headers, 'X-T2-Request-Id');
    $meta = 'HTTP ' . (int)$status;
    if ((string)$contentType !== '') $meta .= ', ' . substr((string)$contentType, 0, 80);
    if ($requestId !== '') $meta .= ', 요청 ID ' . substr($requestId, 0, 80);

    if ($raw === '') {
        throw new RuntimeException('저장소가 빈 응답을 반환했습니다 (' . $meta . ').');
    }
    if (preg_match('/^\s*</', $raw) || stripos((string)$contentType, 'text/html') !== false) {
        throw new RuntimeException('저장소가 JSON 대신 HTML 오류 문서를 반환했습니다 (' . $meta . '). 저장소 API 경로와 서버 PHP 오류 로그를 확인하세요.');
    }
    if ((int)$status >= 300 && (int)$status < 400) {
        throw new RuntimeException('저장소가 리다이렉트 응답을 반환했습니다 (' . $meta . '). 리다이렉트 없는 최종 HTTPS API 주소를 사용하세요.');
    }
    if (in_array((int)$status, array(401, 403), true)) {
        throw new RuntimeException('저장소 접근이 거부되었습니다 (' . $meta . '). 방화벽·봇 차단·접근 권한을 확인하세요.');
    }
    $jsonError = function_exists('json_last_error_msg') ? json_last_error_msg() : ('JSON error ' . json_last_error());
    throw new RuntimeException('저장소 JSON 해석에 실패했습니다 (' . $meta . ', ' . $jsonError . ').');
}

function t2u_http_get_json_raw($url)
{
    t2u_assert_dsclub_api_allowed($url);
    $endpoint = t2u_endpoint($url);
    $headers = array();
    $contentType = '';
    if (extension_loaded('curl') && function_exists('curl_init')) {
        $ch = curl_init($endpoint['url']);
        if ($ch === false) throw new RuntimeException('저장소 연결을 초기화하지 못했습니다.');
        $resolveIp = strpos($endpoint['ip'], ':') !== false ? '[' . $endpoint['ip'] . ']' : $endpoint['ip'];
        $options = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_merge(array(
                'Accept: application/json',
                'Accept-Encoding: identity',
                'Cache-Control: no-cache',
                'User-Agent: T2Editor-CoreUpdater/' . T2U_API_VERSION,
            ), t2u_dsclub_headers($url)),
            CURLOPT_RESOLVE => array($endpoint['host'] . ':443:' . $resolveIp),
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
                $headers[] = rtrim((string)$line, "\r\n");
                return strlen($line);
            },
        );
        if (defined('CURLOPT_ENCODING')) $options[CURLOPT_ENCODING] = 'identity';
        if (defined('CURLOPT_HTTP_VERSION') && defined('CURL_HTTP_VERSION_1_1')) $options[CURLOPT_HTTP_VERSION] = CURL_HTTP_VERSION_1_1;
        curl_setopt_array($ch, $options);
        $body = curl_exec($ch);
        $error = $body === false ? curl_error($ch) : '';
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        if ($body === false) throw new RuntimeException('저장소 연결 실패: ' . $error);
    } else {
        if (!extension_loaded('openssl') || !t2u_bool_ini('allow_url_fopen')) throw new RuntimeException('HTTPS 통신에 php-curl 또는 OpenSSL HTTPS stream이 필요합니다.');
        $context = stream_context_create(array(
            'http' => array(
                'method' => 'GET',
                'header' => t2u_header_lines("Host: {$endpoint['host']}\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nCache-Control: no-cache\r\nUser-Agent: T2Editor-CoreUpdater/" . T2U_API_VERSION . "\r\nConnection: close\r\n", $url),
                'timeout' => 30,
                'ignore_errors' => true,
                'follow_location' => 0,
                'max_redirects' => 0,
                'protocol_version' => 1.1,
            ),
            'ssl' => array('verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $endpoint['host'], 'SNI_enabled' => true, 'disable_compression' => true),
        ));
        $body = @file_get_contents(t2u_stream_url($endpoint), false, $context);
        $headers = isset($http_response_header) ? $http_response_header : array();
        $status = t2u_parse_status($headers);
        $contentType = t2u_header_value($headers, 'Content-Type');
        if ($body === false) throw new RuntimeException('저장소 HTTPS 연결에 실패했습니다.');
    }
    if (strlen((string)$body) > 4 * 1024 * 1024) throw new RuntimeException('저장소 JSON 응답이 너무 큽니다.');
    $decoded = t2u_decode_json_response($body, $status, $contentType, $headers);
    if ($status < 200 || $status >= 300 || empty($decoded['success'])) {
        $msg = isset($decoded['error']['message']) ? (string)$decoded['error']['message'] : ('HTTP ' . $status);
        $errorCode = isset($decoded['error']['code']) ? (string)$decoded['error']['code'] : '';
        if ($errorCode !== '') $msg .= ' [오류 코드: ' . substr($errorCode, 0, 80) . ']';
        $requestId = isset($decoded['request_id']) ? (string)$decoded['request_id'] : t2u_header_value($headers, 'X-T2-Request-Id');
        if ($requestId !== '') $msg .= ' [요청 ID: ' . substr($requestId, 0, 80) . ']';
        throw new RuntimeException('저장소 요청 실패: ' . $msg);
    }
    return $decoded;
}

function t2u_http_json($url)
{
    $decoded = t2u_http_get_json_raw($url);
    $compat = isset($decoded['api']['compatibility']) ? (string)$decoded['api']['compatibility'] : (isset($decoded['store']['compatibility']) ? (string)$decoded['store']['compatibility'] : '');
    if ($compat !== T2U_STORE_COMPATIBILITY) throw new RuntimeException('호환되지 않는 에디터 저장소 API입니다. 요구 규격: ' . T2U_STORE_COMPATIBILITY);
    return $decoded;
}

function t2u_http_download($url, $target, $maxBytes)
{
    t2u_assert_dsclub_api_allowed($url);
    $endpoint = t2u_endpoint($url);
    $written = 0;
    $status = 0;
    $contentType = '';
    if (extension_loaded('curl') && function_exists('curl_init')) {
        $fp = @fopen($target, 'wb');
        if ($fp === false) throw new RuntimeException('임시 업데이트 파일을 만들 수 없습니다.');
        $ch = curl_init($endpoint['url']);
        $resolveIp = strpos($endpoint['ip'], ':') !== false ? '[' . $endpoint['ip'] . ']' : $endpoint['ip'];
        curl_setopt_array($ch, array(
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 180,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array_merge(array('Accept: application/zip', 'Accept-Encoding: identity', 'User-Agent: T2Editor-CoreUpdater/' . T2U_API_VERSION), t2u_dsclub_headers($url)),
            CURLOPT_RESOLVE => array($endpoint['host'] . ':443:' . $resolveIp),
            CURLOPT_ENCODING => 'identity',
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
            CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use ($fp, &$written, $maxBytes) {
                $length = strlen($chunk);
                $written += $length;
                if ($written > $maxBytes) return 0;
                return fwrite($fp, $chunk);
            },
        ));
        $ok = curl_exec($ch);
        $error = $ok === false ? curl_error($ch) : '';
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        fclose($fp);
        if ($ok === false) { @unlink($target); throw new RuntimeException('업데이트 다운로드 실패: ' . $error); }
    } else {
        if (!extension_loaded('openssl') || !t2u_bool_ini('allow_url_fopen')) throw new RuntimeException('HTTPS 다운로드에 php-curl 또는 OpenSSL HTTPS stream이 필요합니다.');
        $context = stream_context_create(array(
            'http' => array('method' => 'GET', 'header' => t2u_header_lines("Host: {$endpoint['host']}\r\nAccept: application/zip\r\nAccept-Encoding: identity\r\nUser-Agent: T2Editor-CoreUpdater/" . T2U_API_VERSION . "\r\nConnection: close\r\n", $url), 'timeout' => 180, 'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0),
            'ssl' => array('verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $endpoint['host'], 'SNI_enabled' => true, 'disable_compression' => true),
        ));
        $in = @fopen(t2u_stream_url($endpoint), 'rb', false, $context);
        $headers = isset($http_response_header) ? $http_response_header : array();
        $status = t2u_parse_status($headers);
        foreach ($headers as $line) if (stripos((string)$line, 'Content-Type:') === 0) $contentType = trim(substr((string)$line, 13));
        if ($in === false) throw new RuntimeException('업데이트 HTTPS 다운로드에 실패했습니다.');
        $out = @fopen($target, 'wb');
        if ($out === false) { fclose($in); throw new RuntimeException('임시 업데이트 파일을 만들 수 없습니다.'); }
        while (!feof($in)) {
            $chunk = fread($in, 1048576);
            if ($chunk === false) break;
            $written += strlen($chunk);
            if ($written > $maxBytes) { fclose($in); fclose($out); @unlink($target); throw new RuntimeException('업데이트 파일이 허용 크기를 초과했습니다.'); }
            if ($chunk !== '' && fwrite($out, $chunk) !== strlen($chunk)) { fclose($in); fclose($out); @unlink($target); throw new RuntimeException('임시 업데이트 파일 저장에 실패했습니다.'); }
        }
        fclose($in); fclose($out);
    }
    if ($status < 200 || $status >= 300 || $written < 1 || $written > $maxBytes || stripos($contentType, 'json') !== false || stripos($contentType, 'html') !== false) {
        @unlink($target);
        throw new RuntimeException('업데이트 파일 다운로드 응답이 올바르지 않습니다. HTTP ' . $status);
    }
    return $written;
}

function t2u_store_by_id($id)
{
    foreach (t2u_stores() as $store) if (is_array($store) && !empty($store['enabled']) && (string)$store['id'] === (string)$id) return $store;
    throw new RuntimeException('활성 업데이트 저장소를 찾을 수 없습니다.');
}

function t2u_validate_version_object($version)
{
    if (!is_array($version) || empty($version['version']) || empty($version['files']) || !is_array($version['files'])) throw new RuntimeException('저장소의 버전 객체가 불완전합니다.');
    if (!preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', (string)$version['version'])) throw new RuntimeException('저장소 버전 문자열이 올바르지 않습니다.');
    $files = array(); $totalBytes = 0;
    foreach ($version['files'] as $file) {
        if (!is_array($file) || empty($file['available'])) continue;
        $sha = strtolower(trim(isset($file['sha256']) ? (string)$file['sha256'] : ''));
        $url = trim(isset($file['download_url']) ? (string)$file['download_url'] : '');
        $size = isset($file['size_bytes']) ? (int)$file['size_bytes'] : (isset($file['size']) ? (int)$file['size'] : 0);
        if (!preg_match('/^[a-f0-9]{64}$/', $sha) || $size < 1 || $size > T2U_MAX_ARCHIVE_BYTES || $url === '') continue;
        t2u_endpoint($url);
        $file['sha256'] = $sha;
        $file['size_bytes'] = $size;
        $totalBytes += $size;
        $files[] = $file;
    }
    if (!$files) throw new RuntimeException('설치 가능한 SHA-256 포함 ZIP 파일이 없습니다.');
    $title = '';
    foreach (array('title','name','version_name') as $key) if ($title === '' && !empty($version[$key])) $title = t2u_clean_text($version[$key], 160);
    $releaseDate = '';
    foreach (array('release_date','released_at','published_at','date') as $key) if ($releaseDate === '' && !empty($version[$key])) $releaseDate = t2u_clean_text($version[$key], 80);
    $changes = '';
    foreach (array('changes','description','release_notes','notes','changelog','content','summary') as $key) if ($changes === '' && !empty($version[$key])) $changes = t2u_clean_text($version[$key], 20000);
    $version['title'] = $title;
    $version['release_date'] = $releaseDate;
    $version['changes'] = $changes;
    $version['size_bytes'] = isset($files[0]['size_bytes']) ? (int)$files[0]['size_bytes'] : $totalBytes;
    $version['total_size_bytes'] = $totalBytes;
    $version['file_count'] = count($files);
    $version['files'] = $files;
    return $version;
}

function t2u_select_version_file($version, $preferredIndex, $preferredName = '')
{
    $files = isset($version['files']) && is_array($version['files']) ? $version['files'] : array();
    if ($preferredName !== '') {
        foreach ($files as $file) {
            if (is_array($file) && isset($file['name']) && (string)$file['name'] === (string)$preferredName) return $file;
        }
    }
    $index = (int)$preferredIndex;
    if (isset($files[$index]) && is_array($files[$index])) return $files[$index];
    if (isset($files[0]) && is_array($files[0])) return $files[0];
    throw new RuntimeException('선택한 업데이트 ZIP 파일이 없습니다.');
}

/**
 * Downloads and validates one official distribution package. Both the target
 * package and the same-version baseline are kept under T2EDITOR_PRIVATE_PATH,
 * so recovery/update working files never depend on the operating-system temp
 * directory.
 */
function t2u_download_version_archive($store, $versionValue, $preferredIndex, $preferredName, $id, $role)
{
    global $T2U_TMP_DIR;
    $safeRole = preg_replace('/[^a-z0-9_-]/i', '-', (string)$role);
    $result = t2u_http_json(t2u_url_query($store['url'], array('version'=>(string)$versionValue)));
    $version = t2u_validate_version_object(isset($result['version']) ? $result['version'] : array());
    if ((string)$version['version'] !== (string)$versionValue) throw new RuntimeException('저장소가 요청한 버전과 다른 배포 정보를 반환했습니다.');
    $file = t2u_select_version_file($version, $preferredIndex, $preferredName);
    $archive = $T2U_TMP_DIR . '/archive-' . $safeRole . '-' . $id . '.zip';
    $stage = $T2U_TMP_DIR . '/stage-' . $safeRole . '-' . $id;
    try {
        $written = t2u_http_download((string)$file['download_url'], $archive, T2U_MAX_ARCHIVE_BYTES);
        if ($written !== (int)$file['size_bytes']) throw new RuntimeException('다운로드 파일 크기가 저장소 메타데이터와 다릅니다.');
        $sha = t2u_hash_file($archive);
        if (!hash_equals(strtolower((string)$file['sha256']), $sha)) throw new RuntimeException('다운로드 파일 SHA-256이 저장소 메타데이터와 다릅니다.');
        return array('version'=>$version,'file'=>$file,'archive'=>$archive,'stage'=>$stage,'archive_sha256'=>$sha,'role'=>$safeRole);
    } catch (Throwable $e) {
        @unlink($archive);
        t2u_remove_tree($stage);
        throw $e;
    }
}

function t2u_prepare_version_package($store, $versionValue, $preferredIndex, $preferredName, $id, $role)
{
    $package = t2u_download_version_archive($store, $versionValue, $preferredIndex, $preferredName, $id, $role);
    try {
        t2u_extract_archive($package['archive'], $package['stage']);
        t2u_normalize_distribution_stage($package['stage'], false);
        list($manifest, $warning) = t2u_load_incoming_manifest($package['stage'], (string)$package['version']['version'], (string)$package['role'] !== 'baseline');
        $package['manifest'] = $manifest;
        $package['warning'] = $warning;
        return $package;
    } catch (Throwable $e) {
        t2u_cleanup_version_package($package);
        throw $e;
    }
}

function t2u_cleanup_version_package($package)
{
    if (!is_array($package)) return;
    if (!empty($package['archive'])) @unlink((string)$package['archive']);
    if (!empty($package['stage'])) t2u_remove_tree((string)$package['stage']);
}


function t2u_finalize_prepared_plan($id, $store, $targetPackage, $baselinePackage, $operation, $majorVersionWarningAck = false)
{
    $version = $targetPackage['version'];
    $currentVersion = t2u_current_version();
    $installMode = t2u_install_mode()['core'];
    $majorVersionMismatch = t2u_major_version_mismatch($currentVersion, (string)$version['version']);
    if ($majorVersionMismatch && !$majorVersionWarningAck) throw new RuntimeException('현재 T2Editor ' . $currentVersion . '와 설치하려는 버전 ' . $version['version'] . '의 메이저 버전이 다릅니다. 관리자 화면에서 호환성 경고를 확인한 뒤 다시 진행하세요.');

    if ($installMode === 'data') {
        if (!t2u_data_install_supported()) throw new RuntimeException('공용 데이터 설치 경로에 쓰기 권한이 없습니다.');
        $inheritedRelease = t2u_normalize_distribution_stage((string)$targetPackage['stage'], true);
        $releaseManifest = t2u_release_manifest((string)$targetPackage['stage'], (string)$version['version'], (string)$targetPackage['archive_sha256']);
        $inheritWarning = '';
        if (!empty($inheritedRelease['count'])) {
            $sample = array_slice(isset($inheritedRelease['files']) && is_array($inheritedRelease['files']) ? $inheritedRelease['files'] : array(), 0, 8);
            $inheritWarning = '업데이트 ZIP이 부분 패치 형식이어서 현재 활성 런타임의 누락 파일 ' . (int)$inheritedRelease['count'] . '개를 상속해 완전한 데이터 릴리스를 구성했습니다.';
            if (!empty($sample)) $inheritWarning .= ' 예: ' . implode(', ', $sample) . ((int)$inheritedRelease['count'] > count($sample) ? ' 외' : '');
        }
        @unlink((string)$targetPackage['archive']);
        $plan = array(
            'id'=>$id,'created_at'=>time(),'expires_at'=>time()+T2U_PLAN_TTL,
            'store'=>$store,'version'=>(string)$version['version'],'release'=>$version,
            'archive'=>'','stage'=>$targetPackage['stage'],'archive_sha256'=>$targetPackage['archive_sha256'],
            'manifest'=>$releaseManifest,'operations'=>array(),
            'counts'=>array('total'=>(int)$releaseManifest['file_count'],'replace'=>(int)$releaseManifest['file_count'],'delete'=>0,'conflict'=>0,'preserve'=>0),
            'warning'=>trim((string)($targetPackage['warning'] ?? '') . ($inheritWarning !== '' ? (($targetPackage['warning'] ?? '') !== '' ? "\n" : '') . $inheritWarning : '')),'current_version'=>$currentVersion,
            'comparison'=>'immutable_release','incremental_stage'=>false,'install_mode'=>'data','operation'=>$operation,
            'major_version_mismatch'=>$majorVersionMismatch,'major_version_warning_ack'=>(!$majorVersionMismatch || $majorVersionWarningAck),
            'release_id_preview'=>t2u_release_id((string)$version['version'], (string)$targetPackage['archive_sha256']),
        );
        t2u_write_private(t2u_plan_file($id), $plan);
        $public=$plan; unset($public['archive'],$public['stage'],$public['manifest']);
        return array($public, $operation === 'reinstall' ? '현재 버전을 새 데이터 릴리스 슬롯에 재설치할 계획을 만들었습니다.' : '새 데이터 릴리스 슬롯에 설치할 계획을 만들었습니다.');
    }

    if (!is_writable(T2EDITOR_PATH)) throw new RuntimeException('직접 설치를 사용하려면 T2Editor 원본 경로에 쓰기 권한이 필요합니다.');
    if (!is_array($baselinePackage)) throw new RuntimeException('직접 설치 비교용 현재 버전 원본이 없습니다.');
    list($operations, $counts) = t2u_build_plan((string)$baselinePackage['stage'], $baselinePackage['manifest'], (string)$targetPackage['stage'], $targetPackage['manifest'], $operation === 'reinstall' || (string)$version['version'] === (string)$currentVersion);
    $warnings=array();
    if (!empty($baselinePackage['warning'])) $warnings[]='현재 버전 원본: '.$baselinePackage['warning'];
    if (!empty($targetPackage['warning'])) $warnings[]='대상 버전 원본: '.$targetPackage['warning'];
    $stagedIncrement=t2u_prune_stage_for_operations((string)$targetPackage['stage'],$operations);
    @unlink((string)$targetPackage['archive']);
    $plan=array(
        'id'=>$id,'created_at'=>time(),'expires_at'=>time()+T2U_PLAN_TTL,'store'=>$store,
        'version'=>(string)$version['version'],'release'=>$version,'archive'=>'','stage'=>$targetPackage['stage'],
        'archive_sha256'=>$targetPackage['archive_sha256'],'manifest'=>$targetPackage['manifest'],'operations'=>$operations,
        'counts'=>$counts,'warning'=>implode(' ',$warnings),'current_version'=>$currentVersion,
        'baseline_version'=>(string)$baselinePackage['version']['version'],'comparison'=>'three_way','incremental_stage'=>$stagedIncrement,
        'install_mode'=>'direct','operation'=>$operation,
        'major_version_mismatch'=>$majorVersionMismatch,'major_version_warning_ack'=>(!$majorVersionMismatch || $majorVersionWarningAck),
    );
    t2u_write_private(t2u_plan_file($id),$plan);
    t2u_cleanup_version_package($baselinePackage);
    $public=$plan; unset($public['archive'],$public['stage'],$public['manifest']);
    return array($public, $operation === 'reinstall' ? '현재 버전 직접 재설치 계획을 만들었습니다.' : '동일 버전 원본을 기준으로 3-way 직접 업데이트 계획을 만들었습니다.');
}

function t2u_safe_path($path)
{
    $path = str_replace('\\', '/', (string)$path);
    while (strpos($path, '//') !== false) $path = str_replace('//', '/', $path);
    while (strpos($path, './') === 0) $path = substr($path, 2);
    if ($path === '' || strpos($path, "\0") !== false || $path[0] === '/' || preg_match('#^[A-Za-z]:/#', $path) || preg_match('#(^|/)\.\.?(/|$)#', $path)) return false;
    return $path;
}

function t2u_ignored_entry($path)
{
    $path = str_replace('\\', '/', (string)$path);
    $base = basename(rtrim($path, '/'));
    return $path === '__MACOSX' || strpos($path, '__MACOSX/') === 0 || $base === '.DS_Store' || $base === 'Thumbs.db' || $base === 'desktop.ini' || strpos($base, '._') === 0;
}

function t2u_protected_path($relative)
{
    $relative = ltrim(str_replace('\\', '/', (string)$relative), '/');
    if ($relative === 'data' || strpos($relative, 'data/') === 0) return true;
    if ($relative === 'admin/t2admin.key' || $relative === 'admin/t2admin.key.txt') return true;
    if (preg_match('#(^|/)(\.git|\.svn|\.hg)(/|$)#', $relative)) return true;
    if (preg_match('#(^|/)(\.htaccess|\.user\.ini|web\.config|php\.ini)$#i', $relative)) return true;
    return false;
}

function t2u_zip_entries_pure($path)
{
    $size = @filesize($path);
    if ($size === false || $size < 22 || $size > T2U_MAX_ARCHIVE_BYTES) throw new RuntimeException('ZIP 파일 크기가 올바르지 않습니다.');
    $fp = @fopen($path, 'rb');
    if ($fp === false) throw new RuntimeException('ZIP 파일을 열 수 없습니다.');
    $tailSize = min($size, 22 + 65535 + 20);
    fseek($fp, $size - $tailSize);
    $tail = (string)fread($fp, $tailSize);
    $eocd = strrpos($tail, "PK\x05\x06");
    if ($eocd === false || strlen($tail) < $eocd + 22) { fclose($fp); throw new RuntimeException('ZIP 중앙 디렉터리를 찾을 수 없습니다.'); }
    $e = unpack('vdisk/vcd_disk/ventries_disk/ventries/Vcd_size/Vcd_offset/vcomment', substr($tail, $eocd + 4, 18));
    if (!is_array($e) || $e['disk'] !== 0 || $e['cd_disk'] !== 0 || $e['entries'] !== $e['entries_disk'] || $e['entries'] > T2U_MAX_FILES || $e['cd_offset'] + $e['cd_size'] > $size) { fclose($fp); throw new RuntimeException('ZIP64·분할 ZIP 또는 과도한 파일 수는 지원하지 않습니다.'); }
    fseek($fp, $e['cd_offset']);
    $entries = array();
    $total = 0;
    for ($i = 0; $i < $e['entries']; $i++) {
        $head = (string)fread($fp, 46);
        if (strlen($head) !== 46 || substr($head, 0, 4) !== "PK\x01\x02") { fclose($fp); throw new RuntimeException('ZIP 중앙 디렉터리가 손상되었습니다.'); }
        $h = unpack('vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/vname_len/vextra_len/vcomment_len/vdisk/vinternal/Vexternal/Vlocal_offset', substr($head, 4));
        if (!is_array($h) || $h['compressed'] === 0xFFFFFFFF || $h['uncompressed'] === 0xFFFFFFFF || $h['local_offset'] === 0xFFFFFFFF) { fclose($fp); throw new RuntimeException('ZIP64 형식은 지원하지 않습니다.'); }
        $name = (string)fread($fp, $h['name_len']);
        if ($h['extra_len'] > 0) fseek($fp, $h['extra_len'], SEEK_CUR);
        if ($h['comment_len'] > 0) fseek($fp, $h['comment_len'], SEEK_CUR);
        $total += (int)$h['uncompressed'];
        if ($h['uncompressed'] > T2U_MAX_FILE_BYTES || $total > T2U_MAX_UNCOMPRESSED_BYTES) { fclose($fp); throw new RuntimeException('ZIP 해제 크기가 안전 한도를 초과했습니다.'); }
        $entries[] = array(
            'name' => $name, 'flags' => (int)$h['flags'], 'method' => (int)$h['method'], 'crc' => (int)$h['crc'],
            'compressed' => (int)$h['compressed'], 'uncompressed' => (int)$h['uncompressed'], 'external' => (int)$h['external'], 'local_offset' => (int)$h['local_offset'],
        );
    }
    fclose($fp);
    return $entries;
}

function t2u_zip_entries($path)
{
    if (!class_exists('ZipArchive')) return t2u_zip_entries_pure($path);
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new RuntimeException('ZIP 파일을 열 수 없습니다.');
    $entries = array(); $total = 0;
    try {
        if ($zip->numFiles < 1 || $zip->numFiles > T2U_MAX_FILES) throw new RuntimeException('ZIP 파일 수가 허용 범위를 벗어났습니다.');
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i, ZipArchive::FL_UNCHANGED);
            if (!is_array($stat)) throw new RuntimeException('ZIP 항목 정보를 읽을 수 없습니다.');
            $opsys = 0; $attr = 0; $zip->getExternalAttributesIndex($i, $opsys, $attr);
            $size = isset($stat['size']) ? (int)$stat['size'] : 0;
            $total += $size;
            if ($size > T2U_MAX_FILE_BYTES || $total > T2U_MAX_UNCOMPRESSED_BYTES) throw new RuntimeException('ZIP 해제 크기가 안전 한도를 초과했습니다.');
            $entries[] = array('name' => (string)$stat['name'], 'index' => $i, 'flags' => 0, 'method' => isset($stat['comp_method']) ? (int)$stat['comp_method'] : 0, 'crc' => isset($stat['crc']) ? (int)$stat['crc'] : 0, 'compressed' => isset($stat['comp_size']) ? (int)$stat['comp_size'] : 0, 'uncompressed' => $size, 'external' => (int)$attr, 'encryption_method' => isset($stat['encryption_method']) ? (int)$stat['encryption_method'] : 0);
        }
    } finally { $zip->close(); }
    return $entries;
}

function t2u_validate_archive_entries($entries)
{
    $files = 0;
    foreach ($entries as $entry) {
        $raw = str_replace('\\', '/', (string)$entry['name']);
        if (!t2browser_utf8_valid($raw)) throw new RuntimeException('ZIP 파일 이름은 UTF-8이어야 합니다.');
        if (t2u_ignored_entry($raw)) continue;
        $safe = t2u_safe_path($raw);
        if ($safe === false) throw new RuntimeException('ZIP에 안전하지 않은 경로가 있습니다: ' . t2u_clean_text($raw, 180));
        $mode = ((int)$entry['external'] >> 16) & 0xF000;
        if ($mode === 0xA000) throw new RuntimeException('ZIP의 심볼릭 링크는 허용되지 않습니다.');
        if (!empty($entry['encryption_method']) || (((int)$entry['flags'] & 1) === 1)) throw new RuntimeException('암호화된 ZIP 항목은 허용되지 않습니다.');
        if (substr($safe, -1) !== '/') $files++;
    }
    if ($files < 1) throw new RuntimeException('ZIP에 설치할 에디터 파일이 없습니다.');
}

function t2u_mkdir($dir)
{
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) throw new RuntimeException('디렉터리를 만들 수 없습니다: ' . basename($dir));
}

function t2u_extract_archive($zipPath, $stage)
{
    $entries = t2u_zip_entries($zipPath);
    t2u_validate_archive_entries($entries);
    t2u_mkdir($stage);
    if (class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) throw new RuntimeException('ZIP 파일을 다시 열 수 없습니다.');
        try {
            foreach ($entries as $entry) {
                $name = str_replace('\\', '/', (string)$entry['name']);
                if (t2u_ignored_entry($name) || substr($name, -1) === '/') continue;
                $relative = t2u_safe_path($name);
                if ($relative === false || $relative === '') continue;
                $target = $stage . '/' . $relative;
                t2u_mkdir(dirname($target));
                $stream = $zip->getStream((string)$entry['name']);
                if ($stream === false) throw new RuntimeException('ZIP 항목을 읽을 수 없습니다: ' . $relative);
                $out = @fopen($target, 'wb');
                if ($out === false) { fclose($stream); throw new RuntimeException('임시 파일을 만들 수 없습니다: ' . $relative); }
                $written = stream_copy_to_stream($stream, $out, T2U_MAX_FILE_BYTES + 1);
                fclose($stream); fclose($out);
                if ($written === false || $written > T2U_MAX_FILE_BYTES || (int)$written !== (int)$entry['uncompressed']) throw new RuntimeException('ZIP 항목 크기 검증에 실패했습니다: ' . $relative);
                @chmod($target, 0644);
            }
        } finally { $zip->close(); }
        return;
    }
    $fp = @fopen($zipPath, 'rb');
    if ($fp === false) throw new RuntimeException('ZIP 파일을 열 수 없습니다.');
    try {
        foreach ($entries as $entry) {
            $name = str_replace('\\', '/', (string)$entry['name']);
            if (t2u_ignored_entry($name) || substr($name, -1) === '/') continue;
            $relative = t2u_safe_path($name);
            if ($relative === false || $relative === '') continue;
            fseek($fp, (int)$entry['local_offset']);
            $local = (string)fread($fp, 30);
            if (strlen($local) !== 30 || substr($local, 0, 4) !== "PK\x03\x04") throw new RuntimeException('ZIP 로컬 헤더가 손상되었습니다.');
            $lh = unpack('vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vuncompressed/vname_len/vextra_len', substr($local, 4));
            fseek($fp, (int)$lh['name_len'] + (int)$lh['extra_len'], SEEK_CUR);
            $compressedSize = (int)$entry['compressed'];
            $compressed = $compressedSize > 0 ? (string)fread($fp, $compressedSize) : '';
            if (strlen($compressed) !== $compressedSize) throw new RuntimeException('ZIP 압축 데이터를 모두 읽지 못했습니다: ' . $relative);
            if ((int)$entry['method'] === 0) $data = $compressed;
            elseif ((int)$entry['method'] === 8 && function_exists('gzinflate')) $data = @gzinflate($compressed, T2U_MAX_FILE_BYTES + 1);
            elseif ((int)$entry['method'] === 8) throw new RuntimeException('DEFLATE ZIP을 서버에서 해제하려면 zlib이 필요합니다.');
            else throw new RuntimeException('지원하지 않는 ZIP 압축 방식입니다: ' . (int)$entry['method']);
            if (!is_string($data) || strlen($data) !== (int)$entry['uncompressed'] || strlen($data) > T2U_MAX_FILE_BYTES) throw new RuntimeException('ZIP 항목 해제 크기가 일치하지 않습니다: ' . $relative);
            $crc = strtolower(hash('crc32b', $data));
            $expectedCrc = strtolower(sprintf('%08x', ((int)$entry['crc']) & 0xffffffff));
            if (!hash_equals($expectedCrc, $crc)) throw new RuntimeException('ZIP CRC 검증에 실패했습니다: ' . $relative);
            $target = $stage . '/' . $relative;
            t2u_mkdir(dirname($target));
            if (@file_put_contents($target, $data, LOCK_EX) === false) throw new RuntimeException('임시 파일을 저장하지 못했습니다: ' . $relative);
            @chmod($target, 0644);
            unset($data, $compressed);
        }
    } finally { fclose($fp); }
}


function t2u_browser_job_file($id)
{
    global $T2U_TMP_DIR;
    if (!preg_match('/^[a-f0-9]{32}$/', (string)$id)) throw new RuntimeException('브라우저 압축 작업 ID가 올바르지 않습니다.');
    return $T2U_TMP_DIR . '/browser-job-' . $id . '.php';
}

function t2u_browser_package_entries($archive)
{
    $rawEntries = t2u_zip_entries($archive);
    t2u_validate_archive_entries($rawEntries);
    $entries = array();
    $seen = array();
    foreach ($rawEntries as $entry) {
        $name = str_replace('\\', '/', (string)$entry['name']);
        if (t2u_ignored_entry($name) || substr($name, -1) === '/') continue;
        $path = t2u_safe_path($name);
        if ($path === false || $path === '') throw new RuntimeException('ZIP 경로가 올바르지 않습니다.');
        if (isset($seen[$path])) throw new RuntimeException('ZIP에 중복 파일 경로가 있습니다: ' . $path);
        if (!in_array((int)$entry['method'], array(0, 8), true)) throw new RuntimeException('브라우저 폴백이 지원하지 않는 ZIP 압축 방식입니다: ' . (int)$entry['method']);
        $seen[$path] = true;
        $entries[] = array(
            'index'=>count($entries),
            'zip_name'=>$name,
            'path'=>$path,
            'size'=>(int)$entry['uncompressed'],
            'crc'=>strtolower(sprintf('%08x', ((int)$entry['crc']) & 0xffffffff)),
            'method'=>(int)$entry['method'],
        );
    }
    if (!$entries) throw new RuntimeException('브라우저에서 해제할 ZIP 파일이 없습니다.');
    return $entries;
}

function t2u_browser_begin_job($store, $versionValue, $index, $operation, $majorVersionWarningAck = false)
{
    $id = bin2hex(random_bytes(16));
    $token = bin2hex(random_bytes(24));
    $packages = array();
    try {
        $packages['target'] = t2u_download_version_archive($store, $versionValue, $index, '', $id, 'target');
        if (t2u_install_mode()['core'] === 'direct') {
            $current = t2u_current_version();
            try {
                $packages['baseline'] = t2u_download_version_archive($store, $current, $index, isset($packages['target']['file']['name']) ? (string)$packages['target']['file']['name'] : '', $id, 'baseline');
            } catch (Throwable $e) {
                throw new RuntimeException('3-way 비교를 위한 현재 버전 ' . $current . ' 원본을 가져오지 못했습니다. 원인: ' . $e->getMessage());
            }
        }

        $needsBrowser = false;
        foreach ($packages as &$package) {
            $package['entries'] = t2u_browser_package_entries($package['archive']);
            foreach ($package['entries'] as $entry) if ((int)$entry['method'] !== 0) { $needsBrowser = true; break; }
        }
        unset($package);

        if (!$needsBrowser) {
            foreach ($packages as $role => &$package) {
                t2u_extract_archive($package['archive'], $package['stage']);
                t2u_normalize_distribution_stage($package['stage'], false);
                list($manifest, $warning) = t2u_load_incoming_manifest($package['stage'], (string)$package['version']['version'], $role !== 'baseline');
                $package['manifest'] = $manifest;
                $package['warning'] = $warning;
            }
            unset($package);
            list($plan, $message) = t2u_finalize_prepared_plan($id, $store, $packages['target'], isset($packages['baseline']) ? $packages['baseline'] : null, $operation, $majorVersionWarningAck);
            return array('browser_fallback_required'=>false, 'plan'=>$plan, 'message'=>$message);
        }

        $public = array();
        foreach ($packages as $role => &$package) {
            $package['uploaded'] = array();
            $package['upload_dir'] = dirname($package['stage']) . '/browser-upload-' . $role . '-' . $id;
            t2u_mkdir($package['stage']);
            t2u_mkdir($package['upload_dir']);
            $public[] = array(
                'role'=>$role,
                'archive_url'=>'update_api.php?action=browser_archive&job_id='.$id.'&role='.$role.'&token='.$token,
                'archive_bytes'=>(int)@filesize($package['archive']),
                'entries'=>array_map(function ($entry) {
                    return array('index'=>$entry['index'],'zip_name'=>$entry['zip_name'],'path'=>$entry['path'],'size'=>$entry['size']);
                }, $package['entries']),
            );
        }
        unset($package);
        $job = array(
            'id'=>$id,'token'=>$token,'created_at'=>time(),'expires_at'=>time()+T2U_BROWSER_JOB_TTL,
            'store'=>$store,'operation'=>$operation,'major_version_warning_ack'=>(bool)$majorVersionWarningAck,'packages'=>$packages,
        );
        t2u_write_private(t2u_browser_job_file($id), $job);
        return array(
            'browser_fallback_required'=>true,
            'job_id'=>$id,'token'=>$token,'chunk_bytes'=>T2U_BROWSER_CHUNK_BYTES,
            'packages'=>$public,
        );
    } catch (Throwable $e) {
        t2u_browser_cleanup_job(array('id'=>$id, 'packages'=>$packages));
        throw $e;
    }
}

function t2u_browser_load_job($id, $token)
{
    $job = t2u_read_private(t2u_browser_job_file($id), array());
    if (!is_array($job) || empty($job['expires_at']) || (int)$job['expires_at'] < time()) throw new RuntimeException('브라우저 압축 작업이 만료되었거나 손상되었습니다.');
    if (!t2browser_token_valid(isset($job['token']) ? $job['token'] : '', (string)$token)) throw new RuntimeException('브라우저 압축 작업 토큰이 올바르지 않습니다.');
    return $job;
}

function t2u_browser_save_job($job)
{
    t2u_write_private(t2u_browser_job_file((string)$job['id']), $job);
}

function t2u_browser_cleanup_job($job)
{
    if (!is_array($job)) return;
    foreach ((array)($job['packages'] ?? array()) as $package) {
        if (!empty($package['archive'])) @unlink((string)$package['archive']);
        if (!empty($package['stage'])) t2u_remove_tree((string)$package['stage']);
        if (!empty($package['upload_dir'])) t2u_remove_tree((string)$package['upload_dir']);
    }
    if (!empty($job['id'])) @unlink(t2u_browser_job_file((string)$job['id']));
}

function t2u_browser_serve_archive($id, $role, $token)
{
    global $T2U_LOCAL_BUFFER_LEVEL;
    $job = t2u_browser_load_job($id, $token);
    if (!isset($job['packages'][$role]) || !is_array($job['packages'][$role])) throw new RuntimeException('브라우저 압축 패키지를 찾을 수 없습니다.');
    $file = (string)$job['packages'][$role]['archive'];
    if (!is_file($file)) throw new RuntimeException('브라우저로 전달할 ZIP 파일이 없습니다.');
    while (ob_get_level() > $T2U_LOCAL_BUFFER_LEVEL) ob_end_clean();
    if (function_exists('set_time_limit')) @set_time_limit(600);
    header('Content-Type: application/zip');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . (int)filesize($file));
    header('Content-Disposition: attachment; filename="t2editor-package.zip"');
    header('Cache-Control: no-store');
    readfile($file);
    exit;
}

function t2u_browser_upload_entry($id, $role, $token, $entryIndex, $offset)
{
    $job = t2u_browser_load_job($id, $token);
    if (!isset($job['packages'][$role]) || !is_array($job['packages'][$role])) throw new RuntimeException('브라우저 압축 패키지를 찾을 수 없습니다.');
    $package =& $job['packages'][$role];
    $entryIndex = (int)$entryIndex;
    if (!isset($package['entries'][$entryIndex])) throw new RuntimeException('브라우저 업로드 파일 번호가 올바르지 않습니다.');
    $entry = $package['entries'][$entryIndex];
    if (isset($package['uploaded'][(string)$entryIndex])) return array('complete'=>true,'received'=>(int)$entry['size']);
    $part = rtrim((string)$package['upload_dir'], '/\\') . '/' . $entryIndex . '.part';
    $expected = (int)$entry['size'];
    if ($expected === 0) {
        if ((int)$offset !== 0) throw new RuntimeException('빈 파일 업로드 위치가 올바르지 않습니다.');
        if (@file_put_contents($part, '') === false) throw new RuntimeException('빈 파일을 저장하지 못했습니다.');
        $received = 0;
    } else {
        $data = t2browser_read_chunk(T2U_BROWSER_CHUNK_BYTES);
        $received = t2browser_append_chunk($part, (int)$offset, $data, $expected);
    }
    if ($received === $expected) {
        if ((int)@filesize($part) !== $expected || !hash_equals((string)$entry['crc'], t2browser_crc32_file($part))) throw new RuntimeException('브라우저가 반환한 파일 검증에 실패했습니다: ' . $entry['path']);
        $target = rtrim((string)$package['stage'], '/\\') . '/' . $entry['path'];
        t2u_mkdir(dirname($target));
        if (!@rename($part, $target)) throw new RuntimeException('검증된 파일을 설치 준비 경로로 이동하지 못했습니다.');
        @chmod($target, 0644);
        $package['uploaded'][(string)$entryIndex] = true;
        t2u_browser_save_job($job);
        return array('complete'=>true,'received'=>$received);
    }
    return array('complete'=>false,'received'=>$received);
}

function t2u_browser_finalize_job($id, $token)
{
    if (function_exists('set_time_limit')) @set_time_limit(300);
    $job = t2u_browser_load_job($id, $token);
    $target = null;
    $baseline = null;
    try {
        foreach ($job['packages'] as $role => &$package) {
            if (count((array)$package['uploaded']) !== count((array)$package['entries'])) throw new RuntimeException('브라우저 압축 해제가 완료되지 않았습니다: ' . $role);
            foreach ($package['entries'] as $entry) {
                $file = rtrim((string)$package['stage'], '/\\') . '/' . $entry['path'];
                if (!is_file($file) || (int)@filesize($file) !== (int)$entry['size'] || !hash_equals((string)$entry['crc'], t2browser_crc32_file($file))) throw new RuntimeException('브라우저 압축 해제 결과가 원본 ZIP과 일치하지 않습니다: ' . $entry['path']);
            }
            t2u_normalize_distribution_stage($package['stage'], false);
            list($manifest, $warning) = t2u_load_incoming_manifest($package['stage'], (string)$package['version']['version'], $role !== 'baseline');
            $package['manifest'] = $manifest;
            $package['warning'] = $warning;
            t2u_remove_tree((string)$package['upload_dir']);
            if ($role === 'target') $target = $package;
            if ($role === 'baseline') $baseline = $package;
        }
        unset($package);
        list($plan, $message) = t2u_finalize_prepared_plan((string)$job['id'], $job['store'], $target, $baseline, (string)$job['operation'], !empty($job['major_version_warning_ack']));
        @unlink(t2u_browser_job_file((string)$job['id']));
        return array($plan, $message);
    } catch (Throwable $e) {
        t2u_browser_cleanup_job($job);
        throw $e;
    }
}

function t2u_remove_tree($path)
{
    if (!file_exists($path) && !is_link($path)) return;
    if (is_file($path) || is_link($path)) { @unlink($path); return; }
    $items = @scandir($path);
    if (is_array($items)) foreach ($items as $item) if ($item !== '.' && $item !== '..') t2u_remove_tree($path . '/' . $item);
    @rmdir($path);
}

function t2u_hash_file($file)
{
    return is_file($file) ? strtolower((string)@hash_file('sha256', $file)) : '';
}

function t2u_scan_local_installation()
{
    $files = array();
    $root = rtrim(str_replace('\\', '/', T2EDITOR_PATH), '/');
    $skipDirs = array('.git'=>true,'.svn'=>true,'.hg'=>true,'.idea'=>true,'.vscode'=>true,'node_modules'=>true,'__MACOSX'=>true);
    $walk = function ($dir, $prefix = '') use (&$walk, &$files, $root, $skipDirs) {
        $items = @scandir($dir);
        if (!is_array($items)) throw new RuntimeException('현재 에디터 파일 목록을 읽을 수 없습니다: ' . ($prefix !== '' ? $prefix : '.'));
        foreach ($items as $name) {
            if ($name === '.' || $name === '..') continue;
            $relative = $prefix === '' ? $name : $prefix . '/' . $name;
            $full = $dir . '/' . $name;
            if (is_link($full)) continue;
            if (is_dir($full)) {
                if (isset($skipDirs[$name]) || t2u_protected_path($relative)) continue;
                $walk($full, $relative);
                continue;
            }
            if (!is_file($full) || $relative === 'update-manifest.json' || t2u_protected_path($relative) || t2u_ignored_entry($relative)) continue;
            $files[$relative] = array('sha256'=>t2u_hash_file($full),'size'=>(int)@filesize($full));
            if (count($files) > T2U_MAX_FILES) throw new RuntimeException('현재 에디터 파일 수가 안전 검사 한도를 초과했습니다.');
        }
    };
    $walk($root, '');
    ksort($files);
    return $files;
}

function t2u_scan_stage($stage)
{
    $files = array();
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($stage, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $info) {
        if (!$info->isFile() || $info->isLink()) continue;
        $full = str_replace('\\', '/', $info->getPathname());
        $relative = ltrim(substr($full, strlen(str_replace('\\', '/', rtrim($stage, '/\\')))), '/');
        if ($relative === 'update-manifest.json' || t2u_protected_path($relative)) continue;
        $files[$relative] = array('sha256' => t2u_hash_file($info->getPathname()), 'size' => (int)$info->getSize());
    }
    ksort($files);
    return $files;
}

function t2u_validate_manifest_files($manifestFiles, $stageFiles)
{
    if (!is_array($manifestFiles)) throw new RuntimeException('업데이트 매니페스트 files가 올바르지 않습니다.');
    $clean = array();
    foreach ($manifestFiles as $path => $meta) {
        $safe = t2u_safe_path((string)$path);
        if ($safe === false || $safe !== (string)$path) throw new RuntimeException('매니페스트에 안전하지 않은 파일 경로가 있습니다.');
        if (t2u_protected_path($safe) || $safe === 'update-manifest.json') continue;
        if (!isset($stageFiles[$safe])) throw new RuntimeException('매니페스트 파일이 ZIP에 없습니다: ' . $safe);
        $sha = is_array($meta) && isset($meta['sha256']) ? strtolower((string)$meta['sha256']) : '';
        $size = is_array($meta) && isset($meta['size']) ? (int)$meta['size'] : -1;
        if (!preg_match('/^[a-f0-9]{64}$/', $sha) || $size < 0 || !hash_equals($sha, $stageFiles[$safe]['sha256']) || $size !== (int)$stageFiles[$safe]['size']) throw new RuntimeException('매니페스트 해시/크기가 ZIP 파일과 일치하지 않습니다: ' . $safe);
        $clean[$safe] = array('sha256' => $sha, 'size' => $size);
    }
    if (count($clean) !== count($stageFiles)) throw new RuntimeException('ZIP 파일 목록과 업데이트 매니페스트 목록이 일치하지 않습니다.');
    ksort($clean);
    return $clean;
}

function t2u_load_incoming_manifest($stage, $version, $checkRequirements = true)
{
    $stageFiles = t2u_scan_stage($stage);
    $file = $stage . '/update-manifest.json';
    $warning = '';
    if (is_file($file)) {
        $raw = (string)@file_get_contents($file);
        $manifest = json_decode($raw, true);
        if (!is_array($manifest) || (isset($manifest['schema']) ? (string)$manifest['schema'] : '') !== T2U_MANIFEST_SCHEMA || (isset($manifest['compatibility']) ? (string)$manifest['compatibility'] : '') !== 't2editor-core-update/1') throw new RuntimeException('지원하지 않는 코어 업데이트 매니페스트입니다.');
        if ((string)(isset($manifest['version']) ? $manifest['version'] : '') !== (string)$version) throw new RuntimeException('ZIP 매니페스트 버전과 저장소 버전이 다릅니다.');
        $manifest['files'] = t2u_validate_manifest_files(isset($manifest['files']) ? $manifest['files'] : array(), $stageFiles);
    } else {
        $warning = '이 저장소 ZIP에는 update-manifest.json이 없어 파일 목록을 안전하게 재생성했습니다. 삭제 파일 추적과 사용자 수정 감지는 제한될 수 있습니다.';
        $manifest = array('schema' => T2U_MANIFEST_SCHEMA, 'compatibility' => 't2editor-core-update/1', 'product' => 'T2Editor', 'version' => (string)$version, 'requirements' => array('php_min' => '7.4.0'), 'files' => $stageFiles, 'generated_at' => gmdate('c'));
    }
    if ($checkRequirements) {
        $requirements = isset($manifest['requirements']) && is_array($manifest['requirements']) ? $manifest['requirements'] : array();
        $phpMin = isset($requirements['php_min']) ? (string)$requirements['php_min'] : '7.4.0';
        $phpMax = isset($requirements['php_max']) ? (string)$requirements['php_max'] : '';
        if (version_compare(PHP_VERSION, $phpMin, '<')) throw new RuntimeException('이 업데이트는 PHP ' . $phpMin . ' 이상이 필요합니다.');
        if ($phpMax !== '' && version_compare(PHP_VERSION, $phpMax, '>')) throw new RuntimeException('이 업데이트는 PHP ' . $phpMax . ' 이하에서만 지원됩니다.');
    }
    return array($manifest, $warning);
}

function t2u_load_local_manifest()
{
    global $T2U_STATE_FILE;
    $file = T2EDITOR_PATH . '/update-manifest.json';
    if (is_file($file)) {
        $data = json_decode((string)@file_get_contents($file), true);
        if (is_array($data) && isset($data['files']) && is_array($data['files'])) return $data;
    }
    $state = t2u_read_private($T2U_STATE_FILE, array());
    if (is_array($state) && isset($state['manifest']) && is_array($state['manifest'])) return $state['manifest'];
    return array('schema' => T2U_MANIFEST_SCHEMA, 'version' => t2u_current_version(), 'files' => array());
}

function t2u_text_diff($currentFile, $incomingFile, $displayPath = '')
{
    $pathForExt = $displayPath !== '' ? $displayPath : ($incomingFile ? $incomingFile : $currentFile);
    $allowed = array('php','js','css','json','html','htm','xml','txt','md','blade','yml','yaml','ini','conf');
    $ext = strtolower((string)pathinfo((string)$pathForExt, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) return null;

    $readLines = function ($file) {
        if (!$file || !is_file($file)) return array();
        $size = @filesize($file);
        if ($size === false || $size > 262144) return null;
        $raw = @file_get_contents($file);
        if ($raw === false || strpos(substr($raw, 0, 8192), "\0") !== false) return null;
        $raw = str_replace(array("\r\n", "\r"), "\n", $raw);
        return explode("\n", $raw);
    };
    $old = $readLines($currentFile);
    $new = $readLines($incomingFile);
    if ($old === null || $new === null) return null;

    $oldCount = count($old); $newCount = count($new); $prefix = 0;
    while ($prefix < $oldCount && $prefix < $newCount && $old[$prefix] === $new[$prefix]) $prefix++;
    if ($prefix === $oldCount && $prefix === $newCount) return null;
    $suffix = 0;
    while ($suffix < ($oldCount - $prefix) && $suffix < ($newCount - $prefix) && $old[$oldCount - 1 - $suffix] === $new[$newCount - 1 - $suffix]) $suffix++;

    $lines = array(); $additions = 0; $deletions = 0; $truncated = false;
    $push = function ($type, $oldLine, $newLine, $text) use (&$lines, &$additions, &$deletions) {
        if ($type === 'add') $additions++;
        if ($type === 'delete') $deletions++;
        $lines[] = array('type'=>$type,'old_line'=>$oldLine,'new_line'=>$newLine,'text'=>(string)$text);
    };

    $contextBefore = 3; $contextAfter = 3;
    if ($prefix > $contextBefore) $push('skip', null, null, '… 변경되지 않은 ' . ($prefix - $contextBefore) . '줄 생략 …');
    for ($i = max(0, $prefix - $contextBefore); $i < $prefix; $i++) $push('context', $i + 1, $i + 1, $old[$i]);

    $oldStart = $prefix; $newStart = $prefix;
    $oldLen = $oldCount - $prefix - $suffix; $newLen = $newCount - $prefix - $suffix;
    $oldMid = array_slice($old, $oldStart, $oldLen); $newMid = array_slice($new, $newStart, $newLen);

    if ($oldLen > 0 && $newLen > 0 && ($oldLen * $newLen) <= 40000) {
        $dp = array_fill(0, $oldLen + 1, array_fill(0, $newLen + 1, 0));
        for ($i = $oldLen - 1; $i >= 0; $i--) {
            for ($j = $newLen - 1; $j >= 0; $j--) {
                $dp[$i][$j] = $oldMid[$i] === $newMid[$j] ? $dp[$i + 1][$j + 1] + 1 : max($dp[$i + 1][$j], $dp[$i][$j + 1]);
            }
        }
        $i = 0; $j = 0;
        while ($i < $oldLen && $j < $newLen) {
            if ($oldMid[$i] === $newMid[$j]) { $push('context', $oldStart + $i + 1, $newStart + $j + 1, $oldMid[$i]); $i++; $j++; }
            elseif ($dp[$i + 1][$j] >= $dp[$i][$j + 1]) { $push('delete', $oldStart + $i + 1, null, $oldMid[$i]); $i++; }
            else { $push('add', null, $newStart + $j + 1, $newMid[$j]); $j++; }
        }
        while ($i < $oldLen) { $push('delete', $oldStart + $i + 1, null, $oldMid[$i]); $i++; }
        while ($j < $newLen) { $push('add', null, $newStart + $j + 1, $newMid[$j]); $j++; }
    } else {
        foreach ($oldMid as $i => $text) $push('delete', $oldStart + $i + 1, null, $text);
        foreach ($newMid as $i => $text) $push('add', null, $newStart + $i + 1, $text);
    }

    if ($suffix > $contextAfter) $push('skip', null, null, '… 변경되지 않은 ' . ($suffix - $contextAfter) . '줄 생략 …');
    for ($i = max(0, $suffix - $contextAfter); $i < $suffix; $i++) {
        $oldIndex = $oldCount - $suffix + $i; $newIndex = $newCount - $suffix + $i;
        $push('context', $oldIndex + 1, $newIndex + 1, $old[$oldIndex]);
    }

    if (count($lines) > 620) {
        $lines = array_merge(array_slice($lines, 0, 300), array(array('type'=>'skip','old_line'=>null,'new_line'=>null,'text'=>'… 긴 diff의 중간 부분을 생략했습니다 …')), array_slice($lines, -300));
        $truncated = true;
    }
    return array('first_changed_line'=>$prefix + 1,'additions'=>$additions,'deletions'=>$deletions,'truncated'=>$truncated,'lines'=>$lines);
}

function t2u_build_plan($baselineStage, $baselineManifest, $incomingStage, $incomingManifest, $forceReinstall = false)
{
    $baseline = isset($baselineManifest['files']) && is_array($baselineManifest['files']) ? $baselineManifest['files'] : array();
    $incoming = isset($incomingManifest['files']) && is_array($incomingManifest['files']) ? $incomingManifest['files'] : array();
    $local = t2u_scan_local_installation();
    $paths = array_fill_keys(array_merge(array_keys($baseline), array_keys($incoming), array_keys($local)), true);
    ksort($paths);

    $ops = array();
    $counts = array(
        'user_modified'=>0, 'official_changed'=>0, 'conflict'=>0, 'preserve'=>0,
        'update'=>0, 'add'=>0, 'delete'=>0, 'already_current'=>0, 'unchanged'=>0,
    );

    foreach ($paths as $path => $_unused) {
        if (t2u_protected_path($path)) continue;
        $baseExists = isset($baseline[$path]);
        $incomingExists = isset($incoming[$path]);
        $target = T2EDITOR_PATH . '/' . $path;
        $localExists = isset($local[$path]);
        $baseSha = $baseExists && isset($baseline[$path]['sha256']) ? strtolower((string)$baseline[$path]['sha256']) : '';
        $incomingSha = $incomingExists && isset($incoming[$path]['sha256']) ? strtolower((string)$incoming[$path]['sha256']) : '';
        $localSha = $localExists && isset($local[$path]['sha256']) ? strtolower((string)$local[$path]['sha256']) : '';

        // ① same-version official baseline ↔ local installation
        $userChanged = $baseExists
            ? (!$localExists || $baseSha === '' || !hash_equals($baseSha, $localSha))
            : $localExists;
        // ② same-version official baseline ↔ target official version
        $officialChanged = ($baseExists !== $incomingExists)
            || ($baseExists && $incomingExists && ($baseSha === '' || $incomingSha === '' || !hash_equals($baseSha, $incomingSha)));
        // A same-version reinstall has no official delta. Modified/missing local files
        // are still offered as conflicts so the administrator can restore them.
        if ($forceReinstall && $userChanged && $incomingExists) $officialChanged = true;
        $localMatchesIncoming = ($localExists === $incomingExists)
            && (!$localExists || ($localSha !== '' && $incomingSha !== '' && hash_equals($localSha, $incomingSha)));

        if ($userChanged) $counts['user_modified']++;
        if ($officialChanged) $counts['official_changed']++;

        if ($localMatchesIncoming) {
            if ($officialChanged || $userChanged) $counts['already_current']++;
            else $counts['unchanged']++;
            continue;
        }

        $common = array(
            'path'=>$path,
            'current_sha256'=>$localSha,
            'baseline_sha256'=>$baseSha,
            'incoming_sha256'=>$incomingSha,
            'incoming_size'=>$incomingExists && isset($incoming[$path]['size']) ? (int)$incoming[$path]['size'] : 0,
            'user_modified'=>$userChanged,
            'official_changed'=>$officialChanged,
        );

        if ($userChanged && !$officialChanged) {
            // User-only changes do not overlap an official update and are preserved automatically.
            $counts['preserve']++;
            $op = $common + array('status'=>'preserve','default_action'=>'keep');
            $userDiff = t2u_text_diff($baseExists ? $baselineStage . '/' . $path : null, $localExists ? $target : null, $path);
            if ($userDiff !== null) $op['user_diff'] = $userDiff;
            $ops[] = $op;
            continue;
        }

        if ($userChanged && $officialChanged) {
            $counts['conflict']++;
            if (!$incomingExists) {
                $status = 'conflict_removed';
                $defaultAction = 'keep';
            } elseif (!$localExists) {
                $status = 'conflict_missing';
                $defaultAction = 'keep';
            } else {
                $status = 'conflict';
                $defaultAction = 'keep';
            }
            $op = $common + array('status'=>$status,'default_action'=>$defaultAction);
            $userDiff = t2u_text_diff($baseExists ? $baselineStage . '/' . $path : null, $localExists ? $target : null, $path);
            $updateDiff = t2u_text_diff($baseExists ? $baselineStage . '/' . $path : null, $incomingExists ? $incomingStage . '/' . $path : null, $path);
            if ($userDiff !== null) $op['user_diff'] = $userDiff;
            if ($updateDiff !== null) $op['update_diff'] = $updateDiff;
            $ops[] = $op;
            continue;
        }

        if (!$officialChanged) {
            $counts['unchanged']++;
            continue;
        }

        if (!$incomingExists) {
            $status = 'delete'; $defaultAction = 'delete';
        } elseif (!$baseExists) {
            $status = 'add'; $defaultAction = 'replace';
        } else {
            $status = 'update'; $defaultAction = 'replace';
        }
        $counts[$status]++;
        $op = $common + array('status'=>$status,'default_action'=>$defaultAction);
        $updateDiff = t2u_text_diff($baseExists ? $baselineStage . '/' . $path : null, $incomingExists ? $incomingStage . '/' . $path : null, $path);
        if ($updateDiff !== null) $op['update_diff'] = $updateDiff;
        $ops[] = $op;
    }

    usort($ops, function ($a, $b) {
        $rank = array('conflict'=>0,'conflict_removed'=>1,'conflict_missing'=>2,'preserve'=>3,'update'=>4,'add'=>5,'delete'=>6);
        $ar = isset($rank[$a['status']]) ? $rank[$a['status']] : 9;
        $br = isset($rank[$b['status']]) ? $rank[$b['status']] : 9;
        return $ar === $br ? strcmp($a['path'], $b['path']) : ($ar < $br ? -1 : 1);
    });
    return array($ops, $counts);
}

/**
 * Keeps only files that can actually be installed by this plan. The full
 * target archive is needed for validation/3-way comparison, but retaining
 * unchanged files for up to an hour wastes disk space and makes the apply
 * phase look like a full overwrite even though it is incremental.
 */
function t2u_prune_stage_for_operations($stage, $operations)
{
    $root = rtrim(str_replace('\\', '/', (string)$stage), '/');
    if ($root === '' || !is_dir($root)) throw new RuntimeException('업데이트 임시 디렉터리가 없습니다.');
    $keep = array();
    foreach ((array)$operations as $op) {
        if (!is_array($op) || empty($op['path']) || empty($op['incoming_sha256'])) continue;
        $status = isset($op['status']) ? (string)$op['status'] : '';
        if (in_array($status, array('update','add','conflict','conflict_missing'), true)) {
            $keep[(string)$op['path']] = strtolower((string)$op['incoming_sha256']);
        }
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $info) {
        $full = str_replace('\\', '/', $info->getPathname());
        $relative = ltrim(substr($full, strlen($root)), '/');
        if ($info->isDir()) {
            @rmdir($info->getPathname());
            continue;
        }
        if (!$info->isFile() || $info->isLink() || !isset($keep[$relative])) {
            @unlink($info->getPathname());
        }
    }

    $files = 0; $bytes = 0;
    foreach ($keep as $path => $sha) {
        $file = $root . '/' . $path;
        if (!is_file($file) || !hash_equals($sha, t2u_hash_file($file))) {
            throw new RuntimeException('증분 적용 파일 준비 상태가 올바르지 않습니다: ' . $path);
        }
        $files++;
        $bytes += (int)@filesize($file);
    }
    return array('files'=>$files, 'bytes'=>$bytes);
}

function t2u_plan_file($id)
{
    global $T2U_TMP_DIR;
    if (!preg_match('/^[a-f0-9]{32}$/', (string)$id)) throw new RuntimeException('업데이트 계획 ID가 올바르지 않습니다.');
    return $T2U_TMP_DIR . '/plan-' . $id . '.php';
}

function t2u_cleanup_plans()
{
    global $T2U_TMP_DIR;
    foreach ((array)glob($T2U_TMP_DIR . '/plan-*.php') as $file) {
        $plan = t2u_read_private($file, array());
        if (!is_array($plan) || empty($plan['expires_at']) || (int)$plan['expires_at'] < time()) {
            if (is_array($plan) && !empty($plan['stage'])) t2u_remove_tree((string)$plan['stage']);
            if (is_array($plan) && !empty($plan['archive'])) @unlink((string)$plan['archive']);
            @unlink($file);
        }
    }
    foreach ((array)glob($T2U_TMP_DIR . '/browser-job-*.php') as $file) {
        $job = t2u_read_private($file, array());
        if (!is_array($job) || empty($job['expires_at']) || (int)$job['expires_at'] < time()) {
            t2u_browser_cleanup_job($job);
            @unlink($file);
        }
    }
}

function t2u_backup_header()
{
    return "<?php\n"
        . "if (!defined('T2_CORE_UPDATE_INTERNAL')) { http_response_code(404); header('Cache-Control: no-store'); exit('Not Found'); }\n"
        . "__halt_compiler();\n";
}

function t2u_backup_blob_path($backupRoot, $path)
{
    return rtrim((string)$backupRoot, '/\\') . '/files/' . (string)$path . '.t2bak.php';
}

function t2u_write_backup_blob($source, $target)
{
    t2u_mkdir(dirname($target));
    $tmp = $target . '.tmp-' . bin2hex(random_bytes(6));
    $in = @fopen($source, 'rb');
    $out = @fopen($tmp, 'wb');
    if ($in === false || $out === false) {
        if (is_resource($in)) fclose($in);
        if (is_resource($out)) fclose($out);
        @unlink($tmp);
        throw new RuntimeException('보호된 백업 파일을 만들 수 없습니다.');
    }
    $header = t2u_backup_header();
    if (fwrite($out, $header) !== strlen($header)) {
        fclose($in); fclose($out); @unlink($tmp);
        throw new RuntimeException('백업 보호 헤더를 저장하지 못했습니다.');
    }
    $copied = stream_copy_to_stream($in, $out);
    fclose($in); fclose($out);
    if ($copied === false || !@rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('파일 백업에 실패했습니다: ' . basename($source));
    }
    @chmod($target, 0600);
}

function t2u_restore_backup_blob($blob, $target, $sha)
{
    $in = @fopen($blob, 'rb');
    if ($in === false) throw new RuntimeException('보호된 백업 파일을 열 수 없습니다: ' . basename($target));
    $header = t2u_backup_header();
    $actualHeader = (string)fread($in, strlen($header));
    if (!hash_equals($header, $actualHeader)) {
        fclose($in);
        throw new RuntimeException('백업 보호 헤더가 손상되었습니다: ' . basename($target));
    }
    t2u_mkdir(dirname($target));
    $tmp = dirname($target) . '/.t2restore-' . bin2hex(random_bytes(8));
    $out = @fopen($tmp, 'wb');
    if ($out === false) { fclose($in); throw new RuntimeException('복구 임시 파일을 만들 수 없습니다.'); }
    $copied = stream_copy_to_stream($in, $out, T2U_MAX_FILE_BYTES + 1);
    fclose($in); fclose($out);
    if ($copied === false || $copied > T2U_MAX_FILE_BYTES || !hash_equals(strtolower((string)$sha), t2u_hash_file($tmp))) {
        @unlink($tmp);
        throw new RuntimeException('백업 파일 무결성 검증에 실패했습니다: ' . basename($target));
    }
    @chmod($tmp, 0644);
    if (file_exists($target) && !@unlink($target)) { @unlink($tmp); throw new RuntimeException('복구 대상 파일을 교체할 수 없습니다: ' . $target); }
    if (!@rename($tmp, $target)) { @unlink($tmp); throw new RuntimeException('백업 파일 복구에 실패했습니다: ' . $target); }
}

function t2u_atomic_install($source, $target, $sha)
{
    t2u_mkdir(dirname($target));
    $tmp = dirname($target) . '/.t2update-' . bin2hex(random_bytes(8));
    if (!@copy($source, $tmp)) throw new RuntimeException('업데이트 파일을 준비하지 못했습니다: ' . basename($target));
    if (!hash_equals(strtolower((string)$sha), t2u_hash_file($tmp))) { @unlink($tmp); throw new RuntimeException('교체 직전 파일 해시가 일치하지 않습니다: ' . basename($target)); }
    @chmod($tmp, 0644);
    if (file_exists($target) && !@unlink($target)) { @unlink($tmp); throw new RuntimeException('기존 파일을 교체할 수 없습니다: ' . $target); }
    if (!@rename($tmp, $target)) { @unlink($tmp); throw new RuntimeException('업데이트 파일을 원자적으로 반영하지 못했습니다: ' . $target); }
}

function t2u_write_manifest_file($manifest)
{
    $target = T2EDITOR_PATH . '/update-manifest.json';
    $tmp = dirname($target) . '/.t2manifest-' . bin2hex(random_bytes(8));
    $json = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
    if (!is_string($json) || @file_put_contents($tmp, $json . "\n", LOCK_EX) === false) throw new RuntimeException('업데이트 기준 매니페스트를 저장하지 못했습니다.');
    @chmod($tmp, 0644);
    if (file_exists($target)) @unlink($target);
    if (!@rename($tmp, $target)) { @unlink($tmp); throw new RuntimeException('업데이트 기준 매니페스트를 반영하지 못했습니다.'); }
}

function t2u_backup_list()
{
    global $T2U_BACKUP_DIR;
    $items = array();
    foreach ((array)glob($T2U_BACKUP_DIR . '/*/metadata.php') as $file) {
        $meta = t2u_read_private($file, array());
        if (!is_array($meta) || empty($meta['id'])) continue;
        $items[] = array('id'=>$meta['id'],'from_version'=>isset($meta['from_version'])?$meta['from_version']:'','to_version'=>isset($meta['to_version'])?$meta['to_version']:'','created_at'=>isset($meta['created_at'])?$meta['created_at']:'','complete'=>!empty($meta['complete']),'file_count'=>isset($meta['entries'])&&is_array($meta['entries'])?count($meta['entries']):0);
    }
    usort($items, function ($a,$b) { return strcmp((string)$b['created_at'], (string)$a['created_at']); });
    return array_slice($items, 0, 10);
}

function t2u_prune_backups($keep)
{
    global $T2U_BACKUP_DIR;
    $dirs = array();
    foreach ((array)glob($T2U_BACKUP_DIR . '/*', GLOB_ONLYDIR) as $dir) $dirs[] = $dir;
    usort($dirs, function ($a,$b) { return filemtime($b) <=> filemtime($a); });
    foreach (array_slice($dirs, (int)$keep) as $dir) t2u_remove_tree($dir);
}

function t2u_backup_id_valid($backupId)
{
    return preg_match('/^[0-9]{8}-[0-9]{6}-[a-f0-9]{12}$/', (string)$backupId) === 1;
}

function t2u_clear_backup_state_reference($deletedIds)
{
    global $T2U_STATE_FILE;
    $deletedIds = array_fill_keys(array_map('strval', (array)$deletedIds), true);
    $state = t2u_read_private($T2U_STATE_FILE, array());
    if (!is_array($state) || empty($state['last_backup_id']) || !isset($deletedIds[(string)$state['last_backup_id']])) return;
    unset($state['last_backup_id']);
    $state['backup_history_updated_at'] = gmdate('c');
    t2u_write_private($T2U_STATE_FILE, $state);
}

function t2u_delete_backup($backupId)
{
    global $T2U_BACKUP_DIR;
    if (!t2u_backup_id_valid($backupId)) throw new RuntimeException('백업 ID가 올바르지 않습니다.');
    return t2u_with_lock(function () use ($backupId, $T2U_BACKUP_DIR) {
        $root = rtrim($T2U_BACKUP_DIR, '/\\') . '/' . $backupId;
        if (!is_dir($root) || is_link($root)) throw new RuntimeException('삭제할 직접 설치 백업을 찾을 수 없습니다.');
        t2u_remove_tree($root);
        if (file_exists($root) || is_link($root)) throw new RuntimeException('직접 설치 백업을 완전히 삭제하지 못했습니다. 디렉터리 권한을 확인하세요.');
        t2u_clear_backup_state_reference(array($backupId));
        return array('deleted_backup_id'=>$backupId, 'deleted_count'=>1);
    });
}

function t2u_delete_all_backups()
{
    global $T2U_BACKUP_DIR;
    return t2u_with_lock(function () use ($T2U_BACKUP_DIR) {
        $deleted = array(); $failed = array();
        foreach ((array)glob(rtrim($T2U_BACKUP_DIR, '/\\') . '/*', GLOB_ONLYDIR) as $dir) {
            if (is_link($dir)) continue;
            $id = basename($dir);
            if (!t2u_backup_id_valid($id)) continue;
            t2u_remove_tree($dir);
            if (file_exists($dir) || is_link($dir)) $failed[] = $id;
            else $deleted[] = $id;
        }
        if ($deleted) t2u_clear_backup_state_reference($deleted);
        if ($failed) throw new RuntimeException('일부 직접 설치 백업을 삭제하지 못했습니다: ' . implode(', ', $failed));
        return array('deleted_backup_ids'=>$deleted, 'deleted_count'=>count($deleted));
    });
}

function t2u_with_lock($callback)
{
    global $T2U_LOCK_FILE;
    $fp = @fopen($T2U_LOCK_FILE, 'c+');
    if ($fp === false) throw new RuntimeException('업데이트 잠금 파일을 만들 수 없습니다.');
    if (!flock($fp, LOCK_EX | LOCK_NB)) { fclose($fp); throw new RuntimeException('다른 업데이트 작업이 진행 중입니다.'); }
    try { return call_user_func($callback); }
    finally { flock($fp, LOCK_UN); fclose($fp); }
}

function t2u_apply_plan($plan, $choices)
{
    global $T2U_BACKUP_DIR, $T2U_STATE_FILE, $T2U_ACTIVE_FILE, $T2U_HEALTH_FILE;
    return t2u_with_lock(function () use ($plan, $choices, $T2U_BACKUP_DIR, $T2U_STATE_FILE, $T2U_ACTIVE_FILE, $T2U_HEALTH_FILE) {
        $backupId = gmdate('Ymd-His') . '-' . substr(bin2hex(random_bytes(8)), 0, 12);
        $backupRoot = $T2U_BACKUP_DIR . '/' . $backupId;
        $previousManifest = t2u_load_local_manifest();
        $previousState = t2u_read_private($T2U_STATE_FILE, array());
        $entries = array(); $selected = array();
        $stats = array(
            'candidate_files'=>0, 'changed_files'=>0, 'replaced_files'=>0, 'deleted_files'=>0,
            'kept_files'=>0, 'applied_bytes'=>0,
        );

        foreach ($plan['operations'] as $op) {
            $path = (string)$op['path']; $status = (string)$op['status'];
            $action = isset($choices[$path]) ? (string)$choices[$path] : (string)$op['default_action'];
            if ($status === 'preserve') {
                $action = 'keep';
            } elseif ($status === 'conflict' || $status === 'conflict_missing') {
                if (!in_array($action, array('keep','replace'), true)) $action = 'keep';
            } elseif ($status === 'conflict_removed') {
                if (!in_array($action, array('keep','delete'), true)) $action = 'keep';
            } elseif ($status === 'delete') {
                $action = 'delete';
            } else {
                $action = 'replace';
            }

            if ($action === 'keep') {
                $stats['kept_files']++;
                continue;
            }
            $stats['candidate_files']++;

            $target = T2EDITOR_PATH . '/' . $path;
            $nowHash = t2u_hash_file($target);
            $expectedCurrent = strtolower(isset($op['current_sha256']) ? (string)$op['current_sha256'] : '');
            $incomingSha = strtolower(isset($op['incoming_sha256']) ? (string)$op['incoming_sha256'] : '');

            if (!hash_equals($expectedCurrent, $nowHash)) {
                throw new RuntimeException('계획 생성 후 파일이 변경되었습니다. 다시 검사하세요: ' . $path);
            }

            if ($action === 'replace') {
                $source = rtrim((string)$plan['stage'], '/\\') . '/' . $path;
                if (!is_file($source)) throw new RuntimeException('준비된 증분 업데이트 파일이 없습니다: ' . $path);
                if ($incomingSha === '' || !hash_equals($incomingSha, t2u_hash_file($source))) {
                    throw new RuntimeException('증분 업데이트 파일 무결성 검증에 실패했습니다: ' . $path);
                }
            }

            $existed = is_file($target);
            $selected[] = array('op'=>$op, 'action'=>$action, 'existed'=>$existed, 'before_sha256'=>$nowHash);
            $stats['changed_files']++;
            if ($action === 'delete') $stats['deleted_files']++;
            else {
                $stats['replaced_files']++;
                $stats['applied_bytes'] += isset($op['incoming_size']) ? (int)$op['incoming_size'] : 0;
            }
        }

        try {
            t2u_mkdir($backupRoot . '/files'); @chmod($backupRoot, 0700);
            foreach ($selected as $item) {
                $op = $item['op']; $path = (string)$op['path'];
                if (!empty($item['existed'])) t2u_write_backup_blob(T2EDITOR_PATH . '/' . $path, t2u_backup_blob_path($backupRoot, $path));
                $entries[$path] = array('existed'=>!empty($item['existed']),'action'=>$item['action'],'before_sha256'=>$item['before_sha256']);
            }
            $metadata = array(
                'id'=>$backupId,
                'from_version'=>isset($previousManifest['version'])?$previousManifest['version']:t2u_current_version(),
                'to_version'=>$plan['version'],
                'created_at'=>gmdate('c'),
                'complete'=>false,
                'entries'=>$entries,
                'apply_stats'=>$stats,
                'previous_manifest'=>$previousManifest,
                'previous_state'=>$previousState,
            );
            t2u_write_private($backupRoot . '/metadata.php', $metadata);

            foreach ($selected as $item) {
                $op = $item['op']; $action = $item['action']; $path = (string)$op['path']; $target = T2EDITOR_PATH . '/' . $path;
                if ($action === 'delete') {
                    if (is_file($target) && !@unlink($target)) throw new RuntimeException('삭제할 수 없습니다: ' . $path);
                } else {
                    $source = rtrim((string)$plan['stage'], '/\\') . '/' . $path;
                    t2u_atomic_install($source, $target, (string)$op['incoming_sha256']);
                }
            }
            $manifest = $plan['manifest'];
            $manifest['installed_at'] = gmdate('c');
            $manifest['source_store'] = array('id'=>$plan['store']['id'],'name'=>$plan['store']['name'],'url'=>$plan['store']['url']);
            t2u_write_manifest_file($manifest);
            $state = array(
                'installed_version'=>$plan['version'],
                'updated_at'=>gmdate('c'),
                'mode'=>'direct',
                'operation'=>(string)($plan['operation'] ?? 'update'),
                'store'=>$manifest['source_store'],
                'manifest'=>$manifest,
                'last_backup_id'=>$backupId,
                'last_apply_stats'=>$stats,
            );
            t2u_write_private($T2U_STATE_FILE, $state);
            t2_extend_write_runtime_pointer(array(
                'provider'=>'base','release_id'=>'base','runtime_path'=>T2EDITOR_BASE_PATH,'asset_url'=>T2EDITOR_BASE_URL,
                'status'=>'active','version'=>(string)$plan['version'],'published_at'=>gmdate('c'),
            ));
            if (function_exists('t2_extend_invalidate_runtime_cache')) t2_extend_invalidate_runtime_cache();
            t2u_write_private($T2U_ACTIVE_FILE, array(
                'release_id'=>'base','version'=>(string)$plan['version'],'status'=>'active','activated_at'=>gmdate('c'),'mode'=>'direct',
            ));
            t2u_write_private($T2U_HEALTH_FILE, array(
                'release_id'=>'base','status'=>'active','checked_at'=>gmdate('c'),'mode'=>'direct',
            ));
            $metadata['complete'] = true; $metadata['completed_at'] = gmdate('c');
            t2u_write_private($backupRoot . '/metadata.php', $metadata);
        } catch (Throwable $e) {
            foreach (array_reverse(array_keys($entries)) as $path) {
                $target = T2EDITOR_PATH . '/' . $path; $entry = $entries[$path];
                if (!empty($entry['existed'])) t2u_restore_backup_blob(t2u_backup_blob_path($backupRoot, $path), $target, (string)$entry['before_sha256']);
                elseif (is_file($target)) @unlink($target);
            }
            t2u_write_manifest_file($previousManifest);
            t2u_write_private($T2U_STATE_FILE, $previousState);
            t2u_remove_tree($backupRoot);
            throw $e;
        }
        t2u_prune_backups(3);
        return array(
            'version'=>$plan['version'],
            'backup_id'=>$backupId,
            'changed_files'=>$stats['changed_files'],
            'replaced_files'=>$stats['replaced_files'],
            'deleted_files'=>$stats['deleted_files'],
            'kept_files'=>$stats['kept_files'],
            'applied_bytes'=>$stats['applied_bytes'],
        );
    });
}

function t2u_rollback($backupId)
{
    global $T2U_BACKUP_DIR, $T2U_STATE_FILE;
    if (!t2u_backup_id_valid($backupId)) throw new RuntimeException('백업 ID가 올바르지 않습니다.');
    return t2u_with_lock(function () use ($backupId, $T2U_BACKUP_DIR, $T2U_STATE_FILE) {
        $root = $T2U_BACKUP_DIR . '/' . $backupId;
        $meta = t2u_read_private($root . '/metadata.php', array());
        if (!is_array($meta) || empty($meta['complete']) || !isset($meta['entries']) || !is_array($meta['entries'])) throw new RuntimeException('복구 가능한 백업을 찾을 수 없습니다.');
        foreach ($meta['entries'] as $path => $entry) {
            $safe = t2u_safe_path((string)$path);
            if ($safe === false || $safe !== (string)$path || t2u_protected_path($safe)) throw new RuntimeException('백업에 안전하지 않은 경로가 있습니다.');
            $target = T2EDITOR_PATH . '/' . $safe;
            if (!empty($entry['existed'])) {
                $source = t2u_backup_blob_path($root, $safe);
                if (!is_file($source)) throw new RuntimeException('백업 파일이 없습니다: ' . $safe);
                t2u_restore_backup_blob($source, $target, (string)$entry['before_sha256']);
            } elseif (is_file($target)) @unlink($target);
        }
        $previousManifest = isset($meta['previous_manifest']) && is_array($meta['previous_manifest']) ? $meta['previous_manifest'] : array('schema'=>T2U_MANIFEST_SCHEMA,'version'=>$meta['from_version'],'files'=>array());
        t2u_write_manifest_file($previousManifest);
        t2u_write_private($T2U_STATE_FILE, isset($meta['previous_state']) && is_array($meta['previous_state']) ? $meta['previous_state'] : array());
        return array('restored_version'=>isset($meta['from_version'])?$meta['from_version']:'','backup_id'=>$backupId,'restored_files'=>count($meta['entries']));
    });
}

function t2u_spec()
{
    return array(
        'compatibility' => T2U_STORE_COMPATIBILITY,
        'transport' => 'HTTPS GET/HEAD only; redirects to HTML are rejected',
        'required_actions' => array('latest','list','version','check','download','spec'),
        'required_version_fields' => array('version','files[]'),
        'required_file_fields' => array('name','size_bytes','sha256','available','download_url'),
        'three_way_update' => array(
            'requirement' => 'The selected store must keep both the currently installed version and the target version downloadable.',
            'comparison' => array('official current vs local installation','official current vs official target','manual decision only for overlapping paths'),
        ),
        'archive' => array(
            'format' => 'ZIP',
            'root' => 'auto-detected (t2editor/ or archive root)',
            'rules' => array('no path traversal','no absolute path','no symlink','no encryption','data and admin key files are filtered during installation'),
            'manifest' => array(
                'path' => 't2editor/update-manifest.json',
                'recommended' => true,
                'schema' => T2U_MANIFEST_SCHEMA,
                'compatibility' => 't2editor-core-update/1',
                'required_fields' => array('schema','compatibility','product','version','requirements.php_min','files[path].sha256','files[path].size'),
            ),
        ),
        'security' => array('absolute HTTPS download URL','SHA-256 lowercase 64 hex','exact content length','store content always treated as untrusted'),
        'php_client' => array('minimum'=>'7.4.0','tested_through'=>'8.2','curl_optional'=>true,'ziparchive_optional'=>true),
    );
}

if (defined('T2U_LIBRARY_ONLY') && T2U_LIBRARY_ONLY) return;

if (!t2u_logged_in()) t2u_response(false, null, '관리자 로그인이 필요합니다.', 401);

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string)$_SERVER['REQUEST_METHOD']) : 'GET';
$action = isset($_GET['action']) ? strtolower((string)$_GET['action']) : 'status';
$input = ($method === 'POST' && $action !== 'browser_upload') ? t2u_input() : array();
t2editor_admin_session_unlock();

try {
    t2u_ensure_dirs();
    t2u_cleanup_plans();

    if ($action === 'status' && $method === 'GET') {
        global $T2U_STATE_FILE, $T2U_ACTIVE_FILE;
        $state = t2u_read_private($T2U_STATE_FILE, array());
        $active = t2u_read_private($T2U_ACTIVE_FILE, array());
        t2u_response(true, array(
            'current_version'=>t2u_current_version(),'php_version'=>PHP_VERSION,'bootstrap_abi'=>(defined('T2_EXTEND_BOOTSTRAP_ABI')?(int)T2_EXTEND_BOOTSTRAP_ABI:0),
            'install_mode'=>t2u_install_mode(),'capabilities'=>t2u_capabilities(),'stores'=>t2u_stores(),
            'state'=>$state,'active_release'=>$active,'data_releases'=>t2u_data_release_list(),'backups'=>t2u_backup_list(),
            'store_spec'=>t2u_spec(),'dsclub_api_enabled'=>t2u_dsclub_api_enabled(),'dsclub_telemetry'=>array('enabled'=>t2u_dsclub_api_enabled(),'official_only'=>true,'fields'=>array('T2Editor version','PHP version','platform','pseudonymous install ID')),
        ), '', 200);
    }

    if ($action === 'save_mode' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $core = isset($input['core']) ? (string)$input['core'] : 'data';
        $thirdParty = isset($input['third_party']) ? (string)$input['third_party'] : 'data';
        if ($core === 'data' && !t2u_data_install_supported()) throw new RuntimeException('공용 데이터 설치 경로에 쓰기 권한이 없습니다.');
        if ($core === 'direct' && !is_writable(T2EDITOR_PATH)) throw new RuntimeException('직접 설치를 사용하려면 T2Editor 원본 경로에 쓰기 권한이 필요합니다.');
        t2u_save_install_mode($core, $thirdParty);
        t2u_response(true, t2u_install_mode(), '설치 방식을 저장했습니다. 코어 방식 변경은 다음 업데이트 또는 재설치부터 적용됩니다.', 200);
    }

    if ($action === 'save_stores' && $method === 'POST') {
        global $T2U_STORES_FILE;
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $stores = isset($input['stores']) && is_array($input['stores']) ? $input['stores'] : array();
        $currentStoreSettings = t2u_stores_raw();
        $officialEnabled = array_key_exists('official_enabled', $input)
            ? !empty($input['official_enabled']) : !empty($currentStoreSettings['official_enabled']);
        $clean = array();
        foreach ($stores as $store) {
            if (!is_array($store)) continue;
            $url = trim(isset($store['url']) ? (string)$store['url'] : '');
            if ($url === T2U_DEFAULT_STORE) continue; // official row is not user-managed here
            t2u_endpoint($url);
            $id = preg_replace('/[^A-Za-z0-9._-]/', '-', isset($store['id']) ? (string)$store['id'] : '');
            if ($id === '' || strpos($id, 'certified-') === 0) $id = 'store-' . substr(hash('sha256', $url), 0, 12);
            $clean[] = array('id'=>substr($id,0,80),'name'=>t2u_clean_text(isset($store['name'])?$store['name']:$url,80),'url'=>$url,'enabled'=>!empty($store['enabled']));
            if (count($clean) >= 20) break;
        }
        $certifiedDisabled = array();
        if (isset($input['certified_disabled']) && is_array($input['certified_disabled'])) {
            foreach ($input['certified_disabled'] as $cid) {
                $cid = preg_replace('/[^A-Za-z0-9._-]/', '', (string)$cid);
                if (strpos($cid, 'certified-') === 0 && strlen($cid) <= 80) $certifiedDisabled[] = $cid;
                if (count($certifiedDisabled) >= 40) break;
            }
        }
        t2u_write_private($T2U_STORES_FILE, array('custom' => $clean, 'certified_disabled' => array_values(array_unique($certifiedDisabled)), 'official_enabled' => $officialEnabled));
        t2u_response(true, t2u_stores(), '업데이트 저장소 목록을 저장했습니다.', 200);
    }

    if ($action === 'test_store' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $url = trim(isset($input['url']) ? (string)$input['url'] : '');
        $spec = t2u_http_json(t2u_url_query($url, array('action'=>'spec')));
        $latest = t2u_http_json(t2u_url_query($url, array('action'=>'latest')));
        t2u_response(true, array('api'=>$spec['api'],'store'=>$spec['store'],'latest'=>isset($latest['latest'])?$latest['latest']:null), '호환 가능한 에디터 저장소 API입니다.', 200);
    }

    if ($action === 'check' && $method === 'GET') {
        $store = t2u_store_by_id(isset($_GET['store_id']) ? (string)$_GET['store_id'] : 'dsclub-official');
        $current = t2u_current_version();
        $currentMajor = t2u_version_major($current);
        $result = t2u_http_json(t2u_url_query($store['url'], array('action'=>'check','current'=>$current,'channel'=>'stable')));
        $repositoryLatest = t2u_validate_version_object(isset($result['latest']) ? $result['latest'] : array());
        $recommendedLatest = null;
        $versionListWarning = '';

        // The automatic recommendation deliberately stays within the currently
        // installed major line. A newer major release remains available through
        // the advanced version list, but is never promoted as the default update.
        try {
            $listResult = t2u_http_json(t2u_url_query($store['url'], array('action'=>'list')));
            $rawVersions = isset($listResult['versions']) && is_array($listResult['versions']) ? $listResult['versions'] : array();
            $validVersions = array();
            foreach ($rawVersions as $rawVersion) {
                if (!is_array($rawVersion)) continue;
                try { $validVersions[] = t2u_validate_version_object($rawVersion); } catch (Throwable $e) { continue; }
            }
            $recommendedLatest = t2u_recommended_version_for_current_major($validVersions, $current);
        } catch (Throwable $e) {
            $versionListWarning = '현재 메이저 버전의 전체 릴리스 목록을 확인하지 못했습니다.';
        }

        if ($recommendedLatest === null && ($currentMajor === null || t2u_version_major((string)$repositoryLatest['version']) === $currentMajor)) {
            $recommendedLatest = $repositoryLatest;
        }

        $recommendedCmp = $recommendedLatest === null ? 0 : version_compare((string)$recommendedLatest['version'], $current);
        $status = $recommendedLatest === null ? 'unavailable' : ($recommendedCmp > 0 ? 'update_available' : ($recommendedCmp < 0 ? 'ahead' : 'latest'));
        $repositoryCmp = version_compare((string)$repositoryLatest['version'], $current);
        $majorUpgradeAvailable = $repositoryCmp > 0 && t2u_major_version_mismatch($current, (string)$repositoryLatest['version']);

        t2u_response(true, array(
            'store'=>$store,
            'current_version'=>$current,
            // latest now follows the safe recommendation policy; repository_latest exposes the absolute newest release.
            'latest'=>$recommendedLatest,
            'repository_latest'=>$repositoryLatest,
            'recommended_latest'=>$recommendedLatest,
            'recommendation_scope'=>'current_major',
            'current_major'=>$currentMajor,
            'status'=>$status,
            'update_available'=>$recommendedCmp > 0,
            'repository_update_available'=>$repositoryCmp > 0,
            'major_upgrade_available'=>$majorUpgradeAvailable,
            'version_list_warning'=>$versionListWarning,
        ), '', 200);
    }

    if ($action === 'list' && $method === 'GET') {
        $store = t2u_store_by_id(isset($_GET['store_id']) ? (string)$_GET['store_id'] : 'dsclub-official');
        $result = t2u_http_json(t2u_url_query($store['url'], array('action' => 'list')));
        $rawVersions = isset($result['versions']) && is_array($result['versions']) ? $result['versions'] : array();
        $versions = array(); $current = t2u_current_version();
        foreach ($rawVersions as $v) {
            if (!is_array($v)) continue;
            try { $clean = t2u_validate_version_object($v); } catch (Throwable $e) { continue; }
            $cmp = version_compare((string)$clean['version'], $current);
            $versions[] = array(
                'version' => (string)$clean['version'],
                'title' => isset($clean['title']) ? (string)$clean['title'] : '',
                'release_date' => isset($clean['release_date']) ? (string)$clean['release_date'] : '',
                'size_bytes' => isset($clean['size_bytes']) ? (int)$clean['size_bytes'] : 0,
                'file_count' => isset($clean['file_count']) ? (int)$clean['file_count'] : 0,
                'changes' => isset($clean['changes']) ? (string)$clean['changes'] : '',
                'relation' => $cmp > 0 ? 'newer' : ($cmp < 0 ? 'older' : 'current'),
            );
            if (count($versions) >= 200) break;
        }
        t2u_response(true, array('store' => $store, 'current_version' => $current, 'versions' => $versions), '', 200);
    }

    if ($action === 'browser_archive' && $method === 'GET') {
        t2u_browser_serve_archive(
            isset($_GET['job_id']) ? (string)$_GET['job_id'] : '',
            isset($_GET['role']) ? (string)$_GET['role'] : '',
            isset($_GET['token']) ? (string)$_GET['token'] : ''
        );
    }

    if ($action === 'browser_upload' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $result = t2u_browser_upload_entry(
            isset($_GET['job_id']) ? (string)$_GET['job_id'] : '',
            isset($_GET['role']) ? (string)$_GET['role'] : '',
            isset($_GET['token']) ? (string)$_GET['token'] : '',
            isset($_GET['entry']) ? (int)$_GET['entry'] : -1,
            isset($_GET['offset']) ? (int)$_GET['offset'] : -1
        );
        t2u_response(true, $result, '', 200);
    }

    if ($action === 'browser_finalize' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        list($plan, $message) = t2u_browser_finalize_job(
            isset($input['job_id']) ? (string)$input['job_id'] : '',
            isset($input['token']) ? (string)$input['token'] : ''
        );
        t2u_response(true, $plan, $message, 200);
    }

    if ($action === 'plan' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $store = t2u_store_by_id(isset($input['store_id']) ? (string)$input['store_id'] : 'dsclub-official');
        $versionValue = isset($input['version']) ? trim((string)$input['version']) : '';
        if (!preg_match('/^[0-9A-Za-z][0-9A-Za-z._+\-]{0,63}$/', $versionValue)) throw new RuntimeException('업데이트 버전이 올바르지 않습니다.');
        $operation = isset($input['operation']) && (string)$input['operation'] === 'reinstall' ? 'reinstall' : 'update';
        $index = isset($input['file_index']) ? (int)$input['file_index'] : 0;
        $currentVersion = t2u_current_version();
        $majorVersionMismatch = t2u_major_version_mismatch($currentVersion, $versionValue);
        $majorVersionWarningAck = !empty($input['major_version_warning_ack']);
        if ($majorVersionMismatch && !$majorVersionWarningAck) throw new RuntimeException('현재 T2Editor ' . $currentVersion . '와 설치하려는 버전 ' . $versionValue . '의 메이저 버전이 다릅니다. 관리자 화면에서 호환성 경고를 확인한 뒤 다시 진행하세요.');

        if (t2browser_archive_backend() === 'browser') {
            $fallback = t2u_browser_begin_job($store, $versionValue, $index, $operation, $majorVersionWarningAck);
            if (empty($fallback['browser_fallback_required'])) t2u_response(true, $fallback['plan'], $fallback['message'], 200);
            t2u_response(true, $fallback, '서버에서 DEFLATE ZIP을 해제할 수 없어 관리자 브라우저에서 처리합니다.', 200);
        }

        $id = bin2hex(random_bytes(16));
        $targetPackage = null;
        $baselinePackage = null;
        try {
            $targetPackage = t2u_prepare_version_package($store, $versionValue, $index, '', $id, 'target');
            if (t2u_install_mode()['core'] === 'direct') {
                $currentVersion = t2u_current_version();
                try {
                    $baselinePackage = t2u_prepare_version_package($store, $currentVersion, $index, isset($targetPackage['file']['name']) ? (string)$targetPackage['file']['name'] : '', $id, 'baseline');
                } catch (Throwable $baselineError) {
                    throw new RuntimeException('3-way 비교를 위한 현재 버전 ' . $currentVersion . ' 원본을 저장소에서 가져오지 못했습니다. 현재 버전 배포물을 같은 저장소에 등록한 뒤 다시 시도하세요. 원인: ' . $baselineError->getMessage());
                }
            }
            list($plan, $message) = t2u_finalize_prepared_plan($id, $store, $targetPackage, $baselinePackage, $operation, $majorVersionWarningAck);
            t2u_response(true, $plan, $message, 200);
        } catch (Throwable $e) {
            t2u_cleanup_version_package($baselinePackage);
            t2u_cleanup_version_package($targetPackage);
            throw $e;
        }
    }

    if ($action === 'apply' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $planId = isset($input['plan_id']) ? (string)$input['plan_id'] : '';
        $planFile = t2u_plan_file($planId);
        $plan = t2u_read_private($planFile, array());
        if (!is_array($plan) || empty($plan['expires_at']) || (int)$plan['expires_at'] < time() || !is_dir((string)$plan['stage'])) throw new RuntimeException('업데이트 계획이 만료되었거나 손상되었습니다. 다시 검사하세요.');
        if (!empty($plan['major_version_mismatch']) && empty($plan['major_version_warning_ack'])) throw new RuntimeException('메이저 버전 호환성 경고가 확인되지 않은 업데이트 계획입니다. 대상 버전을 다시 선택해 경고를 확인하세요.');
        $choices = isset($input['choices']) && is_array($input['choices']) ? $input['choices'] : array();
        $result = (isset($plan['install_mode']) && $plan['install_mode'] === 'data') ? t2u_apply_data_plan($plan) : t2u_apply_plan($plan, $choices);
        if (is_dir((string)$plan['stage'])) t2u_remove_tree((string)$plan['stage']);
        if (!empty($plan['archive'])) @unlink((string)$plan['archive']);
        @unlink($planFile);
        $verb = (isset($plan['operation']) && $plan['operation'] === 'reinstall') ? '재설치' : '업데이트';
        $modeLabel = (isset($result['mode']) && $result['mode'] === 'data') ? '공용 데이터 릴리스 슬롯' : 'T2Editor 실제 폴더';
        t2u_response(true, $result, 'T2Editor ' . $result['version'] . ' ' . $verb . '가 완료되었습니다. 적용 위치: ' . $modeLabel . '.', 200);
    }

    if ($action === 'rollback' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $result = t2u_rollback(isset($input['backup_id']) ? (string)$input['backup_id'] : '');
        t2u_response(true, $result, '선택한 업데이트 백업으로 복구했습니다.', 200);
    }

    if ($action === 'delete_backup' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $result = t2u_delete_backup(isset($input['backup_id']) ? (string)$input['backup_id'] : '');
        t2u_response(true, $result, '선택한 직접 설치 백업 내역을 삭제했습니다.', 200);
    }

    if ($action === 'delete_backups' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $result = t2u_delete_all_backups();
        $message = !empty($result['deleted_count']) ? '직접 설치 백업 내역을 모두 삭제했습니다.' : '삭제할 직접 설치 백업 내역이 없습니다.';
        t2u_response(true, $result, $message, 200);
    }

    if ($action === 'rollback_data' && $method === 'POST') {
        if (!t2u_csrf_valid()) t2u_response(false, null, 'CSRF 검증에 실패했습니다.', 419);
        $password = isset($input['password']) ? (string)$input['password'] : '';
        if (!t2u_verify_password($password)) { sleep(1); t2u_response(false, null, '관리자 비밀번호가 올바르지 않습니다.', 403); }
        $result = t2u_rollback_data(isset($input['release_id']) ? (string)$input['release_id'] : '');
        t2u_response(true, $result, '선택한 데이터 릴리스로 전환했습니다. 다음 정상 요청 후 활성 상태가 확정됩니다.', 200);
    }

    t2u_response(false, null, '지원하지 않는 요청입니다.', 404);
} catch (Throwable $e) {
    error_log('T2Editor core updater error: ' . $e->getMessage());
    t2u_response(false, null, $e->getMessage(), 500);
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
