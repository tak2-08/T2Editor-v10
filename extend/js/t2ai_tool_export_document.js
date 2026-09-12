// Path: T2Editor/extend/js/t2ai_tool_export_document.js
//
// T2Editor AI Tool — export_document
// ============================================================================
// export 플러그인(plugin/export)을 위한 T2AI Tool. export 플러그인 자체는
// 사람 대상 UI다 — exportToHTML()/exportToMarkdown()은 prompt()로 제목/파일명을
// 물어보고, 곧바로 브라우저 다운로드를 트리거한다. LLM은 대화상자에 답할 수
// 없고, 대부분의 경우 "지금 당장 파일을 내려받는 것"보다 "문서 내용을
// 마크다운/HTML 텍스트로 얻어서 다른 곳에 쓰는 것"을 원한다. 이 Tool은 그
// 간극을 메운다: prompt() 없이 인자로 제목/파일명을 받고, export 플러그인의
// 실제 변환·새니타이즈 파이프라인(processContentForMarkdown/htmlToMarkdown,
// renderExportDocument + export_html_skin.html)을 그대로 재사용해 결과를
// 문자열로 반환한다. download:true를 주면 기존과 동일한 실제 파일 다운로드도
// 함께 트리거할 수 있다(선택 사항).
//
// export.js 소스코드는 건드리지 않는다. 이 Tool이 하는 일은 오직
// "prompt() 대신 인자를 쓰고, 다운로드 대신(또는 다운로드와 함께) 결과를
// 반환"하는 것뿐 — 실제 HTML 새니타이즈·마크다운 변환 로직은 전부 export
// 플러그인 인스턴스의 기존 public 메서드를 그대로 호출한다.
//
// export 플러그인은 에디터 DOM을 읽기만 하고 절대 수정하지 않는다(export의
// hooks.js에도 명시됨). 따라서 이 Tool도 부작용이 없는 순수 조회형 Tool이며
// unsafeForReplace를 선언하지 않는다 — 문서 "재구성" 요청 중에도 안전하게
// 함께 노출될 수 있다(다른 Tool들과 달리 재구성 흐름이 지운다거나 충돌할
// "심어둔 상태"가 없음).
//
// PDF는 export 플러그인 자체가 아직 스텁(exportToPDF는 알림만 띄우고 실제
// 변환을 하지 않음)이라 이 Tool도 동일하게 미지원으로 응답한다. 나중에
// export.js에 실제 PDF 변환이 추가되면, 이 Tool의 format:'pdf' 분기만
// 채워주면 된다(다른 Tool 파일에는 영향 없음).
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 export_document 등록을 건너뜁니다.');
        return;
    }

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(`[T2AI] 플러그인 로드 실패: ${name}`, e); }
        }
        return editor.getPlugin(name);
    }

    // exportToHTML()과 동일한 순서: 스킨 템플릿 fetch → 실패 시 기본 템플릿으로
    // 대체. prompt()/downloadHTML() 호출 없이 완성된 HTML 문자열만 만든다.
    async function buildExportHtml(plugin, title) {
        const skinUrl = plugin.buildSkinUrl();
        try {
            const response = await fetch(skinUrl, { credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const template = await response.text();
            return plugin.renderExportDocument(template, title);
        } catch (e) {
            console.warn('[T2AI] export 스킨 템플릿 로드 실패, 기본 템플릿으로 대체합니다.', e);
            return plugin.renderExportDocument(plugin.getDefaultTemplate(), title);
        }
    }

    T2AITools.register({
        name: 'export_document',
        description: '지금 편집 중인 문서를 마크다운 또는 독립 실행 가능한 HTML 문서 텍스트로 변환해 반환한다(export 플러그인의 실제 변환·새니타이즈 파이프라인을 그대로 재사용). 에디터 DOM은 전혀 건드리지 않는 읽기 전용 Tool이다. download:true 를 주면 반환과 동시에 실제 브라우저 파일 다운로드도 트리거한다. PDF는 아직 지원하지 않는다(export 플러그인 자체가 스텁 상태).',
        params: {
            format: '"markdown" 또는 "html". 기본 "markdown".',
            title: 'html 형식일 때 문서 제목(선택, 기본 "T2Editor 내보내기"). markdown에는 영향 없음.',
            filename: '선택: 다운로드 시 파일명(확장자는 자동으로 붙는다). download:true일 때만 사용.',
            download: '선택(true/false): true면 텍스트 반환과 함께 실제 파일 다운로드도 트리거. 기본 false.',
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id.',
        },
        source: 't2ai_tool_export_document.js',
        ui: {
            label: '문서 내보내기',
            icon: 'ios_share',
            description: '문서를 마크다운이나 HTML로 변환해요. 원하면 실제 파일로도 내려받을 수 있어요.',
            usage: '예: "지금 문서를 마크다운으로 줘" 또는 "HTML 파일로 내려받게 해줘"처럼 요청하면 자동으로 변환해요.',
        },
        async run(args) {
            const format = String(args.format || 'markdown').trim().toLowerCase();
            if (format === 'pdf') {
                return { ok: false, message: 'PDF 내보내기는 아직 지원되지 않습니다 (export 플러그인 자체가 스텁 상태입니다).' };
            }
            if (format !== 'markdown' && format !== 'html') {
                return { ok: false, message: `지원하지 않는 format "${format}" 입니다. "markdown" 또는 "html"만 가능합니다.` };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

            const plugin = await ensurePlugin(editor, 'export');
            if (!plugin) return { ok: false, message: 'export 플러그인을 사용할 수 없습니다.' };

            const download = args.download === true || args.download === 'true';

            if (format === 'markdown') {
                if (typeof plugin.processContentForMarkdown !== 'function' || typeof plugin.htmlToMarkdown !== 'function') {
                    return { ok: false, message: 'export 플러그인의 마크다운 변환 기능을 사용할 수 없습니다.' };
                }
                const content = plugin.processContentForMarkdown();
                const markdown = plugin.htmlToMarkdown(content);

                if (download) {
                    if (typeof plugin.buildMarkdownFileName !== 'function' || !window.T2Utils || typeof T2Utils.downloadTextFile !== 'function') {
                        return { ok: false, message: '마크다운 다운로드 기능을 사용할 수 없습니다.' };
                    }
                    const filename = plugin.buildMarkdownFileName(args.filename || 'document.md');
                    T2Utils.downloadTextFile(markdown, filename, 'text/markdown');
                }

                return { ok: true, format: 'markdown', content: markdown, downloaded: download };
            }

            // format === 'html'
            if (typeof plugin.buildSkinUrl !== 'function' || typeof plugin.renderExportDocument !== 'function' ||
                typeof plugin.getDefaultTemplate !== 'function' || typeof plugin.normalizeTitle !== 'function') {
                return { ok: false, message: 'export 플러그인의 HTML 변환 기능을 사용할 수 없습니다.' };
            }

            const title = plugin.normalizeTitle(args.title || 'T2Editor 내보내기');
            const html = await buildExportHtml(plugin, title);

            if (download) {
                if (typeof plugin.buildDownloadFileName !== 'function' || typeof plugin.downloadHTML !== 'function') {
                    return { ok: false, message: 'HTML 다운로드 기능을 사용할 수 없습니다.' };
                }
                const filename = plugin.buildDownloadFileName(args.filename || title);
                plugin.downloadHTML(html, filename);
            }

            return { ok: true, format: 'html', title, content: html, downloaded: download };
        },
    });
})();
