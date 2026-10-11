// runtime.ts
import { App, Notice, TFile, EventRef } from 'obsidian';

export interface RuntimeOptions {
  containerEl: HTMLElement;
  app: App;
  cleanups: Array<() => void>;
  isDestroyed?: () => boolean;
}

export function createRuntimeEnvironment({ containerEl, app, cleanups, isDestroyed = () => false }: RuntimeOptions) {
  const $ = (sel: string) => containerEl.querySelector(sel);
  const $$ = (sel: string) => containerEl.querySelectorAll(sel);
  let audioCtx: AudioContext | null = null;

  const db = {
    onCleanup: (fn: () => void) => cleanups.push(fn),

    loop: (fn: (deltaTime: number, timestamp: number) => void) => {
      let rafId: number | null = null;
      let running = false;
      let lastTime: number | null = null;

      const frame = (time: number) => {
        if (!running || isDestroyed()) {
          rafId = null;
          return;
        }
        const delta = lastTime !== null ? time - lastTime : 0;
        lastTime = time;
        rafId = null;

        try {
          fn(delta, time);
        } catch (error) {
          console.error("[CDS] Animation loop crashed; stopped safely:", error);
          running = false;
          lastTime = null;
          return;
        }

        if (running && !isDestroyed()) {
          rafId = requestAnimationFrame(frame);
        }
      };

      const start = () => {
        if (running || isDestroyed()) return controller;
        running = true;
        lastTime = null;
        rafId = requestAnimationFrame(frame);
        return controller;
      };

      const stop = () => {
        running = false;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        return controller;
      };

      const controller = {
        start,
        stop,
        toggle: () => (running ? stop() : start()),
        get isRunning() { return running; }
      };

      cleanups.push(() => stop());
      return controller;
    },

    canvas: (selector: string | HTMLCanvasElement) => {
      const canvasEl = (typeof selector === 'string' ? containerEl.querySelector(selector) : selector) as HTMLCanvasElement | null;
      if (!canvasEl || !(canvasEl instanceof HTMLCanvasElement)) return null;

      const ctx = canvasEl.getContext('2d');
      const dpr = window.devicePixelRatio || 1;

      const logicalWidth = parseInt(canvasEl.getAttribute('width') || '', 10) || canvasEl.clientWidth || 300;
      const logicalHeight = parseInt(canvasEl.getAttribute('height') || '', 10) || canvasEl.clientHeight || 150;

      if (!canvasEl.dataset.initialized) {
        canvasEl.width = logicalWidth * dpr;
        canvasEl.height = logicalHeight * dpr;
        canvasEl.style.width = '100%';
        canvasEl.style.height = 'auto';
        canvasEl.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;
        canvasEl.style.maxWidth = '100%';
        canvasEl.style.display = 'block';
        if (ctx) ctx.scale(dpr, dpr);
        canvasEl.dataset.initialized = "true";
      }

      return {
        canvas: canvasEl,
        ctx,
        width: logicalWidth,
        height: logicalHeight,
        clear: (color?: string) => {
          if (!ctx) return;
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, logicalWidth, logicalHeight);
          } else {
            ctx.clearRect(0, 0, logicalWidth, logicalHeight);
          }
        }
      };
    },

    onKey: (keys: string | string[] | ((e: KeyboardEvent) => void), fn?: (e: KeyboardEvent) => void, options?: boolean | AddEventListenerOptions) => {
      let targetFn: (e: KeyboardEvent) => void;
      let keyList: string[] | null = null;

      if (typeof keys === 'function') {
        targetFn = keys;
      } else {
        targetFn = fn!;
        keyList = Array.isArray(keys) ? keys.map(k => k.toLowerCase()) : [keys.toLowerCase()];
      }

      const handler = (e: KeyboardEvent) => {
        if (isDestroyed() || !containerEl.isConnected) return;
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
      if (isDestroyed()) return;
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
            if (val === null) return defaultValue as T;
            return JSON.parse(val);
          } catch (e) {
            return defaultValue as T;
          }
        },
        set: (key: string, value: any) => {
          try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch (e) {}
        },
        remove: (key: string) => {
          try { localStorage.removeItem(prefix + key); } catch (e) {}
        },
        clear: () => {
          try {
            const keys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix)) keys.push(k);
            }
            keys.forEach(k => localStorage.removeItem(k));
          } catch (e) {}
        }
      };
    },

    timer: (intervalMs: number, fn: () => void) => {
      let timerId: any = null;
      let running = false;

      const start = () => {
        if (running || isDestroyed()) return ctrl;
        running = true;
        timerId = setInterval(fn, intervalMs);
        return ctrl;
      };

      const stop = () => {
        running = false;
        if (timerId) { clearInterval(timerId); timerId = null; }
        return ctrl;
      };

      const ctrl = {
        start,
        stop,
        toggle: () => (running ? stop() : start()),
        get isRunning() { return running; }
      };

      cleanups.push(() => stop());
      return ctrl;
    },

    state: <T>(initial: T, onChange?: (val: T) => void) => {
      let current = initial;
      const listeners: Array<(val: T) => void> = [];
      if (onChange) listeners.push(onChange);

      return {
        get val() { return current; },
        set val(next: T) {
          if (isDestroyed()) return;
          current = next;
          listeners.forEach(fn => fn(current));
        },
        update: (updater: (prev: T) => T) => {
          if (isDestroyed()) return current;
          current = updater(current);
          listeners.forEach(fn => fn(current));
          return current;
        },
        subscribe: (fn: (val: T) => void) => {
          listeners.push(fn);
          fn(current);
        }
      };
    },

    modal: (title: string, renderFn: (bodyEl: HTMLElement, close: () => void) => void) => {
      if (isDestroyed()) return { close: () => {}, el: document.createElement("div") };
      const backdrop = document.createElement("div");
      backdrop.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;";

      const modalEl = document.createElement("div");
      modalEl.style.cssText = "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;font-family:var(--font-interface);color:var(--text-normal);";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--background-modifier-border);font-weight:600;font-size:1rem;";
      header.innerText = title;

      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.cssText = "background:transparent;border:none;outline:none;box-shadow:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;padding:2px 6px;border-radius:4px;";
      
      const close = () => { backdrop.remove(); };
      closeBtn.onclick = close;
      backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
      header.appendChild(closeBtn);
      modalEl.appendChild(header);

      const bodyEl = document.createElement("div");
      bodyEl.style.cssText = "padding:16px;overflow-y:auto;flex:1;";
      modalEl.appendChild(bodyEl);

      backdrop.appendChild(modalEl);
      document.body.appendChild(backdrop);

      cleanups.push(close);
      renderFn(bodyEl, close);
      return { close, el: modalEl };
    },

    drag: (target: HTMLElement | string, onMove: (dx: number, dy: number, e: PointerEvent) => void, onEnd?: () => void) => {
      const el = typeof target === 'string' ? containerEl.querySelector(target) as HTMLElement : target;
      if (!el || isDestroyed()) return;

      let startX = 0, startY = 0;
      const moveHandler = (e: PointerEvent) => { if (!isDestroyed()) onMove(e.clientX - startX, e.clientY - startY, e); };
      const upHandler = () => {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
        if (onEnd && !isDestroyed()) onEnd();
      };
      const downHandler = (e: PointerEvent) => {
        if (!isDestroyed()) {
          startX = e.clientX;
          startY = e.clientY;
          window.addEventListener('pointermove', moveHandler);
          window.addEventListener('pointerup', upHandler);
        }
      };

      el.addEventListener('pointerdown', downHandler);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', downHandler);
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerup', upHandler);
      });
    },

    notify: (msg: string, timeout = 4000) => { if (!isDestroyed()) new Notice(msg, timeout); },

    onVaultChange: (fn: (file: TFile) => void) => {
      if (isDestroyed()) return () => {};
      const ref: EventRef = app.vault.on('modify', (file) => {
        if (!isDestroyed() && file instanceof TFile) fn(file);
      });
      cleanups.push(() => app.vault.offref(ref));
      return () => app.vault.offref(ref);
    },

    increment: async (path: string, prop: string, by = 1): Promise<boolean> => {
      return db.updateNote(path, (fm) => { fm[prop] = (Number(fm[prop]) || 0) + by; });
    },

    toggleProp: async (path: string, prop: string): Promise<boolean> => {
      return db.updateNote(path, (fm) => { fm[prop] = !fm[prop]; });
    },

    query: (source: string, fallback: any[] = []): any[] => {
      if (isDestroyed()) return fallback;
      try {
        const dv = (app as any).plugins?.plugins?.dataview?.api;
        if (dv && dv.pages) {
          const pages = dv.pages(source);
          if (pages && pages.length > 0) {
            return pages.map((p: any) => ({
              ...p,
              path: p.file?.path || '#',
              name: p.file?.name || '',
              basename: p.file?.basename || '',
              tags: p.file?.tags || []
            })).values;
          }
        }
      } catch (e) {}
      return fallback;
    },

    openNote: (path: string) => {
      if (isDestroyed() || !path || path === '#') return;
      app.workspace.openLinkText(path, "", false);
    },

    createNote: async (opts: { 
      folder?: string; 
      name?: string; 
      title?: string;
      frontmatter?: Record<string, any>; 
      content?: string; 
      open?: boolean 
    }): Promise<TFile | null> => {
      if (isDestroyed()) return null;
      const folder = opts.folder ? opts.folder.replace(/^\/+|\/+$/g, '') : "";
      const baseName = opts.name || opts.title || opts.frontmatter?.title || opts.frontmatter?.name || "Untitled";
      try {
        if (folder && !app.vault.getAbstractFileByPath(folder)) {
          await app.vault.createFolder(folder);
        }
        let filePath = folder ? `${folder}/${baseName}.md` : `${baseName}.md`;
        let counter = 1;
        while (app.vault.getAbstractFileByPath(filePath)) {
          filePath = folder ? `${folder}/${baseName} ${counter}.md` : `${baseName} ${counter}.md`;
          counter++;
        }

        let yaml = "";
        if (opts.frontmatter) {
          yaml = "---\n" + Object.entries(opts.frontmatter)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join("\n") + "\n---\n\n";
        }
        const body = opts.content || `# ${baseName}\n\n`;
        const file = await app.vault.create(filePath, yaml + body);
        if (opts.open !== false) await app.workspace.getLeaf().openFile(file);
        return file;
      } catch (err: any) {
        return null;
      }
    },

    updateNote: (() => {
      const queues = new Map<string, Promise<any>>();
      return async (fileOrPath: TFile | string, updater: (frontmatter: Record<string, any>) => void): Promise<boolean> => {
        if (isDestroyed()) return false;
        const file = typeof fileOrPath === 'string' 
          ? app.vault.getAbstractFileByPath(fileOrPath) 
          : fileOrPath;
          
        if (!(file instanceof TFile)) return false;

        const path = file.path;
        const prev = queues.get(path) || Promise.resolve();
        const current = prev.then(async () => {
          try {
            await app.fileManager.processFrontMatter(file, updater);
            return true;
          } catch (err: any) {
            return false;
          }
        });
        queues.set(path, current);
        return current;
      };
    })(),

    renderList: (selector: string, items: any[], templateFn: (item: any) => string, emptyHtml = '<div class="cds-empty">No items found</div>') => {
      if (isDestroyed()) return;
      const target = containerEl.querySelector(selector);
      if (!target) return;
      if (!items || items.length === 0) {
        target.innerHTML = emptyHtml;
        return;
      }
      target.innerHTML = items.map(templateFn).join("");
    },

    bindFilter: (selector: string, options: string[], onSelect: (selected: string) => void) => {
      if (isDestroyed()) return;
      const bar = containerEl.querySelector(selector);
      if (!bar) return;
      bar.innerHTML = "";
      let active = options[0] || "All";

      options.forEach(opt => {
        const btn = document.createElement("button");
        btn.className = `filter-btn ${opt === active ? "active" : ""}`;
        btn.innerText = opt;
        btn.onclick = () => {
          if (!isDestroyed()) {
            active = opt;
            bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            onSelect(opt);
          }
        };
        bar.appendChild(btn);
      });
      onSelect(active);
    }
  };

  return { db, $, $$ };
}