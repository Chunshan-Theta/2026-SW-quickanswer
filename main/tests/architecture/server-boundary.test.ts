import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type SourceMap = Map<string, string>;

async function getFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? getFiles(path) : [path];
  }));
  return files.flat().filter((path) => /\.(ts|tsx)$/.test(path));
}

function isClientModule(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === "use client",
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        specifiers.add(node.arguments[0].text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...specifiers];
}

function resolveInternalModule(specifier: string, importer: string, sourceRoot: string, sources: SourceMap): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(importer), specifier)
      : null;
  if (!base) return null;

  const candidates = extname(base)
    ? [base]
    : [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}${extension}`)
      .concat([".ts", ".tsx", ".js", ".jsx"].map((extension) => join(base, `index${extension}`)));
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

function isForbiddenSpecifier(specifier: string): boolean {
  return /^(?:@\/server(?:\/|$)|(?:\.\.\/)+server(?:\/|$)|(?:redis|googleapis|server-only)(?:\/|$)|node:crypto$)/.test(specifier);
}

function findClientBoundaryViolations(sources: SourceMap, sourceRoot: string): string[] {
  const entries = [...sources.entries()]
    .filter(([, source]) => isClientModule(ts.createSourceFile("client.tsx", source, ts.ScriptTarget.Latest, true)))
    .map(([path]) => path);
  const violations = new Set<string>();

  for (const entry of entries) {
    const visited = new Set<string>();
    const visit = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      const source = sources.get(path);
      if (source === undefined) return;
      const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

      for (const specifier of moduleSpecifiers(sourceFile)) {
        if (isForbiddenSpecifier(specifier)) violations.add(`${entry} -> ${specifier}`);
        const dependency = resolveInternalModule(specifier, path, sourceRoot, sources);
        if (!dependency) continue;
        if (dependency.startsWith(`${resolve(sourceRoot, "server")}${sep}`)) {
          violations.add(`${entry} -> ${dependency}`);
        } else {
          visit(dependency);
        }
      }
    };
    visit(entry);
  }
  return [...violations].sort();
}

describe("browser/server boundary", () => {
  it("finds server dependencies reached through re-exports, side effects, and dynamic imports", () => {
    const sourceRoot = resolve("/virtual/src");
    const sources: SourceMap = new Map([
      [resolve(sourceRoot, "client.tsx"), '"use client"; export * from "./barrel";'],
      [resolve(sourceRoot, "barrel.ts"), 'import "./side-effect"; export { load } from "./dynamic";'],
      [resolve(sourceRoot, "side-effect.ts"), 'import "server-only";'],
      [resolve(sourceRoot, "dynamic.ts"), 'export const load = () => import("@/server/credentials");'],
      [resolve(sourceRoot, "server/credentials.ts"), "export const secret = true;"],
    ]);

    // Normalise Windows path separators so the assertion is platform independent.
    const violations = findClientBoundaryViolations(sources, sourceRoot).map((violation) => violation.replaceAll("\\", "/"));
    expect(violations).toEqual(expect.arrayContaining([
      expect.stringContaining("server-only"),
      expect.stringContaining("@/server/credentials"),
      expect.stringContaining("server/credentials.ts"),
    ]));
  });

  it("keeps Redis, Google APIs, and server-only modules out of transitive client dependencies", async () => {
    const sourceRoot = resolve("src");
    const files = await getFiles(sourceRoot);
    const sources = new Map(await Promise.all(files.map(async (path) => [path, await readFile(path, "utf8")] as const)));

    expect(findClientBoundaryViolations(sources, sourceRoot)).toEqual([]);
  });
});
