/**
 * T2Editor /extend/js 디렉토리
 * ─────────────────────────────────────────────────────────────────
 * 이 폴더에 .js 파일을 올려두면 T2Editor HTML 출력 시 <script> 태그로
 * 자동 로드됩니다. 그누보드5의 /extend 개념과 동일합니다.
 *
 * 로드 시점 : 플러그인 스크립트(plugin/*.js) 로드 직후, legacy_fallback.js 이전
 * 로드 순서 : 파일명 알파벳 순
 * 활용 예시 :
 *   - 에디터 훅(hook) 커스텀 등록
 *   - 플러그인 동작 확장
 *   - 에디터 초기화 완료 이벤트 리스너 추가
 *
 * ★ 이 README.js 파일은 예제로 제공되며 실제 로드 대상에서 자동 제외됩니다.
 *    (파일명이 README로 시작하는 파일은 건너뜁니다)
 *
 * 예) extend/js/my_hooks.js
 *   document.addEventListener('t2editor:ready', function(e) {
 *       var editor = e.detail.editor;
 *       // 커스텀 동작 작성
 *   });
 */
