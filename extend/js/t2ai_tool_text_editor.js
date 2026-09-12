// Path: T2Editor/extend/js/t2ai_tool_text_editor.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — text_editor
// Anthropic Claude 자체 "text editor" Tool(view/str_replace/create/insert/
// undo_edit)의 구조를 그대로 본떠, T2Editor 문서(및 브라우저 로컬 보조 파일)에
// 적용한 버전이다. 하나의 Tool(name: 'text_editor')이 command 인자로 5가지
// 동작을 라우팅한다(다른 t2ai_tool_*.js 처럼 서로 다른 이름의 Tool을 여러 개
// 등록하는 대신, Claude의 실제 도구 규격과 동일하게 command 스위치 하나로
// 통일 — LLM 입장에서 가장 익숙한 형태이므로 저성능 모델에서도 호출 성공률이
// 높다).
//
// 왜 필요한가
// 기존 "재구성(rearrange)" 흐름은 문서 전체를 DSL 텍스트로 읽어(T2LLM.read),
// LLM이 처음부터 다시 쓰게 한 뒤, 그 결과로 문서 전체를 통째로 교체한다
// (T2LLM.apply(dsl, {mode:'replace'})). 문서 구조를 크게 바꾸는 큰 작업엔
// 적합하지만, "표의 셀 하나만 고쳐줘", "이 문단 뒤에 한 줄만 추가해줘"처럼
// 문서 대부분은 그대로 두고 아주 일부만 고치는 작업에는 비효율적이다 — 매번
// 전체 문서를 다시 생성시키면 토큰 낭비가 크고, 저성능 모델일수록 그 큰
// 재작성 과정에서 원래 있던 다른 내용을 실수로 놓치거나 바꿔버릴 위험도
// 커진다. 이 Tool은 "문서를 부분적으로, 정확하게" 고칠 수 있는 수단을
// 별도로 제공해 그 문제를 해결한다.
//
// path 규칙
//   path: "document" (기본값) — 지금 에디터에 열려 있는 실제 문서. 내용은
//         T2LLM DSL 텍스트(한 줄에 한 블록, 예: "P: 문단", "H1: 제목")로
//         노출되며, 이 Tool로 가한 수정은 T2LLM.apply()를 통해 즉시 실제
//         문서에 반영된다. 문법은 T2LLM.spec()과 동일.
//   path: 그 외 임의 문자열 — 문서와는 무관한, 이 브라우저에만 저장되는
//         가상 스크래치 파일. 예: 초안이나 리서치 메모를 문서에 넣기 전에
//         먼저 정리해 둘 때 사용. 서버나 DB를 전혀 쓰지 않는다.
//
// 저장소(로컬스토리지)만 사용
// 스크래치 파일 본문과 모든 path 공통의 undo 히스토리는 window.localStorage
// 에만 저장된다(다른 t2ai_tool_*.js와 동일한 설계 원칙 — 서버 스키마 변경
// 없이 이 파일 하나만 지우면 기능 전체가 조용히 사라진다). "document" path
// 자체의 실제 내용(진짜 소스)은 물론 살아있는 에디터 DOM이며, 로컬스토리지에는
// 그 되돌리기(undo)용 스냅샷만 저장한다.
//
// unsafeForReplace: true
// str_replace/create/insert/undo_edit는 path:"document"일 때 에디터 DOM을
// 즉시 되돌릴 수 없게 바꾼다(다른 문서 삽입형 Tool들과 동일한 사유). 재구성
// (rearrange) 요청 중에는 이 Tool 자체가 광고되지 않는다 — ai_complex.js의
// getClientToolsPayload(mode)가 이 플래그를 보고 자동으로 걸러준다.

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded_short', {tool: 'text_editor'}, '[T2AI] t2ai_core.js not loaded — skipping text_editor registration'));
        return;
    }

    const NS = 't2ai_texted_v1';
    const MAX_HISTORY_PER_FILE = 20;   // path 하나당 최대 undo 스냅샷 개수
    const DOCUMENT_PATH = 'document';
    const MAX_PATH_CHARS = 200;

    let _available = null;
    function storageAvailable() {
        if (_available !== null) return _available;
        try {
            const probe = `${NS}:__probe__`;
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            _available = true;
        } catch (_) {
            _available = false;
        }
        return _available;
    }

    function safeGetJSON(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function safeSetJSON(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_) {
            return false;
        }
    }

    function safeRemove(key) {
        try { window.localStorage.removeItem(key); } catch (_) { /* no-op */ }
    }

    function pageScope() {
        try {
            return `${location.hostname}${location.pathname}${location.search}`.slice(0, 200);
        } catch (_) {
            return 'unknown';
        }
    }

    function fileKey(path) { return `${NS}:file:${pageScope()}:${path}`; }
    function histKey(path) { return `${NS}:hist:${pageScope()}:${path}`; }

    function normalizePath(raw) {
        const s = (raw == null || raw === '') ? DOCUMENT_PATH : String(raw).trim();
        if (!s) return DOCUMENT_PATH;
        return s.slice(0, MAX_PATH_CHARS);
    }

    function isDocumentPath(path) {
        return path === DOCUMENT_PATH;
    }

    function countLines(content) {
        return content === '' ? 0 : content.split('\n').length;
    }

    function numberLines(content, fromLine) {
        if (content === '') return '(empty file)';
        return content.split('\n')
            .map((line, i) => `${String(fromLine + i).padStart(6, ' ')}\t${line}`)
            .join('\n');
    }

    async function readFile(path, id) {
        if (isDocumentPath(path)) {
            if (!window.T2LLM || typeof window.T2LLM.read !== 'function') {
                throw new Error('T2LLM is not loaded, so the document cannot be read.');
            }
            const content = window.T2LLM.read({ id });
            return { existed: content !== '', content };
        }
        const rec = safeGetJSON(fileKey(path), null);
        if (!rec) return { existed: false, content: '' };
        return { existed: true, content: String(rec.content || '') };
    }

    async function writeFile(path, content, id) {
        if (isDocumentPath(path)) {
            if (!window.T2LLM || typeof window.T2LLM.apply !== 'function') {
                throw new Error('T2LLM is not loaded, so the document cannot be written to.');
            }
            await window.T2LLM.apply(content, { mode: 'replace', id });
            return;
        }
        safeSetJSON(fileKey(path), { content, updatedAt: Date.now() });
    }

    async function clearFile(path, id) {
        if (isDocumentPath(path)) {
            await window.T2LLM.apply('', { mode: 'replace', id });
            return;
        }
        safeRemove(fileKey(path));
    }

    function pushHistory(path, snapshot) {
        const hist = safeGetJSON(histKey(path), []);
        hist.push(snapshot);
        while (hist.length > MAX_HISTORY_PER_FILE) hist.shift();
        safeSetJSON(histKey(path), hist);
    }

    async function cmdView(path, args) {
        const { existed, content } = await readFile(path, args.id);
        if (!existed) {
            return { ok: false, error: `File not found: "${path}". Use command:"create" first, or double-check the path.` };
        }
        const totalLines = countLines(content);
        let from = 1, to = totalLines;
        if (args.view_range != null) {
            if (!Array.isArray(args.view_range) || args.view_range.length !== 2) {
                return { ok: false, error: 'view_range must be an array of exactly two numbers: [start_line, end_line].' };
            }
            const rawStart = parseInt(args.view_range[0], 10);
            const rawEnd = args.view_range[1];
            from = Number.isFinite(rawStart) ? Math.max(1, rawStart) : 1;
            to = (rawEnd === -1 || rawEnd == null) ? totalLines : Math.min(totalLines, parseInt(rawEnd, 10) || totalLines);
            if (from > to) {
                return { ok: false, error: `Invalid view_range [${args.view_range.join(', ')}]: start_line must be <= end_line.` };
            }
        }
        const sliceText = totalLines === 0
            ? ''
            : content.split('\n').slice(from - 1, to).join('\n');
        return {
            ok: true,
            path,
            totalLines,
            range: [from, to],
            content: totalLines === 0 ? '(empty file)' : numberLines(sliceText, from),
        };
    }

    async function cmdStrReplace(path, args) {
        if (typeof args.old_str !== 'string' || args.old_str === '') {
            return { ok: false, error: 'old_str is required and cannot be empty.' };
        }
        if (typeof args.new_str !== 'string') {
            return { ok: false, error: 'new_str is required (pass an empty string if you just want to delete old_str).' };
        }
        const { existed, content } = await readFile(path, args.id);
        if (!existed) return { ok: false, error: `File not found: "${path}". Use command:"create" first.` };

        const occurrences = content.split(args.old_str).length - 1;
        if (occurrences === 0) {
            return { ok: false, error: 'old_str was not found in the file. Use command:"view" to check the exact current text (whitespace and line breaks matter) before retrying.' };
        }
        if (occurrences > 1) {
            return { ok: false, error: `old_str is not unique — it appears ${occurrences} times in the file. Include more surrounding lines so it matches exactly one place.` };
        }

        pushHistory(path, { existed: true, content });
        const newContent = content.replace(args.old_str, args.new_str);
        await writeFile(path, newContent, args.id);
        return { ok: true, path, replaced: true, totalLines: countLines(newContent) };
    }

    async function cmdCreate(path, args) {
        if (typeof args.file_text !== 'string') {
            return { ok: false, error: 'file_text is required (pass an empty string for a blank file).' };
        }
        const { existed, content } = await readFile(path, args.id);
        if (existed) {
            return {
                ok: false,
                error: `"${path}" already has content (${countLines(content)} line(s)). Use command:"str_replace" or "insert" to modify it, or "undo_edit" if you want to revert a previous change first.`,
            };
        }
        pushHistory(path, { existed: false, content: null });
        await writeFile(path, args.file_text, args.id);
        return { ok: true, path, created: true, totalLines: countLines(args.file_text) };
    }

    async function cmdInsert(path, args) {
        if (typeof args.new_str !== 'string') {
            return { ok: false, error: 'new_str is required — the text to insert.' };
        }
        if (!Number.isInteger(args.insert_line) || args.insert_line < 0) {
            return { ok: false, error: 'insert_line must be a non-negative integer (0 means insert at the very start of the file).' };
        }
        const { existed, content } = await readFile(path, args.id);
        if (!existed) return { ok: false, error: `File not found: "${path}". Use command:"create" first.` };

        const lines = content === '' ? [] : content.split('\n');
        if (args.insert_line > lines.length) {
            return { ok: false, error: `insert_line (${args.insert_line}) is past the end of the file — it only has ${lines.length} line(s). Use ${lines.length} to append at the very end.` };
        }
        const newStrLines = args.new_str.split('\n');
        const newLines = lines.slice(0, args.insert_line).concat(newStrLines, lines.slice(args.insert_line));

        pushHistory(path, { existed: true, content });
        const newContent = newLines.join('\n');
        await writeFile(path, newContent, args.id);
        return { ok: true, path, insertedAfterLine: args.insert_line, insertedLineCount: newStrLines.length, totalLines: newLines.length };
    }

    async function cmdUndo(path, args) {
        const hist = safeGetJSON(histKey(path), []);
        if (!hist.length) {
            return { ok: false, error: `No edit history for "${path}" in this browser — nothing to undo.` };
        }
        const prev = hist.pop();
        safeSetJSON(histKey(path), hist);

        if (!prev.existed) {
            await clearFile(path, args.id);
            return {
                ok: true, path, undone: true,
                note: isDocumentPath(path) ? 'Reverted the document to empty.' : `"${path}" was removed (it did not exist before the change being undone).`,
            };
        }
        await writeFile(path, prev.content, args.id);
        return { ok: true, path, undone: true, totalLines: countLines(prev.content) };
    }

    window.T2AITools.register({
        name: 'text_editor',
        description: 'A general-purpose text-file editor tool, modeled on Claude\'s own built-in text-editing tool. Routes to one of five operations via the "command" argument: view (read a file, optionally just a line range), str_replace (find an exact, unique piece of text and replace it), create (make a brand-new file — fails if the path already has content), insert (insert new text right after a given line number), and undo_edit (revert the file\'s most recent change in this browser). Use path:"document" (the default) to read or edit the T2Editor document currently open in the editor — its content is exposed as T2LLM DSL text, one block per line (P:/H1:/TABLE:/etc — see T2LLM.spec() for the exact tag syntax), and any edit you make here is written straight back into the live document. Any other path names a private scratch text file kept only in this browser\'s local storage (not part of the document) — useful for jotting an outline, research notes, or a draft before you commit a final version into the document with str_replace/insert. Prefer this tool over regenerating a whole document from scratch whenever you only need to fix, add to, or remove a small, well-defined part of something that\'s already mostly right — call view first to see the exact current wording and line numbers, then make one precise edit. Save a full rewrite for when most of the document actually needs to change.',
        params: {
            command: 'One of "view" | "str_replace" | "create" | "insert" | "undo_edit". Required.',
            path: 'Which file to operate on. Use "document" (the default if omitted) for the live T2Editor document. Any other string names a private scratch file stored only in this browser.',
            view_range: 'Only for command:"view". Optional [start_line, end_line] (1-indexed, inclusive; end_line:-1 means "to the end") to view part of the file instead of all of it. Omit to view the whole file.',
            old_str: 'Only for command:"str_replace". The exact text to find and replace. Must occur exactly once in the file — if it doesn\'t, view the file first and include more surrounding context to make it unique.',
            new_str: 'For command:"str_replace": the text that replaces old_str. For command:"insert": the text to insert (can contain multiple lines).',
            file_text: 'Only for command:"create". The full content of the brand-new file. Fails if the path already has content.',
            insert_line: 'Only for command:"insert". The line number after which new_str is inserted (0 = insert at the very start of the file).',
            id: 'Optional. Only relevant when path is "document" and more than one editor exists on the page — picks which editor to target.',
        },
        source: 't2ai_tool_text_editor.js',
        unsafeForReplace: true,
        ui: {
            label: 'Text Editor',
            icon: 'edit_note',
            description: 'Lets the AI make precise, surgical edits to the document (or its own scratch notes) instead of rewriting everything from scratch — view exact lines, replace just the part that needs to change, insert new content at a specific spot, or undo the last change.',
            usage: 'Used automatically for small, targeted edits (fixing a sentence, updating one table cell, adding a paragraph in the middle) where regenerating the whole document would be wasteful. Not offered during full document "rearrange" requests.',
        },

        async run(args) {
            const rawArgs = args || {};
            const path = normalizePath(rawArgs.path);
            const command = rawArgs.command;

            try {
                switch (command) {
                    case 'view': return await cmdView(path, rawArgs);
                    case 'str_replace': return await cmdStrReplace(path, rawArgs);
                    case 'create': return await cmdCreate(path, rawArgs);
                    case 'insert': return await cmdInsert(path, rawArgs);
                    case 'undo_edit': return await cmdUndo(path, rawArgs);
                    default:
                        return { ok: false, error: `Unknown command "${command}". Must be one of: view, str_replace, create, insert, undo_edit.` };
                }
            } catch (e) {
                return { ok: false, error: `text_editor failed: ${e && e.message ? e.message : String(e)}` };
            }
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
