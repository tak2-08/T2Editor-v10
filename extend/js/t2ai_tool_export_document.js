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
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'export_document'}, '[T2AI] t2ai_core.js not loaded yet — skipping export_document registration.'));
        return;
    }

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(T2Utils.tf('t2ai.console_plugin_load_failed', {name: name}, '[T2AI] Plugin load failed: ' + name), e); }
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
            console.warn(T2Utils.tf('t2ai.console_skin_load_failed', {}, '[T2AI] Failed to load export skin template, falling back to default.'), e);
            return plugin.renderExportDocument(plugin.getDefaultTemplate(), title);
        }
    }

    T2AITools.register({
        name: 'export_document',
        description: 'Converts the document currently being edited into markdown or a standalone HTML document string, and returns it (reuses the export plugin\'s real conversion/sanitize pipeline). Read-only tool that never touches the editor DOM. Pass download:true to also trigger a real browser file download alongside the returned text. PDF is not yet supported (the export plugin itself is only a stub for it).',
        params: {
            format: '"markdown" or "html". Default "markdown".',
            title: 'Document title for html format (optional, default "T2Editor Export"). Has no effect on markdown.',
            filename: 'Optional: filename for the download (the extension is added automatically). Only used when download:true.',
            download: 'Optional (true/false): if true, also triggers a real file download alongside returning the text. Default false.',
            id: 'Optional: the target editor id when multiple editors are present.',
        },
        source: 't2ai_tool_export_document.js',
        ui: {
            label: 'Export Document',
            icon: 'ios_share',
            description: 'Converts the document to markdown or HTML. Can also be downloaded as a real file if desired.',
            usage: 'e.g. asking "give me this document as markdown" or "let me download this as an HTML file" triggers a conversion automatically.',
        },
        async run(args) {
            const format = String(args.format || 'markdown').trim().toLowerCase();
            if (format === 'pdf') {
                return { ok: false, message: 'PDF export is not supported yet (the export plugin itself is only a stub for it).' };
            }
            if (format !== 'markdown' && format !== 'html') {
                return { ok: false, message: `Unsupported format "${format}". Only "markdown" or "html" are allowed.` };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: 'No active T2Editor instance was found.' };

            const plugin = await ensurePlugin(editor, 'export');
            if (!plugin) return { ok: false, message: 'The export plugin is not available.' };

            const download = args.download === true || args.download === 'true';

            if (format === 'markdown') {
                if (typeof plugin.processContentForMarkdown !== 'function' || typeof plugin.htmlToMarkdown !== 'function') {
                    return { ok: false, message: 'The export plugin\'s markdown conversion feature is not available.' };
                }
                const content = plugin.processContentForMarkdown();
                const markdown = plugin.htmlToMarkdown(content);

                if (download) {
                    if (typeof plugin.buildMarkdownFileName !== 'function' || !window.T2Utils || typeof T2Utils.downloadTextFile !== 'function') {
                        return { ok: false, message: 'The markdown download feature is not available.' };
                    }
                    const filename = plugin.buildMarkdownFileName(args.filename || 'document.md');
                    T2Utils.downloadTextFile(markdown, filename, 'text/markdown');
                }

                return { ok: true, format: 'markdown', content: markdown, downloaded: download };
            }

            // format === 'html'
            if (typeof plugin.buildSkinUrl !== 'function' || typeof plugin.renderExportDocument !== 'function' ||
                typeof plugin.getDefaultTemplate !== 'function' || typeof plugin.normalizeTitle !== 'function') {
                return { ok: false, message: 'The export plugin\'s HTML conversion feature is not available.' };
            }

            const title = plugin.normalizeTitle(args.title || 'T2Editor Export');
            const html = await buildExportHtml(plugin, title);

            if (download) {
                if (typeof plugin.buildDownloadFileName !== 'function' || typeof plugin.downloadHTML !== 'function') {
                    return { ok: false, message: 'The HTML download feature is not available.' };
                }
                const filename = plugin.buildDownloadFileName(args.filename || title);
                plugin.downloadHTML(html, filename);
            }

            return { ok: true, format: 'html', title, content: html, downloaded: download };
        },
    });
})();
