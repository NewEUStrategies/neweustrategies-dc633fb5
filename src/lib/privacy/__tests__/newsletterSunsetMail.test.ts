// Krok `jobs-tick` wysyłki próśb o potwierdzenie (wygaszanie, I9d-Y1).
//
// Co tu ma się nie zepsuć (a czego nie widać w UI):
//   1. LIMIT: krok bierze porcję `NEWSLETTER_SUNSET_MAIL_BATCH`; dzienny limit
//      na najemcę (reputacja domeny) liczy baza w `newsletter_sunset_claim`
//      (parytet stałej: dataRetentionParity, zachowanie: pgTAP
//      hub_i9d_newsletter_sunset_cap_test.sql) - krok nie może go obejść,
//      np. ponawiając zajęcie w pętli;
//   2. `suppressed` (lista wyłączeń) = JAK WYSŁANA - inaczej cykl bez terminu
//      wisiałby wiecznie; adres NIE trafia na listę wyłączeń;
//   3. błąd = PONÓW (`failed` z kodem, nie treścią) - bez wysłanej prośby nikt
//      nie zostanie usunięty;
//   4. idempotencja i język: jeden klucz na cykl, mail w języku subskrybenta,
//      link podpisany i wskazujący endpoint najemcy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  enqueue: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@/lib/email/transactional.server", () => ({ enqueueRawEmail: h.enqueue }));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.gate }));

import { NEWSLETTER_SUNSET_MAIL_BATCH, NEWSLETTER_SUNSET_MAIL_LABEL } from "../newsletterSunset";
import { verifyNewsletterKeepToken } from "../newsletterKeepToken.server";
import {
  parseNewsletterSunsetClaims,
  runNewsletterSunsetMail,
  sunsetOutcomeOf,
} from "../newsletterSunsetMail.server";

const TENANT = "19d40000-0000-4000-8000-0000000000a0";
const OTHER = "19d40000-0000-4000-8000-0000000000b0";

function claim(n: number, patch: Record<string, unknown> = {}) {
  return {
    subscriber_id: `6f9e6f6e-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    tenant_id: TENANT,
    email: `s${n}@example.test`,
    lang: "pl",
    first_name: null,
    nonce: `1b2c3d4e-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    requested_at: "2026-10-22T02:07:00+00:00",
    delete_after: "2026-11-21T08:03:00+00:00",
    unsubscribe_token: `unsub${n}`.padEnd(32, "0"),
    attempt: 1,
    ...patch,
  };
}

interface Harness {
  admin: { rpc: ReturnType<typeof vi.fn>; from: (table: string) => unknown };
  db: ReturnType<typeof supabaseFromStub>;
  marks: Array<Record<string, unknown>>;
}

function harness(claims: unknown[], options: { claimError?: unknown; markOk?: boolean } = {}) {
  const db = supabaseFromStub();
  db.setResponse(
    "tenants",
    ok([
      { id: TENANT, domain: "think.example" },
      { id: OTHER, domain: null },
    ]),
  );
  db.setResponse("site_settings", ok([]));
  const marks: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "newsletter_sunset_claim") {
      return options.claimError
        ? { data: null, error: options.claimError }
        : { data: claims, error: null };
    }
    if (name === "newsletter_sunset_mark") {
      marks.push(args);
      return { data: { ok: options.markOk ?? true }, error: null };
    }
    throw new Error(`nieoczekiwane RPC ${name}`);
  });
  const admin = { rpc, from: db.from };
  return { admin, db, marks } satisfies Harness;
}

function run(hs: Harness, options: Parameters<typeof runNewsletterSunsetMail>[1] = {}) {
  return runNewsletterSunsetMail(hs.admin as never, {
    now: () => new Date("2026-10-22T08:03:00Z"),
    ...options,
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "sekret-testowy");
  h.enqueue.mockReset();
  h.enqueue.mockResolvedValue({ ok: true });
  h.gate.mockReset();
  h.gate.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("limit porcji i dzienny limit najemcy", () => {
  it("krok zajmuje JEDNĄ porcję (domyślnie 50) - dzienny limit liczy baza przy zajęciu", async () => {
    const hs = harness([]);
    expect(await run(hs)).toEqual({
      claimed: 0,
      queued: 0,
      duplicate: 0,
      suppressed: 0,
      failed: 0,
      deferred: 0,
      gone: 0,
    });
    const claims = hs.admin.rpc.mock.calls.filter((c) => c[0] === "newsletter_sunset_claim");
    expect(claims).toEqual([
      ["newsletter_sunset_claim", { p_limit: NEWSLETTER_SUNSET_MAIL_BATCH }],
    ]);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("baza oddała mniej niż porcję (limit dzienny wyczerpany) - krok nie dobiera drugi raz", async () => {
    const hs = harness([claim(1)]);
    await run(hs, { limit: 50 });
    expect(hs.admin.rpc.mock.calls.filter((c) => c[0] === "newsletter_sunset_claim")).toHaveLength(
      1,
    );
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("baza bez migracji wygaszania: `skipped`, nie błąd ticku", async () => {
    const hs = harness([], { claimError: { message: "not found", code: "PGRST202" } });
    expect(await run(hs)).toMatchObject({ claimed: 0, skipped: "migration_pending" });
  });

  it("inny błąd zajęcia to błąd kroku (widoczny w dzienniku przebiegów)", async () => {
    const hs = harness([], { claimError: { message: "boom", code: "57014" } });
    await expect(run(hs)).rejects.toThrow("boom");
  });
});

describe("wynik wysyłki -> stan cyklu", () => {
  it("w kolejce, duplikat, lista wyłączeń (= jak wysłana), błąd (= ponów) i brak odbiorcy", async () => {
    const hs = harness([claim(1), claim(2), claim(3), claim(4), claim(5)]);
    h.enqueue
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, skipped: "duplicate" })
      .mockResolvedValueOnce({ ok: false, skipped: "suppressed", reason: "suppressed:unsubscribe" })
      .mockResolvedValueOnce({ ok: false, error: 'duplicate key value "s4@example.test"' })
      .mockResolvedValueOnce({ ok: false, skipped: "no_recipient" });
    const result = await run(hs);
    expect(result).toMatchObject({ claimed: 5, queued: 1, duplicate: 1, suppressed: 2, failed: 1 });
    expect(hs.marks.map((m) => [m.p_outcome, m.p_error])).toEqual([
      ["queued", null],
      ["duplicate", null],
      ["suppressed", null],
      // Kod, nie treść błędu - komunikat cytował adres odbiorcy.
      ["failed", "enqueue_failed"],
      ["suppressed", null],
    ]);
    expect(hs.marks[0]).toMatchObject({
      p_subscriber: claim(1).subscriber_id,
      p_nonce: claim(1).nonce,
    });
  });

  it("mapowanie wyniku kolejki (czysta funkcja)", () => {
    expect(sunsetOutcomeOf({ ok: true })).toEqual({ outcome: "queued", code: null });
    expect(sunsetOutcomeOf({ ok: false, error: "supabase_unavailable" })).toEqual({
      outcome: "failed",
      code: "supabase_unavailable",
    });
  });

  it("cykl zniknął między zajęciem a zapisem (reakcja, wykluczenie) - `gone`", async () => {
    const hs = harness([claim(1)], { markOk: false });
    expect(await run(hs)).toMatchObject({ queued: 0, gone: 1 });
  });

  it("bramka reputacji domeny wstrzymuje najemcę: bez wysyłki, `failed` do ponowienia", async () => {
    h.gate.mockImplementation(async (_admin: unknown, tenantId: string) => ({
      allowed: tenantId !== TENANT,
    }));
    const hs = harness([claim(1), claim(2, { tenant_id: OTHER })]);
    const result = await run(hs);
    expect(result).toMatchObject({ queued: 1, failed: 1 });
    expect(hs.marks[0]).toMatchObject({ p_outcome: "failed", p_error: "reputation_blocked" });
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("termin kroku minął: reszta porcji czeka na dzierżawę (bez maila i bez zapisu)", async () => {
    const hs = harness([claim(1), claim(2)]);
    const result = await run(hs, { deadlineAt: Date.now() - 1 });
    expect(result).toMatchObject({ claimed: 2, deferred: 2, queued: 0 });
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(hs.marks).toEqual([]);
  });
});

describe("mail: kolejka, etykieta, język, link", () => {
  it("wspólna kolejka z etykietą masową, kluczem cyklu, najemcą i wypisem RFC 8058", async () => {
    const hs = harness([claim(7, { lang: "en", first_name: "Ann" })]);
    await run(hs);
    const [mail] = h.enqueue.mock.calls[0] as [Record<string, unknown>];
    expect(mail).toMatchObject({
      to: "s7@example.test",
      label: NEWSLETTER_SUNSET_MAIL_LABEL,
      category: "bulk",
      idempotencyKey: `newsletter_sunset:${claim(7).subscriber_id}:${claim(7).nonce}`,
      tenantId: TENANT,
      unsubscribeUrl: `https://think.example/api/public/newsletter/unsubscribe?token=${claim(7).unsubscribe_token}`,
    });
    expect(mail.subject).toContain("Do you still want our newsletter?");
    expect(mail.html).toContain("Hi Ann,");
    // Link podpisany: subskrybent i nonce cyklu, ważny po terminie reakcji.
    const href =
      /href="(https:\/\/think\.example\/api\/public\/newsletter\/keep\?token=([^"&]+)&amp;lang=en)"/.exec(
        String(mail.html),
      );
    expect(href).not.toBeNull();
    const check = verifyNewsletterKeepToken(href?.[2], new Date("2026-12-01T00:00:00Z"));
    expect(check).toMatchObject({
      ok: true,
      subscriberId: claim(7).subscriber_id,
      nonce: claim(7).nonce,
    });
  });

  it("treść z panelu najemcy (site_settings) trafia do maila; najemca bez domeny - origin kanoniczny", async () => {
    const hs = harness([claim(1), claim(2, { tenant_id: OTHER })]);
    hs.db.setResponse(
      "site_settings",
      ok([
        {
          tenant_id: TENANT,
          value: { pl: { subject: "Zostajesz z nami?" }, en: {} },
        },
      ]),
    );
    await run(hs);
    const subjects = h.enqueue.mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjects[0]).toBe("Zostajesz z nami?");
    expect(subjects[1]).toContain("Czy nadal chcesz otrzymywać nasz newsletter?");
    const second = h.enqueue.mock.calls[1][0] as { html: string };
    expect(second.html).toContain("https://neweuropeanstrategies.com/api/public/newsletter/keep");
    // Odczyt treści przefiltrowany kluczem i najemcami porcji.
    expect(hs.db.lastChain("site_settings")?.argsOf("in")).toEqual(["tenant_id", [TENANT, OTHER]]);
  });

  it("subskrybent bez tokenu wypisu: mail bez nagłówka wypisu, ale z linkiem pozostania", async () => {
    const hs = harness([claim(1, { unsubscribe_token: null })]);
    await run(hs);
    const [mail] = h.enqueue.mock.calls[0] as [Record<string, unknown>];
    expect(mail.unsubscribeUrl).toBeNull();
    expect(String(mail.html)).toContain("/api/public/newsletter/keep?token=");
  });
});

describe("kontrakt wiersza zajęcia (rpc-shape newsletter_sunset_claim)", () => {
  it("poprawny wiersz -> DTO; rozjazd kontraktu jest głośny", () => {
    expect(parseNewsletterSunsetClaims(null)).toEqual([]);
    expect(parseNewsletterSunsetClaims([claim(1)])[0]).toMatchObject({
      subscriberId: claim(1).subscriber_id,
      lang: "pl",
      attempt: 1,
    });
    expect(() => parseNewsletterSunsetClaims([claim(1, { lang: "de" })])).toThrow("[0].lang");
    expect(() => parseNewsletterSunsetClaims([claim(1, { nonce: "x" })])).toThrow("[0].nonce");
    expect(() => parseNewsletterSunsetClaims({})).toThrow("$");
  });
});
