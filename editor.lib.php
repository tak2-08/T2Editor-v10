<?php
// Path: T2Editor/editor.lib.php
// Developer note: 부트스트랩 공개 함수와 include 순서는 10.4.0 CMS 연결 계약이므로 이름을 바꾸지 않는다.
/**
 * T2Editor immutable bootstrap (T2 Extend Bootstrap ABI 2).
 *
 * Keep this file small and stable. The selected runtime implementation lives
 * in editor.core.php inside the base installation or an immutable data slot.
 */
require_once __DIR__ . '/config/extend.php';

// PHP 스코프 주의: t2_extend_bootstrap_editor() 아래 호출은 editor.core.php를
// "함수 내부"에서 require한다(핫스왑 런타임이 base 설치와 데이터 릴리스 중
// 무엇을 로드할지 그 함수 안에서 결정하기 때문). 즉 editor.core.php의
// 최상위 코드 자체가 이미 진짜 전역 스코프가 아니라 그 함수의 지역 스코프다.
// config/t2_cms_auth.php는 그 자신의 최하단에서 호스트 CMS 부트스트랩 파일
// (예: 그누보드5 common.php — t2editor_g5_common_path()의 주석 참고)을
// require하는데, 이 require가 처음 실행되는 시점이 어디든(설사 editor.core.php
// 안의 어느 함수 몇 겹 아래든) 그 지점의 스코프가 그대로 common.php의 스코프가
// 되어버린다. common.php가 함수 스코프에 갇히면 그누보드5의 is_admin()/
// get_member() 등이 `global $config;`로 봐야 할 값이 존재하지 않게 되어,
// 실제 최고관리자조차 항상 "로그인 필요"로 오판된다.
//
// 이 파일(editor.lib.php)은 호스트 CMS가 언제나 자기 자신의 진짜 최상위
// 스코프에서 직접 include/require하는 불변 부트스트랩 계약이므로(그누보드5의
// write.php가 include_once(G5_EDITOR_LIB)를 자기 최상위에서 실행하는 것이
// 그 예), t2_extend_bootstrap_editor()를 호출하기 "전에" 여기서 먼저
// config/t2_cms_auth.php를 진짜 최상위 require로 로드해 두면, 그 안의
// 호스트 부트스트랩 require도 함께 진짜 전역 스코프에서 실행된다. 이후
// editor.core.php의 _t2e_current_admin_link() 등에서 같은 파일을
// require_once해도 이미 로드된 상태이므로 안전하게 스킵된다(require_once의
// 중복 로드 방지는 스코프가 아니라 프로세스 전역 기준이기 때문).
//
// 경로 계산은 함수(t2_extend_admin_auth_facade_path) 안에서 하되, 실제
// require 문 자체는 반드시 이 파일의 최상위에 그대로 적어야 한다 —
// t2_extend_endpoint_target()/require 패턴과 동일한 이유.
$__t2e_admin_auth_facade = t2_extend_admin_auth_facade_path();
if ($__t2e_admin_auth_facade !== '') require_once $__t2e_admin_auth_facade;
unset($__t2e_admin_auth_facade);

t2_extend_bootstrap_editor(__FILE__);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
