import { Plugin, ItemView, WorkspaceLeaf, Notice, TFile } from 'obsidian';

const VIEW_TYPE_STUDIO = "custom-database-studio-view";

export default class CustomDatabaseStudioPlugin extends Plugin {
  async onload() {
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
        .cds-select { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); color: var(--text-normal); padding: 6px 10px; border-radius: 6px; font-size: 0.85rem; }
        .cds-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 8px; }
        .cds-tab-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 14px; border-radius: 4px; cursor: pointer; color: var(--text-normal); font-weight: 500; }
        .cds-tab-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
        .cds-save-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-left: auto; }
        .cds-editor-pane { flex: 1; display: none; flex-direction: column; gap: 6px; }
        .cds-editor-pane.active { display: flex; }
        .cds-textarea { width: 100%; flex: 1; font-family: monospace; font-size: 0.9rem; background: var(--background-primary); color: var(--text-normal); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px; resize: none; outline: none; }
        .cds-textarea:focus { border-color: var(--interactive-accent); }
        .cds-preview-pane { flex: 1; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: auto; padding: 12px; }
        .cds-split { display: flex; flex-direction: column; height: 45%; gap: 10px; }
      `;
      document.head.appendChild(style);
    }

    // Default Book Grid CSS Code
    let cssCode = `.book-dashboard { font-family: inherit; }\n.top-action-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }\n.filter-bar { display: flex; gap: 8px; flex-wrap: wrap; }\n.filter-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 6px 14px; border-radius: 6px; cursor: pointer; color: var(--text-normal); font-size: 0.85rem; font-weight: 500; }\n.filter-btn:hover { background: var(--background-modifier-hover); }\n.filter-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }\n.add-book-btn { background: var(--interactive-accent); color: var(--text-on-accent); border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; }\n.book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }\n.book-card { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; cursor: pointer; aspect-ratio: 2/3; }\n.book-card:hover { transform: translateY(-4px); box-shadow: 0 6px 20px rgba(0,0,0,0.25); border-color: var(--interactive-accent); }\n.book-cover-container { width: 100%; height: 70%; background: var(--background-modifier-form-field); overflow: hidden; }\n.book-cover { width: 100%; height: 100%; object-fit: cover; }\n.book-info { padding: 10px; display: flex; flex-direction: column; gap: 4px; flex-grow: 1; }\n.book-title { font-weight: 600; font-size: 0.85rem; line-height: 1.2; }\n.book-author { font-size: 0.75rem; color: var(--text-muted); }\n.book-status { margin-top: auto; font-size: 0.7rem; color: var(--text-muted); }`;

    // Default Book Grid JS Code
    let jsCode = `// Fetch books from your vault\nconst books = dv.pages('"Books"').map(b => ({\n  title: b.title || b.file.name,\n  author: b.author || "Unknown Author",\n  cover: b.cover || "https://via.placeholder.com/150x225?text=No+Cover",\n  status: b.status || "Plan to Read",\n  path: b.file.path\n})).values;\n\nasync function createNewBook() {\n  const folderPath = "Books";\n  try {\n    if (!app.vault.getAbstractFileByPath(folderPath)) {\n      await app.vault.createFolder(folderPath);\n    }\n    let baseName = "New Book";\n    let filePath = \`\${folderPath}/\${baseName}.md\`;\n    let counter = 1;\n    while (app.vault.getAbstractFileByPath(filePath)) {\n      filePath = \`\${folderPath}/\${baseName} \${counter}.md\`;\n      counter++;\n    }\n    const content = \`---\\ntitle: "New Book"\\nauthor: "Unknown Author"\\nstatus: "Plan to Read"\\ncover: ""\\n---\\n\\n# New Book\\n\\n\`;\n    const newFile = await app.vault.create(filePath, content);\n    await app.workspace.getLeaf().openFile(newFile);\n  } catch (err) {\n    new Notice("Failed to create book note: " + err.message);\n  }\n}\n\nconst dashboard = container.createDiv({ cls: "book-dashboard" });\nconst topBar = document.createElement('div');\ntopBar.className = "top-action-bar";\n\nconst filterBar = document.createElement('div');\nfilterBar.className = "filter-bar";\n\nconst addBtn = document.createElement('button');\naddBtn.className = "add-book-btn";\naddBtn.innerHTML = "<span>+</span> Add Book";\naddBtn.onclick = createNewBook;\n\nconst categories = ["All", "Reading", "Completed", "Plan to Read"];\nlet activeCategory = "All";\n\nconst gridContainer = document.createElement('div');\ngridContainer.className = "book-grid";\n\nfunction renderGrid(category) {\n  gridContainer.innerHTML = "";\n  const filteredBooks = books.filter(b => {\n    if (category === "All") return true;\n    return b.status.toLowerCase().includes(category.toLowerCase());\n  });\n\n  for (let book of filteredBooks) {\n    const card = document.createElement('div');\n    card.className = "book-card";\n    card.onclick = (e) => {\n      e.preventDefault();\n      app.workspace.openLinkText(book.path, "", false);\n    };\n    card.innerHTML = \`\n      <div class="book-cover-container">\n        <img class="book-cover" src="\${book.cover}" alt="\${book.title}" loading="lazy">\n      </div>\n      <div class="book-info">\n        <div class="book-title">\${book.title}</div>\n        <div class="book-author">\${book.author}</div>\n        <div class="book-status">\${book.status}</div>\n      </div>\n    \`;\n    gridContainer.appendChild(card);\n  }\n}\n\ncategories.forEach(cat => {\n  const btn = document.createElement('button');\n  btn.className = \`filter-btn \${cat === activeCategory ? 'active' : ''}\`;\n  btn.innerText = cat;\n  btn.onclick = () => {\n    activeCategory = cat;\n    filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));\n    btn.classList.add('active');\n    renderGrid(cat);\n  };\n  filterBar.appendChild(btn);\n});\n\ntopBar.appendChild(filterBar);\ntopBar.appendChild(addBtn);\ndashboard.appendChild(topBar);\ndashboard.appendChild(gridContainer);\nrenderGrid("All");`;

    // Top Toolbar for Vault File Selection & Saving
    const toolbar = container.createDiv({ cls: 'cds-toolbar' });
    toolbar.createEl('span', { text: 'Target Note:', attr: { style: 'font-weight:600; font-size:0.85rem;' } });
    
    const fileSelect = toolbar.createEl('select', { cls: 'cds-select' });
    fileSelect.createEl('option', { text: '-- Select Vault Note --', attr: { value: '' } });
    
    const markdownFiles = this.app.vault.getMarkdownFiles();
    markdownFiles.forEach(file => {
      fileSelect.createEl('option', { text: file.path, attr: { value: file.path } });
    });

    const loadBtn = toolbar.createEl('button', { cls: 'cds-tab-btn', text: 'Load' });
    const saveBtn = toolbar.createEl('button', { cls: 'cds-save-btn', text: '💾 Save to Vault Note' });

    // Tabs Header
    const tabHeader = container.createDiv({ cls: 'cds-tabs' });
    const cssBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn active', text: 'CSS' });
    const jsBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: 'JS Logic' });
    const runBtn = tabHeader.createEl('button', { cls: 'cds-tab-btn', text: '▶ Run / Preview' });
    runBtn.style.marginLeft = 'auto';

    // Split Container for Editors
    const splitContainer = container.createDiv({ cls: 'cds-split' });

    const cssPane = splitContainer.createDiv({ cls: 'cds-editor-pane active' });
    const cssArea = cssPane.createEl('textarea', { cls: 'cds-textarea' });
    cssArea.value = cssCode;
    cssArea.oninput = (e: any) => { cssCode = e.target.value; };

    const jsPane = splitContainer.createDiv({ cls: 'cds-editor-pane' });
    const jsArea = jsPane.createEl('textarea', { cls: 'cds-textarea' });
    jsArea.value = jsCode;
    jsArea.oninput = (e: any) => { jsCode = e.target.value; };

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
      bodyDiv.innerHTML = "";
      shadow.appendChild(bodyDiv);

      try {
        const executeFn = new Function('container', 'app', 'notice', jsCode);
        executeFn(bodyDiv, this.app, (msg: string) => new Notice(msg));
      } catch (err: any) {
        console.error("Runtime error in Studio JS:", err);
        const errDiv = document.createElement('div');
        errDiv.style.color = 'var(--text-error)';
        errDiv.innerText = `Error: ${err.message}`;
        shadow.appendChild(errDiv);
      }
    };

    // Load from Vault File
	// Load from Vault File
    loadBtn.onclick = async () => {
      const selectedPath = fileSelect.value;
      if (!selectedPath) {
        new Notice("Please select a note first.");
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        this.currentFile = file;
        const content = await this.app.vault.read(file);
        
        // Extract dataviewjs block safely with a check for match[1]
        const match = content.match(/```dataviewjs([\s\S]*?)```/);
        if (match && match[1]) {
          jsCode = match[1].trim();
        } else {
          jsCode = content;
        }
        jsArea.value = jsCode;
        
        new Notice(`Loaded note: ${file.name}`);
        runCode();
      }
    };

    // Save back to Vault Note
	// Save back to Vault Note
    saveBtn.onclick = async () => {
      if (!this.currentFile) {
        new Notice("Please select and load a vault note first!");
        return;
      }
      try {
        const wrappedContent = [
          "```dataviewjs",
          '// 1. Inject custom styling',
          'const styleId = "interactive-book-grid-style";',
          'if (!document.getElementById(styleId)) {',
          '  const style = document.createElement("style");',
          '  style.id = styleId;',
          `  style.innerHTML = \`${cssCode}\`;`,
          '  document.head.appendChild(style);',
          '}',
          '',
          jsCode,
          '```'
        ].join('\n');

        await this.app.vault.modify(this.currentFile, wrappedContent);
        new Notice(`Successfully updated ${this.currentFile.name}!`);
      } catch (err: any) {
        new Notice("Failed to save: " + err.message);
      }
    };

    const switchTab = (tab: string) => {
      cssBtn.toggleClass('active', tab === 'css');
      jsBtn.toggleClass('active', tab === 'js');
      cssPane.toggleClass('active', tab === 'css');
      jsPane.toggleClass('active', tab === 'js');
    };

    cssBtn.onclick = () => switchTab('css');
    jsBtn.onclick = () => switchTab('js');
    runBtn.onclick = () => runCode();

    runCode();
  }

  async onClose() {}
}