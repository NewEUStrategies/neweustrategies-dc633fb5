// Krok `jobs-tick` wysyłki próśb o zgodę na pomiar (I9d-Y2, „Poproś o zgodę
// na pomiar" z panelu newslettera).
//
// Co tu ma się nie zepsuć (a czego nie widać w UI):
//   1. LIMIT: krok bierze JEDNĄ porcję; dzienny limit wspólny z prośbami
//      wygaszania liczy baza przy zajęciu (pgTAP hub_i9d_y2_reconfirm_test.sql)
//      - krok nie może go obejść, dobierając w pętli;
//   2. LISTA WYŁĄCZEŃ: kategoria `bulk` - bramka kolejki blokuje adres po
//      wypisie/odbiciu/skardze, wynik `suppressed` bez maila;
//   3. błąd = PONÓW (`failed` z kodem, nie treścią);
//   4. idempotencja, język i link: jeden klucz na prośbę, mail w języku
//      subskrybenta, link `mc:` podpisany, jednorazowy (nonce) i z terminem;
//   5. treść: mail pokazuje dosłowną treść OSOBNEJ zgody na pomiar, którą
//      zapisze kliknięcie (I9d-Y2b - nie treść zgody na newsletter), i sam NIE
//      mierzy (bez piksela, bez linków z identyfikatorem);
//   6. pochodzenie (I9d-Y2b): prośba po zapisie (`origin = 'signup'`) ma
//      treść STAŁĄ (nadpisania z panelu ignorowane), a przebieg poza oknem
//      zajmuje wyłącznie takie prośby (`p_origin`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  enqueue: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@/lib/email/transactional.server", () => ({ enqueueRawEmail: h.enqueue }));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.gate }));

import { MEASUREMENT_CONFIRM_LINK_DAYS } from "../measurement";
import {
  NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY,
  NEWSLETTER_MEASUREMENT_DEFAULT_COPY,
  NEWSLETTER_MEASUREMENT_MAIL_BATCH,
  NEWSLETTER_MEASUREMENT_MAIL_LABEL,
  NEWSLETTER_MEASUREMENT_SIGNUP_COPY,
} from "../measurementReconfirm";
import {
  parseNewsletterMeasurementClaims,
  runNewsletterMeasurementMail,
} from "../measurementReconfirmMail.server";
import { verifyMeasurementToken } from "../measurementToken.server";
import { newsletterConsentPlain } from "@/lib/newsletter/consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";

const TENANT = "19d40000-0000-4000-8000-0000000000a0";
const NOW = new Date("2026-10-22T08:04:00Z");

function claim(n: number, patch: Record<string, unknown> = {}) {
  return {
    subscriber_id: `6f9e6f6e-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    tenant_id: TENANT,
    email: `s${n}@example.test`,
    lang: "pl",
    first_name: null,
    nonce: `1b2c3d4e-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    consent_version: EMAIL_MEASUREMENT_CONSENT_VERSION,
    unsubscribe_token: `unsub${n}`.padEnd(32, "0"),
    attempt: 1,
    origin: "panel",
    ...patch,
  };
}

function harness(
  claims: unknown[],
  options: { claimError?: unknown; markOk?: boolean; settings?: unknown[] } = {},
) {
  const db = supabaseFromStub();
  db.setResponse("tenants", ok([{ id: TENANT, domain: "think.example" }]));
  db.setResponse("site_settings", ok(options.settings ?? []));
  const marks: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "newsletter_measurement_claim") {
      return options.claimError
        ? { data: null, error: options.claimError }
        : { data: claims, error: null };
    }
    if (name === "newsletter_measurement_mark") {
      marks.push(args);
      return { data: { ok: options.markOk ?? true }, error: null };
    }
    throw new Error(`nieoczekiwane RPC ${name}`);
  });
  return { admin: { rpc, from: db.from }, db, marks };
}

function run(
  hs: ReturnType<typeof harness>,
  options: Parameters<typeof runNewsletterMeasurementMail>[1] = {},
) {
  return runNewsletterMeasurementMail(hs.admin as never, { now: () => NOW, ...options });
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

describe("porcja i limit", () => {
  it("JEDNA porcja (domyślnie 50) - dzienny limit liczy baza przy zajęciu", async () => {
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
    expect(hs.admin.rpc.mock.calls).toEqual([
      ["newsletter_measurement_claim", { p_limit: NEWSLETTER_MEASUREMENT_MAIL_BATCH }],
    ]);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("baza bez migracji: `skipped`, nie błąd ticku; inny błąd = błąd kroku", async () => {
    expect(
      await run(harness([], { claimError: { message: "nf", code: "PGRST202" } })),
    ).toMatchObject({ claimed: 0, skipped: "migration_pending" });
    await expect(
      run(harness([], { claimError: { message: "boom", code: "57014" } })),
    ).rejects.toThrow("boom");
  });
});

describe("mail", () => {
  it("język, idempotencja, kategoria bulk, wypis RFC 8058, podpisany link zgody z terminem", async () => {
    const hs = harness([claim(1), claim(2, { lang: "en", first_name: "Jane" })]);
    const result = await run(hs);
    expect(result).toMatchObject({ claimed: 2, queued: 2, failed: 0 });
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    const [pl, en] = h.enqueue.mock.calls.map((c) => c[0]);
    expect(pl).toMatchObject({
      to: "s1@example.test",
      label: NEWSLETTER_MEASUREMENT_MAIL_LABEL,
      category: "bulk",
      tenantId: TENANT,
      idempotencyKey: `newsletter_measurement:${claim(1).subscriber_id}:${claim(1).nonce}`,
      subject: NEWSLETTER_MEASUREMENT_DEFAULT_COPY.pl.subject,
    });
    expect(pl.unsubscribeUrl).toMatch(
      /^https:\/\/think\.example\/api\/public\/newsletter\/unsubscribe\?token=unsub1/,
    );
    expect(en.subject).toBe(NEWSLETTER_MEASUREMENT_DEFAULT_COPY.en.subject);

    const href = /href="(https:\/\/think\.example\/api\/public\/newsletter\/measurement[^"]+)"/
      .exec(pl.html)?.[1]
      ?.replace(/&amp;/g, "&");
    const url = new URL(href as string);
    expect(url.searchParams.get("lang")).toBe("pl");
    const check = verifyMeasurementToken(url.searchParams.get("token"), NOW);
    expect(check).toEqual({
      ok: true,
      action: "confirm",
      subscriberId: claim(1).subscriber_id,
      nonce: claim(1).nonce,
      expiresAt: new Date(NOW.getTime() + MEASUREMENT_CONFIRM_LINK_DAYS * 86_400_000),
    });
    expect(hs.marks).toEqual([
      {
        p_subscriber: claim(1).subscriber_id,
        p_nonce: claim(1).nonce,
        p_outcome: "queued",
        p_error: null,
      },
      {
        p_subscriber: claim(2).subscriber_id,
        p_nonce: claim(2).nonce,
        p_outcome: "queued",
        p_error: null,
      },
    ]);
  });

  it("mail pokazuje dosłowną treść OSOBNEJ zgody na pomiar (nie zgody na newsletter) i sam NIE mierzy", async () => {
    const hs = harness([claim(1), claim(2, { lang: "en" })]);
    await run(hs);
    const flat = (value: string) => value.replace(/\s+/g, " ");
    const [pl, en] = h.enqueue.mock.calls.map((c) => c[0] as { html: string; text: string });
    expect(flat(pl.text)).toContain(flat(measurementConsentPlain("pl")));
    expect(flat(en.text)).toContain(flat(measurementConsentPlain("en")));
    expect(flat(pl.text)).not.toContain(flat(newsletterConsentPlain("pl")));
    expect(pl.html).not.toContain("nl-open");
    expect(pl.html).not.toContain("nl-click");
  });

  it("treść z panelu najemcy (z imieniem) zamiast domyślnej", async () => {
    const overrides = {
      pl: {
        subject: "Pytanie od redakcji, {firstName}",
        preview: "",
        eyebrow: "",
        heading: "",
        intro: "",
        cta: "",
        note: "",
      },
      en: { subject: "", preview: "", eyebrow: "", heading: "", intro: "", cta: "", note: "" },
    };
    const hs = harness([claim(1, { first_name: "Anna" })], {
      settings: [{ tenant_id: TENANT, value: overrides }],
    });
    await run(hs);
    expect(h.enqueue.mock.calls[0][0].subject).toBe("Pytanie od redakcji, Anna");
    const reads = hs.db.chainsFor("site_settings");
    expect(reads[0]?.argsOf("eq")).toEqual(["key", NEWSLETTER_MEASUREMENT_COPY_SETTING_KEY]);
  });
});

describe("prośba po zapisie (`origin = 'signup'`, I9d-Y2b)", () => {
  const PANEL_OVERRIDES = {
    pl: {
      subject: "Pytanie od redakcji, {firstName}",
      preview: "Podgląd z panelu",
      eyebrow: "Panel",
      heading: "Nagłówek z panelu",
      intro: "Wstęp z panelu",
      cta: "Przycisk z panelu",
      note: "Notka z panelu",
    },
    en: { subject: "Panel", preview: "", eyebrow: "", heading: "", intro: "", cta: "", note: "" },
  };

  it("treść STAŁA w języku subskrybenta - nadpisania z panelu ignorowane; link zgody jak w prośbie z panelu", async () => {
    const hs = harness(
      [
        claim(1, { origin: "signup", first_name: "Anna" }),
        claim(2, { origin: "signup", lang: "en" }),
      ],
      { settings: [{ tenant_id: TENANT, value: PANEL_OVERRIDES }] },
    );
    expect(await run(hs)).toMatchObject({ claimed: 2, queued: 2 });

    const [pl, en] = h.enqueue.mock.calls.map(
      (c) => c[0] as { subject: string; html: string; text: string },
    );
    expect(pl.subject).toBe(NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl.subject);
    expect(en.subject).toBe(NEWSLETTER_MEASUREMENT_SIGNUP_COPY.en.subject);
    const flat = (value: string) => value.replace(/\s+/g, " ");
    expect(flat(pl.text)).toContain(NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl.cta);
    expect(flat(pl.text)).toContain(flat(measurementConsentPlain("pl")));
    for (const fragment of ["z panelu", "Pytanie od redakcji"]) {
      expect(pl.text).not.toContain(fragment);
      expect(pl.html).not.toContain(fragment);
    }
    const href = /href="(https:\/\/think\.example\/api\/public\/newsletter\/measurement[^"]+)"/
      .exec(pl.html)?.[1]
      ?.replace(/&amp;/g, "&");
    const check = verifyMeasurementToken(new URL(href as string).searchParams.get("token"), NOW);
    expect(check).toMatchObject({ ok: true, action: "confirm", nonce: claim(1).nonce });
  });

  it("prośba z panelu w tej samej porcji dalej bierze treść z panelu", async () => {
    const hs = harness([claim(1, { origin: "signup" }), claim(2, { first_name: "Anna" })], {
      settings: [{ tenant_id: TENANT, value: PANEL_OVERRIDES }],
    });
    await run(hs);
    const subjects = h.enqueue.mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjects).toEqual([
      NEWSLETTER_MEASUREMENT_SIGNUP_COPY.pl.subject,
      "Pytanie od redakcji, Anna",
    ]);
  });

  it("przebieg poza oknem: zajęcie WYŁĄCZNIE próśb po zapisie (`p_origin`)", async () => {
    const hs = harness([]);
    await run(hs, { origin: "signup", limit: 7 });
    expect(hs.admin.rpc.mock.calls).toEqual([
      ["newsletter_measurement_claim", { p_limit: 7, p_origin: "signup" }],
    ]);
  });

  it("baza bez filtra pochodzenia (przed I9d-Y2b): przebieg poza oknem = `migration_pending`", async () => {
    expect(
      await run(harness([], { claimError: { message: "nf", code: "PGRST202" } }), {
        origin: "signup",
      }),
    ).toMatchObject({ claimed: 0, skipped: "migration_pending" });
  });
});

describe("wynik wysyłki -> stan prośby", () => {
  it("lista wyłączeń -> `suppressed`; duplikat -> `duplicate`", async () => {
    h.enqueue
      .mockResolvedValueOnce({ ok: true, skipped: "suppressed" })
      .mockResolvedValueOnce({ ok: true, skipped: "duplicate" });
    const hs = harness([claim(1), claim(2)]);
    expect(await run(hs)).toMatchObject({ suppressed: 1, duplicate: 1 });
    expect(hs.marks.map((m) => m.p_outcome)).toEqual(["suppressed", "duplicate"]);
  });

  it("błąd kolejki -> `failed` z KODEM (nie treścią, która mogłaby cytować adres)", async () => {
    h.enqueue.mockResolvedValueOnce({ ok: false, error: "relation x: s1@example.test" });
    const hs = harness([claim(1)]);
    expect(await run(hs)).toMatchObject({ failed: 1 });
    expect(hs.marks[0]).toMatchObject({ p_outcome: "failed", p_error: "enqueue_failed" });
  });

  it("bramka reputacji wstrzymuje najemcę: `failed` bez maila", async () => {
    h.gate.mockResolvedValue({ allowed: false });
    const hs = harness([claim(1)]);
    await run(hs);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(hs.marks[0]).toMatchObject({ p_outcome: "failed", p_error: "reputation_blocked" });
  });

  it("termin kroku: reszta porcji wraca po dzierżawie (bez maila i bez zapisu)", async () => {
    const hs = harness([claim(1), claim(2)]);
    expect(await run(hs, { deadlineAt: Date.now() - 1 })).toMatchObject({ deferred: 2 });
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(hs.marks).toEqual([]);
  });

  it("prośba zniknęła przed zapisem wyniku -> `gone`", async () => {
    const hs = harness([claim(1)], { markOk: false });
    expect(await run(hs)).toMatchObject({ gone: 1, queued: 0 });
  });
});

describe("kontrakt wiersza zajęcia", () => {
  it("rozjazd kształtu to błąd kroku, nie cicha pusta wysyłka", () => {
    expect(parseNewsletterMeasurementClaims(null)).toEqual([]);
    expect(() => parseNewsletterMeasurementClaims({})).toThrow();
    expect(() => parseNewsletterMeasurementClaims([claim(1, { lang: "de" })])).toThrow(/lang/);
    expect(() => parseNewsletterMeasurementClaims([claim(1, { nonce: "x" })])).toThrow(/nonce/);
    const { consent_version: _omit, ...missing } = claim(1);
    expect(() => parseNewsletterMeasurementClaims([missing])).toThrow(/consent_version/);
    expect(parseNewsletterMeasurementClaims([claim(1)])[0]).toMatchObject({
      lang: "pl",
      consentVersion: EMAIL_MEASUREMENT_CONSENT_VERSION,
      attempt: 1,
      origin: "panel",
    });
  });

  it("`origin`: `signup` rozpoznany; brak kolumny (stara baza) albo obca wartość = `panel`", () => {
    expect(parseNewsletterMeasurementClaims([claim(1, { origin: "signup" })])[0].origin).toBe(
      "signup",
    );
    const { origin: _omit, ...legacy } = claim(1);
    expect(parseNewsletterMeasurementClaims([legacy])[0].origin).toBe("panel");
    expect(parseNewsletterMeasurementClaims([claim(1, { origin: "SIGNUP" })])[0].origin).toBe(
      "panel",
    );
    expect(parseNewsletterMeasurementClaims([claim(1, { origin: null })])[0].origin).toBe("panel");
  });
});
