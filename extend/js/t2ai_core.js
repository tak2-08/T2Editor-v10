// Path: T2Editor/extend/js/t2ai_core.js
//
// T2Editor AI — Tool 레지스트리 & 하네스 (코어)
// ============================================================================
// "T2Editor AI"의 정의: T2Editor를 조작할 수 있는 모든 것 — 즉 T2LLM(콘텐츠 작성/
// 편집 DSL)도, 이 파일이 제공하는 검색·조회형 Tool들도, 전부 T2Editor AI의 일부다.
// 기존 ai/ai_rearrange 플러그인의 "AI 버튼" 기능만이 T2Editor AI인 것은 아니다.
//
// 이 파일은 LLM 제조사(OpenAI/Anthropic 등)의 tool-calling 스펙을 그대로 흉내내지
// 않는다. 특정 벤더에 종속되지 않는, T2Editor 자체의 단순한 자체 규격을 쓴다:
//   툴 = { name, description, params: {필드: 설명 문자열}, run: async (args, ctx) => any }
// 이 정도 정보만 있으면 어떤 LLM이든(어떤 벤더의 tool-calling 포맷으로 감싸든)
// T2AIHarness.spec() 을 시스템 프롬프트에 붙여넣거나, 자체 JSON 스키마로 재포장해
// 사용할 수 있다.
//
// LLM API 연결부는 여기 없다 — 이 하네스는 "요청받은 툴을 실행해 결과를 돌려주는
// 실행기"일 뿐이며, 언제·어떻게 호출할지는 외부(사람이든 다른 자동화든 이미 실행
// 중인 LLM이든)가 결정한다.
//
// ── UI 메타데이터 & on/off (v1.1) ───────────────────────────────────────────
// ai_complex 플러그인 등 "유저가 눈으로 보고 켜고 끌 수 있는 Tool 목록" UI는
// 이 파일이 제공하는 register()의 `ui` 필드를 그대로 읽어서 그린다. 즉 Tool의
// 이름/사용법/설명 같은 사람 대상 문구는 ai_complex.js 같은 소비자 쪽에
// 하드코딩하지 않고, 그 Tool을 등록하는 t2ai_tool_*.js 파일 자신이 들고 있는다
// (Tool 파일 하나를 지우면 실행 능력은 물론 그 UI 문구도 함께 자동으로 사라짐).
//
//   ui: {
//     label:       '유저에게 보여줄 짧은 이름',
//     icon:        'material-icons 아이콘 이름',
//     description: '이 Tool이 하는 일 — 유저 눈높이로 lite하게 1~2문장',
//     usage:       '어떻게 트리거되는지 lite한 예시 1~2문장',
//   }
//   group: '선택. 같은 group을 공유하는 여러 Tool은 UI에는 한 항목으로만
//           묶여 보이고, on/off도 그룹 단위로 함께 적용된다. 생략 시 자기
//           name을 group으로 쓴다(= 단독 항목).'
//
// `ui`가 없는 Tool(내부용/보조용)은 목록 UI에 아예 나타나지 않는다 — 이 역시
// 하드코딩된 화이트리스트가 아니라, Tool 등록 시점에 스스로 선언하는 값이다.
//
// on/off 상태는 DB 없이 이 코어가 직접 브라우저 localStorage에만 저장한다.
// 꺼진 Tool은 T2AIHarness.run()에서 즉시 거부되고(LLM이 실제로 실행 못 함),
// spec()에도 노출되지 않는다 — UI의 "끔"이 실제로 "이번 대화에서 이 Tool을
// 못 쓰게 함"으로 이어지도록 하기 위함(단순히 화면 표시만 바뀌는 게 아님).
//
// ── 플러그인처럼 삭제하기 쉬운 구조 ─────────────────────────────────────────
// 개별 Tool은 t2ai_tool_*.js 각 파일이 담당하며, 이 코어와 register()/unregister()
// 로만 통신한다. 특정 Tool 파일 하나(예: dsclub API가 죽어서 못 쓰게 된 검색 툴)를
// 서버에서 지우기만 하면 그 툴만 사라지고 나머지는 전혀 영향받지 않는다.
// 이 코어 파일 자체가 사라져도(실수로 삭제되어도) 각 tool 파일은 안전하게
// 스스로 최소 레지스트리를 만들도록 방어되어 있어 전체 로딩이 깨지지 않는다.
// ============================================================================

(function () {
    'use strict';

    // 이미 다른 tool 파일이 로딩 순서상 먼저 실행되며 레지스트리를 생성해 두었을 수
    // 있으므로, 존재하면 재사용하고 없으면 새로 만든다 (로드 순서 무관하게 안전).
    if (window.T2AITools && window.T2AIHarness) return;

    const registry = window.T2AITools && window.T2AITools._store
        ? window.T2AITools._store
        : new Map();

    function validateToolDef(def) {
        if (!def || typeof def !== 'object') return 'tool 정의가 객체가 아닙니다';
        if (!def.name || typeof def.name !== 'string') return 'name 이 없습니다';
        if (!/^[a-z][a-z0-9_]*$/.test(def.name)) return `name "${def.name}" 형식이 올바르지 않습니다 (소문자/숫자/언더스코어)`;
        if (!def.description || typeof def.description !== 'string') return 'description 이 없습니다';
        if (typeof def.run !== 'function') return 'run 함수가 없습니다';
        return null;
    }

    // ui는 선택 필드이므로 등록 자체를 막지는 않는다 — 형식이 이상하면 그냥
    // "UI 없음"으로 취급(console.warn만) 해서 실행 능력(run)에는 영향이 없게 한다.
    function normalizeUI(ui, name) {
        if (ui == null) return null;
        if (typeof ui !== 'object' || !ui.label || !ui.description) {
            console.warn(`[T2AI] Tool "${name}"의 ui 필드 형식이 올바르지 않아 무시합니다 (label, description 필수).`);
            return null;
        }
        return {
            label: String(ui.label),
            icon: ui.icon ? String(ui.icon) : 'build',
            description: String(ui.description),
            usage: ui.usage ? String(ui.usage) : '',
        };
    }

    // ── on/off 상태 저장소 — DB 없이 브라우저 localStorage만 사용 ──────────────
    // group 단위로 저장한다(그룹 미지정 Tool은 자기 name이 곧 group).
    // 클로드 채팅의 "tool on/off"와 동일한 개념: 서버가 아니라 이 브라우저에만
    // 기억되며, 꺼진 그룹은 실제로 run()이 거부된다(아래 T2AIHarness.run 참조).
    const DISABLED_GROUPS_KEY = 't2ai_disabled_tools_v1';

    function loadDisabledGroups() {
        try {
            const raw = window.localStorage.getItem(DISABLED_GROUPS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(arr) ? arr.filter(g => typeof g === 'string') : []);
        } catch (_) {
            return new Set();
        }
    }

    function saveDisabledGroups(set) {
        try {
            window.localStorage.setItem(DISABLED_GROUPS_KEY, JSON.stringify(Array.from(set)));
        } catch (_) {
            // 저장 실패해도(프라이빗 모드 등) 이번 세션 메모리 상태로는 계속 동작
        }
    }

    // 이미 다른 t2ai_core.js 사본이 만들어 둔 상태가 있으면 재사용(로드 순서 방어)
    const disabledGroups = (window.T2AITools && window.T2AITools._disabledGroups)
        ? window.T2AITools._disabledGroups
        : loadDisabledGroups();

    function groupOf(tool) {
        return (tool && tool.group) || (tool && tool.name);
    }

    const T2AITools = {
        /**
         * 새 Tool을 등록한다. 동일 name이 이미 있으면 덮어쓴다(핫스왑 허용 —
         * 개발 중 파일을 고쳐 다시 로드해도 에러 없이 최신 정의로 교체된다).
         */
        register(def) {
            const err = validateToolDef(def);
            if (err) {
                console.error(`[T2AI] Tool 등록 실패: ${err}`, def);
                return false;
            }
            registry.set(def.name, {
                name: def.name,
                description: def.description,
                params: def.params || {},
                run: def.run,
                source: def.source || null, // 예: 어떤 확장 파일에서 왔는지(디버깅용, 선택)
                ui: normalizeUI(def.ui, def.name),   // 유저 대상 표시 정보(없으면 UI 목록에서 제외)
                group: def.group ? String(def.group) : def.name, // on/off를 함께 적용할 묶음
                // Tool 스스로 선언하는 위험 신호: run()이 에디터 DOM을 즉시,
                // 되돌릴 수 없게 직접 변경한다면(예: 이미지 블록 즉시 삽입)
                // true로 선언한다. "문서 전체를 비우고 새로 채우는"(예: AI
                // 재구성/rearrange의 mode:'replace') 흐름과 같은 요청에 함께
                // 노출되면, 도구가 이미 심어둔 변경이 그 즉시 통째로 사라지는
                // 사고가 나므로, 소비자(ai_complex.js 등)가 그런 흐름에서는
                // 이 값을 보고 스스로 걸러낼 수 있게 한다. 코어나 다른 파일이
                // 특정 Tool 이름을 하드코딩해 예외처리하지 않아도 되도록,
                // 위험 여부를 아는 당사자(이 Tool 파일 자신)가 직접 선언한다.
                unsafeForReplace: def.unsafeForReplace === true,
            });
            return true;
        },

        /** Tool 제거. 존재하지 않아도 조용히 무시(멱등). */
        unregister(name) {
            return registry.delete(name);
        },

        has(name) {
            return registry.has(name);
        },

        get(name) {
            return registry.get(name) || null;
        },

        /** 등록된 모든 Tool의 메타데이터(실행 함수 제외) 목록. */
        list() {
            return Array.from(registry.values()).map(t => ({
                name: t.name, description: t.description, params: t.params,
                unsafeForReplace: !!t.unsafeForReplace,
            }));
        },

        // ── on/off ──────────────────────────────────────────────────────────
        /** 이 Tool(정확히는 그룹)이 현재 실행 가능한 상태인지. 미등록 Tool은 true. */
        isEnabled(name) {
            const tool = registry.get(name);
            if (!tool) return true;
            return !disabledGroups.has(groupOf(tool));
        },

        /** 그룹 단위 on/off. name으로 하나만 넘겨도 같은 group의 나머지도 함께 바뀐다. */
        setEnabled(name, enabled) {
            const tool = registry.get(name);
            const group = tool ? groupOf(tool) : name; // 미등록 group 문자열도 허용(선반영 대비)
            if (enabled) disabledGroups.delete(group);
            else disabledGroups.add(group);
            saveDisabledGroups(disabledGroups);
            return true;
        },

        /**
         * 유저에게 "이 Tool 켜져 있음/꺼져 있음"을 보여주고 토글할 수 있는 UI용
         * 목록. `ui` 필드를 선언한 Tool만 포함되며(내부/보조 Tool은 자동 제외),
         * 같은 group을 공유하는 Tool들은 한 항목으로 묶인다(대표: 그룹 내 첫
         * 번째로 등록된 Tool의 ui 정보 사용). 이름/설명/사용법 문구는 전부 각
         * t2ai_tool_*.js 파일이 register() 시 넘긴 값 그대로다 — 이 코어나
         * ai_complex.js 어디에도 하드코딩되어 있지 않다.
         */
        listUI() {
            const byGroup = new Map();
            registry.forEach((tool) => {
                if (!tool.ui) return;
                const group = groupOf(tool);
                if (!byGroup.has(group)) {
                    byGroup.set(group, {
                        id: group,
                        name: tool.name,
                        label: tool.ui.label,
                        icon: tool.ui.icon,
                        description: tool.ui.description,
                        usage: tool.ui.usage,
                        enabled: this.isEnabled(tool.name),
                    });
                }
            });
            return Array.from(byGroup.values());
        },

        /** 내부 저장소 직접 노출 — 다른 t2ai_core.js 사본과의 병합용(로드 순서 방어). */
        _store: registry,
        _disabledGroups: disabledGroups,

        // ── 공용 유틸: 에디터 인스턴스 탐색 ─────────────────────────────────
        // editor.lib.php 는 인스턴스를 window[textareaId + '_editor'] 에 노출한다.
        // 여러 Tool이 동일 로직을 반복 구현하지 않도록 코어에서 한 번만 제공한다.
        findEditors() {
            const found = [];
            for (const key in window) {
                if (!key.endsWith('_editor')) continue;
                let val;
                try { val = window[key]; } catch (_) { continue; }
                if (val && typeof val === 'object' && val.editor && typeof val.getPlugin === 'function') {
                    found.push({ id: key.slice(0, -'_editor'.length), instance: val });
                }
            }
            return found;
        },

        resolveEditor(id) {
            const list = this.findEditors();
            if (!list.length) return null;
            if (!id) return list[0].instance;
            const hit = list.find(e => e.id === id);
            return hit ? hit.instance : null;
        },
    };

    const T2AIHarness = {
        version: '1.0',

        /**
         * 단일 Tool 실행. 표준화된 결과 { ok, data?, error? } 반환.
         * Tool의 run() 내부 예외를 여기서 잡아 하네스 차원에서 절대 throw하지 않는다
         * (LLM 쪽 호출 루프가 매번 try/catch를 직접 구현하지 않아도 되게).
         */
        async run(toolName, args, ctx) {
            const tool = registry.get(toolName);
            if (!tool) {
                return { ok: false, error: `알 수 없는 Tool: "${toolName}". T2AIHarness.spec() 으로 사용 가능한 목록을 확인하세요.` };
            }
            if (!T2AITools.isEnabled(toolName)) {
                const label = tool.ui ? tool.ui.label : toolName;
                return { ok: false, error: `"${label}" Tool은 현재 꺼져 있습니다(유저가 껐음). 편집기의 AI 패널에서 다시 켤 수 있습니다.` };
            }
            try {
                const data = await tool.run(args || {}, ctx || {});
                return { ok: true, data };
            } catch (e) {
                console.error(`[T2AI] Tool "${toolName}" 실행 중 오류:`, e);
                return { ok: false, error: (e && e.message) ? e.message : String(e) };
            }
        },

        /** 여러 Tool을 순차 실행. calls = [{tool, args}]. 하나 실패해도 나머지는 계속 진행. */
        async runMany(calls) {
            const results = [];
            for (const call of (calls || [])) {
                results.push({
                    tool: call.tool,
                    ...(await this.run(call.tool, call.args)),
                });
            }
            return results;
        },

        /** 사람도 LLM도 읽을 수 있는 전체 Tool 목록 스펙. 시스템 프롬프트에 그대로 붙여넣기 좋음.
         *  유저가 꺼둔 Tool은 여기서도 제외된다 — LLM이 애초에 "쓸 수 있는 척" 시도조차 하지 않도록. */
        spec() {
            const tools = T2AITools.list().filter(t => T2AITools.isEnabled(t.name));
            if (!tools.length) {
                return 'T2Editor AI — 현재 사용 가능한(켜져 있는) Tool이 없습니다.';
            }
            const lines = ['T2Editor AI Tools — 아래 이름으로 T2AIHarness.run(name, args) 호출:', ''];
            tools.forEach(t => {
                lines.push(`● ${t.name} — ${t.description}`);
                const paramEntries = Object.entries(t.params || {});
                if (paramEntries.length) {
                    paramEntries.forEach(([k, v]) => lines.push(`    - ${k}: ${v}`));
                } else {
                    lines.push('    (인자 없음)');
                }
            });
            lines.push('', '사용법: const result = await T2AIHarness.run("도구이름", {인자});');
            lines.push('결과 형식: { ok: true, data } 또는 { ok: false, error }');
            return lines.join('\n');
        },
    };

    window.T2AITools = T2AITools;
    window.T2AIHarness = T2AIHarness;
})();
