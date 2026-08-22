// Nadanie warstwy członkostwa po ZAPŁACONYM zamówieniu - ostatnie ogniwo między
// „klient zapłacił za plan z kuponu" i „klient ten plan ma".
//
// Strona bazy jest udowodniona pgTAP-em (`coupon_effects_after_payment_test.sql`).
// Strona TypeScriptu nie miała ani jednego testu, mimo że jedyny test, który
// dotyka tej ścieżki (`oneTimeFulfilment.event.test.ts`), MOCKUJE ten moduł -
// stąd 0% linii i 0/2 funkcji. Ten plik przepuszcza te same decyzje przez
// PRAWDZIWY kod.
//
// CO TEN PLIK DOWODZI.
//   1. DRYF NAZWY POLA W ODPOWIEDZI RPC JEST CAŁKOWICIE BEZGŁOŚNY (`it.fails`).
//      To najważniejsze ustalenie tego pliku i jest GORSZE, niż zakładało
//      zlecenie. `parseOutcome` czyta `o.applied === true`, więc odpowiedź
//      `{ was_applied: true }` (przemianowane pole) daje `{ applied: false }`
//      BEZ pola `reason`. Warunek ostrzeżenia to
//      `applied && tierGranted === false && reason !== undefined`
//      (couponEffects.server.ts:70) - przy `applied: false` NIE ZAPADA.
//      Gałąź `console.error` obsługuje tylko `error` z RPC i wyjątek.
//      Efekt: ZERO logu, zero wpisu w audycie, a obaj wywołujący
//      (`checkout.functions.ts:527`, `oneTimeFulfilment.server.ts:188`) robią
//      `await applyCouponEffectsForOrder(order.id)` i WYRZUCAJĄ wynik.
//      Klient zapłacił, planu nie ma, i nikt - ani redakcja, ani monitoring -
//      nie dowie się o tym z żadnego kanału. Zlecenie zakładało, że sygnałem
//      jest `console.warn`; sygnału nie ma wcale.
//   2. `applied` PRZYJMUJE WYŁĄCZNIE `true` BOOLOWSKIE. `"true"` (string z
//      JSON-a po przejściu przez warstwę serializującą), `1`, `"t"` - wszystko
//      to daje `applied: false`. To zachowanie jest POPRAWNE (fail-closed:
//      lepiej nie odnotować nadania, które się nie stało, niż odnotować
//      nadanie, którego nie było) i test pilnuje, żeby nikt tego nie
//      „naprawił" na rzutowanie prawdziwościowe.
//   3. KUPON OBIECUJĄCY NIEISTNIEJĄCĄ WARSTWĘ ZOSTAWIA ŚLAD. Gdy baza mówi
//      „zatrzask wzięty, ale warstwy nie nadałem" (`applied: true`,
//      `tier_granted: false`, `reason` podany), leci `console.warn` z numerem
//      zamówienia i kluczem warstwy - bo klient zapłacił za plan, którego nie
//      ma w `membership_tiers` tego najemcy.
//   4. AWARIA RPC I WYJĄTEK NIE WYWRACAJĄ KSIĘGOWANIA PŁATNOŚCI, ale każde
//      z nich ma WŁASNY, rozróżnialny powód (`rpc_error` vs `exception`) -
//      inaczej diagnoza „czy baza odmówiła, czy w ogóle nie dojechaliśmy"
//      jest niemożliwa.
//   5. IDEMPOTENCJA PRZY POWTÓRNEJ DOSTAWIE WEBHOOKA. Drugie wywołanie dla
//      tego samego zamówienia trafia na zatrzask `effects_applied_at` i wraca
//      `already_applied` - bez drugiego nadania i bez ostrzeżenia.
//   6. ARGUMENT RPC NAZYWA SIĘ `_order_id`. Literówka w nazwie argumentu
//      przechodzi przez `tsc` (obiekt argumentów jest luźny) i przez recenzję,
//      a znaczy „baza użyje wartości domyślnej", czyli ciche nienadanie planu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania samej funkcji bazy
// (`coupon_effects_after_payment_test.sql`) ani ścieżki dostawy webhooka
// (`oneTimeFulfilment.event.test.ts`). Tutaj przedmiotem dowodu jest MAPOWANIE
// odpowiedzi RPC na decyzję i to, co z tej decyzji trafia do człowieka.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";

let rpc: SupabaseRpcStub;

// `applyCouponEffectsForOrder` sięga po klient serwisowy DYNAMICZNYM importem
// (żeby graf `node:*` nie wpadł do bundla klienta), więc atrapa musi stać na
// tym samym specyfikatorze. Prawdziwy moduł rzuca na starcie przy braku
// SUPABASE_SERVICE_ROLE_KEY - w teście nie ma i nie ma go być.
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return { rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args) };
  },
}));

const { applyCouponEffectsForOrder } = await import("@/lib/billing/couponEffects.server");

const ORDER = "11111111-1111-4111-8111-111111111111";
const RPC_NAME = "apply_b2b_coupon_effects";

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rpc = supabaseRpcStub();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyCouponEffectsForOrder: kontrakt wywołania RPC", () => {
  it("woła `apply_b2b_coupon_effects` z argumentem `_order_id`", async () => {
    rpc.setData(RPC_NAME, { applied: true, tier_granted: true, tier_key: "pro" });
    await applyCouponEffectsForOrder(ORDER);

    const call = rpc.lastCall(RPC_NAME);
    expect(call).toBeDefined();
    // Asercja PO NAZWIE argumentu: literówka tutaj znaczy „baza weźmie
    // DEFAULT", czyli nikomu nic nie nada, i nie zgłasza się błędem.
    expect(call?.has("_order_id")).toBe(true);
    expect(call?.arg("_order_id")).toBe(ORDER);
    expect(call?.keys()).toEqual(["_order_id"]);
  });

  it("nie woła żadnej innej funkcji bazy", async () => {
    rpc.setData(RPC_NAME, { applied: false, reason: "order_not_paid" });
    await applyCouponEffectsForOrder(ORDER);
    expect(rpc.names()).toEqual([RPC_NAME]);
  });
});

describe("parseOutcome: mapowanie odpowiedzi bazy na decyzję", () => {
  it("pełny kształt przechodzi w całości", async () => {
    rpc.setData(RPC_NAME, {
      applied: true,
      reason: "granted",
      tier_granted: true,
      tier_key: "patron",
    });
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: true,
      reason: "granted",
      tierGranted: true,
      tierKey: "patron",
    });
  });

  it("`null` z bazy daje `no_result`, a nie wyjątek", async () => {
    rpc.setData(RPC_NAME, null);
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "no_result",
    });
  });

  it.each([
    ["liczba", 7],
    ["string", "applied"],
    ["boolean", true],
    ["undefined", undefined],
  ])("odpowiedź nie-obiektowa (%s) daje `no_result`", async (_label, value) => {
    rpc.setData(RPC_NAME, value);
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "no_result",
    });
  });

  it.each([
    ['string "true"', "true"],
    ["liczba 1", 1],
    ['litera "t"', "t"],
    ["obiekt", {}],
  ])("`applied` jako %s NIE liczy się jako nadanie (fail-closed)", async (_label, value) => {
    // Serializacja przez PostgREST potrafi oddać boolean jako string. Kod
    // wymaga `=== true` i to jest zachowanie POPRAWNE: „nie wiem" ma znaczyć
    // „nie nadano", nie „nadano".
    rpc.setData(RPC_NAME, { applied: value });
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect(outcome.applied).toBe(false);
  });

  it("`reason` nie-napisowy jest POMIJANY, nie przepisywany", async () => {
    // Pole `reason` istnieje w kształcie tylko wtedy, gdy jest stringiem -
    // inaczej `outcome.reason` musi być `undefined`, bo od tego zależy warunek
    // ostrzeżenia.
    rpc.setData(RPC_NAME, { applied: true, reason: 42, tier_granted: false });
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect("reason" in outcome).toBe(false);
    expect(outcome.tierGranted).toBe(false);
  });

  it("`tier_granted` nie-boolowski jest POMIJANY", async () => {
    rpc.setData(RPC_NAME, { applied: true, tier_granted: "yes", reason: "x" });
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect("tierGranted" in outcome).toBe(false);
  });

  it("`tier_key: null` PRZECHODZI - null to inna odpowiedź niż brak klucza", async () => {
    // `null` znaczy „kupon nie obiecuje żadnej warstwy" i musi być odróżnialne
    // od „baza nie powiedziała nic o warstwie".
    rpc.setData(RPC_NAME, { applied: true, tier_key: null });
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect("tierKey" in outcome).toBe(true);
    expect(outcome.tierKey).toBeNull();
  });

  it("`tier_key` nie-napisowy i nie-null jest POMIJANY", async () => {
    rpc.setData(RPC_NAME, { applied: true, tier_key: 5 });
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect("tierKey" in outcome).toBe(false);
  });

  it("tablica z bazy jest obiektem - nie wpada w `no_result`, ale nic nie nadaje", async () => {
    // `typeof [] === "object"`, więc `parseOutcome` NIE odrzuca tablicy jako
    // „brak wyniku". Czyta z niej pola, których tam nie ma, i wychodzi
    // `applied: false` bez powodu - czyli dokładnie cichy przypadek z punktu 1.
    rpc.setData(RPC_NAME, [{ applied: true }]);
    const outcome = await applyCouponEffectsForOrder(ORDER);
    expect(outcome).toEqual({ applied: false });
  });
});

describe("ścieżki awarii: rozróżnialny powód, brak wywrotki", () => {
  it("odmowa bazy daje `rpc_error` i log błędu z numerem zamówienia", async () => {
    rpc.setError(RPC_NAME, "permission denied for function", "42501");
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "rpc_error",
    });
    expect(error).toHaveBeenCalledTimes(1);
    // Numer zamówienia MUSI być w logu - bez niego wpis jest nie do
    // powiązania z płatnością, której dotyczy.
    expect(error.mock.calls[0]).toContain(ORDER);
  });

  it("wyjątek w trakcie wywołania daje `exception`, nie `rpc_error`", async () => {
    rpc.setResponse(RPC_NAME, () => {
      throw new Error("socket hang up");
    });
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "exception",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toContain(ORDER);
  });

  it("funkcja NIGDY nie rzuca - księgowanie płatności nie może się wywrócić", async () => {
    // Best-effort jest tu świadomą decyzją: nieudane efekty kuponu nie mogą
    // cofnąć zaksięgowanej płatności ani nadanego uprawnienia.
    rpc.setResponse(RPC_NAME, () => {
      throw new Error("cokolwiek");
    });
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toBeDefined();
  });

  it("awaria NIE emituje ostrzeżenia o warstwie - to inny kanał", async () => {
    rpc.setError(RPC_NAME, "timeout");
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ostrzeżenie o obiecanej, ale nienadanej warstwie", () => {
  it("applied + tier_granted:false + reason -> `console.warn` z zamówieniem i kluczem", async () => {
    rpc.setData(RPC_NAME, {
      applied: true,
      reason: "tier_not_found",
      tier_granted: false,
      tier_key: "gold",
    });
    await applyCouponEffectsForOrder(ORDER);

    expect(warn).toHaveBeenCalledTimes(1);
    const args = warn.mock.calls[0];
    expect(args).toContain(ORDER);
    expect(args).toContain("tier_not_found");
    // Klucz warstwy jest tym, czego redakcja potrzebuje, żeby naprawić kupon.
    expect(args).toContain("gold");
  });

  it("brak `tier_key` w odpowiedzi loguje pusty string, nie `undefined`", async () => {
    rpc.setData(RPC_NAME, { applied: true, reason: "tier_not_found", tier_granted: false });
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toContain("");
  });

  it("nadanie UDANE nie ostrzega", async () => {
    rpc.setData(RPC_NAME, { applied: true, tier_granted: true, tier_key: "pro", reason: "ok" });
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).not.toHaveBeenCalled();
  });

  it("kupon BEZ obietnicy warstwy nie ostrzega", async () => {
    // `tier_granted` nieobecne = kupon niczego nie obiecywał, więc nie ma
    // czego zgłaszać redakcji.
    rpc.setData(RPC_NAME, { applied: true, reason: "no_tier_on_coupon" });
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).not.toHaveBeenCalled();
  });

  it("tier_granted:false BEZ powodu nie ostrzega - świadoma granica warunku", async () => {
    rpc.setData(RPC_NAME, { applied: true, tier_granted: false });
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("idempotencja przy powtórnej dostawie webhooka", () => {
  it("drugie wywołanie trafia na zatrzask i wraca `already_applied` bez ostrzeżenia", async () => {
    let seen = 0;
    rpc.setResponse(RPC_NAME, () => {
      seen += 1;
      return seen === 1
        ? { data: { applied: true, tier_granted: true, tier_key: "pro" }, error: null }
        : { data: { applied: false, reason: "already_applied" }, error: null };
    });

    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toMatchObject({ applied: true });
    await expect(applyCouponEffectsForOrder(ORDER)).resolves.toEqual({
      applied: false,
      reason: "already_applied",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("`order_not_paid` to normalna odmowa, nie awaria - zero logów", async () => {
    // Webhook potrafi dojechać przed ustawieniem `status='paid'`. RPC świadomie
    // odmawia i to NIE jest incydent do logowania.
    rpc.setData(RPC_NAME, { applied: false, reason: "order_not_paid" });
    await applyCouponEffectsForOrder(ORDER);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("DEFEKT: dryf kształtu odpowiedzi RPC jest bezgłośny", () => {
  it.fails(
    "przemianowane pole `applied` -> `was_applied` MA zostawić jakikolwiek sygnał, " +
      "a nie zostawia żadnego (klient zapłacił, planu nie ma, nikt nie wie)",
    async () => {
      // Oczekiwanie: nierozpoznany kształt odpowiedzi to sytuacja wymagająca
      // uwagi człowieka - powinna trafić do `console.warn` albo `console.error`
      // (albo do audytu), bo jej skutkiem jest niezrealizowana obietnica
      // zakupowa. Produkcja mapuje ją na ciche `{ applied: false }`:
      // warunek ostrzeżenia wymaga `applied === true`, a gałąź `console.error`
      // obsługuje tylko `error` z RPC i wyjątek.
      rpc.setData(RPC_NAME, { was_applied: true, tier_was_granted: true, key: "pro" });
      const outcome = await applyCouponEffectsForOrder(ORDER);

      expect(outcome.applied).toBe(false);
      expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);
    },
  );

  it("STAN FAKTYCZNY: dryf pola daje `{applied:false}` i ZERO logów", async () => {
    // Ten test opisuje dzisiejsze zachowanie i jest sprzężony z `it.fails`
    // powyżej: gdy dryf zacznie być raportowany, ten test padnie i trzeba
    // będzie usunąć oba.
    rpc.setData(RPC_NAME, { was_applied: true, tier_was_granted: true });
    const outcome = await applyCouponEffectsForOrder(ORDER);

    expect(outcome).toEqual({ applied: false });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("obaj wywołujący produkcyjni WYRZUCAJĄ wynik - `applied:false` nie ma odbiorcy", async () => {
    // Dowód statyczny, nie behawioralny: gdyby ktoś zaczął czytać wynik,
    // cichy `applied: false` przestałby być niewidoczny. Dziś nie czyta go
    // nikt, więc pole `applied` nie ma w produkcji ŻADNEGO konsumenta.
    const { readFileSync } = await import("node:fs");
    for (const path of [
      "src/lib/billing/checkout.functions.ts",
      "src/lib/billing/oneTimeFulfilment.server.ts",
    ]) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} wywołuje efekty kuponu`).toContain("applyCouponEffectsForOrder(");
      // Wynik nie jest przypisywany do niczego - samo `await fn(...)`.
      expect(src).toMatch(/await applyCouponEffectsForOrder\(/);
      expect(src).not.toMatch(/=\s*await applyCouponEffectsForOrder\(/);
    }
  });
});
