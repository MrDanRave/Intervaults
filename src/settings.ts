import { App, PluginSettingTab, Setting } from "obsidian";
import * as path from "path";
import type IntervaultGraphPlugin from "./main";
import { VaultConfig } from "./index";

/** Intersection query functions. "meet" matches by vault count regardless of content. */
export type QueryFn = "diff" | "merge" | "meet";

/** A visibility filter, e.g. "Merged(2+)". Filters AND-combine; empty list = show all. */
export interface QueryRule {
  id: string;
  query: string;   // raw text, e.g. "Diff(2+)", "Meet(3-)", "Merged(*)"
}

/** A colouring group, e.g. "Diff(2+)" → colour. First match (top→down) wins. */
export interface GroupRule {
  id: string;
  query: string;
  color: string;
}

/** A named, editable COLOUR preset (line colours only; intersections are global). */
export interface Palette {
  id: string;
  name: string;
  colors: string[];                       // exactly 3 line colours (hex)
  vaultColors: Record<string, string>;    // per-vault line-colour override (THIS preset only)
  vaultStyles: Record<string, number>;    // per-vault line-type override (THIS preset only)
}

/** Purely-visual render parameters (never change how the graph is evaluated). */
export interface DisplaySettings {
  intersectionSize: number;        // dot radius (px), 2–10
  bowScale: number;                // braid amplitude multiplier, 0–2
  lineThickness: number;           // line-width multiplier, 0.5–2.5
  showIntersectionLabels: boolean; // grey note titles under dots
  fadeLabelsOnZoom: boolean;       // fade intersection labels as you zoom out
  fadeLabelAt: number;             // zoom level where labels reach full opacity (fade below this)
  showVaultLabels: boolean;        // vault name labels
}

export interface IntervaultSettings {
  vaultPaths: string[];
  palette: string;                       // selected preset id
  dimVaults: string[];                   // "lights off" vaults
  palettes: Palette[];                   // colour presets (defaults seeded + user)
  filters: QueryRule[];                  // GLOBAL intersection filters (independent of Theme)
  groups: GroupRule[];                   // GLOBAL intersection colour groups (independent of Theme)
  display: DisplaySettings;              // GLOBAL render parameters
}

const seed = (id: string, name: string, colors: string[]): Palette =>
  ({ id, name, colors, vaultColors: {}, vaultStyles: {} });

export const SEED_PALETTES: Palette[] = [
  seed("spy",    "Espion", ["#ffffff", "#000000", "#888888"]), // white, black, mid-grey (high contrast)
  seed("nature", "Nature", ["#5b4636", "#2e8b57", "#d8c9a3"]), // dark brown, emerald, sand beige
  seed("ice",    "Ice",    ["#a8d8ea", "#1f3a5f", "#2a6f97"]), // icy, dark, ocean blue
  seed("flame",  "Flame",  ["#e03b2f", "#ffcc00", "#f5f0e1"]), // fire red, DHL yellow, cream
  seed("magic",  "Magic",  ["#d6409f", "#6c4ce0", "#3a1a5e"]), // magenta, obsidian purple, dark violet
];

/** Deep-clone a palette (so presets never share mutable references). */
export function clonePalette(p: Palette): Palette {
  return {
    ...p,
    colors: [...p.colors],
    vaultColors: { ...p.vaultColors },
    vaultStyles: { ...p.vaultStyles },
  };
}

/** Default colouring groups: differing → yellow; merged across ALL vaults → grey. */
export function defaultGroups(): GroupRule[] {
  return [
    { id: "g1", query: "Diff(2+)", color: "#efe28a" },
    { id: "g2", query: "Merged(*)", color: "#5a5c63" },
  ];
}

/** Factory defaults for the visual parameters. */
export function defaultDisplay(): DisplaySettings {
  return {
    intersectionSize: 5,
    bowScale: 1,
    lineThickness: 1,
    showIntersectionLabels: true,
    fadeLabelsOnZoom: true,
    fadeLabelAt: 1.0,
    showVaultLabels: true,
  };
}

export const DEFAULT_SETTINGS: IntervaultSettings = {
  vaultPaths: [],
  palette: "spy",
  dimVaults: [],
  palettes: SEED_PALETTES.map(clonePalette),
  filters: [],
  groups: defaultGroups(),
  display: defaultDisplay(),
};

/** Derive VaultConfig[] (name = folder basename) from configured paths. */
export function toVaultConfigs(paths: string[]): VaultConfig[] {
  return paths
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => ({ name: path.basename(p.replace(/[\\/]+$/, "")), path: p }));
}

export class IntervaultSettingTab extends PluginSettingTab {
  plugin: IntervaultGraphPlugin;

  constructor(app: App, plugin: IntervaultGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Intervault Graph" });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Enter one absolute vault folder path per line. The folder name becomes the vault's display name and the name used to open it (obsidian://open?vault=NAME).",
    });

    new Setting(containerEl)
      .setName("Vault folder paths")
      .setDesc("One absolute path per line.")
      .addTextArea((ta) => {
        ta.setPlaceholder("C:\\Users\\you\\Vaults\\Work\nC:\\Users\\you\\Vaults\\Personal");
        ta.setValue(this.plugin.settings.vaultPaths.join("\n"));
        ta.inputEl.rows = 8;
        ta.inputEl.style.width = "100%";
        ta.onChange(async (value) => {
          this.plugin.settings.vaultPaths = value.split("\n");
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Open graph")
      .setDesc("Reads the configured folders (filenames only) and renders the graph.")
      .addButton((btn) =>
        btn.setButtonText("Open graph").setCta().onClick(() => this.plugin.openGraphView())
      );
  }
}
