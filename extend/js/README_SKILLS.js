// Path: T2Editor/extend/js/README_SKILLS.js
// (파일명이 README로 시작하므로 자동 로더가 이 파일을 <script>로 출력하지 않습니다.
//  순수 문서용 파일입니다.)
//
// ============================================================================
// T2Editor Skill 만들기 — 가이드
// ============================================================================
//
// "Skill"이란 무엇인가: 클로드(Claude)의 Skill 기능에서 아이디어를 가져왔다.
// LLM이 어떤 상황에서, 어떤 절차로 이미 있는 능력(Tool/T2LLM DSL)을 조합해
// 써야 하는지 적어둔 "작업 지침서"다. Skill 자신은 아무것도 실행하지 않는다
// — 실행은 언제나 T2AIHarness.run()(Tool)이나 T2LLM.apply()(콘텐츠 삽입)가
// 담당하고, Skill은 그 둘을 "어떻게 조합할지"만 텍스트로 안내한다.
//
// (내부적으로만 "Skill-lite"라고 부르는 이유: 클로드의 Skill은 파일 첨부나
//  코드 실행 스크립트까지 포함하지만, 이 환경엔 그런 실행 샌드박스가 없고
//  연결되는 LLM의 성능도 낮다고 가정한다. 그래서 순수 지침 텍스트 + 선택적
//  절차 요약만 다루는 경량판으로 구현했다. 하지만 이 사실을 사용자나
//  다른 개발자에게 굳이 노출할 필요는 없어서, 바깥으로는 그냥 "Skill"이라고만
//  부른다 — 변수명, 함수명, UI 문구, 이 문서 어디에도 "lite"라는 말은
//  T2Skills 코어 파일 자신의 주석 말고는 등장하지 않는다.)
//
// ── Skill vs Tool ────────────────────────────────────────────────────────────
//   Tool  (t2ai_core.js, t2ai_tool_*.js) — "무엇을 할 수 있는가"의 능력.
//         즉시 실행 가능한 run() 함수 하나.
//   Skill (t2skill_core.js, t2skill_*.js) — "언제, 어떤 순서로" 그 능력들을
//         써야 하는지 적은 지침. 실행 함수가 없다(body는 텍스트일 뿐).
//
// ── 서버 측(관리자/제3자 개발자) — t2ai_tool_*.js와 완전히 같은 패턴 ──────────
//
//   // Path: T2Editor/extend/js/t2skill_my_procedure.js
//   (function () {
//       'use strict';
//       if (!window.T2Skills) {
//           console.warn('[T2Skill] t2skill_core.js 미로드 — 등록 건너뜀');
//           return;
//       }
//
//       T2Skills.register({
//           name: 'my_procedure',                 // 소문자/숫자/언더스코어만, 고유해야 함
//           description: '언제 이 Skill을 써야 하는지 — 트리거 조건을 LLM이 판단할 수 있게 1~2문장으로.',
//           // body는 LLM이 필요할 때만 불러와서 읽는 "전체 지침"이다.
//           // T2LLM DSL 태그 이름, T2AITools Tool 이름 등을 자유롭게 언급해도
//           // 된다 — LLM은 이미 그 두 스펙(T2LLM.spec(), T2AIHarness.spec())을
//           // 알고 있다고 가정하고 절차만 적으면 된다.
//           body: [
//               '1. list_skills로 이 Skill이 켜져 있는지 확인했다면, 다음 순서로 진행한다.',
//               '2. 문서에 표가 필요하면 T2LLM DSL의 TABLE: 태그로 구조를 만들고,',
//               '   각 셀 내용은 TROW: 라인으로 이어붙인다.',
//               '3. ...',
//           ].join('\n'),
//           source: 't2skill_my_procedure.js',     // 선택, 디버깅용
//       });
//   })();
//
// ── 규칙(Tool과 동일) ────────────────────────────────────────────────────────
// 1. 파일명은 t2skill_ 로 시작하는 게 관례(필수는 아니지만 정렬·식별에 도움).
// 2. 다른 t2skill_*.js/t2ai_tool_*.js 파일을 절대 import/참조하지 않는다.
// 3. window.T2Skills / window.T2AITools(브릿지 등록용, 코어가 대신 처리)에만
//    의존한다 — 이 파일이 직접 T2AITools.register()를 부를 필요는 없다.
// 4. register()는 같은 name으로 다시 불러도 에러 없이 덮어쓴다.
// 5. 지우면 그 Skill만 사라진다. 코어(t2skill_core.js)나 다른 Skill/Tool
//    파일에는 전혀 영향이 없다.
//
// ── LLM에게 어떻게 보이는가 (프로토콜 변경 없음) ─────────────────────────────
// ai_complex.js ↔ 서버 API의 tool-calling 왕복(client_tools/
// _pending_tool_calls/tool_results)은 이미 존재하는 그대로 재사용된다.
// t2skill_core.js가 알아서 list_skills / load_skill 이라는 평범한 Tool
// 두 개를 T2AITools에 등록해두기 때문에, 서버나 ai_complex.js의 요청/응답
// 형식을 한 글자도 바꾸지 않고도 LLM이:
//   1) list_skills 호출 → 켜져 있는 모든 Skill의 이름+트리거 설명만 가볍게 확인
//   2) 필요하다 싶은 Skill 하나를 load_skill(name) 로 호출 → 전체 지침(body) 확인
//   3) 그 지침을 따라 이미 있는 Tool/T2LLM DSL을 스스로 호출
// 을 할 수 있게 된다. 등록된 Skill이 하나도 없으면 이 두 Tool 자체가
// T2AITools에서 사라진다(불필요한 것을 광고하지 않음).
//
// ── 유저 측(로컬) Skill — 서버에는 절대 저장되지 않음 ────────────────────────
// 일반 유저는 서버에 파일을 올릴 수 없으므로, ai_complex 플러그인의 "스킬"
// 탭이 제공하는 UI로 브라우저 localStorage에만 저장되는 Skill을 만든다.
// 만드는 방법 3가지(전부 검토 후 직접 "저장" 눌러야 확정 — 자동 저장 없음):
//   a. 수동 작성 — 이름/트리거 설명/지침 본문을 직접 입력.
//   b. LLM과 대화로 생성 — 채팅에서 원하는 절차를 설명하면 LLM이
//      \`\`\`skill 코드블록으로 초안(이름/설명/본문)을 제안하고, 그걸 검토
//      폼에 채워 넣어 확인 후 저장한다.
//   c. 화면에서 직접 시연(녹화) — t2skill_recorder.js로 에디터에서 실제로
//      작업을 수행하면 대략적인 절차 요약(+ 시작/종료 시점 문서 스냅샷)을
//      기록하고, 거기에 유저가 설명을 덧붙여 LLM에게 넘기면 마찬가지로
//      \`\`\`skill 초안을 받아 검토 후 저장한다.
// 프로그램적으로 직접 CRUD하고 싶다면:
//   T2Skills.saveUserSkill({ name, description, body, origin? })
//   T2Skills.deleteUserSkill(name)
//   T2Skills.listUserSkills()
//
// ── on/off ───────────────────────────────────────────────────────────────────
// T2Skills.setEnabled(name, boolean) — localStorage에만 저장되며(서버 없음),
// 꺼진 Skill은 load_skill 호출 시 즉시 거부되고 list_skills 결과에도
// 나타나지 않는다(t2ai_core.js의 Tool on/off와 동일한 철학).
//
// ── 이 코어(t2skill_core.js) 자체를 고치거나 완전히 빼고 싶다면 ─────────────
// t2ai_core.js와 똑같이, 레지스트리 동작만 다루는 작은 파일이다.
// t2skill_core.js와 t2skill_*.js 전부를 지우면 Skill 기능 전체가 사라지고
// (T2AITools의 list_skills/load_skill도 자동으로 사라짐), Tool/T2LLM 등
// 나머지 어떤 것도 이 파일들의 존재를 전제하지 않으므로 아무것도 깨지지
// 않는다. ai_complex.js의 "스킬" 탭은 window.T2Skills가 없으면 빈 목록과
// 안내 문구만 보여주고 조용히 동작을 멈춘다.
//
// ── 서드파티 개발자를 위한 참고 ──────────────────────────────────────────────
// t2ai_core.js/t2llm.js와 동일하게, 이 코어는 어떤 LLM API도 직접 호출하지
// 않는다. 자체 API 연결부를 만들고 싶다면 window.T2Skills.list()/get()/
// load()만 있으면 충분하며(그리고 실행은 window.T2AITools/T2AIHarness가
// 이미 제공), 그 위에서 언제·어떻게 LLM을 호출할지는 전부 여러분의 몫이다.
// ============================================================================
