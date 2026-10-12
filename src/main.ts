
import { Plugin, Notice, MarkdownRenderChild, App } from "obsidian";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type {
  DecorationSet,
  ViewUpdate,
} from "@codemirror/view";
import { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

import { StudioView, VIEW_TYPE_STUDIO } from "./view";
import { createRuntimeEnvironment } from "./db_api";

// ==========================================
// Data Types
// ==========================================

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

// ==========================================
// CodeMirror Widget for Edit Mode
// ==========================================

class CanvasViewWidget extends WidgetType {
  private teardownFn: (() => void) | null = null;

  constructor(
    readonly source: string,
    readonly app: any
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");

    container.className = "cds-preview-sim-root";
    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.boxSizing = "border-box";

    // Prevent mouse interactions from unnecessarily
    // propagating into the editor.
    container.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    container.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    // ------------------------------------------
    // Parse CSS, HTML, and JS sections
    // ------------------------------------------

    let cssCode = "";
    let htmlCode = "";
let jsCode = this.source.replace(
  /\n?(`{3,}|~{3,})[ \t]*$/,
  ""
);

    const parts = this.source.split(
      /\/\/\s*--- (CSS|HTML|JS) ---/
    );

    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i += 2) {
        const type = parts[i];
        const content = parts[i + 1]?.trim() ?? "";

        if (type === "CSS") cssCode = content;
        if (type === "HTML") htmlCode = content;
        if (type === "JS") jsCode = content;
      }
    }

    // Remove the closing Markdown fence from the extracted JS.
jsCode = jsCode.replace(/\s*(`{3,}|~{3,})\s*$/, "");

    container.innerHTML = htmlCode;

    // ------------------------------------------
    // Inject CSS
    // ------------------------------------------

    const styleId =
      `cds-style-${Math.random().toString(36).slice(2)}`;

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

    const cleanups: Array<() => void> = [
      () => styleEl.remove(),
    ];

    let isDestroyed = false;

    this.teardownFn = () => {
      if (isDestroyed) return;

      isDestroyed = true;

      cleanups.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          console.error(
            "[canvasview] Cleanup error:",
            error
          );
        }
      });

      const audioContext = (window as any).__cds_audio_ctx;

      if (audioContext) {
        try {
          void audioContext.close();
        } catch {
          // The audio context may already be closed.
        }

        (window as any).__cds_audio_ctx = null;
      }
    };

    // ------------------------------------------
    // Create runtime environment
    // ------------------------------------------

    const { db, $, $$ } = createRuntimeEnvironment({
      containerEl: container,
      app: this.app,
      cleanups,
      isDestroyed: () => isDestroyed,
    });

    // ------------------------------------------
    // Execute JavaScript
    // ------------------------------------------

    const runCanvasViewJS = () => {
      if (isDestroyed || !container.isConnected) return;

      try {
        console.log("[canvasview] JS length:", jsCode.length);
        console.log("[canvasview] JS source:\n", jsCode);
        const dvApi = (this.app as any)
          .plugins?.plugins?.dataview?.api;

        const dv = dvApi
          ? Object.assign(Object.create(dvApi), {
              container,
            })
          : null;

        const dataviewContext = {
          container,
          app: this.app,
          dv,
          db,
        };

        let executeFn: Function;

        try {
          executeFn = new Function(
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
        } catch (err) {
          console.error(
            "[canvasview] Compilation failed. Source length:",
            jsCode.length
          );
          console.error(
            "[canvasview] Source ending:",
            JSON.stringify(jsCode.slice(-300))
          );
          console.error(
            "[canvasview] Full failing source:",
            jsCode
          );
          throw err;
        }

        executeFn.call(
          dataviewContext,
          container,
          htmlCode,
          this.app,
          (message: string) => new Notice(message),
          dv,
          db,
          $,
          $$
        );
      } catch (error: any) {
        console.error(
          "[canvasview] Runtime error:",
          error
        );

        const errDiv = document.createElement("div");
        errDiv.className = "cds-runtime-error";
        errDiv.style.color = "var(--text-error)";
        errDiv.style.fontFamily = "var(--font-monospace)";
        errDiv.style.padding = "10px";
        errDiv.textContent =
          `Runtime Error: ${error.message}`;

        container.appendChild(errDiv);
      }
    };

    requestAnimationFrame(runCanvasViewJS);

    return container;
  }

  destroy(dom: HTMLElement): void {
    this.teardownFn?.();
    this.teardownFn = null;
  }

  eq(other: CanvasViewWidget): boolean {
    return this.source === other.source;
  }
}

// ==========================================
// CodeMirror ViewPlugin Factory
// ==========================================


function createCanvasViewPlugin(app: App) {
  const decorations = EditorView.decorations.compute(
    ["doc"],
    (state) => {
      const widgets: Range<Decoration>[] = [];
      const doc = state.doc;

      for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
        const line = doc.line(lineNo);

        const opening = line.text.match(
          /^(`{3,}|~{3,})[ \t]*canvasview(?:[ \t]+[^\r\n]*)?[ \t]*$/i
        );

        if (!opening) continue;

        const fence = opening[1];
        if (!fence) continue;

        const fenceChar = fence[0];
        const fenceLength = fence.length;

        const closingPattern =
          fenceChar === "`"
            ? new RegExp(
                "^[ \\t]*`{" + fenceLength + ",}[ \\t]*$"
              )
            : new RegExp(
                "^[ \\t]*~{" + fenceLength + ",}[ \\t]*$"
              );

        let closingLineNo = lineNo + 1;

        while (closingLineNo <= doc.lines) {
          if (closingPattern.test(doc.line(closingLineNo).text)) {
            break;
          }
          closingLineNo++;
        }

        if (closingLineNo > doc.lines) continue;

        const closingLine = doc.line(closingLineNo);

        // Replace the complete block, including both fence lines.
        const from = line.from;
        const to = closingLine.to;

        // Pass only the content between the opening and closing fences.
        const contentFrom = line.to < closingLine.from
          ? line.to + 1
          : line.to;
        const contentTo = closingLine.from;

        const source = doc.sliceString(contentFrom, contentTo);

        widgets.push(
          Decoration.replace({
            widget: new CanvasViewWidget(source, app),
            block: true,
          }).range(from, to)
        );

        lineNo = closingLineNo;
      }

      return Decoration.set(widgets, true);
    }
  );

  return decorations;
}


// ==========================================
// Main Plugin Class
// ==========================================

export default class CustomDatabaseStudioPlugin extends Plugin {
  data: StudioPluginData = DEFAULT_DATA;

  async onload() {
    await this.loadStudioData();

    this.registerView(
      VIEW_TYPE_STUDIO,
      (leaf) => new StudioView(leaf, this)
    );

    // ------------------------------------------
    // Register Edit Mode extension ONCE
    // ------------------------------------------

    const boundCanvasPlugin = createCanvasViewPlugin(this.app);
    this.registerEditorExtension(boundCanvasPlugin);


    // ------------------------------------------
    // Reading Mode code block processor
    // ------------------------------------------

    this.registerMarkdownCodeBlockProcessor(
      "canvasview",
      (source, el, ctx) => {
        try {
          let cssCode = "";
          let htmlCode = "";
          let jsCode = source;

          const parts = source.split(
            /\/\/\s*--- (CSS|HTML|JS) ---/
          );

          if (parts.length > 1) {
            for (let i = 1; i < parts.length; i += 2) {
              const type = parts[i];
              const content =
                parts[i + 1]?.trim() ?? "";

              if (type === "CSS") cssCode = content;
              if (type === "HTML") htmlCode = content;
              if (type === "JS") jsCode = content;
            }
          }

          const noteSimWrapper = el.createDiv({
            cls: "cds-preview-sim-root",
          });

          noteSimWrapper.style.setProperty(
            "width",
            "100%",
            "important"
          );

          noteSimWrapper.style.setProperty(
            "max-width",
            "100%",
            "important"
          );

          noteSimWrapper.style.setProperty(
            "box-sizing",
            "border-box",
            "important"
          );

          noteSimWrapper.innerHTML = htmlCode;

          // --------------------------------------
          // Inject styles
          // --------------------------------------

          const styleId =
            `cds-style-${ctx.docId || Math.random().toString(36).slice(2)}`;

          let styleEl = document.getElementById(
            styleId
          ) as HTMLStyleElement | null;

          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
          }

          styleEl.textContent = `
            .cds-preview-sim-root > * {
              width: 100% !important;
              max-width: 100% !important;
              box-sizing: border-box !important;
            }

            ${cssCode}
          `;

          const cleanups: Array<() => void> = [
            () => styleEl?.remove(),
          ];

          const app = this.app;
          let isDestroyed = false;

          // --------------------------------------
          // Teardown
          // --------------------------------------

          const triggerTeardown = () => {
            if (isDestroyed) return;

            isDestroyed = true;

            cleanups.forEach((fn) => {
              try {
                fn();
              } catch (error) {
                console.error(
                  "[canvasview] Cleanup error:",
                  error
                );
              }
            });

            const audioContext =
              (window as any).__cds_audio_ctx;

            if (audioContext) {
              try {
                void audioContext.close();
              } catch {
                // Already closed.
              }

              (window as any).__cds_audio_ctx = null;
            }
          };

          // --------------------------------------
          // Runtime environment
          // --------------------------------------

          const { db, $, $$ } =
            createRuntimeEnvironment({
              containerEl: noteSimWrapper,
              app,
              cleanups,
              isDestroyed: () => isDestroyed,
            });

          // --------------------------------------
          // Execute JavaScript
          // --------------------------------------

          const runCanvasViewJS = () => {
            if (isDestroyed) return;

            try {
              const dvApi = (app as any)
                .plugins?.plugins?.dataview?.api;

              const dv = dvApi
                ? Object.assign(
                    Object.create(dvApi),
                    { container: noteSimWrapper }
                  )
                : null;

              const dataviewContext = {
                container: noteSimWrapper,
                app,
                dv,
                db,
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
                (message: string) =>
                  new Notice(message),
                dv,
                db,
                $,
                $$
              );
            } catch (error: any) {
              console.error(
                "[canvasview] Runtime error:",
                error
              );

              const errDiv =
                noteSimWrapper.createDiv({
                  cls: "cds-runtime-error",
                });

              errDiv.style.color = "var(--text-error)";
              errDiv.style.fontFamily =
                "var(--font-monospace)";
              errDiv.style.padding = "10px";

              errDiv.innerText =
                `Runtime Error: ${error.message}`;
            }
          };

          requestAnimationFrame(runCanvasViewJS);

          // --------------------------------------
          // Lifecycle cleanup
          // --------------------------------------

          ctx.addChild(
            new (class extends MarkdownRenderChild {
              constructor(containerEl: HTMLElement) {
                super(containerEl);
              }

              onunload() {
                triggerTeardown();
              }
            })(noteSimWrapper)
          );
        } catch (error: any) {
          console.error(
            "[canvasview] Critical initialization error:",
            error
          );

          el.empty();

          const errDiv = el.createDiv({
            cls: "cds-init-error",
          });

          errDiv.style.color = "var(--text-error)";
          errDiv.style.fontFamily =
            "var(--font-monospace)";
          errDiv.style.padding = "10px";

          errDiv.innerText =
            `[canvasview] Failed to render block: ${error.message}`;
        }
      }
    );

    // ------------------------------------------
    // Ribbon icon
    // ------------------------------------------

    this.addRibbonIcon(
      "layout-template",
      "Open Database Studio",
      () => {
        this.activateView();
      }
    );

    // ------------------------------------------
    // Command
    // ------------------------------------------

    this.addCommand({
      id: "open-database-studio",
      name: "Open Database Studio",
      callback: () => {
        this.activateView();
      },
    });
  }

  onunload() {}

  async loadStudioData() {
    this.data = Object.assign(
      {},
      DEFAULT_DATA,
      await this.loadData()
    );
  }

  async saveStudioData() {
    await this.saveData(this.data);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(
      VIEW_TYPE_STUDIO
    )[0];

    if (!leaf) {
      leaf = workspace.getLeaf(false);

      await leaf.setViewState({
        type: VIEW_TYPE_STUDIO,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }
}
