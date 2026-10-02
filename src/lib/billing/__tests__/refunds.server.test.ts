// ZWROT PIENIĘDZY I SPÓR PŁATNICZY - 5,1% linii i 9% gałęzi do 31.08.2026,
// 111 linii bez żadnego testu. To najdroższa nieprzetestowana ścieżka w tym
// repo: zwrot jest NIEODWRACALNY, a jego skutki rozchodzą się na pięć tabel
// naraz (zamówienie, uprawnienie, zgłoszenie na wydarzenie, dzwonek, CRM).
//
// CO TEN PLIK MIERZY - ŚCIEŻKĘ PIENIĘDZY, NIE ŚCIEŻKĘ SZCZĘŚLIWĄ:
//   * zwrot pełny / częściowy / przekraczający kwotę zamówienia,
//   * korektę, która NIE odbiera dostępu (kredyt, wniosek, odrzucenie),
//   * ponowione dostarczenie tego samego zwrotu (idempotencja),
//   * transakcję nieznaną, darowiznę, zamówienie bez właściciela,
//   * spór otwarty (dostęp znika od razu) i wygrany (dostęp wraca),
//   * awarię KAŻDEGO zapisu z osobna - i to, CO ZOSTAJE W BAZIE po awarii.
//
// GRANICA ATRAP - ŚWIADOMIE WĄSKA. Podmienione są WYŁĄCZNIE granice systemu:
// klient Supabase (rola serwisowa) i wysyłka poczty. Sąsiednie moduły
// rozliczeń (`grant.server`, `purchaseEffects.server`, `notifications.server`,
// `entitlementSync.server`, `oneTimeFulfilment.server`, `catalog`) biegną
// PRAWDZIWE. To kosztuje więcej pracy przy planowaniu odpowiedzi bazy, ale
// tylko tak test dowodzi, że zwrot NAPRAWDĘ odbiera uprawnienie czytane przez
// `has_content_access()` - atrapa `grant.server` dowodziłaby wyłącznie tego,
// że wywołano atrapę.
//
// RODO: wszystkie adresy są syntetyczne i leżą w `example.com`.
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  rpc: {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    error: null as { message: string } | null,
  },
  emails: [] as unknown[],
}));

// GRANICA 1: klient roli serwisowej. `rpc` jest tu, bo pełny zwrot biletu
// przelicza status zgłoszenia funkcją bazodanową, a nie zapytaniem.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpc.calls.push({ fn, args });
      return Promise.resolve({ data: null, error: h.rpc.error });
    },
  },
}));

// GRANICA 2: poczta. Reszta `transactional.server` (formatowanie kwot i dat,
// które trafia do treści maila o zwrocie) zostaje prawdziwa.
vi.mock("@/lib/email/transactional.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/transactional.server")>(
    "@/lib/email/transactional.server",
  );
  return {
    ...actual,
    sendTxEmail: (message: unknown) => {
      h.emails.push(message);
      return Promise.resolve({ ok: true });
    },
  };
});

import { applyRefundEffects, type RefundEvent } from "@/lib/billing/refunds.server";

// --- atomy sceny ------------------------------------------------------------

/** Wiersz `payment_orders` w kształcie czytanym przez zwrot i przez spór. */
type OrderRow = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "tenant_id"
  | "plan_id"
  | "kind"
  | "entity_type"
  | "entity_id"
  | "metadata"
  | "amount_cents"
  | "refunded_amount_cents"
  | "currency"
  // `status` czyta bramka powtórzonego zwrotu (patrz DEFEKT 2 na końcu pliku).
  | "status"
>;

/** Wiersz `subscriptions` (operatorski) czytany przez obie ścieżki. */
type SubscriptionRow = Pick<
  Tables<"subscriptions">,
  "user_id" | "tenant_id" | "price_id" | "status" | "current_period_end"
>;

const TXN = "pi_1SyntetycznaTransakcja";
const SUB = "sub_1SyntetycznaSubskrypcja";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";

function orderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: BILLING_IDS.order,
    user_id: BILLING_IDS.me,
    tenant_id: BILLING_IDS.tenant,
    plan_id: "plan-member-monthly",
    kind: "subscription",
    entity_type: null,
    entity_id: null,
    metadata: {},
    amount_cents: 4900,
    refunded_amount_cents: 0,
    currency: "PLN",
    status: "paid",
    ...overrides,
  };
}

function subscriptionRow(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    user_id: BILLING_IDS.me,
    // Najemca subskrypcji: zawęża plan (`resolvePlanForPrice`) i adresatów
    // alertu o sporze (`notifyTenantAdmins`).
    tenant_id: BILLING_IDS.tenant,
    // `plus_monthly` jest w `BILLING_CATALOG` - bez wpisu katalogowego plan
    // nie rozwiąże się i połowa skutków zwrotu przestaje istnieć.
    price_id: "plus_monthly",
    status: "active",
    current_period_end: "2026-09-18T10:00:00.000Z",
    ...overrides,
  };
}

function refundEvent(overrides: Partial<RefundEvent> = {}): RefundEvent {
  return {
    adjustmentId: "adj_1Syntetyczna",
    transactionId: TXN,
    subscriptionId: null,
    action: "refund",
    status: "approved",
    amountCents: 4900,
    capturedAmountCents: 4900,
    currency: "PLN",
    environment: "sandbox",
    ...overrides,
  };
}

/** Stan bazy dla jednego testu - podmieniany polami, nie całymi atrapami. */
interface Scene {
  order: OrderRow | null;
  subscription: SubscriptionRow | null;
  /** Ile wierszy `user_subscriptions` faktycznie odebrano (`select("id")`). */
  revokedEntitlements: { id: string }[];
  /** Uprawnienie odczytane przy przywracaniu dostępu (`maybeSingle`). */
  existingEntitlement: { id: string; status: string } | null;
  /** Darowizny zmienione przez zwrot. */
  refundedDonations: { id: string }[];
  /** Najemca darowizny odczytany przez alert o sporze (`maybeSingle`). */
  donationTenant: string | null;
  admins: { user_id: string }[];
  adminProfiles: { id: string; tenant_id: string | null }[];
}

let db: SupabaseFromStub;
let scene: Scene;

function seed(): void {
  db.setResponse("payment_orders", (chain) => {
    if (chain.has("update")) return ok(null);
    // Odebranie i przywrócenie dostępu czytają zamówienie TĄ SAMĄ funkcją
    // (`findOrderForAdjustment`), czyli listą z `.limit(1)`. Gałąź
    // `maybeSingle` zostaje dla atrap, które nadal pytają pojedynczym wierszem.
    if (chain.has("maybeSingle")) return ok(scene.order);
    return ok(scene.order ? [scene.order] : []);
  });
  db.setResponse("subscriptions", () => ok(scene.subscription));
  db.setResponse("user_subscriptions", (chain) => {
    if (chain.has("maybeSingle")) return ok(scene.existingEntitlement);
    if (chain.has("select")) return ok(scene.revokedEntitlements);
    return ok(null);
  });
  db.setResponse("user_purchases", () => ok(null));
  db.setResponse("donations", (chain) =>
    // Alert o sporze pyta o najemcę darowizny pojedynczym wierszem; zwrot
    // zapisuje status i czyta zmienione wiersze listą.
    chain.has("maybeSingle")
      ? ok(scene.donationTenant ? { tenant_id: scene.donationTenant } : null)
      : ok(scene.refundedDonations),
  );
  db.setResponse("event_rsvps", () => ok(null));
  db.setResponse("notifications", () => ok(null));
  db.setResponse("user_roles", () => ok(scene.admins));
  db.setResponse("profiles", (chain) =>
    // Alert dla zespołu czyta profile administratorów listą (`.in`),
    // reszta ścieżek - jeden profil odbiorcy maila / kontaktu CRM.
    chain.has("in")
      ? ok(scene.adminProfiles)
      : ok({
          id: BILLING_IDS.me,
          email: "klient@example.com",
          first_name: "Klient",
          last_name: "Testowy",
          display_name: "Klient Testowy",
          tenant_id: BILLING_IDS.tenant,
          prefs: { language: "pl" },
        }),
  );
  db.setResponse("access_plans", () =>
    ok({
      id: "plan-member-monthly",
      tenant_id: BILLING_IDS.tenant,
      price_cents: 4900,
      currency: "PLN",
      interval: "month",
      name_pl: "Członek",
      name_en: "Member",
    }),
  );
  db.setResponse("crm_leads", () => ok(null));
  db.setResponse("newsletter_subscribers", () => ok(null));
}

// --- odczyt tego, co atrapa zapisała ---------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Wszystkie łatki `update` wysłane na tabelę, w kolejności. */
function patches(table: string): Record<string, unknown>[] {
  return db
    .chainsFor(table)
    .map((chain) => chain.argsOf("update")?.[0])
    .filter(isRecord);
}

/** Wszystkie wiersze `insert` (także wsadowe) wysłane na tabelę. */
function inserted(table: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const chain of db.chainsFor(table)) {
    const payload = chain.argsOf("insert")?.[0];
    if (Array.isArray(payload)) rows.push(...payload.filter(isRecord));
    else if (isRecord(payload)) rows.push(payload);
  }
  return rows;
}

/** Filtry `eq`/`neq` zapisane w łańcuchu, jako pary [kolumna, wartość]. */
function filters(table: string, method: "eq" | "neq"): unknown[][] {
  return db
    .chainsFor(table)
    .flatMap((chain) => chain.calls.filter((call) => call.method === method))
    .map((call) => [...call.args]);
}

/** Dzwonki administratorów - `notifyTenantAdmins` wstawia je przez RPC. */
function adminBells(): Record<string, unknown>[] {
  return h.rpc.calls.filter((call) => call.fn === "enqueue_notification").map((call) => call.args);
}

/** Najemca, w którym alert o sporze szukał administratorów (`user_roles`). */
function alertTenants(): unknown[] {
  return db
    .chainsFor("user_roles")
    .flatMap((chain) => chain.calls.filter((call) => call.method === "eq"))
    .filter((call) => call.args[0] === "tenant_id")
    .map((call) => call.args[1]);
}

/** Wiadomości oddane granicy pocztowej. */
function emails(): Record<string, unknown>[] {
  return h.emails.filter(isRecord);
}

beforeEach(() => {
  db = supabaseFromStub();
  h.db.current = { from: (table: string) => db.from(table) };
  h.rpc.calls.length = 0;
  h.rpc.error = null;
  h.emails.length = 0;
  scene = {
    order: orderRow(),
    subscription: null,
    revokedEntitlements: [{ id: "us-1" }],
    existingEntitlement: null,
    refundedDonations: [],
    donationTenant: null,
    admins: [],
    adminProfiles: [],
  };
  seed();
});

describe("applyRefundEffects - korekty, które NIE odbierają dostępu", () => {
  it.each(["credit", "other"] as const)(
    "korekta `%s` nie dotyka ani zamówienia, ani uprawnienia",
    async (action) => {
      // Kredyt to nota, nie oddanie pieniędzy. Odebranie za nią dostępu byłoby
      // karą za rabat.
      const outcome = await applyRefundEffects(refundEvent({ action }));

      expect(outcome).toBe("skipped");
      expect(db.chains).toHaveLength(0);
    },
  );

  it.each(["pending_approval", "rejected", "reversed"])(
    "zwrot w stanie `%s` czeka albo nie doszedł do skutku",
    async (status) => {
      // Odebranie dostępu na sam WNIOSEK o zwrot to utrata klienta bez zwrotu
      // pieniędzy. `rejected`/`reversed` znaczą, że pieniądze zostały u nas.
      const outcome = await applyRefundEffects(refundEvent({ status }));

      expect(outcome).toBe("skipped");
      expect(db.chains).toHaveLength(0);
    },
  );

  it("korekta bez transakcji i bez subskrypcji jest logowana, nie zgadywana", async () => {
    // Nie mamy w co trafić. Zgadywanie „po kwocie" albo „po ostatnim
    // zamówieniu" odebrałoby dostęp przypadkowej osobie.
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });

  it("identyfikator transakcji o obcym kształcie NIE trafia do filtra `or(...)`", async () => {
    // Identyfikator wchodzi do filtra PostgREST jako tekst. Przecinek albo
    // nawias mogłyby rozszerzyć zapytanie na cudze zamówienia, więc kształt
    // jest bramkowany PRZED zapytaniem - i to jest tu przedmiotem testu.
    const outcome = await applyRefundEffects(
      refundEvent({ transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("payment_orders")).toHaveLength(0);
  });

  it("transakcja wyzerowana W TRAKCIE przetwarzania kończy się `skipped`, nie zapytaniem", async () => {
    // Kierowanie korekty czyta `transactionId` synchronicznie, a `revokeOrder`
    // czyta go PONOWNIE dopiero po pierwszym `await`. Obiekt zdarzenia
    // zmieniony w tym oknie (wołający, który używa go dalej) nie może
    // skończyć się filtrem z `null` - bramka zamyka ścieżkę bez dotykania bazy.
    const event = refundEvent();
    const pending = applyRefundEffects(event);
    event.transactionId = null;

    expect(await pending).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("subskrypcja wyzerowana W TRAKCIE przetwarzania kończy się `skipped`, nie zapytaniem", async () => {
    // To samo okno w `revokeSubscription`: bez bramki `eq(..., null)`
    // i odebranie uprawnienia po pustym `external_ref`.
    const event = refundEvent({ transactionId: null, subscriptionId: SUB });
    const pending = applyRefundEffects(event);
    event.subscriptionId = null;

    expect(await pending).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });
});

describe("zwrot PEŁNY zamówienia - dostęp znika natychmiast", () => {
  it("oznacza zamówienie, odbiera uprawnienie, pisze mail i dzwonek", async () => {
    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");

    // 1. Źródło płatności.
    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 4900,
    });
    expect(filters("payment_orders", "eq")).toContainEqual(["id", BILLING_IDS.order]);
    // Bez tego filtra ponowione zdarzenie nadpisywałoby zamknięty zwrot.
    expect(filters("payment_orders", "neq")).toContainEqual(["status", "refunded"]);

    // 2. Uprawnienie czytane przez `has_content_access()`.
    const entitlement = patches("user_subscriptions")[0];
    expect(entitlement).toMatchObject({ status: "refunded" });
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", BILLING_IDS.order]);

    // 3. Mail o zwrocie, kluczowany identyfikatorem korekty (idempotencja).
    expect(emails()[0]).toMatchObject({
      type: "payment_refunded",
      to: "klient@example.com",
      idempotencyKey: "payment_refunded:adj_1Syntetyczna",
    });

    // 4. Dzwonek w aplikacji, w przestrzeni najemcy zamówienia.
    expect(inserted("notifications")[0]).toMatchObject({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      kind: "billing",
      title_pl: "Zwrot płatności",
      // Spec B.7: ikona z listy kuratorskiej (`receipt` ładował rejestr 109 KB).
      icon: "credit-card",
    });
  });

  it("dostęp kończy się TERAZ, a nie z końcem opłaconego okresu", async () => {
    // Decyzja produktowa z nagłówka modułu. Gdyby `current_period_end` został
    // datą z przyszłości, klient miałby pieniądze i treść jednocześnie.
    const before = Date.now();

    await applyRefundEffects(refundEvent());

    const entitlement = patches("user_subscriptions")[0];
    const periodEnd = Date.parse(String(entitlement.current_period_end));
    expect(periodEnd).toBeGreaterThanOrEqual(before);
    expect(periodEnd).toBeLessThanOrEqual(Date.now());
    expect(entitlement.canceled_at).toBe(entitlement.current_period_end);
  });

  it("zwrot zakupu jednorazowego odbiera `user_purchases`, nie subskrypcję", async () => {
    // Odblokowanie pojedynczej treści żyje w innej tabeli. Pomyłka tutaj
    // zostawiłaby opłaconą treść otwartą po oddaniu pieniędzy.
    scene.order = orderRow({ kind: "one_time", entity_type: "post", entity_id: "post-1" });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_purchases")[0]).toMatchObject({ status: "refunded" });
    expect(filters("user_purchases", "eq")).toEqual([
      ["user_id", BILLING_IDS.me],
      ["entity_type", "post"],
      ["entity_id", "post-1"],
    ]);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("OBCIĄŻENIE ZWROTNE nazywa rzecz po imieniu w dzwonku", async () => {
    scene.order = orderRow();

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    const bell = inserted("notifications").find((row) => row.href === "/profile/plan");
    expect(bell).toMatchObject({ title_pl: "Obciążenie zwrotne", title_en: "Chargeback" });
  });

  it("zamówienie po ANONIMIZACJI konta nadal się księguje, ale nikogo nie zawiadamia", async () => {
    // `user_id` NULL = konto usunięte, zamówienie żyje jako dowód księgowy.
    // Nie ma komu wysłać maila ani odebrać uprawnienia - ale status musi się
    // zgadzać z księgami.
    scene.order = orderRow({ user_id: null });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });
});

describe("zwrot CZĘŚCIOWY - korekta ceny, nie rezygnacja", () => {
  it("nie zmienia statusu zamówienia i NIE odbiera uprawnienia", async () => {
    scene.order = orderRow({ amount_cents: 9900 });

    const outcome = await applyRefundEffects(
      refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }),
    );

    expect(outcome).toBe("order_refunded");
    const patch = patches("payment_orders")[0];
    expect(patch.refunded_amount_cents).toBe(3000);
    // Kluczowa asercja: BRAK klucza `status` w łatce.
    expect(patch).not.toHaveProperty("status");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("user_purchases")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("bilet: miejsce ZOSTAJE, a przeliczenie robi baza", async () => {
    // Zwrot części ceny nie zwalnia miejsca na wydarzeniu - próg „miejsce
    // wraca do puli" ma jedno miejsce w systemie i jest nim funkcja bazowa.
    scene.order = orderRow({ amount_cents: 9900, metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }));

    expect(h.rpc.calls).toEqual([
      {
        fn: "payments_apply_event_ticket_outcome",
        args: {
          p_order_id: BILLING_IDS.order,
          p_outcome: "partial_refund",
          p_refunded_cents: 3000,
        },
      },
    ]);
    // Zgłoszenie nie jest anulowane - uczestnik nadal ma wejście.
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("kwota RÓWNA pobranej to już zwrot pełny", async () => {
    // Próg jest ostry: `refundedSoFar < captured`. Równość musi odebrać dostęp,
    // inaczej pełny zwrot zapisany jako dwa równe raty zostawiłby uprawnienie.
    scene.order = orderRow({ amount_cents: 9900 });

    await applyRefundEffects(refundEvent({ amountCents: 9900, capturedAmountCents: 9900 }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });

  it("korekta BEZ KWOTY jest traktowana jak zwrot pełny", async () => {
    // Brak wiedzy o kwocie to nie powód do zostawienia dostępu. Bezpieczniej
    // odebrać uprawnienie niż zostawić opłaconą treść po oddaniu pieniędzy.
    await applyRefundEffects(refundEvent({ amountCents: null, capturedAmountCents: null }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });

  it("nieznana kwota pobrana (zero) też schodzi na zwrot pełny", async () => {
    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 0 }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
  });

  it("OBCIĄŻENIE ZWROTNE nigdy nie jest częściowe", async () => {
    // Bank wycofuje środki w całości sporu, nawet gdy kwota jest niższa niż
    // obciążenie. Potraktowanie tego jak korekty ceny zostawiłoby dostęp
    // osobie, która zakwestionowała płatność.
    scene.order = orderRow({ amount_cents: 9900 });

    await applyRefundEffects(
      refundEvent({ action: "chargeback", amountCents: 3000, capturedAmountCents: 9900 }),
    );

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
  });
});

describe("IDEMPOTENCJA licznika zwrotów", () => {
  it("spóźnione zdarzenie z NIŻSZĄ kwotą nie cofa licznika", async () => {
    // Operator liczy zwroty narastająco, ale zdarzenia potrafią dojść nie po
    // kolei. Zapisanie niższej wartości „odzwracałoby" część pieniędzy
    // w naszych księgach.
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 9900 });

    await applyRefundEffects(refundEvent({ amountCents: 3000, capturedAmountCents: 9900 }));

    expect(patches("payment_orders")[0].refunded_amount_cents).toBe(9900);
  });

  it("dwie raty częściowe składają się na zwrot pełny bez sumowania po naszej stronie", async () => {
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 0 });
    await applyRefundEffects(refundEvent({ amountCents: 4950, capturedAmountCents: 9900 }));
    expect(patches("payment_orders")[0]).not.toHaveProperty("status");

    db = supabaseFromStub();
    h.db.current = { from: (table: string) => db.from(table) };
    scene.order = orderRow({ amount_cents: 9900, refunded_amount_cents: 4950 });
    seed();

    await applyRefundEffects(
      refundEvent({ adjustmentId: "adj_2", amountCents: 9900, capturedAmountCents: 9900 }),
    );

    expect(patches("payment_orders")[0]).toMatchObject({
      status: "refunded",
      refunded_amount_cents: 9900,
    });
  });
});

describe("wiersze z PUSTYMI kwotami - bezpieczniki `??` w liczeniu zwrotu", () => {
  // Kolumny kwot są dziś NOT NULL, ale PostgREST oddaje to, co leży w bazie,
  // a wiersze sprzed ograniczeń i ręczne poprawki potrafią nieść NULL. Zwrot
  // nie może się na nich wywrócić ani policzyć czegoś, czego nie ma.
  const EMPTY = null as unknown as number;

  it("brak kwoty obciążenia i licznika: zwrot liczy się od zera, bez „już rozliczone”", async () => {
    scene.order = orderRow({ amount_cents: EMPTY, refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(
      refundEvent({ amountCents: 2000, capturedAmountCents: undefined }),
    );

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ refunded_amount_cents: 2000 });
  });

  it("pusty licznik przy znanym obciążeniu: powtórka BEZ nowych pieniędzy to `skipped`", async () => {
    // Licznik NULL czytamy jak zero - wiec zdarzenie bez kwoty nie przynosi
    // pieniedzy, a zamowienie juz „refunded" nie jest zapisywane drugi raz.
    scene.order = orderRow({ status: "refunded", refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(refundEvent({ amountCents: 0 }));

    expect(outcome).toBe("skipped");
  });

  it("pusty licznik przy znanym obciążeniu i nowej kwocie: zwrot przechodzi", async () => {
    scene.order = orderRow({ refunded_amount_cents: EMPTY });

    const outcome = await applyRefundEffects(refundEvent({ amountCents: 4900 }));

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ refunded_amount_cents: 4900 });
  });
});

describe("BILET na wydarzenie - zwrot cofa udział", () => {
  it("pełny zwrot anuluje zgłoszenie i zwalnia miejsce", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    // D0-1: pisownia z CHECK `event_rsvps.status` - `canceled` łamało ograniczenie.
    expect(patches("event_rsvps")[0]).toMatchObject({ status: "cancelled" });
    expect(patches("event_rsvps")[0]).not.toMatchObject({ status: "canceled" });
    expect(filters("event_rsvps", "eq")).toEqual([
      ["event_id", EVENT_ID],
      ["user_id", BILLING_IDS.me],
    ]);
    expect(h.rpc.calls[0]).toMatchObject({
      fn: "payments_apply_event_ticket_outcome",
      args: { p_outcome: "refunded" },
    });
  });

  it("status anulowanego udziału to wartość dozwolona przez CHECK tabeli", async () => {
    // Była tu literówka „canceled": CHECK `event_rsvps_status_check` jej nie
    // dopuszcza, więc KAŻDY pełny zwrot biletu rzucał przed
    // `payments_apply_event_ticket_outcome` - webhook ponawiał w nieskończoność,
    // a zgłoszenie zostawało opłacone, goście przyjęci i kolejka nieruszona.
    // Test czyta NAJNOWSZĄ definicję CHECK-a z migracji, a nie jej kopię.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "supabase", "migrations");
    const pattern = /ADD CONSTRAINT event_rsvps_status_check\s+CHECK \(status IN \(([^)]*)\)\)/g;
    const checks = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .flatMap((name) => [...readFileSync(join(dir, name), "utf8").matchAll(pattern)])
      .map((match) => match[1]);
    expect(checks.length).toBeGreaterThan(0);
    const allowed = [...(checks.at(-1) as string).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent());

    expect(allowed).toContain(patches("event_rsvps")[0].status);
  });

  it("zamówienie związane ze zgłoszeniem nie anuluje RSVP samo - robi to baza po zastosowaniu zwrotu", async () => {
    // Zwrot nadliczbowej wpłaty (`refund_for_other_order`) zostawia ważny
    // bilet opłacony innym zamówieniem. Anulowanie RSVP przed decyzją bazy
    // rozjechałoby się z tym biletem.
    scene.order = orderRow({
      metadata: { event_id: EVENT_ID, registration_id: "reg-bound-1" },
    });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls[0]).toMatchObject({
      fn: "payments_apply_event_ticket_outcome",
      args: { p_outcome: "refunded" },
    });
  });

  it("pusty `registration_id` traktujemy jak zamówienie starszej ścieżki", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID, registration_id: "" } });

    await applyRefundEffects(refundEvent());

    expect(patches("event_rsvps")[0]).toMatchObject({ status: "cancelled" });
  });

  it("bilet zanonimizowanego konta zwalnia miejsce, ale nie rusza cudzych zgłoszeń", async () => {
    // Bez `user_id` filtr `event_rsvps` obejmowałby WSZYSTKIE zgłoszenia na
    // wydarzenie. Miejsce i tak musi wrócić do puli - i wraca, przez bazę.
    scene.order = orderRow({ user_id: null, metadata: { event_id: EVENT_ID } });

    await applyRefundEffects(refundEvent());

    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls).toHaveLength(1);
  });

  it("metadane `null` (jsonb 'null') to zwykły zakup: dostęp znika, zgłoszeń nie ruszamy", async () => {
    // Kolumna jest `NOT NULL DEFAULT '{}'`, ale jsonb dopuszcza literał
    // `'null'` - i typ `Json` go przewiduje. Odczyt `event_id` wprost z `null`
    // wywróciłby zwrot wyjątkiem, czyli pętlą ponowień z otwartym dostępem.
    scene.order = orderRow({ metadata: null });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(h.rpc.calls).toHaveLength(0);
  });

  it("awaria funkcji bazowej nie wywraca zwrotu (miękki skutek)", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    h.rpc.error = { message: "deadlock detected" };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});

describe("AWARIE ZAPISU - co zostaje w bazie", () => {
  it("błąd odczytu zamówienia przerywa zwrot, ZANIM cokolwiek zapisze", async () => {
    // Kontrakt błędów modułu: rzucamy, żeby operator ponowił dostarczenie.
    db.setResponse("payment_orders", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: order lookup failed: statement timeout",
    );
    expect(patches("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("błąd flipu statusu NIE odbiera uprawnienia (dostęp zostaje do ponowienia)", async () => {
    // Kolejność ma tu znaczenie pieniężne: gdyby uprawnienie padło przed
    // księgowaniem, klient straciłby dostęp przy zwrocie, którego nie ma.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([orderRow()]),
    );

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: order status flip failed: permission denied",
    );
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("błąd odebrania uprawnienia przerywa, ZANIM pójdzie mail o zwrocie", async () => {
    // Stan pośredni jest tu świadomy: zamówienie jest już `refunded`,
    // uprawnienie jeszcze nie. Ponowienie zdarzenia dokończy pracę, bo oba
    // zapisy są idempotentne - ale mail nie może wyjść przed odebraniem
    // dostępu, inaczej klient dostaje „zwrócono" i dalej czyta treść.
    db.setResponse("user_subscriptions", () => fail("deadlock detected", "40P01"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "revoke: user_subscriptions failed",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(emails()).toHaveLength(0);
  });

  it("błąd anulowania zgłoszenia przerywa, choć zwrot jest już zaksięgowany", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    db.setResponse("event_rsvps", () => fail("permission denied", "42501"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: rsvp cancel failed: permission denied",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
  });

  it("awaria DZWONKA nie wywraca zwrotu - skutek miękki nigdy nie cofa pieniędzy", async () => {
    db.setResponse("notifications", () => {
      throw new Error('relation "notifications" does not exist');
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("awaria ALERTU O SPORZE nie blokuje odebrania dostępu", async () => {
    db.setResponse("user_roles", () => {
      throw new Error("permission denied for table user_roles");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    errorLog.mockRestore();
  });
});

describe("DAROWIZNA - brak uprawnień, ale księgi muszą się zgadzać", () => {
  it("zwrot bez zamówienia trafia w darowiznę", async () => {
    scene.order = null;
    scene.refundedDonations = [{ id: "don-1" }];

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("donation_refunded");
    expect(patches("donations")[0]).toEqual({ status: "refunded" });
    expect(filters("donations", "eq")).toContainEqual(["provider_intent_id", TXN]);
    expect(filters("donations", "neq")).toContainEqual(["status", "refunded"]);
  });

  it("transakcja NIEZNANA (ani zamówienie, ani darowizna) to `skipped`", async () => {
    // Zwrot dotyczy czegoś, czego u nas nie ma - np. płatności z innego
    // systemu. Nie wymyślamy skutku.
    scene.order = null;
    scene.refundedDonations = [];

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("skipped");
    expect(emails()).toHaveLength(0);
    expect(inserted("notifications")).toHaveLength(0);
  });

  it("darowizna JUŻ ZWRÓCONA nie jest zwracana drugi raz", async () => {
    // Wzorzec, którego brakuje ścieżce zamówienia: `.select("id")` po zapisie
    // odróżnia „zmieniono" od „nic nie pasowało".
    scene.order = null;
    scene.refundedDonations = [];

    expect(await applyRefundEffects(refundEvent())).toBe("skipped");
  });

  it("błąd zapisu darowizny jest zgłaszany do ponowienia", async () => {
    scene.order = null;
    db.setResponse("donations", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(refundEvent())).rejects.toThrow(
      "refund: donation status flip failed: statement timeout",
    );
  });
});

describe("zwrot SUBSKRYPCJI", () => {
  const subEvent = (overrides: Partial<RefundEvent> = {}) =>
    refundEvent({ subscriptionId: SUB, transactionId: null, ...overrides });

  it("odbiera uprawnienie po `external_ref` operatora, znaczy CRM i pisze mail", async () => {
    scene.subscription = subscriptionRow();

    const outcome = await applyRefundEffects(subEvent());

    expect(outcome).toBe("subscription_refunded");
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", SUB]);
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    // Zwrot to UTRATA klienta, nie pauza - inaczej CRM dalej liczyłby go do
    // przychodu cyklicznego.
    expect(inserted("crm_leads")[0]?.tags).toEqual(
      expect.arrayContaining(["plan:member", "churned"]),
    );
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
    expect(inserted("notifications")[0]).toMatchObject({ tenant_id: BILLING_IDS.tenant });
  });

  it("subskrypcja jest szukana W TYM SAMYM ŚRODOWISKU co korekta", async () => {
    scene.subscription = subscriptionRow();

    await applyRefundEffects(subEvent({ environment: "live" }));

    expect(filters("subscriptions", "eq")).toContainEqual(["environment", "live"]);
    expect(filters("subscriptions", "eq")).toContainEqual(["provider_subscription_id", SUB]);
  });

  it("błąd odczytu subskrypcji przerywa zwrot", async () => {
    db.setResponse("subscriptions", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(subEvent())).rejects.toThrow(
      "refund: subscription lookup failed: statement timeout",
    );
  });

  it("subskrypcja NIEZNANA lokalnie: o wyniku decyduje odebranie uprawnienia", async () => {
    // Wiersz operatorski mógł nie dojechać, ale uprawnienie mogło zostać
    // nadane wcześniejszym zdarzeniem - i to ono liczy się dla dostępu.
    scene.subscription = null;
    scene.revokedEntitlements = [{ id: "us-1" }];

    expect(await applyRefundEffects(subEvent())).toBe("subscription_refunded");
    expect(emails()).toHaveLength(0);
  });

  it("brak subskrypcji i brak uprawnienia to `skipped`", async () => {
    scene.subscription = null;
    scene.revokedEntitlements = [];

    expect(await applyRefundEffects(subEvent())).toBe("skipped");
  });

  it("cena SPOZA KATALOGU: dostęp znika, bez CRM, ale dzwonek idzie do najemcy subskrypcji", async () => {
    // Bez wpisu katalogowego nie znamy warstwy (więc CRM milczy) - ale najemcę
    // niesie sam wiersz `subscriptions`. Wcześniej dzwonek brał najemcę
    // wyłącznie z planu i przy cenie spoza katalogu klient nie dostawał
    // w aplikacji żadnego śladu zwrotu.
    scene.subscription = subscriptionRow({ price_id: "cena_spoza_katalogu" });

    const outcome = await applyRefundEffects(subEvent());

    expect(outcome).toBe("subscription_refunded");
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
    expect(inserted("notifications")).toEqual([
      expect.objectContaining({ user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant }),
    ]);
    // Mail idzie mimo to - klient ma prawo wiedzieć o zwrocie.
    expect(emails()[0]).toMatchObject({ type: "payment_refunded" });
  });

  it("pusty identyfikator ceny nie wywraca zwrotu", async () => {
    scene.subscription = subscriptionRow({ price_id: "" });

    expect(await applyRefundEffects(subEvent())).toBe("subscription_refunded");
    expect(db.chainsFor("access_plans")).toHaveLength(0);
  });
});

describe("SPÓR OTWARTY - alert dla zespołu NAJEMCY sporu", () => {
  // AUDYT WYD. 12 (16.8, defekt wysoki): `alertAdminsAboutDispute` wybierał
  // z `user_roles` KAŻDEGO z rolą `admin`, bez warunku najemcy, i wstawiał mu
  // dzwonek z identyfikatorem cudzej transakcji. Odbiorców zawęża teraz
  // `notifyTenantAdmins` (rola i profil W TYM najemcy, dzwonek przez
  // `enqueue_notification`), a najemcę wyprowadza się z NASZEGO wiersza.

  it("dzwonek trafia do administratorów najemcy zamówienia, przez kolejkę powiadomień", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback_warning", status: null }));

    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(adminBells()).toHaveLength(1);
    expect(adminBells()[0]).toMatchObject({
      p_user_id: "admin-1",
      p_kind: "billing",
      p_title_pl: "Otwarto spór płatniczy",
      p_href: "/admin/billing",
      // Ikona z listy kuratorskiej - `shield-alert` jej nie ma i ładował
      // w przeglądarce leniwy rejestr ikon (spec B.7).
      p_icon: "credit-card",
    });
    expect(String(adminBells()[0].p_body_pl)).toContain(TXN);
    // Żadnego wsadowego `insert` do `notifications` z pominięciem kolejki.
    expect(inserted("notifications").some((row) => row.href === "/admin/billing")).toBe(false);
  });

  it("spór najemcy B NIE pyta o administratorów najemcy A", async () => {
    // Regresja wprost: zamówienie obcej organizacji wyznacza JEJ najemcę.
    scene.order = orderRow({ tenant_id: BILLING_IDS.foreignTenant });
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(alertTenants()).not.toContain(BILLING_IDS.tenant);
    const profileTenants = db
      .chainsFor("profiles")
      .filter((chain) => chain.has("in"))
      .flatMap((chain) => chain.calls.filter((call) => call.method === "eq"))
      .map((call) => call.args);
    expect(profileTenants).toContainEqual(["tenant_id", BILLING_IDS.foreignTenant]);
  });

  it("brak administratorów w najemcy nie generuje żadnego dzwonka", async () => {
    scene.admins = [];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(adminBells()).toHaveLength(0);
  });

  it("alert wskazuje SUBSKRYPCJĘ i jej najemcę, gdy korekta nie niesie transakcji", async () => {
    // Odniesienie w treści alertu jest tym, po czym zespół odnajduje sprawę
    // u operatora. Spór subskrypcyjny nie ma identyfikatora transakcji.
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    scene.subscription = subscriptionRow();

    await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: null, subscriptionId: SUB }),
    );

    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(String(adminBells()[0]?.p_body_pl)).toContain(SUB);
  });

  it("subskrypcja NIEZNANA lokalnie: najemca przychodzi z zamówienia transakcji", async () => {
    // Spór może nieść oba identyfikatory, a wiersza subskrypcji u nas nie być
    // (inne środowisko, subskrypcja sprzed migracji). Wtedy najemcę wyznacza
    // zamówienie po transakcji - a nie „nikt".
    scene.subscription = null;
    scene.order = orderRow({ tenant_id: BILLING_IDS.foreignTenant });
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback", subscriptionId: SUB }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(String(adminBells()[0]?.p_body_pl)).toContain(TXN);
  });

  it("spór o DAROWIZNĘ alarmuje najemcę darowizny", async () => {
    scene.order = null;
    scene.donationTenant = BILLING_IDS.foreignTenant;
    scene.admins = [{ user_id: "admin-b" }];
    scene.adminProfiles = [{ id: "admin-b", tenant_id: BILLING_IDS.foreignTenant }];

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(alertTenants()).toEqual([BILLING_IDS.foreignTenant]);
    expect(filters("donations", "eq")).toContainEqual(["environment", "sandbox"]);
  });

  it("spór BEZ przypisanego najemcy nie dzwoni u nikogo - zostaje ślad w logu serwera", async () => {
    // Lepszy brak dzwonka niż dzwonek u obcej organizacji. Spór zostaje
    // w dzienniku webhooków i w logu - z numerem korekty, jedynym uchwytem.
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_roles")).toHaveLength(0);
    expect(adminBells()).toHaveLength(0);
    expect(JSON.stringify(errorLog.mock.calls)).toContain("adj_1Syntetyczna");
    warnLog.mockRestore();
    errorLog.mockRestore();
  });

  it("transakcja nieznana (ani zamówienie, ani darowizna) to też brak najemcy", async () => {
    scene.order = null;
    scene.donationTenant = null;
    scene.admins = [{ user_id: "admin-1" }];
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ action: "chargeback" }));

    expect(db.chainsFor("user_roles")).toHaveLength(0);
    errorLog.mockRestore();
  });

  it("identyfikator o obcym kształcie nie szuka najemcy w `or(...)`", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await applyRefundEffects(
      refundEvent({ action: "chargeback", transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(db.chainsFor("payment_orders")).toHaveLength(0);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
    errorLog.mockRestore();
  });

  it("awaria odczytu najemcy nie wywraca odebrania dostępu", async () => {
    db.setResponse("subscriptions", () => {
      throw new Error("connection reset");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      applyRefundEffects(
        refundEvent({ action: "chargeback", transactionId: null, subscriptionId: SUB }),
      ),
    ).rejects.toThrow("connection reset");
    // Odczyt najemcy połknął błąd (alert to skutek miękki) - wyjątek niesie
    // dopiero właściwe odebranie dostępu, które MUSI dać ponowienie.
    expect(JSON.stringify(errorLog.mock.calls)).toContain("dispute tenant lookup failed");
    errorLog.mockRestore();
  });

  it("zwykły zwrot NIE alarmuje zespołu", async () => {
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(refundEvent());

    expect(db.chainsFor("user_roles")).toHaveLength(0);
  });
});

describe("SPÓR WYGRANY - dostęp wraca", () => {
  const wonEvent = (overrides: Partial<RefundEvent> = {}) =>
    refundEvent({ action: "chargeback", status: "reversed", ...overrides });

  it("przywraca uprawnienie subskrypcyjne i zawiadamia zespół", async () => {
    scene.subscription = subscriptionRow();
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(filters("user_subscriptions", "eq")).toContainEqual(["external_ref", SUB]);
    expect(inserted("user_subscriptions")[0]).toMatchObject({
      user_id: BILLING_IDS.me,
      plan_id: "plan-member-monthly",
      status: "active",
      external_ref: SUB,
    });
    expect(alertTenants()).toEqual([BILLING_IDS.tenant]);
    expect(adminBells()[0]).toMatchObject({ p_title_pl: "Spór płatniczy rozstrzygnięty" });
  });

  it("uprawnienie ODEBRANE po zwrocie jest ostateczne - spór go nie wskrzesza", async () => {
    // Reguła `entitlementSync`: rekord `refunded` nie wraca do życia spóźnionym
    // zdarzeniem. Ponowny zakup założy nowy `external_ref`.
    scene.subscription = subscriptionRow();
    scene.existingEntitlement = { id: "us-1", status: "refunded" };

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(patches("user_subscriptions")).toHaveLength(0);
    expect(inserted("user_subscriptions")).toHaveLength(0);
  });

  it("subskrypcja BEZ końca opłaconego okresu wraca jako bezterminowa", async () => {
    // `current_period_end` NULL znaczy „bez wygaśnięcia" dla
    // `has_content_access()`. Podstawienie w to miejsce daty „teraz" odebrałoby
    // dostęp w tej samej chwili, w której go przywracamy.
    scene.subscription = subscriptionRow({ current_period_end: null });

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(inserted("user_subscriptions")[0]).toMatchObject({
      status: "active",
      current_period_end: null,
    });
  });

  it("subskrypcja bez statusu wraca jako aktywna", async () => {
    // Spór wygrany przywraca dostęp - brak statusu nie może go zostawić pustym.
    scene.subscription = subscriptionRow({ status: null as unknown as string });

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(inserted("user_subscriptions")[0]).toMatchObject({ status: "active" });
  });

  it("brak lokalnej subskrypcji nic nie przywraca", async () => {
    scene.subscription = null;

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("user_roles")).toHaveLength(0);
  });

  it("błąd odczytu subskrypcji przy sporze przerywa przywrócenie", async () => {
    db.setResponse("subscriptions", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(wonEvent({ subscriptionId: SUB }))).rejects.toThrow(
      "dispute: subscription lookup failed: statement timeout",
    );
  });

  it("cena spoza katalogu: wynik mówi `subscription_restored`, ale NIC nie przywrócono", async () => {
    // Zachowanie udokumentowane, nie zatwierdzone. Bez wpisu katalogowego nie
    // ma planu, więc `syncEntitlementState` w ogóle nie biegnie - a wynik i tak
    // brzmi jak sukces. Ten test jest bramką: gdyby ktoś zmienił tę ścieżkę na
    // `skipped` (uczciwszy wynik), zobaczy tutaj, że zmiana jest świadoma.
    scene.subscription = subscriptionRow({ price_id: "cena_spoza_katalogu" });

    const outcome = await applyRefundEffects(wonEvent({ subscriptionId: SUB }));

    expect(outcome).toBe("subscription_restored");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("przywraca zamówienie: status `paid`, uprawnienie i potwierdzony udział", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(inserted("user_subscriptions")[0]).toMatchObject({ status: "active" });
    expect(patches("event_rsvps")[0]).toMatchObject({ status: "going" });
  });

  it("zamówienie ZWIĄZANE ZE ZGŁOSZENIEM nie dostaje `going` - decyzja zostaje u organizatora", async () => {
    // AUDYT WYD. 12 (16.8): zwrot w tym samym oknie przestał dotykać RSVP
    // zamówień ze `registration_id` (miejsce zwalnia baza, z awansem z listy
    // rezerwowej), a wygrany spór dawał `going` bezwarunkowo - czyli link
    // wejścia osobie z odwołanym zgłoszeniem, której miejsce mogło już przejść
    // na kogoś innego.
    scene.order = orderRow({
      metadata: { event_id: EVENT_ID, registration_id: "reg-1" },
    });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(String(adminBells()[0]?.p_body_pl)).toContain("wymaga decyzji organizatora");
    expect(String(adminBells()[0]?.p_body_en)).toContain("needs an organiser decision");
  });

  it("zamówienie bez zgłoszenia nie dopisuje do alertu zdania o organizatorze", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    scene.admins = [{ user_id: "admin-1" }];
    scene.adminProfiles = [{ id: "admin-1", tenant_id: BILLING_IDS.tenant }];

    await applyRefundEffects(wonEvent());

    expect(String(adminBells()[0]?.p_body_pl)).not.toContain("organizatora");
  });

  it("zamówienie BEZ biletu wraca bez dotykania zgłoszeń na wydarzenia", async () => {
    // Zwykły zakup nie ma `event_id` w metadanych. Ślepy zapis do
    // `event_rsvps` bez tego filtra ruszałby cudze zgłoszenia.
    scene.order = orderRow({ metadata: {} });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("zamówienie z metadanymi `null` (jsonb 'null') wraca bez dotykania zgłoszeń", async () => {
    // Lustro przypadku przy zwrocie: literał `'null'` w metadanych nie może
    // wywrócić przywrócenia dostępu po wygranym sporze.
    scene.order = orderRow({ metadata: null });

    const outcome = await applyRefundEffects(wonEvent());

    expect(outcome).toBe("order_restored");
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
    expect(inserted("user_subscriptions")[0]).toMatchObject({ status: "active" });
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
  });

  it("identyfikator o obcym kształcie NIE trafia do filtra `or(...)` także przy sporze", async () => {
    // Przywrócenie nie ma własnej bramki kształtu - korzysta z tej
    // w `findOrderForAdjustment`. Bez niej tekst z payloadu operatora wszedłby
    // do `or(...)` i mógł przywrócić dostęp na CUDZYM zamówieniu.
    const outcome = await applyRefundEffects(
      wonEvent({ transactionId: "pi_1,provider_intent_id.eq.cudze" }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("spór wygrany bez transakcji i bez subskrypcji to `skipped`", async () => {
    const outcome = await applyRefundEffects(
      wonEvent({ transactionId: null, subscriptionId: null }),
    );

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("nieznane zamówienie nie jest przywracane", async () => {
    scene.order = null;

    expect(await applyRefundEffects(wonEvent())).toBe("skipped");
    expect(patches("payment_orders")).toHaveLength(0);
  });

  it("błąd odczytu zamówienia przy sporze przerywa", async () => {
    db.setResponse("payment_orders", () => fail("statement timeout", "57014"));

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: order lookup failed: statement timeout",
    );
  });

  it("błąd flipu na `paid` przerywa, zanim wróci uprawnienie", async () => {
    // Odczyt oddaje LISTĘ: po naprawie defektu nr 4 przywrócenie dostępu szuka
    // zamówienia tą samą funkcją co zwrot (`or(...)` + `.limit(1)`), a nie
    // pojedynczym wierszem po `provider_intent_id`.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([orderRow()]),
    );

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: order status flip failed: permission denied",
    );
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
  });

  it("błąd przywrócenia zgłoszenia przerywa, choć zamówienie jest już `paid`", async () => {
    scene.order = orderRow({ metadata: { event_id: EVENT_ID } });
    db.setResponse("event_rsvps", () => fail("permission denied", "42501"));

    await expect(applyRefundEffects(wonEvent())).rejects.toThrow(
      "dispute: rsvp restore failed: permission denied",
    );
    expect(patches("payment_orders")[0]).toMatchObject({ status: "paid" });
  });
});

describe("refunds.server - DEFEKTY NAPRAWIONE (bramki regresji)", () => {
  // =====================================================================
  // DEFEKT 1 (naprawiony): zwrot NIE BYŁ ZAWĘŻONY DO ŚRODOWISKA.
  //
  // CO BYŁO ZŁE. `revokeOrder` szukał zamówienia wyłącznie po identyfikatorze
  // transakcji (`or(provider_payment_intent_id / provider_intent_id /
  // provider_session_id)`) - bez `.eq("environment", event.environment)`.
  // Ta sama funkcja tuż obok (`revokeSubscription`) filtr środowiska MA,
  // i test „subskrypcja jest szukana W TYM SAMYM ŚRODOWISKU" tego dowodzi.
  //
  // JAKIE TO BYŁO RYZYKO. Reguła jest w tym repo nazwana wprost jako P0
  // (`oneTimeFulfilment.server`): „realizujemy zamówienie WYŁĄCZNIE zdarzeniem
  // z tego samego środowiska, w którym powstało. Bez tego sandboxowy webhook
  // (opłacony kartą testową) mógłby zrealizować realne zamówienie". Zwrot jest
  // tą samą operacją odwróconą i o wyższej stawce: skutkiem nie był darmowy
  // dostęp, tylko ODEBRANIE dostępu i oznaczenie realnego zamówienia jako
  // zwróconego - na podstawie zdarzenia z piaskownicy.
  //
  // JAK NAPRAWIONO. Wyszukiwanie zamówienia zjechało do JEDNEJ funkcji
  // (`findOrderForAdjustment`), która filtruje `.eq("environment", ...)` i jest
  // wołana przez obie ścieżki - odebranie i przywrócenie dostępu. Obawa
  // o wiersze historyczne odpadła: kolumna weszła jako `NOT NULL DEFAULT 'live'`
  // (migracja `20260731220000_payment_orders_environment_isolation`).
  //
  // CO ZOSTAŁO NIEDOKOŃCZONE. `revokeDonation` nadal nie filtruje środowiska,
  // bo `donations` NIE MA kolumny `environment` (wygenerowane `types.ts`).
  // Domknięcie wymaga migracji (kolumna + backfill + indeks), której ta zmiana
  // świadomie nie dokłada - zgłoszone właścicielowi modułu.
  // =====================================================================
  it("zwrot szuka zamówienia W ŚRODOWISKU korekty", async () => {
    await applyRefundEffects(refundEvent({ environment: "live" }));

    expect(filters("payment_orders", "eq")).toContainEqual(["environment", "live"]);
  });

  it("wygrany spór też szuka zamówienia w środowisku korekty", async () => {
    // Ta sama funkcja wyszukująca, więc filtr obowiązuje w obie strony:
    // zdarzenie z piaskownicy nie przywróci realnego zamówienia.
    await applyRefundEffects(
      refundEvent({ action: "chargeback", status: "reversed", environment: "live" }),
    );

    expect(filters("payment_orders", "eq")).toContainEqual(["environment", "live"]);
  });

  // =====================================================================
  // DEFEKT 2 (naprawiony): PODWÓJNY ZWROT był niewykrywalny - skutki miękkie
  // szły co raz.
  //
  // CO BYŁO ZŁE. `revokeOrder` zapisywał `update(...).neq("status","refunded")`
  // i NIE czytał wyniku (`.select("id")` nie było). Co więcej, `select` na
  // wejściu nie pobierał kolumny `status`, więc kod nie miał jak stwierdzić, że
  // zamówienie jest już w całości zwrócone. Ponowione zdarzenie przechodziło
  // CAŁĄ ścieżkę skutków: ponownie odbierało uprawnienie, ponownie anulowało
  // zgłoszenie, ponownie wstawiało dzwonek - i zwracało `order_refunded`, choć
  // baza nie zmieniła ani jednego wiersza.
  //
  // JAKIE TO BYŁO RYZYKO. Wzorzec poprawny stoi kilkadziesiąt linii niżej,
  // w TYM SAMYM PLIKU: `revokeDonation` robi `.select("id")` i oddaje
  // `skipped`, gdy nic nie pasowało (dowodzi tego test „darowizna JUŻ
  // ZWRÓCONA..."). Skutkiem braku tej samej bramki był kolejny dzwonek „Zwrot
  // płatności" przy każdym ponowieniu webhooka i wynik, na którym nie dało się
  // oprzeć metryki zwrotów.
  //
  // JAK NAPRAWIONO. `select` na wejściu pobiera `status`, zapis kończy się
  // `.select("id")`, a skutki miękkie odcina bramka powtórki: zapis nie objął
  // żadnego wiersza I zamówienie było już zamknięte zwrotem I zdarzenie nie
  // podnosi licznika. ZMIANA KONTRAKTU WYNIKU: powtórka oddaje `skipped`
  // zamiast `order_refunded`. Jedyny wołający (`webhookDispatch.server`)
  // wyniku nie czyta (`await applyRefundEffects(...)`), więc zmiana nie dotyka
  // dziennika zdarzeń.
  // =====================================================================
  it("ponowiony zwrot już zwróconego zamówienia nie wstawia dzwonka", async () => {
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 4900 });

    await applyRefundEffects(refundEvent({ adjustmentId: "adj_ponowione" }));

    expect(inserted("notifications")).toHaveLength(0);
  });

  it("powtórka oddaje `skipped` i nie rusza uprawnienia ani zgłoszenia", async () => {
    // Pełny kontrakt powtórki: nie tylko dzwonek, ale ŻADEN skutek miękki -
    // i wynik, po którym metryka zwrotów odróżnia zwrot od jego ponowienia.
    scene.order = orderRow({
      amount_cents: 4900,
      refunded_amount_cents: 4900,
      status: "refunded",
      metadata: { event_id: EVENT_ID },
    });

    const outcome = await applyRefundEffects(refundEvent({ adjustmentId: "adj_ponowione" }));

    expect(outcome).toBe("skipped");
    expect(db.chainsFor("user_subscriptions")).toHaveLength(0);
    expect(db.chainsFor("event_rsvps")).toHaveLength(0);
    expect(emails()).toHaveLength(0);
  });

  it("PIERWSZY zwrot na zamówieniu `paid` nadal przechodzi całą ścieżkę", async () => {
    // Bramka powtórki nie może zjeść zwrotu, który naprawdę coś zmienia -
    // dlatego wymaga OBU dowodów naraz (pusty zapis + zamknięte zamówienie).
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0, status: "paid" });

    const outcome = await applyRefundEffects(refundEvent());

    expect(outcome).toBe("order_refunded");
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    expect(inserted("notifications")).toHaveLength(1);
  });

  // =====================================================================
  // DEFEKT 3 (naprawiony): kwota zwrotu NIE BYŁA ZACISKANA do kwoty zamówienia.
  //
  // CO BYŁO ZŁE. `refundedSoFar = Math.max(order.refunded_amount_cents,
  // event.amountCents)` trafiał do bazy bez porównania z `captured`. Gdy korekta
  // niosła kwotę WYŻSZĄ niż nasze zamówienie, zapisywaliśmy
  // `refunded_amount_cents > amount_cents` - i robiliśmy to CICHO, bez logu.
  //
  // JAKIE TO BYŁO RYZYKO. `refunded_amount_cents` jest podstawą rachunku
  // „przychód netto = amount_cents - refunded_amount_cents". Wartość większa od
  // kwoty zamówienia daje przychód UJEMNY i psuje każde zestawienie, w którym
  // ta kolumna występuje. Rozjazd kwot nie jest hipotetyczny: `captured`
  // pochodzi z payloadu operatora, a `amount_cents` z naszego checkoutu, więc
  // rozjeżdżają się przy zmianie ceny, kuponie dopisanym po utworzeniu
  // zamówienia albo przy zdarzeniu dotyczącym innej waluty. Sytuacja, w której
  // te dwie liczby się nie zgadzają, nie zostawiała ŻADNEGO śladu.
  //
  // JAK NAPRAWIONO (decyzja księgowa: ZACISK, NIE ODRZUCENIE). Kwota jest
  // zaciskana do `captured` i rozjazd ląduje w `console.warn`. Odrzucenie
  // zdarzenia (wyjątek -> ponowienie) wstrzymałoby ODEBRANIE DOSTĘPU przy
  // korekcie, która u operatora już się wydarzyła: klient miałby i pieniądze,
  // i treść, a kolejne dostarczenia niosłyby tę samą kwotę, więc pętla nie
  // miałaby wyjścia bez ręcznej interwencji. Pełne uzasadnienie stoi przy
  // zacisku w `refunds.server.ts`.
  // =====================================================================
  it("zwrot PRZEKRACZAJĄCY kwotę zamówienia jest zaciskany, nie księgowany wprost", async () => {
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0 });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ amountCents: 12000, capturedAmountCents: null }));

    const written = Number(patches("payment_orders")[0].refunded_amount_cents);
    expect(written).toBeLessThanOrEqual(4900);
    // Rozjazd kwot MUSI zostawić ślad - bez niego zacisk po cichu gubiłby
    // informację o tym, że operator i nasze księgi się nie zgadzają.
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });

  it("zacisk nie zamienia zwrotu pełnego w częściowy", async () => {
    // Po zacisku `refundedSoFar === captured`, więc próg „zwrot pełny" musi
    // zadziałać: dostęp znika, a status zamówienia idzie na `refunded`.
    scene.order = orderRow({ amount_cents: 4900, refunded_amount_cents: 0 });
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});

    await applyRefundEffects(refundEvent({ amountCents: 12000, capturedAmountCents: null }));

    expect(patches("payment_orders")[0]).toMatchObject({ status: "refunded" });
    expect(patches("user_subscriptions")[0]).toMatchObject({ status: "refunded" });
    warnLog.mockRestore();
  });

  // =====================================================================
  // DEFEKT 4 (naprawiony): WYGRANY SPÓR nie przywracał zamówień znalezionych
  // sesją.
  //
  // CO BYŁO ZŁE. Odebranie dostępu (`revokeOrder`) szukało zamówienia po TRZECH
  // kolumnach: `provider_payment_intent_id`, `provider_intent_id` oraz
  // `provider_session_id` - z komentarzem, że bez tego „zwrot cicho nie
  // odbierałby dostępu". Przywrócenie (`restoreAccess`) szukało po JEDNEJ:
  // `.eq("provider_intent_id", ...)`.
  //
  // JAKIE TO BYŁO RYZYKO. Asymetria była jednokierunkowa i działała na
  // niekorzyść klienta: zamówienie zapisane identyfikatorem sesji checkout było
  // ZNAJDOWANE przy odbieraniu dostępu i NIEWIDOCZNE przy jego przywracaniu.
  // Efekt: spór wygrany (pieniądze zostają u nas), a klient bezpowrotnie bez
  // dostępu - i bez żadnego sygnału, bo `restoreAccess` oddawał wtedy
  // `skipped`, czyli stan nieodróżnialny od „nie było czego przywracać".
  // Test poniżej pokazuje obie strony w jednym przebiegu: ten sam wiersz jest
  // najpierw namierzony przez zwrot, a potem przez przywrócenie.
  //
  // JAK NAPRAWIONO. Obie ścieżki wołają JEDNĄ funkcję wyszukującą
  // (`findOrderForAdjustment`): ten sam filtr `or(...)` po trzech kolumnach,
  // ta sama bramka kształtu identyfikatora (bez niej `or` przyjąłby tekst
  // z payloadu operatora) i ten sam filtr środowiska.
  // =====================================================================
  it("wygrany spór przywraca zamówienie znalezione po sesji checkout", async () => {
    const sessionOrder = orderRow();
    // Atrapa naśladuje bazę: wiersz ma TYLKO identyfikator sesji, więc
    // odpowiada na filtr `or(...)`, a nie na `eq("provider_intent_id", ...)`.
    db.setResponse("payment_orders", (chain) => {
      if (chain.has("update")) return ok(null);
      if (chain.has("or")) return ok([sessionOrder]);
      return ok(null);
    });

    // Strona pierwsza: zwrot NAMIERZA zamówienie i odbiera dostęp.
    expect(await applyRefundEffects(refundEvent())).toBe("order_refunded");

    // Strona druga: spór wygrany - to samo zamówienie ma odzyskać dostęp.
    const outcome = await applyRefundEffects(
      refundEvent({ action: "chargeback", status: "reversed" }),
    );

    expect(outcome).toBe("order_restored");
  });
});
