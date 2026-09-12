// Path: T2Editor/extend/js/t2skill_recorder.js
//
// T2SkillRecorder — Skill 시연 녹화기
// ============================================================================
// 목적: 유저가 "말로 설명하기 어려운 작업"을 채팅 대신 에디터 안에서 직접
// 손으로 시연하면, 그 과정을 대략적인 절차 요약(+ 시작/종료 시점 문서 스냅샷)
// 으로 기록한다. 이 기록 + 유저가 덧붙인 설명을 LLM에게 건네 Skill 초안을
// 만들게 하는 것은 소비자(ai_complex.js)의 몫이다 — 이 파일은 "무엇이
// 일어났는가"를 관찰해서 텍스트로 정리하는 것까지만 담당한다.
//
// 왜 정밀한 액션 로그가 아니라 "대략적" 요약인가:
//   클로드의 Computer Use처럼 클릭/좌표 단위로 재생 가능한 정밀 기록을 만들
//   방법이 이 WYSIWYG 에디터에는 없다(각 플러그인의 툴바 동작이 공통 이벤트
//   버스를 거치지 않음 — hooks.js는 submit/restore 직렬화 전용). 그래서
//   "Skill-lite"라는 이름에 맞게, MutationObserver로 문서 최상위 블록의
//   추가/삭제/변경만 굵게 관찰해 사람이 읽을 수 있는 절차 문장으로 남긴다.
//   정밀하지 않아도 LLM이 "대략 이런 순서로, 이런 종류의 블록들을 다뤘구나"를
//   파악해 Skill 지침 초안을 잡는 데는 충분하다.
//
// 공개 API (window.T2SkillRecorder):
//   T2SkillRecorder.isRecording()            → boolean
//   T2SkillRecorder.start(opts?)             → boolean (opts.id: 에디터 id)
//   T2SkillRecorder.stop()                   → transcript 객체 | null
//   T2SkillRecorder.getLastTranscript()       → 마지막 stop() 결과 재조회
//   T2SkillRecorder.describeForPrompt(transcript, userNote, maxChars)
//       → LLM에게 보낼 "문서 컨텍스트" 문자열(길이 제한 적용, 채팅의
//         document_excerpt 채널에 실어 보내는 용도)
// ============================================================================

(function () {
    'use strict';

    if (window.T2SkillRecorder) return;

    // ── 에디터 인스턴스 탐색 — t2ai_core.js가 있으면 그걸 재사용하고, 없으면
    //    (파일이 지워졌거나 로드 순서가 어긋난 경우) 최소 구현으로 방어한다.
    //    다른 t2ai_tool_*.js와 동일한 "서로 몰라도 되는" 원칙: 있으면 쓰고,
    //    없어도 이 파일 혼자서 동작한다.
    function findEditors() {
        if (window.T2AITools && typeof window.T2AITools.findEditors === 'function') {
            return window.T2AITools.findEditors();
        }
        const found = [];
        for (const key in window) {
            if (!key.endsWith('_editor')) continue;
            let val;
            try { val = window[key]; } catch (_) { continue; }
            if (val && typeof val === 'object' && val.editor && typeof val.getPlugin === 'function') {
                found.push({ id: key.slice(0, -'_editor'.length), instance: val });
            }
        }
        return found;
    }

    function resolveEditor(id) {
        const list = findEditors();
        if (!list.length) return null;
        if (!id) return list[0].instance;
        const hit = list.find(e => e.id === id);
        return hit ? hit.instance : null;
    }

    function readDSL(editor) {
        try {
            if (window.T2LLM && typeof window.T2LLM.read === 'function') {
                // T2LLM.read()는 페이지의 "첫 에디터"로 폴백하므로, 우리가 이미
                // 골라둔 editor 인스턴스와 다를 수 있는 극히 드문 멀티 에디터
                // 상황을 피하려면 id를 넘겨야 하지만, id 매핑은 T2LLM 내부에만
                // 있으므로 여기서는 페이지에 에디터가 하나뿐인 일반적인 경우를
                // 가정한다(멀티 에디터 페이지에서는 살짝 부정확할 수 있음 —
                // 어차피 "대략적" 기록이므로 치명적이지 않다).
                return window.T2LLM.read();
            }
        } catch (_) { /* 무시 — 스냅샷 없이도 나머지는 계속 동작 */ }
        return '';
    }

    // 최상위 블록 하나를 사람이 읽을 만한 짧은 설명으로 근사 변환.
    // t2llm.js의 read() 분류와 취지는 같지만, 이 파일은 그 파일에 의존하지
    // 않고 훨씬 단순화된 자체 버전만 둔다(독립성 유지 — t2llm.js가 지워져도
    // 녹화기 자체는 계속 동작해야 함, 다만 DSL 스냅샷 정확도만 낮아짐).
    function describeBlock(node) {
        if (!node || node.nodeType !== 1) return null;
        const cls = node.classList;
        if (cls && cls.contains('t2-image-block')) return 'image block';
        if (cls && cls.contains('t2-video-block')) return 'video block';
        if (cls && cls.contains('t2-file-block')) return 'file block';
        if (cls && cls.contains('t2-code-block')) return 'code block';
        if (node.dataset && node.dataset.t2Block === 'drawing') return 'drawing block';
        const tag = node.tagName.toLowerCase();
        if (tag === 'table' || node.querySelector?.('table')) return 'table';
        if (/^h[1-6]$/.test(tag)) return `heading (${tag.toUpperCase()}): "${(node.textContent || '').trim().slice(0, 30)}"`;
        if (tag === 'p' || tag === 'div') {
            const text = (node.textContent || '').trim();
            return text ? `paragraph: "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"` : null;
        }
        return `${tag} block`;
    }

    let state = null;       // 녹화 중 상태
    let lastTranscript = null;

    function isRecording() {
        return !!state;
    }

    function start(opts) {
        if (state) stop(); // 이미 녹화 중이면 정리하고 새로 시작

        const editor = resolveEditor(opts && opts.id);
        if (!editor || !editor.editor) {
            console.warn(T2Utils.tf('t2skill.console_recorder_no_editor', {}, '[T2SkillRecorder] No active T2Editor instance found — cannot start recording.'));
            return false;
        }

        const rootEl = editor.editor;
        const steps = [];
        const lastSummaryByNode = new WeakMap();
        let debounceTimer = null;
        let pendingAdded = new Set();
        let pendingRemoved = new Set();

        function flush() {
            // 같은 타이밍에 지나치게 잦은 문단 편집(타이핑 등)이 섞여 있을 수
            // 있으므로, 디바운스 창 하나당 "추가된 블록"과 "삭제된 블록"을
            // 한 문장씩으로만 정리한다 — 키 입력 하나하나를 로그로 남기지
            // 않는다(그건 "정밀 기록"이지 이 Skill-lite 녹화기의 목적이 아님).
            if (pendingAdded.size) {
                const descs = Array.from(pendingAdded).map(describeBlock).filter(Boolean);
                if (descs.length) steps.push(`Added/changed → ${descs.join(', ')}`);
            }
            if (pendingRemoved.size) {
                const descs = Array.from(pendingRemoved).map(n => lastSummaryByNode.get(n)).filter(Boolean);
                if (descs.length) steps.push(`Removed → ${descs.join(', ')}`);
            }
            pendingAdded = new Set();
            pendingRemoved = new Set();
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(n => {
                    if (n.nodeType !== 1) return;
                    // rootEl의 직계 자식으로 승격(중첩 mutation은 그 최상위 블록으로 귀속)
                    let top = n;
                    while (top.parentElement && top.parentElement !== rootEl) top = top.parentElement;
                    if (top.parentElement === rootEl) {
                        pendingAdded.add(top);
                        lastSummaryByNode.set(top, describeBlock(top));
                    }
                });
                m.removedNodes.forEach(n => {
                    if (n.nodeType !== 1) return;
                    if (lastSummaryByNode.has(n)) pendingRemoved.add(n);
                });
                if (m.type === 'characterData' && m.target) {
                    let top = m.target.parentElement;
                    while (top && top.parentElement && top.parentElement !== rootEl) top = top.parentElement;
                    if (top && top.parentElement === rootEl) pendingAdded.add(top);
                }
            });
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(flush, 700); // 입력이 잠깐 멈췄을 때만 정리
        });

        observer.observe(rootEl, { childList: true, subtree: true, characterData: true });

        state = {
            editor,
            observer,
            steps,
            startedAt: Date.now(),
            beforeDSL: readDSL(editor),
            flushTimerGetter: () => debounceTimer,
        };

        return true;
    }

    function stop() {
        if (!state) return null;
        clearTimeout(0); // no-op 안전장치
        state.observer.disconnect();

        const transcript = {
            beforeDSL: state.beforeDSL,
            afterDSL: readDSL(state.editor),
            steps: state.steps.slice(),
            startedAt: state.startedAt,
            endedAt: Date.now(),
        };
        transcript.durationMs = transcript.endedAt - transcript.startedAt;

        state = null;
        lastTranscript = transcript;
        return transcript;
    }

    function getLastTranscript() {
        return lastTranscript;
    }

    // LLM에게 넘길 컨텍스트 텍스트로 정리. maxChars(기본 3500)를 넘지 않도록
    // before/after DSL은 필요하면 잘라낸다 — ai_complex.js의 채팅 컨텍스트
    // 한도(maxChatContextChars)에 맞춰 호출하는 쪽에서 값을 넘겨준다.
    function describeForPrompt(transcript, userNote, maxChars) {
        if (!transcript) return '';
        const limit = Number(maxChars) > 0 ? Number(maxChars) : 3500;

        const lines = [];
        lines.push('[Recording of a task the user demonstrated by hand in the editor]');
        if (userNote) lines.push(`User's note: ${userNote}`);
        lines.push(`Demonstration duration: about ${Math.max(1, Math.round((transcript.durationMs || 0) / 1000))}s`);
        if (transcript.steps.length) {
            lines.push('Observed procedure (approximate order):');
            transcript.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
        } else {
            lines.push('Observed procedure: (barely any structural change detected — may have been mostly formatting/attribute edits)');
        }

        let text = lines.join('\n');
        const remaining = limit - text.length - 80;
        if (remaining > 200 && (transcript.beforeDSL || transcript.afterDSL)) {
            const half = Math.floor(remaining / 2);
            text += `\n\nDocument at the start of the demonstration (excerpt):\n${String(transcript.beforeDSL || '').slice(0, half)}`;
            text += `\n\nDocument at the end of the demonstration (excerpt):\n${String(transcript.afterDSL || '').slice(0, half)}`;
        }
        return text.slice(0, limit);
    }

    window.T2SkillRecorder = { isRecording, start, stop, getLastTranscript, describeForPrompt };
})();
