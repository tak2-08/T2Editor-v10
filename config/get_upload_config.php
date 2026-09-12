<?php
//Path: T2Editor/config/get_upload_config.php

header('Content-Type: application/json; charset=utf-8');

// ────────────────────────────────────────────────────────────────
// [BUG FIX] check_request_origin() 중복 선언 제거
//
// 이전 코드: 이 파일에 check_request_origin()를 인라인으로 정의한 뒤
//   include_once 'upload_config.php'를 호출했다.
//   upload_config.php에도 동일한 함수가 정의되어 있으므로
//   같은 PHP 프로세스에서 두 파일이 모두 로드되면
//   "Cannot redeclare check_request_origin()" Fatal Error가 발생했다.
//
// 수정: upload_config.php를 먼저 포함해 함수를 확보하고,
//   이 파일의 인라인 정의를 완전히 제거한다.
//   Origin 검증 로직(allowlist, 폴백)은 upload_config.php의 구현을 따른다.
// ────────────────────────────────────────────────────────────────

// [BUG-FIX] 상대 경로 'upload_config.php' 는 PHP 의 현재 작업 디렉터리(cwd) 기준으로
// 해석된다. 이 스크립트가 브라우저에서 직접 요청될 때는 대개 문제가 없지만,
// 다른 라우터/프레임워크(그누보드5 커스텀 라우팅, CLI 배치, 다른 스크립트에서의
// include 등)를 거쳐 실행되면 cwd 가 이 파일의 위치와 달라질 수 있어
// "Failed opening required 'upload_config.php'" 로 요청 전체가 깨질 수 있다.
// __DIR__ 을 사용하면 실행 경로와 무관하게 항상 이 파일과 같은 디렉터리를 참조한다.
include_once __DIR__ . '/upload_config.php';

if (!check_request_origin()) {
    http_response_code(403);
    echo json_encode(['error' => 'Access denied']);
    exit;
}

$config = get_js_config();

echo json_encode($config);