// Path: T2Editor/extend/js/t2ai_tool_get_user_weather.js
(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 미로드 — get_weather 등록 건너뜀');
        return;
    }

    // ── 공통 설정 및 헬퍼 (search_web_open 기반) ──────────────────────────────
    const GLOBAL_TIMEOUT_MS = 5000; // 전체 실행 하드 상한 (5초)[cite: 4]
    const TIMEOUT_MS = 4000;        // 개별 API 요청 상한[cite: 4]

    // 구형 브라우저 지원 Promise.any 대체 함수[cite: 4]
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

    // 타임아웃 시그널 병합[cite: 4]
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
            return await fetch(url, { signal });
        } finally {
            cleanup();
        }
    }

    T2AITools.register({
        name: 'get_weather',
        description: '현재 위치나 특정 좌표/도시의 실시간 날씨 정보를 조회합니다. 다중 백엔드 병렬 폴백 지원.',
        params: {
            latitude: '선택. 위도 (예: 35.1796)',
            longitude: '선택. 경도 (예: 129.0756)',
            city: '선택. 도시 이름 (영문 권장, 예: "Seoul").'
        },
        source: 't2ai_tool_get_weather.js',
        ui: {
            label: '실시간 날씨 정보',
            icon: 'cloud',
            description: '현재 위치나 지정된 도시의 기온, 습도 등을 실시간으로 조회합니다.',
            usage: '날씨 확인이 필요할 때 호출합니다.',
        },
        group: 'environment_info',

        async run(args) {
            // 하드 상한용 Global AbortController 적용[cite: 4]
            const globalController = new AbortController();
            const globalTimer = setTimeout(() => globalController.abort(), GLOBAL_TIMEOUT_MS);

            try {
                return await runInternal(args || {}, globalController.signal);
            } catch (e) {
                // throw 대신 안전한 fallback 객체 반환으로 Upstream failed 차단[cite: 4]
                return {
                    success: false,
                    tier: 'failed',
                    message: `네트워크 지연 또는 위치 확인 실패로 날씨를 가져오지 못했습니다. (에러: ${e.message})`
                };
            } finally {
                clearTimeout(globalTimer);
            }
        }
    });

    async function runInternal(args, globalSignal) {
        let lat = args.latitude;
        let lon = args.longitude;
        const city = args.city ? String(args.city).trim() : '';

        // 1단계: 지오코딩 병렬 경쟁 (도시명이 있을 때)
        if ((!lat || !lon) && city) {
            const geoPromises = [
                fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, TIMEOUT_MS, globalSignal)
                    .then(res => res.json())
                    .then(data => ({ lat: data.results[0].latitude, lon: data.results[0].longitude })),
                fetchWithTimeout(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, TIMEOUT_MS, globalSignal)
                    .then(res => res.json())
                    .then(data => ({ lat: data[0].lat, lon: data[0].lon }))
            ];
            
            try {
                const coords = await getFirstSuccess(geoPromises); // 가장 빠른 지오코딩 결과 채택[cite: 4]
                lat = coords.lat;
                lon = coords.lon;
            } catch (_) { /* 실패 시 무시하고 다음으로 */ }
        }

        // 2단계: 날씨 API 병렬 경쟁 (Open-Meteo vs wttr.in)
        if (lat && lon) {
            const weatherPromises = [
                // 후보 1: Open-Meteo
                fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m&timezone=auto`, TIMEOUT_MS, globalSignal)
                    .then(async res => {
                        if (!res.ok) throw new Error('Open-Meteo HTTP error');
                        const d = await res.json();
                        return {
                            success: true, source: 'Open-Meteo',
                            temperature: `${d.current.temperature_2m}°C`,
                            feels_like: `${d.current.apparent_temperature}°C`,
                            humidity: `${d.current.relative_humidity_2m}%`,
                            wind_speed: `${d.current.wind_speed_10m} km/h`
                        };
                    }),
                // 후보 2: wttr.in
                fetchWithTimeout(`https://wttr.in/${lat},${lon}?format=j1`, TIMEOUT_MS, globalSignal)
                    .then(async res => {
                        if (!res.ok) throw new Error('wttr HTTP error');
                        const d = await res.json();
                        const current = d.current_condition[0];
                        return {
                            success: true, source: 'wttr.in',
                            temperature: `${current.temp_C}°C`,
                            feels_like: `${current.FeelsLikeC}°C`,
                            humidity: `${current.humidity}%`,
                            wind_speed: `${current.windspeedKmph} km/h`
                        };
                    })
            ];

            return await getFirstSuccess(weatherPromises); // 가장 먼저 응답한 결과 반환[cite: 4]
        }

        // 3단계: 최후 안전망 (IP 기반 추정) - 병렬 풀이 모두 실패하거나 좌표 획득을 못했을 때[cite: 4]
        const res = await fetchWithTimeout('https://wttr.in/?format=j1', TIMEOUT_MS, globalSignal);
        const data = await res.json();
        const current = data.current_condition[0];
        return {
            success: true,
            source: 'wttr.in (IP Fallback)',
            temperature: `${current.temp_C}°C`,
            humidity: `${current.humidity}%`,
            note: '정확한 위치 정보를 얻지 못해 IP 기반으로 추정된 날씨입니다.'
        };
    }
})();