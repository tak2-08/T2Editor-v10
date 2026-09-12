// Path: T2Editor/extend/js/t2ai_tool_unit_convert.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — convert_unit
// 길이/무게/부피/온도/속도/데이터 용량 단위를 서로 변환한다. 순수 계산만
// 하므로 외부 API를 전혀 쓰지 않고, 네트워크 상태와 무관하게 항상 동작한다.
//
// 이 파일 하나만 지워도 다른 어떤 Tool·T2LLM·플러그인에도 영향이 없다.

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'convert_unit'}, '[T2AI] t2ai_core.js not loaded yet — skipping convert_unit registration.'));
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
        throw new Error(`Unknown temperature unit: ${unit}`);
    }

    function fromCelsius(value, unit) {
        if (unit === 'c') return value;
        if (unit === 'f') return value * (9 / 5) + 32;
        if (unit === 'k') return value + 273.15;
        throw new Error(`Unknown temperature unit: ${unit}`);
    }

    function convertLinear(category, value, fromUnit, toUnit) {
        const def = LINEAR_CATEGORIES[category];
        const fromFactor = def.units[fromUnit];
        const toFactor = def.units[toUnit];
        if (fromFactor == null) throw new Error(`"${fromUnit}" is not a supported unit in the ${category} category.`);
        if (toFactor == null) throw new Error(`"${toUnit}" is not a supported unit in the ${category} category.`);
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
        description: 'Converts between length/weight/volume/temperature/speed/data-size units. Pure calculation, no external API, always available. from/to must belong to the same category (e.g. km→mi works, km→kg does not).',
        params: {
            value: 'The numeric value to convert (required, e.g. 10)',
            from: `The source unit (required). Supported units: ${supportedUnitsSummary()}`,
            to: 'The target unit (required). Must be in the same category as from.',
        },
        source: 't2ai_tool_unit_convert.js',
        ui: {
            label: 'Unit Conversion',
            icon: 'straighten',
            description: 'Converts between length, weight, volume, temperature, speed, and data-size units.',
            usage: 'e.g. asking "how many km is 10 miles?" or "what\'s 98.6°F in Celsius?" triggers an instant calculation.',
        },
        group: 'calculators',

        async run(args) {
            const rawValue = args.value;
            const value = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
            if (rawValue == null || rawValue === '' || Number.isNaN(value)) {
                return { ok: false, message: 'value is not a valid number.' };
            }

            const fromUnit = normalizeUnit(args.from);
            const toUnit = normalizeUnit(args.to);
            if (!fromUnit || !toUnit) {
                return { ok: false, message: 'Both from and to units must be specified.' };
            }

            const fromCat = findCategory(fromUnit);
            const toCat = findCategory(toUnit);

            if (!fromCat) return { ok: false, message: `Unrecognized unit "${args.from}". Supported units: ${supportedUnitsSummary()}` };
            if (!toCat) return { ok: false, message: `Unrecognized unit "${args.to}". Supported units: ${supportedUnitsSummary()}` };
            if (fromCat !== toCat) {
                return { ok: false, message: `The unit categories differ (${fromCat} → ${toCat}). Conversion is only possible within the same category.` };
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
