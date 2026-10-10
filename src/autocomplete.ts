// autocomplete.ts
import { App, TFolder, TFile } from 'obsidian';

export interface AutocompleteSuggestion {
  text: string;
  displayText?: string;
  type: 'kw' | 'api' | 'builtin' | 'html' | 'attr' | 'css-prop' | 'css-var' | 'dv' | 'vault' | 'prop' | 'buffer';
  weight?: number;
  score?: number;
}

const TOKEN_WEIGHTS: Record<string, number> = {
  // JavaScript Top Keywords
  'const': 95,
  'console.log': 90,
  'console': 85,
  'let': 85,
  'function': 85,
  'return': 80,
  'async': 75,
  'await': 75,
  'if': 75,
  'for': 70,

  // Universal Database Studio API
  'db.query': 100,
  'db.createNote': 95,
  'db.renderList': 95,
  'db.bindFilter': 90,
  'db.openNote': 90,
  'db.updateNote': 85,
  '$': 90,
  '$$': 85,
  'dv.pages': 90,
  'dv.current': 85,

  // HTML Common Elements
  'div': 100,
  'span': 90,
  'button': 90,
  'input': 85,
  'img': 85,
  'a': 80,
  'p': 80,
  'class': 90,
  'id': 85,
  'onclick': 80,

  // CSS Common Properties
  'display': 100,
  'flex': 90,
  'color': 90,
  'background': 90,
  'padding': 85,
  'margin': 85,
  'grid': 85,
  'border': 80
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
    // 1. Dynamic HTML Tags
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

    // 2. Dynamic HTML Attributes
    const attrSet = new Set<string>(['class', 'id', 'src', 'href', 'style', 'alt', 'title', 'type', 'value', 'placeholder', 'onclick']);
    this.dynamicHtmlAttributes = Array.from(attrSet);

    // 3. Dynamic CSS Properties
    const cssPropSet = new Set<string>();
    const styleProto = document.body.style;
    for (const prop in styleProto) {
      if (typeof styleProto[prop] === 'string' && !prop.startsWith('webkit') && !prop.startsWith('moz')) {
        const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (kebab && isNaN(Number(kebab))) cssPropSet.add(kebab);
      }
    }
    this.dynamicCssProperties = Array.from(cssPropSet);

    // 4. Dynamic CSS Theme Variables
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

    // 5. Dataview API
    const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;
    if (dvApi) {
      const dvKeys = new Set<string>([...Object.keys(dvApi), ...Object.getOwnPropertyNames(Object.getPrototypeOf(dvApi) || {})]);
      this.dynamicDataviewApi = Array.from(dvKeys).map(k => typeof dvApi[k] === 'function' ? `dv.${k}()` : `dv.${k}`);
    } else {
      this.dynamicDataviewApi = ['dv.pages()', 'dv.current()', 'dv.array()', 'dv.table()', 'dv.list()'];
    }

    // 6. Vault Folders, Tags, Frontmatter
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

  isInsideComment(textBefore: string, mode: 'html' | 'css' | 'js'): boolean {
    if (mode === 'html') {
      const lastCommentOpen = textBefore.lastIndexOf('<!--');
      const lastCommentClose = textBefore.lastIndexOf('-->');
      return lastCommentOpen > lastCommentClose;
    }

    if (mode === 'css') {
      const lastCommentOpen = textBefore.lastIndexOf('/*');
      const lastCommentClose = textBefore.lastIndexOf('*/');
      return lastCommentOpen > lastCommentClose;
    }

    if (mode === 'js') {
      const currentLine = textBefore.substring(textBefore.lastIndexOf('\n') + 1);
      if (/\/\/.*$/.test(currentLine)) return true;

      const lastCommentOpen = textBefore.lastIndexOf('/*');
      const lastCommentClose = textBefore.lastIndexOf('*/');
      return lastCommentOpen > lastCommentClose;
    }

    return false;
  }

  getBufferTokens(content: string, excludeWord: string): string[] {
    const matches = content.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]{1,}\b/g);
    if (!matches) return [];
    const lowerExclude = excludeWord.toLowerCase();
    const unique = new Set<string>();
    for (const w of matches) {
      if (w.toLowerCase() !== lowerExclude) {
        unique.add(w);
      }
    }
    return Array.from(unique);
  }

  scoreSuggestion(target: string, query: string, type: string): number {
    const text = target.toLowerCase();
    const q = query.toLowerCase();

    // NEVER suggest the exact word currently being typed
    if (text === q) return 0;
    if (!q || !text.includes(q)) return 0;

    const cleanWord = text.replace(/[^a-zA-Z0-9_.]/g, '');
    const weightBoost = TOKEN_WEIGHTS[cleanWord] || TOKEN_WEIGHTS[text] || 0;

    let score = 0;

    // 1. Prefix match
    if (text.startsWith(q)) {
      score = 600 + weightBoost - (text.length - q.length) * 2;
    }
    // 2. Word boundary match ('db.query' matching 'query')
    else if (new RegExp(`[\\-_.:]${q}`, 'i').test(text)) {
      score = 400 + weightBoost - text.length;
    }
    // 3. Substring match
    else {
      const idx = text.indexOf(q);
      score = 150 + (weightBoost * 0.5) - (idx * 10) - text.length;
    }

    return Math.max(score, 1);
  }

  /**
   * Helper that deduplicates suggestions and eliminates exact matches
   */
  private cleanSuggestions(list: AutocompleteSuggestion[], activeWord: string): AutocompleteSuggestion[] {
    const seen = new Set<string>();
    const out: AutocompleteSuggestion[] = [];
    const lowerActive = activeWord.toLowerCase();

    for (const item of list) {
      const key = (item.displayText || item.text).toLowerCase().replace(/[();"']/g, '');
      // Skip if already in list OR if it equals the word being typed
      if (seen.has(key) || key === lowerActive) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  getSuggestions(
    textBefore: string, 
    fullBuffer: string, 
    mode: 'html' | 'css' | 'js'
  ): { suggestions: AutocompleteSuggestion[], startOffset: number } {
    if (this.isInsideComment(textBefore, mode)) {
      return { suggestions: [], startOffset: 0 };
    }

    // --- HTML Context ---
    if (mode === 'html') {
      const tagMatch = textBefore.match(/<([a-zA-Z0-9-]*)$/);
      if (tagMatch) {
        const query = tagMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicHtmlTags.map(t => ({ text: t, type: 'html' })), 
            query
          )
        };
      }

      const attrMatch = textBefore.match(/\s+([a-zA-Z0-9-]*)$/);
      if (attrMatch && !textBefore.endsWith('>')) {
        const query = attrMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicHtmlAttributes.map(a => ({ text: `${a}=""`, displayText: a, type: 'attr' })), 
            query
          )
        };
      }
    }

    // --- CSS Context ---
    if (mode === 'css') {
      const varMatch = textBefore.match(/var\((--[a-zA-Z0-9-]*)$/);
      if (varMatch) {
        const query = varMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions(
            this.dynamicCssVariables.map(v => ({ text: `${v})`, displayText: v, type: 'css-var' })), 
            query
          )
        };
      }

      const propMatch = textBefore.match(/([a-zA-Z-]*)$/);
      if (propMatch) {
        const query = propMatch[1] ?? '';
        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions([
            ...this.dynamicCssProperties.map(p => ({ text: `${p}: `, displayText: p, type: 'css-prop' as const })),
            ...this.dynamicCssVariables.map(v => ({ text: `var(${v});`, displayText: v, type: 'css-var' as const }))
          ], query)
        };
      }
    }

    // --- JavaScript Context ---
    if (mode === 'js') {
      // Vault Folder/Tag queries
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

      // Member Access: db.
      if (textBefore.endsWith('db.')) {
        return {
          startOffset: 0,
          suggestions: [
            { text: 'query()', displayText: 'db.query()', type: 'api' },
            { text: 'createNote()', displayText: 'db.createNote()', type: 'api' },
            { text: 'renderList()', displayText: 'db.renderList()', type: 'api' },
            { text: 'bindFilter()', displayText: 'db.bindFilter()', type: 'api' },
            { text: 'openNote()', displayText: 'db.openNote()', type: 'api' },
            { text: 'updateNote()', displayText: 'db.updateNote()', type: 'api' }
          ]
        };
      }

      // Member Access: dv.
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

      // Frontmatter Property Access: item.
      if (/(\w+)\.$/.test(textBefore)) {
        return {
          startOffset: 0,
          suggestions: this.dynamicFrontmatterKeys.map(k => ({ text: k, type: 'prop' as const }))
        };
      }

      // General JavaScript Keywords & API
      const tokenMatch = textBefore.match(/([a-zA-Z0-9_$]+)$/);
      if (tokenMatch) {
        const query = tokenMatch[1] ?? '';
        const bufferWords = this.getBufferTokens(fullBuffer, query);

        const jsKeywords = [
          'const', 'let', 'function', 'return', 'if', 'else', 'for', 'while',
          'async', 'await', 'import', 'export', 'new', 'class', 'try', 'catch',
          'console.log()', 'console', 'db.query()', 'db.createNote()', 'db.renderList()',
          'db.bindFilter()', 'db.openNote()', 'db', '$', '$$'
        ];

        return {
          startOffset: query.length,
          suggestions: this.cleanSuggestions([
            ...jsKeywords.map(k => ({ text: k, type: 'kw' as const })),
            ...this.dynamicDataviewApi.map(d => ({ text: d, type: 'dv' as const })),
            ...this.dynamicFrontmatterKeys.map(k => ({ text: k, type: 'prop' as const })),
            ...bufferWords.map(w => ({ text: w, type: 'buffer' as const }))
          ], query)
        };
      }
    }

    return { suggestions: [], startOffset: 0 };
  }
}