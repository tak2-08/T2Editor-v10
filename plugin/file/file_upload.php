<?php
//Path: T2Editor/plugin/file/file_upload.php

// [FILEU-06] 출력 버퍼링 시작
ob_start();

function send_json_response(array $data): void {
    ob_clean();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── include 경로 분기 ─────────────────────────────────────────────────────
// upload_config.php 에 check_request_origin(), sanitize_original_name(),
// verify_file_magic_bytes(), 강화된 validate_upload_file() 이 모두 정의됨.
//
// [FIX] 그누보드5 common.php 탐색은 WordPress/Rhymix 위임 분기 판별 "이후"로
// 옮겼다 — image_upload.php 와 동일한 이유(불필요한 I/O + include 리스크 제거).
// ──────────────────────────────────────────────────────────────────────────
include_once __DIR__ . '/../../config/upload_config.php';

// ── [WORDPRESS] 미디어 라이브러리로 위임 ─────────────────────────────────
if (t2editor_is_wordpress()) {
    $wp = t2editor_wp_handle_upload('bf_file');
    if (!$wp['success']) {
        send_json_response(['success' => false, 'message' => $wp['message']]);
    }

    $att = $wp['attachment'];
    send_json_response([
        'success' => true,
        'file'    => [
            'url'           => $att['url'] ?? '',
            'original_name' => $att['filename'] ?? ($att['name'] ?? 'file'),
            'size'          => intval($att['filesizeInBytes'] ?? 0),
            'type'          => strtolower(pathinfo($att['filename'] ?? '', PATHINFO_EXTENSION)),
        ],
    ]);
}

// ── [RHYMIX] 네이티브 파일 모듈로 위임 ───────────────────────────────────
// image_upload.php 와 동일한 이유로 Rhymix 환경에서는 자체 저장을 건너뛰고
// Rhymix 파일 모듈로 업로드를 위임한다. 응답은 file.js 가 기대하는
// {success, file:{url, original_name, size, type}} 형태로 변환해서 돌려준다.
if (t2editor_is_rhymix()) {
    if (!check_request_origin()) {
        send_json_response(['success' => false, 'message' => 'Invalid access.']);
    }

    $proxy = t2editor_rhymix_proxy_upload('bf_file');
    if (!$proxy['success']) {
        send_json_response(['success' => false, 'message' => $proxy['message']]);
    }

    $rx = $proxy['raw'];
    $original_name = $rx['source_filename'] ?? ($rx['uploaded_filename'] ?? 'file');
    $url = $rx['download_url'] ?? ($rx['url'] ?? '');

    send_json_response([
        'success' => true,
        'file'    => [
            'url'           => $url,
            'original_name' => $original_name,
            'size'          => intval($rx['file_size'] ?? 0),
            'type'          => strtolower(pathinfo($original_name, PATHINFO_EXTENSION)),
        ],
        'rhymix'  => [
            'file_srl' => (int)($rx['file_srl'] ?? 0),
            'upload_target_srl' => (int)($rx['upload_target_srl'] ?? 0),
            'source_filename' => (string)$original_name,
            'download_url' => (string)$url,
            'mime_type' => (string)($rx['mime_type'] ?? ''),
        ],
    ]);
}

// ── [GNUBOARD5/독립형] common.php 지연 로딩 ─────────────────────────────
// 이 지점에 도달했다면 WordPress·Rhymix 둘 다 아니므로, 그누보드5 플러그인
// 여부를 판별하기 위해 common.php 를 찾는다(있으면 로드, 없으면 독립형).
$common_path = __DIR__ . '/../../../../../common.php';
if (is_file($common_path)) {
    include_once $common_path;
}

// ── Gnuboard5 플러그인 경로 검증 후 상수 정의 ────────────────────────────
//
// [FIX] 기존 코드는 _GNUBOARD_ 정의 여부만 보고 T2EDITOR_PATH 를
//        G5_PLUGIN_PATH.'/editor/t2editor' 로 하드코딩했다.
//
//        문제 1: T2Editor 가 표준 경로 외 위치에 설치된 경우 경로 불일치
//        문제 2: 디렉토리 깊이가 우연히 맞아 common.php 를 발견한 standalone
//                설치에서도 Gnuboard5 모드로 동작 → G5_DATA_PATH 에 파일 저장
//
//        수정: __DIR__ 기준으로 T2Editor 실제 루트를 계산하고,
//               그 경로가 G5_PLUGIN_PATH 하위인지 realpath 로 검증한다.
//               검증 실패 시 t2_config.php(BASIC SYSTEM) 로 폴백한다.
// ─────────────────────────────────────────────────────────────────────────
$_t2_use_gnuboard = false;

if (defined('_GNUBOARD_')) {
    // __DIR__ = T2Editor/plugin/file/ → 2단계 상위 = T2Editor 루트
    $_t2_actual_root = realpath(__DIR__ . '/../../');
    $_t2_g5_plugin   = realpath(G5_PLUGIN_PATH);

    if ($_t2_actual_root !== false && $_t2_g5_plugin !== false) {
        $_t2_use_gnuboard = str_starts_with(
            str_replace('\\', '/', $_t2_actual_root) . '/',
            str_replace('\\', '/', $_t2_g5_plugin)   . '/'
        );
    }
}

if ($_t2_use_gnuboard) {
    // G5_PLUGIN_URL 기준 URL 동적 계산 (하드코딩 제거)
    $_t2_relative = substr(
        str_replace('\\', '/', $_t2_actual_root),
        strlen(rtrim(str_replace('\\', '/', $_t2_g5_plugin), '/'))
    );

    if (!defined('T2EDITOR_PATH')) {
        define('T2EDITOR_PATH',            $_t2_actual_root);
        define('T2EDITOR_URL',             G5_PLUGIN_URL . $_t2_relative);
        define('T2EDITOR_DATA_PATH',       G5_DATA_PATH  . '/editor');
        define('T2EDITOR_DATA_URL',        G5_DATA_URL   . '/editor');
        define('T2EDITOR_DIR_PERMISSION',  G5_DIR_PERMISSION);
        define('T2EDITOR_FILE_PERMISSION', G5_FILE_PERMISSION);
    }

    unset($_t2_actual_root, $_t2_g5_plugin, $_t2_relative, $_t2_use_gnuboard);
} else {
    // _GNUBOARD_ 미정의 또는 G5_PLUGIN_PATH 검증 실패 → BASIC SYSTEM
    unset($_t2_actual_root, $_t2_g5_plugin, $_t2_use_gnuboard);
    require __DIR__ . '/../../config/t2_config.php';
}

// Origin 검증 — upload_config.php 의 check_request_origin() 사용
if (!check_request_origin()) {
    send_json_response(['success' => false, 'message' => 'Invalid access.']);
}

// ── uid 정제 ──────────────────────────────────────────────────────────────
// [FIX] 이전 코드는 uid 가 빈 문자열이거나 길이·문자 검증에 실패하면
//        업로드를 즉시 거부했다. 그러나 uid 는 서버 내부 어디에도 저장·사용되지
//        않는 단순 세션 식별 힌트에 불과하다.
//
//        일부 브라우저·환경에서 FormData 전달 타이밍 차이로 uid 가 비어있거나
//        예상치 못한 값으로 수신될 수 있으므로, 검증 실패 시 업로드를 차단하는
//        대신 서버에서 타임스탬프로 대체한다.
//
//        허용 문자: 영문 대소문자, 숫자, 하이픈(-), 밑줄(_)
//        최대 길이: 64자 (초과 시 잘라냄)
//        빈 문자열·전부 제거된 경우: time() 으로 대체
// ──────────────────────────────────────────────────────────────────────────
$raw_uid = isset($_POST['uid']) ? $_POST['uid'] : '';
$uid     = preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw_uid);
if (!$uid) {
    $uid = (string)time();
} elseif (strlen($uid) > 64) {
    $uid = substr($uid, 0, 64);
}

// 업로드 경로
$folder_name = 't2editor_' . date('Ymd');
$upload_dir  = T2EDITOR_DATA_PATH . '/' . $folder_name;
$upload_url  = T2EDITOR_DATA_URL  . '/' . $folder_name;

if (!is_dir($upload_dir)) {
    @mkdir($upload_dir, T2EDITOR_DIR_PERMISSION, true);
    @chmod($upload_dir, T2EDITOR_DIR_PERMISSION);
}

if (!isset($_FILES['bf_file']) || empty($_FILES['bf_file']['name'])) {
    send_json_response(['success' => false, 'message' => 'No file.']);
}

// PHP 업로드 에러 코드
$upload_error_messages = [
    UPLOAD_ERR_INI_SIZE   => 'File exceeds server size limit.',
    UPLOAD_ERR_FORM_SIZE  => 'File exceeds form size limit.',
    UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded.',
    UPLOAD_ERR_NO_FILE    => 'No file.',
    UPLOAD_ERR_NO_TMP_DIR => 'Temporary directory not found.',
    UPLOAD_ERR_CANT_WRITE => 'Failed to save file.',
    UPLOAD_ERR_EXTENSION  => 'A PHP extension stopped the upload.',
];
$upload_err_code = $_FILES['bf_file']['error'];
if ($upload_err_code !== UPLOAD_ERR_OK) {
    $err_msg = $upload_error_messages[$upload_err_code] ?? 'An error occurred during file upload.';
    send_json_response(['success' => false, 'message' => $err_msg]);
}

$file     = $_FILES['bf_file'];
$tmp_path = $file['tmp_name'];

// 파일명 정제 — upload_config.php 의 sanitize_original_name() 사용
$filename = sanitize_original_name($file['name']);
$file_ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

// ── 통합 검증 ────────────────────────────────────────────────────────────
$allowed_categories = ['document', 'video', 'other'];
$validation_result  = validate_upload_file($filename, $file['size'], $allowed_categories, $tmp_path);

if (!$validation_result['success']) {
    send_json_response(['success' => false, 'message' => $validation_result['message']]);
}

// 예측 불가능한 저장 파일명
$save_filename = bin2hex(random_bytes(16)) . '.' . $file_ext;
$save_filepath = $upload_dir . '/' . $save_filename;

if (move_uploaded_file($tmp_path, $save_filepath)) {
    @chmod($save_filepath, T2EDITOR_FILE_PERMISSION);
    send_json_response([
        'success' => true,
        'file'    => [
            'url'           => $upload_url . '/' . $save_filename,
            'original_name' => $filename,
            'size'          => $file['size'],
            'type'          => $file_ext,
        ],
    ]);
} else {
    send_json_response(['success' => false, 'message' => 'File upload failed.']);
}
