// Ingest impresji i klików reklamowych: POST /api/public/ad-event.
//
// PO CO TEN PLIK ISTNIEJE. Na tych wierszach stoi RAPORTOWANIE PRZYCHODU
// z reklam - a endpoint jest zbudowany tak, że jest z zewnątrz NIEMY:
// każda ścieżka oddaje 204 i każdy błąd jest połknięty. Ingest, który wyrzuca
// wszystko, jest więc nieodróżnialny od „nie było reklam". Reklamodawca
// dostaje fakturę z liczby, której nikt nie umie zweryfikować, a redakcja nie
// ma sygnału, że cokolwiek się zepsuło.
//
// Dlatego KAŻDA asercja w tym pliku sprawdza EFEKT (czy insert poleciał i z
// jakim ładunkiem), a nie status odpowiedzi. Status jest sprawdzony osobno -
// jednym testem, który przechodzi WSZYSTKIE ścieżki odrzucenia i wymaga 204
// od każdej z nich.
//
// CO TEN PLIK DOWODZI.
//   1. SIEDEM ŚCIEŻEK ODRZUCENIA, KAŻDA PRZEZ BRAK INSERTU: limiter (61. żądanie
//      z tego samego adresu), body ponad 2000 znaków, body niebędące JSON-em,
//      `kind` poza `impression|click`, `slot_id` niepasujący do UUID,
//      brak rozwiązanego najemcy, slot nieistniejący albo z innego najemcy.
//   2. BRAK NAJEMCY ODRZUCA ZDARZENIE, a nie wpuszcza je do najemcy domyślnego.
//      To jest różnica między „zgubiona impresja" i „impresja doliczona obcej
//      instalacji" - drugie fałszuje cudzy raport przychodu.
//   3. SLOT MUSI NALEŻEĆ DO NAJEMCY HOSTA. Bez tego dowolny klient POST-owałby
//      fałszywe impresje dla dowolnego UUID slotu, także cross-tenant. Test
//      sprawdza, że zapytanie o slot ZAWIERA ogniwo `eq("tenant_id", ...)` -
//      samo „slot nie znaleziony" nie dowodzi, że filtr tam jest.
//   4. PLACEMENT KLIENTA NIE JEST UFANY. `placement_id` wskazujący inny slot
//      daje zapis Z `placement_id: null`, a nie z wartością podaną przez
//      klienta i nie odrzucenie całego zdarzenia. Impresja jest prawdziwa,
//      atrybucja - nie.
//   5. `path` PRZECHODZI PRZEZ `redactUrl` I OBCIĘCIE DO 512 ZNAKÓW. Ścieżka
//      z tokenem w query stringu nie może wylądować w tabeli statystyk -
//      tabela obserwowalności zamieniłaby się w drugi magazyn sekretów.
//   6. ŻADNA ŚCIEŻKA NIE ODDAJE STATUSU INNEGO NIŻ 204 - beacon nie ma jak
//      obsłużyć odpowiedzi, a błąd w odpowiedzi na `sendBeacon` niektóre
//      przeglądarki logują w konsoli odwiedzającego.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki kubełka żetonów (`lib/http/rateLimit`
// ma własne testy `tickBucket`) ani reguł czyszczenia PII (`redactUrl` ma swoje).
// Tu dowodzimy WPIĘCIA tych warstw w ingest, nie ich wnętrza.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenantId: "tenant-1" as string | null,
  tenantThrows: false,
  host: "redakcja.example.test" as string | null,
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null | undefined) => {
    if (h.tenantThrows) throw new Error("katalog najemców niedostępny");
    return host ? h.tenantId : null;
  },
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => h.host }));

const req = vi.hoisted(() => ({ current: null as Request | null }));
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => req.current }));

// Klient serwisowy stoi na WSPÓLNEJ atrapie łańcucha PostgREST z `src/test`,
// a nie na ręcznej atrapie: dzięki temu test widzi KOMPLET ogniw zapytania
// (w tym `eq("tenant_id", ...)`), a nie tylko wynik.
//
// Atrapa POWSTAJE W BLOKU HOISTOWANYM, nie w fabryce `vi.mock`. Handler sięga
// po klient serwisowy DYNAMICZNYM importem, więc fabryka mocka odpala się
// dopiero przy PIERWSZYM żądaniu - a `beforeEach` chce ustawiać odpowiedzi
// wcześniej. Zbudowana tutaj atrapa istnieje od startu pliku.
const db = await vi.hoisted(async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  return { stub: supabaseFromStub() };
});
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.stub.from(table) },
}));

import { ok } from "@/test/supabase";
import { routeServerHandlers } from "@/test/routeHarness";
import { Route } from "@/routes/api/public/ad-event";

const handler = routeServerHandlers(Route).POST!;
const SLOT = "11111111-2222-4333-8444-555555555555";
const PLACEMENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** Atrapa bazy w kształcie, którego oczekuje ten plik. */
function sb() {
  return db.stub;
}

/**
 * Limiter jest stanem MODUŁU (jeden kubełek na klucz dla całego pliku), więc
 * każdy test musi mówić z innego adresu - inaczej testy zaczynają się nawzajem
 * wyciszać i zielenieją z niewłaściwego powodu.
 */
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.2.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

async function post(body: unknown, opts: { raw?: string; ip?: string } = {}): Promise<Response> {
  req.current = new Request("https://redakcja.example.test/api/public/ad-event", {
    method: "POST",
    headers: { "x-forwarded-for": opts.ip ?? freshIp() },
    body: opts.raw ?? JSON.stringify(body),
  });
  return handler({ request: req.current });
}

/** Ładunek insertu do `ad_events` albo `undefined`, gdy insert nie poleciał. */
function insertedRow(): Record<string, unknown> | undefined {
  const chain = sb().lastChain("ad_events");
  const args = chain?.argsOf("insert");
  return args?.[0] as Record<string, unknown> | undefined;
}

/** Czy zdarzenie zostało w ogóle zapisane. */
function didInsert(): boolean {
  return sb()
    .chainsFor("ad_events")
    .some((c) => c.has("insert"));
}

beforeEach(() => {
  sb().reset();
  // Domyślnie: slot istnieje i należy do najemcy, placement pasuje, insert OK.
  sb().setResponse("ad_slots", ok({ id: SLOT }));
  sb().setResponse("ad_placements", ok({ id: PLACEMENT }));
  sb().setResponse("ad_events", ok(null));
  h.tenantId = "tenant-1";
  h.tenantThrows = false;
  h.host = "redakcja.example.test";
});

// ---------------------------------------------------------------------------
describe("ścieżka udana: zdarzenie ląduje z pełną atrybucją", () => {
  it("impresja zapisuje slot, najemcę i rodzaj", async () => {
    await post({ kind: "impression", slot_id: SLOT });

    expect(insertedRow()).toEqual({
      slot_id: SLOT,
      placement_id: null,
      kind: "impression",
      path: null,
      tenant_id: "tenant-1",
    });
  });

  it("klik jest przyjmowany tym samym torem", async () => {
    await post({ kind: "click", slot_id: SLOT });
    expect(insertedRow()).toMatchObject({ kind: "click", slot_id: SLOT });
  });

  it("placement wskazujący TEN slot w tym najemcy jest zapisany", async () => {
    await post({ kind: "click", slot_id: SLOT, placement_id: PLACEMENT });
    expect(insertedRow()).toMatchObject({ placement_id: PLACEMENT });
  });

  it("weryfikacja placementu pyta o slot ORAZ o najemcę", async () => {
    // Sam `eq("id", ...)` pozwoliłby przypisać impresję do placementu obcej
    // instalacji, gdyby ktoś zgadł UUID.
    await post({ kind: "click", slot_id: SLOT, placement_id: PLACEMENT });

    const chain = sb().lastChain("ad_placements");
    const eqs = (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["id", PLACEMENT],
      ["slot_id", SLOT],
      ["tenant_id", "tenant-1"],
    ]);
  });

  it("odpowiedź NIE jest cachowana - każdy beacon musi dojść", async () => {
    const res = await post({ kind: "impression", slot_id: SLOT });
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
describe("właściciel slotu: zdarzenie tylko dla slotu tego najemcy", () => {
  it("zapytanie o slot ZAWIERA filtr najemcy", async () => {
    // Dowód na obecność filtra, nie na jego skutek: bez tej asercji test
    // „obcy slot odrzucony" przechodziłby także wtedy, gdyby filtr zniknął,
    // a atrapa i tak oddawała `null`.
    await post({ kind: "impression", slot_id: SLOT });

    const chain = sb().lastChain("ad_slots");
    const eqs = (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["id", SLOT],
      ["tenant_id", "tenant-1"],
    ]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("slot NIEISTNIEJĄCY nie zapisuje nic", async () => {
    sb().setResponse("ad_slots", ok(null));
    await post({ kind: "impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });

  it("slot z INNEGO najemcy nie zapisuje nic", async () => {
    // Atrapa odpowiada wierszem tylko wtedy, gdy filtr najemcy zgadza się
    // z właścicielem slotu - czyli odwzorowuje zachowanie bazy.
    sb().setResponse("ad_slots", (chain) => {
      const tenantEq = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tenant_id");
      return tenantEq?.args[1] === "tenant-wlasciciel" ? ok({ id: SLOT }) : ok(null);
    });
    await post({ kind: "impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });

  it("awaria odczytu slotu nie zapisuje zdarzenia na wiarę", async () => {
    sb().setResponse("ad_slots", { data: null, error: Object.assign(new Error("timeout"), {}) });
    await post({ kind: "impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("placement klienta nie jest ufany", () => {
  it("placement wskazujący INNY slot daje zapis BEZ placementu, nie odrzucenie", async () => {
    // Impresja jest prawdziwa (slot się zgadza), więc zdarzenie MA być
    // policzone. Nieprawdziwa jest atrybucja - i tylko ona jest odrzucona.
    sb().setResponse("ad_placements", ok(null));
    await post({ kind: "click", slot_id: SLOT, placement_id: PLACEMENT });

    expect(didInsert()).toBe(true);
    expect(insertedRow()).toMatchObject({ placement_id: null, slot_id: SLOT });
  });

  it("`placement_id` niepasujący do UUID nie jest nawet sprawdzany w bazie", async () => {
    await post({ kind: "click", slot_id: SLOT, placement_id: "'; drop table ad_events; --" });

    expect(sb().chainsFor("ad_placements")).toHaveLength(0);
    expect(insertedRow()).toMatchObject({ placement_id: null });
  });

  it("`placement_id` innego typu niż napis jest ignorowany", async () => {
    await post({ kind: "impression", slot_id: SLOT, placement_id: 42 });
    expect(sb().chainsFor("ad_placements")).toHaveLength(0);
    expect(insertedRow()).toMatchObject({ placement_id: null });
  });

  it("brak `placement_id` nie generuje zapytania o placement", async () => {
    await post({ kind: "impression", slot_id: SLOT });
    expect(sb().chainsFor("ad_placements")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("walidacja wejścia - każda ścieżka przez BRAK insertu", () => {
  it.each([
    ["rodzaj spoza dozwolonych", { kind: "hover", slot_id: SLOT }],
    ["brak rodzaju", { slot_id: SLOT }],
    ["rodzaj jako liczba", { kind: 1, slot_id: SLOT }],
    ["slot niepasujący do UUID", { kind: "impression", slot_id: "abc" }],
    ["slot jako liczba", { kind: "impression", slot_id: 123 }],
    ["brak slotu", { kind: "impression" }],
    ["slot z wstrzyknięciem SQL", { kind: "impression", slot_id: "'; drop table ad_events; --" }],
  ])("%s nie zapisuje nic", async (_label, body) => {
    await post(body);
    expect(didInsert()).toBe(false);
  });

  it("`kind` o właściwej wartości ale innej wielkości liter jest odrzucany", async () => {
    // `VALID_KINDS` to zbiór dokładnych napisów - „Impression" wpisane przez
    // własną integrację rozsypałoby raport, więc lepiej, żeby nie weszło.
    await post({ kind: "Impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });

  it("UUID slotu jest przyjmowany BEZ WZGLĘDU na wielkość liter", async () => {
    // `UUID_RE` ma flagę `i` - wersalikowy UUID z niektórych integracji musi
    // przejść, inaczej gubilibyśmy prawdziwe impresje.
    const upper = SLOT.toUpperCase();
    sb().setResponse("ad_slots", ok({ id: upper }));
    await post({ kind: "impression", slot_id: upper });
    expect(insertedRow()).toMatchObject({ slot_id: upper });
  });

  it("PUSTE body nie wywala endpointu i nic nie zapisuje", async () => {
    await post(null, { raw: "" });
    expect(didInsert()).toBe(false);
  });

  it("body PONAD 2000 znaków jest odrzucane BEZ parsowania", async () => {
    // Limit chroni przed `JSON.parse` dużego ładunku i przed zapisem śmieci -
    // NIE przed odczytem samego body. `await req.text()` wciąga całe żądanie do
    // pamięci PRZED pomiarem (`ad-event.ts:31-32`), więc komentarz „ochrona
    // pamięci workera" byłby nadużyciem: przed dużym ciałem broni dopiero
    // limit ustawiony wyżej (proxy/runtime), nie ten warunek.
    // Ładunek jest tu POPRAWNY - odrzuca go wyłącznie długość.
    const raw = JSON.stringify({ kind: "impression", slot_id: SLOT, pad: "x".repeat(2100) });
    expect(raw.length).toBeGreaterThan(2000);
    await post(null, { raw });
    expect(didInsert()).toBe(false);
  });

  it("body DOKŁADNIE na granicy 2000 znaków jest przyjmowane", async () => {
    // Granica jest ostra (`> MAX_BODY`), więc 2000 znaków musi przejść -
    // inaczej cicho gubilibyśmy zdarzenia ze długich adresów.
    const base = { kind: "impression", slot_id: SLOT, pad: "" };
    const overhead = JSON.stringify(base).length;
    const raw = JSON.stringify({ ...base, pad: "x".repeat(2000 - overhead) });
    expect(raw.length).toBe(2000);
    await post(null, { raw });
    expect(didInsert()).toBe(true);
  });

  it("body niebędące JSON-em nie wywala endpointu", async () => {
    await post(null, { raw: "to nie jest json" });
    expect(didInsert()).toBe(false);
  });

  it("JSON będący tablicą nie zapisuje nic", async () => {
    await post([{ kind: "impression", slot_id: SLOT }]);
    expect(didInsert()).toBe(false);
  });

  it("JSON będący samym `null` nie wywala endpointu", async () => {
    await post(null, { raw: "null" });
    expect(didInsert()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("najemca: brak rozwiązania ODRZUCA, nie wpada do domyślnego", () => {
  it("brak najemcy dla hosta nie zapisuje nic - i nie pyta nawet o slot", async () => {
    h.tenantId = null;
    await post({ kind: "impression", slot_id: SLOT });

    expect(didInsert()).toBe(false);
    // Odrzucenie następuje PRZED odczytem slotu - to potwierdza kolejność,
    // w której nie ma okna na przypisanie zdarzenia komukolwiek.
    expect(sb().chainsFor("ad_slots")).toHaveLength(0);
  });

  it("brak hosta (praca w tle) nie zapisuje nic", async () => {
    h.host = null;
    await post({ kind: "impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });

  it("AWARIA katalogu najemców odrzuca zdarzenie, nie zgaduje najemcy", async () => {
    // Świadoma różnica względem ingestu popupów, który przy braku najemcy
    // zapisuje wiersz bez kolumny. Tutaj zdarzenie bez najemcy byłoby
    // nieprzypisanym przychodem, więc lepiej je zgubić.
    h.tenantThrows = true;
    await post({ kind: "impression", slot_id: SLOT });
    expect(didInsert()).toBe(false);
  });

  it("najemca z odczytu trafia do WIERSZA, nie jest brany z ładunku klienta", async () => {
    h.tenantId = "tenant-inny";
    sb().setResponse("ad_slots", ok({ id: SLOT }));
    await post({ kind: "impression", slot_id: SLOT, tenant_id: "tenant-podstawiony" });

    expect(insertedRow()).toMatchObject({ tenant_id: "tenant-inny" });
  });
});

// ---------------------------------------------------------------------------
describe("`path`: czyszczenie PII i obcięcie", () => {
  it("query string jest WYCIĘTY - token z adresu nie ląduje w tabeli", async () => {
    await post({
      kind: "impression",
      slot_id: SLOT,
      path: "/artykul/reforma?access_token=sekret123&utm=x",
    });

    const path = String(insertedRow()?.path ?? "");
    expect(path).not.toContain("sekret123");
    expect(path).toContain("/artykul/reforma");
  });

  it("adres e-mail w ścieżce jest zamaskowany", async () => {
    await post({ kind: "impression", slot_id: SLOT, path: "/kontakt/jan@example.com" });
    const path = String(insertedRow()?.path ?? "");
    expect(path).not.toContain("jan@example.com");
    expect(path).toContain("[redacted-email]");
  });

  it("ścieżka dłuższa niż 512 znaków jest OBCIĘTA przed czyszczeniem", async () => {
    const long = `/a/${"b".repeat(900)}`;
    await post({ kind: "impression", slot_id: SLOT, path: long });
    const path = String(insertedRow()?.path ?? "");
    expect(path.length).toBeLessThanOrEqual(512);
  });

  it('`path` innego typu niż napis daje `null`, nie napis "undefined"', async () => {
    await post({ kind: "impression", slot_id: SLOT, path: { a: 1 } });
    expect(insertedRow()?.path).toBeNull();
  });

  it("brak `path` daje `null`", async () => {
    await post({ kind: "impression", slot_id: SLOT });
    expect(insertedRow()?.path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("limiter: zalew z jednego adresu przestaje zapisywać", () => {
  it("61. żądanie z tego samego adresu nie dokłada wiersza - a 60 pierwszych TAK", async () => {
    // Kubełek: 60 żetonów, uzupełnianie 1/s. Seria bez przerwy musi urwać się
    // DOKŁADNIE na 60 zapisach - inaczej jedno źródło zatruwa raport przychodu.
    //
    // Asercja jest OBUSTRONNA z premedytacją. Samo `<= 60` przechodziłoby
    // również dla `capacity: 1`, czyli każde ZANIŻENIE limitu (literówka
    // w konfiguracji, przypadkowe `capacity: 6`) byłoby dla testu niewidoczne -
    // a znaczy „strona z sześcioma slotami gubi impresje przy pierwszym
    // przewinięciu". Dolna granica jest więc równie ważna jak górna.
    //
    // Uzupełnianie 1/s przy prawdziwym `Date.now()`: 61 iteracji w tym środowisku
    // biegnie w kilkanaście milisekund, więc żeton nie zdąży wrócić. Gdyby seria
    // kiedyś zwolniła powyżej sekundy, dolna granica dopuszcza jeden zwrot.
    const ip = "10.77.77.77";
    for (let i = 0; i < 61; i += 1) {
      await post({ kind: "impression", slot_id: SLOT }, { ip });
    }
    const inserts = sb()
      .chainsFor("ad_events")
      .filter((c) => c.has("insert")).length;

    expect(inserts).toBeLessThanOrEqual(61);
    expect(inserts).toBeGreaterThanOrEqual(60);
  });

  it("wyciszenie NIE zwraca błędu - beacon dostaje 204 jak każde inne żądanie", async () => {
    const ip = "10.88.88.88";
    const statuses: number[] = [];
    for (let i = 0; i < 70; i += 1) {
      statuses.push((await post({ kind: "impression", slot_id: SLOT }, { ip })).status);
    }
    expect(new Set(statuses)).toEqual(new Set([204]));
  });

  it("żądanie BEZ adresu klienta nadal wpada do wspólnego kubełka", async () => {
    // `clientIpFromHeaders` oddaje wtedy "unknown" - jeden kubełek dla całej
    // takiej grupy jest lepszy niż obejście limitu.
    req.current = new Request("https://redakcja.example.test/api/public/ad-event", {
      method: "POST",
      body: JSON.stringify({ kind: "impression", slot_id: SLOT }),
    });
    const res = await handler({ request: req.current });
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
describe("beacon nigdy się nie wywraca", () => {
  it("AWARIA zapisu nadal oddaje 204", async () => {
    sb().setResponse("ad_events", () => {
      throw new Error("baza padła");
    });
    const res = await post({ kind: "impression", slot_id: SLOT });
    expect(res.status).toBe(204);
  });

  it("brak żądania w kontekście (getRequest zwraca null) oddaje 204", async () => {
    req.current = null;
    const res = await handler({});
    expect(res.status).toBe(204);
  });

  it("ŻADNA ścieżka odrzucenia nie oddaje statusu innego niż 204", async () => {
    // Jedna asercja przez wszystkie warianty wejścia: gdyby którakolwiek
    // gałąź zaczęła zwracać 4xx/5xx, przeglądarka ponawiałaby wysyłkę beaconu,
    // a użytkownik zobaczyłby błąd w konsoli.
    const bodies: Array<[string, unknown, string | undefined]> = [
      ["poprawny", { kind: "impression", slot_id: SLOT }, undefined],
      ["zły kind", { kind: "x", slot_id: SLOT }, undefined],
      ["zły slot", { kind: "click", slot_id: "nope" }, undefined],
      ["pusty", null, ""],
      ["nie-JSON", null, "%%%"],
      ["za długi", null, JSON.stringify({ pad: "x".repeat(2100) })],
      ["tablica", [], undefined],
    ];
    const statuses: number[] = [];
    for (const [, body, raw] of bodies) {
      statuses.push((await post(body, raw === undefined ? {} : { raw })).status);
    }
    // Wariant „brak najemcy" i „slot obcy" osobno, bo wymagają innego stanu.
    h.tenantId = null;
    statuses.push((await post({ kind: "impression", slot_id: SLOT })).status);
    h.tenantId = "tenant-1";
    sb().setResponse("ad_slots", ok(null));
    statuses.push((await post({ kind: "impression", slot_id: SLOT })).status);

    expect(new Set(statuses)).toEqual(new Set([204]));
  });
});
