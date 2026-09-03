// `TimeRangeFilter` - okno czasowe wspólne dla wszystkich pulpitów BI.
//
// PO CO. Plik stał na 0/28 linii, a jest JEDYNYM źródłem granic czasu dla
// zapytań `runGa4Report`, `getClientErrorsReport`, `resolveWindow` i całej
// reszty. To nie jest kontrolka ozdobna - to parametr POMIARU:
//
//   1. PRESET MUSI ZNACZYĆ TO, CO OBIECUJE. „7 dni" liczy się jako 7 * 24 h
//      wstecz od teraz. Pomyłka o czynnik (godziny zamiast dni, 1000 zamiast
//      3 600 000) nie wywala niczego na ekranie - zmienia LICZBY na kafelkach,
//      a operator porównuje je potem z GA4 i widzi „rozjazd danych".
//   2. ZAKRES WŁASNY MUSI DOMYKAĆ DOBĘ. Kalendarz oddaje daty, nie chwile;
//      bez normalizacji do 00:00:00 / 23:59:59.999 raport za „1-7 sierpnia"
//      gubiłby ostatni dzień prawie w całości. Ta normalizacja jest LOKALNA
//      (strefa przeglądarki), a wynik jedzie na serwer jako ISO - dlatego test
//      liczy oczekiwane granice tą samą arytmetyką kalendarzową, a nie sklejoną
//      stałą z „Z" na końcu, która przechodziłaby tylko w UTC.
//   3. JEDNO ZDARZENIE NA WYBÓR, NIE JEDNO NA KLIK. Wybór dnia w kalendarzu
//      NIE MOŻE wołać `onChange` - każde wołanie to nowa runda zapytań do GA4
//      i Supabase dla całego pulpitu. Zmiana dociera do wołającego dopiero
//      pod „Zastosuj".
//   4. OBSŁUGA KLAWIATURĄ. Presety to prawdziwe przyciski ze stanem
//      `aria-pressed`, a nie divy z `onClick`.
//
// ZEGAR JEST ZAMROŻONY. `buildPresetRange` woła `Date.now()`, więc bez fałszywych
// zegarów asercja o granicach okna mierzyłaby czas wykonania testu.
//
// ECHARTS TU NIE WCHODZI - filtr nie dotyka renderera wykresów.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { TimeRangeFilter, buildPresetRange, type TimeRangeValue } from "../TimeRangeFilter";

/** Środa, 12 sierpnia 2026, 10:30 UTC - punkt odniesienia dla całego pliku. */
const TERAZ = new Date("2026-08-12T10:30:00.000Z");
const GODZINA_MS = 3_600_000;

const PRESETY = [
  { id: "24h", godziny: 24, dni: 1, klucz: "adminAnalytics.timeRange.preset24h" },
  { id: "7d", godziny: 24 * 7, dni: 7, klucz: "adminAnalytics.timeRange.preset7d" },
  { id: "30d", godziny: 24 * 30, dni: 30, klucz: "adminAnalytics.timeRange.preset30d" },
  { id: "90d", godziny: 24 * 90, dni: 90, klucz: "adminAnalytics.timeRange.preset90d" },
] as const;

function filtr(value: TimeRangeValue, onChange = vi.fn()) {
  const wynik = render(<TimeRangeFilter value={value} onChange={onChange} />);
  return { ...wynik, onChange };
}

/** Przycisk otwierający kalendarz - jedyny z ikoną i etykietą „Zakres". */
function przyciskZakresu(): HTMLElement {
  return screen.getByRole("button", {
    name: realT(i18n.language === "en" ? "en" : "pl")("adminAnalytics.timeRange.range"),
  });
}

/**
 * Klika dzień o podanym numerze w kalendarzu. `react-day-picker` trzyma klikalny
 * przycisk WEWNĄTRZ komórki siatki - kliknięcie samej komórki nic nie wybiera.
 * Miesięcy jest dwa, więc numer dnia bywa niejednoznaczny: `ktory` wskazuje,
 * z którego miesiąca wziąć wystąpienie.
 */
function klikDzien(numer: number, ktory = 0) {
  const komorki = screen.getAllByRole("gridcell", { name: String(numer) });
  const komorka = komorki[ktory];
  fireEvent.click(komorka.querySelector("button") ?? komorka);
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---------------------------------------------------------------------------

describe("buildPresetRange - arytmetyka okna", () => {
  it.each(PRESETY)(
    "preset $id daje okno $godziny h zakończone TERAZ i $dni dni w etykiecie",
    ({ id, godziny, dni }) => {
      const zakres = buildPresetRange(id);

      expect(zakres.presetId).toBe(id);
      expect(zakres.untilIso).toBe(TERAZ.toISOString());
      expect(new Date(zakres.sinceIso).getTime()).toBe(TERAZ.getTime() - godziny * GODZINA_MS);
      expect(zakres.days).toBe(dni);
    },
  );

  it("granice są rosnące i zapisane jako ISO w UTC (kontrakt z serwerem)", () => {
    const zakres = buildPresetRange("30d");

    expect(zakres.sinceIso < zakres.untilIso).toBe(true);
    // Serwerowe funkcje parsują to `new Date(...)`; format ze strefą lokalną
    // („2026-08-12T12:30:00+02:00") przeszedłby parser, ale rozjechałby
    // porównania stringowe w cache'u zapytań.
    expect(zakres.sinceIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(zakres.untilIso).toMatch(/Z$/);
  });

  it("dwa wywołania w tej samej chwili dają IDENTYCZNE okno", () => {
    // Pulpity trzymają wynik w `useState(() => buildPresetRange("7d"))`, a
    // porównują go potem z oknem poprzednim - niedeterminizm dałby fałszywe
    // „dane się zmieniły" przy każdym renderze.
    expect(buildPresetRange("7d")).toEqual(buildPresetRange("7d"));
  });
});

describe("TimeRangeFilter - presety", () => {
  it("rysuje wszystkie cztery presety ze słownika, w kolejności rosnącej", () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));

    const napisy = PRESETY.map((p) => t(p.klucz));
    for (const napis of napisy) expect(screen.getByRole("button", { name: napis })).toBeTruthy();
    // Kolejność w DOM = kolejność w tablicy PRESETS; odwrócona myli oko.
    const wszystkie = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((tekst) => napisy.includes(tekst));
    expect(wszystkie).toEqual(napisy);
  });

  it.each(PRESETY)("klik w preset $id melduje DOKŁADNIE to okno, raz", ({ id, godziny, klucz }) => {
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));

    fireEvent.click(screen.getByRole("button", { name: t(klucz) }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    expect(oddane.presetId).toBe(id);
    expect(new Date(oddane.untilIso).getTime() - new Date(oddane.sinceIso).getTime()).toBe(
      godziny * GODZINA_MS,
    );
  });

  it("aktywny preset jest WCIŚNIĘTY, a pozostałe nie - dla czytnika też", () => {
    const t = realT("pl");
    filtr(buildPresetRange("30d"));

    for (const p of PRESETY) {
      const przycisk = screen.getByRole("button", { name: t(p.klucz) });
      expect(przycisk.getAttribute("aria-pressed")).toBe(String(p.id === "30d"));
    }
  });

  it("przy zakresie własnym ŻADEN preset nie jest wciśnięty", () => {
    const t = realT("pl");
    filtr({
      presetId: "custom",
      sinceIso: "2026-08-01T00:00:00.000Z",
      untilIso: "2026-08-07T23:59:59.999Z",
      days: 7,
    });

    for (const p of PRESETY) {
      expect(screen.getByRole("button", { name: t(p.klucz) }).getAttribute("aria-pressed")).toBe(
        "false",
      );
    }
  });

  it("presety to PRZYCISKI type=button - w formularzu nie wyślą strony", () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));

    for (const p of PRESETY) {
      expect(screen.getByRole("button", { name: t(p.klucz) }).getAttribute("type")).toBe("button");
    }
  });

  it("preset da się uruchomić KLAWIATURĄ - Enter i spacja, bez myszy", () => {
    // `<button>` robi to za nas, ale tylko dopóki pozostaje przyciskiem;
    // podmiana na `<div onClick>` przy refaktorze psuje to bez śladu w wyglądzie.
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));

    const przycisk = screen.getByRole("button", { name: t("adminAnalytics.timeRange.preset90d") });
    przycisk.focus();
    expect(document.activeElement).toBe(przycisk);
    // happy-dom nie syntetyzuje kliknięcia z klawisza, więc mierzymy to, co
    // przeglądarka mierzy naprawdę: element jest fokusowalny i jest przyciskiem
    // o domyślnej aktywacji, a nie kontenerem z nasłuchem myszy.
    expect(przycisk.tagName).toBe("BUTTON");
    fireEvent.click(przycisk);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("TimeRangeFilter - etykieta i wybór zakresu własnego", () => {
  it("przy presecie przycisk kalendarza mówi Zakres, a nie datami", () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));

    expect(screen.getByRole("button", { name: t("adminAnalytics.timeRange.range") })).toBeTruthy();
  });

  it("przy zakresie własnym przycisk pokazuje OBIE granice, z rokiem na końcu", () => {
    filtr({
      presetId: "custom",
      sinceIso: new Date(2026, 7, 3, 0, 0, 0, 0).toISOString(),
      untilIso: new Date(2026, 7, 9, 23, 59, 59, 999).toISOString(),
      days: 7,
    });

    // Format „d MMM - d MMM yyyy" w locale `pl` (miesiąc skrótem, po polsku).
    expect(screen.getByRole("button", { name: /3 sie\s*-\s*9 sie 2026/ })).toBeTruthy();
  });

  it("kalendarz otwiera się dopiero po kliknięciu - nie stoi otwarty", async () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));

    expect(screen.queryByText(t("adminAnalytics.timeRange.pickHint"))).toBeNull();

    fireEvent.click(przyciskZakresu());

    expect(await screen.findByText(t("adminAnalytics.timeRange.pickHint"))).toBeTruthy();
  });

  it("przed pierwszym kliknięciem w kalendarz Zastosuj jest ZABLOKOWANY", async () => {
    // Bez tej blokady „Zastosuj" na pustym szkicu byłby przyciskiem, który nic
    // nie robi - a użytkownik czeka na przeładowanie pulpitu.
    const t = realT("pl");
    filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());

    expect(
      await screen.findByRole("button", { name: t("adminAnalytics.timeRange.apply") }),
    ).toBeDisabled();
  });

  it("wybór dni NIE woła `onChange` - dopiero Zastosuj melduje zmianę, raz", async () => {
    // To jest odpowiednik „nie na każde naciśnięcie klawisza": każde wołanie
    // `onChange` przeładowuje CAŁY pulpit (GA4 + Supabase + przeliczenie
    // wniosków). Trzy kliknięcia w kalendarzu to zero zapytań.
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    klikDzien(3);
    klikDzien(9);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("zastosowany zakres DOMYKA dobę: od 00:00:00.000 do 23:59:59.999 lokalnie", async () => {
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    klikDzien(3);
    klikDzien(9);
    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));

    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    // Oczekiwane granice liczone TĄ SAMĄ arytmetyką kalendarzową (lokalną),
    // żeby test nie zakładał, że proces stoi w UTC.
    expect(oddane.sinceIso).toBe(new Date(2026, 7, 3, 0, 0, 0, 0).toISOString());
    expect(oddane.untilIso).toBe(new Date(2026, 7, 9, 23, 59, 59, 999).toISOString());
    expect(oddane.presetId).toBe("custom");
    expect(oddane.days).toBe(7);
  });

  it("JEDEN klik daje zakres jednodniowy, a nie zerowy", async () => {
    // `react-day-picker` w trybie `range` domyka zakres już przy pierwszym
    // kliknięciu (`{ from: d, to: d }`), więc ta ścieżka jest najczęstsza:
    // operator klika jeden dzień i zatwierdza. `Math.ceil` z 86 399 999 ms daje
    // 1; regresja na `Math.floor` dałaby 0, czyli okno „za zero dni" w etykiecie
    // i w pytaniu o poprzedni okres.
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    klikDzien(5);
    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));

    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    expect(oddane.days).toBe(1);
    expect(new Date(oddane.sinceIso).getDate()).toBe(5);
    expect(new Date(oddane.untilIso).getDate()).toBe(5);
    // Doba jest DOMKNIĘTA - inaczej raport za jeden dzień byłby pusty.
    expect(new Date(oddane.untilIso).getTime() - new Date(oddane.sinceIso).getTime()).toBe(
      86_399_999,
    );
  });

  it("koniec wybrany PRZED początkiem zostaje odwrócony, nie oddany na wspak", async () => {
    // Odwrócone okno (`sinceIso > untilIso`) to zapytanie, które w PostgREST i
    // w GA4 zwraca PUSTY zbiór - pulpit narysowałby zera jako zmierzony brak
    // ruchu. Kolejność klików nie może o tym decydować.
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    klikDzien(20);
    klikDzien(4);
    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));

    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    expect(oddane.sinceIso < oddane.untilIso).toBe(true);
    expect(new Date(oddane.sinceIso).getDate()).toBe(4);
    expect(new Date(oddane.untilIso).getDate()).toBe(20);
    expect(oddane.days).toBe(17);
  });

  it("podgląd pod kalendarzem pokazuje wybrany zakres, zanim go zatwierdzisz", async () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    klikDzien(3);
    klikDzien(9);

    expect(screen.getByText(/3 sie 2026\s*-\s*9 sie 2026/)).toBeTruthy();
    expect(screen.queryByText(t("adminAnalytics.timeRange.pickHint"))).toBeNull();
  });

  it("Anuluj zamyka kalendarz i NIE melduje niczego wołającemu", async () => {
    const t = realT("pl");
    const { onChange } = filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));
    klikDzien(3);
    klikDzien(9);

    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));

    await waitFor(() => expect(screen.queryByText(t("adminAnalytics.timeRange.apply"))).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Anuluj CZYŚCI szkic - po ponownym otwarciu kalendarz jest pusty", async () => {
    const t = realT("pl");
    filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));
    klikDzien(3);
    klikDzien(9);
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByText(t("adminAnalytics.timeRange.apply"))).toBeNull());

    fireEvent.click(przyciskZakresu());

    // Podpowiedź wraca = szkic wyczyszczony, „Zastosuj" znów zablokowany.
    expect(await screen.findByText(t("adminAnalytics.timeRange.pickHint"))).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }),
    ).toBeDisabled();
  });

  it("wartość custom z zewnątrz zasiewa kalendarz - nie trzeba klikać od nowa", async () => {
    const t = realT("pl");
    filtr({
      presetId: "custom",
      sinceIso: new Date(2026, 7, 3, 0, 0, 0, 0).toISOString(),
      untilIso: new Date(2026, 7, 9, 23, 59, 59, 999).toISOString(),
      days: 7,
    });

    fireEvent.click(screen.getByRole("button", { name: /3 sie\s*-\s*9 sie 2026/ }));

    expect(await screen.findByText(/3 sie 2026\s*-\s*9 sie 2026/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }),
    ).not.toBeDisabled();
  });

  it("ODWRÓCONA wartość z zewnątrz wychodzi przez Zastosuj UPORZĄDKOWANA", async () => {
    // `buildCustomRange` PORZĄDKUJE granice, bo szkic jest zasiewany wprost
    // z `value`, a `value` przychodzi nie tylko z kalendarza: z przywrócenia
    // stanu z adresu URL, z migracji zapisanego filtra, z literówki
    // w pulpicie. Bez tej bariery wystarczyło okno na wspak, żeby przycisk
    // „Zastosuj" oddał `sinceIso` PÓŹNIEJSZY niż `untilIso` oraz `days: 1` -
    // okno, które w każdym zapytaniu zwraca pustkę, a w etykiecie kłamie
    // o długości. Sam kalendarz takiego zakresu nie wyprodukuje
    // (`addToRange` porządkuje granice), więc jedyne miejsce, gdzie ta
    // bariera może stanąć, to `buildCustomRange` - i ten przypadek tego
    // pilnuje na wejściu, którego kalendarz nie kontroluje.
    const t = realT("pl");
    const { onChange } = filtr({
      presetId: "custom",
      sinceIso: new Date(2026, 7, 20, 0, 0, 0, 0).toISOString(),
      untilIso: new Date(2026, 7, 4, 23, 59, 59, 999).toISOString(),
      days: 17,
    });

    fireEvent.click(screen.getByRole("button", { name: /20 sie\s*-\s*4 sie 2026/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminAnalytics.timeRange.apply") }),
    );

    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    expect(oddane.sinceIso < oddane.untilIso).toBe(true);
  });
});

describe("TimeRangeFilter - dwujęzyczność i dostępność", () => {
  it("etykiety presetów i kalendarza przychodzą ZE SŁOWNIKA w EN", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const en = realT("en");
    const pl = realT("pl");
    // Zabezpieczenie przed testem, który przechodzi na polskim fallbacku.
    expect(en("adminAnalytics.timeRange.preset7d")).not.toBe(
      pl("adminAnalytics.timeRange.preset7d"),
    );

    filtr(buildPresetRange("7d"));

    for (const p of PRESETY) expect(screen.getByRole("button", { name: en(p.klucz) })).toBeTruthy();
    expect(screen.getByRole("button", { name: en("adminAnalytics.timeRange.range") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: pl("adminAnalytics.timeRange.preset24h") })).toBe(
      null,
    );
  });

  it("etykieta zakresu własnego jest formatowana LOKALNIE dla języka", async () => {
    const wartosc: TimeRangeValue = {
      presetId: "custom",
      sinceIso: new Date(2026, 7, 3, 0, 0, 0, 0).toISOString(),
      untilIso: new Date(2026, 7, 9, 23, 59, 59, 999).toISOString(),
      days: 7,
    };
    const { unmount } = filtr(wartosc);
    expect(screen.getByRole("button", { name: /3 sie/ })).toBeTruthy();
    unmount();

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    filtr(wartosc);

    // `enGB` z date-fns: „Aug", nie „sie".
    expect(screen.getByRole("button", { name: /3 Aug\s*-\s*9 Aug 2026/ })).toBeTruthy();
  });

  it("zwinięty filtr nie wnosi naruszeń axe", async () => {
    const { container } = filtr(buildPresetRange("7d"));

    const naruszenia = await axeViolations(container);
    expect(summarize(naruszenia)).toBe("");
  });

  it("otwarty kalendarz jest czysty w axe poza nazwą samej warstwy", async () => {
    // `aria-dialog-name` wyłączone ŚWIADOMIE i tylko tutaj - brak nazwy warstwy
    // jest osobnym, przypiętym niżej defektem. Reszta (siatka, przyciski
    // nawigacji miesiąca, etykiety dni) musi być czysta bez ulg.
    const t = realT("pl");
    filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    const naruszenia = await axeViolations(document.body, {
      "aria-dialog-name": { enabled: false },
    });
    expect(summarize(naruszenia)).toBe("");
  });

  it("otwarta warstwa kalendarza jest czysta w axe - `role=dialog` MA nazwę", async () => {
    // Radiksowy `PopoverContent` renderuje `role="dialog"`. Rola okna
    // dialogowego bez nazwy jest dla czytnika ekranu ogłaszana jako samo
    // „dialog" - osoba niewidząca nie wiedziałaby, że wylądowała w wyborze
    // zakresu dat, a nie w menu. Nazwa idzie ze słownika, z klucza dedykowanego
    // tej warstwie (`adminAnalytics.timeRange.calendarDialog` -
    // „Wybór zakresu dat"), a nie z `timeRange.range` („Zakres"), który jest
    // etykietą PRZYCISKU otwierającego i sam nie mówi, co jest w środku.
    // Ta asercja różni się od poprzedniej JEDNĄ rzeczą: nie wyłącza reguły
    // `aria-dialog-name`, więc przechodzi tylko wtedy, gdy nazwa naprawdę jest.
    // Ten sam mechanizm zamyka menu eksportu w `ChartCard`.
    const t = realT("pl");
    filtr(buildPresetRange("7d"));
    fireEvent.click(przyciskZakresu());
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));

    const naruszenia = await axeViolations(document.body);
    expect(summarize(naruszenia)).toBe("");
  });
});

describe("TimeRangeFilter - izolacja instancji", () => {
  it("dwa filtry obok siebie nie mieszają sobie stanu ani wołań", async () => {
    // Pulpit warsztatu A i pulpit warsztatu B potrafią stać na jednej stronie
    // (zakładki panelu). Filtr jest bezstanowy względem `value`, ale szkic
    // kalendarza już nie - gdyby przeciekł, operator zatwierdziłby w panelu B
    // zakres wyklikany w panelu A.
    const t = realT("pl");
    const naA = vi.fn();
    const naB = vi.fn();
    render(
      <>
        <div data-testid="warsztat-a">
          <TimeRangeFilter value={buildPresetRange("7d")} onChange={naA} />
        </div>
        <div data-testid="warsztat-b">
          <TimeRangeFilter value={buildPresetRange("30d")} onChange={naB} />
        </div>
      </>,
    );

    const a = within(screen.getByTestId("warsztat-a"));
    const b = within(screen.getByTestId("warsztat-b"));

    // Stan wciśnięcia jest liczony z WŁASNEGO `value`, nie ze wspólnego modułu.
    expect(a.getByRole("button", { name: t("adminAnalytics.timeRange.preset7d") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(b.getByRole("button", { name: t("adminAnalytics.timeRange.preset7d") })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(a.getByRole("button", { name: t("adminAnalytics.timeRange.preset90d") }));

    expect(naA).toHaveBeenCalledTimes(1);
    expect(naB).not.toHaveBeenCalled();
  });
});
