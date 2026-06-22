import { ItemView, WorkspaceLeaf, Modal, App, Notice } from "obsidian";
import * as fs from "fs";
import { buildGraphData, GraphData } from "./index";
import { computeScatter, smoothPath, Point, VaultMeta, NoteNode } from "./layout";
import { Simulation, Body, Link } from "./force";
import { lineDiff } from "./diff";
import { toVaultConfigs, Palette, GroupRule, QueryRule, SEED_PALETTES, clonePalette, defaultGroups } from "./settings";
import type IntervaultGraphPlugin from "./main";

export const GRAPH_VIEW_TYPE = "intervault-graph-view";
const SVGNS = "http://www.w3.org/2000/svg";
const GREY = "#888888"; // intersection colour when no group matches

// ── Intersection query language: Fn(Count) ────────────────────────────────────
// Fn ∈ {Diff, Merge/Merged, Meet (=any status)}; Count ∈ {N | N+ | N- | *}.
// "*" means "all vaults this note appears in" (not all configured vaults).
type CountOp = "eq" | "gte" | "lte" | "all";
interface QueryTerm { fn: "diff" | "merge" | "meet"; op: CountOp; n: number; }

const FN_ALIASES: Record<string, "diff" | "merge" | "meet"> = {
  diff: "diff", differ: "diff",
  merge: "merge", merged: "merge",
  meet: "meet", meets: "meet", cut: "meet",
};
const FN_CAP: Record<"diff" | "merge" | "meet", string> = { diff: "Diff", merge: "Merged", meet: "Meet" };

function parseQuery(s: string): QueryTerm | null {
  const m = s.trim().match(/^([a-zA-Z]+)\(\s*(\*|\d+\s*[+-]?)\s*\)$/);
  if (!m) return null;
  const fn = FN_ALIASES[m[1].toLowerCase()];
  if (!fn) return null;
  const tok = m[2].replace(/\s+/g, "");
  if (tok === "*") return { fn, op: "all", n: 0 };
  let mm: RegExpMatchArray | null;
  if ((mm = tok.match(/^(\d+)\+$/))) return { fn, op: "gte", n: parseInt(mm[1], 10) };
  if ((mm = tok.match(/^(\d+)-$/))) return { fn, op: "lte", n: parseInt(mm[1], 10) };
  if ((mm = tok.match(/^(\d+)$/))) return { fn, op: "eq", n: parseInt(mm[1], 10) };
  return null;
}

/** Per-note content-cluster stats (vaults grouped by identical content). */
interface NoteStats {
  total: number;      // vaults the note appears in
  distinct: number;   // number of distinct content versions
  maxCluster: number; // size of the largest identical-content group
}

/** Does an intersection satisfy a query term, under the cluster model?
 *  Each function reads a different basis: diff→distinct versions,
 *  merge→largest identical group, meet→total vaults.
 *  "*" means the basis equals the note's own vault count (s.total), not the
 *  total configured vaults — so Merged(*) means "all copies of this note are
 *  identical", regardless of how many other vaults exist. */
function matchQuery(t: QueryTerm, s: NoteStats): boolean {
  const basis = t.fn === "diff" ? s.distinct : t.fn === "merge" ? s.maxCluster : s.total;
  switch (t.op) {
    case "eq": return basis === t.n;
    case "gte": return basis >= t.n;
    case "lte": return basis <= t.n;
    case "all": return basis === s.total;
  }
  return false;
}

function queryToken(t: QueryTerm): string {
  return t.op === "all" ? "*" : t.op === "gte" ? `${t.n}+` : t.op === "lte" ? `${t.n}-` : `${t.n}`;
}
function normalizeQuery(t: QueryTerm): string { return `${FN_CAP[t.fn]}(${queryToken(t)})`; }

// Geometry style index: 0 solid, 1 striped, 2 double (hollow). Default cycles by
// vault index; per-vault overrides allowed. Colours sorted by luminance so the
// BRIGHTEST is always the double style.
const STYLE_NAMES = ["Solid", "Striped", "Double"];
const DIM_COLOR = "#2b2b2b"; // barely-visible "lights off"

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Sort colours dark→bright so index 2 (the double slot) is the brightest. */
function brightestLast(colors: string[]): string[] {
  return [...colors].sort((a, b) => luminance(a) - luminance(b));
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = activeDocument.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

type P = { x: number; y: number };
function segsCross(a: P, b: P, c: P, d: P): boolean {
  const ccw = (p: P, q: P, r: P) => (r.y - p.y) * (q.x - p.x) - (q.y - p.y) * (r.x - p.x);
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Remove self-crossings from an ordered point path via 2-opt: while any two
 * non-adjacent edges cross, reverse the span between them. Converges to a
 * non-self-intersecting polyline through the same points.
 */
function deCross(order: string[], pos: (t: string) => P): string[] {
  const o = [...order];
  const n = o.length;
  if (n < 4) return o;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 40) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n - 1; j++) {
        const a = pos(o[i]);
        const b = pos(o[i + 1]);
        const c = pos(o[j]);
        const d = pos(o[j + 1]);
        if (segsCross(a, b, c, d)) {
          // reverse o[i+1 .. j]
          let lo = i + 1;
          let hi = j;
          while (lo < hi) { const t = o[lo]; o[lo] = o[hi]; o[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
  }
  return o;
}

interface LineAppearance { color: string; style: number; dim: boolean; }

export class GraphView extends ItemView {
  private rafId: number | null = null;
  private menuOpen = false;
  // Resolved per-vault appearance (colour + geometry style + lit/dim) for this render
  private appearance = new Map<string, LineAppearance>();
  // Which collapsible groups are open (all closed by default)
  private openSections = new Set<string>();
  // In-place restyle hooks set by renderSvg (apply colour/dim without a re-render)
  private reapply: (() => void) | null = null;
  private redrawDots: (() => void) | null = null;
  private refreshLines: (() => void) | null = null;
  private applyDisplay: (() => void) | null = null;
  private popGraph: (() => void) | null = null;
  // Inline preset-editor state (persists across the full re-render on colour commit)
  private editName: string | null = null;
  private editColors: string | null = null;
  private editColorIdx = 0;
  // ID of a freshly-added filter/group rule that renders with an empty textbox
  private newQueryId: string | null = null;
  // Configured vault count for this render (used by query "*" / classifyDot)

  constructor(leaf: WorkspaceLeaf, private plugin: IntervaultGraphPlugin) {
    super(leaf);
  }

  getViewType() { return GRAPH_VIEW_TYPE; }
  getDisplayText() { return "Intervault Graph"; }
  getIcon() { return "git-fork"; }

  async onOpen() {
    this.editName = null;
    this.editColors = null;
    this.editColorIdx = 0;
    this.newQueryId = null;
    this.render();
  }

  async onClose() {
    this.stopLoop();
    this.contentEl.empty();
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  render() {
    this.stopLoop();
    const container = this.contentEl;
    container.empty();
    container.addClass("ivg-view");

    const vaults = toVaultConfigs(this.plugin.settings.vaultPaths);

    const toolbar = container.createEl("div", { cls: "ivg-toolbar" });
    toolbar.createEl("span", { cls: "ivg-title", text: "Intervault Graph" });

    if (vaults.length < 1) {
      container.createEl("p", {
        cls: "ivg-empty",
        text: "No vault paths configured. Add folder paths in the plugin settings.",
      });
      return;
    }

    let data: GraphData;
    try {
      data = buildGraphData(vaults);
    } catch (e) {
      container.createEl("p", { cls: "ivg-empty", text: `Error reading vaults: ${String(e)}` });
      return;
    }

    const info = container.createEl("div", { cls: "ivg-info" });

    const statsMap = this.computeNoteStats(data);
    // ── Filters (global, AND-combined) decide which intersections build the graph.
    // Invalid/empty filters are ignored; no valid filters → every intersection shown.
    const filterTerms = (this.plugin.settings.filters ?? [])
      .map((f) => parseQuery(f.query))
      .filter((t): t is QueryTerm => t !== null);
    const passes = (title: string): boolean => {
      if (filterTerms.length === 0) return true;
      const s = statsMap.get(title);
      if (!s) return false;
      return filterTerms.every((t) => matchQuery(t, s));
    };
    const keptTitles = data.sharedTitles.filter(passes);

    // Reduced GraphData → the simulation/anchors/orders only know surviving notes,
    // so vault lines genuinely reroute (not just hidden dots).
    const filteredIndex: GraphData["titleIndex"] = new Map();
    for (const t of keptTitles) {
      const idx = data.titleIndex.get(t);
      if (idx) filteredIndex.set(t, idx);
    }
    const filteredData: GraphData = { vaults: data.vaults, titleIndex: filteredIndex, sharedTitles: keptTitles };

    const shownCount = keptTitles.length;
    const ofTotal = shownCount !== data.sharedTitles.length ? `/${data.sharedTitles.length}` : "";
    info.setText(
      `${vaults.length} vault${vaults.length !== 1 ? "s" : ""} · ${shownCount}${ofTotal} shared note${shownCount !== 1 ? "s" : ""}`
    );

    const scatter = computeScatter(filteredData);
    this.resolveAppearance(scatter.vaults);
    const wrap = this.renderSvg(container, scatter, filteredData, statsMap);
    this.buildSettingsPanel(wrap, scatter.vaults); // floats over the graph's top-right
  }

  private selectedPalette(): Palette {
    const ps = this.plugin.settings.palettes;
    if (!ps || ps.length === 0) return clonePalette(SEED_PALETTES[0]);
    return ps.find((p) => p.id === this.plugin.settings.palette) ?? ps[0];
  }

  /** Exactly three colours (pad) so the style↔colour pairing is well-defined. */
  private palette3(pal: Palette): string[] {
    const c = pal.colors;
    return [c[0] ?? "#888888", c[1] ?? "#aaaaaa", c[2] ?? "#dddddd"];
  }

  /** Intersection dot colour: first matching GLOBAL group (top→down), else grey. */
  private classifyDot(stats: NoteStats): string {
    for (const g of this.plugin.settings.groups ?? []) {
      const term = parseQuery(g.query);
      if (term && matchQuery(term, stats)) return g.color;
    }
    return GREY;
  }

  /** Resolve each vault's colour, geometry style, and lit/dim (per-vault overrides win;
   *  otherwise colour is driven by style so the double style is always the brightest). */
  private resolveAppearance(vaults: VaultMeta[]) {
    this.appearance.clear();
    const pal = this.selectedPalette();
    const sorted = brightestLast(this.palette3(pal)); // [dark, mid, bright]
    const dim = new Set(this.plugin.settings.dimVaults);
    // Overrides live ON the selected preset, so presets are fully independent.
    const overColor = pal.vaultColors ?? {};
    const overStyle = pal.vaultStyles ?? {};
    vaults.forEach((meta, i) => {
      // Colour is keyed to the vault INDEX (default brightest=double), NOT the
      // current style — so changing a vault's line-shape never changes its colour.
      const style = overStyle[meta.name] ?? (i % 3); // 0 solid, 1 striped, 2 double
      const color = overColor[meta.name] ?? sorted[i % 3];
      this.appearance.set(meta.name, { color, style, dim: dim.has(meta.name) });
    });
  }

  /** Create a new preset cloned (deeply) from the current one and select it. */
  private addPreset(): Palette {
    const cur = this.selectedPalette();
    const nums = this.plugin.settings.palettes
      .map((p) => parseInt(p.id.replace(/^custom/, ""), 10))
      .filter((n) => !Number.isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    const pal: Palette = {
      ...clonePalette(cur),
      id: `custom${next}`,
      name: next === 1 ? "Custom" : `Custom ${next}`,
    };
    this.plugin.settings.palettes.push(pal);
    this.plugin.settings.palette = pal.id;
    return pal;
  }

  /** Floating Settings control over the graph's top-right, as a collapsible tree. */
  private buildSettingsPanel(host: HTMLElement, vaults: VaultMeta[]) {
    // Vertical column: [Settings] [panel when open] [Refresh always at bottom]
    // As sections expand the panel grows, pushing Refresh down while keeping it visible.
    const ctrlCol = host.createEl("div", { cls: "ivg-ctrl-col" });
    const toggle = ctrlCol.createEl("button", { cls: "ivg-gear", text: "Settings" });
    const panel = ctrlCol.createEl("div", { cls: "ivg-panel" });
    panel.setCssStyles({ display: this.menuOpen ? "block" : "none" });
    const refresh = ctrlCol.createEl("button", { cls: "ivg-gear", text: "Refresh" });
    refresh.setAttribute("aria-label", "Respawn graph");
    refresh.addEventListener("click", () => this.render());
    toggle.addEventListener("click", () => {
      this.menuOpen = !this.menuOpen;
      panel.setCssStyles({ display: this.menuOpen ? "block" : "none" });
      if (!this.menuOpen) {
        // Collapse all open groups so the panel starts clean on next open
        for (const [id, apply] of applyById) { this.openSections.delete(id); apply(false); }
      }
    });

    // Debounced pop so a continuous colour-picker drag yields a single pop.
    let popTimer: ReturnType<typeof window.setTimeout> | null = null;
    const popSoon = () => {
      if (popTimer) window.clearTimeout(popTimer);
      popTimer = window.setTimeout(() => { popTimer = null; this.popGraph?.(); }, 130);
    };

    // Refresh the graph's visuals on every settings change (in place, no reshuffle),
    // with a short pop/expand so the change is felt — like the core graph.
    const applyLive = async () => {
      await this.plugin.saveSettings();
      this.resolveAppearance(vaults);
      this.reapply?.();
      this.refreshLines?.();
      this.redrawDots?.();
      popSoon();
    };

    // Registry of each group's apply() function — used to cascade-close sub-menus
    // when a parent is collapsed. Reset at the start of each populate() call.
    const applyById = new Map<string, (open: boolean) => void>();

    // Collapsible group with a persisted open/closed state. Closing a parent also
    // closes all registered children whose id starts with `${id}/`.
    const group = (parent: HTMLElement, id: string, title: string, level: number, build: (body: HTMLElement) => void) => {
      const g = parent.createEl("div", { cls: `ivg-grp ivg-grp-l${level}` });
      const head = g.createEl("div", { cls: "ivg-grp-head" });
      const chev = head.createEl("span", { cls: "ivg-chev" });
      head.createEl("span", { cls: "ivg-grp-title", text: title });
      const body = g.createEl("div", { cls: "ivg-grp-body" });
      const apply = (open: boolean) => {
        body.setCssStyles({ display: open ? "block" : "none" });
        chev.setText(open ? "▾" : "▸"); // ▾ / ▸ (not emoji)
      };
      applyById.set(id, apply);
      apply(this.openSections.has(id));
      head.addEventListener("click", () => {
        const open = !this.openSections.has(id);
        if (open) {
          this.openSections.add(id);
        } else {
          this.openSections.delete(id);
          // Cascade-close all children in both state and DOM
          for (const [cid, capply] of applyById) {
            if (cid.startsWith(id + "/")) { this.openSections.delete(cid); capply(false); }
          }
        }
        apply(open);
      });
      build(body);
    };

    // A colour control rendered as the SAME small dot used inline everywhere: a
    // dot span with a hidden native <input type=color> behind it.
    const colorDot = (parent: HTMLElement, value: string, onSet: (v: string) => void) => {
      const dot = parent.createEl("span", { cls: "ivg-preset-dot" });
      dot.setCssStyles({ background: value });
      const input = dot.createEl("input");
      input.type = "color";
      input.value = value;
      input.addClass("ivg-hidden-color");
      // "input" → live dot colour preview only (no graph refresh avoids partial-reshuffle mid-drag)
      input.addEventListener("input", () => { dot.setCssStyles({ background: input.value }); onSet(input.value); });
      // "change" (picker commit) → save + full reload with reshuffle every time
      input.addEventListener("change", () => { onSet(input.value); void this.plugin.saveSettings().then(() => this.render()); });
      return { dot, input };
    };

    const populate = () => {
      panel.empty();
      applyById.clear(); // fresh registry for this render pass
      const sel = this.selectedPalette();

      group(panel, "Theme", "Theme", 1, (colorsBody) => {
        // ── Presets: one row per preset → [name] | [colour dots] ─────────────
        group(colorsBody, "Theme/Presets", "Presets", 2, (b) => {
          for (const p of this.plugin.settings.palettes) {
            const rowEl = b.createEl("div", { cls: "ivg-preset-row" });
            if (p.id === sel.id) rowEl.addClass("selected");

            // Click the row → select this theme (or exit an open inline editor)
            rowEl.addEventListener("click", () => {
              if (this.editName === p.id || this.editColors === p.id) {
                this.editName = null; this.editColors = null; populate(); return;
              }
              if (this.plugin.settings.palette === p.id) return;
              this.plugin.settings.palette = p.id;
              this.editName = null; this.editColors = null;
              void this.plugin.saveSettings().then(() => this.render());
            });

            if (this.editName === p.id) {
              // Rename mode: name text-box + Delete inline; colours hidden
              const nameIn = rowEl.createEl("input", { cls: "ivg-preset-name", type: "text" });
              nameIn.type = "text";
              nameIn.value = p.name;
              nameIn.addEventListener("click", (e) => e.stopPropagation());
              let nameCommitted = false;
              const commitName = async () => {
                if (nameCommitted) return;
                nameCommitted = true;
                p.name = nameIn.value.trim() || p.name;
                this.editName = null;
                await applyLive();
                populate();
              };
              nameIn.addEventListener("keydown", (e) => {
                const k = e.key;
                if (k === "Enter") nameIn.blur(); // triggers blur → commitName
                else if (k === "Escape") { nameCommitted = true; this.editName = null; populate(); }
              });
              // Confirm on blur: covers both Enter (which calls blur) and click-outside
              nameIn.addEventListener("blur", () => void commitName());
              const del = rowEl.createEl("button", { cls: "ivg-preset-del", text: "Delete" });
              del.toggleClass("ivg-disabled", this.plugin.settings.palettes.length <= 1);
              // Keep focus on mousedown so the name input's blur→commit→populate()
              // doesn't tear down this button before its click handler runs.
              del.addEventListener("mousedown", (e) => e.preventDefault());
              del.addEventListener("click", (e) => {
                e.stopPropagation();
                nameCommitted = true; // suppress the pending name-commit
                if (this.plugin.settings.palettes.length <= 1) return;
                const wasSel = this.plugin.settings.palette === p.id;
                this.plugin.settings.palettes = this.plugin.settings.palettes.filter((x) => x.id !== p.id);
                if (wasSel) this.plugin.settings.palette = this.plugin.settings.palettes[0].id;
                this.editName = null;
                void applyLive().then(() => populate());
              });
              window.setTimeout(() => { nameIn.focus(); nameIn.select(); }, 0); // select-all the current name
            } else {
              // Single line: [name] | [3 colour dots]. Double-click a dot to edit
              // it (opens its picker + highlights it); in edit mode a single click
              // on another dot switches to editing that one. No extra line/4th dot.
              const line = rowEl.createEl("div", { cls: "ivg-preset-line" });
              const nameEl = line.createEl("span", { cls: "ivg-preset-rowname", text: p.name });
              nameEl.addEventListener("dblclick", (e) => { e.stopPropagation(); this.editName = p.id; this.editColors = null; populate(); });

              const dotsEl = line.createEl("span", { cls: "ivg-preset-dots" });
              const order = p.colors.map((_, i) => i).sort((a, c) => luminance(p.colors[a]) - luminance(p.colors[c]));
              const made = order.map((slot) => {
                const { dot, input } = colorDot(dotsEl, p.colors[slot], (v) => { p.colors[slot] = v; });
                return { slot, dot, input };
              });
              const highlight = () => made.forEach((d) => d.dot.toggleClass("selected", this.editColors === p.id && d.slot === this.editColorIdx));
              highlight();
              for (const { slot, dot, input } of made) {
                dot.addEventListener("dblclick", (e) => {
                  e.stopPropagation();
                  this.editColors = p.id; this.editName = null; this.editColorIdx = slot;
                  highlight();
                  input.click(); // open the colour selector
                });
                dot.addEventListener("click", (e) => {
                  if (this.editColors !== p.id) return; // display mode → let the row select the theme
                  e.stopPropagation();
                  this.editColorIdx = slot;
                  highlight();
                  input.click(); // switch the selected colour + open its picker
                });
              }
            }
          }

          const addBtn = b.createEl("button", { cls: "ivg-palette-add", text: "+" });
          addBtn.setAttribute("aria-label", "New preset");
          addBtn.addEventListener("click", () => {
            this.addPreset();
            this.editName = null; this.editColors = null;
            void applyLive().then(() => populate());
          });
        });

        // ── Vaults (per-vault line colour + line-type) ───────────────────────
        group(colorsBody, "Theme/VaultColors", "Vaults", 2, (b) => {
          let activeVaultDot: HTMLElement | null = null;
          vaults.forEach((meta) => {
            const ap = this.appearance.get(meta.name)!;
            const r = b.createEl("div", { cls: "ivg-edit-row" });
            // Dot with selection highlight (same behaviour as preset dots)
            const { dot: vd, input: vi } = colorDot(r, ap.color, (v) => { sel.vaultColors[meta.name] = v; });
            vd.addEventListener("click", (e) => {
              e.stopPropagation();
              if (activeVaultDot && activeVaultDot !== vd) activeVaultDot.removeClass("selected");
              vd.addClass("selected"); activeVaultDot = vd;
              vi.click();
            });
            vi.addEventListener("change", () => { vd.removeClass("selected"); activeVaultDot = null; });
            r.createEl("span", { cls: "ivg-vault-name", text: meta.name });
            const sel2 = r.createEl("select", { cls: "ivg-style-select" });
            STYLE_NAMES.forEach((nm, si) => {
              const opt = sel2.createEl("option", { text: nm, value: String(si) });
              if (si === ap.style) opt.selected = true;
            });
            sel2.addEventListener("change", () => {
              sel.vaultStyles[meta.name] = parseInt(sel2.value, 10); // per-preset override
              void this.plugin.saveSettings().then(() => this.render());
            });
          });
        });

      }); // ── end Theme group ──────────────────────────────────────────────

      // ── Intersections (top-level, GLOBAL): Groups + Filters ───────────────
      // Independent of the colour presets. Filters decide which intersections
      // build the graph (AND-combined); Groups decide their colour (first wins).
      group(panel, "Intersections", "Intersections", 1, (intBody) => {
        const settings = this.plugin.settings;

        // Suggestion data shared by every query textbox (Groups + Filters)
        const fnDefs = [
          { fn: "Diff",   verb: "different across" },
          { fn: "Merged", verb: "merged across" },
          { fn: "Meet",   verb: "meets" },
        ];
        const countDesc = (tok: string): string => {
          const t = tok.replace(/\s+/g, "");
          if (t === "*") return "all configured vaults";
          let mm: RegExpMatchArray | null;
          if ((mm = t.match(/^(\d+)\+$/))) return `at least ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          if ((mm = t.match(/^(\d+)-$/))) return `at most ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          if ((mm = t.match(/^(\d+)$/)))  return `exactly ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          return "# vaults";
        };
        const suggestionsFor = (val: string) => {
          const fnPart = val.toLowerCase().split("(")[0].trim();
          const cm = val.match(/\(([^)]*)/);
          const tok = (cm ? cm[1].trim() : "") || "2";
          return fnDefs
            .filter((d) => fnPart === "" || d.fn.toLowerCase().startsWith(fnPart))
            .map((d) => ({ text: `${d.fn}(${tok})`, hint: `${d.verb} ${countDesc(tok)}` }));
        };

        // Build one query row. `hasColor` adds the colour dot (Groups only);
        // `draggable` adds the reorder handle (Groups only). Filters get neither.
        const buildQueryRow = (opts: {
          listEl: HTMLElement;
          wrapEls: HTMLElement[];
          rules: (QueryRule | GroupRule)[];
          rule: QueryRule | GroupRule;
          index: number;
          hasColor: boolean;
          draggable: boolean;
        }) => {
          const { listEl, wrapEls, rules, rule, index, hasColor, draggable } = opts;
          const isNew = this.newQueryId === rule.id;
          const wrap = listEl.createEl("div", { cls: "ivg-rule-wrap" });
          wrapEls.push(wrap);
          const row = wrap.createEl("div", { cls: "ivg-edit-row" });

          // Colour dot (Groups only) — disabled until the query parses
          let rd: HTMLElement | null = null;
          let ri: HTMLInputElement | null = null;
          if (hasColor) {
            const g = rule as GroupRule;
            const made = colorDot(row, g.color, (v) => { g.color = v; });
            rd = made.dot; ri = made.input;
            if (isNew || !parseQuery(rule.query)) rd.addClass("ivg-disabled");
            rd.addEventListener("click", (e) => {
              e.stopPropagation();
              if (rd!.hasClass("ivg-disabled")) return;
              rd!.addClass("selected");
              ri!.click();
            });
            ri.addEventListener("change", () => rd!.removeClass("selected"));
          }

          // Query textbox
          const txt = row.createEl("input", { cls: "ivg-rule-txt", type: "text" });
          txt.type = "text";
          txt.value = isNew ? "" : rule.query;
          txt.placeholder = "e.g. Diff(2+)";
          txt.addEventListener("click", (e) => e.stopPropagation());

          // Inline suggestion list (pushes content down — never floats)
          const suggestEl = wrap.createEl("div", { cls: "ivg-rule-suggest" });
          suggestEl.setCssStyles({ display: "none" });
          const showSuggestions = (val: string) => {
            suggestEl.empty();
            // Empty textbox → usage help instead of function suggestions
            if (val.trim() === "") {
              suggestEl.setCssStyles({ display: "block" });
              const help = suggestEl.createEl("div", { cls: "ivg-rule-help" });
              help.createEl("div", { cls: "ivg-help-line bold", text: "Function(#)" });
              help.createEl("div", { cls: "ivg-help-line italic", text: "Use #+ or #- for ranges" });
              help.createEl("div", { cls: "ivg-help-line italic", text: "Functions: meet(), merged(), diff()" });
              return;
            }
            const sugs = suggestionsFor(val);
            if (!sugs.length) { suggestEl.setCssStyles({ display: "none" }); return; }
            suggestEl.setCssStyles({ display: "block" });
            sugs.forEach(({ text, hint }) => {
              const item = suggestEl.createEl("div", { cls: "ivg-sug-item" });
              item.createEl("span", { cls: "ivg-sug-text", text });
              item.createEl("span", { cls: "ivg-sug-hint", text: ` – ${hint}` });
              item.addEventListener("mousedown", (e) => {
                e.preventDefault(); // keep focus so the textbox commit fires cleanly
                txt.value = text;
                txt.removeClass("ivg-rule-invalid");
                suggestEl.setCssStyles({ display: "none" });
                txt.dispatchEvent(new Event("change"));
              });
            });
          };

          txt.addEventListener("focus", () => showSuggestions(txt.value));
          txt.addEventListener("blur", () => window.setTimeout(() => { suggestEl.setCssStyles({ display: "none" }); }, 160));
          txt.addEventListener("input", () => {
            const ok = !!parseQuery(txt.value);
            txt.toggleClass("ivg-rule-invalid", txt.value.length > 0 && !ok);
            rd?.toggleClass("ivg-disabled", !ok);
            showSuggestions(txt.value);
          });
          txt.addEventListener("change", () => {
            const term = parseQuery(txt.value);
            if (!term) {
              if (isNew && !txt.value.trim()) {
                const i = rules.indexOf(rule);
                if (i >= 0) rules.splice(i, 1); // cancelled empty new row
                this.newQueryId = null;
                populate(); return;
              }
              txt.value = isNew ? "" : rule.query;
              txt.removeClass("ivg-rule-invalid");
              return;
            }
            rule.query = normalizeQuery(term);
            this.newQueryId = null;
            void this.plugin.saveSettings().then(() => this.render());
          });
          if (isNew) window.setTimeout(() => { txt.focus(); showSuggestions(""); }, 0);

          // Delete button
          const rm = row.createEl("button", { cls: "ivg-preset-del", text: "×" });
          rm.addEventListener("click", (e) => {
            e.stopPropagation();
            const i = rules.indexOf(rule);
            if (i >= 0) rules.splice(i, 1);
            if (this.newQueryId === rule.id) this.newQueryId = null;
            void this.plugin.saveSettings().then(() => this.render());
          });

          // Drag-reorder handle (Groups only — top group wins when many match)
          if (draggable) {
            const handle = row.createEl("span", { cls: "ivg-rule-handle" });
            for (let i = 0; i < 3; i++) handle.createEl("span", { cls: "ivg-rule-bar" });
            handle.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault(); e.stopPropagation();
              const rowH = wrap.offsetHeight || 28;
              const startY = e.clientY;
              let targetIdx = index;
              wrap.addClass("ivg-rule-dragging");
              const onMove = (ev: MouseEvent) => {
                const dy = ev.clientY - startY;
                wrap.setCssStyles({ transform: `translateY(${dy}px)` });
                const ni = Math.max(0, Math.min(rules.length - 1, index + Math.round(dy / rowH)));
                if (ni !== targetIdx) {
                  targetIdx = ni;
                  wrapEls.forEach((w, i) => {
                    if (w === wrap) return;
                    const shift =
                      index < targetIdx ? (i > index && i <= targetIdx ? -rowH : 0) :
                      (i < index && i >= targetIdx ? rowH : 0);
                    w.setCssStyles({ transform: `translateY(${shift}px)` });
                  });
                }
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                wrap.removeClass("ivg-rule-dragging");
                wrapEls.forEach((w) => { w.setCssStyles({ transform: "" }); });
                if (targetIdx !== index) {
                  const [moved] = rules.splice(index, 1);
                  rules.splice(targetIdx, 0, moved);
                  void this.plugin.saveSettings().then(() => this.render());
                }
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            });
          }
        };

        // ── Filters: query only, AND-combined (order irrelevant) ─────────────
        group(intBody, "Intersections/Filters", "Filters", 2, (fb) => {
          const listEl = fb.createEl("div", { cls: "ivg-rule-list" });
          const wrapEls: HTMLElement[] = [];
          settings.filters.forEach((rule, i) =>
            buildQueryRow({ listEl, wrapEls, rules: settings.filters, rule, index: i, hasColor: false, draggable: false })
          );
          const add = fb.createEl("button", { cls: "ivg-palette-add", text: "+" });
          add.setAttribute("aria-label", "New filter");
          add.addEventListener("click", () => {
            const id = `f${(settings.filters.length ? Math.max(...settings.filters.map((x) => parseInt(x.id.replace(/\D/g, ""), 10) || 0)) : 0) + 1}`;
            settings.filters.push({ id, query: "" });
            this.newQueryId = id;
            void this.plugin.saveSettings().then(() => this.render());
          });
        });

        // ── Groups: query + colour, draggable (first match wins) ─────────────
        group(intBody, "Intersections/Groups", "Groups", 2, (gb) => {
          const listEl = gb.createEl("div", { cls: "ivg-rule-list" });
          const wrapEls: HTMLElement[] = [];
          settings.groups.forEach((rule, i) =>
            buildQueryRow({ listEl, wrapEls, rules: settings.groups, rule, index: i, hasColor: true, draggable: true })
          );
          const add = gb.createEl("button", { cls: "ivg-palette-add", text: "+" });
          add.setAttribute("aria-label", "New group");
          add.addEventListener("click", () => {
            const id = `g${(settings.groups.length ? Math.max(...settings.groups.map((x) => parseInt(x.id.replace(/\D/g, ""), 10) || 0)) : 0) + 1}`;
            settings.groups.push({ id, query: "", color: "#cccccc" });
            this.newQueryId = id;
            void this.plugin.saveSettings().then(() => this.render());
          });
        });
      });

      // ── Display: visual render params + Vaults (lights) sub-menu ──────────
      group(panel, "Display", "Display", 1, (db) => {
        const d = this.plugin.settings.display;
        // Live-apply a Display change (save + re-render visuals, NO reshuffle)
        const commit = async () => { await this.plugin.saveSettings(); this.applyDisplay?.(); };

        const slider = (
          label: string, key: keyof typeof d, min: number, max: number, step: number, fmt: (v: number) => string
        ) => {
          const row = db.createEl("div", { cls: "ivg-disp-row" });
          row.createEl("span", { cls: "ivg-disp-name", text: label });
          const input = row.createEl("input", { type: "range" });
          input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step);
          input.value = String(d[key]);
          const valEl = row.createEl("span", { cls: "ivg-disp-val", text: fmt(d[key] as number) });
          input.addEventListener("input", () => {
            (d as Record<string, unknown>)[key] = parseFloat(input.value);
            valEl.setText(fmt(parseFloat(input.value)));
            void commit();
          });
        };

        const toggle = (label: string, key: keyof typeof d) => {
          const row = db.createEl("label", { cls: "ivg-disp-row" });
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = d[key] as boolean;
          row.createEl("span", { cls: "ivg-disp-name", text: label });
          cb.addEventListener("change", () => {
            (d as Record<string, unknown>)[key] = cb.checked;
            void commit();
          });
        };

        slider("Intersection size", "intersectionSize", 2, 10, 1, (v) => String(v));
        slider("Braid amount", "bowScale", 0, 2, 0.1, (v) => v.toFixed(1));
        slider("Line thickness", "lineThickness", 0.5, 2.5, 0.1, (v) => v.toFixed(1));
        toggle("Intersection labels", "showIntersectionLabels");
        // Inline fade row: [checkbox] [label] [short slider] [value]
        {
          const row = db.createEl("div", { cls: "ivg-disp-row" });
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = d.fadeLabelsOnZoom;
          cb.addEventListener("change", () => { d.fadeLabelsOnZoom = cb.checked; void commit(); });
          row.createEl("span", { cls: "ivg-disp-name", text: "Fade zoom" });
          const sl = row.createEl("input", { type: "range" });
          sl.min = "0.5"; sl.max = "3.0"; sl.step = "0.1";
          sl.value = String(d.fadeLabelAt);
          sl.setCssStyles({ flex: "0 0 64px" }); // shorter so checkbox + label + val all fit
          const val = row.createEl("span", { cls: "ivg-disp-val", text: d.fadeLabelAt.toFixed(1) });
          sl.addEventListener("input", () => {
            d.fadeLabelAt = parseFloat(sl.value); val.setText(d.fadeLabelAt.toFixed(1)); void commit();
          });
        }
        toggle("Vault labels", "showVaultLabels");

        // ── Vaults: lights on/off per vault (was "Lighting") ────────────────
        group(db, "Display/Vaults", "Vaults", 2, (b) => {
          const dim = new Set(this.plugin.settings.dimVaults);
          vaults.forEach((meta) => {
            const ap = this.appearance.get(meta.name)!;
            const r = b.createEl("label", { cls: "ivg-vault-row" });
            // Order: [checkbox] [vault name] [colour dot indicator]
            const cb = r.createEl("input", { type: "checkbox" });
            cb.checked = !dim.has(meta.name);
            r.createEl("span", { cls: "ivg-vault-name", text: meta.name });
            const sw = r.createEl("span", { cls: "ivg-preset-dot" });
            sw.setCssStyles({ background: ap.color, pointerEvents: "none" });
            cb.addEventListener("change", () => {
              const set = new Set(this.plugin.settings.dimVaults);
              if (cb.checked) set.delete(meta.name);
              else set.add(meta.name);
              this.plugin.settings.dimVaults = [...set];
              void applyLive();
            });
          });
        });
      });

      // ── Restore Defaults (direct button, not collapsible) ────────────────
      const restoreBtn = panel.createEl("button", { cls: "ivg-restore-btn", text: "Restore Defaults" });
      restoreBtn.addEventListener("click", () => {
        const s = this.plugin.settings;
        // Reset all seed presets to factory values (fresh clone), keep custom ones
        const customs = s.palettes.filter((p) => !SEED_PALETTES.some((seed) => seed.id === p.id));
        s.palettes = [...SEED_PALETTES.map(clonePalette), ...customs];
        if (!s.palettes.some((p) => p.id === s.palette)) s.palette = s.palettes[0].id;
        s.dimVaults = [];
        s.filters = [];
        s.groups = defaultGroups();
        void this.plugin.saveSettings().then(() => this.render());
      });
    };

    populate();
  }

  /** Read contents of shared notes (bounded) and compute per-note content-cluster
   *  stats: total vaults, distinct versions, and largest identical-content group. */
  private computeNoteStats(data: GraphData): Map<string, NoteStats> {
    const out = new Map<string, NoteStats>();
    for (const title of data.sharedTitles) {
      const byVault = data.titleIndex.get(title);
      if (!byVault) continue;
      const clusters = new Map<string, number>(); // content → vault count
      let total = 0;
      for (const filePath of byVault.values()) {
        let content = "";
        try { content = fs.readFileSync(filePath, "utf8"); } catch { /* ignore */ }
        clusters.set(content, (clusters.get(content) ?? 0) + 1);
        total++;
      }
      let maxCluster = 0;
      for (const n of clusters.values()) if (n > maxCluster) maxCluster = n;
      out.set(title, { total, distinct: clusters.size, maxCluster });
    }
    return out;
  }

  private renderSvg(
    container: HTMLElement,
    scatter: { width: number; height: number; notes: NoteNode[]; vaults: VaultMeta[] },
    data: GraphData,
    statsMap: Map<string, NoteStats>
  ): HTMLElement {
    const root = svg("svg", {
      viewBox: `0 0 ${scatter.width} ${scatter.height}`,
      class: "ivg-svg",
      preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;

    // Pop/expand animation, retriggerable on every refresh (like the core graph)
    this.popGraph = () => {
      root.removeClass("ivg-pop");
      void root.getBoundingClientRect(); // reflow so the animation restarts
      root.addClass("ivg-pop");
    };

    // Zoom/pan group — all content lives inside this transformed <g>
    const zoomG = svg("g", {}) as SVGGElement;
    root.appendChild(zoomG);
    // Topmost layer (appended last) for vault name labels, so they're never
    // hidden by lines, dots, or intersection labels.
    const labelLayer = svg("g", {}) as SVGGElement;
    const zoom = { k: 1, tx: 0, ty: 0 };
    // Reassigned once the dots exist; lets applyZoom fade labels by zoom distance.
    let updateLabelFade: () => void = () => {};
    const applyZoom = () => {
      zoomG.setAttribute("transform", `translate(${zoom.tx} ${zoom.ty}) scale(${zoom.k})`);
      updateLabelFade();
    };

    const cx = scatter.width / 2;
    const cy = scatter.height / 2;
    const posById = new Map<string, Point>();

    // ── Build simulation bodies ─────────────────────────────────────────────
    // Anchors for every shared note. End-handles ONLY for vaults with ≤1 shared
    // note (so a standalone/single vault still draws as a line); vaults with ≥2
    // shared notes end their line AT the terminal shared notes — no rigid tails.
    const bodies: Body[] = scatter.notes.map((note) => ({
      id: note.title, x: note.pos.x, y: note.pos.y, vx: 0, vy: 0, fx: null, fy: null,
    }));

    const h0Id = (name: string) => `__h0__${name}`;
    const h1Id = (name: string) => `__h1__${name}`;
    const hasHandles = (meta: VaultMeta) => meta.order.length <= 1;

    scatter.vaults.forEach((meta, vi) => {
      if (!hasHandles(meta)) return;
      const anchor = meta.order.length === 1 ? bodies.find((b) => b.id === meta.order[0])! : null;
      const ang = (vi / scatter.vaults.length) * Math.PI * 2;
      const base = anchor ? { x: anchor.x, y: anchor.y } : { x: cx + Math.cos(ang) * 160, y: cy + Math.sin(ang) * 160 };
      bodies.push({ id: h0Id(meta.name), x: base.x - 45, y: base.y - 30, vx: 0, vy: 0, fx: null, fy: null });
      bodies.push({ id: h1Id(meta.name), x: base.x + 45, y: base.y + 30, vx: 0, vy: 0, fx: null, fy: null });
    });

    // ── Links ────────────────────────────────────────────────────────────────
    // Notes that co-occur in a vault are linked by springs (deduped), so moving
    // any intersection pulls everything connected to it — the graph feels alive.
    const links: Link[] = [];
    const linkSet = new Set<string>();
    const addLink = (a: string, b: string, distance: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (linkSet.has(key)) return;
      linkSet.add(key);
      links.push({ source: a, target: b, distance });
    };
    for (const meta of scatter.vaults) {
      const k = meta.order.length;
      if (k === 0) {
        addLink(h0Id(meta.name), h1Id(meta.name), 110);
      } else if (k === 1) {
        addLink(h0Id(meta.name), meta.order[0], 45);
        addLink(meta.order[0], h1Id(meta.name), 45);
      } else {
        // Consecutive chain → moving a note pulls its neighbours (transitively the
        // whole vault) without over-constraining the straight-line arrangement.
        for (let i = 0; i < k - 1; i++) addLink(meta.order[i], meta.order[i + 1], 130);
      }
    }
    const sim = new Simulation(bodies, links, cx, cy);
    // Balance: strong repulsion + soft centering/links so the graph spreads out
    sim.charge = -3400;
    sim.centerStrength = 0.018; // softer centering → standalone vaults drift further apart
    sim.linkStrength = 0.2;
    // Straighten each vault: pull its (3+) shared notes toward a straight line
    sim.alignGroups = scatter.vaults.filter((m) => m.order.length >= 3).map((m) => [...m.order]);
    sim.alignStrength = 0.10;
    for (const b of bodies) posById.set(b.id, { x: b.x, y: b.y });

    const segKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    // Each vault's note order along its line is FROZEN once the layout settles
    // (spatial order via PCA projection). Freezing — rather than recomputing each
    // frame — means a settled layout never folds, yet dragging a note keeps its
    // identity/position in the sequence (no reshuffle); pulling it off the line
    // just bends the line into a triangle.
    let frozenOrder: string[][] = scatter.vaults.map((m) => m.order.slice());
    let segSharers = new Map<string, number[]>();
    // Order tracks the settling layout until the user takes control, then freezes.
    let interacted = false;

    const buildSegSharers = () => {
      segSharers = new Map();
      frozenOrder.forEach((titles, vi) => {
        for (let i = 0; i < titles.length - 1; i++) {
          const key = segKey(titles[i], titles[i + 1]);
          if (!segSharers.has(key)) segSharers.set(key, []);
          segSharers.get(key)!.push(vi);
        }
      });
    };

    // Cache the projection order per vault so the (costlier) de-cross only runs
    // when that vault's spatial order actually changes — not every frame.
    const projCache = new Map<number, string>();
    const decrossCache = new Map<number, string[]>();

    const freezeOrders = () => {
      frozenOrder = scatter.vaults.map((meta, vi) => {
        const ts = meta.order;
        if (ts.length <= 2) return ts.slice();
        let gx = 0;
        let gy = 0;
        for (const t of ts) { const p = posById.get(t)!; gx += p.x; gy += p.y; }
        gx /= ts.length; gy /= ts.length;
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (const t of ts) {
          const p = posById.get(t)!;
          const ux = p.x - gx;
          const uy = p.y - gy;
          sxx += ux * ux; syy += uy * uy; sxy += ux * uy;
        }
        const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);
        const proj = (t: string) => { const p = posById.get(t)!; return (p.x - gx) * dx + (p.y - gy) * dy; };
        const ordered = [...ts].sort((a, b) => (proj(a) - proj(b)) || (a < b ? -1 : 1));

        // Only de-cross when the projection order changed since last frame
        const key = ordered.join("|");
        if (projCache.get(vi) === key && decrossCache.has(vi)) return decrossCache.get(vi)!;
        const fixed = deCross(ordered, (t) => posById.get(t)!);
        projCache.set(vi, key);
        decrossCache.set(vi, fixed);
        return fixed;
      });
      buildSegSharers();
    };

    buildSegSharers(); // initial (global) until the layout settles and we freeze

    // First manual interaction: lock the current note order and weaken the
    // collinearity force so the user's arrangement persists (no re-straightening).
    const onUserGrab = () => {
      if (interacted) return;
      interacted = true;
      sim.alignStrength = 0.01;
    };

    // ── Vault lines (drawn under the dots) ──────────────────────────────────
    interface LineEls { meta: VaultMeta; vi: number; path: SVGPathElement; inner: SVGPathElement | null; label: SVGElement; width: number; }
    const lineEls: LineEls[] = [];

    // Apply colour + lit/dim + line-TYPE to one line in place (so palette,
    // lighting, and line-type changes never require a full re-render/reshuffle).
    const applyLineAppearance = (le: LineEls) => {
      const ap = this.appearance.get(le.meta.name)!;
      const col = ap.dim ? DIM_COLOR : ap.color;
      const op = ap.dim ? "0.1" : "1";
      le.path.style.setProperty("--line-shade", col);
      le.path.style.opacity = op;
      le.path.style.strokeDasharray = ap.style === 1 ? "7 5" : "none"; // striped
      if (le.inner) {
        le.inner.style.display = ap.style === 2 ? "" : "none";          // double (hollow)
        le.inner.style.opacity = op;
      }
      le.label.style.fill = col;
      le.label.style.opacity = ap.dim ? "0.18" : "1";
    };

    scatter.vaults.forEach((meta, vi) => {
      const width = Math.min(3, 2 + meta.noteCount * 0.2); // line width grows with note count

      const path = svg("path", {
        fill: "none",
        "stroke-width": String(width),
        "stroke-linecap": "round",
        class: "ivg-vault-line",
      }) as SVGPathElement;
      const t = svg("title", {});
      t.textContent = `Vault: ${meta.name} (${meta.noteCount} notes) — drag to move, click to open`;
      path.appendChild(t);
      zoomG.appendChild(path);

      // Inner (background-coloured) path always exists; shown only for the double
      // style via applyLineAppearance → line-type can switch with no rebuild.
      const inner = svg("path", {
        fill: "none",
        stroke: "var(--background-primary)",
        "stroke-width": String(Math.max(0.8, width - 2.2)), // thinner core → smaller, easier-to-follow gap
        "stroke-linecap": "round",
        class: "ivg-vault-inner",
      }) as SVGPathElement;
      zoomG.appendChild(inner);

      const labelCls = meta.order.length === 0 ? "ivg-vault-label ivg-label-lone" : "ivg-vault-label";
      const label = svg("text", { class: labelCls, "text-anchor": "middle", "dominant-baseline": "central" });
      label.textContent = meta.name;
      labelLayer.appendChild(label); // topmost layer (added to zoomG after dots)

      const le: LineEls = { meta, vi, path, inner, label, width };

      // Hover emphasis (gentle): other LIT lines ease to 90% opacity, the hovered
      // line eases bolder. Dimmed (lights-off) lines are left untouched.
      path.addEventListener("mouseenter", () => {
        for (const other of lineEls) {
          if (other === le) continue;
          if (this.appearance.get(other.meta.name)?.dim) continue; // keep lights-off as-is
          other.path.setCssStyles({ opacity: "0.9" });
          if (other.inner) other.inner.setCssStyles({ opacity: "0.9" });
        }
        path.style.strokeWidth = String(width + 1.4);
      });
      path.addEventListener("mouseleave", () => {
        for (const other of lineEls) applyLineAppearance(other); // restore proper opacity
        path.style.strokeWidth = String(width);
      });

      applyLineAppearance(le);
      lineEls.push(le);

      // ── Make the whole line a moveable object ─────────────────────────────
      // Dragging a line translates all of its bodies (handles + its anchors).
      // Because anchors are shared, dragging a connected vault pushes its whole
      // cluster; a standalone vault's line moves on its own.
      const ownIds =
        meta.order.length === 0 ? [h0Id(meta.name), h1Id(meta.name)]
        : meta.order.length === 1 ? [h0Id(meta.name), meta.order[0], h1Id(meta.name)]
        : [...meta.order];

      let lDrag = false;
      let lMoved = false;
      let lStartClient = { x: 0, y: 0 };
      let lStartSvg = { x: 0, y: 0 };
      let lStartPos = new Map<string, Point>();

      const lMove = (e: MouseEvent) => {
        if (!lDrag) return;
        if (!lMoved && Math.hypot(e.clientX - lStartClient.x, e.clientY - lStartClient.y) < 4) return;
        lMoved = true;
        const p = toSvg(e);
        const dx = p.x - lStartSvg.x;
        const dy = p.y - lStartSvg.y;
        for (const id of ownIds) {
          const b = sim.get(id);
          const sp = lStartPos.get(id);
          if (!b || !sp) continue;
          b.fx = sp.x + dx; b.fy = sp.y + dy;
        }
        sim.reheat(0.5);
        ensureRunning();
      };
      const lUp = () => {
        if (!lDrag) return;
        lDrag = false;
        window.removeEventListener("mousemove", lMove);
        window.removeEventListener("mouseup", lUp);
        if (!lMoved) {
          this.openVault(meta.name); // click (no drag) = open vault
        } else {
          // Release back into the physics so the graph stays alive afterwards
          for (const id of ownIds) { const b = sim.get(id); if (b) { b.fx = null; b.fy = null; } }
          sim.reheat(0.3);
          ensureRunning();
        }
      };
      path.addEventListener("mousedown", (e) => {
        lDrag = true; lMoved = false;
        onUserGrab();
        lStartClient = { x: e.clientX, y: e.clientY };
        lStartSvg = toSvg(e);
        lStartPos = new Map(ownIds.map((id) => {
          const b = sim.get(id);
          return [id, b ? { x: b.x, y: b.y } : { x: 0, y: 0 }];
        }));
        window.addEventListener("mousemove", lMove);
        window.addEventListener("mouseup", lUp);
        e.stopPropagation();
        e.preventDefault();
      });
      path.addEventListener("dblclick", (e) => {
        for (const id of ownIds) { const b = sim.get(id); if (b) { b.fx = null; b.fy = null; } }
        sim.reheat(0.5);
        ensureRunning();
        e.stopPropagation();
        e.preventDefault();
      });
    });

    const refreshLine = (le: LineEls) => {
      const order = frozenOrder[le.vi] ?? le.meta.order; // frozen spatial order
      const bow = le.meta.bow;

      // Standalone (no shared notes) → straight line between the two handles
      if (order.length === 0) {
        const a = posById.get(h0Id(le.meta.name))!;
        const b = posById.get(h1Id(le.meta.name))!;
        const d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        le.path.setAttribute("d", d);
        if (le.inner) le.inner.setAttribute("d", d);
        this.placeVaultLabel(le.path, le.label, le.meta.labelEnd);
        return;
      }

      const aPts = order.map((t) => posById.get(t)!);
      const wp: Point[] = [];
      // Handles only for ≤1-note vaults; ≥2-note vaults end AT their anchors
      if (order.length <= 1) wp.push(posById.get(h0Id(le.meta.name))!);
      wp.push(aPts[0]);

      // ONE perpendicular for the whole vault axis (first→last note). Offsetting
      // every lobe along this same direction (sign flipping per segment) keeps the
      // weaver zig-zagging consistently across the spine, so it ALWAYS crosses at
      // each note even when the spine bends — no "same-side" tangle.
      const first = aPts[0];
      const last = aPts[aPts.length - 1];
      const axisLen = Math.hypot(last.x - first.x, last.y - first.y) || 1;
      const gpx = -(last.y - first.y) / axisLen;
      const gpy = (last.x - first.x) / axisLen;

      for (let i = 0; i < aPts.length - 1; i++) {
        const a = aPts[i];
        const b = aPts[i + 1];
        const sharers = segSharers.get(segKey(order[i], order[i + 1])) ?? [];
        const rank = sharers.indexOf(le.vi);
        // Fewest curves: the lowest-rank co-sharer is the STRAIGHT spine (rank 0);
        // higher ranks braid THROUGH it (crossing at each shared note).
        if (sharers.length >= 2 && rank > 0) {
          const side = rank % 2 === 1 ? 1 : -1;       // weavers fan to alternating sides
          const parity = i % 2 === 0 ? 1 : -1;        // swaps each segment → crosses spine at each note
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // Lobe scales with segment length → balanced braid, no short-segment wiggle.
          // Multiplied by the Display "Braid amount" (bowScale) so it's user-tunable.
          const amp = Math.min(70, (bow / 100) * len) * Math.ceil(rank / 2) * this.plugin.settings.display.bowScale;
          const px = gpx;
          const py = gpy;
          // Sample the sine finely (not just near the peak) → a clean rounded
          // lobe instead of a flat-topped "bulky" bump.
          const SAMPLES = 7;
          for (let s = 1; s <= SAMPLES; s++) {
            const u = s / (SAMPLES + 1);
            const off = amp * side * parity * Math.sin(Math.PI * u);
            wp.push({ x: a.x + dx * u + px * off, y: a.y + dy * u + py * off });
          }
        }
        wp.push(b);
      }

      if (order.length <= 1) wp.push(posById.get(h1Id(le.meta.name))!);

      // Extend slightly past the terminal intersections (continue the end tangent)
      // so a line reads as passing THROUGH intersections, not as a closed structure.
      if (order.length >= 2) {
        // Stretch the ends further as more vaults are present → spreads labels to
        // the edges, reduces central tangle, and keeps zoom meaningful.
        const EXT = 50 + scatter.vaults.length * 16;
        const ext = (from: Point, toward: Point): Point | null => {
          const dx = from.x - toward.x;
          const dy = from.y - toward.y;
          const m = Math.hypot(dx, dy);
          if (m < 0.001) return null;
          return { x: from.x + (dx / m) * EXT, y: from.y + (dy / m) * EXT };
        };
        // Continue each line's OWN curve from its latest waypoint (which, for a
        // weaver, includes its perpendicular-offset sample) — not the anchor tangent.
        const startExt = ext(wp[0], wp[1]);
        if (startExt) wp.unshift(startExt);
        const endExt = ext(wp[wp.length - 1], wp[wp.length - 2]);
        if (endExt) wp.push(endExt);
      }

      const d = smoothPath(wp);
      le.path.setAttribute("d", d);
      if (le.inner) le.inner.setAttribute("d", d);
      this.placeVaultLabel(le.path, le.label, le.meta.labelEnd);
    };

    // ── Draggable shared-note dots ──────────────────────────────────────────
    const placers: Array<() => void> = [];
    const dotEls: Array<{ c: SVGElement; label: SVGElement; stats: NoteStats; vaults: string[] }> = [];
    // Map a mouse event into simulation space (accounts for zoom/pan transform)
    const toSvg = (e: MouseEvent): Point => {
      const pt = root.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const sp = pt.matrixTransform(zoomG.getScreenCTM()!.inverse());
      return { x: sp.x, y: sp.y };
    };

    for (const note of scatter.notes) {
      const g = svg("g", { class: "ivg-note" });
      const stats = statsMap.get(note.title) ?? { total: note.vaults.length, distinct: 1, maxCluster: note.vaults.length };
      const differs = stats.distinct > 1;
      const c = svg("circle", { class: "ivg-note-dot" }); // radius via --dot-r (Display)
      const dimSet0 = new Set(this.plugin.settings.dimVaults);
      const anyLit0 = note.vaults.some((v) => !dimSet0.has(v));
      c.style.fill = this.classifyDot(stats);
      // Hidden when it floats in free space (no lit vault line carries it)
      c.style.display = anyLit0 ? "" : "none";
      // Grey title label under each dot; CSS enlarges it on hover for readability
      const noteLabel = svg("text", {
        class: "ivg-note-label", "text-anchor": "middle", "dominant-baseline": "hanging",
      });
      noteLabel.textContent = note.title;
      const showLbl0 = this.plugin.settings.display.showIntersectionLabels;
      noteLabel.style.display = (anyLit0 && showLbl0) ? "" : "none";
      dotEls.push({ c, label: noteLabel, stats, vaults: note.vaults });
      const tip = svg("title", {});
      tip.textContent = `In: ${note.vaults.join(", ")}\n${differs ? "Versions DIFFER" : "Identical"} — drag to move, click to ${differs ? "diff/merge" : "open"}`;
      g.appendChild(c);
      g.appendChild(noteLabel);
      g.appendChild(tip);

      const place = () => {
        const p = posById.get(note.title)!;
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        noteLabel.setAttribute("x", String(p.x));
        noteLabel.setAttribute("y", String(p.y + this.plugin.settings.display.intersectionSize + 3)); // below the dot
      };
      placers.push(place);
      place();

      let dragging = false;
      let moved = false;
      let startClient = { x: 0, y: 0 };
      const body = sim.get(note.title)!;

      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        if (!moved && Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) < 4) return;
        moved = true;
        g.addClass("dragging");
        const p = toSvg(e);
        body.fx = p.x; body.fy = p.y; // pin to cursor
        sim.reheat(0.5);
        ensureRunning();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        g.removeClass("dragging");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!moved) {
          body.fx = null; body.fy = null; // release the pin set on mousedown
          this.onNoteClick(note.title, data);
        } else {
          // Release back into the physics so the graph keeps reacting afterwards
          body.fx = null; body.fy = null;
          sim.reheat(0.3);
          ensureRunning();
        }
      };
      g.addEventListener("mousedown", (e) => {
        dragging = true; moved = false;
        onUserGrab();
        startClient = { x: e.clientX, y: e.clientY };
        body.fx = body.x; body.fy = body.y;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        e.preventDefault();
      });

      zoomG.appendChild(g);
    }

    // Vault labels go on top of everything (dots + intersection labels)
    zoomG.appendChild(labelLayer);

    const wrap = container.createEl("div", { cls: "ivg-svg-wrap" });
    wrap.appendChild(root);

    // ── Zoom (wheel) and pan (drag empty space) ─────────────────────────────
    root.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * scatter.width;   // root user-space
      const sy = ((e.clientY - rect.top) / rect.height) * scatter.height;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k2 = Math.max(0.2, Math.min(6, zoom.k * factor));
      // Keep the point under the cursor fixed
      zoom.tx = sx - (sx - zoom.tx) * (k2 / zoom.k);
      zoom.ty = sy - (sy - zoom.ty) * (k2 / zoom.k);
      zoom.k = k2;
      applyZoom();
    }, { passive: false });

    let panning = false;
    let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
    root.addEventListener("mousedown", (e) => {
      if (e.target !== root && e.target !== zoomG) return; // only empty background
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
      const rect = root.getBoundingClientRect();
      const scaleX = scatter.width / rect.width;
      const scaleY = scatter.height / rect.height;
      const onPan = (ev: MouseEvent) => {
        if (!panning) return;
        zoom.tx = panStart.tx + (ev.clientX - panStart.x) * scaleX;
        zoom.ty = panStart.ty + (ev.clientY - panStart.y) * scaleY;
        applyZoom();
      };
      const onPanUp = () => {
        panning = false;
        window.removeEventListener("mousemove", onPan);
        window.removeEventListener("mouseup", onPanUp);
      };
      window.addEventListener("mousemove", onPan);
      window.addEventListener("mouseup", onPanUp);
    });

    // Push apart any vault labels whose boxes overlap, so each name stays
    // readable (vertical separation = least disruption to the "points-to" feel).
    const labelDims = new Map<SVGElement, { w: number; h: number }>();
    const resolveVaultLabels = () => {
      const items = lineEls.map((le) => {
        let dim = labelDims.get(le.label);
        if (!dim) {
          try { const bb = (le.label as SVGGraphicsElement).getBBox(); dim = { w: bb.width, h: bb.height }; labelDims.set(le.label, dim); }
          catch { return null; }
        }
        return {
          label: le.label,
          x: parseFloat(le.label.getAttribute("x") || "0"),
          y: parseFloat(le.label.getAttribute("y") || "0"),
          w: dim.w, h: dim.h,
        };
      }).filter((v): v is NonNullable<typeof v> => v !== null);

      for (let iter = 0; iter < 8; iter++) {
        let moved = false;
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            const padX = (a.w + b.w) / 2 + 2;
            const padY = (a.h + b.h) / 2 + 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            if (Math.abs(dx) < padX && Math.abs(dy) < padY) {
              const push = (padY - Math.abs(dy)) / 2 + 0.5;
              const dir = dy === 0 ? (i < j ? -1 : 1) : Math.sign(dy);
              a.y -= dir * push; b.y += dir * push;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      for (const it of items) it.label.setAttribute("y", String(it.y));
    };

    // ── In-place restyle hooks (palette / lit-dim changes; no re-render) ──────
    this.reapply = () => lineEls.forEach(applyLineAppearance);
    this.refreshLines = () => { lineEls.forEach(refreshLine); resolveVaultLabels(); };
    this.redrawDots = () => {
      const dimSet = new Set(this.plugin.settings.dimVaults);
      const showLbl = this.plugin.settings.display.showIntersectionLabels;
      for (const d of dotEls) {
        // Hide an intersection when ALL of its vaults are lights-off (floats free)
        const anyLit = d.vaults.some((v) => !dimSet.has(v));
        d.c.style.fill = this.classifyDot(d.stats);
        d.c.style.display = anyLit ? "" : "none";
        d.label.style.display = (anyLit && showLbl) ? "" : "none";
      }
    };

    // Intersection-label opacity by zoom distance (fades out as you zoom OUT).
    updateLabelFade = () => {
      const d = this.plugin.settings.display;
      let op = 1;
      if (!d.showIntersectionLabels) op = 0;
      else if (d.fadeLabelsOnZoom) {
        const hi = d.fadeLabelAt;
        const lo = Math.max(0, hi - 0.55);
        op = hi > lo ? Math.max(0, Math.min(1, (zoom.k - lo) / (hi - lo))) : 1;
      }
      const s = String(op);
      for (const de of dotEls) de.label.style.opacity = s;
    };

    // Apply all visual (Display) params live — no reshuffle/re-render.
    this.applyDisplay = () => {
      const d = this.plugin.settings.display;
      for (const de of dotEls) {
        de.c.style.setProperty("--dot-r", `${d.intersectionSize}px`);
        de.c.style.setProperty("--dot-r-hover", `${d.intersectionSize + 2}px`);
      }
      for (const le of lineEls) {
        const w = le.width * d.lineThickness;
        le.path.setAttribute("stroke-width", String(w));
        if (le.inner) le.inner.setAttribute("stroke-width", String(Math.max(0.8, w - 2.2)));
      }
      labelLayer.style.display = d.showVaultLabels ? "" : "none";
      placers.forEach((p) => p());     // reposition dots/labels (size offset)
      lineEls.forEach(refreshLine);    // redraw paths (bow amount)
      resolveVaultLabels();
      this.redrawDots?.();             // label on/off
      updateLabelFade();               // opacity by zoom
    };

    // ── Simulation loop ─────────────────────────────────────────────────────
    const syncAndDraw = () => {
      for (const b of sim.bodies) posById.set(b.id, { x: b.x, y: b.y });
      if (!interacted) freezeOrders(); // track spatial order while auto-settling
      placers.forEach((p) => p());
      lineEls.forEach(refreshLine);
      resolveVaultLabels();
    };
    const loop = () => {
      const alive = sim.tick();
      syncAndDraw();
      this.rafId = alive ? window.requestAnimationFrame(loop) : null;
    };
    const ensureRunning = () => {
      if (this.rafId === null) this.rafId = window.requestAnimationFrame(loop);
    };

    // Warm-up: pre-settle the layout off-screen so it doesn't load clumped.
    // Order is tracked (not frozen) until the user first drags, so the settling
    // layout always renders in correct spatial order (no fold), then locks.
    for (let i = 0; i < 300; i++) sim.tick();
    sim.reheat(0.15); // a little life left so it eases in
    syncAndDraw();
    this.applyDisplay?.(); // initial dot size / line thickness / label visibility
    this.rafId = window.requestAnimationFrame(loop);

    this.popGraph?.(); // pop/expand on load
    return wrap;
  }

  /** Place a vault label just beyond one extended end, so that end "points to" it. */
  private placeVaultLabel(path: SVGPathElement, label: SVGElement, end: 0 | 1) {
    let total = 0;
    try { total = path.getTotalLength(); } catch { /* not yet measurable */ }
    if (!total) return;
    const at = end === 0 ? 0 : total;
    const innerAt = end === 0 ? Math.min(12, total) : Math.max(0, total - 12);
    let tip: { x: number; y: number };
    let inner: { x: number; y: number };
    try {
      tip = path.getPointAtLength(at);
      inner = path.getPointAtLength(innerAt);
    } catch { return; }
    const dx = tip.x - inner.x;
    const dy = tip.y - inner.y;
    const m = Math.hypot(dx, dy) || 1;
    // Place the label's CENTRE on the line's extended direction, a bit further out.
    const gap = 26;
    label.setAttribute("x", String(tip.x + (dx / m) * gap));
    label.setAttribute("y", String(tip.y + (dy / m) * gap));
  }

  private openVault(name: string) {
    window.open(`obsidian://open?vault=${encodeURIComponent(name)}`);
  }

  private openNoteByPath(filePath: string) {
    // Absolute-path URI is unambiguous regardless of how Obsidian named the vault
    window.open(`obsidian://open?path=${encodeURIComponent(filePath)}`);
  }

  private onNoteClick(title: string, data: GraphData) {
    const byVault = data.titleIndex.get(title);
    if (!byVault) return;

    const entries = [...byVault.entries()]; // [vaultName, filePath]

    // Read each version's content (lazily — only now, on click)
    const versions = entries.map(([vaultName, filePath]) => {
      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch (e) {
        content = `<<could not read: ${String(e)}>>`;
      }
      return { vaultName, filePath, content };
    });

    // All identical → open it in the ACTIVE vault (this Obsidian window)
    const allSame = versions.every((v) => v.content === versions[0].content);
    if (allSame) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(title, "");
      if (dest) {
        void this.app.workspace.getLeaf(false).openFile(dest);
      } else {
        // Not present in the active vault — fall back to opening by absolute path
        this.openNoteByPath(versions[0].filePath);
      }
      return;
    }

    new MergeModal(this.app, title, versions, (filePath) => this.openNoteByPath(filePath)).open();
  }
}

interface NoteVersion {
  vaultName: string;
  filePath: string;
  content: string;
}

interface MergeRow {
  left: string | null;
  right: string | null;
}

/** A contiguous run of differing rows. */
interface RowHunk {
  start: number; // index into rows
  end: number;   // exclusive
}

class MergeModal extends Modal {
  private leftIdx = 0;
  private rightIdx = 1;
  private leftText = "";
  private rightText = "";
  private rows: MergeRow[] = [];
  private bodyEl!: HTMLElement;

  constructor(
    app: App,
    private title: string,
    private versions: NoteVersion[],
    private openByPath: (filePath: string) => void
  ) {
    super(app);
  }

  onOpen() {
    this.modalEl.addClass("ivg-merge-modal");
    this.titleEl.setText(this.title);
    this.loadTexts();
    this.buildShell();
  }

  private loadTexts() {
    this.leftText = this.versions[this.leftIdx].content;
    this.rightText = this.versions[this.rightIdx].content;
  }

  // ── Build static shell once; the diff body re-renders on changes ──────────
  private buildShell() {
    const c = this.contentEl;
    c.empty();

    // Vault count line (italic, top of modal)
    c.createEl("em", {
      cls: "ivg-merge-count",
      text: `Exists in ${this.versions.length} total vault${this.versions.length !== 1 ? "s" : ""}`,
    });

    // Column headers — embedded <select> for 3+ vaults, plain bold text for 2
    const head = c.createEl("div", { cls: "ivg-diff-row ivg-diff-headrow" });
    const leftHead = head.createEl("div", { cls: "ivg-diff-cell" });
    head.createEl("div", { cls: "ivg-diff-gutter" });
    const rightHead = head.createEl("div", { cls: "ivg-diff-cell" });

    if (this.versions.length > 2) {
      const mkSelect = (cell: HTMLElement, which: "left" | "right", current: number) => {
        const sel = cell.createEl("select", { cls: "ivg-head-select" });
        this.versions.forEach((v, i) => {
          const opt = sel.createEl("option", { text: v.vaultName, value: String(i) });
          if (i === current) opt.selected = true;
        });
        sel.addEventListener("change", () => {
          if (which === "left") this.leftIdx = parseInt(sel.value, 10);
          else this.rightIdx = parseInt(sel.value, 10);
          this.loadTexts();
          this.buildShell();
        });
      };
      mkSelect(leftHead, "left", this.leftIdx);
      mkSelect(rightHead, "right", this.rightIdx);
    } else {
      leftHead.setText(this.versions[this.leftIdx].vaultName);
      rightHead.setText(this.versions[this.rightIdx].vaultName);
    }

    // Editable, color-coded diff body
    this.bodyEl = c.createEl("div", { cls: "ivg-merge-body" });

    // Bottom bar: each column gets its own Copy + Save stack, pinned to its edge
    const saveBar = c.createEl("div", { cls: "ivg-save-bar" });

    const leftWrap = saveBar.createEl("div", { cls: "ivg-save-left" });
    const copyR = leftWrap.createEl("button", { cls: "ivg-save-btn", text: "Copy all →" });
    copyR.addEventListener("mousedown", (e) => e.preventDefault());
    copyR.addEventListener("click", () => this.copyAll("left-to-right"));
    const saveL = leftWrap.createEl("button", { cls: "ivg-save-btn", text: `Save ${this.versions[this.leftIdx].vaultName}` });
    saveL.addEventListener("mousedown", (e) => e.preventDefault());
    saveL.addEventListener("click", () => this.save("left"));

    saveBar.createEl("div", { cls: "ivg-save-gutter" });

    const rightWrap = saveBar.createEl("div", { cls: "ivg-save-right" });
    const copyL = rightWrap.createEl("button", { cls: "ivg-save-btn", text: "← Copy all" });
    copyL.addEventListener("mousedown", (e) => e.preventDefault());
    copyL.addEventListener("click", () => this.copyAll("right-to-left"));
    const saveR = rightWrap.createEl("button", { cls: "ivg-save-btn", text: `Save ${this.versions[this.rightIdx].vaultName}` });
    saveR.addEventListener("mousedown", (e) => e.preventDefault());
    saveR.addEventListener("click", () => this.save("right"));

    this.recomputeRows();
    this.renderBody();
  }

  private recomputeRows() {
    this.rows = lineDiff(this.leftText, this.rightText).map((r) => ({ left: r.left, right: r.right }));
  }

  private rowOp(r: MergeRow): "same" | "add" | "del" | "changed" {
    if (r.left !== null && r.right !== null) return r.left === r.right ? "same" : "changed";
    if (r.left !== null) return "del";
    return "add";
  }

  private hunks(): RowHunk[] {
    const out: RowHunk[] = [];
    let start = -1;
    this.rows.forEach((r, i) => {
      const diff = this.rowOp(r) !== "same";
      if (diff && start === -1) start = i;
      if (!diff && start !== -1) { out.push({ start, end: i }); start = -1; }
    });
    if (start !== -1) out.push({ start, end: this.rows.length });
    return out;
  }

  // ── Render the editable diff body ─────────────────────────────────────────
  private renderBody() {
    const el = this.bodyEl;
    el.empty();

    const hunkOf = new Map<number, RowHunk>();
    for (const h of this.hunks()) hunkOf.set(h.start, h);

    this.rows.forEach((row, i) => {
      const op = this.rowOp(row);
      const rowEl = el.createEl("div", { cls: `ivg-diff-row ivg-op-${op}` });

      this.makeCell(rowEl, row, "left", op);

      // Gutter: show copy buttons only on the first row of each hunk
      const gutter = rowEl.createEl("div", { cls: "ivg-diff-gutter" });
      const hunk = hunkOf.get(i);
      if (hunk) {
        const toRight = gutter.createEl("button", { cls: "ivg-copy-btn", text: "▶" });
        toRight.setAttribute("aria-label", "Use left for this block");
        toRight.addEventListener("mousedown", (e) => e.preventDefault());
        toRight.addEventListener("click", () => this.applyHunk(hunk, "left-to-right"));
        const toLeft = gutter.createEl("button", { cls: "ivg-copy-btn", text: "◀" });
        toLeft.setAttribute("aria-label", "Use right for this block");
        toLeft.addEventListener("mousedown", (e) => e.preventDefault());
        toLeft.addEventListener("click", () => this.applyHunk(hunk, "right-to-left"));
      }

      this.makeCell(rowEl, row, "right", op);
    });
  }

  private makeCell(rowEl: HTMLElement, row: MergeRow, side: "left" | "right", op: string) {
    const value = side === "left" ? row.left : row.right;
    const cell = rowEl.createEl("div", { cls: `ivg-diff-cell ivg-diff-${side}` });

    if (value === null) {
      cell.addClass("ivg-cell-absent");
      return; // no line on this side — not editable
    }

    cell.setAttribute("contenteditable", "true");
    cell.setAttribute("spellcheck", "false");
    cell.innerText = value;

    // Live edits update the model + text; recolor only when leaving the line.
    cell.addEventListener("input", () => {
      const text = cell.innerText ?? "";
      if (side === "left") row.left = text;
      else row.right = text;
      this.recomputeTextsFromRows();
    });
    cell.addEventListener("blur", (e) => {
      // Re-align/recolor only when focus leaves the editor entirely (avoids
      // rebuilding the DOM out from under a click on the next cell).
      const next = (e as FocusEvent).relatedTarget;
      if (next && this.bodyEl.contains(next)) return;
      this.recomputeRows();
      this.renderBody();
    });
  }

  private recomputeTextsFromRows() {
    this.leftText = this.rows.filter((r) => r.left !== null).map((r) => r.left).join("\n");
    this.rightText = this.rows.filter((r) => r.right !== null).map((r) => r.right).join("\n");
  }

  private applyHunk(hunk: RowHunk, dir: "left-to-right" | "right-to-left") {
    for (let i = hunk.start; i < hunk.end; i++) {
      const r = this.rows[i];
      if (dir === "left-to-right") r.right = r.left;
      else r.left = r.right;
    }
    // Drop rows that became empty on both sides
    this.rows = this.rows.filter((r) => !(r.left === null && r.right === null));
    this.recomputeTextsFromRows();
    this.recomputeRows();
    this.renderBody();
  }

  private copyAll(dir: "left-to-right" | "right-to-left") {
    if (dir === "left-to-right") this.rightText = this.leftText;
    else this.leftText = this.rightText;
    this.recomputeRows();
    this.renderBody();
  }

  private save(side: "left" | "right") {
    const version = side === "left" ? this.versions[this.leftIdx] : this.versions[this.rightIdx];
    const text = side === "left" ? this.leftText : this.rightText;
    try {
      fs.writeFileSync(version.filePath, text, "utf8");
      version.content = text;
      new Notice(`Saved "${this.title}" → ${version.vaultName}`);
    } catch (e) {
      new Notice(`Save failed: ${String(e)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
