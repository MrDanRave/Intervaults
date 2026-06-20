import * as fs from "fs";
import * as path from "path";

export interface VaultConfig {
  name: string; // display name + obsidian://open vault name
  path: string; // absolute folder path
}

// title -> (vaultName -> absolute file path)
export type TitleIndex = Map<string, Map<string, string>>;

export interface GraphData {
  vaults: VaultConfig[];
  titleIndex: TitleIndex;
  // titles present in >= 2 vaults
  sharedTitles: string[];
}

/** Recursively collect .md file paths under a folder (filenames only — no content reads). */
function collectMarkdown(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip .obsidian, .git, etc.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(full, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Build the cross-vault title index from filenames only. */
export function buildGraphData(vaults: VaultConfig[]): GraphData {
  const titleIndex: TitleIndex = new Map();

  for (const vault of vaults) {
    const files = collectMarkdown(vault.path);
    for (const file of files) {
      const title = path.basename(file, ".md");
      if (!titleIndex.has(title)) titleIndex.set(title, new Map());
      // First occurrence per vault wins (duplicate titles within a vault are rare)
      const byVault = titleIndex.get(title)!;
      if (!byVault.has(vault.name)) byVault.set(vault.name, file);
    }
  }

  const sharedTitles: string[] = [];
  for (const [title, byVault] of titleIndex) {
    if (byVault.size >= 2) sharedTitles.push(title);
  }
  sharedTitles.sort();

  return { vaults, titleIndex, sharedTitles };
}
