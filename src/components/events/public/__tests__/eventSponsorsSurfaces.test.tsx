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

const { EventSponsorsSection, EventSponsorsSectionView } =
  await import("@/components/events/public/organisms/EventSponsorsSection");
const { parseSponsorTiers } = await import("@/lib/events/sponsorsSurface");
const { EventPageSections } =
  await import("@/components/events/public/organisms/EventPageSections");
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

// ── ROZDZIELENIE ZAPYTANIA I RYSUNKU (podgląd studia) ──────────────────────
//
// Podgląd w studiu rysuje sekcję „Partnerzy" z wierszy RPC panelu, bo publiczne
// `event_sponsors_public` odmawia szkicowi. Rysunek MA BYĆ TEN SAM - inaczej
// podgląd znowu staje się drugim rendererem strony. A plakietka partnera
// nieogłoszonego nie może wyciec na stronę publiczną: rysuje się tylko wtedy,
// gdy wywołujący poda napis, a strona go nie podaje.

/** Poziom z jednym partnerem nieogłoszonym i jednym ogłoszonym, ze stroną WWW. */
function tiersWithDraft() {
  const [tier] = parseSponsorTiers([
    tierWire({
      sponsors: [
        sponsorWire(),
        sponsorWire({
          id: "sp-baltic",
          name: "Baltic Print",
          logo: null,
          url: "https://baltic.example.com",
          sort_order: 1,
        }),
      ],
    }) as never,
  ]);
  return [
    {
      ...tier,
      sponsors: tier.sponsors.map((sponsor) => ({
        ...sponsor,
        isDraft: sponsor.id === "sp-baltic",
      })),
    },
  ];
}

describe("EventSponsorsSectionView - rysunek sekcji bez zapytania", () => {
  it("strona publiczna i widok bez zapytania rysują IDENTYCZNE znaczniki", async () => {
    const wire = [
      tierWire({
        benefits: [{ id: "b1", label_pl: "Stoisko 12 m2", label_en: "12 sqm booth" }],
        sponsors: [sponsorWire({ booth_label: "A12", url: "https://nordwind.example.com" })],
      }),
      tierWire({
        tier_id: "tier-bronze",
        tier_key: "bronze",
        tier_name_pl: "Brązowy Partner",
        tier_rank: 10,
        sponsors: [sponsorWire({ id: "sp-baltic", name: "Baltic Print", logo: null })],
      }),
    ];
    h.rpc?.setData("event_sponsors_public", wire);
    const route = withClient(<EventSponsorsSection slug="kongres-strategii" />);
    await screen.findByText("Nordwind Analytics");
    const publicMarkup = route.container.innerHTML;
    route.unmount();

    // Te same wiersze sieci przez ten sam parser - różnić może się wyłącznie
    // miejsce, z którego przyszły.
    const view = render(<EventSponsorsSectionView tiers={parseSponsorTiers(wire as never)} />);
    expect(view.container.innerHTML).toBe(publicMarkup);
  });

  it("pusta lista w widoku mówi to samo zdanie, co pusta odpowiedź publiczna", () => {
    render(<EventSponsorsSectionView tiers={[]} draftLabel="Nieogłoszony" />);
    expect(screen.getByText("eventFront.sections.sponsors.empty")).toBeInTheDocument();
  });

  it("partner nieogłoszony dostaje plakietkę i przygaszony logotyp - TYLKO z napisem", () => {
    const { container } = render(
      <EventSponsorsSectionView tiers={tiersWithDraft()} draftLabel="Nieogłoszony" />,
    );
    const [ogloszony, szkic] = screen.getAllByRole("listitem");
    expect(within(szkic).getByText("Nieogłoszony")).toBeInTheDocument();
    expect(within(ogloszony).queryByText("Nieogłoszony")).toBeNull();
    // Plakietka jest TEKSTEM kafla (poza `aria-hidden`), więc czytnik ekranu ją
    // słyszy - a logotyp partnera jest przygaszony, nie ukryty.
    expect(within(szkic).getByText("Nieogłoszony").closest("[aria-hidden='true']")).toBeNull();
    expect(within(szkic).getAllByText("Baltic Print")[0]?.className).toContain("opacity-60");
    expect(container.querySelector("img")?.className).not.toContain("opacity-60");
  });

  it("znacznik szkicu BEZ napisu nie rysuje niczego - tak wygląda strona publiczna", () => {
    const bezNapisu = render(<EventSponsorsSectionView tiers={tiersWithDraft()} />);
    expect(bezNapisu.container.innerHTML).not.toContain("opacity-60");
    const bare = bezNapisu.container.innerHTML;
    bezNapisu.unmount();

    // Ten sam poziom bez znacznika szkicu daje DOKŁADNIE te same znaczniki.
    const plain = tiersWithDraft().map((tier) => ({
      ...tier,
      sponsors: tier.sponsors.map((sponsor) => ({ ...sponsor, isDraft: undefined })),
    }));
    expect(render(<EventSponsorsSectionView tiers={plain} />).container.innerHTML).toBe(bare);
  });
});

// ── ZNACZNIKI STRONY PUBLICZNEJ: WZORZEC SPRZED ROZDZIELENIA ───────────────
//
// Porównanie „trasa == widok" wyżej NIE MOŻE się czerwienić: po rozdzieleniu
// `EventSponsorsSection` po prostu oddaje `EventSponsorsSectionView`, więc
// każda zmiana rysunku (klasa dopisana bez warunku, nowy wrapper, plakietka,
// która wyciekła na stronę) zmienia OBIE strony równania naraz. Ten blok
// porównuje więc trasę ze STAŁYM wzorcem. Wzorce zostały wyrenderowane z kodu
// sprzed rozdzielenia (110686b) i porównane bajt w bajt z tym, co rysuje kod
// po nim - zmiana któregokolwiek z nich jest zmianą STRONY PUBLICZNEJ, a nie
// podglądu, i ma przejść przez przegląd jako taka.

/** Stała fikstura wzorca: akcent, opis i korzyści poziomu, stoisko, opis i adres partnera, partner bez logotypu. */
function goldenWire(): Wire[] {
  return [
    tierWire({
      tier_accent_color: "#b8860b",
      tier_description_pl: "Najwyższy pakiet",
      benefits: [{ id: "b1", label_pl: "Stoisko 12 m2", label_en: "12 sqm booth" }],
      sponsors: [
        sponsorWire({
          booth_label: "A12",
          url: "https://nordwind.example.com",
          description_pl: "Analityka energetyczna",
        }),
      ],
    }),
    tierWire({
      tier_id: "tier-bronze",
      tier_key: "bronze",
      tier_name_pl: "Brązowy Partner",
      tier_rank: 10,
      tier_logo_size: "sm",
      sponsors: [
        sponsorWire({ id: "sp-baltic", name: "Baltic Print", logo: null, role: "partner" }),
      ],
    }),
  ];
}

describe("strona publiczna - znaczniki partnerów zgodne ze wzorcem sprzed rozdzielenia", () => {
  it("sekcja „Partnerzy” (dane) rysuje dokładnie wzorzec", async () => {
    h.rpc?.setData("event_sponsors_public", goldenWire());
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);
    await screen.findByText("Nordwind Analytics");

    expect(container.firstElementChild).toMatchInlineSnapshot(`
      <div
        class="space-y-8"
      >
        <section
          class="space-y-4"
        >
          <header
            class="space-y-1"
          >
            <h3
              class="text-sm font-semibold uppercase tracking-wide text-foreground"
              style="color: #b8860b;"
            >
              Złoty Partner
            </h3>
            <p
              class="text-sm text-muted-foreground"
            >
              Najwyższy pakiet
            </p>
            <ul
              class="flex flex-wrap gap-2 pt-1"
            >
              <li
                class="sr-only"
              >
                eventFront.sponsors.benefitsLabel
              </li>
              <li>
                <div
                  class="inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground"
                >
                  Stoisko 12 m2
                </div>
              </li>
            </ul>
          </header>
          <ul
            class="grid gap-4"
            style="grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));"
          >
            <li>
              <a
                class="flex h-full flex-col items-center rounded-[6px] border border-border bg-card p-4 text-center transition-colors hover:border-primary/50"
                href="https://nordwind.example.com"
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                <span
                  aria-hidden="true"
                  class="contents"
                >
                  <img
                    alt=""
                    class="w-auto max-w-full object-contain h-20 sm:h-24"
                    decoding="async"
                    loading="lazy"
                    src="https://cdn.example.org/nordwind.svg"
                  />
                </span>
                <span
                  class="mt-3 block text-sm font-medium text-foreground"
                >
                  Nordwind Analytics
                </span>
                <span
                  class="mt-1 flex flex-wrap items-center justify-center gap-1.5"
                >
                  <div
                    class="inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  >
                    eventFront.sponsors.roles.sponsor
                  </div>
                  <div
                    class="inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground"
                  >
                    eventFront.sponsors.boothLabel:{"label":"A12"}
                  </div>
                </span>
                <span
                  class="mt-2 block text-xs text-muted-foreground"
                >
                  Analityka energetyczna
                </span>
                <span
                  class="mt-2 inline-flex items-center gap-1 text-xs text-primary"
                >
                  <svg
                    aria-hidden="true"
                    class="lucide lucide-external-link h-3 w-3"
                    fill="none"
                    height="24"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                    width="24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M15 3h6v6"
                    />
                    <path
                      d="M10 14 21 3"
                    />
                    <path
                      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
                    />
                  </svg>
                  eventFront.sponsors.visitSite
                </span>
              </a>
            </li>
          </ul>
        </section>
        <section
          class="space-y-4"
        >
          <header
            class="space-y-1"
          >
            <h3
              class="text-sm font-semibold uppercase tracking-wide text-foreground"
            >
              Brązowy Partner
            </h3>
          </header>
          <ul
            class="grid gap-4"
            style="grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));"
          >
            <li>
              <div
                class="flex h-full flex-col items-center rounded-[6px] border border-border bg-card p-4 text-center"
              >
                <span
                  aria-hidden="true"
                  class="contents"
                >
                  <span
                    class="flex items-center justify-center px-2 text-center text-sm font-semibold text-foreground h-10 sm:h-12"
                  >
                    Baltic Print
                  </span>
                </span>
                <span
                  class="mt-3 block text-sm font-medium text-foreground"
                >
                  Baltic Print
                </span>
                <span
                  class="mt-1 flex flex-wrap items-center justify-center gap-1.5"
                >
                  <div
                    class="inline-flex items-center rounded-[6px] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  >
                    eventFront.sponsors.roles.partner
                  </div>
                </span>
              </div>
            </li>
          </ul>
        </section>
      </div>
    `);
  });

  it("sekcja „Partnerzy” (wczytywanie) rysuje dokładnie wzorzec", () => {
    h.rpc?.setData("event_sponsors_public", goldenWire());
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);

    expect(container.firstElementChild).toMatchInlineSnapshot(`
      <div
        aria-busy="true"
        aria-label="eventFront.sponsors.loading"
        class="space-y-3"
      >
        <div
          class="animate-pulse rounded-md bg-muted h-6 w-40"
        />
        <div
          class="animate-pulse rounded-md bg-muted h-24 w-full"
        />
      </div>
    `);
  });

  it("sekcja „Partnerzy” (awaria) rysuje dokładnie wzorzec - zdanie w tym samym akapicie", async () => {
    h.rpc?.setError("event_sponsors_public", "not_found: no such event", "P0002");
    const { container } = withClient(<EventSponsorsSection slug="kongres-strategii" />);
    await waitFor(() => expect(container.querySelector("p")).not.toBeNull());

    // Brzmienie zdania należy do `publicEventErrors` (ma własny test); wzorcem
    // jest ZNACZNIK wokół niego.
    const message = container.querySelector("p")?.textContent ?? "";
    expect(message.trim()).not.toBe("");
    expect(container.innerHTML).toBe(
      `<p class="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">${message}</p>`,
    );
  });

  it("pas logotypów (odnośnik i pozycja bez adresu) rysuje dokładnie wzorzec", async () => {
    h.rpc?.setData("event_sponsors_public", goldenWire());
    const { container } = withClient(<EventSponsorTiers slug="kongres-strategii" />);
    await screen.findByRole("link");

    expect(container.firstElementChild).toMatchInlineSnapshot(`
      <div
        class="mt-8 space-y-8"
      >
        <section
          class="space-y-4"
        >
          <h3
            class="text-sm font-semibold text-foreground"
          >
            Złoty Partner
          </h3>
          <ul
            class="flex flex-wrap items-center justify-around gap-x-8 gap-y-6"
          >
            <li
              class="flex items-center justify-center"
            >
              <a
                class="flex items-center justify-center rounded-[6px] px-2 py-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="https://nordwind.example.com"
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                <span
                  aria-hidden="true"
                  class="flex items-center justify-center"
                >
                  <img
                    alt=""
                    class="w-auto max-w-full object-contain h-20 sm:h-24"
                    decoding="async"
                    loading="lazy"
                    src="https://cdn.example.org/nordwind.svg"
                  />
                </span>
                <span
                  class="sr-only"
                >
                  eventFront.sponsorTiers.partnerSite:{"name":"Nordwind Analytics"}
                </span>
              </a>
            </li>
          </ul>
        </section>
        <section
          class="space-y-4"
        >
          <h3
            class="text-sm font-semibold text-foreground"
          >
            Brązowy Partner
          </h3>
          <ul
            class="flex flex-wrap items-center justify-around gap-x-8 gap-y-6"
          >
            <li
              class="flex items-center justify-center"
            >
              <span
                class="flex items-center justify-center px-2"
              >
                <span
                  aria-hidden="true"
                  class="flex items-center justify-center"
                >
                  <span
                    class="flex items-center justify-center px-2 text-center text-sm font-semibold text-foreground h-10 sm:h-12"
                  >
                    Baltic Print
                  </span>
                </span>
                <span
                  class="sr-only"
                >
                  Baltic Print
                </span>
              </span>
            </li>
          </ul>
        </section>
      </div>
    `);
  });
});

describe("EventPageSections - sekcja „Partnerzy” z zapytaniem albo z wierszami podanymi z zewnątrz", () => {
  const sponsorsSection = {
    key: "sponsors" as const,
    sortOrder: 4,
    headingPl: null,
    headingEn: null,
    visibility: "public" as const,
    minTierRank: 0,
    isLocked: false,
    lockReason: "none" as const,
    hasContent: true,
  };

  it("strona publiczna (bez `sponsorTiers`) pyta `event_sponsors_public` jak dotąd", async () => {
    h.rpc?.setData("event_sponsors_public", [tierWire()]);
    const { container } = withClient(
      <EventPageSections slug="kongres-strategii" sections={[sponsorsSection]} />,
    );

    await screen.findByText("Nordwind Analytics");
    expect(h.rpc?.names()).toEqual(["event_sponsors_public"]);
    expect(container.querySelector("#event-sponsors")).not.toBeNull();
  });

  it("podgląd (z `sponsorTiers`) NIE pyta bazy i rysuje podane wiersze z plakietką", () => {
    render(
      <EventPageSections
        slug="kongres-strategii"
        sections={[sponsorsSection]}
        sponsorTiers={tiersWithDraft()}
        sponsorDraftLabel="Nieogłoszony"
      />,
    );

    expect(h.rpc?.names()).toEqual([]);
    expect(screen.getByText("Nieogłoszony")).toBeInTheDocument();
    expect(screen.getAllByText("Baltic Print").length).toBeGreaterThan(0);
  });

  it("podgląd z awarią listy panelu: sekcja zostaje ze ZDANIEM o awarii, nie z pustką", () => {
    const { container } = render(
      <EventPageSections
        slug="kongres-strategii"
        sections={[sponsorsSection]}
        sponsorTiers={tiersWithDraft()}
        sponsorDraftLabel="Nieogłoszony"
        sponsorErrorMessage="Nie udało się wczytać partnerów."
      />,
    );

    // Awaria wygrywa z wierszami (jak `isError` przed `data` w sekcji
    // publicznej) i nie udaje „brak partnerów" - a baza nadal nie jest pytana.
    const sekcja = container.querySelector<HTMLElement>("#event-sponsors") as HTMLElement;
    const zdanie = within(sekcja).getByText("Nie udało się wczytać partnerów.");
    expect(zdanie.className).toBe(
      "rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
    );
    expect(within(sekcja).queryByText("Baltic Print")).toBeNull();
    expect(within(sekcja).queryByText("eventFront.sections.sponsors.empty")).toBeNull();
    expect(h.rpc?.names()).toEqual([]);
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

  it("pas w podglądzie: nieogłoszony partner przygaszony, z plakietką w nazwie pozycji", () => {
    const { container } = render(
      <EventSponsorTiersView tiers={tiersWithDraft()} draftLabel="Nieogłoszony" />,
    );
    // Partner ze stroną WWW jest odnośnikiem - plakietka wchodzi do jego nazwy,
    // więc czytnik ekranu słyszy stan tak samo, jak widzi go oko.
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("Nieogłoszony");
    expect(link.className).toContain("flex-col");
    expect(within(link).getByText("Baltic Print").className).toContain("opacity-60");
    // Ogłoszony partner bez strony zostaje dokładnie taki, jak na stronie.
    const [ogloszony] = screen.getAllByRole("listitem");
    expect(ogloszony.textContent).not.toContain("Nieogłoszony");
    expect(ogloszony.firstElementChild?.className).toBe("flex items-center justify-center px-2");
    expect(container.querySelector("img")?.className).not.toContain("opacity-60");
  });

  it("pas w podglądzie: nieogłoszony partner BEZ strony też dostaje plakietkę", () => {
    const tiers = tiersWithDraft().map((tier) => ({
      ...tier,
      sponsors: tier.sponsors.map((sponsor) => ({ ...sponsor, websiteUrl: null, isDraft: true })),
    }));
    render(<EventSponsorTiersView tiers={tiers} draftLabel="Nieogłoszony" />);
    const pozycje = screen.getAllByRole("listitem");
    for (const pozycja of pozycje) {
      expect(pozycja.textContent).toContain("Nieogłoszony");
      expect(pozycja.firstElementChild?.className).toContain("flex-col");
    }
  });

  it("publiczny pas i publiczna sekcja nie znają plakietki - nawet przy znaczniku z sieci", async () => {
    h.rpc?.setData("event_sponsors_public", [
      tierWire({ sponsors: [sponsorWire({ is_draft: true, isDraft: true })] }),
    ]);
    const { container } = withClient(
      <>
        <EventSponsorTiers slug="kongres-strategii" />
        <EventSponsorsSection slug="kongres-strategii" />
      </>,
    );
    await screen.findAllByText("Nordwind Analytics");
    expect(container.innerHTML).not.toContain("opacity-60");
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
