import { createHash } from "node:crypto";
import type { WorksheetGrid } from "@/features/sheets/domain/worksheet-parser";

export function worksheetFingerprint(grid: WorksheetGrid): string {
  return createHash("sha256").update(JSON.stringify(grid)).digest("hex");
}
