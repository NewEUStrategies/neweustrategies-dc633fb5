// Warstwa zapytan PUBLICZNYCH wydarzenia: co dostaje czytelnik, gdy baza
// ODMOWI, gdy odpowie PUSTO i gdy odpowie tylko w jednym jezyku.
//
// PO CO TEN PLIK ISTNIEJE OBOK `publicEventApi.test.ts`. Tamten pilnuje ksztaltu
// ladunku jadacego do bazy, czyli sciezki szczesliwej. Tutaj chodzi o cztery
// klasy bledow, ktore na tej powierzchni koncza sie CICHYM oszustwem wobec
// anonimowego czytelnika - bo kazda z nich wyglada jak poprawnie narysowana
// strona:
//
// 1) ODMOWA BAZY ZAMIENIONA NA PUSTO. Kazda funkcja czytajaca konczy sie
//    `parse*(data)`, a wszystkie te parsery oddaja PUSTA LISTE na `null`.
//    Zgubiony `if (error) throw error` nie rusza ani jednego typu i nie wywala
//    kompilacji - daje strone wydarzenia bez agendy, bez partnerow i bez
//    sekcji, nieodrozninalna od wydarzenia, ktorego jeszcze nie wypelniono.
//    Czytelnik nie ma wtedy czego ponowic, a organizator nie ma czego zglosic.
// 2) ODMOWA PRZY DZIALANIU UCZESTNIKA UDAJACA WYKONANE DZIALANIE. Zapis na
//    sesje, zakladka i wlasna widocznosc czytaja `record(data)`, ktore na
//    smieciach oddaje pusty obiekt - czyli "cancelled", "nie zapisano",
//    "niewidoczny". To sa trzy zdania, ktore uczestnik zobaczy jako WYNIK
//    swojego kliku, a nie jako blad.
// 3) KOLUMNA JEZYKOWA ZGUBIONA W PARSERZE. Etykiety jada z bazy parami
//    `_pl`/`_en`, a kaskade wyboru robi dopiero widok przez `pickLocalized`
//    (`EventTabsNav.tsx` - wlasna nazwa, druga kolumna, nazwa modulu,
//    sciezka). Parser, ktory skleilby pusta kolumne z druga albo wpisal w nia
//    napis zastepczy, zabralby tej kaskadzie material.
// 4) LIMIT I PRZESUNIECIE POD ZLA NAZWA. Zaciski (1..100) siedza w SQL-u
//    (`20260826182500_event_attendees_and_discussions.sql`,
//    `20260823170000_event_front_binding.sql`), wiec klient odpowiada
//    WYLACZNIE za nazwy argumentow. Literowka w `p_limit` nie daje bledu, bo
//    funkcja ma DEFAULT - daje strone 24 zamiast setnej.
//
// ZAWEZENIE NAJEMCA nie jest tu asertowane, bo nie przechodzi przez klienta:
// wszystkie te funkcje ustalaja najemce przez `public_tenant_id()` (naglowek
// hosta) po stronie bazy. Pilnuje tego bramka `check:sql-tenant-scope`.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseRpcStub } from "@/test/supabase/rpc";
import { eventSectionHeading, findEventSection } from "@/lib/events/eventSections";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const publicApi = await import("@/lib/events/publicEventApi");

const SLUG = "kongres-2026";
const SESSION = "ses-8f21";

/** Slownik zastapiony tozsamoscia - tresc napisu nalezy do i18n, nie tutaj. */
const dict = (key: string) => key;

function isBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ladunek ostatniego wywolania RPC.
 *
 * Straznik typu zamiast rzutowania: brak wywolania albo ladunek, ktory nie jest
 * obiektem, ma sie zglosic ZDANIEM z nazwa funkcji, a nie wywrocic pozniej na
 * `in` z niczym po prawej stronie.
 */
function payloadOf(fn: string): Record<string, unknown> {
  const value = h.rpc?.lastCall(fn)?.arg("p_payload");
  if (!isBag(value)) {
    throw new Error(`test: RPC "${fn}" nie dostalo obiektu w argumencie "p_payload"`);
  }
  return value;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

interface RpcCase {
  /** Co zobaczy czlowiek, jesli odmowa zniknie po drodze. */
  readonly what: string;
  readonly fn: string;
  readonly run: () => Promise<unknown>;
}

describe("odmowa bazy nie zamienia sie w pusta strone", () => {
  it("kazde czytanie tresci wydarzenia oddaje wyjatek, a nie brak tresci", async () => {
    const cases: RpcCase[] = [
      {
        what: "sekcje strony",
        fn: "event_sections",
        run: () => publicApi.fetchEventSections(SLUG),
      },
      { what: "menu podstron", fn: "event_menu", run: () => publicApi.fetchEventMenu(SLUG) },
      { what: "program", fn: "event_agenda", run: () => publicApi.fetchEventAgenda(SLUG) },
      {
        what: "partnerzy",
        fn: "event_sponsors_public",
        run: () => publicApi.fetchEventSponsors(SLUG),
      },
      {
        what: "materialy partnerow",
        fn: "event_sponsor_materials_public",
        run: () => publicApi.fetchEventSponsorMaterials(SLUG),
      },
      {
        what: "dyskusje",
        fn: "event_discussions",
        run: () => publicApi.fetchEventDiscussions(SLUG),
      },
      {
        what: "lista uczestnikow",
        fn: "event_attendees",
        run: () => publicApi.fetchEventAttendees({ slug: SLUG, limit: 24, offset: 0 }),
      },
      {
        what: "dostep do transmisji",
        fn: "event_session_access",
        run: () => publicApi.fetchSessionAccess(SESSION),
      },
      {
        what: "moje zakladki",
        fn: "event_bookmarks_mine",
        run: () => publicApi.fetchMyBookmarks({ scope: "upcoming", limit: 24, offset: 0 }),
      },
    ];

    for (const testCase of cases) {
      h.rpc = supabaseRpcStub();
      // Odmowa z bazy niesie KLUCZ (`publicEventErrors` zamienia go w zdanie
      // z nastepnym krokiem), wiec tresc komunikatu tez musi dojechac w calosci.
      h.rpc.setError(testCase.fn, "permission_denied: brak grantu dla roli anon", "42501");
      await expect(testCase.run(), testCase.what).rejects.toThrow(/permission_denied/);
    }
  });

  it("odmowa przy dzialaniu uczestnika nie udaje wykonanego dzialania", async () => {
    const cases: RpcCase[] = [
      {
        what: "zapis na sesje",
        fn: "event_session_signup",
        run: () => publicApi.submitSessionSignup({ sessionId: SESSION, status: "registered" }),
      },
      {
        what: "zakladka",
        fn: "event_bookmark_toggle",
        run: () => publicApi.toggleEventBookmark({ eventSlug: SLUG }),
      },
      {
        what: "wlasna widocznosc na liscie",
        fn: "event_meeting_directory_visibility_set",
        run: () => publicApi.setEventAttendeeVisibility({ slug: SLUG, listed: true }),
      },
    ];

    for (const testCase of cases) {
      h.rpc = supabaseRpcStub();
      h.rpc.setError(testCase.fn, "auth_required: zaloguj sie");
      // Bez wyjatku uczestnik zobaczylby wynik parsera pustego obiektu:
      // "rezygnacja", "bez zakladki", "niewidoczny" - czyli stan, ktorego
      // nie wybral i ktorego baza nie zapisala.
      await expect(testCase.run(), testCase.what).rejects.toThrow(/auth_required/);
    }
  });
});

describe("pusta odpowiedz bazy", () => {
  it("`null` z RPC to pusta lista, a nie wyjatek w renderze", async () => {
    h.rpc?.setData("event_sections", null);
    h.rpc?.setData("event_menu", null);
    h.rpc?.setData("event_agenda", null);
    h.rpc?.setData("event_sponsors_public", null);
    h.rpc?.setData("event_sponsor_materials_public", null);

    expect(await publicApi.fetchEventSections(SLUG)).toEqual([]);
    expect(await publicApi.fetchEventMenu(SLUG)).toEqual([]);
    expect(await publicApi.fetchEventAgenda(SLUG)).toEqual([]);
    expect(await publicApi.fetchEventSponsors(SLUG)).toEqual([]);
    expect(await publicApi.fetchEventSponsorMaterials(SLUG)).toEqual([]);
  });

  it("brak zakladek to zero w liczniku, a nie licznik z poprzedniej strony", async () => {
    h.rpc?.setData("event_bookmarks_mine", null);
    const page = await publicApi.fetchMyBookmarks({ scope: "past", limit: 24, offset: 48 });
    expect(page.rows).toEqual([]);
    expect(page.totalCount).toBe(0);
  });

  it("nieczytelna odpowiedz o dostepie do sesji ZAMYKA transmisje, a nie otwiera", async () => {
    // `reason` jest tym, co widz czyta na ekranie zamiast odtwarzacza. Domyslne
    // "not_found" mowi prawde: nie wiemy o tej sesji nic, wiec nie ma czego grac.
    h.rpc?.setData("event_session_access", null);
    const access = await publicApi.fetchSessionAccess(SESSION);
    expect(access.canWatch).toBe(false);
    expect(access.canStream).toBe(false);
    expect(access.streamUrl).toBeNull();
    expect(access.recordingUrl).toBeNull();
    expect(access.reason).toBe("not_found");
  });
});

function menuRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "poz-1",
    page_id: "str-1",
    label_pl: "Agenda",
    label_en: "Agenda",
    icon: "calendar-days",
    color: "#2563eb",
    path: `${SLUG}/agenda`,
    sort_order: 10,
    module: "agenda",
    ...over,
  };
}

describe("menu podstron", () => {
  it("pozycja bez sciezki wypada - zakladka bez adresu nie jest zakladka", async () => {
    h.rpc?.setData("event_menu", [
      menuRow(),
      menuRow({ id: "poz-2", path: null }),
      menuRow({ id: "poz-3", path: "   " }),
    ]);
    const items = await publicApi.fetchEventMenu(SLUG);
    expect(items.map((item) => item.id)).toEqual(["poz-1"]);
  });

  it("wiodacy ukosnik z bazy znika, bo doklada go dopiero trasa", async () => {
    // Front sklada adres jako `/events/` + `path`. Sciezka z ukosnikiem dalaby
    // `//kongres-2026/agenda`, czyli adres do innego hosta wedlug przegladarki.
    h.rpc?.setData("event_menu", [menuRow({ path: `///${SLUG}/agenda` })]);
    const items = await publicApi.fetchEventMenu(SLUG);
    expect(items[0]?.path).toBe(`${SLUG}/agenda`);
  });

  it("kolejnosc zakladek jest kontraktem widoku: numer, potem nazwa polska", async () => {
    // Baza sortuje, ale widok nie ma prawa zalezec od porzadku z sieci - inaczej
    // ta sama strona ma inna kolejnosc zakladek po odswiezeniu.
    h.rpc?.setData("event_menu", [
      menuRow({ id: "poz-z", label_pl: "Zaproszeni", sort_order: 20 }),
      menuRow({ id: "poz-a", label_pl: "Agenda", sort_order: 20 }),
      menuRow({ id: "poz-brak", label_pl: "Bez numeru", sort_order: null }),
    ]);
    const items = await publicApi.fetchEventMenu(SLUG);
    expect(items.map((item) => item.id)).toEqual(["poz-brak", "poz-a", "poz-z"]);
    expect(items[0]?.sortOrder).toBe(0);
  });

  it("pusta kolumna jezykowa NIE pozycza tresci z drugiej - kaskade robi widok", async () => {
    h.rpc?.setData("event_menu", [
      menuRow({ label_pl: "   ", label_en: "Partners", module: null, path: `${SLUG}/partnerzy` }),
    ]);
    const [item] = await publicApi.fetchEventMenu(SLUG);
    // Warstwa zapytan oddaje OBIE kolumny takimi, jakie sa. Sklejenie ich tutaj
    // (pusta polska = angielska) zabraloby widokowi mozliwosc odrozninienia
    // "redakcja nie przetlumaczyla" od "redakcja nazwala tak samo".
    expect(item?.labelPl).toBe("");
    expect(item?.labelEn).toBe("Partners");
    // I dowod, ze kaskada widoku (`EventTabsNav.tsx` - `tabLabel`) ma z czego
    // wybierac: polski czytelnik dostaje nazwe angielska, a nie pusta zakladke.
    const label = pickLocalized(
      { label_pl: item?.labelPl ?? "", label_en: item?.labelEn ?? "" },
      "label",
      "pl",
      item?.path ?? "",
    );
    expect(label).toBe("Partners");
  });

  it("obie kolumny puste spadaja do sciezki, nie do pustego napisu", async () => {
    h.rpc?.setData("event_menu", [
      menuRow({ label_pl: "", label_en: null, module: null, path: `${SLUG}/o-nas` }),
    ]);
    const [item] = await publicApi.fetchEventMenu(SLUG);
    expect(
      pickLocalized(
        { label_pl: item?.labelPl ?? "", label_en: item?.labelEn ?? "" },
        "label",
        "en",
        item?.path ?? "",
      ),
    ).toBe(`${SLUG}/o-nas`);
  });

  it("znacznik modulu przezywa przejazd, a zwykla podstrona go NIE dostaje", async () => {
    // Po tym polu front wybiera trase: pozycja modulowa ma wlasny ekran
    // z danymi z bazy, zwykla idzie do trasy splat pod dokument CMS. Zgadywanie
    // po sluggu zalezaloby od napisu, ktory redakcja moze zmienic.
    h.rpc?.setData("event_menu", [
      menuRow({ id: "poz-mod", module: "participants" }),
      menuRow({ id: "poz-zwykla", module: "   ", sort_order: 20 }),
    ]);
    const items = await publicApi.fetchEventMenu(SLUG);
    expect(items.find((item) => item.id === "poz-mod")?.module).toBe("participants");
    expect(items.find((item) => item.id === "poz-zwykla")?.module).toBeNull();
  });

  it.fails("defekt: pozycja o sciezce `/` przezywa jako zakladka bez adresu", async () => {
    // CO JEST ZLE. `parseEventMenu` odsiewa pozycje PRZED obcieciem ukosnikow:
    // `text("/")` jest napisem niepustym, wiec wiersz przechodzi bramke, a
    // dopiero `path.replace(/^\/+/, "")` zostawia z niego pusty napis. Komentarz
    // przy tej samej funkcji mowi wprost: "Pozycja bez sciezki wypada: odnosnik
    // do `/` nie jest podstrona wydarzenia" - i to jest regula, ktorej kod nie
    // realizuje.
    //
    // DLACZEGO TO BOLI. Taka pozycja rysuje sie jako zakladka prowadzaca do
    // korzenia serwisu, a jej etykieta ma ostatni stopien kaskady rowny
    // `item.path`, czyli pustemu napisowi (`EventTabsNav.tsx` - `tabLabel`).
    // Redakcja dostaje w pasku zakladke BEZ NAPISU, wyprowadzajaca czytelnika
    // ze strony wydarzenia.
    //
    // NIE NAPRAWIAM TEGO TUTAJ - przeniesienie bramki za `replace` jest zmiana
    // zachowania produkcyjnego.
    h.rpc?.setData("event_menu", [
      menuRow({ id: "poz-korzen", path: "/", label_pl: "", label_en: "" }),
    ]);
    const items = await publicApi.fetchEventMenu(SLUG);
    expect(items).toEqual([]);
  });
});

function sectionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    section_key: "agenda",
    sort_order: 30,
    heading_pl: null,
    heading_en: null,
    visibility: "public",
    min_tier_rank: 0,
    is_locked: false,
    lock_reason: "none",
    has_content: true,
    ...over,
  };
}

describe("sekcje strony", () => {
  it("nadpisanie z samych bialych znakow jest BRAKIEM nadpisania", async () => {
    // Kaskada jezykowa naglowka (`eventSectionHeading` -> `pickLocalized`) ma
    // trzy stopnie: jezyk czytelnika, druga kolumna, slownik. Gdyby warstwa
    // zapytan przepuszczala napis ze spacji jako "nadpisanie", pierwszy stopien
    // wygrywalby PUSTYM naglowkiem i sekcja zostawalaby bez tytulu.
    h.rpc?.setData("event_sections", [
      sectionRow({ heading_pl: "   ", heading_en: "Programme" }),
      sectionRow({ section_key: "sponsors", sort_order: 40 }),
    ]);
    const sections = await publicApi.fetchEventSections(SLUG);
    const agenda = findEventSection(sections, "agenda");

    expect(agenda?.headingPl).toBeNull();
    expect(agenda?.headingEn).toBe("Programme");
    expect(eventSectionHeading(agenda, "agenda", "pl", dict)).toBe("Programme");
    // Sekcja bez zadnego nadpisania schodzi do slownika, a nie do pustego <h2>.
    expect(
      eventSectionHeading(findEventSection(sections, "sponsors"), "sponsors", "pl", dict),
    ).toBe("eventFront.sections.sponsors.heading");
  });

  it("zamek zostaje na stronie z powodem - sekcja zamknieta nie znika", async () => {
    // "Zamknieta" i "pusta" to dwa rozne ekrany. Zgubienie powodu zamiast
    // zamiany na `registration_required` dawaloby sekcje bez zaproszenia do
    // zapisu, czyli tresc, o ktorej czytelnik nie wie, ze istnieje.
    h.rpc?.setData("event_sections", [
      sectionRow({ section_key: "materials", is_locked: true, lock_reason: "kosmos" }),
    ]);
    const [section] = await publicApi.fetchEventSections(SLUG);
    expect(section?.isLocked).toBe(true);
    expect(section?.lockReason).toBe("registration_required");
  });
});

describe("zapis na sesje i dostep do transmisji", () => {
  it("brak limitu miejsc zostaje nullem, a nie zerem wolnych miejsc", async () => {
    // `0` znaczy "sala pelna, idziesz na rezerwe", `null` znaczy "limitu nie ma".
    // Zamiana jednego na drugie zamyka zapisy na sesje, ktora ich nie ogranicza.
    h.rpc?.setData("event_session_signup", { status: "registered", promoted: true });
    const result = await publicApi.submitSessionSignup({
      sessionId: SESSION,
      status: "registered",
    });
    expect(result.seatsLeft).toBeNull();
    expect(result.registered).toBe(0);
    // Promocja z rezerwy to OSOBNE zdanie dla uczestnika ("zwolnilo sie
    // miejsce"), wiec musi dojechac z bazy, a nie byc zgadywana po statusie.
    expect(result.promoted).toBe(true);
  });

  it("adres transmisji wraca wylacznie wtedy, gdy przyszedl z bazy", async () => {
    h.rpc?.setData("event_session_access", {
      can_stream: true,
      can_watch: true,
      reason: "granted",
      stream_url: "https://stream.example.org/ses-8f21",
      recording_url: "   ",
      chatham_house: true,
    });
    const access = await publicApi.fetchSessionAccess(SESSION);
    expect(access.streamUrl).toBe("https://stream.example.org/ses-8f21");
    // Pusty adres nagrania to BRAK nagrania - przycisk "odtworz" prowadzacy
    // donikad jest gorszy niz brak przycisku.
    expect(access.recordingUrl).toBeNull();
    expect(access.chathamHouse).toBe(true);
  });
});

describe("zakladki", () => {
  it("wprost ustawione `false` JEDZIE do bazy - inaczej odznaczenie by przelaczalo", async () => {
    // Dwa widoki tej samej strony (lista i strona wydarzenia) moga sie rozjechac.
    // Wtedy front NIE przelacza, tylko ustawia stan wprost - a `false` jest
    // wartoscia falszywa i wypada z ladunku przy najprostszej pomylce (`if
    // (input.state)`), zamieniajac ustawienie w przelaczenie.
    h.rpc?.setData("event_bookmark_toggle", {
      event_id: "wyd-1",
      bookmarked: false,
      bookmarked_at: null,
    });
    const result = await publicApi.toggleEventBookmark({ eventId: "wyd-1", state: false });
    expect(h.rpc?.lastCall("event_bookmark_toggle")?.arg("p_payload")).toEqual({
      event_id: "wyd-1",
      state: false,
    });
    expect(result.bookmarked).toBe(false);
    expect(result.bookmarkedAt).toBeNull();
  });

  it("zakres, limit i przesuniecie jada pod nazwami z sygnatury funkcji", async () => {
    // Zacisk 1..100 robi SQL (`event_bookmarks_mine`), wiec klient odpowiada
    // wylacznie za NAZWY. Literowka w `p_offset` nie daje bledu, bo argument ma
    // DEFAULT - daje pierwsza strone w miejscu trzeciej, w nieskonczonosc.
    h.rpc?.setData("event_bookmarks_mine", []);
    await publicApi.fetchMyBookmarks({ scope: "past", limit: 48, offset: 96 });
    const call = h.rpc?.lastCall("event_bookmarks_mine");
    expect(call?.arg("p_scope")).toBe("past");
    expect(call?.arg("p_limit")).toBe(48);
    expect(call?.arg("p_offset")).toBe(96);
  });

  it("licznik calosci bez okna analitycznego spada do dlugosci strony", async () => {
    // Starszy backend nie oddaje `total_count`. Bez tego fallbacku paginacja
    // dostalaby `null` i zniknelaby razem z druga strona zakladek.
    h.rpc?.setData("event_bookmarks_mine", [{ event_id: "wyd-1" }, { event_id: "wyd-2" }]);
    const page = await publicApi.fetchMyBookmarks({ scope: "all", limit: 24, offset: 0 });
    expect(page.totalCount).toBe(2);
  });
});

describe("etykiety grup i watkow - material dla kaskady jezykowej", () => {
  it("grupa bez identyfikatora wypada z plakietek i z licznikow", async () => {
    // Plakietka grupy jest FILTREM listy - klikniecie wysyla `group_id`. Grupa
    // bez identyfikatora dawalaby przycisk, ktory po nacisnieciu pyta baze
    // o grupe "undefined" i oddaje pusta liste uczestnikow.
    h.rpc?.setData("event_attendees", {
      total_count: 2,
      rows: [
        {
          registration_id: "zgl-1",
          name: "Anna Kowalska",
          groups: [
            { id: "gru-1", name_pl: "Prelegenci", name_en: "Speakers" },
            { name_pl: "Bez id" },
          ],
        },
      ],
      groups: [
        { id: "gru-1", name_pl: "Prelegenci", name_en: "Speakers", count: 2 },
        { name_pl: "Bez id", count: 99 },
      ],
    });
    const directory = await publicApi.fetchEventAttendees({ slug: SLUG, limit: 24, offset: 0 });
    expect(directory.rows[0]?.groups.map((tag) => tag.id)).toEqual(["gru-1"]);
    expect(directory.groups.map((group) => group.id)).toEqual(["gru-1"]);
    expect(directory.groups[0]?.count).toBe(2);
  });

  it("grupa nazwana w jednym jezyku zostawia druga kolumne PUSTA, nie skopiowana", async () => {
    // Ta sama regula, co przy menu: kaskade robi widok przez `pickLocalized`,
    // a warstwa zapytan ma jej dostarczyc obie kolumny takimi, jakie sa. Brak
    // licznika czytamy jako zero, bo plakietka bez liczby wyglada jak awaria.
    h.rpc?.setData("event_attendees", {
      groups: [{ id: "gru-2", name_en: "Partners" }],
    });
    const directory = await publicApi.fetchEventAttendees({ slug: SLUG, limit: 24, offset: 0 });
    expect(directory.groups[0]?.namePl).toBe("");
    expect(directory.groups[0]?.nameEn).toBe("Partners");
    expect(directory.groups[0]?.count).toBe(0);
    expect(
      pickLocalized(
        { name_pl: directory.groups[0]?.namePl ?? "", name_en: directory.groups[0]?.nameEn ?? "" },
        "name",
        "pl",
      ),
    ).toBe("Partners");
  });

  it("watek bez rodzaju i stanu dostaje wartosci domyslne, a nie puste plakietki", async () => {
    // `kind` i `status` rysuja sie jako plakietki przy tytule watku. Pusta
    // plakietka wyglada jak blad renderowania, a nie jak brak danych - dlatego
    // domyslne "discussion" i "open" sa czescia kontraktu, nie ozdoba.
    h.rpc?.setData("event_discussions", {
      state: "ok",
      club: { id: "klub-1", slug: "klub-energii" },
      group: { id: "gru-3" },
      total_count: 1,
      threads: [{ id: "wat-1", slug: "czy-europa-ma-plan", title: "Czy Europa ma plan" }],
    });
    const discussions = await publicApi.fetchEventDiscussions(SLUG);
    expect(discussions.threads[0]?.kind).toBe("discussion");
    expect(discussions.threads[0]?.status).toBe("open");
    expect(discussions.threads[0]?.replyCount).toBe(0);
    expect(discussions.threads[0]?.participantCount).toBe(0);
    // Klub i grupa bez nazw zostaja z pustymi kolumnami - obiema, bo o tym,
    // co pokazac, decyduje kaskada jezykowa u wolajacego.
    expect(discussions.club?.namePl).toBe("");
    expect(discussions.club?.nameEn).toBe("");
    // Grupa bez stanu jest "active": zamkniecie dyskusji musi przyjsc z bazy
    // wprost, a nie wynikac z braku pola.
    expect(discussions.group?.status).toBe("active");
    expect(discussions.group?.slug).toBe("");
  });
});

describe("lista uczestnikow - zaciski i filtry", () => {
  it("limit i przesuniecie jada wprost pod nazwami z sygnatury", async () => {
    // Zacisk 1..100 siedzi w SQL-u (migracja 20260826182500), wiec klient NIE
    // przycina - ma tylko nie zgubic nazw. Wlasny zacisk po tej stronie byloby
    // drugim zrodlem prawdy o wielkosci strony.
    h.rpc?.setData("event_attendees", { rows: [], total_count: 0 });
    await publicApi.fetchEventAttendees({ slug: SLUG, limit: 1000, offset: 250 });
    expect(h.rpc?.lastCall("event_attendees")?.arg("p_payload")).toEqual({
      event_slug: SLUG,
      limit: 1000,
      offset: 250,
    });
  });

  it("jawny brak grupy NIE jedzie jako filtr", async () => {
    // `group_id: null` w plpgsql znaczy co innego niz brak klucza - filtr po
    // "grupie nieistniejacej" oddalby pusta liste uczestnikow zamiast pelnej.
    h.rpc?.setData("event_attendees", { rows: [] });
    await publicApi.fetchEventAttendees({
      slug: SLUG,
      groupId: null,
      q: undefined,
      limit: 24,
      offset: 0,
    });
    const payload = payloadOf("event_attendees");
    expect("group_id" in payload).toBe(false);
    expect("q" in payload).toBe(false);
    // A slug i strona jada nadal - "bez filtra" ma znaczyc pelna liste tego
    // wydarzenia, a nie zapytanie bez zakresu.
    expect(payload.event_slug).toBe(SLUG);
    expect(payload.limit).toBe(24);
  });
});
