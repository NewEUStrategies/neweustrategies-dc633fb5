/**
 * SZACUNEK WYSOKOŚCI SEKCJI - rezerwacja miejsca dla szkieletu sekcji
 * strumieniowanej (`SectionStreamSkeleton`).
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. KIERUNEK BŁĘDU. Szacunek wolno PRZESZACOWAĆ, nie wolno niedoszacować:
 *     pusty pas niczego nie przesuwa, a pas za niski spycha całą treść pod
 *     sekcją w chwili dostrumieniowania (audyt CWV, F29b). Stąd asercje na
 *     widełki i na to, że każdy widget DOKŁADA, a nie odejmuje.
 *  2. GEOMETRIA UKŁADU. Widgety w kolumnie stoją JEDEN POD DRUGIM (sumują się
 *     razem z odstępami), a kolumny OBOK SIEBIE (decyduje najwyższa). Pomyłka
 *     w tę stronę daje rezerwację kilkukrotnie za dużą albo za małą, a obie
 *     wyglądają w testach smoke identycznie.
 *  3. CZYSTOŚĆ I DETERMINIZM. Funkcja nie dotyka DOM-u ani `window`, więc
 *     serwer i klient dostają TĘ SAMĄ liczbę - a to jest warunek, żeby
 *     `minHeight` szkieletu nie był sam źródłem różnicy hydratacyjnej.
 *  4. ODPORNOŚĆ NA DANE Z BAZY. `builder_data` to JSONB - brak `children`,
 *     nieznany typ widgetu czy bzdurna wysokość nie mogą wywalić renderu ani
 *     zarezerwować ekranu pustki.
 */
import { describe, expect, it } from "vitest";
import type { ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  DEFAULT_WIDGET_HEIGHT_PX,
  NOMINAL_VIEWPORT_HEIGHT,
  SECTION_STREAM_MAX_HEIGHT,
  SECTION_STREAM_MIN_HEIGHT,
  SECTION_TABS_BAR_PX,
  SECTION_VERTICAL_PADDING_PX,
  WIDGET_GAP_PX,
  WIDGET_HEIGHT_ESTIMATE_PX,
  estimateColumnHeight,
  estimateSectionHeight,
  estimateWidgetHeight,
} from "@/lib/builder/sectionHeightEstimate";

function widget(type: WidgetNode["type"], extra: Partial<WidgetNode> = {}): WidgetNode {
  return {
    kind: "widget",
    id: `w-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content: {},
    ...extra,
  } as WidgetNode;
}

function column(children: WidgetNode[], extra: Partial<ColumnNode> = {}): ColumnNode {
  return {
    kind: "column",
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    span: { desktop: 12 },
    children,
    ...extra,
  } as ColumnNode;
}

function section(children: SectionNode["children"], extra: Partial<SectionNode> = {}): SectionNode {
  return {
    kind: "section",
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    children,
    ...extra,
  } as SectionNode;
}

/** Wysokość z tabeli - test czyta ją z modułu, żeby nie przepisywać liczb. */
const POST_LIST = WIDGET_HEIGHT_ESTIMATE_PX["post-list"]!;
const SLIDER = WIDGET_HEIGHT_ESTIMATE_PX.slider!;
const HEADING = WIDGET_HEIGHT_ESTIMATE_PX.heading!;

describe("estimateWidgetHeight - jeden widget", () => {
  it("wysokość zapisana przez autora BIJE tabelę szacunków", () => {
    // Tabela zgaduje; ramka widgetu zna prawdę. Gdyby było odwrotnie, sekcja
    // z jawnie ustawioną wysokością rezerwowałaby cudzą liczbę.
    expect(estimateWidgetHeight(widget("post-list", { advanced: { height: 777 } }))).toBe(777);
    expect(estimateWidgetHeight(widget("post-list"))).toBe(POST_LIST);
  });

  it("widget spoza tabeli dostaje wartość domyślną, nie zero", () => {
    // Zero znaczyłoby „ten widget nic nie zajmuje" - a nieznany typ to
    // najczęściej zwykły blok treści. Zero wróciłoby jako przesunięcie.
    expect(estimateWidgetHeight(widget("tts"))).toBe(DEFAULT_WIDGET_HEIGHT_PX);
  });

  it("widget UKRYTY na danym urządzeniu nie zajmuje miejsca", () => {
    const ukryty = widget("post-list", { advanced: { hideOn: { mobile: true } } });
    expect(estimateWidgetHeight(ukryty, "mobile")).toBe(0);
    expect(estimateWidgetHeight(ukryty, "desktop")).toBe(POST_LIST);
  });

  it("bzdurna wysokość z bazy nie przechodzi - wracamy do tabeli", () => {
    // `builder_data` to JSONB; ujemna albo zerowa wysokość jest danymi, nie
    // decyzją autora.
    for (const height of [0, -50]) {
      expect(estimateWidgetHeight(widget("post-list", { advanced: { height } }))).toBe(POST_LIST);
    }
  });
});

describe("estimateColumnHeight - kolumna układa widgety PIONOWO", () => {
  it("sumuje wysokości i dokłada odstęp MIĘDZY nimi (n-1 przerw)", () => {
    expect(estimateColumnHeight(column([widget("post-list")]))).toBe(POST_LIST);
    expect(estimateColumnHeight(column([widget("post-list"), widget("heading")]))).toBe(
      POST_LIST + HEADING + WIDGET_GAP_PX,
    );
  });

  it("pusta i ukryta kolumna to zero, bez odstępu-sieroty", () => {
    expect(estimateColumnHeight(column([]))).toBe(0);
    expect(
      estimateColumnHeight(
        column([widget("post-list")], { advanced: { hideOn: { mobile: true } } }),
        "mobile",
      ),
    ).toBe(0);
    // Jedyny widget ukryty: kolumna jest pusta, a nie „pusta plus 16 px".
    expect(
      estimateColumnHeight(
        column([widget("post-list", { advanced: { hideOn: { mobile: true } } })]),
        "mobile",
      ),
    ).toBe(0);
  });
});

describe("estimateSectionHeight - sekcja", () => {
  it("kolumny stoją OBOK siebie - decyduje najwyższa, nie suma", () => {
    // To jest cała różnica między rezerwacją 568 px a 988 px na tej samej
    // sekcji. Suma dałaby ekran pustki pod każdą siatką dwukolumnową.
    const dwie = section([column([widget("post-list")]), column([widget("slider")])]);
    expect(estimateSectionHeight(dwie)).toBe(SLIDER + SECTION_VERTICAL_PADDING_PX);
  });

  it("sekcja wewnętrzna liczy się tak samo - najwyższa z jej kolumn", () => {
    const inner = section([
      {
        kind: "inner-section",
        id: "in-1",
        columns: [column([widget("post-list")]), column([widget("text")])],
      } as SectionNode["children"][number],
    ]);
    expect(estimateSectionHeight(inner)).toBe(POST_LIST + SECTION_VERTICAL_PADDING_PX);
  });

  it("pasek zakładek dokłada swoją wysokość", () => {
    const zZakladkami = section([column([widget("post-list")])], {
      tabs: { enabled: true, items: [] },
    });
    expect(estimateSectionHeight(zZakladkami)).toBe(
      POST_LIST + SECTION_TABS_BAR_PX + SECTION_VERTICAL_PADDING_PX,
    );
  });

  it("wysokość narzucona w układzie sekcji podnosi szacunek, ale go nie obniża", () => {
    const dzieci = [column([widget("post-list")])];
    // Wyższa niż treść - wygrywa ona.
    expect(
      estimateSectionHeight(section(dzieci, { layout: { height: "fixed", heightValue: 700 } })),
    ).toBe(700 + SECTION_VERTICAL_PADDING_PX);
    // Niższa niż treść - treść i tak zajmie swoje, więc rezerwujemy treść.
    expect(
      estimateSectionHeight(section(dzieci, { layout: { height: "fixed", heightValue: 100 } })),
    ).toBe(POST_LIST + SECTION_VERTICAL_PADDING_PX);
  });

  it("`fit-screen` liczy się z NOMINALNEGO wiewportu - SSR nie zna ekranu", () => {
    const pelnyEkran = section([column([widget("heading")])], {
      layout: { height: "fit-screen", heightValue: 100 },
    });
    expect(estimateSectionHeight(pelnyEkran)).toBe(
      NOMINAL_VIEWPORT_HEIGHT + SECTION_VERTICAL_PADDING_PX,
    );
  });

  it("wynik mieści się w widełkach - ani 0 px, ani ekran pustki", () => {
    // Dół: sekcja bez treści (albo z samymi ukrytymi widgetami) nadal
    // rezerwuje tyle, co dawna stała 280 px.
    expect(estimateSectionHeight(section([]))).toBe(SECTION_STREAM_MIN_HEIGHT);
    expect(estimateSectionHeight(section([column([])]))).toBe(SECTION_STREAM_MIN_HEIGHT);
    // Góra: kolumna z trzema sliderami zsumowałaby się do ponad 1600 px -
    // powyżej progu pustka kosztuje więcej niż przesunięcie.
    const wysoka = section([column([widget("slider"), widget("slider"), widget("slider")])]);
    expect(estimateSectionHeight(wysoka)).toBe(SECTION_STREAM_MAX_HEIGHT);
  });

  it("jest CZYSTA i deterministyczna - ten sam dokument, ta sama liczba", () => {
    // Warunek parytetu SSR/klient: gdyby szacunek zależał od czegokolwiek poza
    // konfiguracją, `minHeight` szkieletu sam byłby źródłem różnicy.
    const dokument = section([column([widget("post-list"), widget("heading")])], {
      tabs: { enabled: true, items: [] },
    });
    const pierwszy = estimateSectionHeight(dokument);
    expect(estimateSectionHeight(dokument)).toBe(pierwszy);
    expect(estimateSectionHeight(structuredClone(dokument))).toBe(pierwszy);
    expect(Number.isInteger(pierwszy)).toBe(true);
  });

  it("znosi dokument bez `children` - JSONB bywa niekompletny", () => {
    expect(estimateSectionHeight({ id: "s-goly", kind: "section" } as unknown as SectionNode)).toBe(
      SECTION_STREAM_MIN_HEIGHT,
    );
  });

  it("na telefonie pomija widgety ukryte na telefonie", () => {
    const mieszana = section([
      column([widget("slider", { advanced: { hideOn: { mobile: true } } }), widget("post-list")]),
    ]);
    expect(estimateSectionHeight(mieszana, "desktop")).toBe(
      SLIDER + POST_LIST + WIDGET_GAP_PX + SECTION_VERTICAL_PADDING_PX,
    );
    expect(estimateSectionHeight(mieszana, "mobile")).toBe(POST_LIST + SECTION_VERTICAL_PADDING_PX);
  });
});
