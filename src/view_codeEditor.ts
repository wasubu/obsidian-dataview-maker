// view_codeEditor.ts
import { Notice } from 'obsidian';
import { AutocompleteEngine, AutocompleteSuggestion } from './autocomplete';

export interface SyntaxErrorDetail {
  line: number;
  message: string;
}

export function highlightCode(code: string, mode: 'html' | 'css' | 'js'): string {
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

export function validateSyntax(code: string, mode: 'html' | 'css' | 'js'): SyntaxErrorDetail | null {
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
      return { line: code.split('\n').length, message: `Unmatched curly braces: ${openBraces} '{' vs${closeBraces} '}'` };
    }
  }

  if (mode === 'html') {
    const cleanCode = code.replace(/<!--[\s\S]*?-->/g, '');
    const sanitizedCode = cleanCode.replace(/<(textarea|script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

    const tags = Array.from(sanitizedCode.matchAll(/<\/?([a-zA-Z0-9-]+)[^>]*>/g));
    const stack: { tag: string; line: number }[] = [];
    const selfClosing = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

    const lines = sanitizedCode.split('\n');
    for (const m of tags) {
      const full = m[0];
      const name = m[1] ? m[1].toLowerCase() : '';
      if (selfClosing.has(name) || full.endsWith('/>') || full.startsWith('<!')) continue;

      const charIdx = m.index || 0;
      const lineNum = sanitizedCode.substring(0, charIdx).split('\n').length;

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

export function createCodeEditor(
  parent: HTMLElement,
  mode: 'html' | 'css' | 'js',
  initialCode: string,
  onChange: (val: string) => void,
  autocompleteEngine: AutocompleteEngine,
  previewCleanups: Array<() => void>,
  getHtmlCode?: () => string
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

    const err = validateSyntax(val, mode);
    if (err) {
      errorBar.textContent = `⚠️ Line ${err.line}:${err.message}`;
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

    highlightCodeEl.innerHTML = highlightCode(val, mode) + (val.endsWith('\n') ? ' ' : '');
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
    
    let newCursorPos = replaceStartPos + insertText.length;

    const tagCloseMatch = insertText.match(/^([a-zA-Z0-9-]+)><\/[a-zA-Z0-9-]+>$/);
    if (tagCloseMatch && tagCloseMatch[1]) {
      newCursorPos = replaceStartPos + tagCloseMatch[1].length + 1;
    } else if (insertText.endsWith('="">')) {
      newCursorPos -= 2;
    } else if (insertText.endsWith('()')) {
      newCursorPos -= 1;
    } else if (insertText.endsWith('=""')) {
      newCursorPos -= 1;
    }

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
    const pos = textarea.selectionStart;
    const textAfter = textarea.value.substring(pos);

    if (textAfter && /^[a-zA-Z0-9_$]/.test(textAfter)) {
      hideDropdown();
      return;
    }

    renderGutterAndHighlight();
    onChange(textarea.value);

    const textBefore = textarea.value.substring(0, pos);

    if (/[\s;\n]$/.test(textBefore)) {
      hideDropdown();
      return;
    }

    const { suggestions, startOffset } = autocompleteEngine.getSuggestions(textBefore, textarea.value, mode, getHtmlCode ? getHtmlCode() : '');

    if (suggestions.length === 0) {
      hideDropdown();
      return;
    }

    const activeWord = textBefore.substring(pos - startOffset).toLowerCase();

    if (startOffset > 0 && (!activeWord || activeWord.length < 1)) {
      hideDropdown();
      return;
    }

    replaceStartPos = pos - startOffset;

    if (activeWord === '') {
      filteredList = suggestions.slice(0, 15);
    } else {
      filteredList = suggestions
        .map(s => ({
          ...s,
          score: autocompleteEngine.scoreSuggestion(s.displayText || s.text, activeWord, s.type)
        }))
        .filter(s => (s.score ?? 0) > 0)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 15);
    }

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

      if (activeWord) {
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

    const editorHeight = editArea.clientHeight;
    const editorWidth = editArea.clientWidth;
    const menuHeight = dropdown.offsetHeight || 200;
    const menuWidth = 290;

    let topPos = coords.top + 22;
    if (topPos + menuHeight > editorHeight && coords.top - menuHeight > 0) {
      topPos = coords.top - menuHeight - 6;
    }

    topPos = Math.max(4, Math.min(topPos, Math.max(4, editorHeight - menuHeight - 6)));
    const leftPos = Math.max(4, Math.min(coords.left, Math.max(4, editorWidth - menuWidth - 8)));

    dropdown.style.top = `${topPos}px`;
    dropdown.style.left = `${leftPos}px`;
    updateSelectionHighlight();
  });

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (dropdown.style.display === 'block') {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          activeIndex = (activeIndex - 1 + filteredList.length) % filteredList.length;
        } else {
          activeIndex = (activeIndex + 1) % filteredList.length;
        }
        updateSelectionHighlight();
        return;
      }

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

    if (e.key === ' ' && dropdown.style.display === 'block') {
      hideDropdown();
    }

    if (e.key === 'Tab' && dropdown.style.display !== 'block') {
      e.preventDefault();
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.setSelectionRange(start + 2, start + 2);
      renderGutterAndHighlight();
      onChange(textarea.value);
      return;
    }

    const closers = new Set(['"', "'", '`', ')', ']', '}']);
    if (start === end && closers.has(e.key) && textarea.value.charAt(start) === e.key) {
      e.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      return;
    }

    if (e.key === 'Backspace' && start === end && start > 0) {
      const charBefore = textarea.value.charAt(start - 1);
      const charAfter = textarea.value.charAt(start);
      const pairMap: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'", '`': '`' };

      if (pairMap[charBefore] && pairMap[charBefore] === charAfter) {
        e.preventDefault();
        textarea.value = textarea.value.substring(0, start - 1) + textarea.value.substring(start + 1);
        textarea.setSelectionRange(start - 1, start - 1);
        renderGutterAndHighlight();
        onChange(textarea.value);
        return;
      }
    }

    if (e.key === 'Enter' && dropdown.style.display !== 'block' && start === end && start > 0) {
      const charBefore = textarea.value.charAt(start - 1);
      const charAfter = textarea.value.charAt(start);
      if (charBefore === '{' && charAfter === '}') {
        e.preventDefault();
        textarea.value = textarea.value.substring(0, start) + '\n  \n' + textarea.value.substring(end);
        textarea.setSelectionRange(start + 3, start + 3);
        renderGutterAndHighlight();
        onChange(textarea.value);
        return;
      }
    }

    if (mode === 'html' && e.key === '>' && start === end) {
      const textBefore = textarea.value.substring(0, start);
      const openTagMatch = textBefore.match(/<([a-zA-Z0-9-]+)(\s+[^>]*)?$/);
      const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
      if (openTagMatch && openTagMatch[1] && !voidTags.has(openTagMatch[1].toLowerCase())) {
        e.preventDefault();
        const closeTag = `></${openTagMatch[1]}>`;
        textarea.value = textarea.value.substring(0, start) + closeTag + textarea.value.substring(end);
        textarea.setSelectionRange(start + 1, start + 1);
        renderGutterAndHighlight();
        onChange(textarea.value);
        return;
      }
    }

    const pairs: Record<string, string> = { '"': '"', "'": "'", '(': ')', '{': '}', '[': ']', '`': '`' };
    if (pairs[e.key]) {
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

  textarea.addEventListener('click', () => {
    hideDropdown();
  });

  const onOutsideClick = (evt: MouseEvent) => {
    if (!dropdown.contains(evt.target as Node) && evt.target !== textarea) {
      hideDropdown();
    }
  };
  document.addEventListener('pointerdown', onOutsideClick);
  previewCleanups.push(() => document.removeEventListener('pointerdown', onOutsideClick));

  renderGutterAndHighlight();

  return {
    setValue: (val: string) => {
      textarea.value = val;
      renderGutterAndHighlight();
    },
    getValue: () => textarea.value
  };
}