// CO DOWODZI TEN PLIK: pole SEO (tytuł / opis) ma trzy zobowiązania, których
// nie pilnują ani typy, ani żaden inny test:
//
//   1. LICZNIK LICZY WEJŚCIE, a METRYKA MIERZY TO, CO POJDZIE DO GOOGLE.
//      To dwie różne wielkości i muszą się rozjeżdżać celowo: licznik pokazuje
//      długość tego, co redakcja wpisała (0 przy pustym polu), a pasek SERP
//      mierzy wartość SKUTECZNĄ - przy pustym polu FALLBACK wyprowadzony z
//      wpisu. Gdyby metryka mierzyła puste pole, panel meldowałby "pusto" o
//      tytule, który w wynikach wyszukiwania jest długi na 700 px.
//   2. JEDNOSTKA LICZNIKA to JEDNOSTKI KODU UTF-16 (`String.prototype.length`),
//      dokładnie ta sama, którą wymusza atrybut `maxLength` w DOM. Dla polskich
//      diakrytyków w NFC to to samo co liczba znaków; dla emoji z pary
//      zastępczej - NIE (jeden znak zajmuje 2 jednostki). Ten rozjazd jest tu
//      przypięty JAWNIE, żeby zmiana licznika na `[...str].length` (czyli na
//      "prawdziwe znaki") padła w teście, a nie u redakcji - rozjechałaby
//      licznik z ucinaniem, które robi przeglądarka.
//   3. DWA POZIOMY OSTRZEŻEŃ SĄ ROZŁĄCZNE. Twardy limit znaków to BŁĄD
//      (`aria-invalid` + `role="alert"`, wpis dalej nie wejdzie), a przekroczony
//      budżet pikselowy Google to OSTRZEŻENIE (tylko `aria-describedby`, pole
//      zostaje w pełni edytowalne - Google utnie snippet, ale wpisu nie
//      odrzuci). Zlanie ich w jedno albo blokuje legalny wpis, albo przemilcza
//      ucięcie w SERP-ie.
//   Dodatkowo: kontrakt `onChange` - puste pole oddaje `null`, nie `""`, bo
//   `null` znaczy "brak nadpisania, dziedzicz fallback".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `seoAtoms.test.tsx` - tam `isAtHardLimit`/`CharCounter` są dowodzone
//     tabelą wejść; tutaj wyłącznie ich SKUTEK w polu (tonacja, `aria-invalid`).
//   - testów `src/lib/seo/serp.ts` - nie liczę tu tabeli szerokości znaków ani
//     progów px; z metryki bierę tylko `grade`/`px` przez funkcję produkcyjną,
//     żeby przypiąć, KTÓRY tekst pole mierzy.
//   - `SerpMeter` jako komponentu - pasek jest tu tylko sondą pokazującą
//     zmierzoną wartość.
//   - `RobotsTxtPreview.test.tsx` - inna powierzchnia panelu SEO.
//   - `e2e/seo.spec.ts` - ZERO styku. Cała suita e2e SEO stoi na powierzchniach
//     publicznych (sitemapy, robots.txt, feedy, kontrakt <head>), a jej jedyny
//     test panelu, "/admin/seo is auth-gated (redirects to /auth or /login)",
//     kończy się na przekierowaniu do /auth i NIGDY nie renderuje formularza -
//     żadnego pola SEO w e2e nie widać.
import { describe, expect, it, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { SeoTextField } from "@/components/admin/seo/SeoTextField";
import { serpTitleMetric, serpDescriptionMetric } from "@/lib/seo/serp";

afterEach(cleanup);

type FieldProps = ComponentProps<typeof SeoTextField>;

/** Twardy limit tytułu w panelu - mały, żeby granica dała się przypiąć znakiem. */
const TITLE_MAX = 60;
/** Fallback wyprowadzony z wpisu: mieści się w budżecie pikselowym (grade "good"). */
const TITLE_FALLBACK = "Nowa strategia przemysłowa Unii Europejskiej";

function mount(overrides: Partial<Omit<FieldProps, "onChange">> = {}) {
  const onChange = vi.fn<(value: string | null) => void>();
  const utils = render(
    <SeoTextField
      label="Tytuł SEO"
      kind="title"
      value={null}
      fallback={TITLE_FALLBACK}
      maxLength={TITLE_MAX}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

function counter(): HTMLElement {
  return screen.getByTestId("seo-char-counter");
}

/** Jedyne pole tekstowe renderu - `<input>` dla tytułu, `<textarea>` dla opisu. */
function field(): HTMLElement {
  return screen.getByRole("textbox");
}

/** Napis "NNNpx / MMMpx" z paska SERP - sonda pokazująca, co pole ZMIERZYŁO. */
function measuredPx(): string {
  return screen.getByText(/px \/ \d+px$/).textContent ?? "";
}

describe("SeoTextField - licznik znaków i wartość skuteczna", () => {
  it.each([
    ["null (kolumna nigdy nie nadpisana)", null],
    ["pusty napis (redakcja wyczyściła pole)", ""],
  ] satisfies Array<[string, string | null]>)(
    "puste pole %s: licznik 0, placeholder = fallback, a metryka mierzy FALLBACK",
    (_opis, value) => {
      mount({ value });
      const metric = serpTitleMetric(TITLE_FALLBACK);
      // Kontrola założenia fixture'u: fallback jest sensownej długości, więc
      // "empty" na pasku mogłoby przyjść WYŁĄCZNIE z pomiaru pustego wejścia.
      expect(metric.grade).toBe("good");

      expect(counter().textContent).toBe(`0/${TITLE_MAX}`);
      expect(counter()).toHaveAttribute("data-at-limit", "false");
      expect(field()).toHaveValue("");
      expect(field()).toHaveAttribute("placeholder", TITLE_FALLBACK);
      // Pasek pokazuje px FALLBACKU, nie zero.
      expect(measuredPx()).toBe(`${metric.px}px / ${metric.limitPx}px`);
      expect(screen.getByText("admin.seo.meter.good")).toBeInTheDocument();
      expect(screen.queryByText("admin.seo.meter.empty")).not.toBeInTheDocument();
      // Pole puste = wpis poprawny: żadnego komunikatu ani powiązania z nim.
      expect(field()).not.toHaveAttribute("aria-invalid");
      expect(field()).not.toHaveAttribute("aria-describedby");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("liczy znaki WEJŚCIA, nie encje zdekodowane do postaci wyświetlanej", () => {
    // "&amp;&lt;" to 9 jednostek kodu w polu i 9 znaków, które zje `maxLength`.
    // Liczenie po dekodowaniu ("&<") pokazałoby 2 i pozwoliłoby redakcji
    // wierzyć, że ma jeszcze 58 znaków zapasu.
    const raw = "&amp;&lt;";
    expect(raw.length).toBe(9);
    mount({ value: raw });
    expect(counter().textContent).toBe(`9/${TITLE_MAX}`);
    expect(field()).toHaveValue(raw);
  });

  it("polskie diakrytyki (NFC) liczą się po jednej jednostce kodu na znak", () => {
    const word = "zażółć gęślą jaźń";
    // Przypięcie jednostki: w NFC to 17 jednostek kodu UTF-16 = 17 znaków.
    expect(word.length).toBe(17);
    expect(word.normalize("NFC")).toBe(word);
    mount({ value: word });
    expect(counter().textContent).toBe(`17/${TITLE_MAX}`);
  });

  it("emoji z pary zastępczej liczy się jako 2 - to JEDNOSTKI KODU, nie znaki", () => {
    // JAWNY rozjazd "znaki" vs "jednostki kodu": jeden widziany znak, dwie
    // jednostki. Licznik MUSI mówić to samo co `maxLength` w DOM (który też
    // liczy jednostki kodu), inaczej pole ucięłoby wpis bez ostrzeżenia.
    const emoji = "\u{1F44D}";
    expect([...emoji]).toHaveLength(1);
    expect(emoji.length).toBe(2);
    mount({ value: emoji });
    expect(counter().textContent).toBe(`2/${TITLE_MAX}`);
  });
});

describe("SeoTextField - granica twardego limitu", () => {
  it("dokładnie NA limicie: aria-invalid, komunikat errorMax z parametrem max i role=alert", () => {
    // Wąskie "i" celowo: pomiar pikselowy zostaje w normie, więc jedynym
    // źródłem komunikatu jest długość - granica jest przypięta czysto.
    const value = "i".repeat(TITLE_MAX);
    expect(value.length).toBe(TITLE_MAX);
    mount({ value });

    expect(counter().textContent).toBe(`${TITLE_MAX}/${TITLE_MAX}`);
    expect(counter()).toHaveAttribute("data-at-limit", "true");
    expect(field()).toHaveAttribute("aria-invalid", "true");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(`admin.seo.field.errorMax(max=${TITLE_MAX})`);
    // Komunikat jest POWIĄZANY z polem, a nie tylko postawiony obok.
    expect(field().getAttribute("aria-describedby")).toBe(alert.id);
    // Twardy limit wygrywa nad ostrzeżeniem pikselowym - jeden komunikat, nie dwa.
    expect(screen.queryByText("admin.seo.field.warnPixel")).not.toBeInTheDocument();
  });

  it("o JEDEN znak krócej: żadnego błędu, żadnego komunikatu", () => {
    const value = "i".repeat(TITLE_MAX - 1);
    expect(value.length).toBe(59);
    mount({ value });

    expect(counter().textContent).toBe(`59/${TITLE_MAX}`);
    expect(counter()).toHaveAttribute("data-at-limit", "false");
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText(`admin.seo.field.errorMax(max=${TITLE_MAX})`),
    ).not.toBeInTheDocument();
  });

  it("atrybut maxLength w DOM zgadza się z limitem licznika", () => {
    // Rozjazd tych dwóch = pole ucina wpis w innym miejscu, niż mówi licznik.
    mount({ value: "Krótki tytuł" });
    expect(field()).toHaveAttribute("maxlength", String(TITLE_MAX));
    expect(counter().textContent).toBe(`12/${TITLE_MAX}`);
  });
});

describe("SeoTextField - miękkie przekroczenie budżetu pikselowego", () => {
  /** 60 razy "W": najszersza klasa znaku, ~1104 px przy limicie 600 px. */
  const WIDE = "W".repeat(60);
  const WIDE_MAX = 90;

  it("grade 'long' bez dobicia limitu: warnPixel, aria-describedby, ZERO role=alert", () => {
    // Fixture musi trafiać w OSTRZEŻENIE, a nie w błąd: szeroko ponad budżet
    // pikselowy i wyraźnie poniżej twardego limitu znaków.
    expect(serpTitleMetric(WIDE).grade).toBe("long");
    expect(WIDE.length).toBeLessThan(WIDE_MAX);
    mount({ value: WIDE, maxLength: WIDE_MAX });

    const warn = screen.getByText("admin.seo.field.warnPixel");
    expect(field().getAttribute("aria-describedby")).toBe(warn.id);
    // Ostrzeżenie NIE jest błędem: pole nie jest nieprawidłowe...
    expect(field()).not.toHaveAttribute("aria-invalid");
    // ...i nie przerywa czytnika ekranu.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(counter()).toHaveAttribute("data-at-limit", "false");
    expect(screen.getByText("admin.seo.meter.long")).toBeInTheDocument();
  });

  it("przy ostrzeżeniu pikselowym pole zostaje W PEŁNI edytowalne", () => {
    const { onChange } = mount({ value: WIDE, maxLength: WIDE_MAX });
    expect(field()).toBeEnabled();
    expect(field()).not.toHaveAttribute("readonly");
    // Dowód czynny: wpis nadal przechodzi do góry, choć ostrzeżenie wisi.
    fireEvent.change(field(), { target: { value: `${WIDE}W` } });
    expect(onChange).toHaveBeenCalledWith(`${WIDE}W`);
  });

  it.fails("DEFEKT: ostrzeżenie pikselowe nie jest ogłaszane czytnikowi (brak role=status)", () => {
    // KONSEKWENCJA: ostrzeżenie pojawia się DOPIERO w trakcie pisania, czyli
    // gdy pole ma już fokus. `aria-describedby` czytnik ogłasza przy WEJŚCIU
    // w pole, więc osoba niewidząca dopisuje znaki i nigdy nie słyszy, że
    // snippet zostanie ucięty - a pasek px jest dla niej niedostępny.
    // Projekt ma na to własną konwencję: `severityLiveRole("warning")`
    // (atoms/SeverityBadge.tsx) mówi wprost `role="status"` dla ostrzeżeń.
    // Poprawka to jedna linia w produkcji - zgłoszona, nie wprowadzona.
    mount({ value: WIDE, maxLength: WIDE_MAX });
    expect(screen.getByRole("status")).toHaveTextContent("admin.seo.field.warnPixel");
  });

  it.fails("DEFEKT: puste pole z fallbackiem PONAD budżetem pikselowym nie ostrzega wcale", () => {
    // KONSEKWENCJA: `overPixelBudget` wymaga `raw.length > 0`, a mierzony jest
    // `raw.trim() || fallback`. Przy pustym polu Google i tak dostanie
    // FALLBACK - i utnie go w wynikach - a pole milczy. Redakcja dowie się
    // o ucięciu tylko wtedy, gdy sama odczyta pasek px. Dosypanie jednego
    // odstępu do pola natychmiast pokazuje to samo ostrzeżenie o tym samym
    // (niezmienionym!) tekście - patrz kontrola dodatnia poniżej.
    expect(serpTitleMetric(WIDE).grade).toBe("long");
    mount({ value: null, fallback: WIDE });
    expect(screen.getByText("admin.seo.field.warnPixel")).toBeInTheDocument();
  });

  it("kontrola dodatnia: dziś ten sam pomiar ostrzega tylko, gdy w polu stoi znak", () => {
    // Zapis stanu faktycznego, żeby oba `it.fails` nie były jedynym śladem:
    // przy pustym polu ostrzeżenia NIE MA, a przy samym odstępie JEST - mimo
    // że w obu przypadkach mierzony jest dokładnie ten sam fallback.
    const { unmount } = mount({ value: null, fallback: WIDE });
    expect(screen.queryByText("admin.seo.field.warnPixel")).not.toBeInTheDocument();
    expect(screen.getByText("admin.seo.meter.long")).toBeInTheDocument();
    unmount();

    mount({ value: " ", fallback: WIDE });
    expect(screen.getByText("admin.seo.field.warnPixel")).toBeInTheDocument();
    expect(counter().textContent).toBe(`1/${TITLE_MAX}`);
  });
});

describe("SeoTextField - kształt kontrolki i kontrakt onChange", () => {
  it("kind 'title' renderuje <input> (jedna linia)", () => {
    const { container } = mount({ kind: "title", value: "Tytuł" });
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("kind 'description' renderuje <textarea rows=3> i mierzy budżet OPISU", () => {
    const text = "Krótki opis wpisu dla wyników wyszukiwania.";
    const { container, onChange } = mount({
      kind: "description",
      label: "Opis SEO",
      value: text,
      fallback: "Fallback opisu",
      maxLength: 160,
    });
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(textarea).toHaveAttribute("rows", "3");
    expect(textarea).toHaveAttribute("maxlength", "160");
    // Opis ma INNY budżet niż tytuł (960 px / 14 px), więc pomiar musi iść
    // przez `serpDescriptionMetric` - inaczej pasek kłamie o ucięciu.
    const metric = serpDescriptionMetric(text);
    expect(measuredPx()).toBe(`${metric.px}px / ${metric.limitPx}px`);
    expect(metric.limitPx).not.toBe(serpTitleMetric(text).limitPx);
    // Ten sam kontrakt `onChange` co w `<input>` - `<textarea>` ma WŁASNY
    // handler w JSX, więc "puste = null" trzeba dowieść osobno.
    fireEvent.change(field(), { target: { value: "Inny opis" } });
    expect(onChange).toHaveBeenLastCalledWith("Inny opis");
    fireEvent.change(field(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("etykieta jest powiązana z polem i niesie licznik", () => {
    mount({ label: "Tytuł SEO", value: "Tytuł" });
    // Nazwa dostępna pola = etykieta + licznik, więc czytnik ogłasza limit.
    expect(screen.getByLabelText(`Tytuł SEO5/${TITLE_MAX}`)).toBe(field());
  });

  it("wpisanie tekstu oddaje NAPIS, a wyczyszczenie pola oddaje null", () => {
    // To jest kontrakt "puste = brak nadpisania, dziedzicz fallback": `""`
    // zapisałby do bazy pusty tytuł i skasował dziedziczenie.
    const { onChange } = mount({ value: "Stary tytuł" });
    fireEvent.change(field(), { target: { value: "Nowy tytuł" } });
    expect(onChange).toHaveBeenLastCalledWith("Nowy tytuł");

    fireEvent.change(field(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("kontrolka jest sterowana: `value` z propsa wygrywa nad wpisanym tekstem", () => {
    // Pole nie trzyma własnego stanu - gdyby trzymało, rodzic zapisałby do bazy
    // inny napis niż ten, który redakcja widzi na ekranie.
    mount({ value: "Stary tytuł" });
    fireEvent.change(field(), { target: { value: "Nowy tytuł" } });
    expect(field()).toHaveValue("Stary tytuł");
  });
});

describe("SeoTextField - dostępność", () => {
  it.each([
    ["stan neutralny", { value: "Krótki tytuł" }],
    ["twardy limit (role=alert)", { value: "i".repeat(TITLE_MAX) }],
    ["ostrzeżenie pikselowe", { value: "W".repeat(60), maxLength: 90 }],
  ] satisfies Array<[string, Partial<Omit<FieldProps, "onChange">>]>)(
    "brak naruszeń axe: %s",
    async (_opis, props) => {
      const { container } = mount(props);
      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    },
  );
});
