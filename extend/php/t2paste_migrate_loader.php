<?php
/**
 * T2Editor — paste_migrate 플러그인 등록 로더
 * Path: t2editor/extend/php/t2paste_migrate_loader.php
 *
 * 붙여넣기(paste) 시점의 콘텐츠를 자동으로 T2Editor 자체 포맷으로 변환하는
 * plugin/paste_migrate 를 코어(editor.lib.php) 수정 없이 등록한다.
 *
 * extend/php 자동 로더는 파일명을 정렬(sort)한 뒤 순서대로 include 하므로
 * 이 파일은 t2admin_settings_loader.php (t2a...) 보다 뒤에 실행된다(t2p... > t2a...).
 * 즉 admin_settings.json 에 의해 $T2EDITOR_PLUGINS 가 먼저 커스터마이즈되어 있어도
 * 그 결과 위에 안전하게 'paste_migrate' 하나만 추가한다.
 *
 * editor.lib.php 의 아래 가드 덕분에, 여기서 미리 값을 설정해두면
 * editor.lib.php 자체의 기본값 배열은 사용되지 않고 이 값이 그대로 보존된다.
 *   if (!isset($T2EDITOR_PLUGINS)) $T2EDITOR_PLUGINS = [ ... ];
 *   if (!isset($T2EDITOR_PLUGIN_PRIORITY)) $T2EDITOR_PLUGIN_PRIORITY = [ ... ];
 */

global $T2EDITOR_PLUGINS, $T2EDITOR_PLUGIN_PRIORITY;

// editor.lib.php 의 기본값과 동일한 기본 플러그인 목록.
// (admin_settings_loader.php 등 다른 extend 파일이 이미 값을 세팅했다면 그 값을 그대로 사용)
if (!isset($T2EDITOR_PLUGINS) || !is_array($T2EDITOR_PLUGINS)) {
    $T2EDITOR_PLUGINS = [
        'link', 'image', 'video', 'file', 'table', 'code',
        'export', 'search', 'draw', 'collab', 'ai_complex',
        'clipurl', 'meme',
    ];
}

if (!isset($T2EDITOR_PLUGIN_PRIORITY) || !is_array($T2EDITOR_PLUGIN_PRIORITY)) {
    $T2EDITOR_PLUGIN_PRIORITY = [
        'image' => 0, 'video' => 1, 'link' => 2, 'ai_complex' => 3,
        'file' => 4, 'code' => 4, 'search' => 4, 'table' => 5,
        'draw' => 6, 'collab' => 6, 'meme' => 8, 'export' => 9, 'clipurl' => 9,
    ];
}

if (!in_array('paste_migrate', $T2EDITOR_PLUGINS, true)) {
    $T2EDITOR_PLUGINS[] = 'paste_migrate';
}

// image(0)/video(1)/link(2) 가 먼저 자체 paste 처리 기회를 갖고,
// table(5) 도 자기 자신의 <table> HTML 감지를 먼저 시도한 뒤에
// paste_migrate 가 남은 모든 붙여넣기(순수 텍스트/일반 리치 HTML/URL 등)를 처리하도록
// table 그룹(5)보다 뒤, meme/export/clipurl 그룹(8~9)보다는 앞에 둔다.
if (!isset($T2EDITOR_PLUGIN_PRIORITY['paste_migrate'])) {
    $T2EDITOR_PLUGIN_PRIORITY['paste_migrate'] = 7;
}
