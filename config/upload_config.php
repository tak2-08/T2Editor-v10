<?php
// Path: T2Editor/config/upload_config.php
// Developer settings: change upload limits and extension policy here; PHP/web-server limits still take precedence.

require_once __DIR__ . '/t2_compat.php';


// PHP 7.4 호환 폴리필 (t2_config.php 보다 먼저 include될 수 있으므로 여기도 선언)
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
 * Shared upload policy and validation.
 * Passing $tmp_path to validate_upload_file() enables size, signature and image-structure checks;
 * omitting it preserves the legacy extension/size-only contract. MIME maps are response metadata,
 * while server-side identification uses signatures so Fileinfo is not required.
 */

// 상수

if (!defined('T2EDITOR_MAX_UPLOAD_SIZE')) {
    define('T2EDITOR_MAX_UPLOAD_SIZE', 50);
}

// WebP 변환 실패 처리
//   true (기본·권장): 변환 실패 시 거부. 비정상 포맷 저장 방지.
//   false: 구형 서버(imagewebp 미지원)에서 원본 폴백이 필요할 때만 사용.
if (!defined('T2EDITOR_STRICT_WEBP_CONVERSION')) {
    define('T2EDITOR_STRICT_WEBP_CONVERSION', true);
}

// 이미지 픽셀 수 상한 (DoS 선제 차단)
//   50 MP ≈ RGBA 4채널 기준 약 200 MB. memory_limit 512 MB 내 안전 처리 가능.
if (!defined('T2EDITOR_MAX_IMAGE_PIXELS')) {
    define('T2EDITOR_MAX_IMAGE_PIXELS', 50_000_000);
}

// Developer setting: allowed extensions are grouped below. SVG is excluded for active content/XSS;
// ICO is excluded because MIME/GD handling is inconsistent across servers.
function t2editor_default_upload_extensions(): array {
    return [
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
}

// Endpoint implementations may be included from a bootstrap function or a CMS template method.
// Publish the policy explicitly so helper functions never depend on the caller's local scope.
if (!isset($GLOBALS['t2editor_allowed_extensions']) || !is_array($GLOBALS['t2editor_allowed_extensions'])) {
    $GLOBALS['t2editor_allowed_extensions'] = t2editor_default_upload_extensions();
}
$t2editor_allowed_extensions =& $GLOBALS['t2editor_allowed_extensions'];

// MIME maps drive browser accept/response metadata only; server validation uses signatures without Fileinfo.
function get_ext_mime_map(): array {
    return [
        // 이미지
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'bmp'  => ['image/bmp','image/x-bmp','image/x-ms-bmp'],
        // 문서
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
        // 비디오
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
        // 압축
        'zip'  => ['application/zip','application/x-zip-compressed'],
        'rar'  => ['application/x-rar-compressed','application/vnd.rar'],
        '7z'   => ['application/x-7z-compressed'],
        'tar'  => ['application/x-tar'],
        'gz'   => ['application/gzip','application/x-gzip'],
        'bz2'  => ['application/x-bzip2'],
        // 오디오
        'mp3'  => ['audio/mpeg','audio/mp3'],
        'm4a'  => ['audio/mp4','audio/x-m4a'],
        'wav'  => ['audio/wav','audio/x-wav'],
        'flac' => ['audio/flac','audio/x-flac'],
        'aac'  => ['audio/aac'],
        'wma'  => ['audio/x-ms-wma'],
        // 텍스트 계열
        'json' => ['application/json','text/plain'],
        'xml'  => ['application/xml','text/xml'],
        'csv'  => ['text/csv','text/plain','application/csv'],
    ];
}

// Security: verify an allowed signature, then cross-check getimagesize type/dimensions/pixel limits.
// Executable text images and extension spoofing remain rejected.
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

// Developer setting: define T2EDITOR_ALLOWED_ORIGINS in t2_config.php; otherwise same-host is required.
// Respect X-Forwarded-Proto behind trusted proxies. POST without Origin is rejected; GET config reads may omit it.
function check_request_origin(): bool {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    // Security: POST/PUT/DELETE 등 데이터 변경 요청에서 Origin 이 비어있으면 거부
    if ($origin === '') {
        if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'OPTIONS') {
            return false;
        }
        return true; // GET 등 읽기 요청은 Origin 없어도 허용
    }

    if (defined('T2EDITOR_ALLOWED_ORIGINS') && is_array(T2EDITOR_ALLOWED_ORIGINS) && count(T2EDITOR_ALLOWED_ORIGINS) > 0) {
        return in_array($origin, T2EDITOR_ALLOWED_ORIGINS, true);
    }

    // 역방향 프록시가 X-Forwarded-Proto 를 설정한 경우 우선 참조
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        $proto = strtolower(trim(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]));
    } elseif (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        $proto = 'https';
    } else {
        $proto = 'http';
    }

    return $origin === $proto . '://' . $_SERVER['HTTP_HOST'];
}

// [공통-FILENAME] 원본 파일명 정제
function sanitize_original_name(string $filename): string {
    $filename = str_replace("\0", '', $filename);
    $filename = str_replace(['/', '\\', '..'], '', $filename);
    $filename = preg_replace('/[\x00-\x1F\x7F]/', '', $filename);

    if (t2_utf8_length($filename) > 255) {
        $ext  = pathinfo($filename, PATHINFO_EXTENSION);
        $base = t2_utf8_substr(pathinfo($filename, PATHINFO_FILENAME), 0, 240);
        $filename = $ext !== '' ? $base . '.' . $ext : $base;
    }
    return $filename !== '' ? $filename : 'unnamed_file';
}

// Security: validate content signatures for every allowed type.
// MP4/M4V accepts valid initial boxes used by iOS/QuickTime in addition to ftyp.
function verify_file_magic_bytes(string $tmp_path, string $file_ext): bool {
    $handle = fopen($tmp_path, 'rb');
    if (!$handle) return false;
    $header = fread($handle, 16);
    fclose($handle);
    if ($header === false || strlen($header) < 2) return false;

    switch ($file_ext) {
        // 이미지
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
        // 문서
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
        // 압축
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
        // 오디오
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
        // 비디오
        case 'mp4': case 'm4v':
            // Accept valid ISO BMFF leading boxes (ftyp, wide, free, mdat, moov, pdin, skip) used by real encoders.
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

// 확장자 헬퍼

function get_allowed_extensions($category = null): array {
    $policy = isset($GLOBALS['t2editor_allowed_extensions']) && is_array($GLOBALS['t2editor_allowed_extensions'])
        ? $GLOBALS['t2editor_allowed_extensions']
        : t2editor_default_upload_extensions();

    if ($category !== null && $category !== '') {
        return isset($policy[$category]) && is_array($policy[$category]) ? array_values($policy[$category]) : [];
    }

    $all = [];
    foreach ($policy as $exts) {
        if (is_array($exts)) $all = array_merge($all, $exts);
    }
    return array_values(array_unique($all));
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

// validate_upload_file(): filename/size/category are legacy checks; supplying $tmp_path adds signature and image-structure validation.
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

// 기타 헬퍼

function detect_file_type(string $filename): string {
    $t2editor_allowed_extensions = isset($GLOBALS['t2editor_allowed_extensions']) && is_array($GLOBALS['t2editor_allowed_extensions'])
        ? $GLOBALS['t2editor_allowed_extensions'] : t2editor_default_upload_extensions();
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

// get_js_config() is the single source for injected and endpoint upload settings.
// Keep maxSizeMB, extensions, accept and mimeMap keys stable for 10.4.0 plugins.
function get_js_config(): array {
    $t2editor_allowed_extensions = isset($GLOBALS['t2editor_allowed_extensions']) && is_array($GLOBALS['t2editor_allowed_extensions'])
        ? $GLOBALS['t2editor_allowed_extensions'] : t2editor_default_upload_extensions();

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

// Host-managed uploads are delegated through the adapter facade; validation remains host-neutral.
require_once __DIR__ . '/t2_cms.php';

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
