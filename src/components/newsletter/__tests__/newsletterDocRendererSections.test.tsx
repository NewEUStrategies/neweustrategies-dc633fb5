// Sekcje dokumentu i cały NewsletterDocRenderer: układy, obraz sekcji,
// odporność na nieznane typy, stany zapisu i dostępność formularza zgody.
//
// MAILA NIE DA SIĘ WYCOFAĆ. Dokument idzie w jednym kawałku do dwudziestu
// tysięcy skrzynek, więc awaria JEDNEJ sekcji nie ma prawa zabrać ze sobą
// całego maila: nieznany typ widgetu (starszy dokument, nowszy panel, literówka
// w migracji) musi zniknąć pojedynczo, a reszta treści - w tym pole e-mail
// i przycisk zapisu - musi zostać. Renderer, który się wywala, wysyła pustkę
// wszystkim naraz i nie da się tego odwołać.
//
// DRUGI POWÓD ISTNIENIA TEGO PLIKU: ścieżka zapisu. Sukces, odmowa serwera
// i awaria połączenia to trzy różne rzeczy dla człowieka, który właśnie zostawił
// swój adres. Formularz, który po błędzie wygląda jak sukces, kasuje zgodę
// razem z zaufaniem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { NlDoc, NlLang } from "@/lib/newsletter-builder/types";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { SubscribePayload } from "./docFixtures";

const h = vi.hoisted(() => ({
  payloads: [] as SubscribePayload[],
  result: { ok: true, status: "pending" } as { ok: boolean; status?: string; error?: string },
  /** Rzucane zamiast odpowiedzi - awaria połączenia, nie odmowa serwera. */
  throws: null as unknown,
  /** Bramka wstrzymująca odpowiedź zapisu - do dowodu o podwójnym kliknięciu. */
  gate: null as Promise<void> | null,
}));

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

vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (dirty: string) => dirty.replace(/<script[\s\S]*?<\/script>/gi, ""),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: async ({ data }: { data: SubscribePayload }) => {
    h.payloads.push(data);
    if (h.gate !== null) await h.gate;
    if (h.throws !== null) throw h.throws;
    return h.result;
  },
}));

import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import {
  makeCheckbox,
  makeCountdown,
  makeDoc,
  makeEmailField,
  makeFormDoc,
  makeHeading,
  makeMailingList,
  makeMailingLists,
  makeParagraph,
  makeSection,
  makeSelect,
  makeSettings,
  makeSocialProof,
  makeSubmit,
  makeSuccessMessage,
  makeTextField,
  resetDocIds,
} from "./docFixtures";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
  resetDocIds();
  h.payloads = [];
  h.result = { ok: true, status: "pending" };
  h.throws = null;
  h.gate = null;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function mount(
  doc: NlDoc,
  opts: { lang?: NlLang; settings?: NewsletterSettings; source?: string } = {},
) {
  return renderWithQueryClient(
    <NewsletterDocRenderer
      doc={doc}
      settings={opts.settings ?? makeSettings()}
      lang={opts.lang ?? "pl"}
      source={opts.source}
    />,
  );
}

function el(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`test: brak elementu ${selector}`);
  return node;
}

const form = (): HTMLFormElement => {
  const node = document.querySelector("form");
  if (!(node instanceof HTMLFormElement)) throw new Error("test: brak formularza");
  return node;
};

function typeEmail(value: string): void {
  fireEvent.change(el("input[name='email']"), { target: { value } });
}

async function submitAndSettle(): Promise<void> {
  await act(async () => {
    fireEvent.submit(form());
  });
}

// ---------------------------------------------------------------------------
// Układy sekcji
// ---------------------------------------------------------------------------

describe("układ sekcji", () => {
  it("sekcja jednokolumnowa układa widgety jeden pod drugim z odstępem z panelu", () => {
    mount(makeDoc([makeSection([makeHeading(), makeParagraph()], { style: { gap: 24 } })]));

    const kolumna = el("h2").parentElement;
    expect(kolumna?.style.flexDirection).toBe("column");
    expect(kolumna?.style.gap).toBe("24px");
  });

  it("sekcja bez ustawionego odstępu ma odstęp domyślny, a nie zerowy", () => {
    mount(makeDoc([makeSection([makeHeading()])]));

    expect(el("h2").parentElement?.style.gap).toBe("12px");
  });

  it("układ dwukolumnowy rozdziela widgety na kolumny wskazane w panelu", () => {
    mount(
      makeDoc([
        makeSection(
          [
            makeHeading({ col: 0, text: { pl: "Lewa", en: "Left" } }),
            makeParagraph({ col: 1, html: { pl: "Prawa", en: "Right" } }),
          ],
          { layout: "1-1" },
        ),
      ]),
    );

    const siatka = el("h2").parentElement?.parentElement;
    expect(siatka?.style.display).toBe("grid");
    expect(siatka?.style.gridTemplateColumns).toBe("1fr 1fr");
    const kolumny = siatka?.children;
    expect(kolumny?.[0].textContent).toBe("Lewa");
    expect(kolumny?.[1].textContent).toBe("Prawa");
  });

  it("widget bez przypisanej kolumny ląduje w lewej, a nie znika z maila", () => {
    mount(
      makeDoc([
        makeSection([makeHeading({ text: { pl: "Bez kolumny", en: "No column" } })], {
          layout: "1-1",
        }),
      ]),
    );

    const siatka = el("h2").parentElement?.parentElement;
    expect(siatka?.children[0].textContent).toBe("Bez kolumny");
    expect(siatka?.children[1].textContent).toBe("");
  });

  it("styl sekcji z panelu (tło, kolor, marginesy, zaokrąglenie, wyrównanie) dociera do maila", () => {
    mount(
      makeDoc([
        makeSection([makeHeading()], {
          style: {
            bg: "#101820",
            fg: "#ffffff",
            paddingY: 16,
            paddingX: 24,
            radius: 8,
            align: "center",
          },
        }),
      ]),
    );

    const kontener = el("h2").parentElement?.parentElement;
    expect(kontener?.style.backgroundColor).toBe("#101820");
    expect(kontener?.style.color).toBe("#ffffff");
    expect(kontener?.style.padding).toBe("16px 24px");
    expect(kontener?.style.borderRadius).toBe("8px");
    expect(kontener?.style.textAlign).toBe("center");
  });

  it("sekcja bez stylu nie dokłada zaokrąglenia ani wyrównania od siebie", () => {
    mount(makeDoc([makeSection([makeHeading()])]));

    const kontener = el("h2").parentElement?.parentElement;
    expect(kontener?.style.padding).toBe("0px");
    expect(kontener?.style.borderRadius).toBe("");
    expect(kontener?.style.textAlign).toBe("");
  });

  it("pusta sekcja nie wywraca dokumentu i nie zabiera formularza sąsiedniej sekcji", () => {
    mount(makeDoc([makeSection([]), makeSection([makeEmailField(), makeSubmit()])]));

    expect(document.querySelector("input[name='email']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Zapisz mnie" })).toBeInTheDocument();
  });

  it("sekcja o układzie spoza modelu (starszy dokument) renderuje treść zamiast wywalać maila", () => {
    // Dokumenty zapisane przed zawężeniem listy układów mają w bazie wartości,
    // których dzisiejszy typ nie zna. `Object.assign` odtwarza taki wiersz bez
    // dotykania kodu produkcyjnego i bez rzutowań w teście.
    const sekcja = makeSection([makeHeading({ text: { pl: "Przetrwalem", en: "I survived" } })]);
    Object.assign(sekcja, { layout: "2-1" });
    mount(makeDoc([sekcja]));

    expect(screen.getByText("Przetrwalem")).toBeInTheDocument();
    expect(el("h2").parentElement?.parentElement?.style.display).toBe("grid");
  });
});

// ---------------------------------------------------------------------------
// Obraz sekcji
// ---------------------------------------------------------------------------

describe("obraz sekcji", () => {
  const media = { url: "https://cdn.example.test/tlo.jpg", position: "left" as const };

  it("obraz sekcji jednokolumnowej jest tłem całej sekcji i ma dostępny opis", () => {
    mount(
      makeDoc([makeSection([makeHeading()], { media: { ...media, alt: "Panorama Brukseli" } })]),
    );

    const tlo = screen.getByRole("img", { name: "Panorama Brukseli" });
    expect(tlo.style.backgroundImage).toContain("https://cdn.example.test/tlo.jpg");
    expect(tlo.style.backgroundSize).toBe("cover");
    expect(tlo.textContent).toContain("Zapisz sie na newsletter");
  });

  it("obraz bez opisu alternatywnego nie zmusza czytnika do czytania adresu pliku", () => {
    mount(makeDoc([makeSection([makeHeading()], { media: { ...media, alt: undefined } })]));

    expect(el("[role='img']").getAttribute("aria-label")).toBe("");
  });

  it("w układzie dwukolumnowym obraz po lewej stoi PRZED treścią", () => {
    mount(
      makeDoc([
        makeSection([makeHeading()], { layout: "1-1", media: { ...media, position: "left" } }),
      ]),
    );

    const wiersz = el("[role='img']").parentElement;
    expect(wiersz?.children[0].getAttribute("role")).toBe("img");
    expect(wiersz?.children[1].textContent).toContain("Zapisz sie na newsletter");
  });

  it("obraz po prawej stoi ZA treścią - inaczej układ maila jest lustrzany do podglądu", () => {
    mount(
      makeDoc([
        makeSection([makeHeading()], { layout: "1-1", media: { ...media, position: "right" } }),
      ]),
    );

    const wiersz = el("[role='img']").parentElement;
    expect(wiersz?.children[0].textContent).toContain("Zapisz sie na newsletter");
    expect(wiersz?.children[1].getAttribute("role")).toBe("img");
  });

  it("marginesy sekcji przenoszą się na kolumnę treści, żeby obraz dotykał krawędzi", () => {
    mount(
      makeDoc([
        makeSection([makeHeading()], {
          layout: "1-1",
          media,
          style: { paddingY: 20, paddingX: 30 },
        }),
      ]),
    );

    const wiersz = el("[role='img']").parentElement;
    expect(wiersz?.style.padding).toBe("0px");
    const kolumnaTresci = wiersz?.children[1];
    expect(kolumnaTresci).toBeInstanceOf(HTMLElement);
    expect((kolumnaTresci as HTMLElement).style.padding).toBe("20px 30px");
  });

  it("sekcja z pustym adresem obrazu renderuje się normalnie, bez pustego kafla tła", () => {
    mount(makeDoc([makeSection([makeHeading()], { media: { url: "", position: "left" } })]));

    expect(document.querySelector("[role='img']")).toBeNull();
    expect(screen.getByText("Zapisz sie na newsletter")).toBeInTheDocument();
  });

  it("sekcja z wyczyszczonym obrazem (null) renderuje się normalnie", () => {
    mount(makeDoc([makeSection([makeHeading()], { media: null })]));

    expect(document.querySelector("[role='img']")).toBeNull();
    expect(screen.getByText("Zapisz sie na newsletter")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Odporność na nieznane typy
// ---------------------------------------------------------------------------

describe("nieznany typ widgetu", () => {
  it("nieznany widget znika POJEDYNCZO - formularz zapisu w tej samej sekcji zostaje", () => {
    // To jest najważniejszy dowód w całym pliku. Defekt, który wywala renderer,
    // psuje maila u WSZYSTKICH odbiorców naraz i nie da się go wycofać.
    const obcy = makeHeading({ text: { pl: "Nie powinno byc widoczne", en: "hidden" } });
    Object.assign(obcy, { type: "widget-z-przyszlosci" });
    mount(makeDoc([makeSection([obcy, makeEmailField(), makeSubmit()])]));

    expect(screen.queryByText("Nie powinno byc widoczne")).toBeNull();
    expect(document.querySelector("input[name='email']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Zapisz mnie" })).toBeInTheDocument();
  });

  it("dokument złożony z samych nieznanych widgetów daje pusty formularz, a nie błąd renderu", () => {
    const obcy = makeParagraph();
    Object.assign(obcy, { type: "nieznany" });
    mount(makeDoc([makeSection([obcy])]));

    expect(form()).toBeInTheDocument();
    expect(form().textContent).toBe("");
  });

  it("nieznany widget nie blokuje zapisu - dane z pozostałych pól nadal jadą do CRM", async () => {
    const obcy = makeHeading();
    Object.assign(obcy, { type: "widget-z-przyszlosci" });
    mount(makeDoc([makeSection([obcy, makeEmailField(), makeSubmit()])]));

    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(h.payloads).toHaveLength(1);
    expect(h.payloads[0].email).toBe("jan@example.pl");
  });
});

// ---------------------------------------------------------------------------
// Dokument jako całość
// ---------------------------------------------------------------------------

describe("dokument jako całość", () => {
  it("dokument bez sekcji renderuje sam formularz - nie znika i nie wywala strony", () => {
    mount(makeDoc([]));

    expect(form()).toBeInTheDocument();
    expect(form().textContent).toBe("");
  });

  it("sekcje renderują się w kolejności z panelu - kolejność treści to kolejność czytania", () => {
    mount(
      makeDoc([
        makeSection([makeHeading({ text: { pl: "Pierwsza", en: "First" } })]),
        makeSection([makeHeading({ text: { pl: "Druga", en: "Second" } })]),
      ]),
    );

    const naglowki = [...document.querySelectorAll("h2")].map((n) => n.textContent);
    expect(naglowki).toEqual(["Pierwsza", "Druga"]);
  });

  it("cały dokument przełącza się na angielski jednym przełącznikiem języka", () => {
    const doc = makeDoc([
      makeSection([
        makeHeading({ text: { pl: "Zapisz sie", en: "Subscribe" } }),
        makeParagraph({ html: { pl: "Analizy", en: "Analyses" } }),
        makeSelect(),
        makeSubmit({ label: { pl: "Zapisuje sie", en: "Sign me up" } }),
      ]),
    ]);
    mount(doc, { lang: "en" });

    expect(screen.getByText("Subscribe")).toBeInTheDocument();
    expect(screen.getByText("Analyses")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign me up" })).toBeInTheDocument();
    expect(screen.queryByText("Zapisz sie")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stany zapisu: idle -> loading -> ok / err
// ---------------------------------------------------------------------------

describe("ścieżka zapisu", () => {
  it("udany zapis zastępuje formularz potwierdzeniem z panelu, w języku formularza", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({ success_message_pl: "Dziekujemy, sprawdz skrzynke." }),
    });
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(screen.getByText("Dziekujemy, sprawdz skrzynke.")).toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });

  it("angielski formularz potwierdza po angielsku, a nie po polsku", async () => {
    mount(makeFormDoc(), {
      settings: makeSettings({
        success_message_pl: "Dziekujemy",
        success_message_en: "Thanks, check your inbox.",
      }),
      lang: "en",
    });
    typeEmail("jane@example.com");
    await submitAndSettle();

    expect(screen.getByText("Thanks, check your inbox.")).toBeInTheDocument();
  });

  it("potwierdzenie ułożone w panelu jako widget wygrywa z tekstem z ustawień", async () => {
    mount(
      makeDoc([
        makeSection([
          makeEmailField(),
          makeSuccessMessage({
            text: { pl: "Do zobaczenia w czwartek!", en: "See you Thursday!" },
          }),
          makeSubmit(),
        ]),
      ]),
      { settings: makeSettings({ success_message_pl: "Tekst z ustawien" }) },
    );
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(screen.getByText("Do zobaczenia w czwartek!")).toBeInTheDocument();
    expect(screen.queryByText("Tekst z ustawien")).toBeNull();
  });

  it("odmowa serwera pokazuje jego powód i ZOSTAWIA formularz z wpisanymi danymi", async () => {
    h.result = { ok: false, error: "Adres jest juz na liscie odrzuconych." };
    mount(makeFormDoc());
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(screen.getByText("Adres jest juz na liscie odrzuconych.")).toBeInTheDocument();
    expect(form()).toBeInTheDocument();
    expect(el("input[name='email']").getAttribute("value") ?? "").toBe("");
    expect((el("input[name='email']") as HTMLInputElement).value).toBe("jan@example.pl");
  });

  it("awaria połączenia pokazuje treść błędu zamiast cichego braku reakcji", async () => {
    h.throws = new Error("Failed to fetch");
    mount(makeFormDoc());
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    expect(form()).toBeInTheDocument();
  });

  it("wyjątek bez treści błędu też kończy się komunikatem, a nie pustym ekranem", async () => {
    h.throws = "timeout w bramce";
    mount(makeFormDoc());
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(screen.getByText("timeout w bramce")).toBeInTheDocument();
  });

  it("po odmowie serwera kolejna próba może się udać - stan błędu nie jest trwały", async () => {
    h.result = { ok: false, error: "Chwilowa awaria" };
    mount(makeFormDoc());
    typeEmail("jan@example.pl");
    await submitAndSettle();
    expect(screen.getByText("Chwilowa awaria")).toBeInTheDocument();

    h.result = { ok: true, status: "pending" };
    await submitAndSettle();

    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(screen.queryByText("Chwilowa awaria")).toBeNull();
  });

  it("dokument bez pola e-mail nie zapisuje NIKOGO i nie mówi o tym ani słowa", async () => {
    // STAN FAKTYCZNY, PRZYPIĘTY ŚWIADOMIE: brak widgetu `field.email` oznacza
    // brak pola `email` w formularzu, więc walidacja ustawia błąd pod kluczem
    // `email`, którego nie ma gdzie pokazać. KONSEKWENCJA: formularz wysłany
    // do skrzynek wygląda na sprawny, przycisk reaguje, a zapis nie następuje
    // NIGDY i nikt - ani odwiedzający, ani operator - nie widzi powodu.
    // Zabezpieczenie należy do panelu (dokument bez pola e-mail nie powinien
    // dać się opublikować), dlatego tutaj jest tylko dowód skutku.
    mount(makeDoc([makeSection([makeHeading(), makeSubmit()])]));

    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(form().textContent).toBe("Zapisz sie na newsletterZapisz mnie");
  });

  it("błąd walidacji nie pokazuje komunikatu serwerowego - nie było żadnego zapytania", async () => {
    mount(makeFormDoc());
    await submitAndSettle();

    expect(h.payloads).toHaveLength(0);
    expect(document.querySelector("p.text-destructive")).toBeNull();
  });

  it.fails("dwa kliknięcia „Zapisz mnie” POWINNY dać jeden zapis, nie dwa", async () => {
    // DEFEKT, NIE BRAK TESTU. Renderer ustawia stan `loading`, ale niczego nim
    // nie blokuje: przycisk zostaje aktywny, a `onSubmit` nie sprawdza, czy
    // zapis już trwa. KONSEKWENCJA: niecierpliwe drugie kliknięcie wysyła
    // drugi zapis tego samego adresu - podwójny wpis w rejestrze zgód i,
    // przy włączonym double opt-in, dwa maile potwierdzające do tej samej
    // skrzynki. Naprawa to wyłączenie przycisku na czas zapisu (kod
    // produkcyjny), dlatego tutaj jest zgłoszenie.
    let otworz = (): void => {};
    h.gate = new Promise<void>((resolve) => {
      otworz = () => resolve();
    });
    mount(makeFormDoc());
    typeEmail("jan@example.pl");

    fireEvent.submit(form());
    fireEvent.submit(form());
    await act(async () => {
      otworz();
    });

    expect(h.payloads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Odliczanie w kontekście całego dokumentu
// ---------------------------------------------------------------------------

describe("zegar odliczania w dokumencie", () => {
  it("odliczanie idzie do przodu co sekundę - liczby w mailu nie zastygają", async () => {
    mount(makeDoc([makeSection([makeCountdown({ deadline: "2026-08-22T10:02:04.500Z" })])]));
    const sekundy = () => [...document.querySelectorAll(".tabular-nums")].map((c) => c.textContent);
    expect(sekundy()).toEqual(["00", "00", "02", "04"]);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(sekundy()).toEqual(["00", "00", "02", "03"]);
  });

  it("dokument bez odliczania nie budzi przeglądarki co sekundę", () => {
    const setInterval = vi.spyOn(globalThis, "setInterval");
    mount(makeFormDoc());

    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it("zamknięcie popupu zatrzymuje zegar - inaczej tyka on w tle po zniknięciu treści", () => {
    const clearInterval = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = mount(makeDoc([makeSection([makeCountdown()])]));

    unmount();

    expect(clearInterval).toHaveBeenCalled();
    clearInterval.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Dostępność pełnego formularza zgody
// ---------------------------------------------------------------------------

describe("dostępność formularza zapisu", () => {
  const pelnyDokument = (): NlDoc =>
    makeDoc([
      makeSection([
        makeHeading({ level: 2 }),
        makeParagraph(),
        makeEmailField(),
        makeTextField("firstName"),
        makeSelect(),
        makeMailingLists({ id: "listy" }),
        makeCheckbox({ key: "terms", required: true }),
        makeSocialProof(),
        makeSubmit(),
      ]),
    ]);

  it.fails("pełny formularz zgody NIE MA naruszeń dostępności", async () => {
    // DEFEKT, NIE BRAK TESTU. `FieldWrap` renderuje `<label>` bez `htmlFor`,
    // a pole bez `id` - etykieta jest więc wyłącznie graficzna, a podpowiedź
    // nadpisana spacją nie daje nazwy dostępnej (axe: `label`, `select-name`).
    // KONSEKWENCJA: użytkownik czytnika ekranu słyszy przy polach „edit blank"
    // i nie wie, gdzie wpisać adres ani czego dotyczy lista wyboru - a to jest
    // formularz zbierania ZGODY, więc świadomość treści jest tu wymogiem, nie
    // wygodą. Naprawa to powiązanie etykiety z polem w kodzie produkcyjnym.
    const { container } = mount(pelnyDokument(), {
      settings: makeSettings({ popup_mailing_lists: [makeMailingList("brief")] }),
    });
    await act(async () => {});

    expect(await axeViolations(container).then(summarize)).toBe("");
  });

  it("naruszenia dostępności ograniczają się do niepowiązanych etykiet - nic więcej nie doszło", async () => {
    // Kontrapunkt dla zgłoszenia wyżej: pilnuje, żeby lista defektów nie rosła.
    // Nowe naruszenie (brak nazwy przycisku, zły kontrast ARIA, zła kolejność
    // nagłówków) zapali ten test, mimo że zgłoszenie obok nadal jest czerwone.
    const { container } = mount(pelnyDokument(), {
      settings: makeSettings({ popup_mailing_lists: [makeMailingList("brief")] }),
    });
    await act(async () => {});

    const naruszenia = await axeViolations(container);
    expect(naruszenia.map((v) => v.id).sort()).toEqual(["label", "select-name"]);
  });

  it("potwierdzenie zapisu jest dostępne bez naruszeń - to ostatni ekran, jaki widzi zapisany", async () => {
    const { container } = mount(makeFormDoc());
    typeEmail("jan@example.pl");
    await submitAndSettle();

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
