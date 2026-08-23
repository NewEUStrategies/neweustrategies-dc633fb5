// Render pojedynczych widgetów runtime (RuntimeWidget): treść, pola
// formularza, przyciski i odliczanie.
//
// MAILA NIE DA SIĘ WYCOFAĆ. Widget, który wyrenderuje się źle, idzie w tej
// postaci do dwudziestu tysięcy skrzynek i zostaje w nich na zawsze - poprawka
// dotyczy dopiero następnej wysyłki. Dlatego każdy typ widgetu ma tu dowód
// PRZED wysyłką, i to w trzech wariantach danych: pełnych, częściowych i
// pustych. Widget skonfigurowany do połowy jest w panelu normalnym stanem
// pracy (operator zapisuje wersję roboczą), więc renderer musi go przeżyć.
//
// CO JEST TU PILNOWANE POZA SAMYM RENDEREM:
//   * `cta-button` buduje `href` z danych panelu - `javascript:` w linku
//     wysłanym do skrzynek to nie literówka, tylko incydent;
//   * `field.mailing-lists` znika, gdy lista z panelu przestała istnieć -
//     ciche zniknięcie pola trzeba znać, zanim mail wyjdzie;
//   * `countdown` liczy od ZAMROŻONEGO zegara - test, który czeka sekundę,
//     jest testem, który kiedyś zamruga na czerwono bez powodu.
//
// KUPON I LICZNIK SUBSKRYBENTÓW mają własny plik
// (`newsletterDocRendererCoupon.test.tsx`), bo sięgają poza dokument -
// do schowka przeglądarki i do bazy - i potrzebują własnych atrap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import type { NlDoc, NlLang, NlWidget } from "@/lib/newsletter-builder/types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

const h = vi.hoisted(() => ({
  /** Surowy HTML, który renderer oddał do oczyszczenia. */
  sanitized: [] as string[],
}));

// Licznik subskrybentów ma własny plik - tutaj baza tylko odpowiada, żeby
// dokument z widgetem społecznego dowodu miał się na czym oprzeć.
vi.mock("@/integrations/supabase/client", () => {
  interface CountChain extends PromiseLike<{ count: number | null; error: null }> {
    select: () => CountChain;
    eq: () => CountChain;
  }
  const chain: CountChain = {
    select: () => chain,
    eq: () => chain,
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ count: 4321, error: null }).then(onFulfilled, onRejected),
  };
  return { supabase: { from: () => chain } };
});

// Atrapa oczyszczania HTML zapisuje WEJŚCIE - inaczej nie da się odróżnić
// „renderer przepuścił HTML przez sanitizer" od „HTML był akurat nieszkodliwy".
vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (dirty: string) => {
    h.sanitized.push(dirty);
    return dirty.replace(/<script[\s\S]*?<\/script>/gi, "");
  },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: () => Promise.resolve({ ok: true, status: "pending" }),
}));

import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  makeCheckbox,
  makeCloseButton,
  makeCountdown,
  makeCtaButton,
  makeDivider,
  makeEmailField,
  makeHeading,
  makeImage,
  makeMailingList,
  makeMailingLists,
  makeParagraph,
  makeSelect,
  makeSettings,
  makeSingleSectionDoc,
  makeSpacer,
  makeSubmit,
  makeSuccessMessage,
  makeTextField,
  resetDocIds,
} from "./docFixtures";

const NOW = new Date("2026-08-22T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  resetDocIds();
  h.sanitized = [];
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function mount(
  widgets: NlWidget[],
  opts: { lang?: NlLang; settings?: NewsletterSettings; doc?: NlDoc } = {},
) {
  return renderWithQueryClient(
    <NewsletterDocRenderer
      doc={opts.doc ?? makeSingleSectionDoc(widgets)}
      settings={opts.settings ?? makeSettings()}
      lang={opts.lang ?? "pl"}
    />,
  );
}

function el(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`test: brak elementu ${selector}`);
  return node;
}

// ---------------------------------------------------------------------------
// Treść: nagłówek, akapit, obraz, linia, odstęp
// ---------------------------------------------------------------------------

describe("nagłówek", () => {
  it("poziom nagłówka z panelu staje się prawdziwym H1-H4, a nie pogrubionym tekstem", () => {
    mount([
      makeHeading({ level: 1, text: { pl: "Pierwszy", en: "First" } }),
      makeHeading({ level: 2, text: { pl: "Drugi", en: "Second" } }),
      makeHeading({ level: 3, text: { pl: "Trzeci", en: "Third" } }),
      makeHeading({ level: 4, text: { pl: "Czwarty", en: "Fourth" } }),
    ]);

    expect(el("h1").textContent).toBe("Pierwszy");
    expect(el("h2").textContent).toBe("Drugi");
    expect(el("h3").textContent).toBe("Trzeci");
    expect(el("h4").textContent).toBe("Czwarty");
  });

  it("każdy poziom dostaje własny rozmiar - inaczej hierarchia w mailu znika", () => {
    mount([
      makeHeading({ level: 1 }),
      makeHeading({ level: 2 }),
      makeHeading({ level: 3 }),
      makeHeading({ level: 4 }),
    ]);

    expect(el("h1").className).toContain("text-3xl");
    expect(el("h2").className).toContain("text-2xl");
    expect(el("h3").className).toContain("text-xl");
    expect(el("h4").className).toContain("text-lg");
  });

  it("wyrównanie i kolor z panelu docierają do stylu nagłówka", () => {
    mount([makeHeading({ align: "center", color: "#123456" })]);

    expect(el("h2").style.textAlign).toBe("center");
    expect(el("h2").style.color).toBe("#123456");
  });

  it("nagłówek bez ustawień wyrównania staje do lewej, a nie w środku", () => {
    mount([makeHeading()]);

    expect(el("h2").style.textAlign).toBe("left");
    expect(el("h2").style.color).toBe("");
  });

  it("wersja EN dokumentu pokazuje angielski nagłówek, nie polski", () => {
    mount([makeHeading({ text: { pl: "Zapisz sie", en: "Subscribe" } })], { lang: "en" });

    expect(el("h2").textContent).toBe("Subscribe");
  });
});

describe("akapit", () => {
  it("HTML akapitu przechodzi przez oczyszczanie, zanim trafi do maila", () => {
    mount([makeParagraph({ html: { pl: "<b>Tak</b><script>alert(1)</script>", en: "x" } })]);

    expect(h.sanitized).toContain("<b>Tak</b><script>alert(1)</script>");
    expect(document.querySelector("p script")).toBeNull();
    expect(el("p b").textContent).toBe("Tak");
  });

  it("rozmiar tekstu z panelu zmienia klasę - „lg” nie renderuje się jak „sm”", () => {
    mount([
      makeParagraph({ size: "sm", html: { pl: "maly", en: "small" } }),
      makeParagraph({ size: "lg", html: { pl: "duzy", en: "large" } }),
      makeParagraph({ html: { pl: "domyslny", en: "default" } }),
    ]);

    const paragrafy = document.querySelectorAll("p");
    expect(paragrafy[0].className).toContain("text-xs");
    expect(paragrafy[1].className).toContain("text-base");
    expect(paragrafy[2].className).toContain("text-sm");
  });

  it("kolor akapitu z panelu dociera do stylu", () => {
    mount([makeParagraph({ color: "#ff0000" })]);

    expect(el("p").style.color).toBe("#ff0000");
  });
});

describe("obraz", () => {
  it("obraz bez wybranego pliku nie zostawia w mailu pustej ramki", () => {
    mount([makeImage({ url: null })]);

    expect(document.querySelector("img")).toBeNull();
  });

  it("obraz z opisem alternatywnym renderuje się z tym opisem - czytniki ekranu mają co przeczytać", () => {
    mount([makeImage({ url: "https://cdn.example.test/a.png", alt: "Okladka raportu" })]);

    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.test/a.png");
    expect(img?.getAttribute("alt")).toBe("Okladka raportu");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("obraz bez opisu dostaje pusty alt, a nie brak atrybutu (czytnik go pominie zamiast czytać URL)", () => {
    mount([makeImage({ alt: undefined })]);

    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("proporcje wybrane w panelu trafiają do stylu, a „auto” nie wymusza żadnych", () => {
    mount([makeImage({ aspect: "16/9", rounded: true })]);
    expect(el("img").style.aspectRatio).toBe("16 / 9");
    expect(el("img").className).toContain("rounded-lg");

    cleanup();
    mount([makeImage({ aspect: "auto" })]);
    expect(el("img").style.aspectRatio).toBe("");
    expect(el("img").className).not.toContain("rounded-lg");
  });
});

describe("linia i odstęp", () => {
  it("linia bez ustawień ma widoczną grubość, a nie zerową", () => {
    mount([makeDivider()]);

    expect(el("hr").style.borderTopWidth).toBe("1px");
    expect(el("hr").style.borderColor).toBe("currentcolor");
  });

  it("grubość i kolor linii z panelu docierają do stylu", () => {
    mount([makeDivider({ thickness: 4, color: "#00ff00" })]);

    expect(el("hr").style.borderTopWidth).toBe("4px");
    expect(el("hr").style.borderColor).toBe("#00ff00");
  });

  it("odstęp jest ukryty przed czytnikiem ekranu i ma wysokość z panelu", () => {
    mount([makeSpacer({ size: 48 })]);

    const spacer = el("[aria-hidden='true']");
    expect(spacer.style.height).toBe("48px");
  });
});

// ---------------------------------------------------------------------------
// Pola formularza
// ---------------------------------------------------------------------------

describe("pola formularza", () => {
  it("pole e-mail jest zawsze wymagane i ma limit długości adresu", () => {
    mount([makeEmailField()]);

    const input = el("input[name='email']");
    expect(input.getAttribute("type")).toBe("email");
    expect(input.hasAttribute("required")).toBe(true);
    expect(input.getAttribute("maxlength")).toBe("254");
  });

  it("etykieta pola jedzie z panelu i jest widoczna w języku dokumentu", () => {
    mount([makeEmailField({ label: { pl: "Adres e-mail", en: "Email address" } })], { lang: "en" });

    expect(screen.getByText("Email address")).toBeInTheDocument();
  });

  it("podpowiedź z panelu NIE trafia do pola - etykieta pływająca zastępuje ją spacją", () => {
    // STAN FAKTYCZNY, PRZYPIĘTY ŚWIADOMIE: `FieldWrap` nadpisuje `placeholder`
    // spacją, bo na tym stoi animacja etykiety (`:placeholder-shown`).
    // KONSEKWENCJA: tekst podpowiedzi ustawiony w panelu nie pokaże się nikomu,
    // więc treść instrukcji trzeba pisać w etykiecie, nie w podpowiedzi.
    mount([makeEmailField({ placeholder: { pl: "jan@example.pl", en: "jane@example.com" } })]);

    expect(el("input[name='email']").getAttribute("placeholder")).toBe(" ");
  });

  it("pole tekstowe nazywa się tak, jak wybrano w panelu, i ma limit 200 znaków", () => {
    mount([makeTextField("company", { required: true })]);

    const input = el("input[name='company']");
    expect(input.getAttribute("type")).toBe("text");
    expect(input.hasAttribute("required")).toBe(true);
    expect(input.getAttribute("maxlength")).toBe("200");
  });

  it("pole nieobowiązkowe nie jest oznaczone jako wymagane w przeglądarce", () => {
    mount([makeTextField("phone")]);

    expect(el("input[name='phone']").hasAttribute("required")).toBe(false);
  });

  it("lista wyboru startuje na podpowiedzi, której nie da się wybrać jako odpowiedzi", () => {
    mount([makeSelect({ placeholder: { pl: "Wybierz kraj", en: "Choose a country" } })]);

    const select = el("select[name='country']");
    const opcje = select.querySelectorAll("option");
    expect(opcje[0].textContent).toBe("Wybierz kraj");
    expect(opcje[0].hasAttribute("disabled")).toBe(true);
    expect(select.getAttribute("placeholder")).toBeNull();
  });

  it("opcje listy pokazują się w języku dokumentu", () => {
    mount([makeSelect()], { lang: "en" });

    const opcje = document.querySelectorAll("select[name='country'] option");
    expect([...opcje].map((o) => o.textContent)).toEqual(["Choose a country", "Poland", "Belgium"]);
  });

  it("lista bez opcji renderuje się z samą podpowiedzią, zamiast wywalać formularz", () => {
    mount([makeSelect({ options: [] })]);

    expect(document.querySelectorAll("select[name='country'] option")).toHaveLength(1);
  });

  it("treść zgody przechodzi przez oczyszczanie i zachowuje link do regulaminu", () => {
    mount([
      makeCheckbox({
        key: "terms",
        required: true,
        html: { pl: "Akceptuje <a href='/regulamin'>regulamin</a>", en: "ok" },
      }),
    ]);

    expect(h.sanitized).toContain("Akceptuje <a href='/regulamin'>regulamin</a>");
    expect(el("input[name='terms']").hasAttribute("required")).toBe(true);
    expect(document.querySelector("label a")?.getAttribute("href")).toBe("/regulamin");
  });
});

describe("listy tematyczne", () => {
  const listy = [makeMailingList("brief"), makeMailingList("wydarzenia")];

  it("brak skonfigurowanych list ukrywa pole zamiast pokazywać pusty wybór", () => {
    mount([makeMailingLists()], { settings: makeSettings({ popup_mailing_lists: [] }) });

    expect(document.querySelector("fieldset")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });

  it("wiersz ustawień bez wypełnionej kolumny list (NULL w bazie) nie wywala dokumentu", () => {
    // Kolumna `popup_mailing_lists` bywa pusta w świeżo założonym wierszu
    // tenanta - typ TS mówi „tablica", baza mówi „NULL". `Object.assign`
    // odtwarza taki wiersz bez rzutowań i bez dotykania kodu produkcyjnego.
    // KONSEKWENCJA błędu tutaj: cały mail przestaje się renderować u tenanta,
    // który po prostu nie skonfigurował jeszcze list tematycznych.
    const ustawienia = makeSettings();
    Object.assign(ustawienia, { popup_mailing_lists: null });
    mount([makeHeading(), makeMailingLists()], { settings: ustawienia });

    expect(screen.getByText("Zapisz sie na newsletter")).toBeInTheDocument();
    expect(document.querySelector("fieldset")).toBeNull();
  });

  it("domyślnie każda lista dostaje własny checkbox z etykietą w języku dokumentu", () => {
    mount([makeMailingLists({ id: "listy" })], {
      settings: makeSettings({ popup_mailing_lists: listy }),
      lang: "en",
    });

    const boxes = document.querySelectorAll("input[name='ml_listy']");
    expect(boxes).toHaveLength(2);
    expect(screen.getByText("List brief")).toBeInTheDocument();
    expect(screen.getByText("List wydarzenia")).toBeInTheDocument();
  });

  it("tryb „select” daje jedną listę rozwijaną z podpowiedzią w języku dokumentu", () => {
    mount([makeMailingLists({ id: "listy", display: "select", required: true })], {
      settings: makeSettings({ popup_mailing_lists: listy }),
    });

    const select = el("select[name='ml_listy']");
    expect(select.hasAttribute("required")).toBe(true);
    expect(select.querySelectorAll("option")[0].textContent).toBe("Wybierz...");
  });

  it("angielska wersja listy rozwijanej ma angielską podpowiedź i angielskie etykiety", () => {
    mount([makeMailingLists({ id: "listy", display: "select" })], {
      settings: makeSettings({ popup_mailing_lists: listy }),
      lang: "en",
    });

    const opcje = document.querySelectorAll("select[name='ml_listy'] option");
    expect([...opcje].map((o) => o.textContent)).toEqual([
      "Choose...",
      "List brief",
      "List wydarzenia",
    ]);
  });

  it("zawężenie do wybranych list pokazuje tylko je - reszta oferty nie wycieka do maila", () => {
    mount([makeMailingLists({ id: "listy", listIds: ["brief"] })], {
      settings: makeSettings({ popup_mailing_lists: listy }),
    });

    const boxes = document.querySelectorAll("input[name='ml_listy']");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].getAttribute("value")).toBe("brief");
  });

  it("zawężenie do listy, której już nie ma w ustawieniach, ukrywa pole zamiast pokazywać puste", () => {
    // KONSEKWENCJA: skasowanie listy w ustawieniach po cichu usuwa pole
    // z formularza. Widget zostaje w dokumencie, więc operator go widzi
    // w panelu, a odwiedzający nie widzi go wcale.
    mount([makeMailingLists({ id: "listy", listIds: ["nieistniejaca"] })], {
      settings: makeSettings({ popup_mailing_lists: listy }),
    });

    expect(document.querySelector("fieldset")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Przyciski i komunikaty
// ---------------------------------------------------------------------------

describe("przycisk zapisu", () => {
  it("przycisk wysyła formularz i nosi etykietę z panelu", () => {
    mount([makeSubmit({ label: { pl: "Zapisz mnie", en: "Sign me up" } })]);

    const button = el("button[type='submit']");
    expect(button.textContent).toBe("Zapisz mnie");
  });

  it("kolory z panelu docierają do przycisku, a brak wyboru zostawia kolor motywu", () => {
    mount([makeSubmit({ bg: "#101010", fg: "#fefefe", fullWidth: true })]);
    expect(el("button[type='submit']").style.backgroundColor).toBe("#101010");
    expect(el("button[type='submit']").className).toContain("w-full");

    cleanup();
    mount([makeSubmit()]);
    expect(el("button[type='submit']").style.backgroundColor).toBe("var(--primary)");
    expect(el("button[type='submit']").className).not.toContain("w-full");
  });
});

describe("komunikat sukcesu jako widget", () => {
  it("nie pokazuje się przed zapisem - inaczej człowiek myśli, że już się zapisał", () => {
    mount([makeSuccessMessage({ text: { pl: "Sprawdz skrzynke", en: "Check your inbox" } })]);

    expect(screen.queryByText("Sprawdz skrzynke")).toBeNull();
  });
});

describe("przycisk zamykający popup", () => {
  it("wariant ikony X ma dostępną nazwę, a nie sam znaczek", () => {
    mount([makeCloseButton({ variant: "icon-x" })]);

    const button = screen.getByRole("button", { name: "Zamknij popup" });
    expect(button.textContent).toBe("✕");
    expect(button.getAttribute("data-popup-close")).toBe("true");
  });

  it("wariant szewronu renderuje szewron, a nie krzyżyk", () => {
    mount([makeCloseButton({ variant: "icon-chevron" })]);

    expect(screen.getByRole("button", { name: "Zamknij popup" }).textContent).toBe("‹");
  });

  it("wariant tekstowy pokazuje etykietę z panelu", () => {
    mount([makeCloseButton({ variant: "text", label: { pl: "Nie teraz", en: "Not now" } })]);

    expect(screen.getByRole("button", { name: "Zamknij popup" }).textContent).toBe("Nie teraz");
  });

  it("wariant tekstowy bez etykiety nie zostaje pustym przyciskiem", () => {
    mount([makeCloseButton({ variant: "text", label: undefined })]);

    expect(screen.getByRole("button", { name: "Zamknij popup" }).textContent).toBe("Zamknij");
  });

  it("dostępna nazwa przycisku jest po angielsku na angielskim popupie", () => {
    mount([makeCloseButton({ variant: "text", label: undefined })], { lang: "en" });

    expect(screen.getByRole("button", { name: "Close popup" }).textContent).toBe("Close");
  });

  it("pozycja „w rogu” wypina przycisk z układu, a „inline” zostawia go w kolumnie", () => {
    mount([makeCloseButton({ position: "top-right" })]);
    expect(el("button[data-popup-close]").parentElement?.className).toContain("absolute");

    cleanup();
    mount([makeCloseButton({ position: "inline" })]);
    expect(el("button[data-popup-close]").parentElement?.className).toContain("justify-center");
  });

  it("rozmiar z panelu skaluje przycisk, a jego brak daje rozmiar domyślny", () => {
    mount([makeCloseButton({ size: 64 })]);
    expect(el("button[data-popup-close]").style.height).toBe("64px");
    expect(el("button[data-popup-close]").style.fontSize).toBe("32px");

    cleanup();
    mount([makeCloseButton()]);
    expect(el("button[data-popup-close]").style.height).toBe("32px");
  });
});

describe("przycisk akcji (CTA)", () => {
  it("adres z panelu trafia do linku, a nowa karta dostaje zabezpieczenie rel", () => {
    mount([makeCtaButton({ url: "https://example.test/raport", target: "_blank" })]);

    const link = el("a");
    expect(link.getAttribute("href")).toBe("https://example.test/raport");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("link otwierany w tej samej karcie nie dostaje rel - i tak nie ma czego chronić", () => {
    mount([makeCtaButton()]);

    expect(el("a").getAttribute("target")).toBe("_self");
    expect(el("a").getAttribute("rel")).toBeNull();
  });

  it("adres `javascript:` nie wychodzi w mailu jako klikalny link", () => {
    mount([makeCtaButton({ url: "javascript:alert(1)" })]);

    expect(el("a").getAttribute("href")).toBe("#");
  });

  it("adresy mailto, tel i ścieżki wewnętrzne przechodzą - to normalne cele przycisku", () => {
    mount([
      makeCtaButton({ url: " mailto:biuro@example.pl " }),
      makeCtaButton({ url: "tel:+48221234567" }),
      makeCtaButton({ url: "/wydarzenia" }),
    ]);

    const linki = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(linki).toEqual(["mailto:biuro@example.pl", "tel:+48221234567", "/wydarzenia"]);
  });

  it("przycisk bez etykiety nie znika z maila - zostaje klikalny znak", () => {
    mount([makeCtaButton({ label: { pl: "", en: "" } })]);

    expect(el("a").textContent).toBe("-");
  });

  it("wyrównanie z panelu decyduje o pozycji przycisku w kolumnie", () => {
    mount([
      makeCtaButton({ align: "left" }),
      makeCtaButton({ align: "right" }),
      makeCtaButton({ align: "center" }),
      makeCtaButton(),
    ]);

    const wrappers = [...document.querySelectorAll("a")].map((a) => a.parentElement?.className);
    expect(wrappers[0]).toContain("justify-start");
    expect(wrappers[1]).toContain("justify-end");
    expect(wrappers[2]).toContain("justify-center");
    expect(wrappers[3]).toContain("justify-center");
  });

  it("przycisk pełnej szerokości dostaje klasę rozciągającą, zwykły jej nie ma", () => {
    mount([makeCtaButton({ fullWidth: true }), makeCtaButton({ fullWidth: false })]);

    const linki = [...document.querySelectorAll("a")];
    expect(linki[0].className).toContain("w-full");
    expect(linki[1].className).not.toContain("w-full");
  });
});

// ---------------------------------------------------------------------------
// Odliczanie
// ---------------------------------------------------------------------------

describe("odliczanie do terminu", () => {
  it("pokazuje dni, godziny, minuty i sekundy pozostałe do terminu z panelu", () => {
    // Termin: 1 dzień, 2 godziny, 3 minuty i 4 sekundy po zamrożonym „teraz”.
    mount([makeCountdown({ deadline: "2026-08-23T12:03:04.500Z" })]);

    const komorki = [...document.querySelectorAll(".tabular-nums")].map((c) => c.textContent);
    expect(komorki).toEqual(["01", "02", "03", "04"]);
  });

  it("liczby są dopełniane zerem - „5” zamiast „05” rozjeżdża układ w mailu", () => {
    mount([makeCountdown({ deadline: "2026-08-22T10:00:09.500Z" })]);

    const komorki = [...document.querySelectorAll(".tabular-nums")].map((c) => c.textContent);
    expect(komorki).toEqual(["00", "00", "00", "09"]);
  });

  it("termin, który już minął, pokazuje zera zamiast liczb ujemnych", () => {
    mount([makeCountdown({ deadline: "2020-01-01T00:00:00.000Z" })]);

    const komorki = [...document.querySelectorAll(".tabular-nums")].map((c) => c.textContent);
    expect(komorki).toEqual(["00", "00", "00", "00"]);
  });

  it("podpisy komórek są w języku dokumentu", () => {
    mount([makeCountdown()], { lang: "en" });

    expect(screen.getByText("days")).toBeInTheDocument();
    expect(screen.getByText("sec")).toBeInTheDocument();
  });

  it("kolor akcentu z panelu maluje komórki, a jego brak zostawia kolor motywu", () => {
    mount([makeCountdown({ accent: "#0000ff" })]);
    expect(el(".grid-cols-4 > div").style.backgroundColor).toBe("#0000ff");

    cleanup();
    mount([makeCountdown()]);
    expect(el(".grid-cols-4 > div").style.backgroundColor).toBe("var(--muted)");
  });
});
