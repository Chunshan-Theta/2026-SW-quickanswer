import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function getFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? getFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => /\.(ts|tsx)$/.test(path));
}

describe("browser/server boundary", () => {
  it("keeps Redis, Google APIs, and server-only modules out of client components", async () => {
    const files = await getFiles("src");
    const offenders: string[] = [];
    const forbiddenImport = /(?:from\s*|import\s*\()\s*["'](?:@\/server|(?:\.\.\/)+server|redis|googleapis|node:crypto)(?:\/[^"']*)?["']/;

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes('"use client"') && forbiddenImport.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
