<?php
/** T2Editor first-run guide API. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

require_once dirname(__DIR__) . '/editor.lib.php';

function t2_first_run_json(bool $ok, $data = null, string $message = '', int $status = 200): void
{
    http_response_code($status);
    echo json_encode(array('ok' => $ok, 'data' => $data, 'message' => $message), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$body = array();
if ($method === 'POST') {
    $decoded = json_decode((string)file_get_contents('php://input'), true);
    $body = is_array($decoded) ? $decoded : $_POST;
}
$token = (string)($_GET['token'] ?? ($body['token'] ?? ($_SERVER['HTTP_X_T2_FIRST_RUN_TOKEN'] ?? '')));
if (!t2_first_run_validate_token($token)) {
    t2_first_run_json(false, null, '설치 안내 인증 정보가 없거나 만료되었습니다.', 403);
}

if ($method === 'GET') {
    t2_first_run_json(true, t2_first_run_status_payload());
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    t2_first_run_json(false, null, '허용되지 않은 요청 방식입니다.', 405);
}

if (function_exists('check_request_origin') && !check_request_origin()) {
    t2_first_run_json(false, null, '요청 출처 확인에 실패했습니다.', 403);
}
$action = (string)($body['action'] ?? '');

if ($action === 'dismiss_duplicate_key_notice') {
    t2_first_run_mark_duplicate_key_notice();
    t2_first_run_json(true, null, 'admin/t2admin.key.txt 삭제 안내를 확인했습니다.');
}

if ($action !== 'confirm') {
    t2_first_run_json(false, null, '알 수 없는 요청입니다.', 400);
}
if (($body['read_complete'] ?? false) !== true || ($body['acknowledged'] ?? false) !== true) {
    t2_first_run_json(false, null, '안내를 끝까지 읽고 확인 체크박스를 선택하세요.', 409);
}

$status = t2_first_run_status_payload();
if (empty($status['admin']['key_active'])) {
    t2_first_run_json(false, $status, '먼저 admin/t2admin.key.txt를 admin/t2admin.key로 이름 변경하세요.', 409);
}
if (empty($status['admin']['auth_ready'])) {
    t2_first_run_json(false, $status, '관리자 페이지에서 관리자 비밀번호를 먼저 설정하세요.', 409);
}
if (empty($status['permissions']['data_mode_ok'])) {
    t2_first_run_json(false, $status, 'T2Editor 공용 데이터 디렉터리 권한을 707로 설정하세요.', 409);
}
if (empty($status['can_confirm'])) {
    t2_first_run_json(false, $status, 'T2Editor 데이터 디렉터리를 준비하거나 쓰기 권한을 확인하세요.', 409);
}
if (!t2_first_run_write_acknowledgement()) {
    t2_first_run_json(false, $status, 't2editor_db/에 최초 설치 확인 상태를 저장하지 못했습니다.', 500);
}

$status['required'] = false;
t2_first_run_json(true, $status, '최초 설치 안내 확인 상태를 저장했습니다.');
