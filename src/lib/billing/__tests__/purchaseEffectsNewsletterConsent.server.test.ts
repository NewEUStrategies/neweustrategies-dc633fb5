// ZGODA NA NEWSLETTER PRZY ZAKUPIE (audyt rozliczeń, SUB-15).
//
// DEFEKT. Każda opłacona subskrypcja zapisywała kupującego na newsletter
// z wpisem `consents: [{ key: "newsletter_premium", granted: true, source:
// "subscription_checkout" }]`, choć checkout nie miał żadnego pola zgody
// (rejestr pokazywał zgodę, której nie udzielono - art. 7 ust. 1 RODO,
// art. 398 PKE). Upsert po (tenant_id, email) podmieniał przy tym `consents`
// i `confirmed_at` istniejącego subskrybenta, czyli niszczył dowód double
// opt-in wcześniejszego zapisu.
//
// KRYTERIUM ZAKOŃCZENIA, które przybija ten plik:
//   * bez zaznaczonego pola zgoda NIE powstaje (zero zapytań do listy),
//   * istniejące zgody i `confirmed_at` zostają po zakupie,
//   * zaznaczone pole daje wpis z dowodem (pełna treść, wersja, język, chwila,
//     zamówienie, subskrypcja) - także w rejestrze `crm_consent_log`,
//   * wycofanie nie jest przestawiane, a wypis i lista wykluczeń są nadrzędne.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta roli serwisowej (tabele + RPC listy
// wykluczeń) i wysyłkę poczty. `premiumNewsletter`, `suppressionPolicy`,
// katalog i uprawnienia biegną prawdziwym kodem. Zegar zamrożony; adresy
// syntetyczne (`example.com`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PurchaseContext } from "@/lib/billing/purchaseEffects.server";
import {
  PREMIUM_NEWSLETTER_CONSENT,
  PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS,
  PREMIUM_NEWSLETTER_CONSENT_TEXTS,
  PREMIUM_NEWSLETTER_CONSENT_VERSION,
  type PremiumNewsletterConsentGrant,
} from "@/lib/billing/premiumNewsletter";
import { BILLING_IDS, planLadder } from "@/test/billing/fixtures";
import {
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DZIEN, FIXED_NOW_ISO, MINUTA, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: null as { from: (table: string) => unknown } | null,
  rpc: null as { rpc: (name: string, args?: Record<string, unknown>) => unknown } | null,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("test: atrapa RPC nieustawiona (beforeEach)");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return { ...actual, sendTxEmail: () => Promise.resolve({ ok: true }) };
});

const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");

freezeClock();

const SUB = "sub_1SyntetycznaSubskrypcja";
const EMAIL = "klientka@example.com";
const ROW_ID = "nl-istniejacy";
const DOI_CONFIRMED_AT = relativeIso(-200 * DZIEN);
const ROW_UPDATED_AT = relativeIso(-3 * DZIEN);
const CONSENT_AT = relativeIso(-2 * MINUTA);
const TEXT_PL = PREMIUM_NEWSLETTER_CONSENT_TEXTS[PREMIUM_NEWSLETTER_CONSENT_VERSION]?.pl;

/** Dowód double opt-in z formularza na stronie - ma przetrwać zakup co do bajtu. */
const DOI_CONSENT = {
  key: "newsletter",
  text: "Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.",
  given: true,
  lang: "pl",
  received_at: relativeIso(-201 * DZIEN),
};

function grant(over: Partial<PremiumNewsletterConsentGrant> = {}): PremiumNewsletterConsentGrant {
  return {
    version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
    lang: "pl",
    at: CONSENT_AT,
    orderId: BILLING_IDS.order,
    ...over,
  };
}

/** Wpis, który ma powstać z `grant()` - kanoniczny kształt kolumny `consents`. */
const EXPECTED_ENTRY = {
  key: PREMIUM_NEWSLETTER_CONSENT,
  text: TEXT_PL,
  version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
  given: true,
  lang: "pl",
  timestamp: CONSENT_AT,
  received_at: FIXED_NOW_ISO,
  source: "subscription_checkout",
  subscription_id: SUB,
  order_id: BILLING_IDS.order,
};

function purchase(overrides: Partial<PurchaseContext> = {}): PurchaseContext {
  return {
    userId: BILLING_IDS.me,
    priceId: "plus_monthly",
    subscriptionId: SUB,
    periodEnd: relativeIso(30 * DZIEN),
    environment: "live",
    tenantId: BILLING_IDS.tenant,
    ...overrides,
  };
}

// --- scena ------------------------------------------------------------------

interface Scene {
  /** Kolejne odczyty wiersza subskrybenta (ostatni powtarza się do końca). */
  reads: (Record<string, unknown> | null)[];
  /** Ile warunkowych UPDATE-ów ma „przegrać wyścig" (zero zmienionych wierszy). */
  casMisses: number;
  /** Wstawienie trafia na wiersz dodany w międzyczasie (ON CONFLICT DO NOTHING). */
  insertConflict: boolean;
}

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let scene: Scene;

function isWrite(chain: RecordedChain): boolean {
  return chain.has("insert") || chain.has("update") || chain.has("upsert");
}

function subscriberRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROW_ID,
    status: "subscribed",
    unsubscribed_at: null,
    confirmed_at: DOI_CONFIRMED_AT,
    consents: [DOI_CONSENT],
    user_id: null,
    updated_at: ROW_UPDATED_AT,
    ...over,
  };
}

beforeEach(() => {
  scene = { reads: [null], casMisses: 0, insertConflict: false };
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  h.db = db;
  h.rpc = rpc;

  let readIndex = 0;
  db.setResponse("access_plans", (chain) => {
    const tier = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tier_key")?.args[1];
    const plan = planLadder().find(
      (p) => p.tenant_id === BILLING_IDS.tenant && p.tier_key === tier,
    );
    return ok(plan ?? planLadder()[0] ?? null);
  });
  db.setResponse(
    "profiles",
    ok({
      email: "  Klientka@Example.com ",
      first_name: "Anna",
      last_name: "Nowak",
      display_name: null,
      tenant_id: BILLING_IDS.tenant,
      prefs: { language: "pl" },
    }),
  );
  db.setResponse("user_subscriptions", ok(null));
  db.setResponse("crm_leads", ok(null));
  db.setResponse("notifications", ok(null));
  db.setResponse("crm_consent_log", ok(null));
  db.setResponse("newsletter_subscribers", (chain): SupabaseResult => {
    if (chain.has("upsert")) return ok(scene.insertConflict ? [] : [{ id: "nl-nowy" }]);
    if (chain.has("update")) {
      if (scene.casMisses > 0) {
        scene.casMisses -= 1;
        return ok([]);
      }
      return ok([{ id: ROW_ID }]);
    }
    // Odczyt języka odbiorcy maila (`notifications.server`) - inne kolumny.
    if (!String(chain.argsOf("select")?.[0] ?? "").includes("consents")) return ok(null);
    const row = scene.reads[Math.min(readIndex, scene.reads.length - 1)] ?? null;
    readIndex += 1;
    return ok(row);
  });
  rpc.setData("email_filter_suppressed", []);
});

const newsletterWrites = () => db.chainsFor("newsletter_subscribers").filter(isWrite);
const consentReads = () =>
  db
    .chainsFor("newsletter_subscribers")
    .filter((c) => !isWrite(c) && String(c.argsOf("select")?.[0] ?? "").includes("consents"));
const consentLogInserts = () =>
  db
    .chainsFor("crm_consent_log")
    .filter((c) => c.has("insert"))
    .map((c) => c.argsOf("insert")?.[0]);

function patchOf(index = 0): Record<string, unknown> | undefined {
  const chain = db.chainsFor("newsletter_subscribers").filter((c) => c.has("update"))[index];
  return chain?.argsOf("update")?.[0] as Record<string, unknown> | undefined;
}

function insertedRow(): Record<string, unknown> | undefined {
  const chain = db.chainsFor("newsletter_subscribers").find((c) => c.has("upsert"));
  return chain?.argsOf("upsert")?.[0] as Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------

describe("SUB-15: bez zaznaczonego pola zgoda nie powstaje", () => {
  it("zakup bez zgody nie pyta listy, wykluczeń ani rejestru zgód - a reszta skutków biegnie", async () => {
    scene.reads = [subscriberRow()];

    await applyPurchaseEffects(purchase());

    // Jedyny odczyt tej tabeli to język odbiorcy maila transakcyjnego - stanu
    // zgody nikt nawet nie czyta.
    expect(consentReads()).toHaveLength(0);
    expect(newsletterWrites()).toHaveLength(0);
    expect(db.chainsFor("crm_consent_log")).toHaveLength(0);
    expect(rpc.callsFor("email_filter_suppressed")).toHaveLength(0);
    // Zakup sam w sobie działa: dostęp i dzwonek są.
    expect(db.chainsFor("user_subscriptions").some(isWrite)).toBe(true);
    expect(db.chainsFor("notifications").some((c) => c.has("insert"))).toBe(true);
  });

  it.each([
    ["nieznana wersja treści", grant({ version: "2020-01-01" })],
    [
      "zgoda przeterminowana",
      grant({ at: relativeIso(-PREMIUM_NEWSLETTER_CONSENT_MAX_AGE_MS - 1) }),
    ],
    ["zgoda „z przyszłości”", grant({ at: relativeIso(DZIEN) })],
  ])("%s: brak zapisu i ostrzeżenie w logu", async (_, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyPurchaseEffects(purchase({ newsletterConsent: value }));

    expect(consentReads()).toHaveLength(0);
    expect(newsletterWrites()).toHaveLength(0);
    expect(rpc.callsFor("email_filter_suppressed")).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      "[payments] premium newsletter consent rejected (unknown version or stale)",
      { subscriptionId: SUB },
    );
    warn.mockRestore();
  });
});

describe("SUB-15: istniejący subskrybent - scalenie, nie nadpisanie", () => {
  it("dowód double opt-in i `confirmed_at` zostają; zgoda z checkoutu dopisana obok", async () => {
    scene.reads = [subscriberRow()];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(db.chainsFor("newsletter_subscribers").some((c) => c.has("upsert"))).toBe(false);
    // Łatka niesie WYŁĄCZNIE scalone zgody i brakujące powiązanie z kontem:
    // `confirmed_at`, status, źródło, język, imię i `meta` nie są dotykane.
    expect(patchOf()).toEqual({
      consents: [DOI_CONSENT, EXPECTED_ENTRY],
      user_id: BILLING_IDS.me,
    });
    // Zapis warunkowy: ten sam wiersz i ten sam stan, który przeczytaliśmy.
    const update = db.chainsFor("newsletter_subscribers").find((c) => c.has("update"));
    expect(update?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", ROW_ID],
      ["updated_at", ROW_UPDATED_AT],
    ]);
    // Wyzwalacz rejestru nie loguje UPDATE-u - dowód dopisujemy sami, pełną treścią.
    expect(consentLogInserts()).toEqual([
      {
        tenant_id: BILLING_IDS.tenant,
        email: EMAIL,
        source_type: "newsletter",
        source_id: ROW_ID,
        form_name: "Subskrypcja premium",
        consent_key: PREMIUM_NEWSLETTER_CONSENT,
        consent_text: TEXT_PL,
        consent_version: PREMIUM_NEWSLETTER_CONSENT_VERSION,
        given: true,
        lang: "pl",
      },
    ]);
  });

  it("wiersz już powiązany z kontem: łatka nie przepina `user_id`", async () => {
    scene.reads = [subscriberRow({ user_id: "konto-z-formularza" })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf()).toEqual({ consents: [DOI_CONSENT, EXPECTED_ENTRY] });
  });

  it("zapis oczekujący (DOI niedokończony) przechodzi w `subscribed` z `confirmed_at`, dowody formularza zostają", async () => {
    scene.reads = [subscriberRow({ status: "pending", confirmed_at: null })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf()).toEqual({
      consents: [DOI_CONSENT, EXPECTED_ENTRY],
      status: "subscribed",
      confirmed_at: FIXED_NOW_ISO,
      user_id: BILLING_IDS.me,
    });
  });

  it("wycofanie (`given: false`) nie jest przestawiane - nowa jawna zgoda to NOWY wpis", async () => {
    const withdrawn = { ...EXPECTED_ENTRY, given: false, timestamp: relativeIso(-10 * DZIEN) };
    scene.reads = [subscriberRow({ consents: [DOI_CONSENT, withdrawn] })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf()?.consents).toEqual([DOI_CONSENT, withdrawn, EXPECTED_ENTRY]);
  });

  it("ponowione zdarzenie: zgoda już zapisana - zero zapisów, zostaje najwcześniejszy dowód", async () => {
    const earlier = { ...EXPECTED_ENTRY, received_at: relativeIso(-1 * DZIEN) };
    scene.reads = [subscriberRow({ consents: [DOI_CONSENT, earlier] })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(newsletterWrites()).toHaveLength(0);
    expect(db.chainsFor("crm_consent_log")).toHaveLength(0);
  });

  it("dawny, fabrykowany wpis `granted: true` nie udaje dowodu - prawdziwa zgoda dopisuje się obok", async () => {
    const fabricated = {
      key: PREMIUM_NEWSLETTER_CONSENT,
      granted: true,
      granted_at: relativeIso(-20 * DZIEN),
      source: "subscription_checkout",
    };
    scene.reads = [subscriberRow({ consents: [fabricated] })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf()?.consents).toEqual([fabricated, EXPECTED_ENTRY]);
  });

  it("kolumna `consents`, która nie jest tablicą, zostaje nietknięta", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    scene.reads = [subscriberRow({ consents: { newsletter: true } })];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(newsletterWrites()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      "[payments] newsletter consents column is not an array - left intact",
      { subscriberId: ROW_ID },
    );
    error.mockRestore();
  });
});

describe("SUB-15: nowy adres - wiersz z dowodem zgody", () => {
  it("wstawienie bez nadpisywania, z pełną treścią, wersją, językiem, chwilą i zamówieniem", async () => {
    await applyPurchaseEffects(purchase({ newsletterConsent: grant({ lang: "en" }) }));

    const upsert = db.chainsFor("newsletter_subscribers").find((c) => c.has("upsert"));
    expect(upsert?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "tenant_id,email",
      ignoreDuplicates: true,
    });
    expect(insertedRow()).toEqual({
      tenant_id: BILLING_IDS.tenant,
      user_id: BILLING_IDS.me,
      email: EMAIL,
      first_name: "Anna",
      last_name: "Nowak",
      language: "en",
      status: "subscribed",
      source: "subscription",
      source_form_name: "Subskrypcja premium",
      confirmed_at: FIXED_NOW_ISO,
      unsubscribed_at: null,
      consents: [
        {
          ...EXPECTED_ENTRY,
          lang: "en",
          text: PREMIUM_NEWSLETTER_CONSENT_TEXTS[PREMIUM_NEWSLETTER_CONSENT_VERSION]?.en,
        },
      ],
      meta: { tier: "member", subscription_id: SUB },
    });
    // Rejestr `crm_consent_log` dla nowego wiersza wypełnia wyzwalacz bazy
    // (`newsletter_to_lead`, wpis ma `key` + `text`) - bez drugiej kopii z kodu.
    expect(db.chainsFor("crm_consent_log")).toHaveLength(0);
  });

  it("wiersz dodany w międzyczasie (formularz, druga dostawa): scalenie z nim zamiast nadpisania", async () => {
    scene.insertConflict = true;
    scene.reads = [null, subscriberRow()];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf()).toEqual({
      consents: [DOI_CONSENT, EXPECTED_ENTRY],
      user_id: BILLING_IDS.me,
    });
  });

  it("przegrany wyścig warunkowego zapisu: ponowny odczyt i scalenie z NOWSZYM stanem", async () => {
    const concurrent = { key: "rodo", text: "Zgoda z innego formularza.", given: true, lang: "pl" };
    scene.casMisses = 1;
    scene.reads = [
      subscriberRow(),
      subscriberRow({ consents: [DOI_CONSENT, concurrent], updated_at: relativeIso(-1 * MINUTA) }),
    ];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(patchOf(1)?.consents).toEqual([DOI_CONSENT, concurrent, EXPECTED_ENTRY]);
    // Rejestr dostaje dowód raz - po zapisie, który naprawdę wszedł.
    expect(consentLogInserts()).toHaveLength(1);
  });

  it("wyścig przegrany za każdym razem: nic nie zapisane, błąd w logu", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    scene.casMisses = 99;
    scene.reads = [subscriberRow()];

    await expect(
      applyPurchaseEffects(purchase({ newsletterConsent: grant() })),
    ).resolves.toBeUndefined();

    expect(db.chainsFor("crm_consent_log")).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      "[payments] premium newsletter opt-in failed",
      expect.objectContaining({ message: expect.stringContaining("losing the race") }),
    );
    error.mockRestore();
  });
});

describe("SUB-15: wypis i lista wykluczeń są nadrzędne wobec pola w checkoucie", () => {
  it("osoba wypisana nie wraca na listę - jej dowody zostają nietknięte", async () => {
    scene.reads = [
      subscriberRow({ status: "unsubscribed", unsubscribed_at: relativeIso(-5 * DZIEN) }),
    ];

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(newsletterWrites()).toHaveLength(0);
    expect(db.chainsFor("crm_consent_log")).toHaveLength(0);
  });

  it.each([
    // Pole w checkoucie nie jest double opt-in - wypis zdejmuje wyłącznie DOI.
    { reason: "unsubscribe", scope: "permanent", blocks: true },
    { reason: "complaint", scope: "permanent", blocks: true },
    { reason: "hard_bounce", scope: "permanent", blocks: true },
    // Blokada czasowa nie zatrzymuje zapisu (tak samo jak w formularzu).
    { reason: "soft_bounce", scope: "transient", blocks: false },
  ])("blokada $reason ($scope): zapis zatrzymany = $blocks", async ({ reason, scope, blocks }) => {
    rpc.setData("email_filter_suppressed", [
      { email: EMAIL, reason, scope, expires_at: relativeIso(DZIEN) },
    ]);

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(rpc.lastCall("email_filter_suppressed")?.args).toEqual({
      p_tenant: BILLING_IDS.tenant,
      p_emails: [EMAIL],
    });
    expect(newsletterWrites().length > 0).toBe(!blocks);
  });

  it("nieudany odczyt listy wykluczeń to brak zapisu (fail-closed), a zakup biegnie dalej", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.setError("email_filter_suppressed", "test: lista wykluczeń niedostępna");

    await applyPurchaseEffects(purchase({ newsletterConsent: grant() }));

    expect(newsletterWrites()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      "[payments] premium newsletter opt-in failed",
      expect.objectContaining({ message: expect.stringContaining("suppression lookup failed") }),
    );
    expect(db.chainsFor("notifications").some((c) => c.has("insert"))).toBe(true);
    error.mockRestore();
  });
});
