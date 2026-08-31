// Synchronizacja danych klienta z operatora do profilu rozliczeniowego -
// 0 z 7 funkcji pokrytych do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. To ścieżka, którą DANE Z ZEWNĄTRZ (webhook
// operatora) wchodzą prosto do wiersza, z którego bierze się adres na
// fakturze, stawka podatku i korespondencja rozliczeniowa. Moduł działa
// klientem SERWISOWYM, czyli z pominięciem RLS - jedynym zamkiem jest to, co
// sam sprawdzi w kodzie. Dlatego testy chodzą parami: co MA zostać zapisane
// i czego zapisać NIE WOLNO.
//
// Trzy reguły, których pilnujemy najmocniej:
//   1. profil nigdy nie POWSTAJE z webhooka (aktualizacja, nie upsert) - profil
//      bez zgody użytkownika nie ma prawa istnieć;
//   2. powiązanie klienta operatora z kontem idzie WYŁĄCZNIE przez tabelę
//      `subscriptions` i JEST zawężone środowiskiem (sandbox nie rusza live);
//   3. puste / nieczytelne pola ładunku nie kasują danych, które już mamy.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_IDS,
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({ chain: null as { from: (table: string) => unknown } | null }));

// GRANICA, NIE SĄSIAD: podmieniamy klienta Supabase (rola serwisowa), a nie
// moduły `@/lib/billing/*`. Cała logika modułu wykonuje się naprawdę.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => h.chain?.from(table),
  },
}));

const { syncCustomerAddress, syncCustomerBusiness, syncCustomerProfile } =
  await import("@/lib/billing/customerSync.server");

/**
 * Wiersz `subscriptions` w zakresie, jakiego dotyka wyszukiwanie właściciela.
 * `tenant_id` (kolumna NOT NULL) jest tu tak samo obowiązkowy jak `user_id`:
 * to on rozstrzyga, KTÓRY z profili rozliczeniowych tego człowieka wolno
 * zapisać.
 */
interface SubscriptionLink {
  user_id: string;
  tenant_id: string;
}

/** Miniaturowy wiersz `billing_profiles` - tylko klucze filtrowania. */
interface StoredProfile {
  id: string;
  user_id: string;
  tenant_id: string;
}

let chain: SupabaseFromStub;
/** Profile widoczne dla roli serwisowej - także z INNYCH tenantów. */
let profiles: StoredProfile[];
/** Identyfikatory profili, które FAKTYCZNIE objął zapis (obserwowalna szkoda). */
let touchedProfiles: string[];

/** Filtry `eq` zapisane w łańcuchu, w postaci par kolumna-wartość. */
function eqFilters(recorded: RecordedChain): Array<[string, unknown]> {
  return recorded.calls
    .filter((call) => call.method === "eq")
    .map((call) => [typeof call.args[0] === "string" ? call.args[0] : "", call.args[1]]);
}

/** Odczyt kolumny bez rzutowania - jawne zawężenie zamiast indeksu po stringu. */
function fieldOf(row: StoredProfile, column: string): string | null {
  if (column === "id") return row.id;
  if (column === "user_id") return row.user_id;
  if (column === "tenant_id") return row.tenant_id;
  return null;
}

/** Ładunek `update()` zapisany w łańcuchu - to on trafiłby do bazy. */
function updatePayload(recorded: RecordedChain): Record<string, unknown> {
  const args = recorded.argsOf("update");
  const payload = args?.[0];
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? { ...payload }
    : {};
}

/** Ostatni łańcuch aktualizacji profilu (pomija łańcuchy czysto odczytowe). */
function lastProfileUpdate(): RecordedChain | undefined {
  return chain
    .chainsFor("billing_profiles")
    .filter((c) => c.has("update"))
    .at(-1);
}

/** Subskrypcja wiążąca klienta operatora z kontem - domyślnie w `sandbox`. */
function linkSubscription(link: SubscriptionLink | null, environment = "sandbox"): void {
  chain.setResponse("subscriptions", (recorded) => {
    const filters = eqFilters(recorded);
    const envFilter = filters.find(([column]) => column === "environment")?.[1];
    // Powiązanie ISTNIEJE tylko w swoim środowisku - zdarzenie z sandboxa nie
    // ma prawa odnaleźć klienta produkcyjnego i odwrotnie.
    return ok(envFilter === environment ? link : null);
  });
}

beforeEach(() => {
  chain = supabaseFromStub();
  h.chain = chain;
  profiles = [{ id: "profile-alfa", user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant }];
  touchedProfiles = [];
  linkSubscription({ user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant });
  chain.setResponse("billing_profiles", (recorded) => {
    const filters = eqFilters(recorded);
    const matched = profiles.filter((row) =>
      filters.every(([column, value]) => fieldOf(row, column) === value),
    );
    // Miniaturowa tabela, a nie licznik wywołań: chodzi o to, KTÓRE wiersze
    // objąłby zapis, a nie ile razy ktoś zawołał `update`.
    if (recorded.has("update")) touchedProfiles.push(...matched.map((row) => row.id));
    return ok(matched.map((row) => ({ id: row.id })));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Powiązanie klienta operatora z kontem (wspólne dla trzech zdarzeń)
// ---------------------------------------------------------------------------

describe("powiązanie klienta operatora z kontem", () => {
  it("szuka właściciela po identyfikatorze klienta ORAZ środowisku, biorąc najnowszą subskrypcję", async () => {
    await syncCustomerProfile({ id: "cus_1", email: "klient@example.com" }, "sandbox");

    const lookup = chain.lastChain("subscriptions")!;
    expect(eqFilters(lookup)).toEqual([
      ["provider_customer_id", "cus_1"],
      ["environment", "sandbox"],
    ]);
    expect(lookup.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(lookup.argsOf("limit")).toEqual([1]);
  });

  it("ODMOWA: zdarzenie z innego środowiska nie dosięga konta", async () => {
    // Klucz operatora jest per środowisko, ale identyfikatory klientów bywają
    // podobne. Bez filtra środowiska zdarzenie z piaskownicy przepisywałoby
    // adres na fakturze klienta produkcyjnego.
    linkSubscription({ user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant }, "live");

    await syncCustomerProfile({ id: "cus_1", email: "podmiana@example.com" }, "sandbox");

    expect(lastProfileUpdate()).toBeUndefined();
  });

  it("ODMOWA: ładunek bez identyfikatora klienta nie generuje ŻADNEGO zapytania", async () => {
    for (const payload of [null, undefined, {}, { id: "" }, { id: "   " }, { id: 42 }, "cus_1"]) {
      await syncCustomerProfile(payload, "sandbox");
    }

    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("ODMOWA: klient bez subskrypcji w naszej bazie nie dostaje aktualizacji profilu", async () => {
    // Jedyne wiarygodne powiązanie to `subscriptions`. Zgadywanie po e-mailu
    // z ładunku operatora oznaczałoby przejęcie cudzego profilu przez zmianę
    // adresu w portalu klienta.
    linkSubscription(null);

    await syncCustomerProfile({ id: "cus_nieznany", email: "obcy@example.org" }, "sandbox");

    expect(chain.chainsFor("subscriptions")).toHaveLength(1);
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("ODMOWA: awaria odczytu powiązania kończy pracę cicho, ale ze śladem w logu", async () => {
    chain.setResponse("subscriptions", fail("permission denied for table subscriptions"));

    await expect(
      syncCustomerProfile({ id: "cus_1", email: "klient@example.com" }, "sandbox"),
    ).resolves.toBeUndefined();
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// customer.updated
// ---------------------------------------------------------------------------

describe("syncCustomerProfile - dane kontaktowe klienta", () => {
  it("przepisuje e-mail i nazwę na ISTNIEJĄCY profil, stemplując czas zmiany", async () => {
    await syncCustomerProfile(
      { id: "cus_1", email: "  klient@example.com  ", name: "  Klient Testowy  " },
      "sandbox",
    );

    const update = lastProfileUpdate()!;
    const payload = updatePayload(update);
    expect(payload.email).toBe("klient@example.com");
    expect(payload.full_name).toBe("Klient Testowy");
    expect(typeof payload.updated_at).toBe("string");
    expect(eqFilters(update)).toContainEqual(["user_id", BILLING_IDS.me]);
    // AKTUALIZACJA, NIGDY WSTAWIENIE: profil bez zgody użytkownika nie ma
    // prawa powstać z webhooka.
    expect(update.has("insert")).toBe(false);
    expect(update.has("upsert")).toBe(false);
  });

  it("ODMOWA: ładunek bez czytelnych pól nie wysyła pustej aktualizacji", async () => {
    // Pusty `update()` przestemplowałby `updated_at` i skasował informację
    // o tym, kiedy dane naprawdę się zmieniły.
    await syncCustomerProfile({ id: "cus_1", email: "   ", name: null }, "sandbox");

    expect(lastProfileUpdate()).toBeUndefined();
  });

  it("pole nieobecne w ładunku nie kasuje wartości, którą już mamy", async () => {
    await syncCustomerProfile({ id: "cus_1", name: "Klient Testowy" }, "sandbox");

    const payload = updatePayload(lastProfileUpdate()!);
    expect(payload).not.toHaveProperty("email");
    expect(payload.full_name).toBe("Klient Testowy");
  });

  it("ODMOWA: brak profilu do aktualizacji nie jest błędem ani powodem do jego założenia", async () => {
    profiles = [];

    await expect(
      syncCustomerProfile({ id: "cus_1", email: "klient@example.com" }, "sandbox"),
    ).resolves.toBeUndefined();
    expect(lastProfileUpdate()!.has("update")).toBe(true);
  });

  it("zapis bez zwrotki (`null`) nie jest raportowany jako sukces ani jako awaria", async () => {
    // PostgREST potrafi oddać `null` zamiast listy zmienionych wierszy.
    // Obsługa zdarzenia ma się wtedy zakończyć spokojnie - webhook, który
    // rzuci wyjątkiem, wraca do operatora jako 5xx i jest ponawiany w kółko.
    chain.setResponse("billing_profiles", ok(null));

    await expect(
      syncCustomerProfile({ id: "cus_1", email: "klient@example.com" }, "sandbox"),
    ).resolves.toBeUndefined();
    expect(lastProfileUpdate()!.has("update")).toBe(true);
  });

  it("ODMOWA: błąd zapisu profilu nie wywraca obsługi zdarzenia", async () => {
    // Webhook, który rzuci wyjątkiem, wraca do operatora jako 5xx i jest
    // ponawiany w kółko - tu zapis ma się poddać, zostawiając ślad w logu.
    chain.setResponse("billing_profiles", fail("value too long for type character varying"));

    await expect(
      syncCustomerProfile({ id: "cus_1", email: "klient@example.com" }, "sandbox"),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// address.updated
// ---------------------------------------------------------------------------

describe("syncCustomerAddress - adres rozliczeniowy", () => {
  it("przepisuje komplet adresu i podnosi kod kraju do wielkich liter", async () => {
    // Kod kraju steruje stawką podatku - `pl` i `PL` muszą trafić do bazy
    // jako jedna wartość, inaczej reguła podatkowa nie dopasuje kraju.
    await syncCustomerAddress(
      {
        customerId: "cus_1",
        firstLine: "ul. Testowa 1",
        secondLine: "lok. 2",
        city: "Warszawa",
        region: "mazowieckie",
        postalCode: "00-001",
        countryCode: " pl ",
      },
      "sandbox",
    );

    expect(updatePayload(lastProfileUpdate()!)).toMatchObject({
      address_line1: "ul. Testowa 1",
      address_line2: "lok. 2",
      city: "Warszawa",
      region: "mazowieckie",
      postal_code: "00-001",
      country_code: "PL",
    });
  });

  it("adres CZĘŚCIOWY aktualizuje tylko podane pola", async () => {
    await syncCustomerAddress({ customerId: "cus_1", city: "Bruksela" }, "sandbox");

    const payload = updatePayload(lastProfileUpdate()!);
    expect(payload.city).toBe("Bruksela");
    expect(payload).not.toHaveProperty("address_line1");
    expect(payload).not.toHaveProperty("country_code");
  });

  it("ODMOWA: adres bez identyfikatora klienta nie dotyka bazy", async () => {
    // `address.updated` niesie `customerId`, a nie `id` - pomyłka w nazwie
    // klucza MA kończyć się brakiem zapisu, nie zapisem pod przypadkowy profil.
    for (const payload of [{ id: "cus_1", city: "Bruksela" }, null, undefined, {}]) {
      await syncCustomerAddress(payload, "sandbox");
    }

    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("ODMOWA: adres złożony z samych pustych pól nie wysyła aktualizacji", async () => {
    await syncCustomerAddress(
      { customerId: "cus_1", firstLine: "  ", city: "", countryCode: null },
      "sandbox",
    );

    expect(lastProfileUpdate()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// business.updated
// ---------------------------------------------------------------------------

describe("syncCustomerBusiness - dane firmowe", () => {
  it("nazwa firmy przełącza profil na fakturę B2B", async () => {
    await syncCustomerBusiness(
      { customerId: "cus_1", name: "NES Sp. z o.o.", taxIdentifier: "PL1234567890" },
      "sandbox",
    );

    expect(updatePayload(lastProfileUpdate()!)).toMatchObject({
      company: "NES Sp. z o.o.",
      is_company: true,
      tax_id: "PL1234567890",
    });
  });

  it("sam numer podatkowy NIE przełącza profilu na firmowy", async () => {
    // Świadome zachowanie: `is_company` zmienia treść faktury, więc zapada
    // razem z nazwą firmy, a nie na podstawie samego numeru.
    await syncCustomerBusiness({ customerId: "cus_1", taxIdentifier: "PL1234567890" }, "sandbox");

    const payload = updatePayload(lastProfileUpdate()!);
    expect(payload.tax_id).toBe("PL1234567890");
    expect(payload).not.toHaveProperty("is_company");
    expect(payload).not.toHaveProperty("company");
  });

  it("ODMOWA: pusty ładunek firmowy nie wysyła aktualizacji", async () => {
    await syncCustomerBusiness({ customerId: "cus_1", name: "  ", taxIdentifier: "" }, "sandbox");

    expect(lastProfileUpdate()).toBeUndefined();
  });

  it("ODMOWA: dane firmowe klienta bez powiązania z kontem nie tworzą profilu", async () => {
    linkSubscription(null);

    await syncCustomerBusiness({ customerId: "cus_obcy", name: "Obca S.A." }, "sandbox");

    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("ODMOWA: pusty ładunek zdarzenia firmowego nie dotyka bazy", async () => {
    for (const payload of [null, undefined, {}]) {
      await syncCustomerBusiness(payload, "sandbox");
    }

    expect(chain.chainsFor("subscriptions")).toHaveLength(0);
    expect(chain.chainsFor("billing_profiles")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Izolacja tenanta
// ---------------------------------------------------------------------------

describe("izolacja tenanta przy zapisie profilu", () => {
  it("aktualizacja profilu obejmuje WYŁĄCZNIE tenanta, w którym powstała subskrypcja", async () => {
    // CO BYŁO ZŁE (defekt naprawiony 31.08.2026). `patchProfile` zawężał
    // zapis wyłącznie do `user_id` (`.eq("user_id", userId)`) i robił to
    // KLIENTEM SERWISOWYM, czyli z pominięciem RLS. Tymczasem
    // `billing_profiles` ma `UNIQUE (user_id, tenant_id)` (migracja
    // 20260624172041, komentarz „one per user, per tenant"), więc ten sam
    // człowiek ma tyle profili, w ilu tenantach kupował. Jedno zdarzenie
    // `customer.updated` przepisywało je wszystkie.
    //
    // JAKIE TO BYŁO RYZYKO. To był wyciek danych MIĘDZY NAJEMCAMI zapisany
    // naszą własną ręką: adres firmy podany w portalu operatora dla tenanta A
    // lądował na fakturze tenanta B, razem z numerem podatkowym i nazwą firmy.
    // Kierunek jest szczególnie paskudny, bo dane wjeżdżają Z ZEWNĄTRZ
    // (webhook operatora), a rola serwisowa nie ma nad sobą żadnej polityki.
    // Reszta repo traktuje izolację tenanta jako regułę pieniężną -
    // `tenant_isolation_billing_storage_test.sql` pilnuje jej po stronie bazy,
    // a `src/test/billing/fixtures.ts` zapisuje ją wprost jako zasadę.
    //
    // JAK NAPRAWIONE. Powiązanie i tak idzie przez `subscriptions`, a ta
    // tabela ma kolumnę `tenant_id` (NOT NULL): `userForCustomer` oddaje
    // teraz parę `{ userId, tenantId }`, a `patchProfile` dokłada
    // `.eq("tenant_id", tenantId)`. Wiersz powiązania bez najemcy znaczy
    // „nie wiem, który profil" i kończy się BRAKIEM zapisu (fail-closed).
    profiles = [
      { id: "profile-alfa", user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.tenant },
      { id: "profile-beta", user_id: BILLING_IDS.me, tenant_id: BILLING_IDS.foreignTenant },
    ];

    await syncCustomerBusiness(
      { customerId: "cus_1", name: "NES Sp. z o.o.", taxIdentifier: "PL1234567890" },
      "sandbox",
    );

    // Zapis obejmuje wyłącznie profil tenanta, w którym powstała subskrypcja.
    expect(touchedProfiles).toEqual(["profile-alfa"]);
  });
});
