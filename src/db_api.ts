// db_api.ts
import { App, Notice, TFile, EventRef, MarkdownRenderer, Component } from 'obsidian';

export interface RuntimeOptions {
  containerEl: HTMLElement;
  app: App;
  cleanups: Array<() => void>;
  isDestroyed?: () => boolean;
}

export function createRuntimeEnvironment({ containerEl, app, cleanups, isDestroyed = () => false }: RuntimeOptions) {
  const $ = (sel: string) => containerEl.querySelector(sel);   const $$ = (sel: string) => containerEl.querySelectorAll(sel);
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
        if (isDestroyed() || !containerEl.isConnected || containerEl.offsetParent === null) return;
        if (!keyList || keyList.includes(e.key.toLowerCase()) || keyList.includes(e.code.toLowerCase())) {
          targetFn(e);
        }
      };

      window.addEventListener('keydown', handler, options);
      const unbind = () => window.removeEventListener('keydown', handler, options);
      cleanups.push(unbind);
      return unbind;
    },

    onKeyUp: (keys: string | string[] | ((e: KeyboardEvent) => void), fn?: (e: KeyboardEvent) => void, options?: boolean | AddEventListenerOptions) => {
      let targetFn: (e: KeyboardEvent) => void;
      let keyList: string[] | null = null;

      if (typeof keys === 'function') {
        targetFn = keys;
      } else {
        targetFn = fn!;
        keyList = Array.isArray(keys) ? keys.map(k => k.toLowerCase()) : [keys.toLowerCase()];
      }

      const handler = (e: KeyboardEvent) => {
        if (isDestroyed() || !containerEl.isConnected || containerEl.offsetParent === null) return;
        if (!keyList || keyList.includes(e.key.toLowerCase()) || keyList.includes(e.code.toLowerCase())) {
          targetFn(e);
        }
      };

      window.addEventListener('keyup', handler, options);
      const unbind = () => window.removeEventListener('keyup', handler, options);
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
      
      // 1. Try Dataview API first
      try {
        const dv = (app as any).plugins?.plugins?.dataview?.api;
        if (dv && dv.pages) {
          const pages = dv.pages(source);
          if (pages && pages.length > 0) {
            const arr = typeof pages.array === 'function' ? pages.array() : Array.from(pages);
            return arr.map((p: any) => ({
              ...p,
              path: p.file?.path || p.path || '#',
              name: p.file?.name || p.name || '',
              basename: p.file?.basename || p.basename || '',
              tags: p.file?.tags || p.tags || []
            }));
          }
        }
      } catch (e) {}

      // 2. Native Obsidian Vault Fallback (Supports empty string "" to return all notes)
      try {
        const cleanSource = source.replace(/['"]/g, '').trim();
        const files = app.vault.getMarkdownFiles();
        
        const matchingFiles = cleanSource === '' 
          ? files 
          : files.filter(f => f.path.startsWith(cleanSource + '/') || f.path === cleanSource + '.md' || f.basename.toLowerCase().includes(cleanSource.toLowerCase()));
        
        if (matchingFiles.length > 0) {
          return matchingFiles.map(file => {
            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            return {
              ...fm,
              file: {
                path: file.path,
                name: file.name,
                basename: file.basename,
                tags: cache?.tags?.map((t: any) => t.tag) || []
              },
              path: file.path,
              name: file.name,
              basename: file.basename,
              tags: cache?.tags?.map((t: any) => t.tag) || []
            };
          });
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

    copyToClipboard: async (text: string): Promise<boolean> => {
      if (isDestroyed()) return false;
      try {
        await navigator.clipboard.writeText(text);
        db.notify("Copied to clipboard!");
        return true;
      } catch (e) {
        db.notify("Failed to copy to clipboard");
        return false;
      }
    },

    debounce: <T extends (...args: any[]) => void>(fn: T, delayMs = 300): ((...args: Parameters<T>) => void) => {
      let timeoutId: any = null;
      const debounced = (...args: Parameters<T>) => {
        if (isDestroyed()) return;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delayMs);
      };
      cleanups.push(() => clearTimeout(timeoutId));
      return debounced;
    },

    readNote: async (path: string): Promise<string | null> => {
      if (isDestroyed()) return null;
      try {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          return await app.vault.read(file);
        }
      } catch (e) {}
      return null;
    },

    confetti: (x?: number, y?: number, type: 'burst' | 'fireworks' | 'fountain' | 'shockwave' = 'burst') => {
      if (isDestroyed()) return;

      const startX = x !== undefined ? x : window.innerWidth / 2;
      const startY = y !== undefined ? y : window.innerHeight / 2;
      const colors = ['#bc85ffff', '#6aa2fdff', '#8bf581ff', '#ffdc91ff', '#ff729aff'];

      if (type === 'fountain') {
        const count = 45;
        for (let i = 0; i < count; i++) {
          const p = document.createElement('div');
          p.style.cssText = `
            position: fixed;
            left: ${startX}px;
            top: ${startY}px;
            width: 7px;
            height: 7px;
            background-color: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: 50%;
            pointer-events: none;
            z-index: 999999;
            transform: translate(0px, 0px) scale(1);
            opacity: 1;
            transition: transform 1s cubic-bezier(0, 0.8, 0.2, 1), opacity 1s ease;
          `;
          document.body.appendChild(p);

          const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
          const speed = 70 + Math.random() * 80;
          const targetX = Math.cos(angle) * speed;
          const targetY = Math.sin(angle) * speed - 50;

          setTimeout(() => {
            if (isDestroyed()) return;
            p.style.transform = `translate(${targetX}px, ${targetY}px) scale(${0.3 + Math.random()})`;
            p.style.opacity = '0';
          }, 20);

          setTimeout(() => p.remove(), 1000);
        }
      } else if (type === 'fireworks') {
        const p = document.createElement('div');
        p.style.cssText = `
          position: fixed;
          left: ${startX}px;
          top: ${window.innerHeight}px;
          width: 6px;
          height: 6px;
          background-color: #ff9683ff;
          border-radius: 50%;
          pointer-events: none;
          z-index: 999999;
          transition: transform 0.6s ease-out, opacity 0.6s ease;
        `;
        document.body.appendChild(p);

        setTimeout(() => {
          if (isDestroyed()) return;
          const riseDist = window.innerHeight - startY;
          p.style.transform = `translate(0px, -${riseDist}px)`;
        }, 20);

        setTimeout(() => {
          if (isDestroyed()) return;
          p.remove();
          db.confetti(startX, startY, 'burst');
          db.beep(700, 0.1, 'sine', 0.1);
        }, 600);
      } else {
        const particleCount = 50;
        for (let i = 0; i < particleCount; i++) {
          const p = document.createElement('div');
          p.style.cssText = `
            position: fixed;
            left: ${startX}px;
            top: ${startY}px;
            width: 8px;
            height: 8px;
            background-color: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: 50%;
            pointer-events: none;
            z-index: 999999;
            transform: translate(0px, 0px) scale(1);
            opacity: 1;
            transition: transform 0.8s cubic-bezier(0.1, 1, 0.1, 1), opacity 0.8s ease;
          `;
          document.body.appendChild(p);

          const angle = Math.random() * Math.PI * 2;
          const speed = 60 + Math.random() * 120;
          const targetX = Math.cos(angle) * speed;
          const targetY = Math.sin(angle) * speed;

          setTimeout(() => {
            if (isDestroyed()) return;
            p.style.transform = `translate(${targetX}px, ${targetY}px) scale(${0.4 + Math.random()})`;
            p.style.opacity = '0';
          }, 20);

          setTimeout(() => p.remove(), 900);
        }
      }
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
    },

    // --- NEW IMPLEMENTED METHODS ---

    selectPrompt: (title: string, options: Array<string | { label: string; value: any }>, callback: (selected: any) => void) => {
      if (isDestroyed()) return;
      db.modal(title, (bodyEl, closeFn) => {
        bodyEl.style.cssText = "padding: 8px 0; overflow-y: auto; max-height: 60vh;";
        const listEl = document.createElement("div");
        listEl.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
        
        options.forEach(opt => {
          const label = typeof opt === 'string' ? opt : opt.label;
          const val = typeof opt === 'string' ? opt : opt.value;
          
          const itemEl = document.createElement("div");
          itemEl.innerText = label;
          itemEl.style.cssText = "padding: 10px 16px; cursor: pointer; border-radius: 4px; font-size: 0.95rem; color: var(--text-normal); transition: background 0.1s;";
          itemEl.onmouseenter = () => itemEl.style.background = "var(--background-modifier-hover)";
          itemEl.onmouseleave = () => itemEl.style.background = "transparent";
          itemEl.onclick = () => {
            if (!isDestroyed()) {
              closeFn();
              callback(val);
            }
          };
          listEl.appendChild(itemEl);
        });
        bodyEl.appendChild(listEl);
      });
    },

    addTag: async (fileOrPath: TFile | string, tag: string): Promise<boolean> => {
      if (isDestroyed()) return false;
      const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
      return db.updateNote(fileOrPath, (fm) => {
        if (!fm.tags) {
          fm.tags = [cleanTag];
        } else if (Array.isArray(fm.tags)) {
          if (!fm.tags.includes(cleanTag)) {
            fm.tags.push(cleanTag);
          }
        } else if (typeof fm.tags === 'string') {
          const existing = fm.tags.split(',').map((s: string) => s.trim());
          if (!existing.includes(cleanTag)) {
            existing.push(cleanTag);
            fm.tags = existing;
          }
        }
      });
    },

    toggleFullscreen: (selector?: string | HTMLElement, title = "Fullscreen View"): void => {
      if (isDestroyed()) return;

      let activeBackdrop: HTMLElement | null = (db as any)._fullscreenBackdrop || null;
      let originalParent: HTMLElement | null = (db as any)._fullscreenParent || null;
      let originalNextSibling: ChildNode | null = (db as any)._fullscreenSibling || null;
      let savedTargetEl: HTMLElement | null = (db as any)._fullscreenTarget || null;

      if (activeBackdrop) {
        if (savedTargetEl && originalParent) {
          if (originalNextSibling) {
            originalParent.insertBefore(savedTargetEl, originalNextSibling);
          } else {
            originalParent.appendChild(savedTargetEl);
          }
        }
        activeBackdrop.remove();
        (db as any)._fullscreenBackdrop = null;
        (db as any)._fullscreenParent = null;
        (db as any)._fullscreenSibling = null;
        (db as any)._fullscreenTarget = null;
        return;
      }

      const el = !selector 
        ? containerEl 
        : (typeof selector === 'string' ? containerEl.querySelector(selector) || document.querySelector(selector) : selector) as HTMLElement;
      
      if (!el) return;

      (db as any)._fullscreenTarget = el;
      (db as any)._fullscreenParent = el.parentElement;
      (db as any)._fullscreenSibling = el.nextSibling;

      const backdrop = document.createElement("div");
      backdrop.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;";

      const modalEl = document.createElement("div");
      modalEl.style.cssText = "background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:95vw;max-width:1200px;height:90vh;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;font-family:var(--font-interface);color:var(--text-normal);";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--background-modifier-border);font-weight:600;font-size:1rem;";
      header.innerText = title;

      const closeBtn = document.createElement("button");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.cssText = "background:transparent;border:none;outline:none;box-shadow:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;padding:2px 6px;border-radius:4px;";
      
      const close = () => {
        const target = (db as any)._fullscreenTarget;
        const parent = (db as any)._fullscreenParent;
        const sibling = (db as any)._fullscreenSibling;

        if (target && parent) {
          if (sibling) {
            parent.insertBefore(target, sibling);
          } else {
            parent.appendChild(target);
          }
        }
        backdrop.remove();
        (db as any)._fullscreenBackdrop = null;
        (db as any)._fullscreenParent = null;
        (db as any)._fullscreenSibling = null;
        (db as any)._fullscreenTarget = null;
      };

      closeBtn.onclick = close;
      backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
      header.appendChild(closeBtn);
      modalEl.appendChild(header);

      const bodyEl = document.createElement("div");
      bodyEl.style.cssText = "padding:16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;";
      bodyEl.appendChild(el);
      modalEl.appendChild(bodyEl);

      backdrop.appendChild(modalEl);
      document.body.appendChild(backdrop);
      
      (db as any)._fullscreenBackdrop = backdrop;

      cleanups.push(() => {
        if ((db as any)._fullscreenBackdrop) close();
      });
    },

    searchVaultText: async (keyword: string): Promise<Array<{ path: string; name: string; basename: string; snippet: string }>> => {
      if (isDestroyed() || !keyword) return [];
      const results: Array<{ path: string; name: string; basename: string; snippet: string }> = [];
      const files = app.vault.getMarkdownFiles();
      const lowerKeyword = keyword.toLowerCase();

      for (const file of files) {
        if (isDestroyed()) break;
        try {
          const content = await app.vault.cachedRead(file);
          const lowerContent = content.toLowerCase();
          let index = lowerContent.indexOf(lowerKeyword);
          
          if (index !== -1) {
            const start = Math.max(0, index - 40);
            const end = Math.min(content.length, index + keyword.length + 40);
            let snippet = content.substring(start, end).replace(/\n/g, ' ');
            if (start > 0) snippet = '...' + snippet;
            if (end < content.length) snippet = snippet + '...';

            results.push({
              path: file.path,
              name: file.name,
              basename: file.basename,
              snippet
            });
          }
        } catch (e) {}
      }
      return results;
    },

markdownToHtml: async (
  markdownText: string,
  targetEl: HTMLElement
): Promise<void> => {
  if (isDestroyed() || !targetEl) return;

  const renders = (db as any)._markdownRenders as
    | WeakMap<HTMLElement, { component: Component; id: number }>
    | undefined;

  const renderMap =
    renders ??
    new WeakMap<HTMLElement, { component: Component; id: number }>();

  (db as any)._markdownRenders = renderMap;

  // Invalidate and unload any previous render for this target.
  const previous = renderMap.get(targetEl);
  if (previous) {
    renderMap.delete(targetEl);
    previous.component.unload();
  }

  const component = new Component();
  component.load();

  const id = Date.now() + Math.random();
  renderMap.set(targetEl, { component, id });

  const stagingEl = document.createElement("div");

  const isCurrentRender = () => {
    const current = renderMap.get(targetEl);
    return (
      !isDestroyed() &&
      targetEl.isConnected &&
      current?.id === id
    );
  };

  const sourcePath =
    app.workspace.getActiveFile()?.path ?? "";

  try {
    await MarkdownRenderer.render(
      app,
      markdownText,
      stagingEl,
      sourcePath,
      component
    );

    if (!isCurrentRender()) {
      component.unload();
      return;
    }

    targetEl.classList.add("cds-markdown-preview");

    // Replace the previous rendered Markdown.
    targetEl.replaceChildren(...Array.from(stagingEl.childNodes));

    // Inject styles scoped exclusively to this preview.
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      .cds-markdown-preview {
        white-space: normal;
        min-width: 0;
        box-sizing: border-box;
      }

      .cds-markdown-preview :is(
        h1, h2, h3, h4, h5, h6,
        p, ul, ol, li, blockquote, td, th
      ) {
        white-space: normal;
      }

      .cds-markdown-preview :is(
        h1, h2, h3, h4, h5, h6
      ) {
        line-height: 1.2;
        margin-block: 0;
      }
    `;

    targetEl.appendChild(styleEl);
  } catch (error) {
    component.unload();

    if (isCurrentRender()) {
      console.error("[CDS] Markdown rendering failed:", error);
      targetEl.replaceChildren();
    }

    return;
  }

  // Register lifecycle cleanup.
  cleanups.push(() => {
    const current = renderMap.get(targetEl);

    if (current?.id === id) {
      renderMap.delete(targetEl);
      component.unload();
      targetEl.replaceChildren();
    } else {
      component.unload();
    }
  });
},



    // 6. Spawns a lightweight single-input popup modal to gather text input
    prompt: (title: string, placeholder = "", callback: (value: string) => void) => {
      if (isDestroyed()) return;
      db.modal(title, (bodyEl, closeFn) => {
        bodyEl.style.cssText = "padding: 16px; display: flex; flex-direction: column; gap: 12px;";
        
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = placeholder;
        input.style.cssText = "width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary-alt); color: var(--text-normal); font-size: 0.95rem; outline: none;";
        
        const btnContainer = document.createElement("div");
        btnContainer.style.cssText = "display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;";
        
        const cancelBtn = document.createElement("button");
        cancelBtn.innerText = "Cancel";
        cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-normal); cursor: pointer; font-size: 0.9rem;";
        cancelBtn.onclick = () => closeFn();
        
        const submitBtn = document.createElement("button");
        submitBtn.innerText = "Confirm";
        submitBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; border: none; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer; font-size: 0.9rem; font-weight: 500;";
        
        const submit = () => {
          if (!isDestroyed()) {
            const val = input.value;
            closeFn();
            callback(val);
          }
        };
        
        submitBtn.onclick = submit;
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        };
        
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(submitBtn);
        bodyEl.appendChild(input);
        bodyEl.appendChild(btnContainer);
        
        setTimeout(() => input.focus(), 50);
      });
    },

    // 7. Fetches the entire frontmatter metadata dictionary for a specific vault note
    getFrontmatter: (path: string): Record<string, any> => {
      if (isDestroyed() || !path) return {};
      try {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          const cache = app.metadataCache.getFileCache(file);
          return cache?.frontmatter || {};
        }
      } catch (e) {}
      return {};
    },

    // 8. Safely moves a specified markdown note to the Obsidian vault trash folder
    deleteNote: async (path: string): Promise<boolean> => {
      if (isDestroyed() || !path) return false;
      try {
        const file = app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await app.vault.trash(file, true);
          db.notify(`Moved to trash: ${file.basename}`);
          return true;
        }
      } catch (err: any) {
        db.notify(`Failed to delete note: ${err.message}`);
      }
      return false;
    }
  };

  return { db, $,$$ };
}