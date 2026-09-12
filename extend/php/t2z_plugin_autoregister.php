<?php
/**
 * T2Editor — 플러그인 자동 등록 스캐너 (보조 기능)
 * Path: t2editor/extend/php/t2z_plugin_autoregister.php
 *
 * ── 이 파일의 위치 ──────────────────────────────────────────────────────
 * 플러그인을 등록하는 "기본" 방법은 지금까지와 동일하게 editor.lib.php의
 * $T2EDITOR_PLUGINS 배열에 직접 추가하거나, plugin/paste_migrate 처럼
 * extend/php/t2<name>_loader.php 형태의 개별 로더 파일을 만드는 것이다
 * (t2paste_migrate_loader.php 참고). 이 파일은 그 방식을 대체하지 않는다.
 *
 * 이 파일은 어디까지나 부가 기능이다: plugin/<name>/plugin.json 에
 * {"autoload": true} 라고 "스스로 선언"한 플러그인만 골라서, 아무도 눈치채지
 * 못하게 조용히 목록에 추가해준다. 그런 선언이 없는 플러그인(대다수의 v10
 * 플러그인, 그리고 autoload를 아예 지원/구현하지 않은 플러그인)은 이 파일이
 * 존재하는지조차 모르는 것처럼 지금까지와 완전히 동일하게 취급된다 — 즉
 * 여전히 위의 "기본" 방법(editor.lib.php 직접 등록 또는 개별 로더 파일)으로
 * 등록해야 한다. 이 스캐너가 그 대상 플러그인들을 대신 등록해주지 않는다.
 *
 * 사용법 — 플러그인이 스스로 자동 등록을 지원하고 싶다면:
 *   plugin/<name>/plugin.json 에 아래 형태로 작성하면 끝이다.
 *     { "autoload": true, "priority": 6 }
 *   "priority" 는 선택 사항이다. 생략하면 core.js의 loadPluginsWithPriority()가
 *   자동으로 "우선순위 미지정 그룹"(가장 마지막)에 배정하므로 에러 없이 동작한다.
 *
 * ── 하위호환/안전성 설계 ─────────────────────────────────────────────────
 * · plugin.json 이 없거나, JSON 파싱에 실패하거나, "autoload" 가 true 가
 *   아니면 아무 동작도 하지 않고 다음 플러그인으로 넘어간다 — 어떤 경우에도
 *   예외를 던지지 않으며, 그런 플러그인의 기존 동작(= 등록되지 않은 상태이며
 *   필요하면 수동으로 등록해야 함)은 이 파일 도입 전과 완전히 동일하다.
 * · plugin/paste_migrate 처럼 이미 다른 extend/php 로더나 editor.lib.php의
 *   기본 목록이 명시적으로 등록을 책임지고 있는 플러그인과 충돌하지 않도록,
 *   이미 $T2EDITOR_PLUGINS 에 들어있는 이름은 건드리지 않는다("추가"만 하고
 *   "덮어쓰기"는 하지 않음).
 * · 파일명 접두어 "t2z_" 는 extend/php 자동 로더가 파일명을 정렬(sort)한 뒤
 *   순서대로 include 하는 규칙을 이용한 것이다. t2admin_settings_loader.php,
 *   t2paste_migrate_loader.php 등 "기본" 방법으로 등록하는 다른 로더들보다
 *   항상 뒤에 실행되도록 보장해, 그 파일들이 먼저 세팅해둔(=진짜 주류인)
 *   값을 그대로 존중한 뒤 "위에 조용히 얹어" 추가만 한다.
 */

global $T2EDITOR_PLUGINS, $T2EDITOR_PLUGIN_PRIORITY;

// editor.lib.php 의 기본값과 동일한 기본 목록.
// (t2admin_settings_loader.php / t2paste_migrate_loader.php 등 "기본" 방법으로
//  등록하는 다른 extend 파일이 이미 값을 세팅했다면 그 값을 그대로 사용하고
//  덮어쓰지 않는다 — 이 스캐너는 언제나 그 위에 조용히 추가만 하는 보조 역할이다.)
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

// ── plugin/ 폴더 스캔: {"autoload": true} 로 "스스로" 선언한 플러그인만 ────
$_t2ar_plugin_dir = __DIR__ . '/../../plugin';
$_t2ar_entries = @scandir($_t2ar_plugin_dir);

if (is_array($_t2ar_entries)) {
    foreach ($_t2ar_entries as $_t2ar_name) {
        if ($_t2ar_name === '.' || $_t2ar_name === '..') continue;

        // [SEC] 플러그인 폴더명은 editor.lib.php _t2e_load_plugin_buttons() 와
        // 동일한 규칙(영숫자·언더스코어·하이픈)만 허용 — 경로 탈출 방지.
        if (!preg_match('/^[a-zA-Z0-9_-]+$/', $_t2ar_name)) continue;

        $_t2ar_manifest_path = $_t2ar_plugin_dir . '/' . $_t2ar_name . '/plugin.json';
        // plugin.json 이 없다 = 자동 등록을 지원하지 않는 플러그인이다.
        // 이 스캐너는 여기서 조용히 손을 뗀다 — 필요하면 지금까지처럼
        // editor.lib.php 에 직접 추가하거나 개별 로더 파일로 등록해야 한다.
        if (!is_file($_t2ar_manifest_path)) continue;

        $_t2ar_raw = @file_get_contents($_t2ar_manifest_path);
        if ($_t2ar_raw === false) continue;

        $_t2ar_manifest = json_decode($_t2ar_raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($_t2ar_manifest)) {
            error_log("[T2Editor] plugin/{$_t2ar_name}/plugin.json parse error: " . json_last_error_msg());
            continue; // 파싱 실패도 조용히 건너뜀 — 절대 예외로 전체 로딩을 막지 않는다.
        }

        // "autoload": false 이거나 키 자체가 없으면 = 자동 등록을 지원하지
        // 않거나 명시적으로 거부한 것이다. 이 스캐너는 관여하지 않는다
        // (지금까지와 동일하게 수동으로 등록해야 한다).
        if (empty($_t2ar_manifest['autoload'])) continue;

        // 이미 등록된 이름은 건드리지 않는다 — "기본" 방법(editor.lib.php
        // 직접 등록 또는 개별 로더 파일)이 이미 책임지고 있는 플러그인과의
        // 충돌 방지.
        if (!in_array($_t2ar_name, $T2EDITOR_PLUGINS, true)) {
            $T2EDITOR_PLUGINS[] = $_t2ar_name;
        }

        if (!isset($T2EDITOR_PLUGIN_PRIORITY[$_t2ar_name])) {
            $_t2ar_priority = $_t2ar_manifest['priority'] ?? null;
            if (is_int($_t2ar_priority) || (is_string($_t2ar_priority) && ctype_digit($_t2ar_priority))) {
                $T2EDITOR_PLUGIN_PRIORITY[$_t2ar_name] = (int)$_t2ar_priority;
            }
            // priority 미지정 시: core.js loadPluginsWithPriority() 가 자동으로
            // "우선순위 미지정" 그룹(가장 마지막 순번)에 배정하므로 별도 처리 불필요.
        }
    }
}

unset(
    $_t2ar_plugin_dir, $_t2ar_entries, $_t2ar_name, $_t2ar_manifest_path,
    $_t2ar_raw, $_t2ar_manifest, $_t2ar_priority
);
