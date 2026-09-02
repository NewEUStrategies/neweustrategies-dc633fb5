// `ChartDrillDialog` - okno szczegółów, które otwiera się pod kliknięciem
// w element wykresu BI.
//
// PO CO. Ten plik miał 40,0% linii i 9,3% GAŁĘZI - najgorszy wynik w całym
// module analityki. To nie jest statystyka kosmetyczna: komponent jest niemal
// wyłącznie zbudowany z warunków. KAŻDE pole ładunku jest opcjonalne (poza
// tytułem), a każde z nich ma własną gałąź renderu. Gałąź nieprzejechana
// testem to w tym pliku dokładnie jedno z dwóch:
//
//   1. TREŚĆ, KTÓREJ NIE MA. Wycinek treemapy przynosi `metrics`, kliknięcie
//      w słupek trendu przynosi `date`, a klik w linię progową nie przynosi
//      nic. Zgubiony warunek `metrics.length > 0` nie wywala okna - rysuje
//      nagłówek „Metryki" nad pustą siatką, czyli obiecuje dane, których nie
//      dostarcza. To jest ten rodzaj regresu, który przechodzi code review.
//   2. CEL NAWIGACJI. `isExternal` decyduje, czy link dostanie `target="_blank"`
//      i `rel="noopener noreferrer"`. Pomyłka w jedną stronę wyrzuca operatora
//      z panelu (utrata stanu pulpitu), w drugą - otwiera obcą domenę
//      z dostępem do `window.opener`. Chip adresu pod nagłówkiem wymuszał
//      kiedyś `external: true` na stałe; dziś przechodzi przez tę samą
//      autodetekcję co lista „Powiązane" i jest to tu przypilnowane.
//
// DIALOG JEST PRAWDZIWY, NIE ATRAPĄ. W repo dominuje wzorzec podmiany
// `@/components/ui/dialog` na przezroczysty `<div>`. Tutaj byłby bezużyteczny:
// obietnice „Escape zamyka", „kliknięcie w tło zamyka" i „ognisko wraca tam,
// skąd przyszło" mieszkają WYŁĄCZNIE w Radiksie, a komponent podaje mu tylko
// `open` i `onOpenChange`. Atrapa dowiodłaby, że atrapa działa.
//
// ECHARTS NIE WCHODZI DO TEGO PROCESU (nagłówek `EChart.tsx`) - i nie musi:
// `ChartDrillDialog` nie dotyka renderera, przyjmuje gotowy ładunek. Kształty
// zdarzeń, jakie ECharts potrafi oddać (klik w serię, w wycinek, w element bez
// danych), są przejechane tam, gdzie mieszka mapowanie - w `chartCard.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import {
  ChartDrillDialog,
  type ChartDrillDetail,
  type ChartDrillMetric,
} from "../ChartDrillDialog";

// ---------------------------------------------------------------------------
// Dane - ładunki odpowiadające temu, co produkują pulpity GSC / GA4 / Vitals.
// ---------------------------------------------------------------------------

/** Minimum kontraktu: sam tytuł. Tyle oddaje klik w element bez kontekstu. */
const MINIMALNY: ChartDrillDetail = { title: "Wycinek bez kontekstu" };

const PELNY: ChartDrillDetail = {
  title: "/analizy/energia-w-cee",
  subtitle: "Pozycja 4,2 - 1 280 wyświetleń",
  date: "2026-08-14",
  url: "https://example.com/analizy/energia-w-cee",
  urlLabel: "example.com/analizy/energia-w-cee",
  description: "Strona zebrała najwięcej kliknięć w oknie, ale CTR spadł o 18%.",
  metrics: [
    { label: "Kliknięcia", value: "412", tone: "good", hint: "poprzednio 350" },
    { label: "CTR", value: "3,1%", tone: "bad" },
    { label: "Pozycja", value: "4,2", tone: "warn" },
    { label: "Wyświetlenia", value: "13 290" },
  ],
  links: [
    { href: "https://example.com/analizy/energia-w-cee", label: "Otwórz stronę" },
    { href: "/admin/posts/energia-w-cee", label: "Edytuj wpis" },
  ],
};

function otworz(detail: ChartDrillDetail | null, open = true, onOpenChange = vi.fn()) {
  const wynik = render(
    <ChartDrillDialog open={open} onOpenChange={onOpenChange} detail={detail} />,
  );
  return { ...wynik, onOpenChange };
}

/** Okno Radiksa ląduje w portalu na `document.body`, nie w kontenerze renderu. */
function okno(): HTMLElement {
  return screen.getByRole("dialog");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  // Okno jedzie w portalu do `document.body`, a jeden test dokłada tam własny
  // wyzwalacz - sprzątamy resztki, żeby kolejny przypadek startował z pustego.
  document.body.innerHTML = "";
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("ChartDrillDialog - brama otwarcia", () => {
  it("bez ładunku NIE renderuje niczego, nawet gdy `open` jest prawdą", () => {
    // Karta trzyma `open={drill !== null}`, ale po zamknięciu Radiks animuje
    // wyjście - w tej chwili `detail` już jest `null`. Gdyby komponent liczył
    // wyłącznie na `open`, sięgnąłby po `detail.title` na `null`.
    const { container } = otworz(null, true);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("z ładunkiem, ale zamknięte - nie ma go w drzewie dostępności", () => {
    otworz(PELNY, false);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(PELNY.subtitle ?? "")).toBeNull();
  });

  it("otwarte - dostępną NAZWĄ okna jest tytuł ładunku", () => {
    otworz(PELNY);

    expect(screen.getByRole("dialog", { name: PELNY.title })).toBeTruthy();
  });

  it("sam tytuł wystarcza - żadna z opcjonalnych sekcji się nie pojawia", () => {
    const t = realT("pl");
    otworz(MINIMALNY);

    const w = within(okno());
    expect(w.getByText(MINIMALNY.title)).toBeTruthy();
    expect(w.queryByText(t("adminAnalytics.drillDialog.metrics"))).toBeNull();
    expect(w.queryByText(t("adminAnalytics.drillDialog.links"))).toBeNull();
    // Żadnego linku poza przyciskiem zamknięcia (ten jest przyciskiem).
    expect(w.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("ChartDrillDialog - nagłówek i chipy kontekstu", () => {
  it("podtytuł renderuje się jako OPIS okna, nie jako kolejny nagłówek", () => {
    otworz(PELNY);

    const opis = screen.getByText(PELNY.subtitle ?? "");
    expect(okno().getAttribute("aria-describedby")).toBe(opis.id);
  });

  it("bez podtytułu okno NIE zostawia wiszącego `aria-describedby`", () => {
    // Ta sama reguła, której karta wykresu pilnuje w `chartCardA11y`: atrybut
    // nie może wskazywać identyfikatora elementu, którego w dokumencie nie ma.
    // MECHANIZM. Radiks generuje id opisu ZAWSZE i wstawia je treści okna, ale
    // `DialogDescription` renderuje się tylko wtedy, gdy ładunek ma `subtitle` -
    // a większość kliknięć w wykres go nie ma (klik w wycinek treemapy, w dzień
    // trendu). Bez bariery czytnik ekranu obiecywałby wtedy opis i milkł.
    // Komponent zdejmuje atrybut jawnym `undefined` (warunkowy rozkład propsów
    // na `<DialogContent>`), co zarazem gasi ostrzeżenie Radiksa na konsoli
    // („Missing `Description` or `aria-describedby={undefined}`") - jego brak
    // w przebiegu tego pliku jest dodatkowym dowodem, że atrybut naprawdę
    // zniknął, a nie tylko wskazuje coś innego.
    otworz({ title: "Bez podtytułu" });

    expect(okno().getAttribute("aria-describedby")).toBeNull();
  });

  it("data bez adresu daje SAM chip daty", () => {
    otworz({ title: "Dzień trendu", date: "2026-08-14" });

    const w = within(okno());
    expect(w.getByText("2026-08-14")).toBeTruthy();
    expect(w.queryAllByRole("link")).toHaveLength(0);
  });

  it("adres bez daty daje SAM link, podpisany pełnym adresem w `title`", () => {
    otworz({ title: "Strona", url: "https://example.com/a/b" });

    const link = within(okno()).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/a/b");
    expect(link.getAttribute("title")).toBe("https://example.com/a/b");
    // Bez `urlLabel` widoczną treścią jest sam adres.
    expect(link.textContent).toContain("https://example.com/a/b");
  });

  it("`urlLabel` zastępuje WIDOCZNY tekst, ale nie cel ani podpowiedź", () => {
    otworz(PELNY);

    const link = within(okno()).getByRole("link", { name: /example\.com\/analizy/ });
    expect(link.textContent).toContain(PELNY.urlLabel ?? "");
    expect(link.textContent).not.toContain("https://");
    expect(link.getAttribute("href")).toBe(PELNY.url);
    expect(link.getAttribute("title")).toBe(PELNY.url);
  });

  it("bez daty i bez adresu cały pasek kontekstu znika", () => {
    otworz({ title: "Tylko tytuł", description: "Opis." });

    const w = within(okno());
    expect(w.queryAllByRole("link")).toHaveLength(0);
    expect(w.getByText("Opis.")).toBeTruthy();
  });

  it("opis renderuje się jako akapit, gdy jest, i znika, gdy go nie ma", () => {
    const { unmount } = otworz(PELNY);
    expect(within(okno()).getByText(PELNY.description ?? "")).toBeTruthy();
    unmount();

    otworz({ title: "Bez opisu" });
    expect(within(okno()).queryByText(PELNY.description ?? "")).toBeNull();
  });
});

describe("ChartDrillDialog - metryki", () => {
  it("cztery metryki dają cztery pary etykieta/wartość", () => {
    const t = realT("pl");
    otworz(PELNY);

    const w = within(okno());
    expect(w.getByText(t("adminAnalytics.drillDialog.metrics"))).toBeTruthy();
    for (const m of PELNY.metrics ?? []) {
      expect(w.getByText(m.label)).toBeTruthy();
      expect(w.getByText(m.value)).toBeTruthy();
    }
  });

  it("PUSTA tablica metryk nie rysuje nagłówka nad niczym", () => {
    // Rozróżnienie `undefined` vs `[]` jest tu istotne: mapowania w pulpitach
    // budują tablicę warunkowo i legalnie oddają zero pozycji.
    const t = realT("pl");
    otworz({ title: "Zero metryk", metrics: [] });

    expect(within(okno()).queryByText(t("adminAnalytics.drillDialog.metrics"))).toBeNull();
  });

  it("każdy ton maluje wartość INNĄ klasą, a brak tonu spada na neutralny", () => {
    // Ton niesie ocenę („dobrze / do poprawy / słabo"), więc pomylenie klas
    // odwraca wymowę kafelka przy niezmienionej liczbie.
    const metryki: ChartDrillMetric[] = [
      { label: "Dobrze", value: "1", tone: "good" },
      { label: "Ostrzeżenie", value: "2", tone: "warn" },
      { label: "Źle", value: "3", tone: "bad" },
      { label: "Neutralnie", value: "4", tone: "neutral" },
      { label: "Bez tonu", value: "5" },
    ];
    otworz({ title: "Tony", metrics: metryki });

    const w = within(okno());
    const klasa = (v: string) => w.getByText(v).className;
    expect(klasa("1")).toContain("emerald");
    expect(klasa("2")).toContain("amber");
    expect(klasa("3")).toContain("rose");
    expect(klasa("4")).toContain("text-foreground");
    // Brak tonu MUSI dać dokładnie to samo co ton `neutral` - inaczej metryka
    // bez oceny wyglądałaby jak oceniona.
    expect(klasa("5")).toBe(klasa("4"));
  });

  it("podpowiedź metryki renderuje się tylko dla tej metryki, która ją ma", () => {
    otworz(PELNY);

    const w = within(okno());
    expect(w.getByText("poprzednio 350")).toBeTruthy();
    // Druga metryka (CTR) podpowiedzi nie ma - w oknie jest dokładnie jedna.
    expect(w.getAllByText(/poprzednio/)).toHaveLength(1);
  });
});

describe("ChartDrillDialog - linki i cel nawigacji", () => {
  it("brak listy linków i PUSTA lista dają ten sam wynik: żadnej sekcji", () => {
    const t = realT("pl");
    const naglowek = t("adminAnalytics.drillDialog.links");

    const { unmount } = otworz({ title: "Bez linków" });
    expect(within(okno()).queryByText(naglowek)).toBeNull();
    unmount();

    otworz({ title: "Puste linki", links: [] });
    expect(within(okno()).queryByText(naglowek)).toBeNull();
  });

  it("link ABSOLUTNY bez deklaracji jedzie w nową kartę z rel=noopener noreferrer", () => {
    otworz({ title: "L", links: [{ href: "https://example.org/raport", label: "Raport" }] });

    const link = within(okno()).getByRole("link", { name: /Raport/ });
    expect(link.getAttribute("target")).toBe("_blank");
    // `noopener` odcina obcej stronie dostęp do `window.opener`.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("link WZGLĘDNY bez deklaracji zostaje w panelu - bez target i bez rel", () => {
    otworz({ title: "L", links: [{ href: "/admin/posts/1", label: "Edytuj" }] });

    const link = within(okno()).getByRole("link", { name: "Edytuj" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("jawne `external: false` PRZEBIJA absolutny adres", () => {
    // Pulpit GA4 podaje tak ścieżki własnego serwisu podane w pełnej formie.
    otworz({
      title: "L",
      links: [{ href: "https://example.com/wpis", label: "Wpis", external: false }],
    });

    const link = within(okno()).getByRole("link", { name: "Wpis" });
    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
  });

  it("jawne `external: true` PRZEBIJA adres względny", () => {
    otworz({
      title: "L",
      links: [{ href: "/pobierz/raport.pdf", label: "Pobierz", external: true }],
    });

    const link = within(okno()).getByRole("link", { name: /Pobierz/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("dwa linki o tym samym adresie, ale różnych etykietach, renderują się OBA", () => {
    // Klucz Reacta to `${href}-${label}` - gdyby był samym `href`, drugi wpis
    // zniknąłby bez śladu w konsoli.
    otworz({
      title: "L",
      links: [
        { href: "/admin/x", label: "Podgląd" },
        { href: "/admin/x", label: "Edytuj" },
      ],
    });

    const w = within(okno());
    expect(w.getByRole("link", { name: "Podgląd" })).toBeTruthy();
    expect(w.getByRole("link", { name: "Edytuj" })).toBeTruthy();
  });

  it("względny adres w `detail.url` ZOSTAJE w panelu, jak każdy inny link okna", () => {
    // Chip adresu pod nagłówkiem przechodzi przez tę samą autodetekcję co lista
    // „Powiązane": `isExternal(detail.url)` bez wymuszonego drugiego argumentu.
    // Stała `true` w tym miejscu (`isExternal(detail.url, true)`) czyniła
    // autodetekcję - jedyny powód istnienia tej funkcji - martwą i dawała
    // sprzeczność W TYM SAMYM oknie: `Ga4BiDashboard.tsx:425` podaje
    // `url: path` (ścieżka względna) i jednocześnie
    // `links: [{ href: path, external: false }]`, więc ten sam adres
    // renderował się raz jako wewnętrzny (lista), a raz jako zewnętrzny (chip).
    // Operator klikał chip i wypadał z panelu do nowej karty, tracąc stan
    // pulpitu. Ten przypadek pilnuje, żeby oba miejsca decydowały tak samo.
    otworz({ title: "Ścieżka wewnętrzna", url: "/analizy/energia-w-cee" });

    const chip = within(okno()).getByRole("link");
    expect(chip.getAttribute("target")).toBeNull();
    expect(chip.getAttribute("rel")).toBeNull();
  });
});

describe("ChartDrillDialog - zamykanie i ognisko", () => {
  it("Escape melduje zamknięcie WOŁAJĄCEMU, dokładnie raz", async () => {
    const { onOpenChange } = otworz(PELNY);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("kliknięcie w TŁO też zamyka - okno nie jest pułapką bez wyjścia", async () => {
    const { onOpenChange } = otworz(PELNY);
    // Radiks podpina nasłuch `pointerdown` w `setTimeout(0)`; bez oddania
    // pętli zdarzeń klik poszedłby w próżnię i test dowiódłby nieprawdy.
    // `Promise.resolve()` tu NIE wystarcza - mikrozadanie nie wypycha zegara.
    await act(async () => {
      await new Promise((gotowe) => setTimeout(gotowe, 0));
    });

    const tlo = document.querySelector("[data-state=open].fixed.inset-0");
    expect(tlo).not.toBeNull();
    fireEvent.pointerDown(tlo as Element, { button: 0 });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("przycisk zamknięcia Radiksa melduje zamknięcie", async () => {
    const { onOpenChange } = otworz(PELNY);

    fireEvent.click(within(okno()).getByRole("button"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("po zamknięciu ognisko WRACA tam, skąd przyszło", async () => {
    // Bez powrotu ogniska osoba nawigująca klawiaturą po zamknięciu okna
    // lądowałaby na `<body>` i musiała przejść cały panel od nowa (WCAG 2.4.3).
    //
    // MECHANIZM, KTÓREGO PILNUJE TEN PRZYPADEK. `DialogContent` w trybie
    // modalnym Radiksa BLOKUJE domyślny powrót ogniska
    // (`event.preventDefault()` w `onCloseAutoFocus`) i zamiast niego ustawia
    // ognisko na `triggerRef.current`. Tutaj wyzwalacza nie ma ani być nie
    // może: okno otwiera KLIKNIĘCIE W WYKRES, a nie `<DialogTrigger>`, więc
    // `triggerRef.current` jest `null`. Dlatego `ChartDrillDialog` prowadzi
    // powrót SAM: zapamiętuje `document.activeElement` w `onOpenAutoFocus`
    // (leci PRZED przeniesieniem ogniska do okna) i oddaje mu ognisko we
    // własnym `onCloseAutoFocus`. Przypadek stoi na straży obu połówek tego
    // mechanizmu - zapamiętania i oddania.
    document.body.innerHTML = '<button id="wyzwalacz" type="button">Wykres</button>';
    const wyzwalacz = document.getElementById("wyzwalacz") as HTMLButtonElement;
    wyzwalacz.focus();
    expect(document.activeElement).toBe(wyzwalacz);

    const { rerender } = render(
      <ChartDrillDialog open onOpenChange={() => undefined} detail={PELNY} />,
    );
    await waitFor(() => expect(okno().contains(document.activeElement)).toBe(true));

    rerender(<ChartDrillDialog open={false} onOpenChange={() => undefined} detail={PELNY} />);
    // Radiks oddaje ognisko w `setTimeout(0)` - czekamy na to zadanie, a potem
    // sprawdzamy raz. Bez tego test mierzyłby tylko chwilę przed przywróceniem.
    await act(async () => {
      await new Promise((gotowe) => setTimeout(gotowe, 0));
    });

    expect(document.activeElement).toBe(wyzwalacz);
  });
});

describe("ChartDrillDialog - izolacja warsztatów i dwujęzyczność", () => {
  it("ładunek DRUGIEGO warsztatu wypiera pierwszy w całości", async () => {
    // Panel jest wielotenantowy i to jedno okno obsługuje wszystkie kliknięcia.
    // Gdyby którakolwiek sekcja została z poprzedniego ładunku (np. metryki,
    // bo nowy ich nie ma), operator warsztatu B zobaczyłby liczby warsztatu A.
    const warsztatA: ChartDrillDetail = {
      title: "warsztat-a.example.com/raport",
      date: "2026-08-01",
      description: "Ruch warsztatu A",
      metrics: [{ label: "Kliknięcia", value: "9 999" }],
      links: [{ href: "https://warsztat-a.example.com/raport", label: "Otwórz A" }],
    };
    const warsztatB: ChartDrillDetail = { title: "warsztat-b.example.org/raport" };

    const { rerender } = render(
      <ChartDrillDialog open onOpenChange={() => undefined} detail={warsztatA} />,
    );
    expect(within(okno()).getByText("9 999")).toBeTruthy();

    rerender(<ChartDrillDialog open onOpenChange={() => undefined} detail={warsztatB} />);

    const w = within(okno());
    expect(w.getByText("warsztat-b.example.org/raport")).toBeTruthy();
    expect(w.queryByText("9 999")).toBeNull();
    expect(w.queryByText("Ruch warsztatu A")).toBeNull();
    expect(w.queryByText("2026-08-01")).toBeNull();
    expect(w.queryByRole("link", { name: /Otwórz A/ })).toBeNull();
    expect(document.body.textContent).not.toContain("warsztat-a.example.com");
  });

  it("nagłówki sekcji przychodzą ZE SŁOWNIKA - PL i EN", async () => {
    const pl = realT("pl");
    const { unmount } = otworz(PELNY);
    expect(within(okno()).getByText(pl("adminAnalytics.drillDialog.metrics"))).toBeTruthy();
    expect(within(okno()).getByText(pl("adminAnalytics.drillDialog.links"))).toBeTruthy();
    unmount();

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const en = realT("en");
    // Zabezpieczenie przed testem, który „przechodzi" na polskim fallbacku.
    expect(en("adminAnalytics.drillDialog.metrics")).not.toBe(
      pl("adminAnalytics.drillDialog.metrics"),
    );

    otworz(PELNY);
    const w = within(okno());
    expect(w.getByText(en("adminAnalytics.drillDialog.metrics"))).toBeTruthy();
    expect(w.getByText(en("adminAnalytics.drillDialog.links"))).toBeTruthy();
    expect(w.queryByText(pl("adminAnalytics.drillDialog.metrics"))).toBeNull();
  });

  // Zasięg axe to TREŚĆ okna, nie `document.body`. Poza treścią stoją strażnicy
  // ogniska Radiksa (`aria-hidden` + `tabindex=0`), które reguła
  // `aria-hidden-focus` zgłasza w KAŻDYM modalu tej biblioteki - to znany
  // artefakt prymitywu, nie właściwość `ChartDrillDialog`. Zasięg na treści
  // mierzy dokładnie to, za co ten plik odpowiada.
  it("pełny ładunek nie wnosi naruszeń axe", async () => {
    otworz(PELNY);

    const naruszenia = await axeViolations(okno());
    expect(summarize(naruszenia)).toBe("");
  });

  it("minimalny ładunek (bez opisu, bez sekcji) też jest czysty w axe", async () => {
    otworz(MINIMALNY);

    const naruszenia = await axeViolations(okno());
    expect(summarize(naruszenia)).toBe("");
  });
});
