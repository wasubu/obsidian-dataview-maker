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

interface SyntaxErrorDetail {
  line: number;
  message: string;
}

export class StudioView extends ItemView {
  plugin: CustomDatabaseStudioPlugin;
  currentFile: TFile | null = null;

  // Dynamic collections
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

  async loadVaultIntelligence() {
    // 1. Dynamic HTML tags
    const htmlSet = new Set<string>();
    for (const key of Object.getOwnPropertyNames(window)) {
      const match = key.match(/^HTML([A-Za-z0-9]+)Element$/);
      if (match && match[1]) {
        const tag = match[1].toLowerCase();
        if (tag && tag !== 'unknown' && tag !== 'heading') htmlSet.add(tag);
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

    // 3. Dynamic CSS properties
    const cssPropSet = new Set<string>();
    const styleProto = document.body.style;
    for (const prop in styleProto) {
      if (typeof styleProto[prop] === 'string' && !prop.startsWith('webkit') && !prop.startsWith('moz')) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (kebab && !kebab.startsWith('-') && isNaN(Number(kebab))) cssPropSet.add(kebab);
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
              if (varName && varName.startsWith('--')) cssVarSet.add(varName);
            }
          }
        }
      } catch (e) {}
    }
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
      this.dynamicDataviewApi = ['dv.pages()', 'dv.page()', 'dv.current()', 'dv.array()', 'dv.table()', 'dv.list()', 'dv.header()'];
    }

    // 6. Vault folders, tags, and properties
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

  scoreSuggestion(target: string, query: string, type: string): number {
    const text = target.toLowerCase();
    const q = query.toLowerCase();

    if (!q || !text.includes(q)) return 0;
    if (text === q) return 1000;

    let score = 0;
    if (text.startsWith(q)) {
      score = 600 - (text.length - q.length) * 3;
    } else if (new RegExp(`[\\-_.:]${q}`, 'i').test(text)) {
      score = 400 - text.length * 2;
    } else {
      const idx = text.indexOf(q);
      score = 150 - (idx * 10) - (text.length * 2);
    }

    const commonHtml = new Set(['div', 'span', 'p', 'a', 'img', 'button', 'input', 'ul', 'li', 'h1', 'h2', 'h3']);
    if (type === 'html' && commonHtml.has(text)) score += 30;

    const commonCss = new Set(['display', 'flex', 'grid', 'color', 'background', 'margin', 'padding', 'width', 'height', 'border']);
    if (type === 'css-prop' && commonCss.has(text)) score += 30;

    return Math.max(score, 1);
  }

  /**
   * Fast syntax color tokenizer
   */
  highlightCode(code: string, mode: 'html' | 'css' | 'js'): string {
    const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (mode === 'html') {
      return code.replace(/(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9-]+)|([\w:-]+)(=)("[^"]*"|'[^']*')|(>|\/>)/g, 
        (_m, comment, tag, attr, eq, val, close) => {
          if (comment) return `<span class="cds-tok-comment">${escapeHtml(comment)}</span>`;
          if (tag) return `<span class="cds-tok-tag">${escapeHtml(tag)}</span>`;
          if (attr) return `<span class="cds-tok-attr">${escapeHtml(attr)}</span>${eq}<span class="cds-tok-str">${escapeHtml(val || '')}</span>`;
          if (close) return `<span class="cds-tok-tag">${escapeHtml(close)}</span>`;
          return escapeHtml(_m);
        }
      );
    }

    if (mode === 'css') {
      return code.replace(/(\/\*[\s\S]*?\*\/)|([.#][\w-]+)|([a-zA-Z-]+)\s*(:)|("[^"]*"|'[^']*')|([0-9.]+(?:px|rem|em|%|vh|vw|s|ms)?)|(var\(--[\w-]+\))/g,
        (_m, comment, selector, prop, colon, str, num, cssVar) => {
          if (comment) return `<span class="cds-tok-comment">${escapeHtml(comment)}</span>`;
          if (selector) return `<span class="cds-tok-tag">${escapeHtml(selector)}</span>`;
          if (prop) return `<span class="cds-tok-prop">${escapeHtml(prop)}</span>${colon}`;
          if (str) return `<span class="cds-tok-str">${escapeHtml(str)}</span>`;
          if (num) return `<span class="cds-tok-num">${escapeHtml(num)}</span>`;
          if (cssVar) return `<span class="cds-tok-var">${escapeHtml(cssVar)}</span>`;
          return escapeHtml(_m);
        }
      );
    }

    // JS mode
    return code.replace(/(\/\/.*|\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*'|`[\s\S]*?`)|(\b(?:const|let|var|function|return|if|else|for|while|import|export|class|new|async|await|try|catch|switch|case|break)\b)|(\b(?:true|false|null|undefined)\b)|(\b(?:dv|app|container|window|document)\b)|(\b\d+\b)/g,
      (_m, comment, str, kw, bool, builtin, num) => {
        if (comment) return `<span class="cds-tok-comment">${escapeHtml(comment)}</span>`;
        if (str) return `<span class="cds-tok-str">${escapeHtml(str)}</span>`;
        if (kw) return `<span class="cds-tok-kw">${escapeHtml(kw)}</span>`;
        if (bool) return `<span class="cds-tok-bool">${escapeHtml(bool)}</span>`;
        if (builtin) return `<span class="cds-tok-builtin">${escapeHtml(builtin)}</span>`;
        if (num) return `<span class="cds-tok-num">${escapeHtml(num)}</span>`;
        return escapeHtml(_m);
      }
    );
  }

  /**
   * Validates syntax and returns error details with line numbers
   */
  validateSyntax(code: string, mode: 'html' | 'css' | 'js'): SyntaxErrorDetail | null {
    if (!code.trim()) return null;

    if (mode === 'js') {
      try {
        new Function(code);
      } catch (err: any) {
        let line = 1;
        const lineMatch = err.stack?.match(/<anonymous>:(\d+):(\d+)/);
        if (lineMatch && lineMatch[1]) {
          line = Math.max(1, parseInt(lineMatch[1], 10) - 2); // Function wrapper offset
        } else {
          // Fallback bracket matching
          const openCurl = (code.match(/{/g) || []).length;
          const closeCurl = (code.match(/}/g) || []).length;
          if (openCurl !== closeCurl) {
            line = code.split('\n').length;
          }
        }
        return { line, message: err.message };
      }
    }

    if (mode === 'css') {
      const openBraces = (code.match(/{/g) || []).length;
      const closeBraces = (code.match(/}/g) || []).length;
      if (openBraces !== closeBraces) {
        return { line: code.split('\n').length, message: `Unmatched curly braces: ${openBraces} '{' vs ${closeBraces} '}'` };
      }
    }

    if (mode === 'html') {
      const tags = Array.from(code.matchAll(/<\/?([a-zA-Z0-9-]+)[^>]*>/g));
      const stack: { tag: string; line: number }[] = [];
      const selfClosing = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
      
      const lines = code.split('\n');
      for (const m of tags) {
        const full = m[0];
        const name = m[1] ? m[1].toLowerCase() : '';
        if (selfClosing.has(name) || full.endsWith('/>')) continue;

        const charIdx = m.index || 0;
        const lineNum = code.substring(0, charIdx).split('\n').length;

        if (full.startsWith('</')) {
          if (stack.length === 0 || stack[stack.length - 1]?.tag !== name) {
            return { line: lineNum, message: `Mismatched closing tag </${name}>` };
          }
          stack.pop();
        } else {
          stack.push({ tag: name, line: lineNum });
        }
      }
      if (stack.length > 0) {
        const unclosed = stack.pop();
        return { line: unclosed?.line || lines.length, message: `Unclosed tag <${unclosed?.tag}>` };
      }
    }

    return null;
  }

  /**
   * Creates a code editor with line numbers, code colors, error highlighting,
   * spellcheck disabled, and contextual autocomplete.
   */
  createCodeEditor(
    parent: HTMLElement,
    mode: 'html' | 'css' | 'js',
    initialCode: string,
    onChange: (val: string) => void
  ) {
    const editorRoot = parent.createDiv({ cls: 'cds-editor-wrapper' });

    // Gutter for line numbers
    const gutter = editorRoot.createDiv({ cls: 'cds-gutter' });

    // Inner editor container
    const editArea = editorRoot.createDiv({ cls: 'cds-code-box' });

    // Syntax-highlighted display layer
    const highlightPre = editArea.createEl('pre', { cls: 'cds-highlight-layer' });
    const highlightCodeEl = highlightPre.createEl('code');

    // Input Textarea
    const textarea = editArea.createEl('textarea', { cls: 'cds-textarea-layer' });
    textarea.value = initialCode;

    // Turn off browser spellcheck and grammar underlines
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('data-gramm', 'false');
    textarea.setAttribute('data-enable-grammarly', 'false');

    // Error status banner
    const errorBar = editorRoot.createDiv({ cls: 'cds-error-banner' });
    errorBar.style.display = 'none';

    // Autocomplete dropdown
    const dropdown = editArea.createDiv({ cls: 'suggestion-container cds-autocomplete-menu' });
    dropdown.style.cssText = `
      position: absolute; display: none; z-index: 1000;
      max-height: 220px; width: 280px; overflow-y: auto;
      background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
      border-radius: var(--radius-m); box-shadow: var(--shadow-s); padding: 4px;
    `;

    let activeIndex = 0;
    let filteredList: AutocompleteSuggestion[] = [];
    let replaceStartPos = 0;

    const renderGutterAndHighlight = () => {
      const val = textarea.value;
      const lines = val.split('\n');

      // Check syntax error
      const err = this.validateSyntax(val, mode);
      if (err) {
        errorBar.textContent = `⚠️ Line ${err.line}: ${err.message}`;
        errorBar.style.display = 'block';
      } else {
        errorBar.style.display = 'none';
      }

      // Render line numbers
      gutter.empty();
      lines.forEach((_, idx) => {
        const lineNum = idx + 1;
        const lineEl = gutter.createDiv({ cls: 'cds-gutter-line', text: lineNum.toString() });
        if (err && err.line === lineNum) {
          lineEl.addClass('has-error');
        }
      });

      // Syntax highlight
      highlightCodeEl.innerHTML = this.highlightCode(val + '\n', mode);
    };

    // Scroll synchronizer
    textarea.addEventListener('scroll', () => {
      highlightPre.scrollTop = textarea.scrollTop;
      highlightPre.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    });

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
      renderGutterAndHighlight();
      onChange(textarea.value);
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
        if (val) div.style.setProperty(prop, val);
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
      renderGutterAndHighlight();
      onChange(textarea.value);

      const pos = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, pos);
      const { suggestions, startOffset } = getSuggestionsForContext(textBefore);

      const activeWord = textBefore.substring(pos - startOffset).toLowerCase();
      if (!activeWord || activeWord.length < 1) {
        hideDropdown();
        return;
      }

      replaceStartPos = pos - startOffset;

      filteredList = suggestions
        .map(s => {
          const candidate = s.displayText || s.text;
          return {
            ...s,
            score: this.scoreSuggestion(candidate, activeWord, s.type)
          };
        })
        .filter(s => (s.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 15);

      if (filteredList.length === 0) {
        hideDropdown();
        return;
      }

      dropdown.empty();
      activeIndex = 0;

      filteredList.forEach((item) => {
        const itemEl = dropdown.createDiv({ cls: 'suggestion-item' });
        itemEl.style.cssText = `
          padding: 6px 10px; cursor: pointer; border-radius: 4px;
          display: flex; justify-content: space-between; align-items: center;
          font-family: var(--font-monospace); font-size: 0.8rem;
        `;

        const rawText = item.displayText || item.text;
        const label = itemEl.createSpan();

        const matchIdx = rawText.toLowerCase().indexOf(activeWord);
        if (matchIdx !== -1) {
          label.createSpan({ text: rawText.substring(0, matchIdx) });
          const highlight = label.createSpan({ text: rawText.substring(matchIdx, matchIdx + activeWord.length) });
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

      if (e.key === 'Tab' && dropdown.style.display !== 'block') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.setSelectionRange(start + 2, start + 2);
        renderGutterAndHighlight();
        onChange(textarea.value);
        return;
      }

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
        renderGutterAndHighlight();
        onChange(textarea.value);
      }
    });

    textarea.addEventListener('blur', () => {
      setTimeout(hideDropdown, 200);
    });

    // Initial render
    renderGutterAndHighlight();

    return {
      setValue: (val: string) => {
        textarea.value = val;
        renderGutterAndHighlight();
      },
      getValue: () => textarea.value
    };
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
                /* Layout containers */
        .cds-studio-root { display: flex; flex-direction: column; height: 100%; gap: 10px; padding: 14px; box-sizing: border-box; }
        .cds-toolbar { display: flex; gap: 8px; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; flex-wrap: wrap; }
        .cds-select { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-normal); padding: 5px 8px; border-radius: 4px; font-size: 0.85rem; outline: none; }
        .cds-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; }
        .cds-tab-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 5px 12px; border-radius: 4px; cursor: pointer; color: var(--text-normal); font-size: 0.85rem; font-weight: 500; }
        .cds-tab-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
        .cds-save-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }

        .cds-split { display: flex; flex-direction: column; height: 50%; min-height: 240px; gap: 6px; }
        .cds-editor-pane { flex: 1; display: none; height: 100%; min-height: 0; position: relative; }
        .cds-editor-pane.active { display: flex; flex-direction: column; }

        /* Code Editor Shell */
        .cds-editor-wrapper { display: flex; flex: 1; height: 100%; width: 100%; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: hidden; position: relative; box-sizing: border-box; }

        /* Line Number Gutter */
        .cds-gutter { width: 44px; height: 100%; flex-shrink: 0; background: var(--background-secondary); border-right: 1px solid var(--background-modifier-border); color: var(--text-muted); font-family: var(--font-monospace) !important; font-size: 13px !important; line-height: 20px !important; padding: 8px 0 !important; overflow: hidden; user-select: none; text-align: right; box-sizing: border-box; }
        .cds-gutter-line { padding-right: 8px; height: 20px; line-height: 20px; font-size: 12px; box-sizing: border-box; }
        .cds-gutter-line.has-error { color: var(--text-error) !important; font-weight: 700; background: rgba(255, 60, 60, 0.2); }

        /* Code Display Box */
        .cds-code-box { position: relative; flex: 1; height: 100%; width: 100%; overflow: hidden; }

        /* Complete CSS Reset for Obsidian Pre & Code to stop styling conflicts */
        pre.cds-highlight-layer {
        all: unset !important;
        position: absolute !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important; height: 100% !important;
        margin: 0 !important; padding: 8px 10px !important;
        box-sizing: border-box !important;
        font-family: var(--font-monospace) !important;
        font-size: 13px !important;
        line-height: 20px !important;
        letter-spacing: normal !important;
        white-space: pre !important;
        word-wrap: normal !important;
        overflow: hidden !important;
        pointer-events: none !important;
        user-select: none !important;
        background: transparent !important;
        border: none !important;
        z-index: 1 !important;
        tab-size: 2 !important;
        }

        pre.cds-highlight-layer code {
        all: unset !important;
        font-family: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
        white-space: pre !important;
        background: transparent !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        display: inline !important;
        }

        /* Typing Layer */
        textarea.cds-textarea-layer {
        position: absolute !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important; height: 100% !important;
        margin: 0 !important; padding: 8px 10px !important;
        box-sizing: border-box !important;
        font-family: var(--font-monospace) !important;
        font-size: 13px !important;
        line-height: 20px !important;
        letter-spacing: normal !important;
        white-space: pre !important;
        word-wrap: normal !important;
        overflow: auto !important;
        background: transparent !important;
        color: transparent !important;
        caret-color: var(--text-normal) !important;
        border: none !important;
        outline: none !important;
        resize: none !important;
        z-index: 2 !important;
        tab-size: 2 !important;
        }
        textarea.cds-textarea-layer::selection {
        background: var(--text-selection, rgba(0, 120, 215, 0.35)) !important;
        color: transparent !important;
        }

        /* Syntax Token Colors */
        .cds-tok-kw { color: var(--interactive-accent); font-weight: 600; }
        .cds-tok-builtin { color: #e5c07b; font-weight: 600; }
        .cds-tok-tag { color: #e06c75; font-weight: 600; }
        .cds-tok-prop { color: #61afef; }
        .cds-tok-attr { color: #d19a66; }
        .cds-tok-str { color: #98c379; }
        .cds-tok-num { color: #d19a66; }
        .cds-tok-bool { color: #56b6c2; font-weight: 600; }
        .cds-tok-var { color: var(--text-accent); }
        .cds-tok-comment { color: var(--text-muted); font-style: italic; }

        /* Status Bar */
        .cds-error-banner { position: absolute; bottom: 0; left: 0; right: 0; background: var(--text-error); color: white; font-family: var(--font-monospace); font-size: 0.75rem; padding: 3px 8px; z-index: 10; opacity: 0.95; }
        .cds-preview-pane { flex: 1; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: auto; padding: 12px; }
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
    const cssPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });
    const jsPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });

    let debounceTimer: any = null;
    const triggerHotReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runCode(), 250);
    };

    const htmlEditor = this.createCodeEditor(htmlPane, 'html', htmlCode, (val) => { htmlCode = val; triggerHotReload(); });
    const cssEditor = this.createCodeEditor(cssPane, 'css', cssCode, (val) => { cssCode = val; triggerHotReload(); });
    const jsEditor = this.createCodeEditor(jsPane, 'js', jsCode, (val) => { jsCode = val; triggerHotReload(); });

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
          cssEditor.setValue(cssCode);

          const htmlMatch = code.match(/const\s+htmlContent\s*=\s*`([\s\S]*?)`;/);
          htmlCode = htmlMatch && htmlMatch[1] ? htmlMatch[1] : "";
          htmlEditor.setValue(htmlCode);

          const jsSplit = code.split('// --- JS ---');
          if (jsSplit[1]) {
            jsCode = jsSplit[1].replace(/^\s*const\s+container\s*=\s*this\.container;\s*/, '').trim();
          } else {
            jsCode = code.trim();
          }
          jsEditor.setValue(jsCode);
        } else {
          jsCode = content;
          jsEditor.setValue(jsCode);
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
        htmlEditor.setValue(htmlCode);
        cssCode = resolved.css;
        cssEditor.setValue(cssCode);
        jsCode = resolved.js;
        jsEditor.setValue(jsCode);
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
          htmlEditor.setValue(htmlCode);
          cssCode = resolved.css;
          cssEditor.setValue(cssCode);
          jsCode = resolved.js;
          jsEditor.setValue(jsCode);
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

        // Trigger repaint to align gutters upon unhiding
        if (tab === 'html') htmlEditor.setValue(htmlEditor.getValue());
        if (tab === 'css') cssEditor.setValue(cssEditor.getValue());
        if (tab === 'js') jsEditor.setValue(jsEditor.getValue());
    };

    htmlBtn.onclick = () => switchTab('html');
    cssBtn.onclick = () => switchTab('css');
    jsBtn.onclick = () => switchTab('js');

    runCode();
  }

  async onClose() {}
}