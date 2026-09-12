Path: T2Editor/locales/README.txt
T2Editor 코어 언어팩 규격
==========================

이 폴더는 T2Editor 순수 코어만 번역합니다.

포함 대상
- js/, config/, editor.lib.php 등 코어 UI
- common, editor, toolbar, translation, license, error 네임스페이스

포함 금지
- plugin/<name> 플러그인 번역
- extend/ 확장 모듈 번역

새 언어 등록
-------------
locales/fr.json 같은 UTF-8 JSON 파일을 추가합니다. 이 폴더의 루트 JSON만
언어 선택 목록을 등록할 수 있습니다.

{
  "_meta": {
    "code": "fr",
    "native": "Français",
    "language": "French",
    "direction": "ltr",
    "fallback": "en",
    "aliases": ["fr-FR", "fr-CA"],
    "version": "1.0.0",
    "default": false,
    "order": 100
  },
  "common": { "confirm": "Confirmer" },
  "editor": {},
  "toolbar": {},
  "translation": {},
  "license": {},
  "error": {}
}

플러그인 번역
-------------
각 플러그인은 자신의 폴더에 번역을 둡니다.

  plugin/my_plugin/locales/ko.json
  plugin/my_plugin/locales/en.json

자세한 규격은 plugin/README_LOCALES.txt를 참고하세요.

확장 모듈 번역
---------------
/extend에 포함되는 번들 확장은 extend/locales/<locale>.json을 사용합니다.

안전 제한
---------
- JSON만 읽으며 코드는 실행하지 않습니다.
- 파일 하나는 최대 4 MiB입니다.
- 잘못된 JSON은 무시되며 편집기와 플러그인 실행을 중단하지 않습니다.
- 플러그인 언어팩은 신규 편집기 언어를 등록할 수 없습니다.

# T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
