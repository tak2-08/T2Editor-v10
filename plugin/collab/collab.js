// Path: T2Editor/plugin/collab/collab.js
// =============================================================================
// 실시간 협업 플러그인 v3.2.0
// -----------------------------------------------------------------------------
//   ✦ 디자인 정리: 화려한 그라데이션 제거, Google Material + Flat + 2.5D 절제
//   ✦ 크로스 브라우저: iOS/Safari 전용 표현을 표준 표기로 교체, Chrome/FF/Edge 모두 정상 동작
//   ✦ 워딩 정리: 과도한 영문 브랜드/약어를 자연스러운 한국어 표현으로 변경
//      (예: T2Editor TrustChain → 데이터 무결성 확인,
//             T2Editor MeshCDN  → 참가자 간 공유 캐시,
//             T2Editor VaultSync → 브라우저 내 저장소 등)
//   ✦ 기존 v3.1.0 의 모든 기능(블록 기반 무결성 검증, 분산 저장소, 오프라인 큐,
//      P2P/대체 모드, 채팅·DM·리액션·답장·읽음·검색·QR 등)은 그대로 유지.
//
// 주: 클래스명·메시지 타입 상수 등 외부에서 참조되는 식별자는 절대 변경하지 않음.
// =============================================================================
(function () {
'use strict';

// ============================================================
// 0. 상수 / 유틸
// ============================================================

const CFG = {
    PEERJS_CDNS: [
        'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
        'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
    ],
    PEERJS_BROKERS: [
        { host: '0.peerjs.com', port: 443, secure: true, path: '/' }
    ],
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    PEER_NS: 't2collab-v2-host-',

    // ============================================================
    // ── 안정성 향상 모드 (Stability Mode) ──
    // P2P 연결을 "외부 오픈 무료 공개 서버"(추가 PeerJS 시그널링 서버 /
    // 무료 공개 STUN·TURN 중계 서버) 및 PHP 백업 서버와 하이브리드로
    // 사용해 연결 성공률과 안정성을 높이는 모드입니다.
    //
    // ▶ 아래 두 목록(STABILITY_PEERJS_BROKERS / STABILITY_ICE_SERVERS)은
    //   운영자가 자유롭게 항목을 추가/수정/삭제할 수 있습니다.
    //   - STABILITY_PEERJS_BROKERS: 시그널링(연결 중개) 서버 후보 목록.
    //     배열 순서대로 연결을 시도하며, 실패 시 다음 서버로 자동 전환합니다.
    //   - STABILITY_ICE_SERVERS: STUN/TURN 서버 목록. TURN 서버는
    //     NAT/방화벽으로 인해 P2P 직접 연결이 불가능한 환경에서
    //     트래픽을 중계해 연결 성공률을 크게 높여줍니다.
    //     (아래 openrelay.metered.ca 항목은 Open Relay Project 가
    //      제공하는 무료 공개 TURN 서버입니다)
    // ============================================================
    STABILITY_PEERJS_BROKERS: [
        { host: '0.peerjs.com', port: 443, secure: true, path: '/' }
        // 예) 다른 공개/자체 PeerServer 인스턴스를 추가하려면 아래처럼 작성:
        // { host: 'your-peerserver.example.com', port: 443, secure: true, path: '/' }
    ],
    STABILITY_ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        // ── 무료 공개 TURN (Open Relay Project) ──
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
        // 필요 시 추가 TURN 서버를 같은 형식으로 추가/삭제할 수 있습니다.
    ],
    // 브로커 1개당 연결 시도 제한 시간 (안정성 모드: 여러 브로커를 순차 시도)
    STABILITY_BROKER_TIMEOUT_MS: 9000,
    // 안정성 모드에서 PHP 백업 채널과 동기화하는 주기
    STABILITY_PHP_SYNC_MS: 7000,

    P2P_CONNECT_TIMEOUT: 8000,
    PHP_POLL_MS: 10000,
    DEBOUNCE_MS: 500,
    AWARENESS_THROTTLE_MS: 80,   // 커서 위치 전송 throttle
    AWARENESS_STALE_MS: 12000,   // 일정 시간 업데이트 없으면 커서 숨김
    MAX_CONTENT_BYTES: 1024 * 1024,
    HEARTBEAT_MS: 15000,
    URL_PARAM_KEY: 't2collab',

    MSG_TYPES: {
        FULL:       'full',
        AWARENESS:  'aware',
        PING:       'ping',
        PONG:       'pong',
        USERS:      'users',
        KICK:       'kick',
        CHAT:       'chat',
        FILE_META:  'fmeta',
        FILE_CHUNK: 'fchk',
        TYPING:     'type',
        LOCK:       'lock',
        DM:         'dm',
        STATUS:     'status',
        REACT:      'react',
        READ:       'read',
        HB:         'hb',       // 호스트 heartbeat broadcast
        BACKUP:     'bkp',      // 호스트→상위3: 문서 스냅샷
        TAKE_HOST:  'tkh',      // 새 호스트 선언
        USER_LOCK:  'ulock',    // 방장이 특정 사용자만 편집 잠금
        ROOM_STOP:  'rstop',    // 호스트가 방 종료 → 게스트에게 브로드캐스트
        STATE_SYNC: 'ssync',    // [v2.5.0] 전체 상태 동기화 (리액션+상태+문서) — 참가자 간 공유 캐시
        BLOCK_SYNC: 'bsync',     // [v3.1.0] 블록 체인 동기화
        CHUNK_REQ:  'chreq',     // [v3.1.0] 콘텐츠 청크 요청
        CHUNK_RES:  'chres'      // [v3.1.0] 콘텐츠 청크 응답
    },

    MAX_CHAT_MSG_LEN: 2000,
    MAX_FILE_BYTES: 52428800,
    FILE_CHUNK_BYTES: 65536,
    ALLOWED_FILE_EXTS: new Set([
        '.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg',
        '.pdf','.md','.txt','.csv',
        '.ppt','.pptx','.doc','.docx','.xlsx','.xls',
        '.hwp','.hwpx','.zip','.7z',
        '.mp4','.mov','.avi','.mkv','.mp3','.wav','.ogg'
    ]),

    // 채팅 캐시
    CHAT_CACHE_PFX:    't2c_chat_',
    CHAT_CACHE_MAX:    200,
    CHAT_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1000,

    // 문서 캐시 (재연결 복구용)
    DOC_CACHE_PFX:     't2c_doc_',
    DOC_CACHE_TTL_MS:  2 * 60 * 60 * 1000,     // 2시간

    // [v2.5.0] 참가자 간 공유 캐시 · 분산 백업
    STATE_CACHE_PFX:       't2c_state_',       // 전체 상태 캐시 (리액션+원격상태+문서)
    STATE_CACHE_TTL_MS:    4 * 60 * 60 * 1000, // 4시간
    STATE_SYNC_INTERVAL:   30000,              // 30초마다 전체 상태를 함께 공유 (참가자 간 공유 캐시)
    REACTION_CACHE_PFX:    't2c_react_',       // 리액션 전용 캐시
    REACTION_CACHE_TTL_MS: 4 * 60 * 60 * 1000,  // 4시간

    // 재연결
    RECONNECT_BASE_MS:   1500,
    RECONNECT_MAX_MS:    32000,
    RECONNECT_MAX_TRIES: 8,

    // 자리비움
    AUTO_AWAY_MS:   5 * 60 * 1000,
    AWAY_CHECK_MS:  30 * 1000,
    STATUS_LABELS: { online:'온라인', away:'자리비움', busy:'바쁨', dnd:'방해 금지' },

    // 메시지 그룹핑
    MSG_GROUP_GAP_MS: 3 * 60 * 1000,

    // 리액션
    REACT_EMOJIS: ['👍','❤️','😂','😮','😢','🎉'],

    // ── 호스트 failover ──
    HB_INTERVAL_MS:      3000,    // heartbeat 전송 주기
    HB_TIMEOUT_MS:       10000,   // HB 없으면 호스트 소실 판단
    BACKUP_INTERVAL_MS:  15000,   // 백업 스냅샷 전송 주기
    BACKUP_COUNT:        3,       // 백업 보유 인원
    ELECTION_STEP_MS:    2500,    // 순위별 대기 (rank-1)*step
    BACKUP_ID_SFX:       '_bk',   // 백업 피어 ID 접미사 t2c_{code}_bk{rank}

    // [v3.1.0] 무결성 · 동기화 관련 설정
    BLOCK_CHAIN_MAX_BLOCKS: 100,       // 체인에 유지할 최대 블록 수
    BLOCK_SYNC_INTERVAL:   60000,      // 60초마다 블록 체인 동기화 브로드캐스트
    CHUNK_SIZE:            65536,       // 콘텐츠 청크 크기 (64KB)
    INDEXEDDB_NAME:        't2collab',  // IndexedDB 기본 이름
    INDEXEDDB_VERSION:     1            // IndexedDB 버전
};

function isoNow() { return (new Date()).toISOString(); }

function uuidv4() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const toHex = (n) => (n + 0x100).toString(16).substr(1);
    return Array.from(buf).map(toHex).join('').replace(
        /^(.{8})(.{4})(.{4})(.{4})(.+)$/, '$1-$2-$3-$4-$5'
    );
}

function isValidDomId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}
function isValidContent(c) {
    return typeof c === 'string' && c.length <= CFG.MAX_CONTENT_BYTES;
}

// 메모리 + localStorage 하이브리드 (room 별 색상 유지)
const memStore = {
    _d: {},
    getItem(k) {
        if (this._d[k] != null) return this._d[k];
        try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    setItem(k, v) {
        this._d[k] = v;
        try { localStorage.setItem(k, v); } catch (e) {}
    },
    removeItem(k) {
        delete this._d[k];
        try { localStorage.removeItem(k); } catch (e) {}
    }
};

function getClientId() {
    let id = memStore.getItem('t2_collab_client_id');
    if (!id) { id = uuidv4(); memStore.setItem('t2_collab_client_id', id); }
    return id;
}

// 안정적인 랜덤 HSL 색상. client_id + roomCode 시드로 결정적.
// 같은 사람이 같은 방에 재입장하면 동일 색상.
function pickUserColor(seedString) {
    // 32-bit FNV-1a → 0-360 hue 매핑
    let h = 0x811c9dc5;
    for (let i = 0; i < seedString.length; i++) {
        h ^= seedString.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    const hue = h % 360;
    const sat = 70 + (h >> 9) % 12;   // 70~81
    const lig = 48 + (h >> 17) % 10;  // 48~57
    return {
        hue,
        primary: `hsl(${hue} ${sat}% ${lig}%)`,
        soft:    `hsl(${hue} ${sat}% ${lig}% / 0.18)`,
        ring:    `hsl(${hue} ${sat}% ${lig}% / 0.35)`
    };
}

function showToast(message, type = 'info', duration = 3000) {
    try {
        if (window.T2Utils && typeof T2Utils.showNotification === 'function') {
            T2Utils.showNotification(message, type, duration);
            return;
        }
    } catch (e) {}
    // fallback: minimal own toast
    const el = document.createElement('div');
    el.className = 't2-collab-toast t2-collab-toast-' + type;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 300);
    }, duration);
}

function normalizeHTML(html) {
    if (!html) return '';
    return String(html).replace(/(<br\s*\/?>\s*){2,}/gi, '<br>').replace(/\s+/g, ' ').trim();
}
function fastHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h;
}

function extractDOMState(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const s = { mediaBlocks: {}, codeBlocks: {}, tables: {} };

    tmp.querySelectorAll('.t2-media-block').forEach(block => {
        const id = block.getAttribute('data-block-id');
        if (!isValidDomId(id)) return;
        const c = block.querySelector('div:first-child');
        const m = c?.querySelector('img, iframe, video');
        if (!c || !m) return;
        s.mediaBlocks[id] = {
            cw: c.style.width || '', ch: c.style.height || '',
            cm: c.style.margin || '', cmw: c.style.maxWidth || '',
            mw: m.style.width || '', mh: m.style.height || '',
            ow: parseInt(m.dataset.width) || parseInt(c.dataset.originalWidth) || 320,
            oh: parseInt(m.dataset.height) || parseInt(c.dataset.originalHeight) || 180
        };
    });
    tmp.querySelectorAll('.t2-code-block').forEach(block => {
        const id = block.getAttribute('data-block-id');
        const code = block.querySelector('code');
        if (!isValidDomId(id) || !code) return;
        s.codeBlocks[id] = {
            content: code.textContent,
            placeholder: code.classList.contains('code-placeholder')
        };
    });
    tmp.querySelectorAll('.t2-table-wrapper').forEach(wrap => {
        const table = wrap.querySelector('table');
        if (!table) return;
        const id = table.getAttribute('data-table-id');
        if (!isValidDomId(id)) return;
        s.tables[id] = {
            isLarge: table.classList.contains('t2-table-large'),
            hasScroll: !!wrap.querySelector('.t2-table-scroll-wrapper')
        };
    });
    return s;
}

function applyDOMState(html, s) {
    if (!s) return html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    for (const id in (s.mediaBlocks || {})) {
        if (!isValidDomId(id)) continue;
        const block = tmp.querySelector(`[data-block-id="${id}"]`);
        if (!block) continue;
        const c = block.querySelector('div:first-child');
        const m = c?.querySelector('img, iframe, video');
        const st = s.mediaBlocks[id];
        if (!c || !m) continue;
        c.style.width = st.cw; c.style.height = st.ch;
        c.style.margin = st.cm; c.style.maxWidth = st.cmw;
        m.style.width = st.mw; m.style.height = st.mh;
        m.dataset.width = st.ow; m.dataset.height = st.oh;
        c.dataset.originalWidth = st.ow; c.dataset.originalHeight = st.oh;
    }
    for (const id in (s.codeBlocks || {})) {
        if (!isValidDomId(id)) continue;
        const block = tmp.querySelector(`[data-block-id="${id}"]`);
        const code = block?.querySelector('code');
        const st = s.codeBlocks[id];
        if (!code || !st) continue;
        if (!st.placeholder) {
            code.textContent = st.content;
            code.classList.remove('code-placeholder');
        } else {
            code.textContent = '코드를 입력하세요';
            code.classList.add('code-placeholder');
        }
    }
    for (const id in (s.tables || {})) {
        if (!isValidDomId(id)) continue;
        const table = tmp.querySelector(`[data-table-id="${id}"]`);
        const wrap = table?.closest('.t2-table-wrapper');
        const st = s.tables[id];
        if (!table || !wrap || !st) continue;
        if (st.isLarge) {
            table.classList.add('t2-table-large');
            if (st.hasScroll && !wrap.querySelector('.t2-table-scroll-wrapper')) {
                const sw = document.createElement('div');
                sw.className = 't2-table-scroll-wrapper';
                wrap.insertBefore(sw, table);
                sw.appendChild(table);
            }
        } else {
            table.classList.remove('t2-table-large');
            const sw = wrap.querySelector('.t2-table-scroll-wrapper');
            if (sw) { sw.parentNode.insertBefore(table, sw); sw.remove(); }
        }
    }
    return tmp.innerHTML;
}

// ============================================================
// [v3.1.0] CryptoUtil — Web Crypto API 기반 SHA-256 해시 유틸
// ============================================================
// 블록체인 무결성 검증에 사용. 모든 해시는 결정적(동일 입력 → 동일 출력).
// ============================================================

const CryptoUtil = {
    // SHA-256 해시 → hex 문자열 반환
    async hash(data) {
        try {
            const input = (typeof data === 'string') ? data : JSON.stringify(data);
            const encoder = new TextEncoder();
            const buffer = encoder.encode(input);
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            // Web Crypto API 사용 불가 시 폴백 (빠른 비암호학적 해시)
            console.warn('[Collab][CryptoUtil] SHA-256 unavailable, using fallback hash');
            const str = (typeof data === 'string') ? data : JSON.stringify(data);
            let h = 0x811c9dc5;
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
            }
            return h.toString(16).padStart(8, '0');
        }
    },

    // 해시 배열의 Merkle 루트 계산 (이진 트리, 좌→우 페어링)
    async merkleRoot(hashes) {
        if (!hashes || hashes.length === 0) {
            return await this.hash('');
        }
        if (hashes.length === 1) return hashes[0];

        let current = hashes.slice();
        while (current.length > 1) {
            const next = [];
            for (let i = 0; i < current.length; i += 2) {
                const left = current[i];
                const right = (i + 1 < current.length) ? current[i + 1] : left;
                next.push(await this.hash(left + right));
            }
            current = next;
        }
        return current[0];
    },

    // 블록 체인 무결성 검증 — 각 블록의 해시와 prevHash 연결 확인
    async verifyChain(blocks) {
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return true;
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            // 제네시스 블록은 prevHash가 '0'이어야 함
            if (i === 0) {
                if (block.prevHash !== '0') return false;
            } else {
                if (block.prevHash !== blocks[i - 1].hash) return false;
            }
            // 블록 해시 재계산 및 비교
            const recomputedHash = await this._computeBlockHash(block);
            if (block.hash !== recomputedHash) return false;
        }
        return true;
    },

    // 블록 해시 계산 (index + timestamp + prevHash + data 직렬화 + validator)
    async _computeBlockHash(block) {
        const hashPayload = JSON.stringify({
            index: block.index,
            timestamp: block.timestamp,
            prevHash: block.prevHash,
            data: block.data,
            validator: block.validator
        });
        return await this.hash(hashPayload);
    }
};

// ============================================================
// [v3.1.0] BlockChain — 상태 스냅샷 블록 체인 관리
// ============================================================
// 이 블록체인은 암호화폐가 아닌 데이터 무결성·분산 검증·신뢰성을 위한
// 개념적(concept) 블록체인입니다. 각 상태 변화를 블록으로 기록하여
// 변조 여부를 감지하고, 분산 환경에서 체인을 비교·동기화합니다.
// ============================================================

class BlockChain {
    constructor(roomCode, clientId) {
        this.roomCode = roomCode;
        this.clientId = clientId;
        this.chain = [];
        this._initialized = false;
    }

    // 체인 초기화 — 제네시스 블록 생성
    async init() {
        if (this._initialized) return;
        if (this.chain.length === 0) {
            const genesisBlock = await this._createBlock(0, '0', { type: 'genesis', roomCode: this.roomCode });
            this.chain.push(genesisBlock);
        }
        this._initialized = true;
    }

    // 새 블록 추가
    async addBlock(data) {
        await this.init();
        const prevBlock = this.chain[this.chain.length - 1];
        const newBlock = await this._createBlock(this.chain.length, prevBlock.hash, data);
        this.chain.push(newBlock);
        // 최대 블록 수 유지 — 초과 시 오래된 블록 정리 (제네시스는 보존)
        if (this.chain.length > CFG.BLOCK_CHAIN_MAX_BLOCKS + 1) {
            // 제네시스 블록(인덱스 0)은 유지, 그 다음부터 N개만 유지
            const excess = this.chain.length - CFG.BLOCK_CHAIN_MAX_BLOCKS - 1;
            this.chain.splice(1, excess);
            // 인덱스 재정렬
            for (let i = 0; i < this.chain.length; i++) {
                this.chain[i].index = i;
            }
        }
        return newBlock;
    }

    // 전체 체인 무결성 검증
    async validateChain() {
        return await CryptoUtil.verifyChain(this.chain);
    }

    // 최신 블록 반환
    getLatestBlock() {
        return this.chain.length > 0 ? this.chain[this.chain.length - 1] : null;
    }

    // 최근 N개 블록 해시의 Merkle 루트 반환
    async getMerkleRoot(n = 10) {
        const recentBlocks = this.chain.slice(-n);
        const hashes = recentBlocks.map(b => b.hash);
        return await CryptoUtil.merkleRoot(hashes);
    }

    // 체인 요약 정보 (동기화에 사용)
    async getChainSummary() {
        const latestBlock = this.getLatestBlock();
        const merkleRoot = await this.getMerkleRoot();
        const recentHashes = this.chain.slice(-10).map(b => b.hash);
        return {
            length: this.chain.length,
            latestHash: latestBlock ? latestBlock.hash : '0',
            latestIndex: latestBlock ? latestBlock.index : 0,
            merkleRoot,
            recentHashes
        };
    }

    // 포크 해결 — 가장 긴 유효 체인 선택
    async resolveFork(remoteBlocks) {
        if (!remoteBlocks || remoteBlocks.length === 0) return this.chain;
        const remoteValid = await CryptoUtil.verifyChain(remoteBlocks);
        const localValid = await this.validateChain();
        // 원격 체인이 더 길고 유효하면 교체
        if (remoteValid && remoteBlocks.length > this.chain.length) {
            console.log('[Collab][BlockChain] fork resolved: adopting longer chain (' + remoteBlocks.length + ' > ' + this.chain.length + ')');
            this.chain = remoteBlocks;
        } else if (remoteValid && remoteBlocks.length === this.chain.length && localValid) {
            // 같은 길이면 Merkle root 비교
            const remoteMerkle = await CryptoUtil.merkleRoot(remoteBlocks.map(b => b.hash));
            const localMerkle = await CryptoUtil.merkleRoot(this.chain.map(b => b.hash));
            if (remoteMerkle < localMerkle) {
                // 결정적 선택: 더 작은 Merkle root를 가진 체인 선택
                this.chain = remoteBlocks;
            }
        }
        return this.chain;
    }

    // 체인을 직렬화 가능한 배열로 반환
    getChain() {
        return this.chain.map(b => ({ ...b }));
    }

    // 직렬화된 체인 데이터로 복원
    async loadChain(blocks) {
        if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return;
        const valid = await CryptoUtil.verifyChain(blocks);
        if (valid) {
            this.chain = blocks;
            this._initialized = true;
        } else {
            console.warn('[Collab][BlockChain] loaded chain is invalid, keeping current chain');
        }
    }

    // 내부: 블록 생성
    async _createBlock(index, prevHash, data) {
        const block = {
            index,
            timestamp: Date.now(),
            prevHash,
            data: {
                reactions: data.reactions || {},
                statuses: data.statuses || {},
                documentHash: data.documentHash || '',
                chatHash: data.chatHash || '',
                type: data.type || 'state'
            },
            hash: '',       // 해시는 나중에 계산
            validator: this.clientId
        };
        block.hash = await CryptoUtil._computeBlockHash(block);
        return block;
    }
}

// ============================================================
// [v3.1.0] DistributedStore — IndexedDB 기반 분산 스토어
// ============================================================
// localStorage 대신 IndexedDB 사용으로 더 큰 용량 확보.
// 콘텐츠 어드레스드(content-addressed) 저장: 각 청크를 SHA-256 해시로 저장.
// IndexedDB 사용 불가 시 localStorage로 폴백.
// ============================================================

class DistributedStore {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.dbName = CFG.INDEXEDDB_NAME + '_' + roomCode;
        this.dbVersion = CFG.INDEXEDDB_VERSION;
        this.db = null;
        this._useLocalStorage = false;
        this._lsPrefix = 't2c_ds_' + roomCode + '_';
        this._ready = false;
        this._readyPromise = null;
    }

    // 초기화 — DB 열기
    async init() {
        if (this._ready) return;
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = this._initDB();
        return this._readyPromise;
    }

    async _initDB() {
        // IndexedDB 사용 가능 여부 확인
        if (!window.indexedDB) {
            console.warn('[Collab][분산 저장소] IndexedDB를 사용할 수 없어 localStorage로 대체합니다.');
            this._useLocalStorage = true;
            this._ready = true;
            return;
        }

        try {
            this.db = await new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    // 블록 체인 저장소
                    if (!db.objectStoreNames.contains('blocks')) {
                        db.createObjectStore('blocks', { keyPath: 'index' });
                    }
                    // 콘텐츠 어드레스드 청크 저장소
                    if (!db.objectStoreNames.contains('chunks')) {
                        db.createObjectStore('chunks', { keyPath: 'hash' });
                    }
                    // 일반 상태 저장소
                    if (!db.objectStoreNames.contains('state')) {
                        db.createObjectStore('state', { keyPath: 'key' });
                    }
                };
                request.onsuccess = (event) => resolve(event.target.result);
                request.onerror = (event) => reject(event.target.error);
            });
            this._ready = true;
        } catch (e) {
            console.warn('[Collab][분산 저장소] IndexedDB 열기에 실패하여 localStorage로 대체합니다:', e);
            this._useLocalStorage = true;
            this._ready = true;
        }
    }

    // 블록 저장
    async saveBlock(block) {
        await this.init();
        if (this._useLocalStorage) return this._lsSave('block_' + block.index, block);
        return this._idbPut('blocks', block);
    }

    // 블록 조회 (인덱스로)
    async getBlock(index) {
        await this.init();
        if (this._useLocalStorage) return this._lsLoad('block_' + index);
        return this._idbGet('blocks', index);
    }

    // 전체 체인 반환
    async getChain() {
        await this.init();
        if (this._useLocalStorage) {
            const chain = [];
            let i = 0;
            while (true) {
                const block = this._lsLoad('block_' + i);
                if (!block) break;
                chain.push(block);
                i++;
            }
            return chain;
        }
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction('blocks', 'readonly');
                const store = tx.objectStore('blocks');
                const req = store.getAll();
                req.onsuccess = () => {
                    const blocks = req.result || [];
                    blocks.sort((a, b) => a.index - b.index);
                    resolve(blocks);
                };
                req.onerror = () => resolve([]);
            } catch (e) { resolve([]); }
        });
    }

    // 콘텐츠 어드레스드 청크 저장
    async saveChunk(hash, data) {
        await this.init();
        const record = { hash, data, ts: Date.now() };
        if (this._useLocalStorage) return this._lsSave('chunk_' + hash, record);
        return this._idbPut('chunks', record);
    }

    // 청크 조회 (해시로)
    async getChunk(hash) {
        await this.init();
        if (this._useLocalStorage) return (await this._lsLoad('chunk_' + hash))?.data || null;
        const record = await this._idbGet('chunks', hash);
        return record ? record.data : null;
    }

    // 일반 상태 저장
    async saveState(key, data) {
        await this.init();
        const record = { key, data, ts: Date.now() };
        if (this._useLocalStorage) return this._lsSave('state_' + key, record);
        return this._idbPut('state', record);
    }

    // 일반 상태 조회
    async loadState(key) {
        await this.init();
        if (this._useLocalStorage) return (await this._lsLoad('state_' + key))?.data || null;
        const record = await this._idbGet('state', key);
        return record ? record.data : null;
    }

    // 오래된 블록 정리 — 마지막 N개만 유지
    async prune(maxBlocks) {
        await this.init();
        if (this._useLocalStorage) {
            // localStorage 정리: 최대 블록 수 초과 시 오래된 것 제거
            const chain = await this.getChain();
            if (chain.length <= maxBlocks) return;
            const removeCount = chain.length - maxBlocks;
            for (let i = 0; i < removeCount; i++) {
                this._lsRemove('block_' + chain[i].index);
            }
            return;
        }
        try {
            const tx = this.db.transaction('blocks', 'readwrite');
            const store = tx.objectStore('blocks');
            const req = store.getAll();
            req.onsuccess = () => {
                const blocks = req.result || [];
                if (blocks.length <= maxBlocks) return;
                blocks.sort((a, b) => a.index - b.index);
                const removeCount = blocks.length - maxBlocks;
                for (let i = 0; i < removeCount; i++) {
                    store.delete(blocks[i].index);
                }
            };
        } catch (e) {}
    }

    // DB 삭제 (방 종료 시)
    async destroy() {
        if (this._useLocalStorage) {
            // localStorage 정리: 이 방의 모든 키 삭제
            const keysToRemove = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(this._lsPrefix)) keysToRemove.push(key);
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) {}
            return;
        }
        try {
            if (this.db) { this.db.close(); this.db = null; }
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(this.dbName);
                req.onsuccess = resolve;
                req.onerror = resolve; // 실패해도 무시
            });
        } catch (e) {}
    }

    // ── IndexedDB 내부 유틸 ──
    _idbPut(storeName, data) {
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const req = store.put(data);
                req.onsuccess = () => resolve(true);
                req.onerror = () => { console.warn('[분산 저장소] 저장 실패'); resolve(false); };
            } catch (e) { resolve(false); }
        });
    }

    _idbGet(storeName, key) {
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }

    // ── localStorage 폴백 유틸 ──
    _lsSave(suffix, data) {
        try {
            localStorage.setItem(this._lsPrefix + suffix, JSON.stringify(data));
            return true;
        } catch (e) { return false; }
    }

    _lsLoad(suffix) {
        try {
            const raw = localStorage.getItem(this._lsPrefix + suffix);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    _lsRemove(suffix) {
        try { localStorage.removeItem(this._lsPrefix + suffix); } catch (e) {}
    }
}

// ============================================================
// 1. PeerJS 동적 로더
// ============================================================

let _peerJsLoadPromise = null;
function loadPeerJS() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (_peerJsLoadPromise) return _peerJsLoadPromise;

    _peerJsLoadPromise = new Promise((resolve, reject) => {
        let i = 0;
        const tryNext = () => {
            if (i >= CFG.PEERJS_CDNS.length) return reject(new Error('peerjs_cdn_unreachable'));
            const url = CFG.PEERJS_CDNS[i++];
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.onload = () => {
                if (window.Peer) resolve(window.Peer);
                else tryNext();
            };
            s.onerror = () => { s.remove(); tryNext(); };
            document.head.appendChild(s);
        };
        tryNext();
    });
    return _peerJsLoadPromise;
}

// ============================================================
// 2. Selection / Cursor path 인코딩
// ============================================================
// 협업 노드별로 동일한 DOM에서 caret 좌표를 복원하려면 선택 위치를
// node-path + offset 으로 표현해 전송한다.
//   path: 에디터 루트로부터 자식 인덱스 배열
//   offset: 텍스트 노드라면 글자 오프셋, 엘리먼트 노드면 child index
// 안전 한도: path 길이 30 / offset 50000
// ============================================================

function getNodePath(root, node) {
    if (!root || !node) return null;
    const path = [];
    let cur = node;
    while (cur && cur !== root) {
        const parent = cur.parentNode;
        if (!parent) return null;
        const idx = Array.prototype.indexOf.call(parent.childNodes, cur);
        if (idx < 0) return null;
        path.unshift(idx);
        cur = parent;
        if (path.length > 30) return null;
    }
    return cur === root ? path : null;
}

function resolveNodePath(root, path) {
    if (!root || !Array.isArray(path)) return null;
    let cur = root;
    for (const idx of path) {
        if (!cur || !cur.childNodes || idx >= cur.childNodes.length) return null;
        cur = cur.childNodes[idx];
    }
    return cur;
}

function captureSelection(editorRoot) {
    try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        // selection 이 editor 안에 있는지 확인
        if (!editorRoot.contains(range.startContainer)) return null;

        const sp = getNodePath(editorRoot, range.startContainer);
        const ep = getNodePath(editorRoot, range.endContainer);
        if (!sp || !ep) return null;
        return {
            sp, so: Math.min(range.startOffset, 50000),
            ep, eo: Math.min(range.endOffset, 50000),
            collapsed: range.collapsed
        };
    } catch (e) { return null; }
}

// remote selection → 가시화용 (DOMRect 들 반환)
function selectionToRects(editorRoot, sel) {
    try {
        const sn = resolveNodePath(editorRoot, sel.sp);
        const en = resolveNodePath(editorRoot, sel.ep);
        if (!sn || !en) return null;
        const range = document.createRange();
        // 안전 offset clamp
        const so = Math.min(sel.so, sn.nodeType === 3 ? sn.length : sn.childNodes.length);
        const eo = Math.min(sel.eo, en.nodeType === 3 ? en.length : en.childNodes.length);
        range.setStart(sn, so);
        range.setEnd(en, eo);

        const rects = sel.collapsed ? [] : Array.from(range.getClientRects());
        // caret 위치: 시작점 또는 끝점 기준 (collapsed=true: 동일)
        const caretRange = document.createRange();
        caretRange.setStart(en, eo);
        caretRange.setEnd(en, eo);
        let caretRect = caretRange.getBoundingClientRect();
        if ((!caretRect || (caretRect.width === 0 && caretRect.height === 0)) && sn) {
            // 빈 줄: 가장 가까운 요소 박스 사용
            const block = (sn.nodeType === 1 ? sn : sn.parentElement);
            if (block) caretRect = block.getBoundingClientRect();
        }
        return { rects, caretRect };
    } catch (e) { return null; }
}

// ============================================================
// 3. Transport: P2P (PeerJS) - awareness 메시지 동일 채널 재사용
// ============================================================

class P2PTransport {
    constructor(plugin) {
        this.plugin = plugin;
        this.peer = null;
        this.isHost = plugin.isHost;
        this.connections = new Map();
        this.opened = false;
        this.closed = false;
        this._onMessage = null;
        this._users = new Map();
        this._heartbeatTimer = null;
        this._latency = 0;
        this._lastPingTs = 0;
        this._forcePeerId = null;
        this._peerCfg = null;
        this._hostStopped = false; // [v2.1.3] 호스트가 의도적으로 방 종료 시 true
    }

    onMessage(cb) { this._onMessage = cb; }

    async start() {
        const Peer = await loadPeerJS();
        // [FIX] 백업 호스트 인계 시 _forcePeerId 가 사용되지 않던 문제 수정
        const peerId = this._forcePeerId || (CFG.PEER_NS + this.plugin.collabCode);

        // ── 안정성 향상 모드: 더 많은 STUN/TURN(외부 무료 공개 중계 서버) +
        //    여러 시그널링 브로커를 순차 시도하여 연결 성공률을 높임 ──
        const stability = !!this.plugin.stabilityMode;
        const iceServers = (stability && CFG.STABILITY_ICE_SERVERS && CFG.STABILITY_ICE_SERVERS.length)
            ? CFG.STABILITY_ICE_SERVERS : CFG.ICE_SERVERS;
        const brokers = (stability && CFG.STABILITY_PEERJS_BROKERS && CFG.STABILITY_PEERJS_BROKERS.length)
            ? CFG.STABILITY_PEERJS_BROKERS : CFG.PEERJS_BROKERS;
        const perBrokerTimeout = stability ? CFG.STABILITY_BROKER_TIMEOUT_MS : CFG.P2P_CONNECT_TIMEOUT;

        let lastErr = null;
        for (let i = 0; i < brokers.length; i++) {
            const peerOpts = Object.assign({ config: { iceServers } }, brokers[i], { debug: 0 });
            try {
                await this._connectViaBroker(Peer, peerId, peerOpts, perBrokerTimeout);
                this._peerCfg = peerOpts;
                return;
            } catch (e) {
                lastErr = e;
                // 방 코드 자체의 충돌(이미 사용 중인 호스트 ID)은 브로커를 바꿔도 해결되지 않음
                if (e && e.message === 'p2p_id_taken') throw e;
                if (i < brokers.length - 1) {
                    // 다음 브로커 재시도를 위해 상태 초기화
                    this.closed = false;
                    this.opened = false;
                    this.connections.clear();
                    this.peer = null;
                    console.warn('[Collab][P2P] broker', i, 'failed, trying next broker:', e && e.message);
                    continue;
                }
            }
        }
        throw lastErr || new Error('p2p_all_brokers_failed');
    }

    _connectViaBroker(Peer, peerId, peerOpts, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.close();
                reject(new Error('p2p_timeout'));
            }, timeoutMs);

            if (this.isHost) {
                this.peer = new Peer(peerId, peerOpts);
                this.peer.on('open', () => {
                    clearTimeout(timeoutId);
                    this.opened = true;
                    this._registerSelf();
                    this._startHeartbeat();
                    resolve();
                });
                this.peer.on('connection', (conn) => this._onIncomingGuest(conn));
                this.peer.on('error', (e) => this._handleError(e, timeoutId, reject));
                this.peer.on('disconnected', () => this._tryReconnect());
            } else {
                this.peer = new Peer(peerOpts);
                this.peer.on('open', () => {
                    const conn = this.peer.connect(peerId, {
                        reliable: true,
                        metadata: {
                            client_id: this.plugin.client_id,
                            nickname: this.plugin.nickname,
                            color_hue: this.plugin.userColor.hue
                        }
                    });
                    conn.on('open', () => {
                        clearTimeout(timeoutId);
                        this.opened = true;
                        this.connections.set('host', conn);
                        this._setupGuestConn(conn);
                        this._startHeartbeat();
                        resolve();
                    });
                    conn.on('error', (e) => this._handleError(e, timeoutId, reject));
                    setTimeout(() => {
                        if (!this.opened) {
                            this.close();
                            clearTimeout(timeoutId);
                            reject(new Error('p2p_host_unreachable'));
                        }
                    }, timeoutMs - 500);
                });
                this.peer.on('error', (e) => this._handleError(e, timeoutId, reject));
            }
        });
    }

    _handleError(e, timeoutId, reject) {
        const t = e && e.type;
        if (this.isHost && t === 'unavailable-id') {
            clearTimeout(timeoutId);
            this.close();
            reject(new Error('p2p_id_taken'));
            return;
        }
        if (!this.opened) {
            clearTimeout(timeoutId);
            this.close();
            reject(new Error('p2p_error:' + (t || 'unknown')));
        } else {
            console.warn('[Collab][P2P] runtime error:', e);
            if (this._onMessage) this._onMessage({ t: '__error__', p: e });
        }
    }

    _tryReconnect() {
        if (this.closed) return;
        try { this.peer && this.peer.reconnect(); } catch (e) {}
    }

    _registerSelf() {
        this._users.set(this.plugin.client_id, {
            client_id: this.plugin.client_id,
            nickname: this.plugin.nickname || '호스트',
            isHost: true,
            color_hue: this.plugin.userColor.hue,
            conn: null
        });
    }

    _onIncomingGuest(conn) {
        if (this._users.size >= 50) {
            try { conn.close(); } catch (e) {}
            return;
        }
        conn.on('open', () => {
            const meta = conn.metadata || {};
            const cid = (typeof meta.client_id === 'string' && meta.client_id.length <= 64)
                ? meta.client_id : uuidv4();
            const nick = (typeof meta.nickname === 'string')
                ? meta.nickname.substring(0, 50) : '익명';
            const hue = (typeof meta.color_hue === 'number' && meta.color_hue >= 0 && meta.color_hue < 360)
                ? meta.color_hue
                : pickUserColor(cid + ':' + this.plugin.collabCode).hue;

            this._users.set(cid, { client_id: cid, nickname: nick, isHost: false, color_hue: hue, conn });
            this.connections.set(cid, conn);

            const fullMsg = this.plugin._buildFullMessage();
            this._sendRaw(conn, fullMsg);
            this._broadcastUsers();

            // [v2.1.4] 호스트에게 참가 알림
            if (this._onMessage) {
                this._onMessage({ t: '__peer_joined__', p: { client_id: cid, nickname: nick } });
            }

            // 호스트의 awareness 도 즉시 전송
            const aw = this.plugin._buildAwarenessMessage(true);
            if (aw) this._sendRaw(conn, aw);

            // [v2.5.0] 현재 리액션 상태 + 원격 상태를 새 게스트에게 전송
            // 이것이 없으면 새 참가자는 기존 리액션을 볼 수 없음
            const stateSync = this.plugin._buildStateSyncMessage();
            if (stateSync) this._sendRaw(conn, stateSync);

            // [v3.1.0] 블록 체인 요약도 새 게스트에게 전송
            if (this.plugin._blockChain) {
                (async () => {
                    try {
                        const summary = await this.plugin._blockChain.getChainSummary();
                        const chain = this.plugin._blockChain.chain.slice(-10);
                        this._sendRaw(conn, {
                            t: CFG.MSG_TYPES.BLOCK_SYNC,
                            p: { summary, chain },
                            from: this.plugin.client_id,
                            ts: Date.now()
                        });
                    } catch (e) {}
                })();
            }

            conn.on('data', (data) => this._onDataFromGuest(cid, data));
            conn.on('close', () => {
                // [v2.1.4] 퇴장 알림을 _broadcastUsers() 이전에 발생시켜
                // 호스트가 퇴장자 닉네임을 찾을 수 있도록 함
                if (this._onMessage) this._onMessage({ t: '__peer_left__', p: { client_id: cid } });
                this.connections.delete(cid);
                this._users.delete(cid);
                this._broadcastUsers();
            });
            conn.on('error', (e) => console.warn('[Collab][P2P] guest conn err:', e));
        });
    }

    _setupGuestConn(conn) {
        conn.on('data', (data) => {
            if (!data || typeof data !== 'object') return;
            if (data.t === CFG.MSG_TYPES.PONG) {
                this._latency = Date.now() - (this._lastPingTs || Date.now());
                if (this._onMessage) this._onMessage({ t: '__latency__', p: this._latency });
                return;
            }
            // [FIX v2.1.3] 게스트가 USERS 메시지를 수신하면 즉시 users 배열 선반영
            // 기존: _onMessage 콜백으로만 전달되어 타이밍에 따라 유저 목록이 갱신되지 않았음
            // _handleIncoming에서도 users를 세팅하므로 여기서는 데이터만 선반영하고
            // UI 갱신은 _handleIncoming에 맡김 (이중 렌더링 방지 + backupRank 보존)
            if (data.t === CFG.MSG_TYPES.USERS && Array.isArray(data.p)) {
                this.plugin.users = data.p;
            }
            // [FIX v2.1.3] ROOM_STOP: 호스트가 방 종료 → 게스트에게 즉시 전파
            // _hostStopped 플래그를 _onMessage 호출 전에 먼저 설정하여,
            // 이후 conn.on('close')가 먼저 발동해도 재연결을 시도하지 않도록 함 (race condition 방어)
            if (data.t === CFG.MSG_TYPES.ROOM_STOP) {
                this._hostStopped = true;
                if (this._onMessage) this._onMessage(data);
                return;
            }
            this._onMessage && this._onMessage(data);
        });
        conn.on('close', () => {
            // [FIX v2.1.3] _hostStopped 플래그: 호스트가 의도적으로 종료한 경우
            // 재연결을 시도하지 않고 깔끔하게 종료 처리
            if (this._hostStopped) {
                if (this._onMessage) this._onMessage({ t: '__host_stopped__' });
                return;
            }
            if (this._onMessage) this._onMessage({ t: '__disconnected__' });
        });
        conn.on('error', (e) => console.warn('[Collab][P2P] host conn err:', e));
    }

    _onDataFromGuest(fromCid, data) {
        if (!data || typeof data !== 'object') return;
        if (data.t === CFG.MSG_TYPES.PING) {
            this._sendRaw(this.connections.get(fromCid), { t: CFG.MSG_TYPES.PONG, ts: Date.now() });
            return;
        }
        // [PATCH-P9-01] 호스트 전용 메시지 검증 — 게스트가 보낸 권한 메시지 차단
        const _hostOnlyTypes = new Set([
            CFG.MSG_TYPES.KICK, CFG.MSG_TYPES.ROOM_STOP,
            CFG.MSG_TYPES.TAKE_HOST, CFG.MSG_TYPES.USER_LOCK
        ]);
        if (_hostOnlyTypes.has(data.t)) {
            console.warn('[Collab][P2P] rejected host-only message from guest:', data.t);
            return;
        }
        if (!data.from) data.from = fromCid;

        // DM 라우팅: to 가 설정된 경우 → 해당 수신자에게만 relay, 호스트는 처리 안 함
        const targetCid = data.to || (data.p && data.p.to) || null;
        if (targetCid && targetCid !== this.plugin.client_id) {
            const targetConn = this.connections.get(targetCid);
            if (targetConn) this._sendRaw(targetConn, data);
            return;
        }

        // 호스트 본인 처리 (broadcast 또는 to=host)
        this._onMessage && this._onMessage(data);

        // broadcast relay (to 없을 때만)
        if (!targetCid) {
            const _relayTypes = new Set([
                CFG.MSG_TYPES.FULL, CFG.MSG_TYPES.AWARENESS,
                CFG.MSG_TYPES.CHAT, CFG.MSG_TYPES.FILE_META,
                CFG.MSG_TYPES.FILE_CHUNK, CFG.MSG_TYPES.TYPING,
                CFG.MSG_TYPES.LOCK, CFG.MSG_TYPES.STATUS,
                CFG.MSG_TYPES.REACT, CFG.MSG_TYPES.READ,
                CFG.MSG_TYPES.HB, CFG.MSG_TYPES.TAKE_HOST,
                CFG.MSG_TYPES.USER_LOCK, CFG.MSG_TYPES.ROOM_STOP,
                CFG.MSG_TYPES.STATE_SYNC,  // [v2.5.0] 전체 상태 동기화 메시지
                CFG.MSG_TYPES.BLOCK_SYNC,  // [v3.1.0] 블록 체인 동기화
                CFG.MSG_TYPES.CHUNK_REQ,   // [v3.1.0] 콘텐츠 청크 요청
                CFG.MSG_TYPES.CHUNK_RES    // [v3.1.0] 콘텐츠 청크 응답
            ]);
            if (_relayTypes.has(data.t)) {
                for (const [cid, conn] of this.connections) {
                    if (cid !== fromCid) this._sendRaw(conn, data);
                }
            }
        }
    }

    _broadcastUsers() {
        if (!this.isHost) return;
        const list = [];
        for (const u of this._users.values()) {
            list.push({
                client_id: u.client_id,
                nickname:  u.nickname,
                isHost:    u.isHost,
                color_hue: u.color_hue
            });
        }
        const msg = { t: CFG.MSG_TYPES.USERS, p: list, ts: Date.now() };
        // 호스트 자신의 users 즉시 갱신 (onMessage 콜백 대신 직접 갱신 → 타이밍 버그 방지)
        this.plugin.users = list;
        this.plugin._updateUsersListUI(this.plugin._modalOverlay);
        // 게스트들에게 전송
        for (const conn of this.connections.values()) this._sendRaw(conn, msg);
    }

    _sendRaw(conn, msg) {
        try { if (conn && conn.open) conn.send(msg); }
        catch (e) { console.warn('[Collab][P2P] send fail:', e); }
    }

    send(msg) {
        if (!this.opened || this.closed) return false;
        // [FIX v2.3.0] 호스트가 DM(to 필드 설정)을 보낼 때 전체 브로드캐스트하지 않고
        // 해당 수신자에게만 전송. 그 외 메시지는 기존대로 브로드캐스트.
        const dmTarget = msg.to || (msg.p && msg.p.to) || null;
        if (this.isHost) {
            if (dmTarget) {
                // DM: 대상 연결에만 전송 + 호스트 자신도 처리
                const targetConn = this.connections.get(dmTarget);
                if (targetConn) this._sendRaw(targetConn, msg);
                // 호스트 자신이 발신자가 아닌 경우(예: 다른 게스트가 호스트에게 보낸 DM을
                // relay할 때) 호스트도 수신 처리해야 함.
                // 하지만 이 send()는 "발신" 전용이므로 호스트가 직접 보낸 경우만 처리.
                // _onDataFromGuest에서 relay 시 호스트 처리는 별도로 됨.
            } else {
                // 브로드캐스트: DM이 아닌 모든 메시지
                for (const conn of this.connections.values()) this._sendRaw(conn, msg);
            }
        } else {
            const c = this.connections.get('host');
            this._sendRaw(c, msg);
        }
        return true;
    }

    kick(targetCid) {
        if (!this.isHost) return false;
        const conn = this.connections.get(targetCid);
        if (!conn) return false;
        this._sendRaw(conn, { t: CFG.MSG_TYPES.KICK, ts: Date.now() });
        setTimeout(() => { try { conn.close(); } catch (e) {} }, 300);
        return true;
    }

    // [v2.1.3] 호스트가 방 종료 시 모든 게스트에게 ROOM_STOP 브로드캐스트
    broadcastRoomStop() {
        if (!this.isHost) return;
        const msg = { t: CFG.MSG_TYPES.ROOM_STOP, ts: Date.now() };
        for (const conn of this.connections.values()) {
            this._sendRaw(conn, msg);
        }
    }

    _startHeartbeat() {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = setInterval(() => {
            if (this.closed) return;
            if (!this.isHost) {
                const c = this.connections.get('host');
                if (c && c.open) {
                    this._lastPingTs = Date.now();
                    this._sendRaw(c, { t: CFG.MSG_TYPES.PING, ts: this._lastPingTs });
                }
            }
        }, CFG.HEARTBEAT_MS);
    }

    close() {
        this.closed = true;
        clearInterval(this._heartbeatTimer);
        try { for (const c of this.connections.values()) c.close && c.close(); } catch (e) {}
        this.connections.clear();
        try { this.peer && this.peer.destroy(); } catch (e) {}
        this.peer = null;
    }
}

// ============================================================
// 4. Transport: PHP+JSON (fallback)
// ============================================================
// PHP 모드에서는 awareness 를 별도로 전달하지 않음 (서버 변경 없음).
// awareness 는 P2P 전용 - PHP fallback 으로 떨어지면 커서 공유 자동 비활성.
// ============================================================

class PhpTransport {
    constructor(plugin) {
        this.plugin = plugin;
        this.t2url = plugin.t2url;
        this.pollTimer = null;
        this.knownVersion = 0;
        this._onMessage = null;
        this.closed = false;
        this._sending = false;
        this._pollFailCount = 0;
        this._lastChatTs = 0;
    }
    onMessage(cb) { this._onMessage = cb; }

    async _post(action, body, retries = 2) {
        const url = this.t2url + '/plugin/collab/collab_number.php';
        for (let i = 0; i < retries; i++) {
            try {
                const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({}, body, { action }))
                });
                if (!r.ok) {
                    if (i < retries - 1) { await new Promise(r => setTimeout(r, 300 * (i + 1))); continue; }
                    return null;
                }
                return await r.json();
            } catch (e) {
                if (i < retries - 1) await new Promise(r => setTimeout(r, 300 * (i + 1)));
            }
        }
        return null;
    }

    async start() {
        const p = this.plugin;
        if (p.isHost && !p.hostToken) {
            const r = await this._post('create', {});
            if (!r || !r.success) throw new Error('php_create_failed');
            p.collabCode = r.code;
            p.hostToken = r.host_token;
        }
        const jr = await this._post('join', {
            code: p.collabCode,
            client_id: p.client_id,
            nickname: p.nickname,
            ...(p.hostToken ? { host_token: p.hostToken } : {})
        });
        if (!jr || !jr.success) throw new Error('php_join_failed');
        if (jr.is_host) { p.isHost = true; p.hostToken = jr.host_token; }

        const gr = await this._post('get', {
            code: p.collabCode,
            client_id: p.client_id,
            ...(p.hostToken ? { host_token: p.hostToken } : {})
        });
        if (gr && gr.success && gr.data) {
            this.knownVersion = gr.data.version || 0;
            this._onMessage && this._onMessage({
                t: CFG.MSG_TYPES.FULL,
                p: { content: gr.data.content || '', domState: gr.data.domState || {} },
                v: this.knownVersion
            });
            this._onMessage && this._onMessage({
                t: CFG.MSG_TYPES.USERS,
                p: gr.data.users || []
            });
        }
        // [v2.2.0] 초기 채팅 메시지 로드
        const cr = await this._post('chat_get', {
            code: p.collabCode,
            client_id: p.client_id,
            since_ts: 0,
            ...(p.hostToken ? { host_token: p.hostToken } : {})
        });
        if (cr && cr.success && Array.isArray(cr.messages) && cr.messages.length > 0) {
            this._lastChatTs = Math.max(...cr.messages.map(m => m.ts || 0));
            // 자신이 보낸 메시지 제외하고 수신 처리
            const incoming = cr.messages.filter(m => (m.client_id || m.from) !== p.client_id);
            for (const m of incoming) {
                // [v2.4.0] 리액션 타입 처리
                if (m.type === 'react' && m.react_msg_id && m.react_emoji) {
                    this._onMessage && this._onMessage({
                        t: CFG.MSG_TYPES.REACT,
                        p: {
                            msgId: m.react_msg_id,
                            emoji: m.react_emoji,
                            client_id: m.client_id || m.from,
                            nickname: m.nickname || '익명',
                            remove: !!m.react_remove
                        },
                        from: m.client_id || m.from,
                        ts: m.ts
                    });
                } else {
                    this._onMessage && this._onMessage({
                        t: CFG.MSG_TYPES.CHAT,
                        p: m,
                        from: m.client_id || m.from,
                        ts: m.ts
                    });
                }
            }
        }
        this._startPoll();
    }

    _startPoll() {
        clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => this._poll(), CFG.PHP_POLL_MS);
    }

    async _poll() {
        if (this.closed || this._sending) return;
        const p = this.plugin;
        const r = await this._post('get', {
            code: p.collabCode,
            client_id: p.client_id,
            since_version: this.knownVersion,
            ...(p.hostToken ? { host_token: p.hostToken } : {})
        });
        // [FIX v2.1.4] 방이 삭제된 경우(no_room) → 호스트가 방 종료로 처리
        // 게스트는 재연결 시도 없이 깔끔하게 종료되어야 함
        if (r && !r.success && r.error === 'no_room') {
            this.closed = true;
            clearInterval(this.pollTimer); this.pollTimer = null;
            this._onMessage && this._onMessage({ t: '__host_stopped__' });
            return;
        }
        // 네트워크 오류 (!r)와 인증 오류 (unauthorized) 분리 처리
        if (!r) {
            // 네트워크 오류: 일시적일 수 있으므로 높은 임계값
            this._pollFailCount = (this._pollFailCount || 0) + 1;
            if (this._pollFailCount >= 5) {
                this.closed = true;
                clearInterval(this.pollTimer); this.pollTimer = null;
                this._onMessage && this._onMessage({ t: '__host_stopped__' });
            }
            return;
        }
        if (!r.success && r.error === 'unauthorized') {
            // 인증 오류: 방이 삭제되었을 가능성이 높음
            this._pollFailCount = (this._pollFailCount || 0) + 1;
            if (this._pollFailCount >= 3) {
                this.closed = true;
                clearInterval(this.pollTimer); this.pollTimer = null;
                this._onMessage && this._onMessage({ t: '__host_stopped__' });
            }
            return;
        }
        this._pollFailCount = 0;
        if (!r.success || !r.data) return;
        if (r.data.version > this.knownVersion) {
            this.knownVersion = r.data.version;
            this._onMessage && this._onMessage({
                t: CFG.MSG_TYPES.FULL,
                p: { content: r.data.content || '', domState: r.data.domState || {} },
                v: this.knownVersion
            });
        }
        if (r.data.users) {
            const list = Array.isArray(r.data.users) ? r.data.users : [];
            // [v2.1.4] PHP 모드: 새 참가자 감지 (게스트끼리 참가 알림)
            if (this.plugin._usersInitialized) {
                const prevIds = new Set((this.plugin.users || []).map(u => u.client_id));
                const newUsers = list.filter(u => !prevIds.has(u.client_id));
                for (const nu of newUsers) {
                    if (nu.client_id !== this.plugin.client_id && nu.nickname) {
                        showToast(`${nu.nickname}님이 참가했습니다.`, 'info', 2500);
                    }
                }
                // [v2.1.4] PHP 모드: 퇴장 감지
                const incomingIds = new Set(list.map(u => u.client_id));
                const leftUsers = (this.plugin.users || []).filter(u => !incomingIds.has(u.client_id) && u.client_id !== this.plugin.client_id);
                for (const lu of leftUsers) {
                    if (lu.nickname) {
                        showToast(`${lu.nickname}님이 나갔습니다.`, 'info', 2500);
                    }
                }
            }
            this.plugin.users = list;
            this.plugin._updateUsersListUI(this.plugin._modalOverlay);
        }
        // [v2.2.0] PHP 모드: 채팅 메시지 폴링
        if (this.plugin.mode === 'php') {
            this._pollChatMessages();
        }
    }

    async _pollChatMessages() {
        const p = this.plugin;
        if (!p.collabCode) return;
        try {
            const r = await this._post('chat_get', {
                code: p.collabCode,
                client_id: p.client_id,
                since_ts: this._lastChatTs || 0,
                ...(p.hostToken ? { host_token: p.hostToken } : {})
            });
            if (r && r.success && Array.isArray(r.messages) && r.messages.length > 0) {
                // 타임스탬프 업데이트
                const maxTs = Math.max(...r.messages.map(m => m.ts || 0));
                if (maxTs > (this._lastChatTs || 0)) this._lastChatTs = maxTs;

                // 내가 보낸 메시지는 제외 (이미 로컬에 있음)
                const newMsgs = r.messages.filter(m => (m.client_id || m.from) !== p.client_id);
                for (const m of newMsgs) {
                    // [v2.4.0] 리액션 타입 메시지 처리
                    if (m.type === 'react' && m.react_msg_id && m.react_emoji) {
                        this._onMessage && this._onMessage({
                            t: CFG.MSG_TYPES.REACT,
                            p: {
                                msgId: m.react_msg_id,
                                emoji: m.react_emoji,
                                client_id: m.client_id || m.from,
                                nickname: m.nickname || '익명',
                                remove: !!m.react_remove
                            },
                            from: m.client_id || m.from,
                            ts: m.ts
                        });
                    } else {
                        this._onMessage && this._onMessage({
                            t: CFG.MSG_TYPES.CHAT,
                            p: m,
                            from: m.client_id || m.from,
                            ts: m.ts
                        });
                    }
                }
            }
        } catch (e) {
            // 채팅 폴링 실패는 조용히 무시 (문서 동기화에는 영향 없음)
        }
    }

    async send(msg) {
        if (this.closed) return false;
        // PHP 모드에서는 awareness 메시지는 무시
        if (msg.t === CFG.MSG_TYPES.AWARENESS) return false;

        // 문서 동기화 (FULL)
        if (msg.t === CFG.MSG_TYPES.FULL) {
            const p = this.plugin;
            this._sending = true;
            try {
                const r = await this._post('update', {
                    code: p.collabCode,
                    client_id: p.client_id,
                    version: this.knownVersion,
                    operation: {
                        type: 'full',
                        content: msg.p.content,
                        domState: msg.p.domState,
                        timestamp: isoNow(),
                        client_id: p.client_id
                    },
                    host_token: p.hostToken
                });
                if (r && r.success) {
                    this.knownVersion = r.new_version || (this.knownVersion + 1);
                    return true;
                }
                if (r && r.conflict) {
                    this.knownVersion = r.current_version || this.knownVersion;
                    this._onMessage && this._onMessage({
                        t: CFG.MSG_TYPES.FULL,
                        p: { content: r.current_content || '', domState: r.current_dom_state || {} },
                        v: this.knownVersion
                    });
                }
                return false;
            } finally {
                this._sending = false;
            }
        }

        // 채팅 / DM 메시지: PHP 백엔드 chat_send 액션으로 전송
        if (msg.t === CFG.MSG_TYPES.CHAT || msg.t === CFG.MSG_TYPES.DM) {
            const p = msg.p || {};
            try {
                const r = await this._post('chat_send', {
                    code: this.plugin.collabCode,
                    client_id: this.plugin.client_id,
                    nickname: p.nickname || this.plugin.nickname || '익명',
                    text: p.text || '',
                    to: p.to || null,
                    reply_to: p.replyTo || null,
                    color_hue: typeof p.color_hue === 'number' ? p.color_hue : 200,
                    msg_id: p.id || null, // [v2.4.0] 클라이언트 msg_id 보존
                    host_token: this.plugin.hostToken
                });
                return !!(r && r.success);
            } catch (e) {
                console.warn('[Collab][PHP] chat_send failed:', e);
                return false;
            }
        }

        // [v2.4.0] 리액션 메시지: PHP 백엔드 chat_send로 react 타입 전송
        if (msg.t === CFG.MSG_TYPES.REACT) {
            const p = msg.p || {};
            try {
                const r = await this._post('chat_send', {
                    code: this.plugin.collabCode,
                    client_id: this.plugin.client_id,
                    nickname: p.nickname || this.plugin.nickname || '익명',
                    text: '',  // 리액션은 텍스트 없음
                    type: 'react',
                    react_msg_id: p.msgId || '',
                    react_emoji: p.emoji || '',
                    react_remove: !!p.remove,
                    host_token: this.plugin.hostToken
                });
                return !!(r && r.success);
            } catch (e) {
                console.warn('[Collab][PHP] react_send failed:', e);
                return false;
            }
        }

        // STATUS 메시지: chat_send로 상태 변경 알림 전송
        if (msg.t === CFG.MSG_TYPES.STATUS) {
            // 상태는 users 파일에 반영되므로 별도 전송 불필요
            // PHP 폴링에서 users 목록 갱신 시 자동 반영됨
            return true;
        }

        // 기타 메시지 타입은 PHP 모드에서 미지원 (조용히 무시)
        return false;
    }

    async kick(target_client_id) {
        const p = this.plugin;
        if (!p.isHost) return false;
        const r = await this._post('kick', {
            code: p.collabCode, client_id: p.client_id,
            target_client_id, host_token: p.hostToken
        });
        return r && r.success;
    }

    async leave() {
        const p = this.plugin;
        await this._post('leave', { code: p.collabCode, client_id: p.client_id });
    }

    async stopRoom() {
        const p = this.plugin;
        if (!p.isHost || !p.hostToken) return false;
        const r = await this._post('stop', { code: p.collabCode, host_token: p.hostToken });
        return r && r.success;
    }

    close() {
        this.closed = true;
        clearInterval(this.pollTimer);
        this.pollTimer = null;
    }
}

// ============================================================
// 4b. HybridSyncChannel (안정성 향상 모드 — P2P + 백업 서버 하이브리드)
// ============================================================
// P2P 가 주(主) 전송 채널일 때, 이 채널은 "백업/복구" 용도로만 동작합니다.
//   - 호스트: 주기적으로 현재 문서 스냅샷을 PHP 서버(=collab_number.php,
//     향후 외부 무료 공개 서버로 교체/추가 가능)에 백업 저장.
//   - 게스트: 주기적으로 서버의 최신 버전을 조회해, P2P 채널이 조용히
//     끊기거나 메시지를 놓친 경우에도 문서를 최신 상태로 복구.
//   - 채팅 / 리액션 / 타이핑 / DM 등은 이 채널을 타지 않습니다
//     단, [v2.5.0] 리액션은 채팅 폴링에서도 동기화되므로 안정성 향상 모드에서도 공유 가능.
//   - PHP 방 코드(code)는 P2P 방 코드와 동일하게 맞춰, 호스트/게스트 모두
//     별도 코드 교환 없이 동일한 collabCode 로 백업 방을 공유합니다.
// ============================================================

class HybridSyncChannel {
    constructor(plugin) {
        this.plugin = plugin;
        this.code = null;
        this.knownVersion = 0;
        this.timer = null;
        this.closed = false;
        this.registered = false;
    }

    async _post(action, body) {
        const p = this.plugin;
        if (!p.t2url) return null;
        const url = p.t2url + '/plugin/collab/collab_number.php';
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({}, body, { action }))
            });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            return null;
        }
    }

    // 시작: 호스트는 PHP 백업 방을 생성(또는 기존 방 재사용), 게스트는 참가만 수행.
    // 실패해도 조용히 false 를 반환 — 안정성 향상 모드의 ICE/브로커 강화는
    // PHP 가용 여부와 무관하게 계속 동작합니다.
    async start() {
        const p = this.plugin;
        if (!p.t2url || this.closed) return false;
        this.code = p.collabCode;
        if (!this.code) return false;

        if (p.isHost) {
            if (!p.hostToken) {
                const r = await this._post('create', { code: this.code, stability_mode: true });
                if (!r || !r.success) return false;
                // 요청한 코드와 다른 코드가 발급되면(극히 드문 충돌) 게스트와
                // 코드가 어긋나므로 하이브리드 백업은 비활성화한다.
                if (r.code && r.code !== this.code) return false;
                p.hostToken = r.host_token;
            }
        } else {
            const jr = await this._post('join', { code: this.code, client_id: p.client_id, nickname: p.nickname });
            if (!jr || !jr.success) return false;
        }

        const gr = await this._post('get', {
            code: this.code, client_id: p.client_id,
            ...(p.isHost && p.hostToken ? { host_token: p.hostToken } : {})
        });
        if (gr && gr.success && gr.data && typeof gr.data.version === 'number') {
            this.knownVersion = gr.data.version;
        }

        this.registered = true;
        this._startTimer();
        // [v2.5.0] 안정성 향상 모드에서도 채팅/리액션 폴링 활성화
        this._lastChatTs = 0;
        this._startChatPoll();
        return true;
    }

    _startTimer() {
        clearInterval(this.timer);
        this.timer = setInterval(() => this._tick(), CFG.STABILITY_PHP_SYNC_MS);
    }

    async _tick() {
        if (this.closed || !this.registered) return;
        const p = this.plugin;
        if (!p.collabCode || p.collabCode !== this.code) return;

        if (p.isHost) {
            // 호스트: 현재 문서 스냅샷을 백업 저장
            let html;
            try { html = p.editor.editor.innerHTML; } catch (e) { return; }
            const r = await this._post('update', {
                code: this.code,
                client_id: p.client_id,
                version: this.knownVersion,
                operation: {
                    type: 'full',
                    content: html,
                    domState: extractDOMState(html),
                    timestamp: isoNow(),
                    client_id: p.client_id
                },
                host_token: p.hostToken
            });
            if (r && r.success && typeof r.new_version === 'number') {
                this.knownVersion = r.new_version;
            }
        } else {
            // 게스트: 복구용 폴링 — P2P 로 받은 내용보다 최신이면 적용
            const r = await this._post('get', {
                code: this.code, client_id: p.client_id, since_version: this.knownVersion
            });
            if (r && r.success && r.has_updates && r.data && r.data.version > this.knownVersion) {
                this.knownVersion = r.data.version;
                if (typeof r.data.content === 'string') {
                    p._handleIncoming({
                        t: CFG.MSG_TYPES.FULL,
                        p: { content: r.data.content || '', domState: r.data.domState || {} },
                        v: this.knownVersion
                    });
                }
            }
        }
    }

    close() {
        this.closed = true;
        this.registered = false;
        clearInterval(this.timer);
        this.timer = null;
        // [v2.5.0] 채팅 폴링 타이머 정리
        if (this._chatPollTimer) { clearInterval(this._chatPollTimer); this._chatPollTimer = null; }
    }

    // [v2.5.0] 안정성 향상 모드에서 채팅/리액션 PHP 폴링
    // P2P가 일시적으로 불안정할 때도 채팅과 리액션이 PHP를 통해 동기화됨
    _startChatPoll() {
        if (this._chatPollTimer) clearInterval(this._chatPollTimer);
        this._chatPollTimer = setInterval(() => this._pollChat(), CFG.PHP_POLL_MS);
    }

    async _pollChat() {
        if (this.closed || !this.registered) return;
        const p = this.plugin;
        if (!p.collabCode) return;
        try {
            const r = await this._post('chat_get', {
                code: p.collabCode,
                client_id: p.client_id,
                since_ts: this._lastChatTs || 0,
                ...(p.isHost && p.hostToken ? { host_token: p.hostToken } : {})
            });
            if (r && r.success && Array.isArray(r.messages) && r.messages.length > 0) {
                const maxTs = Math.max(...r.messages.map(m => m.ts || 0));
                if (maxTs > (this._lastChatTs || 0)) this._lastChatTs = maxTs;
                const newMsgs = r.messages.filter(m => (m.client_id || m.from) !== p.client_id);
                for (const m of newMsgs) {
                    if (m.type === 'react' && m.react_msg_id && m.react_emoji) {
                        p._handleIncoming({
                            t: CFG.MSG_TYPES.REACT,
                            p: {
                                msgId: m.react_msg_id,
                                emoji: m.react_emoji,
                                client_id: m.client_id || m.from,
                                nickname: m.nickname || '익명',
                                remove: !!m.react_remove
                            },
                            from: m.client_id || m.from,
                            ts: m.ts
                        });
                    } else if (m.type !== 'react') {
                        p._handleIncoming({
                            t: CFG.MSG_TYPES.CHAT,
                            p: m,
                            from: m.client_id || m.from,
                            ts: m.ts
                        });
                    }
                }
            }
        } catch (e) {}
    }
}

// ============================================================
// 5. RemoteCursorRenderer
// ============================================================
// 다른 유저의 caret + selection 을 에디터 컨테이너 위에 absolutely positioned
// 레이어로 표시. style/transform 기반 → 에디터 콘텐츠를 건드리지 않음.
// 콘텐츠가 변경되거나 스크롤될 때마다 RAF 로 다시 그림.
// ============================================================

class RemoteCursorRenderer {
    constructor(plugin) {
        this.plugin = plugin;
        this.layer = null;          // .t2-collab-cursor-layer
        this.byCid = new Map();     // cid -> { sel, color, nickname, lastSeen, nodes }
        this._rafScheduled = false;
        this._resizeObserver = null;
        this._mutationObserver = null;
        this._scrollHandler = null;
        this._labelTimers = new Map();
    }

    mount() {
        if (this.layer) return;
        const editorEl = this.plugin.editor.editor;
        const host = editorEl.parentElement || this.plugin.editor.container;
        // 부모 position 확보
        const cs = getComputedStyle(host);
        if (cs.position === 'static') host.style.position = 'relative';

        this.layer = document.createElement('div');
        this.layer.className = 't2-collab-cursor-layer';
        this.layer.setAttribute('aria-hidden', 'true');
        host.appendChild(this.layer);

        // 변화 감지
        this._scrollHandler = () => this._scheduleRender();
        editorEl.addEventListener('scroll', this._scrollHandler, { passive: true });
        window.addEventListener('scroll', this._scrollHandler, { passive: true });
        window.addEventListener('resize', this._scrollHandler);

        if ('ResizeObserver' in window) {
            this._resizeObserver = new ResizeObserver(() => this._scheduleRender());
            this._resizeObserver.observe(editorEl);
        }
        this._mutationObserver = new MutationObserver(() => this._scheduleRender());
        this._mutationObserver.observe(editorEl, {
            subtree: true, childList: true, characterData: true, attributes: true
        });

        // stale cleanup
        this._staleTimer = setInterval(() => this._cleanupStale(), 4000);
    }

    unmount() {
        if (!this.layer) return;
        try {
            const editorEl = this.plugin.editor.editor;
            editorEl.removeEventListener('scroll', this._scrollHandler);
        } catch (e) {}
        window.removeEventListener('scroll', this._scrollHandler);
        window.removeEventListener('resize', this._scrollHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this._mutationObserver) this._mutationObserver.disconnect();
        clearInterval(this._staleTimer);
        for (const tid of this._labelTimers.values()) clearTimeout(tid);
        this._labelTimers.clear();
        try { this.layer.remove(); } catch (e) {}
        this.layer = null;
        this.byCid.clear();
    }

    updateCursor({ client_id, nickname, color, sel }) {
        if (!this.layer) return;
        if (client_id === this.plugin.client_id) return; // 자기 자신 미표시

        // [FIX] 이전엔 byCid.set 으로 객체를 통째로 교체하여
        //       _caretEl / _labelEl / _rectEls DOM 참조가 사라졌고,
        //       _render() 가 매 호출마다 새 caret/label/selection 노드를
        //       layer 에 append → 자취가 남고 중복으로 보였음.
        //       이제는 기존 항목이 있으면 in-place 로 필드만 업데이트하여
        //       DOM 노드 참조(_caretEl 등)를 보존한다.
        let entry = this.byCid.get(client_id);
        if (!entry) {
            entry = {
                sel, color, nickname,
                lastSeen: Date.now(),
                wasUpdated: true,
                _caretEl: null,
                _labelEl: null,
                _rectEls: null
            };
            this.byCid.set(client_id, entry);
        } else {
            entry.sel = sel;
            entry.color = color;
            entry.nickname = nickname;
            entry.lastSeen = Date.now();
            entry.wasUpdated = true;
        }

        this._scheduleRender();
        // 라벨 잠시 표시 (3초)
        clearTimeout(this._labelTimers.get(client_id));
        const tid = setTimeout(() => {
            const cur = this.byCid.get(client_id);
            if (cur && cur._labelEl) cur._labelEl.classList.remove('is-active');
        }, 2500);
        this._labelTimers.set(client_id, tid);
    }

    removeCursor(client_id) {
        const cur = this.byCid.get(client_id);
        if (!cur) return;
        if (cur._caretEl) cur._caretEl.remove();
        if (cur._labelEl) cur._labelEl.remove();
        if (cur._rectEls) cur._rectEls.forEach(el => el.remove());
        this.byCid.delete(client_id);
        clearTimeout(this._labelTimers.get(client_id));
        this._labelTimers.delete(client_id);
    }

    _scheduleRender() {
        if (this._rafScheduled) return;
        this._rafScheduled = true;
        requestAnimationFrame(() => {
            this._rafScheduled = false;
            this._render();
        });
    }

    _cleanupStale() {
        const now = Date.now();
        for (const [cid, c] of Array.from(this.byCid.entries())) {
            if (now - c.lastSeen > CFG.AWARENESS_STALE_MS) {
                this.removeCursor(cid);
            }
        }
    }

    _render() {
        if (!this.layer) return;
        const editorEl = this.plugin.editor.editor;
        const host = this.layer.parentElement;
        if (!host) return;
        const hostRect = host.getBoundingClientRect();

        for (const [cid, c] of this.byCid) {
            const out = selectionToRects(editorEl, c.sel);

            // caret 노드 생성/재사용
            // [FIX] 노드 생성 시 data-cid 를 부여하여, 만약 외부 요인(다른 인스턴스/리렌더 등)으로
            //       이 cid 와 매핑된 stray 노드가 layer 에 남아 있으면 마지막에 안전하게 청소한다.
            if (!c._caretEl || !c._caretEl.isConnected) {
                c._caretEl = document.createElement('div');
                c._caretEl.className = 't2-collab-remote-caret';
                c._caretEl.dataset.cid = cid;
                this.layer.appendChild(c._caretEl);
            }
            if (!c._labelEl || !c._labelEl.isConnected) {
                c._labelEl = document.createElement('div');
                c._labelEl.className = 't2-collab-remote-label';
                c._labelEl.dataset.cid = cid;
                this.layer.appendChild(c._labelEl);
            }
            c._caretEl.style.background = c.color.primary;
            c._labelEl.style.background = c.color.primary;
            c._labelEl.textContent = c.nickname;

            // 활성 라벨 표시
            if (c.wasUpdated) {
                c._labelEl.classList.add('is-active');
                c.wasUpdated = false;
            }

            if (!out || !out.caretRect) {
                c._caretEl.style.display = 'none';
                c._labelEl.style.display = 'none';
                if (c._rectEls) c._rectEls.forEach(el => el.style.display = 'none');
                continue;
            }
            c._caretEl.style.display = '';
            c._labelEl.style.display = '';

            // caret: 가로 2px, 세로 = caretRect.height
            const top = (out.caretRect.top - hostRect.top);
            const left = (out.caretRect.left - hostRect.left);
            const h = Math.max(out.caretRect.height || 18, 14);
            c._caretEl.style.transform = `translate(${left}px, ${top}px)`;
            c._caretEl.style.height = h + 'px';

            // label 위치: caret 바로 아래 (오른쪽으로 2px 오프셋)
            c._labelEl.style.transform = `translate(${left + 2}px, ${top + h}px)`;

            // selection rects
            if (!c._rectEls) c._rectEls = [];
            // 부족하면 추가, 남으면 비활성
            const need = out.rects.length;
            while (c._rectEls.length < need) {
                const r = document.createElement('div');
                r.className = 't2-collab-remote-selection';
                r.dataset.cid = cid;
                this.layer.appendChild(r);
                c._rectEls.push(r);
            }
            for (let i = 0; i < c._rectEls.length; i++) {
                const el = c._rectEls[i];
                if (i < need) {
                    const rect = out.rects[i];
                    el.style.display = '';
                    el.style.background = c.color.soft;
                    el.style.transform = `translate(${rect.left - hostRect.left}px, ${rect.top - hostRect.top}px)`;
                    el.style.width = rect.width + 'px';
                    el.style.height = rect.height + 'px';
                } else {
                    el.style.display = 'none';
                }
            }
        }

        // [FIX] stray 노드 청소: layer 내 모든 노드 중
        //       (a) data-cid 가 없거나, (b) byCid 에 없는 cid 거나,
        //       (c) 현재 entry 의 _caretEl/_labelEl/_rectEls 가 아닌 것은 제거.
        //       → "커서 자취가 남으면서 중복으로 표시" 현상을 근본 차단.
        const ownedNodes = new Set();
        for (const c of this.byCid.values()) {
            if (c._caretEl) ownedNodes.add(c._caretEl);
            if (c._labelEl) ownedNodes.add(c._labelEl);
            if (c._rectEls) c._rectEls.forEach(el => ownedNodes.add(el));
        }
        const children = Array.from(this.layer.children);
        for (const node of children) {
            if (!ownedNodes.has(node)) {
                try { node.remove(); } catch (e) {}
            }
        }
    }
}

// ============================================================
// 6. T2CollabPlugin (메인)
// ============================================================

class T2CollabPlugin {
    constructor(editor) {
        this.editor = editor;
        this.container = editor.container || document;
        this.toolbarBtn = this.container.querySelector('[data-command="collab"]');
        this.client_id = getClientId();

        this.collabCode = null;
        this.nickname = null;
        this.hostToken = null;
        this.isHost = false;
        this.userColor = pickUserColor(this.client_id);

        this.t2url = (typeof t2editor_url !== 'undefined') ? t2editor_url : '';
        if (this.t2url && !/^https?:\/\//i.test(this.t2url) && !this.t2url.startsWith('/')) {
            this.t2url = '';
        }

        this.mode = null;
        this.transport = null;
        this.users = [];
        this.latency = 0;

        // === 안정성 향상 모드 (P2P + 외부 백업 서버 하이브리드) ===
        // 방 생성 시 호스트만 1회 설정 가능 (게스트는 P2P 연결을 통해 자동 상속).
        this.stabilityMode = false;
        this._hybridSync = null;

        this.baseContent = '';
        this.baseDOMState = {};
        this.lastSentHash = 0;

        this._inputHandler = null;
        this._mutationObserver = null;
        this._debounceTimer = null;
        this._unloadHandler = null;
        this._applying = false;
        this._lastApplyTs = 0;

        // awareness (cursor sharing)
        this._awarenessRenderer = new RemoteCursorRenderer(this);
        this._awarenessThrottleTs = 0;
        this._awarenessPendingTimer = null;
        this._selectionChangeHandler = null;
        this._scrollSyncHandler = null;
        this._lastSentAwareness = null;

        // UI references (modal 보존용)
        this._modalOverlay = null;
        this._helpOverlay = null;

        this.forcePhpMode = false;
        this.commands = ['collab'];

        // === 채팅 / 파일 공유 / 타이핑 / 잠금 ===
        this._chatMessages = [];
        this._chatUnread = 0;
        this._fileTransfers = new Map();
        this._outgoingTransfers = new Map();
        this._typingTimer = null;
        this._remoteTyping = new Map();
        this._isLocked = false;
        this._userLocks = new Set();    // 방장이 개별 잠금한 client_id 집합
        this._lockedByHost = false;     // 본인(게스트)이 방장에 의해 잠겼는지
        this._qrCache = null;           // QR 캐시: { link, url, downloadable }

        // === 1:1 DM ===
        this._dmTarget = null;
        this._dmUnread = new Map();

        // === 답장 ===
        this._replyTarget = null;

        // === 검색 ===
        this._chatSearchQuery = '';

        // === 자리비움 / 상태 ===
        this._myStatus       = 'online';   // 'online'|'away'|'busy'|'dnd'
        this._autoAway       = false;       // 자동 자리비움 여부
        this._remoteStatuses = new Map();   // clientId → status
        this._activityTimer  = null;
        this._lastActivityTs = Date.now();
        this._activityHandler = null;
        this._visibilityHandler = null;

        // === 이모지 리액션 ===
        this._reactions = new Map();        // msgId → { emoji → { clientId: nick } }

        // [v3.1.0] 무결성 체인 · 분산 저장소 · 오프라인 큐
        this._blockChain = null;            // BlockChain 인스턴스
        this._distributedStore = null;      // DistributedStore 인스턴스
        this._blockSyncTimer = null;        // 블록 체인 동기화 브로드캐스트 타이머
        this._syncingChain = false;         // 체인 동기화 중 여부
        this._syncProgress = 0;             // 체인 동기화 진행률 (0~100)
        this._offlineQueue = [];            // 오프라인 중 큐잉된 연산
        this._isOffline = false;            // 오프라인 상태 여부
        this._chainHeight = 0;              // 현재 체인 높이

        // === 읽음 확인 ===
        this._readBy = new Map();           // msgId → Set<clientId>

        // === 스크롤 미읽음 ===
        this._scrollUnread = 0;

        // === 연결 안정성 ===
        this._reconnectAttempts = 0;
        this._reconnectTimer    = null;
        this._lastConnParams    = null;
        this._pendingMsgs       = [];

        // === 호스트 failover ===
        this._hbInterval    = null;      // 호스트: heartbeat + backup 전송 타이머
        this._hbWatchdog    = null;      // 게스트: HB 수신 감시 타이머
        this._lastHostHb    = Date.now();
        this._backupRank    = null;      // 1|2|3 — 내가 백업 대상이면 설정
        this._backupPeer    = null;      // 두 번째 Peer 인스턴스 (백업 수신용)
        this._backupContent = null;      // { content, domState, ts } 최신 스냅샷
        this._backupPeerIds = [];        // [{rank, clientId, peerId}] 알려진 백업 피어
        this._electionTimer = null;
        this._inElection    = false;
        this._pingMap       = new Map(); // clientId → latencyMs
        this._docRestored   = false;     // 캐시 복원 여부 (UI 표시용)

        // 자동 URL 파라미터 감지 → 잠시 후 자동 모달 오픈
        this._autoJoinFromUrlIfNeeded();

        console.log('[Collab v3.1.0] initialized ...');
    }

    // === 명령 진입점 ===
    async handleCommand(command) {
        if (command === 'collab') this.openModal();
    }

    // ========== URL 자동 참가 감지 ==========
    // [FIX] 기존: window.location.search 만 읽어 ?t2collab=XXXX 만 지원.
    //       다양한 CMS / SPA / 해시 라우팅 (Vue / React Router / WordPress 등)에서는
        //   #/page?t2collab=XXXX , #!/post?t2collab=XXXX , /post#t2collab=XXXX ,
        //   ; 구분자, 해시 안 query 등 다양한 URL 상태를 커버하지 못했음.
    //       이제는 search + hash + 단순 해시 키 모두를 파싱하고,
    //       여러 탭/여러 에디터 인스턴스에서 중복 호출되어도 전역에서 1회만 모달을 열도록 가드한다.
    _autoJoinFromUrlIfNeeded() {
        try {
            // 전역 중복 가드: 같은 페이지에 다수의 에디터/인스턴스가 있어도 참가 팝업은 1회만.
            if (window.__t2collab_autojoin_handled) return;

            const safeCode = T2CollabPlugin.extractRoomCodeFromUrl(
                window.location, CFG.URL_PARAM_KEY
            );
            if (!safeCode) return;

            window.__t2collab_autojoin_handled = true;

            // DOM 준비 후 모달
            setTimeout(() => this.openModal({ prefilledJoinCode: safeCode }), 600);
        } catch (e) {}
    }

    // [FIX] 다양한 URL 상태를 고려한 room code 추출 유틸리티.
    //  지원하는 종류:
    //   1) https://site/path?t2collab=ABCD                (표준 query)
    //   2) https://site/path?foo=1;t2collab=ABCD          (세미콜론 구분자)
    //   3) https://site/path#/route?t2collab=ABCD         (Vue / React hash router)
    //   4) https://site/path#!/route?t2collab=ABCD        (Angular legacy hashbang)
    //   5) https://site/path#t2collab=ABCD                (해시-온리 키 값 쌍)
    //   6) https://site/path#foo=1&t2collab=ABCD          (해시 fragment fragment-style)
    //   7) https://site/path/ABCD/                        (일부 path-based CMS, 마지막 segment 가 유효 코드 형식)
    static extractRoomCodeFromUrl(loc, paramKey) {
        if (!loc) return null;
        const sanitize = (raw) => {
            if (raw == null) return null;
            try { raw = decodeURIComponent(String(raw)); } catch (e) { raw = String(raw); }
            const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
            return (cleaned.length >= 4) ? cleaned : null;
        };
        const tryParse = (qs) => {
            if (!qs) return null;
            // ; 를 & 로 간주해 세미콜론 구분자도 처리
            const normalized = qs.replace(/;/g, '&');
            try {
                const sp = new URLSearchParams(normalized);
                if (sp.has(paramKey)) return sp.get(paramKey);
            } catch (e) {}
            // Fallback: 수동 파싱
            const m = normalized.match(new RegExp('(?:^|&)' + paramKey + '=([^&#]+)'));
            return m ? m[1] : null;
        };

        // 1) location.search
        let raw = null;
        if (loc.search && loc.search.length > 1) {
            raw = tryParse(loc.search.replace(/^\?/, ''));
        }

        // 2) location.hash 내부의 ?query  또는  fragment-as-query
        if (!raw && loc.hash && loc.hash.length > 1) {
            const hash = loc.hash.replace(/^#!?\/?/, '#').substring(1); // 해시 제거 + #! 제거
            const qIdx = hash.indexOf('?');
            if (qIdx >= 0) {
                // 3,4) hash 라우팅 안의 query string
                raw = tryParse(hash.substring(qIdx + 1));
            }
            if (!raw) {
                // 5,6) 해시 자체를 query string 으로 해석
                raw = tryParse(hash);
            }
        }

        // 7) path 명시적 marker:  /<paramKey>/<code>/  이런 패턴도 한번 시도
        if (!raw && loc.pathname) {
            const m = loc.pathname.match(new RegExp('/' + paramKey + '/([a-zA-Z0-9]{4,12})/?', 'i'));
            if (m) raw = m[1];
        }

        return sanitize(raw);
    }

    // ========== 메인 모달 ==========
    openModal(opts = {}) {
        // [FIX] 이전엔 이미 modal 이 있으면 remove 후 재생성했는데,
        //       URL 자동참가 + 수동 열기가 겹치거나 이벤트 이중 등록도에서
        //       openModal 이 두 번 호출되면 "팝업이 두 번 번줦“ 함.
        //       이제는 이미 열려 있으면 재생성하지 않고 좀
        //       더(prefilledJoinCode 등)만 적용 후 리턴한다.
        if (this._modalOverlay && this._modalOverlay.isConnected) {
            try {
                if (opts.prefilledJoinCode) {
                    const ovEl = this._modalOverlay;
                    const tabs = ovEl.querySelectorAll('.t2-collab-tab');
                    const panes = ovEl.querySelectorAll('.t2-collab-pane');
                    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'join'));
                    panes.forEach(p => p.classList.toggle('is-active', p.dataset.pane === 'join'));
                    const codeInput = ovEl.querySelector('.t2-collab-join-code');
                    if (codeInput) codeInput.value = opts.prefilledJoinCode;
                }
            } catch (e) {}
            return;
        }
        // 문제 있는 잔존 overlay 해제 (DOM 엔 남아있는데 참조만 풌린 경우도 대비)
        if (this._modalOverlay) {
            try { this._modalOverlay.remove(); } catch (e) {}
            this._modalOverlay = null;
        }
        const overlay = document.createElement('div');
        overlay.className = 't2-modal-overlay t2-collab-modal-overlay';
        overlay.innerHTML = this._renderModalHTML();
        document.body.appendChild(overlay);
        this._modalOverlay = overlay;

        // 모바일에서 body 스크롤 잠금
        document.body.classList.add('t2-collab-modal-open');

        const $ = (s) => overlay.querySelector(s);
        const $$ = (s) => overlay.querySelectorAll(s);

        const tabs = $$('.t2-collab-tab');
        const panes = $$('.t2-collab-pane');
        const switchTab = (name) => {
            tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
            panes.forEach(p => p.classList.toggle('is-active', p.dataset.pane === name));
            // 슬라이딩 인디케이터
            const active = overlay.querySelector('.t2-collab-tab.is-active');
            const indicator = overlay.querySelector('.t2-collab-tab-indicator');
            if (active && indicator) {
                indicator.style.transform = `translateX(${active.offsetLeft}px)`;
                indicator.style.width = active.offsetWidth + 'px';
            }
        };
        tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

        // 자동 닉네임 제안
        const suggestedNick = this._suggestNickname();
        $('.t2-collab-host-nick').value = suggestedNick;
        $('.t2-collab-join-nick').value = suggestedNick;

        // 미리 채울 코드 (URL 자동 참가 시)
        if (opts.prefilledJoinCode) {
            $('.t2-collab-join-code').value = opts.prefilledJoinCode;
            switchTab('join');
            setTimeout(() => this._refreshJoinBtn(overlay), 0);
        } else {
            switchTab('create');
        }

        const showInfo = () => {
            $('.t2-collab-pane-pre').style.display = 'none';
            $('.t2-collab-pane-info').style.display = 'flex';
            $('.t2-collab-disp-code').textContent = this.collabCode;
            $('.t2-collab-disp-nick').textContent = this.nickname;

            // [v2.1.4] 모바일 컴팩트 바: 방 코드 + 모드 배지 표시
            const compactCode = overlay.querySelector('.t2c-status-compact-code');
            if (compactCode) compactCode.textContent = this.collabCode;

            // [v2.1.4] 모바일: 상태카드 기본 접힘 (모바일에서만)
            const statusCard = overlay.querySelector('.t2-collab-status-card');
            const isMobile = window.innerWidth <= 640;
            if (statusCard && isMobile) {
                statusCard.classList.add('t2c-status-collapsed');
                // 컴팩트 바 클릭 → 펼치기/접기 토글
                const compactBar = statusCard.querySelector('.t2c-status-compact-bar');
                if (compactBar) {
                    compactBar.addEventListener('click', () => {
                        const isCollapsed = statusCard.classList.contains('t2c-status-collapsed');
                        statusCard.classList.toggle('t2c-status-collapsed', !isCollapsed);
                        const hint = compactBar.querySelector('.t2c-status-expand-hint');
                        if (hint) {
                            hint.innerHTML = isCollapsed
                                ? '<span class="material-icons" aria-hidden="true">expand_less</span>접기'
                                : '<span class="material-icons" aria-hidden="true">expand_more</span>펼치기';
                        }
                    });
                }
            }

            // 내 상태 표시 초기화
            const selfColor = overlay.querySelector('.t2-collab-self-color');
            if (selfColor) selfColor.style.background = this.userColor.primary;
            this._refreshStatusUI(overlay);

            // 상태 버튼 + 드롭다운
            const statusBtn    = overlay.querySelector('.t2c-status-btn');
            const statusPicker = overlay.querySelector('.t2c-status-picker');
            if (statusBtn && statusPicker) {
                // [v2.5.0] position:fixed 피커 위치 계산 함수
                const positionPicker = () => {
                    const btnRect = statusBtn.getBoundingClientRect();
                    const pickerHeight = 200; // 대략 4개 항목 높이
                    // 버튼 아래에 피커 배치, 화면 아래 넘어가면 위로
                    let top = btnRect.bottom + 6;
                    if (top + pickerHeight > window.innerHeight) {
                        top = btnRect.top - pickerHeight - 6;
                    }
                    statusPicker.style.top = Math.max(8, top) + 'px';
                    // 좌우: 버튼 기준 왼쪽 정렬, 화면 넘어가면 오른쪽으로
                    let left = btnRect.left;
                    if (left + 200 > window.innerWidth) {
                        left = window.innerWidth - 210;
                    }
                    statusPicker.style.left = Math.max(8, left) + 'px';
                };
                statusBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const open = statusPicker.style.display === 'none';
                    statusPicker.style.display = open ? 'flex' : 'none';
                    if (open) positionPicker(); // [v2.5.0] 열 때 위치 동적 계산
                    const chevron = statusBtn.querySelector('.t2c-status-chevron');
                    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
                });
                statusPicker.addEventListener('click', e => {
                    const opt = e.target.closest('.t2c-status-opt');
                    if (!opt) return;
                    this._setMyStatus(opt.dataset.status, overlay);
                    statusPicker.style.display = 'none';
                    const chevron = statusBtn.querySelector('.t2c-status-chevron');
                    if (chevron) chevron.style.transform = '';
                });
                document.addEventListener('click', function closePicker(ev) {
                    if (!statusPicker.contains(ev.target) && ev.target !== statusBtn) {
                        statusPicker.style.display = 'none';
                        const chevron = statusBtn.querySelector('.t2c-status-chevron');
                        if (chevron) chevron.style.transform = '';
                    }
                }, { passive: true });
            }

            // 공유 링크
            const link = this._buildShareUrl();
            $('.t2-collab-share-link').value = link;

            if (this.isHost) {
                $('.t2-collab-stop-btn').style.display = 'inline-flex';
                $('.t2-collab-lock-btn').style.display = 'inline-flex';
            }
            this._refreshUsersList(overlay);
            this._refreshModeBadge(overlay);
            this._applyStabilityModeUI(overlay);
            this._tryGenerateQRForLink(overlay, link);

            // [v2.2.0] 인라인 QR 토글 제거 — 모든 화면에서 QR 팝업으로 통일
            // QR 토글 버튼은 더 이상 사용하지 않음 (인라인 QR 행이 전역 숨김됨)

            // [v2.3.0] QR 팝업 오버레이 — 데스크톱/모바일 공통 + 미니 상태 바 동기화
            const compactQrBtn = overlay.querySelector('.t2c-compact-qr-btn');
            const expandedQrBtn = overlay.querySelector('.t2c-expanded-qr-btn');
            const chatQrBtn = overlay.querySelector('.t2c-chat-qr-btn');
            const qrPopupOverlay = overlay.querySelector('.t2c-qr-popup-overlay');

            // [v2.3.0] QR 팝업 내 미니 상태 바 업데이트
            const updateQrStatusBar = () => {
                if (!qrPopupOverlay) return;
                const dot = qrPopupOverlay.querySelector('.t2c-qr-status-dot');
                const label = qrPopupOverlay.querySelector('.t2c-qr-status-label');
                const modeEl = qrPopupOverlay.querySelector('.t2c-qr-status-mode');
                const countWrap = qrPopupOverlay.querySelector('.t2c-qr-status-count-wrap');
                const countEl = qrPopupOverlay.querySelector('.t2c-qr-status-count');
                if (dot) {
                    dot.className = `t2c-qr-status-dot t2c-s-${this._myStatus}`;
                    dot.title = CFG.STATUS_LABELS[this._myStatus] || '온라인';
                }
                if (label) label.textContent = CFG.STATUS_LABELS[this._myStatus] || '온라인';
                if (modeEl) {
                    if (this.mode === 'p2p' && this.stabilityMode) modeEl.textContent = '안정성 향상';
                    else if (this.mode === 'p2p') modeEl.textContent = 'P2P';
                    else if (this.mode === 'php') modeEl.textContent = '서버 경유';
                    else modeEl.textContent = '연결 중';
                }
                if (countWrap && countEl) {
                    const cnt = (this.users || []).length;
                    countEl.textContent = cnt;
                    countWrap.style.display = cnt > 0 ? '' : 'none';
                }
            };

            const openQrPopup = (e) => {
                e.stopPropagation();
                if (!qrPopupOverlay) return;
                // QR 캐시가 있으면 팝업에 즉시 렌더
                const popupBox = qrPopupOverlay.querySelector('.t2c-qr-popup-qr-box');
                if (popupBox && this._qrCache && this._qrCache.url) {
                    this._renderQRBox(popupBox, this._qrCache.url);
                } else if (popupBox) {
                    // 캐시 없으면 생성 시도
                    const link = this._buildShareUrl();
                    popupBox.innerHTML = '<div class="t2-collab-qr-loading"><span class="material-icons t2-collab-spin">autorenew</span><small>QR 생성 중…</small></div>';
                    this._tryGenerateQRForLink(overlay, link);
                    // QR 생성 후 팝업에 다시 렌더
                    setTimeout(() => {
                        if (this._qrCache && this._qrCache.url) {
                            this._renderQRBox(popupBox, this._qrCache.url);
                        }
                    }, 1500);
                }
                // [v2.3.0] 미니 상태 바 업데이트 후 표시
                updateQrStatusBar();
                qrPopupOverlay.style.display = 'flex';
            };
            if (compactQrBtn) compactQrBtn.addEventListener('click', openQrPopup);
            if (expandedQrBtn) expandedQrBtn.addEventListener('click', openQrPopup);
            // [v2.3.0] 채팅 탭에서도 QR 팝업 접근 가능
            if (chatQrBtn) chatQrBtn.addEventListener('click', openQrPopup);
            if (qrPopupOverlay) {
                // 팝업 닫기
                const qrPopupClose = qrPopupOverlay.querySelector('.t2c-qr-popup-close');
                if (qrPopupClose) {
                    qrPopupClose.addEventListener('click', () => {
                        qrPopupOverlay.style.display = 'none';
                    });
                }
                // 오버레이 배경 클릭으로 닫기
                qrPopupOverlay.addEventListener('click', (e) => {
                    if (e.target === qrPopupOverlay) {
                        qrPopupOverlay.style.display = 'none';
                    }
                });
            }

            // [v3.1.0] 보안/연결 정보 팝업
            const securityLinkBtn = overlay.querySelector('.t2c-security-link-btn');
            const securityPopupOverlay = overlay.querySelector('.t2c-security-popup-overlay');
            if (securityLinkBtn && securityPopupOverlay) {
                securityLinkBtn.addEventListener('click', () => {
                    this._populateSecurityData(overlay);
                    securityPopupOverlay.style.display = 'flex';
                });
                const securityPopupClose = securityPopupOverlay.querySelector('.t2c-security-popup-close');
                if (securityPopupClose) {
                    securityPopupClose.addEventListener('click', () => {
                        securityPopupOverlay.style.display = 'none';
                    });
                }
                securityPopupOverlay.addEventListener('click', (e) => {
                    if (e.target === securityPopupOverlay) {
                        securityPopupOverlay.style.display = 'none';
                    }
                });
            }

            // [v2.1.5] 모바일 컴팩트 바: 상태 점 클릭 → 상태 피커 직접 열기
            const compactStatusDot = overlay.querySelector('.t2c-compact-status-dot');
            // statusPicker는 위(1738행)에서 이미 선언됨 — 재사용
            if (compactStatusDot) {
                compactStatusDot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const statusBtn = overlay.querySelector('.t2c-status-btn');
                    const isVisible = statusPicker.style.display === 'flex';
                    // 상태카드가 접혀있으면 먼저 펼치기
                    const statusCard = overlay.querySelector('.t2-collab-status-card');
                    if (statusCard && statusCard.classList.contains('t2c-status-collapsed')) {
                        statusCard.classList.remove('t2c-status-collapsed');
                        const hint = overlay.querySelector('.t2c-status-expand-hint');
                        if (hint) hint.innerHTML = '<span class="material-icons" aria-hidden="true">expand_less</span>접기';
                    }
                    statusPicker.style.display = isVisible ? 'none' : 'flex';
                    // [v2.5.0] 피커 위치 동적 계산 (position:fixed)
                    if (!isVisible && statusBtn) {
                        const btnRect = statusBtn.getBoundingClientRect();
                        let top = btnRect.bottom + 6;
                        if (top + 200 > window.innerHeight) top = btnRect.top - 206;
                        statusPicker.style.top = Math.max(8, top) + 'px';
                        let left = btnRect.left;
                        if (left + 200 > window.innerWidth) left = window.innerWidth - 210;
                        statusPicker.style.left = Math.max(8, left) + 'px';
                    }
                    if (statusBtn) {
                        const chevron = statusBtn.querySelector('.t2c-status-chevron');
                        if (chevron) chevron.style.transform = isVisible ? '' : 'rotate(180deg)';
                    }
                });
            }

            // 내부 탭 (상태/채팅) 스위처
            const infoTabs = overlay.querySelectorAll('.t2c-info-tab');
            const infoPanes = overlay.querySelectorAll('.t2c-info-pane');
            const switchInfoTab = (name) => {
                infoTabs.forEach(t => t.classList.toggle('is-active', t.dataset.infotab === name));
                infoPanes.forEach(p => p.classList.toggle('is-active', p.dataset.infopane === name));
                if (name === 'chat') {
                    this._chatUnread = 0;
                    this._updateChatBadge(overlay, 0);
                    this._renderChatView(overlay);
                    this._updateDMHeader(overlay);
                    setTimeout(() => {
                        this._scrollChatToBottom(overlay);
                        this._sendReadReceiptsForVisible(overlay);
                    }, 80);
                }
            };
            infoTabs.forEach(t => t.addEventListener('click', () => {
                // [v2.2.0] 안정성 향상 모드에서도 P2P 채팅 지원 → 제한 해제
                switchInfoTab(t.dataset.infotab);
            }));

            // 채팅 헤더: 전체 버튼
            const allBtn = overlay.querySelector('.t2c-ch-btn[data-ch="all"]');
            if (allBtn) allBtn.addEventListener('click', () => this._exitDM(overlay));

            // 채팅 헤더: DM pill 닫기
            const dmCloseBtn = overlay.querySelector('.t2c-dm-close-btn');
            if (dmCloseBtn) dmCloseBtn.addEventListener('click', () => this._exitDM(overlay));

            // 검색 토글
            const searchToggle = overlay.querySelector('.t2c-search-toggle-btn');
            const searchBar    = overlay.querySelector('.t2c-search-bar');
            const searchInput  = overlay.querySelector('.t2c-search-input');
            const searchClose  = overlay.querySelector('.t2c-search-close-btn');
            if (searchToggle) searchToggle.addEventListener('click', () => {
                const open = searchBar.style.display === 'none';
                searchBar.style.display = open ? 'flex' : 'none';
                if (open) { searchInput && searchInput.focus(); }
                else { this._filterChatView('', overlay); searchInput && (searchInput.value = ''); }
            });
            if (searchInput) {
                searchInput.addEventListener('input', () => this._filterChatView(searchInput.value, overlay));
                searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { searchClose && searchClose.click(); } });
            }
            if (searchClose) searchClose.addEventListener('click', () => {
                searchBar.style.display = 'none';
                if (searchInput) searchInput.value = '';
                this._filterChatView('', overlay);
            });

            // 답장 취소
            const replyCancel = overlay.querySelector('.t2c-reply-cancel-btn');
            if (replyCancel) replyCancel.addEventListener('click', () => this._clearReplyTarget(overlay));

            // 채팅 입력 / 전송
            const chatInput = overlay.querySelector('.t2c-chat-txt');
            const sendBtn   = overlay.querySelector('.t2c-send-btn');
            const fileInput = overlay.querySelector('.t2c-file-input');
            const attachBtn = overlay.querySelector('.t2c-attach-btn');

            const doSend = () => {
                const text = chatInput.value.trim();
                if (!text) return;
                if (text.length > CFG.MAX_CHAT_MSG_LEN) {
                    showToast('메시지가 너무 깁니다.', 'error');
                    return;
                }
                this._sendChatMessage(text, overlay);
                chatInput.value = '';
                chatInput.focus();
            };
            sendBtn.addEventListener('click', doSend);
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
                else this._sendTypingStart(); // 타이핑 중 알림
            });

            // 파일 첨부 (P2P 모드에서만)
            if (this.mode !== 'p2p') {
                if (attachBtn) attachBtn.classList.add('is-disabled');
                if (attachBtn) attachBtn.title = '파일 공유는 P2P 직접 연결 모드에서만 사용 가능합니다.';
            }
            if (fileInput) {
                fileInput.addEventListener('change', () => {
                    if (this.mode !== 'p2p') {
                        showToast('파일 공유는 P2P 직접 연결 모드에서만 지원됩니다.', 'error');
                        return;
                    }
                    Array.from(fileInput.files).forEach(f => this._sendFile(f, overlay));
                    fileInput.value = '';
                });
            }

            // 잠금 버튼 (호스트 전용)
            const lockBtn = overlay.querySelector('.t2-collab-lock-btn');
            if (lockBtn) {
                this._refreshLockBtn(overlay);
                lockBtn.addEventListener('click', () => {
                    if (!this.isHost) return;
                    this._isLocked = !this._isLocked;
                    this._sendLock(this._isLocked);
                    this._applyLock(this._isLocked);
                    this._refreshLockBtn(overlay);
                });
            }

            // 채팅 드래그앤드롭
            const chatMsgs = overlay.querySelector('.t2c-chat-msgs');
            if (chatMsgs) {
                chatMsgs.addEventListener('dragover', e => { e.preventDefault(); chatMsgs.classList.add('t2c-drag-over'); });
                chatMsgs.addEventListener('dragleave', () => chatMsgs.classList.remove('t2c-drag-over'));
                chatMsgs.addEventListener('drop', e => {
                    e.preventDefault(); chatMsgs.classList.remove('t2c-drag-over');
                    if (this.mode !== 'p2p') { showToast('파일 공유는 P2P 모드에서만 지원됩니다.', 'error'); return; }
                    Array.from(e.dataTransfer.files).forEach(f => this._sendFile(f, overlay));
                });
            }

            // 사용자 목록 DM 버튼 액션 위임 (status pane)
            const statusPane = overlay.querySelector('.t2c-info-pane[data-infopane="status"]');
            if (statusPane) {
                statusPane.addEventListener('click', e => {
                    const dmBtn = e.target.closest('[data-collab-action="dm"]');
                    if (dmBtn) {
                        const cid = dmBtn.dataset.clientid;
                        const nick = this._getNickByClientId(cid);
                        this._startDM(cid, nick, overlay);
                        // 채팅 탭으로 이동
                        overlay.querySelector('.t2c-info-tab[data-infotab="chat"]')?.click();
                    }
                });
            }

            // 기존 채팅 메시지 렌더 (캐시 포함)
            this._renderChatView(overlay);
            this._updateDMHeader(overlay);

            // 스크롤-투-바텀 버튼
            const scrollBtn = overlay.querySelector('.t2c-scroll-btn');
            const chatMsgsEl = overlay.querySelector('.t2c-chat-msgs');
            if (scrollBtn) {
                scrollBtn.addEventListener('click', () => {
                    this._scrollUnread = 0;
                    this._updateScrollBtn(overlay);
                    this._scrollChatToBottom(overlay);
                    this._sendReadReceiptsForVisible(overlay);
                });
            }
            if (chatMsgsEl) {
                chatMsgsEl.addEventListener('scroll', () => {
                    const atBottom = chatMsgsEl.scrollHeight - chatMsgsEl.scrollTop - chatMsgsEl.clientHeight < 80;
                    if (atBottom) {
                        this._scrollUnread = 0;
                        this._updateScrollBtn(overlay);
                        this._sendReadReceiptsForVisible(overlay);
                    }
                }, { passive: true });
            }

            // 모바일 키보드 회피
            this._installKeyboardAvoidance(overlay);
        };

        // 방 생성
        $('.t2-collab-create-btn').addEventListener('click', async () => {
            const nick = ($('.t2-collab-host-nick').value.trim() || suggestedNick).substring(0, 50);
            this.nickname = nick;
            this.isHost = true;
            this.collabCode = this._generateRoomCode();
            this.forcePhpMode = false;
            this.stabilityMode = $('.t2-collab-stability-mode').checked;
            this.userColor = pickUserColor(this.client_id + ':' + this.collabCode);

            this._setBusy(overlay, true, '연결 중…');
            const ok = await this._startCollab();
            this._setBusy(overlay, false);
            if (ok) showInfo();
            else showToast('협업 시작에 실패했습니다. 네트워크 연결을 확인하거나, 안정성 향상 모드를 켜고 다시 시도해 주세요.', 'error');
        });

        // 참여
        const joinCode = $('.t2-collab-join-code');
        const joinNick = $('.t2-collab-join-nick');
        const joinBtn = $('.t2-collab-join-btn');
        joinCode.addEventListener('input', () => this._refreshJoinBtn(overlay));
        joinNick.addEventListener('input', () => this._refreshJoinBtn(overlay));

        // QR 이미지로 참여
        const qrUploadInput = overlay.querySelector('.t2-collab-qr-upload-input');
        if (qrUploadInput) {
            qrUploadInput.addEventListener('change', async () => {
                const file = qrUploadInput.files && qrUploadInput.files[0];
                qrUploadInput.value = '';
                if (!file) return;
                if (!/^image\//i.test(file.type)) {
                    showToast('이미지 파일을 선택해주세요.', 'error');
                    return;
                }
                try {
                    this._setBusy(overlay, true, 'QR 분석 중…');
                    const decoded = await this._decodeQRFromImageFile(file);
                    if (!decoded) {
                        this._setBusy(overlay, false);
                        showToast('QR 코드를 읽을 수 없습니다. 더 선명한 이미지로 다시 시도해주세요.', 'error');
                        return;
                    }
                    // 디코딩된 문자열에서 룸 코드 추출 (URL 또는 순수 코드 모두 수용)
                    const code = this._extractCodeFromQRPayload(decoded);
                    if (!code) {
                        this._setBusy(overlay, false);
                        showToast('QR 내용에서 방 코드를 찾을 수 없습니다.', 'error');
                        return;
                    }
                    // 코드 자동 채움
                    joinCode.value = code;
                    this._refreshJoinBtn(overlay);
                    // 닉네임이 이미 있으면 바로 참여, 아니면 닉네임 포커스
                    if ((joinNick.value || '').trim()) {
                        this._setBusy(overlay, false);
                        // 자동 참여 트리거
                        joinBtn.click();
                    } else {
                        this._setBusy(overlay, false);
                        showToast(`QR 인식 완료: ${code} · 닉네임을 입력해주세요.`, 'success', 3000);
                        try { joinNick.focus(); } catch (e) {}
                    }
                } catch (e) {
                    this._setBusy(overlay, false);
                    console.warn('[Collab] QR decode failed:', e);
                    showToast('QR 인식 중 오류가 발생했습니다.', 'error');
                }
            });
        }

        joinBtn.addEventListener('click', async () => {
            const codeRaw = joinCode.value.trim();
            this.collabCode = codeRaw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
            this.nickname = (joinNick.value.trim() || suggestedNick).substring(0, 50);
            this.isHost = false;
            this.forcePhpMode = false;
            this.userColor = pickUserColor(this.client_id + ':' + this.collabCode);

            this._setBusy(overlay, true, '참여 중…');
            const ok = await this._startCollab();
            this._setBusy(overlay, false);
            if (ok) showInfo();
            else showToast('참가에 실패했습니다. 방 코드를 확인하거나, 네트워크 연결을 점검한 뒤 다시 시도해 주세요.', 'error');
        });

        // 코드 복사
        $('.t2-collab-copy-code-btn').addEventListener('click', () => {
            this._copyToClipboard(this.collabCode || '');
            showToast('방 코드가 복사되었습니다.', 'success');
        });
        $('.t2-collab-copy-link-btn').addEventListener('click', () => {
            this._copyToClipboard(this._buildShareUrl());
            showToast('참가 링크가 복사되었습니다.', 'success');
        });
        $('.t2-collab-share-system-btn')?.addEventListener('click', async () => {
            const link = this._buildShareUrl();
            if (navigator.share) {
                try { await navigator.share({ title: 'T2Editor 협업 참가', text: '협업 방에 참가하세요', url: link }); }
                catch (e) {}
            } else {
                this._copyToClipboard(link);
                showToast('링크가 복사되었습니다.', 'success');
            }
        });

        // 강퇴 / 따라가기 / 개인 편집 잠금
        $('.t2-collab-users-list').addEventListener('click', async (e) => {
            const kick = e.target.closest('[data-collab-action="kick"]');
            const follow = e.target.closest('[data-collab-action="follow"]');
            const userlock = e.target.closest('[data-collab-action="userlock"]');
            if (kick) {
                if (!this.isHost) return;
                const ok = await this._kickUser(kick.getAttribute('data-clientid'));
                if (ok) this._refreshUsersList(overlay);
            } else if (follow) {
                this._followUser(follow.getAttribute('data-clientid'));
                showToast('상대방 위치로 이동했습니다.', 'info', 1500);
            } else if (userlock) {
                if (!this.isHost) return;
                this._toggleUserLock(userlock.getAttribute('data-clientid'));
            }
        });

        $('.t2-collab-stop-btn').addEventListener('click', async () => {
            if (!this.isHost) return;
            if (!confirm('협업을 종료하시겠습니까? 모든 참가자의 연결이 끊깁니다.')) return;
            await this._stopRoom();
            this._closeModal();
            showToast('협업이 종료되었습니다.', 'info');
        });
        $('.t2-collab-leave-btn').addEventListener('click', async () => {
            if (!confirm('협업 방을 나가시겠습니까?')) return;
            await this._leave();
            this._closeModal();
            showToast('협업 방을 나갔습니다.', 'info');
        });
        $('.t2-collab-close-btn').addEventListener('click', () => {
            // 정보 패널이 표시되어 있어도, 협업은 그대로 두고 모달만 닫음
            this._closeModal();
        });
        // 사용법 안내 모달
        $('.t2-collab-help-btn').addEventListener('click', () => this._openHelpModal());
        // 배경 클릭 시 닫기 (info 상태에서도)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this._closeModal();
        });

        // 이미 진행 중이면 즉시 info 패널
        if (this.collabCode && this.transport && this.mode) showInfo();
    }

    _closeModal() {
        // [v3.2.4] 모달 닫힐 때 body 레벨 리액션 피커도 정리
        document.querySelectorAll('.t2c-react-picker').forEach(p => p.remove());
        if (this._modalOverlay) {
            if (this._modalOverlay._vvCleanup) this._modalOverlay._vvCleanup();
            try { this._modalOverlay.remove(); } catch (e) {}
        }
        this._modalOverlay = null;
        document.body.classList.remove('t2-collab-modal-open');
    }

    // ========== 사용법 안내 모달 ==========
    _openHelpModal() {
        if (this._helpOverlay && this._helpOverlay.isConnected) return;
        const overlay = document.createElement('div');
        overlay.className = 't2-modal-overlay t2-collab-help-overlay';
        overlay.innerHTML = this._renderHelpModalHTML();
        document.body.appendChild(overlay);
        this._helpOverlay = overlay;

        const close = () => this._closeHelpModal();
        overlay.querySelector('.t2-collab-help-close-btn').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        // 아코디언 섹션 토글
        overlay.querySelectorAll('.t2-collab-help-section').forEach(sec => {
            const head = sec.querySelector('.t2-collab-help-head');
            head.addEventListener('click', () => {
                const willOpen = !sec.classList.contains('is-open');
                overlay.querySelectorAll('.t2-collab-help-section').forEach(s => s.classList.remove('is-open'));
                if (willOpen) {
                    sec.classList.add('is-open');
                    // [v3.2.2] 펼친 섹션이 보이도록 스크롤 (모바일에서 하단 내용 가림 방지)
                    const contentEl = overlay.querySelector('.t2-collab-help-content');
                    if (contentEl) {
                        requestAnimationFrame(() => {
                            // contentEl 이 position:relative 이므로 sec.offsetTop 은 이미 contentEl 기준
                            const secTop = sec.offsetTop;
                            const secBottom = secTop + sec.offsetHeight;
                            const viewTop = contentEl.scrollTop;
                            const viewBottom = viewTop + contentEl.clientHeight;
                            if (secBottom > viewBottom || secTop < viewTop) {
                                const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                                contentEl.scrollTo({
                                    top: Math.max(0, secTop - 8),
                                    behavior: reducedMotion ? 'auto' : 'smooth'
                                });
                            }
                        });
                    }
                }
            });
        });
        // 첫 섹션 기본 펼침
        const first = overlay.querySelector('.t2-collab-help-section');
        if (first) first.classList.add('is-open');
    }

    _closeHelpModal() {
        if (this._helpOverlay) {
            try { this._helpOverlay.remove(); } catch (e) {}
        }
        this._helpOverlay = null;
    }

    _renderHelpModalHTML() {
        const sections = [
            {
                icon: 'rocket_launch',
                title: '시작하기 — 방 만들기 / 참여하기',
                body: `
                    <p><strong>방 만들기</strong> 탭에서 닉네임을 입력하고 <em>방 생성하고 시작</em>을 누르면 새 협업 방이 즉시 시작됩니다.</p>
                    <p>다른 사람을 초대하려면 <strong>방 코드</strong>, <strong>참가 링크</strong>, 또는 <strong>QR 코드</strong>를 공유하세요. 참가자는 <strong>참여하기</strong> 탭에서 코드를 입력하거나, 공유받은 링크/QR을 열기만 하면 자동으로 참가 화면이 뜹니다.</p>
                `
            },
            {
                icon: 'lan',
                title: '연결 모드 — P2P / 안정성 향상 / 서버 경유',
                body: `
                    <p><strong>P2P 직접 연결</strong>: 참가자들의 브라우저가 서로 직접 연결되어 가장 빠르고 서버 부하가 없습니다. 기본값입니다. 네트워크 환경에 따라 자동으로 서버 경유 모드로 전환될 수 있습니다.</p>
                    <p><strong>안정성 향상 모드</strong>: 방을 만들 때 호스트가 한 번만 켤 수 있는 옵션입니다. P2P 연결에 외부 무료 공개 중계 서버(STUN/TURN)와 PHP 백업 서버를 함께 사용해, 방화벽이나 네트워크 환경이 까다로운 곳에서도 연결이 끊기지 않도록 도와줍니다. 참가자는 별도 설정 없이 자동으로 같은 모드를 사용하게 됩니다.</p>
                    <p><strong>서버 경유 모드</strong>: P2P 연결이 모두 실패하면 자동으로 전환되는 최후의 수단입니다. 약간의 지연이 있을 수 있지만 문서 동기화는 계속됩니다.</p>
                    <p>현재 연결 상태는 정보 패널 상단의 <strong>모드 배지</strong>(예: "P2P 직접 연결", "안정성 향상 모드", "서버 경유")에서 확인할 수 있습니다.</p>
                `
            },
            {
                icon: 'shield',
                title: '안정성 향상 모드 안내',
                body: `
                    <p>안정성 향상 모드에서는 P2P 연결에 추가 STUN/TURN 중계 서버와 PHP 백업 서버를 함께 사용해 연결 안정성을 높입니다. 방화벽이나 네트워크 환경이 까다로운 곳에서도 연결이 잘 유지됩니다.</p>
                    <p><strong>채팅·DM</strong>은 P2P 채널을 통해 정상적으로 전송되며, PHP 백업 서버는 문서 동기화만 담당합니다. 따라서 채팅 기능을 그대로 사용할 수 있습니다.</p>
                    <p><strong>온라인 / 자리비움 / 바쁨 / 방해 금지</strong> 등 참가자 상태 표시 기능도 그대로 사용할 수 있어, 서로의 작업 가능 여부를 확인할 수 있습니다.</p>
                    <p>이 설정은 방을 만들 때 호스트만 한 번 선택할 수 있으며, 방을 만든 뒤에는 변경할 수 없습니다.</p>
                `
            },
            {
                icon: 'chat_bubble',
                title: '채팅 / 파일 공유',
                body: `
                    <p>정보 패널의 <strong>채팅</strong> 탭에서 전체 채팅과 1:1 비공개 대화(DM)를 모두 사용할 수 있습니다.</p>
                    <p>메시지를 길게 누르거나 우클릭하면 <strong>답장</strong>, <strong>복사</strong>, <strong>리액션</strong>을 사용할 수 있고, 검색 아이콘으로 대화 내용을 검색할 수 있습니다.</p>
                    <p><strong>파일 공유</strong>는 P2P 직접 연결 모드에서만 가능합니다. 첨부 버튼을 누르거나 채팅창에 파일을 끌어다 놓으세요.</p>
                `
            },
            {
                icon: 'visibility',
                title: '자리비움 / 바쁨 상태 표시',
                body: `
                    <p>정보 패널 상단의 상태 버튼을 눌러 <strong>온라인 / 자리비움 / 바쁨 / 방해 금지</strong> 중 하나를 선택할 수 있습니다.</p>
                    <p>일정 시간 입력이 없거나 다른 탭으로 이동하면 자동으로 <strong>자리비움</strong>으로 표시되고, 다시 활동하면 자동으로 <strong>온라인</strong>으로 돌아옵니다.</p>
                    <p>참여자 목록에서 각 사용자의 현재 상태를 색상 점으로 확인할 수 있습니다.</p>
                `
            },
            {
                icon: 'admin_panel_settings',
                title: '편집 잠금 / 강퇴 / 호스트 인계',
                body: `
                    <p>방장은 <strong>편집 잠금</strong> 버튼으로 모든 참가자의 편집을 일시적으로 막을 수 있습니다.</p>
                    <p>참여자 목록에서 <strong>강퇴</strong>를 눌러 특정 참가자를 내보낼 수 있습니다.</p>
                    <p>방장의 연결이 끊기면, 참가자 중 한 명이 자동으로 새로운 방장 역할을 이어받아 방이 계속 유지됩니다 (P2P 모드).</p>
                `
            },
            {
                icon: 'help',
                title: '문제 해결 팁',
                body: `
                    <p>연결이 자주 끊긴다면, 방을 새로 만들 때 <strong>안정성 향상 모드</strong>를 켜보세요.</p>
                    <p>회사/학교 등 방화벽이 엄격한 네트워크에서는 P2P 연결이 차단될 수 있으며, 이 경우 자동으로 서버 경유 모드로 전환됩니다.</p>
                    <p>참가할 수 없는 경우, 방 코드와 닉네임을 다시 확인하고 페이지를 새로고침한 뒤 다시 시도해 보세요.</p>
                `
            }
        ];

        const sectionsHtml = sections.map(s => `
            <div class="t2-collab-help-section">
                <button type="button" class="t2-collab-help-head">
                    <span class="material-icons" aria-hidden="true">${s.icon}</span>
                    <span class="t2-collab-help-title">${s.title}</span>
                    <span class="material-icons t2-collab-help-chevron" aria-hidden="true">expand_more</span>
                </button>
                <div class="t2-collab-help-body">${s.body}</div>
            </div>
        `).join('');

        return `
            <div class="t2-modal-box t2-collab-help-modal" role="dialog" aria-modal="true" aria-label="협업 기능 사용법">
                <div class="t2-collab-header">
                    <div class="t2-collab-title-wrap">
                        <span class="t2-collab-title-icon" aria-hidden="true">
                            <span class="material-icons">help_outline</span>
                        </span>
                        <h3>협업 기능 사용법</h3>
                    </div>
                    <button class="t2-collab-close-btn t2-collab-help-close-btn" aria-label="닫기">
                        <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                </div>
                <div class="t2-collab-help-content">
                    ${sectionsHtml}
                </div>
            </div>
        `;
    }

    _renderModalHTML() {
        return `
            <div class="t2-modal-box t2-collab-modal" role="dialog" aria-modal="true" aria-label="실시간 협업">
                <div class="t2-collab-header">
                    <div class="t2-collab-title-wrap">
                        <span class="t2-collab-title-icon" aria-hidden="true">
                            <span class="material-icons">groups</span>
                        </span>
                        <h3>실시간 협업</h3>
                    </div>
                    <button class="t2-collab-icon-btn t2-collab-help-btn" aria-label="사용법" title="협업 기능 사용법">
                        <span class="material-icons" aria-hidden="true">help_outline</span>
                    </button>
                    <button class="t2-collab-close-btn" aria-label="닫기">
                        <span class="material-icons" aria-hidden="true">close</span>
                    </button>
                </div>

                <!-- 시작 패널 -->
                <div class="t2-collab-pane-pre">
                    <div class="t2-collab-tabs">
                        <button type="button" class="t2-collab-tab" data-tab="create">
                            <span class="material-icons">add_circle</span>방 만들기
                        </button>
                        <button type="button" class="t2-collab-tab" data-tab="join">
                            <span class="material-icons">login</span>참여하기
                        </button>
                        <div class="t2-collab-tab-indicator"></div>
                    </div>

                    <div class="t2-collab-pane" data-pane="create">
                        <p class="t2-collab-desc">새 협업 방을 만들고 동료들을 초대하세요.</p>
                        <label class="t2-collab-field">
                            <span class="t2-collab-field-label">닉네임</span>
                            <input type="text" class="t2-collab-host-nick" placeholder="예: 김편집" maxlength="20">
                        </label>
                        <label class="t2-collab-checkbox t2-collab-stability-toggle">
                            <input type="checkbox" class="t2-collab-stability-mode">
                            <span>
                                안정성 향상 모드 (P2P + 백업 서버 하이브리드)
                                <small class="t2-collab-stability-hint">
                                    연결 안정성을 높이기 위해 외부 무료 공개 중계 서버 / PHP 서버를 P2P와 함께 사용합니다.
                                    채팅·DM은 P2P 채널로 전송되어 정상 이용 가능합니다.
                                </small>
                            </span>
                        </label>
                        <button type="button" class="t2-collab-btn t2-collab-btn-primary t2-collab-create-btn">
                            <span class="material-icons">play_arrow</span>방 생성하고 시작
                        </button>
                    </div>

                    <div class="t2-collab-pane" data-pane="join">
                        <p class="t2-collab-desc">방 코드를 입력하거나 QR/링크로 참여하세요.</p>
                        <label class="t2-collab-field">
                            <span class="t2-collab-field-label">방 코드</span>
                            <input type="text" class="t2-collab-join-code" placeholder="예: ABCD23" maxlength="12" autocapitalize="characters" autocomplete="off">
                        </label>
                        <label class="t2-collab-field">
                            <span class="t2-collab-field-label">닉네임</span>
                            <input type="text" class="t2-collab-join-nick" placeholder="예: 박참여" maxlength="20">
                        </label>
                        <!-- QR 이미지 업로드로 참여 -->
                        <div class="t2-collab-qr-upload-wrap">
                            <label class="t2-collab-qr-upload-btn" title="QR 이미지 업로드">
                                <span class="material-icons">qr_code_scanner</span>
                                <span class="t2c-qr-upload-label">QR 이미지로 참여</span>
                                <input type="file" class="t2-collab-qr-upload-input" accept="image/*" hidden>
                            </label>
                            <p class="t2-collab-qr-upload-hint">저장된 QR 이미지를 선택하면 자동으로 참여됩니다.</p>
                        </div>
                        <p class="t2-collab-join-hint">
                            <span class="material-icons" aria-hidden="true">info</span>
                            안정성 향상 모드 등 연결 방식은 방장이 설정한 값을 자동으로 따릅니다.
                        </p>
                        <button type="button" class="t2-collab-btn t2-collab-btn-primary t2-collab-join-btn" disabled>
                            <span class="material-icons">login</span>참여
                        </button>
                    </div>

                    <div class="t2-collab-busy" style="display:none;">
                        <div class="t2-collab-spinner"></div>
                        <p class="t2-collab-busy-text">연결 중…</p>
                    </div>
                </div>

                <!-- 정보 패널 -->
                <div class="t2-collab-pane-info" style="display:none;">
                    <!-- 내부 탭: 상태 / 채팅 -->
                    <div class="t2c-info-tabs">
                        <button type="button" class="t2c-info-tab is-active" data-infotab="status">
                            <span class="material-icons">info</span>상태
                        </button>
                        <button type="button" class="t2c-info-tab" data-infotab="chat">
                            <span class="material-icons">chat_bubble</span>채팅
                            <span class="t2c-chat-unread" style="display:none">0</span>
                        </button>
                    </div>

                    <!-- 상태 패널 -->
                    <div class="t2c-info-pane is-active" data-infopane="status">
                    <div class="t2-collab-status-card">
                        <!-- [v2.1.5] 모바일 컴팩트 바 (접힌 상태에서도 상태+QR 접근 가능) -->
                        <div class="t2c-status-compact-bar">
                            <div class="t2c-status-compact-left">
                                <span class="t2c-compact-status-dot t2c-s-online" title="온라인"></span>
                                <span class="t2c-compact-status-label">온라인</span>
                                <span class="t2c-status-compact-code"></span>
                                <span class="t2-collab-mode-badge" style="margin-left:0"></span>
                            </div>
                            <div class="t2c-compact-right">
                                <button type="button" class="t2c-compact-qr-btn" title="QR 코드 보기" aria-label="QR 코드 보기">
                                    <span class="material-icons">qr_code_2</span>
                                </button>
                                <span class="t2c-status-expand-hint">
                                    <span class="material-icons" aria-hidden="true">expand_more</span>펼치기
                                </span>
                            </div>
                        </div>
                        <div class="t2-collab-status-row">
                            <span class="t2-collab-label">방 코드</span>
                            <div class="t2-collab-code-wrap">
                                <strong class="t2-collab-disp-code"></strong>
                                <button type="button" class="t2-collab-icon-btn t2-collab-copy-code-btn" title="코드 복사">
                                    <span class="material-icons">content_copy</span>
                                </button>
                                <!-- [v2.1.5] 모바일: 펼친 상태에서도 QR 접근 가능한 버튼 -->
                                <button type="button" class="t2-collab-icon-btn t2c-expanded-qr-btn" title="QR 코드 보기" style="display:none">
                                    <span class="material-icons">qr_code_2</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-collab-status-row">
                            <span class="t2-collab-label">참가 링크</span>
                            <div class="t2-collab-link-wrap">
                                <input type="text" class="t2-collab-share-link" readonly>
                                <button type="button" class="t2-collab-icon-btn t2-collab-copy-link-btn" title="링크 복사">
                                    <span class="material-icons">link</span>
                                </button>
                                <button type="button" class="t2-collab-icon-btn t2-collab-share-system-btn" title="공유">
                                    <span class="material-icons">share</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-collab-status-row t2-collab-qr-row">
                            <div class="t2-collab-qr-box">
                                <div class="t2-collab-qr-loading"><span class="material-icons">qr_code_2</span><small>QR 생성 중…</small></div>
                            </div>
                            <p class="t2-collab-qr-tip">스마트폰 카메라로 스캔하여 바로 참가할 수 있습니다</p>
                        </div>
                        <!-- [v2.2.0] QR 토글 버튼 제거 — 인라인 QR 숨김, QR 팝업으로 통일 -->
                        <div class="t2-collab-meta-row">
                            <span class="t2c-avatar-wrap t2c-self-avatar">
                                <span class="t2-collab-self-color" aria-hidden="true"></span>
                                <span class="t2c-presence-dot t2c-my-status-dot t2c-s-online" title="온라인"></span>
                            </span>
                            <span class="t2-collab-disp-nick"></span>
                            <button type="button" class="t2c-status-btn" aria-label="상태 변경">
                                <span class="t2c-status-label">온라인</span>
                                <span class="material-icons t2c-status-chevron">expand_more</span>
                            </button>
                            <span class="t2-collab-mode-badge">연결 중…</span>
                        </div>
                        <!-- [v3.1.0] 보안/연결 정보 링크 -->
                        <div class="t2c-security-link-row">
                            <button type="button" class="t2c-security-link-btn" aria-label="보안 및 연결 정보 보기">
                                <span class="material-icons" aria-hidden="true">verified_user</span>
                                <span class="t2c-security-link-text">이 협업은 안전한가요?</span>
                            </button>
                        </div>
                        <!-- 상태 드롭다운 -->
                        <div class="t2c-status-picker" style="display:none">
                            <button type="button" class="t2c-status-opt is-active" data-status="online">
                                <span class="t2c-presence-dot t2c-s-online"></span>온라인
                            </button>
                            <button type="button" class="t2c-status-opt" data-status="away">
                                <span class="t2c-presence-dot t2c-s-away"></span>자리비움
                            </button>
                            <button type="button" class="t2c-status-opt" data-status="busy">
                                <span class="t2c-presence-dot t2c-s-busy"></span>바쁨
                            </button>
                            <button type="button" class="t2c-status-opt" data-status="dnd">
                                <span class="t2c-presence-dot t2c-s-dnd"></span>방해 금지
                            </button>
                        </div>
                    </div>

                    <div class="t2-collab-section-title">
                        <span class="material-icons">groups</span>
                        <span>참여자</span>
                        <span class="t2c-participant-count" style="display:none">0</span>
                    </div>
                    <ul class="t2-collab-users-list"></ul>

                    <div class="t2-collab-actions-row">
                        <button class="t2-collab-btn t2-collab-btn-outline t2-collab-lock-btn" style="display:none;" title="에디터 잠금/해제 (방장 전용)">
                            <span class="material-icons t2c-lock-icon">lock_open</span><span class="t2c-lock-label">편집 잠금</span>
                        </button>
                        <button class="t2-collab-btn t2-collab-btn-stop t2-collab-stop-btn" style="display:none;">
                            <span class="material-icons">stop_circle</span>방 종료
                        </button>
                        <button class="t2-collab-btn t2-collab-btn-leave t2-collab-leave-btn">
                            <span class="material-icons">logout</span>나가기
                        </button>
                    </div>
                    </div><!-- /status pane -->

                    <!-- 채팅 패널 -->
                    <div class="t2c-info-pane" data-infopane="chat">
                        <!-- 채널 헤더 (전체/DM 전환 + 검색 + QR) -->
                        <div class="t2c-chat-header">
                            <div class="t2c-ch-tabs">
                                <button type="button" class="t2c-ch-btn is-active" data-ch="all" title="전체 채팅">
                                    <span class="material-icons">groups</span>전체
                                </button>
                                <span class="t2c-dm-pill" style="display:none" title="DM 채팅 중">
                                    <span class="material-icons" aria-hidden="true">lock</span>
                                    <span class="t2c-dm-pill-nick"></span>
                                    <button type="button" class="t2c-dm-close-btn" aria-label="DM 닫기">
                                        <span class="material-icons">close</span>
                                    </button>
                                </span>
                            </div>
                            <div class="t2c-chat-header-actions">
                                <button type="button" class="t2c-chat-qr-btn" title="QR 코드 보기" aria-label="QR 코드 보기">
                                    <span class="material-icons">qr_code_2</span>
                                </button>
                                <button type="button" class="t2c-search-toggle-btn" title="메시지 검색" aria-label="채팅 검색">
                                    <span class="material-icons">search</span>
                                </button>
                            </div>
                        </div>
                        <!-- 검색 바 (토글) -->
                        <div class="t2c-search-bar" style="display:none">
                            <span class="material-icons t2c-search-icon" aria-hidden="true">search</span>
                            <input type="text" class="t2c-search-input" placeholder="메시지 검색…" autocomplete="off" maxlength="100">
                            <span class="t2c-search-count" style="display:none"></span>
                            <button type="button" class="t2c-search-close-btn" aria-label="검색 닫기">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                        <!-- 메시지 목록 -->
                        <div class="t2c-chat-msgs" role="log" aria-live="polite" aria-label="채팅 메시지"></div>
                        <!-- 맨 아래로 FAB -->
                        <button type="button" class="t2c-scroll-btn" style="display:none" aria-label="맨 아래로">
                            <span class="material-icons">keyboard_arrow_down</span>
                            <span class="t2c-scroll-badge" style="display:none">0</span>
                        </button>
                        <!-- 타이핑 인디케이터 -->
                        <div class="t2c-typing-bar"></div>
                        <!-- 답장 미리보기 -->
                        <div class="t2c-reply-preview" style="display:none">
                            <div class="t2c-reply-preview-bar"></div>
                            <div class="t2c-reply-preview-body">
                                <span class="t2c-reply-preview-nick"></span>
                                <span class="t2c-reply-preview-text"></span>
                            </div>
                            <button type="button" class="t2c-reply-cancel-btn" aria-label="답장 취소">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                        <!-- 입력창 -->
                        <div class="t2c-chat-input-row">
                            <label class="t2c-attach-btn" title="파일 첨부 (직접 연결 모드에서만 사용 가능)">
                                <span class="material-icons">attach_file</span>
                                <input type="file" class="t2c-file-input" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.pdf,.md,.txt,.csv,.ppt,.pptx,.doc,.docx,.xlsx,.xls,.hwp,.hwpx,.zip,.mp4,.mov,.mp3,.wav">
                            </label>
                            <input type="text" class="t2c-chat-txt" placeholder="메시지 입력…" maxlength="2000" autocomplete="off">
                            <button type="button" class="t2c-send-btn" aria-label="전송">
                                <span class="material-icons">send</span>
                            </button>
                        </div>
                    </div><!-- /chat pane -->
                </div>
                <!-- [v3.1.0] 보안/연결 정보 팝업 오버레이 -->
                <div class="t2c-security-popup-overlay" style="display:none">
                    <div class="t2c-security-popup">
                        <div class="t2c-security-popup-header">
                            <span class="material-icons">shield</span>
                            <span>연결 · 보안 정보</span>
                            <button type="button" class="t2c-security-popup-close" aria-label="닫기">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                        <div class="t2c-security-popup-body">
                            <div class="t2c-security-overview">
                                <span class="material-icons t2c-security-shield-icon">verified_user</span>
                                <div class="t2c-security-overview-text">
                                    <strong>이 세션은 안전하게 보호되고 있어요</strong>
                                    <p>주고받는 내용은 암호화 지문으로 보호되며, 변경 이력이 서로 연결되어 위·변조를 감지합니다.</p>
                                </div>
                            </div>
                            <div class="t2c-security-services">
                                <!-- 실시간 협업 연결 -->
                                <div class="t2c-service-card" data-service="smartlink">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">link</span>
                                        <div class="t2c-service-card-title">
                                            <strong>실시간 협업 연결</strong>
                                            <span class="t2c-service-card-sub">참가자와 직접 연결하여 변경 사항을 즉시 전달합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>연결 상태</span><span class="t2c-svc-smartlink-status">—</span></div>
                                        <div class="t2c-service-data-row"><span>연결 모드</span><span class="t2c-svc-smartlink-mode">—</span></div>
                                        <div class="t2c-service-data-row"><span>지연 시간</span><span class="t2c-svc-smartlink-latency">—</span></div>
                                        <div class="t2c-service-data-row"><span>피어 수</span><span class="t2c-svc-smartlink-peers">—</span></div>
                                    </div>
                                </div>
                                <!-- 참가자 간 공유 캐시 -->
                                <div class="t2c-service-card" data-service="meshcdn">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">hub</span>
                                        <div class="t2c-service-card-title">
                                            <strong>참가자 간 공유 캐시</strong>
                                            <span class="t2c-service-card-sub">서로의 캐시를 공유해 끊김 없이 동기화합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>캐시 상태</span><span class="t2c-svc-meshcdn-cache">—</span></div>
                                        <div class="t2c-service-data-row"><span>동기화 주기</span><span class="t2c-svc-meshcdn-interval">—</span></div>
                                        <div class="t2c-service-data-row"><span>마지막 동기화</span><span class="t2c-svc-meshcdn-lastsync">—</span></div>
                                    </div>
                                </div>
                                <!-- 데이터 무결성 확인 -->
                                <div class="t2c-service-card" data-service="trustchain">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">account_tree</span>
                                        <div class="t2c-service-card-title">
                                            <strong>데이터 무결성 확인</strong>
                                            <span class="t2c-service-card-sub">변경 이력을 연결된 블록으로 기록해 위·변조를 감지합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>체인 높이</span><span class="t2c-svc-trustchain-height">—</span></div>
                                        <div class="t2c-service-data-row"><span>무결성</span><span class="t2c-svc-trustchain-integrity">—</span></div>
                                        <div class="t2c-service-data-row"><span>최신 해시</span><span class="t2c-svc-trustchain-hash">—</span></div>
                                        <div class="t2c-service-data-row"><span>Merkle 루트</span><span class="t2c-svc-trustchain-merkle">—</span></div>
                                    </div>
                                </div>
                                <!-- 브라우저 내 저장소 -->
                                <div class="t2c-service-card" data-service="vaultsync">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">warehouse</span>
                                        <div class="t2c-service-card-title">
                                            <strong>브라우저 내 저장소</strong>
                                            <span class="t2c-service-card-sub">브라우저 안에 안전하게 저장하고 다시 켰을 때 복원합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>스토리지</span><span class="t2c-svc-vaultsync-storage">—</span></div>
                                        <div class="t2c-service-data-row"><span>저장 블록</span><span class="t2c-svc-vaultsync-blocks">—</span></div>
                                        <div class="t2c-service-data-row"><span>저장 청크</span><span class="t2c-svc-vaultsync-chunks">—</span></div>
                                    </div>
                                </div>
                                <!-- 오프라인 보조 -->
                                <div class="t2c-service-card" data-service="offlinebridge">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">cloud_off</span>
                                        <div class="t2c-service-card-title">
                                            <strong>오프라인 보조</strong>
                                            <span class="t2c-service-card-sub">연결이 끊겨도 작업을 모았다가 복구되면 자동으로 보냅니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>상태</span><span class="t2c-svc-offlinebridge-status">—</span></div>
                                        <div class="t2c-service-data-row"><span>대기 중인 연산</span><span class="t2c-svc-offlinebridge-queue">—</span></div>
                                    </div>
                                </div>
                                <!-- 암호화 엔진 -->
                                <div class="t2c-service-card" data-service="cryptocore">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">enhanced_encryption</span>
                                        <div class="t2c-service-card-title">
                                            <strong>암호화 엔진</strong>
                                            <span class="t2c-service-card-sub">브라우저 표준 암호 기능으로 데이터 지문을 만듭니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>해시 알고리즘</span><span class="t2c-svc-cryptocore-algo">—</span></div>
                                        <div class="t2c-service-data-row"><span>Web Crypto API</span><span class="t2c-svc-cryptocore-webcrypto">—</span></div>
                                    </div>
                                </div>
                                <!-- 연결 방식 -->
                                <div class="t2c-service-card" data-service="hybridconnect">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">swap_horiz</span>
                                        <div class="t2c-service-card-title">
                                            <strong>연결 방식</strong>
                                            <span class="t2c-service-card-sub">상황에 맞춰 직접 연결과 서버 경유 연결을 함께 활용합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>활성 모드</span><span class="t2c-svc-hybridconnect-mode">—</span></div>
                                        <div class="t2c-service-data-row"><span>안정성 향상</span><span class="t2c-svc-hybridconnect-stability">—</span></div>
                                        <div class="t2c-service-data-row"><span>PHP 백업</span><span class="t2c-svc-hybridconnect-php">—</span></div>
                                    </div>
                                </div>
                                <!-- 리액션 동기화 -->
                                <div class="t2c-service-card" data-service="reactionsync">
                                    <div class="t2c-service-card-header">
                                        <span class="material-icons t2c-service-icon">emoji_emotions</span>
                                        <div class="t2c-service-card-title">
                                            <strong>리액션 동기화</strong>
                                            <span class="t2c-service-card-sub">이모지 반응을 모든 참가자에게 곧바로 전달합니다</span>
                                        </div>
                                    </div>
                                    <div class="t2c-service-card-data">
                                        <div class="t2c-service-data-row"><span>활성 리액션</span><span class="t2c-svc-reactionsync-count">—</span></div>
                                        <div class="t2c-service-data-row"><span>동기화 상태</span><span class="t2c-svc-reactionsync-status">—</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- [v2.3.0] QR 팝업 오버레이: 상태 리스트 가시성 확보 + 미니 상태 바 -->
                <div class="t2c-qr-popup-overlay" style="display:none">
                    <div class="t2c-qr-popup">
                        <!-- [v2.3.0] 미니 상태 바: QR 팝업에도 내 상태 + 참가자 수 표시 -->
                        <div class="t2c-qr-status-bar">
                            <span class="t2c-qr-status-dot t2c-s-online" title="온라인"></span>
                            <span class="t2c-qr-status-label">온라인</span>
                            <span class="t2c-qr-status-sep">·</span>
                            <span class="t2c-qr-status-mode"></span>
                            <span class="t2c-qr-status-count-wrap" style="display:none">
                                <span class="t2c-qr-status-sep">·</span>
                                <span class="t2c-qr-status-count">0</span>명 참여 중
                            </span>
                        </div>
                        <div class="t2c-qr-popup-header">
                            <span class="material-icons">qr_code_2</span>
                            <span>QR 코드</span>
                            <button type="button" class="t2c-qr-popup-close" aria-label="닫기">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                        <div class="t2c-qr-popup-body">
                            <div class="t2c-qr-popup-qr-box">
                                <div class="t2-collab-qr-loading"><span class="material-icons t2-collab-spin">autorenew</span><small>QR 생성 중…</small></div>
                            </div>
                            <p class="t2c-qr-popup-tip">스마트폰 카메라로 스캔하여 바로 참가할 수 있습니다</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _setBusy(overlay, busy, text = '연결 중…') {
        const b = overlay.querySelector('.t2-collab-busy');
        if (!b) return;
        b.querySelector('.t2-collab-busy-text').textContent = text;
        b.style.display = busy ? 'flex' : 'none';
    }

    _refreshJoinBtn(overlay) {
        const code = overlay.querySelector('.t2-collab-join-code').value.trim();
        const nick = overlay.querySelector('.t2-collab-join-nick').value.trim();
        overlay.querySelector('.t2-collab-join-btn').disabled = !(code.length >= 4 && nick.length > 0);
    }

    _suggestNickname() {
        const adjs = ['빠른', '신난', '귀여운', '용감한', '친절한', '재치있는', '꼼꼼한', '느긋한', '명랑한', '신중한'];
        const nouns = ['편집자', '작가', '디자이너', '협업러', '에디터', '동료', '메이커', '드래프터', '플래너', '리더'];
        return adjs[Math.floor(Math.random() * adjs.length)] + nouns[Math.floor(Math.random() * nouns.length)];
    }

    _generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = '';
        for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    // [FIX] 기존엔 무조건 ?query 에만 파라미터 추가했으므로,
    //       hash 라우팅을 쓰는 SPA / 일부 CMS 에서 상대방이 링크를 열었을 때
        //   라우터가 query 를 읽지 못하거나, ?query 가 서버로만 전달되고
        //   클라이언트 라우트에서는 보이지 않는 문제가 있었음.
    //       이제는 현재 URL 의 형태를 분석해, hash 내부에 query 가 있으면
        //   그 안에 추가하고, 그렇지 않으면 search 에 추가한다.
    _buildShareUrl() {
        const code = this.collabCode || '';
        try {
            const u = new URL(window.location.href);
            const key = CFG.URL_PARAM_KEY;
            const encVal = encodeURIComponent(code);

            const hashStr = u.hash || '';
            // hash 안에 “?...” 패턴이 있으면 hash router 로 간주
            const hashHasQuery = /#[^?]*\?/.test(hashStr);
            // hash 가 "#key=value" 식 일반 fragment query 인지 판정
            const hashIsBareKV = !hashHasQuery && /^#[^/].*=/.test(hashStr);

            if (hashHasQuery) {
                const [hPath, hQuery = ''] = hashStr.substring(1).split(/\?(.+)/);
                const sp = new URLSearchParams(hQuery.replace(/;/g, '&'));
                sp.set(key, code);
                u.hash = '#' + hPath + '?' + sp.toString();
            } else if (hashIsBareKV) {
                const sp = new URLSearchParams(hashStr.substring(1).replace(/;/g, '&'));
                sp.set(key, code);
                u.hash = '#' + sp.toString();
            } else {
                u.searchParams.set(key, code);
            }
            return u.toString();
        } catch (e) {
            // 구형 브라우저 fallback
            return window.location.origin + window.location.pathname + '?' +
                CFG.URL_PARAM_KEY + '=' + encodeURIComponent(code);
        }
    }

    // ========== QR 생성 (clipurl 플러그인 연동) ==========
    // v2.1.2: 한 번 생성된 QR은 this._qrCache 에 저장해서
    //         같은 link 에 대해서는 재생성 API 호출을 하지 않고
    //         캐시된 URL을 그대로 다시 사용한다.
    async _tryGenerateQRForLink(overlay, link) {
        const box = overlay.querySelector('.t2-collab-qr-box');
        if (!box) return;

        // ★ 캐시 적중: 같은 link 면 자동 재사용 (API 호출 안함)
        if (this._qrCache && this._qrCache.link === link && this._qrCache.url) {
            this._renderQRBox(box, this._qrCache.url);
            return;
        }

        try {
            const clipurl = this.editor.getPlugin && this.editor.getPlugin('clipurl');
            if (clipurl && typeof clipurl.callAPI === 'function') {
                box.innerHTML = '<div class="t2-collab-qr-loading"><span class="material-icons t2-collab-spin">autorenew</span><small>QR 생성 중…</small></div>';
                const data = await clipurl.callAPI(link, 'qr');
                const qrUrl = data && data.qr_code_url;
                if (qrUrl) {
                    const safe = String(qrUrl).replace(/[<>"]/g, '');
                    this._qrCache = { link, url: safe };
                    this._renderQRBox(box, safe);
                    return;
                }
            }
        } catch (e) {
            console.warn('[Collab] QR via clipurl failed:', e);
        }
        // Fallback: 외부 QR 이미지 서비스 (단축X, 그냥 이미지)
        const fallback = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(link);
        this._qrCache = { link, url: fallback };
        this._renderQRBox(box, fallback);
    }

    // 공통 렌더러: QR 이미지 + 다운로드 버튼
    _renderQRBox(box, url) {
        if (!box) return;
        const safe = String(url).replace(/[<>"]/g, '');
        box.innerHTML = `
            <img src="${safe}" alt="협업 참가 QR" class="t2-collab-qr-img" crossorigin="anonymous">
            <button type="button" class="t2-collab-qr-dl" title="QR 다운로드">
                <span class="material-icons">download</span>
            </button>
        `;
        const dl = box.querySelector('.t2-collab-qr-dl');
        if (dl) dl.addEventListener('click', () => this._downloadQRFromUrl(safe));
    }

    _downloadQRFromUrl(url) {
        fetch(url)
            .then(r => r.blob())
            .then(blob => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 't2collab-' + (this.collabCode || 'qr') + '.png';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(a.href);
                showToast('QR이 저장되었습니다.', 'success');
            })
            .catch(() => showToast('QR 다운로드에 실패했습니다.', 'error'));
    }

    // ========== QR 이미지로부터 코드 수집 ==========
    // jsQR 라이브러리를 동적으로 로드 (CDN) 구현.
    // 단 1회만 로드해 window.jsQR 으로 재사용.
    _loadJsQR() {
        if (window.jsQR) return Promise.resolve(window.jsQR);
        if (this._jsQRPromise) return this._jsQRPromise;
        this._jsQRPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
            s.async = true;
            s.onload = () => { if (window.jsQR) resolve(window.jsQR); else reject(new Error('jsQR load failed')); };
            s.onerror = () => reject(new Error('jsQR network error'));
            document.head.appendChild(s);
        });
        return this._jsQRPromise;
    }

    // File → ImageBitmap → Canvas → jsQR 결과 문자열
    async _decodeQRFromImageFile(file) {
        const jsQR = await this._loadJsQR();
        // 이미지 로드
        const dataURL = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error || new Error('read fail'));
            fr.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('image load fail'));
            im.src = dataURL;
        });
        // 너무 큰 이미지는 축소해서 처리 (성능)
        const MAX = 1280;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (Math.max(w, h) > MAX) {
            const r = MAX / Math.max(w, h);
            w = Math.round(w * r); h = Math.round(h * r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h);

        // 1차: 원본 그대로
        let result = jsQR(id.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (result && result.data) return result.data;

        // 2차 (fallback): 좀 더 밝게 보정해서 재시도 (단순 그레이스케일 + 대비 향상)
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = g < 128 ? Math.max(0, g - 18) : Math.min(255, g + 18);
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(id, 0, 0);
        const id2 = ctx.getImageData(0, 0, w, h);
        result = jsQR(id2.data, w, h, { inversionAttempts: 'attemptBoth' });
        return (result && result.data) ? result.data : null;
    }

    // QR payload (URL 또는 plain text) 에서 방 코드 추출
    _extractCodeFromQRPayload(text) {
        if (!text) return null;
        const raw = String(text).trim();
        // 1) URL 파싱 시도 (기존 extractRoomCodeFromUrl 재사용)
        try {
            const u = new URL(raw);
            const code = T2CollabPlugin.extractRoomCodeFromUrl(u, CFG.URL_PARAM_KEY);
            if (code) return code;
        } catch (e) { /* URL 아님 → 아래로 폴백 */ }
        // 2) "t2collab=XXXX" 패턴 직접 스캔
        const m = raw.match(new RegExp(CFG.URL_PARAM_KEY + '=([A-Za-z0-9]{4,12})'));
        if (m) return m[1];
        // 3) 순수 코드 파싱 (4~12자 영숫자)
        const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned.length >= 4 && cleaned.length <= 12) return cleaned;
        // 4) 일부만 영숫자일 때 키 패턴 포함 여부
        const m2 = cleaned.match(/[A-Za-z0-9]{4,12}/);
        return m2 ? m2[0] : null;
    }

    // ============================================================
    // === 호스트 Heartbeat (호스트 측) ===
    // ============================================================

    _startHostHeartbeat() {
        this._stopHostHeartbeat();
        let backupTick = 0;
        this._hbInterval = setInterval(() => {
            if (!this.transport || !this.mode) return;
            try {
                const pingData = {};
                if (this.transport.connections) {
                    for (const [cid] of this.transport.connections) {
                        pingData[cid] = this._pingMap.get(cid) || 999;
                    }
                }
                this.transport.send({
                    t: CFG.MSG_TYPES.HB,
                    p: { ts: Date.now(), pingMap: pingData },
                    from: this.client_id, ts: Date.now()
                });
            } catch (e) {}
            backupTick += CFG.HB_INTERVAL_MS;
            if (backupTick >= CFG.BACKUP_INTERVAL_MS) {
                backupTick = 0;
                this._sendDocBackups();
            }
        }, CFG.HB_INTERVAL_MS);
    }

    _stopHostHeartbeat() {
        if (this._hbInterval) { clearInterval(this._hbInterval); this._hbInterval = null; }
    }

    _sendDocBackups() {
        if (!this.isHost || !this.transport) return;
        const html = this.editor && this.editor.editor ? this.editor.editor.innerHTML : '';
        if (!html) return;
        const domState = extractDOMState(html);
        const guests = (this.users || [])
            .filter(u => !u.isHost && u.client_id !== this.client_id)
            .map(u => ({ ...u, ping: this._pingMap.get(u.client_id) || 999 }))
            .sort((a, b) => a.ping - b.ping)
            .slice(0, CFG.BACKUP_COUNT);
        const backupPeers = guests.map((u, i) => ({
            rank: i + 1,
            clientId: u.client_id,
            peerId: `t2c_${this.collabCode}${CFG.BACKUP_ID_SFX}${i + 1}`
        }));
        guests.forEach((u, i) => {
            try {
                this.transport.send({
                    t: CFG.MSG_TYPES.BACKUP,
                    p: { rank: i + 1, content: html, domState, ts: Date.now(),
                         backupPeers, chatMessages: this._chatMessages.slice(-50) },
                    to: u.client_id, from: this.client_id, ts: Date.now()
                });
            } catch (e) {}
        });
        if (backupPeers.length > 0) {
            const updatedUsers = (this.users || []).map(u => {
                const bp = backupPeers.find(b => b.clientId === u.client_id);
                return bp ? { ...u, backupRank: bp.rank, backupPeerId: bp.peerId }
                           : { ...u, backupRank: null };
            });
            try { this.transport.send({ t: CFG.MSG_TYPES.USERS, p: updatedUsers, from: this.client_id, ts: Date.now() }); } catch (e) {}
        }
    }

    // ============================================================
    // === Heartbeat Watchdog (게스트 측) ===
    // ============================================================

    _startHeartbeatWatchdog() {
        this._lastHostHb = Date.now();
        this._stopHeartbeatWatchdog();
        this._hbWatchdog = setInterval(() => {
            if (Date.now() - this._lastHostHb > CFG.HB_TIMEOUT_MS) {
                this._stopHeartbeatWatchdog();
                this._onHostSilent();
            }
        }, 2000);
    }

    _stopHeartbeatWatchdog() {
        if (this._hbWatchdog) { clearInterval(this._hbWatchdog); this._hbWatchdog = null; }
    }

    _handleHeartbeat(msg) {
        if (this.isHost) return;
        this._lastHostHb = Date.now();
        if (msg.p && msg.p.ts) this.latency = Date.now() - msg.p.ts;
        if (msg.p && msg.p.pingMap) {
            for (const [cid, ms] of Object.entries(msg.p.pingMap)) {
                this._pingMap.set(cid, ms);
            }
        }
    }

    // ============================================================
    // === 백업 수신 + 백업 피어 등록 ===
    // ============================================================

    _handleBackup(msg) {
        if (this.isHost) return;
        const p = msg && msg.p;
        if (!p || !p.content) return;
        this._backupRank    = p.rank;
        this._backupContent = { content: p.content, domState: p.domState || {}, ts: p.ts };
        this._backupPeerIds = p.backupPeers || [];
        this._saveDocToCache(p.content, p.domState);
        if (Array.isArray(p.chatMessages) && p.chatMessages.length > 0) {
            this._chatMessages = p.chatMessages;
            this._saveChatToCache();
        }
        if (p.rank && !this._backupPeer) this._setupBackupPeer(p.rank);
    }

    _setupBackupPeer(rank) {
        if (this._backupPeer) return;
        if (typeof Peer === 'undefined') return;
        const peerId = `t2c_${this.collabCode}${CFG.BACKUP_ID_SFX}${rank}`;
        try {
            const peerCfg = this.transport && this.transport._peerCfg ? this.transport._peerCfg : {};
            const bp = new Peer(peerId, peerCfg);
            bp.on('error', () => {});
            bp.on('connection', () => { if (!this.isHost) this._becomeNewHost(); });
            this._backupPeer = bp;
        } catch (e) {}
    }

    _cleanupBackupPeer() {
        if (this._backupPeer) {
            try { this._backupPeer.destroy(); } catch (e) {}
            this._backupPeer = null;
        }
    }

    // ============================================================
    // === 호스트 소실 감지 → 선거 → 인계 ===
    // ============================================================

    _onHostSilent() {
        if (this._inElection) return;
        this._inElection = true;
        if (this._backupRank === null) {
            showToast('방장 연결이 끊겼습니다. 새 방장을 찾는 중…', 'info', 4000);
            this._tryConnectToNewHost(1);
            return;
        }
        const delay = (this._backupRank - 1) * CFG.ELECTION_STEP_MS;
        showToast(delay === 0
            ? '방장 연결이 끊겼습니다 — 즉시 방장 역할을 이어받습니다.'
            : `방장 연결이 끊겼습니다 — ${delay / 1000}초 후 방장 역할을 자동으로 이어받습니다.`, 'info', delay + 2500);
        this._electionTimer = setTimeout(() => {
            this._electionTimer = null;
            this._becomeNewHost();
        }, delay);
    }

    async _becomeNewHost() {
        if (this.isHost || !this._backupContent) return;
        showToast('방장 역할을 이어받는 중…', 'info', 2000);
        try { this.transport && this.transport.close(); } catch (e) {}
        this.transport = null; this.mode = null;
        this._removeEditorWatchers();
        this._uninstallSelectionTracking();
        this._awarenessRenderer.unmount();
        this._stopHeartbeatWatchdog();
        this.isHost = true;
        try { this.editor.editor.innerHTML = this._backupContent.content; } catch (e) {}
        try {
            const transport = new P2PTransport(this);
            transport._forcePeerId = `t2c_${this.collabCode}${CFG.BACKUP_ID_SFX}${this._backupRank}`;
            this.transport = transport;
            this._wireTransport();
            await transport.start();
            this.mode = 'p2p';
            this.transport.send({
                t: CFG.MSG_TYPES.TAKE_HOST,
                p: { newHostClientId: this.client_id,
                     newHostPeerId: transport._forcePeerId,
                     nickname: this.nickname, ts: Date.now() },
                from: this.client_id, ts: Date.now()
            });
            this._installEditorWatchers();
            this._awarenessRenderer.mount();
            this._installSelectionTracking();
            this._startHostHeartbeat();
            this.baseContent    = this._backupContent.content;
            this.baseDOMState   = this._backupContent.domState;
            this.lastSentHash   = fastHash(normalizeHTML(this.baseContent));
            this._backupRank    = null;
            this._cleanupBackupPeer();
            this._refreshAllModalBadges();
            showToast('방장 역할 이어받기 완료. 방이 유지됩니다.', 'success', 4000);
        } catch (err) {
            console.error('[Collab] 호스트 인계 실패:', err);
            this.isHost = false; this._inElection = false;
            showToast('방장 역할 이어받기 실패. 재연결 시도 중…', 'error');
            this._handleP2PFailure();
        }
    }

    _handleTakeHost(msg) {
        if (this.isHost) return;
        const p = msg && msg.p;
        if (!p || !p.newHostPeerId) return;
        showToast(`${p.nickname || '참가자'}님이 방장 역할을 이어받았습니다. 재연결 중…`, 'info', 4000);
        this._inElection = false;
        if (this._electionTimer) { clearTimeout(this._electionTimer); this._electionTimer = null; }
        setTimeout(() => {
            if (this._lastConnParams) this._lastConnParams.forcePeerId = p.newHostPeerId;
            this._handleP2PFailure();
        }, 800);
    }

    async _tryConnectToNewHost(rank) {
        if (rank > CFG.BACKUP_COUNT) {
            showToast('백업 방장을 찾지 못했습니다. 잠시 후 다시 시도합니다.', 'error', 5000);
            setTimeout(() => { this._inElection = false; this._handleP2PFailure(); }, 4000);
            return;
        }
        const known = this._backupPeerIds.find(b => b.rank === rank);
        const peerId = known
            ? known.peerId
            : `t2c_${this.collabCode}${CFG.BACKUP_ID_SFX}${rank}`;
        if (this._lastConnParams) this._lastConnParams.forcePeerId = peerId;
        this._reconnectAttempts = 0;
        try {
            await this._attemptReconnect(this._lastConnParams);
        } catch (e) {
            setTimeout(() => this._tryConnectToNewHost(rank + 1), 2500);
        }
    }

    // ============================================================
    // === 문서 캐시 (localStorage) ===
    // ============================================================

    _saveDocToCache(content, domState) {
        if (!this.collabCode || !content) return;
        try {
            localStorage.setItem(CFG.DOC_CACHE_PFX + this.collabCode,
                JSON.stringify({ content, domState: domState || {}, ts: Date.now() }));
        } catch (e) {}
    }

    _loadDocFromCache() {
        if (!this.collabCode) return null;
        try {
            const raw = localStorage.getItem(CFG.DOC_CACHE_PFX + this.collabCode);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || Date.now() - data.ts > CFG.DOC_CACHE_TTL_MS) {
                localStorage.removeItem(CFG.DOC_CACHE_PFX + this.collabCode);
                return null;
            }
            return data;
        } catch (e) { return null; }
    }

    _clearDocCache() {
        try { localStorage.removeItem(CFG.DOC_CACHE_PFX + (this.collabCode || '')); } catch (e) {}
    }

    _copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
                return;
            }
        } catch (e) {}
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }

    // === 협업 시작 ===
    async _startCollab() {
        if (this.forcePhpMode) return this._startPhpMode();

        // 안정성 향상 모드(호스트): P2P 시도와 별개로 PHP 백업 방을 등록.
        // 실패해도 P2P 연결 자체는 (강화된 ICE/브로커 설정으로) 계속 진행한다.
        if (this.isHost && this.stabilityMode && this.t2url && !this._hybridSync) {
            this._hybridSync = new HybridSyncChannel(this);
            try { await this._hybridSync.start(); } catch (e) {}
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                this.transport = new P2PTransport(this);
                this._wireTransport();
                await this.transport.start();
                this.mode = 'p2p';
                console.log('[Collab] connected via P2P');
                this._postConnectInit();
                return true;
            } catch (e) {
                console.warn('[Collab] P2P attempt', attempt + 1, 'failed:', e && e.message);
                try { this.transport && this.transport.close(); } catch (_) {}
                this.transport = null;
                if (this.isHost && e && e.message === 'p2p_id_taken' && attempt === 0) {
                    this.collabCode = this._generateRoomCode();
                    if (this.stabilityMode && this.t2url) {
                        if (this._hybridSync) { try { this._hybridSync.close(); } catch (_) {} }
                        this._hybridSync = new HybridSyncChannel(this);
                        try { await this._hybridSync.start(); } catch (e2) {}
                    }
                    continue;
                }
                break;
            }
        }

        if (!this.t2url) {
            console.error('[Collab] PHP fallback unavailable: t2url not set');
            return false;
        }
        return this._startPhpMode();
    }

    async _startPhpMode() {
        // PHP 단독 모드로 전환 시, 안정성 향상 모드의 백업 동기화 타이머는
        // PhpTransport 의 자체 폴링/전송으로 대체되므로 정리한다.
        if (this._hybridSync) { try { this._hybridSync.close(); } catch (e) {} this._hybridSync = null; }
        try {
            this.transport = new PhpTransport(this);
            this._wireTransport();
            await this.transport.start();
            this.mode = 'php';
            console.log('[Collab] connected via PHP fallback');
            this._postConnectInit();
            return true;
        } catch (e) {
            console.error('[Collab] PHP fallback failed:', e);
            try { this.transport && this.transport.close(); } catch (_) {}
            this.transport = null;
            return false;
        }
    }

    _postConnectInit() {
        this._installEditorWatchers();
        if (this.isHost) {
            this._installHostUnloadHandler();
            this.baseContent = this.editor.editor.innerHTML;
            this.baseDOMState = extractDOMState(this.baseContent);
            this.lastSentHash = fastHash(normalizeHTML(this.baseContent));
        }
        this._awarenessRenderer.mount();
        if (this.mode === 'p2p') this._installSelectionTracking();

        // 자리비움 감지기 설치
        this._installActivityDetector();
        // 연결 직후 상태 broadcast
        setTimeout(() => this._broadcastStatus(), 800);

        // 재연결 파라미터 저장
        this._lastConnParams = {
            code: this.collabCode, nick: this.nickname,
            isHost: this.isHost, forcePhp: this.forcePhpMode
        };
        this._reconnectAttempts = 0;

        // [v3.1.0] 무결성 체인 · 분산 저장소 초기화
        this._initBlockChainAndStore();

        // 문서 캐시 복원 (게스트만: 호스트는 원본이 에디터에 있음)
        if (!this.isHost) {
            const docCache = this._loadDocFromCache();
            if (docCache && docCache.content) {
                this._docRestored = true;
                this._applyRemoteContent(docCache.content, docCache.domState || {});
                showToast('이전 문서를 복원했습니다. 호스트와 동기화 중…', 'info', 3000);
            }
        }

        // 채팅 캐시 복원
        const cached = this._loadChatFromCache();
        if (cached.length > 0) this._chatMessages = cached;

        // [v2.5.0] 리액션 캐시 복원 — 페이지 새로고침 후에도 리액션 유지
        this._loadReactionsFromCache();
        const fullStateCache = this._loadFullStateFromCache();
        if (fullStateCache) {
            // 원격 상태 복원
            if (fullStateCache.statuses && typeof fullStateCache.statuses === 'object') {
                for (const [cid, status] of Object.entries(fullStateCache.statuses)) {
                    if (cid !== this.client_id) this._remoteStatuses.set(cid, status);
                }
            }
        }

        // 큐잉된 메시지 drain
        if (this._pendingMsgs.length > 0) {
            const pending = this._pendingMsgs.splice(0);
            pending.forEach(m => { try { this.transport.send(m); } catch (e) {} });
        }

        // Failover 초기화
        if (this.isHost) {
            // 호스트: transport._users에서 즉시 users 배열 초기화
            this._refreshUsersList(this._modalOverlay);
            this._startHostHeartbeat();
            // [v2.1.4] 호스트는 USERS 메시지를 수신하지 않으므로 직접 초기화
            this._usersInitialized = true;
            // [v2.5.0] 참가자 간 공유 캐시: 주기적 전체 상태 브로드캐스트 시작
            this._startStateSyncBroadcast();
            // [v3.1.0] 블록 체인 동기화 브로드캐스트 시작
            this._startBlockSyncBroadcast();
        } else {
            this._startHeartbeatWatchdog();
        }

        showToast(this.isHost ? '협업 방을 시작했습니다.' : '협업 방에 참여했습니다.', 'success');

        // 안정성 향상 모드 UI 반영 (P2P 채팅·DM 지원, 상태 표시 유지)
        this._applyStabilityModeUI();
    }

    // ============================================================
    // === 안정성 향상 모드 (Stability Mode) ===
    // ============================================================

    // 게스트: 호스트로부터 안정성 향상 모드 설정을 1회 상속받아 적용.
    _enableStabilityMode() {
        if (this.stabilityMode) return;
        this.stabilityMode = true;
        // [FIX v2.3.0] 안정성 향상 모드에서도 채팅/DM이 P2P 채널로 지원됨을 안내
        showToast('이 방은 "안정성 향상 모드"입니다. 채팅·DM은 P2P 채널로 전송되며, 자리비움/바쁨 상태 표시도 계속 사용할 수 있습니다.', 'info', 5000);
        if (!this._hybridSync && this.t2url) {
            this._hybridSync = new HybridSyncChannel(this);
            this._hybridSync.start().catch(() => {});
        }
        this._refreshAllModalBadges();
        this._applyStabilityModeUI();
    }

    // [v2.2.0] 안정성 향상 모드에서도 채팅 지원 → UI 제한 해제
    // 자리비움·바쁨 등 상태 표시 기능은 계속 영향받지 않음
    _applyStabilityModeUI(overlay) {
        const ov = overlay || this._modalOverlay;
        if (!ov) return;
        ov.classList.toggle('t2c-stability-active', !!this.stabilityMode);
        // [v2.2.0] 채팅 탭 강제 전환 로직 제거 — P2P 채널로 채팅 전송 가능
    }

    _wireTransport() {
        this.transport.onMessage((msg) => this._handleIncoming(msg));
    }

    // === 메시지 수신 ===
    _handleIncoming(msg) {
        if (!msg || typeof msg !== 'object') return;
        const T = CFG.MSG_TYPES;

        if (msg.t === T.FULL) {
            // 호스트 경우: 잠긴 참가자가 보낸 FULL 은 무시 (방어시)
            if (this.isHost && msg.from && this._isUserLocked(msg.from)) {
                console.warn('[Collab] dropped FULL from locked user', msg.from);
                return;
            }
            const content = msg.p && msg.p.content;
            const dom = (msg.p && msg.p.domState) || {};
            // 안정성 향상 모드는 호스트가 방 생성 시 1회 설정 → 게스트는
            // 호스트의 FULL 메시지를 통해 자동으로 상속받는다.
            if (!this.isHost && msg.p && msg.p.stabilityMode && !this.stabilityMode) {
                this._enableStabilityMode();
            }
            if (!isValidContent(content)) return;
            const h = fastHash(normalizeHTML(content));
            if (h === this.lastSentHash) return;
            this._applyRemoteContent(content, dom);
            this.lastSentHash = h;
            // 수신된 FULL을 로컬 캐시에 저장 (재연결 복구용)
            this._saveDocToCache(content, dom);
            this._docRestored = false;
        } else if (msg.t === T.AWARENESS) {
            const p = msg.p || {};
            // 자기 자신 echo 방지
            if (p.client_id === this.client_id || msg.from === this.client_id) return;
            const user = this.users.find(u => u.client_id === p.client_id);
            const hue = typeof p.color_hue === 'number' ? p.color_hue : (user && user.color_hue);
            const nickname = (user && user.nickname) || p.nickname || '익명';
            if (!p.sel) {
                this._awarenessRenderer.removeCursor(p.client_id);
            } else {
                const color = (typeof hue === 'number') ? {
                    primary: `hsl(${hue} 75% 52%)`,
                    soft:    `hsl(${hue} 75% 52% / 0.18)`,
                    ring:    `hsl(${hue} 75% 52% / 0.35)`
                } : { primary: '#0187fe', soft: 'rgba(1,135,254,0.18)', ring: 'rgba(1,135,254,0.35)' };
                this._awarenessRenderer.updateCursor({
                    client_id: p.client_id,
                    nickname,
                    color,
                    sel: p.sel
                });
            }
        } else if (msg.t === T.USERS) {
            // 게스트: 서버/호스트가 보낸 목록으로 갱신
            // 호스트: _broadcastUsers 가 자신의 _users Map 에서 만든 목록 수신 → 동일하므로 갱신
            if (Array.isArray(msg.p)) {
                const incoming = msg.p;
                const incomingIds = new Set(incoming.map(u => u.client_id));
                // [v2.1.4] 새 참가자 감지: 기존 목록에 없던 사용자가 추가되면 입장 알림
                // 단, 최초 연결 시에는 알림 스킵 (기존 참가자 전원에 대해 토스트 뜨는 것 방지)
                if (this._usersInitialized) {
                    const prevIds = new Set((this.users || []).map(u => u.client_id));
                    const newUsers = incoming.filter(u => !prevIds.has(u.client_id));
                    for (const nu of newUsers) {
                        if (nu.client_id !== this.client_id && nu.nickname) {
                            showToast(`${nu.nickname}님이 참가했습니다.`, 'info', 2500);
                        }
                    }
                    // [v2.1.4] 퇴장 감지: 목록에서 사라진 사용자가 있으면 퇴장 알림
                    const leftUsers = (this.users || []).filter(u => !incomingIds.has(u.client_id) && u.client_id !== this.client_id);
                    for (const lu of leftUsers) {
                        if (lu.nickname) {
                            showToast(`${lu.nickname}님이 나갔습니다.`, 'info', 2500);
                        }
                    }
                }
                this._usersInitialized = true;
                this.users = incoming;
            } else {
                this.users = [];
            }
            this._refreshUsersList(this._modalOverlay);
        } else if (msg.t === T.KICK) {
            showToast('방장에 의해 강퇴되었습니다.', 'error', 4000);
            this._leave().then(() => { try { window.location.reload(); } catch (e) {} });
        } else if (msg.t === T.ROOM_STOP) {
            // [FIX v2.1.3] 호스트가 방을 종료함 → 게스트에게 토스트 알림 후 재연결 없이 종료
            console.log('[Collab] host stopped the room');
            // P2P transport의 _hostStopped 플래그 설정 (close 이벤트에서 재연결 방지)
            if (this.transport && this.transport._hostStopped !== undefined) {
                this.transport._hostStopped = true;
            }
            // 중복 cleanup 방지: 이미 cleanup 된 상태면 무시
            if (!this.transport && !this.mode) return;
            showToast('방장이 협업을 종료했습니다.', 'error', 5000);
            this._cleanup();
            this._closeModal();
        } else if (msg.t === '__host_stopped__') {
            // [FIX v2.1.3] P2P 연결이 끊어졌는데 _hostStopped 플래그가 설정된 경우
            // 재연결을 시도하지 않고 깔끔하게 종료
            console.log('[Collab] connection closed because host stopped the room');
            // 중복 cleanup 방지: 이미 cleanup 된 상태면 무시
            if (!this.transport && !this.mode) return;
            showToast('방장이 협업을 종료했습니다.', 'error', 5000);
            this._cleanup();
            this._closeModal();
        } else if (msg.t === '__disconnected__') {
            console.warn('[Collab] disconnected from host');
            // [v3.1.0] 오프라인 상태 활성화
            this._isOffline = true;
            this._updateOfflineUI();
            this._handleP2PFailure();
        } else if (msg.t === '__peer_joined__') {
            // [v2.1.4] P2P: 호스트가 새 게스트의 참가를 감지
            const p = msg.p || {};
            if (p.nickname) {
                showToast(`${p.nickname}님이 참가했습니다.`, 'info', 2500);
            }
        } else if (msg.t === '__peer_left__') {
            const leftCid = msg.p && msg.p.client_id;
            if (leftCid) {
                const leftUser = this.users.find(u => u.client_id === leftCid);
                this._awarenessRenderer.removeCursor(leftCid);
                // users 배열에서도 제거 후 UI 갱신
                this.users = (this.users || []).filter(u => u.client_id !== leftCid);
                this._remoteStatuses.delete(leftCid);
                this._dmUnread.delete(leftCid);
                if (this._userLocks instanceof Set) this._userLocks.delete(leftCid);
                this._updateUsersListUI(this._modalOverlay);
                // [v2.1.4] 참가자 퇴장 알림
                if (leftUser && leftUser.nickname) {
                    showToast(`${leftUser.nickname}님이 나갔습니다.`, 'info', 2500);
                }
            }
        } else if (msg.t === '__latency__') {
            this.latency = msg.p || 0;
            this._refreshAllModalBadges();
        } else if (msg.t === '__error__') {
            console.warn('[Collab] transport error event');
        } else if (msg.t === T.CHAT) {
            this._handleChatMsg(msg);
        } else if (msg.t === T.FILE_META) {
            this._handleFileMeta(msg);
        } else if (msg.t === T.FILE_CHUNK) {
            this._handleFileChunk(msg);
        } else if (msg.t === T.TYPING) {
            this._handleRemoteTyping(msg);
        } else if (msg.t === T.LOCK) {
            this._handleLock(msg);
        } else if (msg.t === T.USER_LOCK) {
            this._handleUserLock(msg);
        } else if (msg.t === T.STATUS) {
            this._handleStatusMsg(msg);
        } else if (msg.t === T.REACT) {
            this._handleReact(msg);
        } else if (msg.t === T.READ) {
            this._handleRead(msg);
        } else if (msg.t === T.HB) {
            this._handleHeartbeat(msg);
        } else if (msg.t === T.BACKUP) {
            this._handleBackup(msg);
        } else if (msg.t === T.TAKE_HOST) {
            this._handleTakeHost(msg);
        } else if (msg.t === T.STATE_SYNC) {
            // [v2.5.0] 참가자 간 공유 캐시: 전체 상태 동기화 수신
            this._handleStateSync(msg);
        } else if (msg.t === T.BLOCK_SYNC) {
            // [v3.1.0] 블록 체인 동기화 수신
            this._handleBlockSync(msg);
        } else if (msg.t === T.CHUNK_REQ) {
            // [v3.1.0] 콘텐츠 청크 요청 수신
            this._handleChunkReq(msg);
        } else if (msg.t === T.CHUNK_RES) {
            // [v3.1.0] 콘텐츠 청크 응답 수신
            this._handleChunkRes(msg);
        }
    }

    _applyRemoteContent(content, domState) {
        this._applying = true;
        const html = applyDOMState(content, domState);
        try {
            this.editor.setContent(html);
            setTimeout(() => {
                if (this.editor.plugins) {
                    for (const [name, plugin] of this.editor.plugins) {
                        if (plugin.onContentSet) try { plugin.onContentSet(html); } catch (e) {}
                    }
                }
            }, 50);
        } finally {
            this._lastApplyTs = Date.now();
            setTimeout(() => { this._applying = false; }, 200);
        }
        this.baseContent = content;
        this.baseDOMState = domState || {};
        // 콘텐츠 변경 시 caret layer 재정렬은 MutationObserver 가 자동 호출
    }

    _buildFullMessage() {
        const html = this.editor.editor.innerHTML;
        return {
            t: CFG.MSG_TYPES.FULL,
            p: { content: html, domState: extractDOMState(html), stabilityMode: !!this.stabilityMode },
            from: this.client_id,
            ts: Date.now()
        };
    }

    _buildAwarenessMessage(force = false) {
        const sel = captureSelection(this.editor.editor);
        // selection 변경이 없으면 굳이 보내지 않음 (force 제외)
        if (!force) {
            const last = this._lastSentAwareness;
            if (sel === null && last === null) return null;
            if (sel && last && last.sp.join(',') === sel.sp.join(',') &&
                last.so === sel.so && last.eo === sel.eo && last.collapsed === sel.collapsed &&
                last.ep.join(',') === sel.ep.join(',')) {
                return null;
            }
        }
        this._lastSentAwareness = sel;
        return {
            t: CFG.MSG_TYPES.AWARENESS,
            p: {
                client_id: this.client_id,
                nickname: this.nickname || '익명',
                color_hue: this.userColor.hue,
                sel
            },
            from: this.client_id,
            ts: Date.now()
        };
    }

    _handleP2PFailure() {
        if (this.mode !== 'p2p') return;
        // [FIX v2.1.3] 호스트가 의도적으로 종료한 경우 재연결 시도하지 않음
        if (this.transport && this.transport._hostStopped) return;
        const params = this._lastConnParams;

        // 게스트이고 재연결 시도 횟수가 남아있으면 P2P 재연결 시도
        if (params && !params.isHost && this._reconnectAttempts < CFG.RECONNECT_MAX_TRIES) {
            const attempt = this._reconnectAttempts++;
            const delay = Math.min(CFG.RECONNECT_BASE_MS * (2 ** attempt), CFG.RECONNECT_MAX_MS);
            const delaySec = Math.round(delay / 1000);
            showToast(`연결이 끊겼습니다. ${delaySec}초 후 재연결 시도 중… (${attempt + 1}/${CFG.RECONNECT_MAX_TRIES})`, 'info', delay);

            try { this.transport && this.transport.close(); } catch (e) {}
            this.transport = null;
            this.mode = null;
            this._removeEditorWatchers();
            this._uninstallSelectionTracking();
            this._awarenessRenderer.unmount();
            // [v2.1.4] 재연결 시 _usersInitialized 리셋
            // 재연결 성공 후 첫 USERS 메시지에서 중복 알림 방지
            this._usersInitialized = false;

            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this._attemptReconnect(params);
            }, delay);
            return;
        }

        // 재연결 소진 → PHP fallback
        console.log('[Collab] P2P 재연결 소진 → PHP fallback');
        try { this.transport && this.transport.close(); } catch (e) {}
        this.transport = null;
        this.mode = null;
        this._uninstallSelectionTracking();
        this._awarenessRenderer.unmount();
        showToast('P2P 연결이 끊겨 서버 경유 모드로 전환합니다.', 'info');
        this._startPhpMode().then(() => { this._refreshAllModalBadges(); });
    }

    async _attemptReconnect(params) {
        if (!params || !params.code) return;
        // 재연결 시 현재 상태 복원
        this.collabCode = params.code;
        this.nickname = params.nick;
        this.isHost = params.isHost;
        this.forcePhpMode = params.forcePhp;
        try {
            const transport = new P2PTransport(this);
            this._wireTransport();
            this.transport = transport;
            await transport.start();
            this.mode = 'p2p';
            this._reconnectAttempts = 0;
            this._installEditorWatchers();
            this._awarenessRenderer.mount();
            this._installSelectionTracking();
            this._refreshAllModalBadges();
            showToast('재연결되었습니다.', 'success', 2500);
        } catch (e) {
            console.warn('[Collab] 재연결 실패:', e);
            // 다시 _handleP2PFailure 로 위임
            this.mode = 'p2p'; // temporarily set to trigger the retry logic
            this._handleP2PFailure();
        }
    }

    // === 변경 감지 → 전송 ===
    _installEditorWatchers() {
        if (this._inputHandler) return;
        const ed = this.editor.editor;
        this._inputHandler = () => this._debounceSend();
        ed.addEventListener('input', this._inputHandler);

        this._mutationObserver = new MutationObserver((mutations) => {
            if (this._applying) return;
            const hasRelevant = mutations.some(m => {
                if (m.type === 'childList' &&
                    (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                    // 커서 레이어 자체의 변화는 무시 (무한 루프 방지)
                    if (m.target && m.target.classList &&
                        m.target.classList.contains('t2-collab-cursor-layer')) return false;
                    return true;
                }
                if (m.type === 'attributes') return true;
                return false;
            });
            if (hasRelevant) this._debounceSend();
        });
        this._mutationObserver.observe(ed, {
            childList: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'src', 'href', 'data-block-id', 'data-table-id'],
            subtree: true
        });
    }

    _removeEditorWatchers() {
        if (this._inputHandler) {
            this.editor.editor.removeEventListener('input', this._inputHandler);
            this._inputHandler = null;
        }
        if (this._mutationObserver) { this._mutationObserver.disconnect(); this._mutationObserver = null; }
        if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
    }

    _debounceSend() {
        if (this._applying) return;
        if (Date.now() - this._lastApplyTs < 250) return;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._sendLocalChange(), CFG.DEBOUNCE_MS);
    }

    _sendLocalChange() {
        if (!this.transport || !this.mode) return;
        // 개인 잠금 또는 전체 잠금 상태라면 로컬 변경 전송 안 함 (호스트 제외)
        if (!this.isHost && (this._isLocked || this._lockedByHost)) return;
        const html = this.editor.editor.innerHTML;
        if (!isValidContent(html)) return;
        const norm = normalizeHTML(html);
        const h = fastHash(norm);
        if (h === this.lastSentHash) return;
        const baseNorm = normalizeHTML(this.baseContent);
        if (norm === baseNorm) { this.lastSentHash = h; return; }
        const msg = this._buildFullMessage();
        const sent = this.transport.send(msg);
        if (sent !== false) {
            this.baseContent = html;
            this.baseDOMState = msg.p.domState;
            this.lastSentHash = h;
        }
    }

    // === Awareness (커서) 추적 ===
    _installSelectionTracking() {
        if (this._selectionChangeHandler) return;
        const sendAwareness = () => {
            if (!this.transport || this.mode !== 'p2p') return;
            const now = Date.now();
            const dt = now - this._awarenessThrottleTs;
            if (dt < CFG.AWARENESS_THROTTLE_MS) {
                clearTimeout(this._awarenessPendingTimer);
                this._awarenessPendingTimer = setTimeout(sendAwareness, CFG.AWARENESS_THROTTLE_MS - dt);
                return;
            }
            this._awarenessThrottleTs = now;
            const msg = this._buildAwarenessMessage(false);
            if (msg) this.transport.send(msg);
        };
        this._selectionChangeHandler = () => {
            // selection 이 에디터 내부에 있을 때만
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const r = sel.getRangeAt(0);
            if (!this.editor.editor.contains(r.startContainer)) return;
            sendAwareness();
        };
        document.addEventListener('selectionchange', this._selectionChangeHandler);

        // 키/포인터 이벤트도 awareness 즉시 트리거
        this._kbdAwarenessHandler = () => sendAwareness();
        this.editor.editor.addEventListener('keyup', this._kbdAwarenessHandler);
        this.editor.editor.addEventListener('mouseup', this._kbdAwarenessHandler);
        this.editor.editor.addEventListener('touchend', this._kbdAwarenessHandler);
        this.editor.editor.addEventListener('focus', this._kbdAwarenessHandler, true);
    }
    _uninstallSelectionTracking() {
        if (this._selectionChangeHandler) {
            document.removeEventListener('selectionchange', this._selectionChangeHandler);
            this._selectionChangeHandler = null;
        }
        if (this._kbdAwarenessHandler) {
            try {
                this.editor.editor.removeEventListener('keyup', this._kbdAwarenessHandler);
                this.editor.editor.removeEventListener('mouseup', this._kbdAwarenessHandler);
                this.editor.editor.removeEventListener('touchend', this._kbdAwarenessHandler);
                this.editor.editor.removeEventListener('focus', this._kbdAwarenessHandler, true);
            } catch (e) {}
            this._kbdAwarenessHandler = null;
        }
        clearTimeout(this._awarenessPendingTimer);
    }

    // === 따라가기 ===
    _followUser(cid) {
        const data = this._awarenessRenderer.byCid.get(cid);
        if (!data) {
            showToast('상대방의 위치를 알 수 없습니다.', 'info');
            return;
        }
        const out = selectionToRects(this.editor.editor, data.sel);
        if (!out || !out.caretRect) return;
        // viewport 중앙으로 스크롤
        const target = out.caretRect.top + window.pageYOffset - (window.innerHeight / 2);
        window.scrollTo({ top: target, behavior: 'smooth' });
        // 잠깐 강조
        if (data._caretEl) {
            data._caretEl.classList.add('is-pulse');
            setTimeout(() => data._caretEl && data._caretEl.classList.remove('is-pulse'), 1600);
        }
    }

    // === 사용자 목록 ===
    _refreshUsersList(overlay) {
        // P2P: 호스트만 transport._users 를 정본으로 사용
        // 게스트의 transport._users 는 항상 빈 Map이므로,
        // 호스트가 보낸 USERS 메시지로 세팅된 this.users 를 그대로 사용해야 함
        if (this.mode === 'p2p' && this.isHost && this.transport && this.transport._users) {
            this.users = [];
            for (const u of this.transport._users.values()) {
                this.users.push({
                    client_id: u.client_id,
                    nickname:  u.nickname,
                    isHost:    u.isHost,
                    color_hue: u.color_hue
                });
            }
        }
        this._updateUsersListUI(overlay || this._modalOverlay);
    }

    _updateUsersListUI(overlay) {
        const root = overlay || this._modalOverlay;
        const container = (root && root.querySelector('.t2-collab-users-list'))
            || document.querySelector('.t2-collab-users-list');
        if (!container) return;
        // [v2.1.4] 새 참가자 하이라이트: 기존 목록 대비 새로 추가된 client_id 감지
        const prevIds = new Set(Array.from(container.children).map(li => li.dataset && li.dataset.userCid).filter(Boolean));
        container.innerHTML = '';
        (this.users || []).forEach(u => {
            const li = document.createElement('li');
            li.className = 't2-collab-user-item';
            li.dataset.userCid = u.client_id;
            // [v2.1.4] 기존에 없던 참가자면 하이라이트 애니메이션
            if (prevIds.size > 0 && !prevIds.has(u.client_id) && u.client_id !== this.client_id) {
                li.classList.add('t2c-user-enter');
                li.addEventListener('animationend', () => li.classList.remove('t2c-user-enter'), { once: true });
            }
            const hue = (typeof u.color_hue === 'number') ? u.color_hue : pickUserColor(u.client_id + ':' + this.collabCode).hue;
            const isMe = u.client_id === this.client_id;

            // 아바타 + 상태 점
            const avatarWrap = document.createElement('span');
            avatarWrap.className = 't2c-avatar-wrap';
            const dot = document.createElement('span');
            dot.className = 't2-collab-user-dot';
            dot.style.background = `hsl(${hue} 75% 52%)`;
            avatarWrap.appendChild(dot);
            const status = isMe ? this._myStatus : (this._remoteStatuses.get(u.client_id) || 'online');
            const pDot = document.createElement('span');
            pDot.className = `t2c-presence-dot t2c-s-${status}`;
            pDot.title = CFG.STATUS_LABELS[status] || '온라인';
            avatarWrap.appendChild(pDot);
            li.appendChild(avatarWrap);

            const name = document.createElement('span');
            name.className = 't2-collab-user-name';
            name.textContent = u.nickname || '(익명)';
            if (status === 'away') name.style.opacity = '0.55';
            li.appendChild(name);

            const badges = document.createElement('span');
            badges.className = 't2-collab-user-badges';
            if (isMe) {
                const b = document.createElement('span');
                b.className = 't2-collab-badge t2-collab-badge-me';
                b.textContent = '나';
                badges.appendChild(b);
            }
            if (u.isHost) {
                const b = document.createElement('span');
                b.className = 't2-collab-badge t2-collab-badge-host';
                b.textContent = '방장';
                badges.appendChild(b);
            }
            if (status === 'busy') {
                const b = document.createElement('span');
                b.className = 't2-collab-badge t2c-badge-busy';
                b.textContent = '바쁨';
                badges.appendChild(b);
            }
            if (status === 'dnd') {
                const b = document.createElement('span');
                b.className = 't2-collab-badge t2c-badge-dnd';
                b.textContent = '방해 금지';
                badges.appendChild(b);
            }
            li.appendChild(badges);

            const actions = document.createElement('span');
            actions.className = 't2-collab-user-actions';
            if (!isMe && this.mode === 'p2p') {
                const fb = document.createElement('button');
                fb.type = 'button';
                fb.className = 't2-collab-icon-btn';
                fb.title = '위치 따라가기';
                fb.setAttribute('data-collab-action', 'follow');
                fb.setAttribute('data-clientid', u.client_id);
                fb.innerHTML = '<span class="material-icons">my_location</span>';
                actions.appendChild(fb);
                const dmb = document.createElement('button');
                dmb.type = 'button';
                dmb.className = 't2-collab-icon-btn t2c-user-dm-btn';
                dmb.title = '1:1 DM';
                dmb.setAttribute('data-collab-action', 'dm');
                dmb.setAttribute('data-clientid', u.client_id);
                const dmUnread = this._dmUnread.get(u.client_id) || 0;
                dmb.innerHTML = `<span class="material-icons">chat</span>${dmUnread > 0 ? `<span class="t2c-dm-user-badge">${dmUnread > 9 ? '9+' : dmUnread}</span>` : ''}`;
                actions.appendChild(dmb);
            }
            if (this.isHost && !u.isHost && !isMe) {
                // 개인 편집 잠금 버튼 (방장 전용)
                const locked = this._isUserLocked(u.client_id);
                const lb = document.createElement('button');
                lb.type = 'button';
                lb.className = 't2-collab-icon-btn t2c-user-lock-btn' + (locked ? ' is-locked' : '');
                lb.title = locked ? '편집 잠금 해제' : '이 참가자의 편집 잠금';
                lb.setAttribute('data-collab-action', 'userlock');
                lb.setAttribute('data-clientid', u.client_id);
                lb.innerHTML = `<span class="material-icons">${locked ? 'lock' : 'lock_open'}</span>`;
                actions.appendChild(lb);

                const kb = document.createElement('button');
                kb.type = 'button';
                kb.className = 't2-collab-icon-btn t2-collab-icon-btn-danger';
                kb.title = '강퇴';
                kb.setAttribute('data-collab-action', 'kick');
                kb.setAttribute('data-clientid', u.client_id);
                kb.innerHTML = '<span class="material-icons">person_remove</span>';
                actions.appendChild(kb);
            }
            // 다른 참가자도 "이 사용자는 호스트에 의해 편집 잠금됨" 뱃지 표시
            if (!isMe && this._isUserLocked(u.client_id)) {
                const lbadge = document.createElement('span');
                lbadge.className = 't2-collab-badge t2c-badge-userlock';
                lbadge.innerHTML = '<span class="material-icons" aria-hidden="true">lock</span>잠김';
                lbadge.title = '방장이 편집을 잠갔습니다';
                badges.appendChild(lbadge);
            }
            if (isMe && this._lockedByHost) {
                const lbadge = document.createElement('span');
                lbadge.className = 't2-collab-badge t2c-badge-userlock';
                lbadge.innerHTML = '<span class="material-icons" aria-hidden="true">lock</span>잠김';
                lbadge.title = '방장이 편집을 잠갔습니다';
                badges.appendChild(lbadge);
            }
            li.appendChild(actions);
            container.appendChild(li);
        });
        if (!this.users || this.users.length === 0) {
            const empty = document.createElement('li');
            empty.className = 't2-collab-user-empty';
            empty.textContent = '대기 중…';
            container.appendChild(empty);
        }
        // [v2.1.4] 참가자 수 배지 업데이트 (root는 이미 함수 상단에서 선언됨)
        const countBadge = root && root.querySelector('.t2c-participant-count');
        if (countBadge) {
            const count = (this.users || []).length;
            countBadge.textContent = count;
            countBadge.style.display = count > 0 ? '' : 'none';
        }
        // [v2.1.4] 모바일 스크롤 힌트: 처음 한 번만 바운스 애니메이션
        if (container && !container._scrollHintShown && (this.users || []).length > 2) {
            container.classList.add('t2c-scroll-hint');
            container._scrollHintShown = true;
            setTimeout(() => container.classList.remove('t2c-scroll-hint'), 2500);
        }
    }

    _refreshModeBadge(overlay) {
        const ov = overlay || this._modalOverlay;
        // [v2.1.4] 모든 mode badge 요소 업데이트 (상태카드 내부 + 컴팩트 바)
        const badges = ov ? ov.querySelectorAll('.t2-collab-mode-badge') : [];
        if (badges.length === 0) return;
        const latencyTxt = this.latency ? ` · ${this.latency}ms` : '';
        let html, cls;
        if (this.mode === 'p2p' && this.stabilityMode) {
            html = `<span class="material-icons">verified</span>안정성 향상 모드 (P2P+백업)${latencyTxt}`;
            cls = 't2-collab-mode-badge t2-collab-mode-stability';
        } else if (this.mode === 'p2p') {
            html = `<span class="material-icons">bolt</span>P2P 직접 연결${latencyTxt}`;
            cls = 't2-collab-mode-badge t2-collab-mode-p2p';
        } else if (this.mode === 'php') {
            html = `<span class="material-icons">cloud</span>서버 경유 (안정 모드)`;
            cls = 't2-collab-mode-badge t2-collab-mode-php';
        } else {
            html = '연결 중…';
            cls = 't2-collab-mode-badge';
        }
        badges.forEach(b => { b.innerHTML = html; b.className = cls; });
    }

    _refreshAllModalBadges() {
        if (this._modalOverlay) this._refreshModeBadge(this._modalOverlay);
    }

    // === 강퇴 / 나가기 ===
    async _kickUser(targetCid) {
        if (!this.isHost) return false;
        if (this.mode === 'p2p') return this.transport.kick(targetCid);
        if (this.mode === 'php') return this.transport.kick(targetCid);
        return false;
    }

    async _leave() {
        try {
            // 마지막 awareness: null (커서 제거 알림)
            if (this.mode === 'p2p' && this.transport) {
                const off = {
                    t: CFG.MSG_TYPES.AWARENESS,
                    p: { client_id: this.client_id, sel: null },
                    from: this.client_id, ts: Date.now()
                };
                try { this.transport.send(off); } catch (e) {}
            }
            if (this.mode === 'php' && this.transport) await this.transport.leave();
        } catch (e) {}
        this._cleanup();
    }

    async _stopRoom() {
        try {
            // [FIX v2.1.3] P2P 모드에서 호스트가 방 종료 시 게스트에게 ROOM_STOP 브로드캐스트
            if (this.mode === 'p2p' && this.transport && this.transport.broadcastRoomStop) {
                this.transport.broadcastRoomStop();
                // 메시지가 전송될 시간을 잠시 대기
                await new Promise(r => setTimeout(r, 300));
            }
            if (this.mode === 'php' && this.transport) await this.transport.stopRoom();
        } catch (e) {}
        this._cleanup();
    }

    _cleanup() {
        try { this.transport && this.transport.close(); } catch (e) {}
        this.transport = null;
        this.mode = null;
        if (this._hybridSync) { try { this._hybridSync.close(); } catch (e) {} this._hybridSync = null; }
        this.stabilityMode = false;
        if (this._modalOverlay) this._modalOverlay.classList.remove('t2c-stability-active');
        this._removeEditorWatchers();
        this._uninstallSelectionTracking();
        this._awarenessRenderer.unmount();
        this._uninstallHostUnloadHandler();
        this.collabCode = null;
        this.nickname = null;
        this.hostToken = null;
        this.isHost = false;
        this.users = [];
        this._usersInitialized = false;
        this.baseContent = '';
        this.baseDOMState = {};
        this.lastSentHash = 0;
        this.latency = 0;
        this._lastSentAwareness = null;
        // 채팅 캐시 저장 후 초기화
        this._saveChatToCache();
        this._chatMessages = [];
        this._chatUnread = 0;
        this._fileTransfers.clear();
        this._outgoingTransfers.clear();
        this._remoteTyping.clear();
        if (this._typingTimer) { clearTimeout(this._typingTimer); this._typingTimer = null; }
        this._isLocked = false;
        this._lockedByHost = false;
        if (this._userLocks instanceof Set) this._userLocks.clear();
        else this._userLocks = new Set();
        this._qrCache = null;
        this._applyLock(false);
        this._dmTarget = null;
        this._dmUnread.clear();
        this._replyTarget = null;
        this._chatSearchQuery = '';
        this._pendingMsgs = [];
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
        this._reconnectAttempts = 0;
        this._lastConnParams = null;
        // Failover 정리
        this._stopHostHeartbeat();
        this._stopHeartbeatWatchdog();
        this._cleanupBackupPeer();
        if (this._electionTimer) { clearTimeout(this._electionTimer); this._electionTimer = null; }
        this._backupRank = null;
        this._backupContent = null;
        this._backupPeerIds = [];
        this._inElection = false;
        this._pingMap.clear();
        this._docRestored = false;
        // 상태/리액션 초기화
        this._uninstallActivityDetector();
        this._myStatus = 'online';
        this._autoAway = false;
        this._remoteStatuses.clear();
        // [v2.5.0] 정리 전 리액션 캐시 저장 (재참여 시 복원 가능)
        this._saveReactionsToCache();
        this._saveFullStateToCache();
        this._reactions.clear();
        this._readBy.clear();
        this._scrollUnread = 0;
        // [v2.5.0] 참가자 간 공유 캐시 동기화 브로드캐스트 정지
        this._stopStateSyncBroadcast();
        // [v3.1.0] 무결성 체인 정리 — 분산 저장소에 백업 후 메모리에서 해제
        this._saveBlockChainToStore();
        this._stopBlockSyncBroadcast();
        this._blockChain = null;
        this._distributedStore = null;
        this._syncingChain = false;
        this._syncProgress = 0;
        this._offlineQueue = [];
        this._isOffline = false;
        this._chainHeight = 0;
    }

    _installHostUnloadHandler() {
        if (this._unloadHandler) return;
        this._unloadHandler = () => {
            if (this.mode === 'php' && this.collabCode && this.hostToken) {
                try {
                    const url = this.t2url + '/plugin/collab/collab_number_delete.php';
                    const payload = JSON.stringify({
                        code: this.collabCode,
                        host_token: this.hostToken,
                        timestamp: Date.now()
                    });
                    if (navigator.sendBeacon) {
                        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
                    } else {
                        fetch(url, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
                    }
                } catch (e) {}
            }
        };
        window.addEventListener('beforeunload', this._unloadHandler);
        window.addEventListener('pagehide', this._unloadHandler);
    }

    // ============================================================
    // === 채팅 시스템 ===
    // ============================================================

    _sendChatMessage(text, overlay) {
        // [v2.2.0] 안정성 향상 모드에서도 P2P 채널로 채팅 지원
        // (PHP 백업은 문서 동기화만 담당, 채팅은 P2P로 전송)
        if (!this.transport || !this.mode) {
            // 오프라인 큐
            showToast('연결이 끊겨 있어 메시지를 전송할 수 없습니다.', 'error', 3000);
            return;
        }
        const isDM = !!this._dmTarget;
        const p = {
            id: uuidv4(),
            from: this.client_id,
            nickname: this.nickname || '나',
            color_hue: this.userColor.hue,
            text: String(text).substring(0, CFG.MAX_CHAT_MSG_LEN),
            ts: Date.now(),
            type: 'text',
            ...(isDM ? { to: this._dmTarget } : {}),
            ...(this._replyTarget ? { replyTo: this._replyTarget } : {})
        };
        const msg = { t: CFG.MSG_TYPES.CHAT, p, from: this.client_id, ts: p.ts, ...(isDM ? { to: this._dmTarget } : {}) };
        this.transport.send(msg);
        this._chatMessages.push(p);
            if (this._chatMessages.length > CFG.CHAT_CACHE_MAX) this._chatMessages = this._chatMessages.slice(-CFG.CHAT_CACHE_MAX);
        this._saveChatToCache();
        const ov = overlay || this._modalOverlay;
        if (this._isMessageVisible(p)) {
            this._appendChatMessage(p, ov);
            this._scrollChatToBottom(ov);
        }
        this._clearReplyTarget(ov);
    }

    _handleChatMsg(msg) {
        const p = msg && msg.p;
        if (!p) return;
        // 파일 메시지(type='file')는 fileMeta 가 있어야 유효, 텍스트는 text 가 있어야 유효
        if (p.type !== 'file' && typeof p.text !== 'string') return;
        const safeP = {
            id: p.id || uuidv4(),
            from: p.from || msg.from || '',
            to: p.to || null,
            nickname: (p.nickname || '익명').substring(0, 50),
            color_hue: (typeof p.color_hue === 'number') ? p.color_hue : 200,
            text: p.text ? p.text.substring(0, CFG.MAX_CHAT_MSG_LEN) : '',
            ts: p.ts || Date.now(),
            type: p.type || 'text',
            fileMeta: p.fileMeta || null,
            replyTo: p.replyTo || p.reply_to || null
        };
        this._chatMessages.push(safeP);
            if (this._chatMessages.length > CFG.CHAT_CACHE_MAX) this._chatMessages = this._chatMessages.slice(-CFG.CHAT_CACHE_MAX);
        this._saveChatToCache();

        const overlay = this._modalOverlay;
        const isInfoOpen = overlay && overlay.isConnected;
        const isChatTabActive = isInfoOpen && overlay.querySelector('.t2c-info-tab[data-infotab="chat"].is-active');

        // DM 여부 판단
        const isDM = !!safeP.to;
        const dmFrom = safeP.from;

        // 현재 뷰에 표시 가능한지 확인
        const shouldShow = this._isMessageVisible(safeP);

        if (shouldShow) {
            this._appendChatMessage(safeP, overlay);
            if (isChatTabActive) this._scrollChatToBottom(overlay);
        }

        // 알림 처리
        if (!isChatTabActive || !shouldShow) {
            if (isDM) {
                // DM 미읽음 배지
                const prev = this._dmUnread.get(dmFrom) || 0;
                this._dmUnread.set(dmFrom, prev + 1);
                this._refreshUsersList(overlay);  // 사용자 목록의 DM 배지 업데이트
                showToast(`💬 DM | ${safeP.nickname}: ${(safeP.text||'').substring(0, 28)}…`, 'info', 4500);
            } else if (!shouldShow) {
                // 그룹 채팅인데 다른 DM 탭 보는 중
                this._chatUnread++;
                this._updateChatBadge(overlay, this._chatUnread);
            } else {
                // 채팅 탭 닫혀있음
                this._chatUnread++;
                this._updateChatBadge(overlay, this._chatUnread);
                const preview = (safeP.text || '').substring(0, 30) + (safeP.text && safeP.text.length > 30 ? '…' : '');
                showToast(`💬 ${safeP.nickname}: ${preview}`, 'info', 4000);
            }
        }
    }

    _appendChatMessage(data, overlay) {
        if (!overlay) return;
        const container = overlay.querySelector('.t2c-chat-msgs');
        if (!container) return;

        // 날짜 구분자 필요 여부
        const msgs = this._getVisibleMessages();
        const lastVisible = msgs.slice(0, -1).reverse().find(m => m.id !== data.id);
        if (lastVisible) {
            const prev = new Date(lastVisible.ts);
            const curr = new Date(data.ts);
            if (prev.getDate() !== curr.getDate() ||
                prev.getMonth() !== curr.getMonth() ||
                prev.getFullYear() !== curr.getFullYear()) {
                container.appendChild(this._buildDateSep(data.ts));
            }
        } else if (container.children.length === 0) {
            container.appendChild(this._buildDateSep(data.ts));
        }

        // 그룹핑 판단
        const grouped = lastVisible &&
            lastVisible.from === data.from &&
            !data.replyTo && !lastVisible.to && !data.to &&
            (data.ts - lastVisible.ts) < CFG.MSG_GROUP_GAP_MS;

        const el = this._buildChatMsgEl(data, grouped);
        container.appendChild(el);

        // 스크롤이 아래에 있으면 자동 스크롤, 아니면 미읽음 카운트
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        if (isAtBottom) {
            this._scrollChatToBottom(overlay);
        } else {
            this._scrollUnread++;
            this._updateScrollBtn(overlay);
        }
    }

    _buildChatMsgEl(data, grouped = false) {
        const isMe = data.from === this.client_id;
        const isDM = !!data.to;
        const wrap = document.createElement('div');
        wrap.className = [
            't2c-msg-wrap',
            isMe ? 't2c-msg-me' : 't2c-msg-other',
            isDM ? 't2c-msg-dm' : '',
            grouped ? 't2c-msg-grouped' : ''
        ].filter(Boolean).join(' ');
        wrap.dataset.msgId = data.id || '';

        // 발신자 닉네임 (상대방, 그룹핑 아닐 때만)
        if (!isMe && !grouped) {
            const nick = document.createElement('span');
            nick.className = 't2c-msg-nick';
            nick.textContent = data.nickname || '익명';
            nick.style.color = `hsl(${data.color_hue} 72% 48%)`;
            wrap.appendChild(nick);
        }

        // DM 태그
        if (isDM && !grouped) {
            const dmTag = document.createElement('span');
            dmTag.className = 't2c-dm-tag';
            dmTag.innerHTML = '<span class="material-icons">lock</span>DM';
            wrap.appendChild(dmTag);
        }

        // 버블 행
        const bubbleRow = document.createElement('div');
        bubbleRow.className = 't2c-bubble-row';

        if (isMe) bubbleRow.appendChild(this._buildMsgActions(data));

        // 버블 컬럼
        const bubbleCol = document.createElement('div');
        bubbleCol.className = 't2c-bubble-col';

        // 답장 인용
        if (data.replyTo) {
            const quote = document.createElement('div');
            quote.className = 't2c-reply-quote';
            const bar = document.createElement('div');
            bar.className = 't2c-reply-quote-bar';
            bar.style.background = `hsl(${data.color_hue||200} 72% 52%)`;
            quote.appendChild(bar);
            const qBody = document.createElement('div');
            qBody.className = 't2c-reply-quote-body';
            qBody.innerHTML = `<span class="t2c-reply-quote-nick">${this._escHtml(data.replyTo.nickname || '익명')}</span>`
                            + `<span class="t2c-reply-quote-text">${this._escHtml((data.replyTo.text || '파일').substring(0, 80))}</span>`;
            quote.appendChild(qBody);
            bubbleCol.appendChild(quote);
        }

        // 말풍선
        if (data.type === 'file' && data.fileMeta) {
            const fm = data.fileMeta;
            const mediaType = this._isMediaFile(fm.name, fm.type);

            if (mediaType && (fm.previewUrl || fm.downloadUrl)) {
                // [v3.2.3] 이미지/동영상 → 미디어 미리보기 렌더링
                const bubble = document.createElement('div');
                bubble.className = `t2c-msg-bubble t2c-msg-media t2c-msg-${mediaType}`;
                const previewSrc = fm.previewUrl || fm.downloadUrl;

                if (mediaType === 'image') {
                    bubble.innerHTML = `
                        <div class="t2c-media-preview">
                            <img class="t2c-preview-img" src="${this._escHtml(previewSrc)}" alt="${this._escHtml(fm.name)}" loading="lazy" />
                        </div>
                        <div class="t2c-media-footer">
                            <div class="t2c-file-info">
                                <span class="t2c-file-name">${this._escHtml(fm.name)}</span>
                                <span class="t2c-file-size">${this._humanSize(fm.size)}</span>
                            </div>
                            ${fm.downloadUrl
                                ? `<a class="t2c-dl-btn" href="${fm.downloadUrl}" download="${this._escHtml(fm.name)}" title="다운로드"><span class="material-icons">download</span></a>`
                                : `<span class="t2c-dl-progress" data-transfer-id="${this._escHtml(fm.id)}"><span class="material-icons t2c-spin">autorenew</span></span>`}
                        </div>`;
                } else {
                    // video
                    const safeUrl = this._escHtml(previewSrc);
                    bubble.innerHTML = `
                        <div class="t2c-media-preview">
                            <video class="t2c-preview-video" src="${safeUrl}" controls preload="metadata" playsinline onerror="this.closest('.t2c-msg-media').classList.add('t2c-media-unsupported')"></video>
                        </div>
                        <div class="t2c-media-footer">
                            <div class="t2c-file-info">
                                <span class="t2c-file-name">${this._escHtml(fm.name)}</span>
                                <span class="t2c-file-size">${this._humanSize(fm.size)}</span>
                            </div>
                            ${fm.downloadUrl
                                ? `<a class="t2c-dl-btn" href="${fm.downloadUrl}" download="${this._escHtml(fm.name)}" title="다운로드"><span class="material-icons">download</span></a>`
                                : `<span class="t2c-dl-progress" data-transfer-id="${this._escHtml(fm.id)}"><span class="material-icons t2c-spin">autorenew</span></span>`}
                        </div>`;
                }
                bubbleCol.appendChild(bubble);
            } else if (mediaType && !fm.previewUrl && !fm.downloadUrl) {
                // [v3.2.3] 수신 중인 이미지/동영상 → 플레이스홀더 + 파일 카드
                const bubble = document.createElement('div');
                bubble.className = `t2c-msg-bubble t2c-msg-media t2c-msg-${mediaType}`;
                bubble.dataset.transferId = fm.id;
                bubble.innerHTML = `
                    <div class="t2c-media-preview t2c-media-placeholder">
                        <span class="material-icons t2c-media-placeholder-icon">${mediaType === 'image' ? 'image' : 'videocam'}</span>
                        <span class="t2c-file-size">수신 중…</span>
                    </div>
                    <div class="t2c-media-footer">
                        <div class="t2c-file-info">
                            <span class="t2c-file-name">${this._escHtml(fm.name)}</span>
                            <span class="t2c-file-size">${this._humanSize(fm.size)}</span>
                        </div>
                        <span class="t2c-dl-progress" data-transfer-id="${this._escHtml(fm.id)}"><span class="material-icons t2c-spin">autorenew</span></span>
                    </div>`;
                bubbleCol.appendChild(bubble);
            } else {
                // 일반 파일 → 기존 파일 카드 블록
                const bubble = document.createElement('div');
                bubble.className = 't2c-msg-bubble t2c-msg-file';
                bubble.innerHTML = `
                    <span class="material-icons t2c-file-icon">${this._fileIcon(fm.name)}</span>
                    <div class="t2c-file-info">
                        <span class="t2c-file-name">${this._escHtml(fm.name)}</span>
                        <span class="t2c-file-size">${this._humanSize(fm.size)}</span>
                    </div>
                    ${fm.downloadUrl
                        ? `<a class="t2c-dl-btn" href="${fm.downloadUrl}" download="${this._escHtml(fm.name)}" title="다운로드"><span class="material-icons">download</span></a>`
                        : `<span class="t2c-dl-progress" data-transfer-id="${this._escHtml(fm.id)}"><span class="material-icons t2c-spin">autorenew</span></span>`}`;
                bubbleCol.appendChild(bubble);
            }
        } else {
            const bubble = document.createElement('div');
            bubble.className = 't2c-msg-bubble t2c-msg-text';
            if (this._chatSearchQuery) {
                bubble.innerHTML = this._highlightText(this._escHtml(data.text || ''), this._chatSearchQuery);
            } else {
                bubble.textContent = data.text || '';
            }
            bubbleCol.appendChild(bubble);
        }

        // 리액션 영역
        const reactions = this._reactions.get(data.id);
        if (reactions && Object.keys(reactions).length > 0) {
            bubbleCol.appendChild(this._buildReactionPills(data.id, reactions));
        }

        bubbleRow.appendChild(bubbleCol);
        if (!isMe) bubbleRow.appendChild(this._buildMsgActions(data));
        wrap.appendChild(bubbleRow);

        // 타임스탬프 + 읽음 확인
        const footer = document.createElement('div');
        footer.className = 't2c-msg-footer';
        const ts = document.createElement('time');
        ts.className = 't2c-msg-time';
        ts.textContent = this._fmtTime(data.ts);
        footer.appendChild(ts);
        if (isMe) {
            const readSet = this._readBy.get(data.id);
            const readCount = readSet ? readSet.size : 0;
            const check = document.createElement('span');
            check.className = 't2c-read-check' + (readCount > 0 ? ' is-read' : '');
            check.title = readCount > 0 ? `${readCount}명이 읽음` : '전송됨';
            check.innerHTML = readCount > 0
                ? '<span class="material-icons">done_all</span>'
                : '<span class="material-icons">done</span>';
            footer.appendChild(check);
        }
        wrap.appendChild(footer);

        // 모바일 스와이프 → 답장
        this._installSwipeReply(wrap, data);

        // 모바일 롱프레스 컨텍스트 메뉴
        this._installLongPress(wrap, data);

        return wrap;
    }

    _buildMsgActions(data) {
        const actions = document.createElement('div');
        actions.className = 't2c-msg-actions';

        // 리액션 버튼 — [v3.2.4] 클릭 시 _showReactPicker()로 body 레벨 피커 생성
        const reactBtn = document.createElement('button');
        reactBtn.type = 'button';
        reactBtn.className = 't2c-action-btn t2c-react-trigger';
        reactBtn.title = '리액션';
        reactBtn.innerHTML = '<span class="material-icons">add_reaction</span>';
        reactBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._showReactPicker(reactBtn, data.id);
        });
        actions.appendChild(reactBtn);

        // 답장 버튼
        const replyBtn = document.createElement('button');
        replyBtn.type = 'button';
        replyBtn.className = 't2c-action-btn';
        replyBtn.title = '답장';
        replyBtn.innerHTML = '<span class="material-icons">reply</span>';
        replyBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._setReplyTarget(data, this._modalOverlay);
        });
        actions.appendChild(replyBtn);

        // 복사 버튼 (텍스트 메시지만)
        if (data.type !== 'file') {
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 't2c-action-btn';
            copyBtn.title = '복사';
            copyBtn.innerHTML = '<span class="material-icons">content_copy</span>';
            copyBtn.addEventListener('click', () => {
                this._copyToClipboard(data.text || '');
                showToast('복사했습니다.', 'success', 1500);
            });
            actions.appendChild(copyBtn);
        }

        return actions;
    }

    /**
     * [v3.2.4] 리액션 이모지 피커를 body 레벨에 생성하고 버튼 옆에 반응형 배치
     * — position:fixed + JS getBoundingClientRect → 부모 overflow:hidden 클리핑 완전 회피
     * — 뷰포트 경계 자동 보정 (위/아래/좌/우)
     * — 모바일에서도 버튼 옆에 안 짤리고 화면 뷰 넘어가지 않게 배치
     */
    _showReactPicker(anchorBtn, msgId) {
        // 이미 열려있는 피커가 같은 메시지 것이면 토글 닫기
        const existingPicker = document.querySelector('.t2c-react-picker');
        if (existingPicker && existingPicker.dataset.anchorFor === String(msgId)) {
            existingPicker.remove();
            return;
        }
        // 기존 피커 모두 제거 (다른 메시지의 피커)
        document.querySelectorAll('.t2c-react-picker').forEach(p => p.remove());

        const picker = document.createElement('div');
        picker.className = 't2c-react-picker';
        picker.dataset.anchorFor = String(msgId);
        picker.innerHTML = CFG.REACT_EMOJIS.map(e =>
            `<button type="button" class="t2c-react-opt" data-emoji="${e}">${e}</button>`
        ).join('');

        // 공통 정리 함수 — 피커 제거 + 모든 리스너 해제
        const cleanup = () => {
            picker.remove();
            document.removeEventListener('click', close, true);
            document.removeEventListener('touchend', close, true);
            if (scrollParent) scrollParent.removeEventListener('scroll', onScroll);
        };

        // 이모지 선택 → 리액션 전송 + 피커 닫기
        picker.addEventListener('click', e => {
            const btn = e.target.closest('.t2c-react-opt');
            if (!btn) return;
            this._sendReaction(msgId, btn.dataset.emoji);
            cleanup();
        });

        // body에 직접 추가 (부모 overflow 영향 완전 차단)
        document.body.appendChild(picker);

        // ── 위치 계산 ──
        const btnRect = anchorBtn.getBoundingClientRect();
        const pickerRect = picker.getBoundingClientRect();
        const gap = 6;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const safeMargin = 8;  // 뷰포트 가장자리 최소 여백

        // 세로: 기본 버튼 위, 공간 부족하면 아래
        let top = btnRect.top - pickerRect.height - gap;
        if (top < safeMargin) {
            top = btnRect.bottom + gap;
        }
        // 아래도 넘어가면 뷰포트 내 강제 배치
        if (top + pickerRect.height > vh - safeMargin) {
            top = Math.max(safeMargin, vh - pickerRect.height - safeMargin);
        }

        // 가로: 버튼 중앙 정렬, 뷰포트 경계 보정
        let left = btnRect.left + (btnRect.width / 2) - (pickerRect.width / 2);
        if (left < safeMargin) left = safeMargin;
        if (left + pickerRect.width > vw - safeMargin) left = vw - pickerRect.width - safeMargin;

        picker.style.top = top + 'px';
        picker.style.left = left + 'px';

        // 바깥 클릭 / 터치 시 닫기
        const close = ev => {
            if (ev && picker.contains(ev.target)) return;
            if (ev && ev.target === anchorBtn) return;
            cleanup();
        };
        // 약간 지연하여 현재 클릭 이벤트가 close를 트리거하지 않도록 함
        setTimeout(() => {
            document.addEventListener('click', close, true);
            document.addEventListener('touchend', close, true);
        }, 80);

        // 스크롤 발생 시 피커 닫기 (위치 어긋남 방지)
        const scrollParent = anchorBtn.closest('.t2c-chat-msgs');
        const onScroll = () => { cleanup(); };
        scrollParent && scrollParent.addEventListener('scroll', onScroll, { passive: true });
    }

    _buildReactionPills(msgId, reactions) {
        const row = document.createElement('div');
        row.className = 't2c-reaction-row';
        row.dataset.msgId = msgId;
        for (const [emoji, users] of Object.entries(reactions)) {
            const count = Object.keys(users).length;
            if (count === 0) continue;
            const myReacted = msgId && users[this.client_id];
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 't2c-react-pill' + (myReacted ? ' is-mine' : '');
            pill.title = Object.values(users).join(', ');
            pill.innerHTML = `${emoji}<span class="t2c-react-count">${count}</span>`;
            pill.addEventListener('click', () => this._sendReaction(msgId, emoji));
            row.appendChild(pill);
        }
        return row;
    }

    _installSwipeReply(wrap, data) {
        let startX = 0, startY = 0, swiping = false, swipeDone = false;
        const THRESHOLD = 60;
        wrap.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            swiping = true; swipeDone = false;
        }, { passive: true });
        wrap.addEventListener('touchmove', e => {
            if (!swiping || swipeDone) return;
            const dx = e.touches[0].clientX - startX;
            const dy = Math.abs(e.touches[0].clientY - startY);
            if (dy > 20) { swiping = false; return; } // 세로 스크롤
            // 오른쪽 스와이프 → 답장
            if (dx > THRESHOLD) {
                swipeDone = true;
                wrap.classList.add('t2c-swipe-hint');
                setTimeout(() => wrap.classList.remove('t2c-swipe-hint'), 400);
                this._setReplyTarget(data, this._modalOverlay);
            }
        }, { passive: true });
        wrap.addEventListener('touchend', () => { swiping = false; }, { passive: true });
    }

    _installLongPress(wrap, data) {
        let timer = null;
        const start = e => {
            timer = setTimeout(() => {
                timer = null;
                this._showContextMenu(e, data);
            }, 600);
        };
        const cancel = () => { clearTimeout(timer); timer = null; };
        wrap.addEventListener('touchstart', start, { passive: true });
        wrap.addEventListener('touchend',   cancel, { passive: true });
        wrap.addEventListener('touchmove',  cancel, { passive: true });
        wrap.addEventListener('contextmenu', e => {
            e.preventDefault();
            this._showContextMenu(e, data);
        });
    }

    _showContextMenu(e, data) {
        document.querySelectorAll('.t2c-ctx-menu').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 't2c-ctx-menu';
        const items = [
            { icon: 'reply', label: '답장', action: () => this._setReplyTarget(data, this._modalOverlay) },
            { icon: 'add_reaction', label: '리액션', action: () => {
                const actionsEl = document.querySelector(`[data-msg-id="${data.id}"] .t2c-react-trigger`);
                if (actionsEl) this._showReactPicker(actionsEl, data.id);
            }},
            ...(data.type !== 'file' ? [{ icon: 'content_copy', label: '복사', action: () => {
                this._copyToClipboard(data.text || '');
                showToast('복사했습니다.', 'success', 1500);
            }}] : [])
        ];
        items.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 't2c-ctx-item';
            btn.innerHTML = `<span class="material-icons">${item.icon}</span>${item.label}`;
            btn.addEventListener('click', () => { menu.remove(); item.action(); });
            menu.appendChild(btn);
        });

        // 위치 계산
        const rect = (e.currentTarget || e.target).getBoundingClientRect();
        const menuW = 180, menuH = 180;
        let menuTop = rect.bottom + 4;
        if (menuTop + menuH > window.innerHeight) menuTop = Math.max(4, rect.top - menuH - 4);
        let menuLeft = Math.max(4, rect.left);
        if (menuLeft + menuW > window.innerWidth) menuLeft = Math.max(4, window.innerWidth - menuW - 8);
        menu.style.cssText = `position:fixed;top:${menuTop}px;left:${menuLeft}px;z-index:9999;max-width:calc(100vw - 16px)`;
        document.body.appendChild(menu);
        const close = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
        setTimeout(() => document.addEventListener('click', close), 50);
    }

    _scrollChatToBottom(overlay) {
        const c = overlay && overlay.querySelector('.t2c-chat-msgs');
        if (c) setTimeout(() => { c.scrollTop = c.scrollHeight; }, 30);
    }

    _updateChatBadge(overlay, n) {
        if (!overlay) return;
        const badge = overlay.querySelector('.t2c-chat-unread');
        if (!badge) return;
        if (n > 0) {
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    _escHtml(str) {
        return String(str).replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
    }

    _fmtTime(ts) {
        try {
            const d = new Date(ts);
            const h = d.getHours().toString().padStart(2, '0');
            const m = d.getMinutes().toString().padStart(2, '0');
            return `${h}:${m}`;
        } catch (e) { return ''; }
    }

    _humanSize(bytes) {
        bytes = Math.max(0, bytes || 0);
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    _fileIcon(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) return 'image';
        if (['mp4','mov','avi','mkv'].includes(ext)) return 'videocam';
        if (['mp3','wav','ogg'].includes(ext)) return 'audiotrack';
        if (ext === 'pdf') return 'picture_as_pdf';
        if (['doc','docx','hwp','hwpx'].includes(ext)) return 'description';
        if (['xls','xlsx','csv'].includes(ext)) return 'table_chart';
        if (['ppt','pptx'].includes(ext)) return 'slideshow';
        if (['zip','7z'].includes(ext)) return 'folder_zip';
        if (['md','txt'].includes(ext)) return 'article';
        return 'insert_drive_file';
    }

    // [v3.2.3] 파일이 이미지/동영상인지 판별 (미디어 미리보기 렌더링용)
    _isMediaFile(name, mimeType) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) return 'image';
        if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
        if (mimeType) {
            if (mimeType.startsWith('image/')) return 'image';
            if (mimeType.startsWith('video/')) return 'video';
        }
        return null;
    }

    // ============================================================
    // === 파일 공유 (P2P 전용) ===
    // ============================================================

    _isAllowedFile(file) {
        if (!file.size || file.size === 0) return false;
        if (file.size > CFG.MAX_FILE_BYTES) return false;
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return CFG.ALLOWED_FILE_EXTS.has(ext) || file.type.startsWith('image/');
    }

    _sendFile(file, overlay) {
        if (this.mode !== 'p2p') {
            showToast('파일 공유는 P2P 직접 연결 모드에서만 지원됩니다.', 'error');
            return;
        }
        if (!this._isAllowedFile(file)) {
            showToast(`허용되지 않은 파일 형식이거나 파일이 너무 큽니다. (최대 ${this._humanSize(CFG.MAX_FILE_BYTES)})`, 'error', 4000);
            return;
        }
        const transferId = uuidv4();
        const meta = {
            id: transferId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks: Math.ceil(file.size / CFG.FILE_CHUNK_BYTES),
            from: this.client_id,
            ts: Date.now()
        };

        // 메타 메시지 브로드캐스트
        this.transport.send({
            t: CFG.MSG_TYPES.FILE_META,
            p: meta,
            from: this.client_id, ts: Date.now()
        });

        // 내 채팅에도 파일 메시지 표시 (전송 중)
        // [v3.2.3] 이미지/동영상인 경우 previewUrl 생성
        const mediaType = this._isMediaFile(file.name, file.type);
        const previewUrl = mediaType ? URL.createObjectURL(file) : null;
        if (previewUrl) {
            this._previewUrls = this._previewUrls || new Map();
            this._previewUrls.set(transferId, previewUrl);
        }
        const chatData = {
            id: uuidv4(), from: this.client_id,
            nickname: this.nickname || '나',
            color_hue: this.userColor.hue,
            text: '', ts: Date.now(), type: 'file',
            fileMeta: { ...meta, downloadUrl: null, previewUrl }
        };
        this._chatMessages.push(chatData);
            if (this._chatMessages.length > CFG.CHAT_CACHE_MAX) this._chatMessages = this._chatMessages.slice(-CFG.CHAT_CACHE_MAX);
        this._appendChatMessage(chatData, overlay || this._modalOverlay);
        this._scrollChatToBottom(overlay || this._modalOverlay);

        // 청크 전송
        this._outgoingTransfers.set(transferId, { file, total: meta.totalChunks, sent: 0, cancelled: false });
        this._sendNextChunk(transferId, file, 0, overlay || this._modalOverlay);
    }

    _sendNextChunk(transferId, file, idx, overlay) {
        const entry = this._outgoingTransfers.get(transferId);
        if (!entry || entry.cancelled || !this.transport || this.mode !== 'p2p') return;

        const start = idx * CFG.FILE_CHUNK_BYTES;
        const end = Math.min(start + CFG.FILE_CHUNK_BYTES, file.size);
        const slice = file.slice(start, end);

        const reader = new FileReader();
        reader.onload = (e) => {
            const arrayBuf = e.target.result;
            const uint8 = new Uint8Array(arrayBuf);
            // base64 인코딩으로 DataChannel 텍스트 채널 호환
            let binary = '';
            const chunkSz = 8192;
            for (let i = 0; i < uint8.length; i += chunkSz) {
                binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + chunkSz, uint8.length)));
            }
            const base64 = btoa(binary);
            try {
                this.transport.send({
                    t: CFG.MSG_TYPES.FILE_CHUNK,
                    p: { id: transferId, idx, data: base64, last: (idx + 1) >= entry.total },
                    from: this.client_id, ts: Date.now()
                });
            } catch (_) { return; }

            entry.sent = idx + 1;
            if ((idx + 1) < entry.total) {
                // 흐름 제어: 다음 청크를 약간의 딜레이 후 전송
                setTimeout(() => this._sendNextChunk(transferId, file, idx + 1, overlay), 16);
            } else {
                this._outgoingTransfers.delete(transferId);
                // 내 버블에 다운로드 URL 붙이기
                const url = URL.createObjectURL(file);
                this._updateFileMsg(overlay, transferId, url, file.name);
                // [v3.2.3] 발신용 previewUrl 정리 (이제 downloadUrl로 대체)
                if (this._previewUrls && this._previewUrls.has(transferId)) {
                    URL.revokeObjectURL(this._previewUrls.get(transferId));
                    this._previewUrls.delete(transferId);
                }
                showToast(`파일 전송 완료: ${file.name}`, 'success', 3000);
            }
        };
        reader.readAsArrayBuffer(slice);
    }

    _handleFileMeta(msg) {
        const meta = msg && msg.p;
        if (!meta || !meta.id) return;
        if (meta.from === this.client_id) return; // 내 것 echo 방지
        this._fileTransfers.set(meta.id, { meta, chunks: new Array(meta.totalChunks), received: 0, timeout: setTimeout(() => {
            if (this._fileTransfers.has(meta.id)) {
                this._fileTransfers.delete(meta.id);
                showToast(`파일 수신 시간 초과: ${meta.name}`, 'error', 3000);
            }
        }, 5 * 60 * 1000) });

        // 수신 중 채팅 버블 추가
        const chatData = {
            id: uuidv4(), from: meta.from,
            nickname: this._getNickByClientId(meta.from),
            color_hue: this._getHueByClientId(meta.from),
            text: '', ts: meta.ts || Date.now(), type: 'file',
            fileMeta: { ...meta, downloadUrl: null }
        };
        this._chatMessages.push(chatData);
            if (this._chatMessages.length > CFG.CHAT_CACHE_MAX) this._chatMessages = this._chatMessages.slice(-CFG.CHAT_CACHE_MAX);
        const overlay = this._modalOverlay;
        this._appendChatMessage(chatData, overlay);
        this._scrollChatToBottom(overlay);

        // 채팅 탭 열려있지 않으면 토스트
        const isChatActive = overlay && overlay.querySelector('.t2c-info-tab[data-infotab="chat"].is-active');
        if (!isChatActive) {
            showToast(`📎 ${chatData.nickname}님이 파일을 공유했습니다: ${meta.name}`, 'info', 4500);
            this._chatUnread++;
            this._updateChatBadge(overlay, this._chatUnread);
        }
    }

    _handleFileChunk(msg) {
        const p = msg && msg.p;
        if (!p || !p.id) return;
        const entry = this._fileTransfers.get(p.id);
        if (!entry) return;
        // base64 → Uint8Array
        try {
            const binary = atob(p.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            entry.chunks[p.idx] = bytes;
            entry.received++;
        } catch (_) { return; }

        if (p.last || (entry.received >= entry.meta.totalChunks && entry.chunks.every(c => c !== undefined))) {
            if (entry.timeout) clearTimeout(entry.timeout);
            this._finishFileDownload(entry.meta, entry.chunks);
            this._fileTransfers.delete(p.id);
        }
    }

    _finishFileDownload(meta, chunks) {
        try {
            const totalLen = chunks.reduce((s, c) => s + (c ? c.length : 0), 0);
            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                if (chunk) { merged.set(chunk, offset); offset += chunk.length; }
            }
            const blob = new Blob([merged], { type: meta.type || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            this._updateFileMsg(this._modalOverlay, meta.id, url, meta.name);
            showToast(`✅ 파일 수신 완료: ${meta.name} — 클릭하여 다운로드`, 'success', 5000);
        } catch (e) {
            console.error('[Collab][File] 파일 재조합 실패:', e);
        }
    }

    _updateFileMsg(overlay, transferId, url, name) {
        if (!overlay) return;
        const safeUrl = (typeof url === 'string' && /^(?:blob:|https?:\/\/)/i.test(url)) ? url : '#';

        // [v3.2.3] 미디어 파일: 플레이스홀더 → 실제 미리보기로 교체 + 다운로드 버튼 갱신
        const mediaBubble = overlay.querySelector(`.t2c-msg-media[data-transfer-id="${transferId}"]`);
        if (mediaBubble) {
            // 플레이스홀더 미리보기 영역 찾기
            const placeholder = mediaBubble.querySelector('.t2c-media-placeholder');
            if (placeholder) {
                const mediaType = mediaBubble.classList.contains('t2c-msg-image') ? 'image' : 'video';
                const previewDiv = document.createElement('div');
                previewDiv.className = 't2c-media-preview';
                if (mediaType === 'image') {
                    previewDiv.innerHTML = `<img class="t2c-preview-img" src="${this._escHtml(safeUrl)}" alt="${this._escHtml(name)}" loading="lazy" />`;
                } else {
                    previewDiv.innerHTML = `<video class="t2c-preview-video" src="${this._escHtml(safeUrl)}" controls preload="metadata" playsinline onerror="this.closest('.t2c-msg-media').classList.add('t2c-media-unsupported')"></video>`;
                }
                placeholder.replaceWith(previewDiv);
            }
            // 다운로드 진행 → 다운로드 버튼
            const prog = mediaBubble.querySelector(`.t2c-dl-progress[data-transfer-id="${transferId}"]`);
            if (prog) {
                prog.outerHTML = `<a class="t2c-dl-btn" href="${this._escHtml(safeUrl)}" download="${this._escHtml(name)}" title="다운로드">
                    <span class="material-icons">download</span></a>`;
            }
            mediaBubble.removeAttribute('data-transfer-id');
            return;
        }

        // 일반 파일: 다운로드 진행 → 다운로드 버튼 (기존 로직)
        const prog = overlay.querySelector(`.t2c-dl-progress[data-transfer-id="${transferId}"]`);
        if (prog) {
            prog.outerHTML = `<a class="t2c-dl-btn" href="${this._escHtml(safeUrl)}" download="${this._escHtml(name)}" title="다운로드">
                <span class="material-icons">download</span></a>`;
        }
    }

    _getNickByClientId(cid) {
        const u = this.users.find(u => u.client_id === cid);
        return (u && u.nickname) || '익명';
    }
    _getHueByClientId(cid) {
        const u = this.users.find(u => u.client_id === cid);
        return (u && typeof u.color_hue === 'number') ? u.color_hue : 200;
    }

    // ============================================================
    // === 타이핑 인디케이터 ===
    // ============================================================

    _sendTypingStart() {
        if (this.mode !== 'p2p' || !this.transport) return;
        if (this._typingTimer) return; // 이미 보냄
        this.transport.send({
            t: CFG.MSG_TYPES.TYPING,
            p: { client_id: this.client_id, nickname: this.nickname || '익명', color_hue: this.userColor.hue, typing: true },
            from: this.client_id, ts: Date.now()
        });
        this._typingTimer = setTimeout(() => {
            this._typingTimer = null;
            // 멈춤 알림 (선택 사항: 생략 시 AWARENESS_STALE_MS 후 자동 소멸)
        }, 2500);
    }

    _handleRemoteTyping(msg) {
        const p = msg && msg.p;
        if (!p || !p.client_id || p.client_id === this.client_id) return;
        const cid = p.client_id;
        const existing = this._remoteTyping.get(cid);
        if (existing && existing.timer) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            this._remoteTyping.delete(cid);
            this._updateTypingBar(this._modalOverlay);
        }, 3000);
        this._remoteTyping.set(cid, {
            nickname: (p.nickname || '익명').substring(0, 30),
            hue: typeof p.color_hue === 'number' ? p.color_hue : 200,
            timer
        });
        this._updateTypingBar(this._modalOverlay);
    }

    _updateTypingBar(overlay) {
        if (!overlay) return;
        const bar = overlay.querySelector('.t2c-typing-bar');
        if (!bar) return;
        const typists = Array.from(this._remoteTyping.values());
        if (typists.length === 0) { bar.innerHTML = ''; return; }
        const names = typists.map(t => `<span style="color:hsl(${t.hue} 70% 46%);font-weight:600">${this._escHtml(t.nickname)}</span>`).join(', ');
        const verb = typists.length === 1 ? '님이 입력 중…' : '명이 입력 중…';
        bar.innerHTML = `<span class="t2c-typing-dots"><span></span><span></span><span></span></span>${names}${typists.length > 1 ? ' 외 ' + (typists.length - 1) : ''}${verb}`;
    }

    // ============================================================
    // === 에디터 잠금 (방장 전용) ===
    // ============================================================

    _sendLock(locked) {
        if (!this.transport || !this.isHost) return;
        this.transport.send({
            t: CFG.MSG_TYPES.LOCK,
            p: { locked, by: this.client_id, nickname: this.nickname || '방장' },
            from: this.client_id, ts: Date.now()
        });
    }

    _handleLock(msg) {
        const p = msg && msg.p;
        if (!p) return;
        if (p.by === this.client_id) return; // 내가 보낸 것
        this._isLocked = !!p.locked;
        this._applyLock(this._isLocked);
        const who = (p.nickname || '방장');
        showToast(this._isLocked
            ? `🔒 ${who}님이 편집을 잠갔습니다.`
            : `🔓 ${who}님이 편집 잠금을 해제했습니다.`, 'info', 3500);
    }

    _applyLock(locked) {
        try {
            const ed = this.editor && this.editor.editor;
            if (!ed) return;
            // 호스트는 전체 잠금 시에도 본인은 잠그지 않음.
            // 게스트는: 전체 잠금(this._isLocked) 또는 개인 잠금(this._lockedByHost) 중 하나라도 켜져 있으면 잠금.
            const effective = !!locked || (!this.isHost && !!this._lockedByHost);
            if (effective && !this.isHost) {
                ed.setAttribute('contenteditable', 'false');
                ed.classList.add('t2c-editor-locked');
            } else {
                ed.setAttribute('contenteditable', 'true');
                ed.classList.remove('t2c-editor-locked');
            }
        } catch (e) {}
    }

    _refreshLockBtn(overlay) {
        if (!overlay) return;
        const btn = overlay.querySelector('.t2-collab-lock-btn');
        if (!btn) return;
        const icon = btn.querySelector('.t2c-lock-icon');
        const label = btn.querySelector('.t2c-lock-label');
        if (this._isLocked) {
            btn.classList.add('is-locked');
            if (icon) icon.textContent = 'lock';
            if (label) label.textContent = '편집 잠금 해제';
        } else {
            btn.classList.remove('is-locked');
            if (icon) icon.textContent = 'lock_open';
            if (label) label.textContent = '편집 잠금';
        }
    }

    // ============================================================
    // === 개별 사용자 편집 잠금 (방장 전용) ===
    //   - 방장이 특정 참가자만 "편집 잠금" 처리할 수 있음
    //   - 전체 잠금(_isLocked)과 독립적으로 동작
    //   - this._userLocks: Set<client_id> (방장이 잠근 대상)
    //   - this._lockedByHost: boolean (게스트 자신이 잠겼는지 여부)
    // ============================================================
    _ensureUserLockSet() {
        if (!(this._userLocks instanceof Set)) this._userLocks = new Set();
        return this._userLocks;
    }

    _isUserLocked(cid) {
        if (!cid) return false;
        return this._ensureUserLockSet().has(cid);
    }

    _toggleUserLock(targetCid) {
        if (!this.isHost || !targetCid) return;
        if (targetCid === this.client_id) {
            showToast('자기 자신은 잠글 수 없습니다.', 'info', 2000);
            return;
        }
        const set = this._ensureUserLockSet();
        const willLock = !set.has(targetCid);
        if (willLock) set.add(targetCid);
        else set.delete(targetCid);

        // 메시지 전송: P2P/PHP 모두에서 동작.
        // P2P 호스트 라우팅: to=targetCid 로 보내면 host transport 가 해당 conn 에만 relay
        // 동시에 broadcast 도 보내서 다른 참가자들도 UI 상태 동기화 가능 (state 필드로 표시)
        try {
            if (this.transport) {
                // 1) 대상에게 직접 명시 메시지 (즉시 잠금/해제 동작 트리거)
                this.transport.send({
                    t: CFG.MSG_TYPES.USER_LOCK,
                    p: { targetCid, locked: willLock, by: this.client_id, nickname: this.nickname || '방장' },
                    to: targetCid,
                    from: this.client_id, ts: Date.now()
                });
                // 2) 전체 broadcast (UI 상태 동기화용; 잠금 표시 뱃지)
                this.transport.send({
                    t: CFG.MSG_TYPES.USER_LOCK,
                    p: { targetCid, locked: willLock, by: this.client_id, nickname: this.nickname || '방장', state: true },
                    from: this.client_id, ts: Date.now()
                });
            }
        } catch (e) { console.warn('[Collab] user-lock send fail:', e); }

        showToast(willLock
            ? `🔒 ${this._getNickByClientId(targetCid) || '사용자'}님의 편집을 잠갔습니다.`
            : `🔓 ${this._getNickByClientId(targetCid) || '사용자'}님의 편집 잠금을 해제했습니다.`,
            'info', 2500);

        this._updateUsersListUI(this._modalOverlay);
    }

    _handleUserLock(msg) {
        const p = msg && msg.p;
        if (!p || !p.targetCid) return;
        const set = this._ensureUserLockSet();
        if (p.locked) set.add(p.targetCid);
        else set.delete(p.targetCid);

        // 본인이 대상이면 즉시 잠금/해제 적용
        if (p.targetCid === this.client_id) {
            this._lockedByHost = !!p.locked;
            this._applyLock(this._isLocked || this._lockedByHost);
            const who = (p.nickname || '방장');
            showToast(p.locked
                ? `🔒 ${who}님이 당신의 편집을 잠갔습니다.`
                : `🔓 ${who}님이 당신의 편집 잠금을 해제했습니다.`, 'info', 3500);
        }

        // 모든 참가자의 UI 동기화 (잠금 뱃지 표시)
        this._updateUsersListUI(this._modalOverlay);
    }

    // ============================================================
    // === 메시지 가시성 ===
    // ============================================================
    _isMessageVisible(data) {
        if (!this._dmTarget) {
            // 전체 채팅: DM 아닌 메시지만
            return !data.to;
        }
        // DM 뷰: 나 ↔ dmTarget 사이 메시지만
        return (data.from === this.client_id && data.to === this._dmTarget) ||
               (data.from === this._dmTarget && data.to === this.client_id);
    }

    // ============================================================
    // === 1:1 DM ===
    // ============================================================
    _startDM(targetCid, targetNick, overlay) {
        // [FIX v2.3.0] 안정성 향상 모드에서도 P2P 채널로 DM 전송 가능 → 제한 해제
        this._dmTarget = targetCid;
        // DM 미읽음 초기화
        this._dmUnread.delete(targetCid);
        this._refreshUsersList(overlay);
        this._updateDMHeader(overlay);
        this._renderChatView(overlay);
    }

    _exitDM(overlay) {
        this._dmTarget = null;
        this._updateDMHeader(overlay);
        this._renderChatView(overlay);
    }

    _updateDMHeader(overlay) {
        if (!overlay) return;
        const pill = overlay.querySelector('.t2c-dm-pill');
        const pillNick = overlay.querySelector('.t2c-dm-pill-nick');
        const allBtn = overlay.querySelector('.t2c-ch-btn[data-ch="all"]');
        if (!pill) return;
        if (this._dmTarget) {
            const nick = this._getNickByClientId(this._dmTarget);
            if (pillNick) pillNick.textContent = nick;
            pill.style.display = 'inline-flex';
            if (allBtn) allBtn.classList.remove('is-active');
        } else {
            pill.style.display = 'none';
            if (allBtn) allBtn.classList.add('is-active');
        }
        // 채팅 입력 placeholder 업데이트
        const txt = overlay.querySelector('.t2c-chat-txt');
        if (txt) {
            txt.placeholder = this._dmTarget
                ? `${this._getNickByClientId(this._dmTarget)}님에게 DM…`
                : '메시지 입력…';
        }
    }

    // ============================================================
    // === 답장 ===
    // ============================================================
    _setReplyTarget(data, overlay) {
        this._replyTarget = {
            id: data.id,
            nickname: data.nickname || '익명',
            text: (data.text || '파일').substring(0, 80),
            type: data.type || 'text'
        };
        if (!overlay) return;
        const preview = overlay.querySelector('.t2c-reply-preview');
        const nick = overlay.querySelector('.t2c-reply-preview-nick');
        const text = overlay.querySelector('.t2c-reply-preview-text');
        if (preview) preview.style.display = 'flex';
        if (nick) { nick.textContent = this._replyTarget.nickname; nick.style.color = `hsl(${data.color_hue||200} 72% 48%)`; }
        if (text) text.textContent = this._replyTarget.text;
        overlay.querySelector('.t2c-chat-txt') && overlay.querySelector('.t2c-chat-txt').focus();
    }

    _clearReplyTarget(overlay) {
        this._replyTarget = null;
        if (!overlay) return;
        const preview = overlay.querySelector('.t2c-reply-preview');
        if (preview) preview.style.display = 'none';
    }

    // ============================================================
    // === 채팅 검색 ===
    // ============================================================
    _filterChatView(query, overlay) {
        this._chatSearchQuery = (query || '').trim().toLowerCase();
        this._renderChatView(overlay);
        // 검색 결과 수 표시
        if (!overlay) return;
        const countEl = overlay.querySelector('.t2c-search-count');
        if (countEl) {
            if (this._chatSearchQuery) {
                const visible = this._getVisibleMessages();
                const matched = visible.filter(m => {
                    const t = (m.text || '').toLowerCase();
                    const n = (m.nickname || '').toLowerCase();
                    return t.includes(this._chatSearchQuery) || n.includes(this._chatSearchQuery);
                });
                countEl.textContent = `${matched.length}개`;
                countEl.style.display = matched.length ? 'inline' : 'none';
            } else {
                countEl.textContent = '';
                countEl.style.display = 'none';
            }
        }
    }

    _getVisibleMessages() {
        if (!this._dmTarget) return this._chatMessages.filter(m => !m.to);
        return this._chatMessages.filter(m =>
            (m.from === this.client_id && m.to === this._dmTarget) ||
            (m.from === this._dmTarget && m.to === this.client_id)
        );
    }

    _renderChatView(overlay) {
        if (!overlay) return;
        const container = overlay.querySelector('.t2c-chat-msgs');
        if (!container) return;
        container.innerHTML = '';

        let shownCacheSep = false;
        let prevMsg = null;
        let prevDate = null;
        const msgs = this._getVisibleMessages();
        const q = this._chatSearchQuery;

        msgs.forEach(m => {
            if (q) {
                const t = (m.text || '').toLowerCase();
                const n = (m.nickname || '').toLowerCase();
                if (!t.includes(q) && !n.includes(q)) return;
            }

            // 이전 세션 구분자 (캐시 복원)
            if (m._fromCache && !shownCacheSep) {
                shownCacheSep = true;
                const sep = document.createElement('div');
                sep.className = 't2c-cache-sep';
                sep.innerHTML = '<span>이전 세션 기록</span>';
                container.appendChild(sep);
            }

            // 날짜 구분자
            const msgDate = new Date(m.ts);
            const dateKey = `${msgDate.getFullYear()}-${msgDate.getMonth()}-${msgDate.getDate()}`;
            if (dateKey !== prevDate) {
                prevDate = dateKey;
                container.appendChild(this._buildDateSep(m.ts));
            }

            // 메시지 그룹핑 여부
            const grouped = !q && prevMsg &&
                prevMsg.from === m.from &&
                !m.replyTo && !prevMsg.to && !m.to &&
                (m.ts - prevMsg.ts) < CFG.MSG_GROUP_GAP_MS;

            const el = this._buildChatMsgEl(m, grouped);
            container.appendChild(el);
            prevMsg = m;
        });

        if (msgs.length === 0 && !q) {
            const empty = document.createElement('div');
            empty.className = 't2c-msgs-empty';
            empty.innerHTML = '<span class="material-icons">chat_bubble_outline</span><p>대화를 시작해 보세요</p>';
            container.appendChild(empty);
        }

        this._scrollChatToBottom(overlay);
        this._scrollUnread = 0;
        this._updateScrollBtn(overlay);
    }

    _highlightText(escapedHtml, query) {
        if (!query) return escapedHtml;
        const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escapedHtml.replace(new RegExp(`(${safeQ})`, 'gi'),
            '<mark class="t2c-highlight">$1</mark>');
    }

    // ============================================================
    // === 채팅 캐시 (localStorage) ===
    // ============================================================
    _getCacheKey() {
        return CFG.CHAT_CACHE_PFX + (this.collabCode || 'default');
    }

    _saveChatToCache() {
        if (!this.collabCode) return;
        try {
            const msgs = this._chatMessages.slice(-CFG.CHAT_CACHE_MAX)
                .map(({ _fromCache: _, ...m }) => m); // _fromCache 플래그 제거
            const entry = { ts: Date.now(), msgs };
            localStorage.setItem(this._getCacheKey(), JSON.stringify(entry));
        } catch (e) {}
    }

    _loadChatFromCache() {
        if (!this.collabCode) return [];
        try {
            const raw = localStorage.getItem(this._getCacheKey());
            if (!raw) return [];
            const entry = JSON.parse(raw);
            if (!entry || !Array.isArray(entry.msgs)) return [];
            if (Date.now() - (entry.ts || 0) > CFG.CHAT_CACHE_TTL_MS) {
                localStorage.removeItem(this._getCacheKey());
                return [];
            }
            return entry.msgs.map(m => ({ ...m, _fromCache: true }));
        } catch (e) { return []; }
    }

    // ============================================================
    // === 자리비움 / 상태 관리 ===
    // ============================================================

    _setMyStatus(status, overlay) {
        this._myStatus = status;
        this._broadcastStatus();
        const ov = overlay || this._modalOverlay;
        this._refreshStatusUI(ov);
        // 상태 변경 시 사용자 목록 갱신
        this._updateUsersListUI();
    }

    _broadcastStatus() {
        if (!this.transport || !this.mode) return;
        try {
            this.transport.send({
                t: CFG.MSG_TYPES.STATUS,
                p: { client_id: this.client_id, status: this._myStatus, nickname: this.nickname || '익명' },
                from: this.client_id, ts: Date.now()
            });
        } catch (e) {}
    }

    _handleStatusMsg(msg) {
        const p = msg && msg.p;
        if (!p || !p.client_id || p.client_id === this.client_id) return;
        const prev = this._remoteStatuses.get(p.client_id);
        this._remoteStatuses.set(p.client_id, p.status || 'online');
        if (prev && prev !== p.status) {
            const nick = p.nickname || this._getNickByClientId(p.client_id);
            const label = CFG.STATUS_LABELS[p.status] || p.status;
            if (p.status === 'away') showToast(`${nick}님이 자리를 비웠습니다.`, 'info', 2500);
            if (p.status === 'online' && prev === 'away') showToast(`${nick}님이 돌아왔습니다.`, 'success', 2000);
        }
        this._updateUsersListUI();
    }

    _getStatusDotHtml(status) {
        const cls = { online: 't2c-s-online', away: 't2c-s-away', busy: 't2c-s-busy', dnd: 't2c-s-dnd' }[status] || 't2c-s-online';
        return `<span class="t2c-presence-dot ${cls}" title="${CFG.STATUS_LABELS[status] || '온라인'}"></span>`;
    }

    _refreshStatusUI(overlay) {
        if (!overlay) return;
        const label = overlay.querySelector('.t2c-status-label');
        const dot   = overlay.querySelector('.t2c-my-status-dot');
        if (label) label.textContent = CFG.STATUS_LABELS[this._myStatus] || '온라인';
        if (dot) dot.className = `t2c-presence-dot t2c-my-status-dot t2c-s-${this._myStatus}`;
        // picker 활성 항목
        overlay.querySelectorAll('.t2c-status-opt').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.status === this._myStatus);
        });
        // [v2.1.5] 컴팩트 바 상태 점 + 라벨 동기화
        const compactDot = overlay.querySelector('.t2c-compact-status-dot');
        const compactLabel = overlay.querySelector('.t2c-compact-status-label');
        if (compactDot) {
            compactDot.className = `t2c-compact-status-dot t2c-s-${this._myStatus}`;
            compactDot.title = CFG.STATUS_LABELS[this._myStatus] || '온라인';
        }
        if (compactLabel) compactLabel.textContent = CFG.STATUS_LABELS[this._myStatus] || '온라인';
    }

    _installActivityDetector() {
        this._lastActivityTs = Date.now();
        this._activityHandler = () => {
            this._lastActivityTs = Date.now();
            if (this._autoAway && this._myStatus === 'away') {
                this._autoAway = false;
                this._setMyStatus('online');
            }
        };
        this._visibilityHandler = () => {
            if (document.hidden) {
                if (this._myStatus === 'online') { this._autoAway = true; this._setMyStatus('away'); }
            } else {
                if (this._autoAway) { this._autoAway = false; this._setMyStatus('online'); }
            }
        };
        document.addEventListener('mousemove',        this._activityHandler, { passive: true });
        document.addEventListener('keydown',          this._activityHandler, { passive: true });
        document.addEventListener('touchstart',       this._activityHandler, { passive: true });
        document.addEventListener('click',            this._activityHandler, { passive: true });
        document.addEventListener('visibilitychange', this._visibilityHandler);
        this._activityTimer = setInterval(() => {
            if (!this.transport || !this.mode) return;
            if (this._myStatus === 'online' && Date.now() - this._lastActivityTs > CFG.AUTO_AWAY_MS) {
                this._autoAway = true;
                this._setMyStatus('away');
            }
        }, CFG.AWAY_CHECK_MS);
    }

    _uninstallActivityDetector() {
        if (this._activityHandler) {
            document.removeEventListener('mousemove',        this._activityHandler);
            document.removeEventListener('keydown',          this._activityHandler);
            document.removeEventListener('touchstart',       this._activityHandler);
            document.removeEventListener('click',            this._activityHandler);
            this._activityHandler = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._activityTimer) { clearInterval(this._activityTimer); this._activityTimer = null; }
    }

    // ============================================================
    // === 이모지 리액션 ===
    // ============================================================

    _sendReaction(msgId, emoji) {
        if (!this.transport || !this.mode) return;

        // [v3.1.0] 오프라인 시 큐에 저장
        if (this._isOffline) {
            this._offlineQueue.push({ type: 'react', msgId, emoji, ts: Date.now() });
            this._updateOfflineUI();
            // 로컬 토글은 즉시 반영
            this._toggleLocalReaction(msgId, emoji);
            return;
        }

        // 로컬 토글
        this._toggleLocalReaction(msgId, emoji);

        // 브로드캐스트
        this.transport.send({
            t: CFG.MSG_TYPES.REACT,
            p: { msgId, emoji, client_id: this.client_id, nickname: this.nickname || '나', remove: this._wasReactionRemoved(msgId, emoji) },
            from: this.client_id, ts: Date.now()
        });

        // [v3.1.0] 리액션도 DistributedStore에 저장
        this._saveReactionsToDistributedStore();
    }

    // [v3.1.0] 로컬 리액션 토글 헬퍼
    _toggleLocalReaction(msgId, emoji) {
        let msgReacts = this._reactions.get(msgId);
        if (!msgReacts) { msgReacts = {}; this._reactions.set(msgId, msgReacts); }
        if (!msgReacts[emoji]) msgReacts[emoji] = {};
        const alreadyReacted = !!msgReacts[emoji][this.client_id];
        if (alreadyReacted) {
            delete msgReacts[emoji][this.client_id];
            if (Object.keys(msgReacts[emoji]).length === 0) delete msgReacts[emoji];
        } else {
            msgReacts[emoji][this.client_id] = this.nickname || '나';
        }
        this._updateReactionsUI(msgId);
        this._saveReactionsToCache();
        this._saveFullStateToCache();
    }

    // [v3.1.0] 리액션 제거 여부 확인
    _wasReactionRemoved(msgId, emoji) {
        const msgReacts = this._reactions.get(msgId);
        if (!msgReacts || !msgReacts[emoji]) return false;
        return !msgReacts[emoji][this.client_id];
    }

    // [v3.1.0] 모든 피어에게 리액션 명시적 브로드캐스트
    _broadcastReaction(msgId, emoji, remove) {
        if (!this.transport || !this.mode) return;
        this.transport.send({
            t: CFG.MSG_TYPES.REACT,
            p: { msgId, emoji, client_id: this.client_id, nickname: this.nickname || '나', remove },
            from: this.client_id, ts: Date.now()
        });
    }

    _handleReact(msg) {
        const p = msg && msg.p;
        if (!p || !p.msgId || !p.emoji) return;
        let msgReacts = this._reactions.get(p.msgId);
        if (!msgReacts) { msgReacts = {}; this._reactions.set(p.msgId, msgReacts); }
        if (!msgReacts[p.emoji]) msgReacts[p.emoji] = {};
        if (p.remove) {
            delete msgReacts[p.emoji][p.client_id];
            if (Object.keys(msgReacts[p.emoji]).length === 0) delete msgReacts[p.emoji];
        } else {
            msgReacts[p.emoji][p.client_id] = p.nickname || '익명';
        }
        this._updateReactionsUI(p.msgId);
        // [v2.5.0] 리액션 캐시 저장 — 다른 참가자의 리액션도 캐시에 보존
        this._saveReactionsToCache();
        this._saveFullStateToCache();
        // [v3.1.0] DistributedStore에도 저장
        this._saveReactionsToDistributedStore();
    }

    _updateReactionsUI(msgId) {
        const wrap = this._modalOverlay && this._modalOverlay.querySelector(`[data-msg-id="${msgId}"]`);
        if (!wrap) return;
        const bubbleCol = wrap.querySelector('.t2c-bubble-col');
        if (!bubbleCol) return;
        // 기존 리액션 row 교체
        const existing = bubbleCol.querySelector('.t2c-reaction-row');
        if (existing) existing.remove();
        const reactions = this._reactions.get(msgId);
        if (reactions && Object.keys(reactions).some(e => Object.keys(reactions[e]).length > 0)) {
            bubbleCol.appendChild(this._buildReactionPills(msgId, reactions));
        }
    }

    // [v2.5.0] 리액션을 localStorage에 캐시 — 페이지 새로고침 후에도 리액션 복원
    _saveReactionsToCache() {
        if (!this.collabCode) return;
        try {
            const data = {};
            for (const [msgId, emojiMap] of this._reactions) {
                const filtered = {};
                for (const [emoji, users] of Object.entries(emojiMap)) {
                    if (Object.keys(users).length > 0) filtered[emoji] = users;
                }
                if (Object.keys(filtered).length > 0) data[msgId] = filtered;
            }
            const key = CFG.REACTION_CACHE_PFX + this.collabCode;
            localStorage.setItem(key, JSON.stringify({ ts: Date.now(), reactions: data }));
        } catch (e) {}
    }

    _loadReactionsFromCache() {
        if (!this.collabCode) return;
        try {
            const key = CFG.REACTION_CACHE_PFX + this.collabCode;
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const entry = JSON.parse(raw);
            if (!entry || !entry.reactions) return;
            if (Date.now() - (entry.ts || 0) > CFG.REACTION_CACHE_TTL_MS) {
                localStorage.removeItem(key);
                return;
            }
            for (const [msgId, emojiMap] of Object.entries(entry.reactions)) {
                if (!this._reactions.has(msgId)) {
                    this._reactions.set(msgId, emojiMap);
                } else {
                    // 기존 리액션과 병합 (서버에서 온 것이 우선)
                    const existing = this._reactions.get(msgId);
                    for (const [emoji, users] of Object.entries(emojiMap)) {
                        if (!existing[emoji]) existing[emoji] = users;
                        else Object.assign(existing[emoji], users);
                    }
                }
            }
        } catch (e) {}
    }

    // ============================================================
    // [v2.5.0] 참가자 간 공유 캐시 · 분산 백업 — 전체 상태 동기화
    // ============================================================
    // 모든 협업 참가자의 브라우저가 문서+리액션+상태의 백업 복사본을 유지하여,
    // 호스트나 특정 참가자의 연결이 끊어져도 데이터 손실 없이 복구 가능.
    // 새 참가자가 들어올 때 호스트가 STATE_SYNC를 보내 기존 리액션/상태를 즉시 동기화.
    // 주기적으로 STATE_SYNC를 브로드캐스트하여 모든 참가자의 캐시를 최신으로 유지합니다.
    // ============================================================

    _buildStateSyncMessage() {
        // 리액션 직렬화 (빈 항목 제외)
        const reactionsData = {};
        for (const [msgId, emojiMap] of this._reactions) {
            const filtered = {};
            for (const [emoji, users] of Object.entries(emojiMap)) {
                if (Object.keys(users).length > 0) filtered[emoji] = users;
            }
            if (Object.keys(filtered).length > 0) reactionsData[msgId] = filtered;
        }

        // 원격 상태 직렬화
        const statusesData = {};
        for (const [cid, status] of this._remoteStatuses) {
            statusesData[cid] = status;
        }

        // 캐시에도 저장 (백업)
        this._saveReactionsToCache();
        this._saveFullStateToCache();

        // [v3.1.0] 블록 체인 요약 정보 포함
        let blockSummary = null;
        if (this._blockChain) {
            blockSummary = {
                length: this._blockChain.chain.length,
                latestHash: this._blockChain.getLatestBlock()?.hash || '0',
                latestIndex: this._blockChain.getLatestBlock()?.index || 0
            };
        }

        return {
            t: CFG.MSG_TYPES.STATE_SYNC,
            p: { reactions: reactionsData, statuses: statusesData, blockSummary },
            from: this.client_id,
            ts: Date.now()
        };
    }

    _handleStateSync(msg) {
        const p = msg && msg.p;
        if (!p) return;
        let changed = false;

        // [v3.1.0] 블록 체인 요약 수신 → 체인이 뒤쳐져 있으면 전체 체인 요청
        if (p.blockSummary && this._blockChain) {
            const localLength = this._blockChain.chain.length;
            const remoteLength = p.blockSummary.length || 0;
            if (remoteLength > localLength + 1) {
                // 상대방 체인이 현저히 앞서면 전체 체인 요청
                this._requestFullChain(msg.from);
            }
        }

        // 리액션 복원/병합
        if (p.reactions && typeof p.reactions === 'object') {
            for (const [msgId, emojiMap] of Object.entries(p.reactions)) {
                if (!emojiMap || typeof emojiMap !== 'object') continue;
                let msgReacts = this._reactions.get(msgId);
                if (!msgReacts) { msgReacts = {}; this._reactions.set(msgId, msgReacts); }
                for (const [emoji, users] of Object.entries(emojiMap)) {
                    if (!users || typeof users !== 'object') continue;
                    if (!msgReacts[emoji]) msgReacts[emoji] = {};
                    for (const [cid, nick] of Object.entries(users)) {
                        if (!msgReacts[emoji][cid]) {
                            msgReacts[emoji][cid] = nick;
                            changed = true;
                        }
                    }
                }
                if (changed) this._updateReactionsUI(msgId);
            }
        }

        // 원격 상태 복원/병합
        if (p.statuses && typeof p.statuses === 'object') {
            for (const [cid, status] of Object.entries(p.statuses)) {
                if (cid === this.client_id) continue;
                if (!this._remoteStatuses.has(cid)) {
                    this._remoteStatuses.set(cid, status);
                    changed = true;
                }
            }
            if (changed) this._updateUsersListUI();
        }

        // 로컬 캐시 업데이트
        if (changed) {
            this._saveReactionsToCache();
            this._saveFullStateToCache();
            // [v3.1.0] 상태 변화 시 새 블록 생성
            this._addStateBlock();
        }
    }

    // [v2.5.0] 전체 상태를 localStorage에 캐시 — 오프라인 복구/재연결 시 사용
    _saveFullStateToCache() {
        if (!this.collabCode) return;
        try {
            const reactionsData = {};
            for (const [msgId, emojiMap] of this._reactions) {
                const filtered = {};
                for (const [emoji, users] of Object.entries(emojiMap)) {
                    if (Object.keys(users).length > 0) filtered[emoji] = users;
                }
                if (Object.keys(filtered).length > 0) reactionsData[msgId] = filtered;
            }
            const statusesData = {};
            for (const [cid, status] of this._remoteStatuses) {
                statusesData[cid] = status;
            }
            const key = CFG.STATE_CACHE_PFX + this.collabCode;
            localStorage.setItem(key, JSON.stringify({
                ts: Date.now(),
                reactions: reactionsData,
                statuses: statusesData,
                users: (this.users || []).map(u => ({
                    client_id: u.client_id,
                    nickname: u.nickname,
                    isHost: u.isHost,
                    color_hue: u.color_hue
                }))
            }));
        } catch (e) {}
    }

    _loadFullStateFromCache() {
        if (!this.collabCode) return null;
        try {
            const key = CFG.STATE_CACHE_PFX + this.collabCode;
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry) return null;
            if (Date.now() - (entry.ts || 0) > CFG.STATE_CACHE_TTL_MS) {
                localStorage.removeItem(key);
                return null;
            }
            return entry;
        } catch (e) { return null; }
    }

    // [v2.5.0] 주기적 전체 상태 브로드캐스트
    _startStateSyncBroadcast() {
        this._stopStateSyncBroadcast();
        if (!this.isHost) return; // 호스트만 주기적 브로드캐스트
        this._stateSyncTimer = setInterval(() => {
            if (!this.transport || !this.mode || this.transport.closed) return;
            const msg = this._buildStateSyncMessage();
            if (msg) this.transport.send(msg);
        }, CFG.STATE_SYNC_INTERVAL);
    }

    _stopStateSyncBroadcast() {
        if (this._stateSyncTimer) {
            clearInterval(this._stateSyncTimer);
            this._stateSyncTimer = null;
        }
    }

    // ============================================================
    // === 읽음 확인 ===
    // ============================================================

    _sendReadReceipt(msgIds) {
        if (!this.transport || !this.mode || !msgIds.length) return;
        this.transport.send({
            t: CFG.MSG_TYPES.READ,
            p: { client_id: this.client_id, msgIds },
            from: this.client_id, ts: Date.now()
        });
    }

    _handleRead(msg) {
        const p = msg && msg.p;
        if (!p || !Array.isArray(p.msgIds)) return;
        p.msgIds.forEach(id => {
            let s = this._readBy.get(id);
            if (!s) { s = new Set(); this._readBy.set(id, s); }
            s.add(p.client_id);
            // 읽음 체크 아이콘 갱신
            const wrap = this._modalOverlay && this._modalOverlay.querySelector(`[data-msg-id="${id}"]`);
            const check = wrap && wrap.querySelector('.t2c-read-check');
            if (check) {
                check.classList.add('is-read');
                check.title = `${s.size}명이 읽음`;
                check.innerHTML = '<span class="material-icons">done_all</span>';
            }
        });
    }

    _sendReadReceiptsForVisible(overlay) {
        const container = overlay && overlay.querySelector('.t2c-chat-msgs');
        if (!container) return;
        const myMsgIds = [];
        container.querySelectorAll('.t2c-msg-other[data-msg-id]').forEach(el => {
            myMsgIds.push(el.dataset.msgId);
        });
        if (myMsgIds.length > 0) this._sendReadReceipt(myMsgIds);
    }

    // ============================================================
    // === 날짜 구분자 / 스크롤 버튼 ===
    // ============================================================

    _buildDateSep(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diffDays = Math.floor((now - d) / 86400000);
        let label;
        if (diffDays === 0) label = '오늘';
        else if (diffDays === 1) label = '어제';
        else label = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
        const sep = document.createElement('div');
        sep.className = 't2c-date-sep';
        sep.innerHTML = `<span>${label}</span>`;
        return sep;
    }

    _updateScrollBtn(overlay) {
        if (!overlay) return;
        const btn = overlay.querySelector('.t2c-scroll-btn');
        if (!btn) return;
        const badge = btn.querySelector('.t2c-scroll-badge');
        if (this._scrollUnread > 0) {
            btn.style.display = 'flex';
            if (badge) { badge.textContent = this._scrollUnread; badge.style.display = 'flex'; }
        } else {
            btn.style.display = 'none';
            if (badge) badge.style.display = 'none';
        }
    }

    // ============================================================
    // === 키보드 회피 (모바일) ===
    // ============================================================

    _installKeyboardAvoidance(overlay) {
        if (!window.visualViewport) return;
        const modal = overlay && overlay.querySelector('.t2-collab-modal');
        if (!modal) return;
        const handler = () => {
            const vvh = window.visualViewport.height;
            const vvOffsetTop = window.visualViewport.offsetTop;
            modal.style.maxHeight = `${Math.min(vvh - vvOffsetTop - 8, 760)}px`;
        };
        window.visualViewport && window.visualViewport.addEventListener('resize', handler);
        window.visualViewport && window.visualViewport.addEventListener('scroll', handler);
        overlay._vvCleanup = () => {
            window.visualViewport.removeEventListener('resize', handler);
            window.visualViewport.removeEventListener('scroll', handler);
            modal.style.maxHeight = '';
        };
    }

    _uninstallHostUnloadHandler() {
        if (!this._unloadHandler) return;
        window.removeEventListener('beforeunload', this._unloadHandler);
        window.removeEventListener('pagehide', this._unloadHandler);
        this._unloadHandler = null;
    }

    // ============================================================
    // [v3.1.0] 무결성 체인 · 분산 저장소 핵심 로직
    // ============================================================

    // 무결성 체인 · 분산 저장소 초기화
    async _initBlockChainAndStore() {
        if (!this.collabCode) return;
        try {
            // DistributedStore 초기화
            this._distributedStore = new DistributedStore(this.collabCode);
            await this._distributedStore.init();

            // BlockChain 초기화
            this._blockChain = new BlockChain(this.collabCode, this.client_id);

            // DistributedStore에서 기존 체인 복원 시도
            const savedChain = await this._distributedStore.getChain();
            if (savedChain && savedChain.length > 1) {
                const valid = await CryptoUtil.verifyChain(savedChain);
                if (valid) {
                    await this._blockChain.loadChain(savedChain);
                    this._chainHeight = this._blockChain.chain.length;
                    console.log('[Collab v3.1.0] chain restored from store, height:', this._chainHeight);
                    showToast('로컬 체인에서 상태를 복원했습니다.', 'info', 3000);
                }
            }

            // 체인이 비어있으면 초기화
            if (this._blockChain.chain.length === 0) {
                await this._blockChain.init();
            }
            this._chainHeight = this._blockChain.chain.length;

            // 첫 번째 상태 블록 생성
            await this._addStateBlock();

            // [v3.1.0] 자동 복구: 페이지 리로드 시 체인에서 상태 재구성
            await this._autoRecoverFromChain();
        } catch (e) {
            console.warn('[Collab v3.1.0] BlockChain/DistributedStore init failed:', e);
        }
    }

    // 상태 블록 추가
    async _addStateBlock() {
        if (!this._blockChain) return;
        try {
            // 리액션 직렬화
            const reactionsData = {};
            for (const [msgId, emojiMap] of this._reactions) {
                const filtered = {};
                for (const [emoji, users] of Object.entries(emojiMap)) {
                    if (Object.keys(users).length > 0) filtered[emoji] = users;
                }
                if (Object.keys(filtered).length > 0) reactionsData[msgId] = filtered;
            }

            // 상태 직렬화
            const statusesData = {};
            for (const [cid, status] of this._remoteStatuses) {
                statusesData[cid] = status;
            }

            // 문서 해시 계산
            let documentHash = '';
            try {
                const editorContent = this.editor?.editor?.innerHTML || '';
                documentHash = await CryptoUtil.hash(editorContent);
            } catch (e) {}

            // 채팅 해시 계산
            let chatHash = '';
            try {
                const recentChat = this._chatMessages.slice(-20);
                chatHash = await CryptoUtil.hash(JSON.stringify(recentChat));
            } catch (e) {}

            const block = await this._blockChain.addBlock({
                reactions: reactionsData,
                statuses: statusesData,
                documentHash,
                chatHash
            });

            this._chainHeight = this._blockChain.chain.length;

            // DistributedStore에 블록 저장
            if (this._distributedStore) {
                await this._distributedStore.saveBlock(block);
            }

            // UI 업데이트
            this._updateChainIndicatorUI();
        } catch (e) {
            console.warn('[Collab v3.1.0] addStateBlock failed:', e);
        }
    }

    // 블록 체인 동기화 브로드캐스트
    _startBlockSyncBroadcast() {
        this._stopBlockSyncBroadcast();
        if (!this.isHost) return; // 호스트만 브로드캐스트
        this._blockSyncTimer = setInterval(async () => {
            if (!this.transport || !this.mode || this.transport.closed) return;
            if (!this._blockChain) return;
            try {
                const summary = await this._blockChain.getChainSummary();
                const msg = {
                    t: CFG.MSG_TYPES.BLOCK_SYNC,
                    p: { summary, chain: this._blockChain.chain.slice(-10) },
                    from: this.client_id,
                    ts: Date.now()
                };
                this.transport.send(msg);
            } catch (e) {}
        }, CFG.BLOCK_SYNC_INTERVAL);
    }

    _stopBlockSyncBroadcast() {
        if (this._blockSyncTimer) {
            clearInterval(this._blockSyncTimer);
            this._blockSyncTimer = null;
        }
    }

    // 블록 체인 동기화 메시지 수신
    async _handleBlockSync(msg) {
        const p = msg && msg.p;
        if (!p || !this._blockChain) return;

        try {
            const remoteSummary = p.summary;
            const remoteBlocks = p.chain;

            if (!remoteSummary) return;

            // 원격 체인이 더 길면 포크 해결 시도
            if (remoteSummary.length > this._blockChain.chain.length && remoteBlocks) {
                const valid = await CryptoUtil.verifyChain(remoteBlocks);
                if (valid) {
                    await this._blockChain.resolveFork(remoteBlocks);
                    this._chainHeight = this._blockChain.chain.length;
                    this._updateChainIndicatorUI();

                    // DistributedStore에도 업데이트
                    if (this._distributedStore) {
                        for (const block of this._blockChain.chain) {
                            await this._distributedStore.saveBlock(block);
                        }
                    }
                } else {
                    // 검증 실패 → 전체 체인 요청
                    this._requestFullChain(msg.from);
                }
            }
        } catch (e) {
            console.warn('[Collab v3.1.0] handleBlockSync failed:', e);
        }
    }

    // 전체 체인 요청
    _requestFullChain(fromCid) {
        if (!this.transport || !this.mode) return;
        this._syncingChain = true;
        this._syncProgress = 10;
        this._updateSyncProgressUI();

        // CHUNK_REQ로 전체 체인 요청
        this.transport.send({
            t: CFG.MSG_TYPES.CHUNK_REQ,
            p: { type: 'fullchain', fromIndex: 0 },
            from: this.client_id,
            to: fromCid,
            ts: Date.now()
        });

        // 타임아웃: 10초 내에 응답 없으면 동기화 상태 해제
        setTimeout(() => {
            this._syncingChain = false;
            this._syncProgress = 0;
            this._updateSyncProgressUI();
        }, 10000);
    }

    // 청크 요청 수신
    async _handleChunkReq(msg) {
        const p = msg && msg.p;
        if (!p || !this._blockChain) return;

        try {
            if (p.type === 'fullchain') {
                const fromIndex = p.fromIndex || 0;
                const chain = this._blockChain.chain.slice(fromIndex);
                this.transport.send({
                    t: CFG.MSG_TYPES.CHUNK_RES,
                    p: { type: 'fullchain', chain, fromIndex },
                    from: this.client_id,
                    to: msg.from,
                    ts: Date.now()
                });
            }
        } catch (e) {}
    }

    // 청크 응답 수신
    async _handleChunkRes(msg) {
        const p = msg && msg.p;
        if (!p || !this._blockChain) return;

        try {
            if (p.type === 'fullchain' && p.chain) {
                this._syncProgress = 50;
                this._updateSyncProgressUI();

                const valid = await CryptoUtil.verifyChain(p.chain);
                if (valid) {
                    await this._blockChain.resolveFork(p.chain);
                    this._chainHeight = this._blockChain.chain.length;

                    // DistributedStore에 저장
                    if (this._distributedStore) {
                        for (const block of this._blockChain.chain) {
                            await this._distributedStore.saveBlock(block);
                        }
                    }

                    this._syncProgress = 100;
                    this._updateSyncProgressUI();
                    this._updateChainIndicatorUI();
                } else {
                    console.warn('[Collab v3.1.0] received chain is invalid');
                }
            }
        } catch (e) {
            console.warn('[Collab v3.1.0] handleChunkRes failed:', e);
        } finally {
            setTimeout(() => {
                this._syncingChain = false;
                this._syncProgress = 0;
                this._updateSyncProgressUI();
            }, 2000);
        }
    }

    // DistributedStore에 리액션 저장
    async _saveReactionsToDistributedStore() {
        if (!this._distributedStore || !this.collabCode) return;
        try {
            const reactionsData = {};
            for (const [msgId, emojiMap] of this._reactions) {
                const filtered = {};
                for (const [emoji, users] of Object.entries(emojiMap)) {
                    if (Object.keys(users).length > 0) filtered[emoji] = users;
                }
                if (Object.keys(filtered).length > 0) reactionsData[msgId] = filtered;
            }
            await this._distributedStore.saveState('reactions', { ts: Date.now(), reactions: reactionsData });
        } catch (e) {}
    }

    // 블록체인을 DistributedStore에 저장
    async _saveBlockChainToStore() {
        if (!this._distributedStore || !this._blockChain) return;
        try {
            for (const block of this._blockChain.chain) {
                await this._distributedStore.saveBlock(block);
            }
            await this._distributedStore.saveState('chainMeta', {
                height: this._blockChain.chain.length,
                lastSaved: Date.now()
            });
        } catch (e) {}
    }

    // 체인에서 자동 복구
    async _autoRecoverFromChain() {
        if (!this._blockChain || !this._distributedStore) return;
        try {
            const chainMeta = await this._distributedStore.loadState('chainMeta');
            if (!chainMeta || !chainMeta.height) return;

            // 체인이 유효하면 마지막 블록에서 리액션/상태 복원
            const latestBlock = this._blockChain.getLatestBlock();
            if (!latestBlock || !latestBlock.data) return;

            // 리액션 복원 (기존 리액션과 병합)
            if (latestBlock.data.reactions && typeof latestBlock.data.reactions === 'object') {
                for (const [msgId, emojiMap] of Object.entries(latestBlock.data.reactions)) {
                    if (!emojiMap || typeof emojiMap !== 'object') continue;
                    let msgReacts = this._reactions.get(msgId);
                    if (!msgReacts) { msgReacts = {}; this._reactions.set(msgId, msgReacts); }
                    for (const [emoji, users] of Object.entries(emojiMap)) {
                        if (!users || typeof users !== 'object') continue;
                        if (!msgReacts[emoji]) msgReacts[emoji] = {};
                        for (const [cid, nick] of Object.entries(users)) {
                            if (!msgReacts[emoji][cid]) {
                                msgReacts[emoji][cid] = nick;
                            }
                        }
                    }
                }
            }

            // 상태 복원
            if (latestBlock.data.statuses && typeof latestBlock.data.statuses === 'object') {
                for (const [cid, status] of Object.entries(latestBlock.data.statuses)) {
                    if (cid !== this.client_id) {
                        this._remoteStatuses.set(cid, status);
                    }
                }
            }
        } catch (e) {
            console.warn('[Collab v3.1.0] autoRecoverFromChain failed:', e);
        }
    }

    // 오프라인 큐 재생 — 재연결 시 호출
    async _replayOfflineQueue() {
        if (this._offlineQueue.length === 0) return;
        const queue = this._offlineQueue.splice(0);
        console.log('[Collab v3.1.0] replaying offline queue:', queue.length, 'operations');

        for (const op of queue) {
            try {
                if (op.type === 'react') {
                    this._sendReaction(op.msgId, op.emoji);
                } else if (op.type === 'edit') {
                    if (this.transport) {
                        const content = this.editor?.editor?.innerHTML || '';
                        const domState = extractDOMState(content);
                        this.transport.send({
                            t: CFG.MSG_TYPES.FULL,
                            p: { content, domState, stabilityMode: this.stabilityMode },
                            from: this.client_id, ts: Date.now()
                        });
                    }
                } else if (op.type === 'chat') {
                    if (this.transport) {
                        this.transport.send(op.msg);
                    }
                }
            } catch (e) {}
        }

        // 오프라인 큐의 연산을 새 블록으로 기록
        await this._addStateBlock();
        this._updateOfflineUI();
    }

    // ── [v3.1.0] UI 업데이트 메서드 ──

    // 체인 인디케이터 UI 업데이트
    _updateChainIndicatorUI() {
        if (!this._modalOverlay) return;
        const indicator = this._modalOverlay.querySelector('.t2c-chain-indicator');
        if (!indicator) return;
        const height = this._blockChain ? this._blockChain.chain.length : 0;
        indicator.querySelector('.t2c-chain-height') &&
            (indicator.querySelector('.t2c-chain-height').textContent = height);
        const integrityBadge = indicator.querySelector('.t2c-integrity-badge');
        if (integrityBadge) {
            if (this._blockChain && this._blockChain.chain.length > 0) {
                integrityBadge.classList.add('is-valid');
                integrityBadge.textContent = '✓ 무결성 확인';
            }
        }
    }

    // 동기화 진행률 UI 업데이트
    _updateSyncProgressUI() {
        if (!this._modalOverlay) return;
        const progressBar = this._modalOverlay.querySelector('.t2c-sync-progress-bar');
        const syncLabel = this._modalOverlay.querySelector('.t2c-sync-label');
        if (progressBar) {
            progressBar.style.width = this._syncProgress + '%';
            progressBar.style.display = this._syncingChain ? 'block' : 'none';
        }
        if (syncLabel) {
            syncLabel.textContent = this._syncingChain ? '체인 동기화 중…' : '';
            syncLabel.style.display = this._syncingChain ? 'inline' : 'none';
        }
    }

    // 오프라인 UI 업데이트
    _updateOfflineUI() {
        if (!this._modalOverlay) return;
        const badge = this._modalOverlay.querySelector('.t2c-offline-badge');
        if (!badge) return;
        if (this._isOffline && this._offlineQueue.length > 0) {
            badge.style.display = 'inline-flex';
            badge.textContent = `오프라인: ${this._offlineQueue.length}개 대기`;
        } else if (this._isOffline) {
            badge.style.display = 'inline-flex';
            badge.textContent = '오프라인';
        } else {
            badge.style.display = 'none';
        }
    }

    // 연결 품질 UI 업데이트 (모드 배지에 추가 정보 표시)
    _updateConnectionQualityUI() {
        if (!this._modalOverlay) return;
        const modeBadges = this._modalOverlay.querySelectorAll('.t2-collab-mode-badge');
        const peerCount = this.users ? this.users.length : 0;
        const chainHeight = this._chainHeight || 0;
        modeBadges.forEach(badge => {
            const extra = badge.querySelector('.t2c-quality-info');
            if (!extra) return;
            extra.textContent = `${peerCount}명 · 체인 ${chainHeight}`;
        });
    }

    // ── [v3.1.0] 보안/연결 정보 팝업 데이터 채우기 ──
    async _populateSecurityData(overlay) {
        if (!overlay) return;

        const setText = (cls, text) => {
            const el = overlay.querySelector('.' + cls);
            if (el) el.textContent = text;
        };
        const setHTML = (cls, html) => {
            const el = overlay.querySelector('.' + cls);
            if (el) el.innerHTML = html;
        };

        // ── SmartLink ──
        const isConnected = !!(this.transport && this.mode);
        const connStatus = isConnected ? '<span class="t2c-svc-ok">연결됨</span>' : '<span class="t2c-svc-warn">미연결</span>';
        setHTML('t2c-svc-smartlink-status', connStatus);
        const modeLabel = this.mode === 'p2p' ? 'P2P 직접 연결' : this.mode === 'php' ? 'PHP 서버 중계' : '—';
        setText('t2c-svc-smartlink-mode', modeLabel);
        const latency = this.latency || 0;
        const latencyLabel = latency > 0 ? `${latency}ms` + (latency < 100 ? ' (우수)' : latency < 300 ? ' (양호)' : ' (느림)') : '측정 중…';
        setText('t2c-svc-smartlink-latency', latencyLabel);
        const peerCount = this.users ? this.users.length : 0;
        setText('t2c-svc-smartlink-peers', peerCount > 0 ? `${peerCount}명` : '—');

        // ── MeshCDN ──
        const hasCache = this._stateSyncTimer || this.mode === 'p2p';
        setHTML('t2c-svc-meshcdn-cache', hasCache ? '<span class="t2c-svc-ok">활성</span>' : '<span class="t2c-svc-warn">비활성</span>');
        setText('t2c-svc-meshcdn-interval', `${CFG.STATE_SYNC_INTERVAL / 1000}초`);
        const lastSyncEl = overlay.querySelector('.t2c-svc-meshcdn-lastsync');
        if (lastSyncEl) {
            try {
                const cached = memStore.getItem(CFG.STATE_CACHE_PFX + this.collabCode);
                lastSyncEl.textContent = cached ? '최근 동기화됨' : '대기 중';
            } catch (e) { lastSyncEl.textContent = '—'; }
        }

        // ── TrustChain ──
        const chainHeight = this._blockChain ? this._blockChain.chain.length : 0;
        setText('t2c-svc-trustchain-height', chainHeight > 0 ? `${chainHeight} 블록` : '—');
        let integrityOk = false;
        if (this._blockChain && chainHeight > 0) {
            try {
                integrityOk = await this._blockChain.validateChain();
            } catch (e) { integrityOk = false; }
        }
        setHTML('t2c-svc-trustchain-integrity',
            integrityOk ? '<span class="t2c-svc-ok">✓ 검증 완료</span>' :
            (chainHeight > 0 ? '<span class="t2c-svc-err">✗ 오류</span>' : '<span class="t2c-svc-warn">체인 없음</span>'));
        const latestBlock = this._blockChain ? this._blockChain.getLatestBlock() : null;
        setText('t2c-svc-trustchain-hash', latestBlock ? latestBlock.hash.substring(0, 16) + '…' : '—');
        let merkleRoot = '—';
        if (this._blockChain && chainHeight > 0) {
            try {
                merkleRoot = (await this._blockChain.getMerkleRoot()).substring(0, 16) + '…';
            } catch (e) {}
        }
        setText('t2c-svc-trustchain-merkle', merkleRoot);

        // ── VaultSync ──
        if (this._distributedStore) {
            setText('t2c-svc-vaultsync-storage', this._distributedStore._useLocalStorage ? 'localStorage (폴백)' : 'IndexedDB');
            try {
                const chain = await this._distributedStore.getChain();
                setText('t2c-svc-vaultsync-blocks', chain ? `${chain.length}개` : '0개');
            } catch (e) { setText('t2c-svc-vaultsync-blocks', '—'); }
            setText('t2c-svc-vaultsync-chunks', this._distributedStore._useLocalStorage ? 'N/A' : 'IndexedDB 사용 중');
        } else {
            setText('t2c-svc-vaultsync-storage', '미초기화');
            setText('t2c-svc-vaultsync-blocks', '—');
            setText('t2c-svc-vaultsync-chunks', '—');
        }

        // ── OfflineBridge ──
        if (this._isOffline) {
            setHTML('t2c-svc-offlinebridge-status', '<span class="t2c-svc-warn">오프라인</span>');
            setText('t2c-svc-offlinebridge-queue', `${this._offlineQueue.length}개 대기`);
        } else {
            setHTML('t2c-svc-offlinebridge-status', '<span class="t2c-svc-ok">온라인</span>');
            setText('t2c-svc-offlinebridge-queue', '0개');
        }

        // ── CryptoCore ──
        let hasWebCrypto = false;
        try { hasWebCrypto = !!(crypto && crypto.subtle); } catch (e) {}
        setText('t2c-svc-cryptocore-algo', 'SHA-256');
        setHTML('t2c-svc-cryptocore-webcrypto',
            hasWebCrypto ? '<span class="t2c-svc-ok">사용 가능</span>' : '<span class="t2c-svc-warn">폴백 모드</span>');

        // ── HybridConnect ──
        const activeMode = this.mode === 'p2p' ? 'P2P' : this.mode === 'php' ? 'PHP' : '—';
        setText('t2c-svc-hybridconnect-mode', activeMode);
        const isStability = !!(this.transport && this.transport._stabilityMode);
        setHTML('t2c-svc-hybridconnect-stability', isStability ? '<span class="t2c-svc-ok">활성</span>' : '비활성');
        setHTML('t2c-svc-hybridconnect-php',
            this.mode === 'php' ? '<span class="t2c-svc-ok">활성 (주 채널)</span>' :
            (isStability ? '<span class="t2c-svc-ok">백업 활성</span>' : '비활성'));

        // ── ReactionSync ──
        let activeReactionCount = 0;
        if (this._reactions) {
            this._reactions.forEach(msgReactions => {
                msgReactions.forEach(userMap => { activeReactionCount += userMap.size; });
            });
        }
        setText('t2c-svc-reactionsync-count', `${activeReactionCount}건`);
        setHTML('t2c-svc-reactionsync-status',
            isConnected ? '<span class="t2c-svc-ok">실시간 동기화 중</span>' : '<span class="t2c-svc-warn">대기 중</span>');

        // ── 개요 텍스트 동적 업데이트 ──
        const overviewText = overlay.querySelector('.t2c-security-overview-text strong');
        if (overviewText) {
            if (!isConnected) {
                overviewText.textContent = '연결이 설정되지 않았습니다';
            } else if (this._isOffline) {
                overviewText.textContent = '오프라인 모드 — 연결 복구 시 자동 동기화됩니다';
            } else if (integrityOk) {
                overviewText.textContent = '이 협업 세션은 안전합니다';
            } else {
                overviewText.textContent = '무결성 검증이 필요합니다';
            }
        }
    }
}

// ============================================================
// 7. 등록
// ============================================================

window.T2CollabPlugin = T2CollabPlugin;

// [FIX] DOMContentLoaded 가 이미 발생한 이후 스크립트가 평가되면 기존엔 등록이 누락되었고,
//       일부 환경에서는 이 IIFE 가 두 번 로드(例: defer/non-defer 동시, 테마 내 캡쳐)되어
//       하나의 container 에 plugin 이 두 번 등록 → 참가하기 팝업이 두 번 번줦이는 원인이 되었음.
//       이제는 동일 container 당 1회 등록, ready 상태에서도 즉시 동작, IIFE 이중 로드 가드를 가진다.
function __t2collab_bootstrap() {
    if (window.__t2collab_bootstrapped) return;
    window.__t2collab_bootstrapped = true;

    const tryRegister = () => {
        const containers = document.querySelectorAll('.t2-editor-container');
        containers.forEach(container => {
            if (container.dataset.t2collabBound === '1') return;
            const editorId = container.id.replace('_container', '');
            const editorInstance = window[editorId + '_editor'];
            if (editorInstance && typeof editorInstance.getPlugin === 'function' &&
                !editorInstance.getPlugin('collab')) {
                const p = new T2CollabPlugin(editorInstance);
                editorInstance.registerPlugin('collab', p);
                container.dataset.t2collabBound = '1';
            }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryRegister, { once: true });
    } else {
        // 이미 DOM 준비됨
        tryRegister();
    }
}
__t2collab_bootstrap();

})();