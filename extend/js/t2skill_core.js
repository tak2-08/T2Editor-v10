// Path: T2Editor/extend/js/t2skill_core.js
//
// T2Skills — "Skill" 레지스트리 & 하네스 (코어)
// ============================================================================
// 클로드(Claude)의 Skill 기능을 참고했지만, 이 T2Editor 환경에는 코드 실행
// 샌드박스도 없고 연결된 LLM의 성능도 훨씬 낮다고 가정한다. 그래서 "파일 첨부 +
// 스크립트 실행"까지 가는 완전한 Skill이 아니라, 순수 텍스트 지침(+ 선택적
// 녹화 절차 요약)만 다루는 경량판으로 구현한다. 이 파일 내부에서만 이걸
// "Skill-lite"라고 부르고, 바깥(README, UI, 변수/함수 이름, 콘솔 로그 등)에는
// 전부 그냥 "Skill"이라고만 부른다 — 사용자/제3자 개발자가 굳이 "lite"라는
// 축소판 인상을 받을 필요가 없기 때문이다.
//
// Skill과 Tool(t2ai_core.js)의 차이:
//   · Tool = 즉시 실행 가능한 함수(run). "무엇을 하는가"의 능력.
//   · Skill = 실행되지 않는 지침 텍스트(body). "어떤 상황에서, 어떤 절차로
//     Tool/T2LLM DSL을 조합해 써야 하는가"에 대한 사람 대상/LLM 대상 설명서.
//     Skill 자신은 아무것도 실행하지 않는다 — LLM이 Skill 본문을 읽고, 이미
//     존재하는 T2AITools/T2LLM 능력을 스스로 호출해 절차를 따라간다.
//
// ── 두 가지 출처(source) ────────────────────────────────────────────────────
//   1) server  — 관리자가 t2ai_tool_*.js와 똑같은 방식으로, 이 폴더
//      (extend/js/)에 t2skill_*.js 파일을 올려서 T2Skills.register()를
//      호출한다. 파일 하나 = Skill 하나. 지우면 그 Skill만 사라진다.
//   2) user    — 유저가 브라우저에서 직접 만든 Skill. 서버에는 절대 저장되지
//      않고 localStorage에만 저장된다(다른 사람/다른 기기와 공유되지 않음).
//      만드는 방법 3가지(전부 ai_complex 플러그인이 UI로 제공):
//        a. 수동 작성 — 이름/트리거 설명/본문을 직접 타이핑
//        b. LLM과 대화로 생성 — 채팅에서 LLM에게 부탁해 초안을 받고, 검토 후 저장
//        c. 화면에서 직접 시연(recording) — t2skill_recorder.js로 편집 동작을
//           녹화한 뒤, 그 기록을 LLM에게 주고(설명 덧붙이기 가능) 초안을 받아
//           검토 후 저장
//      어느 방법이든 "LLM이 초안을 만들어도 저장은 항상 사람이 검토 후 확정"
//      원칙은 동일하다 — 자동 저장은 없다.
//
// ── LLM에게 노출되는 방식: 새 프로토콜 없이 기존 Tool 브릿지에 편승 ─────────
// ai_complex.js ↔ 서버 API의 tool-calling 왕복 프로토콜(client_tools/
// _pending_tool_calls/tool_results)은 이미 완성되어 있다. Skill을 위해 이
// 프로토콜을 한 글자도 바꾸지 않는다 — 대신 이 코어가 T2AITools(t2ai_core.js)
// 레지스트리에 아주 평범한 Tool 두 개를 스스로 등록한다:
//   · list_skills : 지금 켜져 있는 Skill들의 이름+트리거 설명만 반환(가벼움)
//   · load_skill   : 이름을 넘기면 그 Skill의 전체 지침(body)을 반환
// 클로드의 Skill이 "이름+설명은 항상 보이고, 본문은 필요할 때만 불러온다"는
// 점진적 노출(progressive disclosure) 원칙을 그대로 흉내낸 것이다. 즉
// LLM은 우선 list_skills로 무엇이 있는지 훑어보고, 필요하다 싶으면
// load_skill로 그 하나만 본문을 읽어 절차를 따라간다. 등록된 Skill이 하나도
// 없으면 이 두 Tool 자체를 등록하지 않는다(불필요한 Tool을 광고하지 않음).
//
// ── 이 파일이 하지 않는 일 ──────────────────────────────────────────────────
// t2ai_core.js/t2llm.js와 동일하게, 이 코어는 어떤 LLM API도 직접 호출하지
// 않는다. "지침을 저장/조회/노출"하는 순수 레지스트리 + 하네스일 뿐이며,
// 언제 어떤 LLM에게 이 지침을 읽힐지는 전부 바깥(여기서는 ai_complex.js가
// 이미 구현해 둔 Tool 왕복 루프)이 결정한다. 서드파티 개발자가 이 코어를
// 자기 자신의 API 연결부에 붙이고 싶다면, window.T2Skills 의 공개 함수들만
// 호출하면 된다(register/list/get/load 등) — 그 이상의 결합은 없다.
// ============================================================================

(function () {
    'use strict';

    if (window.T2Skills) return; // 중복 로드 방어(핫스왑은 register()로 충분)

    // ── 이름 검증 (t2ai_core.js와 동일 규칙: 소문자/숫자/언더스코어) ─────────
    function validName(name) {
        return typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name);
    }

    function validateSkillDef(def, { requireBody = true } = {}) {
        if (!def || typeof def !== 'object') return T2Utils.tf('t2skill.err_skill_not_object', {}, 'skill definition is not an object');
        if (!validName(def.name)) return T2Utils.tf('t2skill.err_skill_name_invalid', {name: def && def.name}, 'name "' + (def && def.name) + '" format invalid (lowercase/numbers/underscore only)');
        if (!def.description || typeof def.description !== 'string') return T2Utils.tf('t2skill.err_skill_desc_missing', {}, 'description (trigger description) is missing');
        if (requireBody && (!def.body || typeof def.body !== 'string')) return T2Utils.tf('t2skill.err_skill_body_missing', {}, 'body (instruction body) is missing');
        return null;
    }

    // ── 서버 측(파일 기반) Skill 레지스트리 — t2ai_core.js의 registry와 동일 패턴 ──
    const serverRegistry = new Map();

    // ── 유저 측(localStorage) Skill 저장소 ──────────────────────────────────
    const USER_SKILLS_KEY = 't2skill_user_v1';
    const DISABLED_SKILLS_KEY = 't2skill_disabled_v1';

    function loadUserSkills() {
        try {
            const raw = window.localStorage.getItem(USER_SKILLS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function saveUserSkillsRaw(list) {
        try {
            window.localStorage.setItem(USER_SKILLS_KEY, JSON.stringify(list));
            return true;
        } catch (_) {
            return false; // 프라이빗 모드 등 저장 실패 — 이번 세션 메모리에는 남아있음
        }
    }

    let userSkills = loadUserSkills();

    function loadDisabled() {
        try {
            const raw = window.localStorage.getItem(DISABLED_SKILLS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr.filter(n => typeof n === 'string') : []);
        } catch (_) {
            return new Set();
        }
    }

    function saveDisabled(set) {
        try {
            window.localStorage.setItem(DISABLED_SKILLS_KEY, JSON.stringify(Array.from(set)));
        } catch (_) { /* 저장 실패해도 이번 세션 메모리 상태로 계속 동작 */ }
    }

    const disabledSkills = loadDisabled();

    // ── 병합 조회 헬퍼 ───────────────────────────────────────────────────────
    // 서버 Skill과 유저 Skill의 이름이 겹치면 유저 쪽을 우선한다 — 유저가
    // "이 서버 기본 Skill 대신 내가 고친 버전을 쓰고 싶다"는 상황을 자연스럽게
    // 허용한다(서버 파일을 건드리지 않고도 로컬에서 오버라이드 가능).
    function findRaw(name) {
        const u = userSkills.find(s => s.name === name);
        if (u) return { def: u, source: 'user' };
        const s = serverRegistry.get(name);
        if (s) return { def: s, source: 'server' };
        return null;
    }

    function mergedNames() {
        const names = new Set();
        serverRegistry.forEach((_, n) => names.add(n));
        userSkills.forEach(s => names.add(s.name));
        return Array.from(names);
    }

    // ── T2AITools 브릿지: list_skills / load_skill 메타 Tool ────────────────
    // Skill 목록이 바뀔 때마다(등록/삭제/토글) 다시 호출해 메타 Tool의
    // 등록 상태를 최신으로 맞춘다. T2AITools.register()는 같은 name으로
    // 다시 불러도 안전하게 덮어쓰므로 매번 새로 register해도 문제 없다.
    function syncMetaTools() {
        if (!window.T2AITools || typeof window.T2AITools.register !== 'function') return;

        const hasAny = mergedNames().length > 0;
        if (!hasAny) {
            if (typeof window.T2AITools.unregister === 'function') {
                window.T2AITools.unregister('list_skills');
                window.T2AITools.unregister('load_skill');
            }
            return;
        }

        window.T2AITools.register({
            name: 'list_skills',
            description: 'Quickly check the names and trigger descriptions of the Skills (task procedure guides) currently available. Skim this first before a task that might need guidance.',
            params: {},
            source: 't2skill_core.js',
            async run() {
                const list = T2Skills.list().filter(s => s.enabled);
                if (!list.length) return { skills: [], message: 'No skills are currently available (enabled).' };
                return { skills: list.map(s => ({ name: s.name, description: s.description })) };
            },
        });

        window.T2AITools.register({
            name: 'load_skill',
            description: 'Load the full instructions (body) of the named Skill. Check the exact name via list_skills first, then call this.',
            params: { name: 'The exact name of the skill to load (the "name" value from list_skills\' result)' },
            source: 't2skill_core.js',
            async run(args) {
                return T2Skills.load(args && args.name);
            },
        });
    }

    const T2Skills = {
        // ── 서버 측 등록(관리자/제3자 개발자용) ─────────────────────────────
        register(def) {
            const err = validateSkillDef(def);
            if (err) {
                console.error(T2Utils.tf('t2skill.console_register_failed', {err: err}, '[T2Skills] Server skill registration failed: ' + err), def);
                return false;
            }
            serverRegistry.set(def.name, {
                name: def.name,
                description: def.description,
                body: def.body,
                source: def.source || null, // 예: 어떤 파일에서 왔는지(디버깅용)
            });
            syncMetaTools();
            return true;
        },

        unregister(name) {
            const ok = serverRegistry.delete(name);
            syncMetaTools();
            return ok;
        },

        // ── 유저 측 CRUD(localStorage) ───────────────────────────────────
        // origin: 'manual' | 'chat' | 'record' — ai_complex.js가 UI 표시용으로
        // 넘겨준다(어떤 방법으로 만들었는지). 필수는 아니다.
        saveUserSkill(def) {
            const err = validateSkillDef(def);
            if (err) return { ok: false, error: err };
            if (serverRegistry.has(def.name) && !userSkills.some(s => s.name === def.name)) {
                // 서버 Skill과 이름이 같은 "새" 유저 Skill을 막 만드는 경우만
                // 경고한다(이미 오버라이드로 존재하던 경우는 그대로 수정 허용).
                console.warn(T2Utils.tf('t2skill.console_name_conflict', {name: def.name}, '[T2Skills] "' + def.name + '" has the same name as a server skill — saving will make the user version take priority in this browser.'));
            }
            const now = Date.now();
            const idx = userSkills.findIndex(s => s.name === def.name);
            const record = {
                name: def.name,
                description: def.description,
                body: def.body,
                origin: def.origin || 'manual',
                createdAt: idx >= 0 ? userSkills[idx].createdAt : now,
                updatedAt: now,
            };
            if (idx >= 0) userSkills[idx] = record; else userSkills.push(record);
            if (!saveUserSkillsRaw(userSkills)) return { ok: false, error: T2Utils.tf('t2skill.err_save_failed_localstorage', {}, 'Save failed (browser storage unavailable — e.g. private mode).') };
            syncMetaTools();
            return { ok: true, skill: record };
        },

        deleteUserSkill(name) {
            const before = userSkills.length;
            userSkills = userSkills.filter(s => s.name !== name);
            if (userSkills.length === before) return false;
            saveUserSkillsRaw(userSkills);
            syncMetaTools();
            return true;
        },

        listUserSkills() {
            return userSkills.slice();
        },

        // ── 병합 조회(서버 + 유저) ───────────────────────────────────────
        list() {
            return mergedNames().map(name => {
                const found = findRaw(name);
                return {
                    name,
                    description: found.def.description,
                    source: found.source,
                    editable: found.source === 'user',
                    enabled: this.isEnabled(name),
                };
            });
        },

        get(name) {
            const found = findRaw(name);
            if (!found) return null;
            return { name, description: found.def.description, body: found.def.body, source: found.source };
        },

        // ── on/off (DB 없이 localStorage만) ──────────────────────────────
        isEnabled(name) {
            return !disabledSkills.has(name);
        },

        setEnabled(name, enabled) {
            if (enabled) disabledSkills.delete(name); else disabledSkills.add(name);
            saveDisabled(disabledSkills);
            return true;
        },

        // ── load_skill 메타 Tool이 실제로 호출하는 조회 함수 ────────────────
        // 존재하지 않거나 꺼져 있으면 throw — T2AIHarness.run()이 이걸 잡아
        // { ok:false, error } 로 LLM에게 명확히 알려준다.
        load(name) {
            if (!validName(name)) throw new Error(`Unknown skill name: "${name}"`);
            const found = findRaw(name);
            if (!found) throw new Error(`Skill "${name}" was not found. Check the name with list_skills first.`);
            if (!this.isEnabled(name)) throw new Error(`Skill "${name}" is currently turned off (disabled by the user).`);
            return { name, description: found.def.description, body: found.def.body, source: found.source };
        },

        // ── ai_complex.js 등 소비자용 UI 목록 ────────────────────────────
        listUI() {
            return this.list().map(s => ({ ...s }));
        },

        // 디버깅/콘솔용 사람이 읽을 수 있는 요약(선택 기능).
        spec() {
            const list = this.list().filter(s => s.enabled);
            if (!list.length) return 'T2Skills — no skills are currently available (enabled).';
            return ['T2Skills — registered skills:', ''].concat(
                list.map(s => `● ${s.name} [${s.source}] — ${s.description}`)
            ).join('\n');
        },

        _serverRegistry: serverRegistry, // 디버깅/방어용 직접 노출
    };

    window.T2Skills = T2Skills;

    // T2AITools가 이 파일보다 먼저 로드되어 있으면 즉시 동기화, 늦게 로드되면
    // (알파벳 순 로딩 순서상 보통은 이미 있지만, 순서가 바뀌는 상황을 방어)
    // 짧게 몇 번만 재시도한다. t2ai_core.js 쪽은 register()가 몇 번을 불러도
    // 안전하므로 과도한 재시도로 인한 부작용은 없다.
    syncMetaTools();
    if (!window.T2AITools) {
        let tries = 0;
        const retry = setInterval(() => {
            tries++;
            if (window.T2AITools) { syncMetaTools(); clearInterval(retry); }
            else if (tries > 20) clearInterval(retry); // 약 10초 후 포기(코어 자체가 없는 페이지)
        }, 500);
    }
})();
