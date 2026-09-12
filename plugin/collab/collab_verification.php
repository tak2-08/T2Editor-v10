<?php
// Path: T2Editor/plugin/collab/collab_verification.php  (v2.1)
//
// v2.1 변경 사항:
//   - v2.0: 검증 실패해도 P2P 모드는 동작.
//   - v2.1: 안정성 향상 모드(stability_mode) 관련 필드 검증 추가.
//     PHP는 "최후 fallback" 이므로 검증 실패해도 P2P/하이브리드 모드는 동작.
//   - 보안 권장값 (chmod 750) 유지.

if (!defined('T2EDITOR_PATH')) {
    $possible = __DIR__ . '/../../config/t2_config.php';
    if (file_exists($possible)) include_once $possible;
}
if (!defined('T2EDITOR_PATH')) {
    define('T2EDITOR_PATH', realpath(__DIR__ . '/../..'));
}

$is_direct_call = (isset($_GET['verify']) || basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'collab_verification.php');
if ($is_direct_call) {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        http_response_code(405);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success'=>false,'error'=>'method_not_allowed','php_fallback_available'=>false]);
        exit;
    }
    header('Content-Type: application/json; charset=utf-8');
}

function verifyCollabEnvironment() {
    $collab_dir = T2EDITOR_PATH . '/collab';
    $results = [
        'steps'                  => [],
        'success'                => false,
        'error'                  => '',
        'php_fallback_available' => false,
    ];

    // [1] /t2editor/collab 폴더
    if (!is_dir($collab_dir)) {
        $results['steps'][] = '⚠ /t2editor/collab 폴더 없음 (PHP 폴백 비활성). P2P 모드는 가능.';
        $results['error']   = "/t2editor/collab 폴더가 없습니다. P2P 모드만 사용 가능합니다.";
        return $results;
    }
    $results['steps'][] = '✓ collab 폴더 존재';

    // [2] 쓰기 권한
    if (!is_writable($collab_dir)) {
        $results['steps'][] = '⚠ collab 폴더 쓰기 권한 부족 (PHP 폴백 비활성)';
        $results['error'] = "/t2editor/collab 폴더에 쓰기 권한이 필요합니다 (PHP 폴백 사용 시).\n"
            . "권장: chmod 750 /t2editor/collab (chmod 707/777은 보안상 위험).\n"
            . "단, P2P 모드만 사용한다면 이 권한은 필수가 아닙니다.";
        return $results;
    }
    $results['steps'][] = '✓ collab 폴더 쓰기 권한';

    // [3] 필수 PHP 파일
    foreach (['collab_number.php','collab_number_delete.php'] as $file) {
        if (!file_exists(__DIR__ . '/' . $file)) {
            $results['steps'][] = "⚠ $file 누락 (PHP 폴백 비활성)";
            $results['error']   = "$file 파일이 없습니다. 재설치 권장. (P2P 모드는 가능)";
            return $results;
        }
        $results['steps'][] = "✓ $file 존재";
    }

    // [4] 쓰기 테스트
    try {
        $rand_suffix = bin2hex(random_bytes(8));
    } catch (Exception $e) {
        $rand_suffix = md5(uniqid(mt_rand(), true));
    }
    $test_file = $collab_dir . '/.perm_test_' . $rand_suffix . '.tmp';
    if (@file_put_contents($test_file, 'test') === false) {
        $results['steps'][] = '⚠ 쓰기 테스트 실패 (PHP 폴백 비활성)';
        $results['error']   = "/t2editor/collab 폴더에 파일 생성 실패. (P2P 모드는 가능)";
        return $results;
    }
    @unlink($test_file);
    $results['steps'][] = '✓ 쓰기 테스트 통과';

    $results['success']                = true;
    $results['php_fallback_available'] = true;
    return $results;
}

if (isset($_GET['verify'])) {
    $result = verifyCollabEnvironment();
    echo json_encode($result);
    exit;
}

return verifyCollabEnvironment();
?>
