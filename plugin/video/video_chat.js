// Path: T2Editor/plugin/video/video_chat.js
// =============================================================================
// video 플러그인 — 자동 P2P 실시간 채팅 v1.0.0
// -----------------------------------------------------------------------------
//  ✦ 같은 영상을 보는 방문자끼리 브라우저에서 자동으로 P2P 연결되어 채팅.
//  ✦ 유저/운영자의 추가 설정 없이 동작(기본 공개 STUN/TURN + PeerJS 무료
//    시그널링 브로커 사용). 운영자가 자체 TURN 서버를 쓰고 싶으면
//    T2EDITOR_DATA_PATH/webrtc_turn_config.json 하나만 두면 된다
//    (get_webrtc_config.php 참고 — plugin/collab 과 동일한 "공통 데이터 폴더"
//    사용 방식).
//  ✦ 닉네임: 직접 입력 가능, 초기값은 랜덤 닉네임 + 랜덤(고정 시드) 색상.
//  ✦ 방(room)은 영상 하나당 하나 자동 배정(video_player.php 가 만든
//    payload.id 를 시드로 사용) → 같은 영상을 보는 사람들끼리 자동 매칭.
//  ✦ 위상: 트래픽 폭주 방지를 위해 "호스트 1인 + 다수 게스트"의 스타(hub)
//    형태로 연결한다(모두 WebRTC P2P 데이터채널). 호스트가 사라지면 남은
//    게스트 중 하나가 자동으로 새 호스트를 맡는다(재선출).
// =============================================================================
(function () {
    'use strict';

    var CFG = {
        PEERJS_CDNS: [
            'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
            'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
        ],
        HOST_ID_PREFIX: 't2vchat_host_',
        CONNECT_TIMEOUT_MS: 8000,
        REELECT_MIN_MS: 400,
        REELECT_MAX_MS: 2600,
        PRESENCE_INTERVAL_MS: 8000,
        MAX_CHAT_LEN: 500,
        MAX_HISTORY: 60,
        NICK_MAX_LEN: 20,
        MSG_TYPES: { JOIN: 'join', CHAT: 'chat', LEAVE: 'leave', PRESENCE: 'presence', HISTORY: 'history' }
    };

    // ── 유틸 ─────────────────────────────────────────────────────────────
    function safeParseJson(v, fb) { try { return JSON.parse(v); } catch (e) { return fb; } }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function uuidv4() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        var buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        buf[6] = (buf[6] & 0x0f) | 0x40;
        buf[8] = (buf[8] & 0x3f) | 0x80;
        var toHex = function (n) { return (n + 0x100).toString(16).substr(1); };
        return Array.from(buf).map(toHex).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.+)$/, '$1-$2-$3-$4-$5');
    }

    var store = {
        get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };

    function getClientId() {
        var id = store.get('t2_vchat_client_id');
        if (!id) { id = uuidv4(); store.set('t2_vchat_client_id', id); }
        return id;
    }

    // FNV-1a 기반 결정적 색상(같은 클라이언트는 항상 같은 색)
    function pickColor(seed) {
        var h = 0x811c9dc5;
        for (var i = 0; i < seed.length; i++) {
            h ^= seed.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        var hue = h % 360;
        var sat = 68 + (h >> 9) % 14;
        var lig = 55 + (h >> 17) % 10;
        return 'hsl(' + hue + ' ' + sat + '% ' + lig + '%)';
    }

    var ADJ = ['조용한', '수줍은', '재빠른', '느긋한', '반짝이는', '용감한', '따뜻한', '엉뚱한', '차분한', '유쾌한'];
    var NOUN = ['여우', '고양이', '수달', '너구리', '펭귄', '토끼', '부엉이', '판다', '다람쥐', '고래'];

    function randomNickname(seed) {
        var h = 0;
        for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
        var a = ADJ[h % ADJ.length];
        var n = NOUN[(h >> 4) % NOUN.length];
        var num = (h % 9000) + 1000;
        return a + n + num;
    }

    function getNickname(clientId) {
        var saved = store.get('t2_vchat_nickname');
        if (saved && saved.trim()) return saved.trim().slice(0, CFG.NICK_MAX_LEN);
        return randomNickname(clientId);
    }

    function sanitizeNickname(raw) {
        var v = String(raw || '').replace(/[<>]/g, '').trim();
        if (!v) return '';
        return v.slice(0, CFG.NICK_MAX_LEN);
    }

    // ── PeerJS 지연 로드 ───────────────────────────────────────────────
    var _peerJsPromise = null;
    function loadPeerJs() {
        if (window.Peer) return Promise.resolve(window.Peer);
        if (_peerJsPromise) return _peerJsPromise;
        _peerJsPromise = new Promise(function (resolve, reject) {
            var i = 0;
            (function tryNext() {
                if (i >= CFG.PEERJS_CDNS.length) { reject(new Error('peerjs_cdn_unreachable')); return; }
                var s = document.createElement('script');
                s.src = CFG.PEERJS_CDNS[i++];
                s.async = true;
                s.onload = function () { window.Peer ? resolve(window.Peer) : tryNext(); };
                s.onerror = tryNext;
                document.head.appendChild(s);
            })();
        });
        return _peerJsPromise;
    }

    // ── 서버(공통 데이터 폴더) ICE/브로커 설정 로드 ────────────────────
    function loadWebrtcConfig() {
        var url = (window.T2_WEBRTC_CONFIG_URL || '').trim();
        var fallback = {
            ice_servers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
                { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
            ],
            peer_brokers: [{ host: '0.peerjs.com', port: 443, secure: true, path: '/' }]
        };
        if (!url) return Promise.resolve(fallback);
        return fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : fallback; })
            .then(function (cfg) {
                if (!cfg || !Array.isArray(cfg.ice_servers) || !cfg.ice_servers.length) return fallback;
                return cfg;
            })
            .catch(function () { return fallback; });
    }

    // ── 채팅 UI ──────────────────────────────────────────────────────────
    function buildUi(root) {
        var wrap = document.createElement('div');
        wrap.className = 't2vc-panel';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML =
            '<div class="t2vc-header">' +
                '<span class="t2vc-title">실시간 채팅</span>' +
                '<span class="t2vc-viewers" data-vc-viewers>1명 시청 중</span>' +
                '<button type="button" class="t2vc-close" data-vc-close aria-label="채팅 닫기">✕</button>' +
            '</div>' +
            '<div class="t2vc-messages" data-vc-messages></div>' +
            '<div class="t2vc-nickrow">' +
                '<span class="t2vc-dot" data-vc-dot></span>' +
                '<input type="text" class="t2vc-nick-input" data-vc-nick maxlength="' + CFG.NICK_MAX_LEN + '" aria-label="닉네임">' +
                '<button type="button" class="t2vc-nick-save" data-vc-nick-save>변경</button>' +
            '</div>' +
            '<form class="t2vc-inputrow" data-vc-form>' +
                '<input type="text" class="t2vc-input" data-vc-input maxlength="' + CFG.MAX_CHAT_LEN + '" placeholder="메시지 보내기…" autocomplete="off">' +
                '<button type="button" class="t2vc-danmaku-toggle" data-vc-danmaku-toggle aria-pressed="false" aria-label="전체 채팅(영상 위로 흘려보내기)" title="전체 채팅: 켜두면 채팅이 영상 위로도 흘러갑니다">' +
                    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">' +
                        '<path d="M1.2 4.2h12.6M1.2 7.5h8.4M1.2 10.8h11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                    '</svg>' +
                '</button>' +
                '<button type="submit" class="t2vc-send" data-vc-send aria-label="전송">➤</button>' +
            '</form>';
        root.appendChild(wrap);

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 't2vp-control t2vp-control--chat';
        toggle.setAttribute('data-vc-toggle', '');
        toggle.setAttribute('aria-label', '채팅 열기/닫기');
        toggle.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
                '<path d="M2 4.5A2 2 0 0 1 4 2.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7.5L4 14.2V12.5H4a2 2 0 0 1-2-2v-6z" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
            '</svg>';
        var chrome = root.querySelector('[data-chrome] .t2vp-controls') || root.querySelector('.t2vp-controls');
        if (chrome) {
            var fsBtn = chrome.querySelector('[data-fullscreen]') || chrome.querySelector('.t2vp-control--fs');
            if (fsBtn) chrome.insertBefore(toggle, fsBtn); else chrome.appendChild(toggle);
        } else {
            root.appendChild(toggle);
        }

        // 영상 위로 채팅이 흘러가는 오버레이 레이어(전체 채팅 켰을 때만 채워짐)
        var danmakuLayer = document.createElement('div');
        danmakuLayer.className = 't2vd-layer';
        danmakuLayer.setAttribute('aria-hidden', 'true');
        root.appendChild(danmakuLayer);

        return { panel: wrap, toggle: toggle, danmakuLayer: danmakuLayer };
    }

    // ── 전체 채팅(영상 위로 흘러가는 코멘트) 레이어 ─────────────────────────
    // 티비플/니코니코 스타일: 새 코멘트가 들어올 때마다 화면 안(플레이어 영역)
    // 랜덤한 위치에, 이미 떠 있는 다른 코멘트와 최대한 겹치지 않게 배치하고,
    // 6~30초 사이 랜덤한 시간 뒤 자동으로 사라진다.
    function DanmakuLayer(layerEl) {
        this.layer = layerEl;
        this.active = []; // { el, x, y, w, h }
    }

    // 후보 위치 하나가 기존에 떠 있는 코멘트들과 겹치는 면적(px²) 합
    DanmakuLayer.prototype._overlapArea = function (x, y, w, h) {
        var total = 0;
        for (var i = 0; i < this.active.length; i++) {
            var o = this.active[i];
            var ox = Math.min(x + w, o.x + o.w) - Math.max(x, o.x);
            var oy = Math.min(y + h, o.y + o.h) - Math.max(y, o.y);
            if (ox > 0 && oy > 0) total += ox * oy;
        }
        return total;
    };

    DanmakuLayer.prototype.spawn = function (text, color) {
        if (!text) return;
        var self = this;
        var shown = text.length > 60 ? text.slice(0, 60) + '…' : text;

        var el = document.createElement('div');
        el.className = 't2vd-item';
        el.textContent = shown;
        if (color) el.style.color = color;
        el.style.visibility = 'hidden';
        this.layer.appendChild(el);

        var boundsW = this.layer.clientWidth;
        var boundsH = this.layer.clientHeight;
        var w = el.offsetWidth;
        var h = el.offsetHeight;
        var maxX = Math.max(0, boundsW - w);
        var maxY = Math.max(0, boundsH - h);

        // 겹침이 0인(또는 가장 적은) 위치를 여러 번 무작위 시도해서 고른다.
        var best = null;
        var bestOverlap = Infinity;
        for (var i = 0; i < 18 && bestOverlap > 0; i++) {
            var x = Math.random() * maxX;
            var y = Math.random() * maxY;
            var ov = this._overlapArea(x, y, w, h);
            if (ov < bestOverlap) { bestOverlap = ov; best = { x: x, y: y }; }
        }
        if (!best) best = { x: Math.random() * maxX, y: Math.random() * maxY };

        el.style.left = best.x + 'px';
        el.style.top  = best.y + 'px';
        el.style.visibility = '';
        void el.offsetWidth; // reflow 강제 → 등장 트랜지션 재생
        el.classList.add('is-visible');

        var entry = { el: el, x: best.x, y: best.y, w: w, h: h };
        this.active.push(entry);

        // "최대 30초" — 6~30초 사이에서 무작위로 사라짐
        var life = 6000 + Math.random() * 24000;
        setTimeout(function () {
            el.classList.remove('is-visible');
            el.classList.add('is-leaving');
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
                var idx = self.active.indexOf(entry);
                if (idx !== -1) self.active.splice(idx, 1);
            }, 500);
        }, life);
    };

    DanmakuLayer.prototype.clear = function () {
        this.active.forEach(function (e) { if (e.el.parentNode) e.el.parentNode.removeChild(e.el); });
        this.active = [];
    };

    // ── 채팅 엔진 ─────────────────────────────────────────────────────────
    function VideoChat(root) {
        this.root = root;
        var data = safeParseJson(root.getAttribute('data-video') || '{}', {});
        this.roomId = String(data.id || 't2video-default').replace(/[^a-zA-Z0-9_-]/g, '');
        this.hostPeerId = CFG.HOST_ID_PREFIX + this.roomId;

        this.clientId = getClientId();
        this.nickname = getNickname(this.clientId);
        this.color = pickColor(this.clientId);

        this.isHost = false;
        this.peer = null;
        this.hostConn = null;          // 게스트: 호스트로의 연결
        this.guestConns = {};          // 호스트: 접속된 게스트 목록 {peerId: conn}
        this.history = [];
        this.opened = false;
        this._reconnectTimer = null;

        this.ui = buildUi(root);
        this.danmaku = new DanmakuLayer(this.ui.danmakuLayer);
        this.danmakuEnabled = store.get('t2_vchat_danmaku_enabled') === '1';
        this._bindUi();
    }

    VideoChat.prototype._bindUi = function () {
        var self = this;
        var panel = this.ui.panel;

        this.ui.toggle.addEventListener('click', function () { self.togglePanel(); });
        panel.querySelector('[data-vc-close]').addEventListener('click', function () { self.togglePanel(false); });

        var nickInput = panel.querySelector('[data-vc-nick]');
        nickInput.value = this.nickname;
        panel.querySelector('[data-vc-dot]').style.background = this.color;

        panel.querySelector('[data-vc-nick-save]').addEventListener('click', function () {
            var v = sanitizeNickname(nickInput.value);
            if (!v) { nickInput.value = self.nickname; return; }
            self.nickname = v;
            store.set('t2_vchat_nickname', v);
            self._broadcastPresenceInfo();
            self._systemMessage('닉네임이 "' + v + '"(으)로 변경되었습니다.');
        });

        var danmakuToggle = panel.querySelector('[data-vc-danmaku-toggle]');
        danmakuToggle.classList.toggle('is-active', this.danmakuEnabled);
        danmakuToggle.setAttribute('aria-pressed', this.danmakuEnabled ? 'true' : 'false');
        danmakuToggle.addEventListener('click', function () {
            self.danmakuEnabled = !self.danmakuEnabled;
            store.set('t2_vchat_danmaku_enabled', self.danmakuEnabled ? '1' : '0');
            danmakuToggle.classList.toggle('is-active', self.danmakuEnabled);
            danmakuToggle.setAttribute('aria-pressed', self.danmakuEnabled ? 'true' : 'false');
            if (!self.danmakuEnabled) self.danmaku.clear();
        });

        panel.querySelector('[data-vc-form]').addEventListener('submit', function (e) {
            e.preventDefault();
            var input = panel.querySelector('[data-vc-input]');
            var text = String(input.value || '').trim().slice(0, CFG.MAX_CHAT_LEN);
            if (!text) return;
            input.value = '';
            self.sendChat(text);
        });
    };

    VideoChat.prototype.togglePanel = function (force) {
        var show = typeof force === 'boolean' ? force : !this.opened;
        this.opened = show;
        this.ui.panel.classList.toggle('is-open', show);
        this.ui.panel.setAttribute('aria-hidden', show ? 'false' : 'true');
        this.ui.toggle.classList.toggle('is-active', show);
        if (show && !this.peer) this.connect();
    };

    VideoChat.prototype._appendMessage = function (msg, skipDanmaku) {
        var list = this.ui.panel.querySelector('[data-vc-messages]');
        var row = document.createElement('div');
        row.className = 't2vc-msg' + (msg.system ? ' t2vc-msg--system' : '');
        if (msg.system) {
            row.innerHTML = '<span class="t2vc-msg-system-text">' + escapeHtml(msg.text) + '</span>';
        } else {
            row.innerHTML =
                '<span class="t2vc-msg-nick" style="color:' + msg.color + '">' + escapeHtml(msg.nickname) + '</span>' +
                '<span class="t2vc-msg-text">' + escapeHtml(msg.text) + '</span>';
        }
        list.appendChild(row);
        while (list.children.length > CFG.MAX_HISTORY) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight + 999;

        if (!msg.system && !skipDanmaku && this.danmakuEnabled) {
            this.danmaku.spawn(msg.text, msg.color);
        }
    };

    VideoChat.prototype._systemMessage = function (text) {
        this._appendMessage({ system: true, text: text });
    };

    VideoChat.prototype._setViewerCount = function (n) {
        var el = this.ui.panel.querySelector('[data-vc-viewers]');
        if (el) el.textContent = n + '명 시청 중';
    };

    // ── 연결 ──────────────────────────────────────────────────────────
    VideoChat.prototype.connect = function () {
        var self = this;
        Promise.all([loadPeerJs(), loadWebrtcConfig()]).then(function (results) {
            var Peer = results[0];
            var netCfg = results[1];
            self.iceServers = netCfg.ice_servers;
            self.broker = (netCfg.peer_brokers && netCfg.peer_brokers[0]) || { host: '0.peerjs.com', port: 443, secure: true, path: '/' };
            self._Peer = Peer;
            self._attemptBecomeHost();
        }).catch(function () {
            self._systemMessage('채팅 연결에 실패했습니다. 잠시 후 자동으로 재시도합니다.');
            self._scheduleReconnect();
        });
    };

    VideoChat.prototype._peerOptions = function () {
        return {
            host: this.broker.host,
            port: this.broker.port,
            secure: this.broker.secure,
            path: this.broker.path,
            config: { iceServers: this.iceServers },
            debug: 0
        };
    };

    VideoChat.prototype._attemptBecomeHost = function () {
        var self = this;
        var peer = new this._Peer(this.hostPeerId, this._peerOptions());
        var settled = false;
        var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            try { peer.destroy(); } catch (e) {}
            self._joinAsGuest();
        }, CFG.CONNECT_TIMEOUT_MS);

        peer.on('open', function () {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            self.isHost = true;
            self.peer = peer;
            self._systemMessage('채팅방에 연결되었습니다.');
            self._setViewerCount(1);
        });

        peer.on('connection', function (conn) { self._handleGuestConnection(conn); });

        peer.on('error', function (err) {
            if (settled) return;
            var type = err && err.type;
            if (type === 'unavailable-id') {
                settled = true;
                clearTimeout(timer);
                self._joinAsGuest();
            }
        });

        peer.on('disconnected', function () {
            if (self.isHost) self._scheduleReconnect();
        });
    };

    VideoChat.prototype._handleGuestConnection = function (conn) {
        var self = this;
        conn.on('open', function () {
            self.guestConns[conn.peer] = conn;
            self._updateViewerCountFromHost();
            // 신규 접속자에게 최근 대화 이력 전달
            try { conn.send({ t: CFG.MSG_TYPES.HISTORY, items: self.history.slice(-CFG.MAX_HISTORY) }); } catch (e) {}
        });
        conn.on('data', function (msg) { self._onHostReceive(conn, msg); });
        conn.on('close', function () {
            delete self.guestConns[conn.peer];
            self._updateViewerCountFromHost();
        });
        conn.on('error', function () {
            delete self.guestConns[conn.peer];
            self._updateViewerCountFromHost();
        });
    };

    VideoChat.prototype._onHostReceive = function (conn, msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === CFG.MSG_TYPES.JOIN || msg.t === CFG.MSG_TYPES.CHAT) {
            if (msg.t === CFG.MSG_TYPES.CHAT) {
                var text = String(msg.text || '').slice(0, CFG.MAX_CHAT_LEN);
                if (!text.trim()) return;
                var entry = {
                    t: CFG.MSG_TYPES.CHAT,
                    nickname: sanitizeNickname(msg.nickname) || '익명',
                    color: /^hsl\(/.test(msg.color) ? msg.color : pickColor(conn.peer),
                    text: text
                };
                this.history.push(entry);
                if (this.history.length > CFG.MAX_HISTORY) this.history.shift();
                this._appendMessage(entry);
                this._broadcastToGuests(entry, conn.peer);
            }
        }
    };

    VideoChat.prototype._broadcastToGuests = function (msg, exceptPeerId) {
        var conns = this.guestConns;
        Object.keys(conns).forEach(function (pid) {
            if (pid === exceptPeerId) return;
            try { conns[pid].send(msg); } catch (e) {}
        });
    };

    VideoChat.prototype._updateViewerCountFromHost = function () {
        var count = Object.keys(this.guestConns).length + 1;
        this._setViewerCount(count);
        this._broadcastToGuests({ t: CFG.MSG_TYPES.PRESENCE, count: count });
    };

    VideoChat.prototype._joinAsGuest = function () {
        var self = this;
        var peer = new this._Peer(undefined, this._peerOptions());

        peer.on('open', function () {
            self.peer = peer;
            self._connectToHost();
        });

        peer.on('error', function () { self._scheduleReconnect(); });
        peer.on('disconnected', function () { self._scheduleReconnect(); });
    };

    VideoChat.prototype._connectToHost = function () {
        var self = this;
        var conn = this.peer.connect(this.hostPeerId, { reliable: true });
        var opened = false;
        var timer = setTimeout(function () {
            if (!opened) self._scheduleReconnect();
        }, CFG.CONNECT_TIMEOUT_MS);

        conn.on('open', function () {
            opened = true;
            clearTimeout(timer);
            self.hostConn = conn;
            self._systemMessage('채팅방에 연결되었습니다.');
            try { conn.send({ t: CFG.MSG_TYPES.JOIN, nickname: self.nickname, color: self.color }); } catch (e) {}
        });

        conn.on('data', function (msg) { self._onGuestReceive(msg); });

        conn.on('close', function () {
            self._systemMessage('호스트와의 연결이 끊어졌습니다. 재연결을 시도합니다.');
            self._scheduleReconnect();
        });
        conn.on('error', function () { self._scheduleReconnect(); });
    };

    VideoChat.prototype._onGuestReceive = function (msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === CFG.MSG_TYPES.CHAT) {
            this._appendMessage(msg);
        } else if (msg.t === CFG.MSG_TYPES.PRESENCE) {
            this._setViewerCount(msg.count || 1);
        } else if (msg.t === CFG.MSG_TYPES.HISTORY && Array.isArray(msg.items)) {
            var self = this;
            msg.items.forEach(function (m) { self._appendMessage(m, true); });
        }
    };

    VideoChat.prototype._broadcastPresenceInfo = function () {
        // 닉네임 변경 시 호스트/게스트 각자 알림 정도만 표시(별도 프로토콜 불필요)
    };

    VideoChat.prototype._scheduleReconnect = function () {
        var self = this;
        if (this._reconnectTimer) return;
        var wait = CFG.REELECT_MIN_MS + Math.random() * (CFG.REELECT_MAX_MS - CFG.REELECT_MIN_MS);
        this._reconnectTimer = setTimeout(function () {
            self._reconnectTimer = null;
            try { if (self.peer) self.peer.destroy(); } catch (e) {}
            self.peer = null;
            self.hostConn = null;
            self.isHost = false;
            self.guestConns = {};
            self._attemptBecomeHost();
        }, wait);
    };

    VideoChat.prototype.sendChat = function (text) {
        var entry = { t: CFG.MSG_TYPES.CHAT, nickname: this.nickname, color: this.color, text: text };
        if (this.isHost) {
            this.history.push(entry);
            if (this.history.length > CFG.MAX_HISTORY) this.history.shift();
            this._appendMessage(entry);
            this._broadcastToGuests(entry);
        } else if (this.hostConn) {
            try { this.hostConn.send(entry); } catch (e) {}
            // 낙관적 표시: 호스트가 되돌려 보내지 않아도 내 화면엔 즉시 표기
            this._appendMessage(entry);
        } else {
            this._systemMessage('아직 채팅 서버에 연결 중입니다…');
        }
    };

    // ── 초기화 ────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var root = document.querySelector('[data-t2-video-player]');
        if (root) window.t2VideoChat = new VideoChat(root);
    });
}());
