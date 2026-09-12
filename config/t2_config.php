<?php
//Path: T2Editor/config/t2_config.php

/**
 * T2Editor Configuration File
 * T2에디터 설정 파일
 */

require_once __DIR__ . '/t2_storage.php';

// Defense-in-depth: normally config/extend.php already ran this before
// T2EDITOR_PATH existed, but any legacy code path that reaches t2_config.php
// directly still needs Gnuboard5's common.php loaded before the _GNUBOARD_
// check just below can be trusted. Cheap no-op if already bootstrapped.
t2editor_bootstrap_host_cms();

// ── PHP 7.4 호환 폴리필 ──────────────────────────────────────────────────
// str_starts_with() 는 PHP 8.0 에서 추가됐다. PHP 7.4 환경을 지원하기 위해
// 함수가 없을 때만 정의한다. PHP 8.0+ 에서는 네이티브 함수가 그대로 사용된다.
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool
    {
        return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}
if (!function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool
    {
        return $needle === '' || substr($haystack, -strlen($needle)) === $needle;
    }
}
if (!function_exists('str_contains')) {
    function str_contains(string $haystack, string $needle): bool
    {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}
// ─────────────────────────────────────────────────────────────────────────

// ── Gnuboard5 플러그인으로서 유효한 환경인지 검증 ────────────────────────
//
// [FIX] 기존 코드는 _GNUBOARD_ 가 정의됐다는 이유만으로
//        T2EDITOR_PATH 를 G5_PLUGIN_PATH.'/editor/t2editor' 로 하드코딩했다.
//        이는 두 가지 상황에서 잘못된 경로를 만든다:
//
//        ① T2Editor 가 Gnuboard5 표준 경로(/plugin/editor/t2editor)가 아닌
//           다른 위치에 설치된 경우 → T2EDITOR_PATH 가 실재하지 않는 경로
//        ② T2Editor 가 Gnuboard5 와 무관하게 독립(standalone) 설치됐지만
//           디렉토리 깊이가 우연히 맞아 common.php 를 발견한 경우
//           → T2EDITOR_DATA_PATH = G5_DATA_PATH.'/editor' (타 사이트 data 폴더!)
//
//        수정: dirname(__DIR__) 로 이 파일 기준 실제 T2Editor 루트를 계산하고,
//               그 경로가 G5_PLUGIN_PATH 하위인지 realpath 로 검증한다.
//               검증 실패 시 BASIC SYSTEM 으로 폴백한다.
// ─────────────────────────────────────────────────────────────────────────────
// ── Rhymix(라이믹스) 환경 참고 ────────────────────────────────────────────
// image_upload.php / file_upload.php 의 실제 업로드는 Rhymix 파일 모듈로
// 위임되므로(t2editor_rhymix_proxy_upload() 참고) 이 파일의 상수들은 그
// 경로에서는 쓰이지 않는다. Rhymix 는 _GNUBOARD_ 를 정의하지 않으므로
// 아래 로직은 자동으로 BASIC SYSTEM 분기로 폴백되며, __DIR__ 와
// $_SERVER['DOCUMENT_ROOT'] 기준으로 T2EDITOR_PATH/URL/DATA_PATH 를
// 프레임워크 무관하게 계산한다 — 별도 Rhymix 전용 분기가 필요 없다.
$_t2_use_gnuboard = false;

if (defined('_GNUBOARD_') && !defined('T2EDITOR_PATH')) {
    // __DIR__ = T2Editor/config/ → dirname = T2Editor 루트
    $_t2_actual_root  = realpath(dirname(__DIR__));
    $_t2_g5_plugin    = realpath(G5_PLUGIN_PATH);

    if ($_t2_actual_root !== false && $_t2_g5_plugin !== false) {
        // 경로 구분자 통일 후 "하위 경로" 여부 확인
        // 끝에 '/' 를 붙여 부분 일치(예: /plugin2 가 /plugin 의 하위로 오인) 방지
        $_t2_use_gnuboard = str_starts_with(
            str_replace('\\', '/', $_t2_actual_root) . '/',
            str_replace('\\', '/', $_t2_g5_plugin)   . '/'
        );
    }
}

if ($_t2_use_gnuboard) {
    // ── GNUBOARD5 SYSTEM ──────────────────────────────────────────────────
    //
    // [FIX] G5_PLUGIN_URL 기준 URL 을 실제 설치 경로로 동적 계산한다.
    //        기존: G5_PLUGIN_URL . '/editor/t2editor' (하드코딩)
    //        수정: G5_PLUGIN_PATH 와 실제 루트의 차이를 suffix 로 추출
    //
    $_t2_relative = substr(
        str_replace('\\', '/', $_t2_actual_root),
        strlen(rtrim(str_replace('\\', '/', $_t2_g5_plugin), '/'))
    );

    define('T2EDITOR_PATH',            $_t2_actual_root);
    define('T2EDITOR_URL',             G5_PLUGIN_URL . $_t2_relative);
    define('T2EDITOR_DATA_PATH',       G5_DATA_PATH  . '/editor');
    define('T2EDITOR_DATA_URL',        G5_DATA_URL   . '/editor');
    define('T2EDITOR_DIR_PERMISSION',  G5_DIR_PERMISSION);
    define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);

    unset($_t2_actual_root, $_t2_g5_plugin, $_t2_relative, $_t2_use_gnuboard);

} else {
    // ── BASIC SYSTEM (타 환경 또는 G5_PLUGIN_PATH 검증 실패) ─────────────
    //
    // _GNUBOARD_ 가 정의됐더라도 T2Editor 가 G5_PLUGIN_PATH 하위에 없으면
    // 이 브랜치로 폴백하여 독립(standalone) 경로 계산을 수행한다.
    //
    unset($_t2_actual_root, $_t2_g5_plugin, $_t2_use_gnuboard);

    if (!defined('T2EDITOR_PATH')) {
        // config 폴더의 상위 폴더(T2Editor 루트)를 기준으로 설정
        $base_dir = dirname(__DIR__);
        $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";

        // ── [SEC-HOST-HEADER-INJECTION] HTTP_HOST 검증 ────────────────────────
        // $_SERVER['HTTP_HOST'] 는 클라이언트가 임의로 조작할 수 있다.
        // 미검증 상태로 URL에 삽입하면 비밀번호 재설정 링크, 캐시 포이즈닝,
        // 내부 URL 생성 오류 등 다양한 공격 벡터가 된다.
        // 허용 형식: hostname[:port] — 문자, 숫자, 점, 하이픈, 대괄호(IPv6), 콜론
        $raw_host = $_SERVER['HTTP_HOST'] ?? '';
        if ($raw_host === '' || !preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $raw_host)) {
            $raw_host = 'localhost'; // 잘못된 호스트 헤더 폴백
        }
        $host = $raw_host;

        // 웹 경로 계산 — realpath로 심볼릭 링크·OS 경로 구분자 문제 해소
        $real_base    = realpath($base_dir);
        $real_docroot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');

        if ($real_base !== false && $real_docroot !== false) {
            // 양쪽 모두 구분자를 슬래시로 통일 후 비교
            $real_base    = rtrim(str_replace('\\', '/', $real_base), '/');
            $real_docroot = rtrim(str_replace('\\', '/', $real_docroot), '/');

            if (str_starts_with($real_base, $real_docroot)) {
                // DOCUMENT_ROOT 아래에 있는 정상 케이스
                $relative_path = substr($real_base, strlen($real_docroot));
            } else {
                // DOCUMENT_ROOT 밖(심볼릭 링크 대상 등) — fallback: 원본 경로로 재시도
                $raw_base    = rtrim(str_replace('\\', '/', $base_dir), '/');
                $raw_docroot = rtrim(str_replace('\\', '/', rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/\\')), '/');
                $relative_path = str_starts_with($raw_base, $raw_docroot)
                    ? substr($raw_base, strlen($raw_docroot))
                    : '';
            }
        } else {
            // realpath 실패 시 원본 str_replace 방식으로 fallback
            $document_root = rtrim(str_replace('\\', '/', $_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
            $relative_path = str_replace('\\', '/', str_replace($document_root, '', $base_dir));
        }

        // 슬래시로 시작하도록 보정
        if ($relative_path !== '' && $relative_path[0] !== '/') {
            $relative_path = '/' . $relative_path;
        }

        define('T2EDITOR_PATH',            $base_dir);
        define('T2EDITOR_URL',             $protocol . $host . $relative_path);
        define('T2EDITOR_DATA_PATH',       T2EDITOR_PATH . '/data');
        define('T2EDITOR_DATA_URL',        T2EDITOR_URL  . '/data');
        define('T2EDITOR_DIR_PERMISSION',  0755);
        define('T2EDITOR_FILE_PERMISSION', 0644);
    }
}

// 미디어 업로드는 기존 공용 데이터 루트에 유지하고, 그 외 가변 상태는
// t2editor_db 하위에 격리한다. 이 구분은 Gnuboard/Rhymix의 CMS 데이터
// 디렉터리에 T2Editor 관리 파일이 흩어지는 것을 방지한다.
if (!is_dir(T2EDITOR_DATA_PATH)) {
    @mkdir(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION, true);
    @chmod(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION);
}
if (!defined('T2EDITOR_DB_PATH')) {
    define('T2EDITOR_DB_PATH', rtrim(T2EDITOR_DATA_PATH, '/\\') . '/t2editor_db');
}
if (!defined('T2EDITOR_DB_URL')) {
    define('T2EDITOR_DB_URL', rtrim(T2EDITOR_DATA_URL, '/') . '/t2editor_db');
}
if (!defined('T2EDITOR_LEGACY_PRIVATE_PATH')) {
    define('T2EDITOR_LEGACY_PRIVATE_PATH', rtrim(T2EDITOR_DATA_PATH, '/\\') . '/t2admin-private');
}
t2editor_storage_prepare(T2EDITOR_PATH, T2EDITOR_DATA_PATH, T2EDITOR_DB_PATH, defined('T2EDITOR_PRIVATE_PATH') ? T2EDITOR_PRIVATE_PATH : T2EDITOR_DB_PATH . '/t2admin-private');

// 협업 플러그인도 격리된 T2Editor DB 루트 아래에서 상태를 관리한다.
// 이전 버전의 <T2Editor>/collab 폴더가 있으면 최초 실행 시 새 위치로 이전한다.
if (!defined('T2EDITOR_COLLAB_PATH')) {
    define('T2EDITOR_COLLAB_PATH', rtrim(T2EDITOR_DB_PATH, '/\\') . '/collab');
}

if (!function_exists('t2editor_migrate_collab_tree')) {
    /**
     * 구버전 협업 데이터 트리를 공통 데이터 디렉터리로 충돌 없이 병합한다.
     * 같은 이름의 새 파일이 이미 있으면 새 파일을 보존하고 구버전 파일은 남겨 둔다.
     */
    function t2editor_migrate_collab_tree(string $source, string $target): void
    {
        if (!is_dir($source)) return;
        if (!is_dir($target)) {
            @mkdir($target, 0750, true);
            @chmod($target, 0750);
        }
        $entries = @scandir($source);
        if (!is_array($entries)) return;
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $from = rtrim($source, '/\\') . '/' . $entry;
            $to   = rtrim($target, '/\\') . '/' . $entry;
            if (is_dir($from) && !is_link($from)) {
                t2editor_migrate_collab_tree($from, $to);
                @rmdir($from);
                continue;
            }
            if (!file_exists($to) && !is_link($from)) {
                @rename($from, $to);
            }
        }
        @rmdir($source);
    }
}

$_t2_collab_legacy_path = rtrim(T2EDITOR_PATH, '/\\') . '/collab';
$_t2_collab_same_path = str_replace('\\', '/', rtrim($_t2_collab_legacy_path, '/\\'))
    === str_replace('\\', '/', rtrim(T2EDITOR_COLLAB_PATH, '/\\'));
if (!$_t2_collab_same_path && is_dir($_t2_collab_legacy_path) && !is_link($_t2_collab_legacy_path)) {
    // 같은 파일시스템이면 디렉터리 자체 이동을 먼저 시도하고, 실패하거나 새 폴더가
    // 이미 존재하면 재귀 병합으로 폴백한다.
    if (!is_dir(T2EDITOR_COLLAB_PATH)) @rename($_t2_collab_legacy_path, T2EDITOR_COLLAB_PATH);
    if (is_dir($_t2_collab_legacy_path)) {
        t2editor_migrate_collab_tree($_t2_collab_legacy_path, T2EDITOR_COLLAB_PATH);
    }
}
if (!is_dir(T2EDITOR_COLLAB_PATH)) {
    @mkdir(T2EDITOR_COLLAB_PATH, 0750, true);
}
@chmod(T2EDITOR_COLLAB_PATH, 0750);
unset($_t2_collab_legacy_path, $_t2_collab_same_path);

// 협업 데이터에는 방 토큰과 문서 상태가 포함될 수 있으므로 웹 직접 접근을 차단한다.
foreach (array(T2EDITOR_COLLAB_PATH . '/index.php', T2EDITOR_COLLAB_PATH . '/.htaccess') as $_t2_collab_guard) {
    if (file_exists($_t2_collab_guard)) continue;
    if (substr($_t2_collab_guard, -4) === '.php') {
        @file_put_contents($_t2_collab_guard, "<?php\nhttp_response_code(404);\nheader('Cache-Control: no-store');\nexit('Not Found');\n", LOCK_EX);
    } else {
        @file_put_contents($_t2_collab_guard, "Require all denied\nDeny from all\n", LOCK_EX);
    }
}
unset($_t2_collab_guard);

// 관리자 인증·서드파티 설치 기록·비공개 설정은 격리된 DB 디렉터리에 저장한다.
// 기본 위치는 <공용 데이터>/t2editor_db/t2admin-private 이다.
if (!defined('T2EDITOR_PRIVATE_PATH')) {
    define('T2EDITOR_PRIVATE_PATH', rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2admin-private');
}
if (!is_dir(T2EDITOR_PRIVATE_PATH)) {
    @mkdir(T2EDITOR_PRIVATE_PATH, 0700, true);
}
@chmod(T2EDITOR_PRIVATE_PATH, 0700);

// 관리자 비밀번호 해시와 마켓 설정은 직접 요청 시 404를 반환하는 PHP 저장 파일로 보관한다.
require_once __DIR__ . '/t2_private_store.php';
t2editor_storage_rewrite_runtime_state(T2EDITOR_DATA_PATH, T2EDITOR_DATA_URL, T2EDITOR_DB_PATH, T2EDITOR_DB_URL, T2EDITOR_PRIVATE_PATH);
$_t2_private_map = array(
    'admin_auth.php' => array('admin_auth.json', 'json'),
    'admin_settings.php' => array('admin_settings.json', 'json'),
    'third_party_markets.php' => array('third_party_markets.json', 'json'),
    'third_party_installed.php' => array('third_party_installed.json', 'json'),
    'third_party_client.php' => array('third_party_client.key', 'text'),
);
foreach ($_t2_private_map as $_t2_secure_name => $_t2_legacy) {
    $_t2_target = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/' . $_t2_secure_name;
    $_t2_sources = array(
        rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/' . $_t2_legacy[0],
        rtrim(T2EDITOR_DB_PATH, '/\\') . '/' . $_t2_legacy[0],
        rtrim(T2EDITOR_DATA_PATH, '/\\') . '/' . $_t2_legacy[0],
    );
    t2_private_store_import_legacy($_t2_target, $_t2_sources, $_t2_legacy[1]);
}
unset($_t2_private_map, $_t2_secure_name, $_t2_legacy, $_t2_target, $_t2_sources);
foreach (array('third_party_tmp', 'third_party_backups') as $_t2_private_name) {
    $_t2_new = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/' . $_t2_private_name;
    foreach (array(T2EDITOR_DB_PATH, T2EDITOR_DATA_PATH) as $_t2_old_root) {
        $_t2_old = rtrim($_t2_old_root, '/\\') . '/' . $_t2_private_name;
        if (is_dir($_t2_old) && !file_exists($_t2_new)) @rename($_t2_old, $_t2_new);
    }
}
unset($_t2_private_name, $_t2_old_root, $_t2_old, $_t2_new);

foreach (array(T2EDITOR_PRIVATE_PATH . '/index.php', T2EDITOR_PRIVATE_PATH . '/.htaccess') as $_t2_private_guard) {
    if (file_exists($_t2_private_guard)) continue;
    if (substr($_t2_private_guard, -4) === '.php') {
        @file_put_contents($_t2_private_guard, "<?php\nhttp_response_code(404);\nheader('Cache-Control: no-store');\nexit('Not Found');\n", LOCK_EX);
    } else {
        @file_put_contents($_t2_private_guard, "Require all denied\nDeny from all\n", LOCK_EX);
    }
}
unset($_t2_private_guard);

// ════════════════════════════════════════════════════════════════════════════
// 허용 URL 도메인 설정
// ════════════════════════════════════════════════════════════════════════════
//
// 비디오 뷰어, 미디어 플러그인 등에서 외부 URL 허용 여부를 판단할 때
// 공통으로 사용하는 도메인 허용 목록입니다.
//
// ★ 현재 서버 도메인은 자동으로 항상 허용됩니다. 여기에 추가할 필요 없습니다.
//
// 추가 허용이 필요한 도메인(CDN, 다른 서브도메인, 미디어 전용 서버 등)을
// 배열에 추가하세요. 포트 없이 도메인/호스트명만 입력합니다.
//
// 사용 예:
//   define('T2EDITOR_ALLOWED_URL_DOMAINS', [
//       'cdn.example.com',
//       'media.example.com',
//       'static.my-site.co.kr',
//   ]);
//
// 이후 개발하는 모든 플러그인은 아래 t2editor_is_allowed_url() 함수 하나로
// 이 설정을 그대로 활용할 수 있습니다.
// ─────────────────────────────────────────────────────────────────────────────
if (!defined('T2EDITOR_ALLOWED_URL_DOMAINS')) {
    define('T2EDITOR_ALLOWED_URL_DOMAINS', [
        // 추가 허용 도메인을 여기에 입력하세요 (현재 서버 도메인은 자동 추가됨)
        // 'cdn.example.com',
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// [공통 함수] t2editor_get_allowed_domains()
//
// 현재 서버 도메인 + T2EDITOR_ALLOWED_URL_DOMAINS 설정값을 합산해 반환한다.
// 정적 캐시를 사용하므로 한 요청 내에서 여러 번 호출해도 연산은 1회만 수행.
//
// 반환값: string[] — 허용된 도메인 목록 (모두 소문자, 포트 없음)
//
// 이후 개발하는 모든 플러그인은 이 함수로 허용 도메인 목록을 가져올 수 있다.
// ─────────────────────────────────────────────────────────────────────────────
if (!function_exists('t2editor_get_allowed_domains')) {
    function t2editor_get_allowed_domains(): array
    {
        static $cached = null;
        if ($cached !== null) {
            return $cached;
        }

        // HTTP_HOST injection 방지: t2_config.php 상단의 검증 로직과 동일한 규칙
        $raw_host = $_SERVER['HTTP_HOST'] ?? '';
        if ($raw_host === '' || !preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $raw_host)) {
            $raw_host = 'localhost';
        }
        // 포트 제거 → 순수 도메인/호스트명만 추출
        $server_domain = strtolower(explode(':', $raw_host)[0]);

        // 서버 자신의 도메인은 항상 허용
        $domains = [$server_domain];

        // 관리자가 설정한 추가 허용 도메인 병합
        if (is_array(T2EDITOR_ALLOWED_URL_DOMAINS)) {
            foreach (T2EDITOR_ALLOWED_URL_DOMAINS as $domain) {
                if (is_string($domain) && trim($domain) !== '') {
                    $domains[] = strtolower(trim($domain));
                }
            }
        }

        $cached = array_unique($domains);
        return $cached;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// [공통 함수] t2editor_is_allowed_url()
//
// 주어진 URL이 T2에디터에서 허용된 출처인지 확인한다.
//
// 판단 기준:
//   - 빈 문자열       → false (무효한 URL)
//   - 상대 경로       → true  (경로 탈출 검증은 호출자 담당)
//   - 절대 http(s) URL → 도메인이 허용 목록에 있으면 true
//   - 프로토콜 상대 URL (//host/...) → 위와 동일하게 도메인 비교
//
// 이후 개발하는 모든 플러그인에서 외부 URL 허용 판단에 이 함수를 사용한다.
//
// @param string $url 검사할 URL
// @return bool       허용 여부
// ─────────────────────────────────────────────────────────────────────────────
if (!function_exists('t2editor_is_allowed_url')) {
    function t2editor_is_allowed_url(string $url): bool
    {
        if ($url === '') {
            return false;
        }

        // 상대 경로 (http:// 또는 // 없음) → 항상 허용
        // 경로 탈출(path traversal) 방지는 호출자(video_view.php 등)가 담당한다.
        if (!preg_match('#^(https?:)?//#i', $url)) {
            return true;
        }

        // 절대 URL / 프로토콜 상대 URL → 도메인 비교
        $parsed = parse_url($url);
        if ($parsed === false || empty($parsed['host'])) {
            return false;
        }

        // parse_url 이 host 에 포트를 포함할 수 있으므로 분리
        $host = strtolower(explode(':', $parsed['host'])[0]);
        if ($host === '') {
            return false;
        }

        return in_array($host, t2editor_get_allowed_domains(), true);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// 허용 iframe 도메인 설정
// ════════════════════════════════════════════════════════════════════════════
if (!defined('T2EDITOR_ALLOWED_IFRAME_DOMAINS')) {
    define('T2EDITOR_ALLOWED_IFRAME_DOMAINS', [
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
    ]);
}

if (!function_exists('t2editor_get_allowed_iframe_domains')) {
    function t2editor_get_allowed_iframe_domains(): array
    {
        $domains = [];

        if (function_exists('t2editor_get_allowed_domains')) {
            $domains = array_merge($domains, t2editor_get_allowed_domains());
        }

        if (is_array(T2EDITOR_ALLOWED_IFRAME_DOMAINS)) {
            foreach (T2EDITOR_ALLOWED_IFRAME_DOMAINS as $domain) {
                if (is_string($domain) && trim($domain) !== '') {
                    $domains[] = strtolower(trim($domain));
                }
            }
        }

        if (is_array(T2EDITOR_ALLOWED_URL_DOMAINS)) {
            foreach (T2EDITOR_ALLOWED_URL_DOMAINS as $domain) {
                if (is_string($domain) && trim($domain) !== '') {
                    $domains[] = strtolower(trim($domain));
                }
            }
        }

        return array_values(array_unique($domains));
    }
}

// ════════════════════════════════════════════════════════════════════════
// [I18N] 자동 언어팩 로더
// ───────────────────────────────────────────────────────────────────────
// 신규 코어 언어는 locales/<locale>.json으로 등록합니다.
// 플러그인 번역은 plugin/<plugin>/locales/<locale>.json에 두며,
// /extend 번역은 extend/locales/<locale>.json에 둡니다.
// 플러그인/확장 번역 파일은 선택 사항이며 누락·손상되어도 로딩과 실행을
// 중단하지 않습니다. 자세한 규격은 locales/README.txt와
// plugin/README_LOCALES.txt를 참고하세요.
// ════════════════════════════════════════════════════════════════════════
if (!defined('T2EDITOR_I18N_ENABLED')) define('T2EDITOR_I18N_ENABLED', true);
if (!defined('T2EDITOR_I18N_LOCALES_PATH')) define('T2EDITOR_I18N_LOCALES_PATH', T2EDITOR_PATH . '/locales');
if (!defined('T2EDITOR_I18N_POLYFILL_URL')) define('T2EDITOR_I18N_POLYFILL_URL', (defined('T2EDITOR_ASSET_URL') ? T2EDITOR_ASSET_URL : T2EDITOR_URL) . '/vendor/formatjs/t2i18n-polyfill.js');

require_once __DIR__ . '/t2_i18n_loader.php';
