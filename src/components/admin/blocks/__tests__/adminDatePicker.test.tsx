// WSPOLNE POLA DATY PANELU (`AdminDatePicker` i `AdminDateTimePicker`).
//
// Jeden plik daje panelowi DWA pola: date (`YYYY-MM-DD`) i date z godzina
// (`YYYY-MM-DDTHH:mm`, czas LOKALNY, bez strefy). Oba maja byc zamiennikami
// `<input type="date">` / `"datetime-local"`, wiec przyjmuja `null` i `""` jako
// pustke i oddaja `null` przy czyszczeniu.
//
// DLACZEGO OSOBNY PLIK. Pola nie mialy zadnego wlasnego przejazdu: wszystkie
// cztery powierzchnie, ktore je renderuja (`/admin/tracker`, panele wygladu,
// `BlockEditRenderer`, `PostListEditor` buildera), zaslaniaja je atrapami, bo
// interesuje je co INNEGO. Skutek: `AdminDatePicker` nie mial ANI JEDNEGO
// wywolania, a `commit` w wariancie z godzina - zadnej sciezki poza szczesliwa.
// Kalendarz w srodku ma juz swoj plik (`adminCalendar.test.tsx`); tutaj dowod
// idzie na to, czego tam nie ma: na GRANICE miedzy kalendarzem a polem
// formularza, czyli na parsowanie wartosci, na format napisu oddawanego
// rodzicowi i na galezie odmowy.
//
// CO MA TU DOWOD
//   * FORMAT WYJSCIOWY JEST LOKALNY, nie ISO/UTC. `toLocalDate` sklada napis
//     z `getFullYear/getMonth/getDate`, wiec data wybrana 6 wrzesnia zostaje
//     szostym wrzesnia takze na wschod od Greenwich - `toISOString()` cofnalby
//     ja o dzien dla polnocnych godzin,
//   * PUSTKA I WARTOSC NIEPARSOWALNA daja podpowiedz, a nie wywrotke ani
//     „Invalid Date" na przycisku,
//   * CZYSZCZENIE oddaje `null` (a nie pusty napis) i jest ZABLOKOWANE, gdy nie
//     ma czego czyscic - guzik, ktory nic nie robi, jest gorszy niz jego brak,
//   * GODZINA BEZ DATY jest niemozliwa: pole czasu jest wylaczone, dopoki data
//     nie istnieje, bo `commit(null, ...)` i tak oddaje `null`,
//   * ODMOWA I WARTOSCI BRZEGOWE GODZINY: pusty napis, godzina bez minut
//     i napis nieliczbowy schodza na `00:00`, a nie na `NaN` w dokumencie,
//   * OBA JEZYKI: etykiety i format daty ida za propsem `lang`, bo ten plik
//     NIE korzysta ze slownikow i18n - ma wpisane napisy w kodzie.
//
// CZEGO TU NIE MA - swiadomie
//   * atrapy `AdminCalendar` ani `@/components/ui/*`. Kalendarz jest prawdziwy,
//     wiec klik w dzien przechodzi cala droge, ktora przejdzie w panelu,
//   * asercji na animacje i pozycjonowanie Popovera (happy-dom nie ma silnika
//     layoutu),
//   * dat rzeczywistych osob ani zdarzen - wszystkie daty sa arbitralne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AdminDatePicker, AdminDateTimePicker } from "@/components/admin/blocks/AdminDatePicker";
import { axeViolations, summarize } from "@/test/axe";

// Czas zamrozony: kalendarz otwarty bez wartosci startuje na „dzisiaj",
// a siatka dni rysuje obwodke dnia biezacego z `new Date()`.
const TERAZ = new Date(2026, 8, 6, 12, 0, 0);

// Napisy pola sa WPISANE W KOD (ten plik nie ma slownika i18n), wiec test
// trzyma je w jednym miejscu - zmiana literki w produkcji ma oblac ten plik.
const PUSTE_PL = "Wybierz datę";
const PUSTE_EN = "Pick a date";
const WYCZYSC_PL = "Wyczyść";
const WYCZYSC_EN = "Clear";
const GODZINA_PL = "Godzina";
const GODZINA_EN = "Time";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

type Zmiana = ReturnType<typeof vi.fn<(v: string | null) => void>>;

function zamontujDate(props: Partial<React.ComponentProps<typeof AdminDatePicker>> = {}) {
  const onChange: Zmiana = vi.fn<(v: string | null) => void>();
  const { container } = render(
    <AdminDatePicker
      value={props.value ?? null}
      onChange={props.onChange ?? onChange}
      {...props}
    />,
  );
  return { onChange: (props.onChange as Zmiana) ?? onChange, container };
}

function zamontujDateGodzine(
  props: Partial<React.ComponentProps<typeof AdminDateTimePicker>> = {},
) {
  const onChange: Zmiana = vi.fn<(v: string | null) => void>();
  const { container } = render(
    <AdminDateTimePicker
      value={props.value ?? null}
      onChange={props.onChange ?? onChange}
      {...props}
    />,
  );
  return { onChange: (props.onChange as Zmiana) ?? onChange, container };
}

/** Wyzwalacz kalendarza. Klasa jest jedynym STALYM uchwytem - nazwa dostepna
 *  tego przycisku to jego tresc, czyli data albo podpowiedz. */
function wyzwalacz(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".admin-date-trigger");
  if (!found) throw new Error("test: nie znaleziono wyzwalacza kalendarza");
  return found;
}

/** Otwiera Popover i oddaje jego zawartosc (Radix renderuje ja w portalu). */
function otworzKalendarz(container: HTMLElement): HTMLElement {
  fireEvent.click(wyzwalacz(container));
  return screen.getByRole("dialog");
}

/**
 * Klika dzien wrzesnia 2026 w siatce kalendarza. Nazwa dostepna dnia idzie
 * z locale react-day-pickera („niedziela, 6 września 2026"), wiec wzorzec musi
 * byc ZAKOTWICZONY na poczatku liczby - inaczej „6 września" lapie tez 16 i 26.
 */
function klikDzien(dialog: HTMLElement, dzien: number): void {
  const wzorzec = new RegExp(`(^|[\\s,])${dzien} września 2026`);
  fireEvent.click(within(dialog).getByRole("button", { name: wzorzec }));
}

function poleGodziny(etykieta = GODZINA_PL): HTMLInputElement {
  return screen.getByLabelText(etykieta) as HTMLInputElement;
}

describe("AdminDatePicker - co widzi redaktor", () => {
  it("PUSTA wartosc daje podpowiedz, a nie napis Invalid Date", () => {
    const { container } = zamontujDate({ value: null });
    expect(wyzwalacz(container)).toHaveTextContent(PUSTE_PL);
  });

  it.each([undefined, null, ""])("wartosc %s jest traktowana jako pustka", (value) => {
    // Trzy rozne postacie „nic" przychodza z trzech roznych warstw: brak pola
    // w JSON-ie, `null` z bazy i pusty napis z formularza.
    const { container } = zamontujDate({ value });
    expect(wyzwalacz(container)).toHaveTextContent(PUSTE_PL);
  });

  it("data jest formatowana po polsku, gdy `lang` jest domyslny", () => {
    const { container } = zamontujDate({ value: "2026-09-06" });
    expect(wyzwalacz(container)).toHaveTextContent("6 wrz 2026");
  });

  it("`lang=en` zmienia i format daty, i podpowiedz, i etykiete czyszczenia", () => {
    const { container } = zamontujDate({ value: "2026-09-06", lang: "en" });
    expect(wyzwalacz(container)).toHaveTextContent("Sep 6, 2026");
    expect(screen.getByRole("button", { name: WYCZYSC_EN })).toBeInTheDocument();
    cleanup();
    const puste = zamontujDate({ value: null, lang: "en" });
    expect(wyzwalacz(puste.container)).toHaveTextContent(PUSTE_EN);
  });

  it("wlasna podpowiedz WYGRYWA z podpowiedzia domyslna", () => {
    const { container } = zamontujDate({ value: null, placeholder: "Data publikacji" });
    expect(wyzwalacz(container)).toHaveTextContent("Data publikacji");
    expect(wyzwalacz(container)).not.toHaveTextContent(PUSTE_PL);
  });

  it("pusty przycisk jest wyszarzony, a przycisk z data - nie", () => {
    // Klasa `text-muted-foreground` jest tu JEDYNYM nosnikiem informacji
    // „pole jeszcze niewypelnione".
    const puste = zamontujDate({ value: null });
    expect(wyzwalacz(puste.container).className).toContain("text-muted-foreground");
    cleanup();
    const pelne = zamontujDate({ value: "2026-09-06" });
    expect(wyzwalacz(pelne.container).className).not.toContain("text-muted-foreground");
  });

  it("wartosc z godzina pokazuje SAMA date - to pole daty, nie daty z czasem", () => {
    const { container } = zamontujDate({ value: "2026-09-06T14:30" });
    expect(wyzwalacz(container)).toHaveTextContent("6 wrz 2026");
    expect(wyzwalacz(container)).not.toHaveTextContent("14:30");
  });

  it("wartosc NIEPARSOWALNA schodzi na podpowiedz zamiast wywracac panel", () => {
    // Import z obcego CMS-a albo recznie poprawiony JSON potrafia wpisac tu
    // dowolny napis. `parseLocalDateTime` oddaje wtedy `null`.
    const { container } = zamontujDate({ value: "nie-data" });
    expect(wyzwalacz(container)).toHaveTextContent(PUSTE_PL);
  });

  it("wartosc POZA formatem ISO, ale zrozumiala dla `Date`, jest pokazywana", () => {
    // Zapasowa sciezka parsowania: wyrazenie regularne nie lapie „2026/09/06",
    // ale `new Date(...)` tak - i tego dnia nie wolno zgubic.
    const { container } = zamontujDate({ value: "2026/09/06" });
    expect(wyzwalacz(container)).toHaveTextContent("6 wrz 2026");
  });

  it("wlasna `aria-label` idzie na wyzwalacz - bez niej nazwa to sama data", () => {
    const { container } = zamontujDate({ value: "2026-09-06", "aria-label": "Data publikacji" });
    expect(screen.getByRole("button", { name: "Data publikacji" })).toBe(wyzwalacz(container));
  });

  it("wlasna klasa dokleja sie do korzenia pola", () => {
    const { container } = zamontujDate({ value: null, className: "moja-klasa-testowa" });
    expect(container.firstElementChild?.className).toContain("moja-klasa-testowa");
  });

  it("`triggerClassName` dokleja sie do samego wyzwalacza", () => {
    const { container } = zamontujDate({ value: null, triggerClassName: "klasa-wyzwalacza" });
    expect(wyzwalacz(container).className).toContain("klasa-wyzwalacza");
  });
});

describe("AdminDatePicker - wybor dnia i czyszczenie", () => {
  it("klik w dzien oddaje date LOKALNIE (YYYY-MM-DD) i zamyka kalendarz", () => {
    const { container, onChange } = zamontujDate({ value: "2026-09-06" });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 20);
    expect(onChange).toHaveBeenCalledWith("2026-09-20");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kalendarz otwarty BEZ wartosci startuje na dzisiejszym miesiacu", () => {
    // Bez daty w polu `parsed` jest puste, wiec kalendarz nie ma czego pokazac
    // poza „dzisiaj" - inaczej redaktor ladowalby w styczniu roku zerowego.
    const { container, onChange } = zamontujDate({ value: null });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 10);
    expect(onChange).toHaveBeenCalledWith("2026-09-10");
  });

  it("czyszczenie oddaje `null`, a nie pusty napis", () => {
    // Rozroznienie nosne: `null` znaczy „pole puste", a pusty napis przeszedlby
    // do dokumentu jako wartosc.
    const { container, onChange } = zamontujDate({ value: "2026-09-06" });
    fireEvent.click(within(container).getByRole("button", { name: WYCZYSC_PL }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("czyszczenie jest ZABLOKOWANE, gdy pole jest puste", () => {
    const { container } = zamontujDate({ value: null });
    expect(within(container).getByRole("button", { name: WYCZYSC_PL })).toBeDisabled();
  });

  it("`clearable=false` w ogole nie renderuje guzika czyszczenia", () => {
    const { container } = zamontujDate({ value: "2026-09-06", clearable: false });
    expect(within(container).queryByRole("button", { name: WYCZYSC_PL })).toBeNull();
  });

  it("`disabled` blokuje OBA guziki, takze przy wypelnionym polu", () => {
    const { container } = zamontujDate({ value: "2026-09-06", disabled: true });
    expect(wyzwalacz(container)).toBeDisabled();
    expect(within(container).getByRole("button", { name: WYCZYSC_PL })).toBeDisabled();
  });

  it("STAN DZIS: klik w JUZ WYBRANY dzien czysci pole", () => {
    // `react-day-picker` w trybie `mode="single"` bez propu `required`
    // odznacza dzien, w ktory kliknieto po raz drugi, i oddaje `undefined`.
    // Pole zamienia to na `null`, czyli na wyczyszczenie wartosci - defekt
    // zarejestrowany przy kalendarzu (`adminCalendar.test.tsx`, sekcja
    // o odznaczaniu). Tu przypinam KONSEKWENCJE na poziomie pola, zeby
    // naprawa w kalendarzu byla widoczna takze stad.
    const { container, onChange } = zamontujDate({ value: "2026-09-06" });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 6);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("pole daty nie wnosi naruszen dostepnosci", async () => {
    const { container } = zamontujDate({ value: "2026-09-06", "aria-label": "Data publikacji" });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("AdminDateTimePicker - data i godzina razem", () => {
  it("PUSTE pole ma pusta godzine i WYLACZONE pole godziny", () => {
    // Godzina bez daty nie ma sensu - `commit(null, ...)` i tak oddalby `null`.
    const { container } = zamontujDateGodzine({ value: null });
    expect(wyzwalacz(container)).toHaveTextContent(PUSTE_PL);
    expect(poleGodziny().value).toBe("");
    expect(poleGodziny()).toBeDisabled();
  });

  it("wartosc z godzina rozklada sie na przycisk daty i pole godziny", () => {
    const { container } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    expect(wyzwalacz(container)).toHaveTextContent("6 wrz 2026");
    expect(poleGodziny().value).toBe("14:30");
    expect(poleGodziny()).toBeEnabled();
  });

  it("jednocyfrowe skladniki daty i godziny sa DOPELNIANE zerem", () => {
    // `pad` istnieje wlasnie dlatego, ze „2026-1-2T3:4" nie jest poprawnym
    // `datetime-local` i nie wroci z bazy jako ta sama chwila.
    const { onChange } = zamontujDateGodzine({ value: "2026-01-02T13:14" });
    expect(poleGodziny().value).toBe("13:14");
    fireEvent.change(poleGodziny(), { target: { value: "03:04" } });
    expect(onChange).toHaveBeenCalledWith("2026-01-02T03:04");
  });

  it("zmiana godziny ZOSTAWIA date nietknieta", () => {
    const { onChange } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    fireEvent.change(poleGodziny(), { target: { value: "07:05" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-06T07:05");
  });

  it("PUSTA godzina schodzi na polnoc, a nie na `NaN` w dokumencie", () => {
    const { onChange } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    fireEvent.change(poleGodziny(), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-06T00:00");
  });

  it("godzina ODRZUCONA przez pole (napis nie-godzina) schodzi na polnoc, nie na `NaN`", () => {
    // GRANICA POMIARU, zapisana swiadomie: `<input type="time">` normalizuje
    // wartosc niepoprawna do PUSTEGO napisu - i tak samo robi przegladarka,
    // i tak samo robi happy-dom. Do `commit` nie dojedzie wiec ani „9", ani
    // „aa:bb", tylko `""`, ktore lapie straznik `time || "00:00"`. Drugi
    // straznik w tej samej linii (`Number(h) || 0` i domyslne minuty)
    // jest z tego pola NIEOSIAGALNY - zostaje obrona przed wywolaniem
    // `commit` z kodu, nie z interfejsu, i dlatego nie udaje tu testu.
    const { onChange } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    fireEvent.change(poleGodziny(), { target: { value: "aa:bb" } });
    const oddane = onChange.mock.calls.at(-1)?.[0];
    expect(oddane).toBe("2026-09-06T00:00");
    expect(String(oddane)).not.toContain("NaN");
  });

  it("wybor dnia PRZY ustawionej godzinie zachowuje te godzine", () => {
    const { container, onChange } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 20);
    expect(onChange).toHaveBeenCalledWith("2026-09-20T14:30");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wybor dnia przy PUSTYM polu ustawia polnoc", () => {
    const { container, onChange } = zamontujDateGodzine({ value: null });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 20);
    expect(onChange).toHaveBeenCalledWith("2026-09-20T00:00");
  });

  it("STAN DZIS: klik w JUZ WYBRANY dzien czysci cala wartosc, razem z godzina", () => {
    // Ta sama sciezka odznaczenia co w polu daty, tylko przechodzi przez
    // `commit(null, ...)`, ktory oddaje `null` bez sklejania godziny.
    const { container, onChange } = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    const dialog = otworzKalendarz(container);
    klikDzien(dialog, 6);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("czyszczenie oddaje `null` i jest zablokowane przy pustym polu", () => {
    const pelne = zamontujDateGodzine({ value: "2026-09-06T14:30" });
    fireEvent.click(within(pelne.container).getByRole("button", { name: WYCZYSC_PL }));
    expect(pelne.onChange).toHaveBeenCalledWith(null);
    cleanup();
    const puste = zamontujDateGodzine({ value: null });
    expect(within(puste.container).getByRole("button", { name: WYCZYSC_PL })).toBeDisabled();
  });

  it("`clearable=false` zdejmuje guzik czyszczenia i szerszy uklad kolumn", () => {
    const { container } = zamontujDateGodzine({ value: "2026-09-06T14:30", clearable: false });
    expect(within(container).queryByRole("button", { name: WYCZYSC_PL })).toBeNull();
    expect(container.firstElementChild?.className).not.toContain("sm:grid-cols");
  });

  it("`disabled` blokuje wyzwalacz, godzine i czyszczenie naraz", () => {
    const { container } = zamontujDateGodzine({ value: "2026-09-06T14:30", disabled: true });
    expect(wyzwalacz(container)).toBeDisabled();
    expect(poleGodziny()).toBeDisabled();
    expect(within(container).getByRole("button", { name: WYCZYSC_PL })).toBeDisabled();
  });

  it("`lang=en` zmienia etykiety godziny, czyszczenia i format daty", () => {
    const { container } = zamontujDateGodzine({ value: "2026-09-06T14:30", lang: "en" });
    expect(wyzwalacz(container)).toHaveTextContent("Sep 6, 2026");
    expect(screen.getByLabelText(GODZINA_EN)).toBeInTheDocument();
    expect(within(container).getByRole("button", { name: WYCZYSC_EN })).toBeInTheDocument();
  });

  it("wlasna podpowiedz i `aria-label` dzialaja tak samo jak w polu daty", () => {
    const { container } = zamontujDateGodzine({
      value: null,
      placeholder: "Start wydarzenia",
      "aria-label": "Termin",
      triggerClassName: "klasa-wyzwalacza",
      className: "moja-klasa-testowa",
    });
    expect(screen.getByRole("button", { name: "Termin" })).toHaveTextContent("Start wydarzenia");
    expect(wyzwalacz(container).className).toContain("klasa-wyzwalacza");
    expect(container.firstElementChild?.className).toContain("moja-klasa-testowa");
  });

  it("wartosc NIEPARSOWALNA daje podpowiedz i wylaczone pole godziny", () => {
    const { container } = zamontujDateGodzine({ value: "nie-data" });
    expect(wyzwalacz(container)).toHaveTextContent(PUSTE_PL);
    expect(poleGodziny()).toBeDisabled();
  });

  it("pole daty z godzina nie wnosi naruszen dostepnosci", async () => {
    const { container } = zamontujDateGodzine({
      value: "2026-09-06T14:30",
      "aria-label": "Termin",
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
