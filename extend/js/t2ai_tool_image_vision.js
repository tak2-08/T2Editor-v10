// Path: T2Editor/extend/js/t2ai_tool_image_vision.js
//
// T2Editor AI Tool — read_image_blocks
// ============================================================================
// VLLM(비전 지원 LLM)이 문서에 이미 삽입된 이미지 블록을 "볼" 수 있도록,
// 이미지 블록의 URL·크기·설명과, 필요하면 base64 data URL까지 반환한다.
//
// image 플러그인의 소스코드는 건드리지 않는다 — 렌더링된 DOM(t2-image-block)만
// 읽는다. 실제로 이미지를 "이해"하는 것은 이 Tool을 호출하는 바깥의 비전 LLM이며,
// 이 파일은 그 LLM이 이미지에 접근할 수 있는 형태로 데이터를 정리해 건네줄 뿐이다.
//
// base64 모드는 대상 이미지 서버가 CORS를 허용해야 동작한다(허용하지 않으면
// 명확한 에러로 알려준다) — 이 파일이 어떻게 해도 우회할 수 없는 브라우저 보안
// 제약이므로, 그 경우 url 모드(기본값)를 그대로 비전 LLM에 넘기는 편이 낫다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 read_image_blocks 등록을 건너뜁니다.');
        return;
    }

    async function toBase64DataUrl(url) {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`이미지 fetch 실패: HTTP ${res.status}`);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('base64 인코딩 실패'));
            reader.readAsDataURL(blob);
        });
    }

    function collectImageBlocks(editor) {
        const blocks = Array.from(editor.editor.children);
        const out = [];
        blocks.forEach((el, idx) => {
            if (!el.classList || !el.classList.contains('t2-image-block')) return;
            const img = el.querySelector('img');
            if (!img) return;
            out.push({
                blockIndex: idx,
                url: img.getAttribute('src') || '',
                alt: img.getAttribute('alt') || '',
                width: img.naturalWidth || null,
                height: img.naturalHeight || null,
            });
        });
        return out;
    }

    T2AITools.register({
        name: 'read_image_blocks',
        description: '문서 내 이미지 블록들을 VLLM(비전 LLM)이 볼 수 있는 형태로 반환한다. 기본은 이미지 URL만 반환하고(대부분의 비전 LLM API가 URL을 직접 받을 수 있음), format:"base64" 지정 시 픽셀 데이터를 data URL로 인코딩해 함께 반환한다(대상 서버가 CORS 허용해야 함).',
        params: {
            blockIndex: '선택: 특정 블록 인덱스 하나만 조회 (search_document 결과의 blockIndex 재사용 가능). 생략 시 문서 내 모든 이미지 블록.',
            format: '선택: "url"(기본, URL만) | "base64"(data URL로 인코딩해 포함 — 비용이 크므로 필요할 때만)',
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id.',
        },
        source: 't2ai_tool_image_vision.js',
        ui: {
            label: '이미지 인식(비전)',
            icon: 'visibility',
            description: '문서에 이미 들어있는 이미지들을 AI가 볼 수 있게 읽어와요. AI가 비전 기능을 지원해야 해요.',
            usage: '예: "문서에 있는 사진들 설명해줘"처럼 이미지 이해가 필요할 때 자동으로 읽어와 답변에 반영해요.',
        },
        async run(args) {
            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { images: [], message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

            let images = collectImageBlocks(editor);

            if (args.blockIndex !== undefined && args.blockIndex !== null && args.blockIndex !== '') {
                const wantIdx = parseInt(args.blockIndex, 10);
                images = images.filter(im => im.blockIndex === wantIdx);
                if (!images.length) return { images: [], message: `blockIndex ${wantIdx} 에 이미지 블록이 없습니다.` };
            }

            if (args.format === 'base64') {
                for (const im of images) {
                    try {
                        im.dataUrl = await toBase64DataUrl(im.url);
                    } catch (e) {
                        im.dataUrl = null;
                        im.encodeError = e.message;
                    }
                }
            }

            return { images, total: images.length };
        },
    });
})();
