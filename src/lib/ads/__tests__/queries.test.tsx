// Publiczne zapytanie o aktywne reklamy - warstwa, która decyduje, KTÓRA
// kreacja zobaczy czytelnika i czy wygasła emisja jest naprawdę wygasła.
//
// Plik stał na 0% linii i 0/6 funkcji. Komentarz w produkcji mówi wprost, PO CO
// okno emisji jest filtrowane także tutaj, a nie tylko w RLS: staff przechodzi
// przez politykę „manage", więc bez tego filtra redakcja widziałaby na froncie
// emisje wygasłe i jeszcze nierozpoczęte - i uznałaby, że kampania leci.
//
// CO TEN PLIK DOWODZI.
//   1. OKNO EMISJI JEST FILTROWANE PO OBU STRONACH. Dwa ogniwa `.or(...)`
//      dopuszczają wiersz, gdy granica jest `NULL` (emisja bezterminowa) ALBO
//      gdy „teraz" mieści się w oknie. Test czyta OBA ogniwa i sprawdza znak
//      porównania: `lte` dla `starts_at`, `gte` dla `ends_at`. Odwrócenie tych
//      dwóch znaków przechodzi przez `tsc` i przez recenzję, a znaczy „emituj
//      dokładnie te kampanie, które się skończyły".
//   2. SLOT MUSI BYĆ AKTYWNY, I TO PRZEZ `!inner`. `.eq("slot.status","active")`
//      działa WYŁĄCZNIE dlatego, że `select` deklaruje `ad_slots!inner`. Zamiana
//      na zwykłe zagnieżdżenie zamieniłaby warunek w cichy no-op i wstrzymany
//      slot wróciłby na stronę. Dlatego test asertuje NAPIS `select`, nie tylko
//      obecność filtra.
//   3. FILTR `page_id` DZIAŁA PO STRONIE KLIENTA i używa LUŹNEJ RÓWNOŚCI
//      (`p.page_id == null`). To nie jest literówka: dzięki niej placement,
//      któremu PostgREST nie oddał kolumny (`undefined`), liczy się jako
//      „bez ograniczenia strony", a nie jako „ograniczony do strony
//      `undefined`" - czyli nie znika. Test pokrywa wszystkie trzy przypadki:
//      `null`, brak klucza i konkretny identyfikator.
//   4. BŁĄD ODCZYTU JEST GŁOŚNY (`throw`), a odfiltrowanie w `select` - CICHE.
//      To jest sedno hipotezy defektu tego pliku i test pokazuje różnicę
//      wprost: przy błędzie zapytanie jest w stanie `error`, przy pełnym
//      odfiltrowaniu jest w stanie `success` z pustą listą. Regres w
//      `parseAdTargeting` (albo redakcyjna literówka w `targeting`) gasi więc
//      WSZYSTKIE reklamy w sposób nieodróżnialny od „nie ma kreacji" - i to
//      jest udokumentowane osobnym testem, nie `it.fails`, bo produkcja
//      zachowuje się tu zgodnie z projektem; problemem jest brak sygnału.
//   5. KLUCZ ZAPYTANIA NIE ZAWIERA JĘZYKA ANI KONTEKSTU TREŚCI - fetch jest
//      WSPÓŁDZIELONY, a targeting działa per obserwator w `select`. Test
//      dowodzi tego przez licznik łańcuchów: dwa różne języki na tym samym
//      kluczu = JEDEN odczyt bazy, dwa różne wyniki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `parseAdTargeting`, `matchesAdTargeting`
// i `hasContentTargeting` mają własny plik (`targeting.test.ts`). Tutaj
// przedmiotem dowodu jest WPIĘCIE tych funkcji w zapytanie i kształt samego
// zapytania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let language = "pl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => language);
});

const db = await vi.hoisted(async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  return { stub: supabaseFromStub() };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.stub.from(table) },
}));

import { ok, fail } from "@/test/supabase";
import { useAdPlacements, type AdContentContext } from "@/lib/ads/queries";
import type { AdPlacementWithSlot } from "@/lib/ads/types";

const TABLE = "ad_placements";

/** Placement z zagnieżdżonym slotem - kształt, jaki oddaje PostgREST. */
function placement(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1",
    tenant_id: "t1",
    slot_id: "s1",
    position: "sidebar",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    slot: {
      id: "s1",
      tenant_id: "t1",
      name: "Baner boczny",
      kind: "html",
      status: "active",
      html: "<b>reklama</b>",
      script: null,
      image_url: null,
      image_link: null,
      image_alt: null,
      width: null,
      height: null,
      requires_consent: true,
      targeting: {},
      notes: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    ...over,
  };
}

/** Placement, którego slot celuje w podane slugi/języki. */
function targeted(targeting: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const base = placement(over);
  return { ...base, slot: { ...(base.slot as object), targeting } };
}

function render(
  args: {
    position?: string;
    pageType?: string;
    pageId?: string | null;
    content?: AdContentContext;
  } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useAdPlacements(
        (args.position ?? "sidebar") as never,
        (args.pageType ?? "post") as never,
        args.pageId,
        args.content,
      ),
    { wrapper },
  );
  return { ...hook, queryClient };
}

/** Czeka na rozstrzygnięcie zapytania (sukces albo błąd). */
async function settled(result: { current: { isPending: boolean } }) {
  await waitFor(() => expect(result.current.isPending).toBe(false));
}

beforeEach(() => {
  db.stub.reset();
  language = "pl";
});

describe("fetchPlacements: kształt zapytania", () => {
  it("czyta `ad_placements` ze złączeniem `ad_slots!inner`", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);

    const chain = db.stub.lastChain(TABLE);
    // `!inner` jest warunkiem działania filtra `slot.status` - bez niego
    // wstrzymany slot wróciłby na stronę bez żadnego błędu.
    expect(chain?.argsOf("select")?.[0]).toBe("*, slot:ad_slots!inner(*)");
  });

  it("filtruje pozycję, typ strony, aktywność placementu I status slotu", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render({ position: "mid_post", pageType: "category" });
    await settled(result);

    const chain = db.stub.lastChain(TABLE);
    const eqs = (chain?.calls ?? []).filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["position", "mid_post"],
      ["active", true],
      ["slot.status", "active"],
    ]);
    // `all` MUSI być w zbiorze - placement globalny obowiązuje na każdym typie.
    expect(chain?.argsOf("in")).toEqual(["page_type", ["all", "category"]]);
  });

  it("sortuje po `sort_order` - kolejność kreacji jest redakcyjna, nie losowa", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);
    expect(db.stub.lastChain(TABLE)?.argsOf("order")).toEqual(["sort_order"]);
  });
});

describe("okno emisji: oba ogniwa `.or` z właściwym znakiem porównania", () => {
  it("`starts_at` dopuszcza NULL albo wartość NIE PÓŹNIEJSZĄ niż teraz (`lte`)", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);

    const ors = (db.stub.lastChain(TABLE)?.calls ?? [])
      .filter((c) => c.method === "or")
      .map((c) => String(c.args[0]));
    const startsOr = ors.find((s) => s.includes("starts_at"));
    expect(startsOr).toBeDefined();
    expect(startsOr).toContain("starts_at.is.null");
    // Odwrócenie na `gte` znaczyłoby „emituj tylko to, co się jeszcze nie
    // zaczęło" - czyli nic.
    expect(startsOr).toMatch(/starts_at\.lte\.\d{4}-\d{2}-\d{2}T/);
  });

  it("`ends_at` dopuszcza NULL albo wartość NIE WCZEŚNIEJSZĄ niż teraz (`gte`)", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);

    const ors = (db.stub.lastChain(TABLE)?.calls ?? [])
      .filter((c) => c.method === "or")
      .map((c) => String(c.args[0]));
    const endsOr = ors.find((s) => s.includes("ends_at"));
    expect(endsOr).toContain("ends_at.is.null");
    // Odwrócenie na `lte` znaczyłoby „emituj dokładnie te kampanie, które się
    // SKOŃCZYŁY" - i nikt by tego nie zgłosił, bo reklamy nadal by leciały.
    expect(endsOr).toMatch(/ends_at\.gte\.\d{4}-\d{2}-\d{2}T/);
  });

  it("oba ogniwa `.or` są obecne - jedno nie zastępuje drugiego", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);
    const ors = (db.stub.lastChain(TABLE)?.calls ?? []).filter((c) => c.method === "or");
    expect(ors).toHaveLength(2);
  });

  it("obie granice używają TEGO SAMEGO znacznika czasu", async () => {
    // Dwa różne `new Date()` dałyby okno niespójne o milisekundy - nieszkodliwe,
    // ale test przypina intencję: jeden `nowIso` na zapytanie.
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result } = render();
    await settled(result);

    const stamps = (db.stub.lastChain(TABLE)?.calls ?? [])
      .filter((c) => c.method === "or")
      .map((c) => String(c.args[0]).split(/\.(?:lte|gte)\./)[1]);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(stamps[1]);
  });
});

describe("filtr `page_id` po stronie klienta", () => {
  it("placement z `page_id: null` przechodzi na KAŻDEJ stronie", async () => {
    db.stub.setResponse(TABLE, ok([placement({ id: "globalny", page_id: null })]));
    const { result } = render({ pageId: "post-42" });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["globalny"]);
  });

  it("placement BEZ klucza `page_id` też przechodzi - luźna równość obejmuje `undefined`", async () => {
    // Gdyby filtr używał `===`, placement, któremu PostgREST nie oddał
    // kolumny, ZNIKNĄŁBY z emisji. `==` jest tu świadomym wyborem.
    const row = placement({ id: "bezkolumny" });
    delete (row as Record<string, unknown>).page_id;
    db.stub.setResponse(TABLE, ok([row]));
    const { result } = render({ pageId: "post-42" });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["bezkolumny"]);
  });

  it("placement przypięty do TEJ strony przechodzi", async () => {
    db.stub.setResponse(TABLE, ok([placement({ id: "przypiety", page_id: "post-42" })]));
    const { result } = render({ pageId: "post-42" });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["przypiety"]);
  });

  it("placement przypięty do INNEJ strony jest odfiltrowany", async () => {
    db.stub.setResponse(TABLE, ok([placement({ id: "obcy", page_id: "post-99" })]));
    const { result } = render({ pageId: "post-42" });
    await settled(result);
    expect(result.current.data).toEqual([]);
  });

  it("brak `pageId` w kontekście odcina placementy przypięte do stron", async () => {
    db.stub.setResponse(
      TABLE,
      ok([
        placement({ id: "globalny", page_id: null }),
        placement({ id: "przypiety", page_id: "x" }),
      ]),
    );
    const { result } = render({ pageId: undefined });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["globalny"]);
  });

  it("`data: null` z bazy daje pustą listę, nie wyjątek", async () => {
    db.stub.setResponse(TABLE, ok(null));
    const { result } = render();
    await settled(result);
    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });
});

describe("targeting w `select`: język czytelnika", () => {
  it("slot celujący w `en` NIE wychodzi czytelnikowi `pl`", async () => {
    db.stub.setResponse(TABLE, ok([targeted({ languages: ["en"] }, { id: "tylko-en" })]));
    language = "pl";
    const { result } = render();
    await settled(result);
    expect(result.current.data).toEqual([]);
  });

  it("ten sam slot WYCHODZI czytelnikowi `en`", async () => {
    db.stub.setResponse(TABLE, ok([targeted({ languages: ["en"] }, { id: "tylko-en" })]));
    language = "en";
    const { result } = render();
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["tylko-en"]);
  });

  it("nieznany język interfejsu liczy się jako `pl`", async () => {
    // `i18n.language === "en" ? "en" : "pl"` - każdy inny kod (np. `de`,
    // `en-GB`) wpada w `pl`. Test przypina to wprost, bo od tego zależy, czy
    // kampania anglojęzyczna pokaże się na wersji, której nie kupiono.
    db.stub.setResponse(TABLE, ok([targeted({ languages: ["pl"] }, { id: "tylko-pl" })]));
    language = "de";
    const { result } = render();
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["tylko-pl"]);
  });

  it("`en-GB` NIE jest traktowane jak `en` - dopasowanie jest dokładne", async () => {
    db.stub.setResponse(TABLE, ok([targeted({ languages: ["en"] }, { id: "tylko-en" })]));
    language = "en-GB";
    const { result } = render();
    await settled(result);
    expect(result.current.data).toEqual([]);
  });
});

describe("targeting w `select`: kategorie i tagi", () => {
  it("trafienie w kategorię wpuszcza kreację", async () => {
    db.stub.setResponse(TABLE, ok([targeted({ categorySlugs: ["energia"] }, { id: "e" })]));
    const { result } = render({ content: { categorySlugs: ["energia"], tagSlugs: [] } });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["e"]);
  });

  it("trafienie w TAG wystarcza, choć kategoria nie pasuje (semantyka OR)", async () => {
    db.stub.setResponse(
      TABLE,
      ok([targeted({ categorySlugs: ["energia"], tagSlugs: ["ue"] }, { id: "or" })]),
    );
    const { result } = render({ content: { categorySlugs: ["kultura"], tagSlugs: ["ue"] } });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["or"]);
  });

  it("brak kontekstu treści odcina kreacje z targetingiem treściowym", async () => {
    // Strona bez kategorii/tagów (np. wyszukiwarka) nie ma czym dopasować, więc
    // kreacja kupiona „na energetykę" nie ma prawa się tam pokazać.
    db.stub.setResponse(TABLE, ok([targeted({ categorySlugs: ["energia"] }, { id: "e" })]));
    const { result } = render({ content: undefined });
    await settled(result);
    expect(result.current.data).toEqual([]);
  });

  it("slot bez targetingu przechodzi wszędzie", async () => {
    db.stub.setResponse(TABLE, ok([targeted({}, { id: "wszedzie" })]));
    const { result } = render({ content: undefined });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["wszedzie"]);
  });

  it("uszkodzony `targeting` (napis zamiast obiektu) NIE gasi kreacji", async () => {
    // `parseAdTargeting` degraduje śmieci do pustego targetingu, czyli „brak
    // ograniczeń". To jest wybór bezpieczny dla reklamodawcy: kreacja leci.
    db.stub.setResponse(TABLE, ok([targeted("popsute" as never, { id: "smieci" })]));
    const { result } = render({ content: undefined });
    await settled(result);
    expect((result.current.data ?? []).map((p) => p.id)).toEqual(["smieci"]);
  });
});

describe("błąd odczytu jest GŁOŚNY, odfiltrowanie jest CICHE", () => {
  it("błąd z bazy przechodzi jako `throw` - zapytanie jest w stanie błędu", async () => {
    db.stub.setResponse(TABLE, fail("permission denied for table ad_placements", "42501"));
    const { result } = render();
    await settled(result);

    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("PEŁNE odfiltrowanie przez targeting daje SUKCES z pustą listą", async () => {
    // Ta para testów jest sednem hipotezy defektu: te dwa scenariusze
    // („baza odmówiła" i „wszystkie kreacje odpadły na targetingu") są dla
    // konsumenta hooka rozróżnialne WYŁĄCZNIE przez `isError`. Konsumenci
    // (MidPostAds, FooterSlideup, AdSlotById) renderują pustkę w obu
    // przypadkach, więc redakcja nie ma sygnału, że kampania nie leci.
    db.stub.setResponse(
      TABLE,
      ok([
        targeted({ languages: ["en"] }, { id: "a" }),
        targeted({ categorySlugs: ["nieistniejaca"] }, { id: "b" }),
      ]),
    );
    language = "pl";
    const { result } = render({ content: { categorySlugs: ["energia"], tagSlugs: [] } });
    await settled(result);

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("BRAK kreacji w bazie daje DOKŁADNIE ten sam stan, co pełne odfiltrowanie", async () => {
    // Dowód nieodróżnialności: ten sam `isSuccess` i to samo `data`.
    db.stub.setResponse(TABLE, ok([]));
    const { result } = render();
    await settled(result);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it("odczyt WIDZI wiersze, które `select` potem wyrzuca - różnica żyje w cache", async () => {
    // Rozróżnienie ISTNIEJE w danych zapytania, tylko nie w jego publicznej
    // powierzchni: surowa odpowiedź ma wiersze, `data` po `select` jest pusta.
    // Kto chciałby zbudować alarm „kampania kupiona, ale nikt jej nie widzi",
    // ma z czego - i to jest treść zgłoszenia do człowieka.
    db.stub.setResponse(TABLE, ok([targeted({ languages: ["en"] }, { id: "a" })]));
    language = "pl";
    const { result, queryClient } = render();
    await settled(result);

    const raw = queryClient.getQueryData(["ad_placements", "sidebar", "post", null]) as
      AdPlacementWithSlot[] | undefined;
    expect(raw).toHaveLength(1);
    expect(result.current.data).toEqual([]);
  });
});

describe("klucz zapytania: fetch współdzielony między obserwatorami", () => {
  it("klucz NIE zawiera języka ani kontekstu treści", async () => {
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result, queryClient } = render({
      position: "mid_post",
      pageType: "post",
      pageId: "post-1",
      content: { categorySlugs: ["energia"], tagSlugs: ["ue"] },
    });
    await settled(result);

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual([["ad_placements", "mid_post", "post", "post-1"]]);
  });

  it("brak `pageId` normalizuje się w kluczu do `null`, nie `undefined`", async () => {
    // `undefined` w kluczu react-query jest niedozwolone przy serializacji -
    // stąd `pageId ?? null`.
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result, queryClient } = render({ pageId: undefined });
    await settled(result);
    expect(queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual([
      "ad_placements",
      "sidebar",
      "post",
      null,
    ]);
  });

  it("dwa języki na tym samym kluczu = JEDEN odczyt bazy, dwa różne wyniki", async () => {
    db.stub.setResponse(
      TABLE,
      ok([
        targeted({ languages: ["pl"] }, { id: "pl" }),
        targeted({ languages: ["en"] }, { id: "en" }),
      ]),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    language = "pl";
    const first = renderHook(() => useAdPlacements("sidebar", "post", null), { wrapper });
    await waitFor(() => expect(first.result.current.isPending).toBe(false));
    expect((first.result.current.data ?? []).map((p) => p.id)).toEqual(["pl"]);

    language = "en";
    const second = renderHook(() => useAdPlacements("sidebar", "post", null), { wrapper });
    await waitFor(() => expect(second.result.current.isPending).toBe(false));
    expect((second.result.current.data ?? []).map((p) => p.id)).toEqual(["en"]);

    // Sedno: drugi obserwator NIE poszedł do bazy.
    expect(db.stub.chainsFor(TABLE)).toHaveLength(1);
  });

  it("nie odświeża się przy powrocie do okna", async () => {
    // Reklama nie ma prawa przeładować się przy każdym `focus` - to kosztuje
    // impresję i migocze czytelnikowi w oczach.
    db.stub.setResponse(TABLE, ok([placement()]));
    const { result, queryClient } = render();
    await settled(result);

    const options = queryClient.getQueryCache().getAll()[0]?.options as {
      refetchOnWindowFocus?: boolean;
      staleTime?: number;
    };
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.staleTime).toBe(60_000);
  });
});
