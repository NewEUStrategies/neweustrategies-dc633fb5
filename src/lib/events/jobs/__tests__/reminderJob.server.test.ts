// Zaślepka zadania `runEventParticipantReminders` (tor A) - zamrożona sygnatura, jawny wynik `stub`.
//
// Harmonogram woła tę funkcję od pierwszego dnia (jobs-tick, cron
// społeczności). Dopóki tor A nie wymieni treści modułu, zadanie nie może
// udawać pracy: same zera i `note: "stub"`, bez dotykania bazy. Tor A
// przepisuje ten plik razem ze swoim modułem.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import { runEventParticipantReminders } from "@/lib/events/jobs/reminderJob.server";

describe("runEventParticipantReminders (zaślepka Foundation)", () => {
  it("zwraca zera z note=stub i nie dotyka bazy", async () => {
    const rpc = vi.fn();
    const from = vi.fn();
    const admin = { rpc, from } as unknown as SupabaseClient<Database>;
    await expect(
      runEventParticipantReminders(admin, { deadlineAt: Date.now() + 6_000, limit: 5 }),
    ).resolves.toEqual({
      claimed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      note: "stub",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
