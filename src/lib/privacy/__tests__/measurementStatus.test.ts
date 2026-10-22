// Porcja zgód na pomiar w chwili wysyłki kampanii (I9d-Y2): normalizacja
// adresów, podział na porcje limitu RPC, awaria = bez pomiaru.
import { describe, expect, it, vi } from "vitest";

import { fetchMeasuredEmails, MEASUREMENT_STATUS_BATCH } from "../measurementStatus.server";

const TENANT = "e5000000-0000-0000-0000-0000000000a0";

function client(handler: (args: Record<string, unknown>) => unknown) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe("email_measurement_status");
      return handler(args) as { data: unknown; error: null };
    }),
  };
}

describe("fetchMeasuredEmails", () => {
  it("zwraca tylko adresy z `measured` = true (zgoda ORAZ przełącznik), znormalizowane", async () => {
    const db = client((args) => ({
      data: (args.p_emails as string[]).map((email) => ({
        email,
        consent: true,
        measured: email !== "b@x.test",
      })),
      error: null,
    }));
    const out = await fetchMeasuredEmails(db, TENANT, [" A@X.test", "b@x.test", "a@x.test", ""]);
    expect([...out]).toEqual(["a@x.test"]);
    // Bez duplikatów i pustych; najemca z serwera.
    expect(db.rpc).toHaveBeenCalledWith("email_measurement_status", {
      p_tenant: TENANT,
      p_emails: ["a@x.test", "b@x.test"],
    });
  });

  it("dzieli duże zbiory na porcje limitu bazy", async () => {
    const emails = Array.from(
      { length: MEASUREMENT_STATUS_BATCH + 5 },
      (_, index) => `u${index}@x.test`,
    );
    const db = client((args) => ({
      data: (args.p_emails as string[]).map((email) => ({ email, consent: true, measured: true })),
      error: null,
    }));
    const out = await fetchMeasuredEmails(db, TENANT, emails);
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(out.size).toBe(emails.length);
  });

  it("błąd, zły kształt albo wyjątek RPC = porcja BEZ pomiaru (nigdy pomiar bez zgody)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const handler of [
      () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      () => ({ data: { email: "a@x.test", measured: true }, error: null }),
      () => {
        throw new Error("network");
      },
    ]) {
      const out = await fetchMeasuredEmails(client(handler), TENANT, ["a@x.test"]);
      expect(out.size).toBe(0);
    }
    // Log bez adresów (komunikat Postgresa mógłby cytować parametry).
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("a@x.test");
    spy.mockRestore();
  });

  it("pusta lista = zero wywołań", async () => {
    const db = client(() => ({ data: [], error: null }));
    expect((await fetchMeasuredEmails(db, TENANT, [])).size).toBe(0);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
