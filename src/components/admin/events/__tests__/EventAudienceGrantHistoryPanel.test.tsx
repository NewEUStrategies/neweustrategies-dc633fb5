// Organizm „HISTORIA ZMIAN UPRAWNIEN DO STAWEK" - dziennik audytu rozliczen.
//
// PO CO TEN EKRAN ISTNIEJE. Lista nadan mowi o STANIE dzisiejszym; faktura
// z ulga pyta o DROGE: kto przedluzyl waznosc, kto podmienil podstawe, kto
// wycofal i kiedy. Zrodlem jest wspolny dziennik `public.audit_log`, wypelniany
// TRIGGEREM bazy - zadna sciezka zapisu go nie omija.
//
// CO TEN PLIK DOWODZI.
//   1. PUSTA HISTORIA TO „PUSTO", A NIE „NIE UDALO SIE". Nadanie, ktorego nikt
//      jeszcze nie zmienial, ma zero wpisow i to jest PRAWDA o dzienniku.
//      Odwrotnie: odmowa NIE MOZE wygladac jak pusty dziennik - „nikt tego nie
//      ruszal" jest wtedy falszywym zaswiadczeniem dla audytu.
//   2. ZAKRES MA PARE: „to wydarzenie" i „caly najemca" pytaja o CO INNEGO,
//      a wejscie z wiersza nadania pyta o SCIEZKE JEDNEGO uprawnienia - i wtedy
//      przelacznika zakresu nie ma wcale, bo nie mialby czego zawezac.
//   3. WYCOFANIE JEST NAZWANE INACZEJ NIZ KOREKTA. Trigger rozroznia cztery
//      akcje; ekran, ktory zrownalby wycofanie z „zmieniono", odbieralby
//      audytorowi najwazniejsze zdarzenie rozliczeniowe.
//   4. DIFF POKAZUJE OBIE STRONY zmiany, a wartosc pusta ma wlasny napis -
//      pusty napis czytalby sie jak uszkodzony wiersz dziennika.
//   5. DZIENNIK JEST TYLKO DO ODCZYTU. Wpis, ktory da sie poprawic albo
//      skasowac, nie jest sladem audytowym.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Warstwy danych (`fetchAudienceGrantHistory`,
// ksztalt `p_payload`) - `audienceGrantsRpc.test.ts`. (2) Funkcji czystych
// (`audienceGrantAction`, `historyValueText`) - `audienceGrantHistory.test.ts`;
// tutaj sa PRAWDZIWE, bo dowodzimy ich WYNIKU na ekranie. (3) Parytetu akcji
// i pol diffu z trescia triggera - `termsGroupsDbEnumParity.test.ts`.
// (4) Formatowania dat - podmienione na wartosc deterministyczna, zeby asercja
// nie zalezala od wersji ICU maszyny, ale nadal widziala JEZYK.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { radixSwitchStub } from "@/test/reactStubs";
import { axeViolations, summarize } from "@/test/axe";
import type { EventAudienceGrantHistoryRow } from "@/lib/events/audienceGrantsApi";

/** Zapytanie o dziennik - to, co organizm wysyla do warstwy danych. */
interface ZapytanieHistorii {
  eventId: string | null;
  grantId: string | null;
  search: string;
  limit: number;
}

const h = vi.hoisted(() => ({
  language: "pl",
  rows: undefined as unknown,
  isLoading: false,
  listError: null as Error | null,
  zapytania: [] as unknown[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

// Slownik odmow bazy ma wlasny plik testowy i ciagnie realny i18next; tutaj
// potrzebny jest wylacznie dowod, ze odmowa DOCHODZI zdaniem.
vi.mock("@/lib/events/adminRegistrationErrors", () => ({
  adminRegistrationErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

// Data w wierszu ma byc DETERMINISTYCZNA: wynik `Intl` zalezy od wersji ICU
// maszyny, a przedmiotem dowodu jest to, JAKA WARTOSC i W JAKIM JEZYKU organizm
// oddaje do formatowania - nie sam napis.
vi.mock("@/lib/i18n/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/format")>()),
  formatDateTime: (value: string | number | Date, lang: string | undefined) =>
    `data(${String(value)}|${String(lang)})`,
}));

vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (next: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/lib/events/useEventAudienceGrants", () => ({
  useAudienceGrantHistory: (query: ZapytanieHistorii) => {
    h.zapytania.push(query);
    return { data: h.rows, isLoading: h.isLoading, error: h.listError };
  },
}));

const { EventAudienceGrantHistoryPanel, EventAudienceGrantHistoryButton } =
  await import("@/components/admin/events/organisms/EventAudienceGrantHistoryPanel");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const H = "adminEventRegistration.audienceGrantHistory.";

/**
 * Wiersz `admin_event_audience_grant_history`.
 *
 * Kolumny wyliczane z LEFT JOIN-ow (`actor_name`, `actor_email`,
 * `subject_name`, `subject_email`, `event_title`, `audience`) przychodza
 * z RPC jako `NULL` - nadanie moze byc dla osoby spoza kartoteki, dla calego
 * najemcy, a autor wpisu moze byc zadaniem serwisowym bez konta. Generator
 * opisuje kazda kolumne `RETURNS TABLE` jako niepusta, wiec rzutowanie tego
 * jednego wartownika jest WIERNE bazie, a nie obejsciem typu: organizm te
 * pustki rozroznia i ma na nie osobne napisy.
 */
const BRAK = null as unknown as string;

function historyRow(
  overrides: Partial<EventAudienceGrantHistoryRow> = {},
): EventAudienceGrantHistoryRow {
  return {
    action: "event_audience_grant.granted",
    actor_email: "redakcja@example.org",
    actor_id: "aktor-1",
    actor_name: "Redaktor Testowy",
    after_values: {},
    audience: "academic",
    before_values: {},
    changed: [],
    created_at: "2026-08-20T12:00:00.000Z",
    event_id: EVENT_ID,
    event_title: "Kongres",
    grant_id: GRANT_ID,
    id: "wpis-1",
    subject_email: "anna.kowalska@example.org",
    subject_name: "Anna Kowalska",
    ...overrides,
  };
}

function renderuj(props: { grantId?: string | null; embedded?: boolean } = {}) {
  return render(
    <EventAudienceGrantHistoryPanel
      eventId={EVENT_ID}
      grantId={props.grantId ?? null}
      embedded={props.embedded === true}
    />,
  );
}

function wiersz(fragment: string): HTMLElement {
  const li = screen
    .getAllByRole("listitem")
    .find((node) => node.textContent?.includes(fragment) === true);
  if (li === undefined) throw new Error(`brak wpisu „${fragment}” w dzienniku`);
  return li;
}

function ostatnieZapytanie(): ZapytanieHistorii {
  const last = h.zapytania.at(-1);
  if (last === undefined) throw new Error("organizm nie zapytal o dziennik");
  return last as ZapytanieHistorii;
}

beforeEach(() => {
  h.language = "pl";
  h.rows = [];
  h.isLoading = false;
  h.listError = null;
  h.zapytania = [];
});

describe("pusta historia to „pusto”, a nie „nie udalo sie”", () => {
  // NADANIE, KTOREGO NIKT NIE ZMIENIAL, MA ZERO WPISOW - i to jest PRAWDA
  // o dzienniku, a nie awaria. Komunikat odmowy w tym miejscu kazalby
  // audytorowi szukac problemu technicznego tam, gdzie go nie ma.
  it("brak wpisow mowi o pustce i NIE pokazuje zadnej odmowy", () => {
    h.rows = [];
    renderuj();
    expect(screen.getByText(`${H}empty`)).toBeTruthy();
    expect(screen.queryByText(/^odmowa:/)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // ...A ODMOWA NIE MOZE WYGLADAC JAK PUSTY DZIENNIK. „Nikt tego nie ruszal"
  // po nieudanym zapytaniu jest falszywym zaswiadczeniem dla audytu rozliczen.
  it("odmowa mowi trescia odmowy i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.listError = new Error("forbidden: editor role required");
    renderuj();
    expect(screen.getByText("odmowa:forbidden: editor role required")).toBeTruthy();
    expect(screen.queryByText(`${H}empty`)).toBeNull();
  });

  it("wczytywanie pokazuje postep i NIE mowi o pustce", () => {
    h.rows = undefined;
    h.isLoading = true;
    renderuj();
    expect(screen.getByText(`${H}loading`)).toBeTruthy();
    expect(screen.queryByText(`${H}empty`)).toBeNull();
  });

  it("wczytywanie po nieudanej probie bije odmowe", () => {
    h.rows = undefined;
    h.isLoading = true;
    h.listError = new Error("history_failed");
    renderuj();
    expect(screen.getByText(`${H}loading`)).toBeTruthy();
    expect(screen.queryByText("odmowa:history_failed")).toBeNull();
  });
});

describe("zakres dziennika - para „cale wydarzenie / caly najemca”", () => {
  it("stan poczatkowy pyta o dziennik TEGO wydarzenia", () => {
    renderuj();
    expect(ostatnieZapytanie()).toEqual({
      eventId: EVENT_ID,
      grantId: null,
      search: "",
      limit: 50,
    });
  });

  // NADANIA OBOWIAZUJACE W CALYM NAJEMCY (bez wydarzenia) nie pokazalyby sie
  // w widoku zawezonym - a to one najczesciej sa przedmiotem pytania audytu.
  it("zdjecie zakresu pyta o dziennik CALEGO najemcy", () => {
    renderuj();
    fireEvent.click(screen.getByLabelText("adminEventRegistration.audienceGrants.scopeThis"));
    expect(ostatnieZapytanie().eventId).toBeNull();
  });

  // WEJSCIE Z WIERSZA NADANIA PYTA O SCIEZKE JEDNEGO UPRAWNIENIA. Zakres
  // wydarzenia nie ma tu sensu (nadanie moze byc poza wydarzeniem), wiec
  // przelacznika NIE MA, a zapytanie idzie bez zawezenia do wydarzenia.
  it("widok jednego nadania NIE MA przelacznika zakresu", () => {
    renderuj({ grantId: GRANT_ID });
    expect(screen.queryByLabelText("adminEventRegistration.audienceGrants.scopeThis")).toBeNull();
  });

  it("widok jednego nadania pyta o TO nadanie, bez zawezenia do wydarzenia", () => {
    renderuj({ grantId: GRANT_ID });
    expect(ostatnieZapytanie()).toMatchObject({ grantId: GRANT_ID, eventId: null });
  });

  it("widok calego wydarzenia NIE zaweza do zadnego nadania", () => {
    renderuj();
    expect(ostatnieZapytanie().grantId).toBeNull();
  });
});

describe("fraza i dlugosc dziennika", () => {
  it("fraza jedzie do zapytania bez obcinania po stronie ekranu", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText(`${H}searchLabel`), {
      target: { value: "  kowalska  " },
    });
    expect(ostatnieZapytanie().search).toBe("  kowalska  ");
  });

  it("droplista oferuje trzy dlugosci dziennika", () => {
    renderuj();
    const opcje = within(screen.getByLabelText(`${H}limitLabel`))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(opcje).toEqual(["50", "100", "250"]);
  });

  it("wybrana dlugosc jedzie do zapytania", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText(`${H}limitLabel`), { target: { value: "250" } });
    expect(ostatnieZapytanie().limit).toBe(250);
  });

  // WARTOSC SPOZA ZBIORU WRACA DO NAJKROTSZEJ. Baza i tak przycina limit do
  // przedzialu 1..500, ale ekran nie moze obiecywac dlugosci, ktorej nie
  // dostanie - inaczej audytor sadzi, ze widzi caly dziennik.
  it("dlugosc spoza zbioru wraca do najkrotszej", () => {
    renderuj();
    fireEvent.change(screen.getByLabelText(`${H}limitLabel`), { target: { value: "9999" } });
    expect(ostatnieZapytanie().limit).toBe(50);
  });
});

describe("akcje dziennika - wycofanie nie wyglada jak korekta", () => {
  it.each([
    ["event_audience_grant.granted", "granted"],
    ["event_audience_grant.updated", "updated"],
    ["event_audience_grant.revoked", "revoked"],
    ["event_audience_grant.restored", "restored"],
  ])("akcja `%s` jest nazwana `%s`", (action, nazwa) => {
    h.rows = [historyRow({ action })];
    renderuj();
    expect(within(wiersz("Redaktor Testowy")).getByText(`${H}actions.${nazwa}`)).toBeTruthy();
  });

  // WYCOFANIE I KOREKTA TO DWA ROZNE ZDARZENIA ROZLICZENIOWE. Trigger stawia
  // dla nich osobne akcje wlasnie po to, zeby audytor pytal o nie osobno.
  it("wycofanie NIE jest nazwane tak jak korekta", () => {
    h.rows = [historyRow({ action: "event_audience_grant.revoked" })];
    renderuj();
    const li = wiersz("Redaktor Testowy");
    expect(within(li).getByText(`${H}actions.revoked`)).toBeTruthy();
    expect(within(li).queryByText(`${H}actions.updated`)).toBeNull();
  });

  // AKCJA NIEZNANA EKRANOWI DEGRADUJE DO „zmieniono" - wpis zostaje w
  // dzienniku, bo pominiecie go byloby luka w sladzie audytowym.
  it("akcja nieznana ekranowi degraduje do „zmieniono”, a wpis zostaje", () => {
    h.rows = [historyRow({ action: "event_audience_grant.reindexed" })];
    renderuj();
    expect(within(wiersz("Redaktor Testowy")).getByText(`${H}actions.updated`)).toBeTruthy();
  });

  it("wpis niesie date zdarzenia w jezyku interfejsu", () => {
    h.rows = [historyRow({ created_at: "2026-08-20T12:00:00.000Z" })];
    renderuj();
    expect(wiersz("Redaktor Testowy").textContent).toContain("data(2026-08-20T12:00:00.000Z|pl)");
  });

  it("po angielsku data sklada sie w jezyku angielskim", () => {
    h.language = "en";
    h.rows = [historyRow({ created_at: "2026-08-20T12:00:00.000Z" })];
    renderuj();
    expect(wiersz("Redaktor Testowy").textContent).toContain("data(2026-08-20T12:00:00.000Z|en)");
  });
});

describe("kto i kogo - wpis zawsze wskazuje autora i podmiot", () => {
  it("autor z nazwiskiem pokazuje nazwisko", () => {
    h.rows = [historyRow({ actor_name: "Redaktor Testowy" })];
    renderuj();
    expect(screen.getByText("Redaktor Testowy")).toBeTruthy();
  });

  it("autor bez nazwiska pokazuje adres pocztowy", () => {
    h.rows = [historyRow({ actor_name: BRAK, actor_email: "redakcja@example.org" })];
    renderuj();
    expect(screen.getByText("redakcja@example.org")).toBeTruthy();
  });

  // WPIS BEZ AUTORA TEZ ZOSTAJE W DZIENNIKU. Trigger zapisuje `auth.uid()`,
  // ktore przy zadaniu serwisowym jest puste - pusty napis czytalby sie jak
  // uszkodzony wiersz, a pominiecie wpisu byloby luka w sladzie.
  it("wpis bez autora mowi o tym wprost, a nie pustka", () => {
    h.rows = [historyRow({ actor_name: BRAK, actor_email: BRAK })];
    renderuj();
    expect(screen.getByText(`${H}actorUnknown`)).toBeTruthy();
  });

  it("podmiot z nazwiskiem wchodzi do zdania podsumowania", () => {
    h.rows = [historyRow({ subject_name: "Anna Kowalska" })];
    renderuj();
    expect(screen.getByText(/subject=Anna Kowalska/)).toBeTruthy();
  });

  it("podmiot bez nazwiska wchodzi adresem pocztowym", () => {
    h.rows = [historyRow({ subject_name: BRAK, subject_email: "anna.kowalska@example.org" })];
    renderuj();
    expect(screen.getByText(/subject=anna\.kowalska@example\.org/)).toBeTruthy();
  });

  it("podmiot nierozpoznany mowi o tym wprost", () => {
    h.rows = [historyRow({ subject_name: BRAK, subject_email: BRAK })];
    renderuj();
    expect(screen.getByText(new RegExp(`subject=${H}subjectUnknown`))).toBeTruthy();
  });

  // ZAKRES NADANIA WCHODZI DO ZDANIA: ulga na jeden kongres i ulga na
  // wszystkie wydarzenia najemcy to dwa rozne uprawnienia.
  it("wpis nadania wydarzenia niesie jego tytul, a wpis bez wydarzenia - napis o calosci", () => {
    h.rows = [
      historyRow({ id: "a", actor_name: "Autor Wydarzenia", event_title: "Kongres" }),
      historyRow({ id: "b", actor_name: "Autor Najemcy", event_title: BRAK }),
    ];
    renderuj();
    expect(wiersz("Autor Wydarzenia").textContent).toContain("scope=Kongres");
    expect(wiersz("Autor Najemcy").textContent).toContain(
      "scope=adminEventRegistration.audienceGrants.scopeAll",
    );
  });

  it("grupa odbiorcow wchodzi do zdania podsumowania", () => {
    h.rows = [historyRow({ audience: "ngo" })];
    renderuj();
    expect(wiersz("Redaktor Testowy").textContent).toContain(
      "audience=adminEventRegistration.audienceGrants.audiences.ngo",
    );
  });
});

describe("diff - obie strony zmiany", () => {
  // AUDYT PYTA „CO SIE ZMIENILO", a nie „co jest teraz". Wpis pokazujacy samo
  // „po" nie tlumaczy niczego: bez wartosci „przed" nie widac, czy podstawe
  // podmieniono, czy dopisano.
  it("zmienione pole pokazuje wartosc przed i po", () => {
    h.rows = [
      historyRow({
        action: "event_audience_grant.updated",
        changed: ["evidence"],
        before_values: { evidence: "Legitymacja 2025" },
        after_values: { evidence: "Legitymacja 2026" },
      }),
    ];
    renderuj();
    const li = wiersz("Redaktor Testowy");
    expect(within(li).getByText("Legitymacja 2025")).toBeTruthy();
    expect(within(li).getByText("Legitymacja 2026")).toBeTruthy();
    expect(within(li).getByText(`${H}fields.evidence`)).toBeTruthy();
  });

  // WARTOSC PUSTA MA WLASNY NAPIS. Puste miejsce w kolumnie „przed" czytaloby
  // sie jak uszkodzony wpis, a nie jak „tego pola wczesniej nie bylo".
  it("wartosc pusta ma wlasny napis po obu stronach", () => {
    h.rows = [
      historyRow({
        action: "event_audience_grant.updated",
        changed: ["valid_until"],
        before_values: { valid_until: null },
        after_values: { valid_until: "2027-06-30" },
      }),
    ];
    renderuj();
    expect(within(wiersz("Redaktor Testowy")).getByText(`${H}emptyValue`)).toBeTruthy();
  });

  it("kilka zmienionych pol daje kilka wierszy diffu", () => {
    h.rows = [
      historyRow({
        action: "event_audience_grant.updated",
        changed: ["evidence", "valid_until"],
        before_values: { evidence: "a", valid_until: "2026-01-01" },
        after_values: { evidence: "b", valid_until: "2027-01-01" },
      }),
    ];
    renderuj();
    const li = wiersz("Redaktor Testowy");
    expect(within(li).getByText(`${H}fields.evidence`)).toBeTruthy();
    expect(within(li).getByText(`${H}fields.valid_until`)).toBeTruthy();
  });

  // WPIS NADANIA NIE MA DIFFU (trigger zapisuje tylko „po"), wiec pusta lista
  // zmian nie moze rysowac pustego pudelka.
  it("wpis bez listy zmian nie rysuje pudelka diffu", () => {
    h.rows = [historyRow({ changed: [] })];
    renderuj();
    expect(within(wiersz("Redaktor Testowy")).queryByText(`${H}fields.evidence`)).toBeNull();
  });

  it("brak listy zmian z bazy nie wywraca wiersza", () => {
    h.rows = [historyRow({ changed: null as unknown as string[] })];
    renderuj();
    expect(wiersz("Redaktor Testowy")).toBeTruthy();
  });
});

describe("dziennik jest tylko do odczytu", () => {
  // WPIS, KTORY DA SIE POPRAWIC ALBO SKASOWAC, NIE JEST SLADEM AUDYTOWYM.
  // Ekran nie moze wiec oferowac ani jednej akcji zmieniajacej.
  it("wiersz dziennika nie ma zadnego przycisku", () => {
    h.rows = [historyRow()];
    renderuj();
    expect(within(wiersz("Redaktor Testowy")).queryAllByRole("button")).toEqual([]);
  });

  it("ekran dziennika nie ma pola do edycji wpisu", () => {
    h.rows = [historyRow()];
    renderuj();
    // Jedyne pola tekstowe to filtry dziennika, a nie tresc wpisu.
    expect(within(wiersz("Redaktor Testowy")).queryAllByRole("textbox")).toEqual([]);
  });
});

describe("widok zagniezdzony - para „samodzielny / w oknie”", () => {
  it("widok samodzielny ma naglowek i przypis o zrodle", () => {
    renderuj();
    expect(screen.getByText(`${H}title`)).toBeTruthy();
    expect(screen.getByText(`${H}footnote`)).toBeTruthy();
  });

  // W OKNIE NAD WIERSZEM NADANIA NAGLOWEK BYLBY DRUGIM TYTULEM tej samej
  // rzeczy kilkadziesiat pikseli od pierwszego.
  it("widok zagniezdzony nie powtarza naglowka ani przypisu", () => {
    renderuj({ embedded: true });
    expect(screen.queryByText(`${H}title`)).toBeNull();
    expect(screen.queryByText(`${H}footnote`)).toBeNull();
  });

  it("widok zagniezdzony NADAL pokazuje wpisy", () => {
    h.rows = [historyRow()];
    renderuj({ embedded: true, grantId: GRANT_ID });
    expect(wiersz("Redaktor Testowy")).toBeTruthy();
  });
});

describe("przycisk wejscia w historie", () => {
  it("niesie podana etykiete i oddaje klikniecie", () => {
    const onClick = vi.fn();
    render(<EventAudienceGrantHistoryButton label="Historia zmian" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Historia zmian" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("dostepnosc", () => {
  it("dziennik z wpisami nie ma naruszen dostepnosci", async () => {
    h.rows = [
      historyRow({
        id: "a",
        action: "event_audience_grant.updated",
        changed: ["evidence"],
        before_values: { evidence: "Legitymacja 2025" },
        after_values: { evidence: "Legitymacja 2026" },
      }),
      historyRow({ id: "b", action: "event_audience_grant.revoked" }),
    ];
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("pusty dziennik nie ma naruszen dostepnosci", async () => {
    h.rows = [];
    const { container } = renderuj();
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("widok jednego nadania nie ma naruszen dostepnosci", async () => {
    h.rows = [historyRow()];
    const { container } = renderuj({ grantId: GRANT_ID, embedded: true });
    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
