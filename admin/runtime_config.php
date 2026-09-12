<?php
/**
 * T2Editor Admin — Runtime Config Endpoint
 * Path: t2editor/admin/runtime_config.php
 *
 * extend/js/t2admin_runtime.js 가 매 페이지 로드마다 호출하는 읽기 전용 공개 엔드포인트.
 * extend/php/t2admin_settings_loader.php 가 data/admin_settings.json 을 매 요청마다
 * 직접 읽는 것과 동일한 패턴 — 저장 시점에 별도 파일을 굽지 않고, 항상 같은 데이터
 * 파일을 그 자리에서 읽어 반환한다.
 *
 * 노출 데이터는 아이콘·툴바 그룹 구성뿐이며, 이는 어차피 렌더링된 페이지에서
 * 누구나 볼 수 있는 시각적 정보이므로 별도 인증 없이 공개 응답한다.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

require_once dirname(__DIR__) . '/config/t2_config.php';

$settings_file = T2EDITOR_DATA_PATH . '/admin_settings.json';

$icons = [];
$toolbar_groups = null;

if (file_exists($settings_file)) {
    $raw = @file_get_contents($settings_file);
    $cfg = $raw ? @json_decode($raw, true) : null;
    if (is_array($cfg)) {
        if (!empty($cfg['icons']) && is_array($cfg['icons'])) {
            $icons = $cfg['icons'];
        }
        if (!empty($cfg['toolbar_groups']) && is_array($cfg['toolbar_groups'])) {
            $toolbar_groups = $cfg['toolbar_groups'];
        }
    }
}

echo json_encode([
    'icons'          => $icons,
    'toolbar_groups' => $toolbar_groups,
], JSON_UNESCAPED_UNICODE);
