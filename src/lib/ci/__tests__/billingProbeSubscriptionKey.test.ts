// @vitest-environment node
//
// KLUCZ, PO KTÓRYM NOCNA SONDA SZUKA NASZEJ STRONY (PAY-17c, luka testowa
// przeglądu „criterionTestGaps" PAY-17c).
//
// JAKIE RYZYKO PILNUJE TEN PLIK. Sonda pyta o dziennik webhooków jednej
// subskrypcji: RPC `billing_probe_status` filtruje
// `payment_webhook_events.subscription_id = <sub_…>`. Kolumnę stempluje
// WYŁĄCZNIE trasa webhooka przy rezerwacji - z `subscriptionId` danych
// zdarzenia albo z `id` zdarzeń `subscription.*`. Test CLI sondy sprawdzał
// tylko, że sonda PYTA o `sub_…`; nic nie wiązało tego z tym, co trasa
// faktycznie ZAPISUJE. Regresja po stronie trasy (inny klucz, brak stempla
// dla faktur w kształcie API `dahlia`) zostawiałaby sondę na stałe czerwoną -
// albo, przy filtrze bez porażek, na stałe zieloną - bez żadnego czerwonego
// testu.
//
// Dowód biegnie PRAWDZIWĄ ścieżką: podpis HMAC, normalizacja Stripe'a,
// rezerwacja w dzienniku. Drugi koniec - filtr RPC po tej kolumnie i po
// piaskownicy - dowodzi supabase/tests/billing_ops_transport_test.sql na
// prawdziwym Postgresie; tu pilnujemy, że migracja filtruje po TEJ kolumnie.
//
// GRANICE ATRAP: klient roli serwisowej Supabase (dziennik + strażnik
// kolejności), `runAfterResponse` i kontrola odcisku katalogu (sieć).
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabase/chain";
import { FIXED_NOW_MS, SEKUNDA, freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
  afterResponse: [] as Promise<unknown>[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.afterResponse.push(work.catch(() => undefined));
  },
}));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({
  ensureCatalogSynced: async () => {},
}));

import { __handleForTests as handle } from "@/routes/api/public/payments/webhook";

freezeClock();

const SECRET = "whsec_sandbox_probe_key";
const NOW_S = Math.floor(FIXED_NOW_MS / SEKUNDA);
const LOG = "payment_webhook_events";
const SUBSCRIPTION = "sub_probekey123";
const db = supabaseFromStub();

function signed(event: Record<string, unknown>): Request {
  const body = JSON.stringify(event);
  const v1 = createHmac("sha256", SECRET).update(`${NOW_S}.${body}`).digest("hex");
  return new Request("https://example.com/api/public/payments/webhook?env=sandbox", {
    method: "POST",
    headers: { "stripe-signature": `t=${NOW_S},v1=${v1}` },
    body,
  });
}

/** Wiersz, który trasa wstawiła do dziennika przy rezerwacji. */
const logInsert = () =>
  db
    .chainsFor(LOG)
    .find((chain) => chain.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  db.reset();
  h.db.current = db;
  h.afterResponse.length = 0;
  // Rezerwacja przechodzi; dalsza obsługa nie jest przedmiotem tego pliku -
  // każda inna tabela odpowiada pustym wynikiem.
  db.setResponse(LOG, (chain: RecordedChain) =>
    chain.has("update") ? ok([{ id: "row-1" }]) : ok(null),
  );
  for (const table of ["subscriptions", "user_subscriptions", "profiles", "payment_orders"]) {
    db.setResponse(table, ok(null));
  }
  vi.stubEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("test: sieć zablokowana"))),
  );
});

afterEach(async () => {
  await Promise.all(h.afterResponse);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trasa webhooka stempluje klucz sondy: `subscription_id` = `sub_…` z piaskownicy", () => {
  it("zmiana subskrypcji (`customer.subscription.updated`) - zdarzenie, które sonda liczy jako odbiór odnowienia", async () => {
    await handle(
      signed({
        id: "evt_probe_sub",
        type: "customer.subscription.updated",
        created: NOW_S,
        data: {
          object: {
            id: SUBSCRIPTION,
            customer: "cus_probekey",
            status: "active",
            metadata: {},
            items: { data: [] },
          },
        },
      }),
    );

    expect(logInsert()).toMatchObject({
      event_id: "evt_probe_sub",
      // Sonda liczy wyłącznie przetworzone `subscription.*` - typ PO normalizacji.
      event_type: "subscription.updated",
      environment: "sandbox",
      subscription_id: SUBSCRIPTION,
    });
  });

  it("faktura odnowienia w kształcie API `dahlia` (powiązanie w `parent.subscription_details`) - porażka obsługi trafia pod ten sam klucz", async () => {
    await handle(
      signed({
        id: "evt_probe_invoice",
        type: "invoice.paid",
        created: NOW_S,
        data: {
          object: {
            id: "in_probekey",
            customer: "cus_probekey",
            currency: "pln",
            total: 4900,
            amount_paid: 4900,
            billing_reason: "subscription_cycle",
            parent: {
              type: "subscription_details",
              subscription_details: { subscription: SUBSCRIPTION, metadata: {} },
            },
            lines: { data: [] },
          },
        },
      }),
    );

    // Bez tego stempla `failed` obsługi faktury nie byłby widoczny dla sondy,
    // a ta raportowałaby „nasza strona nadąża" przy padającej realizacji.
    expect(logInsert()).toMatchObject({
      event_id: "evt_probe_invoice",
      environment: "sandbox",
      subscription_id: SUBSCRIPTION,
    });
  });

  it("RPC sondy filtruje dziennik po TEJ kolumnie i wyłącznie w piaskownicy", () => {
    const file = readdirSync("supabase/migrations")
      .filter((name) =>
        readFileSync(`supabase/migrations/${name}`, "utf8").includes(
          "FUNCTION public.billing_probe_status(",
        ),
      )
      .sort()
      .at(-1);
    expect(file).toBeDefined();
    const sql = readFileSync(`supabase/migrations/${file!}`, "utf8");

    expect(sql).toContain("w.subscription_id = p_subscription_id");
    expect(sql).toContain("w.environment = 'sandbox'");
    // Kształt klucza, który RPC przyjmuje, obejmuje identyfikator z tego testu.
    expect(new RegExp("^sub_[A-Za-z0-9]{1,250}$").test(SUBSCRIPTION)).toBe(true);
    expect(sql).toContain("'^sub_[A-Za-z0-9]{1,250}$'");
  });
});
