// Path: T2Editor/plugin/ai_complex/hooks.js
// Developer note: ai_complex 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.2.0 — ai_complex 플러그인 submit/restore 훅
// (ai + ai_rearrange 통폐합)
//
// ai_complex 플러그인은 콘텐츠를 직접 만들지 않는다. 생성/재구성 결과는 전부
// T2LLM.apply()를 통해 각 대상 플러그인(code/image/table/link/video/...)의
// "순수 생성" API로 삽입되므로, 그 블록들의 submit/restore는 각 플러그인의
// hooks.js가 이미 담당한다.
//
// 이 플러그인이 남기는 유일한 런타임 전용 흔적은 "요소 선택(포커스 지정)" 시
// 붙는 하이라이트 클래스뿐이다 — 저장 전 반드시 제거한다.
//
// Restore: 별도 처리 없음 (선택 상태는 매 편집 세션마다 새로 시작).

(function () {
    'use strict';

    T2EditorHooks.onSubmit('ai_complex', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-aic-focus-pick, .t2-aic-focus-selected')
               .forEach(function (el) {
                   el.classList.remove('t2-aic-focus-pick', 't2-aic-focus-selected');
               });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
