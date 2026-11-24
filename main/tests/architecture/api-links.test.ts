import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
  }));
  return files.flat().filter((path) => path.endsWith(".tsx"));
}

describe("links to API routes", () => {
  // A next/link to an API route makes the client router fetch it first and then navigate again.
  // For /api/auth/google/start that issued two OAuth states, so Google's callback no longer
  // matched the state cookie ("Google 登入狀態無效或已過期。"). API routes need a plain <a>.
  it("never uses next/link for /api/ routes", async () => {
    const offenders: string[] = [];
    for (const path of await sourceFiles(resolve("src"))) {
      const source = await readFile(path, "utf8");
      if (/<Link\b[^>]*\bhref=["'{`]+\/api\//.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
