// Path: T2Editor/extend/js/t2ai_tool_search_web_open.js
//
// T2Editor AI Tool — search_web_open
// ============================================================================
// 특정 벤더 API에 종속되지 않는 "오픈" 웹 검색.
// 
// ── 차단 방지(anti block) 및 병렬 경쟁 전략 (호환성 모드) ─────────────────────
// 1) (SearXNG 인스턴스) ∪ (4get 인스턴스) 를 하나의 후보 풀로 합쳐 매 호출마다
//    랜덤하게 섞는다.
// 2) [병렬 처리] 상위 MAX_ATTEMPTS 개의 후보를 동시에 호출하여 가장 먼저
//    성공적인 응답을 가져오는 인스턴스의 결과를 채택한다. (Promise.any 미지원
//    구형 브라우저를 위해 커스텀 헬퍼 함수 getFirstSuccess 사용)
// 3) 성공한 후보는 우선순위를 올리고, 실패한 후보는 COOLDOWN_MS 동안 쉬게 한다.
// 4) [하드 상한] 호출 전체에 GLOBAL_TIMEOUT_MS가 적용되며 초과 시 즉시 Abort된다.
// 5) [최후 계층] 병렬 풀 전체가 실패하면, 함께 백그라운드에서 실행되던
//    Wikipedia 결과를 즉각 폴백으로 반환한다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'search_web_open'}, '[T2AI] t2ai_core.js not loaded yet — skipping search_web_open registration.'));
        return;
    }

    // ── 공통 설정 ────────────────────────────────────────────────────────────
    const GLOBAL_TIMEOUT_MS = 3500;     // 툴 전체 실행 하드 상한(7초)
    const MAX_ATTEMPTS = 6;             // 한 번에 동시 출발(병렬)시킬 최대 후보 수
    const TIMEOUT_MS = 6000;            // 검색 인스턴스 1개당 응답 대기 (Global보단 약간 짧게)
    const COOLDOWN_MS = 10 * 60 * 1000; // 실패한 후보 재시도 쉬는 시간(10분)
    const LIST_FETCH_TIMEOUT_MS = 4000; // 인스턴스 목록 수집 대기 시간
    const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 동적 인스턴스 목록 캐시 유효시간(12시간)
    const MAX_POOL_SIZE = 40;           // 후보 풀 상한

    const lastFailedAt = new Map();
    const successCount = new Map();

    function poolKey(candidate) {
        return `${candidate.provider}:${candidate.base}`;
    }

    // ── Promise.any 호환성 헬퍼 함수 ──────────────────────────────────────────
    // 구형 브라우저에서도 Promise.any()와 동일하게 가장 먼저 성공한 결과를 반환하고,
    // 모두 실패했을 때만 에러를 던집니다.
    function getFirstSuccess(promises) {
        return new Promise((resolve, reject) => {
            if (!promises || promises.length === 0) {
                return reject(new Error('No promises to race'));
            }
            let rejectedCount = 0;
            const errors = new Array(promises.length);

            promises.forEach((p, i) => {
                Promise.resolve(p).then(resolve).catch(err => {
                    errors[i] = err;
                    rejectedCount++;
                    if (rejectedCount === promises.length) {
                        const error = new Error('All candidates failed');
                        error.errors = errors; // AggregateError 대신 배열 부착
                        reject(error);
                    }
                });
            });
        });
    }

    // ── Global Signal 및 Timeout 유틸 ─────────────────────────────────────────
    function createMergedSignal(timeoutMs, globalSignal) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onGlobalAbort = () => controller.abort();

        if (globalSignal) {
            if (globalSignal.aborted) controller.abort();
            else globalSignal.addEventListener('abort', onGlobalAbort);
        }

        return {
            signal: controller.signal,
            cleanup: () => {
                clearTimeout(timer);
                if (globalSignal) globalSignal.removeEventListener('abort', onGlobalAbort);
            }
        };
    }

    async function fetchWithTimeout(url, ms, globalSignal) {
        const { signal, cleanup } = createMergedSignal(ms, globalSignal);
        try {
            return await fetch(url, { 
                method: 'GET', 
                headers: { 'Accept': 'application/json' }, 
                signal 
            });
        } finally {
            cleanup();
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Provider 1 — SearXNG
    // ────────────────────────────────────────────────────────────────────────
    const SEARXNG_FALLBACK = [
        'https://searx.be', 'https://priv.au', 'https://search.inetol.net',
        'https://baresearch.org', 'https://searx.tiekoetter.com', 'https://opnxng.com',
        'https://search.bus-hit.me', 'https://searx.stream', 'https://etsi.me',
        'https://search.sapti.me',
    ];
    const SEARXNG_LIST_URL = 'https://searx.space/data/instances.json';
    const SEARXNG_CACHE_KEY = 't2ai_open_search_searxng_instances_v1';
    let searxngListMemo = null;

    function normalizeBaseUrl(u) {
        try {
            const parsed = new URL(u);
            return `${parsed.protocol}//${parsed.host}`;
        } catch (_) {
            return null;
        }
    }

    function readJsonCache(key) {
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.instances) || typeof parsed.fetchedAt !== 'number') return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function writeJsonCache(key, instances) {
        try { window.localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), instances })); } catch (_) {}
    }

    function parseSearxngInstancesJson(json) {
        if (!json || typeof json !== 'object') return [];
        const out = [];
        for (const key of Object.keys(json)) {
            const info = json[key];
            if (!info || typeof info !== 'object' || (info.network_type && info.network_type !== 'normal')) continue;
            const statusCode = info.http && info.http.status_code;
            if (statusCode != null && statusCode !== 200) continue;
            const base = normalizeBaseUrl(key);
            if (base) out.push(base);
        }
        return out;
    }

    async function fetchSearxngLiveList(globalSignal) {
        const { signal, cleanup } = createMergedSignal(LIST_FETCH_TIMEOUT_MS, globalSignal);
        try {
            const res = await fetch(SEARXNG_LIST_URL, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal,
            });
            if (!res.ok) throw new Error(`instances.json HTTP ${res.status}`);
            const json = await res.json();
            const list = parseSearxngInstancesJson(json);
            if (!list.length) throw new Error('Parsed instances.json result is empty');
            return list;
        } finally {
            cleanup();
        }
    }

    async function getSearxngCandidates(globalSignal) {
        if (searxngListMemo) return searxngListMemo;
        const cached = readJsonCache(SEARXNG_CACHE_KEY);
        const now = Date.now();
        if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
            searxngListMemo = cached.instances;
            return searxngListMemo;
        }
        try {
            const fresh = await fetchSearxngLiveList(globalSignal);
            writeJsonCache(SEARXNG_CACHE_KEY, fresh);
            searxngListMemo = fresh;
            return fresh;
        } catch (_) {
            searxngListMemo = (cached && cached.instances.length) ? cached.instances : SEARXNG_FALLBACK.slice();
            return searxngListMemo;
        }
    }

    async function trySearxng(base, query, opts, globalSignal) {
        const url = new URL('/search', base);
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('safesearch', '1');
        if (opts.language) url.searchParams.set('language', opts.language);
        if (opts.categories) url.searchParams.set('categories', opts.categories);

        const res = await fetchWithTimeout(url.toString(), TIMEOUT_MS, globalSignal);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || !Array.isArray(json.results)) throw new Error('Unexpected response format');

        return json.results.map(r => ({
            title: r.title || '',
            url: r.url || '',
            content: r.content || '',
            engine: r.engine || (Array.isArray(r.engines) ? r.engines.join(',') : ''),
        }));
    }

    // ────────────────────────────────────────────────────────────────────────
    // Provider 2 — 4get 
    // ────────────────────────────────────────────────────────────────────────
    const FOURGET_INSTANCES = [
        'https://4get.ca', 'https://4get.bloat.cat', 'https://4get.lunar.icu', 'https://4get.nadeko.net'
    ];

    async function tryFourget(base, query, globalSignal) {
        const url = new URL('/api/v1/web', base);
        url.searchParams.set('s', query);

        const res = await fetchWithTimeout(url.toString(), TIMEOUT_MS, globalSignal);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json || json.status !== 'ok' || !Array.isArray(json.web)) {
            throw new Error((json && json.status) || 'Unexpected response format');
        }

        return json.web.map(r => ({
            title: r.title || '',
            url: r.url || '',
            content: typeof r.description === 'string' ? r.description : '',
            engine: '4get',
        }));
    }

    // ────────────────────────────────────────────────────────────────────────
    // Provider 3 — Wikipedia (최후 안전망)
    // ────────────────────────────────────────────────────────────────────────
    async function tryWikipedia(query, opts, globalSignal) {
        const lang = (opts.language || 'en').slice(0, 2) || 'en';
        const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
        url.searchParams.set('action', 'query');
        url.searchParams.set('list', 'search');
        url.searchParams.set('srsearch', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('origin', '*');

        const res = await fetchWithTimeout(url.toString(), TIMEOUT_MS, globalSignal);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const hits = json && json.query && Array.isArray(json.query.search) ? json.query.search : null;
        if (!hits) throw new Error('Unexpected response format');

        return hits.map(h => ({
            title: h.title || '',
            url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((h.title || '').replace(/ /g, '_'))}`,
            content: String(h.snippet || '').replace(/<[^>]+>/g, ''),
            engine: 'wikipedia',
        }));
    }

    // ── 공용 유틸 ────────────────────────────────────────────────────────────
    const MAX_FIELD_CHARS = 400;
    const MAX_TOTAL_CHARS = 6000;

    function safeStr(v, maxLen) {
        if (v == null) return '';
        let s;
        try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { s = String(v); }
        // eslint-disable-next-line no-control-regex
        s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, '');
        s = s.trim();
        if (maxLen && s.length > maxLen) s = s.slice(0, maxLen) + '…';
        return s;
    }

    function sanitizeResults(rawResults, engineFallback) {
        const out = [];
        let budget = MAX_TOTAL_CHARS;
        for (const r of (rawResults || [])) {
            if (budget <= 0) break;
            const content = safeStr(r && r.content, MAX_FIELD_CHARS);
            out.push({
                title: safeStr(r && r.title, MAX_FIELD_CHARS),
                url: safeStr(r && r.url, MAX_FIELD_CHARS),
                content,
                engine: safeStr((r && r.engine) || engineFallback, 60),
            });
            budget -= content.length;
        }
        return out;
    }

    async function buildHybridPool(globalSignal) {
        const searxng = await getSearxngCandidates(globalSignal);
        const pool = [
            ...searxng.map(base => ({ provider: 'searxng', base })),
            ...FOURGET_INSTANCES.map(base => ({ provider: '4get', base })),
        ];
        if (pool.length <= MAX_POOL_SIZE) return pool;
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, MAX_POOL_SIZE);
    }

    function rankPool(pool) {
        const now = Date.now();
        const usable = pool.filter(c => {
            const failedAt = lastFailedAt.get(poolKey(c));
            return !failedAt || (now - failedAt) > COOLDOWN_MS;
        });
        const usePool = usable.length ? usable : pool; 
        return usePool
            .map(c => ({ c, score: (successCount.get(poolKey(c)) || 0) + Math.random() }))
            .sort((a, b) => b.score - a.score)
            .map(x => x.c);
    }

    async function tryCandidate(candidate, query, opts, globalSignal) {
        if (candidate.provider === 'searxng') return trySearxng(candidate.base, query, opts, globalSignal);
        if (candidate.provider === '4get') return tryFourget(candidate.base, query, globalSignal);
        throw new Error(`Unknown provider: ${candidate.provider}`);
    }

    // ── Tool 등록 ────────────────────────────────────────────────────────────
    T2AITools.register({
        name: 'search_web_open',
        description: 'Without a vendor API key, races public instances of two independent open-source metasearch projects (SearXNG and 4get) in parallel to fetch the fastest web search results.',
        params: {
            query: 'Search query. Required.',
            limit: 'Optional: max number of results (default 10, max 20)',
            language: 'Optional: language code (e.g. ko, en). If omitted, uses the instance default (uses that language\'s Wikipedia when falling back to Wikipedia)',
            categories: 'Optional: SearXNG category',
        },
        source: 't2ai_tool_search_web_open.js',
        ui: {
            label: 'Open Web Search',
            icon: 'hub',
            description: 'Runs several open-source search engines (SearXNG, 4get) not tied to any single company\'s API in parallel, and uses the fastest result. Guarantees a Wikipedia background search result even on failure.',
            usage: 'e.g. used automatically for questions needing current info or fact-checking, like "what\'s today\'s exchange rate?"'
        },
        async run(args) {
            // 하드 상한용 Global AbortController
            const globalController = new AbortController();
            const globalTimer = setTimeout(() => globalController.abort(), GLOBAL_TIMEOUT_MS);

            try {
                return await runInternal(args || {}, globalController.signal);
            } catch (e) {
                return {
                    results: [],
                    total: 0,
                    tier: 'failed',
                    message: `Could not complete the search due to an internal error or timeout (exceeded 7s): ${safeStr(e && e.message, 200)}`,
                };
            } finally {
                clearTimeout(globalTimer);
            }
        },
    });

    // ── 병렬 핵심 로직 ────────────────────────────────────────────────────────
    async function runInternal(args, globalSignal) {
        const query = String(args.query || '').trim();
        if (!query) return { results: [], total: 0, message: 'query is empty.' };

        const limit = Math.max(1, Math.min(20, parseInt(args.limit, 10) || 10));
        const opts = {
            language: args.language ? String(args.language).trim() : '',
            categories: args.categories ? String(args.categories).trim() : '',
        };

        const pool = await buildHybridPool(globalSignal);
        const candidates = rankPool(pool).slice(0, MAX_ATTEMPTS);
        const attempted = candidates.map(c => `${c.provider}:${c.base}`);

        // Wikipedia를 백그라운드에서 메인 검색과 동시에 병렬 실행 시작
        const wikiPromise = tryWikipedia(query, opts, globalSignal).then(raw => {
            const results = sanitizeResults(raw.slice(0, limit), 'wikipedia');
            return {
                results,
                total: results.length,
                source: 'wikipedia',
                tier: 'fallback',
                message: results.length
                    ? `All ${attempted.length} general web search instances failed, so Wikipedia was used as a fallback instead.`
                    : 'No results from either general web search or Wikipedia.',
            };
        });

        // 1순위: SearXNG/4get 인스턴스들 간의 병렬 생존 경쟁
        if (candidates.length > 0) {
            const candidatePromises = candidates.map(async (candidate) => {
                const key = poolKey(candidate);
                try {
                    const raw = (await tryCandidate(candidate, query, opts, globalSignal)).slice(0, limit);
                    const results = sanitizeResults(raw, candidate.provider);
                    
                    // 빈 배열일 경우 Error를 던져 경쟁 풀에서 양보(reject) 처리
                    if (results.length === 0) {
                        throw new Error('No results');
                    }

                    successCount.set(key, (successCount.get(key) || 0) + 1);
                    lastFailedAt.delete(key);
                    return {
                        results,
                        total: results.length,
                        source: safeStr(`${candidate.provider}:${candidate.base}`, 200),
                        tier: 'primary',
                        message: ''
                    };
                } catch (e) {
                    lastFailedAt.set(key, Date.now());
                    throw e; 
                }
            });

            try {
                // Promise.any 대체 헬퍼 함수를 사용하여 첫 번째 성공 결과를 반환
                return await getFirstSuccess(candidatePromises);
            } catch (allErrors) {
                // 병렬 후보 모두 실패했거나 결과가 비어 있음
            }
        }

        // ── 최후 안전망 ──
        // 메인 검색이 실패했으므로, 시작부터 같이 돌아가고 있던 Wikipedia 결과를 대기/사용
        try {
            return await wikiPromise;
        } catch (wikiError) {
            return {
                results: [],
                total: 0,
                tier: 'failed',
                message: `Every search path failed (${attempted.length} parallel SearXNG/4get candidates failed; the Wikipedia fallback also failed: ${safeStr(wikiError && wikiError.message, 200)}). Please try again shortly.`,
            };
        }
    }
})();