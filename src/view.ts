// view.ts
import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import CustomDatabaseStudioPlugin, { VersionSnapshot } from './main';
import { VersionPromptModal, ConfirmModal } from './modals';
import { AutocompleteEngine, AutocompleteSuggestion } from './autocomplete';

export const VIEW_TYPE_STUDIO = "custom-database-studio-view";

interface SyntaxErrorDetail {
  line: number;
  message: string;
}

export class StudioView extends ItemView {
  plugin: CustomDatabaseStudioPlugin;
  currentFile: TFile | null = null;
  autocompleteEngine: AutocompleteEngine;

  constructor(leaf: WorkspaceLeaf, plugin: CustomDatabaseStudioPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.autocompleteEngine = new AutocompleteEngine(this.app);
  }

  getViewType(): string { 
    return VIEW_TYPE_STUDIO; 
  }
  
  getDisplayText(): string { 
    return "Database Studio"; 
  }

  /**
   * Universal DataviewJS Runtime Helpers (Domain-Agnostic)
   */
  getRuntimeHelpers(containerEl: HTMLElement, htmlContent: string) {
    const app = this.app;
    containerEl.innerHTML = htmlContent;

    const $ = (sel: string) => containerEl.querySelector(sel);
    const $$ = (sel: string) => containerEl.querySelectorAll(sel);

    const db = {
      query: (source: string, fallback: any[] = []): any[] => {
        try {
          const dv = (app as any).plugins?.plugins?.dataview?.api;
          if (dv && dv.pages) {
            const pages = dv.pages(source);
            if (pages && pages.length > 0) {
              return pages.map((p: any) => ({
                ...p,
                path: p.file?.path || '#',
                name: p.file?.name || '',
                basename: p.file?.basename || '',
                tags: p.file?.tags || []
              })).values;
            }
          }
        } catch (e) {}
        return fallback;
      },

      openNote: (path: string) => {
        if (!path || path === '#') {
          new Notice("Preview mode: Link clicked");
          return;
        }
        app.workspace.openLinkText(path, "", false);
      },

      createNote: async (opts: { 
        folder?: string; 
        name?: string; 
        title?: string;
        frontmatter?: Record<string, any>; 
        content?: string; 
        open?: boolean 
      }): Promise<TFile | null> => {
        const folder = opts.folder ? opts.folder.replace(/^\/+|\/+$/g, '') : "";
        const baseName = opts.name || opts.title || opts.frontmatter?.title || opts.frontmatter?.name || "Untitled";
        try {
          if (folder && !app.vault.getAbstractFileByPath(folder)) {
            await app.vault.createFolder(folder);
          }
          let filePath = folder ? `${folder}/${baseName}.md` : `${baseName}.md`;
          let counter = 1;
          while (app.vault.getAbstractFileByPath(filePath)) {
            filePath = folder ? `${folder}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`;
            counter++;
          }

          let yaml = "";
          if (opts.frontmatter) {
            yaml = "---\n" + Object.entries(opts.frontmatter)
              .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
              .join("\n") + "\n---\n\n";
          }
          const body = opts.content || `# ${baseName}\n\n`;
          const file = await app.vault.create(filePath, yaml + body);
          
          if (opts.open !== false) {
            await app.workspace.getLeaf().openFile(file);
          }
          new Notice(`Created: ${filePath}`);
          return file;
        } catch (err: any) {
          new Notice(`Failed to create note: ${err.message}`);
          return null;
        }
      },

      updateNote: async (path: string, updater: (frontmatter: Record<string, any>) => void): Promise<boolean> => {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          try {
            await app.fileManager.processFrontMatter(file, updater);
            return true;
          } catch (err: any) {
            new Notice(`Update error: ${err.message}`);
          }
        }
        return false;
      },

      renderList: (selector: string, items: any[], templateFn: (item: any) => string, emptyHtml = '<div class="cds-empty">No items found</div>') => {
        const target = containerEl.querySelector(selector);
        if (!target) return;
        if (!items || items.length === 0) {
          target.innerHTML = emptyHtml;
          return;
        }
        target.innerHTML = items.map(templateFn).join("");
      },

      bindFilter: (selector: string, options: string[], onSelect: (selected: string) => void) => {
        const bar = containerEl.querySelector(selector);
        if (!bar) return;
        bar.innerHTML = "";
        let active = options[0] || "All";

        options.forEach(opt => {
          const btn = document.createElement("button");
          btn.className = `filter-btn ${opt === active ? "active" : ""}`;
          btn.innerText = opt;
          btn.onclick = () => {
            active = opt;
            bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            onSelect(opt);
          };
          bar.appendChild(btn);
        });
        onSelect(active);
      }
    };

    return { db, $, $$ };
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

  highlightCode(code: string, mode: 'html' | 'css' | 'js'): string {
    const escape = (str: string) => 
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (mode === 'html') {
      return code.replace(/(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9-]+)|([\w:-]+)(=)("[^"]*"|'[^']*')|(>|\/>)|([^<]+|.)/g, 
        (_m, comment, tag, attr, eq, val, close, text) => {
          if (comment) return `<span class="cds-tok-comment">${escape(comment)}</span>`;
          if (tag) return `<span class="cds-tok-tag">${escape(tag)}</span>`;
          if (attr) return `<span class="cds-tok-attr">${escape(attr)}</span>${eq}<span class="cds-tok-str">${escape(val || '')}</span>`;
          if (close) return `<span class="cds-tok-tag">${escape(close)}</span>`;
          if (text) return escape(text);
          return escape(_m);
        }
      );
    }

    if (mode === 'css') {
      return code.replace(/(\/\*[\s\S]*?\*\/)|([.#][\w-]+)|([a-zA-Z-]+)\s*(:)|("[^"]*"|'[^']*')|([0-9.]+(?:px|rem|em|%|vh|vw|s|ms)?)|(var\(--[\w-]+\))|(\b(?:rgba?|hsla?|calc|minmax|repeat|url)\b)|([^"'/`a-zA-Z0-9_\s]+|[a-zA-Z0-9_\s]+|.)/g,
        (_m, comment, selector, prop, colon, str, num, cssVar, fn, text) => {
          if (comment) return `<span class="cds-tok-comment">${escape(comment)}</span>`;
          if (selector) return `<span class="cds-tok-tag">${escape(selector)}</span>`;
          if (prop) return `<span class="cds-tok-prop">${escape(prop)}</span>${colon}`;
          if (str) return `<span class="cds-tok-str">${escape(str)}</span>`;
          if (num) return `<span class="cds-tok-num">${escape(num)}</span>`;
          if (cssVar) return `<span class="cds-tok-var">${escape(cssVar)}</span>`;
          if (fn) return `<span class="cds-tok-builtin">${escape(fn)}</span>`;
          if (text) return escape(text);
          return escape(_m);
        }
      );
    }

    return code.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\`|[\s\S])*?`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b(?:const|let|var|function|return|if|else|for|while|import|export|class|new|async|await|try|catch|switch|case|break)\b)|(\b(?:true|false|null|undefined)\b)|(\b(?:dv|app|container|window|document|console|db|\$|\$\$)\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)(?=\s*\()|(\b\d+\b)|([^"'/`a-zA-Z0-9_\s]+|[a-zA-Z0-9_\s]+|.)/g,
      (_m, comment, str, kw, bool, builtin, method, num, text) => {
        if (comment) return `<span class="cds-tok-comment">${escape(comment)}</span>`;
        if (str) return `<span class="cds-tok-str">${escape(str)}</span>`;
        if (kw) return `<span class="cds-tok-kw">${escape(kw)}</span>`;
        if (bool) return `<span class="cds-tok-bool">${escape(bool)}</span>`;
        if (builtin) return `<span class="cds-tok-builtin">${escape(builtin)}</span>`;
        if (method) return `<span class="cds-tok-prop">${escape(method)}</span>`;
        if (num) return `<span class="cds-tok-num">${escape(num)}</span>`;
        if (text) return escape(text);
        return escape(_m);
      }
    );
  }

  validateSyntax(code: string, mode: 'html' | 'css' | 'js'): SyntaxErrorDetail | null {
    if (!code.trim()) return null;

    if (mode === 'js') {
      try {
        new Function(code);
      } catch (err: any) {
        let line = 1;
        const lineMatch = err.stack?.match(/<anonymous>:(\d+):(\d+)/);
        if (lineMatch && lineMatch[1]) {
          line = Math.max(1, parseInt(lineMatch[1], 10) - 2);
        } else {
          const openCurl = (code.match(/{/g) || []).length;
          const closeCurl = (code.match(/}/g) || []).length;
          if (openCurl !== closeCurl) line = code.split('\n').length;
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

  createCodeEditor(
    parent: HTMLElement,
    mode: 'html' | 'css' | 'js',
    initialCode: string,
    onChange: (val: string) => void
  ) {
    const editorRoot = parent.createDiv({ cls: 'cds-editor-wrapper' });
    const gutter = editorRoot.createDiv({ cls: 'cds-gutter' });
    const editArea = editorRoot.createDiv({ cls: 'cds-code-box' });

    const highlightPre = editArea.createEl('pre', { cls: 'cds-highlight-layer' });
    const highlightCodeEl = highlightPre.createEl('code');

    const textarea = editArea.createEl('textarea', { cls: 'cds-textarea-layer' });
    textarea.value = initialCode;

    textarea.setAttribute('wrap', 'off');
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('data-gramm', 'false');
    textarea.setAttribute('data-enable-grammarly', 'false');

    const errorBar = editorRoot.createDiv({ cls: 'cds-error-banner' });
    errorBar.style.display = 'none';

    const dropdown = editArea.createDiv({ cls: 'suggestion-container cds-autocomplete-menu' });

    let activeIndex = 0;
    let filteredList: AutocompleteSuggestion[] = [];
    let replaceStartPos = 0;

    const syncScroll = () => {
      highlightCodeEl.style.transform = `translate3d(-${textarea.scrollLeft}px, -${textarea.scrollTop}px, 0)`;
      gutter.scrollTop = textarea.scrollTop;
    };

    textarea.addEventListener('scroll', syncScroll);

    const renderGutterAndHighlight = () => {
      const val = textarea.value;
      const lines = val.split('\n');

      const err = this.validateSyntax(val, mode);
      if (err) {
        errorBar.textContent = `⚠️ Line ${err.line}: ${err.message}`;
        errorBar.style.display = 'block';
      } else {
        errorBar.style.display = 'none';
      }

      gutter.empty();
      lines.forEach((_, idx) => {
        const lineNum = idx + 1;
        const lineEl = gutter.createDiv({ cls: 'cds-gutter-line', text: lineNum.toString() });
        if (err && err.line === lineNum) lineEl.addClass('has-error');
      });

      highlightCodeEl.innerHTML = this.highlightCode(val, mode) + (val.endsWith('\n') ? ' ' : '');
      syncScroll();
    };

    const hideDropdown = () => {
      dropdown.style.display = 'none';
      filteredList = [];
    };

    const updateSelectionHighlight = () => {
      Array.from(dropdown.children).forEach((child, idx) => {
        const itemEl = child as HTMLElement;
        if (idx === activeIndex) {
          itemEl.addClass('is-selected');
          itemEl.scrollIntoView({ block: 'nearest' });
        } else {
          itemEl.removeClass('is-selected');
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
      div.style.whiteSpace = 'pre';
      div.style.wordWrap = 'normal';
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

    textarea.addEventListener('input', () => {
      renderGutterAndHighlight();
      onChange(textarea.value);

      const pos = textarea.selectionStart;
      const textBefore = textarea.value.substring(0, pos);

      // 1. Get suggestions through dedicated engine
      const { suggestions, startOffset } = this.autocompleteEngine.getSuggestions(textBefore, textarea.value, mode);

      const activeWord = textBefore.substring(pos - startOffset).toLowerCase();
      if (!activeWord || activeWord.length < 1) {
        hideDropdown();
        return;
      }

      replaceStartPos = pos - startOffset;

      // 2. Score using smart weights
      filteredList = suggestions
        .map(s => ({
          ...s,
          score: this.autocompleteEngine.scoreSuggestion(s.displayText || s.text, activeWord, s.type)
        }))
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

        const rawText = item.displayText || item.text;
        const label = itemEl.createSpan({ cls: 'cds-suggest-label' });

        const matchIdx = rawText.toLowerCase().indexOf(activeWord);
        if (matchIdx !== -1) {
          label.createSpan({ text: rawText.substring(0, matchIdx) });
          label.createSpan({ 
            cls: 'cds-suggest-match', 
            text: rawText.substring(matchIdx, matchIdx + activeWord.length) 
          });
          label.createSpan({ text: rawText.substring(matchIdx + activeWord.length) });
        } else {
          label.textContent = rawText;
        }

        itemEl.createSpan({ 
          cls: 'cds-suggest-badge', 
          text: item.type.toUpperCase() 
        });

        itemEl.onmousedown = (e) => {
          e.preventDefault();
          insertSuggestion(item);
        };
        dropdown.appendChild(itemEl);
      });

      const coords = computeCaretPosition(pos);
      dropdown.style.display = 'block';

      // Smart viewport collision detection
      const editorHeight = editArea.clientHeight;
      const editorWidth = editArea.clientWidth;
      const menuHeight = dropdown.offsetHeight || 200;
      const menuWidth = 290;

      let topPos = coords.top + 22;
      if (topPos + menuHeight > editorHeight && coords.top - menuHeight > 0) {
        topPos = coords.top - menuHeight - 6; // Flip above cursor
      }

      topPos = Math.max(4, Math.min(topPos, Math.max(4, editorHeight - menuHeight - 6)));
      const leftPos = Math.max(4, Math.min(coords.left, Math.max(4, editorWidth - menuWidth - 8)));

      dropdown.style.top = `${topPos}px`;
      dropdown.style.left = `${leftPos}px`;
      updateSelectionHighlight();
    });

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (dropdown.style.display === 'block') {
        // Tab / Shift+Tab Cycling
        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + Tab: Cycle backward
            activeIndex = (activeIndex - 1 + filteredList.length) % filteredList.length;
          } else {
            // Tab: Cycle forward
            activeIndex = (activeIndex + 1) % filteredList.length;
          }
          updateSelectionHighlight();
          return;
        }

        // Arrow Key Navigation
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

        // Enter to Complete
        if (e.key === 'Enter') {
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

      // Normal Tab indentation when popup is not open
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
        renderGutterAndHighlight();
        onChange(textarea.value);
      }
    });

    textarea.addEventListener('blur', () => {
      setTimeout(hideDropdown, 200);
    });

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
    await this.autocompleteEngine.indexVault();

    const container = this.contentEl;
    container.empty();
    container.addClass('cds-studio-root');

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
        const { db, $, $$ } = this.getRuntimeHelpers(bodyDiv, htmlCode);
        (window as any).db = db;

        const executeFn = new Function('container', 'htmlContent', 'app', 'notice', 'dv', 'db', '$', '$$', jsCode);
        executeFn(bodyDiv, htmlCode, this.app, (msg: string) => new Notice(msg), dvApi, db, $, $$);
      } catch (err: any) {
        const errDiv = document.createElement('div');
        errDiv.style.color = 'var(--text-error)';
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
            jsCode = jsSplit[1].trim();
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
          "// --- UNIVERSAL HELPERS ---",
          'const container = this.container;',
          'container.innerHTML = htmlContent;',
          'const $ = (s) => container.querySelector(s);',
          'const $$ = (s) => container.querySelectorAll(s);',
          'const db = {',
          '  query: (src, def = []) => {',
          '    try {',
          '      const p = (dv && dv.pages) ? dv.pages(src) : null;',
          '      if (p && p.length > 0) return p.map(x => ({ ...x, path: x.file?.path || "#", name: x.file?.name || "", tags: x.file?.tags || [] })).values;',
          '    } catch (e) {}',
          '    return def;',
          '  },',
          '  openNote: (p) => { if (p && p !== "#") app.workspace.openLinkText(p, "", false); },',
          '  createNote: async (opt) => {',
          '    let f = opt.folder ? opt.folder.replace(/^\\/+|\\/+$/g, "") : "";',
          '    let n = opt.name || opt.frontmatter?.title || "Untitled";',
          '    if (f && !app.vault.getAbstractFileByPath(f)) await app.vault.createFolder(f);',
          '    let path = f ? `${f}/${n}.md` : `${n}.md`; let c = 1;',
          '    while (app.vault.getAbstractFileByPath(path)) { path = f ? `${f}/${n} ${c}.md` : `${n} ${c}.md`; c++; }',
          '    let y = opt.frontmatter ? "---\\n" + Object.entries(opt.frontmatter).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join("\\n") + "\\n---\\n\\n" : "";',
          '    let file = await app.vault.create(path, y + (opt.content || `# ${n}\\n\\n`));',
          '    if (opt.open !== false) await app.workspace.getLeaf().openFile(file);',
          '    return file;',
          '  },',
          '  updateNote: async (p, fn) => {',
          '    const f = app.vault.getAbstractFileByPath(p);',
          '    if (f instanceof TFile) await app.fileManager.processFrontMatter(f, fn);',
          '  },',
          '  renderList: (sel, items, fn, empty = "<div>No items found</div>") => {',
          '    const el = $(sel); if (!el) return;',
          '    el.innerHTML = (items && items.length) ? items.map(fn).join("") : empty;',
          '  },',
          '  bindFilter: (sel, opts, onSel) => {',
          '    const bar = $(sel); if (!bar) return; bar.innerHTML = ""; let act = opts[0] || "All";',
          '    opts.forEach(o => {',
          '      const b = document.createElement("button"); b.className = `filter-btn ${o === act ? "active" : ""}`; b.innerText = o;',
          '      b.onclick = () => { act = o; bar.querySelectorAll(".filter-btn").forEach(x => x.classList.remove("active")); b.classList.add("active"); onSel(o); };',
          '      bar.appendChild(b);',
          '    });',
          '    onSel(act);',
          '  }',
          '};',
          'window.db = db;',
          '',
          "// --- JS ---",
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