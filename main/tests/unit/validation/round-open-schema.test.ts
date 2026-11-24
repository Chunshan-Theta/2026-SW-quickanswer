import { describe, expect, it } from "vitest";
import { roundOpenSchema } from "@/lib/validation/schemas";

describe("roundOpenSchema", () => {
  it("accepts several question numbers at once", () => {
    expect(roundOpenSchema.parse({ questionNumbers: ["1", " 2 "] })).toEqual({ questionNumbers: ["1", "2"], legacy: false });
  });

  it("keeps accepting the legacy single question number", () => {
    expect(roundOpenSchema.parse({ questionNumber: "3" })).toEqual({ questionNumbers: ["3"], legacy: true });
  });

  it.each([
    [{}],
    [{ questionNumbers: [] }],
    [{ questionNumbers: ["1", "1"] }],
    [{ questionNumbers: ["one"] }],
    [{ questionNumbers: "1" }],
    [{ questionNumber: "" }],
  ])("rejects %j", (body) => {
    expect(roundOpenSchema.safeParse(body).success).toBe(false);
  });
});
