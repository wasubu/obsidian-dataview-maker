// view.ts
import { ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import CustomDatabaseStudioPlugin, { VersionSnapshot } from './main';
import { VersionPromptModal, ConfirmModal } from './modals';
import { AutocompleteEngine } from './autocomplete';
import { createRuntimeEnvironment } from './db_api';
import { createCodeEditor } from './view_codeEditor';

export const VIEW_TYPE_STUDIO = "custom-database-studio-view";

export class StudioView extends ItemView {
  plugin: CustomDatabaseStudioPlugin;
  currentFile: TFile | null = null;
  autocompleteEngine: AutocompleteEngine;

  // Universal lifecycle registry (cleans up user animations, timers, listeners on reload)
  private previewCleanups: Array<() => void> = [];

  private runCleanups() {
    for (const fn of this.previewCleanups) {
      try { fn(); } catch (e) {}
    }
    this.previewCleanups = [];
  }

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
   * Universal CanvasView Runtime Helpers (Delegates to shared runtime environment)
   */
  getRuntimeHelpers(containerEl: HTMLElement, htmlContent: string) {
    containerEl.innerHTML = htmlContent;
    return createRuntimeEnvironment({
      containerEl,
      app: this.app,
      cleanups: this.previewCleanups,
      isDestroyed: () => false
    });
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

  async onOpen() {
    await this.autocompleteEngine.indexVault();

    const container = this.contentEl;
    container.empty();
    container.addClass('cds-studio-root');

    let htmlCode = "<div class=\"filter-bar\"></div>\n<div class=\"book-grid\"></div>";
    let cssCode = ".filter-bar { display: flex; gap: 8px; margin-bottom: 16px; }\n.filter-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 12px; border-radius: 4px; color: var(--text-normal); cursor: pointer; }\n.filter-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); }\n.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }";
    let jsCode = "container.innerHTML = htmlContent;\nconst grid = container.querySelector('.book-grid');\nconst files = app.vault.getMarkdownFiles().slice(0, 8);\nfor (const file of files) {\n  const el = document.createElement('div');\n  el.style.padding = '8px';\n  el.style.border = '1px solid var(--background-modifier-border)';\n  el.innerText = file.basename;\n  grid?.appendChild(el);\n}";

    const toolbar = container.createDiv({ cls: 'cds-toolbar' });
    toolbar.createEl('span', { text: 'Note:', attr: { style: 'font-weight:600; font-size:0.85rem;' } });
    const fileSelect = toolbar.createEl('select', { cls: 'cds-select' });
    fileSelect.createEl('option', { text: 'Scanning notes...', attr: { value: '', disabled: true } });

    toolbar.createEl('span', { text: 'Version:', attr: { style: 'font-weight:600; font-size:0.85rem; margin-left: 8px;' } });
    const versionSelect = toolbar.createEl('select', { cls: 'cds-select' });
    versionSelect.createEl('option', { text: '-- Select Version --', attr: { value: '', disabled: true } });

    const newVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: '+ Save as New' });
    newVersionBtn.style.display = 'none';

    const checkUnsavedChanges = () => {
      if (!this.currentFile) {
        newVersionBtn.style.display = 'none';
        return;
      }
      const versions = this.plugin.data.versions[this.currentFile.path] || [];
      const idx = parseInt(versionSelect.value, 10);
      
      if (isNaN(idx) || !versions[idx]) {
        newVersionBtn.style.display = 'none';
        return;
      }

      const resolved = this.resolveVersion(versions, idx);
      const hasChanges = (htmlCode !== resolved.html) || 
                         (cssCode !== resolved.css) || 
                         (jsCode !== resolved.js);

      if (hasChanges) {
        newVersionBtn.style.display = 'inline-flex';
        newVersionBtn.addClass('cds-btn-highlight');
      } else {
        newVersionBtn.style.display = 'none';
        newVersionBtn.removeClass('cds-btn-highlight');
      }
    };

    const renameVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: 'Rename Ver' });
    const removeVersionBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: 'Remove Last Ver' });
    const saveBtn = toolbar.createEl('button', { cls: 'cds-save-btn', text: '💾 Update Note', attr: { style: 'margin-left: auto;' } });

    // Scan vault for notes containing ```canvasview
    (async () => {
      fileSelect.empty();
      fileSelect.createEl('option', { text: '-- Select CanvasView Note --', attr: { value: '' } });
      for (const file of this.app.vault.getMarkdownFiles()) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (content.includes('```canvasview')) {
            fileSelect.createEl('option', { text: file.path, attr: { value: file.path } });
          }
        } catch (e) {}
      }
    })();

    const tabHeader = container.createDiv({ cls: 'cds-tabs' });
    const htmlBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn active', text: 'HTML' });
    const cssBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'CSS' });
    const jsBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'JS Logic' });

    const mainBody = container.createDiv({ cls: 'cds-main-body' });

    const splitContainer = mainBody.createDiv({ cls: 'cds-split' });
    const htmlPane = splitContainer.createDiv({ cls: 'cds-editor-pane active' });
    const cssPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });
    const jsPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });

    let debounceTimer: any = null;
    const triggerHotReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runCode(), 250);
    };

    const htmlEditor = createCodeEditor(htmlPane, 'html', htmlCode, (val) => { 
      htmlCode = val; 
      triggerHotReload(); 
      checkUnsavedChanges(); 
    }, this.autocompleteEngine, this.previewCleanups, () => htmlCode);

    const cssEditor = createCodeEditor(cssPane, 'css', cssCode, (val) => { 
      cssCode = val; 
      triggerHotReload(); 
      checkUnsavedChanges(); 
    }, this.autocompleteEngine, this.previewCleanups, () => htmlCode);

    const jsEditor = createCodeEditor(jsPane, 'js', jsCode, (val) => { 
      jsCode = val; 
      triggerHotReload(); 
      checkUnsavedChanges(); 
    }, this.autocompleteEngine, this.previewCleanups, () => htmlCode);

    const previewWrapper = mainBody.createDiv({ cls: 'cds-preview-pane' });
    const previewContainer = previewWrapper.createDiv({ cls: 'cds-preview-scroll' });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const paneWidth = entry.contentRect.width;
        mainBody.toggleClass('is-two-column', paneWidth >= 850);
      }
    });
    resizeObserver.observe(container);
    this.register(() => resizeObserver.disconnect());

    const runCode = () => {
      this.runCleanups();
      previewContainer.empty();

      const noteSimWrapper = previewContainer.createDiv({ 
        cls: 'markdown-rendered markdown-preview-view cds-preview-sim-root' 
      });
      noteSimWrapper.style.setProperty('width', '100%', 'important');
      noteSimWrapper.style.setProperty('max-width', '100%', 'important');
      noteSimWrapper.style.setProperty('box-sizing', 'border-box', 'important');

      const previewStyleId = 'cds-preview-active-styles';
      let styleEl = previewContainer.querySelector(`#${previewStyleId}`) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = previewStyleId;
        previewContainer.prepend(styleEl);
      }

      styleEl.innerHTML = `
        .cds-preview-sim-root > * {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        ${cssCode}
      `;

      const { db, $,$$ } = this.getRuntimeHelpers(noteSimWrapper, htmlCode);
      (window as any).db = db;

      try {
        const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;

        const dv = dvApi
          ? Object.assign(Object.create(dvApi), {
              container: noteSimWrapper
            })
          : null;

        const dataviewContext = {
          container: noteSimWrapper,
          app: this.app,
          dv
        };

        const executeFn = new Function(
          "container",
          "htmlContent",
          "app",
          "notice",
          "dv",
          "db",
          "$", "$$",
          jsCode
        );

        executeFn.call(
          dataviewContext,
          noteSimWrapper,
          htmlCode,
          this.app,
          (msg: string) => new Notice(msg),
          dv,
          db,
          $,$$
        );

      } catch (err: any) {
        console.error("[canvasview] Runtime error:", err);

        const errDiv = noteSimWrapper.createDiv({
          cls: "cds-runtime-error"
        });

        errDiv.style.color = "var(--text-error)";
        errDiv.style.fontFamily = "var(--font-monospace)";
        errDiv.style.padding = "10px";
        errDiv.innerText = `Runtime Error: ${err.message}`;
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
        if (selectedTag ? v.tag === selectedTag : idx === versions.length - 1) {
          opt.selected = true;
        }
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

        // Match ```canvasview block
        const match = content.match(/```[ \t]*canvasview(?:[ \t]+[^\r\n]*)?\r?\n([\s\S]*?)\r?\n[ \t]*```/);
        if (match && match[1]) {
          const code = match[1];

          const cssMatch = code.match(/\/\/ --- CSS ---([\s\S]*?)(?=\/\/ --- HTML ---|\/\/ --- JS ---|$)/);
          cssCode = cssMatch && cssMatch[1] ? cssMatch[1].trim() : "";
          cssEditor.setValue(cssCode);

          const htmlMatch = code.match(/\/\/ --- HTML ---([\s\S]*?)(?=\/\/ --- JS ---|$)/);
          htmlCode = htmlMatch && htmlMatch[1] ? htmlMatch[1].trim() : "";
          htmlEditor.setValue(htmlCode);

          const jsMatch = code.match(/\/\/ --- JS ---([\s\S]*)$/);
          if (jsMatch && jsMatch[1]) {
            jsCode = jsMatch[1].trim();
          } else {
            const styleMatch = code.match(/styleEl\.innerHTML\s*=\s*`([\s\S]*?)`;/);
            if (styleMatch && styleMatch[1] && !cssCode) cssCode = styleMatch[1].trim();
            
            const htmlContentMatch = code.match(/const\s+htmlContent\s*=\s*`([\s\S]*?)`;/);
            if (htmlContentMatch && htmlContentMatch[1] && !htmlCode) htmlCode = htmlContentMatch[1].trim();

            const jsSplit = code.split('// --- JS ---');
            jsCode = jsSplit[1] ? jsSplit[1].trim() : code.trim();
          }
          cssEditor.setValue(cssCode);
          htmlEditor.setValue(htmlCode);
          jsEditor.setValue(jsCode);
        } else {
          jsCode = content.trim();
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

        const versions = this.plugin.data.versions[file.path] || [];
        const latestTag = versions[versions.length - 1]?.tag;
        updateVersionDropdown(file.path, latestTag);
        new Notice(`Loaded note: ${file.name}`);
        checkUnsavedChanges();
        runCode();
      }
    };

    versionSelect.onchange = () => {
      const idx = parseInt(versionSelect.value, 10);
      if (!this.currentFile || isNaN(idx)) return;
      const versions = this.plugin.data.versions[this.currentFile.path] || [];
      const selectedVersion = versions[idx];
      const resolved = this.resolveVersion(versions, idx);

      if (selectedVersion) {
        cssCode = resolved.css;
        cssEditor.setValue(cssCode);
        htmlCode = resolved.html;
        htmlEditor.setValue(htmlCode);
        jsCode = resolved.js;
        jsEditor.setValue(jsCode);
        new Notice(`Loaded version: ${selectedVersion.tag}`);
        runCode();
        checkUnsavedChanges();
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
        checkUnsavedChanges();

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
        const wrappedContent = [
          "```canvasview",
          "// --- CSS ---",
          cssCode,
          "",
          "// --- HTML ---",
          htmlCode,
          "",
          "// --- JS ---",
          jsCode,
          "```"
        ].join('\n');

        await this.app.vault.modify(this.currentFile, wrappedContent);
        new Notice(`Successfully saved to ${this.currentFile.name}!`);
        checkUnsavedChanges();
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

  async onClose() {
    this.runCleanups();
  }
}