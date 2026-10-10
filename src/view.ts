// view.ts
import { ItemView, WorkspaceLeaf, Notice, TFile, TFolder } from 'obsidian';
import CustomDatabaseStudioPlugin, { VersionSnapshot } from './main';
import { VersionPromptModal, ConfirmModal } from './modals';

export const VIEW_TYPE_STUDIO = "custom-database-studio-view";

interface AutocompleteSuggestion {
  text: string;
  displayText?: string;
  type: 'html' | 'attr' | 'css-prop' | 'css-var' | 'dv' | 'vault' | 'prop' | 'buffer';
  score?: number;
}

export class StudioView extends ItemView {
  plugin: CustomDatabaseStudioPlugin;
  currentFile: TFile | null = null;

  // Dynamically inspected collections
  dynamicVaultFolders: string[] = [];
  dynamicVaultTags: string[] = [];
  dynamicFrontmatterKeys: string[] = [];
  dynamicHtmlTags: string[] = [];
  dynamicHtmlAttributes: string[] = [];
  dynamicCssProperties: string[] = [];
  dynamicCssVariables: string[] = [];
  dynamicDataviewApi: string[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: CustomDatabaseStudioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { 
    return VIEW_TYPE_STUDIO; 
  }
  
  getDisplayText(): string { 
    return "Database Studio"; 
  }

  /**
   * Introspects browser prototypes, Obsidian theme CSS variables, 
   * vault metadata cache, and Dataview API dynamically.
   */
  async loadVaultIntelligence() {
    // 1. Dynamic HTML tags from browser DOM interface prototypes
    const htmlSet = new Set<string>();
    for (const key of Object.getOwnPropertyNames(window)) {
      const match = key.match(/^HTML([A-Za-z0-9]+)Element$/);
      if (match && match[1]) {
        const tag = match[1].toLowerCase();
        if (tag && tag !== 'unknown' && tag !== 'heading') {
          htmlSet.add(tag);
        }
      }
    }
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 
     'table', 'thead', 'tbody', 'tr', 'th', 'td', 'form', 'input', 'button', 'select', 'option', 
     'textarea', 'label', 'section', 'article', 'nav', 'header', 'footer', 'main', 'aside'].forEach(t => htmlSet.add(t));
    this.dynamicHtmlTags = Array.from(htmlSet).sort();

    // 2. Dynamic HTML attributes
    const attrSet = new Set<string>(['class', 'id', 'src', 'href', 'style', 'alt', 'title', 'type', 'value', 'placeholder', 'target', 'data-']);
    const dummyEl = document.createElement('div');
    for (const key in dummyEl) {
      if (key.startsWith('on')) attrSet.add(key);
    }
    this.dynamicHtmlAttributes = Array.from(attrSet).sort();

    // 3. Dynamic CSS properties from CSSStyleDeclaration
    const cssPropSet = new Set<string>();
    const styleProto = document.body.style;
    for (const prop in styleProto) {
      if (typeof styleProto[prop] === 'string' && !prop.startsWith('webkit') && !prop.startsWith('moz')) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (kebab && !kebab.startsWith('-') && isNaN(Number(kebab))) {
          cssPropSet.add(kebab);
        }
      }
    }
    this.dynamicCssProperties = Array.from(cssPropSet).sort();

    // 4. Dynamic CSS variables active in Obsidian's theme
    const cssVarSet = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && (rule.selectorText === ':root' || rule.selectorText === 'body')) {
            for (let i = 0; i < rule.style.length; i++) {
              const varName = rule.style[i];
              if (varName && varName.startsWith('--')) {
                cssVarSet.add(varName);
              }
            }
          }
        }
      } catch (e) {
        // Cross-origin stylesheet rules might be protected
      }
    }
    // Fallback standard Obsidian CSS variables if stylesheets are locked
    ['--background-primary', '--background-secondary', '--background-modifier-border', 
     '--background-modifier-hover', '--text-normal', '--text-muted', '--interactive-accent', 
     '--text-on-accent', '--text-error', '--font-monospace'].forEach(v => cssVarSet.add(v));
    this.dynamicCssVariables = Array.from(cssVarSet).sort();

    // 5. Dynamic Dataview API introspection
    const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;
    if (dvApi) {
      const dvKeys = new Set<string>([...Object.keys(dvApi), ...Object.getOwnPropertyNames(Object.getPrototypeOf(dvApi) || {})]);
      this.dynamicDataviewApi = Array.from(dvKeys).map(k => typeof dvApi[k] === 'function' ? `dv.${k}()` : `dv.${k}`);
    } else {
      this.dynamicDataviewApi = ['dv.pages()', 'dv.page()', 'dv.current()', 'dv.array()', 'dv.table()', 'dv.list()', 'dv.header()', 'dv.paragraph()'];
    }

    // 6. Vault folders, tags, and frontmatter keys
    const folderSet = new Set<string>();
    const allFiles = this.app.vault.getAllLoadedFiles();
    for (const file of allFiles) {
      if (file instanceof TFolder && file.path && file.path !== '/') {
        folderSet.add(`"${file.path}"`);
      }
    }
    this.dynamicVaultFolders = Array.from(folderSet).sort();

    const tagsObj = (this.app.metadataCache as any).getTags?.() || {};
    this.dynamicVaultTags = Object.keys(tagsObj).map(t => `"${t}"`);

    const keySet = new Set<string>();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        Object.keys(cache.frontmatter).forEach(k => {
          if (k !== 'position') keySet.add(k);
        });
      }
    }
    this.dynamicFrontmatterKeys = Array.from(keySet).sort();
  }

  /**
   * Scans active editor buffer for user-declared tokens
   */
  getBufferTokens(content: string): string[] {
    const matches = content.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
  }

  resolveVersion(versions: VersionSnapshot[], targetIdx: number) {
    let html = "";
    let css = "";
    let js = "";
    for (let i = 0; i <= targetIdx; i++) {
      const v = versions[i];
      if (v) {
        if (v.html !== null) html = v.html;
        if (v.css !== null) css = v.css;
        if (v.js !== null) js = v.js;
      }
    }
    return { html, css, js };
  }

  /**
   * Scores and ranks suggestions. Prefix matches always rank highest,
   * followed by word-boundary matches, then substrings.
   */
  scoreSuggestion(target: string, query: string, type: string): number {
    const text = target.toLowerCase();
    const q = query.toLowerCase();

    if (!q || !text.includes(q)) return 0;
    if (text === q) return 1000; // Exact match

    let score = 0;

    // 1. Prefix match (highest priority: 'div' starts with 'di')
    if (text.startsWith(q)) {
      score = 600 - (text.length - q.length) * 3;
    }
    // 2. Word boundary match ('flex-direction' matching 'dir', or 'dv.pages' matching 'page')
    else if (new RegExp(`[\\-_.:]${q}`, 'i').test(text)) {
      score = 400 - text.length * 2;
    }
    // 3. Substring match ('audio' containing 'di')
    else {
      const idx = text.indexOf(q);
      score = 150 - (idx * 10) - (text.length * 2);
    }

    // Common HTML element priority boost
    const commonHtml = new Set(['div', 'span', 'p', 'a', 'img', 'button', 'input', 'ul', 'li', 'h1', 'h2', 'h3']);
    if (type === 'html' && commonHtml.has(text)) {
      score += 30;
    }

    // Common CSS property priority boost
    const commonCss = new Set(['display', 'flex', 'grid', 'color', 'background', 'margin', 'padding', 'width', 'height', 'border']);
    if (type === 'css-prop' && commonCss.has(text)) {
      score += 30;
    }

    return Math.max(score, 1);
  }

  /**
   * Enhanced autocomplete using Obsidian native suggestion aesthetics,
   * fuzzy prefix scoring, and context-sensitive token recognition.
   */
  enhanceEditor(
    textarea: HTMLTextAreaElement,
    mode: 'html' | 'css' | 'js',
    onInputCallback: () => void
  ) {
    const dropdown = document.createElement('div');
    dropdown.className = 'suggestion-container cds-autocomplete-menu';
    dropdown.style.cssText = `
      position: absolute; display: none; z-index: 1000;
      max-height: 220px; width: 280px; overflow-y: auto;
      background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
      border-radius: var(--radius-m); box-shadow: var(--shadow-s); padding: 4px;
    `;
    
    const wrapper = textarea.parentElement;
    if (wrapper) {
      wrapper.style.setProperty('position', 'relative');
      wrapper.appendChild(dropdown);
    }

    let activeIndex = 0;
    let filteredList: AutocompleteSuggestion[] = [];
    let replaceStartPos = 0;

    const hideDropdown = () => {
      dropdown.style.display = 'none';
      filteredList = [];
    };

    const updateSelectionHighlight = () => {
      Array.from(dropdown.children).forEach((child, idx) => {
        const itemEl = child as HTMLElement;
        if (idx === activeIndex) {
          itemEl.addClass('is-selected');
          itemEl.style.background = 'var(--background-modifier-hover)';
          itemEl.scrollIntoView({ block: 'nearest' });
        } else {
          itemEl.removeClass('is-selected');
          itemEl.style.background = 'transparent';
        }
      });
    };

    const insertSuggestion = (item: AutocompleteSuggestion) => {
      const currentPos = textarea.selectionStart;
      const text = textarea.value;
      const insertText = item.text;
      
      textarea.value = text.substring(0, replaceStartPos) + insertText + text.substring(currentPos);
      const newCursorPos = replaceStartPos + insertText.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      
      hideDropdown();
      onInputCallback();
      textarea.focus();
    };

    const computeCaretPosition = (pos: number) => {
  const div = document.createElement('div');
  const style = window.getComputedStyle(textarea);

  const caretStyles = [
    'direction', 'box-sizing', 'width', 'height', 'overflow-x', 'overflow-y',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-style', 'font-variant', 'font-weight', 'font-size', 'line-height',
    'font-family', 'text-align', 'letter-spacing', 'word-spacing'
  ];

  caretStyles.forEach(prop => {
    const val = style.getPropertyValue(prop);
    if (val) {
      div.style.setProperty(prop, val);
    }
  });

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  document.body.appendChild(div);

  div.textContent = textarea.value.substring(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '|';
  div.appendChild(marker);

  const coords = {
    top: marker.offsetTop - textarea.scrollTop + parseInt(style.paddingTop || '0', 10),
    left: marker.offsetLeft - textarea.scrollLeft + parseInt(style.paddingLeft || '0', 10)
  };

  document.body.removeChild(div);
  return coords;
};

    const getSuggestionsForContext = (textBefore: string): { suggestions: AutocompleteSuggestion[], startOffset: number } => {
      const bufferWords = this.getBufferTokens(textarea.value);


      // --- HTML CONTEXT ---
if (mode === 'html') {
  const tagMatch = textBefore.match(/<([a-zA-Z0-9-]*)$/);
  if (tagMatch) {
    const query = tagMatch[1] ?? '';
    return {
      startOffset: query.length,
      suggestions: this.dynamicHtmlTags.map(t => ({ text: t, type: 'html' as const }))
    };
  }

  const attrMatch = textBefore.match(/\s+([a-zA-Z0-9-]*)$/);
  if (attrMatch && !textBefore.endsWith('>')) {
    const query = attrMatch[1] ?? '';
    return {
      startOffset: query.length,
      suggestions: this.dynamicHtmlAttributes.map(a => ({ text: `${a}=""`, displayText: a, type: 'attr' as const }))
    };
  }
}

// --- CSS CONTEXT ---
if (mode === 'css') {
  const varMatch = textBefore.match(/var\((--[a-zA-Z0-9-]*)$/);
  if (varMatch) {
    const query = varMatch[1] ?? '';
    return {
      startOffset: query.length,
      suggestions: this.dynamicCssVariables.map(v => ({ text: `${v})`, displayText: v, type: 'css-var' as const }))
    };
  }

  const propMatch = textBefore.match(/([a-zA-Z-]*)$/);
  if (propMatch) {
    const query = propMatch[1] ?? '';
    return {
      startOffset: query.length,
      suggestions: [
        ...this.dynamicCssProperties.map(p => ({ text: `${p}: `, displayText: p, type: 'css-prop' as const })),
        ...this.dynamicCssVariables.map(v => ({ text: `var(${v});`, displayText: v, type: 'css-var' as const }))
      ]
    };
  }
}

// --- JS / DATAVIEW CONTEXT ---
if (mode === 'js') {
  if (/dv\.pages\([^)]*$/.test(textBefore)) {
    const match = textBefore.match(/dv\.pages\(([^)]*)$/);
    const query = match?.[1]?.replace(/["']/g, '') ?? '';
    return {
      startOffset: query.length,
      suggestions: [
        ...this.dynamicVaultFolders.map(f => ({ text: `${f})`, displayText: f, type: 'vault' as const })),
        ...this.dynamicVaultTags.map(t => ({ text: `${t})`, displayText: t, type: 'vault' as const }))
      ]
    };
  }

  if (textBefore.endsWith('dv.')) {
    return {
      startOffset: 0,
      suggestions: this.dynamicDataviewApi.map(api => ({
        text: api.replace(/^dv\./, ''),
        displayText: api,
        type: 'dv' as const
      }))
    };
  }

  if (/(\w+)\.$/.test(textBefore)) {
    return {
      startOffset: 0,
      suggestions: this.dynamicFrontmatterKeys.map(k => ({ text: k, type: 'prop' as const }))
    };
  }

  const tokenMatch = textBefore.match(/([a-zA-Z0-9_$]+)$/);
  if (tokenMatch) {
    const query = tokenMatch[1] ?? '';
    return {
      startOffset: query.length,
      suggestions: [
        ...this.dynamicDataviewApi.map(d => ({ text: d, type: 'dv' as const })),
        ...this.dynamicFrontmatterKeys.map(k => ({ text: k, type: 'prop' as const })),
        ...bufferWords.map(w => ({ text: w, type: 'buffer' as const }))
      ]
    };
  }
}

// Generic buffer word match fallback
const wordMatch = textBefore.match(/([a-zA-Z0-9_-]+)$/);
if (wordMatch) {
  const query = wordMatch[1] ?? '';
  return {
    startOffset: query.length,
    suggestions: bufferWords.map(w => ({ text: w, type: 'buffer' as const }))
  };
}

      return { suggestions: [], startOffset: 0 };
    };

    textarea.addEventListener('input', () => {
      onInputCallback();
      const pos = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, pos);
      const { suggestions, startOffset } = getSuggestionsForContext(textBefore);

      const activeWord = textBefore.substring(pos - startOffset).toLowerCase();
      if (!activeWord || activeWord.length < 1) {
        hideDropdown();
        return;
      }

      replaceStartPos = pos - startOffset;

      // Score and rank all suggestions
      filteredList = suggestions
        .map(s => {
          const candidate = s.displayText || s.text;
          return {
            ...s,
            score: this.scoreSuggestion(candidate, activeWord, s.type)
          };
        })
        .filter(s => (s.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) // Highest score first
        .slice(0, 15);

      if (filteredList.length === 0) {
        hideDropdown();
        return;
      }

      dropdown.empty();
      activeIndex = 0;

      filteredList.forEach((item, idx) => {
        const itemEl = dropdown.createDiv({ cls: 'suggestion-item' });
        itemEl.style.cssText = `
          padding: 6px 10px; cursor: pointer; border-radius: 4px;
          display: flex; justify-content: space-between; align-items: center;
          font-family: var(--font-monospace); font-size: 0.8rem;
        `;

        const rawText = item.displayText || item.text;
        const label = itemEl.createSpan();

        // Highlight the matched substring
        const matchIdx = rawText.toLowerCase().indexOf(activeWord);
        if (matchIdx !== -1) {
          label.createSpan({ text: rawText.substring(0, matchIdx) });
          const highlight = label.createSpan({ 
            text: rawText.substring(matchIdx, matchIdx + activeWord.length) 
          });
          highlight.style.fontWeight = '700';
          highlight.style.color = 'var(--interactive-accent)';
          label.createSpan({ text: rawText.substring(matchIdx + activeWord.length) });
        } else {
          label.textContent = rawText;
        }

        const badge = itemEl.createSpan({ text: item.type.toUpperCase() });
        badge.style.cssText = `
          font-size: 0.65rem; color: var(--text-muted); opacity: 0.8;
          background: var(--background-primary); padding: 1px 4px; border-radius: 3px;
        `;

        itemEl.onmousedown = (e) => {
          e.preventDefault();
          insertSuggestion(item);
        };
        dropdown.appendChild(itemEl);
      });

      const coords = computeCaretPosition(pos);
      dropdown.style.top = `${coords.top + 20}px`;
      dropdown.style.left = `${Math.min(coords.left, Math.max(0, textarea.clientWidth - 290))}px`;
      dropdown.style.display = 'block';
      updateSelectionHighlight();
    });

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (dropdown.style.display === 'block') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIndex = (activeIndex + 1) % filteredList.length;
          updateSelectionHighlight();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIndex = (activeIndex - 1 + filteredList.length) % filteredList.length;
          updateSelectionHighlight();
          return;
        }
if (e.key === 'Enter' || e.key === 'Tab') {
  const selectedItem = filteredList[activeIndex];
  if (selectedItem) {
    e.preventDefault();
    insertSuggestion(selectedItem);
    return;
  }
}
        if (e.key === 'Escape') {
          hideDropdown();
          return;
        }
      }

      // Auto-indent with 2 spaces
      if (e.key === 'Tab' && dropdown.style.display !== 'block') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.setSelectionRange(start + 2, start + 2);
        onInputCallback();
        return;
      }

      // Auto-closing brackets and quotes
      const pairs: Record<string, string> = { '"': '"', "'": "'", '(': ')', '{': '}', '[': ']', '`': '`' };
      if (pairs[e.key]) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        e.preventDefault();
        if (start !== end) {
          const selected = textarea.value.substring(start, end);
          textarea.value = textarea.value.substring(0, start) + e.key + selected + pairs[e.key] + textarea.value.substring(end);
          textarea.setSelectionRange(start + 1, end + 1);
        } else {
          textarea.value = textarea.value.substring(0, start) + e.key + pairs[e.key] + textarea.value.substring(end);
          textarea.setSelectionRange(start + 1, start + 1);
        }
        onInputCallback();
      }
    });

    textarea.addEventListener('blur', () => {
      setTimeout(hideDropdown, 200);
    });
  }

  async onOpen() {
    await this.loadVaultIntelligence();

    const container = this.contentEl;
    container.empty();
    container.addClass('cds-studio-root');

    const styleId = "cds-studio-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        .cds-studio-root { display: flex; flex-direction: column; height: 100%; gap: 12px; padding: 16px; box-sizing: border-box; }
        .cds-toolbar { display: flex; gap: 8px; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; flex-wrap: wrap; }
        .cds-select { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-normal); padding: 6px 10px; border-radius: 6px; font-size: 0.85rem; outline: none; }
        .cds-select:focus { border-color: var(--interactive-accent); }
        .cds-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; }
        .cds-tab-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 14px; border-radius: 4px; cursor: pointer; color: var(--text-normal); font-weight: 500; }
        .cds-tab-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
        .cds-save-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .cds-editor-pane { flex: 1; display: none; flex-direction: column; gap: 6px; position: relative; }
        .cds-editor-pane.active { display: flex; }
        .cds-textarea { width: 100%; flex: 1; font-family: var(--font-monospace); font-size: 0.85rem; background: var(--background-primary); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px; resize: none; outline: none; }
        .cds-textarea:focus { border-color: var(--interactive-accent); }
        .cds-preview-pane { flex: 1; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: auto; padding: 12px; }
        .cds-split { display: flex; flex-direction: column; height: 45%; gap: 10px; }
      `;
      document.head.appendChild(style);
    }

    let htmlCode = "<div class=\"filter-bar\"></div>\n<div class=\"book-grid\"></div>";
    let cssCode = ".filter-bar { display: flex; gap: 8px; margin-bottom: 16px; }\n.filter-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 12px; border-radius: 4px; color: var(--text-normal); cursor: pointer; }\n.filter-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); }\n.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }";
    let jsCode = "const pages = dv ? dv.pages() : [];\ncontainer.innerHTML = htmlContent;\nconst grid = container.querySelector('.book-grid');\nfor (const p of pages.slice(0, 8)) {\n  const el = document.createElement('div');\n  el.style.padding = '8px';\n  el.style.border = '1px solid var(--background-modifier-border)';\n  el.innerText = p.file.name;\n  grid.appendChild(el);\n}";

    const toolbar = container.createDiv({ cls: 'cds-toolbar' });
    toolbar.createEl('span', { text: 'Note:', attr: { style: 'font-weight:600; font-size:0.85rem;' } });
    const fileSelect = toolbar.createEl('select', { cls: 'cds-select' });
    fileSelect.createEl('option', { text: 'Scanning notes...', attr: { value: '', disabled: true } });

    toolbar.createEl('span', { text: 'Version:', attr: { style: 'font-weight:600; font-size:0.85rem; margin-left: 8px;' } });
    const versionSelect = toolbar.createEl('select', { cls: 'cds-select' });
    versionSelect.createEl('option', { text: '-- Select Version --', attr: { value: '', disabled: true } });

    const newVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: '+ Save as New' });
    const renameVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: 'Rename' });
    const removeVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: '🗑️ Remove Last' });
    const saveBtn = toolbar.createEl('button', { cls: 'cds-save-btn', text: '💾 Save to Note', attr: { style: 'margin-left: auto;' } });

    (async () => {
      fileSelect.empty();
      fileSelect.createEl('option', { text: '-- Select DataviewJS Note --', attr: { value: '' } });
      for (const file of this.app.vault.getMarkdownFiles()) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (content.includes('dataviewjs')) {
            fileSelect.createEl('option', { text: file.path, attr: { value: file.path } });
          }
        } catch (e) {}
      }
    })();

    const tabHeader = container.createDiv({ cls: 'cds-tabs' });
    const htmlBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn active', text: 'HTML' });
    const cssBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'CSS' });
    const jsBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'JS Logic' });

    const splitContainer = container.createDiv({ cls: 'cds-split' });

    const htmlPane = splitContainer.createDiv({ cls: 'cds-editor-pane active' });
    const htmlArea = htmlPane.createEl('textarea', { cls: 'cds-textarea' });
    htmlArea.value = htmlCode;

    const cssPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });
    const cssArea = cssPane.createEl('textarea', { cls: 'cds-textarea' });
    cssArea.value = cssCode;

    const jsPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });
    const jsArea = jsPane.createEl('textarea', { cls: 'cds-textarea' });
    jsArea.value = jsCode;

    let debounceTimer: any = null;
    const triggerHotReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runCode(), 250);
    };

    // Attach dynamic contextual autocompletion to each editor pane
    this.enhanceEditor(htmlArea, 'html', () => { htmlCode = htmlArea.value; triggerHotReload(); });
    this.enhanceEditor(cssArea, 'css', () => { cssCode = cssArea.value; triggerHotReload(); });
    this.enhanceEditor(jsArea, 'js', () => { jsCode = jsArea.value; triggerHotReload(); });

    const previewWrapper = container.createDiv({ cls: 'cds-preview-pane' });
    previewWrapper.createEl('h4', { text: 'Live Preview Output', attr: { style: 'margin-top:0; margin-bottom:8px; font-size:0.85rem; color:var(--text-muted);' } });
    const previewContainer = previewWrapper.createDiv();

    const runCode = () => {
      previewContainer.empty();
      const shadowHost = previewContainer.createDiv();
      const shadow = shadowHost.attachShadow({ mode: 'open' });

      const styleTag = document.createElement('style');
      styleTag.textContent = cssCode;
      shadow.appendChild(styleTag);

      const bodyDiv = document.createElement('div');
      shadow.appendChild(bodyDiv);

      try {
        // Resolve real Dataview API so live preview has access to dv
        const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;
        const executeFn = new Function('container', 'htmlContent', 'app', 'notice', 'dv', jsCode);
        executeFn(bodyDiv, htmlCode, this.app, (msg: string) => new Notice(msg), dvApi);
      } catch (err: any) {
        const errDiv = document.createElement('div');
        errDiv.style.color = 'var(--text-error)';
        errDiv.style.fontFamily = 'var(--font-monospace)';
        errDiv.innerText = `Runtime Error: ${err.message}`;
        shadow.appendChild(errDiv);
      }
    };

    const updateVersionDropdown = (path: string, selectedTag?: string) => {
      versionSelect.empty();
      const versions = this.plugin.data.versions[path] || [];
      if (versions.length === 0) {
        versionSelect.createEl('option', { text: 'No versions yet', attr: { value: '', disabled: true } });
        return;
      }
      versions.forEach((v, idx) => {
        const opt = versionSelect.createEl('option', { text: v.tag, attr: { value: idx.toString() } });
        if (selectedTag && v.tag === selectedTag) opt.selected = true;
      });
    };

    fileSelect.onchange = async () => {
      const selectedPath = fileSelect.value;
      if (!selectedPath) {
        this.currentFile = null;
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        this.currentFile = file;
        const content = await this.app.vault.read(file);
        
        const match = content.match(/```dataviewjs([\s\S]*?)```/);
        if (match && match[1]) {
          const code = match[1];

          const cssMatch = code.match(/style\.innerHTML\s*=\s*`([\s\S]*?)`;/);
          cssCode = cssMatch && cssMatch[1] ? cssMatch[1] : "";
          cssArea.value = cssCode;

          const htmlMatch = code.match(/const\s+htmlContent\s*=\s*`([\s\S]*?)`;/);
          htmlCode = htmlMatch && htmlMatch[1] ? htmlMatch[1] : "";
          htmlArea.value = htmlCode;

          const jsSplit = code.split('// --- JS ---');
          if (jsSplit[1]) {
            jsCode = jsSplit[1].replace(/^\s*const\s+container\s*=\s*this\.container;\s*/, '').trim();
          } else {
            jsCode = code.trim();
          }
          jsArea.value = jsCode;
        } else {
          jsCode = content;
          jsArea.value = jsCode;
        }

        if (!this.plugin.data.versions[file.path]) {
          this.plugin.data.versions[file.path] = [{
            tag: "v0 - Initial",
            html: htmlCode,
            css: cssCode,
            js: jsCode,
            timestamp: Date.now()
          }];
          await this.plugin.saveStudioData();
        }

        updateVersionDropdown(file.path, this.plugin.data.versions[file.path]?.[0]?.tag);
        new Notice(`Loaded note: ${file.name}`);
        runCode();
      }
    };

    versionSelect.onchange = () => {
      if (!this.currentFile) return;
      const idx = parseInt(versionSelect.value, 10);
      const versions = this.plugin.data.versions[this.currentFile.path] || [];
      const selectedVersion = versions[idx];
      if (selectedVersion) {
        const resolved = this.resolveVersion(versions, idx);
        htmlCode = resolved.html;
        htmlArea.value = htmlCode;
        cssCode = resolved.css;
        cssArea.value = cssCode;
        jsCode = resolved.js;
        jsArea.value = jsCode;
        new Notice(`Loaded version: ${selectedVersion.tag}`);
        runCode();
      }
    };

    newVersionBtn.onclick = () => {
      if (!this.currentFile) {
        new Notice("Please select a note from the dropdown first!");
        return;
      }
      const path = this.currentFile.path;
      if (!this.plugin.data.versions[path]) {
        this.plugin.data.versions[path] = [];
      }
      const versionsArray = this.plugin.data.versions[path];
      const nextVersionNum = versionsArray ? versionsArray.length : 0;
      const currentSelectedIdx = parseInt(versionSelect.value, 10) || (versionsArray.length - 1);
      const parentResolved = this.resolveVersion(versionsArray, currentSelectedIdx);

      new VersionPromptModal(this.app, "Save as New Version", `v${nextVersionNum} - Update`, async (fullTagInput) => {
        const tag = fullTagInput.startsWith('v') ? fullTagInput : `v${nextVersionNum} - ${fullTagInput}`;
        
        const newSnapshot: VersionSnapshot = {
          tag,
          html: htmlCode === parentResolved.html ? null : htmlCode,
          css: cssCode === parentResolved.css ? null : cssCode,
          js: jsCode === parentResolved.js ? null : jsCode,
          timestamp: Date.now()
        };

        this.plugin.data.versions[path]!.push(newSnapshot);
        await this.plugin.saveStudioData();

        updateVersionDropdown(path, tag);
        new Notice(`Created delta version ${tag}`);
      }).open();
    };

    renameVersionBtn.onclick = () => {
      if (!this.currentFile) {
        new Notice("Please select a note first!");
        return;
      }
      const path = this.currentFile.path;
      const idx = parseInt(versionSelect.value, 10);
      const versions = this.plugin.data.versions[path];

      if (isNaN(idx) || !versions || !versions[idx]) {
        new Notice("Please select a version to rename!");
        return;
      }

      const currentTag = versions[idx]!.tag;

      new VersionPromptModal(this.app, "Rename Version", currentTag, async (newTag) => {
        versions[idx]!.tag = newTag;
        await this.plugin.saveStudioData();
        updateVersionDropdown(path, newTag);
        new Notice(`Renamed version to ${newTag}`);
      }).open();
    };

    removeVersionBtn.onclick = () => {
      if (!this.currentFile) {
        new Notice("Please select a note first!");
        return;
      }
      const path = this.currentFile.path;
      const versions = this.plugin.data.versions[path];

      if (!versions || versions.length <= 1) {
        new Notice("Cannot remove the last remaining version!");
        return;
      }

      const lastVersion = versions[versions.length - 1];

      new ConfirmModal(
        this.app,
        "Remove Last Version",
        `Are you sure you want to delete the latest version "${lastVersion?.tag}"?`,
        async () => {
          versions.pop();
          await this.plugin.saveStudioData();
          
          const newLatestIdx = versions.length - 1;
          const resolved = this.resolveVersion(versions, newLatestIdx);
          htmlCode = resolved.html;
          htmlArea.value = htmlCode;
          cssCode = resolved.css;
          cssArea.value = cssCode;
          jsCode = resolved.js;
          jsArea.value = jsCode;
          runCode();

          updateVersionDropdown(path, versions[newLatestIdx]?.tag);
          new Notice("Successfully removed the last version.");
        }
      ).open();
    };

    saveBtn.onclick = async () => {
      if (!this.currentFile) {
        new Notice("Please select and load a vault note first!");
        return;
      }
      try {
        const uniqueId = `cds-style-${this.currentFile.basename.replace(/[^a-zA-Z0-9_-]/g, '')}`;
        const wrappedContent = [
          "```dataviewjs",
          "// --- CSS ---",
          `const styleId = "${uniqueId}";`,
          'if (!document.getElementById(styleId)) {',
          '  const style = document.createElement("style");',
          '  style.id = styleId;',
          `  style.innerHTML = \`${cssCode}\`;`,
          '  document.head.appendChild(style);',
          '}',
          '',
          "// --- HTML ---",
          `const htmlContent = \`${htmlCode}\`;`,
          '',
          "// --- JS ---",
          'const container = this.container;',
          jsCode,
          "```"
        ].join('\n');

        await this.app.vault.modify(this.currentFile, wrappedContent);
        new Notice(`Successfully saved to ${this.currentFile.name}!`);
      } catch (err: any) {
        new Notice("Failed to save: " + err.message);
      }
    };

    const switchTab = (tab: string) => {
      htmlBtn.toggleClass('active', tab === 'html');
      cssBtn.toggleClass('active', tab === 'css');
      jsBtn.toggleClass('active', tab === 'js');
      htmlPane.toggleClass('active', tab === 'html');
      cssPane.toggleClass('active', tab === 'css');
      jsPane.toggleClass('active', tab === 'js');
    };

    htmlBtn.onclick = () => switchTab('html');
    cssBtn.onclick = () => switchTab('css');
    jsBtn.onclick = () => switchTab('js');

    runCode();
  }

  async onClose() {}
}