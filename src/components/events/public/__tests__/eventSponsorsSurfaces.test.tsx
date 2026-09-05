// PARTNERZY na publicznej stronie wydarzenia: sekcja „Partnerzy”, pas
// logotypów na stronie głównej i sam logotyp.
//
// TO JEST POWIERZCHNIA, KTÓRĄ WIDZI UCZESTNIK I ROBOT WYSZUKIWARKI, a do dziś
// żaden z trzech stanów tych komponentów (pustka, dane, awaria) nie był
// wykonany ani razu. Sześć rzeczy, których złamanie widać na produkcji:
//
// 1. WYDARZENIE BEZ PARTNERÓW NIE RYSUJE NAGŁÓWKA POZIOMU. Poziom, z którego
//    baza zdjęła ostatnie przypięcie, wraca w odpowiedzi jako pusty wiersz -
//    gdyby front rysował go mimo to, na stronie zostałby samotny „Złoty
//    Partner” bez ani jednego logotypu, czyli zaproszenie do pytania
//    „kto zrezygnował”.
// 2. RANGA POZIOMU RZĄDZI KOLEJNOŚCIĄ I ROZMIAREM. To jest treść umowy
//    sponsorskiej, a nie układ: „złoty” stoi wyżej niż „brązowy” i ma szerszy
//    kafel, a grupa bez poziomu idzie na koniec.
// 3. LOGOTYP, KTÓRY SIĘ NIE WCZYTA, ZAMIENIA SIĘ W NAZWĘ FIRMY. `alt` jest
//    pusty celowo, więc bez tej degradacji czytnik ekranu przeczytałby nazwę
//    pliku (albo nic), a widzący zobaczyłby pusty kwadrat na miejscu partnera,
//    który za to miejsce zapłacił.
// 4. ODNOŚNIK DO PARTNERA NIE ODDAJE MU ANI UCHWYTU DO OKNA, ANI RANKINGU -
//    adresy pochodzą od partnerów, więc `rel` jest wymogiem, nie ostrożnością.
// 5. AWARIA ZAPYTANIA TO ZDANIE, A NIE SUROWY KOMUNIKAT BAZY - i nie wolno jej
//    pomylić z „ten kongres nie ma partnerów”.
// 6. ZAMKNIĘTA SEKCJA NIE PYTA BAZY. `enabled={false}` ma zatrzymać zapytanie,
//    a nie tylko schować wynik.
//
// ATRAPA STOI NA GRANICY, NIE POD KOMPONENTEM: podmieniony jest wyłącznie
// klient Supabase, więc parser `sponsorsSurface`, hook `usePublicEventSponsors`
// i wszystkie trzy komponenty jadą kodem produkcyjnym. Wzorzec atrap i nazw
// przejęty z `eventDiscussionsList.test.tsx` (ten sam katalog), a atrapa RPC
// z `src/lib/events/__tests__/publicEventApi.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { supabaseRpcStub } from "@/test/supabase/rpc";

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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Tożsamość widza nie wchodzi do klucza partnerów (migawka jest ta sama dla
// wszystkich), ale `usePublicEvent` wciąga `useAuth` - atrapa trzyma test
// z dala od dostawcy sesji.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

const { EventSponsorsSection } =
  await import("@/components/events/public/organisms/EventSponsorsSection");
const { EventSponsorTiers, EventSponsorTiersView } =
  await import("@/components/events/public/organisms/EventSponsorTiers");
const { SponsorLogo } = await import("@/components/events/public/atoms/SponsorLogo");

/** Wiersz przyjeżdża z bazy luźnym `jsonb`, więc fikstura jest wierszem sieci. */
type Wire = Record<string, unknown>;

const LOGO_URL = "https://cdn.example.org/nordwind.svg";

function sponsorWire(over: Wire = {}): Wire {
  return {
    id: "sp-nordwind",
    name: "Nordwind Analytics",
    logo: LOGO_URL,
    url: null,
    description_pl: null,
    description_en: null,
    country: "PL",
    role: "sponsor",
    booth_label: null,
    sort_order: 0,
    ...over,
  };
}

function tierWire(over: Wire = {}): Wire {
  return {
    tier_id: "tier-gold",
    tier_key: "gold",
    tier_name_pl: "Złoty Partner",
    tier_name_en: "Gold Partner",
    tier_description_pl: null,
    tier_description_en: null,
    tier_rank: 30,
    tier_accent_color: null,
    tier_logo_size: "lg",
    benefits: [],
    sponsors: [sponsorWire()],
    ...over,
  };
}

function withClient(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Najmniejsza szerokość kafla w `rem` - liczba, nie napis klasy. */
function minTileRem(list: Element): number {
  const match = /minmax\(([0-9.]+)rem/.exec(list.getAttribute("style") ?? "");
  return match === null ? Number.NaN : Number(match[1]);
}

/** Wysokość bazowa logotypu w krokach skali - liczba, nie napis klasy. */
function baseHeight(node: Element | null): number {
  const match = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(node?.getAttribute("class") ?? "");
  return match === null ? Number.NaN : Number(match[1]);
}

/**
 * Ile razy czytnik ekranu przeczyta tę nazwę. Węzły pod `aria-hidden` się nie
 * liczą - to jest cała różnica między „logotyp jest ozdobą" a „nazwa leci dwa
 * razy pod rząd".
 */
function readAloudCount(root: HTMLElement, name: string): number {
  return within(root)
    .getAllByText(name)
    .filter((node) => node.closest("[aria-hidden='true']") === null).length;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("EventSponsorsSection - sekcja „Partnerzy”", () => {
  it("pyta DOKŁADNIE o partnerów tego slugu (zawężenie najemcą siedzi w SQL)", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    // Najemca NIE jest argumentem: `event_sponsors_public` ustala go z nagłówka
    // hosta przez `public_tenant_id()`, a pilnuje tego bramka
    // `check:sql-tenant-scope`. Front ma podać slug i nic poza nim.
    expect(h.rpc?.names()).toEqual(["event_sponsors_public"]);
    expect(h.rpc?.lastCall("event_sponsors_public")?.arg("p_slug")).toBe("kongres-strategii");
    expect(h.rpc?.lastCall("event_sponsors_public")?.keys()).toEqual(["p_slug"]);
  });

  it("poziom, z którego zdjęto ostatnie przypięcie, NIE zostawia pustego nagłówka", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire({ sponsors: [] })]);
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);

    expect(await screen.findByText("eventFront.sections.sponsors.empty")).toBeInTheDocument();
    // Sam „Złoty Partner” nad pustką jest gorszy niż brak sekcji - czytelnik
    // widzi wtedy dziurę po partnerze, a nie wydarzenie bez partnerów.
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByText("Złoty Partner")).not.toBeInTheDocument();
  });

  it("zanim odpowiedź przyjdzie, sekcja mówi że wczytuje - a nie że jest pusta", () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    expect(screen.getByLabelText("eventFront.sponsors.loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("eventFront.sections.sponsors.empty")).not.toBeInTheDocument();
  });

  it("odmowa bazy zamienia się w zdanie i NIE udaje wydarzenia bez partnerów", async () => {
    h.rpc?.setError("event_sponsors_public", "not_found: no such event", "P0002");
    const first = withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await waitFor(() => expect(first.container.querySelector("p")).not.toBeNull());
    const notFound = first.container.querySelector("p")?.textContent ?? "";
    // Ani surowy komunikat plpgsql, ani goły klucz słownika nie wychodzą na
    // stronę publiczną: jedno straszy czytelnika, drugie wygląda jak
    // niewdrożone tłumaczenie.
    expect(notFound).not.toContain("not_found");
    expect(notFound).not.toContain("no such event");
    expect(notFound).not.toContain("eventFront.errors.");
    expect(notFound.trim()).not.toBe("");
    // Awaria to nie pustka - inaczej organizator zobaczyłby „brak partnerów”
    // i zaczął szukać zguby w studiu zamiast w logach.
    expect(screen.queryByText("eventFront.sections.sponsors.empty")).not.toBeInTheDocument();

    // Inny kod odmowy = inne zdanie. Gdyby mapa kluczy przestała działać, oba
    // stany zlałyby się w jedno „coś nie zadziałało”.
    h.rpc?.setError("event_sponsors_public", "forbidden: sign in first", "42501");
    const second = withClient(<EventSponsorsSection slug="inny-kongres" />);
    await waitFor(() => expect(second.container.querySelector("p")).not.toBeNull());
    expect(second.container.querySelector("p")?.textContent).not.toBe(notFound);
  });

  it("zamknięta sekcja NIE wysyła zapytania do bazy", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    withClient(<EventSponsorsSection slug="kongres-strategii" enabled={false} />);

    await screen.findByLabelText("eventFront.sponsors.loading");
    expect(h.rpc?.callsFor("event_sponsors_public")).toHaveLength(0);
    expect(screen.queryByText("Nordwind Analytics")).not.toBeInTheDocument();
  });

  it("złoty stoi wyżej i ma szerszy kafel niż brązowy, a grupa bez poziomu na końcu", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({
        tier_id: null,
        tier_key: null,
        tier_name_pl: null,
        tier_name_en: null,
        tier_rank: 0,
        tier_logo_size: "md",
        sponsors: [sponsorWire({ id: "sp-bezpoziomu", name: "Vistula Consulting" })],
      }),
      tierWire({
        tier_id: "tier-bronze",
        tier_key: "bronze",
        tier_name_pl: "Brązowy Partner",
        tier_name_en: "Bronze Partner",
        tier_rank: 10,
        tier_logo_size: "sm",
        sponsors: [sponsorWire({ id: "sp-baltic", name: "Baltic Print" })],
      }),
      tierWire(),
    ]);
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    const headings = [...container.querySelectorAll("h3")].map((el) => el.textContent);
    expect(headings).toEqual([
      "Złoty Partner",
      "Brązowy Partner",
      // Grupa bez poziomu dostaje nazwę zastępczą, a nie pusty nagłówek.
      "eventFront.sponsors.noTier",
    ]);

    const lists = container.querySelectorAll("ul");
    expect(minTileRem(lists[0])).toBeGreaterThan(minTileRem(lists[1]));
  });

  it("kafel niesie rolę, stoisko, opis i korzyści poziomu", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({
        benefits: [{ id: "b1", label_pl: "Stoisko 12 m2", label_en: "12 sqm booth" }],
        sponsors: [
          sponsorWire({
            role: "media_partner",
            booth_label: "A12",
            description_pl: "Redakcja gospodarcza",
          }),
        ],
      }),
    ]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    // Rola `media_partner` ma własny klucz - inaczej „partner medialny” czytałby
    // się jako zwykły sponsor, czyli inna pozycja w umowie.
    expect(screen.getByText("eventFront.sponsors.roles.mediaPartner")).toBeInTheDocument();
    expect(screen.getByText('eventFront.sponsors.boothLabel:{"label":"A12"}')).toBeInTheDocument();
    expect(screen.getByText("Redakcja gospodarcza")).toBeInTheDocument();
    // Lista korzyści poziomu jest podpisana dla czytnika ekranu.
    expect(screen.getByText("eventFront.sponsors.benefitsLabel")).toBeInTheDocument();
    expect(screen.getByText("Stoisko 12 m2")).toBeInTheDocument();
  });

  it("przypięcie bez stoiska i bez opisu nie zostawia pustych plakietek", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    const card = (await screen.findByRole("listitem")).firstElementChild;
    // Kafel ma być dokładnie tym, co przyszło: nazwa i rola. Pusta plakietka
    // stoiska albo pusty akapit opisu to widoczna dziura w siatce.
    expect(card?.textContent).toBe("Nordwind AnalyticseventFront.sponsors.roles.sponsor");
  });

  it("partner z adresem dostaje odnośnik bez uchwytu do okna i bez rankingu", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({ sponsors: [sponsorWire({ url: "https://nordwind.example.com" })] }),
    ]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "https://nordwind.example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("eventFront.sponsors.visitSite")).toBeInTheDocument();
  });

  it("partner BEZ adresu nie jest odnośnikiem donikąd", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("eventFront.sponsors.visitSite")).not.toBeInTheDocument();
  });

  it("akcent poziomu maluje nagłówek TYLKO tam, gdzie poziom go niesie", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({ tier_accent_color: "#b8860b", tier_description_pl: "Najwyższy pakiet" }),
      tierWire({
        tier_id: "tier-bronze",
        tier_key: "bronze",
        tier_name_pl: "Brązowy Partner",
        tier_rank: 10,
        sponsors: [sponsorWire({ id: "sp-baltic", name: "Baltic Print" })],
      }),
    ]);
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    const [gold, bronze] = [...container.querySelectorAll("h3")];
    // Kolor jest treścią umowy (pakiet), więc poziom bez koloru NIE może
    // odziedziczyć akcentu sąsiada.
    expect((gold as HTMLElement).style.color).not.toBe("");
    expect((bronze as HTMLElement).style.color).toBe("");
    expect(screen.getByText("Najwyższy pakiet")).toBeInTheDocument();
  });

  // DEFEKT: w kaflu sekcji „Partnerzy” logotyp NIE jest schowany przed
  // czytnikiem ekranu, a `SponsorLogo` bez adresu degraduje do NAZWY firmy -
  // więc partner bez logotypu jest czytany dwa razy pod rząd. Pas na stronie
  // głównej (`EventSponsorTiers`) ma na to `aria-hidden` i komentarz mówiący
  // wprost „bez tego pozycja bez logotypu przeczytałaby nazwę dwa razy”;
  // kafel dostał tę samą ochronę - logotyp kafla siedzi pod `aria-hidden`.
  it("defekt: partner bez logotypu jest w kaflu czytany DWA RAZY (brak `aria-hidden`)", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({ sponsors: [sponsorWire({ logo: null })] }),
    ]);
    withClient(<EventSponsorsSection slug="kongres-strategii" />);

    await screen.findAllByText("Nordwind Analytics");
    const tile = screen.getByRole("listitem");
    // Nazwa MUSI zostać na kaflu - to ona mówi, kto jest partnerem, więc
    // naprawa przez skasowanie podpisu nie jest naprawą.
    expect(within(tile).getAllByText("Nordwind Analytics").length).toBeGreaterThan(0);
    // ...i MUSI być czytana raz. Liczymy odczyty, a nie węzły: poprawka
    // polega na schowaniu logotypu przed czytnikiem (`aria-hidden`), a nie
    // na usunięciu któregokolwiek z dwóch napisów - inaczej ten wpis
    // zostałby czerwony także po prawidłowej naprawie.
    expect(readAloudCount(tile, "Nordwind Analytics")).toBe(1);
  });
});

describe("EventSponsorTiers - pas logotypów na stronie głównej", () => {
  it("brak partnerów nie zostawia ani jednego węzła (pas nie ma własnego nagłówka)", () => {
    const { container } = render(<EventSponsorTiersView tiers={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("awaria zapytania też nie rysuje pasa - komunikat należy do sekcji „Partnerzy”", async () => {
    h.rpc?.setError("event_sponsors_public", "not_found: no such event");
    const { container } = withClient(<EventSponsorTiers slug="kongres-strategii" />);

    // Ten sam klucz zapytania obsługuje sekcję z nagłówkiem, więc awaria ma być
    // widoczna RAZ, a nie dwa razy na jednej stronie.
    await waitFor(() => expect(h.rpc?.callsFor("event_sponsors_public")).toHaveLength(1));
    expect(container.innerHTML).toBe("");
  });

  it("logotyp jest ozdobą, a nazwa firmy leci do czytnika ekranu dokładnie raz", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({
        sponsors: [
          sponsorWire(),
          sponsorWire({ id: "sp-baltic", name: "Baltic Print", logo: null, sort_order: 1 }),
        ],
      }),
    ]);
    const { container } = withClient(<EventSponsorTiers slug="kongres-strategii" />);

    await screen.findByText("Nordwind Analytics");
    // Obrazek jest ozdobą: `alt` jest pusty, więc bez `aria-hidden` czytnik
    // dostałby w tym układzie samo puste miejsce zamiast partnera.
    expect(container.querySelector("img")?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(readAloudCount(container, "Nordwind Analytics")).toBe(1);
    // A pozycja BEZ logotypu degraduje do nazwy - gdyby ta degradacja nie
    // siedziała pod `aria-hidden`, czytnik przeczytałby „Baltic Print” dwa
    // razy pod rząd. To jest ta sama reguła, której w kaflu sekcji
    // „Partnerzy” pilnuje przypadek wyżej.
    expect(readAloudCount(container, "Baltic Print")).toBe(1);
  });

  it("odnośnik z pasa mówi, DOKĄD prowadzi, i nie oddaje partnerowi rankingu", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({ sponsors: [sponsorWire({ url: "https://nordwind.example.com" })] }),
    ]);
    withClient(<EventSponsorTiers slug="kongres-strategii" />);

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(
      screen.getByText('eventFront.sponsorTiers.partnerSite:{"name":"Nordwind Analytics"}'),
    ).toBeInTheDocument();
  });

  it("pas nie maluje nagłówka akcentem poziomu, choć kolumna go niesie", () => {
    render(
      <EventSponsorTiersView
        tiers={[
          {
            tierId: null,
            key: null,
            namePl: null,
            nameEn: null,
            descriptionPl: null,
            descriptionEn: null,
            rank: 0,
            accentColor: "#b8860b",
            logoSize: "md",
            benefits: [],
            sponsors: [
              {
                id: "sp-vistula",
                name: "Vistula Consulting",
                logoUrl: null,
                websiteUrl: null,
                descriptionPl: null,
                descriptionEn: null,
                country: null,
                role: "partner",
                boothLabel: null,
                sortOrder: 0,
              },
            ],
          },
        ]}
      />,
    );

    // Na tle strony nie kontrolujemy obu stron kontrastu, więc akcent zostaje
    // w kaflu sekcji, a poziom bez nazwy dostaje napis zastępczy.
    const heading = screen.getByText("eventFront.sponsors.noTier");
    expect((heading as HTMLElement).style.color).toBe("");
  });
});

describe("SponsorLogo - nazwa jest treścią, logotyp ozdobą", () => {
  it("migawka bez adresu logotypu pokazuje NAZWĘ firmy, a nie pusty kwadrat", () => {
    const { container } = render(
      <SponsorLogo name="Nordwind Analytics" logoUrl={null} size="md" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Nordwind Analytics")).toBeInTheDocument();
  });

  it("logotyp ma PUSTY `alt`, bo nazwa stoi obok - inaczej czytnik powtarza ją dwa razy", () => {
    const { container } = render(
      <SponsorLogo name="Nordwind Analytics" logoUrl={LOGO_URL} size="md" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(screen.queryByText("Nordwind Analytics")).not.toBeInTheDocument();
  });

  it("obrazek, który się nie wczytał, degraduje do nazwy firmy", () => {
    const { container } = render(
      <SponsorLogo
        name="Nordwind Analytics"
        logoUrl="https://cdn.example.org/znikl.svg"
        size="lg"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as Element);

    // Bez tej degradacji czytnik ekranu zostaje z pustym `alt`, a widzący
    // z ikoną zepsutego obrazka na miejscu partnera.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Nordwind Analytics")).toBeInTheDocument();
  });

  it("poziom rządzi wysokością - „złoty” nie może wyglądać jak „brązowy”", () => {
    const small = render(<SponsorLogo name="Baltic Print" logoUrl={null} size="sm" />);
    const medium = render(<SponsorLogo name="Vistula Consulting" logoUrl={null} size="md" />);
    const large = render(<SponsorLogo name="Nordwind Analytics" logoUrl={null} size="lg" />);

    // Różnica pakietów sponsorskich jest widoczna WYŁĄCZNIE przez rozmiar.
    // Gdyby trzy poziomy dostały tę samą wysokość, „złoty” przestałby być
    // czymkolwiek więcej niż napisem w nagłówku - a to jest treść umowy.
    expect(baseHeight(small.container.firstElementChild)).toBeLessThan(
      baseHeight(medium.container.firstElementChild),
    );
    expect(baseHeight(medium.container.firstElementChild)).toBeLessThan(
      baseHeight(large.container.firstElementChild),
    );
  });

  it("klasa wywołującego dokłada się do wysokości poziomu, a nie zamiast niej", () => {
    const plain = render(<SponsorLogo name="Baltic Print" logoUrl={null} size="sm" />);
    const extended = render(
      <SponsorLogo name="Baltic Print" logoUrl={null} size="sm" className="opacity-70" />,
    );

    const base = (plain.container.firstElementChild?.getAttribute("class") ?? "").split(/\s+/);
    const withExtra = (extended.container.firstElementChild?.getAttribute("class") ?? "").split(
      /\s+/,
    );
    // Gdyby klasa wywołującego ZASTĄPIŁA klasę poziomu, pas na stronie głównej
    // wyrównałby wszystkie logotypy do jednego rozmiaru i różnica „złoty” od
    // „brązowego” zniknęłaby dokładnie tam, gdzie ma być widoczna.
    expect(withExtra).toEqual(expect.arrayContaining(base));
    expect(withExtra).toContain("opacity-70");
  });
});
