// Path: T2Editor/extend/js/t2ai_tool_date_calculate.js
//
// T2Editor AI Tool — calculate_date
// ============================================================================
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
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 calculate_date 등록을 건너뜁니다.');
        return;
    }

    const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

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
        return { date: iso(dt), weekday: WEEKDAYS_KO[dt.getDay()] + '요일' };
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
        description: '날짜 계산기. (1) target을 지정하면 base와 target 사이의 날짜 차이와 디데이(D-N/D+N)를 계산한다. (2) add와 unit을 지정하면 base로부터 그만큼 더하거나 뺀 날짜를 계산한다(음수 add로 과거 계산 가능). (3) 아무 것도 지정하지 않으면 base(기본값: 오늘) 자체의 요일 등 기본 정보만 반환한다. target과 add는 동시에 지정하지 않는다.',
        params: {
            base: '선택. 기준 날짜, "YYYY-MM-DD" 형식. 생략 시 오늘(브라우저 로컬 기준).',
            target: '선택. 비교할 날짜, "YYYY-MM-DD" 형식. 지정하면 base와의 차이/디데이를 계산.',
            add: '선택. base에 더할 값(정수, 음수 가능). unit과 함께 사용.',
            unit: '선택. add의 단위: "days" | "weeks" | "months" | "years". 기본 "days".',
        },
        source: 't2ai_tool_date_calculate.js',
        ui: {
            label: '날짜 계산',
            icon: 'event',
            description: '두 날짜 사이 며칠 남았는지(디데이), 또는 특정 날짜에서 며칠/몇 달 뒤 날짜가 언제인지 계산해줘요.',
            usage: '예: "크리스마스까지 며칠 남았어?", "오늘부터 100일 후가 며칠이야?"처럼 물으면 계산해줘요.',
        },
        group: 'calculators',

        async run(args) {
            const base = args.base ? parseDateOnly(args.base) : todayLocal();
            if (!base) return { ok: false, message: `base 날짜 형식이 올바르지 않습니다: "${args.base}" (YYYY-MM-DD 형식 필요)` };

            const hasTarget = args.target != null && String(args.target).trim() !== '';
            const hasAdd = args.add != null && String(args.add).trim() !== '';

            if (hasTarget && hasAdd) {
                return { ok: false, message: 'target 과 add 는 동시에 지정할 수 없습니다. 둘 중 하나만 사용하세요.' };
            }

            if (hasTarget) {
                const target = parseDateOnly(args.target);
                if (!target) return { ok: false, message: `target 날짜 형식이 올바르지 않습니다: "${args.target}" (YYYY-MM-DD 형식 필요)` };
                const diffDays = Math.round((target.getTime() - base.getTime()) / 86400000);
                return {
                    ok: true,
                    mode: 'diff',
                    base: describe(base),
                    target: describe(target),
                    diffDays,
                    dday: ddayLabel(diffDays),
                    relation: diffDays === 0 ? '같은 날' : (diffDays > 0 ? `target이 base보다 ${diffDays}일 뒤` : `target이 base보다 ${Math.abs(diffDays)}일 전`),
                };
            }

            if (hasAdd) {
                const amount = parseInt(args.add, 10);
                if (Number.isNaN(amount)) return { ok: false, message: `add 값이 정수가 아닙니다: "${args.add}"` };
                const unit = args.unit ? String(args.unit).trim().toLowerCase() : 'days';
                let result;
                switch (unit) {
                    case 'days': result = new Date(base); result.setDate(result.getDate() + amount); break;
                    case 'weeks': result = new Date(base); result.setDate(result.getDate() + amount * 7); break;
                    case 'months': result = addMonths(base, amount); break;
                    case 'years': result = addYears(base, amount); break;
                    default: return { ok: false, message: `알 수 없는 unit: "${args.unit}" (days|weeks|months|years 중 하나)` };
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
