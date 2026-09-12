<?php
//Path: T2Editor/config/t2_config.php

/**
 * T2Editor Configuration File
 * T2에디터 설정 파일
 */

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

// 데이터 디렉토리 생성
if (!is_dir(T2EDITOR_DATA_PATH)) {
    @mkdir(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION, true);
    @chmod(T2EDITOR_DATA_PATH, T2EDITOR_DIR_PERMISSION);
}

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
// [I18N] 다국어(i18n) 설정 — T2Editor 10.2.1-beta2+
// ───────────────────────────────────────────────────────────────────────
// 자체 호스팅 방식 (CDN 의존성 없음)
// 지원 언어: ko(한국어), en(영어), ja(일본어), zh(중국어 간체)
// 구형 브라우저는 vendor/formatjs/ 폴리필이 자동 로드됨
// ════════════════════════════════════════════════════════════════════════

// i18n 기능 활성화 여부 (false면 번역버튼 숨김, 모든 메시지 한국어 원본 그대로)
if (!defined('T2EDITOR_I18N_ENABLED')) define('T2EDITOR_I18N_ENABLED', true);

// 기본 언어 (지원 언어 중 사용자 언어를 찾지 못했을 때의 폴백)
// 요구사항: "유저의 언어가 지원하는 언어 중 일치하는 언어가 있으면 그 언어로,
//           없으면 영어로 보여줌" → 기본값은 'en' 권장
if (!defined('T2EDITOR_I18N_DEFAULT_LANG')) define('T2EDITOR_I18N_DEFAULT_LANG', 'en');

// 지원 언어 목록 (한국어-영어-일본어-중국어)
if (!defined('T2EDITOR_I18N_SUPPORTED_LANGS')) define('T2EDITOR_I18N_SUPPORTED_LANGS', ['ko', 'en', 'ja', 'zh']);

// 표시명 (UI 언어 선택 메뉴용) — 코드 => [native name, english name]
if (!defined('T2EDITOR_I18N_LANG_DISPLAY')) define('T2EDITOR_I18N_LANG_DISPLAY', [
    'ko' => ['한국어', 'Korean'],
    'en' => ['English', 'English'],
    'ja' => ['日本語', 'Japanese'],
    'zh' => ['中文', 'Chinese'],
]);

// locales 디렉토리 경로 (자체 호스팅 번역 JSON 파일 위치)
if (!defined('T2EDITOR_I18N_LOCALES_PATH')) define('T2EDITOR_I18N_LOCALES_PATH', T2EDITOR_PATH . '/locales');

// FormatJS 폴리필 자체 호스팅 경로 (구형 브라우저용)
if (!defined('T2EDITOR_I18N_POLYFILL_URL')) define('T2EDITOR_I18N_POLYFILL_URL', T2EDITOR_URL . '/vendor/formatjs');

/**
 * 사용자 언어 감지 (PHP 측 1차 감지 — JS가 2차로 navigator.language 검증)
 *
 * 감지 우선순위:
 *   1. 쿠키 t2editor_lang (사용자 명시적 선택)
 *   2. Accept-Language 헤더 (q-value 기반 파싱)
 *   3. T2EDITOR_I18N_DEFAULT_LANG 상수
 *
 * @return string 'ko' | 'en' | 'ja' | 'zh'
 */
if (!function_exists('t2editor_detect_user_lang')) {
    function t2editor_detect_user_lang(): string {
        $supported = defined('T2EDITOR_I18N_SUPPORTED_LANGS') && is_array(T2EDITOR_I18N_SUPPORTED_LANGS)
            ? T2EDITOR_I18N_SUPPORTED_LANGS
            : ['ko', 'en', 'ja', 'zh'];
        $default = defined('T2EDITOR_I18N_DEFAULT_LANG') && in_array(T2EDITOR_I18N_DEFAULT_LANG, $supported, true)
            ? T2EDITOR_I18N_DEFAULT_LANG
            : 'en';

        // 1순위: 쿠키 (사용자가 번역 버튼으로 명시적으로 선택한 언어)
        if (!empty($_COOKIE['t2editor_lang'])) {
            $cookie = strtolower(trim($_COOKIE['t2editor_lang']));
            // 2자리 언어코드만 추출 (ko-KR → ko)
            if (preg_match('/^([a-z]{2})/i', $cookie, $m)) {
                $lang = strtolower($m[1]);
                if (in_array($lang, $supported, true)) return $lang;
            }
        }

        // 2순위: Accept-Language 헤더
        $accept = $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '';
        if ($accept !== '' && function_exists('t2editor_parse_accept_language')) {
            $detected = t2editor_parse_accept_language($accept, $supported);
            if ($detected !== null) return $detected;
        }

        // 3순위: 기본 언어
        return $default;
    }
}

/**
 * Accept-Language 헤더 파싱 — q-value 기반으로 지원 언어 중 최우선 언어 반환
 *
 * @param string $accept HTTP Accept-Language 헤더값
 * @param array $supported 지원 언어 배열 ['ko','en','ja','zh']
 * @return string|null 일치하는 언어코드 또는 null
 */
if (!function_exists('t2editor_parse_accept_language')) {
    function t2editor_parse_accept_language(string $accept, array $supported): ?string {
        // 예: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6"
        // 쉼표로 분리 후 q-value 추출
        $parts = explode(',', $accept);
        $candidates = []; // [lang => q]

        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '') continue;

            // "ko-KR;q=0.9" 형식 분리
            $segments = explode(';', $part);
            $langSpec = trim($segments[0]);
            if ($langSpec === '') continue;

            // 2자리 언어코드 추출 (ko-KR → ko, en-US → en)
            if (!preg_match('/^([a-zA-Z]{2})/i', $langSpec, $m)) continue;
            $lang = strtolower($m[1]);

            // q-value 파싱 (기본 1.0)
            $q = 1.0;
            for ($i = 1; $i < count($segments); $i++) {
                $seg = trim($segments[$i]);
                if (preg_match('/^q\s*=\s*([0-9.]+)$/i', $seg, $qm)) {
                    $q = (float)$qm[1];
                    break;
                }
            }

            if (in_array($lang, $supported, true)) {
                // 같은 언어가 여러 번 나오면 더 높은 q-value 채택
                if (!isset($candidates[$lang]) || $q > $candidates[$lang]) {
                    $candidates[$lang] = $q;
                }
            }
        }

        if (empty($candidates)) return null;

        // q-value 내림차순 정렬
        arsort($candidates);
        return (string)array_key_first($candidates);
    }
}

/**
 * 지정된 언어의 번역 메시지 카탈로그 로드
 *
 * 자체 호스팅 locales/{lang}.json 파일을 읽어 배열로 반환.
 * 파일이 없거나 파싱 실패 시 빈 배열 반환 (JS 측에서 폴백 처리).
 *
 * @param string $lang 언어코드 (ko|en|ja|zh)
 * @return array [key => message] 형태의 연관배열
 */
if (!function_exists('t2editor_get_messages')) {
    function t2editor_get_messages(string $lang = ''): array {
        static $cache = [];

        $supported = defined('T2EDITOR_I18N_SUPPORTED_LANGS') && is_array(T2EDITOR_I18N_SUPPORTED_LANGS)
            ? T2EDITOR_I18N_SUPPORTED_LANGS
            : ['ko', 'en', 'ja', 'zh'];

        // 잘못된 언어코드 폴백
        if (!in_array($lang, $supported, true)) {
            $lang = defined('T2EDITOR_I18N_DEFAULT_LANG') ? T2EDITOR_I18N_DEFAULT_LANG : 'en';
        }

        if (isset($cache[$lang])) return $cache[$lang];

        $localesPath = defined('T2EDITOR_I18N_LOCALES_PATH')
            ? T2EDITOR_I18N_LOCALES_PATH
            : T2EDITOR_PATH . '/locales';

        $filePath = $localesPath . '/' . $lang . '.json';

        if (!file_exists($filePath)) {
            $cache[$lang] = [];
            return [];
        }

        $raw = @file_get_contents($filePath);
        if ($raw === false) {
            $cache[$lang] = [];
            return [];
        }

        $decoded = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            $cache[$lang] = [];
            return [];
        }

        // 플랫 구조 허용: {"key": "value"} 또는 {"section": {"key": "value"}}
        // JS에서 점(.)으로 접근 가능하도록 평탄화 (section.key => value)
        $flattened = [];
        $flatten = function($arr, $prefix = '') use (&$flatten, &$flattened) {
            foreach ($arr as $k => $v) {
                $key = $prefix === '' ? $k : $prefix . '.' . $k;
                if (is_array($v) && !isset($v[0])) {
                    // 연관배열만 재귀 (숫자인덱스는 값으로 처리)
                    $flatten($v, $key);
                } elseif (is_array($v)) {
                    // [BUG-FIX] 숫자 인덱스 배열(리스트, 예: collab.nickname_adjs)은
                    // 값 자체로 보존해야 한다. 기존 코드는 아래 else 분기로 떨어져
                    // (string)$v 를 실행했는데, PHP에서 배열을 문자열로 캐스팅하면
                    // 내용이 아니라 리터럴 문자열 "Array" 가 되고 E_WARNING
                    // "Array to string conversion" 이 발생한다.
                    // js/i18n.js 의 t() 는 이 키에 대해 "msg 가 배열/객체인 경우"를
                    // 명시적으로 분기 처리하도록 이미 설계되어 있었으므로(주석 참조),
                    // 원래 의도는 배열을 그대로 JSON 배열로 클라이언트에 전달하는
                    // 것이었다. 이 버그로 인해 실제로는 모든 언어에서 항상
                    // T2Utils.tf() 의 하드코딩된 영어 폴백(['Swift','Happy',...])이
                    // 조용히 사용되고 있었다 — 한국어/일본어/중국어 협업 닉네임이
                    // 한 번도 로컬라이즈되지 않았던 원인.
                    $flattened[$key] = $v;
                } else {
                    $flattened[$key] = is_string($v) ? $v : (string)$v;
                }
            }
        };
        $flatten($decoded);
        $cache[$lang] = $flattened;
        return $flattened;
    }
}

/**
 * 모든 지원 언어를 JS에 주입할 수 있도록 한 번에 로드
 * (언어 전환 시 추가 fetch 없이 즉시 전환 가능)
 *
 * @return array [lang => [key => message]]
 */
if (!function_exists('t2editor_get_all_messages')) {
    function t2editor_get_all_messages(): array {
        $supported = defined('T2EDITOR_I18N_SUPPORTED_LANGS') && is_array(T2EDITOR_I18N_SUPPORTED_LANGS)
            ? T2EDITOR_I18N_SUPPORTED_LANGS
            : ['ko', 'en', 'ja', 'zh'];

        $all = [];
        foreach ($supported as $lang) {
            $all[$lang] = t2editor_get_messages($lang);
        }
        return $all;
    }
}
