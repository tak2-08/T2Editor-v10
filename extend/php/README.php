<?php
/**
 * T2Editor /extend/php 디렉토리
 * ─────────────────────────────────────────────────────────────────
 * 이 폴더에 .php 파일을 올려두면 T2Editor 초기화 시 자동으로 include됩니다.
 * 그누보드5의 /extend 개념과 동일합니다.
 *
 * 로드 시점 : editor.lib.php 기본 상수(T2EDITOR_PATH 등) 정의 직후
 * 로드 순서 : 파일명 알파벳 순 (정렬 후 include_once)
 * 활용 예시 :
 *   - 에디터 전역 설정 오버라이드  (T2_CSS_MIN, T2_JS_MIN 등 재정의)
 *   - 커스텀 PHP 훅 등록
 *   - 허용 도메인·업로드 설정 추가
 *
 * ★ 이 README.php 파일은 예제로 제공되며 실행해도 아무 동작도 하지 않습니다.
 */
// 실제 extend 코드를 작성할 때는 이 파일 외에 별도 파일로 작성하세요.
// 예) extend/php/my_custom.php
