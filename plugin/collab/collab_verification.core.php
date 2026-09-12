<?php
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }
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
    $collab_dir = defined('T2EDITOR_COLLAB_PATH')
        ? T2EDITOR_COLLAB_PATH
        : rtrim(defined('T2EDITOR_DB_PATH') ? T2EDITOR_DB_PATH : (defined('T2EDITOR_DATA_PATH') ? T2EDITOR_DATA_PATH . '/t2editor_db' : T2EDITOR_PATH . '/data/t2editor_db'), '/\\') . '/collab';
    $results = [
        'steps'                  => [],
        'success'                => false,
        'error'                  => '',
        'php_fallback_available' => false,
    ];

    // [1] 격리된 T2Editor DB의 /collab 폴더
    if (!is_dir($collab_dir)) {
        $results['steps'][] = '⚠ T2Editor DB/collab folder missing (PHP fallback disabled). P2P mode still available.';
        $results['error']   = "The T2Editor DB/collab folder is missing. Only P2P mode is available.";
        return $results;
    }
    $results['steps'][] = '✓ collab folder exists';

    // [2] 쓰기 권한
    if (!is_writable($collab_dir)) {
        $results['steps'][] = '⚠ Insufficient write permission on collab folder (PHP fallback disabled)';
        $results['error'] = "The T2Editor DB/collab folder requires write permission (when using PHP fallback).\n"
            . "Recommended: chmod 750 " . $collab_dir . " (chmod 707/777 is a security risk).\n"
            . "However, this permission is not required if you only use P2P mode.";
        return $results;
    }
    $results['steps'][] = '✓ collab folder write permission';

    // [3] 필수 PHP 파일
    foreach (['collab_number.php','collab_number_delete.php'] as $file) {
        if (!file_exists(__DIR__ . '/' . $file)) {
            $results['steps'][] = "⚠ $file missing (PHP fallback disabled)";
            $results['error']   = "$file is missing. Reinstall recommended. (P2P mode still available)";
            return $results;
        }
        $results['steps'][] = "✓ $file exists";
    }

    // [4] 쓰기 테스트
    try {
        $rand_suffix = bin2hex(random_bytes(8));
    } catch (Exception $e) {
        $rand_suffix = md5(uniqid(mt_rand(), true));
    }
    $test_file = $collab_dir . '/.perm_test_' . $rand_suffix . '.tmp';
    if (@file_put_contents($test_file, 'test') === false) {
        $results['steps'][] = '⚠ Write test failed (PHP fallback disabled)';
        $results['error']   = "Failed to create a file in the T2Editor DB/collab folder. (P2P mode still available)";
        return $results;
    }
    @unlink($test_file);
    $results['steps'][] = '✓ Write test passed';

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
