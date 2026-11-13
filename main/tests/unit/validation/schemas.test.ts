import { describe, expect, it } from "vitest";
import { mappingConfirmationSchema } from "@/lib/validation/schemas";

describe("mappingConfirmationSchema", () => {
  it("accepts confirmations for more than 200 source questions", () => {
    const resolutions = Array.from({ length: 205 }, (_, index) => ({
      questionNumber: String(index + 1),
      answerSlotToken: `slot-token-${String(index + 1).padStart(16, "0")}`,
    }));

    expect(mappingConfirmationSchema.safeParse({ resolutions }).success).toBe(true);
  });
});
