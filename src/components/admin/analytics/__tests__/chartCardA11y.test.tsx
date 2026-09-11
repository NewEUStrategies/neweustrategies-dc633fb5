// Dostępność kart wykresów BI - co należy do KARTY, a co do silnika.
//
// CO SIĘ ZMIENIŁO. Karta rysowała wcześniej kanwę ECharts, czyli dla czytnika
// ekranu pusty prostokąt, i sama dokładała wokół niej całą obudowę
// dostępności: rolę „obrazek", nazwę z tytułu oraz tabelę danych zbudowaną
// z `csv` i powiązaną przez `aria-describedby`. Ta obudowa była konieczna,
// dopóki rysunek nie umiał o sobie nic powiedzieć.
//
// Dziś rysuje nasz silnik, a ten oddaje region z własną nazwą, opis obsługi
// klawiatury i tabelę danych przy KAŻDYM rodzaju - bez pytania wywołującego
// o zgodę i bez możliwości pominięcia. Karta przestała więc być dostawcą
// alternatywy tekstowej i jest dostawcą JEDNEJ RZECZY: nazwy rysunku
// zbudowanej z tytułu karty. Ten plik pilnuje dokładnie tej granicy, bo obie
// jej strony da się złamać po cichu: karta może przestać podawać nazwę
// (wszystkie wykresy pulpitu nazwą się wtedy „Wykres"), albo zacząć rysować
// DRUGĄ tabelę i drugą rolę obrazka - czyli ogłaszać ten sam wykres dwa razy.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-analytics";
import { ChartCard, type ChartCardProps } from "../ChartCard";
import { biChart } from "../biChart";

const CSV: NonNullable<ChartCardProps["csv"]> = {
  filename: "views.csv",
  headers: ["Dzien", "Odslony"],
  rows: [
    ["2026-08-01", 1200],
    ["2026-08-02", 1580],
  ],
};

const KONFIGURACJA = biChart({
  kind: "line",
  categories: ["2026-08-01", "2026-08-02"],
  series: [{ name: "Odsłony", values: [1200, 1580] }],
});

const t = realT("pl");

/** Nazwa regionu, którą karta buduje z tytułu. */
function nazwa(tytul: string): string {
  return t("adminAnalytics.chartCard.chartRegion", { title: tytul });
}

describe("ChartCard - dostępność", () => {
  it("opisuje region wykresu nazwą zbudowaną z tytułu karty", () => {
    render(<ChartCard title="Odsłony wpisów" config={KONFIGURACJA} />);

    // NAZWA Z KARTY, nie z konfiguracji: konfiguracja ma tytuł PUSTY, żeby
    // nagłówek nie stał nad rysunkiem dwa razy. Bez tej właściwości wszystkie
    // wykresy pulpitu nazywałyby się „Wykres", czyli czytnik ekranu ogłaszałby
    // dziesięć nierozróżnialnych obrazków.
    expect(screen.getByLabelText(nazwa("Odsłony wpisów"))).toBeTruthy();
  });

  it("nie owija rysunku DRUGĄ rolą obrazka", () => {
    const { container } = render(<ChartCard title="Odsłony wpisów" config={KONFIGURACJA} />);

    // Rysunek silnika sam nosi rolę i nazwę. Karta stawiała ją dodatkowo na
    // swoim kontenerze (kanwa ECharts nie miała żadnej), a dwie role „obrazek"
    // jedna w drugiej to ten sam wykres ogłoszony dwa razy.
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it("tabelę danych rysuje SILNIK - jedna na kartę, nie dwie", () => {
    render(<ChartCard title="Odsłony wpisów" config={KONFIGURACJA} csv={CSV} />);

    // `csv` zostaje WYŁĄCZNIE źródłem eksportu. Karta budowała z niego własną
    // tabelę; obok tabeli silnika byłyby to te same liczby dwa razy, a przy
    // rozjeździe - dwie odpowiedzi na to samo pytanie.
    // Szukamy po DOM, a nie po roli: tabela siedzi w panelu zwiniętym
    // (`hidden`), więc do drzewa dostępności wchodzi dopiero po rozwinięciu -
    // i to jest właściwe zachowanie, bo osiem tabel rozwiniętych naraz
    // zasypałoby pulpit.
    const tabele = document.querySelectorAll("table");
    expect(tabele).toHaveLength(1);
    const naglowki = [...tabele[0].querySelectorAll("thead th")].map((th) => th.textContent);
    expect(naglowki).toEqual([t("charts.frame.category"), "Odsłony"]);
    expect(within(tabele[0] as HTMLElement).getByText("2026-08-02")).toBeTruthy();
  });

  it("region niesie opis obsługi, a wskazany identyfikator istnieje", () => {
    render(<ChartCard title="Odsłony wpisów" config={KONFIGURACJA} />);

    // Sam atrybut bez elementu jest gorszy niż jego brak: czytnik obiecuje
    // opis i milknie.
    const region = screen.getByLabelText(nazwa("Odsłony wpisów"));
    const opis = region.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(opis)).toBeTruthy();
  });

  it("konfiguracja bez danych nie zmyśla rysunku ani tabeli", () => {
    render(
      <ChartCard
        title="Bez danych"
        config={biChart({ kind: "line", categories: [], series: [] })}
      />,
    );

    // Silnik pokazuje wtedy komunikat zamiast pustych osi - pusty układ
    // współrzędnych wygląda jak pomiar równy zeru.
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByText(t("charts.frame.empty"))).toBeTruthy();
    // Nagłówek karty zostaje: to on mówi, CZEGO brakuje.
    expect(screen.getByText("Bez danych")).toBeTruthy();
  });

  it("dwie karty o tym samym tytule mają ROZŁĄCZNE panele tabel", () => {
    // Identyfikatory z `slug(title)` dawałyby ten sam `id` dwóm kartom o tym
    // samym tytule w różnych sekcjach pulpitu, a zduplikowany identyfikator
    // rozjeżdża `aria-controls` przełącznika tabeli: jeden przycisk
    // rozwijałby cudzą tabelę.
    render(
      <>
        <ChartCard title="Ten sam tytuł" config={KONFIGURACJA} csv={CSV} />
        <ChartCard title="Ten sam tytuł" config={KONFIGURACJA} csv={CSV} />
      </>,
    );

    const przelaczniki = document.querySelectorAll("[data-chart-table-toggle]");
    expect(przelaczniki).toHaveLength(2);
    const idki = [...przelaczniki].map((b) => b.getAttribute("aria-controls"));
    expect(new Set(idki).size).toBe(2);
    for (const id of idki) expect(document.getElementById(id ?? "")).toBeTruthy();
  });

  it("wyzwalacz menu eksportu i przełącznik pełnego ekranu mają nazwy, nie same ikony", () => {
    render(<ChartCard title="Odsłony wpisów" config={KONFIGURACJA} csv={CSV} />);

    expect(
      screen.getByRole("button", { name: t("adminAnalytics.chartCard.exportMenu") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("adminAnalytics.chartCard.fullscreen") }),
    ).toBeTruthy();
  });
});
