import { GraphData } from "./index";

export interface Point {
  x: number;
  y: number;
}

export interface NoteNode {
  title: string;
  pos: Point;
  vaults: string[];
}

export interface VaultMeta {
  name: string;
  color: string;
  order: string[];   // shared-note titles in a GLOBAL order (also the draw order)
  bow: number;       // per-vault braid amplitude (random 19–32)
  noteCount: number; // total notes in the vault (drives line width)
  labelEnd: 0 | 1;   // which extended end the label sits at (random per refresh)
  shade: string;     // per-vault grey shade so lines differ at a glance
}

export interface Scatter {
  width: number;
  height: number;
  notes: NoteNode[];
  vaults: VaultMeta[];
}

const PALETTE = [
  "#e06c75", "#61afef", "#98c379", "#c678dd", "#e5c07b",
  "#56b6c2", "#d19a66", "#be5046", "#528bff", "#7f848e",
];



/**
 * Centripetal Catmull-Rom spline (alpha = 0.5) through points → cubic Bézier.
 * Centripetal parametrisation avoids the overshoot loops/cusps that uniform
 * Catmull-Rom produces when waypoints are unevenly spaced.
 */
export function smoothPath(pts: Point[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const EPS = 1e-3;
  const knot = (a: Point, b: Point) => Math.sqrt(Math.max(EPS, Math.hypot(a.x - b.x, a.y - b.y)));

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];

    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);

    // Barry-Goldman tangents at p1 and p2, scaled to this segment
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

/** Scattered anchor positions + a fixed GLOBAL per-vault note order. */
export function computeScatter(data: GraphData, width = 900, height = 620): Scatter {
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.46;

  const titles = [...data.sharedTitles]; // already globally sorted

  const notes: NoteNode[] = [];
  titles.forEach((title) => {
    // Random spawn point (uniform in a disk) → a fresh arrangement each refresh
    const theta = Math.random() * Math.PI * 2;
    const r = R * Math.sqrt(Math.random());
    notes.push({
      title,
      pos: { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) },
      vaults: [...(data.titleIndex.get(title)?.keys() ?? [])],
    });
  });

  const vaults: VaultMeta[] = data.vaults.map((vault, vi) => {
    let total = 0;
    for (const vmap of data.titleIndex.values()) if (vmap.has(vault.name)) total++;
    // Varied grey shade (lightness spread) so lines are distinguishable at rest
    const lightness = 50 + ((vi * 47) % 30); // 50–79%
    return {
      name: vault.name,
      color: PALETTE[vi % PALETTE.length],
      order: titles.filter((t) => data.titleIndex.get(t)?.has(vault.name)),
      bow: 19 + Math.random() * 13, // 19–32, fixed once per layout
      noteCount: total,
      labelEnd: Math.random() < 0.5 ? 0 : 1,
      shade: `hsl(225, 7%, ${lightness}%)`,
    };
  });

  return { width, height, notes, vaults };
}

export const VAULT_PALETTE = PALETTE;
