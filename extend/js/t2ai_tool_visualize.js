// Path: T2Editor/extend/js/t2ai_tool_visualize.js
//
// "visualize" Tool — 채팅 답변 중 이미지/링크 카드/간단한 막대·선 그래프를
// 곧바로 화면에 그려서 보여준다. 클로드 웹 채팅의 아티팩트·인라인 시각화와
// 같은 목적이지만, 별도 패널이 아니라 "그 자리(채팅 말풍선 안)"에 바로
// 붙는 lite 버전이다.
//
// 이 Tool은 무언가를 "찾아오지" 않는다 — 이미 갖고 있는 정보(URL, 수치
// 데이터)를 검증/정규화해서 돌려줄 뿐이다. 실제 렌더링은 ai_complex.js가
// 담당한다: chat 모드의 Tool 왕복에서 onToolCallDone(call, result) 콜백이
// call.name === 'visualize' 인 결과를 가로채, run()이 돌려준 정규화된
// spec을 renderInlineVisual()로 그려 현재 진행 중인 답변 말풍선에 바로
// 붙인다(다른 Tool처럼 "다음 라운드의 LLM에게 데이터를 돌려주는" 용도가
// 아니라 "그 즉시 사람 눈에 보여주는" 용도이므로, 결과 데이터도 아주
// 단순하게 유지한다 — LLM은 그저 "성공적으로 보여줬다"만 알면 된다).
//
// 지원하는 type:
//   image — { type:'image', url, caption? }
//   link  — { type:'link',  url, title? }
//   chart — { type:'chart', chart_type:'bar'|'line', title?, labels:[...], values:[...] }
(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js not loaded — skipping registration');
        return;
    }

    function isHttpUrl(u) {
        return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim());
    }

    function safeHostname(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch (_) { return ''; }
    }

    T2AITools.register({
        name: 'visualize',
        description: 'Shows information you already have (an image URL, a link, numeric data) visually instead of as text. Not a search/lookup tool — it\'s a "render what you already have" tool; only call it once you already have the url or data.',
        params: {
            type: 'One of "image" | "link" | "chart"',
            url: 'Required for image/link: an http(s) URL',
            title: 'For link/chart: a title (optional)',
            caption: 'For image: a caption (optional)',
            chart_type: 'For chart: "bar" or "line" (default bar)',
            labels: 'Required for chart: an array of item-name strings',
            values: 'Required for chart: an array of numbers, same length as labels',
        },
        source: 't2ai_tool_visualize.js',
        ui: {
            label: 'Show Visual',
            icon: 'insert_chart',
            description: 'Renders an image, link, or a simple bar/line chart directly inside the chat answer.',
            usage: 'Used automatically for requests like "show me this image" or "chart these numbers," where the information is already available.',
        },
        group: 'visualize',

        async run(args) {
            const type = String((args && args.type) || '').toLowerCase();

            if (type === 'image') {
                if (!isHttpUrl(args.url)) throw new Error('image requires an http(s) URL.');
                return { type: 'image', url: String(args.url).trim(), caption: args.caption ? String(args.caption).slice(0, 200) : '' };
            }

            if (type === 'link') {
                if (!isHttpUrl(args.url)) throw new Error('link requires an http(s) URL.');
                const url = String(args.url).trim();
                return { type: 'link', url, title: args.title ? String(args.title).slice(0, 200) : url, host: safeHostname(url) };
            }

            if (type === 'chart') {
                const labels = Array.isArray(args.labels) ? args.labels.map(v => String(v).slice(0, 40)) : [];
                const values = Array.isArray(args.values) ? args.values.map(Number) : [];
                if (!labels.length || labels.length !== values.length) {
                    throw new Error('chart requires labels/values arrays of equal length.');
                }
                if (values.some(n => !Number.isFinite(n))) {
                    throw new Error('values must all be numbers.');
                }
                return {
                    type: 'chart',
                    chartType: args.chart_type === 'line' ? 'line' : 'bar',
                    title: args.title ? String(args.title).slice(0, 200) : '',
                    labels: labels.slice(0, 20),
                    values: values.slice(0, 20),
                };
            }

            throw new Error(`Unknown type "${args && args.type}" — must be one of image/link/chart.`);
        },
    });
})();