# T2Editor I18N Polyfill (Self-hosted FormatJS-compatible runtime)

## 개요
이 폴더는 T2Editor 10.2.1-beta2+ 의 다국어(i18n) 시스템을 구동하기 위한
자체 호스팅 폴리필을 제공합니다. CDN 을 사용하지 않고 자체 서버에서
모든 자원을 호스팅하기 위해 작성되었습니다.

## 파일 구성

### `t2i18n-polyfill.js` (자체 구현 폴리필)
- FormatJS (`@formatjs/intl-messageformat`) 의 핵심 기능을 자체 구현
- ICU MessageFormat 문법 호환:
  - 단순 변수: `{name}` → "World"
  - 복수형: `{count, plural, =0 {none} one {item} other {# items}}`
  - 선택: `{gender, select, male {he} female {she} other {they}}`
  - 숫자 포맷: `{count, number}` → "1,234"
  - 중첩: `{count, plural, one {{name} has one} other {{name} has many}}`
- 네이티브 `Intl.NumberFormat`, `Intl.PluralRules` 이 없는 구형 브라우저에서
  최소한의 호환 런타임 제공
- 모던 브라우저에서는 네이티브 API 우선 사용

## 로드 방식
1. `editor.lib.php` 가 클라이언트 브라우저를 감지하여 필요시 폴리필 스크립트를 주입
2. `js/i18n.js` 는 `window.T2I18NPolyfill` 또는 네이티브 `Intl` 중 사용 가능한 것을 사용
3. 모던 브라우저에서는 폴리필이 사실상 no-op (중복 로드 방지 로직 내장)

## 네이티브 Intl 지원 현황
- `Intl.NumberFormat`: IE11+, Chrome 24+, Firefox 29+, Safari 10+
- `Intl.PluralRules`: Chrome 63+, Firefox 58+, Safari 13+, **IE11 미지원**
- `Intl.MessageFormat`: 표준이 아님 (FormatJS 자체 API)
→ 모던 브라우저에서도 ICU MessageFormat 파싱은 이 폴리필 또는 FormatJS 라이브러리 필요

## 참고
- 원본 FormatJS 프로젝트: https://formatjs.github.io/
- 이 폴리필은 FormatJS 의 모든 기능을 대체하지 않음 — T2Editor 사용 사례에 맞춘 경량화 버전
- 복잡한 ICU 기능이 필요하면 `@formatjs/intl-messageformat` 패키지를 별도 호스팅하여 교체 가능
