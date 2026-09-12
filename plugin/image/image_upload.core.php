<?php
// Path: T2Editor/plugin/image/image_upload.core.php
// Developer note: image 엔드포인트 입력명·응답 JSON·보안 허용목록은 클라이언트 코드와 함께 수정한다.
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }

ob_start();

// 호스트가 같은 요청에서 다른 업로드 모듈을 함께 로드하더라도 전역 함수명이
// 충돌하지 않도록 이미지 엔드포인트 전용 이름을 사용한다.
$GLOBALS['t2image_response_sent'] = false;
function t2image_send_json_response(array $data, int $status = 200): void {
    $GLOBALS['t2image_response_sent'] = true;
    if (ob_get_level() > 0) ob_clean();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// GD 함수 누락·스토리지 예외 등 예상하지 못한 런타임 오류도 HTML 500 페이지나
// 빈 응답으로 흘리지 않는다. 상세 내용은 서버 로그에만 남기고 클라이언트에는
// 항상 해석 가능한 JSON을 보낸다.
set_exception_handler(function (Throwable $error): void {
    error_log('[T2Editor image upload] ' . $error->getMessage());
    t2image_send_json_response([
        'success' => false,
        'message' => 'Image upload could not be completed on this server.',
        'failures' => [['reason' => 'server_runtime_error']],
    ], 500);
});
register_shutdown_function(function (): void {
    if (!empty($GLOBALS['t2image_response_sent'])) return;
    $error = error_get_last();
    if (!$error || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
    error_log('[T2Editor image upload] ' . ($error['message'] ?? 'fatal error'));
    while (ob_get_level() > 0) @ob_end_clean();
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => 'Image upload could not be completed on this server.',
        'failures' => [['reason' => 'server_fatal_error']],
    ], JSON_UNESCAPED_UNICODE);
});

// include 경로 분기
// upload_config.php provides common validation and the host-adapter delegation facade.
include_once __DIR__ . '/../../config/upload_config.php';

// Host adapters may own file storage and return the endpoint response.
$delegatedUpload = function_exists('t2editor_cms_upload_delegate')
    ? t2editor_cms_upload_delegate('bf_file', 'image')
    : null;
if (is_array($delegatedUpload) && isset($delegatedUpload['body']) && is_array($delegatedUpload['body'])) {
    t2image_send_json_response($delegatedUpload['body'], isset($delegatedUpload['status']) ? (int)$delegatedUpload['status'] : 200);
}

// Default storage path is resolved by the selected host adapter; standalone remains the fallback.
require_once __DIR__ . '/../../config/t2_config.php';

// Origin 검증 — upload_config.php 의 check_request_origin() 사용
if (!check_request_origin()) {
    t2image_send_json_response(['success' => false, 'message' => 'Invalid access.']);
}

// uid 정제
// 이전 코드는 숫자만 허용(preg_replace '/[^0-9]/')했기 때문에
// JS 에서 UUID·hex·alphanumeric uid 를 전송하면 스트립 후 빈 문자열 또는
// 20자 초과가 되어 "잘못된 접근입니다." 를 반환했다.
// 이제 안전한 alphanumeric + 하이픈·언더스코어 을 허용하고 최대 64자로 제한한다.
$raw_uid = isset($_POST['uid']) ? $_POST['uid'] : '';
$uid     = preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw_uid);
if (!$uid || strlen($uid) > 64) {
    t2image_send_json_response(['success' => false, 'message' => 'Invalid access.']);
}

// 업로드 경로
$date_folder = date('ymd');
$upload_dir  = T2EDITOR_DATA_PATH . '/' . $date_folder;
$upload_url  = T2EDITOR_DATA_URL  . '/' . $date_folder;

if (!is_dir($upload_dir)) {
    if (!@mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true)) {
        t2image_send_json_response(['success' => false, 'message' => 'Cannot create upload directory.']);
    }
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

if (!isset($_FILES['bf_file'])) {
    t2image_send_json_response(['success' => false, 'message' => 'No file to upload.']);
}

// 픽셀 수·메모리 사전 검사 헬퍼
function t2image_commit_file(string $source, string $destination): bool {
    if (@rename($source, $destination)) return true;
    if (!@copy($source, $destination)) return false;
    if (!@unlink($source)) {
        @unlink($destination);
        return false;
    }
    return is_file($destination);
}

function check_image_resource_limit(int $width, int $height): bool {
    $max_pixels = defined('T2EDITOR_MAX_IMAGE_PIXELS') ? (int)T2EDITOR_MAX_IMAGE_PIXELS : 50_000_000;
    if ($width * $height > $max_pixels) return false;

    $mem_str = ini_get('memory_limit');
    if ($mem_str !== '-1') {
        $mem_val  = (int)$mem_str;
        $mem_unit = strtoupper(substr(trim($mem_str), -1));
        if ($mem_unit === 'G')      $mem_val *= 1024 * 1024 * 1024;
        elseif ($mem_unit === 'M')  $mem_val *= 1024 * 1024;
        elseif ($mem_unit === 'K')  $mem_val *= 1024;

        $estimated = (int)($width * $height * 4 * 1.5);
        if ((memory_get_usage(true) + $estimated) > $mem_val * 0.80) return false;
    }
    return true;
}

$files           = $_FILES['bf_file'];
$file_count      = is_array($files['name']) ? count($files['name']) : 1;
$webp_quality    = 85;
$uploaded_files  = [];
$failure_details = [];

// SVG·ICO 이중 차단 (upload_config.php allowlist 외 직접 요청 방어)
const BLOCKED_IMAGE_EXTENSIONS = ['svg', 'ico'];

for ($i = 0; $i < $file_count; $i++) {
    if (is_array($files['name'])) {
        $filename   = $files['name'][$i];
        $tmp_name   = $files['tmp_name'][$i];
        $file_size  = $files['size'][$i];
        $file_error = $files['error'][$i];
    } else {
        $filename   = $files['name'];
        $tmp_name   = $files['tmp_name'];
        $file_size  = $files['size'];
        $file_error = $files['error'];
    }

    $filename          = str_replace("\0", '', $filename);
    $safe_display_name = htmlspecialchars(basename($filename), ENT_QUOTES, 'UTF-8');

    if ($file_error !== UPLOAD_ERR_OK || empty($filename) || !is_uploaded_file($tmp_name)) {
        if (!empty($filename)) {
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'upload_error', 'message' => 'PHP upload error'];
        }
        continue;
    }

    $file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

    // SVG·ICO 명시적 거부
    if (in_array($file_ext, BLOCKED_IMAGE_EXTENSIONS, true)) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'blocked_extension', 'message' => $file_ext . ' file is not allowed.'];
        continue;
    }

    // 확장자+크기 사전 검사 (move 전 빠른 실패)
    // tmp_path 없이 호출 → 확장자+크기만 검사
    $pre_check = validate_upload_file($filename, $file_size, 'image');
    if (!$pre_check['success']) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'validation_failed', 'message' => $pre_check['message']];
        continue;
    }

    // 임시 파일로 이동
    $temp_random   = bin2hex(random_bytes(8));
    $temp_filepath = $upload_dir . '/tmp_' . $temp_random . '.' . $file_ext;

    if (!move_uploaded_file($tmp_name, $temp_filepath)) {
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'move_failed', 'message' => 'Failed to move file.'];
        continue;
    }

    // 콘텐츠 검증 (move 후 MIME + 매직바이트)
    $content_check = validate_upload_file($filename, $file_size, 'image', $temp_filepath);
    if (!$content_check['success']) {
        @unlink($temp_filepath);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'content_check_failed', 'message' => $content_check['message']];
        continue;
    }

    // 실제 이미지 타입 확인
    $image_info = @getimagesize($temp_filepath);
    if (!$image_info) {
        @unlink($temp_filepath);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'not_image', 'message' => 'Not a valid image file.'];
        continue;
    }

    $img_width  = $image_info[0];
    $img_height = $image_info[1];
    $img_type   = $image_info[2];

    // 픽셀 수·메모리 사전 검사
    if (!check_image_resource_limit($img_width, $img_height)) {
        @unlink($temp_filepath);
        $max_mp = number_format(defined('T2EDITOR_MAX_IMAGE_PIXELS') ? T2EDITOR_MAX_IMAGE_PIXELS : 50_000_000);
        $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'image_too_large', 'message' => "Image resolution too large. (max {$max_mp} pixels)"];
        continue;
    }

    // GIF는 원본을 그대로 보존한다. GD의 imagecreatefromgif() → imagewebp() 경로는
    // 첫 프레임만 저장하므로 애니메이션이 사라진다. 콘텐츠 검증과 픽셀 제한을 이미
    // 통과했으므로 안전한 난수 파일명으로 이동하면 된다.
    if ($img_type === IMAGETYPE_GIF) {
        $save_filename = bin2hex(random_bytes(16)) . '.gif';
        $save_filepath = $upload_dir . '/' . $save_filename;
        if (t2image_commit_file($temp_filepath, $save_filepath)) {
            @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = ['url' => $upload_url . '/' . $save_filename, 'width' => $img_width, 'height' => $img_height];
        } else {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'rename_failed', 'message' => 'Failed to save GIF file.'];
        }
        continue;
    }

    // WebP 이미지는 변환 없이 이동
    if (defined('IMAGETYPE_WEBP') && $img_type === IMAGETYPE_WEBP) {
        $save_filename = bin2hex(random_bytes(16)) . '.webp';
        $save_filepath = $upload_dir . '/' . $save_filename;
        if (t2image_commit_file($temp_filepath, $save_filepath)) {
            @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = ['url' => $upload_url . '/' . $save_filename, 'width' => $img_width, 'height' => $img_height];
        } else {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'rename_failed', 'message' => 'Failed to save file.'];
        }
        continue;
    }

    // GD/WebP가 없는 서버에서는 존재하지 않는 imagecreatefrom*() 호출이 PHP를
    // 즉시 중단시켜 HTTP 500을 만들었다. 파일은 이 지점까지 확장자·매직바이트·
    // 실제 이미지 구조·픽셀 제한을 모두 통과했으므로, 변환 기능 자체가 없는
    // 환경에서는 검증된 원본을 실제 이미지 타입 확장자로 안전하게 저장한다.
    $decoder = null;
    $safe_original_ext = null;
    switch ($img_type) {
        case IMAGETYPE_JPEG: $decoder = 'imagecreatefromjpeg'; $safe_original_ext = 'jpg'; break;
        case IMAGETYPE_PNG:  $decoder = 'imagecreatefrompng';  $safe_original_ext = 'png'; break;
        case IMAGETYPE_BMP:  $decoder = 'imagecreatefrombmp';  $safe_original_ext = 'bmp'; break;
    }

    if ($decoder === null || !function_exists($decoder) || !function_exists('imagewebp')) {
        if ($safe_original_ext === null) {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'unsupported_image_type', 'message' => 'Unsupported image format.'];
            continue;
        }
        $org_save = bin2hex(random_bytes(16)) . '.' . $safe_original_ext;
        $org_path = $upload_dir . '/' . $org_save;
        if (t2image_commit_file($temp_filepath, $org_path)) {
            @chmod($org_path, T2EDITOR_FILE_PERMISSION);
            $uploaded_files[] = ['url' => $upload_url . '/' . $org_save, 'width' => $img_width, 'height' => $img_height];
        } else {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'fallback_save_failed', 'message' => 'Failed to save file.'];
        }
        continue;
    }

    // GD 리소스 생성
    $save_filename = bin2hex(random_bytes(16)) . '.webp';
    $save_filepath = $upload_dir . '/' . $save_filename;
    $src_image     = null;

    switch ($img_type) {
        case IMAGETYPE_JPEG: $src_image = @$decoder($temp_filepath); break;
        case IMAGETYPE_PNG:
            $src_image = @$decoder($temp_filepath);
            if ($src_image) { imagepalettetotruecolor($src_image); imagealphablending($src_image, false); imagesavealpha($src_image, true); }
            break;
        case IMAGETYPE_BMP: $src_image = @$decoder($temp_filepath); break;
        default:
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'unsupported_image_type', 'message' => 'Unsupported image format.'];
            continue 2;
    }

    $conversion_success = false;

    if ($src_image) {
        $max_dimension = 9000;
        if ($img_width > $max_dimension || $img_height > $max_dimension) {
            $ratio      = min($max_dimension / $img_width, $max_dimension / $img_height);
            $new_width  = (int)floor($img_width  * $ratio);
            $new_height = (int)floor($img_height * $ratio);

            $resized = imagecreatetruecolor($new_width, $new_height);
            if ($img_type === IMAGETYPE_PNG) {
                imagealphablending($resized, false);
                imagesavealpha($resized, true);
                imagefill($resized, 0, 0, imagecolorallocatealpha($resized, 255, 255, 255, 127));
            }
            imagecopyresampled($resized, $src_image, 0, 0, 0, 0, $new_width, $new_height, $img_width, $img_height);
            imagedestroy($src_image);
            $src_image = $resized;
            $img_width  = $new_width;
            $img_height = $new_height;
        }

        if (function_exists('imagewebp')) {
            $conversion_success = @imagewebp($src_image, $save_filepath, $webp_quality);
        }
        imagedestroy($src_image);
    }

    if ($conversion_success) {
        @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
        $uploaded_files[] = ['url' => $upload_url . '/' . $save_filename, 'width' => $img_width, 'height' => $img_height];
        @unlink($temp_filepath);
    } else {
        // T2EDITOR_STRICT_WEBP_CONVERSION (upload_config.php 에서 정의)
        $strict = !defined('T2EDITOR_STRICT_WEBP_CONVERSION') || T2EDITOR_STRICT_WEBP_CONVERSION;

        if ($strict) {
            @unlink($temp_filepath);
            $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'webp_conversion_failed', 'message' => 'WebP conversion failed.'];
        } else {
            $org_save  = bin2hex(random_bytes(16)) . '.' . $file_ext;
            $org_path  = $upload_dir . '/' . $org_save;
            if (t2image_commit_file($temp_filepath, $org_path)) {
                @chmod($org_path, T2EDITOR_FILE_PERMISSION);
                $uploaded_files[] = ['url' => $upload_url . '/' . $org_save, 'width' => $img_width, 'height' => $img_height];
            } else {
                @unlink($temp_filepath);
                $failure_details[] = ['filename' => $safe_display_name, 'reason' => 'fallback_save_failed', 'message' => 'Failed to save file.'];
            }
        }
    }
}

if (empty($uploaded_files)) {
    $first_msg = !empty($failure_details) ? $failure_details[0]['message'] : 'Error during image processing.';
    t2image_send_json_response(['success' => false, 'message' => $first_msg, 'failures' => $failure_details]);
}

t2image_send_json_response(['success' => true, 'files' => $uploaded_files, 'failures' => $failure_details]);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
