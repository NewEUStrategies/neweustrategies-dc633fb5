// Panel administracyjny prezentów („udostępnij pełny artykuł") - 232 linie
// warstwy serwerowej, 0 z 12 funkcji pokrytych do 31.08.2026. Ten jeden plik
// ciągnął w dół cały obszar `lib/gifting`, którego pozostałe moduły (model,
// model panelu, hooki, panele) mają własne testy.
//
// PO CO TEN PLIK ISTNIEJE. Prezenty to OBEJŚCIE PAYWALLA udzielane świadomie:
// link generowany przez redakcję otwiera płatną treść osobie bez subskrypcji.
// Sześć funkcji z tego modułu ustawia reguły tego obejścia i pozwala je
// rozliczyć. Nieprzetestowane było dokładnie to, co siedzi w opakowaniu:
//
//   1. WALIDATORY. Limity (`monthly_limit`, `link_ttl_days`,
//      `max_redemptions_per_link`) są LUSTREM CHECK-ów z bazy. Wartość spoza
//      zakresu to albo błąd zapisu (CHECK odrzuca), albo - gdyby CHECK
//      kiedyś zniknął - limit 100 000 klików na link, czyli publiczny paywall.
//      Bramka uprawnienia (`eligibility`) jest enumem: wartość spoza listy
//      MUSI zostać odrzucona, bo baza trzyma tam CHECK, a panel renderuje
//      przełącznik o dwóch pozycjach.
//   2. TENANT NIE POCHODZI Z ŁADUNKU. `updateGiftAdminSettings` czyta go
//      z PROFILU wywołującego. Gdyby dało się go podać w żądaniu, redaktor
//      jednego najemcy przestawiłby limity innego.
//   3. FILTRY AUDYTU. Status linku i typ zdarzenia to enumy przekazywane do
//      SECURITY DEFINER RPC - dowolny napis w tym miejscu to filtr, którego
//      funkcja bazy nie rozumie (cichy pusty wynik w dzienniku audytu).
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness (`src/test/serverFnHarness.ts`)
// świadomie NIE uruchamia middleware. Deklarację `requireAdminEditor` przy
// KAŻDEJ z sześciu funkcji przybijamy strukturalnie; prawdziwymi bramkami są
// polityka RLS „gift settings staff write" i re-walidacja roli oraz najemcy
// wewnątrz każdego RPC (pgTAP).
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (łańcuch PostgREST + RPC).
// PRAWDZIWE zostają schematy zod, `@/lib/gifting/admin-model`
// (GIFT_ADMIN_BOUNDS, DEFAULT_GIFT_ADMIN_SETTINGS) i `normalizeGiftEligibility`
// - test ma dowodzić parytetu z modelem, a nie powtarzać jego liczby.
// Zero sieci. RODO: adresy wyłącznie example.com.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, supabaseRpcStub } from "@/test/supabase";
import { asServerFn, callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";
import {
  DEFAULT_GIFT_ADMIN_SETTINGS,
  GIFT_ADMIN_BOUNDS,
  GIFT_ADMIN_LIMIT_FIELDS,
} from "@/lib/gifting/admin-model";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));

const {
  getGiftAdminSettings,
  getGiftAdminStats,
  listGiftEventsAdmin,
  listGiftLinksAdmin,
  revokeGiftLinkAdmin,
  updateGiftAdminSettings,
} = await import("@/lib/gifting-admin.functions");

const SETTINGS = "gift_article_settings";
const PROFILES = "profiles";

/** Identyfikatory testowe - UUID losowe, bez związku z produkcją. */
const REDAKTOR = "dddddddd-1111-4222-8333-444444444444";
const TENANT = "eeeeeeee-1111-4222-8333-444444444444";
const LINK = "ffffffff-1111-4222-8333-444444444444";
const WPIS = "aaaaaaaa-2222-4333-8444-555555555555";

const db = supabaseFromStub();
const rpc = supabaseRpcStub();

/**
 * Klient z kontekstu. `get_gift_stats_admin` jest wołane z ogniwem
 * `.maybeSingle()`, więc atrapa RPC musi oddawać obiekt, który jest
 * JEDNOCZEŚNIE obietnicą i builderem - dokładnie jak klient produkcyjny.
 */
const supabaseKontekst = {
  from: db.from,
  rpc: (name: string, args?: Record<string, unknown>) => {
    const wynik = rpc.rpc(name, args);
    return Object.assign(wynik, { maybeSingle: () => wynik });
  },
};

const KONTEKST = { supabase: supabaseKontekst, userId: REDAKTOR };

/**
 * Poprawny komplet ustawień - punkt wyjścia dla przypadków odrzucenia.
 * Nadpisania są CELOWO nietypowane (`unknown`): połowa przypadków tego pliku
 * podaje wartości, których typ produkcyjny zabrania, a to właśnie one mają
 * zostać odrzucone przez schemat w czasie wykonania - bo ładunek server fn
 * przychodzi z przeglądarki, gdzie żaden typ już nie obowiązuje.
 */
function ustawienia(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    monthly_limit: 10,
    link_ttl_days: 30,
    max_redemptions_per_link: 5,
    eligibility: "registered",
    ...over,
  };
}

/** Wiersz `gift_article_settings` w kształcie czytanym przez handler. */
function wierszUstawien(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false,
    monthly_limit: 42,
    link_ttl_days: 14,
    max_redemptions_per_link: 3,
    eligibility: "subscribers",
    updated_at: "2026-08-20T10:00:00.000Z",
    updated_by: REDAKTOR,
    ...over,
  };
}

function waliduj(fn: unknown, input: unknown): unknown {
  const spec = asServerFn(fn);
  if (!spec.validator) throw new Error("test: funkcja bez walidatora");
  return spec.validator(input);
}

beforeEach(() => {
  db.reset();
  rpc.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SETTINGS, ok(null));
});

// ---------------------------------------------------------------------------
// Struktura bramek
// ---------------------------------------------------------------------------
describe("obudowa - bramki i metody wszystkich sześciu funkcji", () => {
  const funkcje: Array<[string, unknown, string]> = [
    ["getGiftAdminSettings", getGiftAdminSettings, "GET"],
    ["updateGiftAdminSettings", updateGiftAdminSettings, "POST"],
    ["getGiftAdminStats", getGiftAdminStats, "GET"],
    ["listGiftLinksAdmin", listGiftLinksAdmin, "POST"],
    ["revokeGiftLinkAdmin", revokeGiftLinkAdmin, "POST"],
    ["listGiftEventsAdmin", listGiftEventsAdmin, "POST"],
  ];

  it.each(funkcje)("%s deklaruje bramkę requireAdminEditor", (_nazwa, fn) => {
    // Dowód STRUKTURALNY. `requireAdminEditor` to auth + rola + AAL2 przy
    // zapisanym MFA. Spadek tej deklaracji do samego uwierzytelnienia oddałby
    // dowolnemu zalogowanemu ustawienia obejścia paywalla i dziennik audytu
    // (z adresami e-mail obdarowanych).
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireAdminEditor"]);
  });

  it.each(funkcje)("%s deklaruje właściwą metodę HTTP", (_nazwa, fn, metoda) => {
    // Zapis (revoke, upsert, filtrowane listy audytu) nie może być GET-em:
    // taki adres da się wywołać prefetchem albo z podglądu linku.
    expect(asServerFn(fn).method).toBe(metoda);
  });

  it("funkcje odczytu bez parametrów nie mają walidatora, reszta ma", () => {
    // Brak walidatora tam, gdzie NIE MA wejścia, jest poprawny; jego brak przy
    // funkcji przyjmującej ładunek oznaczałby, że do RPC idzie surowy obiekt
    // z przeglądarki.
    expect(asServerFn(getGiftAdminSettings).validator).toBeUndefined();
    expect(asServerFn(getGiftAdminStats).validator).toBeUndefined();
    for (const fn of [
      updateGiftAdminSettings,
      listGiftLinksAdmin,
      revokeGiftLinkAdmin,
      listGiftEventsAdmin,
    ]) {
      expect(typeof asServerFn(fn).validator).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// Ustawienia - odczyt
// ---------------------------------------------------------------------------
describe("odczyt ustawień", () => {
  it("BRAK wiersza pokazuje efektywne domyślne z bazy, oznaczone jako nieutrwalone", async () => {
    // „Brak wiersza" nie znaczy „wszystko na zero": create/redeem_gift_link
    // egzekwują wtedy fallbacki (10/30/5 + bramka rejestracji). Panel
    // pokazujący zera kłamałby adminowi o tym, co robi baza. Porównujemy
    // z PRAWDZIWĄ stałą modelu, żeby test nie był drugą kopią tych liczb.
    const wynik = await callServerFn(getGiftAdminSettings, { context: KONTEKST });

    expect(wynik).toEqual({
      ...DEFAULT_GIFT_ADMIN_SETTINGS,
      updated_at: null,
      updated_by: null,
      persisted: false,
    });
  });

  it("wiersz najemcy wraca jako utrwalony, z autorem i czasem zmiany", async () => {
    db.setResponse(SETTINGS, ok(wierszUstawien()));

    const wynik = await callServerFn(getGiftAdminSettings, { context: KONTEKST });

    expect(wynik).toEqual({
      enabled: false,
      monthly_limit: 42,
      link_ttl_days: 14,
      max_redemptions_per_link: 3,
      eligibility: "subscribers",
      updated_at: "2026-08-20T10:00:00.000Z",
      updated_by: REDAKTOR,
      persisted: true,
    });
  });

  it("czyta WSZYSTKIE pola, których potrzebuje formularz", async () => {
    // Brakująca kolumna w `select` to pole formularza wracające jako
    // `undefined` - przełącznik przeskakuje na wartość domyślną i zapisuje ją
    // przy pierwszym zapisie, po cichu zmieniając regułę najemcy.
    await callServerFn(getGiftAdminSettings, { context: KONTEKST });

    const kolumny = String(db.lastChain(SETTINGS)?.argsOf("select")?.[0] ?? "");
    for (const pole of [
      "enabled",
      "monthly_limit",
      "link_ttl_days",
      "max_redemptions_per_link",
      "eligibility",
      "updated_at",
      "updated_by",
    ]) {
      expect(kolumny).toContain(pole);
    }
  });

  it("nieznana wartość uprawnienia z bazy jest normalizowana do węższej", async () => {
    // `normalizeGiftEligibility` biegnie PRAWDZIWY. Nieznana wartość (starsza
    // migracja, ręczny UPDATE) musi spaść do „registered", a nie trafić do
    // przełącznika o dwóch pozycjach jako trzecia, nieobsługiwana wartość.
    db.setResponse(SETTINGS, ok(wierszUstawien({ eligibility: "everyone" })));

    const wynik = await callServerFn<{ eligibility: string }>(getGiftAdminSettings, {
      context: KONTEKST,
    });

    expect(wynik.eligibility).toBe("registered");
  });

  it("pusta wartość uprawnienia też schodzi do „registered”", async () => {
    db.setResponse(SETTINGS, ok(wierszUstawien({ eligibility: null })));

    const wynik = await callServerFn<{ eligibility: string }>(getGiftAdminSettings, {
      context: KONTEKST,
    });

    expect(wynik.eligibility).toBe("registered");
  });

  it("odmowa bazy wychodzi na zewnątrz zamiast udawać domyślne ustawienia", async () => {
    // Gdyby błąd degradował się do „brak wiersza", panel pokazałby fallbacki
    // jako stan najemcy - i pierwszy zapis nadpisałby prawdziwe ustawienia.
    db.setResponse(SETTINGS, fail("permission denied for table gift_article_settings", "42501"));

    await expect(callServerFn(getGiftAdminSettings, { context: KONTEKST })).rejects.toThrow(
      "permission denied for table gift_article_settings",
    );
  });
});

// ---------------------------------------------------------------------------
// Ustawienia - walidator zapisu
// ---------------------------------------------------------------------------
describe("walidator zapisu ustawień", () => {
  it("przyjmuje poprawny komplet", () => {
    expect(waliduj(updateGiftAdminSettings, ustawienia())).toEqual(ustawienia());
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s przyjmuje DOLNĄ granicę z modelu", (pole) => {
    // Zakresy pochodzą z GIFT_ADMIN_BOUNDS - lustra CHECK-ów z migracji.
    // Test czyta je z modelu, więc rozjazd schematu z modelem jest czerwony.
    const min = GIFT_ADMIN_BOUNDS[pole].min;

    expect(waliduj(updateGiftAdminSettings, ustawienia({ [pole]: min }))).toMatchObject({
      [pole]: min,
    });
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s przyjmuje GÓRNĄ granicę z modelu", (pole) => {
    const max = GIFT_ADMIN_BOUNDS[pole].max;

    expect(waliduj(updateGiftAdminSettings, ustawienia({ [pole]: max }))).toMatchObject({
      [pole]: max,
    });
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s odrzuca wartość PONIŻEJ zakresu", (pole) => {
    // Wartość ujemna w limicie miesięcznym albo w budżecie klików nie ma
    // interpretacji - baza odrzuci ją CHECK-iem, a formularz dostanie
    // nieczytelny błąd zamiast komunikatu przy polu.
    expect(() =>
      waliduj(updateGiftAdminSettings, ustawienia({ [pole]: GIFT_ADMIN_BOUNDS[pole].min - 1 })),
    ).toThrow();
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s odrzuca wartość POWYŻEJ zakresu", (pole) => {
    // Sufit jest tu regułą pieniężną: `max_redemptions_per_link` ponad limit
    // zamienia link prezentowy w publiczny adres do płatnej treści.
    expect(() =>
      waliduj(updateGiftAdminSettings, ustawienia({ [pole]: GIFT_ADMIN_BOUNDS[pole].max + 1 })),
    ).toThrow();
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s odrzuca ułamek", (pole) => {
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ [pole]: 1.5 }))).toThrow();
  });

  it.each(GIFT_ADMIN_LIMIT_FIELDS)("pole %s odrzuca napis i brak wartości", (pole) => {
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ [pole]: "10" }))).toThrow();

    const bezPola = ustawienia();
    delete bezPola[pole];
    expect(() => waliduj(updateGiftAdminSettings, bezPola)).toThrow();
  });

  it("odrzuca uprawnienie SPOZA enuma", () => {
    // Enum jest lustrem CHECK-a z migracji 20260806170000. Trzecia wartość
    // przeszłaby do bazy tylko po to, żeby wywalić się na CHECK-u - albo,
    // gdyby CHECK zniknął, ustawić regułę, której panel nie umie pokazać.
    expect(() =>
      waliduj(updateGiftAdminSettings, ustawienia({ eligibility: "everyone" })),
    ).toThrow();
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ eligibility: "" }))).toThrow();
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ eligibility: null }))).toThrow();
  });

  it("przyjmuje obie dozwolone wartości uprawnienia", () => {
    expect(
      waliduj(updateGiftAdminSettings, ustawienia({ eligibility: "registered" })),
    ).toMatchObject({ eligibility: "registered" });
    expect(
      waliduj(updateGiftAdminSettings, ustawienia({ eligibility: "subscribers" })),
    ).toMatchObject({ eligibility: "subscribers" });
  });

  it("odrzuca `enabled` w innym typie niż logiczny", () => {
    // „true" jako napis jest prawdziwe w JavaScripcie - koercja w tym miejscu
    // WŁĄCZYŁABY prezenty przy próbie ich wyłączenia.
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ enabled: "false" }))).toThrow();
    expect(() => waliduj(updateGiftAdminSettings, ustawienia({ enabled: 0 }))).toThrow();

    const bezEnabled = ustawienia();
    delete bezEnabled.enabled;
    expect(() => waliduj(updateGiftAdminSettings, bezEnabled)).toThrow();
  });

  it("odrzuca wejście, które nie jest obiektem", () => {
    expect(() => waliduj(updateGiftAdminSettings, undefined)).toThrow();
    expect(() => waliduj(updateGiftAdminSettings, null)).toThrow();
    expect(() => waliduj(updateGiftAdminSettings, "enabled")).toThrow();
  });

  it("obce pola są ODCINANE - w szczególności najemca", () => {
    // To jest bramka izolacji najemcy po stronie kontraktu: nawet gdyby
    // handler kiedyś zaczął czytać `data.tenant_id`, walidator go nie przepuści.
    expect(waliduj(updateGiftAdminSettings, { ...ustawienia(), tenant_id: "tenant-obcy" })).toEqual(
      ustawienia(),
    );
  });
});

// ---------------------------------------------------------------------------
// Ustawienia - zapis
// ---------------------------------------------------------------------------
describe("zapis ustawień", () => {
  it("najemca pochodzi z PROFILU wywołującego, nie z ładunku", async () => {
    // Gdyby najemca szedł z żądania, redaktor jednego serwisu przestawiłby
    // limity prezentów innego. Profil czytamy po `context.userId` z tokenu.
    await callServerFn(updateGiftAdminSettings, {
      data: { ...ustawienia(), tenant_id: "tenant-obcy" },
      context: KONTEKST,
    });

    expect(db.lastChain(PROFILES)?.argsOf("eq")).toEqual(["id", REDAKTOR]);
    const zapis = db.lastChain(SETTINGS)?.argsOf("upsert");
    expect(zapis?.[0]).toMatchObject({ tenant_id: TENANT });
  });

  it("zapisuje komplet ustawień, autora zmiany i znacznik czasu", async () => {
    await callServerFn(updateGiftAdminSettings, {
      data: ustawienia({ enabled: false, monthly_limit: 0 }),
      context: KONTEKST,
    });

    const zapis = db.lastChain(SETTINGS)?.argsOf("upsert");
    expect(zapis?.[0]).toMatchObject({
      tenant_id: TENANT,
      enabled: false,
      monthly_limit: 0,
      link_ttl_days: 30,
      max_redemptions_per_link: 5,
      eligibility: "registered",
      updated_by: REDAKTOR,
    });
    // Znacznik czasu musi być ISO - kolumna jest `timestamptz`, a panel
    // pokazuje „ostatnia zmiana" wprost z tej wartości.
    const wiersz = zapis?.[0];
    const updatedAt =
      typeof wiersz === "object" && wiersz !== null && "updated_at" in wiersz
        ? Reflect.get(wiersz, "updated_at")
        : null;
    expect(String(updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("zapis idzie z rozstrzygnięciem konfliktu po najemcy (singleton)", async () => {
    // Bez `onConflict` drugi zapis tworzyłby drugi wiersz ustawień tego samego
    // najemcy - a wtedy `maybeSingle()` przy odczycie zaczyna rzucać.
    await callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST });

    expect(db.lastChain(SETTINGS)?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id" });
  });

  it("sukces oddaje potwierdzenie", async () => {
    await expect(
      callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST }),
    ).resolves.toEqual({ ok: true });
  });

  it("konto BEZ najemcy dostaje odmowę i nic nie zapisuje", async () => {
    // Profil bez najemcy to konto w trakcie zakładania albo osierocone -
    // upsert z `tenant_id: null` trafiłby w cudzy wiersz albo w NOT NULL.
    db.setResponse(PROFILES, ok({ tenant_id: null }));

    await expect(
      callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST }),
    ).rejects.toThrow("Forbidden: no tenant");
    expect(db.chainsFor(SETTINGS)).toHaveLength(0);
  });

  it("brak wiersza profilu też jest odmową", async () => {
    db.setResponse(PROFILES, ok(null));

    await expect(
      callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST }),
    ).rejects.toThrow("Forbidden: no tenant");
    expect(db.chainsFor(SETTINGS)).toHaveLength(0);
  });

  it("błąd odczytu profilu przerywa zapis", async () => {
    db.setResponse(PROFILES, fail("permission denied for table profiles", "42501"));

    await expect(
      callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST }),
    ).rejects.toThrow("permission denied for table profiles");
    expect(db.chainsFor(SETTINGS)).toHaveLength(0);
  });

  it("odmowa zapisu (RLS lub CHECK) wychodzi na zewnątrz", async () => {
    // Cicha zieleń przy odrzuconym zapisie to najgorszy wynik w tym panelu:
    // admin uznaje, że limit obniżył, a baza dalej wydaje stare linki.
    db.setResponse(
      SETTINGS,
      fail('new row violates check constraint "gift_settings_monthly_limit_check"', "23514"),
    );

    await expect(
      callServerFn(updateGiftAdminSettings, { data: ustawienia(), context: KONTEKST }),
    ).rejects.toThrow("gift_settings_monthly_limit_check");
  });
});

// ---------------------------------------------------------------------------
// Statystyki
// ---------------------------------------------------------------------------
describe("statystyki prezentów", () => {
  const STATS = "get_gift_stats_admin";

  it("oddaje wiersz z funkcji bazy bez przerabiania", async () => {
    rpc.setResponse(
      STATS,
      ok({
        active_links: 4,
        revoked_links: 1,
        expired_links: 2,
        exhausted_links: 0,
        total_created: 7,
        total_redeemed: 12,
        created_this_month: 3,
        redeemed_this_month: 5,
        unique_gifters: 2,
        unique_recipients: 9,
      }),
    );

    await expect(callServerFn(getGiftAdminStats, { context: KONTEKST })).resolves.toMatchObject({
      active_links: 4,
      unique_recipients: 9,
    });
    expect(rpc.names()).toEqual([STATS]);
  });

  it("brak danych daje komplet ZER, a nie `null` na kaflach panelu", async () => {
    // Najemca bez ani jednego prezentu ma pokazać zera. `null` w tym miejscu
    // renderowałby puste kafle wyglądające jak awaria odczytu.
    rpc.setResponse(STATS, ok(null));

    await expect(callServerFn(getGiftAdminStats, { context: KONTEKST })).resolves.toEqual({
      active_links: 0,
      revoked_links: 0,
      expired_links: 0,
      exhausted_links: 0,
      total_created: 0,
      total_redeemed: 0,
      created_this_month: 0,
      redeemed_this_month: 0,
      unique_gifters: 0,
      unique_recipients: 0,
    });
  });

  it("odmowa funkcji bazy wychodzi na zewnątrz", async () => {
    rpc.setResponse(STATS, fail("permission denied for function get_gift_stats_admin", "42501"));

    await expect(callServerFn(getGiftAdminStats, { context: KONTEKST })).rejects.toThrow(
      "permission denied for function get_gift_stats_admin",
    );
  });
});

// ---------------------------------------------------------------------------
// Lista linków
// ---------------------------------------------------------------------------
describe("walidator listy linków", () => {
  it("brak wejścia daje komplet wartości domyślnych", () => {
    // Panel woła tę funkcję bez ładunku przy pierwszym wejściu - domyślne
    // muszą powstać w schemacie, a nie „gdzieś w handlerze".
    expect(waliduj(listGiftLinksAdmin, {})).toEqual({ limit: 50, offset: 0, status: "all" });
  });

  it("przyjmuje krańce zakresów stronicowania", () => {
    expect(waliduj(listGiftLinksAdmin, { limit: 1, offset: 0 })).toMatchObject({
      limit: 1,
      offset: 0,
    });
    expect(waliduj(listGiftLinksAdmin, { limit: 200 })).toMatchObject({ limit: 200 });
  });

  it("odrzuca limit poza zakresem i ujemne przesunięcie", () => {
    // Sufit 200 wierszy chroni funkcję SECURITY DEFINER przed pobraniem
    // całego dziennika linków (z adresami e-mail twórców) w jednym żądaniu.
    expect(() => waliduj(listGiftLinksAdmin, { limit: 0 })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { limit: 201 })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { offset: -1 })).toThrow();
  });

  it("odrzuca ułamki i napisy w stronicowaniu", () => {
    expect(() => waliduj(listGiftLinksAdmin, { limit: 10.5 })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { offset: "0" })).toThrow();
  });

  it.each(["all", "active", "revoked", "expired"])("przyjmuje status „%s”", (status) => {
    expect(waliduj(listGiftLinksAdmin, { status })).toMatchObject({ status });
  });

  it("odrzuca status SPOZA enuma", () => {
    // Nieznany status trafiłby do RPC jako filtr, którego funkcja nie zna -
    // w najlepszym razie pusta lista, w najgorszym filtr zignorowany i pełny
    // wykaz zamiast zawężonego.
    expect(() => waliduj(listGiftLinksAdmin, { status: "deleted" })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { status: "" })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { status: 1 })).toThrow();
  });

  it("filtr wpisu przyjmuje UUID, `null` i brak wartości", () => {
    expect(waliduj(listGiftLinksAdmin, { post_id: WPIS })).toMatchObject({ post_id: WPIS });
    expect(waliduj(listGiftLinksAdmin, { post_id: null })).toMatchObject({ post_id: null });
    expect(waliduj(listGiftLinksAdmin, {})).toEqual({ limit: 50, offset: 0, status: "all" });
  });

  it("odrzuca filtr wpisu spoza formatu UUID", () => {
    expect(() => waliduj(listGiftLinksAdmin, { post_id: "wpis-1" })).toThrow();
    expect(() => waliduj(listGiftLinksAdmin, { post_id: "" })).toThrow();
  });
});

describe("lista linków - wywołanie funkcji bazy", () => {
  const LISTA = "list_gift_links_admin";

  /** Wiersz z `list_gift_links_admin` (kształt jak w typie GiftLinkAdminRow). */
  function wierszLinku(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: LINK,
      post_id: WPIS,
      post_title: "Analiza rynku CEE",
      post_slug: "analiza-rynku-cee",
      created_by: REDAKTOR,
      creator_name: "Redaktor Testowy",
      creator_email: "redakcja@example.com",
      code: "kod-testowy",
      created_at: "2026-08-20T10:00:00.000Z",
      expires_at: "2026-09-19T10:00:00.000Z",
      revoked_at: null,
      redemption_count: 2,
      max_redemptions: 5,
      unique_recipients: 2,
      last_redeemed_at: "2026-08-21T08:00:00.000Z",
      total_count: 7,
      ...over,
    };
  }

  it("przekazuje stronicowanie i filtry pod nazwami, których oczekuje RPC", async () => {
    // Zgubiony albo przemianowany argument jest równoważny utracie zawężenia:
    // przechodzi przez `tsc` (obiekt argumentów jest luźny), przez przegląd
    // i przez interfejs, bo lista i tak coś pokazuje.
    rpc.setResponse(LISTA, ok([wierszLinku()]));

    await callServerFn(listGiftLinksAdmin, {
      data: { limit: 10, offset: 20, status: "revoked", post_id: WPIS },
      context: KONTEKST,
    });

    expect(rpc.lastCall(LISTA)?.args).toEqual({
      _limit: 10,
      _offset: 20,
      _status: "revoked",
      _post_id: WPIS,
    });
  });

  it("brak filtru wpisu przechodzi jako brak wartości, nie jako `null`", async () => {
    // `null` i „brak argumentu" to dla funkcji z DEFAULT-em dwie różne
    // rzeczy - stąd świadome `?? undefined` w handlerze.
    rpc.setResponse(LISTA, ok([]));

    await callServerFn(listGiftLinksAdmin, { data: { post_id: null }, context: KONTEKST });

    expect(rpc.lastCall(LISTA)?.arg("_post_id")).toBeUndefined();
  });

  it("domyślne stronicowanie dojeżdża do RPC, gdy panel nic nie poda", async () => {
    rpc.setResponse(LISTA, ok([]));

    await callServerFn(listGiftLinksAdmin, { data: {}, context: KONTEKST });

    expect(rpc.lastCall(LISTA)?.args).toMatchObject({
      _limit: 50,
      _offset: 0,
      _status: "all",
    });
  });

  it("łączną liczbę wierszy bierze z okna funkcji, nie z długości strony", async () => {
    // `total_count` to `count(*) OVER ()` - bez niego panel policzyłby strony
    // z rozmiaru bieżącej strony i ukrył resztę dziennika.
    rpc.setResponse(LISTA, ok([wierszLinku(), wierszLinku({ id: WPIS, total_count: 7 })]));

    await expect(
      callServerFn(listGiftLinksAdmin, { data: {}, context: KONTEKST }),
    ).resolves.toMatchObject({ total: 7 });
  });

  it("pusta strona daje pustą listę i zero", async () => {
    rpc.setResponse(LISTA, ok([]));

    await expect(
      callServerFn(listGiftLinksAdmin, { data: {}, context: KONTEKST }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("brak danych z RPC też daje pustą listę", async () => {
    rpc.setResponse(LISTA, ok(null));

    await expect(
      callServerFn(listGiftLinksAdmin, { data: {}, context: KONTEKST }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("odmowa funkcji bazy wychodzi na zewnątrz", async () => {
    rpc.setResponse(LISTA, fail("permission denied for function list_gift_links_admin", "42501"));

    await expect(callServerFn(listGiftLinksAdmin, { data: {}, context: KONTEKST })).rejects.toThrow(
      "permission denied for function list_gift_links_admin",
    );
  });
});

// ---------------------------------------------------------------------------
// Unieważnienie linku
// ---------------------------------------------------------------------------
describe("unieważnienie linku", () => {
  const REVOKE = "revoke_gift_link_admin";

  it("przyjmuje identyfikator linku i przekazuje go pod nazwą `_link_id`", async () => {
    rpc.setResponse(REVOKE, ok(true));

    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: KONTEKST }),
    ).resolves.toEqual({ ok: true });
    expect(rpc.lastCall(REVOKE)?.args).toEqual({ _link_id: LINK });
  });

  it("odrzuca identyfikator spoza formatu UUID i brak pola", () => {
    // To jest operacja NIEODWRACALNA (link przestaje otwierać treść), więc
    // wejście musi być jednoznaczne, zanim dojdzie do funkcji bazy.
    expect(() => waliduj(revokeGiftLinkAdmin, { link_id: "link-1" })).toThrow();
    expect(() => waliduj(revokeGiftLinkAdmin, { link_id: "" })).toThrow();
    expect(() => waliduj(revokeGiftLinkAdmin, {})).toThrow();
    expect(() => waliduj(revokeGiftLinkAdmin, undefined)).toThrow();
    expect(() => waliduj(revokeGiftLinkAdmin, { link_id: 1 })).toThrow();
  });

  it("obce pola są odcinane", () => {
    expect(waliduj(revokeGiftLinkAdmin, { link_id: LINK, tenant_id: "tenant-obcy" })).toEqual({
      link_id: LINK,
    });
  });

  it("odpowiedź „nie unieważniono” NIE jest raportowana jako sukces", async () => {
    // Funkcja bazy oddaje `false`, gdy link nie należy do najemcy albo już
    // był unieważniony. Zamiana tego na `ok: true` mówiłaby adminowi, że
    // dostęp odebrany - a link dalej otwierałby płatną treść.
    rpc.setResponse(REVOKE, ok(false));

    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: KONTEKST }),
    ).resolves.toEqual({ ok: false });
  });

  it("brak odpowiedzi funkcji też nie jest sukcesem", async () => {
    rpc.setResponse(REVOKE, ok(null));

    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: KONTEKST }),
    ).resolves.toEqual({ ok: false });
  });

  it("odmowa funkcji bazy wychodzi na zewnątrz", async () => {
    rpc.setResponse(REVOKE, fail("permission denied for function revoke_gift_link_admin", "42501"));

    await expect(
      callServerFn(revokeGiftLinkAdmin, { data: { link_id: LINK }, context: KONTEKST }),
    ).rejects.toThrow("permission denied for function revoke_gift_link_admin");
  });
});

// ---------------------------------------------------------------------------
// Dziennik zdarzeń
// ---------------------------------------------------------------------------
describe("walidator dziennika zdarzeń", () => {
  it("brak wejścia daje komplet wartości domyślnych", () => {
    expect(waliduj(listGiftEventsAdmin, {})).toEqual({
      limit: 100,
      offset: 0,
      event_type: "all",
    });
  });

  it("przyjmuje krańce zakresu stronicowania", () => {
    expect(waliduj(listGiftEventsAdmin, { limit: 1 })).toMatchObject({ limit: 1 });
    expect(waliduj(listGiftEventsAdmin, { limit: 500 })).toMatchObject({ limit: 500 });
  });

  it("odrzuca limit poza zakresem", () => {
    expect(() => waliduj(listGiftEventsAdmin, { limit: 0 })).toThrow();
    expect(() => waliduj(listGiftEventsAdmin, { limit: 501 })).toThrow();
    expect(() => waliduj(listGiftEventsAdmin, { offset: -1 })).toThrow();
  });

  it.each(["all", "created", "redeemed", "revoked", "expired", "exhausted"])(
    "przyjmuje typ zdarzenia „%s”",
    (event_type) => {
      expect(waliduj(listGiftEventsAdmin, { event_type })).toMatchObject({ event_type });
    },
  );

  it("odrzuca typ zdarzenia SPOZA enuma", () => {
    // Dziennik audytu ma pokazywać także zdarzenia nieznane temu buildowi
    // (dlatego `event_type` w WIERSZU jest otwartym napisem), ale FILTR jest
    // zamknięty - inaczej pytanie o nieistniejący typ cicho gasi cały wykaz.
    expect(() => waliduj(listGiftEventsAdmin, { event_type: "purged" })).toThrow();
    expect(() => waliduj(listGiftEventsAdmin, { event_type: "" })).toThrow();
  });

  it("filtr linku przyjmuje UUID i `null`, odrzuca resztę", () => {
    expect(waliduj(listGiftEventsAdmin, { link_id: LINK })).toMatchObject({ link_id: LINK });
    expect(waliduj(listGiftEventsAdmin, { link_id: null })).toMatchObject({ link_id: null });
    expect(() => waliduj(listGiftEventsAdmin, { link_id: "link-1" })).toThrow();
  });
});

describe("dziennik zdarzeń - wywołanie funkcji bazy", () => {
  const ZDARZENIA = "list_gift_events_admin";

  /** Wiersz z `list_gift_events_admin`. */
  function wierszZdarzenia(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "zdarzenie-1",
      event_type: "redeemed",
      post_id: WPIS,
      post_title: "Analiza rynku CEE",
      actor_id: REDAKTOR,
      actor_name: "Redaktor Testowy",
      actor_email: "redakcja@example.com",
      code: "kod-testowy",
      created_at: "2026-08-21T08:00:00.000Z",
      total_count: 3,
      ...over,
    };
  }

  it("przekazuje stronicowanie i filtry pod nazwami, których oczekuje RPC", async () => {
    rpc.setResponse(ZDARZENIA, ok([wierszZdarzenia()]));

    await callServerFn(listGiftEventsAdmin, {
      data: { limit: 25, offset: 50, event_type: "revoked", link_id: LINK },
      context: KONTEKST,
    });

    expect(rpc.lastCall(ZDARZENIA)?.args).toEqual({
      _limit: 25,
      _offset: 50,
      _event_type: "revoked",
      _link_id: LINK,
    });
  });

  it("brak filtru linku przechodzi jako brak wartości", async () => {
    rpc.setResponse(ZDARZENIA, ok([]));

    await callServerFn(listGiftEventsAdmin, { data: { link_id: null }, context: KONTEKST });

    expect(rpc.lastCall(ZDARZENIA)?.arg("_link_id")).toBeUndefined();
  });

  it("oddaje wiersze i łączną liczbę z okna funkcji", async () => {
    rpc.setResponse(ZDARZENIA, ok([wierszZdarzenia(), wierszZdarzenia({ id: "zdarzenie-2" })]));

    const wynik = await callServerFn<{ rows: unknown[]; total: number }>(listGiftEventsAdmin, {
      data: {},
      context: KONTEKST,
    });

    expect(wynik.rows).toHaveLength(2);
    expect(wynik.total).toBe(3);
  });

  it("pusty dziennik daje pustą listę i zero", async () => {
    rpc.setResponse(ZDARZENIA, ok(null));

    await expect(
      callServerFn(listGiftEventsAdmin, { data: {}, context: KONTEKST }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("odmowa funkcji bazy wychodzi na zewnątrz", async () => {
    rpc.setResponse(
      ZDARZENIA,
      fail("permission denied for function list_gift_events_admin", "42501"),
    );

    await expect(
      callServerFn(listGiftEventsAdmin, { data: {}, context: KONTEKST }),
    ).rejects.toThrow("permission denied for function list_gift_events_admin");
  });
});
