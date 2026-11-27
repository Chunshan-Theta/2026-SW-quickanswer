import { describe, expect, it } from "vitest";
import { activityImportSchema } from "@/lib/validation/schemas";

const base = { spreadsheetId: "sheet-1", sheetId: 0, groupNames: ["A", "B"] };

describe("activityImportSchema spreadsheetTitle (006)", () => {
  it("keeps accepting imports without a title", () => {
    const parsed = activityImportSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("spreadsheetTitle");
  });

  it("accepts and trims the Picker file name", () => {
    const parsed = activityImportSchema.safeParse({ ...base, spreadsheetTitle: "  題組+單題範本 的副本  " });
    expect(parsed.success && parsed.data.spreadsheetTitle).toBe("題組+單題範本 的副本");
  });

  it("drops an empty title and rejects an overlong one", () => {
    const empty = activityImportSchema.safeParse({ ...base, spreadsheetTitle: "   " });
    expect(empty.success).toBe(true);
    expect(empty.data).not.toHaveProperty("spreadsheetTitle");
    expect(activityImportSchema.safeParse({ ...base, spreadsheetTitle: "x".repeat(201) }).success).toBe(false);
  });
});
