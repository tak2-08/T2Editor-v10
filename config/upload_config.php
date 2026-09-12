<?php
//Path: T2Editor/config/upload_config.php

// ── PHP 7.4 호환 폴리필 (t2_config.php 보다 먼저 include될 수 있으므로 여기도 선언) ──
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

/**
 * T2Editor 업로드 설정 파일
 *
 * [구조 변경 요약]
 *   이전: validate_upload_file()이 확장자+크기만 검사.
 *         MIME·매직바이트 검증은 각 핸들러에 중복·분산.
 *         새 업로드 엔드포인트 추가 시 보호가 누락될 수 있었다.
 *
 *   현재: 공통 보안 함수 3종을 이 파일에 집약.
 *         · check_request_origin()    — Origin allowlist 검증
 *         · sanitize_original_name()  — 파일명 정제
 *         · verify_file_magic_bytes() — 포맷 시그니처 검증
 *
 *         validate_upload_file()에 $tmp_path 파라미터를 추가.
 *         $tmp_path 제공 시 → 확장자+크기+매직바이트+이미지 구조 전체 검사.
 *         $tmp_path 없이 호출 시 → 기존 확장자+크기만 검사 (하위 호환).
 *
 *         어떤 업로드 핸들러도 $tmp_path 하나만 추가하면
 *         완전한 콘텐츠 검증을 자동으로 받는다.
 *
 * [MIME 맵]
 *   브라우저 accept 및 재생기 Content-Type 출력을 위한 선언형 맵이다.
 *   서버측 파일 판정은 Fileinfo 없이 매직바이트와 이미지 구조로 수행한다.
 *
 * [매직바이트 개선]
 *   mp4/m4v: 첫 번째 박스 타입을 더 넓게 허용 (wide, free, mdat, moov 등)
 *            iOS 촬영 mp4, Apple QuickTime 인코딩 등 다양한 변형 지원.
 */

// ────────────────────────────────────────────────────────────────
// 상수
// ────────────────────────────────────────────────────────────────

define('T2EDITOR_MAX_UPLOAD_SIZE', 50);

// WebP 변환 실패 처리
//   true (기본·권장): 변환 실패 시 거부. 비정상 포맷 저장 방지.
//   false: 구형 서버(imagewebp 미지원)에서 원본 폴백이 필요할 때만 사용.
define('T2EDITOR_STRICT_WEBP_CONVERSION', true);

// 이미지 픽셀 수 상한 (DoS 선제 차단)
//   50 MP ≈ RGBA 4채널 기준 약 200 MB. memory_limit 512 MB 내 안전 처리 가능.
define('T2EDITOR_MAX_IMAGE_PIXELS', 50_000_000);

// ────────────────────────────────────────────────────────────────
// 허용 확장자 목록
// ────────────────────────────────────────────────────────────────
// SVG·ICO 제외:
//   SVG — XML 내 <script>·이벤트 핸들러·외부 참조가 실행됨.
//          sanitizer 없이 저장하면 XSS 공격 벡터가 된다.
//   ICO — MIME 판정이 환경 의존적이고 GD 처리 오류·폴백 위험이 크다.
// ────────────────────────────────────────────────────────────────
$t2editor_allowed_extensions = [
    'document' => [
        'pdf','txt','doc','docx','xls','xlsx','ppt','pptx',
        'hwp','odt','ods','odp','rtf',
    ],
    'image' => [
        'jpg','jpeg','png','gif','webp','bmp',
    ],
    'video' => [
        'mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v',
    ],
    'other' => [
        'zip','rar','7z','tar','gz','bz2',
        'mp3','m4a','wav','flac','aac','wma',
        'json','xml','csv',
    ],
];

// ────────────────────────────────────────────────────────────────
// 확장자 ↔ 허용 MIME 타입 맵
// (이미지·문서·미디어·압축 전체 통합 — 핸들러별 중복 제거)
//
// 이 맵은 브라우저 accept 및 재생 응답의 대표 Content-Type에 사용한다.
// 서버측 업로드 검증에는 Fileinfo를 사용하지 않고 파일 시그니처를 사용한다.
// ────────────────────────────────────────────────────────────────
function get_ext_mime_map(): array {
    return [
        // ── 이미지 ─────────────────────────────────────────────────────────
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'bmp'  => ['image/bmp','image/x-bmp','image/x-ms-bmp'],
        // ── 문서 ───────────────────────────────────────────────────────────
        'pdf'  => ['application/pdf'],
        'txt'  => ['text/plain'],
        'doc'  => ['application/msword'],
        'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        'xls'  => ['application/vnd.ms-excel'],
        'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        'ppt'  => ['application/vnd.ms-powerpoint'],
        'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
        'hwp'  => ['application/x-hwp','application/haansofthwp','application/octet-stream'],
        'odt'  => ['application/vnd.oasis.opendocument.text'],
        'ods'  => ['application/vnd.oasis.opendocument.spreadsheet'],
        'odp'  => ['application/vnd.oasis.opendocument.presentation'],
        'rtf'  => ['application/rtf','text/rtf'],
        // ── 비디오 ─────────────────────────────────────────────────────────
        // 브라우저·플레이어별로 사용하는 알려진 MIME 변형을 함께 선언한다.
        'mp4'  => ['video/mp4','video/quicktime','video/x-m4v'],
        //         ^ video/quicktime: iOS/Apple 기기 촬영 mp4가 이 MIME로 판정됨
        'webm' => ['video/webm'],
        'ogg'  => ['video/ogg','audio/ogg','application/ogg'],
        'mov'  => ['video/quicktime','video/mp4'],
        //         ^ video/mp4: 일부 mov 파일이 mp4 컨테이너로 인식됨
        'avi'  => ['video/x-msvideo','video/avi','video/msvideo'],
        //         ^ video/avi, video/msvideo: 레거시 서버·플레이어 호환
        'mkv'  => ['video/x-matroska','video/webm'],
        'wmv'  => ['video/x-ms-wmv','video/x-ms-asf'],
        'flv'  => ['video/x-flv','video/flv'],
        //         ^ video/flv: 일부 시스템에서 이 MIME로 반환됨
        'm4v'  => ['video/mp4','video/x-m4v','video/quicktime'],
        // ── 압축 ───────────────────────────────────────────────────────────
        'zip'  => ['application/zip','application/x-zip-compressed'],
        'rar'  => ['application/x-rar-compressed','application/vnd.rar'],
        '7z'   => ['application/x-7z-compressed'],
        'tar'  => ['application/x-tar'],
        'gz'   => ['application/gzip','application/x-gzip'],
        'bz2'  => ['application/x-bzip2'],
        // ── 오디오 ─────────────────────────────────────────────────────────
        'mp3'  => ['audio/mpeg','audio/mp3'],
        'm4a'  => ['audio/mp4','audio/x-m4a'],
        'wav'  => ['audio/wav','audio/x-wav'],
        'flac' => ['audio/flac','audio/x-flac'],
        'aac'  => ['audio/aac'],
        'wma'  => ['audio/x-ms-wma'],
        // ── 텍스트 계열 ────────────────────────────────────────────────────
        'json' => ['application/json','text/plain'],
        'xml'  => ['application/xml','text/xml'],
        'csv'  => ['text/csv','text/plain','application/csv'],
    ];
}

// ────────────────────────────────────────────────────────────────
// [공통-IMAGE] Fileinfo 없는 이미지 구조 판정
//
// getimagesize()/getimagesizefromstring()은 GD나 Fileinfo 확장에 의존하지
// 않는 PHP 표준 이미지 헤더 판독 함수다. 먼저 허용 포맷의 시그니처를
// 확인하고, 이어 실제 가로·세로와 PHP의 이미지 타입 판정을 교차 검증한다.
// SVG 등 실행 가능한 텍스트 이미지와 확장자 위장은 허용하지 않는다.
// ────────────────────────────────────────────────────────────────
function t2editor_image_type_to_mime(int $type): ?string {
    switch ($type) {
        case IMAGETYPE_JPEG: return 'image/jpeg';
        case IMAGETYPE_PNG:  return 'image/png';
        case IMAGETYPE_GIF:  return 'image/gif';
        case IMAGETYPE_BMP:  return 'image/bmp';
        default:
            if (defined('IMAGETYPE_WEBP') && $type === IMAGETYPE_WEBP) {
                return 'image/webp';
            }
            return null;
    }
}

function t2editor_image_signature_mime(string $bytes): ?string {
    $length = strlen($bytes);
    if ($length < 12) return null;

    if (substr($bytes, 0, 3) === "\xFF\xD8\xFF") return 'image/jpeg';
    if (substr($bytes, 0, 8) === "\x89PNG\r\n\x1A\n") return 'image/png';

    $gif = substr($bytes, 0, 6);
    if ($gif === 'GIF87a' || $gif === 'GIF89a') return 'image/gif';

    if (substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') {
        return 'image/webp';
    }
    if (substr($bytes, 0, 2) === 'BM') return 'image/bmp';

    return null;
}

function t2editor_validate_image_info(array $info, string $signature_mime): ?array {
    $width  = isset($info[0]) ? (int)$info[0] : 0;
    $height = isset($info[1]) ? (int)$info[1] : 0;
    $type   = isset($info[2]) ? (int)$info[2] : 0;
    $mime   = t2editor_image_type_to_mime($type);

    if ($width < 1 || $height < 1 || $mime === null || $mime !== $signature_mime) {
        return null;
    }

    $max_pixels = defined('T2EDITOR_MAX_IMAGE_PIXELS') ? (int)T2EDITOR_MAX_IMAGE_PIXELS : 50_000_000;
    if ($max_pixels > 0 && $width > intdiv($max_pixels, $height)) {
        return null;
    }

    return ['mime' => $mime, 'width' => $width, 'height' => $height, 'type' => $type];
}

function t2editor_inspect_image_bytes(string $bytes): ?array {
    $signature_mime = t2editor_image_signature_mime($bytes);
    if ($signature_mime === null || !function_exists('getimagesizefromstring')) {
        return null;
    }

    $info = @getimagesizefromstring($bytes);
    if ($info === false) return null;

    return t2editor_validate_image_info($info, $signature_mime);
}

function t2editor_inspect_image_file(string $path): ?array {
    if (!is_file($path) || !is_readable($path) || !function_exists('getimagesize')) {
        return null;
    }

    $handle = @fopen($path, 'rb');
    if (!$handle) return null;
    $header = fread($handle, 16);
    fclose($handle);
    if ($header === false) return null;

    $signature_mime = t2editor_image_signature_mime($header);
    if ($signature_mime === null) return null;

    $info = @getimagesize($path);
    if ($info === false) return null;

    return t2editor_validate_image_info($info, $signature_mime);
}

// ────────────────────────────────────────────────────────────────
// [공통-ORIGIN] Origin allowlist 검증
//
// 설정 예시 (t2_config.php):
//   define('T2EDITOR_ALLOWED_ORIGINS', [
//       'https://www.example.com',
//       'https://editor.example.com',
//   ]);
// 미정의 시 동일 호스트 비교로 폴백.
//
// [FIX] 역방향 프록시(Nginx, Apache mod_proxy, CDN 등) 환경에서
// $_SERVER['HTTPS'] 가 설정되지 않는 경우가 있다.
// GET 요청(loadConfig)은 Origin 헤더를 보내지 않아 통과하지만,
// POST 요청(실제 업로드)은 Chrome 이 Origin 을 항상 포함하므로
// 프로토콜 불일치가 생기면 정상 요청이 403 으로 차단된다.
// X-Forwarded-Proto 를 우선 참조하도록 수정한다.
//
// [SEC-CSRF] POST 요청에 Origin 헤더가 없으면 거부한다.
// 브라우저는 cross-origin POST 요청에 Origin 을 항상 포함한다.
// Origin 이 비어있는 POST = curl / 서버 간 요청으로 간주하여 차단한다.
// GET 요청(설정 조회 등)은 Origin 없이도 허용한다.
// ────────────────────────────────────────────────────────────────
function check_request_origin(): bool {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    // [SEC-CSRF] POST/PUT/DELETE 등 데이터 변경 요청에서 Origin 이 비어있으면 거부
    if ($origin === '') {
        if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'OPTIONS') {
            return false;
        }
        return true; // GET 등 읽기 요청은 Origin 없어도 허용
    }

    if (defined('T2EDITOR_ALLOWED_ORIGINS') && is_array(T2EDITOR_ALLOWED_ORIGINS) && count(T2EDITOR_ALLOWED_ORIGINS) > 0) {
        return in_array($origin, T2EDITOR_ALLOWED_ORIGINS, true);
    }

    // [FIX] 역방향 프록시가 X-Forwarded-Proto 를 설정한 경우 우선 참조
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $proto = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]));
    } elseif (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        $proto = 'https';
    } else {
        $proto = 'http';
    }

    return $origin === $proto . '://' . $_SERVER['HTTP_HOST'];
}

// ────────────────────────────────────────────────────────────────
// [공통-FILENAME] 원본 파일명 정제
// ────────────────────────────────────────────────────────────────
function sanitize_original_name(string $filename): string {
    $filename = str_replace("\0", '', $filename);
    $filename = str_replace(['/', '\\', '..'], '', $filename);
    $filename = preg_replace('/[\x00-\x1F\x7F]/', '', $filename);

    if (mb_strlen($filename, 'UTF-8') > 255) {
        $ext  = pathinfo($filename, PATHINFO_EXTENSION);
        $base = mb_substr(pathinfo($filename, PATHINFO_FILENAME), 0, 240, 'UTF-8');
        $filename = $ext !== '' ? $base . '.' . $ext : $base;
    }
    return $filename !== '' ? $filename : 'unnamed_file';
}

// ────────────────────────────────────────────────────────────────
// [공통-MAGIC] 파일 시그니처(매직 바이트) 검증
//
// 이미지(jpg·png·gif·webp·bmp)를 포함한 전체 허용 포맷을 처리.
// 환경 의존적 MIME 판정(octet-stream 오판 등)을 내용 기반으로 보완.
//
// [개선] mp4/m4v: 첫 번째 박스 타입을 더 넓게 허용.
//   MP4 컨테이너 규격(ISO 14496-12)에서 첫 번째 박스는 ftyp 가 권장되지만
//   wide, free, mdat, moov 로 시작하는 유효한 파일도 존재한다.
//   특히 iOS/QuickTime 인코딩 파일은 wide 박스로 시작하는 경우가 많다.
// ────────────────────────────────────────────────────────────────
function verify_file_magic_bytes(string $tmp_path, string $file_ext): bool {
    $handle = fopen($tmp_path, 'rb');
    if (!$handle) return false;
    $header = fread($handle, 16);
    fclose($handle);
    if ($header === false || strlen($header) < 2) return false;

    switch ($file_ext) {
        // ── 이미지 ─────────────────────────────────────────────────────────
        case 'jpg': case 'jpeg':
            return substr($header, 0, 3) === "\xFF\xD8\xFF";
        case 'png':
            return substr($header, 0, 8) === "\x89PNG\r\n\x1A\n";
        case 'gif':
            return substr($header, 0, 6) === 'GIF87a' || substr($header, 0, 6) === 'GIF89a';
        case 'webp':
            return substr($header, 0, 4) === 'RIFF' && strlen($header) >= 12 && substr($header, 8, 4) === 'WEBP';
        case 'bmp':
            return substr($header, 0, 2) === 'BM';
        // ── 문서 ───────────────────────────────────────────────────────────
        case 'pdf':
            return substr($header, 0, 4) === '%PDF';
        case 'zip': case 'docx': case 'xlsx': case 'pptx':
        case 'odt': case 'ods':  case 'odp':
            return substr($header, 0, 4) === "PK\x03\x04";
        case 'doc': case 'xls': case 'ppt': case 'hwp':
            return substr($header, 0, 8) === "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";
        case 'rtf':
            return substr($header, 0, 5) === '{\\rtf';
        case 'txt': case 'csv':
            return strpos($header, "\x00") === false;
        case 'json': {
            $s = file_get_contents($tmp_path, false, null, 0, 4096);
            if ($s === false) return false;
            if (substr($s, 0, 3) === "\xEF\xBB\xBF") $s = substr($s, 3);
            $t = ltrim($s);
            return strlen($t) > 0 && ($t[0] === '{' || $t[0] === '[');
        }
        case 'xml': {
            $s = file_get_contents($tmp_path, false, null, 0, 256);
            if ($s === false) return false;
            if (substr($s, 0, 3) === "\xEF\xBB\xBF") $s = substr($s, 3);
            $t = ltrim($s);
            return strncmp($t, '<?xml', 5) === 0 || (strlen($t) > 0 && $t[0] === '<');
        }
        // ── 압축 ───────────────────────────────────────────────────────────
        case 'rar':
            return substr($header, 0, 7) === "Rar!\x1A\x07\x00" || substr($header, 0, 8) === "Rar!\x1A\x07\x01\x00";
        case '7z':
            return substr($header, 0, 6) === "7z\xBC\xAF\x27\x1C";
        case 'gz':
            return substr($header, 0, 2) === "\x1F\x8B";
        case 'bz2':
            return substr($header, 0, 2) === 'BZ';
        case 'tar': {
            $h2 = fopen($tmp_path, 'rb');
            if (!$h2) return false;
            fseek($h2, 257);
            $m = fread($h2, 5);
            fclose($h2);
            return $m !== false && substr($m, 0, 5) === 'ustar';
        }
        // ── 오디오 ─────────────────────────────────────────────────────────
        case 'mp3':
            return substr($header, 0, 3) === 'ID3' || (ord($header[0]) === 0xFF && (ord($header[1]) & 0xE0) === 0xE0);
        case 'm4a':
            return strlen($header) >= 8 && substr($header, 4, 4) === 'ftyp';
        case 'wav':
            return substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'WAVE';
        case 'flac':
            return substr($header, 0, 4) === 'fLaC';
        case 'ogg':
            return substr($header, 0, 4) === 'OggS';
        case 'aac':
            return (ord($header[0]) === 0xFF && (ord($header[1]) & 0xF0) === 0xF0) || substr($header, 0, 3) === 'ID3';
        case 'wma':
            return substr($header, 0, 8) === "\x30\x26\xB2\x75\x8E\x66\xCF\x11";
        // ── 비디오 ─────────────────────────────────────────────────────────
        case 'mp4': case 'm4v':
            // [개선] MP4/M4V 매직바이트 검사 강화
            //
            // MP4 컨테이너(ISO 14496-12)의 첫 번째 박스 구조:
            //   [4바이트 크기][4바이트 타입][데이터...]
            //
            // 표준(권장): ftyp 로 시작.
            // 현실:       iOS, QuickTime, 일부 인코더는 아래 박스로 시작할 수 있다.
            //   · wide — Apple QuickTime 의 확장 크기 예약 박스
            //   · free — 빈 공간(패딩) 박스
            //   · mdat — 미디어 데이터가 앞에 오는 경우 (스트리밍 최적화)
            //   · moov — 메타데이터 박스가 앞에 오는 경우
            //   · pdin — Progressive Download Information
            //   · skip — 건너뛰기 박스
            //
            // 이를 모두 허용해 iOS 촬영 영상, Apple 인코딩 파일 등의
            // MIME 검사 통과 실패를 방지한다.
            if (strlen($header) < 8) return false;
            $box_type = substr($header, 4, 4);
            return in_array($box_type, ['ftyp','mdat','moov','wide','free','skip','pdin'], true);

        case 'webm': case 'mkv':
            return substr($header, 0, 4) === "\x1A\x45\xDF\xA3";
        case 'avi':
            return substr($header, 0, 4) === 'RIFF' && substr($header, 8, 4) === 'AVI ';
        case 'mov': {
            // MOV 는 QuickTime 포맷으로 MP4 와 유사한 박스 구조
            $box = strlen($header) >= 8 ? substr($header, 4, 4) : '';
            return in_array($box, ['ftyp','moov','mdat','wide','free','skip','pnot'], true);
        }
        case 'wmv':
            return substr($header, 0, 8) === "\x30\x26\xB2\x75\x8E\x66\xCF\x11";
        case 'flv':
            return substr($header, 0, 3) === 'FLV';
        default:
            // 알 수 없는 확장자는 통과 (확장자 검사에서 이미 필터링됨)
            return true;
    }
}

// ────────────────────────────────────────────────────────────────
// 확장자 헬퍼
// ────────────────────────────────────────────────────────────────

function get_allowed_extensions($category = null): array {
    global $t2editor_allowed_extensions;
    if ($category && isset($t2editor_allowed_extensions[$category])) {
        return $t2editor_allowed_extensions[$category];
    }
    $all = [];
    foreach ($t2editor_allowed_extensions as $exts) {
        $all = array_merge($all, $exts);
    }
    return $all;
}

function get_image_extensions():    array { return get_allowed_extensions('image'); }
function get_video_extensions():    array { return get_allowed_extensions('video'); }
function get_document_extensions(): array { return get_allowed_extensions('document'); }
function get_other_extensions():    array { return get_allowed_extensions('other'); }

function is_allowed_extension($filename, $categories = null): bool {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    if ($categories === null) {
        $allowed = get_allowed_extensions();
    } elseif (is_string($categories)) {
        $allowed = get_allowed_extensions($categories);
    } elseif (is_array($categories)) {
        $allowed = [];
        foreach ($categories as $cat) {
            $allowed = array_merge($allowed, get_allowed_extensions($cat));
        }
    } else {
        return false;
    }
    return in_array($ext, $allowed, true);
}

function is_allowed_file_size(int $file_size): bool {
    return $file_size <= T2EDITOR_MAX_UPLOAD_SIZE * 1024 * 1024;
}

// ────────────────────────────────────────────────────────────────
// validate_upload_file() — 강화된 공통 보안 경계
//
// 파라미터:
//   $filename   — (정제된) 파일명
//   $file_size  — 파일 크기 (바이트)
//   $categories — 허용 카테고리 (null = 전체)
//   $tmp_path   — 임시 파일 경로 (null = 확장자+크기만 검사)
//
// $tmp_path 제공 시 실행되는 추가 검사:
//   3) 매직바이트 — verify_file_magic_bytes()
//   4) 이미지 구조 — getimagesize()로 타입·크기·픽셀 수 교차 검증
//
// Fileinfo 확장은 사용하지 않는다.
// ────────────────────────────────────────────────────────────────
function validate_upload_file(
    string  $filename,
    int     $file_size,
    $categories  = null,
    ?string $tmp_path = null
): array {

    // 1. 확장자
    if (!is_allowed_extension($filename, $categories)) {
        return ['success' => false, 'message' => 'Unsupported file type.'];
    }

    // 2. 크기
    if (!is_allowed_file_size($file_size)) {
        return ['success' => false, 'message' => 'File size too large. (max ' . T2EDITOR_MAX_UPLOAD_SIZE . 'MB)'];
    }

    // tmp_path 없으면 여기서 종료 (하위 호환)
    if ($tmp_path === null || !is_file($tmp_path)) {
        return ['success' => true, 'message' => ''];
    }

    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

    // 3. 매직바이트
    if (!verify_file_magic_bytes($tmp_path, $file_ext)) {
        return ['success' => false, 'message' => 'Invalid file format.'];
    }

    // 4. 이미지 구조 교차 검증
    // 시그니처만 흉내 낸 파일, 확장자 위장, 비정상 크기 및 과도한 픽셀 수를 거부한다.
    if (in_array($file_ext, get_image_extensions(), true)) {
        $image = t2editor_inspect_image_file($tmp_path);
        if ($image === null) {
            return ['success' => false, 'message' => 'Invalid image format.'];
        }

        $expected = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png', 'gif' => 'image/gif',
            'webp' => 'image/webp', 'bmp' => 'image/bmp',
        ];
        if (($expected[$file_ext] ?? null) !== $image['mime']) {
            return ['success' => false, 'message' => 'Image content does not match extension.'];
        }
    }

    return ['success' => true, 'message' => ''];
}

// ────────────────────────────────────────────────────────────────
// 기타 헬퍼
// ────────────────────────────────────────────────────────────────

function detect_file_type(string $filename): string {
    global $t2editor_allowed_extensions;
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    foreach ($t2editor_allowed_extensions as $type => $exts) {
        if (in_array($ext, $exts, true)) return $type;
    }
    return 'unknown';
}

function generate_accept_string($categories = null): string {
    if ($categories === null)          $exts = get_allowed_extensions();
    elseif (is_string($categories))    $exts = get_allowed_extensions($categories);
    elseif (is_array($categories)) {
        $exts = [];
        foreach ($categories as $cat) $exts = array_merge($exts, get_allowed_extensions($cat));
    } else return '';

    return implode(',', array_map(fn($e) => '.' . $e, $exts));
}

// ────────────────────────────────────────────────────────────────
// get_js_config() — JS/클라이언트용 통합 설정 객체 생성
//
// editor_lib.php 의 window.T2EDITOR_UPLOAD_CONFIG 주입과
// get_upload_config.php fallback 엔드포인트 양쪽이 이 함수를 사용해
// 완전히 동일한 구조를 반환하도록 보장한다.
//
// 반환 구조:
//   maxSizeMB   — 최대 업로드 크기 (MB 정수)
//   extensions  — 카테고리별 허용 확장자 배열
//     .image / .video / .document / .audio / .other
//   accept      — <input accept> 속성값 (카테고리별)
//     .image / .video / .file  (file = document+video+other)
//   mimeMap     — 비디오 확장자 → 대표 MIME (video.js 전용)
// ────────────────────────────────────────────────────────────────
function get_js_config(): array {
    global $t2editor_allowed_extensions;

    $mime_map = get_ext_mime_map();

    // 오디오 확장자: other 카테고리에서 첫 번째 MIME 가 audio/* 인 것만 추출.
    // upload_config.php 변경 시 자동 반영 — 별도 목록 관리 불필요.
    $audio_exts = [];
    foreach ($t2editor_allowed_extensions['other'] as $ext) {
        foreach ($mime_map[$ext] ?? [] as $mime) {
            if (strncmp($mime, 'audio/', 6) === 0) {
                $audio_exts[] = $ext;
                break;
            }
        }
    }

    // 비디오 확장자별 대표 MIME 맵 (첫 번째 값 = 가장 표준적인 MIME)
    $video_mime_map = [];
    foreach ($t2editor_allowed_extensions['video'] as $ext) {
        if (!empty($mime_map[$ext])) {
            $video_mime_map[$ext] = $mime_map[$ext][0];
        }
    }

    return [
        'maxSizeMB'  => (int) T2EDITOR_MAX_UPLOAD_SIZE,
        'extensions' => [
            'image'    => $t2editor_allowed_extensions['image'],
            'video'    => $t2editor_allowed_extensions['video'],
            'document' => $t2editor_allowed_extensions['document'],
            'audio'    => $audio_exts,
            'other'    => $t2editor_allowed_extensions['other'],
        ],
        'accept' => [
            'image'    => generate_accept_string('image'),
            'video'    => generate_accept_string('video'),
            'file'     => generate_accept_string(['document', 'video', 'other']),
        ],
        'mimeMap' => $video_mime_map,
    ];
}

// ════════════════════════════════════════════════════════════════════════
// [RHYMIX BRIDGE] Rhymix(라이믹스) 파일 모듈 위임 업로드
//
// 설계 방침
// ─────────
// Rhymix 환경에서는 T2 자체 저장 로직(GD 변환·자체 디렉토리 저장)을 쓰지 않고
// Rhymix 의 공개 업로드 액션(FileController::procFileUpload, module=file)으로
// 그대로 위임(proxy)한다.
//
//   · Rhymix 는 업로드된 파일을 files 테이블에 등록해야 문서 저장/삭제/권한 검사·
//     첨부파일 목록에서 정상적으로 취급된다. T2가 자체 디렉토리에 직접 저장하면
//     Rhymix 입장에서는 존재를 전혀 모르는 "고아 파일"이 되어 버린다.
//   · Rhymix 파일 모듈은 이미 자체적으로 업로드 용량 제한(모듈별 설정)·확장자
//     제한·썸네일 생성 등을 수행한다. 이를 T2에서 다시 구현하면 두 정책이
//     어긋날 위험이 있고 유지보수 부담도 커진다.
//   · Rhymix 의 내부 구조(Context, ModuleHandler, 부트스트랩 절차 등)는
//     "사전 공지 없이 변경될 수 있다"(T2Editor 라이선스 고지와 마찬가지로
//     Rhymix 도 배포마다 리팩터링이 있을 수 있음). 반면 module=file&act=
//     procFileUpload 라는 공개 액션 URL 계약은 Rhymix 코어의 안정된 표면이므로,
//     내부 클래스를 직접 include 하는 대신 이 공개 액션을 "루프백 HTTP 요청"으로
//     호출하는 편이 버전 변화에 더 강하다.
//
// 호출 흐름
// ─────────
//   1) T2Editor 를 Rhymix 에디터 스킨으로 등록하면(=> README_RHYMIX.md 참고)
//      Rhymix 에디터 모듈이 editor_sequence 를 할당하고 세션에
//      $_SESSION['upload_info'][editor_sequence] 를 등록해 둔다.
//   2) editor.lib.php 는 그 editor_sequence 를 window.T2EDITOR_RHYMIX_EDITOR_SEQUENCE
//      로 브라우저에 내려보낸다.
//   3) plugin/image/image.js, plugin/file/file.js (및 draw.js/video.js) 는
//      업로드 시 이 값을 FormData 에 함께 실어 image_upload.php / file_upload.php
//      로 보낸다 (T2Utils.appendRhymixUploadFields 참고).
//   4) image_upload.php / file_upload.php 는 t2editor_is_rhymix() 가 true 이면
//      자체 저장 대신 t2editor_rhymix_proxy_upload() 로 Rhymix 파일 모듈에
//      그대로 위임하고, 응답을 T2 표준 JSON 형식으로 변환해 돌려준다.
// ════════════════════════════════════════════════════════════════════════

/**
 * 현재 요청이 Rhymix(라이믹스) 부트스트랩 위에서 실행 중인지 판별.
 *
 * RX_BASEDIR 는 Rhymix 코어가 부팅되면(그누보드5의 _GNUBOARD_ 처럼) 항상
 * 정의되는 상수이며, Context 클래스 존재 여부로 이중 확인한다.
 */
function t2editor_find_rhymix_root(): ?string {
    static $resolved = false;
    static $root = null;
    if ($resolved) return $root;
    $resolved = true;

    if (defined('RX_BASEDIR') && is_dir(RX_BASEDIR)) {
        $root = rtrim(str_replace('\\', '/', RX_BASEDIR), '/');
        return $root;
    }

    // Upload endpoints are called directly by the browser, outside index.php.
    // Walk up from config/ until the Rhymix installation root is found.
    $dir = dirname(__DIR__);
    for ($i = 0; $i < 12; $i++) {
        if (is_file($dir . '/index.php')
            && is_file($dir . '/common/autoload.php')
            && is_file($dir . '/modules/file/file.controller.php')) {
            $real = realpath($dir);
            $root = rtrim(str_replace('\\', '/', $real !== false ? $real : $dir), '/');
            return $root;
        }
        $parent = dirname($dir);
        if ($parent === $dir) break;
        $dir = $parent;
    }
    return null;
}

function t2editor_is_rhymix(): bool {
    return t2editor_find_rhymix_root() !== null;
}

/**
 * 현재 요청을 기준으로 사이트의 스킴+호스트(예: https://example.com)를 계산한다.
 * t2_config.php 의 BASIC SYSTEM 호스트 검증 로직과 동일한 방어 수준을 적용.
 * T2EDITOR_RHYMIX_BASE_URL 상수가 정의되어 있으면 그 값을 우선 사용한다
 * (리버스 프록시·내부망 루프백 등 자동 계산이 어려운 환경을 위한 탈출구).
 */
function t2editor_rhymix_base_url(): string {
    if (defined('T2EDITOR_RHYMIX_BASE_URL') && T2EDITOR_RHYMIX_BASE_URL) {
        return rtrim(T2EDITOR_RHYMIX_BASE_URL, '/');
    }

    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $proto = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]));
    } elseif (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        $proto = 'https';
    } else {
        $proto = 'http';
    }

    $raw_host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    if (!preg_match('/^[a-zA-Z0-9\-\.\[\]:]+$/', $raw_host)) {
        $raw_host = 'localhost';
    }

    // Preserve installations in a web subdirectory. For example,
    // /rhymix/modules/editor/skins/t2editor/... must proxy to /rhymix/index.php.
    $script_name = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
    $marker = '/modules/editor/skins/';
    $pos = strpos($script_name, $marker);
    $base_path = $pos !== false ? substr($script_name, 0, $pos) : '';
    $base_path = '/' . trim($base_path, '/');
    if ($base_path === '/') $base_path = '';

    return $proto . '://' . $raw_host . $base_path;
}

/**
 * 업로드된 파일을 Rhymix 파일 모듈(module=file&act=procFileUpload)로
 * 그대로 프록시하고, Rhymix 의 원본 JSON 응답을 반환한다.
 *
 * @param string $file_field   $_FILES 키 (예: 'bf_file'). bf_file[] 배열 형태면
 *                              첫 번째 파일만 프록시한다 — Rhymix procFileUpload
 *                              는 요청 1건당 파일 1개를 처리하는 액션이기 때문.
 * @return array{success:bool, raw:array|null, message:string}
 */
function t2editor_rhymix_proxy_upload(string $file_field): array {
    if (!function_exists('curl_init')) {
        return ['success' => false, 'raw' => null, 'message' => 'cURL extension is required to bridge uploads to Rhymix.'];
    }
    if (!isset($_FILES[$file_field])) {
        return ['success' => false, 'raw' => null, 'message' => 'No file to upload.'];
    }

    $f        = $_FILES[$file_field];
    $name     = is_array($f['name'])     ? ($f['name'][0]     ?? '') : $f['name'];
    $tmp_name = is_array($f['tmp_name']) ? ($f['tmp_name'][0] ?? '') : $f['tmp_name'];
    $error    = is_array($f['error'])    ? ($f['error'][0]    ?? UPLOAD_ERR_NO_FILE) : $f['error'];
    $type     = is_array($f['type'])     ? ($f['type'][0]     ?? '') : $f['type'];

    if ($error !== UPLOAD_ERR_OK || !$tmp_name || !is_uploaded_file($tmp_name)) {
        return ['success' => false, 'raw' => null, 'message' => 'PHP upload error.'];
    }

    // editor_sequence 는 Rhymix 에디터 모듈이 세션에 등록해 둔 값과 일치해야
    // procFileUpload 가 이를 신뢰한다. JS 단(T2Utils.appendRhymixUploadFields)
    // 에서 window.T2EDITOR_RHYMIX_EDITOR_SEQUENCE 를 그대로 실어 보낸다.
    $editor_sequence = $_POST['editor_sequence'] ?? '';
    if ($editor_sequence === '' || !preg_match('/^[0-9]+$/', (string)$editor_sequence)) {
        return ['success' => false, 'raw' => null, 'message' => 'Missing or invalid editor_sequence for Rhymix upload. Is T2Editor registered as a Rhymix editor skin? See README_RHYMIX.md'];
    }

    // [FIX] module_srl 필수 검증 추가.
    // Rhymix 코어 file.controller.php::procFileUpload() 는 editor_sequence 뿐
    // 아니라 module_srl 도 함께 검증하며, 없으면 InvalidRequest('module_srl')
    // 예외를 던진다. 지금까지는 $_POST['module_srl'] 이 비어 있으면 그냥
    // 필드를 안 실어 보내고 Rhymix 의 범용 에러만 그대로 노출됐는데, 그러면
    // "T2Editor 설정이 잘못됐다"는 원인 파악이 어렵다. config.blade.php 가
    // $module_srl / $module_info 를 못 찾는 렌더링 컨텍스트(위젯 미리보기 등)
    // 에서 여기서 바로 원인을 알려주도록 명시적으로 막는다.
    $module_srl = $_POST['module_srl'] ?? '';
    if ($module_srl === '' || !preg_match('/^[0-9]+$/', (string)$module_srl)) {
        return ['success' => false, 'raw' => null, 'message' => 'Missing or invalid module_srl for Rhymix upload. config.blade.php could not resolve $module_srl/$module_info on this screen — see README_RHYMIX.md'];
    }

    $post_fields = [
        'Filedata'        => new CURLFile($tmp_name, $type ?: 'application/octet-stream', $name ?: 'upload.bin'),
        'editor_sequence' => $editor_sequence,
        'module_srl'      => $module_srl,
    ];
    foreach (['uploadTargetSrl', 'upload_target_srl', 'mid'] as $k) {
        if (!empty($_POST[$k])) {
            $post_fields[$k] = $_POST[$k];
        }
    }

    $headers = [
        'Cookie: ' . ($_SERVER['HTTP_COOKIE'] ?? ''),
        'Accept: application/json',
        'X-Requested-With: XMLHttpRequest',
    ];
    // 일부 Rhymix 설치에서 file.xml 의 procFileUpload 액션에 check_csrf 가
    // 걸려 있을 수 있다. 페이지에서 전달받은 토큰이 있으면 함께 전달한다.
    if (!empty($_POST['_rx_csrf_token'])) {
        $headers[] = 'X-CSRF-Token: ' . $_POST['_rx_csrf_token'];
        $post_fields['_rx_csrf_token'] = $_POST['_rx_csrf_token'];
    }

    $target_url = t2editor_rhymix_base_url() . '/index.php?module=file&act=procFileUpload';

    $ch = curl_init($target_url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $post_fields,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body      = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        return ['success' => false, 'raw' => null, 'message' => 'Failed to reach Rhymix file module: ' . $curl_err];
    }
    if ($http_code >= 400) {
        return ['success' => false, 'raw' => null, 'message' => 'Rhymix file module returned HTTP ' . $http_code];
    }

    $decoded = json_decode(trim((string)$body), true);
    if (!is_array($decoded)) {
        return ['success' => false, 'raw' => null, 'message' => 'Rhymix returned a non-JSON response (unexpected module/act routing on this install?).'];
    }

    // Rhymix exec_json() 규격: error === 0 이 성공, 그 외에는 message 에 실패 사유.
    $rx_error = $decoded['error'] ?? 0;
    if ((int)$rx_error !== 0) {
        return ['success' => false, 'raw' => $decoded, 'message' => $decoded['message'] ?? 'Rhymix rejected the upload.'];
    }

    return ['success' => true, 'raw' => $decoded, 'message' => ''];
}

// ════════════════════════════════════════════════════════════════════════
// [WORDPRESS BRIDGE] 워드프레스 미디어 라이브러리 위임 업로드
//
// 설계 방침 (Rhymix 브릿지와 동일한 이유, 방식만 다름)
// ─────────────────────────────────────────────────────────────────────
// 워드프레스도 업로드된 파일을 wp_posts(attachment)/미디어 라이브러리에
// 등록해야 미디어 관리 화면·글 삭제 시 정리·권한 검사에서 정상 인식된다.
// T2가 자체 저장하면 워드프레스가 모르는 "고아 파일"이 된다.
//
// Rhymix 와의 차이점: 워드프레스는 어디서든 wp-load.php 하나만 불러오면
// 전체 런타임(세션/쿠키 인증 포함)이 그 자리에서 부트스트랩된다. 그래서
// Rhymix 처럼 자기 자신에게 별도 HTTP 루프백을 보낼 필요가 없다 —
// media_handle_upload() 를 이 스크립트 안에서 직접 호출하면 된다. 이는
// wp_ajax_upload_attachment() (워드프레스 코어의 표준 업로드 액션) 이
// 내부적으로 호출하는 것과 동일한 함수이므로 동작이 100% 동일하다.
// ════════════════════════════════════════════════════════════════════════

/**
 * 현재 스크립트 위치에서 위쪽으로 올라가며 wp-load.php 를 찾아 로드한다.
 * 이미 로드되어 있으면(=워드프레스 프로세스 내부에서 호출된 경우) 아무 것도
 * 하지 않는다. T2Editor 가 wp-content/plugins/t2editor/ 든, mu-plugins 든,
 * 테마 하위든 어디에 설치되어도 동작하도록 상대 위치를 가정하지 않는다.
 */
function t2editor_wp_bootstrap(): bool {
    if (defined('ABSPATH')) {
        return true; // 이미 워드프레스 컨텍스트 안에서 실행 중
    }

    $dir = __DIR__;
    for ($i = 0; $i < 10; $i++) {
        $candidate = $dir . '/wp-load.php';
        if (is_file($candidate)) {
            require_once $candidate;
            return defined('ABSPATH');
        }
        $parent = dirname($dir);
        if ($parent === $dir) break; // 파일시스템 루트 도달
        $dir = $parent;
    }
    return false;
}

/**
 * 현재 요청이 워드프레스 위에서 실행 가능한지 판별(필요 시 부트스트랩까지 수행).
 */
function t2editor_is_wordpress(): bool {
    static $result = null;
    if ($result === null) {
        $result = t2editor_wp_bootstrap() && function_exists('media_handle_upload');
    }
    return $result;
}

/**
 * 업로드된 파일을 워드프레스 미디어 라이브러리에 그대로 등록한다.
 * wp_ajax_upload_attachment() (wp-admin/includes/ajax-actions.php) 와 동일한
 * 검증·처리 경로(media_handle_upload → wp_prepare_attachment_for_js)를 탄다.
 *
 * @param string $file_field  $_FILES 키 (예: 'bf_file'). 배열 형태면 첫 파일만 처리.
 * @return array{success:bool, attachment:array|null, message:string}
 */
function t2editor_wp_handle_upload(string $file_field): array {
    if (!t2editor_is_wordpress()) {
        return ['success' => false, 'attachment' => null, 'message' => 'WordPress runtime not available.'];
    }
    if (!isset($_FILES[$file_field])) {
        return ['success' => false, 'attachment' => null, 'message' => 'No file to upload.'];
    }

    // 워드프레스 코어와 동일한 nonce 액션명('media-form')으로 검증.
    // check_ajax_referer() 는 실패 시 기본적으로 wp_die() 로 프로세스를
    // 종료시키므로, 세 번째 인자 false 로 죽지 않게 하고 반환값을 직접 확인한다.
    $nonce = $_POST['_wpnonce'] ?? '';
    if (!function_exists('check_ajax_referer') || !check_ajax_referer('media-form', false, false)) {
        return ['success' => false, 'attachment' => null, 'message' => 'Invalid or missing WordPress nonce (_wpnonce). Is T2Editor\'s WordPress bridge active on this screen?'];
    }

    if (!current_user_can('upload_files')) {
        return ['success' => false, 'attachment' => null, 'message' => 'Sorry, you are not allowed to upload files.'];
    }

    $post_id = isset($_REQUEST['post_id']) ? intval($_REQUEST['post_id']) : 0;
    if ($post_id && !current_user_can('edit_post', $post_id)) {
        return ['success' => false, 'attachment' => null, 'message' => 'Sorry, you are not allowed to attach files to this post.'];
    }

    // bf_file[] 배열이면 첫 번째 항목만 $_FILES[$file_field] 형태로 재구성 —
    // media_handle_upload() 는 단일 파일 필드를 기대한다.
    if (isset($_FILES[$file_field]['name']) && is_array($_FILES[$file_field]['name'])) {
        $_FILES[$file_field] = [
            'name'     => $_FILES[$file_field]['name'][0]     ?? '',
            'type'     => $_FILES[$file_field]['type'][0]     ?? '',
            'tmp_name' => $_FILES[$file_field]['tmp_name'][0] ?? '',
            'error'    => $_FILES[$file_field]['error'][0]    ?? UPLOAD_ERR_NO_FILE,
            'size'     => $_FILES[$file_field]['size'][0]     ?? 0,
        ];
    }

    require_once ABSPATH . 'wp-admin/includes/image.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';

    $attachment_id = media_handle_upload($file_field, $post_id);
    if (is_wp_error($attachment_id)) {
        return ['success' => false, 'attachment' => null, 'message' => $attachment_id->get_error_message()];
    }

    $attachment = wp_prepare_attachment_for_js($attachment_id);
    if (!$attachment) {
        return ['success' => false, 'attachment' => null, 'message' => 'Failed to prepare attachment data.'];
    }

    return ['success' => true, 'attachment' => $attachment, 'message' => ''];
}