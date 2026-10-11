// main.ts
import { Plugin, Notice, MarkdownRenderChild, TFile } from 'obsidian';
import { StudioView, VIEW_TYPE_STUDIO } from './view';
import { createRuntimeEnvironment } from './runtime';

export interface VersionSnapshot {
  tag: string;
  html: string | null;
  css: string | null;
  js: string | null;
  timestamp: number;
}

export interface StudioPluginData {
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

    // Register the custom ```canvasview codeblock processor with 100% preview parity
this.registerMarkdownCodeBlockProcessor("canvasview", (source, el, ctx) => {
      let cssCode = "";
      let htmlCode = "";
      let jsCode = source;

      const parts = source.split(/\/\/\s*--- (CSS|HTML|JS) ---/);
      if (parts.length > 1) {
        for (let i = 1; i < parts.length; i += 2) {
          const type = parts[i];
          const content = parts[i + 1]?.trim() ?? "";
          if (type === "CSS") cssCode = content;
          if (type === "HTML") htmlCode = content;
          if (type === "JS") jsCode = content;
        }
      }

      // Match exact wrapper structure & classes used in StudioView preview
      const noteSimWrapper = el.createDiv({
        cls: 'cds-preview-sim-root'
      });

      noteSimWrapper.style.setProperty('width', '100%', 'important');
      noteSimWrapper.style.setProperty('max-width', '100%', 'important');
      noteSimWrapper.style.setProperty('box-sizing', 'border-box', 'important');
      noteSimWrapper.innerHTML = htmlCode;

      // FIX: Inject CSS into document.head so Obsidian's markdown cache never wipes it on cold start
      const styleId = `cds-style-${ctx.docId || Math.random().toString(36).slice(2)}`;
      let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      styleEl.innerHTML = `
        .cds-preview-sim-root > * {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        ${cssCode}
      `;

      const cleanups: Array<() => void> = [
        () => styleEl?.remove()
      ];
      const app = this.app;
      let isDestroyed = false;

      // Bulletproof teardown hook (stops animation loops, timers, listeners, and audio)
      const triggerTeardown = () => {
        if (isDestroyed) return;
        isDestroyed = true;

        // 1. Stop all animation loops, timers, and unbind keyboard listeners
        cleanups.forEach(fn => { try { fn(); } catch(e) {} });

        // 2. Force-close global AudioContext immediately if active
        if ((window as any).__cds_audio_ctx) {
          try { (window as any).__cds_audio_ctx.close(); } catch(e) {}
          (window as any).__cds_audio_ctx = null;
        }
      };

      // Instantiate shared runtime helpers from runtime.ts
      const { db, $, $$ } = createRuntimeEnvironment({
        containerEl: noteSimWrapper,
        app,
        cleanups,
        isDestroyed: () => isDestroyed
      });

      const runCanvasViewJS = () => {
        if (isDestroyed) return;
        try {
          const dvApi = (app as any).plugins?.plugins?.dataview?.api;
          const dv = dvApi
            ? Object.assign(Object.create(dvApi), { container: noteSimWrapper })
            : null;

          const dataviewContext = {
            container: noteSimWrapper,
            app,
            dv,
            db
          };

          const executeFn = new Function(
            "container",
            "htmlContent",
            "app",
            "notice",
            "dv",
            "db",
            "$",
            "$$",
            jsCode
          );

          executeFn.call(
            dataviewContext,
            noteSimWrapper,
            htmlCode,
            app,
            (msg: string) => new Notice(msg),
            dv,
            db,
            $,
            $$
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

      // Execute script after Obsidian has finished painting the layout on startup
      requestAnimationFrame(() => {
        runCanvasViewJS();
      });

      ctx.addChild(new (class extends MarkdownRenderChild {
        constructor(containerEl: HTMLElement) { super(containerEl); }
        onunload() {
          triggerTeardown();
        }
      })(noteSimWrapper));
    });

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