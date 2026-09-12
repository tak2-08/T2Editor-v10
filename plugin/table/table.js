// T2Editor/plugin/table/table.js

class T2TablePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertTable'];

        // [SEC/IDEMPOTENT] editor.lib.php가 setContent 후 플러그인 초기화를
        // fallback으로 한 번 더 호출할 수 있으므로, 셀/테이블 이벤트를 WeakSet으로
        // 멱등 처리한다.
        this._cellsWithEditing = new WeakSet();
        this._tablesWithResizing = new WeakSet();
        this._controlsWithEvents = new WeakSet();
        this._tableSelections = new WeakMap();
    }


    handleCommand(command, button) {
        switch(command) {
            case 'insertTable':
                this.showTableModal();
                break;
        }
    }



    // ── [SEC-PLUGIN-BOUNDARY] core.js / utils.js 공통 경계 재사용 ─────────────
    sanitizeTableHTML(html) {
        if (!html || typeof html !== 'string') return '';

        if (this.editor && typeof this.editor.sanitizePluginHTML === 'function') {
            return this.editor.sanitizePluginHTML(html, 'table');
        }

        // core.js가 아직 로드되지 않은 비정상 순서에서도 최소 방어를 유지한다.
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        tempDiv.querySelectorAll('script,object,embed,base,meta,link[rel="import"],iframe,style')
            .forEach(el => el.remove());
        tempDiv.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                    return;
                }
                if (attr.name === 'href') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'href')
                        : this.basicSafeUrl(attr.value, 'href');
                    if (!safe) el.removeAttribute(attr.name);
                }
                if (attr.name === 'src') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'src')
                        : this.basicSafeUrl(attr.value, 'src');
                    if (!safe) el.removeAttribute(attr.name);
                }
            });
        });
        return tempDiv.innerHTML;
    }

    basicSafeUrl(value, context = 'href') {
        if (!value) return '';
        const normalized = String(value).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return String(value);
    }

    clampInt(value, min, max, fallback) {
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    normalizeBorderStyle(value) {
        const allowed = new Set(['solid', 'dashed', 'dotted', 'double']);
        return allowed.has(value) ? value : 'solid';
    }

    normalizeTableWidth(value) {
        const raw = String(value || '100%').trim();
        if (raw === '75%' || raw === '50%' || raw === '100%') return raw;
        const match = raw.match(/^(\d{1,3})%$/);
        if (match) return `${this.clampInt(match[1], 10, 100, 100)}%`;
        return '100%';
    }

    createMaterialIcon(name, outlined = false) {
        const icon = document.createElement('span');
        icon.className = outlined ? 'material-icons-outlined' : 'material-icons';
        icon.textContent = String(name || '');
        return icon;
    }

    appendMaterialIcon(target, name, outlined = false) {
        target.textContent = '';
        target.appendChild(this.createMaterialIcon(name, outlined));
    }

    createEmptyParagraph() {
        const p = document.createElement('p');
        p.appendChild(document.createElement('br'));
        return p;
    }

    setEmptyCellBreak(cell) {
        cell.textContent = '';
        cell.appendChild(document.createElement('br'));
    }

    buildTableGrid(table) {
        const rows = Array.from(table?.rows || []);
        const grid = Array.from({ length: rows.length }, () => []);
        const origins = new Map();

        rows.forEach((row, rowIndex) => {
            let colIndex = 0;
            Array.from(row.cells).forEach(cell => {
                while (grid[rowIndex][colIndex]) colIndex += 1;

                const rawRowSpan = cell.getAttribute('rowspan');
                const requestedRowSpan = rawRowSpan === '0'
                    ? rows.length - rowIndex
                    : this.clampInt(cell.rowSpan, 1, 100, 1);
                const rowSpan = Math.max(1, Math.min(requestedRowSpan, rows.length - rowIndex));
                const colSpan = this.clampInt(cell.colSpan, 1, 100, 1);
                const info = { cell, row: rowIndex, col: colIndex, rowSpan, colSpan, rowElement: row };
                origins.set(cell, info);

                for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
                    if (!grid[r]) grid[r] = [];
                    for (let c = colIndex; c < colIndex + colSpan; c += 1) {
                        if (!grid[r][c]) grid[r][c] = cell;
                    }
                }
                colIndex += colSpan;
            });
        });

        return {
            rows,
            grid,
            origins,
            rowCount: rows.length,
            colCount: grid.reduce((max, row) => Math.max(max, row.length), 0)
        };
    }

    cellSection(cell) {
        return cell?.closest('thead, tbody, tfoot') || cell?.closest('table') || null;
    }

    getTableSelection(table) {
        const saved = this._tableSelections.get(table);
        if (!saved) return { anchor: null, cells: [], rangeMode: false };
        const cells = saved.cells.filter(cell => cell.isConnected && table.contains(cell));
        const anchor = saved.anchor && table.contains(saved.anchor) ? saved.anchor : (cells[0] || null);
        return { anchor, cells, rangeMode: !!saved.rangeMode };
    }

    setTableSelection(table, cells, anchor = null, options = {}) {
        const previous = this._tableSelections.get(table);
        (previous?.cells || []).forEach(cell => {
            cell.classList.remove('t2-table-cell-selected');
            cell.removeAttribute('aria-selected');
        });

        const unique = Array.from(new Set(cells || [])).filter(cell =>
            cell && cell.isConnected && table.contains(cell) && /^(TD|TH)$/.test(cell.tagName)
        );
        unique.forEach(cell => {
            cell.classList.add('t2-table-cell-selected');
            cell.setAttribute('aria-selected', 'true');
        });
        const rangeMode = !!options.rangeMode;
        table.classList.toggle('t2-table-range-selecting', rangeMode);
        this._tableSelections.set(table, { anchor: anchor || unique[0] || null, cells: unique, rangeMode });
        this.refreshCellActionState(table);
        return unique;
    }

    selectCellRange(table, anchor, target) {
        const model = this.buildTableGrid(table);
        const start = model.origins.get(anchor);
        const end = model.origins.get(target);
        if (!start || !end || this.cellSection(anchor) !== this.cellSection(target)) {
            return this.setTableSelection(table, [target], target);
        }

        const rowStart = Math.min(start.row, end.row);
        const rowEnd = Math.max(start.row + start.rowSpan - 1, end.row + end.rowSpan - 1);
        const colStart = Math.min(start.col, end.col);
        const colEnd = Math.max(start.col + start.colSpan - 1, end.col + end.colSpan - 1);
        const cells = [];
        for (let row = rowStart; row <= rowEnd; row += 1) {
            for (let col = colStart; col <= colEnd; col += 1) {
                const cell = model.grid[row]?.[col];
                if (!cell || this.cellSection(cell) !== this.cellSection(anchor)) {
                    return this.setTableSelection(table, [target], target);
                }
                cells.push(cell);
            }
        }
        return this.setTableSelection(table, cells, anchor);
    }

    getMergeRectangle(table) {
        const selection = this.getTableSelection(table);
        if (selection.cells.length < 2) return null;
        const model = this.buildTableGrid(table);
        const infos = selection.cells.map(cell => model.origins.get(cell));
        if (infos.some(info => !info || info.rowSpan !== 1 || info.colSpan !== 1)) return null;

        const section = this.cellSection(selection.cells[0]);
        const tagName = selection.cells[0].tagName;
        if (selection.cells.some(cell => this.cellSection(cell) !== section || cell.tagName !== tagName)) return null;

        const rowStart = Math.min(...infos.map(info => info.row));
        const rowEnd = Math.max(...infos.map(info => info.row));
        const colStart = Math.min(...infos.map(info => info.col));
        const colEnd = Math.max(...infos.map(info => info.col));
        const expectedCount = (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
        if (expectedCount !== selection.cells.length) return null;

        const selected = new Set(selection.cells);
        for (let row = rowStart; row <= rowEnd; row += 1) {
            for (let col = colStart; col <= colEnd; col += 1) {
                if (!selected.has(model.grid[row]?.[col])) return null;
            }
        }
        return {
            model,
            cells: selection.cells,
            primary: model.grid[rowStart][colStart],
            rowStart,
            rowEnd,
            colStart,
            colEnd
        };
    }

    cellHasContent(cell) {
        return !!cell && (cell.textContent.trim() !== '' || !!cell.querySelector('img, a[href]'));
    }

    mergeSelectedCells(table) {
        const rectangle = this.getMergeRectangle(table);
        if (!rectangle) return false;
        const primary = rectangle.primary;
        const ordered = rectangle.cells.slice().sort((a, b) => {
            const ai = rectangle.model.origins.get(a);
            const bi = rectangle.model.origins.get(b);
            return ai.row - bi.row || ai.col - bi.col;
        });

        let hasContent = this.cellHasContent(primary);
        if (!hasContent) primary.replaceChildren();
        ordered.forEach(cell => {
            if (cell === primary) return;
            if (this.cellHasContent(cell)) {
                if (hasContent) primary.appendChild(document.createElement('br'));
                while (cell.firstChild) primary.appendChild(cell.firstChild);
                hasContent = true;
            }
            cell.remove();
        });
        if (!hasContent) this.setEmptyCellBreak(primary);

        primary.rowSpan = rectangle.rowEnd - rectangle.rowStart + 1;
        primary.colSpan = rectangle.colEnd - rectangle.colStart + 1;
        this.setTableSelection(table, [primary], primary);
        return true;
    }

    copyCellPresentation(source, target) {
        ['borderWidth', 'borderStyle', 'padding', 'verticalAlign', 'textAlign'].forEach(property => {
            if (source.style[property]) target.style[property] = source.style[property];
        });
    }

    insertCellAtLogicalColumn(row, cell, logicalColumn, model) {
        let reference = null;
        for (const existing of Array.from(row.cells)) {
            const info = model.origins.get(existing);
            if (info && info.col >= logicalColumn) {
                reference = existing;
                break;
            }
        }
        row.insertBefore(cell, reference);
    }

    splitSelectedCell(table) {
        const selection = this.getTableSelection(table);
        if (selection.cells.length !== 1) return false;
        const cell = selection.cells[0];
        const model = this.buildTableGrid(table);
        const origin = model.origins.get(cell);
        if (!origin || (origin.rowSpan === 1 && origin.colSpan === 1)) return false;

        const created = [cell];
        cell.removeAttribute('rowspan');
        cell.removeAttribute('colspan');
        cell.rowSpan = 1;
        cell.colSpan = 1;

        for (let rowIndex = origin.row; rowIndex < origin.row + origin.rowSpan; rowIndex += 1) {
            const row = model.rows[rowIndex];
            if (!row) continue;
            for (let colIndex = origin.col; colIndex < origin.col + origin.colSpan; colIndex += 1) {
                if (rowIndex === origin.row && colIndex === origin.col) continue;
                const newCell = document.createElement(cell.tagName.toLowerCase());
                this.copyCellPresentation(cell, newCell);
                this.setEmptyCellBreak(newCell);
                this.insertCellAtLogicalColumn(row, newCell, colIndex, model);
                this.setupCellEditing(newCell);
                created.push(newCell);
            }
        }

        this.setTableSelection(table, created, cell);
        return true;
    }

    refreshCellActionState(table) {
        const controls = table.closest('.t2-table-wrapper')?.querySelector('.t2-table-controls');
        if (!controls) return;
        const mergeButton = controls.querySelector('[data-action="merge-cells"]');
        const splitButton = controls.querySelector('[data-action="split-cell"]');
        const selection = this.getTableSelection(table);
        if (mergeButton) {
            const singleCell = selection.cells.length === 1 ? selection.cells[0] : null;
            const canStartRange = !!singleCell && singleCell.rowSpan <= 1 && singleCell.colSpan <= 1;
            mergeButton.disabled = selection.cells.length === 0 ||
                (selection.cells.length === 1 ? !canStartRange : !this.getMergeRectangle(table));
            mergeButton.classList.toggle('t2-cell-range-mode', selection.rangeMode);
            mergeButton.setAttribute('aria-pressed', selection.rangeMode ? 'true' : 'false');
        }
        if (splitButton) {
            const cell = selection.cells.length === 1 ? selection.cells[0] : null;
            splitButton.disabled = !cell || (cell.rowSpan <= 1 && cell.colSpan <= 1);
        }
    }

    createActionButton(className, action, iconName, options = {}) {
        const button = document.createElement('button');
        button.className = className;
        button.type = options.type || 'button';
        if (action) button.setAttribute(options.actionAttr || 'data-action', action);
        if (options.style) button.style.cssText = options.style;
        if (options.ariaLabel) button.setAttribute('aria-label', options.ariaLabel);
        if (options.title || options.ariaLabel) button.title = options.title || options.ariaLabel;
        button.appendChild(this.createMaterialIcon(iconName, !!options.outlined));
        return button;
    }

    sanitizeEmbeddedContentElement(el) {
        const tag = el.tagName.toLowerCase();

        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (/^on/i.test(name) || name === 'srcdoc' || name === 'style') {
                el.removeAttribute(attr.name);
                return;
            }

            if (tag === 'a') {
                if (name === 'href') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'href')
                        : this.basicSafeUrl(attr.value, 'href');
                    if (safe) el.setAttribute('href', safe);
                    else el.removeAttribute('href');
                    return;
                }
                if (!['title', 'target', 'rel'].includes(name)) el.removeAttribute(attr.name);
                return;
            }

            if (tag === 'img') {
                if (name === 'src') {
                    const safe = (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL)
                        ? T2Utils.sanitizeURL(attr.value, 'src')
                        : this.basicSafeUrl(attr.value, 'src');
                    if (safe) el.setAttribute('src', safe);
                    else el.removeAttribute('src');
                    return;
                }
                if (!['alt', 'title', 'width', 'height'].includes(name)) el.removeAttribute(attr.name);
                return;
            }

            if ((tag === 'td' || tag === 'th') && ['colspan', 'rowspan'].includes(name)) {
                const safeSpan = this.clampInt(attr.value, 1, 100, 1);
                el.setAttribute(name, String(safeSpan));
                return;
            }

            if (tag === 'th' && name === 'scope') return;

            // 표 내부 일반 콘텐츠는 class/style/data-* 등 저장 오염 요인을 제거한다.
            el.removeAttribute(attr.name);
        });

        if (tag === 'a') {
            const href = el.getAttribute('href');
            if (href) {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }

    normalizeExternalTable(table) {
        if (!table || table.tagName !== 'TABLE') return null;

        // core 프로필 통과 후에도 표 플러그인 저장 구조에 불필요한 요소는 제거한다.
        table.querySelectorAll('script,object,embed,base,meta,iframe,style,form,input,button,textarea,select')
            .forEach(el => el.remove());

        const allowedTags = new Set([
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
            'br', 'a', 'img', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'p', 'div',
            'ul', 'ol', 'li'
        ]);

        Array.from(table.querySelectorAll('*')).forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (!allowedTags.has(tag)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                return;
            }
            this.sanitizeEmbeddedContentElement(el);
        });

        Array.from(table.attributes).forEach(attr => table.removeAttribute(attr.name));
        table.className = 't2-table';
        table.setAttribute('border', '1');
        table.setAttribute('data-t2-table', 'true');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        table.querySelectorAll('td, th').forEach(cell => {
            // 테마가 셀 색상을 결정할 수 있도록 밝은 색을 인라인으로 고정하지 않는다.
            cell.style.borderWidth = '1px';
            cell.style.borderStyle = 'solid';
            cell.style.removeProperty('border-color');
            cell.style.padding = '8px';
            cell.style.removeProperty('background-color');
            if (!cell.textContent.trim() && !cell.querySelector('img, a, br')) {
                this.setEmptyCellBreak(cell);
            }
        });

        return table;
    }

    parseSanitizedHTML(html) {
        const tempDiv = document.createElement('div');
        // sanitizeTableHTML()을 먼저 통과한 문자열만 이 함수로 들어온다.
        tempDiv.innerHTML = html;
        return tempDiv;
    }

    handlePaste(e) {
        // [BUG-FIX] core.js 의 플러그인 handlePaste 훅은 항상 PasteEvent(e) 를 전달하는데
        // 이 함수는 과거 clipboardData 를 직접 받는 것으로 잘못 작성되어 있었다.
        // e.getData 는 존재하지 않는 메서드이므로 매 paste 마다 예외가 발생했고,
        // core.js 의 handlePaste() 는 이 예외를 잡지 않아(try/catch 없음) 그대로 상위로
        // 전파되어 e.preventDefault() 가 호출되지 못한 채 함수 전체가 중단됐다.
        // 결과: 이미지가 아닌 모든 붙여넣기(순수 텍스트/일반 HTML 등)가 T2Editor 자체 처리 경로를
        // 타지 못하고 매번 "브라우저 네이티브 붙여넣기"로 대체 실행되어, 브라우저별(특히 iOS Safari)
        // 줄바꿈 처리 방식 차이로 인한 콘텐츠 손상(줄바꿈 소실 등)의 핵심 원인이 되었다.
        const clipboardData = (e && e.clipboardData) || window.clipboardData;
        if (!clipboardData) return false;

        const htmlText = clipboardData.getData('text/html');

        if (htmlText && htmlText.includes('<table')) {
            // [BUG-FIX] 성공 경로에서도 preventDefault 가 호출되지 않아 T2 테이블 삽입과
            // 브라우저 네이티브 붙여넣기가 중복 실행될 수 있었다. 여기서 명시적으로 방지한다.
            if (e && typeof e.preventDefault === 'function') e.preventDefault();

            // [SEC-PLUGIN-BOUNDARY] 클립보드 HTML은 비신뢰 입력이므로
            // core.js의 table 프로필 새니타이저를 먼저 통과시킨 뒤 파싱한다.
            const sanitizedHTML = this.sanitizeTableHTML(htmlText);
            const tempDiv = this.parseSanitizedHTML(sanitizedHTML);

            const tables = Array.from(tempDiv.querySelectorAll('table'));
            tables.forEach(origTable => {
                const table = this.normalizeExternalTable(origTable.cloneNode(true));
                if (!table) return;

                const tableWrapper = this.createTableWrapper(table);
                this.insertTableWithLineBreaks(tableWrapper);
            });

            if (!tables.length) return false;

            this.editor.normalizeContent();

            if (this.editor.collab) {
                this.editor.collab.recordChange();
            } else {
                this.editor.createUndoPoint();
            }

            return true;
        }

        return false;
    }


    onContentSet(html) {
        console.log('Table plugin: onContentSet called');
        setTimeout(() => {
            this.initializeTableBlocks();
        }, 50);
    }

    showTableModal() {
        const modalContent = `
            <div class="t2-table-editor-modal">
                <h3 data-i18n="table.modal_title">${T2Utils.t('table.modal_title')}</h3>
                <div class="t2-table-size-selector">
                    <div class="t2-table-size-inputs">
                        <div class="t2-table-input-group">
                            <label data-i18n="table.cols_count_label">${T2Utils.t('table.cols_count_label')}</label>
                            <div class="t2-input-with-controls">
                                <button class="t2-btn t2-table-control-btn" data-action="decrease-cols">
                                    <span class="material-icons">remove</span>
                                </button>
                                <input type="number" class="t2-table-cols" value="3" min="1" max="30">
                                <button class="t2-btn t2-table-control-btn" data-action="increase-cols">
                                    <span class="material-icons">add</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-table-input-group">
                            <label data-i18n="table.rows_count_label">${T2Utils.t('table.rows_count_label')}</label>
                            <div class="t2-input-with-controls">
                                <button class="t2-btn t2-table-control-btn" data-action="decrease-rows">
                                    <span class="material-icons">remove</span>
                                </button>
                                <input type="number" class="t2-table-rows" value="3" min="1" max="30">
                                <button class="t2-btn t2-table-control-btn" data-action="increase-rows">
                                    <span class="material-icons">add</span>
                                </button>
                            </div>
                        </div>
                        <div class="t2-table-warning" style="display: none; color: #e67e22; margin-top: 10px; font-size: 13px;">
                            <span class="material-icons" style="font-size: 16px; vertical-align: middle;">warning</span>
                            <span data-i18n="table.large_table_warning">${T2Utils.t('table.large_table_warning')}</span>
                        </div>
                    </div>
                    <!-- [BUG-FIX] 인라인 style 제거: CSS 클래스(.t2-table-preview-container)와
                         border-radius(4px vs 8px)/border 색상(#ddd vs #e5e7eb)이 서로 달라
                         불일치했고, 인라인 border 가 다크모드 오버라이드
                         (html[data-t2editor-theme="dark"] .t2-table-preview-container{border-color:#444})
                         를 항상 덮어써 다크 모드에서도 밝은 테두리색이 고정되는 문제가 있었다. -->
                    <div class="t2-table-preview-container">
                        <div class="t2-table-preview"></div>
                    </div>
                </div>
                <div class="t2-table-style-options">
                    <div class="t2-table-style-option">
                        <p data-i18n="table.width_label">${T2Utils.t('table.width_label')}&nbsp;</p>
                        <select class="t2-table-width">
                            <option value="100%">${T2Utils.t('table.width_full')}</option>
                            <option value="75%">75%</option>
                            <option value="50%">50%</option>
                            <option value="custom">${T2Utils.t('table.width_custom')}</option>
                        </select>
                        <div class="t2-custom-width-container" style="display: none;">
                            <input type="number" class="t2-custom-width-value" value="100" min="10" max="100">
                            <span>%</span>
                        </div>
                    </div>
                    <div class="t2-table-style-option">
                        <p data-i18n="table.border_style_label">${T2Utils.t('table.border_style_label')}&nbsp;</p>
                        <select class="t2-table-border-style">
                            <option value="solid">${T2Utils.t('table.border_solid')}</option>
                            <option value="dashed">${T2Utils.t('table.border_dashed')}</option>
                            <option value="dotted">${T2Utils.t('table.border_dotted')}</option>
                            <option value="double">${T2Utils.t('table.border_double')}</option>
                        </select>
                    </div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel" data-i18n="common.cancel">${T2Utils.t('common.cancel')}</button>
                    <button class="t2-btn" data-action="insert" data-i18n="common.insert">${T2Utils.t('common.insert')}</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupTableModalEvents(modal);
    }

    setupTableModalEvents(modal) {
        const previewContainer = modal.querySelector('.t2-table-preview');
        const colsInput = modal.querySelector('.t2-table-cols');
        const rowsInput = modal.querySelector('.t2-table-rows');
        const tableWidthSelect = modal.querySelector('.t2-table-width');
        const customWidthContainer = modal.querySelector('.t2-custom-width-container');
        const customWidthInput = modal.querySelector('.t2-custom-width-value');
        const tableWarning = modal.querySelector('.t2-table-warning');

        const closeModal = () => {
            const modalOverlay = document.querySelector('.t2-modal-overlay');
            if (modalOverlay) {
                modalOverlay.remove();
            } else if (modal.parentElement) {
                modal.parentElement.remove();
            } else {
                modal.remove();
            }
        };

        // [BUG-FIX] 표 크기 미리보기 DOM을 매번 새로 만들지 않고 재사용한다.
        // (아래 updateTablePreview() 의 diff 업데이트와 함께, CSS transition 이
        //  실제로 걸리도록 하기 위한 전제 조건 — 매번 replaceChildren 으로 통째로
        //  갈아엎으면 브라우저가 "새 엘리먼트"로 취급해 transition 이 발생하지 않는다.)
        const ensurePreviewTable = () => {
            let table = previewContainer.querySelector('table.t2-preview-table');
            if (!table) {
                table = document.createElement('table');
                table.className = 't2-preview-table';
                previewContainer.replaceChildren(table);
            }
            return table;
        };

        const updateTablePreview = () => {
            const cols = this.clampInt(colsInput.value, 1, 30, 3);
            const rows = this.clampInt(rowsInput.value, 1, 30, 3);

            tableWarning.style.display = (cols > 10 || rows > 10) ? 'block' : 'none';

            // [BUG-FIX] transform:scale() 제거.
            // .t2-table-preview-container 는 display:flex 로 내용을 가운데 정렬하는데,
            // transform 은 레이아웃 박스 크기에 영향을 주지 않으므로 큰 표(예: 20×20 ≈ 320px)일
            // 경우 "축소 전 원본 크기"가 먼저 160×160 박스 안에서 중앙 정렬된 뒤 좌상단 기준으로
            // 시각적으로만 축소되어, 행/열이 많아질수록 표가 컨테이너 밖으로 밀려나거나
            // 잘려 보이는 문제가 있었다. → 셀 픽셀 크기를 직접 계산해 실제 레이아웃 크기를 줄인다.
            const AVAILABLE_PX = 140; // .t2-table-preview-container 160px - 좌우/상하 padding 10px
            const cellSize = Math.max(4, Math.min(16, Math.floor(AVAILABLE_PX / Math.max(cols, rows))));

            const table = ensurePreviewTable();

            // 행 개수 맞추기 (끝에서부터 추가/삭제 — 0번 행은 항상 헤더로 유지됨)
            while (table.rows.length < rows) {
                table.appendChild(document.createElement('tr'));
            }
            while (table.rows.length > rows) {
                table.deleteRow(table.rows.length - 1);
            }

            // 각 행의 셀 개수 및 크기 갱신
            Array.from(table.rows).forEach((tr, rowIndex) => {
                const cellTag = rowIndex === 0 ? 'th' : 'td';
                while (tr.cells.length < cols) {
                    tr.appendChild(document.createElement(cellTag));
                }
                while (tr.cells.length > cols) {
                    tr.removeChild(tr.lastElementChild);
                }
                // [BUG-FIX] border/background 인라인 스타일을 지정하지 않는다.
                // 과거에는 th.style.border='1px solid #ccc' 처럼 인라인으로 직접 지정해
                // table.css 의 클래스 기반 색상과 다크모드 오버라이드
                // (html[data-t2editor-theme="dark"] .t2-preview-table th{...}) 가
                // 인라인 스타일에 항상 밀려 절대 적용되지 못했다(다크 모드에서도 라이트 색상 고정).
                // width/height 는 매번 값이 바뀌므로 계속 인라인으로 지정하되,
                // 색상 관련 속성은 전부 CSS(.t2-preview-table th/td)에 맡긴다.
                Array.from(tr.cells).forEach(cell => {
                    cell.style.width = `${cellSize}px`;
                    cell.style.height = `${cellSize}px`;
                });
            });
        };

        modal.querySelector('[data-action="decrease-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.max(1, this.clampInt(colsInput.value, 1, 30, 3) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-cols"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            colsInput.value = Math.min(30, this.clampInt(colsInput.value, 1, 30, 3) + 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="decrease-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.max(1, this.clampInt(rowsInput.value, 1, 30, 3) - 1);
            updateTablePreview();
        };
        
        modal.querySelector('[data-action="increase-rows"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rowsInput.value = Math.min(30, this.clampInt(rowsInput.value, 1, 30, 3) + 1);
            updateTablePreview();
        };

        tableWidthSelect.addEventListener('change', () => {
            if (tableWidthSelect.value === 'custom') {
                customWidthContainer.style.display = 'flex';
            } else {
                customWidthContainer.style.display = 'none';
            }
        });

        colsInput.addEventListener('input', () => {
            colsInput.value = this.clampInt(colsInput.value, 1, 30, 1);
            updateTablePreview();
        });
        
        rowsInput.addEventListener('input', () => {
            rowsInput.value = this.clampInt(rowsInput.value, 1, 30, 1);
            updateTablePreview();
        });

        updateTablePreview();

        modal.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const cols = this.clampInt(colsInput.value, 1, 30, 3);
            const rows = this.clampInt(rowsInput.value, 1, 30, 3);
            const borderStyle = this.normalizeBorderStyle(modal.querySelector('.t2-table-border-style').value);
            
            let tableWidth;
            if (tableWidthSelect.value === 'custom') {
                const customWidth = this.clampInt(customWidthInput.value, 10, 100, 100);
                tableWidth = `${customWidth}%`;
            } else {
                tableWidth = this.normalizeTableWidth(tableWidthSelect.value);
            }
            
            closeModal();
            
            setTimeout(() => {
                const table = this.createTable(cols, rows, tableWidth, borderStyle);
                const tableWrapper = this.createTableWrapper(table);
                this.insertTableWithLineBreaks(tableWrapper);
            }, 10);
        };

        modal.querySelector('[data-action="cancel"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        };
    }

    createTable(cols, rows, width, borderStyle) {
        cols = this.clampInt(cols, 1, 30, 3);
        rows = this.clampInt(rows, 1, 30, 3);
        width = this.normalizeTableWidth(width);
        borderStyle = this.normalizeBorderStyle(borderStyle);

        const table = document.createElement('table');
        table.className = 't2-table';
        table.style.width = width;
        table.style.borderCollapse = 'collapse';
        table.setAttribute('border', '1');
        table.setAttribute('data-t2-table', 'true');

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        for (let col = 0; col < cols; col++) {
            const th = document.createElement('th');
            th.style.borderWidth = '1px';
            th.style.borderStyle = borderStyle;
            th.style.padding = '8px';
            th.textContent = T2Utils.t('table.header_label', { n: col + 1 });
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (let row = 1; row < rows; row++) {
            const tr = document.createElement('tr');
            for (let col = 0; col < cols; col++) {
                const td = document.createElement('td');
                td.style.borderWidth = '1px';
                td.style.borderStyle = borderStyle;
                td.style.padding = '8px';
                this.setEmptyCellBreak(td);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        return table;
    }


    insertTableWithLineBreaks(tableWrapper) {
        const selection = window.getSelection();
        let range;

        if (selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
            // 선택 영역이 에디터 내부인지 확인
            if (!this.editor.editor.contains(range.commonAncestorContainer)) {
                range = null;
            }
        }

        if (!range) {
            // 에디터 끝에 새로운 줄 추가 후 위치 지정
            const p = this.createEmptyParagraph();
            this.editor.editor.appendChild(p);
            range = document.createRange();
            range.selectNodeContents(p);
            range.collapse(false);
        }

        const topBreak = this.createEmptyParagraph();
        const bottomBreak = this.createEmptyParagraph();

        const fragment = document.createDocumentFragment();
        fragment.appendChild(topBreak);
        fragment.appendChild(tableWrapper);
        fragment.appendChild(bottomBreak);

        range.deleteContents();
        range.insertNode(fragment);

        const table = tableWrapper.querySelector('.t2-table');
        if (table) {
            this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
            this.setupTableCellEditing(table);
            this.setupTableResizing(table);
        }

        this.cleanupEmptyLines(tableWrapper);

        // 커서를 테이블 아래 빈 줄로 이동
        const newRange = document.createRange();
        newRange.setStart(bottomBreak, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
        bottomBreak.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        this.editor.normalizeContent();

        if (this.editor.collab) {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }

        this.editor.autoSave();
    }


    createTableWrapper(table) {
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 't2-table-wrapper';
        tableWrapper.setAttribute('data-t2-block', 'table');
        tableWrapper.contentEditable = false;
        tableWrapper.style.position = 'relative';

        if (!table.classList.contains('t2-table')) table.classList.add('t2-table');
        table.setAttribute('data-t2-table', 'true');

        const tableModel = this.buildTableGrid(table);
        const cols = tableModel.colCount;
        const rows = tableModel.rowCount;
        const cellWidth = 50;
        const padding = 12 * 2;
        const tableWidth = cols * (cellWidth + padding);
        const mediaBlockWidth = 320;
        const editorWidth = this.editor.editor.clientWidth;
        const needsScroll = tableWidth > mediaBlockWidth || tableWidth > editorWidth;

        if (needsScroll) {
            const scrollWrapper = document.createElement('div');
            scrollWrapper.className = 't2-table-scroll-wrapper';
            scrollWrapper.appendChild(table);
            tableWrapper.appendChild(scrollWrapper);
            table.classList.add('t2-table-large');
        } else {
            tableWrapper.appendChild(table);
        }

        const tableControls = this.createTableControls(table, rows, cols);
        tableWrapper.appendChild(tableControls);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 't2-table-download-btn';
        downloadBtn.type = 'button';
        downloadBtn.style.cssText = 'position: absolute; bottom: 8px; left: 8px; right: auto;';
        downloadBtn.appendChild(this.createMaterialIcon('download'));
        downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exportTableToCSV(table);
        });
        tableWrapper.appendChild(downloadBtn);

        const moveControls = this.createMoveControls();
        tableWrapper.appendChild(moveControls);

        return tableWrapper;
    }


    createTableControls(table, rows, cols) {
        const tableControls = document.createElement('div');
        tableControls.className = 't2-table-controls';

        const createGroup = (labelText, actions) => {
            const group = document.createElement('div');
            group.className = 't2-table-control-group';

            const label = document.createElement('span');
            label.textContent = labelText;
            group.appendChild(label);

            actions.forEach(({ action, icon, label: ariaLabel, title }) => {
                group.appendChild(this.createActionButton(
                    't2-btn t2-table-control-btn',
                    action,
                    icon,
                    { ariaLabel, title }
                ));
            });

            return group;
        };

        tableControls.appendChild(createGroup(T2Utils.t('table.cols_short_label'), [
            { action: 'add-col', icon: 'add', label: T2Utils.t('table.add_col') },
            { action: 'remove-col', icon: 'remove', label: T2Utils.t('table.del_col') },
        ]));

        tableControls.appendChild(createGroup(T2Utils.t('table.rows_short_label'), [
            { action: 'add-row', icon: 'add', label: T2Utils.t('table.add_row') },
            { action: 'remove-row', icon: 'remove', label: T2Utils.t('table.del_row') },
        ]));

        tableControls.appendChild(createGroup(T2Utils.t('table.cells_short_label'), [
            {
                action: 'merge-cells',
                icon: 'call_merge',
                label: T2Utils.t('table.merge_cells'),
                title: T2Utils.t('table.merge_cells_hint')
            },
            { action: 'split-cell', icon: 'call_split', label: T2Utils.t('table.split_cell') },
        ]));

        tableControls.appendChild(this.createActionButton(
            't2-btn t2-table-delete-btn',
            'delete-table',
            'close',
            { ariaLabel: T2Utils.t('table.delete_table') }
        ));

        return tableControls;
    }


    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            display: inline-flex;
            background: rgba(50, 50, 50, 0.9);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
        `;

        const baseStyle = 'padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;';
        const upBtn = this.createActionButton('t2-btn t2-move-btn', 'up', 'arrow_upward', {
            actionAttr: 'data-direction',
            style: `${baseStyle} border-right: 2px solid rgba(255,255,255,0.3);`,
            ariaLabel: T2Utils.t('table.move_up')
        });
        const downBtn = this.createActionButton('t2-btn t2-move-btn', 'down', 'arrow_downward', {
            actionAttr: 'data-direction',
            style: baseStyle,
            ariaLabel: T2Utils.t('table.move_down')
        });

        upBtn.querySelector('.material-icons').style.fontSize = '20px';
        downBtn.querySelector('.material-icons').style.fontSize = '20px';

        moveWrapper.appendChild(upBtn);
        moveWrapper.appendChild(downBtn);

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255,255,255,0.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'transparent';
            });
        });

        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('up', moveWrapper);
        });

        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('down', moveWrapper);
        });

        return moveWrapper;
    }


    moveBlock(direction, controlElement) {
        const tableWrapper = controlElement.closest('.t2-table-wrapper');
        if (!tableWrapper) return;

        const sibling = direction === 'up' ? tableWrapper.previousElementSibling : tableWrapper.nextElementSibling;
        
        if (!sibling) return;

        if (direction === 'up') {
            tableWrapper.parentNode.insertBefore(tableWrapper, sibling);
        } else {
            tableWrapper.parentNode.insertBefore(tableWrapper, sibling.nextElementSibling);
        }

        if (this.editor.collab) {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
        
        this.editor.autoSave();
    }

    setupTableControlEvents(controls, table) {
        if (!controls || this._controlsWithEvents.has(controls)) return;
        this._controlsWithEvents.add(controls);

        const updateTableScroll = () => {
            const model = this.buildTableGrid(table);
            const cols = model.colCount;
            const cellWidth = 50;
            const padding = 12 * 2;
            const tableWidth = cols * (cellWidth + padding);
            const mediaBlockWidth = 320;
            const editorWidth = this.editor.editor.clientWidth;
            const needsScroll = tableWidth > mediaBlockWidth || tableWidth > editorWidth;

            const wrapper = table.closest('.t2-table-wrapper');
            const scrollWrapper = table.closest('.t2-table-scroll-wrapper');

            if (!wrapper) return;

            if (needsScroll && !scrollWrapper) {
                const newScrollWrapper = document.createElement('div');
                newScrollWrapper.className = 't2-table-scroll-wrapper';
                wrapper.insertBefore(newScrollWrapper, table);
                newScrollWrapper.appendChild(table);
                table.classList.add('t2-table-large');
            } else if (!needsScroll && scrollWrapper) {
                wrapper.insertBefore(table, scrollWrapper);
                scrollWrapper.remove();
                table.classList.remove('t2-table-large');
            }
        };

        const recordChange = () => {
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            } else {
                this.editor.createUndoPoint();
            }
            this.editor.autoSave();
        };

        controls.querySelector('[data-action="add-col"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = this.buildTableGrid(table);
            const rows = model.rows;
            if (!rows.length) return;
            const colCount = model.colCount;
            if (colCount >= 100) return;
            rows.forEach(row => {
                const isHeader = row.parentElement?.tagName === 'THEAD';
                const cell = document.createElement(isHeader ? 'th' : 'td');
                const sourceCell = row.cells[row.cells.length - 1] || rows[0].cells[0];
                cell.style.borderWidth = sourceCell?.style.borderWidth || '1px';
                cell.style.borderStyle = sourceCell?.style.borderStyle || 'solid';
                cell.style.padding = '8px';
                if (isHeader) {
                    cell.textContent = T2Utils.t('table.header_label', { n: colCount + 1 });
                } else {
                    this.setEmptyCellBreak(cell);
                }
                row.appendChild(cell);
                this.setupCellEditing(cell);
            });
            this.setTableSelection(table, []);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="remove-col"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = this.buildTableGrid(table);
            if (!model.rowCount || model.colCount <= 1) return;
            const lastColumn = model.colCount - 1;
            const affected = new Set(model.grid.map(row => row[lastColumn]).filter(Boolean));
            affected.forEach(cell => {
                const info = model.origins.get(cell);
                if (!info) return;
                if (info.colSpan > 1) cell.colSpan = info.colSpan - 1;
                else cell.remove();
            });
            this.setTableSelection(table, []);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="add-row"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = this.buildTableGrid(table);
            if (!model.rowCount) return;
            const colCount = Math.max(1, model.colCount);
            let tbody = table.tBodies[0];
            if (!tbody) {
                tbody = document.createElement('tbody');
                table.appendChild(tbody);
            }
            const newRow = document.createElement('tr');
            for (let col = 0; col < colCount; col++) {
                const td = document.createElement('td');
                const sourceCell = model.rows[0].cells[0];
                td.style.borderWidth = sourceCell?.style.borderWidth || '1px';
                td.style.borderStyle = sourceCell?.style.borderStyle || 'solid';
                td.style.padding = '8px';
                this.setEmptyCellBreak(td);
                newRow.appendChild(td);
                this.setupCellEditing(td);
            }
            tbody.appendChild(newRow);
            this.setTableSelection(table, []);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="remove-row"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = this.buildTableGrid(table);
            if (model.rowCount <= 1) return;
            const lastRowIndex = model.rowCount - 1;
            const lastRow = model.rows[lastRowIndex];
            const affected = new Set((model.grid[lastRowIndex] || []).filter(Boolean));
            affected.forEach(cell => {
                const info = model.origins.get(cell);
                if (info && info.row < lastRowIndex && info.rowSpan > 1) {
                    cell.rowSpan = info.rowSpan - 1;
                }
            });
            lastRow.remove();
            this.setTableSelection(table, []);
            updateTableScroll();
            recordChange();
        });

        controls.querySelector('[data-action="merge-cells"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.mergeSelectedCells(table)) {
                updateTableScroll();
                recordChange();
                return;
            }
            const selection = this.getTableSelection(table);
            if (selection.cells.length === 1 && selection.cells[0].rowSpan <= 1 && selection.cells[0].colSpan <= 1) {
                this.setTableSelection(table, selection.cells, selection.anchor, { rangeMode: true });
            }
        });

        controls.querySelector('[data-action="split-cell"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.splitSelectedCell(table)) {
                updateTableScroll();
                recordChange();
            }
        });

        controls.querySelector('[data-action="delete-table"]').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const wrapper = table.closest('.t2-table-wrapper');
            if (wrapper) {
                wrapper.remove();
                recordChange();
            }
        });

        updateTableScroll();
        this.refreshCellActionState(table);
    }


    setupTableCellEditing(table) {
        const cells = table.querySelectorAll('th, td');
        cells.forEach(cell => {
            this.setupCellEditing(cell);
        });
    }

    setupCellEditing(cell) {
        if (!cell || this._cellsWithEditing.has(cell)) return;
        this._cellsWithEditing.add(cell);

        cell.contentEditable = true;

        cell.addEventListener('click', (e) => {
            e.stopPropagation();

            const table = cell.closest('table.t2-table');
            if (table) {
                const current = this.getTableSelection(table);
                if ((e.shiftKey || current.rangeMode) && current.anchor) {
                    e.preventDefault();
                    this.selectCellRange(table, current.anchor, cell);
                    return;
                }
                this.setTableSelection(table, [cell], cell);
            }

            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(cell);
            selection.removeAllRanges();
            selection.addRange(range);
        });

        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const selection = window.getSelection();
                if (!selection.rangeCount || !cell.contains(selection.anchorNode)) {
                    cell.appendChild(document.createElement('br'));
                    return;
                }
                const range = selection.getRangeAt(0);
                range.deleteContents();
                const br = document.createElement('br');
                range.insertNode(br);
                range.setStartAfter(br);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        cell.addEventListener('input', () => {
            if (this.editor.collab) {
                this.editor.collab.recordChange();
            }
        });
    }


    setupTableResizing(table) {
        if (!table || this._tablesWithResizing.has(table)) return;
        this._tablesWithResizing.add(table);

        let isResizing = false;
        let currentTh = null;
        let startX = 0;
        let startWidth = 0;

        table.addEventListener('mousedown', (e) => {
            const th = e.target.closest('th');
            if (!th || !table.contains(th)) return;

            const thRect = th.getBoundingClientRect();
            if (thRect.right - e.clientX <= 5) {
                isResizing = true;
                currentTh = th;
                startX = e.clientX;
                startWidth = th.offsetWidth;

                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                e.preventDefault();
                e.stopPropagation();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !currentTh) return;

            const diffX = e.clientX - startX;
            const newWidth = Math.max(30, startWidth + diffX);

            currentTh.style.width = `${newWidth}px`;

            const colIndex = Array.from(currentTh.parentNode.children).indexOf(currentTh);
            const rows = table.querySelectorAll('tr');

            rows.forEach(row => {
                const cell = row.children[colIndex];
                if (cell) {
                    cell.style.width = `${newWidth}px`;
                }
            });

            e.preventDefault();
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                currentTh = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                if (this.editor.collab) {
                    this.editor.collab.recordChange();
                } else {
                    this.editor.createUndoPoint();
                }
                this.editor.autoSave();
            }
        });
    }


    exportTableToCSV(table) {
        const model = this.buildTableGrid(table);
        const csvRows = [];

        for (let row = 0; row < model.rowCount; row += 1) {
            const rowData = [];
            for (let col = 0; col < model.colCount; col += 1) {
                const cell = model.grid[row]?.[col];
                const origin = cell ? model.origins.get(cell) : null;
                let text = origin && origin.row === row && origin.col === col ? cell.textContent.trim() : '';
                if (text.includes('"') || text.includes(',')) {
                    text = `"${text.replace(/"/g, '""')}"`;
                }
                rowData.push(text);
            }
            csvRows.push(rowData.join(','));
        }

        const csvContent = csvRows.join('\n');
        T2Utils.downloadTextFile(csvContent, `table_export_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
    }

    initializeTableBlocks() {
        console.log('Initializing table blocks...');
        
        this.editor.editor.querySelectorAll('.table-responsive').forEach(responsiveWrapper => {
            const table = responsiveWrapper.querySelector('table');
            if (table) {
                if (!table.classList.contains('t2-table')) table.classList.add('t2-table');

                const tableWrapper = this.createTableWrapper(table);
                responsiveWrapper.parentNode.insertBefore(tableWrapper, responsiveWrapper);
                responsiveWrapper.remove();

                this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                this.cleanupEmptyLines(tableWrapper);
            }
        });

        this.editor.editor.querySelectorAll('table.t2-table').forEach(table => {
            let tableWrapper = table.closest('.t2-table-wrapper');

            if (!tableWrapper) {
                const originalParent = table.parentNode;
                const originalNext = table.nextSibling;
                tableWrapper = this.createTableWrapper(table);
                if (originalParent) originalParent.insertBefore(tableWrapper, originalNext);

                this.setupTableControlEvents(tableWrapper.querySelector('.t2-table-controls'), table);
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                this.cleanupEmptyLines(tableWrapper);
            } else {
                tableWrapper.style.position = 'relative';
                tableWrapper.contentEditable = false;
                
                if (tableWrapper.parentNode.nodeName === 'P') {
                    const p = tableWrapper.parentNode;
                    p.parentNode.insertBefore(tableWrapper, p);
                    p.remove();
                }
                
                const existingControls = tableWrapper.querySelector('.t2-table-controls');
                if (existingControls) {
                    existingControls.remove();
                }
                const tableModel = this.buildTableGrid(table);
                const cols = tableModel.colCount;
                const rows = tableModel.rowCount;
                const newControls = this.createTableControls(table, rows, cols);
                tableWrapper.appendChild(newControls);
                this.setupTableControlEvents(newControls, table);
                
                const existingDownloadBtn = tableWrapper.querySelector('.t2-table-download-btn');
                if (existingDownloadBtn) {
                    existingDownloadBtn.remove();
                }
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 't2-table-download-btn';
                downloadBtn.appendChild(this.createMaterialIcon('download'));
                downloadBtn.style.cssText = 'position: absolute; bottom: 8px; left: 8px; right: auto;';
                downloadBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.exportTableToCSV(table);
                });
                tableWrapper.appendChild(downloadBtn);
                
                const existingMoveControls = tableWrapper.querySelector('.t2-move-controls');
                if (existingMoveControls) {
                    existingMoveControls.remove();
                }
                const moveControls = this.createMoveControls();
                tableWrapper.appendChild(moveControls);
                
                this.setupTableCellEditing(table);
                this.setupTableResizing(table);
                
                this.cleanupEmptyLines(tableWrapper);
            }
        });
        
        console.log('Table blocks initialization complete');
    }

    cleanupEmptyLines(tableWrapper) {
        let prev = tableWrapper.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];
        
        while (prev && prev.tagName === 'P' && 
               !prev.textContent.trim() && 
               (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(prev);
            }
            prev = prev.previousElementSibling;
        }
        
        let next = tableWrapper.nextElementSibling;
        emptyCount = 0;
        
        while (next && next.tagName === 'P' && 
               !next.textContent.trim() && 
               (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) {
                toRemove.push(next);
            }
            next = next.nextElementSibling;
        }
        
        toRemove.forEach(el => el.remove());
    }
}

window.T2TablePlugin = T2TablePlugin;
