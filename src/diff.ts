export type DiffOp = "same" | "add" | "del";

export interface DiffRow {
  op: DiffOp;
  left: string | null;  // line in version A (null when added)
  right: string | null; // line in version B (null when removed)
}

/** Classic LCS line diff. Offline, dependency-free. */
export function lineDiff(a: string, b: string): DiffRow[] {
  const aLines = a.split(/\r?\n/);
  const bLines = b.split(/\r?\n/);
  const m = aLines.length;
  const n = bLines.length;

  // LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack to build aligned rows
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) {
      rows.push({ op: "same", left: aLines[i], right: bLines[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ op: "del", left: aLines[i], right: null });
      i++;
    } else {
      rows.push({ op: "add", left: null, right: bLines[j] });
      j++;
    }
  }
  while (i < m) { rows.push({ op: "del", left: aLines[i++], right: null }); }
  while (j < n) { rows.push({ op: "add", left: null, right: bLines[j++] }); }

  return rows;
}

export function hasDifferences(rows: DiffRow[]): boolean {
  return rows.some((r) => r.op !== "same");
}
