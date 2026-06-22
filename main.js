"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => IntervaultGraphPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var path = __toESM(require("path"));
var seed = (id, name, colors) => ({ id, name, colors, vaultColors: {}, vaultStyles: {} });
var SEED_PALETTES = [
  seed("spy", "Espion", ["#ffffff", "#000000", "#888888"]),
  // white, black, mid-grey (high contrast)
  seed("nature", "Nature", ["#5b4636", "#2e8b57", "#d8c9a3"]),
  // dark brown, emerald, sand beige
  seed("ice", "Ice", ["#a8d8ea", "#1f3a5f", "#2a6f97"]),
  // icy, dark, ocean blue
  seed("flame", "Flame", ["#e03b2f", "#ffcc00", "#f5f0e1"]),
  // fire red, DHL yellow, cream
  seed("magic", "Magic", ["#d6409f", "#6c4ce0", "#3a1a5e"])
  // magenta, obsidian purple, dark violet
];
function clonePalette(p) {
  return {
    ...p,
    colors: [...p.colors],
    vaultColors: { ...p.vaultColors },
    vaultStyles: { ...p.vaultStyles }
  };
}
function defaultGroups() {
  return [
    { id: "g1", query: "Diff(2+)", color: "#efe28a" },
    { id: "g2", query: "Merged(*)", color: "#5a5c63" }
  ];
}
function defaultDisplay() {
  return {
    intersectionSize: 5,
    bowScale: 1,
    lineThickness: 1,
    showIntersectionLabels: true,
    fadeLabelsOnZoom: true,
    fadeLabelAt: 1,
    showVaultLabels: true
  };
}
var DEFAULT_SETTINGS = {
  vaultPaths: [],
  palette: "spy",
  dimVaults: [],
  palettes: SEED_PALETTES.map(clonePalette),
  filters: [],
  groups: defaultGroups(),
  display: defaultDisplay()
};
function toVaultConfigs(paths) {
  return paths.map((p) => p.trim()).filter((p) => p.length > 0).map((p) => ({ name: path.basename(p.replace(/[\\/]+$/, "")), path: p }));
}
var IntervaultSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Intervault Graph").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Enter one absolute vault folder path per line. The folder name becomes the vault's display name and the name used to open it (obsidian://open?vault=NAME)."
    });
    new import_obsidian.Setting(containerEl).setName("Vault folder paths").setDesc("One absolute path per line.").addTextArea((ta) => {
      ta.setPlaceholder("C:\\Users\\you\\Vaults\\Work\nC:\\Users\\you\\Vaults\\Personal");
      ta.setValue(this.plugin.settings.vaultPaths.join("\n"));
      ta.inputEl.rows = 8;
      ta.inputEl.setCssStyles({ width: "100%" });
      ta.onChange(async (value) => {
        this.plugin.settings.vaultPaths = value.split("\n");
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Open graph").setDesc("Reads the configured folders (filenames only) and renders the graph.").addButton(
      (btn) => btn.setButtonText("Open graph").setCta().onClick(() => this.plugin.openGraphView())
    );
  }
};

// src/view.ts
var import_obsidian2 = require("obsidian");
var fs2 = __toESM(require("fs"));

// src/index.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function collectMarkdown(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path2.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(full, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}
function buildGraphData(vaults) {
  const titleIndex = /* @__PURE__ */ new Map();
  for (const vault of vaults) {
    const files = collectMarkdown(vault.path);
    for (const file of files) {
      const title = path2.basename(file, ".md");
      if (!titleIndex.has(title)) titleIndex.set(title, /* @__PURE__ */ new Map());
      const byVault = titleIndex.get(title);
      if (!byVault.has(vault.name)) byVault.set(vault.name, file);
    }
  }
  const sharedTitles = [];
  for (const [title, byVault] of titleIndex) {
    if (byVault.size >= 2) sharedTitles.push(title);
  }
  sharedTitles.sort();
  return { vaults, titleIndex, sharedTitles };
}

// src/layout.ts
var PALETTE = [
  "#e06c75",
  "#61afef",
  "#98c379",
  "#c678dd",
  "#e5c07b",
  "#56b6c2",
  "#d19a66",
  "#be5046",
  "#528bff",
  "#7f848e"
];
function smoothPath(pts) {
  var _a, _b;
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  const EPS = 1e-3;
  const knot = (a, b) => Math.sqrt(Math.max(EPS, Math.hypot(a.x - b.x, a.y - b.y)));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = (_a = pts[i - 1]) != null ? _a : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = (_b = pts[i + 2]) != null ? _b : pts[i + 1];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const m1x = (t2 - t1) * ((p1.x - p0.x) / (t1 - t0) - (p2.x - p0.x) / (t2 - t0) + (p2.x - p1.x) / (t2 - t1));
    const m1y = (t2 - t1) * ((p1.y - p0.y) / (t1 - t0) - (p2.y - p0.y) / (t2 - t0) + (p2.y - p1.y) / (t2 - t1));
    const m2x = (t2 - t1) * ((p2.x - p1.x) / (t2 - t1) - (p3.x - p1.x) / (t3 - t1) + (p3.x - p2.x) / (t3 - t2));
    const m2y = (t2 - t1) * ((p2.y - p1.y) / (t2 - t1) - (p3.y - p1.y) / (t3 - t1) + (p3.y - p2.y) / (t3 - t2));
    const c1x = p1.x + m1x / 3;
    const c1y = p1.y + m1y / 3;
    const c2x = p2.x - m2x / 3;
    const c2y = p2.y - m2y / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
function computeScatter(data, width = 900, height = 620) {
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.46;
  const titles = [...data.sharedTitles];
  const notes = [];
  titles.forEach((title) => {
    var _a, _b;
    const theta = Math.random() * Math.PI * 2;
    const r = R * Math.sqrt(Math.random());
    notes.push({
      title,
      pos: { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) },
      vaults: [...(_b = (_a = data.titleIndex.get(title)) == null ? void 0 : _a.keys()) != null ? _b : []]
    });
  });
  const vaults = data.vaults.map((vault, vi) => {
    let total = 0;
    for (const vmap of data.titleIndex.values()) if (vmap.has(vault.name)) total++;
    const lightness = 50 + vi * 47 % 30;
    return {
      name: vault.name,
      color: PALETTE[vi % PALETTE.length],
      order: titles.filter((t) => {
        var _a;
        return (_a = data.titleIndex.get(t)) == null ? void 0 : _a.has(vault.name);
      }),
      bow: 19 + Math.random() * 13,
      // 19–32, fixed once per layout
      noteCount: total,
      labelEnd: Math.random() < 0.5 ? 0 : 1,
      shade: `hsl(225, 7%, ${lightness}%)`
    };
  });
  return { width, height, notes, vaults };
}

// src/force.ts
var Simulation = class {
  constructor(bodies, links, cx, cy) {
    this.alpha = 1;
    this.alphaMin = 1e-3;
    this.alphaDecay = 0.022;
    this.friction = 0.6;
    // velocity retained per tick
    this.charge = -1600;
    // repulsion strength (negative = repel)
    this.linkStrength = 0.35;
    this.centerStrength = 0.05;
    this.maxDisplace = 60;
    // clamp per-tick movement for stability
    // Collinearity: each group of body ids is pulled toward its own best-fit
    // straight line, so a vault renders as a near-straight line (and overlapping
    // vaults can be drawn straight + weaving rather than both curving).
    this.alignGroups = [];
    this.alignStrength = 0.09;
    this.bodies = bodies;
    this.byId = new Map(bodies.map((b) => [b.id, b]));
    this.links = links;
    this.cx = cx;
    this.cy = cy;
  }
  get(id) {
    return this.byId.get(id);
  }
  reheat(a = 0.6) {
    if (this.alpha < a) this.alpha = a;
  }
  /** Advance one tick. Returns false when the simulation has cooled. */
  tick() {
    if (this.alpha < this.alphaMin) return false;
    this.alpha += (0 - this.alpha) * this.alphaDecay;
    const a = this.alpha;
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = this.bodies[j];
        let dx = bi.x - bj.x;
        let dy = bi.y - bj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 === 0) {
          dx = Math.cos(i) * 0.5;
          dy = Math.sin(j) * 0.5;
          d2 = 0.25;
        }
        const dist = Math.sqrt(d2);
        const f = this.charge * a / d2;
        const fx = dx / dist * f;
        const fy = dy / dist * f;
        bi.vx -= fx;
        bi.vy -= fy;
        bj.vx += fx;
        bj.vy += fy;
      }
    }
    for (const b of this.bodies) {
      b.vx += (this.cx - b.x) * this.centerStrength * a;
      b.vy += (this.cy - b.y) * this.centerStrength * a;
    }
    for (const link of this.links) {
      const s = this.byId.get(link.source);
      const t = this.byId.get(link.target);
      if (!s || !t) continue;
      let dx = t.x - s.x;
      let dy = t.y - s.y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const diff = (dist - link.distance) / dist * this.linkStrength * a;
      const ox = dx * diff * 0.5;
      const oy = dy * diff * 0.5;
      s.vx += ox;
      s.vy += oy;
      t.vx -= ox;
      t.vy -= oy;
    }
    for (const group of this.alignGroups) {
      if (group.length < 3) continue;
      const ps = [];
      let gx = 0;
      let gy = 0;
      for (const id of group) {
        const b = this.byId.get(id);
        if (b) {
          ps.push(b);
          gx += b.x;
          gy += b.y;
        }
      }
      if (ps.length < 3) continue;
      gx /= ps.length;
      gy /= ps.length;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const b of ps) {
        const ux = b.x - gx;
        const uy = b.y - gy;
        sxx += ux * ux;
        syy += uy * uy;
        sxy += ux * uy;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const dlx = Math.cos(theta);
      const dly = Math.sin(theta);
      for (const b of ps) {
        const tproj = (b.x - gx) * dlx + (b.y - gy) * dly;
        const projx = gx + dlx * tproj;
        const projy = gy + dly * tproj;
        b.vx += (projx - b.x) * this.alignStrength * a;
        b.vy += (projy - b.y) * this.alignStrength * a;
      }
    }
    for (const b of this.bodies) {
      if (b.fx !== null) {
        b.x = b.fx;
        b.vx = 0;
      } else {
        b.vx *= this.friction;
        b.vx = Math.max(-this.maxDisplace, Math.min(this.maxDisplace, b.vx));
        b.x += b.vx;
      }
      if (b.fy !== null) {
        b.y = b.fy;
        b.vy = 0;
      } else {
        b.vy *= this.friction;
        b.vy = Math.max(-this.maxDisplace, Math.min(this.maxDisplace, b.vy));
        b.y += b.vy;
      }
    }
    return true;
  }
};

// src/diff.ts
function lineDiff(a, b) {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i2 = m - 1; i2 >= 0; i2--) {
    for (let j2 = n - 1; j2 >= 0; j2--) {
      dp[i2][j2] = aLines[i2] === bLines[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      rows.push({ op: "same", left: aLines[i], right: bLines[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ op: "del", left: aLines[i], right: null });
      i++;
    } else {
      rows.push({ op: "add", left: null, right: bLines[j] });
      j++;
    }
  }
  while (i < m) {
    rows.push({ op: "del", left: aLines[i++], right: null });
  }
  while (j < n) {
    rows.push({ op: "add", left: null, right: bLines[j++] });
  }
  return rows;
}

// src/view.ts
var GRAPH_VIEW_TYPE = "intervault-graph-view";
var SVGNS = "http://www.w3.org/2000/svg";
var GREY = "#888888";
var FN_ALIASES = {
  diff: "diff",
  differ: "diff",
  merge: "merge",
  merged: "merge",
  meet: "meet",
  meets: "meet",
  cut: "meet"
};
var FN_CAP = { diff: "Diff", merge: "Merged", meet: "Meet" };
function parseQuery(s) {
  const m = s.trim().match(/^([a-zA-Z]+)\(\s*(\*|\d+\s*[+-]?)\s*\)$/);
  if (!m) return null;
  const fn = FN_ALIASES[m[1].toLowerCase()];
  if (!fn) return null;
  const tok = m[2].replace(/\s+/g, "");
  if (tok === "*") return { fn, op: "all", n: 0 };
  let mm;
  if (mm = tok.match(/^(\d+)\+$/)) return { fn, op: "gte", n: parseInt(mm[1], 10) };
  if (mm = tok.match(/^(\d+)-$/)) return { fn, op: "lte", n: parseInt(mm[1], 10) };
  if (mm = tok.match(/^(\d+)$/)) return { fn, op: "eq", n: parseInt(mm[1], 10) };
  return null;
}
function matchQuery(t, s) {
  const basis = t.fn === "diff" ? s.distinct : t.fn === "merge" ? s.maxCluster : s.total;
  switch (t.op) {
    case "eq":
      return basis === t.n;
    case "gte":
      return basis >= t.n;
    case "lte":
      return basis <= t.n;
    case "all":
      return basis === s.total;
  }
  return false;
}
function queryToken(t) {
  return t.op === "all" ? "*" : t.op === "gte" ? `${t.n}+` : t.op === "lte" ? `${t.n}-` : `${t.n}`;
}
function normalizeQuery(t) {
  return `${FN_CAP[t.fn]}(${queryToken(t)})`;
}
var STYLE_NAMES = ["Solid", "Striped", "Double"];
var DIM_COLOR = "#2b2b2b";
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
}
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function brightestLast(colors) {
  return [...colors].sort((a, b) => luminance(a) - luminance(b));
}
function svg(tag, attrs) {
  const el = activeDocument.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function segsCross(a, b, c, d) {
  const ccw = (p, q, r) => (r.y - p.y) * (q.x - p.x) - (q.y - p.y) * (r.x - p.x);
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}
function deCross(order, pos) {
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
          let lo = i + 1;
          let hi = j;
          while (lo < hi) {
            const t = o[lo];
            o[lo] = o[hi];
            o[hi] = t;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return o;
}
var GraphView = class extends import_obsidian2.ItemView {
  // Configured vault count for this render (used by query "*" / classifyDot)
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.rafId = null;
    this.menuOpen = false;
    // Resolved per-vault appearance (colour + geometry style + lit/dim) for this render
    this.appearance = /* @__PURE__ */ new Map();
    // Which collapsible groups are open (all closed by default)
    this.openSections = /* @__PURE__ */ new Set();
    // In-place restyle hooks set by renderSvg (apply colour/dim without a re-render)
    this.reapply = null;
    this.redrawDots = null;
    this.refreshLines = null;
    this.applyDisplay = null;
    this.popGraph = null;
    // Inline preset-editor state (persists across the full re-render on colour commit)
    this.editName = null;
    this.editColors = null;
    this.editColorIdx = 0;
    // ID of a freshly-added filter/group rule that renders with an empty textbox
    this.newQueryId = null;
  }
  getViewType() {
    return GRAPH_VIEW_TYPE;
  }
  getDisplayText() {
    return "Intervault Graph";
  }
  getIcon() {
    return "git-fork";
  }
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
  stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
  render() {
    var _a;
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
        text: "No vault paths configured. Add folder paths in the plugin settings."
      });
      return;
    }
    let data;
    try {
      data = buildGraphData(vaults);
    } catch (e) {
      container.createEl("p", { cls: "ivg-empty", text: `Error reading vaults: ${String(e)}` });
      return;
    }
    const info = container.createEl("div", { cls: "ivg-info" });
    const statsMap = this.computeNoteStats(data);
    const filterTerms = ((_a = this.plugin.settings.filters) != null ? _a : []).map((f) => parseQuery(f.query)).filter((t) => t !== null);
    const passes = (title) => {
      if (filterTerms.length === 0) return true;
      const s = statsMap.get(title);
      if (!s) return false;
      return filterTerms.every((t) => matchQuery(t, s));
    };
    const keptTitles = data.sharedTitles.filter(passes);
    const filteredIndex = /* @__PURE__ */ new Map();
    for (const t of keptTitles) {
      const idx = data.titleIndex.get(t);
      if (idx) filteredIndex.set(t, idx);
    }
    const filteredData = { vaults: data.vaults, titleIndex: filteredIndex, sharedTitles: keptTitles };
    const shownCount = keptTitles.length;
    const ofTotal = shownCount !== data.sharedTitles.length ? `/${data.sharedTitles.length}` : "";
    info.setText(
      `${vaults.length} vault${vaults.length !== 1 ? "s" : ""} \xB7 ${shownCount}${ofTotal} shared note${shownCount !== 1 ? "s" : ""}`
    );
    const scatter = computeScatter(filteredData);
    this.resolveAppearance(scatter.vaults);
    const wrap = this.renderSvg(container, scatter, filteredData, statsMap);
    this.buildSettingsPanel(wrap, scatter.vaults);
  }
  selectedPalette() {
    var _a;
    const ps = this.plugin.settings.palettes;
    if (!ps || ps.length === 0) return clonePalette(SEED_PALETTES[0]);
    return (_a = ps.find((p) => p.id === this.plugin.settings.palette)) != null ? _a : ps[0];
  }
  /** Exactly three colours (pad) so the style↔colour pairing is well-defined. */
  palette3(pal) {
    var _a, _b, _c;
    const c = pal.colors;
    return [(_a = c[0]) != null ? _a : "#888888", (_b = c[1]) != null ? _b : "#aaaaaa", (_c = c[2]) != null ? _c : "#dddddd"];
  }
  /** Intersection dot colour: first matching GLOBAL group (top→down), else grey. */
  classifyDot(stats) {
    var _a;
    for (const g of (_a = this.plugin.settings.groups) != null ? _a : []) {
      const term = parseQuery(g.query);
      if (term && matchQuery(term, stats)) return g.color;
    }
    return GREY;
  }
  /** Resolve each vault's colour, geometry style, and lit/dim (per-vault overrides win;
   *  otherwise colour is driven by style so the double style is always the brightest). */
  resolveAppearance(vaults) {
    var _a, _b;
    this.appearance.clear();
    const pal = this.selectedPalette();
    const sorted = brightestLast(this.palette3(pal));
    const dim = new Set(this.plugin.settings.dimVaults);
    const overColor = (_a = pal.vaultColors) != null ? _a : {};
    const overStyle = (_b = pal.vaultStyles) != null ? _b : {};
    vaults.forEach((meta, i) => {
      var _a2, _b2;
      const style = (_a2 = overStyle[meta.name]) != null ? _a2 : i % 3;
      const color = (_b2 = overColor[meta.name]) != null ? _b2 : sorted[i % 3];
      this.appearance.set(meta.name, { color, style, dim: dim.has(meta.name) });
    });
  }
  /** Create a new preset cloned (deeply) from the current one and select it. */
  addPreset() {
    const cur = this.selectedPalette();
    const nums = this.plugin.settings.palettes.map((p) => parseInt(p.id.replace(/^custom/, ""), 10)).filter((n) => !Number.isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    const pal = {
      ...clonePalette(cur),
      id: `custom${next}`,
      name: next === 1 ? "Custom" : `Custom ${next}`
    };
    this.plugin.settings.palettes.push(pal);
    this.plugin.settings.palette = pal.id;
    return pal;
  }
  /** Floating Settings control over the graph's top-right, as a collapsible tree. */
  buildSettingsPanel(host, vaults) {
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
        for (const [id, apply] of applyById) {
          this.openSections.delete(id);
          apply(false);
        }
      }
    });
    let popTimer = null;
    const popSoon = () => {
      if (popTimer) window.clearTimeout(popTimer);
      popTimer = window.setTimeout(() => {
        var _a;
        popTimer = null;
        (_a = this.popGraph) == null ? void 0 : _a.call(this);
      }, 130);
    };
    const applyLive = async () => {
      var _a, _b, _c;
      await this.plugin.saveSettings();
      this.resolveAppearance(vaults);
      (_a = this.reapply) == null ? void 0 : _a.call(this);
      (_b = this.refreshLines) == null ? void 0 : _b.call(this);
      (_c = this.redrawDots) == null ? void 0 : _c.call(this);
      popSoon();
    };
    const applyById = /* @__PURE__ */ new Map();
    const group = (parent, id, title, level, build) => {
      const g = parent.createEl("div", { cls: `ivg-grp ivg-grp-l${level}` });
      const head = g.createEl("div", { cls: "ivg-grp-head" });
      const chev = head.createEl("span", { cls: "ivg-chev" });
      head.createEl("span", { cls: "ivg-grp-title", text: title });
      const body = g.createEl("div", { cls: "ivg-grp-body" });
      const apply = (open) => {
        body.setCssStyles({ display: open ? "block" : "none" });
        chev.setText(open ? "\u25BE" : "\u25B8");
      };
      applyById.set(id, apply);
      apply(this.openSections.has(id));
      head.addEventListener("click", () => {
        const open = !this.openSections.has(id);
        if (open) {
          this.openSections.add(id);
        } else {
          this.openSections.delete(id);
          for (const [cid, capply] of applyById) {
            if (cid.startsWith(id + "/")) {
              this.openSections.delete(cid);
              capply(false);
            }
          }
        }
        apply(open);
      });
      build(body);
    };
    const colorDot = (parent, value, onSet) => {
      const dot = parent.createEl("span", { cls: "ivg-preset-dot" });
      dot.setCssStyles({ background: value });
      const input = dot.createEl("input");
      input.type = "color";
      input.value = value;
      input.addClass("ivg-hidden-color");
      input.addEventListener("input", () => {
        dot.setCssStyles({ background: input.value });
        onSet(input.value);
      });
      input.addEventListener("change", () => {
        onSet(input.value);
        void this.plugin.saveSettings().then(() => this.render());
      });
      return { dot, input };
    };
    const populate = () => {
      panel.empty();
      applyById.clear();
      const sel = this.selectedPalette();
      group(panel, "Theme", "Theme", 1, (colorsBody) => {
        group(colorsBody, "Theme/Presets", "Presets", 2, (b) => {
          for (const p of this.plugin.settings.palettes) {
            const rowEl = b.createEl("div", { cls: "ivg-preset-row" });
            if (p.id === sel.id) rowEl.addClass("selected");
            rowEl.addEventListener("click", () => {
              if (this.editName === p.id || this.editColors === p.id) {
                this.editName = null;
                this.editColors = null;
                populate();
                return;
              }
              if (this.plugin.settings.palette === p.id) return;
              this.plugin.settings.palette = p.id;
              this.editName = null;
              this.editColors = null;
              void this.plugin.saveSettings().then(() => this.render());
            });
            if (this.editName === p.id) {
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
                if (k === "Enter") nameIn.blur();
                else if (k === "Escape") {
                  nameCommitted = true;
                  this.editName = null;
                  populate();
                }
              });
              nameIn.addEventListener("blur", () => void commitName());
              const del = rowEl.createEl("button", { cls: "ivg-preset-del", text: "Delete" });
              del.toggleClass("ivg-disabled", this.plugin.settings.palettes.length <= 1);
              del.addEventListener("mousedown", (e) => e.preventDefault());
              del.addEventListener("click", (e) => {
                e.stopPropagation();
                nameCommitted = true;
                if (this.plugin.settings.palettes.length <= 1) return;
                const wasSel = this.plugin.settings.palette === p.id;
                this.plugin.settings.palettes = this.plugin.settings.palettes.filter((x) => x.id !== p.id);
                if (wasSel) this.plugin.settings.palette = this.plugin.settings.palettes[0].id;
                this.editName = null;
                void applyLive().then(() => populate());
              });
              window.setTimeout(() => {
                nameIn.focus();
                nameIn.select();
              }, 0);
            } else {
              const line = rowEl.createEl("div", { cls: "ivg-preset-line" });
              const nameEl = line.createEl("span", { cls: "ivg-preset-rowname", text: p.name });
              nameEl.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                this.editName = p.id;
                this.editColors = null;
                populate();
              });
              const dotsEl = line.createEl("span", { cls: "ivg-preset-dots" });
              const order = p.colors.map((_, i) => i).sort((a, c) => luminance(p.colors[a]) - luminance(p.colors[c]));
              const made = order.map((slot) => {
                const { dot, input } = colorDot(dotsEl, p.colors[slot], (v) => {
                  p.colors[slot] = v;
                });
                return { slot, dot, input };
              });
              const highlight = () => made.forEach((d) => d.dot.toggleClass("selected", this.editColors === p.id && d.slot === this.editColorIdx));
              highlight();
              for (const { slot, dot, input } of made) {
                dot.addEventListener("dblclick", (e) => {
                  e.stopPropagation();
                  this.editColors = p.id;
                  this.editName = null;
                  this.editColorIdx = slot;
                  highlight();
                  input.click();
                });
                dot.addEventListener("click", (e) => {
                  if (this.editColors !== p.id) return;
                  e.stopPropagation();
                  this.editColorIdx = slot;
                  highlight();
                  input.click();
                });
              }
            }
          }
          const addBtn = b.createEl("button", { cls: "ivg-palette-add", text: "+" });
          addBtn.setAttribute("aria-label", "New preset");
          addBtn.addEventListener("click", () => {
            this.addPreset();
            this.editName = null;
            this.editColors = null;
            void applyLive().then(() => populate());
          });
        });
        group(colorsBody, "Theme/VaultColors", "Vaults", 2, (b) => {
          let activeVaultDot = null;
          vaults.forEach((meta) => {
            const ap = this.appearance.get(meta.name);
            const r = b.createEl("div", { cls: "ivg-edit-row" });
            const { dot: vd, input: vi } = colorDot(r, ap.color, (v) => {
              sel.vaultColors[meta.name] = v;
            });
            vd.addEventListener("click", (e) => {
              e.stopPropagation();
              if (activeVaultDot && activeVaultDot !== vd) activeVaultDot.removeClass("selected");
              vd.addClass("selected");
              activeVaultDot = vd;
              vi.click();
            });
            vi.addEventListener("change", () => {
              vd.removeClass("selected");
              activeVaultDot = null;
            });
            r.createEl("span", { cls: "ivg-vault-name", text: meta.name });
            const sel2 = r.createEl("select", { cls: "ivg-style-select" });
            STYLE_NAMES.forEach((nm, si) => {
              const opt = sel2.createEl("option", { text: nm, value: String(si) });
              if (si === ap.style) opt.selected = true;
            });
            sel2.addEventListener("change", () => {
              sel.vaultStyles[meta.name] = parseInt(sel2.value, 10);
              void this.plugin.saveSettings().then(() => this.render());
            });
          });
        });
      });
      group(panel, "Intersections", "Intersections", 1, (intBody) => {
        const settings = this.plugin.settings;
        const fnDefs = [
          { fn: "Diff", verb: "different across" },
          { fn: "Merged", verb: "merged across" },
          { fn: "Meet", verb: "meets" }
        ];
        const countDesc = (tok) => {
          const t = tok.replace(/\s+/g, "");
          if (t === "*") return "all configured vaults";
          let mm;
          if (mm = t.match(/^(\d+)\+$/)) return `at least ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          if (mm = t.match(/^(\d+)-$/)) return `at most ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          if (mm = t.match(/^(\d+)$/)) return `exactly ${mm[1]} vault${mm[1] !== "1" ? "s" : ""}`;
          return "# vaults";
        };
        const suggestionsFor = (val) => {
          const fnPart = val.toLowerCase().split("(")[0].trim();
          const cm = val.match(/\(([^)]*)/);
          const tok = (cm ? cm[1].trim() : "") || "2";
          return fnDefs.filter((d) => fnPart === "" || d.fn.toLowerCase().startsWith(fnPart)).map((d) => ({ text: `${d.fn}(${tok})`, hint: `${d.verb} ${countDesc(tok)}` }));
        };
        const buildQueryRow = (opts) => {
          const { listEl, wrapEls, rules, rule, index, hasColor, draggable } = opts;
          const isNew = this.newQueryId === rule.id;
          const wrap = listEl.createEl("div", { cls: "ivg-rule-wrap" });
          wrapEls.push(wrap);
          const row = wrap.createEl("div", { cls: "ivg-edit-row" });
          let rd = null;
          let ri = null;
          if (hasColor) {
            const g = rule;
            const made = colorDot(row, g.color, (v) => {
              g.color = v;
            });
            rd = made.dot;
            ri = made.input;
            if (isNew || !parseQuery(rule.query)) rd.addClass("ivg-disabled");
            rd.addEventListener("click", (e) => {
              e.stopPropagation();
              if (rd.hasClass("ivg-disabled")) return;
              rd.addClass("selected");
              ri.click();
            });
            ri.addEventListener("change", () => rd.removeClass("selected"));
          }
          const txt = row.createEl("input", { cls: "ivg-rule-txt", type: "text" });
          txt.type = "text";
          txt.value = isNew ? "" : rule.query;
          txt.placeholder = "e.g. Diff(2+)";
          txt.addEventListener("click", (e) => e.stopPropagation());
          const suggestEl = wrap.createEl("div", { cls: "ivg-rule-suggest" });
          suggestEl.setCssStyles({ display: "none" });
          const showSuggestions = (val) => {
            suggestEl.empty();
            if (val.trim() === "") {
              suggestEl.setCssStyles({ display: "block" });
              const help = suggestEl.createEl("div", { cls: "ivg-rule-help" });
              help.createEl("div", { cls: "ivg-help-line bold", text: "Function(#)" });
              help.createEl("div", { cls: "ivg-help-line italic", text: "Use #+ or #- for ranges" });
              help.createEl("div", { cls: "ivg-help-line italic", text: "Functions: meet(), merged(), diff()" });
              return;
            }
            const sugs = suggestionsFor(val);
            if (!sugs.length) {
              suggestEl.setCssStyles({ display: "none" });
              return;
            }
            suggestEl.setCssStyles({ display: "block" });
            sugs.forEach(({ text, hint }) => {
              const item = suggestEl.createEl("div", { cls: "ivg-sug-item" });
              item.createEl("span", { cls: "ivg-sug-text", text });
              item.createEl("span", { cls: "ivg-sug-hint", text: ` \u2013 ${hint}` });
              item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                txt.value = text;
                txt.removeClass("ivg-rule-invalid");
                suggestEl.setCssStyles({ display: "none" });
                txt.dispatchEvent(new Event("change"));
              });
            });
          };
          txt.addEventListener("focus", () => showSuggestions(txt.value));
          txt.addEventListener("blur", () => window.setTimeout(() => {
            suggestEl.setCssStyles({ display: "none" });
          }, 160));
          txt.addEventListener("input", () => {
            const ok = !!parseQuery(txt.value);
            txt.toggleClass("ivg-rule-invalid", txt.value.length > 0 && !ok);
            rd == null ? void 0 : rd.toggleClass("ivg-disabled", !ok);
            showSuggestions(txt.value);
          });
          txt.addEventListener("change", () => {
            const term = parseQuery(txt.value);
            if (!term) {
              if (isNew && !txt.value.trim()) {
                const i = rules.indexOf(rule);
                if (i >= 0) rules.splice(i, 1);
                this.newQueryId = null;
                populate();
                return;
              }
              txt.value = isNew ? "" : rule.query;
              txt.removeClass("ivg-rule-invalid");
              return;
            }
            rule.query = normalizeQuery(term);
            this.newQueryId = null;
            void this.plugin.saveSettings().then(() => this.render());
          });
          if (isNew) window.setTimeout(() => {
            txt.focus();
            showSuggestions("");
          }, 0);
          const rm = row.createEl("button", { cls: "ivg-preset-del", text: "\xD7" });
          rm.addEventListener("click", (e) => {
            e.stopPropagation();
            const i = rules.indexOf(rule);
            if (i >= 0) rules.splice(i, 1);
            if (this.newQueryId === rule.id) this.newQueryId = null;
            void this.plugin.saveSettings().then(() => this.render());
          });
          if (draggable) {
            const handle = row.createEl("span", { cls: "ivg-rule-handle" });
            for (let i = 0; i < 3; i++) handle.createEl("span", { cls: "ivg-rule-bar" });
            handle.addEventListener("mousedown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const rowH = wrap.offsetHeight || 28;
              const startY = e.clientY;
              let targetIdx = index;
              wrap.addClass("ivg-rule-dragging");
              const onMove = (ev) => {
                const dy = ev.clientY - startY;
                wrap.setCssStyles({ transform: `translateY(${dy}px)` });
                const ni = Math.max(0, Math.min(rules.length - 1, index + Math.round(dy / rowH)));
                if (ni !== targetIdx) {
                  targetIdx = ni;
                  wrapEls.forEach((w, i) => {
                    if (w === wrap) return;
                    const shift = index < targetIdx ? i > index && i <= targetIdx ? -rowH : 0 : i < index && i >= targetIdx ? rowH : 0;
                    w.setCssStyles({ transform: `translateY(${shift}px)` });
                  });
                }
              };
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                wrap.removeClass("ivg-rule-dragging");
                wrapEls.forEach((w) => {
                  w.setCssStyles({ transform: "" });
                });
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
        group(intBody, "Intersections/Filters", "Filters", 2, (fb) => {
          const listEl = fb.createEl("div", { cls: "ivg-rule-list" });
          const wrapEls = [];
          settings.filters.forEach(
            (rule, i) => buildQueryRow({ listEl, wrapEls, rules: settings.filters, rule, index: i, hasColor: false, draggable: false })
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
        group(intBody, "Intersections/Groups", "Groups", 2, (gb) => {
          const listEl = gb.createEl("div", { cls: "ivg-rule-list" });
          const wrapEls = [];
          settings.groups.forEach(
            (rule, i) => buildQueryRow({ listEl, wrapEls, rules: settings.groups, rule, index: i, hasColor: true, draggable: true })
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
      group(panel, "Display", "Display", 1, (db) => {
        const d = this.plugin.settings.display;
        const commit = async () => {
          var _a;
          await this.plugin.saveSettings();
          (_a = this.applyDisplay) == null ? void 0 : _a.call(this);
        };
        const slider = (label, key, min, max, step, fmt) => {
          const row = db.createEl("div", { cls: "ivg-disp-row" });
          row.createEl("span", { cls: "ivg-disp-name", text: label });
          const input = row.createEl("input", { type: "range" });
          input.type = "range";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.value = String(d[key]);
          const valEl = row.createEl("span", { cls: "ivg-disp-val", text: fmt(d[key]) });
          input.addEventListener("input", () => {
            d[key] = parseFloat(input.value);
            valEl.setText(fmt(parseFloat(input.value)));
            void commit();
          });
        };
        const toggle2 = (label, key) => {
          const row = db.createEl("label", { cls: "ivg-disp-row" });
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = d[key];
          row.createEl("span", { cls: "ivg-disp-name", text: label });
          cb.addEventListener("change", () => {
            d[key] = cb.checked;
            void commit();
          });
        };
        slider("Intersection size", "intersectionSize", 2, 10, 1, (v) => String(v));
        slider("Braid amount", "bowScale", 0, 2, 0.1, (v) => v.toFixed(1));
        slider("Line thickness", "lineThickness", 0.5, 2.5, 0.1, (v) => v.toFixed(1));
        toggle2("Intersection labels", "showIntersectionLabels");
        {
          const row = db.createEl("div", { cls: "ivg-disp-row" });
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = d.fadeLabelsOnZoom;
          cb.addEventListener("change", () => {
            d.fadeLabelsOnZoom = cb.checked;
            void commit();
          });
          row.createEl("span", { cls: "ivg-disp-name", text: "Fade zoom" });
          const sl = row.createEl("input", { type: "range" });
          sl.min = "0.5";
          sl.max = "3.0";
          sl.step = "0.1";
          sl.value = String(d.fadeLabelAt);
          sl.setCssStyles({ flex: "0 0 64px" });
          const val = row.createEl("span", { cls: "ivg-disp-val", text: d.fadeLabelAt.toFixed(1) });
          sl.addEventListener("input", () => {
            d.fadeLabelAt = parseFloat(sl.value);
            val.setText(d.fadeLabelAt.toFixed(1));
            void commit();
          });
        }
        toggle2("Vault labels", "showVaultLabels");
        group(db, "Display/Vaults", "Vaults", 2, (b) => {
          const dim = new Set(this.plugin.settings.dimVaults);
          vaults.forEach((meta) => {
            const ap = this.appearance.get(meta.name);
            const r = b.createEl("label", { cls: "ivg-vault-row" });
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
      const restoreBtn = panel.createEl("button", { cls: "ivg-restore-btn", text: "Restore Defaults" });
      restoreBtn.addEventListener("click", () => {
        const s = this.plugin.settings;
        const customs = s.palettes.filter((p) => !SEED_PALETTES.some((seed2) => seed2.id === p.id));
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
  computeNoteStats(data) {
    var _a;
    const out = /* @__PURE__ */ new Map();
    for (const title of data.sharedTitles) {
      const byVault = data.titleIndex.get(title);
      if (!byVault) continue;
      const clusters = /* @__PURE__ */ new Map();
      let total = 0;
      for (const filePath of byVault.values()) {
        let content = "";
        try {
          content = fs2.readFileSync(filePath, "utf8");
        } catch (e) {
        }
        clusters.set(content, ((_a = clusters.get(content)) != null ? _a : 0) + 1);
        total++;
      }
      let maxCluster = 0;
      for (const n of clusters.values()) if (n > maxCluster) maxCluster = n;
      out.set(title, { total, distinct: clusters.size, maxCluster });
    }
    return out;
  }
  renderSvg(container, scatter, data, statsMap) {
    var _a, _b, _c;
    const root = svg("svg", {
      viewBox: `0 0 ${scatter.width} ${scatter.height}`,
      class: "ivg-svg",
      preserveAspectRatio: "xMidYMid meet"
    });
    this.popGraph = () => {
      root.removeClass("ivg-pop");
      void root.getBoundingClientRect();
      root.addClass("ivg-pop");
    };
    const zoomG = svg("g", {});
    root.appendChild(zoomG);
    const labelLayer = svg("g", {});
    const zoom = { k: 1, tx: 0, ty: 0 };
    let updateLabelFade = () => {
    };
    const applyZoom = () => {
      zoomG.setAttribute("transform", `translate(${zoom.tx} ${zoom.ty}) scale(${zoom.k})`);
      updateLabelFade();
    };
    const cx = scatter.width / 2;
    const cy = scatter.height / 2;
    const posById = /* @__PURE__ */ new Map();
    const bodies = scatter.notes.map((note) => ({
      id: note.title,
      x: note.pos.x,
      y: note.pos.y,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null
    }));
    const h0Id = (name) => `__h0__${name}`;
    const h1Id = (name) => `__h1__${name}`;
    const hasHandles = (meta) => meta.order.length <= 1;
    scatter.vaults.forEach((meta, vi) => {
      if (!hasHandles(meta)) return;
      const anchor = meta.order.length === 1 ? bodies.find((b) => b.id === meta.order[0]) : null;
      const ang = vi / scatter.vaults.length * Math.PI * 2;
      const base = anchor ? { x: anchor.x, y: anchor.y } : { x: cx + Math.cos(ang) * 160, y: cy + Math.sin(ang) * 160 };
      bodies.push({ id: h0Id(meta.name), x: base.x - 45, y: base.y - 30, vx: 0, vy: 0, fx: null, fy: null });
      bodies.push({ id: h1Id(meta.name), x: base.x + 45, y: base.y + 30, vx: 0, vy: 0, fx: null, fy: null });
    });
    const links = [];
    const linkSet = /* @__PURE__ */ new Set();
    const addLink = (a, b, distance) => {
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
        for (let i = 0; i < k - 1; i++) addLink(meta.order[i], meta.order[i + 1], 130);
      }
    }
    const sim = new Simulation(bodies, links, cx, cy);
    sim.charge = -3400;
    sim.centerStrength = 0.018;
    sim.linkStrength = 0.2;
    sim.alignGroups = scatter.vaults.filter((m) => m.order.length >= 3).map((m) => [...m.order]);
    sim.alignStrength = 0.1;
    for (const b of bodies) posById.set(b.id, { x: b.x, y: b.y });
    const segKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
    let frozenOrder = scatter.vaults.map((m) => m.order.slice());
    let segSharers = /* @__PURE__ */ new Map();
    let interacted = false;
    const buildSegSharers = () => {
      segSharers = /* @__PURE__ */ new Map();
      frozenOrder.forEach((titles, vi) => {
        for (let i = 0; i < titles.length - 1; i++) {
          const key = segKey(titles[i], titles[i + 1]);
          if (!segSharers.has(key)) segSharers.set(key, []);
          segSharers.get(key).push(vi);
        }
      });
    };
    const projCache = /* @__PURE__ */ new Map();
    const decrossCache = /* @__PURE__ */ new Map();
    const freezeOrders = () => {
      frozenOrder = scatter.vaults.map((meta, vi) => {
        const ts = meta.order;
        if (ts.length <= 2) return ts.slice();
        let gx = 0;
        let gy = 0;
        for (const t of ts) {
          const p = posById.get(t);
          gx += p.x;
          gy += p.y;
        }
        gx /= ts.length;
        gy /= ts.length;
        let sxx = 0;
        let syy = 0;
        let sxy = 0;
        for (const t of ts) {
          const p = posById.get(t);
          const ux = p.x - gx;
          const uy = p.y - gy;
          sxx += ux * ux;
          syy += uy * uy;
          sxy += ux * uy;
        }
        const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const dx = Math.cos(theta);
        const dy = Math.sin(theta);
        const proj = (t) => {
          const p = posById.get(t);
          return (p.x - gx) * dx + (p.y - gy) * dy;
        };
        const ordered = [...ts].sort((a, b) => proj(a) - proj(b) || (a < b ? -1 : 1));
        const key = ordered.join("|");
        if (projCache.get(vi) === key && decrossCache.has(vi)) return decrossCache.get(vi);
        const fixed = deCross(ordered, (t) => posById.get(t));
        projCache.set(vi, key);
        decrossCache.set(vi, fixed);
        return fixed;
      });
      buildSegSharers();
    };
    buildSegSharers();
    const onUserGrab = () => {
      if (interacted) return;
      interacted = true;
      sim.alignStrength = 0.01;
    };
    const lineEls = [];
    const applyLineAppearance = (le) => {
      const ap = this.appearance.get(le.meta.name);
      const col = ap.dim ? DIM_COLOR : ap.color;
      const op = ap.dim ? "0.1" : "1";
      le.path.style.setProperty("--line-shade", col);
      le.path.style.opacity = op;
      le.path.style.strokeDasharray = ap.style === 1 ? "7 5" : "none";
      if (le.inner) {
        le.inner.style.display = ap.style === 2 ? "" : "none";
        le.inner.style.opacity = op;
      }
      le.label.style.fill = col;
      le.label.style.opacity = ap.dim ? "0.18" : "1";
    };
    scatter.vaults.forEach((meta, vi) => {
      const width = Math.min(3, 2 + meta.noteCount * 0.2);
      const path3 = svg("path", {
        fill: "none",
        "stroke-width": String(width),
        "stroke-linecap": "round",
        class: "ivg-vault-line"
      });
      const t = svg("title", {});
      t.textContent = `Vault: ${meta.name} (${meta.noteCount} notes) \u2014 drag to move, click to open`;
      path3.appendChild(t);
      zoomG.appendChild(path3);
      const inner = svg("path", {
        fill: "none",
        stroke: "var(--background-primary)",
        "stroke-width": String(Math.max(0.8, width - 2.2)),
        // thinner core → smaller, easier-to-follow gap
        "stroke-linecap": "round",
        class: "ivg-vault-inner"
      });
      zoomG.appendChild(inner);
      const labelCls = meta.order.length === 0 ? "ivg-vault-label ivg-label-lone" : "ivg-vault-label";
      const label = svg("text", { class: labelCls, "text-anchor": "middle", "dominant-baseline": "central" });
      label.textContent = meta.name;
      labelLayer.appendChild(label);
      const le = { meta, vi, path: path3, inner, label, width };
      path3.addEventListener("mouseenter", () => {
        var _a2;
        for (const other of lineEls) {
          if (other === le) continue;
          if ((_a2 = this.appearance.get(other.meta.name)) == null ? void 0 : _a2.dim) continue;
          other.path.setCssStyles({ opacity: "0.9" });
          if (other.inner) other.inner.setCssStyles({ opacity: "0.9" });
        }
        path3.style.strokeWidth = String(width + 1.4);
      });
      path3.addEventListener("mouseleave", () => {
        for (const other of lineEls) applyLineAppearance(other);
        path3.style.strokeWidth = String(width);
      });
      applyLineAppearance(le);
      lineEls.push(le);
      const ownIds = meta.order.length === 0 ? [h0Id(meta.name), h1Id(meta.name)] : meta.order.length === 1 ? [h0Id(meta.name), meta.order[0], h1Id(meta.name)] : [...meta.order];
      let lDrag = false;
      let lMoved = false;
      let lStartClient = { x: 0, y: 0 };
      let lStartSvg = { x: 0, y: 0 };
      let lStartPos = /* @__PURE__ */ new Map();
      const lMove = (e) => {
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
          b.fx = sp.x + dx;
          b.fy = sp.y + dy;
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
          this.openVault(meta.name);
        } else {
          for (const id of ownIds) {
            const b = sim.get(id);
            if (b) {
              b.fx = null;
              b.fy = null;
            }
          }
          sim.reheat(0.3);
          ensureRunning();
        }
      };
      path3.addEventListener("mousedown", (e) => {
        lDrag = true;
        lMoved = false;
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
      path3.addEventListener("dblclick", (e) => {
        for (const id of ownIds) {
          const b = sim.get(id);
          if (b) {
            b.fx = null;
            b.fy = null;
          }
        }
        sim.reheat(0.5);
        ensureRunning();
        e.stopPropagation();
        e.preventDefault();
      });
    });
    const refreshLine = (le) => {
      var _a2, _b2;
      const order = (_a2 = frozenOrder[le.vi]) != null ? _a2 : le.meta.order;
      const bow = le.meta.bow;
      if (order.length === 0) {
        const a = posById.get(h0Id(le.meta.name));
        const b = posById.get(h1Id(le.meta.name));
        const d2 = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        le.path.setAttribute("d", d2);
        if (le.inner) le.inner.setAttribute("d", d2);
        this.placeVaultLabel(le.path, le.label, le.meta.labelEnd);
        return;
      }
      const aPts = order.map((t) => posById.get(t));
      const wp = [];
      if (order.length <= 1) wp.push(posById.get(h0Id(le.meta.name)));
      wp.push(aPts[0]);
      const first = aPts[0];
      const last = aPts[aPts.length - 1];
      const axisLen = Math.hypot(last.x - first.x, last.y - first.y) || 1;
      const gpx = -(last.y - first.y) / axisLen;
      const gpy = (last.x - first.x) / axisLen;
      for (let i = 0; i < aPts.length - 1; i++) {
        const a = aPts[i];
        const b = aPts[i + 1];
        const sharers = (_b2 = segSharers.get(segKey(order[i], order[i + 1]))) != null ? _b2 : [];
        const rank = sharers.indexOf(le.vi);
        if (sharers.length >= 2 && rank > 0) {
          const side = rank % 2 === 1 ? 1 : -1;
          const parity = i % 2 === 0 ? 1 : -1;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const amp = Math.min(70, bow / 100 * len) * Math.ceil(rank / 2) * this.plugin.settings.display.bowScale;
          const px = gpx;
          const py = gpy;
          const SAMPLES = 7;
          for (let s = 1; s <= SAMPLES; s++) {
            const u = s / (SAMPLES + 1);
            const off = amp * side * parity * Math.sin(Math.PI * u);
            wp.push({ x: a.x + dx * u + px * off, y: a.y + dy * u + py * off });
          }
        }
        wp.push(b);
      }
      if (order.length <= 1) wp.push(posById.get(h1Id(le.meta.name)));
      if (order.length >= 2) {
        const EXT = 50 + scatter.vaults.length * 16;
        const ext = (from, toward) => {
          const dx = from.x - toward.x;
          const dy = from.y - toward.y;
          const m = Math.hypot(dx, dy);
          if (m < 1e-3) return null;
          return { x: from.x + dx / m * EXT, y: from.y + dy / m * EXT };
        };
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
    const placers = [];
    const dotEls = [];
    const toSvg = (e) => {
      const pt = root.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const sp = pt.matrixTransform(zoomG.getScreenCTM().inverse());
      return { x: sp.x, y: sp.y };
    };
    for (const note of scatter.notes) {
      const g = svg("g", { class: "ivg-note" });
      const stats = (_a = statsMap.get(note.title)) != null ? _a : { total: note.vaults.length, distinct: 1, maxCluster: note.vaults.length };
      const differs = stats.distinct > 1;
      const c = svg("circle", { class: "ivg-note-dot" });
      const dimSet0 = new Set(this.plugin.settings.dimVaults);
      const anyLit0 = note.vaults.some((v) => !dimSet0.has(v));
      c.style.fill = this.classifyDot(stats);
      c.style.display = anyLit0 ? "" : "none";
      const noteLabel = svg("text", {
        class: "ivg-note-label",
        "text-anchor": "middle",
        "dominant-baseline": "hanging"
      });
      noteLabel.textContent = note.title;
      const showLbl0 = this.plugin.settings.display.showIntersectionLabels;
      noteLabel.style.display = anyLit0 && showLbl0 ? "" : "none";
      dotEls.push({ c, label: noteLabel, stats, vaults: note.vaults });
      const tip = svg("title", {});
      tip.textContent = `In: ${note.vaults.join(", ")}
${differs ? "Versions DIFFER" : "Identical"} \u2014 drag to move, click to ${differs ? "diff/merge" : "open"}`;
      g.appendChild(c);
      g.appendChild(noteLabel);
      g.appendChild(tip);
      const place = () => {
        const p = posById.get(note.title);
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        noteLabel.setAttribute("x", String(p.x));
        noteLabel.setAttribute("y", String(p.y + this.plugin.settings.display.intersectionSize + 3));
      };
      placers.push(place);
      place();
      let dragging = false;
      let moved = false;
      let startClient = { x: 0, y: 0 };
      const body = sim.get(note.title);
      const onMove = (e) => {
        if (!dragging) return;
        if (!moved && Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) < 4) return;
        moved = true;
        g.addClass("dragging");
        const p = toSvg(e);
        body.fx = p.x;
        body.fy = p.y;
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
          body.fx = null;
          body.fy = null;
          this.onNoteClick(note.title, data);
        } else {
          body.fx = null;
          body.fy = null;
          sim.reheat(0.3);
          ensureRunning();
        }
      };
      g.addEventListener("mousedown", (e) => {
        dragging = true;
        moved = false;
        onUserGrab();
        startClient = { x: e.clientX, y: e.clientY };
        body.fx = body.x;
        body.fy = body.y;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        e.preventDefault();
      });
      zoomG.appendChild(g);
    }
    zoomG.appendChild(labelLayer);
    const wrap = container.createEl("div", { cls: "ivg-svg-wrap" });
    wrap.appendChild(root);
    root.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width * scatter.width;
      const sy = (e.clientY - rect.top) / rect.height * scatter.height;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k2 = Math.max(0.2, Math.min(6, zoom.k * factor));
      zoom.tx = sx - (sx - zoom.tx) * (k2 / zoom.k);
      zoom.ty = sy - (sy - zoom.ty) * (k2 / zoom.k);
      zoom.k = k2;
      applyZoom();
    }, { passive: false });
    let panning = false;
    let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
    root.addEventListener("mousedown", (e) => {
      if (e.target !== root && e.target !== zoomG) return;
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
      const rect = root.getBoundingClientRect();
      const scaleX = scatter.width / rect.width;
      const scaleY = scatter.height / rect.height;
      const onPan = (ev) => {
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
    const labelDims = /* @__PURE__ */ new Map();
    const resolveVaultLabels = () => {
      const items = lineEls.map((le) => {
        let dim = labelDims.get(le.label);
        if (!dim) {
          try {
            const bb = le.label.getBBox();
            dim = { w: bb.width, h: bb.height };
            labelDims.set(le.label, dim);
          } catch (e) {
            return null;
          }
        }
        return {
          label: le.label,
          x: parseFloat(le.label.getAttribute("x") || "0"),
          y: parseFloat(le.label.getAttribute("y") || "0"),
          w: dim.w,
          h: dim.h
        };
      }).filter((v) => v !== null);
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
              const dir = dy === 0 ? i < j ? -1 : 1 : Math.sign(dy);
              a.y -= dir * push;
              b.y += dir * push;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      for (const it of items) it.label.setAttribute("y", String(it.y));
    };
    this.reapply = () => lineEls.forEach(applyLineAppearance);
    this.refreshLines = () => {
      lineEls.forEach(refreshLine);
      resolveVaultLabels();
    };
    this.redrawDots = () => {
      const dimSet = new Set(this.plugin.settings.dimVaults);
      const showLbl = this.plugin.settings.display.showIntersectionLabels;
      for (const d of dotEls) {
        const anyLit = d.vaults.some((v) => !dimSet.has(v));
        d.c.style.fill = this.classifyDot(d.stats);
        d.c.style.display = anyLit ? "" : "none";
        d.label.style.display = anyLit && showLbl ? "" : "none";
      }
    };
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
    this.applyDisplay = () => {
      var _a2;
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
      placers.forEach((p) => p());
      lineEls.forEach(refreshLine);
      resolveVaultLabels();
      (_a2 = this.redrawDots) == null ? void 0 : _a2.call(this);
      updateLabelFade();
    };
    const syncAndDraw = () => {
      for (const b of sim.bodies) posById.set(b.id, { x: b.x, y: b.y });
      if (!interacted) freezeOrders();
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
    for (let i = 0; i < 300; i++) sim.tick();
    sim.reheat(0.15);
    syncAndDraw();
    (_b = this.applyDisplay) == null ? void 0 : _b.call(this);
    this.rafId = window.requestAnimationFrame(loop);
    (_c = this.popGraph) == null ? void 0 : _c.call(this);
    return wrap;
  }
  /** Place a vault label just beyond one extended end, so that end "points to" it. */
  placeVaultLabel(path3, label, end) {
    let total = 0;
    try {
      total = path3.getTotalLength();
    } catch (e) {
    }
    if (!total) return;
    const at = end === 0 ? 0 : total;
    const innerAt = end === 0 ? Math.min(12, total) : Math.max(0, total - 12);
    let tip;
    let inner;
    try {
      tip = path3.getPointAtLength(at);
      inner = path3.getPointAtLength(innerAt);
    } catch (e) {
      return;
    }
    const dx = tip.x - inner.x;
    const dy = tip.y - inner.y;
    const m = Math.hypot(dx, dy) || 1;
    const gap = 26;
    label.setAttribute("x", String(tip.x + dx / m * gap));
    label.setAttribute("y", String(tip.y + dy / m * gap));
  }
  openVault(name) {
    window.open(`obsidian://open?vault=${encodeURIComponent(name)}`);
  }
  openNoteByPath(filePath) {
    window.open(`obsidian://open?path=${encodeURIComponent(filePath)}`);
  }
  onNoteClick(title, data) {
    const byVault = data.titleIndex.get(title);
    if (!byVault) return;
    const entries = [...byVault.entries()];
    const versions = entries.map(([vaultName, filePath]) => {
      let content = "";
      try {
        content = fs2.readFileSync(filePath, "utf8");
      } catch (e) {
        content = `<<could not read: ${String(e)}>>`;
      }
      return { vaultName, filePath, content };
    });
    const allSame = versions.every((v) => v.content === versions[0].content);
    if (allSame) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(title, "");
      if (dest) {
        void this.app.workspace.getLeaf(false).openFile(dest);
      } else {
        this.openNoteByPath(versions[0].filePath);
      }
      return;
    }
    new MergeModal(this.app, title, versions, (filePath) => this.openNoteByPath(filePath)).open();
  }
};
var MergeModal = class extends import_obsidian2.Modal {
  constructor(app, title, versions, openByPath) {
    super(app);
    this.title = title;
    this.versions = versions;
    this.openByPath = openByPath;
    this.leftIdx = 0;
    this.rightIdx = 1;
    this.leftText = "";
    this.rightText = "";
    this.rows = [];
  }
  onOpen() {
    this.modalEl.addClass("ivg-merge-modal");
    this.titleEl.setText(this.title);
    this.loadTexts();
    this.buildShell();
  }
  loadTexts() {
    this.leftText = this.versions[this.leftIdx].content;
    this.rightText = this.versions[this.rightIdx].content;
  }
  // ── Build static shell once; the diff body re-renders on changes ──────────
  buildShell() {
    const c = this.contentEl;
    c.empty();
    c.createEl("em", {
      cls: "ivg-merge-count",
      text: `Exists in ${this.versions.length} total vault${this.versions.length !== 1 ? "s" : ""}`
    });
    const head = c.createEl("div", { cls: "ivg-diff-row ivg-diff-headrow" });
    const leftHead = head.createEl("div", { cls: "ivg-diff-cell" });
    head.createEl("div", { cls: "ivg-diff-gutter" });
    const rightHead = head.createEl("div", { cls: "ivg-diff-cell" });
    if (this.versions.length > 2) {
      const mkSelect = (cell, which, current) => {
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
    this.bodyEl = c.createEl("div", { cls: "ivg-merge-body" });
    const saveBar = c.createEl("div", { cls: "ivg-save-bar" });
    const leftWrap = saveBar.createEl("div", { cls: "ivg-save-left" });
    const copyR = leftWrap.createEl("button", { cls: "ivg-save-btn", text: "Copy all \u2192" });
    copyR.addEventListener("mousedown", (e) => e.preventDefault());
    copyR.addEventListener("click", () => this.copyAll("left-to-right"));
    const saveL = leftWrap.createEl("button", { cls: "ivg-save-btn", text: `Save ${this.versions[this.leftIdx].vaultName}` });
    saveL.addEventListener("mousedown", (e) => e.preventDefault());
    saveL.addEventListener("click", () => this.save("left"));
    saveBar.createEl("div", { cls: "ivg-save-gutter" });
    const rightWrap = saveBar.createEl("div", { cls: "ivg-save-right" });
    const copyL = rightWrap.createEl("button", { cls: "ivg-save-btn", text: "\u2190 Copy all" });
    copyL.addEventListener("mousedown", (e) => e.preventDefault());
    copyL.addEventListener("click", () => this.copyAll("right-to-left"));
    const saveR = rightWrap.createEl("button", { cls: "ivg-save-btn", text: `Save ${this.versions[this.rightIdx].vaultName}` });
    saveR.addEventListener("mousedown", (e) => e.preventDefault());
    saveR.addEventListener("click", () => this.save("right"));
    this.recomputeRows();
    this.renderBody();
  }
  recomputeRows() {
    this.rows = lineDiff(this.leftText, this.rightText).map((r) => ({ left: r.left, right: r.right }));
  }
  rowOp(r) {
    if (r.left !== null && r.right !== null) return r.left === r.right ? "same" : "changed";
    if (r.left !== null) return "del";
    return "add";
  }
  hunks() {
    const out = [];
    let start = -1;
    this.rows.forEach((r, i) => {
      const diff = this.rowOp(r) !== "same";
      if (diff && start === -1) start = i;
      if (!diff && start !== -1) {
        out.push({ start, end: i });
        start = -1;
      }
    });
    if (start !== -1) out.push({ start, end: this.rows.length });
    return out;
  }
  // ── Render the editable diff body ─────────────────────────────────────────
  renderBody() {
    const el = this.bodyEl;
    el.empty();
    const hunkOf = /* @__PURE__ */ new Map();
    for (const h of this.hunks()) hunkOf.set(h.start, h);
    this.rows.forEach((row, i) => {
      const op = this.rowOp(row);
      const rowEl = el.createEl("div", { cls: `ivg-diff-row ivg-op-${op}` });
      this.makeCell(rowEl, row, "left", op);
      const gutter = rowEl.createEl("div", { cls: "ivg-diff-gutter" });
      const hunk = hunkOf.get(i);
      if (hunk) {
        const toRight = gutter.createEl("button", { cls: "ivg-copy-btn", text: "\u25B6" });
        toRight.setAttribute("aria-label", "Use left for this block");
        toRight.addEventListener("mousedown", (e) => e.preventDefault());
        toRight.addEventListener("click", () => this.applyHunk(hunk, "left-to-right"));
        const toLeft = gutter.createEl("button", { cls: "ivg-copy-btn", text: "\u25C0" });
        toLeft.setAttribute("aria-label", "Use right for this block");
        toLeft.addEventListener("mousedown", (e) => e.preventDefault());
        toLeft.addEventListener("click", () => this.applyHunk(hunk, "right-to-left"));
      }
      this.makeCell(rowEl, row, "right", op);
    });
  }
  makeCell(rowEl, row, side, op) {
    const value = side === "left" ? row.left : row.right;
    const cell = rowEl.createEl("div", { cls: `ivg-diff-cell ivg-diff-${side}` });
    if (value === null) {
      cell.addClass("ivg-cell-absent");
      return;
    }
    cell.setAttribute("contenteditable", "true");
    cell.setAttribute("spellcheck", "false");
    cell.innerText = value;
    cell.addEventListener("input", () => {
      var _a;
      const text = (_a = cell.innerText) != null ? _a : "";
      if (side === "left") row.left = text;
      else row.right = text;
      this.recomputeTextsFromRows();
    });
    cell.addEventListener("blur", (e) => {
      const next = e.relatedTarget;
      if (next && this.bodyEl.contains(next)) return;
      this.recomputeRows();
      this.renderBody();
    });
  }
  recomputeTextsFromRows() {
    this.leftText = this.rows.filter((r) => r.left !== null).map((r) => r.left).join("\n");
    this.rightText = this.rows.filter((r) => r.right !== null).map((r) => r.right).join("\n");
  }
  applyHunk(hunk, dir) {
    for (let i = hunk.start; i < hunk.end; i++) {
      const r = this.rows[i];
      if (dir === "left-to-right") r.right = r.left;
      else r.left = r.right;
    }
    this.rows = this.rows.filter((r) => !(r.left === null && r.right === null));
    this.recomputeTextsFromRows();
    this.recomputeRows();
    this.renderBody();
  }
  copyAll(dir) {
    if (dir === "left-to-right") this.rightText = this.leftText;
    else this.leftText = this.rightText;
    this.recomputeRows();
    this.renderBody();
  }
  save(side) {
    const version = side === "left" ? this.versions[this.leftIdx] : this.versions[this.rightIdx];
    const text = side === "left" ? this.leftText : this.rightText;
    try {
      fs2.writeFileSync(version.filePath, text, "utf8");
      version.content = text;
      new import_obsidian2.Notice(`Saved "${this.title}" \u2192 ${version.vaultName}`);
    } catch (e) {
      new import_obsidian2.Notice(`Save failed: ${String(e)}`);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
function normalizePalette(p, i) {
  var _a, _b, _c, _d;
  const colors = Array.isArray(p.colors) && p.colors.length >= 3 ? [p.colors[0], p.colors[1], p.colors[2]] : ["#888888", "#aaaaaa", "#dddddd"];
  return {
    id: (_a = p.id) != null ? _a : `p${i}`,
    name: (_b = p.name) != null ? _b : `Preset ${i + 1}`,
    colors,
    vaultColors: (_c = p.vaultColors) != null ? _c : {},
    vaultStyles: (_d = p.vaultStyles) != null ? _d : {}
  };
}
function migrateGroups(raw) {
  var _a;
  if (!raw || !Array.isArray(raw.palettes)) return null;
  const pals = raw.palettes;
  const sel = (_a = pals.find((p) => p.id === raw.palette)) != null ? _a : pals[0];
  if (!sel) return null;
  const groups = [];
  if (typeof sel.diff === "string") groups.push({ id: "g1", query: "Diff(2+)", color: sel.diff });
  if (typeof sel.merged === "string") groups.push({ id: "g2", query: "Merged(*)", color: sel.merged });
  if (Array.isArray(sel.rules)) {
    sel.rules.forEach((r, i) => {
      var _a2, _b, _c;
      const t = (_a2 = r.type) != null ? _a2 : r.differs ? "diff" : "merge";
      const fn = t === "cut" ? "Meet" : t === "merge" ? "Merged" : "Diff";
      const v = (_b = r.vaults) != null ? _b : 0;
      const tok = !v ? "2+" : String(v);
      groups.push({ id: `gr${i}`, query: `${fn}(${tok})`, color: (_c = r.color) != null ? _c : "#888888" });
    });
  }
  return groups.length ? groups : null;
}
var IntervaultGraphPlugin = class extends import_obsidian3.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new IntervaultSettingTab(this.app, this));
    this.registerView(GRAPH_VIEW_TYPE, (leaf) => new GraphView(leaf, this));
    this.addCommand({
      id: "open-intervault-graph",
      name: "Open intervault graph",
      callback: () => this.openGraphView()
    });
    this.addRibbonIcon("git-fork", "Intervault Graph", () => this.openGraphView());
    injectStyles(activeDocument);
  }
  async openGraphView() {
    var _a;
    const existing = this.app.workspace.getLeavesOfType(GRAPH_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof GraphView) (_a = view.render) == null ? void 0 : _a.call(view);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  // onunload intentionally empty: do NOT detach leaves, as that resets
  // the leaf to its default location even if the user moved it.
  async loadSettings() {
    var _a, _b;
    const raw = await this.loadData();
    const merged = { ...DEFAULT_SETTINGS };
    if (raw) {
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (raw[k] !== void 0) merged[k] = raw[k];
      }
    }
    const ps = Array.isArray(merged.palettes) && merged.palettes.length ? merged.palettes : SEED_PALETTES.map(clonePalette);
    merged.palettes = ps.map(normalizePalette);
    if (!merged.palettes.some((p) => p.id === merged.palette)) {
      merged.palette = merged.palettes[0].id;
    }
    merged.filters = Array.isArray(raw == null ? void 0 : raw.filters) ? raw.filters.filter((f) => f != null && typeof f.query === "string").map((f, i) => {
      var _a2;
      return { id: (_a2 = f.id) != null ? _a2 : `f${i}`, query: f.query };
    }) : [];
    if (Array.isArray(raw == null ? void 0 : raw.groups)) {
      merged.groups = raw.groups.filter((g) => g != null && typeof g.query === "string").map((g, i) => {
        var _a2, _b2;
        return { id: (_a2 = g.id) != null ? _a2 : `g${i}`, query: g.query, color: (_b2 = g.color) != null ? _b2 : "#888888" };
      });
    } else {
      merged.groups = (_a = migrateGroups(raw)) != null ? _a : defaultGroups();
    }
    merged.display = { ...defaultDisplay(), ...(_b = raw == null ? void 0 : raw.display) != null ? _b : {} };
    this.settings = merged;
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
function injectStyles(doc) {
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
    /* Rule single-textbox (Function(N) format) \u2014 half-width */
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
    /* Vault selector embedded inside the diff column header \u2014 flat combobox style */
    /* Zero the cell's own padding so the select fills edge-to-edge */
    .ivg-diff-headrow .ivg-diff-cell:has(.ivg-head-select) { padding: 0; }
    .ivg-head-select {
      width: 100%; box-sizing: border-box;
      font-weight: 600; font-size: 12px;
      background: var(--background-secondary);
      border: none; /* headrow already provides the outer border; select needs none */
      border-radius: 0; /* headrow overflow:hidden clips corners to match rounding */
      outline: none; color: var(--text-normal); cursor: pointer;
      padding: 1px 8px; margin: 0; /* 1px vertical \u2192 shorter row */
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
