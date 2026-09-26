// Kontrakt zadań uczestnika: pusty wynik jest zamrożony i bez notatki.
import { describe, expect, it } from "vitest";

import { EMPTY_JOB_RESULT } from "@/lib/events/jobs/types";

describe("EMPTY_JOB_RESULT", () => {
  it("same zera, bez notatki, zamrożony (rozszerzany przez spread, nigdy mutowany)", () => {
    expect(EMPTY_JOB_RESULT).toEqual({ claimed: 0, sent: 0, skipped: 0, failed: 0 });
    expect(Object.isFrozen(EMPTY_JOB_RESULT)).toBe(true);
  });
});
