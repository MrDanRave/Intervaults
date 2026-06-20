// Tiny dependency-free force simulation (d3-force style), fully offline.
// Phase 1: simulates shared-note anchors with repulsion + centering + per-vault
// spring chains. Pinned bodies (fx/fy set) stay put while the rest settle.

export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null; // pinned x (null = free)
  fy: number | null;
}

export interface Link {
  source: string;
  target: string;
  distance: number;
}

export class Simulation {
  readonly bodies: Body[];
  private byId: Map<string, Body>;
  private links: Link[];

  private cx: number;
  private cy: number;

  alpha = 1;
  alphaMin = 0.001;
  alphaDecay = 0.022;
  friction = 0.6; // velocity retained per tick

  charge = -1600;       // repulsion strength (negative = repel)
  linkStrength = 0.35;
  centerStrength = 0.05;
  maxDisplace = 60;     // clamp per-tick movement for stability

  // Collinearity: each group of body ids is pulled toward its own best-fit
  // straight line, so a vault renders as a near-straight line (and overlapping
  // vaults can be drawn straight + weaving rather than both curving).
  alignGroups: string[][] = [];
  alignStrength = 0.09;

  constructor(bodies: Body[], links: Link[], cx: number, cy: number) {
    this.bodies = bodies;
    this.byId = new Map(bodies.map((b) => [b.id, b]));
    this.links = links;
    this.cx = cx;
    this.cy = cy;
  }

  get(id: string): Body | undefined {
    return this.byId.get(id);
  }

  reheat(a = 0.6) {
    if (this.alpha < a) this.alpha = a;
  }

  /** Advance one tick. Returns false when the simulation has cooled. */
  tick(): boolean {
    if (this.alpha < this.alphaMin) return false;
    this.alpha += (0 - this.alpha) * this.alphaDecay;
    const a = this.alpha;
    const n = this.bodies.length;

    // Many-body repulsion (O(n^2) — fine for the modest node counts here)
    for (let i = 0; i < n; i++) {
      const bi = this.bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = this.bodies[j];
        let dx = bi.x - bj.x;
        let dy = bi.y - bj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 === 0) { dx = (Math.cos(i) * 0.5); dy = (Math.sin(j) * 0.5); d2 = 0.25; }
        const dist = Math.sqrt(d2);
        const f = (this.charge * a) / d2;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        bi.vx -= fx; bi.vy -= fy;
        bj.vx += fx; bj.vy += fy;
      }
    }

    // Centering gravity
    for (const b of this.bodies) {
      b.vx += (this.cx - b.x) * this.centerStrength * a;
      b.vy += (this.cy - b.y) * this.centerStrength * a;
    }

    // Spring links
    for (const link of this.links) {
      const s = this.byId.get(link.source);
      const t = this.byId.get(link.target);
      if (!s || !t) continue;
      let dx = t.x - s.x;
      let dy = t.y - s.y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const diff = ((dist - link.distance) / dist) * this.linkStrength * a;
      const ox = dx * diff * 0.5;
      const oy = dy * diff * 0.5;
      s.vx += ox; s.vy += oy;
      t.vx -= ox; t.vy -= oy;
    }

    // Collinearity: pull each group toward its best-fit line (PCA principal axis)
    for (const group of this.alignGroups) {
      if (group.length < 3) continue;
      const ps: Body[] = [];
      let gx = 0;
      let gy = 0;
      for (const id of group) {
        const b = this.byId.get(id);
        if (b) { ps.push(b); gx += b.x; gy += b.y; }
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
        sxx += ux * ux; syy += uy * uy; sxy += ux * uy;
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

    // Integrate
    for (const b of this.bodies) {
      if (b.fx !== null) { b.x = b.fx; b.vx = 0; }
      else {
        b.vx *= this.friction;
        b.vx = Math.max(-this.maxDisplace, Math.min(this.maxDisplace, b.vx));
        b.x += b.vx;
      }
      if (b.fy !== null) { b.y = b.fy; b.vy = 0; }
      else {
        b.vy *= this.friction;
        b.vy = Math.max(-this.maxDisplace, Math.min(this.maxDisplace, b.vy));
        b.y += b.vy;
      }
    }

    return true;
  }
}
