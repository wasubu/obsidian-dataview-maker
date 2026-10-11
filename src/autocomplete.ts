// autocomplete.ts
import { App, TFolder } from 'obsidian';

export interface AutocompleteSuggestion {
  text: string;
  displayText?: string;
  type: 'kw' | 'api' | 'builtin' | 'var' | 'fn' | 'html' | 'attr' | 'html-class' | 'html-id' | 'css-prop' | 'css-val' | 'css-var' | 'dv' | 'vault' | 'prop' | 'buffer';
  weight?: number;
  score?: number;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const TOKEN_WEIGHTS: Record<string, number> = {
  'const': 95, 'console': 90, 'let': 85, 'function': 85, 'return': 80,
  'async': 75, 'await': 75, 'if': 75, 'for': 70, 'db': 95, '$': 90, '$$': 85, 'dv': 85,
  'log()': 95, 'query()': 95, 'createNote()': 90, 'updateNote()': 90, 'renderList()': 90, 
  'bindFilter()': 85, 'openNote()': 85, 'increment()': 85, 'toggleProp()': 85, 'modal()': 85,
  'state()': 85, 'timer()': 80, 'loop()': 80, 'canvas()': 80, 'storage()': 80, 'notify()': 85,
  'div': 100, 'span': 90, 'button': 90, 'input': 85, 'img': 85, 'a': 80, 'p': 80,
  'class': 95, 'id': 90, 'src': 85, 'href': 85, 'onclick': 80,
  'display': 100, 'flex': 95, 'grid': 90, 'color': 90, 'background': 90, 'padding': 85, 'margin': 85
};

export class AutocompleteEngine {
  app: App;

  dynamicVaultFolders: string[] = [];
  dynamicVaultTags: string[] = [];
  dynamicFrontmatterKeys: string[] = [];
  dynamicHtmlTags: string[] = [];
  dynamicHtmlAttributes: string[] = [];
  dynamicCssProperties: string[] = [];
  dynamicCssVariables: string[] = [];
  dynamicDataviewApi: string[] = [];

  constructor(app: App) {
    this.app = app;
  }

  async indexVault() {
    const htmlSet = new Set<string>();
    for (const key of Object.getOwnPropertyNames(window)) {
      const match = key.match(/^HTML([A-Za-z0-9]+)Element$/);
      if (match && match[1]) {
        const tag = match[1].toLowerCase();
        if (tag && tag !== 'unknown' && tag !== 'heading') htmlSet.add(tag);
      }
    }
    ['div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li', 'button', 'input', 'select', 'form', 
     'h1', 'h2', 'h3', 'table', 'tr', 'td', 'th', 'header', 'footer', 'nav', 'section'].forEach(t => htmlSet.add(t));
    this.dynamicHtmlTags = Array.from(htmlSet);

    this.dynamicHtmlAttributes = ['class', 'id', 'src', 'href', 'style', 'alt', 'title', 'type', 'value', 'placeholder', 'onclick', 'loading="lazy"'];

    const cssPropSet = new Set<string>();
    const styleProto = document.body.style;
    for (const prop in styleProto) {
      if (typeof styleProto[prop] === 'string' && !prop.startsWith('webkit') && !prop.startsWith('moz')) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (kebab && isNaN(Number(kebab))) cssPropSet.add(kebab);
      }
    }
    this.dynamicCssProperties = Array.from(cssPropSet);

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
    this.dynamicCssVariables = Array.from(cssVarSet);

    const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;
    if (dvApi) {
      const dvKeys = new Set<string>([...Object.keys(dvApi), ...Object.getOwnPropertyNames(Object.getPrototypeOf(dvApi) || {})]);
      this.dynamicDataviewApi = Array.from(dvKeys).map(k => typeof dvApi[k] === 'function' ? `${k}()` : `${k}`);
    } else {
      this.dynamicDataviewApi = ['pages()', 'current()', 'array()', 'table()', 'list()'];
    }

    const folderSet = new Set<string>();
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path && file.path !== '/') folderSet.add(`"${file.path}"`);
    }
    this.dynamicVaultFolders = Array.from(folderSet);

    const tagsObj = (this.app.metadataCache as any).getTags?.() || {};
    this.dynamicVaultTags = Object.keys(tagsObj).map(t => `"${t}"`);

    const keySet = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        Object.keys(cache.frontmatter).forEach(k => { if (k !== 'position') keySet.add(k); });
      }
    }
    this.dynamicFrontmatterKeys = Array.from(keySet);
  }

  /**
   * Extracts classes and IDs defined in the HTML markup
   */
  extractHtmlTokens(html: string): { classes: string[], ids: string[] } {
    const classes = new Set<string>();
    const ids = new Set<string>();

    const classMatches = html.matchAll(/class=["']([^"']+)["']/g);
    for (const m of classMatches) {
      if (m[1]) m[1].split(/\s+/).forEach(c => { if (c.trim()) classes.add(c.trim()); });
    }

    const idMatches = html.matchAll(/id=["']([^"']+)["']/g);
    for (const m of idMatches) {
      if (m[1] && m[1].trim()) ids.add(m[1].trim());
    }

    return { classes: Array.from(classes), ids: Array.from(ids) };
  }

  /**
   * Extracts user declared variables, constants, and functions from JS code
   */
  extractUserJsSymbols(jsCode: string): { vars: string[], fns: string[] } {
    const vars = new Set<string>();
    const fns = new Set<string>();

    // const X, let X, var X
    const declMatches = jsCode.matchAll(/\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    for (const m of declMatches) if (m[1]) vars.add(m[1]);

    // function myFunc()
    const fnMatches = jsCode.matchAll(/\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    for (const m of fnMatches) if (m[1]) fns.add(m[1]);

    // (param1, param2) =>
    const paramMatches = jsCode.matchAll(/\(([a-zA-Z_$,\s]+)\)\s*=>/g);
    for (const m of paramMatches) {
      if (m[1]) {
        m[1].split(',').forEach(p => {
          const clean = p.trim();
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(clean)) vars.add(clean);
        });
      }
    }

    // for (let item of items)
    const forMatches = jsCode.matchAll(/\bfor\s*\(\s*(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+(?:of|in)\b/g);
    for (const m of forMatches) if (m[1]) vars.add(m[1]);

    return { vars: Array.from(vars), fns: Array.from(fns) };
  }

  isInsideComment(textBefore: string, mode: 'html' | 'css' | 'js'): boolean {
    if (mode === 'html') return textBefore.lastIndexOf('<!--') > textBefore.lastIndexOf('-->');
    if (mode === 'css') return textBefore.lastIndexOf('/*') > textBefore.lastIndexOf('*/');
    if (mode === 'js') {
      const currentLine = textBefore.substring(textBefore.lastIndexOf('\n') + 1);
      if (/\/\/.*$/.test(currentLine)) return true;
      return textBefore.lastIndexOf('/*') > textBefore.lastIndexOf('*/');
    }
    return false;
  }

  isInsideString(textBefore: string): boolean {
    const backticks = (textBefore.match(/(?<!\\)`/g) || []).length;
    if (backticks % 2 === 1) {
      const lastBacktick = textBefore.lastIndexOf('`');
      const textInBacktick = textBefore.substring(lastBacktick);
      const openInterp = (textInBacktick.match(/\${/g) || []).length;
      const closeInterp = (textInBacktick.match(/}/g) || []).length;
      return openInterp <= closeInterp;
    }
    const currentLine = textBefore.substring(textBefore.lastIndexOf('\n') + 1);
    const singleQuotes = (currentLine.match(/(?<!\\)'/g) || []).length;
    if (singleQuotes % 2 === 1) return true;
    const doubleQuotes = (currentLine.match(/(?<!\\)"/g) || []).length;
    if (doubleQuotes % 2 === 1) return true;
    return false;
  }

  scoreSuggestion(target: string, query: string, type: string): number {
    const text = target.toLowerCase();
    const q = query.toLowerCase();

    if (!q || !text.includes(q)) return 0;
    if (text === q) return 1000; // Exact match gets maximum score so it's always at the top!

    const cleanWord = text.replace(/[^a-zA-Z0-9_.]/g, '');
    let weightBoost = TOKEN_WEIGHTS[cleanWord] || TOKEN_WEIGHTS[text] || 0;

    // High relevance boost for user variables, functions, and HTML classes/IDs
    if (type === 'var' || type === 'fn' || type === 'html-class' || type === 'html-id') {
      weightBoost = Math.max(weightBoost, 90);
    }

    let score = 0;
    if (text.startsWith(q)) {
      score = 600 + weightBoost - (text.length - q.length) * 2;
    } else if (new RegExp(`[\\-_.:]${q}`, 'i').test(text)) {
      score = 400 + weightBoost - text.length;
    } else {
      const idx = text.indexOf(q);
      score = 150 + (weightBoost * 0.5) - (idx * 10) - text.length;
    }
    return Math.max(score, 1);
  }

  private cleanSuggestions(list: AutocompleteSuggestion[], activeWord: string): AutocompleteSuggestion[] {
    const seen = new Set<string>();
    const out: AutocompleteSuggestion[] = [];

    for (const item of list) {
      const key = (item.displayText || item.text).toLowerCase().replace(/[();"']/g, '');
      if (seen.has(key)) continue; // Removed the exact-match filter
      seen.add(key);

      const weight = item.weight || TOKEN_WEIGHTS[key] || TOKEN_WEIGHTS[item.text] || 0;
      out.push({ ...item, weight });
    }

    // Sort by score/weight so exact/matching terms stay at the top
    out.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return out;
  }

  getSuggestions(
    textBefore: string, 
    fullBuffer: string, 
    mode: 'html' | 'css' | 'js',
    htmlCode = ''
  ): { suggestions: AutocompleteSuggestion[], startOffset: number } {
    if (this.isInsideComment(textBefore, mode)) {
      return { suggestions: [], startOffset: 0 };
    }

    const { classes: htmlClasses, ids: htmlIds } = this.extractHtmlTokens(htmlCode);

    // =========================================================================
    // HTML Context
    // =========================================================================
    if (mode === 'html') {
      const lastOpenTag = textBefore.lastIndexOf('<');
      const lastCloseTag = textBefore.lastIndexOf('>');
      const isInsideTag = lastOpenTag > lastCloseTag;

      if (!isInsideTag) return { suggestions: [], startOffset: 0 };

      const tagContent = textBefore.substring(lastOpenTag);
      const inDoubleQuotes = (tagContent.match(/"/g) || []).length % 2 === 1;
      const inSingleQuotes = (tagContent.match(/'/g) || []).length % 2 === 1;
      if (inDoubleQuotes || inSingleQuotes) return { suggestions: [], startOffset: 0 };

      // Tag name (<di|)
      const tagMatch = tagContent.match(/^<([a-zA-Z0-9-]*)$/);
      if (tagMatch) {
        const query = tagMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicHtmlTags.map(t => {
              if (VOID_TAGS.has(t)) {
                if (t === 'img') return { text: 'img src="" alt="">', displayText: 'img', type: 'html' };
                if (t === 'input') return { text: 'input type="text">', displayText: 'input', type: 'html' };
                return { text: `${t}>`, displayText: t, type: 'html' };
              }
              return { text: `${t}></${t}>`, displayText: t, type: 'html' };
            }), 
            query
          )
        };
      }

      // Attribute (<div cl|)
      const attrMatch = tagContent.match(/\s+([a-zA-Z0-9-]+)$/);
      if (attrMatch) {
        const query = attrMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicHtmlAttributes.map(a => ({ 
              text: a.includes('=') ? a : `${a}=""`, 
              displayText: a.replace(/=.*/, ''), 
              type: 'attr' 
            })), 
            query
          )
        };
      }

      return { suggestions: [], startOffset: 0 };
    }

    // =========================================================================
    // CSS Context
    // =========================================================================
    if (mode === 'css') {
      if (this.isInsideString(textBefore)) return { suggestions: [], startOffset: 0 };

      const lastOpenBrace = textBefore.lastIndexOf('{');
      const lastCloseBrace = textBefore.lastIndexOf('}');
      const isInsideRule = lastOpenBrace > lastCloseBrace;

      if (!isInsideRule) {
        const classMatch = textBefore.match(/\.([a-zA-Z0-9_-]*)$/);
        if (classMatch) {
          const query = classMatch[1] ?? '';
          return {
            startOffset: query.length,
            suggestions: this.cleanSuggestions(
              htmlClasses.map(c => ({ text: c, displayText: `.${c}`, type: 'html-class', weight: 100 })),
              query
            )
          };
        }

        const idMatch = textBefore.match(/#([a-zA-Z0-9_-]*)$/);
        if (idMatch) {
          const query = idMatch[1] ?? '';
          return {
            startOffset: query.length,
            suggestions: this.cleanSuggestions(
              htmlIds.map(i => ({ text: i, displayText: `#${i}`, type: 'html-id', weight: 100 })),
              query
            )
          };
        }

        return { suggestions: [], startOffset: 0 };
      }

      // Inside { }
      const ruleContent = textBefore.substring(lastOpenBrace);
      const isValueScope = ruleContent.lastIndexOf(':') > ruleContent.lastIndexOf(';');

      if (isValueScope) {
        const valMatch = textBefore.match(/:\s*([a-zA-Z0-9-]+)$/);
        if (valMatch) {
          const query = valMatch[1] ?? '';
          const cssValues = ['flex', 'grid', 'inline-flex', 'block', 'inline-block', 'none', 'center', 'pointer', 'absolute', 'relative', 'fixed', 'inherit', 'wrap', 'nowrap', 'space-between', 'space-around'];
          return {
            startOffset: query.length,
            suggestions: this.cleanSuggestions([
              ...cssValues.map(v => ({ text: `${v};`, displayText: v, type: 'css-val' as const })),
              ...this.dynamicCssVariables.map(v => ({ text: `var(${v});`, displayText: v, type: 'css-var' as const }))
            ], query)
          };
        }
        return { suggestions: [], startOffset: 0 };
      }

      const propMatch = textBefore.match(/([a-zA-Z-]+)$/);
      if (propMatch) {
        const query = propMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicCssProperties.map(p => ({ text: `${p}: `, displayText: p, type: 'css-prop' as const })),
            query
          )
        };
      }
    }

    // =========================================================================
    // JavaScript Context
    // =========================================================================
    if (mode === 'js') {
      // 1. Vault Queries Inside quotes: dv.pages("...") or db.query("...")
      if (/(?:dv\.pages|db\.query)\([^)]*$/.test(textBefore)) {
        const match = textBefore.match(/(?:dv\.pages|db\.query)\(([^)]*)$/);
        const query = match?.[1]?.replace(/["']/g, '') ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions([
            ...this.dynamicVaultFolders.map(f => ({ text: `${f})`, displayText: f, type: 'vault' as const })),
            ...this.dynamicVaultTags.map(t => ({ text: `${t})`, displayText: t, type: 'vault' as const }))
          ], query)
        };
      }

      // 2. DOM Selectors in db.renderList(), db.bindFilter(), $(), $$(), or any '#id' / '.class'
      const selectorFnMatch = textBefore.match(/(?:\$|\$\$|querySelector|querySelectorAll|renderList|bindFilter)\(\s*['"]([#.]?[a-zA-Z0-9_-]*)$/);
      const hashOrDotMatch = textBefore.match(/['"]([#.][a-zA-Z0-9_-]*)$/);
      const selectorMatch = selectorFnMatch || hashOrDotMatch;

      if (selectorMatch) {
        const rawQuery = selectorMatch[1] ?? '';

        const idSuggestions = htmlIds.map(i => ({
          text: `#${i}`,
          displayText: `#${i}`,
          type: 'html-id' as const,
          weight: 100
        }));

        const classSuggestions = htmlClasses.map(c => ({
          text: `.${c}`,
          displayText: `.${c}`,
          type: 'html-class' as const,
          weight: 95
        }));

        let list: AutocompleteSuggestion[] = [];
        if (rawQuery.startsWith('.')) {
          list = classSuggestions;
        } else if (rawQuery.startsWith('#')) {
          list = idSuggestions;
        } else {
          list = [...idSuggestions, ...classSuggestions];
        }

        return {
          startOffset: rawQuery.length,
          suggestions: this.cleanSuggestions(list, rawQuery)
        };
      }

      // 3. Ignore normal strings
      if (this.isInsideString(textBefore)) return { suggestions: [], startOffset: 0 };

      // 4. Member Access after dot (.)
      const dotMatch = textBefore.match(/([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]*)$/);
      if (dotMatch) {
        const objName = dotMatch[1];
        const propQuery = dotMatch[2] ?? '';

        if (objName === 'console') {
          return {
            startOffset: propQuery.length,
            suggestions: this.cleanSuggestions(
              ['log()', 'warn()', 'error()', 'info()', 'table()', 'clear()'].map(m => ({ text: m, type: 'builtin' })),
              propQuery
            )
          };
        }
        if (objName === 'db') {
          return {
            startOffset: propQuery.length,
            suggestions: this.cleanSuggestions(
              [
                'query()', 'createNote()', 'updateNote()', 'increment()', 'toggleProp()', 
                'renderList()', 'bindFilter()', 'openNote()', 'modal()', 'state()', 
                'timer()', 'loop()', 'canvas()', 'onKey()', 'beep()', 'storage()', 
                'drag()', 'notify()', 'onVaultChange()', 'onCleanup()'
              ].map(m => ({ text: m, type: 'api' })),
              propQuery
            )
          };
        }
        if (objName === 'dv') {
          return {
            startOffset: propQuery.length,
            suggestions: this.cleanSuggestions(
              this.dynamicDataviewApi.map(api => ({ text: api, type: 'dv' })),
              propQuery
            )
          };
        }
        if (objName === 'app') {
          return {
            startOffset: propQuery.length,
            suggestions: this.cleanSuggestions(
              ['vault', 'workspace', 'metadataCache', 'fileManager'].map(p => ({ text: p, type: 'builtin' })),
              propQuery
            )
          };
        }

        const commonMethods = [
          'map()', 'filter()', 'forEach()', 'find()', 'includes()', 'slice()', 'join()', 
          'length', 'push()', 'reduce()', 'some()', 'every()', 'sort()', 'reverse()', 
          'indexOf()', 'split()', 'trim()', 'replace()', 'toLowerCase()', 'toUpperCase()'
        ];
        return {
          startOffset: propQuery.length,
          suggestions: this.cleanSuggestions([
            ...this.dynamicFrontmatterKeys.map(k => ({ text: k, type: 'prop' as const })),
            ...commonMethods.map(m => ({ text: m, type: 'builtin' as const }))
          ], propQuery)
        };
      }

      // 5. Top-Level Scope (Keywords, User Variables & Functions)
      const tokenMatch = textBefore.match(/([a-zA-Z0-9_$]+)$/);
      if (tokenMatch) {
        const query = tokenMatch[1] ?? '';
        const { vars: userVars, fns: userFns } = this.extractUserJsSymbols(fullBuffer);

        const jsTopLevel = [
          'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 
          'async', 'await', 'new', 'class', 'switch', 'case', 'break', 'try', 'catch', 
          'finally', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 
          'this', 'window', 'document', 'console', 'db', 'dv', 'app', '$', '$$', 
          'Math', 'JSON', 'Promise', 'setTimeout', 'setInterval', 'localStorage'
        ];

        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions([
            ...userVars.map(v => ({ text: v, type: 'var' as const, weight: 95 })),
            ...userFns.map(f => ({ text: `${f}()`, displayText: f, type: 'fn' as const, weight: 95 })),
            ...jsTopLevel.map(k => ({ text: k, type: 'kw' as const }))
          ], query)
        };
      }
    }

    return { suggestions: [], startOffset: 0 };
  }
}