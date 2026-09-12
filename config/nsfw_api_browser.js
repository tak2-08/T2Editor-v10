/**
Path: T2Editor/config/nsfw_api_browser.js
 * T2Editor NSFW Browser API
 * - 기존 자체 UI 없음
 * - 기존 이미지 플러그인 UI에만 결과를 공급
 * - 엔진: nsfwjs + TensorFlow.js
 * - 기본 모델: MobileNetV2Mid (graph)
 * - 기본 런타임: 자체 호스팅 정적 자산
 * - 백엔드 우선순위: webgpu -> webgl -> wasm -> cpu
 */

const DEFAULTS = {
  model: 'MobileNetV2Mid',
  modelUrl: null,
  modelType: 'graph',
  modelFilesAvailable: true,
  missingModelFiles: [],
  topK: 5,
  backendPriority: ['webgpu', 'webgl', 'wasm', 'cpu'],
  useProdMode: true,
  wasmThreads: 0,
  assets: null,
  thresholds: {
    unsafeExplicit: 0.20,
    unsafeCombined: 0.70,
    suspectExplicit: 0.08,
    suspectCombined: 0.35,
    suspectSexy: 0.30
  }
};

const SCRIPT_CACHE = new Map();
const MODULE_URL = (() => {
  try { return import.meta.url || ''; } catch (_) { return ''; }
})();

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getEditorBaseUrl() {
  // 정적 자산은 API 엔드포인트(T2EDITOR_URL)가 아니라 실제 활성 런타임 자산
  // 루트(T2EDITOR_ASSET_URL)를 우선한다. 데이터 슬롯/서브폴더 CMS에서 두 URL은
  // 서로 다를 수 있다.
  if (typeof window !== 'undefined') {
    const configured = window.T2EDITOR_NSFW_ASSET_BASE || window.T2EDITOR_ASSET_URL;
    if (configured) return stripTrailingSlash(configured).replace(/\/vendor$/, '');
  }

  // 이 모듈 위치는 <T2Editor>/config/nsfw_api_browser.js 이므로 한 단계 상위가
  // T2Editor 루트다. 기존 ../.. 계산은 CMS/사이트 루트까지 올라가는 오류였다.
  if (MODULE_URL) {
    try { return stripTrailingSlash(new URL('..', MODULE_URL).href); } catch (_) { /* ignore */ }
  }

  if (typeof window !== 'undefined' && window.T2EDITOR_URL) {
    return stripTrailingSlash(window.T2EDITOR_URL);
  }

  if (typeof document !== 'undefined' && document.baseURI) {
    try { return stripTrailingSlash(new URL('./t2editor/', document.baseURI).href); } catch (_) { /* ignore */ }
  }

  return '/t2editor';
}

function resolveResourceUrl(value, baseUrl = getEditorBaseUrl()) {
  if (typeof value !== 'string' || value.trim() === '') return value;
  const raw = value.trim();
  if (/^(?:https?:|data:|blob:|indexeddb:|localstorage:)/i.test(raw)) return raw;
  if (raw.startsWith('//')) {
    const protocol = typeof location !== 'undefined' ? location.protocol : 'https:';
    return protocol + raw;
  }
  try {
    const pageBase = typeof location !== 'undefined' && location.href ? location.href : baseUrl + '/';
    if (raw.startsWith('/')) return new URL(raw, pageBase).href;
    return new URL(raw, stripTrailingSlash(baseUrl) + '/').href;
  } catch (_) {
    return raw;
  }
}

function getDefaultAssets() {
  const base = `${getEditorBaseUrl()}/vendor`;
  return {
    tfjs: `${base}/tfjs/tf.min.js`,
    webgl: `${base}/tfjs-backend-webgl/tf-backend-webgl.min.js`,
    webgpu: `${base}/tfjs-backend-webgpu/tf-backend-webgpu.min.js`,
    wasm: `${base}/tfjs-backend-wasm/tf-backend-wasm.min.js`,
    wasmBase: `${base}/tfjs-backend-wasm/`,
    nsfwjs: `${base}/nsfwjs/nsfwjs.min.js`
  };
}

function resolveAssets(customAssets) {
  const merged = { ...getDefaultAssets(), ...(customAssets || {}) };
  for (const key of ['tfjs', 'webgl', 'webgpu', 'wasm', 'nsfwjs']) {
    merged[key] = resolveResourceUrl(merged[key]);
  }
  merged.wasmBase = stripTrailingSlash(resolveResourceUrl(merged.wasmBase)) + '/';
  return merged;
}

function isProbablyUrl(value) {
  return typeof value === 'string' && /(^https?:\/\/)|(^\/)|(^\.\/)|(^\.\.\/)|(^indexeddb:\/\/)|(^localstorage:\/\/)/i.test(value);
}

function loadScriptOnce(src) {
  if (!src) {
    return Promise.reject(new Error('Script path is empty.'));
  }

  if (SCRIPT_CACHE.has(src)) {
    return SCRIPT_CACHE.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-t2-nsfw-src="${src}"]`);
    if (existing && existing.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.t2NsfwSrc = src;

    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
    };

    script.onload = () => {
      script.dataset.loaded = 'true';
      cleanup();
      resolve();
    };

    script.onerror = () => {
      cleanup();
      SCRIPT_CACHE.delete(src);
      reject(new Error(`Script load failed: ${src}`));
    };

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  SCRIPT_CACHE.set(src, promise);
  return promise;
}

function toPredictionMap(predictions) {
  const map = Object.create(null);
  for (const item of Array.isArray(predictions) ? predictions : []) {
    if (!item || typeof item.className !== 'string') continue;
    map[item.className.toLowerCase()] = clamp01(Number(item.probability || 0));
  }
  return map;
}

function buildAssessment(predictions, backend, options) {
  const sorted = [...(predictions || [])].sort((a, b) => (b?.probability || 0) - (a?.probability || 0));
  const topPrediction = sorted[0] || null;
  const scoreMap = toPredictionMap(sorted);

  const porn = scoreMap.porn || 0;
  const hentai = scoreMap.hentai || 0;
  const sexy = scoreMap.sexy || 0;
  const neutral = scoreMap.neutral || 0;
  const drawing = scoreMap.drawing || 0;

  const explicitScore = clamp01(porn + hentai);
  const nsfwScore = clamp01(explicitScore + sexy);
  const safeScore = clamp01(neutral + drawing);
  const thresholds = options.thresholds || DEFAULTS.thresholds;

  let label = 'safe';
  let prob = safeScore;

  if (explicitScore >= thresholds.unsafeExplicit || nsfwScore >= thresholds.unsafeCombined) {
    label = 'unsafe';
    prob = Math.max(explicitScore, nsfwScore, porn, hentai);
  } else if (
    explicitScore >= thresholds.suspectExplicit ||
    nsfwScore >= thresholds.suspectCombined ||
    sexy >= thresholds.suspectSexy
  ) {
    label = 'suspect';
    prob = Math.max(explicitScore, nsfwScore, sexy);
  }

  const topProb = clamp01(Number(topPrediction?.probability || 0));
  const confidence = topProb >= 0.85 ? 'high' : topProb >= 0.55 ? 'medium' : 'low';

  return {
    ok: true,
    label,
    prob,
    confidence,
    backend: backend || null,
    explicitScore,
    nsfwScore,
    sexyScore: sexy,
    safeScore,
    topPrediction,
    predictions: sorted,
    classes: {
      porn,
      hentai,
      sexy,
      neutral,
      drawing
    }
  };
}

class NSFWFilterAPI {
  constructor(options = {}) {
    this.options = {
      ...DEFAULTS,
      ...options,
      modelUrl: resolveResourceUrl(options.modelUrl || null),
      modelFilesAvailable: options.modelFilesAvailable !== false,
      missingModelFiles: Array.isArray(options.missingModelFiles) ? options.missingModelFiles.slice() : [],
      assets: resolveAssets(options.assets || (typeof window !== 'undefined' ? window.T2EDITOR_NSFW_RUNTIME_ASSETS : null)),
      thresholds: {
        ...DEFAULTS.thresholds,
        ...(options.thresholds || {})
      }
    };

    this._tf = null;
    this._nsfwjs = null;
    this._model = null;
    this._backend = null;
    this._loadPromise = null;
    this._onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  }

  _reportProgress(percent, message, stage) {
    if (typeof this._onProgress === 'function') {
      try {
        this._onProgress({ percent, message, stage });
      } catch (_) { /* ignore */ }
    }
  }

  async load() {
    if (this._model) return this;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const assets = this.options.assets;

      if (!this.options.modelFilesAvailable) {
        const missing = this.options.missingModelFiles.filter(Boolean);
        const detail = missing.length ? ` Missing: ${missing.join(', ')}` : '';
        const target = this.options.modelUrl ? ` Model URL: ${this.options.modelUrl}` : '';
        throw new Error(`[T2NSFW] The local NSFW model package is incomplete.${detail}${target}`);
      }

      this._reportProgress(5, 'Loading TensorFlow.js', 'loading-tfjs');
      await loadScriptOnce(assets.tfjs);

      const tf = window.tf;
      if (!tf) {
        throw new Error('Cannot find TensorFlow.js global object (tf).');
      }

      this._reportProgress(30, 'Setting up inference backend', 'tfjs-loaded');

      if (this.options.useProdMode && typeof tf.enableProdMode === 'function') {
        try {
          tf.enableProdMode();
        } catch (error) {
          console.warn('[T2NSFW] tf.enableProdMode failed:', error);
        }
      }

      await this._registerOptionalBackends(tf, assets);
      this._reportProgress(50, 'Initializing backend', 'backends-registered');

      await tf.ready();
      this._reportProgress(60, 'Loading NSFWJS', 'tf-ready');

      const selectedBackend = await this._selectBackend(tf);

      await loadScriptOnce(assets.nsfwjs);
      const nsfwjs = window.nsfwjs || window.NSFWJS;
      if (!nsfwjs || typeof nsfwjs.load !== 'function') {
        throw new Error('Cannot find nsfwjs global object.');
      }

      this._reportProgress(75, 'Loading AI model', 'loading-model');

      const loadTarget = this.options.modelUrl || this.options.model || 'MobileNetV2Mid';
      const loadOptions = {};
      if (isProbablyUrl(loadTarget) && this.options.modelType) {
        loadOptions.type = this.options.modelType;
      }

      let model;
      try {
        model = await nsfwjs.load(loadTarget, loadOptions);
      } catch (cause) {
        const reason = cause && cause.message ? cause.message : String(cause || 'unknown error');
        const error = new Error(`[T2NSFW] Failed to load the NSFW model from ${loadTarget}. Check the CMS asset URL, web-server access, and model shard files. ${reason}`);
        try { error.cause = cause; } catch (_) { /* old browser */ }
        throw error;
      }

      this._reportProgress(100, 'Ready', 'done');

      this._tf = tf;
      this._nsfwjs = nsfwjs;
      this._model = model;
      this._backend = selectedBackend || tf.getBackend();

      return this;
    })().catch((error) => {
      // A corrected asset path or repaired deployment must be retryable without
      // recreating the whole editor instance.
      this._loadPromise = null;
      throw error;
    });

    return this._loadPromise;
  }

  async _registerOptionalBackends(tf, assets) {
    const priorities = Array.isArray(this.options.backendPriority) ? this.options.backendPriority : DEFAULTS.backendPriority;

    const requested = new Set(priorities);
    if (requested.has('webgl')) {
      try {
        await loadScriptOnce(assets.webgl);
      } catch (error) {
        console.warn('[T2NSFW] webgl backend load failed:', error);
      }
    }

    if (requested.has('webgpu')) {
      const webgpuAvailable = typeof navigator !== 'undefined' && !!navigator.gpu;
      if (webgpuAvailable) {
        try {
          await loadScriptOnce(assets.webgpu);
        } catch (error) {
          console.warn('[T2NSFW] webgpu backend load failed:', error);
        }
      } else {
        console.info('[T2NSFW] navigator.gpu not supported — skipping webgpu backend.');
      }
    }

    if (requested.has('wasm')) {
      try {
        await loadScriptOnce(assets.wasm);
        if (tf.wasm && typeof tf.wasm.setWasmPaths === 'function') {
          tf.wasm.setWasmPaths(assets.wasmBase);
        }
        if (this.options.wasmThreads > 0 && tf.wasm && typeof tf.wasm.setThreadsCount === 'function') {
          tf.wasm.setThreadsCount(this.options.wasmThreads);
        }
      } catch (error) {
        console.warn('[T2NSFW] wasm backend load failed:', error);
      }
    }
  }

  async _selectBackend(tf) {
    const priorities = Array.isArray(this.options.backendPriority) ? this.options.backendPriority : DEFAULTS.backendPriority;

    for (const candidate of priorities) {
      if (candidate === 'webgpu' && (typeof navigator === 'undefined' || !navigator.gpu)) {
        continue;
      }

      try {
        const changed = await tf.setBackend(candidate);
        await tf.ready();
        if (changed || tf.getBackend() === candidate) {
          return tf.getBackend();
        }
      } catch (error) {
        console.warn(`[T2NSFW] backend switch failed: ${candidate}`, error);
      }
    }

    return tf.getBackend();
  }

  async classify(input, heatmap = false) {
    void heatmap;
    await this.load();

    const source = await this._normalizeInput(input);
    try {
      const predictions = await this._model.classify(source, this.options.topK);
      return buildAssessment(predictions, this._backend, this.options);
    } finally {
      this._cleanupSource(source, input);
    }
  }

  async classifyWithHeatmap(input) {
    return this.classify(input, true);
  }

  async _normalizeInput(input) {
    if (!input) {
      throw new Error('Image input is empty.');
    }

    if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
      if (!input.complete) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            input.removeEventListener('load', onLoad);
            input.removeEventListener('error', onError);
            resolve();
          };
          const onError = (event) => {
            input.removeEventListener('load', onLoad);
            input.removeEventListener('error', onError);
            reject(event);
          };
          input.addEventListener('load', onLoad, { once: true });
          input.addEventListener('error', onError, { once: true });
        });
      }
      return input;
    }

    if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
      return input;
    }

    if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
      return input;
    }

    if (input instanceof Blob || input instanceof File) {
      // Animated GIFs can advance frames while tf.browser.fromPixels() is reading
      // the element, producing an inconsistent tensor shape on some browsers/backends.
      // Freeze the currently decoded first frame into a canvas for inspection only;
      // the original GIF file is still uploaded unchanged.
      const name = (typeof File !== 'undefined' && input instanceof File) ? String(input.name || '') : '';
      const isGif = String(input.type || '').toLowerCase() === 'image/gif' || /\.gif$/i.test(name);
      return isGif ? this._blobToStaticCanvas(input) : this._blobToImage(input);
    }

    if (typeof input === 'string') {
      return this._urlToImage(input);
    }

    throw new Error('Unsupported image input format.');
  }

  _cleanupSource(source, originalInput) {
    if (source && source !== originalInput && source.dataset && source.dataset.t2ObjectUrl) {
      URL.revokeObjectURL(source.dataset.t2ObjectUrl);
    }
  }

  _blobToStaticCanvas(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        try {
          const sourceWidth = Math.max(1, Number(img.naturalWidth || img.width || 0));
          const sourceHeight = Math.max(1, Number(img.naturalHeight || img.height || 0));
          const maxDimension = 2048;
          const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
          if (!ctx) throw new Error('Cannot create canvas context for GIF inspection.');
          ctx.drawImage(img, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
          URL.revokeObjectURL(objectUrl);
          resolve(canvas);
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };
      img.onerror = (event) => {
        URL.revokeObjectURL(objectUrl);
        reject(event instanceof Error ? event : new Error('GIF frame decoding failed.'));
      };
      img.src = objectUrl;
    });
  }

  _blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.dataset.t2ObjectUrl = objectUrl;
      img.onload = () => resolve(img);
      img.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      };
      img.src = objectUrl;
    });
  }

  _urlToImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  getBackend() {
    return this._backend;
  }

  dispose() {
    try {
      if (this._model && typeof this._model.dispose === 'function') {
        this._model.dispose();
      }
    } catch (error) {
      console.warn('[T2NSFW] model dispose failed:', error);
    }
    this._model = null;
    this._loadPromise = null;
  }
}

export default NSFWFilterAPI;