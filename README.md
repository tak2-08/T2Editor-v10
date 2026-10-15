# T2Editor v10 — 배포본 아카이브

T2Editor v10 계열의 배포본 9개(10.0.0 ~ 10.5.1)를 보관한 아카이브입니다. 추후 업데이트가 있을 수 있습니다.

> 상태: 현행 공개 판본입니다. v1~v9는 모두 EOL(지원 종료)입니다. v11은 별도 저장소에서 개발 중이며, T2Editor v10은 LTS(약 2028년까지)입니다.

| 모양 | 위치 | 설명 |
|---|---|---|
| 브랜치 | `releases/v<판본>` | 해당 판본의 배포본을 펼쳐놓은 소스입니다. 브랜치 루트가 서버에 올리는 `t2editor/` 폴더와 동일합니다. |
| 태그 | `v<판본>` | 위 브랜치와 같은 커밋을 가리킵니다. `git checkout v10.5.1`로 해당 시점 트리를 확인하실 수 있습니다. |
| 릴리즈 | [Releases](https://github.com/tak2-08/T2Editor-v10/releases) | 원본 ZIP 에셋(sha256 대조값 포함)이 올라갑니다. |

- ZIP 합계: 35.9 MB · 판본 수: 9개 · 상태: 현행 공개 판본  
- 계열 전체 지원 상태 및 아카이브: [v1](https://github.com/tak2-08/T2Editor-v1) · [v2](https://github.com/tak2-08/T2Editor-v2) · [v3](https://github.com/tak2-08/T2Editor-v3) · [v4](https://github.com/tak2-08/T2Editor-v4) · [v5](https://github.com/tak2-08/T2Editor-v5) · [v6](https://github.com/tak2-08/T2Editor-v6) · [v7](https://github.com/tak2-08/T2Editor-v7) · [v8](https://github.com/tak2-08/T2Editor-v8) · [v9](https://github.com/tak2-08/T2Editor-v9)  
- 참고: v11은 이 저장소의 아카이브 범위에 포함되어 있지 않으며, 별도 저장소([tak2-08/T2Editor-v11](https://github.com/tak2-08/T2Editor-v11))에서 관리됩니다.

> 가져오기 안내 — 배포본이 필요하신 경우 릴리즈 에셋 ZIP을 이용하시면 원본 그대로 받으실 수 있고, sha256으로 무결성 확인이 가능합니다. 소스만 확인할 때는 `git clone --branch releases/v<판본> --depth 1` 또는 `git checkout v<판본>`을 권장합니다.

---

## 지원 상태

| 계열 | 상태 | 최종 판본 | 최종 배포일 | 아카이브 |
|---|---|---|---|---|
| v1 | EOL | `1.6.3` | 2025-05-01 | [T2Editor-v1](https://github.com/tak2-08/T2Editor-v1) |
| v2 | EOL | `2.0.0` | 2025-06-03 | [T2Editor-v2](https://github.com/tak2-08/T2Editor-v2) |
| v3 | EOL | `3.0.9` | 2025-10-06 | [T2Editor-v3](https://github.com/tak2-08/T2Editor-v3) |
| v4 | EOL | `4.0.2` | 2025-10-08 | [T2Editor-v4](https://github.com/tak2-08/T2Editor-v4) |
| v5 | EOL | `5.10.0` | 2025-12-08 | [T2Editor-v5](https://github.com/tak2-08/T2Editor-v5) |
| v6 | EOL | `6.0.0` | 2025-12-09 | [T2Editor-v6](https://github.com/tak2-08/T2Editor-v6) |
| v7 | EOL | `7.0.2` | 2025-12-19 | [T2Editor-v7](https://github.com/tak2-08/T2Editor-v7) |
| v8 | EOL | `8.2.0` | 2026-03-26 | [T2Editor-v8](https://github.com/tak2-08/T2Editor-v8) |
| v9 | EOL | `9.3.0` | 2026-05-29 | [T2Editor-v9](https://github.com/tak2-08/T2Editor-v9) |
| v10 | 현행 공개 판본 | `10.5.1` | 2026-07-27 | T2Editor-v10 |
| v11 | 개발 중 | — | — | 별도 저장소([tak2-08/T2Editor-v11](https://github.com/tak2-08/T2Editor-v11)) |

v10은 2026-07-27 기준 최신 공개 판본입니다. v11은 개발 중이며 별도 저장소에서 진행되고 있습니다.

---

## 저작권 안내 (Copyright Notice)

**T2Editor의 저작권은 Tak2 (dsclub.kr)에게 있습니다.**

아래는 T2Editor 배포본 `readme.txt`의 전문 원문 그대로입니다. 원본 파일은 저장소 루트의 [`readme.txt`](readme.txt)에 있습니다.

> sha256 `d46dc52442a19ef201c0e77baed96a7eaf39ed758d2797a53b5bb8d0c0e5716a`

```text
Path: T2Editor/readme.txt
ver_11.0.0
date_2026.09.08
Copyright (c) 2025 Tak2 (dsclub.kr)
The_first.license_License_ko.txt & License_en.txt
email_dsclub2023@gmail.com

-___-

T2Editor License_Ko
Version: 3.0.0
Initial development period: 2025.01.23 - 2025.02.11
Copyright (c) 2025 Tak2 (dsclub.kr)

[한국어 버전]

저작권 및 소유권:
T2Editor의 저작권은 Tak2(dsclub.kr)에게 있습니다.
이메일: dsclub2023@gmail.com

사용 권한:
1. dsclub.kr에서 배포하는 T2Editor 코어 파일 및 기본 제공 플러그인:
   - 사용, 복사, 수정, 재배포 가능
   - 모든 배포물(수정본 포함)은 무료로 제공해야 함
   - 상업적 판매 금지

2. 외부 자체 개발 플러그인 및 관련 서비스:
   - T2Editor와 연동되는 독자 개발 플러그인의 유료 판매 허용
   - 자체 개발 플러그인 기반 유료 서비스(구독형 등) 제공 허용
   - 단, dsclub.kr 기본 제공 소프트웨어는 무료로 유지되어야 함
   - 플러그인은 T2Editor 본체의 핵심 기능을 무단으로 변경·우회·비활성화할 수 없음
   - 배포 시 "T2Editor 호환 플러그인"임을 명시해야 하며, DSc 또는 Tak2의 공식 제품으로 오인될 수 있는 표현은 사용할 수 없음
   - 유료 판매로 발생하는 수익, 환불, 분쟁, 세금 등 일체의 책임은 해당 개발자 본인에게 있음
   - DSc는 플러그인의 품질·보안성·지속 운영을 보증하지 않으며, 부적절하다고 판단되는 플러그인의 유통을 제한할 수 있음
   - T2 서비스의 코드, API, 호환 구조는 사전 공지 없이도 변경될 수 있으며, 이로 인해 서드파티 플러그인의 호환성이 깨지거나 정상 작동하지 않게 되�[...]

3. 파생 에디터 개발:
   - T2Editor를 기반으로 한 새로운 브랜드의 에디터 개발 허용
   - 단, 파생된 에디터 또한 본 약관, DSc의 정책, T2Editor 라이선스를 우선적으로 따라야 하며, 이에 반하는 별도 약관이나 정책을 적용할 수 없음

책임의 한계:
T2 서비스는 무상으로 제공되는 도구입니다. T2 서비스의 이용 과정에서 발생하는 데이터 손실, 콘텐츠 분쟁, 제3자와의 법적 분쟁, 기타 직·간접적 손��[...]

약관의 개정:
DSc는 운영상 필요에 따라 본 약관을 개정할 수 있습니다. 약관이 개정되는 경우 적용 전 dsclub.kr 공지사항을 통해 사전에 고지하며, 개정된 약관은 공지[...]

서비스 변경, 중단 및 유료화:
DSc는 운영상·정책상 사정에 따라 사전 공지를 통해 T2 서비스의 내용을 변경하거나, 서비스의 일부 또는 전부를 중단할 수 있습니다. 또한 T2 서비스는 [...]

코드 및 호환 구조 변경에 대한 고지:
T2 서비스(T2Editor 및 연계 서비스 포함)의 소스코드, 내부 구조, API, 호환 방식 등은 DSc(dsclub.kr) 및 Tak2의 운영상 사정에 따라 사전 공지 없이 언제든지 변[...]

약관의 우선순위 및 서비스 종료 시 적용 기준:
T2Editor를 비롯한 dsclub 산하의 모든 T2 서비스는 dsclub.kr 공지사항 게시판에 게시된 약관 및 그 개정 내용을 우선적으로 따릅니다. DSc(dsclub.kr) 커뮤니티에[...]

제한사항:
- 저작권 고지 제거 또는 수정 금지
- dsclub.kr 기본 배포 파일의 상업적 판매 금지
- readme.txt 변경·삭제 또는 누락 후 재배포 금지

배포 및 문의:
최신 버전: https://dsclub.kr/service/editor
사용 안내: https://dsclub.kr/service/editor

이 라이선스는 2026년 6월 29일부터 유효합니다.

-___-

T2Editor License_En
Version: 3.0.0
Initial development period: 2025.01.23 - 2025.02.11
Copyright (c) 2025 Tak2 (dsclub.kr)

[English Version]

Copyright and Ownership:
T2Editor is copyrighted by Tak2 (dsclub.kr)
Email: dsclub2023@gmail.com

Usage Rights:
1. T2Editor core files and bundled plugins distributed by dsclub.kr:
   - Free to use, copy, modify, and redistribute
   - All distributions (including modified versions) must be provided free of charge
   - Commercial sale prohibited

2. Third-party developed plugins and related services:
   - Commercial sale of independently developed plugins that integrate with T2Editor is permitted
   - Paid services (e.g., subscription-based) based on third-party plugins are permitted
   - Core software distributed by dsclub.kr must remain free
   - Plugins may not modify, bypass, or disable core functions of T2Editor without authorization
   - Plugins must be clearly labeled as "T2Editor-compatible plugins" and must not use language that could be mistaken for an official DSc or Tak2 product
   - All responsibility for revenue, refunds, disputes, and taxes arising from paid plugin sales rests solely with the developer
   - DSc does not guarantee the quality, security, or continued operability of any plugin, and may restrict the distribution of plugins it deems inappropriate
   - The code, API, and compatibility structure of T2 Services may change at any time without prior notice, and DSc and Tak2 bear no responsibility for any resulting plugin incompatibility or malfunct[...]

3. Development of derivative editors:
   - Development of a new, separately branded editor based on T2Editor is permitted
   - However, any such derivative editor must first and foremost comply with these Terms, DSc's policies, and the T2Editor license, and may not apply separate terms or policies that conflict with them

Limitation of Liability:
T2 Services are provided free of charge. DSc (dsclub.kr) and Tak2 bear no liability for any data loss, content disputes, disputes with third parties, or other direct or indirect damages arising from t[...]

Amendment of Terms:
DSc may amend these Terms as operationally necessary. Any amendment will be announced in advance via a notice on dsclub.kr prior to taking effect. Amended Terms apply to new versions released after th[...]

Service Changes, Suspension, and Monetization:
DSc may, for operational or policy reasons and with advance notice, change the content of T2 Services or suspend part or all of them. Although T2 Services are currently provided free of charge, DSc ma[...]

Notice Regarding Changes to Code and Compatibility Structure:
The source code, internal structure, APIs, and compatibility methods of T2 Services (including T2Editor and linked services) may be changed at any time without prior notice, at the operational discret[...]

Order of Precedence and Terms Applicable Upon Service Termination:
All T2 Services under dsclub, including T2Editor, are governed primarily by the Terms posted on the dsclub.kr notice board and any amendments thereto. In the event that the DSc (dsclub.kr) community e[...]

Restrictions:
- Removal or modification of copyright notices is prohibited
- Commercial sale of core files distributed by dsclub.kr is prohibited
- Redistribution without readme.txt, or with a modified or deleted readme.txt, is prohibited

Distribution and Contact:
Latest version: https://dsclub.kr/service/editor
How to use: https://dsclub.kr/service/editor

This license is valid from June 29, 2026.
[번역 디렉터리 책임 분리]
- locales/<locale>.json: T2Editor 순수 코어 번역만 담당
- plugin/<plugin>/locales/<locale>.json: 해당 플러그인 번역만 담당
- extend/locales/<locale>.json: /extend 번들 확장 번역만 담당
- 플러그인 번역이 없거나 JSON 오류가 있어도 플러그인 등록/실행은 계속됨
- 플러그인은 자신의 폴더명과 같은 번역 네임스페이스만 주입 가능
자세한 내용: locales/README.txt, plugin/readme-locales.txt

# T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
```

판본별 라이선스 원문 위치:

| 위치 | 내용 |
|---|---|
| 저장소 루트 `readme.txt` | 최신 배포본(T2Editor v11)의 라이선스 원문(Version 3.0.0) |
| 본 README의 위 절 | 같은 원문 전문 |
| 각 릴리즈 노트 「저작권 안내」 | 판본별 유효 라이선스 명시 |
| `licenses/` | 판본에 실제로 적용되었던 라이선스 원문 파일들 |
| `releases/v<판본>` 트리의 `readme.txt` | 해당 판본 배포본 내 원문 |

### 이 시리즈 판본에 적용되는 라이선스

`readme.txt`의 「약관의 우선순위 및 서비스 종료 시 적용 기준」에 따라, 이미 배포된 소프트웨어 제품은 배포 시점에 유효했던 라이선스 조건을 따릅니다.

| 판본 | 배포일 | 배포 시점 유효 라이선스 | 판본 안 원문 위치 |
|---|---|---|---|
| `v10.0.0` | 2026-06-24 | 3.0.0 | `readme.txt` |
| `v10.0.1` | 2026-06-27 | 3.0.0 | `readme.txt` |
| `v10.1.0` | 2026-06-29 | 3.0.0 | `readme.txt` |
| `v10.2.0` | 2026-07-05 | 3.0.0 | `readme.txt` |
| `v10.3.0` | 2026-07-16 | 3.0.0 | `readme.txt` |
| `v10.3.1` | 2026-07-20 | 3.0.0 | `readme.txt` |
| `v10.4.0` | 2026-07-20 | 3.0.0 | `readme.txt` |
| `v10.5.0` | 2026-07-22 | 3.0.0 | `readme.txt` |
| `v10.5.1` | 2026-07-27 | 3.0.0 | `readme.txt` |

판본별로 유효했던 라이선스 원문:
- `licenses/readme-license-3.0.0.txt`
- `licenses/License_ko-v1.0.txt`
- `licenses/License_en-v1.0.txt`

공통 제한: 상업적 판매 금지 · 저작권 고지 제거·수정 금지 · readme.txt 변경·삭제·누락 후 재배포 금지 · 모든 배포는 무료입니다.

---

## 판본표 (오래된 순)

아래 판본 표의 sha256 값은 배포 API에서 제공한 무결성 값입니다. 에셋을 받으신 뒤 해당 값과 대조하시기 바랍니다.

| # | 판본 | 배포일 | 라이선스 | ZIP | 크기 | sha256 (앞 16자) |
|---:|---|---|---|---|---:|---|
| 1 | [`v10.0.0`](releases/tag/v10.0.0) | 2026-06-24 | 3.0.0 | `10.0.0.zip` | 2.49 MB | `12ab7ff8dd3e298a` |
| 2 | [`v10.0.1`](releases/tag/v10.0.1) | 2026-06-27 | 3.0.0 | `10.0.1.zip` | 2.49 MB | `d1606a6cc4df187c` |
| 3 | [`v10.1.0`](releases/tag/v10.1.0) | 2026-06-29 | 3.0.0 | `10.1.0.zip` | 2.50 MB | `429c8214ad691acf` |
| 4 | [`v10.2.0`](releases/tag/v10.2.0) | 2026-07-05 | 3.0.0 | `10.2.0.zip` | 2.66 MB | `14d74e34326f7227` |
| 5 | [`v10.3.0`](releases/tag/v10.3.0) | 2026-07-16 | 3.0.0 | `10.3.0.zip` | 3.10 MB | `14ea813a28b00425` |
| 6 | [`v10.3.1`](releases/tag/v10.3.1) | 2026-07-20 | 3.0.0 | `10.3.1.zip` | 3.12 MB | `4921b73ea601d531` |
| 7 | [`v10.4.0`](releases/tag/v10.4.0) | 2026-07-20 | 3.0.0 | `10.4.0.zip` | 6.50 MB | `93fc5900c437cd33` |
| 8 | [`v10.5.0`](releases/tag/v10.5.0) | 2026-07-22 | 3.0.0 | `10.5.0.zip` | 6.54 MB | `f4855419fd0b573f` |
| 9 | [`v10.5.1`](releases/tag/v10.5.1) | 2026-07-27 | 3.0.0 | `10.5.1.zip` | 6.55 MB | `9ded2e84dee85ee7` |

전수 목록(릴리즈 노트 전문 포함)은 `MANIFEST.md` 및 기계 판독용 `manifest.json`을 참조하시기 바랍니다.

---

## 출처와 무결성

| 항목 | 값 |
|---|---|
| 배포 페이지 | https://dsclub.kr/service/editor |
| 배포 API | `https://dsclub.kr/api/t2editor/version/index.php?action=list` |
| 판본 수 | 9 |
| 수집 시점 | 2026-09-27 |
| sha256 | 배포 API가 판본별로 제공한 값이며, 이 저장소의 값과 전 판본 일치합니다. |
| ZIP | 원본 그대로(압축 해제·수정 없음) |
| 브랜치 루트 | ZIP 안 최상위 `t2editor/` 접두사를 제거한 트리입니다. 서버에 올릴 때 이 루트를 `t2editor/`로 이름 붙이면 됩니다. |
| 제외 대상 | `__MACOSX/`(ZIP 메타데이터), 빈 디렉터리 엔트리 |
| 파일 모드 | ZIP이 지정한 실행 비트를 따르고, 그 외 파일은 일반적으로 644/755로 배포됩니다. |

### 배포본 표기 불일치 (원문 그대로 기록)
아카이브 원칙에 따라 원본의 불일치는 수정하지 않고 그대로 기록합니다. 자세한 불일치 항목은 원문을 참조하십시오.

---

## 자주 쓰는 명령

```bash
# 특정 판본 소스만 받기
git clone --depth 1 --branch releases/v10.5.1 https://github.com/tak2-08/T2Editor-v10.git t2editor-10.5.1

# 태그로 특정 시점 트리
git fetch --depth 1 origin tag v10.5.1

# 에셋 무결성 확인
sha256sum 10.5.1.zip   # 위 표 또는 manifest.json의 값과 대조
```

## 문의

T2Editor 관련 문의는 dsclub2023@gmail.com으로 연락해 주시고, 최신 배포 및 사용 안내는 https://dsclub.kr/service/editor 를 참고해 주십시오.
