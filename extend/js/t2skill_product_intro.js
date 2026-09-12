// Path: T2Editor/extend/js/t2skill_product_intro.js
//
// 예시 서버 Skill — "제품 소개글 작성" 절차 지침.
// README_SKILLS.js에 나온 최소 템플릿을 그대로 따른 실제 동작 예시다.
// 이 파일을 지우면 이 Skill만 사라지고 나머지 기능에는 영향이 없다.
(function () {
    'use strict';
    if (!window.T2Skills) {
        console.warn('[T2Skill] t2skill_core.js 미로드 — 등록 건너뜀');
        return;
    }

    T2Skills.register({
        name: 'product_intro_writer',
        description: '제품/서비스 소개글을 새로 써달라는 요청일 때 이 절차를 따른다.',
        body: [
            '제품 소개글은 다음 순서로 T2LLM DSL을 사용해 작성한다:',
            '1. H1: 제품명을 제목으로 한 줄.',
            '2. P: 한두 문장으로 이 제품이 "누구에게, 어떤 문제를 해결해주는지" 핵심만 먼저 말한다.',
            '3. 핵심 특징이 2개 이상이면 TABLE: 태그로 표를 만들어 "특징 | 설명" 2열로 정리한다',
            '   (T2LLM DSL의 TABLE 태그는 구조만 만들 뿐 셀 내용은 못 채우므로,',
            '    표를 쓸 때는 그 사실을 알고 있는 호출자(ai_complex.js 등)가',
            '    별도로 셀 내용을 채우는 절차를 갖고 있다는 점을 감안한다).',
            '4. 마지막 문단(P:)에는 다음 행동(문의/구매/체험 등) 하나만 짧게 제안한다.',
            '5. 과장된 형용사(최고의/유일한/압도적인 등)는 남발하지 않는다 — 구체적인',
            '   수치나 사실 위주로 쓴다. 확인할 수 없는 수치를 지어내지 않는다.',
        ].join('\n'),
        source: 't2skill_product_intro.js',
    });
})();
