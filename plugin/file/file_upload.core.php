<?php
// Path: T2Editor/plugin/file/file_upload.core.php
// Developer note: file 엔드포인트 입력명·응답 JSON·보안 허용목록은 클라이언트 코드와 함께 수정한다.
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }

// [FILEU-06] 출력 버퍼링 시작
ob_start();

function send_json_response(array $data, int $status = 200): void {
    ob_clean();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// include 경로 분기
// upload_config.php provides common validation and the host-adapter delegation facade.
include_once __DIR__ . '/../../config/upload_config.php';

// Host adapters may own file storage and return the endpoint response.
$delegatedUpload = function_exists('t2editor_cms_upload_delegate')
    ? t2editor_cms_upload_delegate('bf_file', 'file')
    : null;
if (is_array($delegatedUpload) && isset($delegatedUpload['body']) && is_array($delegatedUpload['body'])) {
    send_json_response($delegatedUpload['body'], isset($delegatedUpload['status']) ? (int)$delegatedUpload['status'] : 200);
}

// Default storage path is resolved by the selected host adapter; standalone remains the fallback.
require_once __DIR__ . '/../../config/t2_config.php';

// Origin 검증 — upload_config.php 의 check_request_origin() 사용
if (!check_request_origin()) {
    send_json_response(['success' => false, 'message' => 'Invalid access.']);
}

// uid 정제
// 이전 코드는 uid 가 빈 문자열이거나 길이·문자 검증에 실패하면
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

// 통합 검증
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
