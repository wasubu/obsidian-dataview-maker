import { Plugin, ItemView, WorkspaceLeaf, Notice, TFile, Modal, App } from 'obsidian';

const VIEW_TYPE_STUDIO = "custom-database-studio-view";

interface VersionSnapshot {
  tag: string;
  html: string;
  css: string;
  js: string;
  timestamp: number;
}

interface StudioPluginData {
  versions: Record<string, VersionSnapshot[]>;
}

const DEFAULT_DATA: StudioPluginData = {
  versions: {}
};

export default class CustomDatabaseStudioPlugin extends Plugin {
  data: StudioPluginData = DEFAULT_DATA;

  async onload() {
    await this.loadStudioData();

    this.registerView(VIEW_TYPE_STUDIO, (leaf) => new StudioView(leaf, this));

    this.addRibbonIcon('layout-template', 'Open Database Studio', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-database-studio',
      name: 'Open Database Studio',
      callback: () => { this.activateView(); }
    });
  }

  onunload() {}

  async loadStudioData() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
  }

  async saveStudioData() {
    await this.saveData(this.data);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_STUDIO)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_STUDIO, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}

class VersionPromptModal extends Modal {
  onSubmit: (result: string) => void;
  defaultText: string;

  constructor(app: App, title: string, defaultText: string, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.defaultText = defaultText;
    this.titleEl.textContent = title;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('p', { text: 'Enter version description/name:' });
    
    const input = contentEl.createEl('input', { attr: { type: 'text', value: this.defaultText } });
    input.style.width = '100%';
    input.style.marginBottom = '16px';
    input.style.padding = '8px';
    input.style.background = 'var(--background-secondary)';
    input.style.border = '1px solid var(--background-modifier-border)';
    input.style.color = 'var(--text-normal)';
    input.style.borderRadius = '6px';
    input.style.outline = 'none';

    input.focus();
    input.select();

    const btnContainer = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px;' } });
    const cancelBtn = btnContainer.createEl('button', { text: 'Cancel', attr: { class: 'cds-tab-btn' } });
    const submitBtn = btnContainer.createEl('button', { text: 'Confirm', attr: { class: 'cds-save-btn' } });
    submitBtn.style.marginLeft = '0';

    cancelBtn.onclick = () => this.close();
    submitBtn.onclick = () => {
      this.onSubmit(input.value.trim() || 'Update');
      this.close();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        this.onSubmit(input.value.trim() || 'Update');
        this.close();
      }
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  onConfirm: () => void;
  message: string;

  constructor(app: App, title: string, message: string, onConfirm: () => void) {
    super(app);
    this.titleEl.textContent = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('p', { text: this.message });
    
    const btnContainer = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;' } });
    const cancelBtn = btnContainer.createEl('button', { text: 'Cancel', attr: { class: 'cds-tab-btn' } });
    const confirmBtn = btnContainer.createEl('button', { text: 'Delete', attr: { class: 'cds-save-btn', style: 'background: var(--text-error); color: white;' } });

    cancelBtn.onclick = () => this.close();
    confirmBtn.onclick = () => {
      this.onConfirm();
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

class StudioView extends ItemView {
  plugin: CustomDatabaseStudioPlugin;
  currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CustomDatabaseStudioPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE_STUDIO; }
  getDisplayText() { return "Database Studio"; }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass('cds-studio-root');

    // Inject Studio CSS styles
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
        .cds-editor-pane { flex: 1; display: none; flex-direction: column; gap: 6px; }
        .cds-editor-pane.active { display: flex; }
        .cds-textarea { width: 100%; flex: 1; font-family: monospace; font-size: 0.9rem; background: var(--background-primary); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px; resize: none; outline: none; }
        .cds-textarea:focus { border-color: var(--interactive-accent); }
        .cds-preview-pane { flex: 1; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: auto; padding: 12px; }
        .cds-split { display: flex; flex-direction: column; height: 45%; gap: 10px; }
      `;
      document.head.appendChild(style);
    }

    let htmlCode = `<!-- HTML Markup Structure -->\n<div class="filter-bar"></div>\n<div class="book-grid"></div>`;
    let cssCode = `.book-dashboard { font-family: inherit; }\n.filter-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }\n.filter-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 14px; border-radius: 6px; cursor: pointer; color: var(--text-normal); font-size: 0.85rem; font-weight: 500; }\n.filter-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }\n.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }\n.book-card { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; cursor: pointer; aspect-ratio: 2/3; }\n.book-card:hover { transform: translateY(-4px); box-shadow: 0 6px 20px rgba(0,0,0,0.25); border-color: var(--interactive-accent); }\n.book-cover-container { width: 100%; height: 70%; background: var(--background-modifier-form-field); overflow: hidden; }\n.book-cover { width: 100%; height: 100%; object-fit: cover; }\n.book-info { padding: 10px; display: flex; flex-direction: column; gap: 4px; flex-grow: 1; }\n.book-title { font-weight: 600; font-size: 0.85rem; line-height: 1.2; }\n.book-author { font-size: 0.75rem; color: var(--text-muted); }\n.book-status { margin-top: auto; font-size: 0.7rem; color: var(--text-muted); }`;
    let jsCode = `// Fetch books from vault\nconst books = dv.pages('"Books"').map(b => ({\n  title: b.title || b.file.name,\n  author: b.author || "Unknown Author",\n  cover: b.cover || "https://via.placeholder.com/150x225?text=No+Cover",\n  status: b.status || "Plan to Read",\n  path: b.file.path\n})).values;\n\ncontainer.innerHTML = htmlContent;\nconst filterBar = container.querySelector('.filter-bar');\nconst gridContainer = container.querySelector('.book-grid');\n\nconst categories = ["All", "Reading", "Completed", "Plan to Read"];\nlet activeCategory = "All";\n\nfunction renderGrid(category) {\n  gridContainer.innerHTML = "";\n  const filteredBooks = books.filter(b => {\n    if (category === "All") return true;\n    return b.status.toLowerCase().includes(category.toLowerCase());\n  });\n\n  for (let book of filteredBooks) {\n    const card = document.createElement('div');\n    card.className = "book-card";\n    card.onclick = () => app.workspace.openLinkText(book.path, "", false);\n    card.innerHTML = \`\n      <div class="book-cover-container"><img class="book-cover" src="\${book.cover}"></div>\n      <div class="book-info">\n        <div class="book-title">\${book.title}</div>\n        <div class="book-author">\${book.author}</div>\n        <div class="book-status">\${book.status}</div>\n      </div>\n    \`;\n    gridContainer.appendChild(card);\n  }\n}\n\ncategories.forEach(cat => {\n  const btn = document.createElement('button');\n  btn.className = \`filter-btn \${cat === activeCategory ? 'active' : ''}\`;\n  btn.innerText = cat;\n  btn.onclick = () => {\n    activeCategory = cat;\n    filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));\n    btn.classList.add('active');\n    renderGrid(cat);\n  };\n  filterBar.appendChild(btn);\n});\n\nrenderGrid("All");`;

    // Top Toolbar
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

    // Populate Note Dropdown
    (async () => {
      fileSelect.empty();
      fileSelect.createEl('option', { text: '-- Select DataviewJS Note --', attr: { value: '' } });
      const markdownFiles = this.app.vault.getMarkdownFiles();
      for (const file of markdownFiles) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (content.includes('dataviewjs')) {
            fileSelect.createEl('option', { text: file.path, attr: { value: file.path } });
          }
        } catch (e) {}
      }
    })();

    // 3 Tabs Header (HTML, CSS, JS Logic)
    const tabHeader = container.createDiv({ cls: 'cds-tabs' });
    const htmlBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn active', text: 'HTML' });
    const cssBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'CSS' });
    const jsBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'JS Logic' });

    // Split Container for Editors
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

    // Preview Pane
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
        const executeFn = new Function('container', 'htmlContent', 'app', 'notice', jsCode);
        executeFn(bodyDiv, htmlCode, this.app, (msg: string) => new Notice(msg));
      } catch (err: any) {
        console.error("Runtime error in Studio JS:", err);
        const errDiv = document.createElement('div');
        errDiv.style.color = 'var(--text-error)';
        errDiv.innerText = `Error: ${err.message}`;
        shadow.appendChild(errDiv);
      }
    };

    // Hot Reload Debounce Setup
    let debounceTimer: any = null;
    const triggerHotReload = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        runCode();
      }, 250);
    };

    htmlArea.oninput = (e: any) => { htmlCode = e.target.value; triggerHotReload(); };
    cssArea.oninput = (e: any) => { cssCode = e.target.value; triggerHotReload(); };
    jsArea.oninput = (e: any) => { jsCode = e.target.value; triggerHotReload(); };

    const updateVersionDropdown = (path: string, selectedTag?: string) => {
      versionSelect.empty();
      const versions = this.plugin.data.versions[path] || [];
      if (versions.length === 0) {
        versionSelect.createEl('option', { text: 'No versions yet', attr: { value: '', disabled: true } });
        return;
      }
      versions.forEach((v, idx) => {
        const opt = versionSelect.createEl('option', { text: v.tag, attr: { value: idx.toString() } });
        if (selectedTag && v.tag === selectedTag) {
          opt.selected = true;
        }
      });
    };

    // Auto-load note when selected from dropdown
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

          // 1. Extract CSS
          const cssMatch = code.match(/style\.innerHTML\s*=\s*`([\s\S]*?)`;/);
          cssCode = cssMatch && cssMatch[1] ? cssMatch[1] : "";
          cssArea.value = cssCode;

          // 2. Extract HTML
          const htmlMatch = code.match(/const\s+htmlContent\s*=\s*`([\s\S]*?)`;/);
          htmlCode = htmlMatch && htmlMatch[1] ? htmlMatch[1] : "";
          htmlArea.value = htmlCode;

          // 3. Extract JS Logic
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

        // Initialize v0 version if none exist for this file yet
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

    // Switch version when version dropdown changes
    versionSelect.onchange = () => {
      if (!this.currentFile) return;
      const idx = parseInt(versionSelect.value, 10);
      const versions = this.plugin.data.versions[this.currentFile.path] || [];
      const selectedVersion = versions[idx];
      if (selectedVersion) {
        htmlCode = selectedVersion.html;
        htmlArea.value = htmlCode;
        cssCode = selectedVersion.css;
        cssArea.value = cssCode;
        jsCode = selectedVersion.js;
        jsArea.value = jsCode;
        new Notice(`Loaded version: ${selectedVersion.tag}`);
        runCode();
      }
    };

    // Save as New Version
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

      new VersionPromptModal(this.app, "Save as New Version", `v${nextVersionNum} - Update`, async (fullTagInput) => {
        const tag = fullTagInput.startsWith('v') ? fullTagInput : `v${nextVersionNum} - ${fullTagInput}`;
        const newSnapshot: VersionSnapshot = {
          tag,
          html: htmlCode,
          css: cssCode,
          js: jsCode,
          timestamp: Date.now()
        };

        if (!this.plugin.data.versions[path]) {
          this.plugin.data.versions[path] = [];
        }
        this.plugin.data.versions[path]!.push(newSnapshot);
        await this.plugin.saveStudioData();

        updateVersionDropdown(path, tag);
        new Notice(`Created version ${tag}`);
      }).open();
    };

    // Rename Selected Version
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

    // Remove Last Version
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
          
          const newLatest = versions[versions.length - 1];
          if (newLatest) {
            htmlCode = newLatest.html;
            htmlArea.value = htmlCode;
            cssCode = newLatest.css;
            cssArea.value = cssCode;
            jsCode = newLatest.js;
            jsArea.value = jsCode;
            runCode();
          }

          updateVersionDropdown(path, newLatest?.tag);
          new Notice("Successfully removed the last version.");
        }
      ).open();
    };

    // Save back to Vault Note
    saveBtn.onclick = async () => {
      if (!this.currentFile) {
        new Notice("Please select and load a vault note first!");
        return;
      }
      try {
        const wrappedContent = [
          "```dataviewjs",
          "// --- CSS ---",
          'const styleId = "interactive-book-grid-style";',
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
        new Notice(`Successfully updated ${this.currentFile.name}!`);
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