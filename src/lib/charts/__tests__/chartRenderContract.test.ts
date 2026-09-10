// CO KAŻDY RENDER MUSI MIEĆ, ŻEBY BYĆ RENDEREM TEGO SILNIKA.
//
// PO CO. Rodzaje wykresu powstawały tu jeden po drugim i każdy następny
// dostawał trochę więcej kontraktu niż poprzedni. Skutek zobaczył dopiero
// przegląd spójności: `PieChart` - rodzaj OPUBLIKOWANY, `pie` i `donut` -
// nie miał ani `aria-describedby` ze wskazówką klawiatury, ani obsługi
// `Escape`, ani jednego uchwytu `data-role`, a bramka rodzajów przechodziła,
// bo wymaga tylko `tabindex="0"` i zmiany stanu po klawiszu.
//
// Ta bramka jest STATYCZNA i celowo prymitywna: czyta źródła i pyta o
// OBECNOŚĆ pięciu rzeczy. Nie zastępuje testów zachowania (te są przy każdym
// rodzaju osobno) - zastępuje CZUJNOŚĆ przy dodawaniu dziewiątego renderu,
// której nikt nie ma po trzech godzinach pisania geometrii.
//
// LISTA RENDERÓW JEST ZAMKNIĘTA I RĘCZNA. Nie skanujemy katalogu, bo leżą
// w nim też pliki, których ten kontrakt nie dotyczy (rama karty, dymek,
// mapa choroplet z własnym `viewBox` z zasobu geograficznego). Nowy render
// dopisuje się tutaj jedną linijką - i to jest cała cena.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const RENDERY = [
  "CartesianChart",
  "PieChart",
  "HistogramChart",
  "BoxplotChart",
  "BeeswarmChart",
  "ScatterChart",
  "HeatmapChart",
  "TornadoChart",
] as const;

const zrodlo = (nazwa: string): string =>
  readFileSync(`src/components/charts/${nazwa}.tsx`, "utf8");

describe("kontrakt renderu wykresu", () => {
  for (const nazwa of RENDERY) {
    describe(nazwa, () => {
      const src = zrodlo(nazwa);

      it("wystawia co najmniej jeden uchwyt data-role", () => {
        // Konwencja repozytorium (`chartClasses.test.ts`): uchwyt zapytania
        // idzie na `data-role`, nie na klasę bez reguły w arkuszu. Render bez
        // ani jednego uchwytu każe testom rozróżniać rodzaje po KLASACH
        // WYGLĄDU - a wygląd wolno zmienić bez zmiany znaczenia.
        expect(src.includes("data-role=")).toBe(true);
      });

      it("opisuje klawiaturę przez aria-describedby", () => {
        // Sama obsługa klawiszy nie wystarcza: czytelnik, który nie wie, że
        // strzałki coś robią, ich nie naciśnie.
        expect(src.includes("aria-describedby")).toBe(true);
        expect(/a11y\.keyboardHint/.test(src)).toBe(true);
      });

      it("czyści zaznaczenie Escapem", () => {
        // Wskazanie ustawia się fokusem albo strzałką, a fokus na klawiaturze
        // zostaje tam, gdzie go zostawiono. Bez Escape jedyną drogą zdjęcia
        // dymka jest tapnięcie w tło, czyli akcja WSKAŹNIKOWA - której na
        // klawiaturze nie ma.
        expect(src.includes('"Escape"')).toBe(true);
      });

      it("ma element o roli i fokusie", () => {
        expect(/role="(img|group)"/.test(src)).toBe(true);
        expect(src.includes("tabIndex")).toBe(true);
      });

      it("nie ma viewBox - jedna jednostka SVG jest jednym pikselem CSS", () => {
        // Strefy trafienia liczą się w pikselach CSS (`src/lib/charts/plot.ts`),
        // więc `viewBox` skalujący układ współrzędnych rozjechałby kursor
        // z tym, co widać. Wyjątkiem jest mapa, która bierze geometrię
        // z zasobu - i dlatego nie ma jej na liście wyżej.
        expect(/viewBox=/.test(src)).toBe(false);
      });

      it("nie zapieka koloru - wszystko idzie tokenem", () => {
        expect(/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/`[^`]*`/g, ""))).toBe(false);
      });
    });
  }
});
