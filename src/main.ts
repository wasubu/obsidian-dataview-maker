import { Plugin, Notice, MarkdownRenderChild, App, MarkdownView, TFile } from "obsidian";
import { StudioView, VIEW_TYPE_STUDIO } from "./view";
import { createRuntimeEnvironment } from "./db_api";

interface CanvasViewSession {
  persistentData: Record<string, any>;
  container: HTMLElement | null;
  teardownFn: (() => void) | null;
}

const canvasViewSessions = new Map<string, CanvasViewSession>();

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
  versions: {},
};

export default class CustomDatabaseStudioPlugin extends Plugin {
  data: StudioPluginData = DEFAULT_DATA;

  async onload() {
    await this.loadStudioData();

    this.registerView(
      VIEW_TYPE_STUDIO,
      (leaf) => new StudioView(leaf, this)
    );

    // Reading Mode code block processor
    this.registerMarkdownCodeBlockProcessor(
      "canvasview",
      (source, el, ctx) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const isEditing = activeView && activeView.getMode() !== 'preview';

        if (isEditing) {
          el.empty();
          const placeholder = el.createDiv({ cls: 'cds-edit-placeholder-line' });
          placeholder.textContent = '---advanceDB here---';
          placeholder.style.cssText = 'color: var(--text-faint); font-size: 0.8rem; font-family: var(--font-monospace); padding: 8px 16px; text-align: center; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 12px; user-select: none; display: block; margin: 6px 0;';
          return;
        }

        try {
          // Generate a unique session key for this specific block based on its line number
          const sectionInfo = ctx.getSectionInfo(el);
          const startLineNo = sectionInfo ? sectionInfo.lineStart : Math.random().toString(36).slice(2);
          const sessionKey = `${ctx.sourcePath}::line-${startLineNo}`;

          let session = canvasViewSessions.get(sessionKey);
          if (!session) {
            session = {
              persistentData: {},
              container: null,
              teardownFn: null,
            };
            canvasViewSessions.set(sessionKey, session);
          }

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

          const container = document.createElement("div");
          session.container = container;

          container.className = "cds-preview-sim-root";
          container.style.width = "100%";
          container.style.maxWidth = "100%";
          container.style.boxSizing = "border-box";

          container.addEventListener("mousedown", (event) => event.stopPropagation());
          container.addEventListener("click", (event) => event.stopPropagation());

          container.innerHTML = htmlCode;

          // Unique style element ID per block instance to prevent style collisions across multiple blocks
          const styleId = `cds-style-${Math.random().toString(36).slice(2)}`;
          const styleEl = document.createElement("style");
          styleEl.id = styleId;
          styleEl.textContent = `
            .cds-preview-sim-root > * {
              width: 100% !important;
              max-width: 100% !important;
              box-sizing: border-box !important;
            }
            ${cssCode}
          `;
          document.head.appendChild(styleEl);

          const cleanups: Array<() => void> = [() => styleEl.remove()];
          let isDestroyed = false;

          session.teardownFn = () => {
            if (isDestroyed) return;
            isDestroyed = true;
            cleanups.forEach((fn) => {
              try { fn(); } catch (error) {
                console.error("[canvasview] Cleanup error:", error);
              }
            });
          };

          const app = this.app;
          const { db, $,$$ } = createRuntimeEnvironment({
            containerEl: container,
            app,
            cleanups,
            isDestroyed: () => isDestroyed,
            persistentData: session.persistentData,
          });

          el.appendChild(container);

          const runCanvasViewJS = () => {
            if (isDestroyed) return;
            try {
              const dvApi = (app as any).plugins?.plugins?.dataview?.api;
              const dv = dvApi ? Object.assign(Object.create(dvApi), { container }) : null;

              const dataviewContext = {
                container,
                app,
                dv,
                db,
              };

              const executeFn = new Function(
                "container", "htmlContent", "app", "notice", "dv", "db", "$", "$$", jsCode
              );

              executeFn.call(
                dataviewContext,
                container,
                htmlCode,
                app,
                (message: string) => new Notice(message),
                dv,
                db,
                $,$$
              );
            } catch (error: any) {
              console.error("[canvasview] Runtime error:", error);
              const errDiv = container.createDiv({ cls: "cds-runtime-error" });
              errDiv.style.color = "var(--text-error)";
              errDiv.style.fontFamily = "var(--font-monospace)";
              errDiv.style.padding = "10px";
              errDiv.innerText = `Runtime Error: ${error.message}`;
            }
          };

          requestAnimationFrame(runCanvasViewJS);

          ctx.addChild(
            new (class extends MarkdownRenderChild {
              constructor(containerEl: HTMLElement) {
                super(containerEl);
              }
              onunload() {
                session?.teardownFn?.();
              }
            })(container)
          );
        } catch (error: any) {
          console.error("[canvasview] Critical initialization error:", error);
          el.empty();
          const errDiv = el.createDiv({ cls: "cds-init-error" });
          errDiv.style.color = "var(--text-error)";
          errDiv.style.fontFamily = "var(--font-monospace)";
          errDiv.style.padding = "10px";
          errDiv.innerText = `[canvasview] Failed to render block: ${error.message}`;
        }
      }
    );

    this.addRibbonIcon(
      "layout-template",
      "Open Database Studio",
      () => {
        this.activateView();
      }
    );

    this.addCommand({
      id: "open-database-studio",
      name: "Open Database Studio",
      callback: () => {
        this.activateView();
      },
    });
  }

  onunload() {
    canvasViewSessions.forEach((session) => {
      try { session.teardownFn?.(); } catch {}
    });
    canvasViewSessions.clear();
  }

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