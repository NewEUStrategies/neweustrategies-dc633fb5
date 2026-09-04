// Organizm „PROGRAM WYDARZENIA" - cienka warstwa, ktora decyduje o JEDNEJ
// rzeczy: co jest na ekranie programu, gdy pasmo jest otwarte, a co gdy nie.
//
// PO CO TEN PLIK ISTNIEJE. Panel nie ma wlasnego zapytania i wlasnego stanu -
// caly jego kod to trzy warunki i przepisanie propsow. Wlasnie dlatego byl bez
// testu („czwarty plik na zerze" w kronice `vitest.config.ts`) i wlasnie dlatego
// jego bledy sa niewidoczne w kodzie, a widoczne dopiero na ekranie:
//
//   1. DWA NAGLOWKI NAD SOBA. Warsztat pasma ma WLASNY naglowek z powrotem
//      i tytulem (`EventTrackWorkspace`), wiec naglowek programu musi wtedy
//      zniknac - inaczej pasek zakladek dostaje dwa tytuly jeden nad drugim
//      i traci wysokosc, ktora jest w studiu na wage zlota.
//   2. SIATKA CZASU W WARSZTACIE. Siatka mowi o CALYM dniu wydarzenia; w
//      warsztacie jednego pasma jest szumem i - co gorsza - drugim zrodlem
//      prawdy o tych samych sesjach. Musi zostac wylaczona razem z naglowkiem.
//   3. PUSTE `?track=` NIE JEST WARSZTATEM. Otwarte pasmo mieszka w adresie,
//      a adres oddaje pusty napis rownie chetnie jak brak parametru
//      (`?track=`). Warunek liczony na samym `!== null` chowalby naglowek i
//      siatke na widoku LISTY pasm, czyli na ekranie, ktory nie ma zadnego
//      innego naglowka.
//   4. STREFA WYDARZENIA JEDZIE DALEJ JAWNIE. Siatka liczy doby w strefie
//      wydarzenia, a nie w strefie przegladarki; brak strefy to `null`
//      (wartosc), a nie `undefined` (brak informacji) - inaczej sesja o 23:30
//      w Brukseli wypada organizatorowi w Warszawie na inny dzien.
//   5. WEJSCIE I WYJSCIE Z WARSZTATU IDZIE PRZEZ RODZICA. Panel nie trzyma
//      otwartego pasma u siebie - przekazuje `onOpenTrack` dalej, zeby trasa
//      mogla zapisac je w adresie i zeby odswiezenie strony wrocilo w to samo
//      miejsce.
//
// CZEGO SWIADOMIE NIE DUBLUJE. `AgendaTracksPanel` i `AgendaTimelinePanel` to
// OSOBNE organizmy z wlasnymi plikami testowymi (`AgendaTracksPanel.test.tsx`,
// `AgendaTimelinePanel.test.tsx`) - tam mieszkaja stany ich list (wczytywanie,
// awaria, pustka, dane) i cala mechanika pasm. Tutaj sa atrapami, bo przedmiotem
// dowodu jest SKLAD ekranu i to, co panel im podaje; zamontowanie ich prawdziwych
// wersji przepisywaloby tamte pliki i mierzyloby ich zapytania, a nie te trzy
// warunki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  lang: "pl",
  otwarcia: [] as (string | null)[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Lista pasm ma wlasny plik testowy. Tutaj liczy sie STYK: czy dostaje
// wydarzenie, opis strefy, otwarte pasmo i droge powrotna.
vi.mock("@/components/admin/events/organisms/AgendaTracksPanel", () => ({
  AgendaTracksPanel: ({
    eventId,
    timeZoneLabel,
    openedTrackId,
    onOpenTrack,
  }: {
    eventId: string;
    timeZoneLabel: string;
    openedTrackId?: string | null;
    onOpenTrack?: (trackId: string | null) => void;
  }) => (
    <div
      data-testid="lista-pasm"
      data-wydarzenie={eventId}
      data-strefa-opis={timeZoneLabel}
      data-otwarte={openedTrackId === null || openedTrackId === undefined ? "brak" : openedTrackId}
    >
      <button type="button" data-testid="wejdz-w-pasmo" onClick={() => onOpenTrack?.(PASMO)}>
        wejdz
      </button>
      <button type="button" data-testid="wroc-do-listy" onClick={() => onOpenTrack?.(null)}>
        wroc
      </button>
    </div>
  ),
}));

// Siatka czasu ma wlasny plik testowy. Tutaj sprawdzamy, KIEDY jest na ekranie
// i z jaka strefa - jej wnetrze jest poza zakresem tego organizmu.
vi.mock("@/components/admin/events/organisms/AgendaTimelinePanel", () => ({
  AgendaTimelinePanel: ({
    eventId,
    timezone,
  }: {
    eventId: string;
    timezone: string | null | undefined;
  }) => (
    <div
      data-testid="siatka-czasu"
      data-wydarzenie={eventId}
      data-strefa={timezone === null ? "null" : timezone === undefined ? "undefined" : timezone}
    />
  ),
}));

const { EventProgramPanel } = await import("@/components/admin/events/organisms/EventProgramPanel");

const T = "adminEventAgenda.program";
const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const PASMO = "22222222-2222-4222-8222-222222222222";
const STREFA_OPIS = "Europe/Brussels (CEST)";

interface Ustawienia {
  timeZoneLabel?: string;
  timezone?: string | null;
  openedTrackId?: string | null;
  onOpenTrack?: (trackId: string | null) => void;
}

function panel(ustawienia: Ustawienia = {}): RenderResult {
  return render(
    <EventProgramPanel
      eventId={WYDARZENIE}
      timeZoneLabel={ustawienia.timeZoneLabel ?? STREFA_OPIS}
      timezone={ustawienia.timezone}
      openedTrackId={ustawienia.openedTrackId}
      onOpenTrack={ustawienia.onOpenTrack ?? ((trackId) => h.otwarcia.push(trackId))}
    />,
  );
}

const listaPasm = (): HTMLElement => screen.getByTestId("lista-pasm");
const siatka = (): HTMLElement | null => screen.queryByTestId("siatka-czasu");
const naglowek = (): HTMLElement | null => screen.queryByText(`${T}.title`);
const podtytul = (): HTMLElement | null => screen.queryByText(`${T}.subtitle`);

beforeEach(() => {
  h.lang = "pl";
  h.otwarcia = [];
});

describe("widok LISTY pasm - pasmo nie jest otwarte", () => {
  it("ma naglowek ze zdaniem, jak buduje sie program", () => {
    // Bez podtytulu ekran otwiera sie lista pasm i nie mowi, gdzie sa sesje -
    // a warsztat sesji stoi dopiero w zakladce wewnatrz sciezki. Zdanie musi
    // przy tym stac W naglowku: wyjete poza niego przestaje byc wprowadzeniem
    // do ekranu i laduje miedzy pasmami jako luzny akapit.
    const { container } = panel();
    const czapka = container.querySelector("header");

    expect(czapka?.textContent).toContain(`${T}.title`);
    expect(czapka?.textContent).toContain(`${T}.subtitle`);
  });

  it("naglowek jest naglowkiem DRUGIEGO poziomu, a nie akapitem", () => {
    // Program jest sekcja strony wydarzenia, ktora ma juz swoj `h1`. Akapit
    // udajacy naglowek odbiera czytnikowi punkt skoku, a `h1` w tym miejscu
    // rozbija konspekt strony na dwa dokumenty.
    panel();

    expect(screen.getByRole("heading", { level: 2, name: `${T}.title` })).toBeTruthy();
  });

  it("ma liste pasm i siatke czasu POD nia", () => {
    // Kolejnosc jest tresciowa: pasma sa jednostka planowania, a siatka jest
    // podgladem calego dnia - odwrocenie tej pary zmienia ekran w kalendarz,
    // od ktorego zaczyna sie planowanie.
    const { container } = panel();
    const kolejnosc = Array.from(container.querySelectorAll("[data-testid]")).map((node) =>
      node.getAttribute("data-testid"),
    );

    expect(kolejnosc.indexOf("lista-pasm")).toBeGreaterThanOrEqual(0);
    expect(kolejnosc.indexOf("siatka-czasu")).toBeGreaterThan(kolejnosc.indexOf("lista-pasm"));
  });

  it("puste `?track=` to nadal widok listy - naglowek i siatka zostaja", () => {
    // Adres oddaje pusty napis rownie chetnie jak brak parametru; warunek
    // liczony na samym „nie null" chowalby naglowek na ekranie, ktory nie ma
    // zadnego innego.
    panel({ openedTrackId: "" });

    expect(naglowek()).not.toBeNull();
    expect(siatka()).not.toBeNull();
  });

  it("`null` i brak propsa znacza to samo, co puste `?track=`", () => {
    const jawnyNull = panel({ openedTrackId: null });
    expect(screen.getByText(`${T}.title`)).toBeTruthy();
    expect(screen.getByTestId("siatka-czasu")).toBeTruthy();
    jawnyNull.unmount();

    panel();
    expect(naglowek()).not.toBeNull();
    expect(siatka()).not.toBeNull();
  });
});

describe("widok WARSZTATU pasma - pasmo jest otwarte", () => {
  it("naglowek programu znika - warsztat sciezki ma wlasny", () => {
    // Dwa naglowki jeden nad drugim tylko zabieraja wysokosc paskowi zakladek.
    panel({ openedTrackId: PASMO });

    expect(naglowek()).toBeNull();
    expect(podtytul()).toBeNull();
  });

  it("siatka czasu znika - w warsztacie uwaga jest na JEDNYM pasmie", () => {
    // Siatka mowi o calym dniu i byla drugim, niezaleznym widokiem tych samych
    // sesji - dokladnie tym, przed czym ostrzega naglowek pliku zrodlowego.
    panel({ openedTrackId: PASMO });

    expect(siatka()).toBeNull();
  });

  it("lista pasm ZOSTAJE i wie, ktore pasmo jest otwarte", () => {
    // Warsztat mieszka wewnatrz listy pasm - zdjecie jej razem z naglowkiem
    // zostawiloby pusty ekran.
    panel({ openedTrackId: PASMO });

    expect(listaPasm()).toHaveAttribute("data-otwarte", PASMO);
  });
});

describe("co panel podaje dalej", () => {
  it("oba organizmy potomne dostaja TO wydarzenie", () => {
    // Pomylka tutaj pokazuje program cudzego wydarzenia; zawezenie najemcem
    // siedzi w SQL-u funkcji `admin_event_*` (pilnuje go bramka
    // `check:sql-tenant-scope`), ale wybor wydarzenia jest po stronie panelu.
    panel();

    expect(listaPasm()).toHaveAttribute("data-wydarzenie", WYDARZENIE);
    expect(siatka()).toHaveAttribute("data-wydarzenie", WYDARZENIE);
  });

  it("opis strefy jedzie do listy pasm - to on wedruje do zakladki sesji", () => {
    panel({ timeZoneLabel: "Europe/Warsaw (CEST)" });

    expect(listaPasm()).toHaveAttribute("data-strefa-opis", "Europe/Warsaw (CEST)");
  });

  it("strefa wydarzenia jedzie do siatki bez zmian", () => {
    panel({ timezone: "Europe/Brussels" });

    expect(siatka()).toHaveAttribute("data-strefa", "Europe/Brussels");
  });

  it("BRAK strefy dojezdza jako `null`, nie jako `undefined`", () => {
    // Siatka odroznia „wydarzenie nie ma strefy" od „nie wiem" - dostaje
    // wartosc, a nie brak argumentu.
    panel();

    expect(siatka()).toHaveAttribute("data-strefa", "null");
  });

  it("strefa podana jako `null` tez dojezdza jako `null`", () => {
    panel({ timezone: null });

    expect(siatka()).toHaveAttribute("data-strefa", "null");
  });

  it("wejscie w pasmo i powrot do listy ida do RODZICA, nie do wlasnego stanu", () => {
    // Otwarte pasmo mieszka w adresie (`?track=`), wiec panel nie moze go
    // przechwytywac u siebie - odswiezenie strony musi wrocic w to samo miejsce.
    panel();

    fireEvent.click(screen.getByTestId("wejdz-w-pasmo"));
    fireEvent.click(screen.getByTestId("wroc-do-listy"));

    expect(h.otwarcia).toEqual([PASMO, null]);
  });

  it("panel BEZ `onOpenTrack` nie wywraca sie przy klikniecu w pasmo", () => {
    // Naglowek `AgendaTracksPanel` mowi wprost, ze bez tych propsow panel
    // dziala „jak dotad" - na wlasnym stanie; program nie moze tego psuc.
    render(<EventProgramPanel eventId={WYDARZENIE} timeZoneLabel={STREFA_OPIS} timezone={null} />);

    fireEvent.click(screen.getByTestId("wejdz-w-pasmo"));

    expect(h.otwarcia).toEqual([]);
    expect(screen.getByTestId("lista-pasm")).toBeTruthy();
  });
});

describe("dostepnosc", () => {
  it("widok listy nie ma naruszen axe", async () => {
    const { container } = panel();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("widok warsztatu - juz bez naglowka - tez nie ma naruszen axe", async () => {
    const { container } = panel({ openedTrackId: PASMO });

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});

describe("jezyk interfejsu", () => {
  it("naglowek idzie ze slownika, wiec przelaczenie jezyka go nie gubi", () => {
    // Slownik agendy jest jeden dla PL i EN (parytetu pilnuja bramki
    // slownikowe); tutaj liczy sie to, ze panel siega po KLUCZ, a nie po
    // wpisany na sztywno napis.
    h.lang = "en";
    panel();

    expect(screen.getByRole("heading", { level: 2, name: `${T}.title` })).toBeTruthy();
    expect(screen.getByText(`${T}.subtitle`)).toBeTruthy();
  });
});
