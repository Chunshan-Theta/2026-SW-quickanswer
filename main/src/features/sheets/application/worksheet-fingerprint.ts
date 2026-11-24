import { createHash } from "node:crypto";
import type { WorksheetParseResult } from "@/features/sheets/domain/worksheet-parser";

/**
 * Fingerprint of the question structure only (numbers, rows, answer-cell positions).
 * Answer-cell contents are excluded so a completed writeback never invalidates later ones.
 */
export function structureFingerprint(parsed: Pick<WorksheetParseResult, "structure">): string {
  return createHash("sha256").update(JSON.stringify(parsed.structure)).digest("hex");
}
