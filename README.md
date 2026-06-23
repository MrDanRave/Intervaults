# Intervaults

An [Obsidian](https://obsidian.md) plugin that renders multiple vaults as a single interactive graph, shows notes shared across vaults as intersections, and lets you diff and merge conflicting versions side-by-side.
> **Desktop only** — the plugin reads files directly from disk and requires the Obsidian desktop app.
<img width="958" height="529" alt="inter" src="https://github.com/user-attachments/assets/c28ed589-a15a-4efe-baed-c849e463a3db" />

>  This software was vibe coded.

---

## Features

### Cross-vault graph
- Configure any number of vault folder paths; each becomes a **line** in the graph.
- Notes that appear in two or more vaults become **intersection dots** where the lines cross.
- The graph uses a force-directed physics simulation (velocity-Verlet, many-body repulsion, spring links) so it settles into a readable layout automatically.
- Lines for vaults that share many notes **braid** through each other — a Catmull-Rom spline with sine-sampled lobes that cross at every shared note.

### Interactive canvas
- **Drag** any dot or line to rearrange the layout; release to let physics continue.
- **Scroll** to zoom; **drag the background** to pan.
- **Click** a vault line to open that vault in Obsidian.
- **Click** an intersection dot to open the note (if identical across vaults) or open the diff/merge view (if versions differ).

### Diff / Merge editor
- Side-by-side diff view with per-line colour coding (added / removed / changed).
- **Copy block** buttons (▶ / ◀) in the gutter to accept one side for each changed hunk.
- **Copy all** buttons at the bottom of each column.
- Fully **editable** cells — type freely, press Enter for newlines.
- **Save** each side independently back to disk.
- For 3 + vaults, vault selectors are embedded directly in the column headers.

### Intersection query language
Filters and colour groups use a small query language:

| Function | Matches when… |
|---|---|
| `Meet(n)` | the note appears in exactly `n` vaults |
| `Merged(n)` | the largest group of identical versions spans `n` vaults |
| `Diff(n)` | the note has `n` distinct content versions |

Append `+` / `-` for ranges, or `*` for "all vaults note appears in":

```
Meet(3)      — in exactly 3 vaults
Diff(2+)     — at least 2 distinct versions
Merged(*)    — fully identical across every vault
```

**Filters** (AND-combined) decide which intersections are drawn at all.  
**Groups** (first-match-wins, draggable to reorder) decide the dot colour.

### Display controls
All visual parameters are live-adjustable without reshuffling the graph:

| Setting | Effect |
|---|---|
| Intersection size | Dot radius (2 – 10 px) |
| Braid amount | Amplitude of the weave (0 – 2) |
| Line thickness | Stroke width multiplier (0.5 – 2.5) |
| Intersection labels | Show / hide note-title labels under dots |
| Fade zoom | Labels fade as you zoom out; slider sets the threshold |
| Vault labels | Show / hide vault name labels at line ends |

### Themes
- Five built-in colour presets: **Espion**, **Nature**, **Ice**, **Flame**, **Magic**.
- Create custom presets cloned from any existing one; rename or delete them.
- Per-vault line colour and line style (Solid / Striped / Double) overrides per preset.
- **Restore Defaults** resets all seed presets and intersection rules without touching your custom presets.

---

## Installation

### From the Obsidian community plugins list *(coming soon)*
1. Open **Settings → Community plugins → Browse**.
2. Search for **Intervault Graph** and install.

### Manual install
1. Download `main.js` and `manifest.json` from the [latest release](../../releases/latest).
2. Copy them into `<your-vault>/.obsidian/plugins/intervaults/`.
3. Enable the plugin in **Settings → Community plugins**.

### Build from source
```bash
git clone https://github.com/MrDanRave/intervaults
cd intervaults
npm install
npm run build   # outputs main.js
```

---

## Usage

1. Open **Settings → Intervaults** and enter one absolute vault folder path per line.
2. Click **Open graph** (or use the ribbon icon / command palette: *Open intervault graph*).
3. Expand **Settings** in the top-right corner of the graph view to adjust themes, filters, groups, and display parameters.

---

## Requirements

- Obsidian **1.7.2** or later.
- Desktop app (Windows, macOS, Linux) — mobile is not supported.

---

## License

[GPL v3](LICENSE) — Copyright (C) 2026 MrDanRave.
Free to use, modify, and distribute; any distributed modifications must remain open-source under the same license.
