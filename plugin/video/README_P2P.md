# Video P2P offload (HLS 전용)

## 무엇이 바뀌었나
HLS(m3u8) 소스를 재생할 때, 가능한 브라우저에서는 `hls.js` +
`p2p-media-loader` 를 사용해 시청자들끼리 WebRTC 로 세그먼트를 나눠받는다.
원 서버는 각 세그먼트를 "덜" 내려주게 되어 CPU/디스크 I/O/네트워크 대역폭
부담이 줄어든다.

## 추가/수정 파일
- `t2editor/vendor/hlsjs/hls.min.js` (신규, MIT) — 순정 hls.js 배포본
- `t2editor/vendor/p2p-media-loader/p2p-media-loader-hlsjs.iife.min.js`
  (신규, Apache-2.0) — Novage/p2p-media-loader 의 브라우저용 IIFE 번들
  (core + hlsjs 통합 포함, 별도 의존성 없음)
- `t2editor/plugin/video/video_p2p.js` (신규) — hls.js ↔ p2p-media-loader
  연결 및 장애 시 폴백 로직
- `t2editor/plugin/video/video_player.js` (수정)
  - `loadSource()` 를 분리해 HLS+P2P 지원 브라우저는 `video_p2p.js` 경로로,
    그 외에는 기존 `loadSourceLegacy()` (native `<video src>`) 로 보냄
  - 소스 전환/페이지 이탈 시 `teardownP2P()` 로 피어 연결 정리
  - 다운로드 방지용 fetch/XHR 가드가 HLS 소스 URL은 더 이상 차단하지
    않도록 예외 처리 (아래 "보안 트레이드오프" 참고)
  - 우측 컨트롤 바에 P2P 상태 배지 업데이트 로직 추가
- `t2editor/plugin/video/video_player.php` (수정)
  - HLS 소스일 때만 `hls.min.js` / `p2p-media-loader-hlsjs.iife.min.js` /
    `video_p2p.js` 를 로드 (MP4 등에는 영향/오버헤드 없음)
  - 컨트롤 바에 `data-p2p-badge` 엘리먼트 추가
- `t2editor/plugin/video/video_player.css` (수정) — 배지 스타일 추가

## 동작 방식 / 안정성 설계
1. **가능할 때만 P2P**: HLS 소스 + `Hls.isSupported()` + P2P 엔진 로드 성공
   + `RTCPeerConnection` 지원 조건을 모두 만족할 때만 P2P 경로를 탄다.
   Safari 등 **네이티브 HLS 지원 브라우저는 기존 방식 그대로** 유지한다
   (배터리/안정성 우선, 불필요한 변경 최소화).
2. **피어가 없어도 항상 재생됨**: p2p-media-loader 는 세그먼트를 피어에게
   못 받으면 자동으로 원 서버 HTTP 요청으로 즉시 전환한다
   (`httpDownloadTimeWindow` 를 `p2pDownloadTimeWindow` 보다 짧게 설정해
   HTTP 를 "선행 확보"로 우선 사용). 즉 최악의 경우에도 지금까지와 동일하게
   원 서버에서만 받아 재생된다 — 절대 P2P 에만 의존하지 않는다.
3. **3단계 폴백**: (a) hls.js 네트워크/미디어 fatal 에러 → 1회 자동 복구
   시도 → (b) 그래도 실패하면 P2P/hls.js 를 완전히 버리고
   `loadSourceLegacy()` (native HLS 또는 MP4) 로 전환 → (c) 그마저 불가능한
   브라우저는 처음부터 (2)로 감. 사용자에게는 토스트로만 안내되고 재생은
   끊기지 않도록 설계했다.
4. **NAT 통과(연결 성공률)**: 시그널링은 공개 WebTorrent 트래커
   (`wss://tracker.novage.com.ua`, `wss://tracker.openwebtorrent.com`) 를
   쓰고, ICE(STUN/TURN)는 이미 `video_chat.js` 가 쓰던
   `window.T2_WEBRTC_CONFIG_URL` 설정을 그대로 재사용한다. 관리자가
   `webrtc_turn_config.json` 에 TURN 서버를 지정해뒀다면 자동으로 같이
   적용된다 — 새 인프라 구축 불필요.
5. **정리(cleanup)**: 화질 전환/소스 재로드/페이지 이탈(`pagehide`) 시
   `hls.destroy()` + `p2pEngine.destroy()` 를 호출해 WebRTC 연결과 워커를
   정리한다.

## 보안 트레이드오프 (반드시 인지할 것)
기존 "다운로드 방지" 계층에는 `video URL 을 JS fetch()/XHR 로 직접 요청하면
SecurityError 를 던진다"는 가드가 있었다. 이 가드는 "브라우저 내부 미디어
엔진은 JS 를 거치지 않는다"는 전제로 만들어졌는데, **HLS+P2P 재생 자체가
JS 레벨 fetch/XHR 로 세그먼트를 받아오기 때문에 이 전제가 깨진다.**

그래서 이번 변경에서는 **HLS 타입 소스에 한해서만** 그 가드를 예외
처리했다 (MP4/WebM 등 프로그레시브 소스는 기존과 동일하게 완전히
차단됨). 실무적으로:
- 콘솔에서 `fetch(m3u8_URL)` 로 플레이리스트/세그먼트를 직접 받아가는 것은
  이제 막을 수 없다 (애초에 HLS 플레이리스트/세그먼트 URL 자체가 P2P
  스웜 시그널링을 통해 노출되는 정보이기도 하다).
- 워터마크, `captureStream()`/`MediaRecorder` 차단, headless 브라우저
  감지, 우클릭/단축키 차단 등 **나머지 다운로드 방지 계층은 그대로
  전부 유지**된다.
- 유료/민감 콘텐츠라 이 트레이드오프가 부담스럽다면, 해당 영상만
  P2P 를 끄고 기존처럼 MP4 소스로만 서빙하면 된다(HLS 소스가 없으면
  P2P 경로 자체가 아예 로드되지 않음).

## 남은 설정/확인 사항
- **CORS**: 세그먼트/플레이리스트가 플레이어와 동일 출처(같은 도메인)에서
  서빙된다는 전제로 만들었다 (`video_view.php`/업로드 데이터 폴더 구조상
  기본적으로 동일 출처). CDN 등 다른 오리진에서 서빙한다면 해당 오리진에
  `Access-Control-Allow-Origin` 헤더를 추가해야 hls.js/P2P 가 정상 동작한다.
- **HLS 멀티 화질**: 현재 `video_player.php` 는 소스를 1개만 만든다
  (`$payload['sources']`). 멀티 비트레이트 마스터 플레이리스트를 쓴다면
  hls.js 가 알아서 ABR 전환을 처리하므로 추가 작업은 필요 없다.
- P2P 관련 튜닝 값(`video_p2p.js` 상단 `CFG`)은 트래픽/서버 사양에 맞춰
  조정 가능하다.
