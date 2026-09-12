// Path: T2Editor/extend/js/t2ai_tool_memory.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — long_memory (high-tool)
// LLM에게 "능동적이고 반영구적인 기억" 능력을 부여하는 확장 Tool 세트.
// 브라우저의 window.localStorage 를 저장소로 사용하며, 서버·DB·별도 API를
// 전혀 필요로 하지 않는다 — 순수 클라이언트 사이드 확장이다.
//
// 왜 localStorage인가
// T2Editor 자체는 상태를 갖지 않는(stateless) 에디터 조작 레이어다(t2llm.js
// 헤더 참고). 이 Tool은 그 위에 "기억"이라는 선택적 능력을 얹는다. 서버 스키마
// 변경이나 관리자 설정 없이도, 브라우저 하나만으로 즉시 동작·즉시 제거 가능해야
// 하므로 localStorage를 택했다. 브라우저가 이를 지원하지 않거나(사파일 프라이빗
// 모드 등) 사용자가 차단한 경우, 아래 storageAvailable()이 이를 감지해 해당
// 경우에 한해서만(지원하는 경우에 한하여) 조용히 비활성 응답을 반환한다 — 절대
// throw 하지 않는다.
//
// 끄는 방법
// 다른 t2ai_tool_*.js 와 완전히 동일하게, 이 파일 하나를 서버에서 지우면 그걸로
// 끝이다. 별도의 관리자 설정·DB 플래그·UI가 전혀 없다. 이미 브라우저에 저장된
// localStorage 데이터는 그대로 남지만(사용자 데이터 보존), 이 파일이 없으면
// LLM은 더 이상 그 데이터를 읽거나 쓸 방법이 없다 — 즉 "기억 기능 정지"와
// 동일한 효과.
//
// 스코프(격리) 설계
// 요청사항 주의사항: "에디터는 동일하게 로드되어도, 그 작성하는 게시판이나
// 게시글, url 등이 다를 수 있다." 따라서 기억을 전부 하나의 통에 담지 않고
// 아래 두 계층으로 분리한다.
//   - scope 'page'   (기본값) : location.pathname + location.search 기준.
//                                "이 게시글/이 글쓰기 화면"에 한정된 기억.
//   - scope 'global'           : location.hostname 기준. 사이트 전체에서
//                                재사용할 사용자 성향·문체 등 범용 기억.
//   - 그 외 임의 문자열         : LLM이 스스로 이름 붙인 커스텀 스코프
//                                (예: "series:연재제목" 처럼 여러 게시글을
//                                묶고 싶을 때).
// 자동으로 결정되는 site+path 기준 스코프는 "같은 에디터, 다른 글"을 안전하게
// 분리하기 위한 기본값일 뿐이며, 필요하면 언제든 scope 인자로 재정의한다.
//
// T2AI Tool 4종
//   memory_remember  — 새 기억 저장(또는 같은 key로 갱신)
//   memory_recall    — 기억 검색/조회
//   memory_forget     — 기억 삭제(개별 또는 스코프 전체)
//   memory_list       — 스코프 내 기억 목록 + 용량 통계
//                        (통계는 t2ai_tool_memory_compress.js 의 memory_compress
//                         호출 여부를 LLM이 스스로 판단하는 근거로 쓰인다.)
//
// t2ai_tool_memory_compress.js 는 이 파일과 동일한 localStorage 스키마를
// "데이터 계약"으로만 공유할 뿐, 이 파일의 코드를 import/참조하지 않는다
// (README_AI_TOOLS.js 규칙 2 준수 — Tool끼리는 서로 몰라야 한다).

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'long_memory'}, '[T2AI] t2ai_core.js not loaded yet — skipping long_memory registration.'));
        return;
    }

    // 저장소 스키마 (memory_compress 와 공유하는 계약)
    const NS = 't2ai_mem_v1';
    const MAX_VALUE_CHARS = 4000;      // 항목 1개당 최대 글자수 (초과분은 저장 시 절단)
    const MAX_ENTRIES_PER_SCOPE = 300; // 스코프당 최대 항목 수 (초과 시 가장 오래되고 덜 중요한 것부터 자동 정리)

    // ── 압축 권고 임계값 (LLM이 "언제 압축을 고려해야 하는지" 스스로 판단하지
    //    않아도 되게, 결정론적 숫자 기준으로 고정) ──────────────────────────────
    // 저사양(약 8B~20B급) LLM은 "용량이 꽤 쌓인 것 같다" 같은 모호한 판단보다
    // "이 숫자를 넘으면 압축을 고려하라"는 명시적 임계값 하나를 훨씬 잘 따른다.
    // 이 숫자는 memory_list 뿐 아니라 memory_remember 응답에도 매번 실어 보내
    // (아래 scopeStats 참고), LLM이 별도로 memory_list를 호출해 "확인"하는
    // 추가 추론 단계 없이도 매 저장 시점마다 자동으로 신호를 받게 한다.
    const SOFT_LIMIT_CHARS = 20000;      // 스코프 총 글자수가 이 값을 넘으면 압축 권고
    const NEAR_ENTRY_LIMIT_RATIO = 0.85; // 항목 수가 MAX_ENTRIES_PER_SCOPE의 85%를 넘어도 압축 권고

    function idxKey(scope) { return `${NS}:idx:${scope}`; }
    function itemKey(scope, id) { return `${NS}:item:${scope}:${id}`; }
    const SCOPES_KEY = `${NS}:scopes`;

    // localStorage 가용성 감지 ("지원하는 경우에 한하여")
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
        } catch (e) {
            return false; // 대개 QuotaExceededError — 호출부에서 정리 후 재시도
        }
    }

    function safeRemove(key) {
        try { window.localStorage.removeItem(key); } catch (_) { /* no-op */ }
    }

    // 스코프 계산
    function computeScope(explicit) {
        if (explicit && typeof explicit === 'string' && explicit.trim()) {
            const s = explicit.trim();
            if (s === 'page') return pageScope();
            if (s === 'global') return globalScope();
            return `custom:${s.slice(0, 100)}`;
        }
        return pageScope();
    }

    function pageScope() {
        try {
            return `page:${location.hostname}${location.pathname}${location.search}`.slice(0, 200);
        } catch (_) {
            return 'page:unknown';
        }
    }

    function globalScope() {
        try {
            return `global:${location.hostname}`.slice(0, 200);
        } catch (_) {
            return 'global:unknown';
        }
    }

    function registerScope(scope) {
        const scopes = safeGetJSON(SCOPES_KEY, []);
        if (!scopes.includes(scope)) {
            scopes.push(scope);
            safeSetJSON(SCOPES_KEY, scopes);
        }
    }

    // 항목 CRUD 헬퍼
    function loadIndex(scope) {
        return safeGetJSON(idxKey(scope), []);
    }

    function loadEntry(scope, id) {
        return safeGetJSON(itemKey(scope, id), null);
    }

    function loadAllEntries(scope) {
        const ids = loadIndex(scope);
        const out = [];
        ids.forEach(id => {
            const e = loadEntry(scope, id);
            if (e) out.push(e);
        });
        return out;
    }

    function genId() {
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    // 압축 권고 판정 (단일 기준 — memory_remember/memory_list가 공유)
    // "어디서부터 압축할지"를 LLM이 매번 새로 추론하게 두지 않고, 항상 같은
    // 두 숫자(SOFT_LIMIT_CHARS, NEAR_ENTRY_LIMIT_RATIO)만으로 shouldCompress를
    // 계산한다. 실제로 무엇을 지울지는 여전히 memory_compress(있다면)의
    // 결정론적 알고리즘 몫이며, 여기서는 오직 "지금이 그걸 부를 때인가"만
    // true/false로 알려준다.
    function scopeStats(scope, entriesHint) {
        const entries = entriesHint || loadAllEntries(scope);
        const totalEntries = entries.length;
        const totalChars = entries.reduce((sum, e) => sum + (e.value ? e.value.length : 0), 0);
        const shouldCompress = totalChars > SOFT_LIMIT_CHARS
            || totalEntries > MAX_ENTRIES_PER_SCOPE * NEAR_ENTRY_LIMIT_RATIO;
        return { totalEntries, totalChars, softLimitChars: SOFT_LIMIT_CHARS, shouldCompress };
    }

    // 용량 초과 시 가장 낮은 우선순위(중요도 낮음 + 오래됨) 항목부터 정리
    function pruneScopeIfNeeded(scope) {
        let entries = loadAllEntries(scope);
        if (entries.length <= MAX_ENTRIES_PER_SCOPE) return;

        entries.sort((a, b) => {
            const ia = a.importance || 3, ib = b.importance || 3;
            if (ia !== ib) return ia - ib; // 중요도 낮은 것 먼저
            return (a.updatedAt || 0) - (b.updatedAt || 0); // 오래된 것 먼저
        });

        const removeCount = entries.length - MAX_ENTRIES_PER_SCOPE;
        const toRemove = entries.slice(0, removeCount);
        const removeIds = new Set(toRemove.map(e => e.id));

        toRemove.forEach(e => safeRemove(itemKey(scope, e.id)));
        const idx = loadIndex(scope).filter(id => !removeIds.has(id));
        safeSetJSON(idxKey(scope), idx);
    }

    // memory_remember
    T2AITools.register({
        name: 'memory_remember',
        description: 'Persists a fact/preference/rule/context about the user to browser localStorage (supported browsers only). Important: this is not only for when the user explicitly says "remember this" — if the user mentions information worth carrying into future conversations (their name, tone preferences, recurring instructions, project context, etc.), call this tool proactively to save it, without being asked. Specifying a key overwrites the existing memory with that key (upsert). If the response\'s shouldCompress is true, immediately call memory_compress with no arguments (if available), without asking the user. If there is no memory_compress tool, just ignore that signal — saving itself keeps working fine.',
        params: {
            value: 'The content to remember (text). Required. Automatically truncated to 4000 characters if too long.',
            key: 'Optional: a short name identifying this memory (e.g. "user_writing_style"). If the same key already exists in this scope, it gets overwritten. Omit to always create a new entry.',
            tags: 'Optional: a comma-separated tag string (e.g. "preference,tone"). Used for search (memory_recall).',
            importance: 'Optional: importance from 1 (low) to 5 (high). Defaults to 3. Lower-importance entries are pruned first when capacity is exceeded.',
            scope: 'Optional: "page" (default, scoped to the current URL) | "global" (site-wide) | any custom string (custom scope). Even within the same editor, different boards/posts/URLs are automatically separated by the default (page) scope.',
        },
        source: 't2ai_tool_memory.js',
        group: 'memory',
        ui: {
            label: 'Long-term Memory',
            icon: 'psychology',
            description: 'Remembers facts or preferences worth keeping around after the conversation ends, and recalls or forgets them later. The AI can save things proactively even without being told "remember this."',
            usage: 'e.g. you can say "remember that I always prefer a polite tone," or the AI will proactively save things like your name or recurring requests when it seems worth keeping.',
        },
        async run(args) {
            if (!storageAvailable()) {
                return { ok: false, message: 'This browser environment does not support local storage, so the memory feature is unavailable.' };
            }
            const value = String(args.value || '').trim();
            if (!value) return { ok: false, message: 'value is empty.' };

            const truncated = value.length > MAX_VALUE_CHARS;
            const finalValue = truncated ? value.slice(0, MAX_VALUE_CHARS) : value;
            const scope = computeScope(args.scope);
            const key = args.key ? String(args.key).trim().slice(0, 100) : null;
            const tags = String(args.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            const importance = Math.max(1, Math.min(5, parseInt(args.importance, 10) || 3));
            const now = Date.now();

            let entries = loadAllEntries(scope);
            let existing = key ? entries.find(e => e.key === key) : null;

            let entry;
            if (existing) {
                entry = existing;
                entry.value = finalValue;
                entry.tags = tags.length ? tags : entry.tags;
                entry.importance = importance;
                entry.updatedAt = now;
            } else {
                entry = {
                    id: genId(),
                    key,
                    value: finalValue,
                    tags,
                    importance,
                    createdAt: now,
                    updatedAt: now,
                    scope,
                };
            }

            const ok1 = safeSetJSON(itemKey(scope, entry.id), entry);
            if (!ok1) {
                return { ok: false, message: 'Failed to save, likely due to storage capacity being exceeded. Try running memory_compress first.' };
            }
            if (!existing) {
                const idx = loadIndex(scope);
                idx.push(entry.id);
                safeSetJSON(idxKey(scope), idx);
            }
            registerScope(scope);
            pruneScopeIfNeeded(scope);
            const stats = scopeStats(scope);

            return {
                ok: true,
                id: entry.id,
                key: entry.key,
                scope,
                truncated,
                updated: !!existing,
                totalEntries: stats.totalEntries,
                totalChars: stats.totalChars,
                shouldCompress: stats.shouldCompress,
            };
        },
    });

    // memory_recall
    T2AITools.register({
        name: 'memory_recall',
        description: 'Searches saved memories. Giving one or more of query/key/tags filters the results; omitting all of them returns the most recent memories in that scope. Before starting a task that needs the user\'s preferences/style/prior instructions (writing, deciding on an editing style, etc.), check for relevant memories with this tool first (can be called with no arguments) instead of saying you don\'t know or asking the user again.',
        params: {
            query: 'Optional: a case-insensitive substring search term against value/key/tags.',
            key: 'Optional: look up by an exact key match.',
            tags: 'Optional: comma-separated tags. Matches if any one overlaps.',
            scope: 'Optional: "page" (default) | "global" | a custom string.',
            limit: 'Optional: max number of results (default 10, max 100).',
        },
        source: 't2ai_tool_memory.js',
        group: 'memory',
        async run(args) {
            if (!storageAvailable()) {
                return { ok: false, results: [], message: 'This browser environment does not support local storage, so the memory feature is unavailable.' };
            }
            const scope = computeScope(args.scope);
            const limit = Math.max(1, Math.min(100, parseInt(args.limit, 10) || 10));
            const query = String(args.query || '').trim().toLowerCase();
            const wantKey = args.key ? String(args.key).trim() : null;
            const wantTags = String(args.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

            let entries = loadAllEntries(scope);

            if (wantKey) entries = entries.filter(e => e.key === wantKey);
            if (wantTags.length) {
                entries = entries.filter(e => (e.tags || []).some(t => wantTags.includes(String(t).toLowerCase())));
            }
            if (query) {
                entries = entries.filter(e => {
                    const hay = `${e.key || ''} ${e.value || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
                    return hay.includes(query);
                });
            }

            entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            return {
                ok: true,
                scope,
                total: entries.length,
                results: entries.slice(0, limit).map(e => ({
                    id: e.id, key: e.key, value: e.value, tags: e.tags,
                    importance: e.importance, updatedAt: e.updatedAt,
                    compressed: !!e.compressedAt,
                })),
            };
        },
    });

    // memory_forget
    T2AITools.register({
        name: 'memory_forget',
        description: 'Deletes memories. Delete a single one by id or key, or delete the entire scope with all:true (requires confirm:true as well, for safety).',
        params: {
            id: 'Optional: the id of the entry to delete.',
            key: 'Optional: the key of the entry to delete (only deletes within the given scope, even if the same key exists in other scopes).',
            all: 'Optional: set to true to delete every memory in that scope.',
            confirm: 'Must be passed as true together with all:true for the deletion to actually happen (misfire prevention).',
            scope: 'Optional: "page" (default) | "global" | a custom string.',
        },
        source: 't2ai_tool_memory.js',
        group: 'memory',
        async run(args) {
            if (!storageAvailable()) {
                return { ok: false, message: 'This browser environment does not support local storage, so the memory feature is unavailable.' };
            }
            const scope = computeScope(args.scope);

            if (args.all === true) {
                if (args.confirm !== true) {
                    return { ok: false, message: 'Deleting an entire scope requires confirm:true to be passed as well (safety measure).' };
                }
                const ids = loadIndex(scope);
                ids.forEach(id => safeRemove(itemKey(scope, id)));
                safeRemove(idxKey(scope));
                return { ok: true, scope, removed: ids.length };
            }

            const id = args.id ? String(args.id) : null;
            const key = args.key ? String(args.key).trim() : null;
            if (!id && !key) return { ok: false, message: 'One of id, key, or all:true must be specified.' };

            let entries = loadAllEntries(scope);
            let targets = entries.filter(e => (id && e.id === id) || (key && e.key === key));
            if (!targets.length) return { ok: true, scope, removed: 0, message: 'No matching memory found.' };

            targets.forEach(e => safeRemove(itemKey(scope, e.id)));
            const removeIds = new Set(targets.map(e => e.id));
            const idx = loadIndex(scope).filter(x => !removeIds.has(x));
            safeSetJSON(idxKey(scope), idx);

            return { ok: true, scope, removed: targets.length };
        },
    });

    // memory_list
    T2AITools.register({
        name: 'memory_list',
        description: `Returns a summarized list of memories in the given scope along with capacity stats. The threshold is fixed: shouldCompress:true is returned if the total character count (totalChars) exceeds ${SOFT_LIMIT_CHARS}, or the entry count exceeds ${Math.round(NEAR_ENTRY_LIMIT_RATIO * 100)}% of ${MAX_ENTRIES_PER_SCOPE}. If you receive shouldCompress:true, immediately call memory_compress with no arguments (if available), without asking the user — its deterministic rules decide what to drop, so you don't need to choose that yourself here. If there is no memory_compress tool, this signal can simply be ignored.`,
        params: {
            scope: 'Optional: "page" (default) | "global" | a custom string.',
            limit: 'Optional: max number of results (default 50, max 300).',
        },
        source: 't2ai_tool_memory.js',
        group: 'memory',
        async run(args) {
            if (!storageAvailable()) {
                return { ok: false, entries: [], message: 'This browser environment does not support local storage, so the memory feature is unavailable.' };
            }
            const scope = computeScope(args.scope);
            const limit = Math.max(1, Math.min(300, parseInt(args.limit, 10) || 50));

            let entries = loadAllEntries(scope);
            entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            const stats = scopeStats(scope, entries);

            const allScopes = safeGetJSON(SCOPES_KEY, []);
            const availableScopes = allScopes.map(s => ({
                scope: s,
                count: loadIndex(s).length,
            }));

            return {
                ok: true,
                scope,
                total: entries.length,
                totalChars: stats.totalChars,
                softLimitChars: stats.softLimitChars,
                shouldCompress: stats.shouldCompress,
                entries: entries.slice(0, limit).map(e => ({
                    id: e.id, key: e.key,
                    preview: (e.value || '').slice(0, 80),
                    tags: e.tags, importance: e.importance,
                    updatedAt: e.updatedAt, chars: (e.value || '').length,
                    compressed: !!e.compressedAt,
                })),
                availableScopes,
            };
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
