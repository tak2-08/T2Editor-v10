// Path: T2Editor/extend/js/t2skill_product_intro.js
//
// 예시 서버 Skill — "제품 소개글 작성" 절차 지침.
// README_SKILLS.js에 나온 최소 템플릿을 그대로 따른 실제 동작 예시다.
// 이 파일을 지우면 이 Skill만 사라지고 나머지 기능에는 영향이 없다.
(function () {
    'use strict';
    if (!window.T2Skills) {
        console.warn(T2Utils.tf('t2skill.console_module_not_loaded', {}, '[T2Skill] t2skill_core.js not loaded — skipping registration'));
        return;
    }

    T2Skills.register({
        name: 'product_intro_writer',
        description: 'Follow this procedure whenever asked to write a new product/service introduction.',
        body: [
            'Write the product intro using T2LLM DSL in this order:',
            '1. H1: one line — the product name as the title.',
            '2. P: in one or two sentences, lead with the core point — "who this is for, and what problem it solves."',
            '3. If there are 2 or more key features, build a TABLE: with two columns, "Feature | Description"',
            '   (T2LLM DSL\'s TABLE tag only creates the structure and can\'t fill in cell content by itself,',
            '    so when using a table, keep in mind that the caller — e.g. ai_complex.js — is responsible',
            '    for a separate step that actually fills in the cell contents).',
            '4. In the final paragraph (P:), suggest exactly one next action (contact/purchase/try it, etc.), kept short.',
            '5. Don\'t overuse exaggerated adjectives ("the best", "the only", "unmatched", etc.) — favor concrete',
            '   numbers and facts. Never invent a figure you can\'t verify.',
        ].join('\n'),
        source: 't2skill_product_intro.js',
    });
})();
