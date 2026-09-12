// Path: T2Editor/plugin/ai_complex/ai_complex.js
// 콘텐츠 생성/치환은 extend/js/t2llm.js의 T2LLM.apply()/T2LLM.read()만 사용하며,
// DOM/커서/undo 스택을 직접 조작하지 않는다.
// API: dsclub complex/interaction 엔드포인트(mode=generate|rearrange)를 사용하고,
// /extend Tool 호출은 callInteractionApi() 내부의 continuation 루프로 처리한다.

// 클래스 밖 상수로 둔 이유: 구형 브라우저 호환을 위해 static 클래스 필드 문법을 쓰지 않음.
const T2AIC_WORKLOAD_CALL_COUNTS = { low: 1, medium: 3, high: 5, max: 7, ultimate: 10 };

const T2AIC_WORKLOAD_CHAT_DIRECTIVES = [
    '',
    '방금 답변에 이어서, 더 구체적인 예시나 사례를 추가로 알려줘. 방금 한 이야기는 반복하지 말고 새로운 내용만 이어서 말해줘. 방금 문서에 추가할 내용을 제안했다면, 그 내용도 같은 방식으로 이어서 확장해줘.',
    '방금 답변과 관련해 실전에서 바로 쓸 수 있는 팁이나 주의할 점을 추가로 알려줘. 방금 한 이야기는 반복하지 말고 새로운 내용만 이어서 말해줘. 방금 문서에 추가할 내용을 제안했다면, 그 내용도 같은 방식으로 이어서 확장해줘.',
    '방금 답변에 대해 다른 관점이나 더 깊은 설명을 추가로 알려줘. 방금 한 이야기는 반복하지 말고 새로운 내용만 이어서 말해줘. 방금 문서에 추가할 내용을 제안했다면, 그 내용도 같은 방식으로 이어서 확장해줘.',
    '방금 답변과 관련해 사람들이 자주 하는 실수나 오해를 짚어서 추가로 알려줘. 방금 한 이야기는 반복하지 말고 새로운 내용만 이어서 말해줘. 방금 문서에 추가할 내용을 제안했다면, 그 내용도 같은 방식으로 이어서 확장해줘.',
    '방금 답변에 대해 비교할만한 대안이나 선택 기준을 추가로 알려줘. 방금 한 이야기는 반복하지 말고 새로운 내용만 이어서 말해줘. 방금 문서에 추가할 내용을 제안했다면, 그 내용도 같은 방식으로 이어서 확장해줘.',
    '지금까지 나눈 이야기를 마무리하는 요약과 결론을 추가로 알려줘. 방금 문서에 추가할 내용을 제안했다면, 마무리 부분을 같은 방식으로 이어서 확장해줘.',
];

function t2aicPickDirectiveIndices(count) {
    const total = T2AIC_WORKLOAD_CHAT_DIRECTIVES.length;
    const n = Math.max(1, count | 0);
    const indices = [0];
    if (total <= 1) {
        while (indices.length < n) indices.push(0);
        return indices;
    }
    let cursor = 0;
    while (indices.length < n) {
        indices.push(1 + (cursor % (total - 1)));
        cursor++;
    }
    return indices;
}

    // 사고(Thinking) 모드: 실제 답변 전에 별도 API 호출로 "어떻게 답할지"를 미리 정리한다.
    // 이 메모는 사용자에게 보이는 말풍선이 아니라 다음 호출의 history에만 실린다.
const T2AIC_THINKING_DIRECTIVE = '지금부터 사용자의 요청에 실제로 답하기 전에, 답변을 어떻게 구성할지 핵심 논리·근거·주의할 점을 스스로 정리해줘. 이건 사용자에게 그대로 보여줄 완성된 답변이 아니라 다음 단계에서 진짜 답변을 쓸 때 참고할 내부 분석 메모야. 격식을 차리지 말고 짧고 실용적인 메모 형태로만 정리해줘.';

    // 사고 단계 전용 지시문: 활성화된 Tool이 있을 때만 "필요하면 적극적으로 써라"는
    // 문구를 덧붙인다(무관한 Tool까지 억지로 쓰지 않도록 과사용 방지 문구도 포함).
const T2AIC_THINKING_TOOL_NUDGE = ' 그리고 지금 쓸 수 있는 Tool이 있다면 먼저 뭐가 있는지 살펴보고, 이 요청에 실제로 도움이 될 만한 게 있으면(예: 최신 정보 확인, 문서 안 내용 검색, 이미지·자료 찾기 등) 망설이지 말고 적극적으로 호출해서 그 결과를 반영해 메모를 정리해줘. 다만 이번 요청과 상관없는 Tool까지 억지로 끌어다 쓰지는 마.';

    // 재사고(Re-thinking): Thinking/Finalize와 달리 "정해진 횟수를 무조건 다 쓰는" 방식이 아니라,
    // 상한(전체 확정 사용량의 27%)만 정해두고 매 회차 AI가 스스로 필요 여부를 판단해 멈춘다.
const T2AIC_RETHINK_MAX_RATIO = 0.27;

function t2aicBuildRethinkPassPrompt(draft) {
    return `아래는 방금까지 이어서 작성한 답변 초안이야. 이 초안을 다시 한 번 냉정하게 검토해서, 논리적으로 빠진 부분·부정확한 부분·더 명확하게 다듬을 수 있는 부분이 있는지 스스로 판단해줘.\n\n- 정말로 다시 생각해서 고칠 부분이 있다면: 첫 줄에 "[RETHINK:REVISED]"라고만 적고, 그 다음 줄부터 개선된 답변 전체를 새로 이어서 적어줘("수정했습니다" 같은 부연 설명은 붙이지 마).\n- 다시 봐도 이미 충분히 괜찮아서 더 고칠 필요가 없다면: 다른 말 없이 "[RETHINK:DONE]" 한 줄만 적어줘.\n\n---\n${draft}\n---`;
}

    // 모델이 마커 규칙을 못 지켰거나 통제 토큰만 새어나온 "깨진 응답"을 걸러내는 안전장치.
    // 통제 토큰이 남아있거나(1), 원래 초안 대비 급격히 짧아졌다면(2) 신뢰하지 않고 직전 초안을 유지한다.
function t2aicLooksLikeBrokenRevision(candidate, originalDraft) {
    const c = String(candidate || '').trim();
    if (!c) return true;
    if (/\[?RETHINK:(REVISED|DONE)\]?/i.test(c)) return true;
    if (/\\boxed\s*\{/i.test(c)) return true;
    const draftLen = String(originalDraft || '').trim().length;
    if (draftLen >= 200 && c.length < draftLen * 0.4) return true;
    return false;
}

function t2aicParseRethinkResponse(raw, originalDraft) {
    const text = String(raw || '').trim();
    if (!text) return { needed: false, revised: null };
    if (/^\[?RETHINK:DONE\]?\s*$/i.test(text)) return { needed: false, revised: null };
    const m = text.match(/^\[?RETHINK:REVISED\]?\s*\n?([\s\S]*)$/i);
    if (m && m[1] && m[1].trim()) {
        const candidate = m[1].trim();
        if (t2aicLooksLikeBrokenRevision(candidate, originalDraft)) return { needed: false, revised: null };
        return { needed: true, revised: candidate };
    }
    // 과거엔 마커 형식이 틀려도 내용을 무조건 채택해, 깨진 응답이 멀쩡한 초안을 덮어쓰는 버그가 있었다.
    // 이제는 동일한 안전 검사를 거쳐 깨진 응답이면 채택하지 않는다.
    if (!/^\[?RETHINK:/i.test(text)) {
        if (t2aicLooksLikeBrokenRevision(text, originalDraft)) return { needed: false, revised: null };
        return { needed: true, revised: text };
    }
    return { needed: false, revised: null };
}

class T2Ai_complexPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['openAiComplex'];

        this.modal = null;
        this.mode = 'chat'; // 'chat' | 'rearrange'
        this.isProcessing = false;
        // 답변 중단(Abort)은 채팅에만 둔다 — 글쓰기/재구성은 도구 왕복 continuation 토큰 정합성 때문에
        // 중간 취소 시 상태가 깨질 위험이 더 크다.
        this.activeChatAbort = null;

        // 채팅 대화 기록은 서버에 저장되지 않는다(stateless API) — 이 플러그인 인스턴스 메모리에만
        // 있으므로 새로고침하면 사라진다.
        this.chatMessages = []; // [{ role:'user'|'assistant', content, editProposal?, applied?, provider?, model?, pending?, error? }]
        // 재구성 턴은 chatMessages와 물리적으로 분리한다 — 서버로 보내는 채팅 history에
        // 재구성 지시문이 섞여 들어가는 것을 막기 위함.
        this.rearrangeTurns = []; // [{role:'user',text} | {role:'assistant', status:'loading'|'ready'|'applied'|'error', ...}]

        this.currentInstruction = null;
        this.currentDsl = null;        // write 모드: 삽입 대기 중인 결과 DSL
        this.pendingBeforeDsl = null;  // rearrange 모드: 변경 전 문서 DSL
        this.pendingAfterDsl = null;   // rearrange 모드: 변경 후 문서 DSL(LLM 응답)

        this.focusHints = [];          // [{ preview, tag, el }] — "요소 선택"으로 지정한 대상 힌트들(복수 선택 가능)
        this.focusPickActive = false;
        this._focusPickHandler = null;
        this._focusPickHoverHandler = null;

        const baseUrl = 'https://dsclub.kr/api/ai/t2editor/complex/interaction/index.php';
        this.apiUrl = baseUrl;
        this.limitsUrl = baseUrl + '?mode=limits';
        this.sharedSecret = 'dsclubT2Editor2025';
        this.rateLimitSecret = 'RateLimitSecret2025!@#';

        this.maxInputChars = 350;      // 서버 기본값 — loadLimits() 완료 시 실측치로 갱신
        this.maxOutputChars = null;
        this.maxDocumentChars = 12000; // rearrange 모드 문서 길이 한도 — loadLimits()에서 갱신
        this.maxChatContextChars = 4000; // chat 모드에서 함께 보낼 문서 발췌 길이 한도
        this.limitsLoaded = false;
        this.rateLimitsLoaded = false;

        this.rateLimit = {
            ip: { remaining: null, limit: null },
            domain: { remaining: null, limit: null }
        };

        this.lastUsedProvider = null;
        this.lastUsedModel = null;

        this.workloadLevel = this.loadWorkloadPreference();

        this.thinkingEnabled = this.loadThinkingPreference();

        this.workloadPanelExpanded = this.loadWorkloadPanelExpandedPreference();

        this.toolsPopupEl = null;
        this._toolsPopupCleanup = null;

        // 모달을 열기 전에 백그라운드로 먼저 불러와, 실제로 열었을 때는
        // 대부분 이미 준비돼 있도록 한다(구 ai.js와 동일한 패턴).
        this.limitsLoadPromise = this.loadLimits();
        this.rateLimitsLoadPromise = this.loadRateLimits().then(() => {
            if (!this.modal) return;
            const body = this.modal.querySelector('.t2-aic-body');
            if (body) this.refreshWorkloadAvailability(body);
        });

        console.log('T2Ai_complexPlugin initialized (ai + ai_rearrange 통폐합, T2LLM 연동, complex/interaction API v3.2.0 연결 — 글쓰기/재구성 단일 엔드포인트)');
    }

    // t2ai_core.js가 아직 로드되지 않았을 수 있으므로 항상 존재 여부를 확인하고,
    // 없으면 빈 배열/무동작으로 안전 폴백한다.
    getToolCatalog() {
        if (!window.T2AITools || typeof window.T2AITools.listUI !== 'function') return [];
        try {
            return window.T2AITools.listUI();
        } catch (err) {
            console.warn('[T2Ai_complex] T2AITools.listUI() 호출 실패', err);
            return [];
        }
    }

    // 서버(v3.3.0)는 client_tools를 T2AITools.list() 그대로의 형태(name/description/params)로
    // 기대한다. 비워 보내면 서버는 도구 브릿지 전체를 비활성화한 채 기존 동작과 동일하게 응답한다.
    hasEnabledTools(mode) {
        return this.getClientToolsPayload(mode === 'rearrange' ? 'rearrange' : 'generate').length > 0;
    }

    getClientToolsPayload(mode) {
        if (!window.T2AITools || typeof window.T2AITools.list !== 'function') return [];
        try {
            return window.T2AITools.list()
                .filter(t => window.T2AITools.isEnabled(t.name))
                // 재구성 응답은 T2LLM.apply(dsl, {mode:'replace'})로 문서 전체를 교체한다.
                // 이 도중 DOM을 되돌릴 수 없게 바꾸는 Tool(unsafeForReplace)이 실행되면 그 결과가
                // 곧바로 전체 교체로 사라지므로, 재구성 모드에서는 이런 Tool을 아예 광고하지 않는다.
                .filter(t => !(t.unsafeForReplace && mode === 'rearrange'))
                .map(t => ({
                    name: t.name,
                    description: t.description || '',
                    params: (t.params && typeof t.params === 'object') ? t.params : {}
                }));
        } catch (err) {
            console.warn('[T2Ai_complex] T2AITools.list() 호출 실패', err);
            return [];
        }
    }

    // AI가 요청한 도구 호출을 T2AIHarness.run()으로 실제 실행한다.
    // T2AIHarness.run()은 설계상 절대 throw하지 않고 항상 {ok,data|error}를 resolve하므로,
    // 여기 try/catch는 T2AIHarness 자체가 없는 극단적 상황을 막기 위한 방어용이다.
    // 하나가 실패해도 나머지 호출은 계속 진행한다.
    async executeClientToolCalls(pendingToolCalls, callbacks = {}) {
        const results = [];
        for (const call of (pendingToolCalls || [])) {
            const callId = call && call.call_id ? String(call.call_id) : '';
            const name = call && call.name ? String(call.name) : '';
            const args = (call && call.args && typeof call.args === 'object') ? call.args : {};
            if (!callId || !name) continue;

            if (typeof callbacks.onCallStart === 'function') {
                try { callbacks.onCallStart(call); } catch (err) { console.warn('[T2Ai_complex] onCallStart 콜백 오류', err); }
            }

            let outcome;
            if (!window.T2AIHarness || typeof window.T2AIHarness.run !== 'function') {
                outcome = { call_id: callId, ok: false, error: '이 브라우저에서는 확장 도구를 실행할 수 없습니다(T2AIHarness 미로드).' };
            } else {
                try {
                    const res = await window.T2AIHarness.run(name, args);
                    outcome = (res && res.ok)
                        ? { call_id: callId, ok: true, data: res.data ?? null }
                        : { call_id: callId, ok: false, error: (res && res.error) ? String(res.error) : '알 수 없는 오류' };
                } catch (err) {
                    outcome = { call_id: callId, ok: false, error: (err && err.message) ? err.message : String(err) };
                }
            }
            results.push(outcome);

            if (typeof callbacks.onCallDone === 'function') {
                try { callbacks.onCallDone(call, outcome); } catch (err) { console.warn('[T2Ai_complex] onCallDone 콜백 오류', err); }
            }
        }
        return results;
    }

    // 보안 경계 헬퍼 — T2Utils가 있으면 그것을 쓰고, 없으면 안전한 폴백을 쓴다.
    escapeHtml(value) {
        if (window.T2Utils && typeof T2Utils.escapeHtml === 'function') {
            return T2Utils.escapeHtml(String(value ?? ''));
        }
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    escapeAttr(value) {
        if (window.T2Utils && typeof T2Utils.escapeAttr === 'function') {
            return T2Utils.escapeAttr(value);
        }
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    sanitizeUrl(url, context = 'href') {
        if (window.T2Utils && typeof T2Utils.sanitizeURL === 'function') {
            return T2Utils.sanitizeURL(String(url ?? ''), context);
        }
        const raw = String(url ?? '');
        const normalized = raw.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return raw;
    }

    setSafeUIHTML(target, html) {
        if (!target) return;
        const temp = document.createElement('div');
        temp.innerHTML = String(html ?? '');
        temp.querySelectorAll('script,object,embed,base,meta,iframe').forEach(el => el.remove());
        temp.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || attr.name === 'srcdoc') { el.removeAttribute(attr.name); return; }
                if (attr.name === 'href') {
                    const safe = this.sanitizeUrl(attr.value, 'href');
                    if (safe) el.setAttribute('href', safe); else el.removeAttribute('href');
                }
            });
        });
        target.innerHTML = temp.innerHTML;
    }

    safePositiveInt(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
    }

    safeCounterValue(value, fallback = '?') {
        if (value === null || value === undefined || value === '') return fallback;
        const num = Number(value);
        return Number.isFinite(num) ? String(Math.max(0, Math.floor(num))) : this.escapeHtml(value);
    }

    ensureT2LLM() {
        if (!window.T2LLM || typeof window.T2LLM.apply !== 'function') {
            throw new Error('AI 연동 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.');
        }
        return window.T2LLM;
    }

    // 현재 이 플러그인 인스턴스가 속한 에디터의 id를 찾는다.
    // (editor.lib.php는 인스턴스를 window[id + '_editor']에 노출 — t2llm.js와 동일 규약)
    resolveMyEditorId() {
        for (const key in window) {
            if (!key.endsWith('_editor')) continue;
            try {
                if (window[key] === this.editor) return key.slice(0, -'_editor'.length);
            } catch (_) { /* 접근 불가 속성 무시 */ }
        }
        return undefined; // 못 찾으면 T2LLM이 페이지의 첫 에디터로 폴백
    }

    readDocumentDSL() {
        return this.ensureT2LLM().read({ id: this.resolveMyEditorId() });
    }

    async applyDSL(dsl, mode) {
        return this.ensureT2LLM().apply(dsl, { id: this.resolveMyEditorId(), mode });
    }

    handleCommand(command) {
        if (command === 'openAiComplex') this.openModal();
    }

    // API 초기 정보 로딩(글자수 한도/모델/잔여 요청 수) — 실패해도 폴백값으로 조용히 진행한다.
    async loadLimits() {
        try {
            const res = await fetch(this.limitsUrl, { method: 'GET', cache: 'no-cache', headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.ip_limit) this.rateLimit.ip.limit = data.ip_limit;
            if (data.domain_limit) this.rateLimit.domain.limit = data.domain_limit;
            if (data.max_input_chars) this.maxInputChars = data.max_input_chars;
            if (data.max_output_chars) this.maxOutputChars = data.max_output_chars;
            if (data.max_document_chars) this.maxDocumentChars = data.max_document_chars;
            if (data.max_chat_context_chars) this.maxChatContextChars = data.max_chat_context_chars;
            this.limitsLoaded = true;
        } catch (err) {
            console.warn('[ai_complex] 한도 정보를 불러오지 못해 기본값으로 진행합니다:', err);
        }
    }

    // 실제 생성 요청 없이(GET) 현재 잔여 요청 수만 조회 — 쿼터를 소모하지 않는다.
    async loadRateLimits() {
        const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
        if (!licenseToken) { this.rateLimitsLoaded = true; return; }
        try {
            const headers = await this.buildSignedHeaders(licenseToken);
            const res = await fetch(this.apiUrl, { method: 'GET', headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data._rate_limit) {
                this.rateLimit.ip.remaining = data._rate_limit.ip.remaining;
                this.rateLimit.domain.remaining = data._rate_limit.domain.remaining;
            }
            this.rateLimitsLoaded = true;
        } catch (err) {
            console.warn('[ai_complex] 잔여 요청 수를 불러오지 못했습니다:', err);
            this.rateLimitsLoaded = true;
        }
    }

    async hmacSha256(message, secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateDomainSignature() {
        const domain = window.location.hostname;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonce = Math.random().toString(36).substring(2, 15);
        const signature = await this.hmacSha256(`${domain}|${timestamp}|${nonce}`, this.rateLimitSecret);
        return { domain, timestamp, nonce, signature };
    }

    async generateVerifyHash(licenseToken, timestamp) {
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(`${licenseToken}|${timestamp}|${this.rateLimitSecret}`));
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateSignature(text) {
        return this.hmacSha256(text, this.sharedSecret);
    }

    async buildSignedHeaders(licenseToken, bodyTextForSignature) {
        const domainSig = await this.generateDomainSignature();
        const timestamp = Math.floor(Date.now() / 1000);
        const verifyHash = await this.generateVerifyHash(licenseToken, timestamp);
        const headers = {
            'Content-Type': 'application/json',
            'X-Domain': domainSig.domain,
            'X-Domain-Timestamp': domainSig.timestamp,
            'X-Domain-Nonce': domainSig.nonce,
            'X-Domain-Signature': domainSig.signature,
            'X-T2Editor-License': licenseToken,
            'X-T2Editor-Timestamp': timestamp.toString(),
            'X-T2Editor-Verify': verifyHash
        };
        if (this.sharedSecret) {
            headers['X-DSCLUB-SIGN'] = await this.generateSignature(bodyTextForSignature || '');
        }
        return headers;
    }

    getPromptSuggestions(mode) {
        if (mode === 'rearrange') {
            return [
                '구조 먼저', '반복 줄이기', '톤 정리', '핵심부터 배치', '긴 문단 나누기',
                '중복 표현 제거', '소제목 정리', '문장 흐름 자연스럽게', '목록으로 정리',
                '중요 내용 강조', '공식적인 톤으로', '읽기 쉽게 재배열'
            ];
        }
        return [
            '제품 소개글 작성', '블로그 포스트 작성', '공지사항 작성', '이메일 초안 작성',
            '표로 비교 정리', '체크리스트 작성', '요약 정리', 'FAQ 작성'
        ];
    }

    buildPromptHintsHTML(mode) {
        return this.getPromptSuggestions(mode).map(p => `
            <button class="t2-aic-prompt-hint" type="button" data-prompt="${this.escapeAttr(p)}">${this.escapeHtml(p)}</button>
        `).join('');
    }

    insertInstructionSuggestion(textarea, suggestion) {
        if (!textarea) return;
        const prompt = String(suggestion ?? '').trim();
        if (!prompt) return;

        const value = textarea.value || '';
        const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : value.length;
        const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
        const before = value.slice(0, start);
        const after = value.slice(end);
        const leading = before.length === 0 || /\s$/.test(before) ? '' : '\n';
        const trailing = after.length === 0 || /^\s/.test(after) ? '' : '\n';
        const next = `${before}${leading}${prompt}${trailing}${after}`;

        if (next.length > this.safePositiveInt(this.maxInputChars, 350)) return;

        textarea.value = next;
        textarea.focus();
        const cursor = before.length + leading.length + prompt.length;
        textarea.setSelectionRange(cursor, cursor);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    openModal() {
        if (this.modal) this.modal.remove();

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-overlay';

        const modal = document.createElement('div');
        modal.className = 't2-aic-modal t2-aic-sheet';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const dragHandle = document.createElement('div');
        dragHandle.className = 't2-aic-sheet-handle';
        dragHandle.innerHTML = '<span></span>';

        const header = document.createElement('div');
        header.className = 't2-aic-header';
        this.setSafeUIHTML(header, `
            <div class="t2-aic-title-block">
                <div class="t2-aic-title-copy">
                    <h3><span class="t2-aic-brand-mark">T2</span><span class="t2-aic-brand-rest">Editor</span><span class="t2-aic-brand-suffix">complex AI</span></h3>
                    <p>글쓰기부터 문서 재구성까지, 대화 한 번으로.</p>
                </div>
            </div>
            <div class="t2-aic-header-actions">
                <button class="t2-aic-info" type="button" aria-label="T2Editor AI 소개"><span class="material-icons">info</span></button>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
        `);

        // "일반"은 write+chat이 합쳐진 기본 스트림이고, "재구성"만 문서 전체 교체라는
        // 위험 때문에 별도 트리거로 명시적으로 전환해야 한다.
        const modeRow = document.createElement('div');
        modeRow.className = 't2-aic-mode-row';
        this.setSafeUIHTML(modeRow, `
            <div class="t2-aic-mode-seg" role="tablist" aria-label="모드 선택">
                <button class="t2-aic-mode-btn is-active" type="button" data-mode="chat" role="tab" aria-selected="true">
                    <span class="material-icons" aria-hidden="true">forum</span> 일반
                </button>
                <button class="t2-aic-mode-btn" type="button" data-mode="rearrange" role="tab" aria-selected="false">
                    <span class="material-icons" aria-hidden="true">auto_fix_high</span> 재구성
                </button>
            </div>
        `);

        const body = document.createElement('div');
        body.className = 't2-aic-body';

        const statusBar = document.createElement('div');
        statusBar.className = 't2-aic-status-bar';

        const footer = document.createElement('div');
        footer.className = 't2-aic-footer';

        modal.appendChild(dragHandle);
        modal.appendChild(header);
        modal.appendChild(modeRow);
        modal.appendChild(body);
        modal.appendChild(statusBar);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.modal = overlay;
        this.statusBar = statusBar;
        this.footerEl = footer;
        this.renderStatusBar(statusBar);

        header.querySelector('.t2-aic-close').addEventListener('click', () => this.closeModal());
        header.querySelector('.t2-aic-info').addEventListener('click', () => this.openIntroPanel());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeModal(); });
        this.setupSheetDragToClose(modal, dragHandle);

        modeRow.querySelectorAll('.t2-aic-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.mode === this.mode) return;
                modeRow.querySelectorAll('.t2-aic-mode-btn').forEach(b => {
                    b.classList.toggle('is-active', b === btn);
                    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
                });
                this.mode = btn.dataset.mode;
                this.cancelFocusPick();
                this.closeToolsPopup();
                this.closePlusSheet();
                this.cancelSkillRecordingIfActive();
                this.renderBody(body, footer);
            });
        });

        this.renderBody(body, footer);
    }

    closeModal() {
        this.cancelFocusPick();
        // 주의: 픽 모드를 Esc로만 종료하고 모달을 바로 닫으면 focusHints의 하이라이트가
        // 문서에 영구히 남는 버그가 있었다 — 모달이 완전히 닫힐 때는 선택 내용과 하이라이트를 반드시 제거한다.
        this.clearAllFocusHints();
        this.closeToolsPopup();
        this.closePlusSheet();
        this.closeIntroPanel();
        this.cancelSkillRecordingIfActive();
        this.disconnectChatBottomSpacingObserver();
        if (this.modal) { this.modal.remove(); this.modal = null; }
        this.statusBar = null;
    }

    cancelSkillRecordingIfActive() {
        if (window.T2SkillRecorder && typeof window.T2SkillRecorder.isRecording === 'function' && window.T2SkillRecorder.isRecording()) {
            try { window.T2SkillRecorder.stop(); } catch (_) {}
        }
        if (this._recordBar) { this._recordBar.remove(); this._recordBar = null; }
        if (this.modal) this.modal.classList.remove('t2-aic-hidden-while-picking');
    }

    // write/rearrange는 "지시문 → 결과" 흐름이라 footer에 실행 버튼이 있고, chat은 자체
    // 입력창을 몸체 안에 들고 있어 footer를 쓰지 않는다.
    renderBody(body, footer) {
        this.disconnectChatBottomSpacingObserver();
        const isChat = this.mode === 'chat';
        const modalEl = body.closest('.t2-aic-modal');
        if (modalEl) modalEl.classList.toggle('is-chat-mode', isChat);
        body.classList.toggle('is-chat-mode', isChat);
        // 채팅 모드는 안내 문구+초기화 버튼을 footer 안에서 자체 처리하므로,
        // 이 독립 상태 바는 채팅 모드일 때만 숨긴다.
        if (this.statusBar) this.statusBar.classList.toggle('is-hidden', isChat);

        this.setSafeUIHTML(body, isChat ? this.getChatSectionHTML() : this.getInstructionSectionHTML());

        if (!isChat) {
            const streamSection = document.createElement('section');
            streamSection.className = 't2-aic-result t2-aic-rearrange-stream';
            streamSection.setAttribute('aria-live', 'polite');
            body.appendChild(streamSection);

            this.setupInstructionSection(body, footer);
            this.renderRearrangeStream(body);
        } else {
            this.setupChatSection(body, footer);
        }
    }

    getToolsTriggerHTML() {
        return `
            <button type="button" class="t2-aic-tools-trigger" data-tools-popup-trigger
                aria-haspopup="true" aria-expanded="false" aria-label="Tool 목록 보기">
                <span class="material-icons" aria-hidden="true">handyman</span>
                <span class="t2-aic-tools-trigger-badge" hidden>0</span>
            </button>
        `;
    }

    setupToolsTrigger(root) {
        if (!root) return;
        root.querySelectorAll('[data-tools-popup-trigger]').forEach(btn => {
            if (btn.dataset.wiredTools) return;
            btn.dataset.wiredTools = '1';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openPlusSheet('tools');
            });
        });
        this.refreshToolsTrigger();
    }

    refreshToolsTrigger() {
        const catalog = this.getToolCatalog();
        const enabledCount = catalog.filter(t => t.enabled).length;
        document.querySelectorAll('.t2-aic-tools-trigger').forEach(btn => {
            const badge = btn.querySelector('.t2-aic-tools-trigger-badge');
            btn.classList.toggle('is-empty', !catalog.length);
            btn.setAttribute('aria-label', catalog.length ? `Tool ${enabledCount}/${catalog.length}개 사용중 — 목록 보기` : '연결된 Tool 없음');
            if (!badge) return;
            if (enabledCount > 0) {
                badge.textContent = String(enabledCount);
                badge.hidden = false;
            } else {
                badge.hidden = true;
            }
        });
    }

    getToolDisplayInfo(name) {
        const catalog = this.getToolCatalog();
        const hit = catalog.find(t => t.name === name || t.id === name);
        if (hit) return { label: hit.label || name, icon: hit.icon || 'build' };
        // 그룹 대표 이름과 다른 개별 Tool(같은 그룹 내 2번째 이후 등록분)일
        // 수 있다 — 그런 경우엔 이름을 그대로 사람이 읽기 좋게만 다듬는다.
        const humanized = String(name || '').replace(/_/g, ' ').trim();
        return { label: humanized || name || '알 수 없는 Tool', icon: 'build' };
    }

    buildToolArgsPreview(args) {
        if (!args || typeof args !== 'object') return '';
        const firstKey = Object.keys(args)[0];
        if (!firstKey) return '';
        const v = args[firstKey];
        if (v === null || v === undefined || v === '') return '';
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        return s.length > 44 ? s.slice(0, 44) + '…' : s;
    }

    // 활동 표시줄: "생각 중 → 실행 중 → 완료"를 하나의 엘리먼트로 표시한다.
    //   reasoning: 서버가 채워줄 때만 존재(비-스트리밍 API라 완성된 채로 한 번에 도착).
    //   stillGenerating: Tool을 다 썼어도 메시지가 아직 pending이면 계속 움직이는 상태로 표시.
    // opts.static=true면 웨이브 애니메이션 없이 모든 도트가 완전히 켜진
    // 상태로 고정된다 — 답변이 끝난 뒤 그 아래 남는 "서명" 용도.
    getBrandSpinnerHTML(opts = {}) {
        const staticCls = opts.static ? ' is-static' : '';
        return `
            <span class="t2-aic-brand-spinner${staticCls}" aria-hidden="true">
                <span class="t2-aic-bs-char" data-ch="T"></span>
                <span class="t2-aic-bs-char" data-ch="2"></span>
                <span class="t2-aic-bs-char" data-ch="E"></span>
            </span>
        `;
    }

    // onToolRound는 매 라운드 "새로 요청된" Tool 호출만 넘긴다(누적본 아님) — 그대로 대입하면
    // 이전 라운드 기록이 덮어써지므로 call_id 기준으로 이어붙인다.
    mergeToolCalls(existingCalls, newCalls) {
        const existing = Array.isArray(existingCalls) ? existingCalls : [];
        const incoming = Array.isArray(newCalls) ? newCalls : [];
        const seen = new Set(existing.map(c => c && c.call_id));
        const additions = incoming.filter(c => c && !seen.has(c.call_id));
        return existing.concat(additions);
    }

    renderActivityLineHTML(calls, statusMap, opts = {}) {
        const list = Array.isArray(calls) ? calls : [];
        const stillGenerating = !!opts.stillGenerating;
        const reasoning = (typeof opts.reasoning === 'string' && opts.reasoning.trim()) ? opts.reasoning.trim() : '';

        if (!list.length && !reasoning) {
            // 아직 Tool 호출도, 사고 내용도 없는 순수 대기 단계 — 펼칠
            // 내용이 없으므로 버튼이 아니라 정적인 한 줄로만 존재한다.
            if (!stillGenerating) return '';
            const label = opts.thinkingLabel || '생각하는 중…';
            return `
                <div class="t2-aic-tool-round t2-aic-tool-round-plain">
                    <span class="t2-aic-tool-round-spin is-spinning" aria-hidden="true">${this.getBrandSpinnerHTML()}</span>
                    <span class="t2-aic-tool-round-summary">${this.escapeHtml(label)}</span>
                </div>
            `;
        }
        return this.renderToolRoundHTML(list, statusMap, { stillGenerating, reasoning });
    }

    // calls: [{call_id, name, args}], statusMap: Map(call_id -> 'ok'|'error')
    // (아직 없으면 'running'으로 취급)
    renderToolRoundHTML(calls, statusMap, opts = {}) {
        const list = Array.isArray(calls) ? calls : [];
        const stillGenerating = !!opts.stillGenerating;
        const reasoning = (typeof opts.reasoning === 'string' && opts.reasoning.trim()) ? opts.reasoning.trim() : '';
        const doneCount = list.filter(c => statusMap && statusMap.get(c.call_id) && statusMap.get(c.call_id) !== 'running').length;
        const allDone = list.length === 0 || doneCount === list.length;
        // Tool이 전부 끝났어도, 메시지 자체가 아직 pending이면(= 이 결과를
        // 바탕으로 최종 문장을 마저 쓰는 중이면) 계속 움직이는 상태로 둔다.
        const spinning = !allDone || stillGenerating;

        // 사고 내용이 있으면 목록 맨 위, Tool 실행 내역보다 먼저 보여준다
        // (실제로도 판단 → 실행 순서이므로).
        const reasoningRow = reasoning ? `
            <div class="t2-aic-tool-reasoning">${this.renderChatMarkdown(reasoning)}</div>
        ` : '';

        const rows = list.map(c => {
            const info = this.getToolDisplayInfo(c.name);
            const st = (statusMap && statusMap.get(c.call_id)) || 'running';
            const stateIcon = st === 'running' ? 'autorenew' : (st === 'error' ? 'error_outline' : 'check_circle');
            const stateCls = st === 'running' ? 'is-running' : (st === 'error' ? 'is-error' : 'is-done');
            const preview = this.buildToolArgsPreview(c.args);
            return `
                <div class="t2-aic-tool-call-row ${stateCls}">
                    <span class="material-icons t2-aic-tool-call-icon" aria-hidden="true">${this.escapeHtml(info.icon)}</span>
                    <span class="t2-aic-tool-call-label">${this.escapeHtml(info.label)}${preview ? `<span class="t2-aic-tool-call-args">${this.escapeHtml(preview)}</span>` : ''}</span>
                    <span class="material-icons t2-aic-tool-call-state ${stateCls}" aria-hidden="true">${stateIcon}</span>
                </div>
            `;
        }).join('');

        let summary;
        if (!list.length) {
            // Tool은 없고 사고 내용만 있는 경우 — 답변에 곁들여진 생각을
            // 나중에라도 펼쳐볼 수 있게 한 줄만 남긴다.
            summary = stillGenerating ? '생각하는 중…' : '생각 과정 보기';
        } else if (!allDone) {
            summary = `Tool ${list.length}개 실행 중…`;
        } else {
            summary = stillGenerating ? `Tool ${list.length}개 사용됨 · 답변 작성 중…` : `Tool ${list.length}개 사용됨`;
        }

        return `
            <div class="t2-aic-tool-round${(allDone && !stillGenerating) ? ' is-collapsed' : ''}">
                <button type="button" class="t2-aic-tool-round-toggle">
                    <span class="t2-aic-tool-round-spin ${spinning ? 'is-spinning' : ''}" aria-hidden="true">${spinning ? this.getBrandSpinnerHTML() : '<span class="material-icons">check_circle</span>'}</span>
                    <span class="t2-aic-tool-round-summary">${this.escapeHtml(summary)}</span>
                    <span class="material-icons t2-aic-tool-round-chevron" aria-hidden="true">expand_more</span>
                </button>
                <div class="t2-aic-tool-round-list">${reasoningRow}${rows}</div>
            </div>
        `;
    }

    // 렌더된 컨테이너 안의 접이식 Tool 라운드 토글 버튼에 이벤트를 건다.
    // (채팅 메시지 목록/재구성 스트림 둘 다에서 재사용)
    wireToolRoundToggles(container) {
        if (!container) return;
        container.querySelectorAll('.t2-aic-tool-round-toggle').forEach(btn => {
            if (btn.dataset.wired) return;
            btn.dataset.wired = '1';
            btn.addEventListener('click', () => {
                const round = btn.closest('.t2-aic-tool-round');
                if (round) round.classList.toggle('is-collapsed');
            });
        });
    }

    renderRearrangeStream(body) {
        const el = body.querySelector('.t2-aic-rearrange-stream');
        if (!el) return;
        if (!this.rearrangeTurns.length) {
            el.classList.remove('is-visible');
            this.setSafeUIHTML(el, '');
            return;
        }
        el.classList.add('is-visible');
        this.setSafeUIHTML(el, this.rearrangeTurns.map((t, i) =>
            this.getRearrangeTurnHTML(t, i, i === this.rearrangeTurns.length - 1)
        ).join(''));

        this.rearrangeTurns.forEach((t, i) => {
            if (t.role !== 'assistant' || (t.status !== 'ready' && t.status !== 'applied')) return;
            const slot = el.querySelector(`[data-turn-idx="${i}"] .t2-aic-rearrange-diff-slot`);
            if (slot) this.renderSplitDiff(t.beforeDsl, t.afterDsl, slot);
        });

        el.querySelectorAll('[data-rearrange-apply]').forEach(btn => {
            btn.addEventListener('click', () => this.applyRearranged());
        });
        el.querySelectorAll('[data-rearrange-retry]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalEl = body.closest('.t2-aic-modal');
                const footer = modalEl ? modalEl.querySelector('.t2-aic-footer') : null;
                if (footer && !this.isProcessing) this.runRearrange(btn.dataset.rearrangeRetry || '', body, footer);
            });
        });
        this.wireToolRoundToggles(el);

        try { el.scrollTop = el.scrollHeight; } catch (_) {}
    }

    getRearrangeTurnHTML(turn, idx, isLatest) {
        if (turn.role === 'user') {
            return `
                <div class="t2-aic-chat-msg is-user">
                    <div class="t2-aic-chat-msg-content">${this.renderChatMarkdown(turn.text || '')}</div>
                </div>
            `;
        }

        const isLoading = turn.status === 'loading';
        let inner = this.renderActivityLineHTML(turn.toolCalls, turn.toolStatus, { stillGenerating: isLoading, thinkingLabel: '문서를 분석하고 재구성하고 있습니다…', reasoning: turn.reasoning });
        if (turn.status === 'error') {
            inner += `<div class="t2-aic-chat-error"><span class="material-icons" aria-hidden="true">error_outline</span><span>${this.escapeHtml(turn.error || '오류가 발생했습니다')}</span></div>`;
        } else if (!isLoading) {
            inner += `<div class="t2-aic-rearrange-diff-slot"></div>`;
            if (turn.provider || turn.model) {
                inner += `<div class="t2-aic-chat-model">${this.escapeHtml(turn.model || '알 수 없는 모델')}${turn.provider ? ' · ' + this.escapeHtml(turn.provider) : ''}</div>`;
            }
            if (turn.status === 'applied') {
                inner += `<div class="t2-aic-rearrange-applied-badge"><span class="material-icons" aria-hidden="true">check_circle</span> 문서에 적용됨</div>`;
            } else if (isLatest) {
                inner += `
                    <div class="t2-aic-rearrange-turn-actions">
                        <button class="t2-aic-btn t2-aic-btn-ghost" type="button" data-rearrange-retry="${this.escapeAttr(turn.instruction || '')}">
                            <span class="material-icons" aria-hidden="true">refresh</span><span>다시 생성</span>
                        </button>
                        <button class="t2-aic-btn t2-aic-btn-success" type="button" data-rearrange-apply>
                            <span class="material-icons" aria-hidden="true">check</span><span>변경 적용</span>
                        </button>
                    </div>
                `;
            } else {
                inner += `<div class="t2-aic-rearrange-stale-hint">이전 요청의 결과입니다 — 최신 요청에서만 적용할 수 있어요.</div>`;
            }
        }

        return `
            <div class="t2-aic-chat-msg is-assistant" data-turn-idx="${idx}">
                <div class="t2-aic-chat-msg-content">${inner}</div>
            </div>
        `;
    }
    openPlusSheet(initialSegment = 'tools', opts = {}) {
        this.closePlusSheet();

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-plus-sheet-overlay';

        const sheet = document.createElement('div');
        sheet.className = 't2-aic-plus-sheet t2-aic-sheet';
        this.setSafeUIHTML(sheet, `
            <div class="t2-aic-sheet-handle"><span></span></div>
            <div class="t2-aic-plus-sheet-head">
                <div class="t2-aic-mode-seg t2-aic-plus-seg" role="tablist" aria-label="Tool 또는 Skill 선택">
                    <button class="t2-aic-mode-btn" type="button" data-seg="tools" role="tab" aria-selected="false">
                        <span class="material-icons" aria-hidden="true">handyman</span> Tool
                    </button>
                    <button class="t2-aic-mode-btn" type="button" data-seg="skills" role="tab" aria-selected="false">
                        <span class="material-icons" aria-hidden="true">bolt</span> Skill
                    </button>
                </div>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-plus-sheet-body"></div>
        `);

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
        this._plusSheetEl = overlay;
        this.setupSheetDragToClose(sheet, sheet.querySelector('.t2-aic-sheet-handle'), () => this.closePlusSheet());

        const sheetBody = sheet.querySelector('.t2-aic-plus-sheet-body');
        const segBtns = sheet.querySelectorAll('[data-seg]');

        const renderSegment = (seg) => {
            segBtns.forEach(b => {
                const active = b.dataset.seg === seg;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            if (seg === 'tools') {
                this.setSafeUIHTML(sheetBody, `
                    <p class="t2-aic-plus-sheet-hint">눌러서 켜고 끌 수 있어요 — 꺼진 Tool은 AI가 아예 쓸 수 없습니다.</p>
                    <div class="t2-aic-tools-popup-list t2-aic-plus-tools-list"></div>
                `);
                this.renderToolsPopupList(sheetBody.querySelector('.t2-aic-plus-tools-list'));
            } else {
                this.setSafeUIHTML(sheetBody, this.getSkillsSectionHTML());
                this.setupSkillsSection(sheetBody);
                this.setupSkillImportButton(sheetBody);
                if (opts.skillDraft) {
                    setTimeout(() => this.openSkillBuilder(sheetBody, { draft: opts.skillDraft }), 0);
                }
            }
        };
        segBtns.forEach(btn => btn.addEventListener('click', () => renderSegment(btn.dataset.seg)));
        renderSegment(initialSegment);

        sheet.querySelector('.t2-aic-close').addEventListener('click', () => this.closePlusSheet());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closePlusSheet(); });
        this._plusSheetEscHandler = (e) => { if (e.key === 'Escape') this.closePlusSheet(); };
        document.addEventListener('keydown', this._plusSheetEscHandler);
    }

    closePlusSheet() {
        if (this._plusSheetEl) { this._plusSheetEl.remove(); this._plusSheetEl = null; }
        if (this._plusSheetEscHandler) {
            document.removeEventListener('keydown', this._plusSheetEscHandler);
            this._plusSheetEscHandler = null;
        }
    }

    // "가져오기"는 .json 스킬 파일을 브라우저(localStorage)에 등록한다(서버 업로드 아님).
    // 기대 형식: { "name": "...", "description": "...", "body": "..." }
    setupSkillImportButton(container) {
        const introEl = container.querySelector('.t2-aic-skills-intro');
        if (!introEl || introEl.querySelector('.t2-aic-skill-import-btn')) return;

        const importRow = document.createElement('div');
        importRow.className = 't2-aic-skill-import-row';
        this.setSafeUIHTML(importRow, `
            <input type="file" accept="application/json,.json" class="t2-aic-skill-import-input" hidden>
            <button type="button" class="t2-aic-btn t2-aic-btn-ghost t2-aic-skill-import-btn">
                <span class="material-icons" aria-hidden="true">upload_file</span>
                <span>.json 파일로 가져오기</span>
            </button>
        `);
        introEl.insertAdjacentElement('afterend', importRow);

        const fileInput = importRow.querySelector('.t2-aic-skill-import-input');
        importRow.querySelector('.t2-aic-skill-import-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (!window.T2Skills || typeof window.T2Skills.saveUserSkill !== 'function') {
                alert('스킬 기능을 불러오지 못했습니다 (extend/js/t2skill_core.js 미로드)');
                return;
            }
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const result = window.T2Skills.saveUserSkill({
                    name: parsed.name,
                    description: parsed.description,
                    body: parsed.body,
                    origin: 'import',
                });
                if (!result.ok) { alert(`가져오기 실패: ${result.error}`); return; }
                this.renderSkillsList(container);
            } catch (err) {
                alert('올바른 Skill JSON 파일이 아닙니다. { "name", "description", "body" } 형식이어야 합니다.');
            }
        });
    }

    setupSheetDragToClose(sheetEl, handleEl, onClose) {
        if (!handleEl) return;
        let startY = 0;
        let dragging = false;

        const onMove = (clientY) => {
            const dy = Math.max(0, clientY - startY);
            sheetEl.style.transform = `translateY(${dy}px)`;
        };
        const onEnd = (clientY) => {
            dragging = false;
            const dy = clientY - startY;
            sheetEl.style.transform = '';
            if (dy > 90) (onClose || (() => this.closeModal()))();
        };

        handleEl.addEventListener('pointerdown', (e) => {
            dragging = true;
            startY = e.clientY;
            handleEl.setPointerCapture && handleEl.setPointerCapture(e.pointerId);
        });
        handleEl.addEventListener('pointermove', (e) => { if (dragging) onMove(e.clientY); });
        handleEl.addEventListener('pointerup', (e) => { if (dragging) onEnd(e.clientY); });
        handleEl.addEventListener('pointercancel', () => { dragging = false; sheetEl.style.transform = ''; });
    }

    // 하단 고정 영역 높이가 계속 바뀌므로 ResizeObserver로 실시간 관찰해 --t2-aic-chat-bottom-h
    // CSS 변수로 되돌려준다 — body가 다시 그려질 때마다 이전 관찰자를 반드시 끊어야 한다.
    setupChatBottomSpacingObserver(body) {
        this.disconnectChatBottomSpacingObserver();
        const bottomEl = body.querySelector('.t2-aic-chat-bottom');
        const wrapEl = body.querySelector('.t2-aic-chat-messages-wrap');
        if (!bottomEl || !wrapEl) return;

        const sync = () => {
            wrapEl.style.setProperty('--t2-aic-chat-bottom-h', (bottomEl.offsetHeight + 12) + 'px');
        };
        sync();

        if (typeof ResizeObserver !== 'undefined') {
            this._chatBottomResizeObserver = new ResizeObserver(sync);
            this._chatBottomResizeObserver.observe(bottomEl);
        } else {
            // ResizeObserver 미지원 구형 환경 — 창 크기 변경 때만이라도 갱신한다.
            this._chatBottomResizeFallback = sync;
            window.addEventListener('resize', sync);
        }
    }

    disconnectChatBottomSpacingObserver() {
        if (this._chatBottomResizeObserver) {
            try { this._chatBottomResizeObserver.disconnect(); } catch (_) { /* no-op */ }
            this._chatBottomResizeObserver = null;
        }
        if (this._chatBottomResizeFallback) {
            window.removeEventListener('resize', this._chatBottomResizeFallback);
            this._chatBottomResizeFallback = null;
        }
    }

    openIntroPanel() {
        this.closeIntroPanel();

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-intro-overlay';

        const panel = document.createElement('div');
        panel.className = 't2-aic-intro-panel t2-aic-sheet';
        this.setSafeUIHTML(panel, `
            <div class="t2-aic-sheet-handle"><span></span></div>
            <div class="t2-aic-intro-head">
                <h3><span class="t2-aic-brand-mark">T2</span><span class="t2-aic-brand-rest">Editor</span><span class="t2-aic-brand-suffix">complex AI</span></h3>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-intro-seg" role="tablist">
                <button class="t2-aic-mode-btn is-active" type="button" data-intro-seg="about" role="tab" aria-selected="true">소개</button>
                <button class="t2-aic-mode-btn" type="button" data-intro-seg="dev" role="tab" aria-selected="false">개발자</button>
            </div>
            <div class="t2-aic-intro-body"></div>
        `);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this._introPanelEl = overlay;
        this.setupSheetDragToClose(panel, panel.querySelector('.t2-aic-sheet-handle'), () => this.closeIntroPanel());

        const bodyEl = panel.querySelector('.t2-aic-intro-body');
        const segBtns = panel.querySelectorAll('[data-intro-seg]');
        const renderSeg = (seg) => {
            segBtns.forEach(b => {
                const active = b.dataset.introSeg === seg;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            this.setSafeUIHTML(bodyEl, seg === 'dev' ? this.getIntroDevSectionHTML() : this.getIntroAboutSectionHTML());
        };
        segBtns.forEach(btn => btn.addEventListener('click', () => renderSeg(btn.dataset.introSeg)));
        renderSeg('about');

        panel.querySelector('.t2-aic-close').addEventListener('click', () => this.closeIntroPanel());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeIntroPanel(); });
    }

    closeIntroPanel() {
        if (this._introPanelEl) { this._introPanelEl.remove(); this._introPanelEl = null; }
    }

    openDisclaimerPopup() {
        this.closeDisclaimerPopup();
        document.querySelectorAll('.t2-aic-tool-info-overlay').forEach(p => p.remove());

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-info-overlay t2-aic-disclaimer-overlay';
        const popup = document.createElement('div');
        popup.className = 't2-aic-info-popup t2-aic-disclaimer-popup';
        this.setSafeUIHTML(popup, this.getDisclaimerPopupHTML());
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        this._disclaimerPopupEl = overlay;

        const close = () => this.closeDisclaimerPopup();
        popup.querySelector('.t2-aic-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        this._disclaimerEscHandler = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', this._disclaimerEscHandler);
    }

    closeDisclaimerPopup() {
        if (this._disclaimerPopupEl) { this._disclaimerPopupEl.remove(); this._disclaimerPopupEl = null; }
        if (this._disclaimerEscHandler) {
            document.removeEventListener('keydown', this._disclaimerEscHandler);
            this._disclaimerEscHandler = null;
        }
    }

    getDisclaimerPopupHTML() {
        const warn = this.getRateLimitWarning();
        return `
            <div class="t2-aic-info-head">
                <span class="material-icons t2-aic-title-icon" aria-hidden="true" style="font-size:20px;">info</span>
                <strong>이용 안내</strong>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-llm-disclaimer">
                <span class="material-icons" aria-hidden="true">info</span>
                <p>T2Editor AI는 <b>생성형 AI(LLM)</b>를 기반으로 답합니다. 답변에는 실제와 다르거나 부정확한 내용이 섞여 있을 수 있으니, 중요한 내용은 적용하기 전에 꼭 한 번 더 확인해 주세요.</p>
            </div>
            <div class="t2-aic-llm-disclaimer">
                <span class="material-icons" aria-hidden="true">shield</span>
                <p>답변을 만드는 과정에서 입력하신 내용은 답변 생성을 위해 AI API를 제공하는 외부 업체에 전달될 수 있습니다. T2Editor AI를 계속 이용하시면 이러한 처리 방식에 동의하신 것으로 안내드립니다.</p>
            </div>
            <div class="t2-aic-info-usage${warn ? ' is-warning' : ''}" style="margin-bottom:0;">
                <span><span class="material-icons" aria-hidden="true">person</span>내 요청 ${this.safeCounterValue(this.rateLimit.ip.remaining)}/${this.safeCounterValue(this.rateLimit.ip.limit)}</span>
                <span><span class="material-icons" aria-hidden="true">public</span>서버 요청 ${this.safeCounterValue(this.rateLimit.domain.remaining)}/${this.safeCounterValue(this.rateLimit.domain.limit)}</span>
            </div>
        `;
    }

    getIntroAboutSectionHTML() {
        const warn = this.getRateLimitWarning();
        return `
            <div class="t2-aic-intro-section">
                <p class="t2-aic-intro-lede">지금 쓰고 계신 T2Editor complex AI는 T2Editor AI 베이스 시스템 위에서 작동해요.</p>

                <p>이 베이스는 <b>Tool</b>과 <b>Skill</b>을 다루는 공통 기반이에요. 누구나 만들어
                이 에디터에 연결할 수 있고, 그렇게 만든 확장은 어디에서든 그대로 이어집니다.</p>

                <div class="t2-aic-info-list">
                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">build</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>handyman</h4>
                            <p>문서 검색, 이미지 삽입, 외부 정보 조회처럼 대화만으로 하기 어려운 일을 도와줍니다. 어떤 도구를 쓸지는 항상 사용자가 정할 수 있어요.</p>
                        </div>
                    </div>

                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">bolt</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>Skill</h4>
                            <p>자주 쓰는 작업 방식이나 문체를 저장해두는 기능이에요. 한 번 만들어두면 다음에도 같은 방식으로 결과를 만들어줍니다.</p>
                        </div>
                    </div>

                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">shield</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>안전하게 작동해요</h4>
                            <p>자체 보호 기술이 모든 요청을 지켜봅니다. 하나가 문제가 생겨도 나머지 작업과 문서는 영향받지 않아요.</p>
                        </div>
                    </div>

                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">visibility</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>먼저 보여드리고, 그다음에 반영해요</h4>
                            <p>무엇이 바뀌는지 먼저 확인하고, 원할 때만 적용하세요. 되돌릴 수 없는 변화는 강요하지 않습니다.</p>
                        </div>
                    </div>
                </div>

                <p>여기에 <b>T2Editor complex AI</b>만의 기능 두 가지가 더해져요.</p>

                <div class="t2-aic-info-list">
                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">tune</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>작업량</h4>
                            <p>지금 맡기려는 일의 크기에 맞춰 작업량을 고를 수 있어요. 간단한 요청은 가볍게, 복잡하고 손이 많이 가는 요청은 넉넉하게 — 작업량을 올릴수록 더 깊고 풍부한 결과를 받을 수 있지만, 그만큼 사용량도 함께 늘어나요.</p>
                        </div>
                    </div>

                    <div class="t2-aic-info-item">
                        <span class="t2-aic-info-badge" aria-hidden="true"><span class="material-icons">psychology</span></span>
                        <div class="t2-aic-info-copy">
                            <h4>Thinking</h4>
                            <p>답변을 내놓기 전에 한 번 더 생각을 정리하는 모드예요. 여러 단계를 거쳐야 하거나 논리가 복잡한 요청일수록 Thinking을 켜두면 더 효과적으로 일을 처리하는 데 도움이 됩니다.</p>
                        </div>
                    </div>
                </div>

                <div class="t2-aic-info-usage${warn ? ' is-warning' : ''}">
                    <span><span class="material-icons" aria-hidden="true">person</span>내 요청 ${this.safeCounterValue(this.rateLimit.ip.remaining)}/${this.safeCounterValue(this.rateLimit.ip.limit)}</span>
                    <span><span class="material-icons" aria-hidden="true">public</span>서버 요청 ${this.safeCounterValue(this.rateLimit.domain.remaining)}/${this.safeCounterValue(this.rateLimit.domain.limit)}</span>
                </div>
            </div>
        `;
    }

    getIntroDevSectionHTML() {
        return `
            <div class="t2-aic-intro-section t2-aic-intro-dev">
                <p class="t2-aic-intro-dev-lede">조금 더 자세히 들여다보면, T2Editor AI 베이스 시스템은 이렇게 움직여요.</p>

                <div class="t2-aic-dev-block">
                    <h4><span class="material-icons" aria-hidden="true">handyman</span> Tool</h4>
                    <p>문서 검색, 이미지 삽입, 외부 정보 조회처럼 대화만으로 할 수 없는 일을 Tool로 직접 수행합니다. 무엇을 허용할지는 언제나 사용자가 정해요 — 꺼둔 Tool은 절대 쓰이지 않아요.</p>
                </div>

                <div class="t2-aic-dev-block">
                    <h4><span class="material-icons" aria-hidden="true">bolt</span> Skill-lite</h4>
                    <p>무거운 지식 파일 대신, "언제 어떻게 움직일지"만 짧게 적어두는 규격이에요. 적은 토큰으로도 일관된 결과를 만듭니다.</p>
                </div>

                <div class="t2-aic-dev-block">
                    <h4><span class="material-icons" aria-hidden="true">shield</span> T2AIHarness</h4>
                    <p>대화의 맥락을 붙들고, 부적절한 요청이나 프롬프트 인젝션 같은 시도를 걸러내며, Tool 호출이 더 안정적으로 끝까지 실행되도록 돕는 공통 실행 계층이에요. 이 베이스 시스템 위에서 동작하는 여러 AI 플러그인이 이 하네스를 함께 씁니다.</p>
                </div>

                <p class="t2-aic-intro-dev-lede">여기까지는 T2Editor AI 베이스 시스템의 이야기고, 지금 쓰고 계신 <b>T2Editor complex AI</b> 플러그인은 그 위에서 다음 두 가지를 자체적으로 더 얹어 움직여요.</p>

                <div class="t2-aic-dev-block">
                    <h4><span class="material-icons" aria-hidden="true">tune</span> 작업량(Workload)</h4>
                    <p>작업량을 올리는 건 답을 부풀리는 일이 아니라, 실제로 API 호출 시행 횟수 자체를 늘리는 일이에요. 단계가 올라갈수록 서버를 더 여러 번 왕복하며 매번 조금씩 다른 관점과 깊이를 받아와 이어붙이거든요. 그래서 단계를 올릴수록 결과는 더 두터워지지만, 그 대가로 호출 횟수도 같이 늘어나요 — 어느 쪽이 더 나은지는 다루는 일의 성격에 달려 있습니다.</p>
                </div>

                <div class="t2-aic-dev-block">
                    <h4><span class="material-icons" aria-hidden="true">psychology</span> Thinking</h4>
                    <p>연결된 모델이 자체적인 사고 능력을 갖추고 있는지와는 별개로 작동해요. Thinking을 켜두면, 그런 능력이 없는 모델을 쓰고 있더라도 T2Editor complex AI가 답변 전에 한 번 더 정리하는 과정을 스스로 거치게 만들어서, 마치 그 모델이 직접 생각한 것과 비슷한 효과를 내도록 돕습니다. 정확히 어떤 원리로 얼마나 더 나아지는지는 딱 잘라 말하기 어렵지만, 복잡한 요청일수록 대체로 도움이 되는 편이에요.</p>
                </div>
            </div>
        `;
    }

    getInstructionSectionHTML() {
        const maxChars = this.safePositiveInt(this.maxInputChars, 350);
        const isRearrange = this.mode === 'rearrange';
        return `
            <section class="t2-aic-instruction-section">
                <label class="t2-aic-section-label" for="t2-aic-instruction">${isRearrange ? '재구성 요청' : '작성 요청'}</label>
                <p class="t2-aic-section-desc">${isRearrange
                    ? 'AI가 지금 문서 전체를 파악한 뒤 지시에 맞게 다시 씁니다. 적용 전 변경 내역을 항상 먼저 확인할 수 있습니다.'
                    : '무엇을 써야 할지 설명해주세요. 결과는 현재 문서 뒤에 이어붙습니다.'}</p>
                <div class="t2-aic-instruction-card">
                    <div class="t2-aic-input-shell">
                        <textarea id="t2-aic-instruction" class="t2-aic-instruction" maxlength="${this.escapeAttr(maxChars)}"
                            placeholder="${isRearrange ? '예: 이미지를 먼저 보여주고, 핵심 문단을 앞으로 옮겨 자연스럽게 정리해줘' : '예: 제품 소개글 작성, 블로그 포스트 작성 등'}"></textarea>
                    </div>
                    <div class="t2-aic-char-count-row">
                        <span class="t2-aic-char-count">0/${this.escapeHtml(maxChars)}자</span>
                    </div>
                </div>
                <div class="t2-aic-prompt-hints">${this.buildPromptHintsHTML(this.mode)}</div>
                <div class="t2-aic-focus-row-section">
                    <button class="t2-aic-focus-btn" type="button">
                        <span class="material-icons" aria-hidden="true">ads_click</span>
                        <span class="t2-aic-focus-btn-text">문서에서 특정 부분 선택</span>
                    </button>
                    <span class="t2-aic-focus-chip-slot"></span>
                </div>
            </section>
        `;
    }

    setupInstructionSection(body, footer) {
        const maxChars = this.safePositiveInt(this.maxInputChars, 350);
        const instruction = body.querySelector('.t2-aic-instruction');
        const charCount = body.querySelector('.t2-aic-char-count');
        instruction.addEventListener('input', () => {
            const len = instruction.value.length;
            charCount.textContent = `${len}/${maxChars}자`;
            charCount.classList.toggle('is-danger', len >= maxChars);
            charCount.classList.toggle('is-warning', len < maxChars && len >= maxChars * 0.9);
        });

        body.querySelectorAll('.t2-aic-prompt-hint').forEach(btn => {
            btn.addEventListener('click', () => this.insertInstructionSuggestion(instruction, btn.dataset.prompt));
        });

        body.querySelector('.t2-aic-focus-btn').addEventListener('click', (e) => this.toggleFocusPick(e.currentTarget, body));
        this.renderFocusChip(body);

        footer.classList.remove('is-hidden');
        this.renderFooter(footer, body, instruction);
        instruction.focus();
    }

    renderFooter(footer, body, instruction) {
        const isRearrange = this.mode === 'rearrange';
        this.setSafeUIHTML(footer, `
            ${this.getToolsTriggerHTML()}
            <button class="t2-aic-btn t2-aic-btn-primary t2-aic-run" type="button">
                <span class="material-icons" aria-hidden="true">auto_awesome</span>
                <span>${isRearrange ? '재구성 생성' : '생성하기'}</span>
            </button>
        `);
        this.setupToolsTrigger(footer);

        footer.querySelector('.t2-aic-run').addEventListener('click', () => {
            const value = instruction.value.trim();
            if (!value || this.isProcessing) return;
            this.currentInstruction = value;
            if (isRearrange) this.runRearrange(value, body, footer);
            else this.runGenerate(value, body, footer);
        });
    }

    // 채팅 탭: AI가 편집이 필요하다고 판단하면 말풍선에 "편집 제안" 카드가 함께 오지만,
    // 사용자가 "문서에 추가"를 눌러야만 T2LLM.apply()가 호출된다 — 채팅만으로 문서가 자동으로 바뀌지 않는다.
    getChatSectionHTML() {
        const maxChars = this.safePositiveInt(this.maxInputChars, 350);
        return `
            <section class="t2-aic-chat-messages-wrap">
                <div class="t2-aic-chat-messages" aria-live="polite"></div>
                <div class="t2-aic-chat-empty-hint">
                    <span class="material-icons" aria-hidden="true">forum</span>
                    <p>AI에게 무엇이든 물어보세요 — Tool 사용법, 현재 문서 편집 조언, 설정 도움 등.</p>
                </div>
            </section>

            <section class="t2-aic-chat-bottom">
                <div class="t2-aic-chat-quick" data-quick-row>
                    <button type="button" class="t2-aic-chat-quick-btn" data-quick="tools">Tool 상태</button>
                    <button type="button" class="t2-aic-chat-quick-btn" data-quick="usage">사용법</button>
                    <button type="button" class="t2-aic-chat-quick-btn" data-quick="document">문서 요약</button>
                    <button type="button" class="t2-aic-chat-quick-btn" data-quick="skill">스킬 만들기</button>
                </div>

                ${this.renderWorkloadSegHTML()}

                <div class="t2-aic-chat-composer">
                    <textarea class="t2-aic-chat-input" maxlength="${this.escapeAttr(maxChars)}" rows="1"
                        placeholder="무엇이든 물어보세요"></textarea>
                    <div class="t2-aic-composer-actions">
                        <button class="t2-aic-chat-plus" type="button" aria-label="스킬 선택" data-plus-trigger>
                            <span class="material-icons" aria-hidden="true">bolt</span>
                        </button>
                        <span class="t2-aic-char-count t2-aic-chat-char-count" hidden></span>
                        <div class="t2-aic-composer-spacer"></div>
                        ${this.getToolsTriggerHTML()}
                        <button class="t2-aic-chat-send t2-aic-send-fab" type="button" disabled aria-label="전송">
                            <span class="material-icons" aria-hidden="true">arrow_upward</span>
                        </button>
                    </div>
                </div>
            </section>
        `;
    }

    setupChatSection(body, footer) {
        footer.classList.remove('is-hidden');
        this.renderChatFooter(footer, body);

        // Tool 트리거는 이제 컴포저 액션 행 안의 작은 아이콘 버튼 하나뿐이다.
        this.setupToolsTrigger(body);

        this.setupWorkloadSeg(body);

        // "+" 는 이제 Skill 전용 입구다(Tool은 옆의 트리거 아이콘으로 분리).
        const plusBtn = body.querySelector('[data-plus-trigger]');
        if (plusBtn) plusBtn.addEventListener('click', () => this.openPlusSheet('skills'));

        // 메시지 영역 — 이전에 대화한 적이 있으면 그 기록을 복원.
        const messagesEl = body.querySelector('.t2-aic-chat-messages');
        this.renderChatMessages(messagesEl);
        this.updateChatEmptyHint(body);

        const input = body.querySelector('.t2-aic-chat-input');
        const sendBtn = body.querySelector('.t2-aic-chat-send');
        const charCount = body.querySelector('.t2-aic-chat-char-count');

        // 글자수는 평소엔 아예 안 보이다가, 한도에 가까워졌을 때만 조용히
        // 나타난다 — 늘 떠 있는 숫자는 그 자체로 시각적 소음이다.
        const updateSendState = () => {
            const len = input.value.length;
            const max = this.safePositiveInt(this.maxInputChars, 350);
            const nearLimit = len >= max * 0.85;
            charCount.hidden = !nearLimit;
            if (nearLimit) charCount.textContent = `${len}/${max}`;
            charCount.classList.toggle('is-danger', len >= max);
            charCount.classList.toggle('is-warning', len < max && len >= max * 0.9);
            // 처리 중일 때 이 버튼은 "중단" 역할이라 항상 눌릴 수 있어야
            // 한다 — 글자수와 무관하게 비활성화하지 않는다.
            sendBtn.disabled = !this.isProcessing && len === 0;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        };
        input.addEventListener('input', updateSendState);

        // Enter: 전송 / Shift+Enter: 줄바꿈. 답변이 오는 중엔 Enter가 아무 것도 하지 않는다
        // (중단은 반드시 버튼을 눌러야만 — 실수로 끊기지 않도록).
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (!this.isProcessing && !sendBtn.disabled) this.sendChatMessage(input.value.trim(), body, footer);
            }
        });
        sendBtn.addEventListener('click', () => {
            if (this.isProcessing) {
                if (this.activeChatAbort) this.activeChatAbort.abort();
                return;
            }
            if (sendBtn.disabled) return;
            this.sendChatMessage(input.value.trim(), body, footer);
        });

        // 퀵 액션 — 자주 할 질문을 한 번에 채워 넣는 바로가기.
        const quickPrompts = {
            tools: '지금 어떤 Tool이 켜져 있어? 각각 뭐 하는 건지도 알려줘.',
            usage: '이 채팅에서 뭘 도와줄 수 있는지 사용법을 알려줘.',
            document: '지금 문서 내용을 짧게 요약해줘.',
            skill: this.getSkillDraftQuickPrompt(),
        };
        body.querySelectorAll('.t2-aic-chat-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.isProcessing) return;
                const prompt = quickPrompts[btn.dataset.quick];
                if (!prompt) return;
                this.sendChatMessage(prompt, body, footer);
            });
        });

        this.setSendButtonMode(sendBtn, this.isProcessing ? 'stop' : 'send');
        updateSendState();
        input.focus();

        this.setupChatBottomSpacingObserver(body);
    }

    updateChatEmptyHint(body) {
        const hint = body.querySelector('.t2-aic-chat-empty-hint');
        if (hint) hint.style.display = this.chatMessages.length ? 'none' : '';
        // 빠른 질문 칩도 첫 메시지 전에만 보여준다 — 대화가 시작되면 컴포저
        // 위 공간은 다시 메시지 스크롤에 온전히 돌려준다.
        const quickRow = body.querySelector('[data-quick-row]');
        if (quickRow) quickRow.style.display = this.chatMessages.length ? 'none' : '';
    }

    renderChatFooter(footer, body) {
        this.setSafeUIHTML(footer, `
            <div class="t2-aic-chat-footer-row">
                ${this.getStatusCaptionHTML()}
                <button class="t2-aic-btn t2-aic-btn-ghost t2-aic-chat-clear" type="button">
                    <span class="material-icons" aria-hidden="true">restart_alt</span>
                    <span>대화 초기화</span>
                </button>
            </div>
        `);
        footer.querySelector('.t2-aic-status-caption').addEventListener('click', () => this.openDisclaimerPopup());
        footer.querySelector('.t2-aic-chat-clear').addEventListener('click', () => {
            if (this.isProcessing || !this.chatMessages.length) return;
            if (!confirm('지금까지의 대화 기록을 모두 지울까요?')) return;
            this.clearChat();
        });
    }

    renderChatMessages(container) {
        if (!container) return;
        this.setSafeUIHTML(container, this.chatMessages.map((m, idx) => this.getChatMessageHTML(m, idx)).join(''));
        container.querySelectorAll('.t2-aic-chat-apply').forEach(btn => {
            btn.addEventListener('click', () => this.applyChatEditProposal(Number(btn.dataset.idx)));
        });
        container.querySelectorAll('.t2-aic-chat-save-skill').forEach(btn => {
            btn.addEventListener('click', () => this.openSkillDraftFromChat(Number(btn.dataset.idx)));
        });
        container.querySelectorAll('.t2-aic-msg-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => this.copyChatMessageToClipboard(Number(btn.dataset.idx), btn));
        });
        this.wireToolRoundToggles(container);

        // 방금 막 도착한 답변만 문자 단위로 흘려보이고, 한 번 재생하면 플래그를 꺼서
        // 같은 메시지가 다른 이유로 다시 렌더링돼도 처음부터 재생되지 않게 한다.
        this.chatMessages.forEach((m, idx) => {
            if (!m._needsTypewriter) return;
            m._needsTypewriter = false;
            const wrap = container.children[idx];
            const target = wrap ? wrap.querySelector('[data-typewriter="1"]') : null;
            const hadTools = !!(m.toolCalls && m.toolCalls.length);
            if (target) this.typewriterReveal(target, container, { hadTools });
        });

        try { container.scrollTop = container.scrollHeight; } catch (_) {}
    }

    // 이 API는 스트리밍을 지원하지 않아 답변이 한 번에 도착하지만, 문자 단위로 순차 노출해
    // 실시간 스트리밍처럼 보이게 하는 순수 클라이언트 연출이다(HTML 태그는 건드리지 않음).
    typewriterReveal(el, scrollContainer, opts = {}) {
        if (!el) return;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let total = 0;
        let n;
        while ((n = walker.nextNode())) {
            nodes.push({ node: n, full: n.nodeValue });
            total += n.nodeValue.length;
        }
        if (!total) return;

        // 아주 짧은 답변("네!", "완료했어요" 등)은 애니메이션을 느낄
        // 새도 없이 끝나버려 오히려 어색하다 — 그냥 즉시 표시한다.
        if (total <= 12) return;

        nodes.forEach(item => { item.node.nodeValue = ''; });

        let shown = 0;
        const intervalMs = 16;
        const targetDurationMs = opts.hadTools ? 450 : 180;
        const ticks = Math.max(1, Math.round(targetDurationMs / intervalMs));
        const perTick = Math.max(1, Math.ceil(total / ticks));

        const cursor = document.createElement('span');
        cursor.className = 't2-aic-typewriter-cursor';
        const lastNode = nodes[nodes.length - 1].node;
        lastNode.parentNode.insertBefore(cursor, lastNode.nextSibling);

        const timer = setInterval(() => {
            if (!el.isConnected) { clearInterval(timer); return; }
            shown = Math.min(total, shown + perTick);
            let remaining = shown;
            for (const item of nodes) {
                const len = item.full.length;
                if (remaining <= 0) {
                    if (item.node.nodeValue !== '') item.node.nodeValue = '';
                    continue;
                }
                if (remaining >= len) { item.node.nodeValue = item.full; remaining -= len; }
                else { item.node.nodeValue = item.full.slice(0, remaining); remaining = 0; }
            }
            if (scrollContainer) { try { scrollContainer.scrollTop = scrollContainer.scrollHeight; } catch (_) {} }
            if (shown >= total) { clearInterval(timer); cursor.remove(); }
        }, intervalMs);
    }

    getChatMessageHTML(m, idx) {
        const isUser = m.role === 'user';
        const stateCls = m.pending ? ' is-loading' : (m.error ? ' is-error' : '');
        // 사고(Thinking) 단계는 _phaseLabel에 완성된 라벨이 있으면 그걸 우선 쓰고,
        // 없으면 기존 _workloadStep 문구로 폴백한다.
        const toolHtml = this.renderActivityLineHTML(m.toolCalls, m.toolStatus, {
            stillGenerating: !!m.pending,
            reasoning: m.reasoning,
            thinkingLabel: m._phaseLabel || (m._workloadStep ? `생각하는 중… (작업량 ${m._workloadStep} 단계)` : undefined),
        });

        let inner;
        if (m.pending) {
            const streamHtml = m._streamText
                ? `<div class="t2-aic-chat-answer-text t2-aic-chat-answer-streaming">${this.renderChatMarkdown(m._streamText)}<span class="t2-aic-typewriter-cursor"></span></div>`
                : '';
            inner = toolHtml + streamHtml;
        } else if (m.error) {
            inner = toolHtml + `<div class="t2-aic-chat-error"><span class="material-icons" aria-hidden="true">error_outline</span><span>${this.escapeHtml(m.error)}</span></div>`;
        } else {
            const answerHtml = this.renderChatMarkdown(m.content || '');
            inner = toolHtml + (m._needsTypewriter ? `<div class="t2-aic-chat-answer-text" data-typewriter="1">${answerHtml}</div>` : answerHtml);
            if (!isUser && Array.isArray(m.visuals) && m.visuals.length) {
                inner += this.renderInlineVisualsHTML(m.visuals);
            }
            if (m.editProposal) {
                inner += `
                    <div class="t2-aic-chat-edit-card">
                        <div class="t2-aic-chat-edit-head">
                            <span class="material-icons" aria-hidden="true">auto_fix_high</span>
                            <span>편집 제안 — 눌러야 문서에 반영돼요</span>
                        </div>
                        <button class="t2-aic-chat-apply t2-aic-btn ${m.applied ? 't2-aic-btn-ghost' : 't2-aic-btn-primary'}" type="button" data-idx="${idx}" ${m.applied ? 'disabled' : ''}>
                            <span class="material-icons" aria-hidden="true">${m.applied ? 'check' : 'add'}</span>
                            <span>${m.applied ? '문서에 추가됨' : '문서에 추가'}</span>
                        </button>
                    </div>
                `;
            }
            // AI 답변에 ```skill 코드블록이 있으면 "스킬로 저장" 버튼을 보여준다 — 여기서도
            // 절대 자동 저장하지 않고, 사용자가 검토 후 확정해야 저장된다.
            const skillDraft = !isUser ? this.parseSkillDraftFromText(m.content || '') : null;
            if (skillDraft) {
                inner += `
                    <div class="t2-aic-chat-edit-card">
                        <div class="t2-aic-chat-edit-head">
                            <span class="material-icons" aria-hidden="true">bolt</span>
                            <span>스킬 초안 — "${this.escapeHtml(skillDraft.name)}"</span>
                        </div>
                        <button class="t2-aic-chat-save-skill t2-aic-btn ${m.skillSaved ? 't2-aic-btn-ghost' : 't2-aic-btn-primary'}" type="button" data-idx="${idx}" ${m.skillSaved ? 'disabled' : ''}>
                            <span class="material-icons" aria-hidden="true">${m.skillSaved ? 'check' : 'bolt'}</span>
                            <span>${m.skillSaved ? '스킬 탭에서 저장됨' : '스킬로 저장'}</span>
                        </button>
                    </div>
                `;
            }
        }

        // v16.5.0: 모델 표시줄(왼쪽)과 복사 버튼(오른쪽)만 한 줄에 나란히
        // 두고, T2E 서명 아이콘은 여기 섞지 않고 그 아래 완전히 독립된
        // 줄로 맨 하단에 그대로 둔다.
        const modelHtml = (!isUser && !m.pending && !m.error && (m.provider || m.model))
            ? `<span class="t2-aic-chat-model">${this.escapeHtml(m.model || '알 수 없는 모델')}${m.provider ? ' · ' + this.escapeHtml(m.provider) : ''}</span>`
            : '';

        // v16.2.0: 메시지 아래 복사 버튼 — 아직 스트리밍/로딩 중인 말풍선은
        // 텍스트가 확정되지 않았으니 제외하고, 실제로 복사할 내용이 있을
        // 때만(에러 메시지면 에러 문구라도) 보여준다.
        const copySourceText = m.error ? m.error : (m.content || '');
        const showCopyBtn = !m.pending && !!copySourceText && copySourceText.trim().length > 0;
        const copyBtnHtml = showCopyBtn ? `
            <button type="button" class="t2-aic-msg-copy-btn" data-idx="${idx}" title="복사" aria-label="메시지 복사">
                <span class="material-icons" aria-hidden="true">content_copy</span>
            </button>
        ` : '';

        // 모델 표시줄이 있으면 왼쪽에, 복사 버튼은 항상 오른쪽에 —
        // space-between으로 한 줄에 배치(모델 정보가 없는 사용자 메시지는
        // 자동으로 복사 버튼만 오른쪽에 남는다).
        const metaRowHtml = (modelHtml || copyBtnHtml) ? `
            <div class="t2-aic-chat-msg-meta${modelHtml ? ' has-model' : ''}">${modelHtml}${copyBtnHtml}</div>
        ` : '';

        // v16.1.0: 답변이 완전히 끝난 뒤에도 T2E 아이콘이 사라지지 않고
        // 답변 맨 아래 "서명"처럼 남는다 — 클로드 웹 채팅처럼, 단 더 이상
        // 일렁이지 않고 도트가 전부 켜진 정지 상태로. 복사 버튼/모델
        // 표시줄과는 섞이지 않고 항상 그 아래 독립된 줄이다.
        const showBrandMark = !isUser && !m.pending && !m.error;
        const brandMarkHtml = showBrandMark
            ? `<div class="t2-aic-chat-brandmark">${this.getBrandSpinnerHTML({ static: true })}<span class="t2-aic-chat-brandmark-label">complex AI</span></div>`
            : '';

        return `
            <div class="t2-aic-chat-msg ${isUser ? 'is-user' : 'is-assistant'}${stateCls}">
                <div class="t2-aic-chat-msg-col">
                    <div class="t2-aic-chat-msg-content">${inner}</div>
                    ${metaRowHtml}
                    ${brandMarkHtml}
                </div>
            </div>
        `;
    }

    // 채팅 메시지 복사 버튼 — navigator.clipboard가 없는 구형 웹뷰
    // 환경까지 대비해 execCommand('copy') 폴백을 함께 둔다.
    async copyChatMessageToClipboard(idx, btn) {
        const m = this.chatMessages[idx];
        if (!m) return;
        const text = m.error ? m.error : (m.content || '');
        if (!text) return;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.top = '-9999px';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            this.flashMsgCopyButton(btn, false);
        } catch (e) {
            this.flashMsgCopyButton(btn, true);
        }
    }

    // 복사 버튼 아이콘을 잠깐 체크(✓)/에러 아이콘으로 바꿔 피드백을 준 뒤
    // 원래 아이콘으로 되돌린다.
    flashMsgCopyButton(btn, failed) {
        if (!btn) return;
        const icon = btn.querySelector('.material-icons');
        if (!icon) return;
        if (!btn.dataset.originalIcon) btn.dataset.originalIcon = icon.textContent;
        icon.textContent = failed ? 'error_outline' : 'check';
        btn.classList.toggle('is-copied', !failed);
        btn.classList.toggle('is-copy-failed', !!failed);
        if (btn._t2aicCopyTimer) clearTimeout(btn._t2aicCopyTimer);
        btn._t2aicCopyTimer = setTimeout(() => {
            icon.textContent = btn.dataset.originalIcon;
            btn.classList.remove('is-copied', 'is-copy-failed');
        }, 1200);
    }

    // 채팅 답변용 경량 마크다운 렌더러(DSL 변환과는 무관, 순수 표시용).
    // XSS 방지를 위해 모든 원본 텍스트는 escapeHtml을 거친 뒤에만 태그를 삽입한다.
    renderChatMarkdown(text) {
        const raw = String(text ?? '');

        // 1. 코드펜스(```...```) 를 먼저 떼어내 플레이스홀더로 치환 — 안에서는
        //    다른 마크다운 변환이 절대 일어나지 않게 하기 위함.
        const codeBlocks = [];
        let working = raw.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, body) => {
            codeBlocks.push({ lang: lang || '', body: body.replace(/\n$/, '') });
            return `\u0000CODEBLOCK_${codeBlocks.length - 1}\u0000`;
        });

        // 2. 나머지 텍스트는 전부 escape 먼저 — 이후 정규식은 escape된
        //    안전한 텍스트 위에서만 태그를 추가한다.
        working = this.escapeHtml(working);

        // 3. 인라인 코드 `...` → <code>
        working = working.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);

        // 4. 굵게/기울임/취소선
        working = working.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        working = working.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
        working = working.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

        // 5. 링크 [text](url) — http/https만 허용.
        working = working.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, url) =>
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${t}</a>`);

        // 6. 목록 — "- "/"* "/"1. " 시작 라인들을 <ul>/<ol>로.
        working = this.convertChatListsToHtml(working);

        // 7. 줄바꿈 → <br>
        working = working.replace(/\n/g, '<br>');

        // 8. 코드펜스 복원
        working = working.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_, idx) => {
            const block = codeBlocks[Number(idx)];
            if (!block) return '';
            const langAttr = block.lang ? ` data-lang="${this.escapeAttr(block.lang)}"` : '';
            return `<pre class="t2-aic-chat-codeblock"${langAttr}><code>${this.escapeHtml(block.body)}</code></pre>`;
        });

        return working;
    }

    // "- 항목" / "* 항목" / "1. 항목" 형태의 연속된 라인을 <ul>/<ol>로 묶는다.
    // 이미 escape된 텍스트를 받으므로 <, > 등은 엔티티로 되어 있어 안전.
    convertChatListsToHtml(text) {
        const lines = text.split('\n');
        const out = [];
        let listType = null;
        let items = [];
        const flush = () => {
            if (!listType) return;
            out.push(`<${listType}>` + items.map(i => `<li>${i}</li>`).join('') + `</${listType}>`);
            listType = null;
            items = [];
        };
        for (const line of lines) {
            const ul = line.match(/^\s*[-*]\s+(.+)$/);
            const ol = line.match(/^\s*\d+\.\s+(.+)$/);
            if (ul) {
                if (listType && listType !== 'ul') flush();
                listType = 'ul';
                items.push(ul[1]);
                continue;
            }
            if (ol) {
                if (listType && listType !== 'ol') flush();
                listType = 'ol';
                items.push(ol[1]);
                continue;
            }
            flush();
            out.push(line);
        }
        flush();
        return out.join('\n');
    }

    renderInlineVisualsHTML(visuals) {
        if (!Array.isArray(visuals) || !visuals.length) return '';
        return visuals.map(v => this.renderInlineVisual(v)).join('');
    }

    renderInlineVisual(spec) {
        if (!spec || typeof spec !== 'object') return '';
        if (spec.type === 'image') return this.renderInlineImageCard(spec);
        if (spec.type === 'link') return this.renderInlineLinkCard(spec);
        if (spec.type === 'chart') return this.renderInlineChartCard(spec);
        return '';
    }

    renderInlineImageCard(spec) {
        const url = this.escapeAttr(spec.url || '');
        const caption = spec.caption
            ? `<div class="t2-aic-inline-visual-caption">${this.escapeHtml(spec.caption)}</div>`
            : '';
        return `
            <div class="t2-aic-inline-visual t2-aic-inline-visual-image">
                <img src="${url}" alt="${this.escapeAttr(spec.caption || '')}" loading="lazy" />
                ${caption}
            </div>
        `;
    }

    renderInlineLinkCard(spec) {
        const url = this.escapeAttr(spec.url || '');
        const title = this.escapeHtml(spec.title || spec.url || '');
        const host = spec.host ? this.escapeHtml(spec.host) : '';
        return `
            <a class="t2-aic-inline-visual t2-aic-inline-visual-link" href="${url}" target="_blank" rel="noopener noreferrer">
                <span class="material-icons t2-aic-inline-visual-link-icon" aria-hidden="true">link</span>
                <span class="t2-aic-inline-visual-link-body">
                    <span class="t2-aic-inline-visual-link-title">${title}</span>
                    ${host ? `<span class="t2-aic-inline-visual-link-host">${host}</span>` : ''}
                </span>
                <span class="material-icons t2-aic-inline-visual-link-open" aria-hidden="true">open_in_new</span>
            </a>
        `;
    }

    renderInlineChartCard(spec) {
        const svg = this.buildInlineChartSVG(spec);
        const title = spec.title ? `<div class="t2-aic-inline-visual-caption">${this.escapeHtml(spec.title)}</div>` : '';
        return `
            <div class="t2-aic-inline-visual t2-aic-inline-visual-chart">
                ${svg}
                ${title}
            </div>
        `;
    }

    buildInlineChartSVG(spec) {
        const labels = Array.isArray(spec.labels) ? spec.labels : [];
        const values = Array.isArray(spec.values) ? spec.values : [];
        const w = 320, h = 160, padL = 28, padB = 28, padT = 12, padR = 12;
        const plotW = w - padL - padR, plotH = h - padT - padB;
        const maxV = Math.max(0, ...values);
        const minV = Math.min(0, ...values);
        const range = (maxV - minV) || 1;
        const zeroY = padT + plotH * (maxV / range);
        const n = Math.max(1, labels.length);
        const step = plotW / n;

        let bodySvg;
        if (spec.chartType === 'line') {
            const pts = values.map((v, i) => ({
                x: padL + step * (i + 0.5),
                y: padT + plotH * ((maxV - v) / range),
            }));
            const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" class="t2-aic-inline-chart-dot" />`).join('');
            bodySvg = `<polyline points="${line}" class="t2-aic-inline-chart-line" />${dots}`;
        } else {
            const barW = Math.min(36, step * 0.6);
            bodySvg = values.map((v, i) => {
                const x = padL + step * i + (step - barW) / 2;
                const barH = plotH * (Math.abs(v) / range);
                const y = v >= 0 ? zeroY - barH : zeroY;
                return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" rx="3" class="t2-aic-inline-chart-bar" />`;
            }).join('');
        }

        const axis = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${w - padR}" y2="${zeroY.toFixed(1)}" class="t2-aic-inline-chart-axis" />`;
        const labelsSvg = labels.map((lb, i) => {
            const x = padL + step * (i + 0.5);
            const text = String(lb).length > 8 ? String(lb).slice(0, 7) + '…' : String(lb);
            return `<text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" class="t2-aic-inline-chart-label">${this.escapeHtml(text)}</text>`;
        }).join('');

        return `
            <svg class="t2-aic-inline-chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${this.escapeAttr(spec.title || '그래프')}">
                ${axis}${bodySvg}${labelsSvg}
            </svg>
        `;
    }


    getWorkloadCallCount(level) {
        return T2AIC_WORKLOAD_CALL_COUNTS[level] || T2AIC_WORKLOAD_CALL_COUNTS.low;
    }

    getContentPassCount(level) {
        return this.getWorkloadCallCount(level);
    }

    // 마지막 정리(finalize) 호출 횟수 — 작업량 단계 호출 횟수의 30%를 반올림해 "추가로" 사용한다
    // (콘텐츠 회차에서 빼오지 않음).
    hasFinalizePass(level) {
        return this.getWorkloadCallCount(level) > 1;
    }

    getFinalizeCallCount(level) {
        if (!this.hasFinalizePass(level)) return 0;
        const base = this.getWorkloadCallCount(level);
        return Math.max(1, Math.round(base * 0.3));
    }

    getWorkloadChatDirectives(level) {
        const count = this.getContentPassCount(level);
        const idx = t2aicPickDirectiveIndices(count);
        return idx.map(i => T2AIC_WORKLOAD_CHAT_DIRECTIVES[i] || '');
    }

    // 사고 모드가 만든 개요에서 번호 매긴 줄만 뽑아낸다. 부족하면 null을 돌려줘
    // 호출부가 기존 "이어서 확장해줘" 방식으로 안전하게 폴백하게 한다.
    parseOutlineSteps(text, expectedCount) {
        if (!text || expectedCount < 1) return null;
        const items = [];
        String(text).split('\n').forEach(line => {
            const m = line.trim().match(/^(?:\d+|[①-⑳])[.).、:]?\s*(.+)$/);
            if (m && m[1] && m[1].trim()) items.push(m[1].trim());
        });
        if (items.length >= expectedCount) return items.slice(0, expectedCount);
        return null;
    }

    buildFinalizePassPrompt(draft) {
        return `아래는 지금까지 여러 회차에 걸쳐 이어서 작성한 답변 초안이야. 전체를 새로 쓰지 말고, 정말 필요한 부분만 아주 최소한으로 손봐줘 — 회차 사이에 겹치는 내용 정리, 어색하게 끊기는 연결부 다듬기, 표현이 서로 어긋나는 부분 통일 정도만 고쳐. 초안에 없던 새로운 내용을 추가하지 말고, 원래 문장과 구성은 최대한 그대로 유지해줘. 수정한 최종본만 답으로 줘(설명이나 "수정했습니다" 같은 말은 붙이지 마).\n\n---\n${draft}\n---`;
    }

    loadThinkingPreference() {
        try {
            const v = window.localStorage ? window.localStorage.getItem('t2aic_thinking_enabled') : null;
            return v === '1';
        } catch (_) { /* localStorage 접근 불가 환경 — 기본값(꺼짐)으로 폴백 */ }
        return false;
    }

    saveThinkingPreference(enabled) {
        try {
            if (window.localStorage) window.localStorage.setItem('t2aic_thinking_enabled', enabled ? '1' : '0');
        } catch (_) { /* 저장 실패해도 이번 세션 동작에는 영향 없음 */ }
    }

    // 사고 전용 호출 횟수 = 작업량 호출 횟수의 제곱근을 반올림(최소 1회 보장).
    // 하드코딩 없이 새 단계가 추가돼도 자동으로 계산된다.
    getThinkingCallCount(level) {
        const base = this.getWorkloadCallCount(level);
        const rootedOneDecimal = Math.round(Math.sqrt(base) * 10) / 10;
        return Math.max(1, Math.round(rootedOneDecimal));
    }

    loadWorkloadPreference() {
        try {
            const v = window.localStorage ? window.localStorage.getItem('t2aic_workload_level') : null;
            if (v && Object.prototype.hasOwnProperty.call(T2AIC_WORKLOAD_CALL_COUNTS, v)) return v;
        } catch (_) { /* localStorage 접근 불가 환경 — 기본값으로 폴백 */ }
        return 'low';
    }

    saveWorkloadPreference(level) {
        try {
            if (window.localStorage) window.localStorage.setItem('t2aic_workload_level', level);
        } catch (_) { /* 저장 실패해도 이번 세션 동작에는 영향 없음 */ }
    }

    getWorkloadLabel(level) {
        const labels = { low: '낮음', medium: '중간', high: '높음', max: 'Max', ultimate: 'Ultimate' };
        return labels[level] || labels.low;
    }

    loadWorkloadPanelExpandedPreference() {
        try {
            const v = window.localStorage ? window.localStorage.getItem('t2aic_workload_panel_expanded') : null;
            return v === '1';
        } catch (_) { /* localStorage 접근 불가 환경 — 기본값(접힘)으로 폴백 */ }
        return false;
    }

    saveWorkloadPanelExpandedPreference(expanded) {
        try {
            if (window.localStorage) window.localStorage.setItem('t2aic_workload_panel_expanded', expanded ? '1' : '0');
        } catch (_) { /* 저장 실패해도 이번 세션 동작에는 영향 없음 */ }
    }

    // 접힌 요약 줄에 보여줄 한 줄 요약 텍스트 — "작업량: 낮음(x1) · Thinking 꺼짐"
    getWorkloadSummaryText() {
        const workloadPart = `작업량 ${this.getWorkloadLabel(this.workloadLevel)} ${this.getWorkloadUsageText(this.workloadLevel)}`;
        const thinkingPart = `Thinking ${this.thinkingEnabled ? '켜짐' : '꺼짐'}`;
        return `${workloadPart} · ${thinkingPart}`;
    }

    // 선택된 작업량 단계가 실제로 몇 번의 API 호출을 쓰는지 보여준다(콘텐츠+정리+사고 합산).
    // 합산 로직은 getWorkloadRequiredCalls()로 분리해 사용 가능 여부 판단과 표시 숫자가 항상 일치하게 한다.
    getWorkloadBaseCalls(level) {
        let total = this.getWorkloadCallCount(level) + this.getFinalizeCallCount(level);
        if (this.thinkingEnabled) total += this.getThinkingCallCount(level);
        return total;
    }

    getRethinkMaxCallCount(level) {
        const base = this.getWorkloadBaseCalls(level);
        return Math.max(0, Math.round(base * T2AIC_RETHINK_MAX_RATIO));
    }

    getWorkloadRequiredCalls(level) {
        // 재사고는 "상한까지만 쓸 수 있다"는 것이지 확정 사용이 아니지만, 잔여량 체크는
        // 최악의 경우(상한을 전부 씀)까지 미리 반영해 중간에 한도 초과로 실패하지 않게 한다.
        return this.getWorkloadBaseCalls(level) + this.getRethinkMaxCallCount(level);
    }

    getWorkloadUsageText(level) {
        return `x${this.getWorkloadRequiredCalls(level)}`;
    }


    // 남은 요청 한도 중 더 빠듯한 쪽(IP/도메인)을 반환한다. 아직 못 불러왔으면 null(보류)을
    // 반환하고, 이 경우 아래 판단 로직은 항상 허용으로 동작한다.
    getRemainingRequestBudget() {
        const ip = this.rateLimit.ip, domain = this.rateLimit.domain;
        const knowns = [];
        if (typeof ip.remaining === 'number' && ip.limit > 0) knowns.push(ip.remaining);
        if (typeof domain.remaining === 'number' && domain.limit > 0) knowns.push(domain.remaining);
        if (!knowns.length) return null;
        return Math.min(...knowns);
    }

    // 이 작업량 단계를 지금 골라도 안전한지 — 필요 호출 수(getWorkloadUsageText
    // 와 동일한 숫자)가 남은 한도를 넘지 않아야 한다.
    isWorkloadLevelAffordable(level) {
        const budget = this.getRemainingRequestBudget();
        if (budget === null) return true;
        return budget >= this.getWorkloadRequiredCalls(level);
    }

    // 고를 수 없는 단계 버튼에 붙일 짧은 이유 문구(title 툴팁용).
    getWorkloadUnaffordableReason(level) {
        const budget = this.getRemainingRequestBudget();
        if (budget === null) return '';
        return `남은 요청이 ${this.safeCounterValue(budget)}개뿐이라 이 단계(${this.getWorkloadUsageText(level)})는 지금 선택할 수 없어요`;
    }

    // 선택된 작업량 단계가 더 이상 감당이 안 되면 감당되는 단계 중 가장 높은 단계로 자동으로
    // 낮춘다. 어느 단계도 감당 안 되면 '낮음'으로 낮춘다(실제 전송 가능 여부는 서버가 다시 확인).
    clampWorkloadLevelToBudget() {
        if (this.isWorkloadLevelAffordable(this.workloadLevel)) return false;
        const levels = ['low', 'medium', 'high', 'max', 'ultimate'];
        let fallback = 'low';
        levels.forEach(lv => { if (this.isWorkloadLevelAffordable(lv)) fallback = lv; });
        if (fallback === this.workloadLevel) return false;
        this.workloadLevel = fallback;
        this.saveWorkloadPreference(fallback);
        return true;
    }

    renderWorkloadSegHTML() {
        const levels = ['low', 'medium', 'high', 'max', 'ultimate'];
        this.clampWorkloadLevelToBudget();
        const expanded = !!this.workloadPanelExpanded;
        return `
            <div class="t2-aic-workload-panel${expanded ? ' is-expanded' : ''}">
                <button type="button" class="t2-aic-workload-summary" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="t2-aic-workload-details">
                    <span class="material-icons t2-aic-workload-summary-icon" aria-hidden="true">tune</span>
                    <span class="t2-aic-workload-summary-text">${this.escapeHtml(this.getWorkloadSummaryText())}</span>
                    <span class="material-icons t2-aic-workload-chevron" aria-hidden="true">expand_more</span>
                </button>
                <div class="t2-aic-workload-details" id="t2-aic-workload-details"${expanded ? '' : ' hidden'}>
                    <div class="t2-aic-workload-row">
                        <span class="t2-aic-workload-label">작업량</span>
                        <button type="button" class="t2-aic-info-btn" data-info="workload" aria-label="작업량 설명 보기">
                            <span class="material-icons" aria-hidden="true">info</span>
                        </button>
                        <div class="t2-aic-workload-seg" role="tablist" aria-label="작업량 선택">
                            ${levels.map(lv => {
                                const affordable = this.isWorkloadLevelAffordable(lv);
                                const reason = affordable ? '' : this.getWorkloadUnaffordableReason(lv);
                                return `
                                <button type="button" class="t2-aic-workload-btn${lv === this.workloadLevel ? ' is-active' : ''}${affordable ? '' : ' is-disabled'}"
                                    data-level="${lv}" role="tab" aria-selected="${lv === this.workloadLevel ? 'true' : 'false'}"
                                    ${affordable ? '' : 'disabled aria-disabled="true"'}
                                    ${reason ? `title="${this.escapeAttr(reason)}"` : ''}>${this.getWorkloadLabel(lv)}</button>
                            `;
                            }).join('')}
                        </div>
                        <span class="t2-aic-workload-usage" aria-live="polite">${this.getWorkloadUsageText(this.workloadLevel)}</span>
                    </div>
                    <div class="t2-aic-thinking-row">
                        <button type="button" class="t2-aic-thinking-toggle${this.thinkingEnabled ? ' is-active' : ''}"
                            role="switch" aria-checked="${this.thinkingEnabled ? 'true' : 'false'}" title="Thinking 모드 — 답변 전에 내부적으로 한 번 더 생각합니다">
                            <span class="t2-aic-thinking-toggle-label">Thinking</span>
                            <span class="t2-aic-thinking-toggle-switch"><span class="t2-aic-thinking-toggle-knob"></span></span>
                        </button>
                        <button type="button" class="t2-aic-info-btn" data-info="thinking" aria-label="Thinking 모드 설명 보기">
                            <span class="material-icons" aria-hidden="true">info</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    setupWorkloadSeg(body) {
        const btns = body.querySelectorAll('.t2-aic-workload-btn');
        const usageEl = body.querySelector('.t2-aic-workload-usage');
        const summaryTextEl = body.querySelector('.t2-aic-workload-summary-text');
        const refreshSummary = () => {
            if (summaryTextEl) summaryTextEl.textContent = this.getWorkloadSummaryText();
        };

        if (btns.length) {
            btns.forEach(btn => {
                btn.addEventListener('click', () => {
                    if (this.isProcessing) return; // 답변이 나오는 중에는 단계 수가 바뀌면 진행 중 루프와 어긋나므로 잠긴다.
                    if (btn.disabled || btn.classList.contains('is-disabled')) return; // 잔여 사용량 부족으로 막힌 단계 — 고를 수 없다.
                    const level = btn.dataset.level;
                    if (!level || level === this.workloadLevel) return;
                    this.workloadLevel = level;
                    this.saveWorkloadPreference(level);
                    btns.forEach(b => b.classList.toggle('is-active', b.dataset.level === level));
                    btns.forEach(b => b.setAttribute('aria-selected', b.dataset.level === level ? 'true' : 'false'));
                    if (usageEl) usageEl.textContent = this.getWorkloadUsageText(level);
                    refreshSummary();
                });
            });
        }

        const thinkingBtn = body.querySelector('.t2-aic-thinking-toggle');
        if (thinkingBtn) {
            thinkingBtn.addEventListener('click', () => {
                if (this.isProcessing) return; // 진행 중인 루프와 어긋나지 않도록 답변 중엔 잠긴다.
                this.thinkingEnabled = !this.thinkingEnabled;
                this.saveThinkingPreference(this.thinkingEnabled);
                thinkingBtn.classList.toggle('is-active', this.thinkingEnabled);
                thinkingBtn.setAttribute('aria-checked', this.thinkingEnabled ? 'true' : 'false');
                // Thinking on/off는 각 단계의 필요 호출 수 자체를 바꾸므로, 방금까지 고를 수 있던
                // 단계가 갑자기 못 고르게 바뀔 수 있어 버튼 상태를 다시 계산한다.
                this.refreshWorkloadAvailability(body);
            });
        }

        // 잔여 사용량 정보가 이미 로드돼 있다면(재로딩 없이 다시 이 탭을
        // 그린 경우 등) 패널을 처음 그릴 때도 한 번 최신 상태로 맞춰둔다.
        this.refreshWorkloadAvailability(body);

        // 접힘/펼침 — 요약 줄을 누르면 상세(세그먼트/스위치/정보버튼) 영역이
        // 토글된다. 펼침 상태는 localStorage에 저장해 다음에 열어도 유지.
        const summaryBtn = body.querySelector('.t2-aic-workload-summary');
        const detailsEl = body.querySelector('.t2-aic-workload-details');
        if (summaryBtn && detailsEl) {
            summaryBtn.addEventListener('click', () => {
                const nextExpanded = detailsEl.hasAttribute('hidden');
                if (nextExpanded) detailsEl.removeAttribute('hidden');
                else detailsEl.setAttribute('hidden', '');
                summaryBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
                summaryBtn.parentElement.classList.toggle('is-expanded', nextExpanded);
                this.workloadPanelExpanded = nextExpanded;
                this.saveWorkloadPanelExpandedPreference(nextExpanded);
            });
        }

        body.querySelectorAll('.t2-aic-info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const kind = btn.dataset.info;
                if (kind === 'workload') {
                    this.openSimpleInfoPopup(
                        '작업량이란?',
                        '작업량을 높일수록 AI가 답변을 여러 번에 걸쳐 더 다양한 각도로 다듬어 훨씬 꼼꼼한 결과를 만들어냅니다. 다만 그만큼 답변이 나오기까지 시간이 더 걸리고, 사용 한도(사용량)도 더 빠르게 줄어듭니다. 남은 사용량이 그 단계를 다 쓰기에 부족하면 아예 고를 수 없어요.'
                    );
                } else if (kind === 'thinking') {
                    this.openSimpleInfoPopup(
                        'Thinking 모드란?',
                        '실제 답변을 쓰기 전에 AI가 먼저 생각을 정리하는 단계를 한 번 더 거칩니다. 복잡하거나 까다로운 요청에서 더 깊이 있고 정돈된 답변을 받을 수 있지만, 그만큼 사용량이 조금 더 소모됩니다.'
                    );
                }
            });
        });
    }

    // 작업량 패널 버튼의 사용 가능 여부/사용량 텍스트를 "지금 남은 요청 한도" 기준으로
    // 다시 계산한다(패널 최초 렌더/Thinking 토글/잔여량 조회 완료 시점마다 호출됨).
    refreshWorkloadAvailability(body) {
        if (!body) return;
        const panel = body.querySelector('.t2-aic-workload-panel');
        if (!panel) return;

        this.clampWorkloadLevelToBudget();

        panel.querySelectorAll('.t2-aic-workload-btn').forEach(btn => {
            const lv = btn.dataset.level;
            const affordable = this.isWorkloadLevelAffordable(lv);
            btn.disabled = !affordable;
            btn.classList.toggle('is-disabled', !affordable);
            btn.setAttribute('aria-disabled', affordable ? 'false' : 'true');
            btn.title = affordable ? '' : this.getWorkloadUnaffordableReason(lv);
            btn.classList.toggle('is-active', lv === this.workloadLevel);
            btn.setAttribute('aria-selected', lv === this.workloadLevel ? 'true' : 'false');
        });

        const usageEl = panel.querySelector('.t2-aic-workload-usage');
        if (usageEl) usageEl.textContent = this.getWorkloadUsageText(this.workloadLevel);
        const summaryTextEl = panel.querySelector('.t2-aic-workload-summary-text');
        if (summaryTextEl) summaryTextEl.textContent = this.getWorkloadSummaryText();
    }

    openSimpleInfoPopup(title, bodyText) {
        this.closeSimpleInfoPopup();
        document.querySelectorAll('.t2-aic-tool-info-overlay').forEach(p => p.remove());

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-info-overlay t2-aic-simple-info-overlay';
        const popup = document.createElement('div');
        popup.className = 't2-aic-info-popup t2-aic-simple-info-popup';
        this.setSafeUIHTML(popup, `
            <div class="t2-aic-info-head">
                <span class="material-icons t2-aic-title-icon" aria-hidden="true" style="font-size:20px;">info</span>
                <strong>${this.escapeHtml(title)}</strong>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-llm-disclaimer" style="margin-bottom:0;">
                <p>${this.escapeHtml(bodyText)}</p>
            </div>
        `);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        this._simpleInfoPopupEl = overlay;

        const close = () => this.closeSimpleInfoPopup();
        popup.querySelector('.t2-aic-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        this._simpleInfoEscHandler = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', this._simpleInfoEscHandler);
    }

    closeSimpleInfoPopup() {
        if (this._simpleInfoPopupEl) { this._simpleInfoPopupEl.remove(); this._simpleInfoPopupEl = null; }
        if (this._simpleInfoEscHandler) {
            document.removeEventListener('keydown', this._simpleInfoEscHandler);
            this._simpleInfoEscHandler = null;
        }
    }

    async sendChatMessage(text, body, footer, extraOpts = {}) {
        if (!text || this.isProcessing) return;

        const max = this.safePositiveInt(this.maxInputChars, 350);
        const trimmed = text.length > max ? text.slice(0, max) : text;

        // 서버로 넘길 "이전까지의" 대화 — 이번에 보내는 메시지는 text
        // 인자로 별도 전달되므로 중복되지 않도록 push 전에 미리 계산한다.
        const historyForServer = this.getChatHistoryPayload();

        this.chatMessages.push({ role: 'user', content: trimmed });
        const messagesEl = body.querySelector('.t2-aic-chat-messages');
        this.renderChatMessages(messagesEl);
        this.updateChatEmptyHint(body);

        const input = body.querySelector('.t2-aic-chat-input');
        const sendBtn = body.querySelector('.t2-aic-chat-send');
        const charCount = body.querySelector('.t2-aic-chat-char-count');
        if (input) { input.value = ''; input.style.height = 'auto'; }
        if (charCount) { charCount.hidden = true; charCount.classList.remove('is-danger', 'is-warning'); }

        // 전송 버튼을 "중단" 버튼으로 바꾼다 — 답변이
        // 나오는 동안 같은 자리를 눌러 즉시 멈출 수 있다.
        const controller = new AbortController();
        this.activeChatAbort = controller;
        this.setSendButtonMode(sendBtn, 'stop');

        this.isProcessing = true;
        const loadingMsg = { role: 'assistant', content: '', pending: true, toolCalls: null, toolStatus: null };
        this.chatMessages.push(loadingMsg);
        this.renderChatMessages(messagesEl);

        // 낮음을 제외한 모든 단계는 전체 호출 중 일부를 콘텐츠 생성이 아니라 마지막 정리(finalize)에
        // 남겨둔다. 2회차부터는 별도 말풍선 없이 history에만 지시문을 얹어 계속 이어붙인다.
        const workloadLevel = this.workloadLevel || 'low';
        const contentPassCount = this.getContentPassCount(workloadLevel);

        // 사고 모드는 콘텐츠 회차가 2개 이상이면 "각 회차가 다룰 내용"을 개요로 뽑아내고,
        // 이후 회차는 반복 지시문 대신 그 개요를 순서대로 하나씩 맡는다(개요 파싱 실패 시 기존 방식 폴백).
        const thinkingCallCount = this.thinkingEnabled ? this.getThinkingCallCount(workloadLevel) : 0;

        const replyParts = [];
        const editParts = [];
        let passLastProvider = null;
        let passLastModel = null;
        let passFirstReasoning = null;
        let outlineSteps = null;
        // 다음 회차를 위한 대화 기록 — 화면(this.chatMessages)에는 반영하지
        // 않고 이 요청 안에서만 조용히 이어간다.
        let runningHistory = historyForServer.slice();

        const appendStreamChunk = (pieceText) => {
            if (!pieceText) return;
            loadingMsg._streamText = (loadingMsg._streamText ? loadingMsg._streamText + '\n' : '') + pieceText;
            this.renderChatMessages(messagesEl);
        };

        try {
            if (thinkingCallCount > 0) {
                const thinkingNotes = [];
                const toolNudge = this.hasEnabledTools('generate') ? T2AIC_THINKING_TOOL_NUDGE : '';
                for (let ti = 0; ti < thinkingCallCount; ti++) {
                    loadingMsg._phaseLabel = `생각하는 중… (사고 ${ti + 1}/${thinkingCallCount})`;
                    this.renderChatMessages(messagesEl);

                    let thinkPrompt;
                    if (ti === 0 && contentPassCount > 1) {
                        thinkPrompt = `${trimmed}\n\n(지시: 실제 답변을 쓰기 전에, 이 답변을 정확히 ${contentPassCount}단계로 나눠 순서대로 쓴다고 할 때 각 단계에서 다룰 핵심 내용을 한 줄씩 정리해줘. 반드시 "1. ", "2. "처럼 번호를 매겨 정확히 ${contentPassCount}개 항목만 적어줘. 각 항목은 완성된 문장이 아니라 짧은 제목 형태로만 적고, 다른 설명은 붙이지 마. 이 순서가 곧 실제 답변이 작성될 순서야.${toolNudge})`;
                    } else if (ti === 0) {
                        thinkPrompt = `${trimmed}\n\n(지시: ${T2AIC_THINKING_DIRECTIVE}${toolNudge})`;
                    } else {
                        thinkPrompt = `${T2AIC_THINKING_DIRECTIVE}${toolNudge} 방금 정리한 메모에 이어서, 아직 다루지 못한 관점이 있다면 더 정리해줘.`;
                    }

                    const thinkRaw = await this.callChatApi(thinkPrompt, {
                        stream: false, // 사고 메모는 화면에 실시간으로 흘려보이지 않고 조용히 처리한다.
                        history: runningHistory,
                        contextOverride: extraOpts.contextOverride,
                        signal: controller.signal,
                        // thinkPrompt는 순수 사용자 입력이 아니라 내부 지시문이 섞인 텍스트라,
                        // 사용자 입력 한도(350자)가 아닌 더 넉넉한 내부 한도를 적용한다.
                        phase: 'internal',
                        onToolRound: (round, maxRounds, pendingToolCalls, reasoning) => {
                            loadingMsg.toolCalls = this.mergeToolCalls(loadingMsg.toolCalls, pendingToolCalls);
                            if (!loadingMsg.toolStatus) loadingMsg.toolStatus = new Map();
                            this.renderChatMessages(messagesEl);
                        },
                        onToolCallDone: (call, result) => {
                            if (!loadingMsg.toolStatus) loadingMsg.toolStatus = new Map();
                            loadingMsg.toolStatus.set(call.call_id, result.ok ? 'ok' : 'error');
                            if (call.name === 'visualize' && result.ok && result.data) {
                                if (!loadingMsg.visuals) loadingMsg.visuals = [];
                                loadingMsg.visuals.push(result.data);
                            }
                            this.renderChatMessages(messagesEl);
                        },
                    });

                    if (thinkRaw.usedProvider) passLastProvider = thinkRaw.usedProvider;
                    if (thinkRaw.usedModel) passLastModel = thinkRaw.usedModel;

                    const note = String(thinkRaw.reply || '').trim();
                    if (note) {
                        thinkingNotes.push(note);
                        if (ti === 0 && contentPassCount > 1) {
                            outlineSteps = this.parseOutlineSteps(note, contentPassCount);
                        }
                    }
                    runningHistory = runningHistory
                        .concat([
                            { role: 'user', content: thinkPrompt },
                            { role: 'assistant', content: note || '(메모 없음)' },
                        ])
                        .slice(-20);
                }
                loadingMsg._phaseLabel = null;
                if (thinkingNotes.length) passFirstReasoning = thinkingNotes.join('\n\n');
            }

            // 사고 모드가 유효한 개요를 만들었으면 각 회차가 그 항목을 순서대로 맡고,
            // 그렇지 않으면 기존 "이어서 확장해줘" 지시문으로 폴백한다.
            const isOutlinePass = !!(outlineSteps && outlineSteps.length === contentPassCount);
            let passTexts;
            if (isOutlinePass) {
                passTexts = outlineSteps.map((step, i) => {
                    if (i === 0) {
                        return `${trimmed}\n\n(지시: 이 답변을 총 ${contentPassCount}단계로 나눠 순서대로 쓰는 중이야. 이번 회차에서는 다음 항목만 다뤄줘: "${step}". 아직 다루지 않은 나머지 항목은 지금 언급하지 말고 이후 회차에서 다룰 거야.)`;
                    }
                    return `방금까지 이어서 작성한 답변에 자연스럽게 곧바로 이어서, 이번 회차에서는 다음 항목만 새로 다뤄줘(이미 다룬 내용은 반복하지 마): "${step}".`;
                });
            } else {
                const genericDirectives = this.getWorkloadChatDirectives(workloadLevel);
                passTexts = genericDirectives.map((d, i) => i === 0 ? trimmed : d);
            }
            const totalPasses = passTexts.length;

            for (let pass = 0; pass < totalPasses; pass++) {
                const passText = passTexts[pass];
                const passPhase = (pass === 0 && !isOutlinePass) ? 'user' : 'internal';

                if (totalPasses > 1 || thinkingCallCount > 0) {
                    loadingMsg.reasoning = passFirstReasoning || loadingMsg.reasoning || null;
                    loadingMsg._workloadStep = totalPasses > 1 ? `${pass + 1}/${totalPasses}` : null;
                    this.renderChatMessages(messagesEl);
                }

                const raw = await this.callChatApi(passText, {
                    stream: true,
                    history: runningHistory,
                    contextOverride: extraOpts.contextOverride,
                    signal: controller.signal,
                    phase: passPhase,
                    onStreamChunk: appendStreamChunk,
                    onToolRound: (round, maxRounds, pendingToolCalls, reasoning) => {
                        loadingMsg.toolCalls = this.mergeToolCalls(loadingMsg.toolCalls, pendingToolCalls);
                        if (!loadingMsg.toolStatus) loadingMsg.toolStatus = new Map();
                        if (reasoning) loadingMsg.reasoning = passFirstReasoning ? `${passFirstReasoning}\n\n${reasoning}` : reasoning;
                        this.renderChatMessages(messagesEl);
                    },
                    onToolCallDone: (call, result) => {
                        if (!loadingMsg.toolStatus) loadingMsg.toolStatus = new Map();
                        loadingMsg.toolStatus.set(call.call_id, result.ok ? 'ok' : 'error');
                        if (call.name === 'visualize' && result.ok && result.data) {
                            if (!loadingMsg.visuals) loadingMsg.visuals = [];
                            loadingMsg.visuals.push(result.data);
                        }
                        this.renderChatMessages(messagesEl);
                    },
                });

                if (raw.usedProvider) passLastProvider = raw.usedProvider;
                if (raw.usedModel) passLastModel = raw.usedModel;
                if (pass === 0 && raw.reasoning) passFirstReasoning = passFirstReasoning ? `${passFirstReasoning}\n\n${raw.reasoning}` : raw.reasoning;

                const replyPiece = String(raw.reply || '').trim();
                if (replyPiece) replyParts.push(replyPiece);
                if (raw.editProposal && String(raw.editProposal).trim()) editParts.push(String(raw.editProposal).trim());

                loadingMsg._streamText = replyParts.join('\n\n');

                if (pass < totalPasses - 1) {
                    runningHistory = runningHistory
                        .concat([
                            { role: 'user', content: passText },
                            { role: 'assistant', content: replyPiece || '(빈 응답)' },
                        ])
                        .slice(-20);
                }
            }

            const rethinkMaxCallCount = replyParts.length ? this.getRethinkMaxCallCount(workloadLevel) : 0;
            if (rethinkMaxCallCount > 0) {
                for (let ri = 0; ri < rethinkMaxCallCount; ri++) {
                    loadingMsg._phaseLabel = `다시 생각하는 중… (재사고 ${ri + 1}/${rethinkMaxCallCount})`;
                    loadingMsg._workloadStep = null;
                    this.renderChatMessages(messagesEl);

                    const draftForRethink = replyParts.join('\n\n');
                    let rethinkRaw;
                    try {
                        rethinkRaw = await this.callChatApi(t2aicBuildRethinkPassPrompt(draftForRethink), {
                            stream: false, // 판단 결과(마커)까지 포함된 응답이라 실시간 스트리밍은 필요 없다.
                            history: runningHistory,
                            contextOverride: extraOpts.contextOverride,
                            signal: controller.signal,
                            // 지금까지의 초안 전체를 그대로 에코하는 지시문이라
                            // 사용자 입력 한도가 아니라 내부 한도를 적용해야 한다.
                            phase: 'internal',
                        });
                    } catch (rethinkErr) {
                        if (rethinkErr && rethinkErr.name === 'AbortError') throw rethinkErr;
                        // 재사고 단계 자체가 실패해도 그 전까지의 초안은 유효하므로
                        // 전체 실패로 취급하지 않고, 남은 재사고 회차만 포기한다.
                        console.warn('[T2Ai_complex] 재사고(rethink) 단계 실패 — 직전 초안을 그대로 사용', rethinkErr);
                        break;
                    }

                    if (rethinkRaw.usedProvider) passLastProvider = rethinkRaw.usedProvider;
                    if (rethinkRaw.usedModel) passLastModel = rethinkRaw.usedModel;

                    const rethinkResult = t2aicParseRethinkResponse(rethinkRaw.reply, draftForRethink);
                    if (!rethinkResult.needed) break; // AI가 "이미 충분하다"고 판단 — 남은 상한을 억지로 채우지 않는다.

                    if (rethinkResult.revised) {
                        replyParts.length = 0;
                        replyParts.push(rethinkResult.revised);
                        loadingMsg._streamText = rethinkResult.revised;
                    }

                    runningHistory = runningHistory
                        .concat([
                            { role: 'user', content: t2aicBuildRethinkPassPrompt(draftForRethink) },
                            { role: 'assistant', content: rethinkRaw.reply || '(빈 응답)' },
                        ])
                        .slice(-20);
                }
                loadingMsg._phaseLabel = null;
            }

            const finalizeCallCount = replyParts.length ? this.getFinalizeCallCount(workloadLevel) : 0;
            if (finalizeCallCount > 0) {
                for (let fi = 0; fi < finalizeCallCount; fi++) {
                    loadingMsg._phaseLabel = finalizeCallCount > 1
                        ? `답변을 다듬는 중… (정리 ${fi + 1}/${finalizeCallCount})`
                        : '답변을 다듬는 중… (정리 단계)';
                    loadingMsg._workloadStep = null;
                    this.renderChatMessages(messagesEl);

                    const draftBeforeFinalize = replyParts.join('\n\n');
                    try {
                        const finalizeRaw = await this.callChatApi(this.buildFinalizePassPrompt(draftBeforeFinalize), {
                            stream: false, // 이미 화면에 다 나와 있는 내용을 다듬는 것이라 실시간 스트리밍은 필요 없다.
                            history: runningHistory,
                            contextOverride: extraOpts.contextOverride,
                            signal: controller.signal,
                            // 지금까지의 초안 전체를 그대로 에코하는 지시문이라
                            // 사용자 입력 한도가 아니라 내부 한도를 적용해야 한다.
                            phase: 'internal',
                        });
                        if (finalizeRaw.usedProvider) passLastProvider = finalizeRaw.usedProvider;
                        if (finalizeRaw.usedModel) passLastModel = finalizeRaw.usedModel;
                        const finalized = String(finalizeRaw.reply || '').trim();
                        if (finalized) {
                            if (t2aicLooksLikeBrokenRevision(finalized, draftBeforeFinalize)) {
                                console.warn('[T2Ai_complex] 정리 단계(finalize) 응답이 깨진 것으로 보여 초안을 그대로 사용');
                                break;
                            }
                            replyParts.length = 0;
                            replyParts.push(finalized);
                            loadingMsg._streamText = finalized;
                        }
                    } catch (finalizeErr) {
                        if (finalizeErr && finalizeErr.name === 'AbortError') throw finalizeErr;
                        // 정리 단계 자체가 실패해도 그 전까지의 초안은 유효하므로 전체 실패로
                        // 취급하지 않고 초안을 그대로 사용한다.
                        console.warn('[T2Ai_complex] 정리 단계(finalize) 실패 — 초안을 그대로 사용', finalizeErr);
                        break;
                    }
                }
                loadingMsg._phaseLabel = null;
            }

            this.chatMessages.pop(); // pending 제거
            this.chatMessages.push({
                role: 'assistant',
                content: replyParts.join('\n\n') || '(빈 응답)',
                editProposal: editParts.length ? editParts.join('\n') : null,
                provider: passLastProvider,
                model: passLastModel,
                toolCalls: loadingMsg.toolCalls,
                toolStatus: loadingMsg.toolStatus,
                visuals: loadingMsg.visuals || null,
                reasoning: passFirstReasoning || loadingMsg.reasoning || null,
                _needsTypewriter: !loadingMsg._streamText,
            });
            this.lastUsedProvider = passLastProvider || this.lastUsedProvider || null;
            this.lastUsedModel = passLastModel || this.lastUsedModel || null;
        } catch (err) {
            this.chatMessages.pop(); // pending 제거
            const hasPartial = replyParts.length > 0;
            if (err && err.name === 'AbortError') {
                // 사용자가 직접 멈춘 것은 실패가 아니므로 에러 카드 대신 조용한 안내만 남기고,
                // 그때까지의 진행 결과는 그대로 보존한다.
                this.chatMessages.push({
                    role: 'assistant',
                    content: hasPartial ? `${replyParts.join('\n\n')}\n\n_(생성을 중단했습니다.)_` : '_생성을 중단했습니다._',
                    editProposal: editParts.length ? editParts.join('\n') : null,
                    provider: passLastProvider,
                    model: passLastModel,
                    toolCalls: loadingMsg.toolCalls,
                    toolStatus: loadingMsg.toolStatus,
                    reasoning: passFirstReasoning || loadingMsg.reasoning || null,
                    _needsTypewriter: hasPartial,
                });
            } else if (hasPartial) {
                // 작업량 여러 회차 중 일부는 이미 성공했다면, 그 내용을
                // 버리지 않고 보여준 뒤 이후 회차부터 실패했음을 함께 알린다.
                this.chatMessages.push({
                    role: 'assistant',
                    content: `${replyParts.join('\n\n')}\n\n_(이후 단계에서 오류가 발생해 여기까지만 생성됐습니다: ${(err && err.message) ? err.message : String(err)})_`,
                    editProposal: editParts.length ? editParts.join('\n') : null,
                    provider: passLastProvider,
                    model: passLastModel,
                    toolCalls: loadingMsg.toolCalls,
                    toolStatus: loadingMsg.toolStatus,
                    reasoning: passFirstReasoning || loadingMsg.reasoning || null,
                    _needsTypewriter: true,
                });
            } else {
                this.chatMessages.push({ role: 'assistant', content: '', error: (err && err.message) ? err.message : String(err) });
            }
        } finally {
            this.isProcessing = false;
            this.activeChatAbort = null;
            this.setSendButtonMode(sendBtn, 'send');
            if (sendBtn && input) sendBtn.disabled = input.value.trim().length === 0;
            this.renderChatMessages(messagesEl);
            this.refreshStatusBar();
            if (input) input.focus();
        }
    }

    // 전송 ↔ 중단 버튼 전환 시 DOM 노드는 그대로 재사용한다(이벤트 리스너 재등록 불필요).
    setSendButtonMode(sendBtn, mode) {
        if (!sendBtn) return;
        const icon = sendBtn.querySelector('.material-icons');
        if (mode === 'stop') {
            sendBtn.dataset.mode = 'stop';
            sendBtn.disabled = false;
            sendBtn.setAttribute('aria-label', '생성 중단');
            if (icon) icon.textContent = 'stop';
        } else {
            sendBtn.dataset.mode = 'send';
            sendBtn.setAttribute('aria-label', '전송');
            if (icon) icon.textContent = 'arrow_upward';
        }
    }

    getChatHistoryPayload() {
        return this.chatMessages
            .filter(m => !m.pending && !m.error && m.content)
            .slice(-20)
            .map(m => ({ role: m.role, content: m.content }));
    }

    getDocumentExcerptForChat() {
        try {
            const dsl = this.readDocumentDSL();
            if (typeof dsl !== 'string' || !dsl.trim()) return null;
            return dsl.slice(0, this.safePositiveInt(this.maxChatContextChars, 4000));
        } catch (_) {
            return null;
        }
    }

    async callChatApi(text, opts = {}) {
        const toolCatalog = this.getToolCatalog().map(t => ({
            label: t.label,
            description: t.description,
            usage: t.usage || '',
            enabled: !!t.enabled,
        }));
        // contextOverride가 있으면 문서 발췌 대신 그 텍스트를 같은 채널(document_excerpt)로 보낸다
        // — 서버 프로토콜을 새로 만들지 않고 기존 채널을 재사용.
        const documentExcerpt = typeof opts.contextOverride === 'string'
            ? opts.contextOverride
            : this.getDocumentExcerptForChat();

        const raw = await this.callInteractionApi(text, {
            mode: 'chat',
            stream: !!opts.stream,
            history: opts.history || [],
            toolCatalog,
            documentExcerpt,
            onToolRound: opts.onToolRound,
            onToolCallDone: opts.onToolCallDone,
            onStreamChunk: opts.onStreamChunk,
            signal: opts.signal,
            // 'internal'로 표시하면 서버가 사용자 입력 한도(350자) 대신 더 넉넉한 내부 한도를 적용한다
            // (호출부가 명시 안 하면 기존처럼 'user'로 취급되어 하위 호환된다).
            phase: opts.phase === 'internal' ? 'internal' : 'user',
        });

        return {
            reply: raw.content,
            editProposal: raw.editProposal || null,
            usedProvider: raw.usedProvider,
            usedModel: raw.usedModel,
            reasoning: raw.reasoning || null,
        };
    }

    // 채팅의 편집 제안은 항상 append 모드로만 삽입한다 — 문서 전체 교체는 재구성 탭의 역할이다.
    async applyChatEditProposal(idx) {
        const m = this.chatMessages[idx];
        if (!m || !m.editProposal || m.applied || this.isProcessing) return;
        try {
            const { dsl, tables } = this.convertBracketResponseToDsl(m.editProposal);
            await this.applyDSL(dsl, 'append');
            if (tables && tables.length) this.fillAppendedTables(tables);
            m.applied = true;
        } catch (err) {
            console.warn('[T2Ai_complex] 채팅 편집 제안 적용 실패', err);
            m.error = (err && err.message) ? err.message : String(err);
        } finally {
            const container = this.modal ? this.modal.querySelector('.t2-aic-chat-messages') : null;
            if (container) this.renderChatMessages(container);
        }
    }

    clearChat() {
        if (this.isProcessing) return;
        this.chatMessages = [];
        if (this.modal) {
            const messagesEl = this.modal.querySelector('.t2-aic-chat-messages');
            const bodyEl = this.modal.querySelector('.t2-aic-body');
            if (messagesEl) this.renderChatMessages(messagesEl);
            if (bodyEl) this.updateChatEmptyHint(bodyEl);
        }
    }

    // 스킬(Skill) 탭 — 저장/실행은 전부 T2Skills(extend/js/t2skill_core.js)에 위임하고 이 플러그인은
    // UI만 담당한다. 새 스킬은 마법사 대신 채팅형 빌더 하나로 통일하며, 저장은 항상 사용자 확인 후 확정된다.
    getSkillCatalog() {
        if (!window.T2Skills || typeof window.T2Skills.listUI !== 'function') return [];
        try { return window.T2Skills.listUI(); }
        catch (err) { console.warn('[T2Ai_complex] T2Skills.listUI() 호출 실패', err); return []; }
    }

    getSkillDraftQuickPrompt() {
        return '지금까지 얘기한 내용을 참고해서 스킬 초안을 만들어줘. 이름/트리거 설명/절차를 ```skill 코드블록 안에 적어줘.';
    }

    getSkillsSectionHTML() {
        return `
            <section class="t2-aic-chat-messages-wrap t2-aic-skills-wrap">
                <div class="t2-aic-skills-scroll">
                    <div class="t2-aic-skills-intro">
                        <span class="material-icons" aria-hidden="true">bolt</span>
                        <p>Skill은 AI가 "언제, 어떤 절차로" Tool과 글쓰기 능력을 조합해야 하는지 적어둔 지침서예요. 서버 Skill은 관리자가 올려두고, 아래에서 직접 만든 Skill은 이 브라우저에만 저장돼요.</p>
                    </div>
                    <div class="t2-aic-skills-list"></div>
                    <div class="t2-aic-skills-create-row">
                        <button type="button" class="t2-aic-btn t2-aic-btn-primary t2-aic-skills-new-btn">
                            <span class="material-icons" aria-hidden="true">add</span>
                            <span>새 스킬 만들기</span>
                        </button>
                    </div>
                    <div class="t2-aic-skills-panel-slot"></div>
                </div>
            </section>
        `;
    }

    setupSkillsSection(body) {
        this.renderSkillsList(body);
        body.querySelector('.t2-aic-skills-new-btn').addEventListener('click', () => this.openSkillBuilder(body));
        // 이전 세션에서 빌더가 열려 있던 상태로 탭을 나갔다가 다시 들어온
        // 경우(예: 모달을 닫지 않고 다른 탭을 눌렀다가 되돌아옴) 그대로 복원.
        if (this.skillBuilder) this.renderSkillBuilder(body);
    }

    renderSkillsList(body) {
        const listEl = body.querySelector('.t2-aic-skills-list');
        if (!listEl) return;
        const catalog = this.getSkillCatalog();

        if (!window.T2Skills) {
            this.setSafeUIHTML(listEl, `<span class="t2-aic-tools-empty">스킬 기능을 불러오지 못했습니다 (extend/js/t2skill_core.js 미로드)</span>`);
            return;
        }
        if (!catalog.length) {
            this.setSafeUIHTML(listEl, `<span class="t2-aic-tools-empty">아직 등록된 스킬이 없습니다. 아래 "새 스킬 만들기"로 첫 스킬을 만들어보세요.</span>`);
            return;
        }

        this.setSafeUIHTML(listEl, catalog.map(s => `
            <div class="t2-aic-skill-row${s.enabled ? ' is-active' : ''}" data-skill-name="${this.escapeAttr(s.name)}">
                <button type="button" class="t2-aic-skill-toggle" data-skill-name="${this.escapeAttr(s.name)}" role="switch" aria-checked="${s.enabled}" aria-label="${this.escapeAttr(s.name)} 켜기/끄기">
                    <span class="material-icons" aria-hidden="true">${s.enabled ? 'check_circle' : 'radio_button_unchecked'}</span>
                </button>
                <div class="t2-aic-skill-row-main">
                    <div class="t2-aic-skill-row-name">
                        ${this.escapeHtml(s.name)}
                        <span class="t2-aic-skill-badge ${s.source === 'server' ? 'is-server' : 'is-user'}">${s.source === 'server' ? '서버' : '내 스킬'}</span>
                    </div>
                    <div class="t2-aic-skill-row-desc">${this.escapeHtml(s.description)}</div>
                </div>
                <div class="t2-aic-skill-row-actions">
                    ${s.editable ? `
                        <button type="button" class="t2-aic-skill-edit" data-skill-name="${this.escapeAttr(s.name)}" aria-label="수정">
                            <span class="material-icons" aria-hidden="true">edit</span>
                        </button>
                        <button type="button" class="t2-aic-skill-delete" data-skill-name="${this.escapeAttr(s.name)}" aria-label="삭제">
                            <span class="material-icons" aria-hidden="true">delete_outline</span>
                        </button>
                    ` : `
                        <button type="button" class="t2-aic-skill-view" data-skill-name="${this.escapeAttr(s.name)}" aria-label="지침 보기">
                            <span class="material-icons" aria-hidden="true">visibility</span>
                        </button>
                    `}
                </div>
            </div>
        `).join(''));

        listEl.querySelectorAll('.t2-aic-skill-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.skillName;
                const nowEnabled = !window.T2Skills.isEnabled(name);
                window.T2Skills.setEnabled(name, nowEnabled);
                this.renderSkillsList(body);
            });
        });
        listEl.querySelectorAll('.t2-aic-skill-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const skill = window.T2Skills.get(btn.dataset.skillName);
                if (skill) this.openSkillBuilder(body, { draft: skill, editingName: skill.name });
            });
        });
        listEl.querySelectorAll('.t2-aic-skill-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const skill = window.T2Skills.get(btn.dataset.skillName);
                if (skill) this.showSkillInfoPopup(skill);
            });
        });
        listEl.querySelectorAll('.t2-aic-skill-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.skillName;
                if (!confirm(`"${name}" 스킬을 삭제할까요? (이 브라우저에서만 사라지며 되돌릴 수 없습니다)`)) return;
                window.T2Skills.deleteUserSkill(name);
                this.renderSkillsList(body);
            });
        });
    }

    // 서버 Skill(수정 불가)의 지침 전문은 Tool 설명 팝업과 동일한 가벼운
    // 정보 팝업으로만 보여준다 — 별도의 "읽기 전용 편집 폼"을 두지 않는다.
    showSkillInfoPopup(skill) {
        document.querySelectorAll('.t2-aic-tool-info-overlay').forEach(p => p.remove());

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-info-overlay t2-aic-tool-info-overlay';
        const popup = document.createElement('div');
        popup.className = 't2-aic-info-popup t2-aic-tool-info-popup';
        this.setSafeUIHTML(popup, `
            <div class="t2-aic-info-head">
                <span class="material-icons t2-aic-title-icon" aria-hidden="true" style="font-size:20px;">bolt</span>
                <strong>${this.escapeHtml(skill.name)}</strong>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-info-item" style="border-top:none;padding-top:0;">
                <p>${this.escapeHtml(skill.description)}</p>
            </div>
            <div class="t2-aic-info-footer">
                <p style="white-space:pre-wrap;">${this.escapeHtml(skill.body)}</p>
            </div>
        `);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        popup.querySelector('.t2-aic-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    // ── 스킬 빌더(skill builder) — 하나로 통일된 생성/수정 대화창 ────────────
    // this.skillBuilder = { messages, draft, editingName, pendingTranscript }
    openSkillBuilder(body, opts = {}) {
        this.skillBuilder = {
            messages: [],
            draft: opts.draft ? { name: opts.draft.name, description: opts.draft.description, body: opts.draft.body } : null,
            editingName: opts.editingName || null,
            pendingTranscript: null,
        };
        this.renderSkillBuilder(body);
        setTimeout(() => {
            const input = body.querySelector('.t2-aic-skill-builder-input');
            if (input) input.focus();
        }, 0);
    }

    closeSkillBuilder(body) {
        this.cancelSkillRecordingIfActive();
        this.skillBuilder = null;
        const slot = body.querySelector('.t2-aic-skills-panel-slot');
        if (slot) slot.innerHTML = '';
    }

    getSkillBuilderMsgHTML(m) {
        if (m.pending) {
            return `<div class="t2-aic-skill-builder-msg is-assistant"><div class="t2-aic-chat-typing"><span></span><span></span><span></span></div></div>`;
        }
        if (m.error) {
            return `<div class="t2-aic-skill-builder-msg is-assistant"><div class="t2-aic-chat-error"><span class="material-icons" aria-hidden="true">error_outline</span><span>${this.escapeHtml(m.error)}</span></div></div>`;
        }
        return `<div class="t2-aic-skill-builder-msg ${m.role === 'user' ? 'is-user' : 'is-assistant'}">${this.renderChatMarkdown(m.content || '')}</div>`;
    }

    getSkillDraftCardHTML(draft) {
        const locked = !!this.skillBuilder.editingName;
        return `
            <div class="t2-aic-skill-draftcard">
                <div class="t2-aic-skill-draftcard-head">
                    <span class="material-icons" aria-hidden="true">bolt</span>
                    <span>${locked ? '스킬 수정' : '스킬 초안 — 필요하면 바로 고쳐도 돼요'}</span>
                </div>
                <input type="text" class="t2-aic-skill-draft-name" ${locked ? 'disabled' : ''}
                    value="${this.escapeAttr(draft.name)}" placeholder="이름 (예: product_intro_writer)">
                <textarea class="t2-aic-skill-draft-desc" rows="2"
                    placeholder="트리거 설명 — 언제 이 스킬을 써야 하는지">${this.escapeHtml(draft.description)}</textarea>
                <textarea class="t2-aic-skill-draft-body" rows="6"
                    placeholder="지침 본문 — 1. ...\n2. ...">${this.escapeHtml(draft.body)}</textarea>
                <div class="t2-aic-skill-form-actions">
                    <button type="button" class="t2-aic-btn t2-aic-btn-ghost t2-aic-skill-draft-discard">지우고 계속 채팅</button>
                    <button type="button" class="t2-aic-btn t2-aic-btn-primary t2-aic-skill-draft-save">저장</button>
                </div>
            </div>
        `;
    }

    renderSkillBuilder(body) {
        const slot = body.querySelector('.t2-aic-skills-panel-slot');
        if (!slot) return;
        const sb = this.skillBuilder;
        if (!sb) { slot.innerHTML = ''; return; }

        const isRecording = !!(window.T2SkillRecorder && window.T2SkillRecorder.isRecording());
        const showIntro = !sb.messages.length && !sb.draft;

        this.setSafeUIHTML(slot, `
            <div class="t2-aic-skill-builder">
                <div class="t2-aic-skill-panel-head">
                    <strong>${sb.editingName ? '스킬 수정' : '새 스킬 만들기'}</strong>
                    <button type="button" class="t2-aic-skill-panel-close" aria-label="닫기"><span class="material-icons">close</span></button>
                </div>

                ${showIntro ? `<p class="t2-aic-section-desc">어떤 작업을 위한 스킬인지 편하게 설명해주세요. 편집기에서 직접 시연하면서 보여줄 수도 있어요(입력줄 옆 ⏺ 버튼).</p>` : ''}

                ${sb.messages.length ? `<div class="t2-aic-skill-builder-messages">${sb.messages.map(m => this.getSkillBuilderMsgHTML(m)).join('')}</div>` : ''}

                ${sb.draft ? this.getSkillDraftCardHTML(sb.draft) : ''}

                <div class="t2-aic-skill-builder-composer">
                    <textarea class="t2-aic-skill-builder-input" rows="1"
                        maxlength="${this.escapeAttr(this.safePositiveInt(this.maxInputChars, 350))}"
                        placeholder="${sb.pendingTranscript ? '방금 시연한 작업을 설명해주세요…' : (sb.draft ? '더 고치고 싶은 점을 말해주세요' : '어떤 작업을 위한 스킬인가요?')}"></textarea>
                    ${window.T2SkillRecorder ? `
                        <button type="button" class="t2-aic-skill-builder-record${isRecording ? ' is-recording' : ''}" aria-label="편집기에서 직접 시연하며 보여주기" title="편집기에서 직접 시연하며 보여주기">
                            <span class="material-icons" aria-hidden="true">fiber_manual_record</span>
                        </button>
                    ` : ''}
                    <button type="button" class="t2-aic-skill-builder-send t2-aic-btn t2-aic-btn-primary" disabled aria-label="보내기">
                        <span class="material-icons" aria-hidden="true">send</span>
                    </button>
                </div>
                ${sb.pendingTranscript ? `<p class="t2-aic-skill-builder-hint">시연 기록이 첨부되어 있어요 — 설명을 적어 보내면 그 기록과 함께 전달돼요.</p>` : ''}
            </div>
        `);

        slot.querySelector('.t2-aic-skill-panel-close').addEventListener('click', () => this.closeSkillBuilder(body));

        const input = slot.querySelector('.t2-aic-skill-builder-input');
        const sendBtn = slot.querySelector('.t2-aic-skill-builder-send');
        if (input && sendBtn) {
            const updateSendState = () => { sendBtn.disabled = this.isProcessing || input.value.trim().length === 0; };
            input.addEventListener('input', updateSendState);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    if (!sendBtn.disabled) this.sendSkillBuilderMessage(body);
                }
            });
            sendBtn.addEventListener('click', () => { if (!sendBtn.disabled) this.sendSkillBuilderMessage(body); });
            updateSendState();
        }

        const recordBtn = slot.querySelector('.t2-aic-skill-builder-record');
        if (recordBtn) recordBtn.addEventListener('click', () => this.toggleSkillBuilderRecording(body));

        const discardBtn = slot.querySelector('.t2-aic-skill-draft-discard');
        if (discardBtn) discardBtn.addEventListener('click', () => { sb.draft = null; this.renderSkillBuilder(body); });

        const saveBtn = slot.querySelector('.t2-aic-skill-draft-save');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveSkillBuilderDraft(body));
    }

    async sendSkillBuilderMessage(body) {
        const sb = this.skillBuilder;
        if (!sb || this.isProcessing) return;
        const input = body.querySelector('.t2-aic-skill-builder-input');
        if (!input) return;
        const max = this.safePositiveInt(this.maxInputChars, 350);
        let text = input.value.trim();
        if (!text) return;
        if (text.length > max) text = text.slice(0, max);

        let contextOverride;
        if (sb.pendingTranscript) {
            contextOverride = window.T2SkillRecorder.describeForPrompt(
                sb.pendingTranscript, text, this.safePositiveInt(this.maxChatContextChars, 4000)
            );
            sb.pendingTranscript = null;
        }

        sb.messages.push({ role: 'user', content: text });
        input.value = '';
        this.isProcessing = true;
        const loadingMsg = { role: 'assistant', content: '', pending: true };
        sb.messages.push(loadingMsg);
        this.renderSkillBuilder(body);

        try {
            const history = sb.messages
                .filter(m => m !== loadingMsg && !m.error && m.content)
                .map(m => ({ role: m.role, content: m.content }));
            const raw = await this.callChatApi(text, { history, contextOverride });
            const idx = sb.messages.indexOf(loadingMsg);
            if (idx !== -1) sb.messages.splice(idx, 1);
            const replyText = String(raw.reply || '').trim() || '(빈 응답)';
            sb.messages.push({ role: 'assistant', content: replyText });
            const parsed = this.parseSkillDraftFromText(replyText);
            if (parsed) sb.draft = { ...parsed, ...(sb.draft && sb.editingName ? { name: sb.editingName } : {}) };
        } catch (err) {
            const idx = sb.messages.indexOf(loadingMsg);
            if (idx !== -1) sb.messages.splice(idx, 1);
            sb.messages.push({ role: 'assistant', content: '', error: (err && err.message) ? err.message : String(err) });
        } finally {
            this.isProcessing = false;
            if (this.skillBuilder === sb) this.renderSkillBuilder(body);
        }
    }

    // ```skill 블록에서 NAME:/DESC:/BODY: 형식을 파싱한다 — 엄격한 JSON 대신 단순 포맷을 쓰는 이유는
    // 성능이 낮은 LLM이 JSON 형식을 자주 깨뜨리기 때문이다.
    parseSkillDraftFromText(text) {
        const raw = String(text || '');
        const m = raw.match(/```skill\s*\n([\s\S]*?)```/i);
        if (!m) return null;
        const inner = m[1];

        const nameMatch = inner.match(/^\s*NAME\s*:\s*(.+)$/im);
        const descMatch = inner.match(/^\s*DESC(?:RIPTION)?\s*:\s*(.+)$/im);
        const bodyMatch = inner.match(/^\s*BODY\s*:\s*\n?([\s\S]*)$/im);
        if (!nameMatch) return null;

        const name = nameMatch[1].trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '') || 'my_skill';
        const description = descMatch ? descMatch[1].trim() : '';
        const skillBody = bodyMatch ? bodyMatch[1].trim() : '';
        if (!description || !skillBody) return null;
        return { name, description, body: skillBody };
    }

    saveSkillBuilderDraft(body) {
        const sb = this.skillBuilder;
        if (!sb || !sb.draft) return;
        const slot = body.querySelector('.t2-aic-skills-panel-slot');
        const name = (sb.editingName || slot.querySelector('.t2-aic-skill-draft-name').value.trim());
        const description = slot.querySelector('.t2-aic-skill-draft-desc').value.trim();
        const skillBody = slot.querySelector('.t2-aic-skill-draft-body').value.trim();

        if (!/^[a-z][a-z0-9_]*$/.test(name)) { alert('이름은 소문자/숫자/언더스코어만 가능하고, 첫 글자는 영문 소문자여야 해요.'); return; }
        if (!description) { alert('트리거 설명을 입력해주세요.'); return; }
        if (!skillBody) { alert('지침 본문을 입력해주세요.'); return; }

        const res = window.T2Skills.saveUserSkill({
            name, description, body: skillBody,
            origin: sb.messages.length ? 'chat' : 'manual',
        });
        if (!res.ok) { alert('저장 실패: ' + res.error); return; }
        this.closeSkillBuilder(body);
        this.renderSkillsList(body);
    }

    toggleSkillBuilderRecording(body) {
        if (!window.T2SkillRecorder) return;
        const sb = this.skillBuilder;
        if (!sb) return;

        if (window.T2SkillRecorder.isRecording()) {
            const transcript = window.T2SkillRecorder.stop();
            if (this._recordBar) { this._recordBar.remove(); this._recordBar = null; }
            if (this.modal) this.modal.classList.remove('t2-aic-hidden-while-picking');
            if (transcript) sb.pendingTranscript = transcript;
            this.renderSkillBuilder(body);
            const input = body.querySelector('.t2-aic-skill-builder-input');
            if (input) input.focus();
            return;
        }

        const ok = window.T2SkillRecorder.start({ id: this.resolveMyEditorId() });
        if (!ok) { alert('녹화를 시작할 수 없습니다 (활성 에디터를 찾지 못함).'); return; }
        if (this.modal) this.modal.classList.add('t2-aic-hidden-while-picking');

        const bar = document.createElement('div');
        bar.className = 't2-aic-pick-bar t2-aic-record-bar';
        this.setSafeUIHTML(bar, `
            <span class="material-icons" aria-hidden="true">fiber_manual_record</span>
            <span class="t2-aic-pick-bar-text">녹화 중… 편집기에서 원하는 작업을 직접 시연하세요</span>
            <button type="button" class="t2-aic-pick-cancel t2-aic-record-stop">중지</button>
        `);
        document.body.appendChild(bar);
        this._recordBar = bar;
        bar.querySelector('.t2-aic-record-stop').addEventListener('click', () => this.toggleSkillBuilderRecording(body));
    }

    // 채팅 말풍선의 "스킬로 저장" 버튼 — 스킬 탭으로 이동해 빌더를 그 초안으로
    // 곧바로 연다(사람이 검토 후 "저장"을 눌러야 확정 — 즉시 저장되지 않음).
    openSkillDraftFromChat(idx) {
        const m = this.chatMessages[idx];
        if (!m) return;
        const draft = this.parseSkillDraftFromText(m.content || '');
        if (!draft) return;
        m.skillSaved = false;

        // 스킬 탭이 따로 없으므로, "+" 버튼이 여는 Tools&Skills
        // 바텀시트를 스킬 세그먼트로 바로 열고 그 안에서 빌더를 띄운다.
        this.openPlusSheet('skills', { skillDraft: draft });
    }

    renderToolPills(container) {
        if (!container) return;
        const catalog = this.getToolCatalog();
        const enabled = catalog.filter(t => t.enabled);

        if (!catalog.length) {
            this.setSafeUIHTML(container, `<span class="t2-aic-tools-empty">연결된 Tool이 없습니다 (extend/js 미로드)</span>`);
            return;
        }
        if (!enabled.length) {
            this.setSafeUIHTML(container, `<span class="t2-aic-tools-empty">사용 중인 도구가 없습니다</span>`);
            return;
        }

        this.setSafeUIHTML(container, enabled.map(t => `
            <span class="t2-aic-tool-pill" data-tool-id="${this.escapeAttr(t.id)}">
                <span class="t2-aic-tool-pill-label">${this.escapeHtml(t.label)}</span>
                <button class="t2-aic-tool-pill-x" type="button" data-tool-id="${this.escapeAttr(t.id)}" aria-label="${this.escapeAttr(t.label)} 도구 끄기">
                    <span class="material-icons" aria-hidden="true">close</span>
                </button>
            </span>
        `).join(''));

        container.querySelectorAll('.t2-aic-tool-pill-x').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setToolEnabled(btn.dataset.toolId, false);
            });
        });
    }

    // 실제 on/off 상태는 이 플러그인이 아니라 T2AITools(코어)가 들고 있다 — 여기서는 위임만 한다
    // (이래야 "꺼짐"이 UI뿐 아니라 실제 실행 거부로도 이어진다).
    setToolEnabled(toolId, enabled) {
        if (!window.T2AITools || typeof window.T2AITools.setEnabled !== 'function') return;
        window.T2AITools.setEnabled(toolId, enabled);

        this.refreshToolsTrigger();
        if (this.toolsPopupEl) {
            this.renderToolsPopupList(this.toolsPopupEl.querySelector('.t2-aic-tools-popup-list'));
        }
        if (this._plusSheetEl) {
            const list = this._plusSheetEl.querySelector('.t2-aic-plus-tools-list');
            if (list) this.renderToolsPopupList(list);
        }
    }

    toggleToolsPopup(caretBtn) {
        if (this.toolsPopupEl) { this.closeToolsPopup(); return; }
        this.openToolsPopup(caretBtn);
    }

    openToolsPopup(caretBtn) {
        this.closeToolsPopup();

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-tools-popup-overlay';

        const popup = document.createElement('div');
        popup.className = 't2-aic-tools-popup';
        this.setSafeUIHTML(popup, `
            <div class="t2-aic-tools-popup-head">
                <span>전체 도구</span>
                <span class="t2-aic-tools-popup-hint">눌러서 켜고 끌 수 있어요</span>
            </div>
            <div class="t2-aic-tools-popup-list"></div>
        `);

        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        this.toolsPopupEl = overlay;

        this.renderToolsPopupList(popup.querySelector('.t2-aic-tools-popup-list'));
        this.positionToolsPopup(popup, caretBtn);

        caretBtn.classList.add('is-open');
        caretBtn.setAttribute('aria-expanded', 'true');

        // '설명 보기' 팝업은 이 popup의 자식이 아니라 body에 별도로 붙는 오버레이라, 그 팝업을
        // 닫으려는 클릭이 "바깥 클릭"으로 오인되어 tools popup까지 같이 닫히는 버그가 있었다 — 예외 처리함.
        const onOutside = (e) => {
            if (popup.contains(e.target) || e.target === caretBtn || caretBtn.contains(e.target)) return;
            if (e.target.closest && e.target.closest('.t2-aic-tool-info-overlay')) return;
            this.closeToolsPopup();
        };
        const onReflow = () => this.closeToolsPopup();
        const onEsc = (e) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('.t2-aic-tool-info-overlay')) return;
            this.closeToolsPopup();
        };
        const scrollParent = this.modal ? this.modal.querySelector('.t2-aic-body') : null;

        // 캐럿을 클릭한 이 이벤트가 곧바로 "바깥 클릭"으로 잡혀 즉시 닫히는
        // 것을 막기 위해 한 틱 미룬 뒤 리스너를 건다.
        setTimeout(() => {
            document.addEventListener('mousedown', onOutside);
            document.addEventListener('keydown', onEsc);
            window.addEventListener('resize', onReflow);
            if (scrollParent) scrollParent.addEventListener('scroll', onReflow, { passive: true });
        }, 0);

        this._toolsPopupCleanup = () => {
            document.removeEventListener('mousedown', onOutside);
            document.removeEventListener('keydown', onEsc);
            window.removeEventListener('resize', onReflow);
            if (scrollParent) scrollParent.removeEventListener('scroll', onReflow);
        };
    }

    closeToolsPopup() {
        if (!this.toolsPopupEl) return;
        this.toolsPopupEl.remove();
        this.toolsPopupEl = null;
        if (this._toolsPopupCleanup) { this._toolsPopupCleanup(); this._toolsPopupCleanup = null; }
        document.querySelectorAll('.t2-aic-tools-caret.is-open').forEach(btn => {
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    positionToolsPopup(popup, caretBtn) {
        const rect = caretBtn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 10;

        popup.style.visibility = 'hidden';
        popup.style.position = 'fixed';
        popup.style.top = '0px';
        popup.style.left = '0px';
        popup.style.width = Math.min(300, vw - margin * 2) + 'px';

        const measured = popup.getBoundingClientRect();
        const popupWidth = measured.width;
        const popupHeight = Math.min(measured.height, vh - margin * 2);

        let top = rect.top - popupHeight - 8; // 기본: 캐럿 위로
        if (top < margin) {
            top = rect.bottom + 8; // 위쪽 공간 부족 → 아래로 뒤집기
            if (top + popupHeight > vh - margin) top = Math.max(margin, vh - margin - popupHeight);
        }

        let left = rect.right - popupWidth; // 캐럿 오른쪽 끝에 맞춤
        if (left < margin) left = margin;
        if (left + popupWidth > vw - margin) left = Math.max(margin, vw - margin - popupWidth);

        popup.style.maxHeight = popupHeight + 'px';
        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
        popup.style.visibility = 'visible';
    }

    renderToolsPopupList(listEl) {
        if (!listEl) return;
        const catalog = this.getToolCatalog();

        if (!catalog.length) {
            this.setSafeUIHTML(listEl, `<span class="t2-aic-tools-empty">연결된 Tool이 없습니다</span>`);
            return;
        }

        this.setSafeUIHTML(listEl, catalog.map(t => {
            const active = !!t.enabled;
            return `
            <div class="t2-aic-tools-popup-row${active ? ' is-active' : ''}" data-tool-id="${this.escapeAttr(t.id)}" role="button" tabindex="0" aria-pressed="${active}">
                <span class="t2-aic-tools-popup-check" aria-hidden="true">${active ? '<span class="material-icons">check</span>' : ''}</span>
                <span class="material-icons t2-aic-tools-popup-icon" aria-hidden="true">${this.escapeHtml(t.icon || 'build')}</span>
                <span class="t2-aic-tools-popup-name">${this.escapeHtml(t.label)}</span>
                <button class="t2-aic-tools-popup-info" type="button" data-tool-id="${this.escapeAttr(t.id)}" aria-label="${this.escapeAttr(t.label)} 설명 보기">
                    <span class="material-icons" aria-hidden="true">info</span>
                </button>
            </div>`;
        }).join(''));

        listEl.querySelectorAll('.t2-aic-tools-popup-row').forEach(row => {
            const toggle = () => this.setToolEnabled(row.dataset.toolId, !row.classList.contains('is-active'));
            row.addEventListener('click', (e) => {
                if (e.target.closest('.t2-aic-tools-popup-info')) return;
                toggle();
            });
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
        });

        listEl.querySelectorAll('.t2-aic-tools-popup-info').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tool = catalog.find(t => t.id === btn.dataset.toolId);
                if (tool) this.showToolInfoPopup(tool);
            });
        });
    }

    showToolInfoPopup(tool) {
        document.querySelectorAll('.t2-aic-tool-info-overlay').forEach(p => p.remove());

        const overlay = document.createElement('div');
        overlay.className = 't2-aic-info-overlay t2-aic-tool-info-overlay';

        const popup = document.createElement('div');
        popup.className = 't2-aic-info-popup t2-aic-tool-info-popup';
        this.setSafeUIHTML(popup, `
            <div class="t2-aic-info-head">
                <span class="material-icons t2-aic-title-icon" aria-hidden="true" style="font-size:20px;">${this.escapeHtml(tool.icon || 'build')}</span>
                <strong>${this.escapeHtml(tool.label)}</strong>
                <button class="t2-aic-close" type="button" aria-label="닫기"><span class="material-icons">close</span></button>
            </div>
            <div class="t2-aic-info-item" style="border-top:none;padding-top:0;">
                <p>${this.escapeHtml(tool.description)}</p>
            </div>
            <div class="t2-aic-info-footer">
                <p>${this.escapeHtml(tool.usage)}</p>
            </div>
        `);

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        popup.querySelector('.t2-aic-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    // 요소 선택(포커스 힌트): 이 모달은 전체 화면 오버레이라 켜진 채로는 에디터 블록 클릭이 막힌다.
    // 그래서 선택 모드에 들어가면 모달을 잠깐 숨기고 작은 안내 바만 띄워 편집 화면을 그대로 보게 한다.
    toggleFocusPick(btn, body) {
        if (this.focusPickActive) { this.finishFocusPick(); this.renderFocusChip(body); return; }

        this.focusPickActive = true;
        btn.classList.add('is-active');
        btn.querySelector('.t2-aic-focus-btn-text').textContent = '선택 모드 진행 중…';

        const editorEl = this.editor.editor;

        // 이전에 이미 골라둔 블록이 있으면(같은 모달 세션 내 재진입 등) 다시
        // 픽 모드에 들어가는 순간부터 계속 "선택됨" 표시를 켜둔다.
        this.focusHints.forEach(h => { if (h.el && h.el.isConnected) h.el.classList.add('t2-aic-focus-selected'); });

        this._focusPickHoverHandler = (e) => {
            const block = e.target.closest('.t2-editor > *');
            editorEl.querySelectorAll('.t2-aic-focus-pick').forEach(el => el.classList.remove('t2-aic-focus-pick'));
            // 이미 선택된 블록 위에서는 호버 하이라이트를 겹쳐 그리지 않는다
            // (선택됨 표시와 호버 표시가 혼동되지 않도록).
            if (block && !this.focusHints.some(h => h.el === block)) block.classList.add('t2-aic-focus-pick');
        };
        this._focusPickHandler = (e) => {
            const block = e.target.closest('.t2-editor > *');
            if (!block) return;
            e.preventDefault();
            e.stopPropagation();

            const idx = this.focusHints.findIndex(h => h.el === block);
            if (idx >= 0) {
                block.classList.remove('t2-aic-focus-selected');
                this.focusHints.splice(idx, 1);
            } else {
                const preview = (block.textContent || block.getAttribute('alt') || block.tagName).trim().slice(0, 60);
                this.focusHints.push({ preview: preview || `(${block.tagName.toLowerCase()} 블록)`, tag: block.tagName.toLowerCase(), el: block });
                block.classList.remove('t2-aic-focus-pick');
                block.classList.add('t2-aic-focus-selected');
            }
            this.renderFocusChip(body);
            this.updatePickBarCount();
        };

        editorEl.addEventListener('mouseover', this._focusPickHoverHandler);
        editorEl.addEventListener('click', this._focusPickHandler, true);

        this.enterPickMode(body);
    }

    enterPickMode(body) {
        if (this.modal) this.modal.classList.add('t2-aic-hidden-while-picking');

        const bar = document.createElement('div');
        bar.className = 't2-aic-pick-bar';
        this.setSafeUIHTML(bar, `
            <span class="material-icons" aria-hidden="true">ads_click</span>
            <span class="t2-aic-pick-bar-text">에디터에서 원하는 블록을 클릭하세요 (여러 개 선택 가능)</span>
            <button type="button" class="t2-aic-pick-clear">전체 해제</button>
            <button type="button" class="t2-aic-pick-cancel">완료 (Esc)</button>
        `);
        document.body.appendChild(bar);
        this._pickBar = bar;
        this.updatePickBarCount();

        bar.querySelector('.t2-aic-pick-clear').addEventListener('click', () => {
            this.clearAllFocusHints();
            this.updatePickBarCount();
            this.renderFocusChip(body);
        });
        bar.querySelector('.t2-aic-pick-cancel').addEventListener('click', () => {
            this.finishFocusPick();
            this.renderFocusChip(body);
        });

        this._pickEscHandler = (e) => {
            if (e.key !== 'Escape') return;
            this.finishFocusPick();
            this.renderFocusChip(body);
        };
        document.addEventListener('keydown', this._pickEscHandler);
    }

    // 픽 모드 안내 바의 문구를 "N개 선택됨"으로 갱신한다.
    updatePickBarCount() {
        if (!this._pickBar) return;
        const textEl = this._pickBar.querySelector('.t2-aic-pick-bar-text');
        if (!textEl) return;
        const n = this.focusHints.length;
        textEl.textContent = n > 0
            ? `${n}개 선택됨 — 계속 클릭해 추가/해제하세요`
            : '에디터에서 원하는 블록을 클릭하세요 (여러 개 선택 가능)';
    }

    exitPickMode() {
        if (this.modal) this.modal.classList.remove('t2-aic-hidden-while-picking');
        if (this._pickBar) { this._pickBar.remove(); this._pickBar = null; }
        if (this._pickEscHandler) { document.removeEventListener('keydown', this._pickEscHandler); this._pickEscHandler = null; }
    }

    // 이름은 cancelFocusPick이지만 실제로는 취소가 아니라 종료/확정이다 — 고른 focusHints는
    // 그대로 유지한 채 픽 UI만 정리한다(closeModal에서도 재사용하기 위해 이름은 유지).
    finishFocusPick() {
        this.cancelFocusPick();
    }

    // 현재 세션에서 고른 블록을 전부 지운다(하이라이트 포함).
    clearAllFocusHints() {
        this.focusHints.forEach(h => { if (h.el && h.el.isConnected) h.el.classList.remove('t2-aic-focus-selected'); });
        this.focusHints = [];
    }

    cancelFocusPick() {
        if (!this.focusPickActive) return;
        this.focusPickActive = false;
        const editorEl = this.editor && this.editor.editor;
        if (editorEl) {
            editorEl.querySelectorAll('.t2-aic-focus-pick').forEach(el => el.classList.remove('t2-aic-focus-pick'));
            if (this._focusPickHoverHandler) editorEl.removeEventListener('mouseover', this._focusPickHoverHandler);
            if (this._focusPickHandler) editorEl.removeEventListener('click', this._focusPickHandler, true);
        }
        this._focusPickHoverHandler = null;
        this._focusPickHandler = null;
        this.exitPickMode();
        const btn = this.modal && this.modal.querySelector('.t2-aic-focus-btn');
        if (btn) {
            btn.classList.remove('is-active');
            const t = btn.querySelector('.t2-aic-focus-btn-text');
            if (t) t.textContent = '문서에서 특정 부분 선택';
        }
    }

    renderFocusChip(body) {
        const slot = body.querySelector('.t2-aic-focus-chip-slot');
        if (!slot) return;
        if (!this.focusHints.length) { slot.innerHTML = ''; return; }

        const chipsHtml = this.focusHints.map((h, i) => `
            <span class="t2-aic-focus-chip">
                <span class="material-icons" style="font-size:13px;" aria-hidden="true">crop_free</span>
                <span class="txt">${this.escapeHtml(h.preview)}</span>
                <button type="button" data-idx="${i}" aria-label="선택 해제">×</button>
            </span>
        `).join('');
        const clearAllHtml = this.focusHints.length > 1
            ? `<button type="button" class="t2-aic-focus-clear-all">전체 해제</button>`
            : '';

        this.setSafeUIHTML(slot, chipsHtml + clearAllHtml);

        slot.querySelectorAll('.t2-aic-focus-chip button').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                const hint = this.focusHints[idx];
                if (hint && hint.el && hint.el.isConnected) hint.el.classList.remove('t2-aic-focus-selected');
                this.focusHints.splice(idx, 1);
                this.renderFocusChip(body);
                this.updatePickBarCount();
            });
        });
        const clearAllBtn = slot.querySelector('.t2-aic-focus-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                this.clearAllFocusHints();
                this.renderFocusChip(body);
                this.updatePickBarCount();
            });
        }
    }

    getFocusHintText() {
        if (!this.focusHints.length) return '';
        return this.focusHints.map(h => `"${h.preview}"`).join(', ');
    }

    async runGenerate(instruction, body, footer) {
        const result = body.querySelector('.t2-aic-result');
        this.isProcessing = true;
        result.classList.add('is-visible');
        this.setSafeUIHTML(result, `<div class="t2-aic-loading"><div class="t2-aic-spinner"></div><span>콘텐츠를 생성하고 있습니다…</span></div>`);
        footer.querySelectorAll('.t2-aic-btn').forEach(b => b.disabled = true);

        try {
            const promptText = this.buildInteractionText(instruction);
            // stream:true를 켠다 — client_tools가 있으면 callInteractionApi()가 알아서
            // 스트리밍을 건너뛰므로 이 플래그는 그 경우 무해하다.
            const raw = await this.callInteractionApi(promptText, {
                mode: 'generate',
                stream: true,
                onToolRound: (round, maxRounds) => {
                    const roundLabel = maxRounds ? `${round}/${maxRounds}` : `${round}`;
                    this.setSafeUIHTML(result, `<div class="t2-aic-loading"><div class="t2-aic-spinner"></div><span>도구를 실행하고 있습니다… (${roundLabel})</span></div>`);
                },
            });
            const { dsl, tables } = this.convertBracketResponseToDsl(raw.content);

            this.currentDsl = dsl;
            this.currentTables = tables;
            this.renderDslPreview(dsl, result, tables);
            this.renderModelBadge(result, raw.usedProvider, raw.usedModel);
            this.renderFooter(footer, body, body.querySelector('.t2-aic-instruction'));
            this.appendResultActions(footer, [
                { label: '다시 생성', icon: 'refresh', cls: 'ghost', onClick: () => this.runGenerate(instruction, body, footer) },
                { label: '문서에 추가', icon: 'add', cls: 'primary', onClick: () => this.insertGenerated() }
            ]);
            this.refreshStatusBar();
        } catch (err) {
            this.renderErrorBox(result, err);
            this.renderFooter(footer, body, body.querySelector('.t2-aic-instruction'));
        } finally {
            this.isProcessing = false;
            footer.querySelectorAll('.t2-aic-btn').forEach(b => b.disabled = false);
        }
    }

    buildInteractionText(instruction) {
        let text = String(instruction ?? '').trim();
        const focusText = this.getFocusHintText();
        if (focusText) {
            text += this.focusHints.length > 1
                ? `\n(참고로 다음 부분들과 어울리게 써줘: ${focusText})`
                : `\n(참고로 ${focusText} 부분과 어울리게 써줘)`;
        }
        const max = this.safePositiveInt(this.maxInputChars, 350);
        return text.length > max ? text.slice(0, max) : text;
    }

    async insertGenerated() {
        if (!this.currentDsl) return;
        await this.applyDSL(this.currentDsl, 'append');
        // T2LLM의 TABLE 태그는 구조(칸수x행수)만 만들고 셀 내용은 채우지 않으므로,
        // 표에 한해서만 별도로 텍스트를 채우는 후처리를 한 번 더 한다.
        if (this.currentTables && this.currentTables.length) {
            this.fillAppendedTables(this.currentTables);
        }
        this.closeModal();
    }

    // 방금 apply()로 추가된 표들(문서 맨 끝 N개, N = 이번 응답의 표 개수)의
    // 빈 th/td에 실제 헤더/데이터를 채운다.
    fillAppendedTables(tables) {
        const allTables = Array.from(this.editor.editor.querySelectorAll('table'));
        const start = Math.max(0, allTables.length - tables.length);
        tables.forEach((t, i) => {
            const table = allTables[start + i];
            if (!table) return;
            const ths = table.querySelectorAll('thead th');
            t.headers.forEach((h, c) => { if (ths[c]) ths[c].textContent = h; });
            const trs = table.querySelectorAll('tbody tr');
            t.rows.forEach((row, r) => {
                const tr = trs[r];
                if (!tr) return;
                row.forEach((cell, c) => { if (tr.children[c]) tr.children[c].textContent = cell; });
            });
        });
    }

    async runRearrange(instruction, body, footer) {
        this.isProcessing = true;
        footer.querySelectorAll('.t2-aic-btn').forEach(b => b.disabled = true);

        this.rearrangeTurns.push({ role: 'user', text: instruction });
        const turn = { role: 'assistant', status: 'loading', toolCalls: null, toolStatus: null, reasoning: null, instruction };
        this.rearrangeTurns.push(turn);
        this.renderRearrangeStream(body);

        try {
            const beforeDsl = this.readDocumentDSL();
            if (String(beforeDsl ?? '').length > this.safePositiveInt(this.maxDocumentChars, 12000)) {
                throw new Error('문서가 너무 길어 한 번에 재구성할 수 없습니다. 일부를 줄인 뒤 다시 시도해주세요.');
            }

            const { dsl: afterDsl, tables, reasoning: finalReasoning } = await this.callRearrangeApi({
                instruction,
                document: beforeDsl,
                focus: this.getFocusHintText() || null,
                onToolRound: (round, maxRounds, pendingToolCalls, reasoning) => {
                    turn.toolCalls = this.mergeToolCalls(turn.toolCalls, pendingToolCalls);
                    if (!turn.toolStatus) turn.toolStatus = new Map();
                    if (reasoning) turn.reasoning = reasoning;
                    this.renderRearrangeStream(body);
                },
                onToolCallDone: (call, result) => {
                    if (!turn.toolStatus) turn.toolStatus = new Map();
                    turn.toolStatus.set(call.call_id, result.ok ? 'ok' : 'error');
                    this.renderRearrangeStream(body);
                },
            });
            this.pendingBeforeDsl = beforeDsl;
            this.pendingAfterDsl = afterDsl;
            this.pendingAfterTables = tables;

            turn.status = 'ready';
            turn.beforeDsl = beforeDsl;
            turn.afterDsl = afterDsl;
            turn.provider = this.lastUsedProvider;
            turn.model = this.lastUsedModel;
            if (finalReasoning) turn.reasoning = finalReasoning;
            this.renderRearrangeStream(body);
            this.refreshStatusBar();
        } catch (err) {
            turn.status = 'error';
            turn.error = (err && err.message) ? err.message : String(err);
            this.renderRearrangeStream(body);
        } finally {
            this.isProcessing = false;
            footer.querySelectorAll('.t2-aic-btn').forEach(b => b.disabled = false);
        }
    }

    async applyRearranged() {
        if (!this.pendingAfterDsl) return;
        await this.applyDSL(this.pendingAfterDsl, 'replace');
        const lastTurn = this.rearrangeTurns[this.rearrangeTurns.length - 1];
        if (lastTurn && lastTurn.role === 'assistant' && lastTurn.status === 'ready') lastTurn.status = 'applied';
        // replace 모드는 문서를 완전히 비우고 새로 채우므로, 표는 항상 처음(0번)부터
        // 순서대로 대응한다(append 모드처럼 "끝에서부터 N개"를 셀 필요 없음).
        if (this.pendingAfterTables && this.pendingAfterTables.length) {
            this.fillAllTables(this.pendingAfterTables);
        }
        this.closeModal();
    }

    fillAllTables(tables) {
        const allTables = Array.from(this.editor.editor.querySelectorAll('table'));
        tables.forEach((t, i) => {
            const table = allTables[i];
            if (!table) return;
            const ths = table.querySelectorAll('thead th');
            t.headers.forEach((h, c) => { if (ths[c]) ths[c].textContent = h; });
            const trs = table.querySelectorAll('tbody tr');
            t.rows.forEach((row, r) => {
                const tr = trs[r];
                if (!tr) return;
                row.forEach((cell, c) => { if (tr.children[c]) tr.children[c].textContent = cell; });
            });
        });
    }

    appendResultActions(footer, actions) {
        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `t2-aic-btn t2-aic-btn-${a.cls}`;
            btn.innerHTML = `<span class="material-icons" aria-hidden="true">${this.escapeHtml(a.icon)}</span><span>${this.escapeHtml(a.label)}</span>`;
            btn.addEventListener('click', a.onClick);
            footer.insertBefore(btn, footer.firstChild);
        });
    }

    renderErrorBox(container, err) {
        const message = (err && err.message) ? err.message : String(err);
        this.setSafeUIHTML(container, `
            <div class="t2-aic-error-box">
                <span class="material-icons" aria-hidden="true">error_outline</span>
                <div><strong>요청을 완료하지 못했습니다</strong><div style="margin-top:4px;">${this.escapeHtml(message)}</div></div>
            </div>
        `);
    }

    // 통합 인터랙션 API 단일 호출. 응답은 (A) 최종 choices[0].message.content 또는
    // (B) _pending_tool_calls가 채워진 도구 요청 중 하나다. content 추출/에러 처리는
    // 상위 callInteractionApi()의 루프가 담당한다.
    async postInteraction(licenseToken, text, mode, extra = {}) {
        const body = { text, mode };
        // phase가 'internal'일 때만 실어 보낸다 — 기본값('user')은
        // 서버 쪽 기본 동작과 동일하므로 굳이 매 요청에 얹지 않는다.
        if (extra.phase === 'internal') body.phase = 'internal';
        if (mode === 'rearrange') {
            body.document = extra.document || '';
            if (extra.focus) body.focus = extra.focus;
        }
        if (mode === 'chat') {
            if (extra.history && extra.history.length) body.history = extra.history;
            if (extra.toolCatalog && extra.toolCatalog.length) body.tool_catalog = extra.toolCatalog;
            if (extra.documentExcerpt) body.document_excerpt = extra.documentExcerpt;
        }
        if (extra.clientTools && extra.clientTools.length) body.client_tools = extra.clientTools;
        if (extra.toolResults && extra.toolResults.length) body.tool_results = extra.toolResults;
        if (extra.continuation) body.continuation = extra.continuation;

        const bodyText = JSON.stringify(body);
        const headers = await this.buildSignedHeaders(licenseToken, text);
        const response = await fetch(this.apiUrl, { method: 'POST', headers, body: bodyText, signal: extra.signal });
        const data = await response.json().catch(() => ({}));

        if (data._rate_limit) {
            this.rateLimit.ip.remaining = data._rate_limit.ip.remaining;
            this.rateLimit.domain.remaining = data._rate_limit.domain.remaining;
        }

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error(data.code === 'IP_RATE_LIMIT'
                    ? `오늘의 요청 한도(${data.limit}회)를 초과했습니다. ${data.reset_at}에 초기화됩니다.`
                    : `서버의 요청 한도(${data.limit}회)를 초과했습니다. ${data.reset_at}에 초기화됩니다.`);
            }
            if (response.status === 403 && data.code === 'INVALID_LICENSE') {
                throw new Error(data.message || '정품 T2Editor에서만 사용할 수 있는 기능입니다.');
            }
            if (response.status === 413 && data.code === 'DOCUMENT_TOO_LONG') {
                throw new Error(data.error || '문서가 너무 길어 재구성할 수 없습니다.');
            }
            if (response.status === 502 && data.code === 'INVALID_DSL_RESPONSE') {
                throw new Error('AI가 올바른 형식으로 응답하지 않았습니다. 다시 시도해주세요.');
            }
            if (response.status === 400 && (data.code === 'INVALID_CONTINUATION' || data.code === 'CONTINUATION_MODE_MISMATCH' || data.code === 'MISSING_TOOL_RESULTS')) {
                throw new Error(data.error || '도구 실행 결과를 이어붙이는 데 실패했습니다. 처음부터 다시 시도해주세요.');
            }
            throw new Error(data.error || `요청이 실패했습니다. (HTTP ${response.status})`);
        }

        return data;
    }

    // 청크 스트리밍(SSE) — 서버가 완성되는 즉시 이벤트로 흘려보내 실시간 타이핑처럼 보이게 한다.
    //   chunk: {index,text,provider,model} — 그대로 이어붙이면 됨
    //   done : {_final_content,...} — 스트리밍 중 이어붙인 텍스트를 이 값으로 최종 교체해야 함
    //   error: {error,detail,partial} — partial엔 지금까지 생성된 내용이 담겨 있음
    async postInteractionStream(licenseToken, text, mode, extra = {}, onChunk = null) {
        const body = { text, mode, stream: true };
        // 비-스트리밍 경로(postInteraction)와 동일하게, 내부에서
        // 구성한 지시문/초안 에코 호출임을 표시한다.
        if (extra.phase === 'internal') body.phase = 'internal';
        if (extra.clientTools && extra.clientTools.length) body.client_tools = extra.clientTools;
        // rearrange 스트리밍도 비-스트리밍 postInteraction()과 동일하게 document/focus를 실어야
        // 한다(빠뜨리면 서버가 빈 문서로 재구성을 시도함).
        if (mode === 'rearrange') {
            body.document = extra.document || '';
            if (extra.focus) body.focus = extra.focus;
        }
        if (mode === 'chat') {
            if (extra.history && extra.history.length) body.history = extra.history;
            if (extra.toolCatalog && extra.toolCatalog.length) body.tool_catalog = extra.toolCatalog;
            if (extra.documentExcerpt) body.document_excerpt = extra.documentExcerpt;
        }

        const bodyText = JSON.stringify(body);
        const headers = await this.buildSignedHeaders(licenseToken, text);
        const response = await fetch(this.apiUrl, { method: 'POST', headers, body: bodyText, signal: extra.signal });

        if (!response.ok || !response.body) {
            // 서버가 스트리밍을 못 태워주는 상황(구버전 서버, 프록시 버퍼링 등) —
            // 호출부가 이 예외를 잡아 기존 postInteraction() 경로로 폴백하면 된다.
            let data = {};
            try { data = await response.json(); } catch (_) { /* 본문이 JSON이 아닐 수 있음 */ }
            const err = new Error(data.error || `스트리밍 요청이 실패했습니다. (HTTP ${response.status})`);
            err.fallbackToNonStream = true;
            throw err;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let accumulated = '';
        let donePayload = null;
        let errorPayload = null;

        const handleEvent = (eventName, dataStr) => {
            let payload;
            try { payload = JSON.parse(dataStr); } catch (_) { return; }

            if (eventName === 'ready') {
                return;
            }
            if (eventName === 'chunk') {
                accumulated += (accumulated ? '\n' : '') + (payload.text || '');
                if (typeof onChunk === 'function') {
                    try { onChunk(payload.text || '', payload); } catch (e) { console.warn('[T2Ai_complex] onChunk 콜백 오류', e); }
                }
            } else if (eventName === 'done') {
                donePayload = payload;
            } else if (eventName === 'error') {
                errorPayload = payload;
            }
        };

        // 서버는 대기 중에도 SSE keep-alive를 주기적으로 보내므로, reader.read()가 그 바이트를
        // 받을 때마다 stallTimer가 리셋된다 — "서버가 살아있음"과 "진짜 멈춤"을 구분하는 효과.
        const STALL_TIMEOUT_MS = 60000;
        try {
            while (true) {
                // stallTimer는 항상 reject만 하므로, reader.read()가 먼저 끝나지
                // 않으면 Promise.race 전체가 실패해 아래 catch(streamErr)로 간다.
                const stallTimer = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('stream_stalled')), STALL_TIMEOUT_MS);
                });
                const { value, done } = await Promise.race([reader.read(), stallTimer]);
                if (done) break;
                buf += decoder.decode(value, { stream: true });

                // SSE 프레임은 빈 줄(\n\n)로 구분된다. ':'로 시작하는 줄은
                // keep-alive comment이므로 event/data가 없어 그냥 버려진다.
                let sep;
                while ((sep = buf.indexOf('\n\n')) !== -1) {
                    const frame = buf.slice(0, sep);
                    buf = buf.slice(sep + 2);

                    let eventName = 'message';
                    let dataStr = '';
                    frame.split('\n').forEach(line => {
                        if (line.startsWith('event:')) eventName = line.slice(6).trim();
                        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
                    });
                    if (dataStr) handleEvent(eventName, dataStr);
                }
            }
        } catch (streamErr) {
            try { reader.cancel(); } catch (_) { /* 이미 끊긴 연결이면 무시 */ }
            const isStall = streamErr && streamErr.message === 'stream_stalled';
            const err = new Error(isStall
                ? '응답이 지연되어 스트리밍을 중단했습니다. (Upstream stalled)'
                : `스트리밍 연결이 끊겼습니다. (Upstream failed: ${streamErr && streamErr.message ? streamErr.message : 'network error'})`);
            // 지금까지 이미 화면에 이어붙여 보여준 내용을 그대로 살려서 던진다 —
            // 호출부가 "여기까지 생성됨"으로 이어갈 수 있도록.
            err.partial = accumulated;
            err.streamReadFailure = true;
            throw err;
        }

        if (errorPayload) {
            const err = new Error(errorPayload.detail ? `Upstream failed: ${errorPayload.detail}` : (errorPayload.error || 'Upstream failed'));
            err.partial = errorPayload.partial || accumulated;
            err.tried = errorPayload.tried || [];
            throw err;
        }

        if (!donePayload) {
            // 연결이 끊기는 등 done 이벤트를 못 받은 경우 — 지금까지 모은 것을 부분 실패로 취급.
            const err = new Error('스트리밍 응답이 완료되지 않았습니다.');
            err.partial = accumulated;
            throw err;
        }

        return { ...donePayload, _streamed_raw: accumulated };
    }

    async callInteractionApi(text, opts = {}) {
        const licenseToken = window.T2EDITOR_LICENSE_TOKEN;
        if (!licenseToken) {
            throw new Error('정품 T2Editor에서만 사용할 수 있는 기능입니다.');
        }

        const mode = opts.mode === 'rearrange' ? 'rearrange' : (opts.mode === 'chat' ? 'chat' : 'generate');
        const clientTools = this.getClientToolsPayload(mode === 'rearrange' ? 'rearrange' : 'generate');

        const extraFields = {
            document: opts.document,
            focus: opts.focus,
            clientTools,
            history: opts.history,
            toolCatalog: opts.toolCatalog,
            documentExcerpt: opts.documentExcerpt,
            signal: opts.signal,
            phase: opts.phase === 'internal' ? 'internal' : 'user',
        };

        // 스트리밍은 opts.stream이 켜져 있고 generate/chat 모드이면서 도구 왕복이 없을 때만 시도한다.
        // 서버가 스트리밍을 못 태우면 조용히 기존 비-스트리밍 경로로 폴백한다.
        if (opts.stream && (mode === 'generate' || mode === 'chat' || mode === 'rearrange') && (!clientTools || !clientTools.length)) {
            try {
                const streamed = await this.postInteractionStream(licenseToken, text, mode, extraFields, (pieceText, meta) => {
                    if (typeof opts.onStreamChunk === 'function') {
                        try { opts.onStreamChunk(pieceText, meta); } catch (e) { console.warn('[T2Ai_complex] onStreamChunk 콜백 오류', e); }
                    }
                });

                this.lastUsedProvider = streamed._used_provider || this.lastUsedProvider || null;
                this.lastUsedModel = streamed._used_model || this.lastUsedModel || null;

                return {
                    content: streamed._final_content || streamed._streamed_raw || '',
                    tokenInfo: streamed._token_info || null,
                    usedProvider: this.lastUsedProvider,
                    usedModel: this.lastUsedModel,
                    editProposal: mode === 'chat' ? (streamed._edit_proposal || null) : undefined,
                    reasoning: null,
                    streamed: true,
                    chunks: streamed._chunks || 0,
                    truncated: !!streamed._truncated,
                };
            } catch (err) {
                const isAborted = !!(opts.signal && opts.signal.aborted);
                const hasMeaningfulPartial = !!(err.partial && err.partial.trim().length >= 20);

                if (err.fallbackToNonStream) {
                    // 구버전 서버 등, 스트리밍 자체를 못 태워준 경우 — 조용히
                    // 아래 기존 비-스트리밍 경로로 계속 진행한다.
                } else if (!isAborted && !hasMeaningfulPartial) {
                    // 스트리밍이 심하게 실패한 아주 드문 경우, 화면에 보여준 내용이 거의 없다면
                    // 완전한 에러 대신 비-스트리밍 경로로 조용히 한 번만 재시도한다.
                    console.warn('[T2Ai_complex] 스트리밍 실패, 비-스트리밍 경로로 1회 재시도:', err.message);
                } else {
                    // 이미 의미 있는 내용을 보여준 뒤라면 처음부터 다시 요청하지 않고,
                    // "여기까지 생성됨" 에러로 partial을 실어 그대로 던진다.
                    err.streamedPartial = true;
                    throw err;
                }
            }
        }

        let data = await this.postInteraction(licenseToken, text, mode, extraFields);

        // 서버의 왕복 한도와는 별개로 클라이언트에도 안전장치로 상한을 하나 둔다
        // (손상된 continuation을 계속 돌려받아도 무한 루프에 빠지지 않도록).
        const CLIENT_SIDE_ROUND_GUARD = 10;
        let guard = 0;

        while (data && Array.isArray(data._pending_tool_calls) && data._pending_tool_calls.length && guard < CLIENT_SIDE_ROUND_GUARD) {
            guard++;
            if (data._used_provider) this.lastUsedProvider = data._used_provider;
            if (data._used_model) this.lastUsedModel = data._used_model;

            if (typeof opts.onToolRound === 'function') {
                try {
                    opts.onToolRound(data._round || guard, data._max_rounds || null, data._pending_tool_calls, data._reasoning || null);
                } catch (err) {
                    console.warn('[T2Ai_complex] onToolRound 콜백 오류', err);
                }
            }

            const toolResults = await this.executeClientToolCalls(data._pending_tool_calls, {
                onCallStart: opts.onToolCallStart,
                onCallDone: opts.onToolCallDone,
            });

            data = await this.postInteraction(licenseToken, text, mode, {
                ...extraFields,
                toolResults,
                continuation: data._continuation,
            });
        }

        let content = '';
        if (data.choices && data.choices[0] && data.choices[0].message) content = data.choices[0].message.content || '';
        else if (typeof data.response === 'string') content = data.response;
        else if (typeof data.text === 'string') content = data.text;
        if (!content && mode !== 'chat') throw new Error('AI 응답 형식을 인식할 수 없습니다.');

        // 이번 요청에 실제로 사용된 모델 — 결과 화면에 즉시 표시할 수 있도록 저장.
        this.lastUsedProvider = data._used_provider || this.lastUsedProvider || null;
        this.lastUsedModel = data._used_model || this.lastUsedModel || null;

        return {
            content,
            tokenInfo: data._token_info || null,
            usedProvider: this.lastUsedProvider,
            usedModel: this.lastUsedModel,
            editProposal: mode === 'chat' ? (data._edit_proposal || null) : undefined,
            // 서버가 지원할 때만 채워지는 사고 내용 — 지원하지
            // 않으면 그냥 undefined라서 화면에 아무 영향이 없다(기존과 동일).
            reasoning: (typeof data._reasoning === 'string' && data._reasoning.trim()) ? data._reasoning.trim() : null,
        };
    }

    async callRearrangeApi({ instruction, document, focus, onToolRound, onToolCallDone }) {
        // rearrange도 스트리밍 경로를 타지만, 문서 전체 교체 전 사용자 승인이 필요하므로
        // 중간 청크를 에디터에 미리 반영하지는 않는다(keep-alive/부분 실패 방지 목적만).
        const raw = await this.callInteractionApi(instruction, {
            mode: 'rearrange',
            stream: true,
            document,
            focus,
            onToolRound,
            onToolCallDone,
        });
        return { ...this.extractTableRowsFromDsl(raw.content), reasoning: raw.reasoning || null };
    }

    // "TABLE: cols|rows|width|border" 바로 뒤에 이어지는 "TROW: 셀,셀,셀" 라인들을
    // 뽑아내고, 표준 T2LLM DSL(TABLE 라인만 남긴 것)과 표 내용 배열을 함께 반환한다.
    extractTableRowsFromDsl(dsl) {
        const lines = String(dsl ?? '').replace(/\r\n/g, '\n').split('\n');
        const outLines = [];
        const tables = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const tableMatch = line.trim().match(/^TABLE\s*:\s*(.*)$/);
            if (!tableMatch) { outLines.push(line); i++; continue; }

            outLines.push(line);
            i++;
            const rows = [];
            while (i < lines.length) {
                const rowMatch = lines[i].trim().match(/^TROW\s*:\s*(.*)$/);
                if (!rowMatch) break;
                rows.push(rowMatch[1].split(',').map(c => c.trim()));
                i++;
            }
            const headers = rows.length ? rows[0] : [];
            const dataRows = rows.length ? rows.slice(1) : [];
            tables.push({ headers, rows: dataRows });
        }
        return { dsl: outLines.join('\n'), tables };
    }

    // 브라켓 태그 응답 → T2LLM DSL 변환. 인터랙션 API는 [bold]/[link]/[table]/[img] 등
    // 자체 브라켓 문법을 돌려주는데, T2LLM DSL은 문법이 달라 여기서 다리를 놓는다
    // (표는 예외로 셀 내용을 별도로 들고 있다가 apply() 후 채운다).
    convertBracketResponseToDsl(text) {
        let working = String(text ?? '').replace(/\r\n/g, '\n');
        const tables = [];
        const codes = [];

        working = working.replace(/\[table\]([\s\S]*?)\[\/table\]/gi, (_, rawBody) => {
            const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);
            const headers = lines.length ? lines[0].split(',').map(s => s.trim()) : [];
            const rows = lines.slice(1).map(l => l.split(',').map(s => s.trim()));
            const idx = tables.push({ headers, rows }) - 1;
            return `\nTABLE_PLACEHOLDER_${idx}\n`;
        });

        working = working.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, rawBody) => {
            const idx = codes.push(rawBody.replace(/^\n+|\n+$/g, '')) - 1;
            return `\nCODE_PLACEHOLDER_${idx}\n`;
        });

        working = working.replace(/\[img\]([^\[]+)\[\/img\]/gi, (_, url) => `\nIMG_PLACEHOLDER_${url.trim()}\n`);

        const dslLines = [];
        working.split('\n').forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) return;

            const tableMatch = line.match(/^TABLE_PLACEHOLDER_(\d+)$/);
            if (tableMatch) {
                const t = tables[Number(tableMatch[1])];
                const cols = t.headers.length || (t.rows[0] ? t.rows[0].length : 3);
                dslLines.push(`TABLE: ${cols}|${1 + t.rows.length}|100%|solid`);
                return;
            }
            const codeMatch = line.match(/^CODE_PLACEHOLDER_(\d+)$/);
            if (codeMatch) {
                dslLines.push('```', codes[Number(codeMatch[1])], '```');
                return;
            }
            const imgMatch = line.match(/^IMG_PLACEHOLDER_(.+)$/);
            if (imgMatch) { dslLines.push(`IMG: ${imgMatch[1]}`); return; }

            dslLines.push(`P: ${this.convertInlineTags(line)}`);
        });

        return { dsl: dslLines.join('\n'), tables };
    }

    // 브라켓 인라인 태그 → T2LLM 인라인 마크업(마크다운과 거의 동일)
    convertInlineTags(line) {
        let s = line;
        s = s.replace(/\[link:([^\]]*)\]([^\[]*)\[\/link\]/gi, (_, txt, url) => `[${txt.trim() || url.trim()}](${url.trim()})`);
        s = s.replace(/\[tcolor:(#[0-9A-Fa-f]{6})\]([\s\S]*?)\[\/tcolor\]/gi, (_, hex, t) => `{c:${hex}}${t}{/c}`);
        s = s.replace(/\[bold\]([\s\S]*?)\[\/bold\]/gi, (_, t) => `**${t}**`);
        s = s.replace(/\[italic\]([\s\S]*?)\[\/italic\]/gi, (_, t) => `*${t}*`);
        s = s.replace(/\[underlined\]([\s\S]*?)\[\/underlined\]/gi, (_, t) => `++${t}++`);
        s = s.replace(/\[strikethrough\]([\s\S]*?)\[\/strikethrough\]/gi, (_, t) => `~~${t}~~`);
        return s;
    }

    parseDslLines(dsl) {
        const lines = String(dsl ?? '').replace(/\r\n/g, '\n').split('\n');
        const blocks = [];
        let i = 0;
        while (i < lines.length) {
            const trimmed = lines[i].trim();
            if (!trimmed) { i++; continue; }
            const fence = trimmed.match(/^```(\w*)$/);
            if (fence) {
                const lang = fence[1] || '';
                const body = [];
                i++;
                while (i < lines.length && lines[i].trim() !== '```') { body.push(lines[i]); i++; }
                i++;
                blocks.push({ tag: lang.toLowerCase() === 'svg' ? 'DRAW' : 'CODE', arg: lang, body: body.join('\n') });
                continue;
            }
            const m = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/);
            blocks.push(m ? { tag: m[1], arg: m[2] } : { tag: 'P', arg: trimmed });
            i++;
        }
        return blocks;
    }

    dslTagIcon(tag) {
        const map = {
            P: 'notes', H1: 'title', H2: 'title', H3: 'title', H4: 'title', H5: 'title', H6: 'title',
            IMG: 'image', VIDEO: 'smart_display', LINK: 'link', CLIPURL: 'link', FILE: 'attach_file',
            MEME: 'sentiment_satisfied_alt', TABLE: 'table_chart', CODE: 'code', DRAW: 'brush'
        };
        return map[tag] || 'article';
    }

    // 미리보기 전용 — bold/italic/strike/underline/code/link 정도만 가볍게 표현.
    // T2LLM.apply()가 실제 삽입 시 정식으로 다시 컴파일하므로 완전할 필요 없음.
    previewInline(text) {
        let s = this.escapeHtml(text);
        s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
        s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
        s = s.replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>');
        return s;
    }

    renderDslPreview(dsl, container, tables) {
        const blocks = this.parseDslLines(dsl);
        if (!blocks.length) {
            this.setSafeUIHTML(container, `<div class="t2-aic-error-box"><span class="material-icons">info</span><div>생성된 내용이 없습니다.</div></div>`);
            return;
        }
        const tableQueue = Array.isArray(tables) ? tables.slice() : null;
        const cards = blocks.map(b => {
            let bodyHtml;
            if (b.tag === 'CODE') bodyHtml = `<div class="t2-aic-dsl-meta">코드 (${this.escapeHtml(b.arg || 'plaintext')})</div><pre>${this.escapeHtml(b.body || '')}</pre>`;
            else if (b.tag === 'DRAW') bodyHtml = `<div class="t2-aic-dsl-meta">그림(SVG)</div><pre>${this.escapeHtml((b.body || b.arg || '').slice(0, 200))}</pre>`;
            else if (b.tag === 'TABLE') {
                const t = tableQueue && tableQueue.length ? tableQueue.shift() : null;
                bodyHtml = t
                    ? `<div class="t2-aic-dsl-meta">표</div>${this.escapeHtml(t.headers.join(' | '))}${t.rows.map(r => '<br>' + this.escapeHtml(r.join(' | '))).join('')}`
                    : `표 삽입 — ${this.escapeHtml(b.arg)}`;
            }
            else if (['IMG', 'VIDEO', 'FILE', 'MEME', 'CLIPURL'].includes(b.tag)) bodyHtml = this.escapeHtml(b.arg);
            else bodyHtml = this.previewInline(b.arg);

            return `
                <div class="t2-aic-dsl-card">
                    <div class="t2-aic-dsl-tag"><span class="material-icons" aria-hidden="true">${this.dslTagIcon(b.tag)}</span></div>
                    <div class="t2-aic-dsl-body">${bodyHtml}</div>
                </div>
            `;
        }).join('');

        this.setSafeUIHTML(container, `<div class="t2-aic-dsl-preview">${cards}</div>`);
    }

    normalizeDiffLines(value) {
        const text = String(value ?? '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        return text.length > 0 ? text.split('\n') : [];
    }

    buildLineDiffOperations(beforeLines, afterLines) {
        const rows = beforeLines.length + 1, cols = afterLines.length + 1;
        const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
        for (let i = beforeLines.length - 1; i >= 0; i--) {
            for (let j = afterLines.length - 1; j >= 0; j--) {
                dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = [];
        let i = 0, j = 0;
        while (i < beforeLines.length && j < afterLines.length) {
            if (beforeLines[i] === afterLines[j]) { ops.push({ type: 'equal', beforeLine: i + 1, afterLine: j + 1, text: beforeLines[i] }); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'remove', beforeLine: i + 1, text: beforeLines[i] }); i++; }
            else { ops.push({ type: 'add', afterLine: j + 1, text: afterLines[j] }); j++; }
        }
        while (i < beforeLines.length) ops.push({ type: 'remove', beforeLine: ++i, text: beforeLines[i - 1] });
        while (j < afterLines.length) ops.push({ type: 'add', afterLine: ++j, text: afterLines[j - 1] });
        return ops;
    }

    buildSplitDiffPairs(beforeLines, afterLines) {
        if (beforeLines.length * afterLines.length > 40000) {
            return [{ type: 'modified', beforeLine: beforeLines.length ? 1 : null, afterLine: afterLines.length ? 1 : null, beforeText: beforeLines.join('\n'), afterText: afterLines.join('\n') }];
        }
        const ops = this.buildLineDiffOperations(beforeLines, afterLines);
        const rows = [];
        for (let i = 0; i < ops.length;) {
            const op = ops[i];
            if (op.type === 'equal') { rows.push({ type: 'context', beforeLine: op.beforeLine, afterLine: op.afterLine, beforeText: op.text, afterText: op.text }); i++; continue; }
            const removed = [], added = [];
            while (i < ops.length && ops[i].type !== 'equal') { (ops[i].type === 'remove' ? removed : added).push(ops[i]); i++; }
            const max = Math.max(removed.length, added.length);
            for (let r = 0; r < max; r++) {
                const b = removed[r] || null, a = added[r] || null;
                if (b && a) rows.push({ type: 'modified', beforeLine: b.beforeLine, afterLine: a.afterLine, beforeText: b.text, afterText: a.text });
                else if (b) rows.push({ type: 'removed', beforeLine: b.beforeLine, afterLine: null, beforeText: b.text, afterText: '' });
                else if (a) rows.push({ type: 'added', beforeLine: null, afterLine: a.afterLine, beforeText: '', afterText: a.text });
            }
        }
        return rows;
    }

    tokenizeReviewText(text) { return String(text || '').split(/(\s+)/).filter(t => t.length > 0); }

    wrapDiffTokens(tokens, cls) {
        return tokens.map(t => /^\s+$/.test(t) ? this.escapeHtml(t) : `<span class="t2-ai-diff-token ${cls}">${this.escapeHtml(t)}</span>`).join('');
    }

    buildTokenDiffHTML(beforeTokens, afterTokens) {
        const rows = beforeTokens.length + 1, cols = afterTokens.length + 1;
        const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
        for (let i = beforeTokens.length - 1; i >= 0; i--)
            for (let j = afterTokens.length - 1; j >= 0; j--)
                dp[i][j] = beforeTokens[i] === afterTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

        const beforeParts = [], afterParts = [];
        let i = 0, j = 0;
        while (i < beforeTokens.length && j < afterTokens.length) {
            if (beforeTokens[i] === afterTokens[j]) { const s = this.escapeHtml(beforeTokens[i]); beforeParts.push(s); afterParts.push(s); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { const t = beforeTokens[i++]; beforeParts.push(/^\s+$/.test(t) ? this.escapeHtml(t) : `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(t)}</span>`); }
            else { const t = afterTokens[j++]; afterParts.push(/^\s+$/.test(t) ? this.escapeHtml(t) : `<span class="t2-ai-diff-token is-added">${this.escapeHtml(t)}</span>`); }
        }
        while (i < beforeTokens.length) { const t = beforeTokens[i++]; beforeParts.push(/^\s+$/.test(t) ? this.escapeHtml(t) : `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(t)}</span>`); }
        while (j < afterTokens.length) { const t = afterTokens[j++]; afterParts.push(/^\s+$/.test(t) ? this.escapeHtml(t) : `<span class="t2-ai-diff-token is-added">${this.escapeHtml(t)}</span>`); }

        return {
            before: beforeParts.join('') || '<span class="t2-ai-diff-empty">(내용 없음)</span>',
            after: afterParts.join('') || '<span class="t2-ai-diff-empty">(내용 없음)</span>'
        };
    }

    getDiffLineTextHTML(value) {
        const text = String(value ?? '');
        return text.length > 0 ? this.escapeHtml(text) : '<span class="t2-ai-diff-blank-line">&nbsp;</span>';
    }

    getInlineLineDiffHTML(beforeLine, afterLine) {
        const before = String(beforeLine ?? ''), after = String(afterLine ?? '');
        if (before === after) { const s = this.getDiffLineTextHTML(before); return { before: s, after: s }; }
        const bt = this.tokenizeReviewText(before), at = this.tokenizeReviewText(after);
        if (bt.length === 0) return { before: '<span class="t2-ai-diff-blank-line">&nbsp;</span>', after: this.wrapDiffTokens(at, 'is-added') };
        if (at.length === 0) return { before: this.wrapDiffTokens(bt, 'is-removed'), after: '<span class="t2-ai-diff-blank-line">&nbsp;</span>' };
        if (bt.length * at.length > 90000) return { before: `<span class="t2-ai-diff-token is-removed">${this.escapeHtml(before)}</span>`, after: `<span class="t2-ai-diff-token is-added">${this.escapeHtml(after)}</span>` };
        return this.buildTokenDiffHTML(bt, at);
    }

    getSplitDiffRowHTML(row) {
        let beforeCls = 'is-context', afterCls = 'is-context';
        let beforeHtml = this.getDiffLineTextHTML(row.beforeText), afterHtml = this.getDiffLineTextHTML(row.afterText);

        if (row.type === 'modified') {
            const inline = this.getInlineLineDiffHTML(row.beforeText, row.afterText);
            beforeCls = 'is-removed'; afterCls = 'is-added';
            beforeHtml = inline.before; afterHtml = inline.after;
        } else if (row.type === 'removed') { beforeCls = 'is-removed'; afterCls = 'is-empty'; afterHtml = ''; }
        else if (row.type === 'added') { beforeCls = 'is-empty'; afterCls = 'is-added'; beforeHtml = ''; }

        return `
            <div class="t2-aic-diff-row">
                <div class="t2-aic-diff-linenum">${row.beforeLine ? this.escapeHtml(row.beforeLine) : ''}</div>
                <div class="t2-aic-diff-cell ${beforeCls}">${beforeHtml}</div>
                <div class="t2-aic-diff-linenum">${row.afterLine ? this.escapeHtml(row.afterLine) : ''}</div>
                <div class="t2-aic-diff-cell ${afterCls}">${afterHtml}</div>
            </div>
        `;
    }

    renderSplitDiff(beforeDsl, afterDsl, container) {
        const beforeLines = this.normalizeDiffLines(beforeDsl);
        const afterLines = this.normalizeDiffLines(afterDsl);
        const rows = this.buildSplitDiffPairs(beforeLines, afterLines);
        const rowsHtml = rows.map(r => this.getSplitDiffRowHTML(r)).join('');

        this.setSafeUIHTML(container, `
            <div class="t2-aic-diff-shell">
                <div class="t2-aic-diff-head"><div>#</div><div>변경 전</div><div>#</div><div>변경 후</div></div>
                ${rowsHtml}
            </div>
        `);
    }

    getStatusCaptionHTML() {
        const warn = this.getRateLimitWarning();
        return `
            <button type="button" class="t2-aic-status-caption${warn ? ' is-warning' : ''}">
                ${warn ? `<span class="material-icons" aria-hidden="true">error_outline</span><span class="t2-aic-status-caption-text">${this.escapeHtml(warn)}</span>` : `<span class="t2-aic-status-caption-text">T2Editor AI는 실수할 수 있어요</span>`}
            </button>
        `;
    }

    renderStatusBar(statusBar) {
        if (!statusBar) return;
        this.setSafeUIHTML(statusBar, this.getStatusCaptionHTML());
        statusBar.querySelector('.t2-aic-status-caption').addEventListener('click', () => this.openDisclaimerPopup());
    }

    // 두 한도(IP/서버) 중 하나라도 20% 미만 남았으면 그 사실을 문장으로
    // 반환한다 — 평소엔 null이라 캡션이 조용한 기본 문구로 남는다.
    getRateLimitWarning() {
        const ip = this.rateLimit.ip, domain = this.rateLimit.domain;
        const ipLow = ip.limit > 0 && ip.remaining <= Math.max(1, ip.limit * 0.2);
        const domainLow = domain.limit > 0 && domain.remaining <= Math.max(1, domain.limit * 0.2);
        if (ipLow && ip.remaining <= domain.remaining) return `남은 요청이 ${this.safeCounterValue(ip.remaining)}개예요`;
        if (domainLow) return `서버 요청 한도가 얼마 남지 않았어요 (${this.safeCounterValue(domain.remaining)}개)`;
        if (ipLow) return `남은 요청이 ${this.safeCounterValue(ip.remaining)}개예요`;
        return null;
    }

    refreshStatusBar() {
        if (this.statusBar) this.renderStatusBar(this.statusBar);
        // 채팅 모드에서는 안내 문구가 footer 행 안에 있으므로 거기도 갱신.
        if (this.mode === 'chat' && this.footerEl) {
            const cap = this.footerEl.querySelector('.t2-aic-status-caption');
            if (cap) cap.outerHTML = this.getStatusCaptionHTML();
            const newCap = this.footerEl.querySelector('.t2-aic-status-caption');
            if (newCap) newCap.addEventListener('click', () => this.openDisclaimerPopup());
        }
        if (this.mode === 'chat' && this.modal) {
            const body = this.modal.querySelector('.t2-aic-body');
            if (body) this.refreshWorkloadAvailability(body);
        }
    }

    renderModelBadge(container, provider, model) {
        if (!container) return;
        container.querySelectorAll('.t2-aic-model-badge').forEach(el => el.remove());
        if (!provider && !model) return;

        const badge = document.createElement('div');
        badge.className = 't2-aic-model-badge';
        this.setSafeUIHTML(badge, `
            <span class="material-icons" aria-hidden="true">auto_awesome</span>
            <span>이 결과는 <strong>${this.escapeHtml(model || '알 수 없는 모델')}</strong>${provider ? ` (${this.escapeHtml(provider)})` : ''}(으)로 생성되었습니다</span>
        `);
        container.insertBefore(badge, container.firstChild);
    }
}

window.T2Ai_complexPlugin = T2Ai_complexPlugin;


/* T2E 브랜드 픽셀 웨이브 스피너 런타임 마운터.
   getBrandSpinnerHTML()이 내뱉는 빈 마크업에 5x7 픽셀 그리드를 채우고 대각선 웨이브
   animation-delay를 부여한다. MutationObserver 미지원 환경은 setInterval로 폴백. */
(function () {
    'use strict';

    // 5×7 도트 매트릭스 글자 패턴. '1' = 셀 켜짐.
    var GLYPHS = {
        'T': [
            '11111',
            '00100',
            '00100',
            '00100',
            '00100',
            '00100',
            '00100'
        ],
        '2': [
            '01110',
            '10001',
            '00001',
            '00010',
            '00100',
            '01000',
            '11111'
        ],
        'E': [
            '11111',
            '10000',
            '10000',
            '11110',
            '10000',
            '10000',
            '11111'
        ]
    };

    var ROWS = 7;
    var COLS = 5;
    var GAP  = 1; // 글자 사이 1 col gap

    function parseTime(str, fallback) {
        if (!str) return fallback;
        str = ('' + str).trim();
        if (str.slice(-2) === 'ms') return parseFloat(str) || fallback;
        if (str.slice(-1) === 's')  return (parseFloat(str) || fallback / 1000) * 1000;
        var n = parseFloat(str);
        return isNaN(n) ? fallback : n;
    }

    function mountOne(container) {
        if (!container || container.__t2AicBsMounted) return;
        container.__t2AicBsMounted = true;

        var chars = container.getElementsByClassName('t2-aic-bs-char');
        if (!chars || !chars.length) return;

        var styles = window.getComputedStyle(container);
        var cycleMs = parseTime(styles.getPropertyValue('--t2-bs-cycle'), 1600);
        var stepMs  = parseTime(styles.getPropertyValue('--t2-bs-step'),   55);

        for (var ci = 0; ci < chars.length; ci++) {
            var charEl = chars[ci];
            var ch = charEl.getAttribute('data-ch');
            var glyph = GLYPHS[ch];
            if (!glyph) continue;

            // 이미 도트가 박혀 있으면 스킵 (재러닝이나 부분 재사용 대응)
            if (charEl.getElementsByClassName('t2-aic-bs-dot').length > 0) continue;

            var charOffsetCol = ci * (COLS + GAP); // 전역 x 오프셋
            var frag = document.createDocumentFragment();

            for (var y = 0; y < ROWS; y++) {
                var row = glyph[y];
                for (var x = 0; x < COLS; x++) {
                    if (row.charAt(x) !== '1') continue;

                    var globalX = charOffsetCol + x;
                    // 좌하 → 우상 대각선: X 가 크거나 Y 가 작을수록 늦게 점등
                    var diag = globalX + (ROWS - 1 - y);
                    var rawDelay = diag * stepMs;
                    var delay = rawDelay % cycleMs;
                    // 음수 delay 를 쓰면 첫 프레임부터 파도 중간처럼 또럵해 보인다.
                    var negDelay = -(cycleMs - delay);

                    var dot = document.createElement('span');
                    dot.className = 't2-aic-bs-dot';
                    dot.style.left = 'calc(var(--t2-bs-cell) * ' + x + ')';
                    dot.style.top  = 'calc(var(--t2-bs-cell) * ' + y + ')';
                    dot.style.webkitAnimationDelay = negDelay + 'ms';
                    dot.style.animationDelay = negDelay + 'ms';
                    frag.appendChild(dot);
                }
            }
            charEl.appendChild(frag);
        }
    }

    function mountAll(root) {
        var scope = root || document;
        if (!scope || !scope.getElementsByClassName) return;
        var nodes = scope.getElementsByClassName('t2-aic-brand-spinner');
        // live HTMLCollection 이므로 스냅샷을 뜼고 순회
        var snap = [];
        for (var i = 0; i < nodes.length; i++) snap.push(nodes[i]);
        // scope 자체가 스피너인 경우도 처리
        if (scope.classList && scope.classList.contains && scope.classList.contains('t2-aic-brand-spinner')) {
            snap.push(scope);
        }
        for (var j = 0; j < snap.length; j++) mountOne(snap[j]);
    }

    function bootstrap() {
        try { mountAll(document); } catch (e) { /* no-op */ }

        if (typeof MutationObserver !== 'undefined') {
            try {
                var mo = new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var added = muts[i].addedNodes;
                        if (!added) continue;
                        for (var j = 0; j < added.length; j++) {
                            var n = added[j];
                            if (!n || n.nodeType !== 1) continue;
                            if (n.classList && n.classList.contains && n.classList.contains('t2-aic-brand-spinner')) {
                                mountOne(n);
                            } else if (n.getElementsByClassName) {
                                mountAll(n);
                            }
                        }
                    }
                });
                mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
                return;
            } catch (e) { /* fall through to polling */ }
        }

        // 최종 안전망: MutationObserver 가 없거나 오류를 낸 구형 환경
        setInterval(function () {
            try { mountAll(document); } catch (e) { /* no-op */ }
        }, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, false);
    } else {
        bootstrap();
    }

    // 외부에서 강제 리마운트하고 싶을 때 쓰라고 노출 (디버깅/테스트 용)
    window.__t2AicMountBrandSpinners = mountAll;
})();