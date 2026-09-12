// Path: T2Editor/extend/js/t2ai_tool_memory_compress.js
//
// T2Editor AI Tool — memory_compress (middle-tool)
// ============================================================================
// t2ai_tool_memory.js(long_memory, high-tool)가 localStorage에 쌓아온 기억을
// 자동으로 압축(정리)하는 Tool. t2ai_tool_memory.js 의 저장 스키마를
// "데이터 계약"으로만 공유할 뿐, 그 파일의 코드를 import/참조하지 않는다
// (README_AI_TOOLS.js 규칙 2 — Tool끼리는 서로 몰라야 한다). 즉 이 파일만
// 지워도 long_memory 자체는 계속 정상 동작하고, 반대로 t2ai_tool_memory.js를
// 지워도 이 파일은 조용히 아무 데이터도 찾지 못할 뿐 에러를 내지 않는다.
//
// ── group을 'memory'가 아닌 독립 그룹으로 두는 이유 ──────────────────────────
// 예전에는 group:'memory'로 묶어 memory_remember 등과 on/off를 함께 적용했다.
// 하지만 그러면 이 Tool은 ui를 선언해도 T2AITools.listUI()의 그룹 대표자가
// 이미 memory_remember로 정해져 있어(그룹당 대표 ui는 "그 그룹에 먼저
// 등록된 Tool 하나"만 쓰인다) 유저 화면에는 절대 노출되지 않고, LLM만 조용히
// 호출할 수 있는 "내부용" Tool로 계속 남는 문제가 있었다. 이제는 자신만의
// group(=자기 name)을 가진 독립 Tool로 등록해, 다른 search_*/shorten_url 등과
// 동일하게 자기 이름/아이콘/설명/사용법을 유저 Tool 목록에 직접 노출하고,
// 유저가 이 Tool 하나만 따로 켜고 끌 수 있게 한다("일반 Tool처럼 사용").
// memory_remember 등 나머지 memory 그룹을 꺼도 이 Tool 자체는 별개로 계속
// 켜져 있을 수 있다 — 압축은 이미 저장된 데이터를 정리할 뿐 새로 기억을
// 만들지 않으므로, 독립적으로 켜고 꺼도 안전하다.
//
// ── 왜 LLM 재작성이 아니라 규칙 기반(rule-based) 압축인가 ────────────────────
// "환각 없이, 적은 토큰으로, 정확하고 객관적인 기준"이라는 요구사항을 만족하는
// 가장 확실한 방법은 애초에 LLM에게 "다시 써 달라"고 요청하지 않는 것이다.
// 이 Tool은 브라우저 안에서 전부 결정적(deterministic) 알고리즘으로만 동작한다:
//   1) 근사 중복 항목 병합 — 새 문장을 생성하지 않고, 이미 있는 두 항목 중
//      하나만 남기고 나머지를 버린다(원문 그대로 유지 → 왜곡 불가능).
//   2) 우선순위 낮은 항목 제거 — 중요도(importance)가 낮고 오래된 항목부터
//      통째로 제거한다(요약이 아니라 "버림" — 역시 왜곡 불가능).
//   3) 그래도 목표치를 못 채우면, 긴 항목에 한해 문장 단위 추출 요약
//      (extractive summarization)을 적용한다 — 원문 문장을 그대로 골라 남길
//      뿐, 단 한 글자도 새로 생성하지 않는다. 따라서 "환각"이 원천적으로
//      불가능하다.
// 이 방식은 실제 LLM API 호출이 전혀 없으므로 토큰 비용도 0이다("적은 토큰"의
// 가장 확실한 형태).
//
// ── 압축률(ratio)의 정의 ─────────────────────────────────────────────────────
// ratio=45 는 "원본 대비 45%만큼 용량을 절감한다"는 뜻이다. 즉 압축 후 목표
// 용량 = 원본 용량 × (1 - ratio/100). (일반적인 파일 압축 유틸리티의
// "압축률 X%" 표기와 동일한 정의 — 숫자가 클수록 더 많이 줄어든다.)
//
// ── 하드코딩된 압축률 목록 ────────────────────────────────────────────────────
// [10, 15, 25, 30, 45, 60, 75] — 기본값 45. 사용자가 memory_compress 호출 시
// ratio 인자로 이 중 하나를 선택하면, 별도로 저장(setDefault:false 아닌 한)되어
// 다음 자동 압축부터도 그 값이 기본값으로 쓰인다.
//
// ── 자동 트리거 ──────────────────────────────────────────────────────────────
// 이 파일이 스스로 타이머 등으로 "자동" 실행되지는 않는다(백그라운드 타이머는
// 예측 불가능한 시점에 사용자 데이터를 건드릴 수 있어 안전하지 않음). 대신
// memory_list 가 반환하는 shouldCompress 힌트를 LLM이 보고 스스로 이 Tool을
// 호출하는 "LLM 주도 자동화" 방식을 쓴다 — Tool 파일 간 직접 호출 없이도
// 사실상 자동 압축처럼 동작한다.
//
// 삭제하기: 이 파일 하나만 지우면 압축 기능만 사라지고, long_memory 저장/조회/
// 삭제 기능은 전혀 영향받지 않는다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 memory_compress 등록을 건너뜁니다.');
        return;
    }

    // ── t2ai_tool_memory.js 와 공유하는 저장소 스키마(코드 참조 아님, 계약만 공유) ──
    const NS = 't2ai_mem_v1';
    function idxKey(scope) { return `${NS}:idx:${scope}`; }
    function itemKey(scope, id) { return `${NS}:item:${scope}:${id}`; }
    const SCOPES_KEY = `${NS}:scopes`;
    const RATIO_PREF_KEY = `${NS}:compress_ratio`;

    // 하드코딩된 압축률 목록 (요구사항 그대로)
    const ALLOWED_RATIOS = [10, 15, 25, 30, 45, 60, 75];
    const DEFAULT_RATIO = 45;

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

    function loadIndex(scope) { return safeGetJSON(idxKey(scope), []); }
    function loadEntry(scope, id) { return safeGetJSON(itemKey(scope, id), null); }
    function loadAllEntries(scope) {
        const ids = loadIndex(scope);
        const out = [];
        ids.forEach(id => {
            const e = loadEntry(scope, id);
            if (e) out.push(e);
        });
        return out;
    }
    function saveEntry(scope, entry) {
        return safeSetJSON(itemKey(scope, entry.id), entry);
    }
    function removeEntry(scope, id) {
        safeRemove(itemKey(scope, id));
        const idx = loadIndex(scope).filter(x => x !== id);
        safeSetJSON(idxKey(scope), idx);
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
    function computeScope(explicit) {
        if (explicit && typeof explicit === 'string' && explicit.trim()) {
            const s = explicit.trim();
            if (s === 'page') return pageScope();
            if (s === 'global') return globalScope();
            if (s === 'all') return 'all';
            return `custom:${s.slice(0, 100)}`;
        }
        return pageScope();
    }

    // ── 압축률 선택/저장 ─────────────────────────────────────────────────────
    function resolveRatio(requested) {
        const n = parseInt(requested, 10);
        if (ALLOWED_RATIOS.includes(n)) return n;
        const saved = parseInt(safeGetJSON(RATIO_PREF_KEY, null), 10);
        if (ALLOWED_RATIOS.includes(saved)) return saved;
        return DEFAULT_RATIO;
    }

    // ── 문자열 유사도(근사 중복 판정) — Jaccard on 단어 집합 ──────────────────
    function wordSet(text) {
        return new Set(
            String(text || '')
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 2)
        );
    }
    function jaccard(a, b) {
        if (!a.size || !b.size) return 0;
        let inter = 0;
        a.forEach(w => { if (b.has(w)) inter++; });
        const union = a.size + b.size - inter;
        return union === 0 ? 0 : inter / union;
    }
    const DEDUP_THRESHOLD = 0.82;

    // ── 결정론적 점수 (중요도 + 최신성만 사용, 임의 생성 없음) ────────────────
    function scoreEntries(entries) {
        const sortedByRecency = [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const recencyRank = new Map();
        sortedByRecency.forEach((e, idx) => recencyRank.set(e.id, sortedByRecency.length - idx));
        entries.forEach(e => {
            const importance = e.importance || 3;
            e.__score = importance * 1000 + (recencyRank.get(e.id) || 0);
        });
    }

    // ── 문장 단위 추출 요약 (원문 문장만 선택, 생성 없음) ─────────────────────
    function splitSentences(text) {
        const parts = String(text || '').split(/(?<=[.!?。!?\n])\s+/).map(s => s.trim()).filter(Boolean);
        return parts.length ? parts : [String(text || '')];
    }

    function extractiveTrim(text, targetChars) {
        if (!text || text.length <= targetChars) return { value: text, trimmed: false };
        const sentences = splitSentences(text);
        if (sentences.length <= 1) {
            // 문장이 하나뿐이면 어쩔 수 없이 앞부분만 물리적으로 절단(내용 왜곡 없이 자르기)
            return { value: text.slice(0, Math.max(20, targetChars)), trimmed: true };
        }

        // 단어 빈도 기반 문장 점수 (해당 항목 내부에서만 계산 — 외부 지식 사용 안 함)
        const freq = new Map();
        sentences.forEach(s => {
            wordSet(s).forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
        });
        const scored = sentences.map((s, idx) => {
            let score = 0;
            wordSet(s).forEach(w => { score += freq.get(w) || 0; });
            if (idx === 0) score += 1000; // 첫 문장(핵심 진술일 가능성 높음)은 항상 우대
            return { s, idx, score };
        });
        scored.sort((a, b) => b.score - a.score);

        const kept = [];
        let total = 0;
        for (const item of scored) {
            if (total + item.s.length > targetChars && kept.length > 0) continue;
            kept.push(item);
            total += item.s.length;
            if (total >= targetChars) break;
        }
        kept.sort((a, b) => a.idx - b.idx); // 원래 순서로 복원
        return { value: kept.map(k => k.s).join(' '), trimmed: true };
    }

    // ── memory_compress ──────────────────────────────────────────────────────
    T2AITools.register({
        name: 'memory_compress',
        description: `long_memory(memory_remember 등)가 저장한 기억을 규칙 기반(rule-based)으로 압축한다. LLM이 텍스트를 새로 생성하지 않으므로 환각 위험이 없고 토큰 비용도 없다. 언제 호출할지: memory_remember 또는 memory_list의 응답에 shouldCompress:true가 오면, 사용자에게 묻지 말고 그 직후에 인자 없이 호출하라 — 그 외의 시점에는 호출할 필요가 없다(불필요하게 자주 호출하지 말 것). 무엇을 지울지: 절대 스스로 고르지 않아도 된다 — scope/ratio를 생략하면 결정론적 규칙(근사 중복 병합 → 낮은 중요도/오래된 항목 제거 → 원문 문장 추출 요약 순)이 알아서 처리한다. 압축률은 [${ALLOWED_RATIOS.join(', ')}] 중 하나만 허용되며 기본값은 ${DEFAULT_RATIO}(%)다. ratio=45는 "원본 대비 45% 용량 절감(목표 용량 = 원본×0.55)"을 의미하며, 특별한 이유가 없으면 ratio는 생략하고 기본값을 쓰면 된다.`,
        params: {
            scope: '선택: "page"(기본) | "global" | 커스텀 문자열 | "all"(모든 스코프 일괄 압축).',
            ratio: `선택: 압축률(%). 허용값 [${ALLOWED_RATIOS.join(', ')}] 중 하나. 생략 시 사용자가 이전에 지정한 값 또는 ${DEFAULT_RATIO}.`,
            setDefault: '선택: true(기본)면 이번 ratio를 다음 호출의 기본값으로 저장. false면 이번 한 번만 적용.',
            dryRun: '선택: true면 실제로 저장소를 변경하지 않고 예상 결과 리포트만 반환.',
        },
        source: 't2ai_tool_memory_compress.js',
        // group을 지정하지 않으면 자기 name('memory_compress')이 곧 group이 되어
        // 독립된 유저 Tool 항목으로 노출된다(위 상단 주석 참고).
        ui: {
            label: '기억 압축',
            icon: 'compress',
            description: '저장해 둔 장기 기억이 너무 많이 쌓이면, 내용을 새로 지어내지 않고 정해진 규칙대로만 정리해서 용량을 줄여요.',
            usage: '예: 기억이 많이 쌓였다는 신호가 오면 AI가 스스로 압축을 실행해요(허락을 구하지 않고, 대신 나중에 알려줘요). "기억 좀 정리해줘"처럼 직접 요청할 수도 있어요.',
        },
        async run(args) {
            if (!storageAvailable()) {
                return { ok: false, message: '이 브라우저 환경에서는 로컬 저장소를 사용할 수 없어 압축 기능을 지원하지 않습니다.' };
            }

            const ratio = resolveRatio(args.ratio);
            if (args.ratio !== undefined && !ALLOWED_RATIOS.includes(parseInt(args.ratio, 10))) {
                return { ok: false, message: `ratio는 [${ALLOWED_RATIOS.join(', ')}] 중 하나여야 합니다. 받은 값: ${args.ratio}` };
            }
            if (args.setDefault !== false) {
                safeSetJSON(RATIO_PREF_KEY, ratio);
            }
            const dryRun = args.dryRun === true;

            const scopeArg = computeScope(args.scope);
            let scopes;
            if (scopeArg === 'all') {
                scopes = safeGetJSON(SCOPES_KEY, []);
            } else {
                scopes = [scopeArg];
            }
            if (!scopes.length) {
                return { ok: true, ratio, message: '압축할 스코프가 없습니다(저장된 기억 없음).', originalChars: 0, finalChars: 0 };
            }

            let report = {
                ok: true,
                ratio,
                scopes: [],
                originalChars: 0,
                finalChars: 0,
                entriesDeduped: 0,
                entriesRemoved: 0,
                entriesTrimmed: 0,
                entriesUnchanged: 0,
                dryRun,
            };

            for (const scope of scopes) {
                let entries = loadAllEntries(scope);
                if (!entries.length) continue;

                const originalChars = entries.reduce((s, e) => s + (e.value || '').length, 0);
                const targetChars = Math.max(0, Math.floor(originalChars * (1 - ratio / 100)));
                const minKeep = Math.max(3, Math.ceil(entries.length * 0.15));

                // 1) 근사 중복 탐지 — "제거 후보" 목록만 만든다(target 초과분만 실제 제거).
                //    같은 문장이 여러 번 겹쳐 잡혀도 loser id는 Set으로 유일화하므로
                //    통계(deduped)와 실제 제거 수가 항상 일치한다.
                const dupLoserIds = new Set();
                for (let i = 0; i < entries.length; i++) {
                    if (dupLoserIds.has(entries[i].id)) continue;
                    const wsA = wordSet(entries[i].value);
                    for (let j = i + 1; j < entries.length; j++) {
                        if (dupLoserIds.has(entries[j].id)) continue;
                        const sim = jaccard(wsA, wordSet(entries[j].value));
                        if (sim >= DEDUP_THRESHOLD) {
                            // 더 낮은 우선순위(오래되고 덜 중요한) 쪽을 제거 후보로
                            const a = entries[i], b = entries[j];
                            const aScore = (a.importance || 3) * 1000000 + (a.updatedAt || 0);
                            const bScore = (b.importance || 3) * 1000000 + (b.updatedAt || 0);
                            const loser = aScore >= bScore ? b : a;
                            dupLoserIds.add(loser.id);
                        }
                    }
                }

                // 2) 제거 우선순위 큐 구성: (중복 후보 → 점수 낮은 순) + (나머지 → 점수 낮은 순).
                //    target을 만족하는 선까지만 실제로 제거한다 — dedup이라고 해서
                //    무조건 전부 지우지 않는다(요청한 압축률을 불필요하게 초과하지 않도록).
                scoreEntries(entries);
                const dupCandidates = entries.filter(e => dupLoserIds.has(e.id)).sort((a, b) => a.__score - b.__score);
                const restCandidates = entries.filter(e => !dupLoserIds.has(e.id)).sort((a, b) => a.__score - b.__score);
                const removalQueue = [...dupCandidates, ...restCandidates];

                let currentChars = entries.reduce((s, e) => s + (e.value || '').length, 0);
                let removedCount = 0;
                let deduped = 0;
                const removedIds = new Set();
                const survivors = [...entries];

                let qi = 0;
                while (currentChars > targetChars && survivors.length > minKeep && qi < removalQueue.length) {
                    const dropped = removalQueue[qi++];
                    if (removedIds.has(dropped.id)) continue;
                    const idx = survivors.findIndex(e => e.id === dropped.id);
                    if (idx === -1) continue;
                    survivors.splice(idx, 1);
                    removedIds.add(dropped.id);
                    currentChars -= (dropped.value || '').length;
                    removedCount++;
                    if (dupLoserIds.has(dropped.id)) deduped++;
                }
                entries = survivors;

                // 3) 그래도 목표 초과면, 긴 항목부터 추출 요약(원문 문장만 선택)
                let trimmedCount = 0;
                if (currentChars > targetChars) {
                    survivors.sort((a, b) => (b.value || '').length - (a.value || '').length);
                    for (const e of survivors) {
                        if (currentChars <= targetChars) break;
                        const val = e.value || '';
                        if (val.length < 160) continue; // 이미 짧은 항목은 손대지 않음
                        const over = currentChars - targetChars;
                        const entryTarget = Math.max(80, val.length - over - 1);
                        if (entryTarget >= val.length) continue;
                        const result = extractiveTrim(val, entryTarget);
                        if (result.trimmed && result.value.length < val.length) {
                            currentChars -= (val.length - result.value.length);
                            if (!e.compressedFromChars) e.compressedFromChars = val.length;
                            e.value = result.value;
                            e.compressedAt = Date.now();
                            trimmedCount++;
                        }
                    }
                }

                const finalChars = survivors.reduce((s, e) => s + (e.value || '').length, 0);

                if (!dryRun) {
                    // 실제 반영: 제거된 항목 삭제, 남은(트리밍된 포함) 항목 갱신
                    const keepIds = new Set(survivors.map(e => e.id));
                    const originalIds = loadIndex(scope);
                    originalIds.forEach(id => {
                        if (!keepIds.has(id)) removeEntry(scope, id);
                    });
                    survivors.forEach(e => {
                        delete e.__score;
                        saveEntry(scope, e);
                    });
                    // 인덱스를 survivors 기준으로 재작성
                    safeSetJSON(idxKey(scope), survivors.map(e => e.id));
                }

                report.scopes.push({
                    scope,
                    originalChars,
                    targetChars,
                    finalChars,
                    deduped,
                    removed: removedCount,
                    trimmed: trimmedCount,
                    entriesRemaining: survivors.length,
                });
                report.originalChars += originalChars;
                report.finalChars += finalChars;
                report.entriesDeduped += deduped;
                report.entriesRemoved += removedCount;
                report.entriesTrimmed += trimmedCount;
                report.entriesUnchanged += (survivors.length - trimmedCount);
            }

            report.achievedReductionPercent = report.originalChars > 0
                ? Math.round((1 - report.finalChars / report.originalChars) * 100)
                : 0;

            return report;
        },
    });

    // ── memory_compress_settings ────────────────────────────────────────────
    // 현재 저장된 기본 압축률과 허용 목록을 조회하는 소형 보조 Tool.
    T2AITools.register({
        name: 'memory_compress_settings',
        description: '허용된 압축률 목록과 현재 사용자가 지정한 기본 압축률을 조회한다.',
        params: {},
        source: 't2ai_tool_memory_compress.js',
        group: 'memory_compress', // memory_compress와 같은 그룹 — 이 Tool을 끄면 압축 설정 조회도 함께 꺼진다.
        async run() {
            return {
                ok: true,
                allowedRatios: ALLOWED_RATIOS,
                defaultRatio: DEFAULT_RATIO,
                currentRatio: resolveRatio(undefined),
            };
        },
    });
})();