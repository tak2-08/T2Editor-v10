// Path: T2Editor/extend/js/t2ai_tool_date_calculate.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — calculate_date
// 날짜 계산기. 세 가지를 한 Tool에서 처리한다(각각 별도 파일로 쪼갤 만큼
// 복잡하지 않고, LLM 입장에서도 "날짜 관련 계산은 이 하나"로 묶여 있는 게
// 더 찾기 쉽다):
//   1) target 지정 → base와 target 사이의 날짜 차이(디데이 포함)
//   2) add(+unit) 지정 → base에서 며칠/몇 주/몇 개월/몇 년 뒤(또는 전) 날짜
//   3) 아무 것도 안 주면 → base(기본 오늘) 자체의 요일 등 기본 정보
//
// 순수 계산만 하므로 외부 API를 쓰지 않고, base가 없으면 로컬 "오늘"을
// 쓰므로 get_user_timezone Tool과 함께 쓰면(먼저 타임존을 확인한 뒤 base로
// 넘기는 식) 더 정확해진다 — 다만 이 Tool 자체는 그 Tool을 참조하지 않는다
// (Tool 간 서로 몰라야 한다는 규칙 준수).

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'calculate_date'}, '[T2AI] t2ai_core.js not loaded yet — skipping calculate_date registration.'));
        return;
    }

    const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function parseDateOnly(str) {
        const s = String(str || '').trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
        const dt = new Date(y, mo - 1, d);
        // 2월 30일처럼 존재하지 않는 날짜가 롤오버되는 것을 방지(입력 검증).
        if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
        return dt;
    }

    function todayLocal() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function iso(dt) {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function describe(dt) {
        return { date: iso(dt), weekday: WEEKDAYS_EN[dt.getDay()] };
    }

    function ddayLabel(diffDays) {
        if (diffDays === 0) return 'D-DAY';
        return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
    }

    // 1/31 + 1개월처럼 목표 월에 없는 날짜가 되면(예: 2월 31일), 다음 달로
    // 밀려버리는 JS Date의 기본 롤오버 대신 그 달의 마지막 날로 자연스럽게
    // 클램프한다(달력 계산기의 통상적인 동작). years도 윤년 2/29 케이스에서
    // 동일하게 적용된다.
    function addMonths(date, months) {
        const targetDay = date.getDate();
        const d = new Date(date);
        d.setDate(1); // 월 경계를 넘나드는 중간 계산에서 날짜 오버플로우 방지
        d.setMonth(d.getMonth() + months);
        const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(targetDay, lastDayOfTargetMonth));
        return d;
    }

    function addYears(date, years) {
        return addMonths(date, years * 12);
    }

    T2AITools.register({
        name: 'calculate_date',
        description: 'Date calculator. (1) If target is given, computes the day difference and D-day (D-N/D+N) between base and target. (2) If add and unit are given, computes the date that many units before/after base (a negative add gives a past date). (3) If neither is given, returns basic info (e.g. weekday) about base itself (default: today). Do not specify target and add at the same time.',
        params: {
            base: 'Optional. The reference date, in "YYYY-MM-DD" format. Defaults to today (browser local time) if omitted.',
            target: 'Optional. The date to compare against, in "YYYY-MM-DD" format. If given, computes the diff/D-day against base.',
            add: 'Optional. The amount to add to base (integer, can be negative). Used together with unit.',
            unit: 'Optional. The unit for add: "days" | "weeks" | "months" | "years". Defaults to "days".',
        },
        source: 't2ai_tool_date_calculate.js',
        ui: {
            label: 'Date Calculator',
            icon: 'event',
            description: 'Calculates how many days are left between two dates (D-day), or what date it will be a certain number of days/months from a given date.',
            usage: 'e.g. asking "how many days until Christmas?" or "what date is 100 days from today?" triggers a calculation.',
        },
        group: 'calculators',

        async run(args) {
            const base = args.base ? parseDateOnly(args.base) : todayLocal();
            if (!base) return { ok: false, message: `Invalid base date format: "${args.base}" (YYYY-MM-DD required)` };

            const hasTarget = args.target != null && String(args.target).trim() !== '';
            const hasAdd = args.add != null && String(args.add).trim() !== '';

            if (hasTarget && hasAdd) {
                return { ok: false, message: 'target and add cannot both be specified at the same time. Use only one of them.' };
            }

            if (hasTarget) {
                const target = parseDateOnly(args.target);
                if (!target) return { ok: false, message: `Invalid target date format: "${args.target}" (YYYY-MM-DD required)` };
                const diffDays = Math.round((target.getTime() - base.getTime()) / 86400000);
                return {
                    ok: true,
                    mode: 'diff',
                    base: describe(base),
                    target: describe(target),
                    diffDays,
                    dday: ddayLabel(diffDays),
                    relation: diffDays === 0 ? 'same day' : (diffDays > 0 ? `target is ${diffDays} day(s) after base` : `target is ${Math.abs(diffDays)} day(s) before base`),
                };
            }

            if (hasAdd) {
                const amount = parseInt(args.add, 10);
                if (Number.isNaN(amount)) return { ok: false, message: `add is not an integer: "${args.add}"` };
                const unit = args.unit ? String(args.unit).trim().toLowerCase() : 'days';
                let result;
                switch (unit) {
                    case 'days': result = new Date(base); result.setDate(result.getDate() + amount); break;
                    case 'weeks': result = new Date(base); result.setDate(result.getDate() + amount * 7); break;
                    case 'months': result = addMonths(base, amount); break;
                    case 'years': result = addYears(base, amount); break;
                    default: return { ok: false, message: `Unknown unit: "${args.unit}" (must be one of days|weeks|months|years)` };
                }
                return {
                    ok: true,
                    mode: 'add',
                    base: describe(base),
                    amount,
                    unit,
                    result: describe(result),
                };
            }

            return { ok: true, mode: 'info', base: describe(base) };
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
