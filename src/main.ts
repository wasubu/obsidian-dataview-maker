// main.ts
import { Plugin, Notice, MarkdownRenderChild } from 'obsidian';
import { StudioView, VIEW_TYPE_STUDIO } from './view';

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

    // Register the custom ```canvasview codeblock processor
    this.registerMarkdownCodeBlockProcessor("canvasview", (source, el, ctx) => {
      // 1. Clean & Robust Parsing via String Splitting
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

      // 2. Create Wrapper & Shadow DOM for 100% CSS & DOM Isolation
      const wrapper = el.createDiv({ cls: 'cds-canvasview-root' });
      const shadow = wrapper.attachShadow({ mode: 'open' });

      shadow.innerHTML = `
        <style>
          :host { display: block; width: 100%; box-sizing: border-box; }
          ${cssCode}
        </style>
        <div class="cds-shadow-content">${htmlCode}</div>
      `;

      const contentEl = shadow.querySelector('.cds-shadow-content') as HTMLElement;
      const cleanups: Array<() => void> = [];
      let audioCtx: AudioContext | null = null;

      // 3. Runtime Helpers (Scoped securely to this instance)
      const db = {
        onCleanup: (fn: () => void) => cleanups.push(fn),

        loop: (fn: (delta: number, time: number) => void) => {
          let rafId: number | null = null;
          let running = false;
          let lastTime: number | null = null;

          const frame = (time: number) => {
            if (!running) return;
            const delta = lastTime !== null ? (time - lastTime) : 0;
            lastTime = time;
            fn(delta, time);
            if (running) rafId = requestAnimationFrame(frame);
          };

          const ctrl = {
            start: () => { if (!running) { running = true; lastTime = null; rafId = requestAnimationFrame(frame); } return ctrl; },
            stop: () => { running = false; if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } return ctrl; },
            toggle: () => (running ? ctrl.stop() : ctrl.start()),
            get isRunning() { return running; }
          };
          cleanups.push(() => ctrl.stop());
          return ctrl;
        },

        canvas: (selector: string | HTMLCanvasElement) => {
          const canvasEl = (typeof selector === 'string' ? contentEl.querySelector(selector) : selector) as HTMLCanvasElement | null;
          if (!canvasEl || !(canvasEl instanceof HTMLCanvasElement)) return null;

          const ctx = canvasEl.getContext('2d');
          const dpr = window.devicePixelRatio || 1;
          const logicalWidth = canvasEl.clientWidth || canvasEl.width || 300;
          const logicalHeight = canvasEl.clientHeight || canvasEl.height || 150;
          const targetW = Math.round(logicalWidth * dpr);
          const targetH = Math.round(logicalHeight * dpr);

          if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
            canvasEl.width = targetW;
            canvasEl.height = targetH;
            canvasEl.style.width = `${logicalWidth}px`;
            canvasEl.style.height = `${logicalHeight}px`;
            if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr); }
          }

          return {
            canvas: canvasEl,
            ctx,
            width: logicalWidth,
            height: logicalHeight,
            clear: (color?: string) => {
              if (!ctx) return;
              if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, logicalWidth, logicalHeight); }
              else { ctx.clearRect(0, 0, logicalWidth, logicalHeight); }
            }
          };
        },

        onKey: (keys: string | string[] | ((e: KeyboardEvent) => void), fn?: (e: KeyboardEvent) => void, options?: boolean | AddEventListenerOptions) => {
          const targetFn = typeof keys === 'function' ? keys : fn!;
          const keyList = typeof keys === 'function' ? null : (Array.isArray(keys) ? keys.map(k => k.toLowerCase()) : [keys.toLowerCase()]);

          const handler = (e: KeyboardEvent) => {
            if (!wrapper.isConnected) return;
            if (!keyList || keyList.includes(e.key.toLowerCase()) || keyList.includes(e.code.toLowerCase())) {
              targetFn(e);
            }
          };

          window.addEventListener('keydown', handler, options);
          const unbind = () => window.removeEventListener('keydown', handler, options);
          cleanups.push(unbind);
          return unbind;
        },

        beep: (frequency = 440, duration = 0.1, type: OscillatorType = 'sine', volume = 0.1) => {
          try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioCtx();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const dur = duration > 10 ? duration / 1000 : duration;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
            gain.gain.setValueAtTime(volume, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + dur);
          } catch (e) {}
        },

        storage: (namespace = 'default') => {
          const prefix = `cds_${namespace}_`;
          return {
            get: <T = any>(key: string, defaultValue?: T): T => {
              try {
                const val = localStorage.getItem(prefix + key);
                return val === null ? (defaultValue as T) : JSON.parse(val);
              } catch (e) { return defaultValue as T; }
            },
            set: (key: string, value: any) => {
              try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) {}
            }
          };
        },

        notify: (msg: string, dur = 4000) => new Notice(msg, dur)
      };

      try {
        const dvApi = (this.app as any).plugins?.plugins?.dataview?.api;
        const executeFn = new Function('container', 'app', 'dv', 'db', '$', '$$', jsCode);
        const $ = (s: string) => contentEl.querySelector(s);
        const $$ = (s: string) => contentEl.querySelectorAll(s);

        executeFn.call({ container: contentEl }, contentEl, this.app, dvApi, db, $, $$);
      } catch (err: any) {
        contentEl.innerHTML = `<div style="color: var(--text-error); padding: 12px; font-family: monospace;">Runtime Error: ${err.message}</div>`;
      }

      // 4. Obsidian Native Lifecycle via MarkdownRenderChild
      ctx.addChild(new class extends MarkdownRenderChild {
        onunload() {
          cleanups.forEach(fn => { try { fn(); } catch(e) {} });
          if (audioCtx) {
            try { audioCtx.close(); } catch(e) {}
            audioCtx = null;
          }
        }
      }(wrapper));
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