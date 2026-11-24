import { describe, expect, it } from "vitest";
import { mappingConfirmationSchema, writebackRequestSchema } from "@/lib/validation/schemas";

describe("mappingConfirmationSchema", () => {
  it("accepts confirmations for more than 200 source questions", () => {
    const resolutions = Array.from({ length: 205 }, (_, index) => ({
      questionNumber: String(index + 1),
      answerSlotToken: `slot-token-${String(index + 1).padStart(16, "0")}`,
    }));

    expect(mappingConfirmationSchema.safeParse({ resolutions }).success).toBe(true);
  });
});

describe("writebackRequestSchema selection (005)", () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";

  it("accepts the legacy body, a group selection and a typed answer per blank", () => {
    expect(writebackRequestSchema.parse({ requestId })).toEqual({ requestId });
    expect(writebackRequestSchema.parse({ requestId, selection: { source: "group", groupId: " teamB " } }))
      .toEqual({ requestId, selection: { source: "group", groupId: "teamB" } });
    expect(writebackRequestSchema.parse({ requestId, selection: { source: "teacher", answers: [" CPU ", "OS"] } }))
      .toEqual({ requestId, selection: { source: "teacher", answers: ["CPU", "OS"] } });
  });

  it("rejects incomplete or malformed selections", () => {
    for (const selection of [
      { source: "group", groupId: "" },
      { source: "group" },
      { source: "teacher", answers: [] },
      { source: "teacher", answers: ["CPU", "   "] },
      { source: "teacher", answers: ["x".repeat(4001)] },
      { source: "winner", groupId: "A" },
    ]) {
      expect(writebackRequestSchema.safeParse({ requestId, selection }).success).toBe(false);
    }
  });
});
