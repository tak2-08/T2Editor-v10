// Path: T2Editor/extend/js/t2ai_tool_unit_convert.js
//
// T2Editor AI Tool — convert_unit
// ============================================================================
// 길이/무게/부피/온도/속도/데이터 용량 단위를 서로 변환한다. 순수 계산만
// 하므로 외부 API를 전혀 쓰지 않고, 네트워크 상태와 무관하게 항상 동작한다.
//
// 이 파일 하나만 지워도 다른 어떤 Tool·T2LLM·플러그인에도 영향이 없다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 convert_unit 등록을 건너뜁니다.');
        return;
    }

    // 카테고리별로 "기준 단위(base)" 하나를 정해두고, 각 단위 → base 배율만
    // 저장한다. base로 한 번 바꿨다가 목표 단위로 다시 나누면 임의의 두
    // 단위 사이를 바로 변환할 수 있다(온도만 배율이 아니라 별도 함수 필요).
    const LINEAR_CATEGORIES = {
        length: {
            base: 'm',
            units: {
                mm: 0.001, cm: 0.01, m: 1, km: 1000,
                in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344,
            },
        },
        weight: {
            base: 'g',
            units: {
                mg: 0.001, g: 1, kg: 1000, t: 1000000,
                oz: 28.349523125, lb: 453.59237,
            },
        },
        volume: {
            base: 'ml',
            units: {
                ml: 1, l: 1000,
                tsp: 4.92892, tbsp: 14.7868, cup: 236.588,
                floz: 29.5735, pt: 473.176, qt: 946.353, gal: 3785.41,
            },
        },
        speed: {
            base: 'ms', // m/s
            units: {
                ms: 1, kmh: 1000 / 3600, mph: 1609.344 / 3600,
                knot: 1852 / 3600, fts: 0.3048,
            },
        },
        data: {
            base: 'b', // byte, 1000진법(저장매체 표기 기준)
            units: {
                b: 1, kb: 1000, mb: 1000 ** 2, gb: 1000 ** 3, tb: 1000 ** 4,
                kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
            },
        },
    };

    // 사람이 흔히 쓰는 표기를 내부 키로 정규화(대소문자, 공백, 흔한 별칭).
    const ALIASES = {
        meter: 'm', meters: 'm', metre: 'm', metres: 'm',
        kilometer: 'km', kilometers: 'km',
        centimeter: 'cm', centimeters: 'cm',
        millimeter: 'mm', millimeters: 'mm',
        inch: 'in', inches: 'in',
        foot: 'ft', feet: 'ft',
        yard: 'yd', yards: 'yd',
        mile: 'mi', miles: 'mi',
        gram: 'g', grams: 'g',
        kilogram: 'kg', kilograms: 'kg',
        milligram: 'mg', milligrams: 'mg',
        ton: 't', tonne: 't', tonnes: 't',
        ounce: 'oz', ounces: 'oz',
        pound: 'lb', pounds: 'lb', lbs: 'lb',
        liter: 'l', liters: 'l', litre: 'l', litres: 'l',
        milliliter: 'ml', milliliters: 'ml',
        teaspoon: 'tsp', tablespoon: 'tbsp',
        cups: 'cup',
        'fl oz': 'floz', fluidounce: 'floz',
        pint: 'pt', pints: 'pt',
        quart: 'qt', quarts: 'qt',
        gallon: 'gal', gallons: 'gal',
        celsius: 'c', centigrade: 'c', '°c': 'c',
        fahrenheit: 'f', '°f': 'f',
        kelvin: 'k',
        'km/h': 'kmh', kph: 'kmh',
        'mi/h': 'mph',
        'm/s': 'ms', mps: 'ms',
        'ft/s': 'fts', fps: 'fts',
        knots: 'knot', kn: 'knot',
        byte: 'b', bytes: 'b',
        kilobyte: 'kb', kilobytes: 'kb',
        megabyte: 'mb', megabytes: 'mb',
        gigabyte: 'gb', gigabytes: 'gb',
        terabyte: 'tb', terabytes: 'tb',
        kibibyte: 'kib', mebibyte: 'mib', gibibyte: 'gib', tebibyte: 'tib',
    };

    function normalizeUnit(raw) {
        let u = String(raw || '').trim().toLowerCase();
        u = u.replace(/\s+/g, ' ').trim();
        if (ALIASES[u]) return ALIASES[u];
        u = u.replace(/\s/g, '');
        if (ALIASES[u]) return ALIASES[u];
        return u;
    }

    function findCategory(unit) {
        if (unit === 'c' || unit === 'f' || unit === 'k') return 'temperature';
        for (const [cat, def] of Object.entries(LINEAR_CATEGORIES)) {
            if (Object.prototype.hasOwnProperty.call(def.units, unit)) return cat;
        }
        return null;
    }

    function toCelsius(value, unit) {
        if (unit === 'c') return value;
        if (unit === 'f') return (value - 32) * (5 / 9);
        if (unit === 'k') return value - 273.15;
        throw new Error(`알 수 없는 온도 단위: ${unit}`);
    }

    function fromCelsius(value, unit) {
        if (unit === 'c') return value;
        if (unit === 'f') return value * (9 / 5) + 32;
        if (unit === 'k') return value + 273.15;
        throw new Error(`알 수 없는 온도 단위: ${unit}`);
    }

    function convertLinear(category, value, fromUnit, toUnit) {
        const def = LINEAR_CATEGORIES[category];
        const fromFactor = def.units[fromUnit];
        const toFactor = def.units[toUnit];
        if (fromFactor == null) throw new Error(`"${fromUnit}"은(는) ${category} 카테고리에서 지원하지 않는 단위입니다.`);
        if (toFactor == null) throw new Error(`"${toUnit}"은(는) ${category} 카테고리에서 지원하지 않는 단위입니다.`);
        const baseValue = value * fromFactor;
        return baseValue / toFactor;
    }

    function roundNice(n) {
        if (!isFinite(n)) return n;
        // 소수점 6자리까지 반올림 후, 불필요한 꼬리 0을 제거한다.
        const rounded = Math.round(n * 1e6) / 1e6;
        return rounded;
    }

    function supportedUnitsSummary() {
        const parts = Object.entries(LINEAR_CATEGORIES).map(
            ([cat, def]) => `${cat}(${Object.keys(def.units).join(', ')})`
        );
        parts.push('temperature(c, f, k)');
        return parts.join(' / ');
    }

    T2AITools.register({
        name: 'convert_unit',
        description: '길이·무게·부피·온도·속도·데이터 용량 단위를 서로 변환한다. 순수 계산만 수행하며 외부 API를 쓰지 않아 항상 사용 가능하다. from/to는 같은 카테고리에 속한 단위여야 한다(예: km→mi는 가능, km→kg는 불가).',
        params: {
            value: '변환할 숫자 값 (필수, 예: 10)',
            from: `변환 전 단위 (필수). 지원 단위: ${supportedUnitsSummary()}`,
            to: '변환 후 단위 (필수). from과 같은 카테고리여야 함.',
        },
        source: 't2ai_tool_unit_convert.js',
        ui: {
            label: '단위 변환',
            icon: 'straighten',
            description: '길이, 무게, 부피, 온도, 속도, 데이터 용량 단위를 서로 계산해서 바꿔줘요.',
            usage: '예: "10마일은 몇 km야?", "화씨 98.6도는 섭씨로 몇 도야?"처럼 물으면 바로 계산해줘요.',
        },
        group: 'calculators',

        async run(args) {
            const rawValue = args.value;
            const value = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
            if (rawValue == null || rawValue === '' || Number.isNaN(value)) {
                return { ok: false, message: 'value 가 유효한 숫자가 아닙니다.' };
            }

            const fromUnit = normalizeUnit(args.from);
            const toUnit = normalizeUnit(args.to);
            if (!fromUnit || !toUnit) {
                return { ok: false, message: 'from 과 to 단위를 모두 지정해야 합니다.' };
            }

            const fromCat = findCategory(fromUnit);
            const toCat = findCategory(toUnit);

            if (!fromCat) return { ok: false, message: `"${args.from}" 단위를 인식하지 못했습니다. 지원 단위: ${supportedUnitsSummary()}` };
            if (!toCat) return { ok: false, message: `"${args.to}" 단위를 인식하지 못했습니다. 지원 단위: ${supportedUnitsSummary()}` };
            if (fromCat !== toCat) {
                return { ok: false, message: `단위 카테고리가 서로 다릅니다 (${fromCat} → ${toCat}). 같은 카테고리 안의 단위끼리만 변환할 수 있습니다.` };
            }

            let result;
            try {
                result = fromCat === 'temperature'
                    ? fromCelsius(toCelsius(value, fromUnit), toUnit)
                    : convertLinear(fromCat, value, fromUnit, toUnit);
            } catch (e) {
                return { ok: false, message: e.message };
            }

            const rounded = roundNice(result);
            return {
                ok: true,
                category: fromCat,
                input: { value, unit: args.from },
                output: { value: rounded, unit: args.to },
                text: `${value} ${args.from} = ${rounded} ${args.to}`,
            };
        },
    });
})();
