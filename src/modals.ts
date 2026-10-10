import { App, Modal } from 'obsidian';

export class VersionPromptModal extends Modal {
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

export class ConfirmModal extends Modal {
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