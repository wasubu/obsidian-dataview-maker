// main.ts - do not modify or delete
import { Plugin } from 'obsidian';
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