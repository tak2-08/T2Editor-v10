// Path: T2Editor/extend/js/t2ai_tool_get_user_timezone.js
(function () {
    'use strict';
    
    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded_short', {tool: 'get_user_timezone'}, '[T2AI] t2ai_core.js not loaded — skipping get_user_timezone registration'));
        return;
    }

    // ── 공통 설정 및 헬퍼 ──────────────────────────────────────────────────
    const GLOBAL_TIMEOUT_MS = 3000; // 시간 툴은 가벼우므로 3초 상한[cite: 4]
    
    function getFirstSuccess(promises) {
        return new Promise((resolve, reject) => {
            if (!promises || promises.length === 0) return reject(new Error('No promises to race'));
            let rejectedCount = 0;
            promises.forEach((p) => {
                Promise.resolve(p).then(resolve).catch(() => {
                    rejectedCount++;
                    if (rejectedCount === promises.length) reject(new Error('All candidates failed'));
                });
            });
        });
    }

    function createMergedSignal(timeoutMs, globalSignal) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onGlobalAbort = () => controller.abort();
        if (globalSignal) {
            if (globalSignal.aborted) controller.abort();
            else globalSignal.addEventListener('abort', onGlobalAbort);
        }
        return { signal: controller.signal, cleanup: () => { clearTimeout(timer); if (globalSignal) globalSignal.removeEventListener('abort', onGlobalAbort); } };
    }

    async function fetchWithTimeout(url, ms, globalSignal) {
        const { signal, cleanup } = createMergedSignal(ms, globalSignal);
        try { return await fetch(url, { signal }); } finally { cleanup(); }
    }

    T2AITools.register({
        name: 'get_user_timezone',
        description: 'Gets the user\'s time zone and UTC offset from the current browser environment.',
        params: {},
        source: 't2ai_tool_get_user_timezone.js',
        ui: {
            label: 'Check Time Zone',
            icon: 'schedule',
            description: 'Checks the user\'s device time zone and local time.',
            usage: 'Called whenever the user\'s current time is needed for context.',
        },
        group: 'system_info',

        async run(args) {
            // 하드 상한용 Global AbortController[cite: 4]
            const globalController = new AbortController();
            const globalTimer = setTimeout(() => globalController.abort(), GLOBAL_TIMEOUT_MS);

            try {
                return await runInternal(globalController.signal);
            } catch (e) {
                // 어떠한 에러가 발생해도 LLM 호출 단으로 throw 하지 않고 객체 형태로 우아하게 처리[cite: 4]
                return {
                    timeZone: 'Unknown',
                    localTimeString: new Date().toString(),
                    tier: 'failed',
                    message: 'Failed to resolve a precise time zone; returning the default system time instead.'
                };
            } finally {
                clearTimeout(globalTimer);
            }
        }
    });

    async function runInternal(globalSignal) {
        let timeZone = 'Unknown';
        const date = new Date();
        const offsetMinutes = date.getTimezoneOffset();
        
        // 1. 브라우저 내장 API 시도 (가장 빠르고 정확함)
        try {
            if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
                timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
            }
        } catch (_) {}

        // 2. 브라우저 내장 API가 실패했거나 응답이 불확실한 경우 최후 안전망 (IP API 병렬 폴백)[cite: 4]
        if (timeZone === 'Unknown') {
            const ipTimePromises = [
                fetchWithTimeout('https://worldtimeapi.org/api/ip', 2000, globalSignal)
                    .then(res => res.json())
                    .then(data => data.timezone),
                fetchWithTimeout('https://ipapi.co/json/', 2000, globalSignal)
                    .then(res => res.json())
                    .then(data => data.timezone)
            ];
            
            try {
                // 여러 IP 시간대 인스턴스 중 가장 먼저 응답하는 것을 채택[cite: 4]
                timeZone = await getFirstSuccess(ipTimePromises);
            } catch (_) {
                // 병렬 네트워크 폴백까지 모두 실패 시 Unknown 유지[cite: 4]
            }
        }

        const sign = offsetMinutes > 0 ? '-' : '+';
        const offsetHoursStr = String(Math.abs(Math.floor(offsetMinutes / 60))).padStart(2, '0');
        const offsetMinsStr = String(Math.abs(offsetMinutes % 60)).padStart(2, '0');

        return {
            timeZone: timeZone,
            offsetMinutes: offsetMinutes,
            offsetString: `GMT${sign}${offsetHoursStr}${offsetMinsStr}`,
            localTimeString: date.toString(),
            utcString: date.toUTCString(),
            tier: timeZone !== 'Unknown' ? 'primary' : 'fallback'
        };
    }
})();