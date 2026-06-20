import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  GroupRule,
  IntervaultSettings,
  IntervaultSettingTab,
  Palette,
  QueryRule,
  SEED_PALETTES,
  clonePalette,
  defaultDisplay,
  defaultGroups,
} from "./settings";
import { GRAPH_VIEW_TYPE, GraphView } from "./view";

/** Coerce any stored palette (possibly from an older schema) into the current shape. */
function normalizePalette(p: Partial<Palette> & { id?: string }, i: number): Palette {
  const colors = Array.isArray(p.colors) && p.colors.length >= 3
    ? [p.colors[0], p.colors[1], p.colors[2]]
    : ["#888888", "#aaaaaa", "#dddddd"];
  return {
    id: p.id ?? `p${i}`,
    name: p.name ?? `Preset ${i + 1}`,
    colors,
    vaultColors: p.vaultColors ?? {},
    vaultStyles: p.vaultStyles ?? {},
  };
}

/** Migrate legacy per-palette merged/diff/rules into the new GLOBAL colour groups.
 *  Returns null when there's nothing to migrate (caller falls back to defaults). */
function migrateGroups(raw: Record<string, unknown> | null): GroupRule[] | null {
  if (!raw || !Array.isArray(raw.palettes)) return null;
  const pals = raw.palettes as Array<Record<string, unknown>>;
  const sel = pals.find((p) => p.id === raw.palette) ?? pals[0];
  if (!sel) return null;
  const groups: GroupRule[] = [];
  if (typeof sel.diff === "string") groups.push({ id: "g1", query: "Diff(2+)", color: sel.diff });
  if (typeof sel.merged === "string") groups.push({ id: "g2", query: "Merged(*)", color: sel.merged });
  if (Array.isArray(sel.rules)) {
    (sel.rules as Array<Record<string, unknown>>).forEach((r, i) => {
      const t = (r.type as string) ?? ((r.differs as boolean) ? "diff" : "merge");
      const fn = t === "cut" ? "Meet" : t === "merge" ? "Merged" : "Diff";
      const v = (r.vaults as number) ?? 0;
      const tok = !v ? "2+" : String(v); // legacy vaults:0 ("any") → "2+"
      groups.push({ id: `gr${i}`, query: `${fn}(${tok})`, color: (r.color as string) ?? "#888888" });
    });
  }
  return groups.length ? groups : null;
}

export default class IntervaultGraphPlugin extends Plugin {
  settings: IntervaultSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new IntervaultSettingTab(this.app, this));

    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));

    this.addCommand({
      id: "open-intervault-graph",
      name: "Open intervault graph",
      callback: () => this.openGraphView(),
    });

    this.addRibbonIcon("git-fork", "Intervault Graph", () => this.openGraphView());

    injectStyles(activeDocument);
  }

  async openGraphView() {
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof GraphView) view.render?.();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  // onunload intentionally empty: do NOT detach leaves, as that resets
  // the leaf to its default location even if the user moved it.

  async loadSettings() {
    const raw = (await this.loadData()) as Partial<IntervaultSettings> | null;
    // Assign only known keys so stale/legacy fields don't get re-persisted forever.
    const merged: IntervaultSettings = { ...DEFAULT_SETTINGS };
    if (raw) {
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof IntervaultSettings)[]) {
        if (raw[k] !== undefined) (merged as Record<string, unknown>)[k] = raw[k];
      }
    }
    // Migrate palettes from any older schema (e.g. missing vaultColors/vaultStyles).
    const ps = Array.isArray(merged.palettes) && merged.palettes.length
      ? merged.palettes
      : SEED_PALETTES.map(clonePalette);
    merged.palettes = ps.map(normalizePalette);
    if (!merged.palettes.some((p) => p.id === merged.palette)) {
      merged.palette = merged.palettes[0].id;
    }

    // Global filters: keep any stored array (even empty), else none.
    merged.filters = Array.isArray(raw?.filters)
      ? (raw!.filters as Partial<QueryRule>[])
          .filter((f): f is Partial<QueryRule> & { query: string } => f != null && typeof f.query === "string")
          .map((f, i) => ({ id: f.id ?? `f${i}`, query: f.query }))
      : [];

    // Global groups: keep any stored array (even empty = "user deleted all");
    // otherwise migrate from legacy per-palette colours, else seed defaults.
    if (Array.isArray(raw?.groups)) {
      merged.groups = (raw!.groups as Partial<GroupRule>[])
        .filter((g): g is Partial<GroupRule> & { query: string } => g != null && typeof g.query === "string")
        .map((g, i) => ({ id: g.id ?? `g${i}`, query: g.query, color: g.color ?? "#888888" }));
    } else {
      merged.groups = migrateGroups(raw as Record<string, unknown> | null) ?? defaultGroups();
    }

    // Display: start from factory defaults, overlay any stored values (so new
    // params appear automatically on upgrade).
    merged.display = { ...defaultDisplay(), ...(raw?.display ?? {}) };

    this.settings = merged;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

function injectStyles(doc: Document) {
  if (doc.getElementById("ivg-styles")) return;
  const style = doc.createElement("style");
  style.id = "ivg-styles";
  style.textContent = `
    .ivg-view { padding: 12px; overflow: auto; position: relative; }
    .ivg-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .ivg-title { font-weight: 600; font-size: 15px; }
    /* Right-side control column: [Settings] [Panel] [Refresh], stacked vertically */
    .ivg-ctrl-col {
      position: absolute; top: 10px; right: 10px; z-index: 6;
      display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
      max-height: 85vh; pointer-events: none;
    }
    .ivg-ctrl-col > * { pointer-events: auto; }
    .ivg-gear {
      cursor: pointer; font-size: 12px; padding: 4px 12px; border-radius: 6px;
      border: 1px solid var(--background-modifier-border); background: var(--background-secondary);
      color: var(--text-normal); box-shadow: 0 1px 4px rgba(0,0,0,0.3); flex-shrink: 0;
    }
    .ivg-gear:hover { background: var(--interactive-hover); }
    .ivg-panel {
      /* Static inside ivg-ctrl-col; grows/shrinks as sections expand */
      position: static; width: 260px; min-height: 0; flex: 0 1 auto;
      overflow-y: auto; overflow-x: hidden;
      padding: 8px 10px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border); border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
    }
    /* Collapsible tree */
    .ivg-grp { margin: 2px 0; }
    .ivg-grp-l2 { margin-left: 5px; }
    .ivg-grp-head {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      padding: 4px 2px; user-select: none; border-radius: 4px;
    }
    .ivg-grp-head:hover { background: var(--background-modifier-hover); }
    .ivg-chev { width: 10px; font-size: 10px; color: var(--text-muted); }
    .ivg-grp-l1 > .ivg-grp-head > .ivg-grp-title { font-size: 12px; font-weight: 700; letter-spacing: 0.03em; }
    .ivg-grp-l2 > .ivg-grp-head > .ivg-grp-title { font-size: 12px; color: var(--text-muted); }
    .ivg-grp-body { padding: 2px 0 4px 9px; }
    .ivg-palette-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: stretch; }
    .ivg-palette-btn {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 6px 8px; cursor: pointer; border-radius: 6px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary);
    }
    .ivg-palette-btn.selected { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .ivg-palette-swatch { display: inline-block; width: 16px; height: 6px; }
    .ivg-palette-btn > .ivg-palette-swatch:first-of-type { border-radius: 3px 3px 0 0; }
    .ivg-palette-name { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .ivg-palette-add {
      cursor: pointer; font-size: 18px; line-height: 1; min-width: 34px;
      border-radius: 6px; border: 1px dashed var(--background-modifier-border);
      background: var(--background-primary); color: var(--text-muted);
    }
    .ivg-palette-add:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .ivg-preset-name {
      flex: 1; min-width: 0; font-size: 12px; padding: 3px 6px; border-radius: 4px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal);
    }
    .ivg-preset-del {
      cursor: pointer; font-size: 11px; padding: 3px 8px; border-radius: 4px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);
    }
    .ivg-preset-del:hover { color: var(--text-error, #e05); border-color: var(--text-error, #e05); }
    .ivg-disabled { opacity: 0.4; pointer-events: none; }
    .ivg-edit-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-normal); padding: 2px 0; }
    .ivg-preset-line { flex: 1 0 100%; display: flex; align-items: center; gap: 8px; }
    .ivg-style-select, .ivg-rule-num {
      font-size: 11px; padding: 1px 4px; border-radius: 4px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal);
    }
    .ivg-rule-num { width: 42px; }
    .ivg-rule-add { font-size: 12px; min-width: 0; padding: 2px 8px; margin-top: 4px; }
    /* Rule single-textbox (Function(N) format) — half-width */
    .ivg-rule-txt {
      width: 96px; flex: 0 0 96px; font-size: 11px; padding: 1px 6px; border-radius: 4px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal);
    }
    .ivg-rule-txt.ivg-rule-invalid { border-color: var(--text-error, #e05); }

    /* Drag-reorder handle (3 horizontal bars) */
    .ivg-rule-handle {
      cursor: grab; flex-shrink: 0; display: flex; flex-direction: column;
      gap: 2px; padding: 3px 5px; border-radius: 3px; margin-left: auto;
    }
    .ivg-rule-handle:hover { background: var(--background-modifier-hover); }
    .ivg-rule-handle:active { cursor: grabbing; }
    .ivg-rule-bar { width: 11px; height: 1.5px; background: var(--text-muted); border-radius: 1px; display: block; }
    .ivg-rule-handle:hover .ivg-rule-bar { background: var(--text-normal); }

    /* Drag-reorder state */
    .ivg-rule-wrap { position: relative; transition: transform 0.13s cubic-bezier(0.2,0,0,1); }
    .ivg-rule-wrap.ivg-rule-dragging {
      transition: none; z-index: 20; opacity: 0.92;
      box-shadow: 0 4px 18px rgba(0,0,0,0.35); border-radius: 5px;
    }

    /* Autocomplete suggestion list for rule textbox */
    .ivg-rule-suggest {
      margin: 2px 0 4px 0; border-radius: 4px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-primary); overflow: hidden;
    }
    .ivg-sug-item {
      padding: 4px 8px; cursor: pointer; display: flex; align-items: baseline; gap: 4px;
      font-size: 11px; white-space: nowrap;
    }
    .ivg-sug-item:hover { background: var(--background-modifier-hover); }
    .ivg-sug-text { font-weight: 600; color: var(--text-normal); }
    .ivg-sug-hint { color: var(--text-muted); }
    /* Empty-textbox usage help */
    .ivg-rule-help { padding: 4px 8px; }
    .ivg-help-line { font-size: 10px; color: var(--text-muted); line-height: 1.5; }
    .ivg-help-line.bold { font-weight: 700; color: var(--text-normal); font-style: normal; }
    .ivg-help-line.italic { font-style: italic; }

    /* Display menu controls */
    .ivg-disp-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; }
    .ivg-disp-row .ivg-disp-name { flex: 1; color: var(--text-normal); }
    .ivg-disp-row input[type="range"] { flex: 1; min-width: 0; height: 3px; accent-color: var(--interactive-accent); }
    .ivg-disp-row input[type="range"]::-webkit-slider-thumb { width: 8px; height: 8px; border-radius: 50%; cursor: pointer; }
    .ivg-disp-row input[type="range"]::-moz-range-thumb { width: 8px; height: 8px; border-radius: 50%; border: none; cursor: pointer; }
    .ivg-disp-val { width: 30px; text-align: right; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .ivg-disp-row input[type="checkbox"] { accent-color: var(--interactive-accent); }

    /* Re-add Merged/Diff buttons */
    .ivg-int-add {
      font-size: 11px; padding: 2px 8px; cursor: pointer; border-radius: 4px;
      border: 1px dashed var(--background-modifier-border); background: var(--background-primary);
      color: var(--text-muted); margin-bottom: 2px;
    }
    .ivg-int-add:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    /* Preset rows: [name] | [colour dots]; click selects, dbl-click name/dots edits */
    .ivg-preset-row {
      display: flex; align-items: center; gap: 8px; padding: 4px 6px;
      border-radius: 5px; cursor: pointer; border: 1px solid transparent;
      flex-wrap: wrap;
    }
    .ivg-preset-row:hover { background: var(--background-modifier-hover); }
    .ivg-preset-row.selected { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .ivg-preset-rowname { flex: 1; font-size: 13px; color: var(--text-normal); user-select: none; }
    .ivg-preset-dots { display: flex; gap: 4px; }
    .ivg-preset-dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; cursor: pointer; position: relative; border: 1px solid rgba(0,0,0,0.25); box-sizing: border-box; }
    .ivg-preset-dot.selected { box-shadow: 0 0 0 2px var(--interactive-accent); }
    /* Native colour input hidden behind the dot; the dot is the visible control */
    .ivg-hidden-color { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; padding: 0; margin: 0; border: 0; pointer-events: none; }
    .ivg-restore-btn {
      cursor: pointer; font-size: 12px; padding: 5px 12px; border-radius: 6px;
      border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal);
      margin-top: 6px; width: 100%; box-sizing: border-box;
    }
    .ivg-restore-btn:hover { background: var(--interactive-accent); color: #fff; }
    .ivg-vault-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-normal); padding: 2px 0; cursor: pointer; white-space: nowrap; }
    .ivg-vault-swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .ivg-vault-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .ivg-info { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
    .ivg-empty { color: var(--text-muted); margin-top: 20px; }
    .ivg-svg-wrap { width: 100%; position: relative; }
    .ivg-svg { width: 100%; height: auto; background: var(--background-primary); border-radius: 8px; transform-origin: center; }
    .ivg-pop { animation: ivg-pop 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes ivg-pop {
      from { transform: scale(0.965); opacity: 0.55; }
      to   { transform: scale(1); opacity: 1; }
    }
    .ivg-vault-line {
      cursor: pointer; fill: none;
      stroke: var(--line-shade, #6b6e76);
      transition: opacity 0.15s ease, stroke-width 0.15s ease;
    }
    .ivg-vault-inner { pointer-events: none; transition: opacity 0.15s ease; }
    .ivg-note { cursor: pointer; }
    .ivg-note-dot { stroke: none; r: var(--dot-r, 5px); transition: r 0.1s; }
    .ivg-note-same { fill: #5a5c63; }
    .ivg-note-diff { fill: #efe28a; }
    .ivg-note:hover .ivg-note-dot,
    .ivg-note.dragging .ivg-note-dot { r: var(--dot-r-hover, 7px); }
    /* Grey intersection title label; grows + bolds on hover for readability.
       Opacity is driven by JS (zoom-distance fade). */
    .ivg-note-label {
      fill: var(--text-muted); font-size: 8px; pointer-events: none;
      transition: font-size 0.1s ease, opacity 0.15s ease;
    }
    .ivg-note:hover .ivg-note-label,
    .ivg-note.dragging .ivg-note-label {
      font-size: 11px; font-weight: 700; fill: var(--text-normal);
    }
    .ivg-vault-label {
      font-size: 12px; font-weight: 600; cursor: pointer;
      fill: var(--text-muted);
    }
    .ivg-vault-label.hover { fill: var(--interactive-accent); }

    .ivg-merge-modal { width: min(1000px, 94vw); }
    .ivg-merge-modal .modal-content { max-height: 86vh; display: flex; flex-direction: column; }
    .ivg-merge-count { display: block; font-size: 11px; color: var(--text-muted); font-style: italic; margin-bottom: 8px; }
    /* Vault selector embedded inside the diff column header — flat combobox style */
    /* Zero the cell's own padding so the select fills edge-to-edge */
    .ivg-diff-headrow .ivg-diff-cell:has(.ivg-head-select) { padding: 0; }
    .ivg-head-select {
      width: 100%; box-sizing: border-box;
      font-weight: 600; font-size: 12px;
      background: var(--background-secondary);
      border: none; /* headrow already provides the outer border; select needs none */
      border-radius: 0; /* headrow overflow:hidden clips corners to match rounding */
      outline: none; color: var(--text-normal); cursor: pointer;
      padding: 1px 8px; margin: 0; /* 1px vertical → shorter row */
      -webkit-appearance: menulist; appearance: menulist;
    }
    .ivg-head-select:hover { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }

    .ivg-diff-row { display: flex; align-items: stretch; }
    .ivg-diff-headrow {
      font-weight: 600; font-size: 12px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-bottom: none; border-radius: 6px 6px 0 0;
      overflow: hidden; /* clips select corners so they follow the headrow's rounding */
    }
    .ivg-diff-headrow .ivg-diff-cell { min-height: 0; }
    .ivg-merge-body {
      font-family: var(--font-monospace); font-size: 12px;
      flex: 1; min-height: 30vh; overflow: auto;
      border: 1px solid var(--background-modifier-border); border-radius: 0 0 6px 6px;
    }
    .ivg-diff-cell {
      flex: 1; padding: 2px 8px; white-space: pre-wrap; word-break: break-word;
      outline: none; min-height: 1.4em;
    }
    .ivg-diff-cell[contenteditable="true"]:focus {
      background: var(--background-modifier-form-field);
      box-shadow: inset 0 0 0 1px var(--interactive-accent);
    }
    .ivg-cell-absent { background: repeating-linear-gradient(45deg, transparent, transparent 5px, var(--background-secondary) 5px, var(--background-secondary) 10px); opacity: 0.4; }
    .ivg-diff-gutter {
      flex: 0 0 52px; display: flex; align-items: center; justify-content: center; gap: 3px;
      border-left: 1px solid var(--background-modifier-border);
      border-right: 1px solid var(--background-modifier-border);
    }
    .ivg-copy-btn {
      font-size: 11px; padding: 0 5px; line-height: 1.6; cursor: pointer;
      border-radius: 3px; border: 1px solid var(--background-modifier-border);
      background: var(--background-primary); color: var(--text-normal);
    }
    .ivg-copy-btn:hover { background: var(--interactive-accent); color: #fff; }

    /* Per-line diff colouring shown directly in the editor */
    .ivg-op-del .ivg-diff-left   { background: rgba(255,80,80,0.18); }
    .ivg-op-add .ivg-diff-right  { background: rgba(80,200,120,0.18); }
    .ivg-op-changed .ivg-diff-left  { background: rgba(255,80,80,0.18); }
    .ivg-op-changed .ivg-diff-right { background: rgba(80,200,120,0.18); }

    .ivg-save-bar { display: flex; margin-top: 8px; }
    .ivg-save-left { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .ivg-save-gutter { flex: 0 0 52px; }
    .ivg-save-right { flex: 1; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .ivg-save-btn {
      cursor: pointer; padding: 5px 14px; border-radius: 5px;
      border: 1px solid var(--background-modifier-border);
      background: var(--interactive-normal); color: var(--text-normal);
    }
    .ivg-save-btn:hover { background: var(--interactive-accent); color: #fff; }
  `;
  doc.head.appendChild(style);
}
