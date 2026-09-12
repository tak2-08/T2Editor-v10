// Path: T2Editor/plugin/video/video_p2p.js
// Developer note: 플러그인 ID "video"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.
/*
 *
 * HLS(m3u8) 소스에 한해 hls.js + p2p-media-loader 로 세그먼트를
 * "시청자 브라우저끼리(WebRTC)" 나눠받게 하여, 원본 서버의
 * CPU / 저장장치(디스크 I/O) / 네트워크 대역폭 부하를 낮춘다.
 *
 * 설계 원칙 (안정성 최우선):
 *   1) 이 모듈이 없거나, 로드에 실패하거나, 브라우저가 필요한 기능
 *      (MSE, WebRTC) 을 지원하지 않으면 → video_player.js 는 항상
 *      기존 native <video src> 재생 경로로 자연스럽게 폴백한다.
 *      (video_player.js 는 이 파일의 존재 여부를 매 호출마다 다시 확인함)
 *   2) P2P 로 세그먼트를 못 받으면(peer 없음/타임아웃) 자동으로 원 서버
 *      HTTP 요청으로 즉시 전환한다 (p2p-media-loader 내장 기능).
 *      즉 "피어가 하나도 없어도" 항상 원 서버에서 정상 재생된다.
 *   3) hls.js 레벨에서 네트워크/미디어 fatal 에러가 발생하면 1회 복구를
 *      시도하고, 그래도 실패하면 P2P/HLS 를 완전히 버리고 콜백으로
 *      video_player.js 의 legacy 소스 로딩(native HLS 또는 MP4)에
 *      맡긴다.
 *   4) 시그널링(피어 탐색)은 공개 WebTorrent 트래커를, ICE(NAT 통과)는
 *      video_chat.js 가 이미 쓰고 있는 공용 STUN/TURN 설정
 *      (window.T2_WEBRTC_CONFIG_URL) 을 재사용한다 → 별도 서버 구축 불필요.
 */
(function () {
  'use strict';

  var CFG = {
    // 세그먼트를 최소 이 정도는 원 서버에서 미리 받아두어(HTTP 우선 구간)
    // P2P 가 늦어져도 재생이 끊기지 않게 한다.
    HTTP_DOWNLOAD_TIME_WINDOW_SEC: 20,
    P2P_DOWNLOAD_TIME_WINDOW_SEC:  60,
    HTTP_INITIAL_TIMEOUT_MS:       4000,
    HTTP_NOT_RECEIVING_TIMEOUT_MS: 6000,
    P2P_NOT_RECEIVING_TIMEOUT_MS:  8000,
    P2P_INACTIVE_DESTROY_MS:       20000,
    SIMULTANEOUS_HTTP_DOWNLOADS:   2,
    SIMULTANEOUS_P2P_DOWNLOADS:    2,
    MAX_PEERS:                     16,
    ANNOUNCE_TRACKERS: [
      'wss://tracker.novage.com.ua',
      'wss://tracker.openwebtorrent.com',
    ],
  };

  function isSupported() {
    try {
      return (
        typeof window.Hls !== 'undefined' &&
        window.Hls.isSupported &&
        window.Hls.isSupported() &&
        typeof window.p2pml !== 'undefined' &&
        window.p2pml.hlsjs &&
        typeof window.p2pml.hlsjs.HlsJsP2PEngine === 'function' &&
        typeof window.RTCPeerConnection === 'function'
      );
    } catch (_) {
      return false;
    }
  }

  // video_chat.js 와 동일한 공용 ICE(STUN/TURN) 설정을 재사용한다.
  // (서버 관리자가 admin_settings 로 지정한 TURN 서버가 있으면 그것을,
  //  없으면 무료 공개 STUN/TURN 으로 자동 폴백)
  function loadIceServers() {
    var url = (window.T2_WEBRTC_CONFIG_URL || '').trim();
    var fallback = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    ];
    if (!url) return Promise.resolve(fallback);
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !Array.isArray(cfg.ice_servers) || !cfg.ice_servers.length) return fallback;
        return cfg.ice_servers;
      })
      .catch(function () { return fallback; });
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {Object} opts
   *   opts.url        {string}  m3u8 URL
   *   opts.swarmId     {string}  같은 영상을 보는 시청자들을 하나의 스웜으로 묶는 키
   *   opts.startTime   {number=} 초기 seek 위치(초)
   *   opts.autoplay    {boolean=}
   *   opts.onFatal     {function}  더 이상 복구 불가 → 호출측이 legacy 경로로 폴백
   *   opts.onManifestParsed {function=}
   *   opts.onStats     {function(stats)}  { peers, httpBytes, p2pBytes, p2pRatio }
   * @returns {Object} controller { destroy(), hls, engine }
   */
  function attach(video, opts) {
    opts = opts || {};
    var destroyed  = false;
    var netErrTry  = 0;
    var mediaErrTry = 0;
    var stats = { peers: 0, httpBytes: 0, p2pBytes: 0 };

    var HlsWithP2P = window.p2pml.hlsjs.HlsJsP2PEngine.injectMixin(window.Hls);

    var hls = new HlsWithP2P({
      // hls.js 자체 옵션: 버퍼를 과도하게 키우지 않아 메모리/지연을 안정적으로 유지
      lowLatencyMode: false,
      backBufferLength: 30,
      p2p: {
        core: {
          swarmId:                          opts.swarmId,
          announceTrackers:                 CFG.ANNOUNCE_TRACKERS,
          httpDownloadTimeWindow:            CFG.HTTP_DOWNLOAD_TIME_WINDOW_SEC,
          p2pDownloadTimeWindow:             CFG.P2P_DOWNLOAD_TIME_WINDOW_SEC,
          httpDownloadInitialTimeoutMs:      CFG.HTTP_INITIAL_TIMEOUT_MS,
          httpNotReceivingBytesTimeoutMs:    CFG.HTTP_NOT_RECEIVING_TIMEOUT_MS,
          p2pNotReceivingBytesTimeoutMs:     CFG.P2P_NOT_RECEIVING_TIMEOUT_MS,
          p2pInactiveLoaderDestroyTimeoutMs: CFG.P2P_INACTIVE_DESTROY_MS,
          simultaneousHttpDownloads:         CFG.SIMULTANEOUS_HTTP_DOWNLOADS,
          simultaneousP2PDownloads:          CFG.SIMULTANEOUS_P2P_DOWNLOADS,
          httpErrorRetries:                  2,
          p2pErrorRetries:                   2,
          p2pMaxPeers:                       CFG.MAX_PEERS,
          // ICE 는 아래에서 loadIceServers() 완료 후 applyDynamicConfig 로 갱신
          rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        },
        onHlsJsCreated: function (hlsInstance) {
          var engine = hlsInstance.p2pEngine;

          engine.addEventListener('onPeerConnect', function () {
            stats.peers++;
            emitStats();
          });
          engine.addEventListener('onPeerClose', function () {
            stats.peers = Math.max(0, stats.peers - 1);
            emitStats();
          });
          engine.addEventListener('onChunkDownloaded', function (bytesLength, downloadSource) {
            if (downloadSource === 'p2p') stats.p2pBytes += bytesLength;
            else stats.httpBytes += bytesLength;
            emitStats();
          });
          engine.addEventListener('onSegmentError', function () {
            // 세그먼트 하나 실패는 fatal 이 아님 — hls.js 가 자체적으로
            // 재시도/HTTP 폴백을 시도하므로 여기서는 통계만 남긴다.
          });
        },
      },
    });

    function emitStats() {
      if (typeof opts.onStats !== 'function') return;
      var total = stats.httpBytes + stats.p2pBytes;
      opts.onStats({
        peers:    stats.peers,
        httpBytes: stats.httpBytes,
        p2pBytes:  stats.p2pBytes,
        p2pRatio:  total > 0 ? stats.p2pBytes / total : 0,
      });
    }

    function fail(reason) {
      if (destroyed) return;
      destroy();
      if (typeof opts.onFatal === 'function') opts.onFatal(reason);
    }

    hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
      if (typeof opts.onManifestParsed === 'function') opts.onManifestParsed();
      if (opts.autoplay) {
        var p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    });

    hls.on(window.Hls.Events.ERROR, function (_evt, data) {
      if (!data || !data.fatal) return;
      switch (data.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR:
          if (netErrTry < 1) { netErrTry++; hls.startLoad(); }
          else fail('network');
          break;
        case window.Hls.ErrorTypes.MEDIA_ERROR:
          if (mediaErrTry < 1) { mediaErrTry++; hls.recoverMediaError(); }
          else fail('media');
          break;
        default:
          fail('other');
          break;
      }
    });

    hls.loadSource(opts.url);
    hls.attachMedia(video);

    if (Number.isFinite(opts.startTime) && opts.startTime > 0) {
      video.addEventListener('loadedmetadata', function onLm() {
        video.removeEventListener('loadedmetadata', onLm);
        try { video.currentTime = opts.startTime; } catch (_) {}
      });
    }

    // TURN 포함 ICE 목록이 준비되면 반영 (재생 시작을 막지 않기 위해 비동기로 처리)
    loadIceServers().then(function (iceServers) {
      if (destroyed) return;
      try {
        hls.p2pEngine.applyDynamicConfig({ core: { rtcConfig: { iceServers: iceServers } } });
      } catch (_) {}
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      try { hls.p2pEngine && hls.p2pEngine.destroy(); } catch (_) {}
      try { hls.destroy(); } catch (_) {}
    }

    return { destroy: destroy, hls: hls };
  }

  window.T2VideoP2P = {
    isSupported: isSupported,
    attach: attach,
  };
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
