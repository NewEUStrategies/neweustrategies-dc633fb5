// Dwie trasy publiczne modułu konta: `/contribute` i `/support`.
//
// CO TE TRASY ŁĄCZY - I DLACZEGO SIEDZĄ W JEDNYM PLIKU. Obie są PUBLICZNE, obie
// mają wyłącznik po stronie konfiguracji, i w obu wyłącznik decyduje o tym, czy
// strona w ogóle coś oferuje. Oba pliki stały na okrągłym zerze.
//
// CO TEN PLIK DOWODZI:
//
//   1. WYŁĄCZONY MODUŁ MÓWI, ŻE JEST WYŁĄCZONY. `/contribute` z wyłączonym
//      programem kontrybutorów i `/support` z wyłączonymi darowiznami muszą
//      pokazać komunikat, nie pusty formularz i nie przycisk prowadzący nikąd.
//   2. GOŚĆ WIDZI, CZEGO MU BRAKUJE. `/contribute` nie renderuje formularza
//      osobie niezalogowanej (RLS i tak odrzuci wstawienie: `user_id =
//      auth.uid()`), ale MUSI powiedzieć, że trzeba się zalogować - inaczej
//      strona wygląda na zepsutą.
//   3. PRÓG DŁUGOŚCI ZGŁOSZENIA JEST PO STRONIE KLIENTA I PO STRONIE BAZY.
//      Przycisk nieaktywny do 5 znaków tytułu i 40 znaków propozycji oszczędza
//      odbicie od RLS-a, którego użytkownik nie umiałby zinterpretować.
//   4. NAGŁÓWEK SEO JEST NADPISYWALNY Z PANELU. `/contribute` czyta
//      `static_page_seo`; awaria tego odczytu nie ma prawa wywrócić strony,
//      tylko cofnąć się do tekstu wbudowanego.
//   5. DOKUMENT Z PANELU WYGRYWA NA `/support`. Gdy redakcja opublikuje stronę
//      o tym adresie, jest ona źródłem prawdy; brak dokumentu ORAZ awaria jego
//      odczytu degradują do sekcji wbudowanej - i to są dwie różne drogi do tego
//      samego widoku, obie sprawdzone.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - BUDOWANIA NAGŁÓWKA: `lib/seo/meta` (`buildContentHead`) i
//   `lib/queries/staticPageSeo` (`pickStaticSeo`) mają własne testy. Tutaj
//   dowodzimy, że trasa je WOŁA i respektuje wynik.
// - KONFIGURACJI DAROWIZN: `lib/billing/donationsConfigQuery` ma własne testy;
//   `useDonationTarget` jest tu atrapą trzech rozłącznych stanów.
// - RENDEREREM TREŚCI: `ContentRenderer` i `prepareContentForRender` mają testy
//   przy warstwie treści; na tej trasie stoją jako atrapy-markery.
// - POLITYK `contributor_submissions`: RLS (`user_id = auth.uid() AND status =
//   'submitted'`) jest dowiedziona w pgTAP. Sprawdzamy KSZTAŁT wiersza, nie
//   autorytet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Konfiguracja modułów społeczności - wyłącznik `/contribute`. */
  contributorEnabled: true,
  user: { id: "user-1" } as { id: string } | null,
  /** Wiersze wstawione do `contributor_submissions` - przedmiot dowodu. */
  inserted: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  /** Wartość, którą wstawienie ma ODRZUCIĆ obietnicę (`null` = nie odrzuca). */
  rejectInsertWith: null as unknown,
  /** Bramka wstrzymująca wstawienie - do podejrzenia stanu oczekiwania. */
  insertGate: null as Promise<void> | null,
  /** Wynik odczytu SEO z panelu (`null` = brak wpisu, `"fail"` = awaria). */
  staticSeo: null as Record<string, unknown> | null | "fail",
  /** Cel darowizny widziany przez `/support`. */
  donationTarget: { kind: "internal", href: "/donate" } as {
    kind: "internal" | "external" | "disabled";
    href?: string;
  },
  /** Odpowiedź zapytania o dokument buildera dla `/support`. */
  supportDoc: null as unknown,
  supportDocFails: false,
  /** Język interfejsu - decyduje o wyborze treści dokumentu. */
  language: "pl",
  /**
   * Adres ŻĄDANIA widziany przez `head()`. Nagłówek wybiera język z ADRESU
   * (`activeLang`), nie z interfejsu: robot indeksujący nie ma sesji ani
   * preferencji, więc `/en/...` musi dać angielskie meta samo z siebie.
   * `null` = brak kontekstu żądania (trasa cofa się do swojej ścieżki).
   */
  requestUrl: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-support", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, session: h.user ? {} : null, loading: false, roles: [] }),
}));
vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => ({ contributor_program_enabled: h.contributorEnabled }),
}));
vi.mock("@/components/community/CommunityDisabled", () => ({
  CommunityDisabled: () => <div data-testid="community-disabled" />,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserted.push(row);
        if (h.insertGate !== null) await h.insertGate;
        // Odrzucenie wartością spoza `Error` - klient potrafi tak zerwać
        // żądanie (przerwane połączenie), a komponent musi to obsłużyć.
        if (h.rejectInsertWith !== null) throw h.rejectInsertWith;
        return { error: h.insertError };
      },
    }),
  },
}));
vi.mock("@/lib/queries/staticPageSeo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/staticPageSeo")>();
  return {
    ...actual,
    staticPageSeoQueryOptions: (slug: string) => ({
      queryKey: ["static-page-seo", slug],
      queryFn: () => {
        if (h.staticSeo === "fail") throw new Error("test: odczyt SEO nieudany");
        return Promise.resolve(h.staticSeo);
      },
    }),
  };
});
vi.mock("@/lib/billing/donationsConfigQuery", () => ({
  useDonationTarget: () => h.donationTarget,
}));
vi.mock("@/lib/queries/public", () => ({
  resolvedContentQueryOptions: (segments: string[]) => ({
    queryKey: ["resolved-content", ...segments],
    queryFn: () => {
      if (h.supportDocFails) throw new Error("test: dokument nieosiągalny");
      return Promise.resolve(h.supportDoc);
    },
  }),
}));
vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: (props: { lang: string; html?: string }) => (
    <div data-testid="content-renderer" data-lang={props.lang} data-html={props.html ?? ""} />
  ),
}));
vi.mock("@/components/Footnotes", () => ({
  FootnoteTooltips: () => null,
  FootnotesList: () => <div data-testid="footnotes" />,
}));
// Radix Select nie działa pod happy-dom bez pełnego pointer API. Natywny
// odpowiednik oddaje kontrakt: KTÓRE opcje trasa wystawia i co robi ze zmianą.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as ContributeRoute } from "@/routes/contribute";
import { Route as SupportRoute } from "@/routes/support";

/** Wartość wpisu `meta` po nazwie (`title` albo `name`). */
function metaValue(meta: Record<string, unknown>[], key: string): unknown {
  if (key === "title") return meta.find((entry) => "title" in entry)?.title;
  return meta.find((entry) => entry.name === key || entry.property === key)?.content;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.contributorEnabled = true;
  h.user = { id: "user-1" };
  h.inserted = [];
  h.insertError = null;
  h.rejectInsertWith = null;
  h.insertGate = null;
  h.staticSeo = null;
  h.donationTarget = { kind: "internal", href: "/donate" };
  h.supportDoc = null;
  h.supportDocFails = false;
  h.language = "pl";
  h.requestUrl = null;
});

afterEach(() => cleanup());

describe("/contribute - wyłącznik modułu", () => {
  it("wyłączony program kontrybutorów pokazuje komunikat, NIE formularz", async () => {
    // Formularz zgłoszenia do programu, którego nie ma, zbierałby propozycje,
    // których nikt nie czyta.
    h.contributorEnabled = false;
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    expect(screen.getByTestId("community-disabled")).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });

  it("włączony program renderuje stronę z wytycznymi", async () => {
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    expect(screen.getByText("community.contribute.title")).toBeTruthy();
    expect(screen.getByText("community.contribute.guidelines")).toBeTruthy();
  });
});

describe("/contribute - gość kontra zalogowany", () => {
  it("GOŚĆ nie dostaje formularza, ale dostaje ZDANIE dlaczego", async () => {
    // Bez tego zdania strona wygląda na zepsutą: nagłówek, wytyczne i nic więcej.
    h.user = null;
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    expect(screen.getByText("community.contribute.signInHint")).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });

  it("zalogowany dostaje formularz i NIE dostaje podpowiedzi o logowaniu", async () => {
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    expect(document.querySelector("form")).toBeTruthy();
    expect(screen.queryByText("community.contribute.signInHint")).toBeNull();
  });
});

describe("/contribute - próg zgłoszenia", () => {
  const title = () => document.getElementById("contrib-title") as HTMLInputElement;
  const pitch = () => document.getElementById("contrib-pitch") as HTMLTextAreaElement;
  const submitButton = () =>
    screen.getByText("community.contribute.submit").closest("button") as HTMLButtonElement;

  async function mountForm() {
    return renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
  }

  function fill(titleValue: string, pitchValue: string) {
    fireEvent.change(title(), { target: { value: titleValue } });
    fireEvent.change(pitch(), { target: { value: pitchValue } });
  }

  it("pusty formularz ma NIEAKTYWNY przycisk wysyłki", async () => {
    await mountForm();
    expect(submitButton().disabled).toBe(true);
  });

  it.each([
    ["abcd", "x".repeat(40), "tytuł o jeden znak za krótki"],
    ["abcde", "x".repeat(39), "propozycja o jeden znak za krótka"],
    ["     ", "x".repeat(40), "tytuł z samych spacji"],
    ["abcde", "   ".repeat(20), "propozycja z samych spacji"],
  ])("%j + %j (%s) nie odblokowuje wysyłki", async (titleValue, pitchValue) => {
    await mountForm();
    fill(titleValue, pitchValue);
    expect(submitButton().disabled).toBe(true);
  });

  it("próg dokładnie spełniony odblokowuje wysyłkę - granica jest włączna", async () => {
    await mountForm();
    fill("abcde", "x".repeat(40));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
  });

  it("zgłoszenie poniżej progu NIE jedzie do bazy, choćby ktoś wysłał formularz", async () => {
    // Zgłoszenie formularza obok przycisku (Enter w polu) też musi respektować
    // próg - inaczej RLS odbija wiersz, a użytkownik widzi surowy błąd bazy.
    await mountForm();
    fill("abc", "krótko");
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(h.inserted).toEqual([]));
  });
});

describe("/contribute - zapis zgłoszenia", () => {
  async function submitValid(language?: "pl" | "en") {
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    fireEvent.change(document.getElementById("contrib-title")!, {
      target: { value: "  Propozycja tekstu  " },
    });
    fireEvent.change(document.getElementById("contrib-pitch")!, {
      target: { value: `  ${"x".repeat(60)}  ` },
    });
    if (language) {
      fireEvent.change(screen.getByTestId("select"), { target: { value: language } });
    }
    fireEvent.submit(document.querySelector("form")!);
  }

  it("wiersz niesie autora, status i PRZYCIĘTE wartości", async () => {
    // `status: "submitted"` jest warunkiem polityki wstawiania - bez niego RLS
    // odrzuca wiersz. Przycięcie jest po stronie klienta, bo baza zapisze
    // dokładnie to, co dostanie.
    await submitValid();
    await waitFor(() => expect(h.inserted).toHaveLength(1));
    expect(h.inserted[0]).toEqual({
      user_id: "user-1",
      title: "Propozycja tekstu",
      pitch: "x".repeat(60),
      language: "pl",
      status: "submitted",
    });
  });

  it("wybrany język zgłoszenia jedzie do wiersza", async () => {
    await submitValid("en");
    await waitFor(() => expect(h.inserted).toHaveLength(1));
    expect(h.inserted[0].language).toBe("en");
  });

  it("po udanym zapisie formularz ustępuje POTWIERDZENIU i pola są czyste", async () => {
    await submitValid();
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("community.contribute.success"),
    );
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByText("community.contribute.success")).toBeTruthy();
  });

  it("język zgłoszenia jest WSTĘPNIE ustawiony na język interfejsu", async () => {
    // Osoba czytająca serwis po angielsku najczęściej pisze po angielsku -
    // domyślne „polski" kazałoby jej to poprawiać przy każdym zgłoszeniu.
    h.language = "en";
    await renderRoute({ route: ContributeRoute, path: "/contribute", initialEntry: "/contribute" });
    expect((screen.getByTestId("select") as HTMLSelectElement).value).toBe("en");
  });

  it("odmowa bez komunikatu degraduje do klucza, nie do „undefined”", async () => {
    // Klient bazy potrafi odrzucić obietnicę wartością, która nie jest błędem
    // (np. przerwane żądanie) - komunikat „undefined" w toaście nie pomaga nikomu.
    const client = await import("@/integrations/supabase/client");
    const spy = vi.spyOn(client.supabase, "from").mockReturnValue({
      insert: () => Promise.reject({ code: 500 }),
    } as unknown as ReturnType<typeof client.supabase.from>);
    await submitValid();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("community.contribute.error"));
    spy.mockRestore();
  });

  it("BŁĄD zapisu zostawia formularz z wpisaną treścią", async () => {
    // Wyczyszczony formularz po nieudanym zapisie każe pisać propozycję od nowa
    // i wygląda jak wysłana.
    h.insertError = { message: "new row violates row-level security policy" };
    await submitValid();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(document.querySelector("form")).toBeTruthy();
    expect((document.getElementById("contrib-title") as HTMLInputElement).value).toBe(
      "  Propozycja tekstu  ",
    );
    expect(screen.queryByText("community.contribute.success")).toBeNull();
  });

  it("wysyłka w locie blokuje przycisk - jedno zgłoszenie, nie trzy", async () => {
    // Bramka wstrzymuje odpowiedź bazy (bez zegarów), więc formularz stoi
    // w stanie oczekiwania dokładnie tak długo, jak potrzebuje test. Idzie przez
    // STAN ATRAPY, nie przez podmianę `supabase.from`: ten builder jest mocno
    // typowany na schemat bazy, a atrapa udająca go wymagałaby `as unknown as`.
    let release: () => void = () => undefined;
    h.insertGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await submitValid();
    await waitFor(() => expect(h.inserted).toHaveLength(1));
    const button = screen.getByText("community.contribute.submitting").closest("button");
    expect(button?.hasAttribute("disabled")).toBe(true);
    release();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});

describe("/contribute - nagłówek strony", () => {
  it("bez wpisu w panelu używa tekstu wbudowanego", async () => {
    h.staticSeo = null;
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    const title = metaValue(view.meta(), "title");
    expect(typeof title).toBe("string");
    expect(String(title)).toContain("New European Strategies");
  });

  it("wpis z panelu NADPISUJE tytuł i opis", async () => {
    // Kształt wiersza `static_page_seo` - pola `seo_*` mają pierwszeństwo nad
    // tytułem i zajawką strony (patrz `pickStaticSeo`).
    h.staticSeo = {
      seo_title_pl: "Piszemy o Europie",
      seo_description_pl: "Zgłoś propozycję tekstu",
      title_pl: "Tytuł strony",
      excerpt_pl: "Zajawka strony",
      seo_noindex: false,
    };
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    expect(metaValue(view.meta(), "title")).toBe("Piszemy o Europie");
    expect(metaValue(view.meta(), "description")).toBe("Zgłoś propozycję tekstu");
  });

  it("`noindex` z panelu dociera do nagłówka robots", async () => {
    // Redakcja musi umieć wyjąć tę stronę z wyników wyszukiwania bez deploya.
    h.staticSeo = { seo_title_pl: "x", seo_description_pl: "y", seo_noindex: true };
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    expect(String(metaValue(view.meta(), "robots"))).toContain("noindex");
  });

  it("AWARIA odczytu SEO nie wywraca strony - nagłówek cofa się do wbudowanego", async () => {
    // Loader łapie ten błąd (`.catch(() => null)`); bez tego blip w bazie
    // zabierałby całą publiczną stronę zgłoszeń.
    h.staticSeo = "fail";
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    expect(screen.getByText("community.contribute.title")).toBeTruthy();
    expect(String(metaValue(view.meta(), "title"))).toContain("New European Strategies");
  });

  it("wersja ANGIELSKA nagłówka ma własny tytuł i opis", async () => {
    // Nagłówek wybiera język z ADRESU żądania (`activeLang`), nie z interfejsu:
    // robot indeksujący nie ma sesji ani preferencji.
    h.requestUrl = "/en/contribute";
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    const title = String(metaValue(view.meta(), "title"));
    const description = String(metaValue(view.meta(), "description"));
    expect(title + description).toMatch(/contributor|European affairs/i);
  });

  it("wpis z panelu w wersji ANGIELSKIEJ wygrywa nad tekstem wbudowanym", async () => {
    h.staticSeo = {
      seo_title_en: "Write for us",
      seo_description_en: "Pitch us a story",
      seo_title_pl: "Piszemy o Europie",
      seo_description_pl: "Zgłoś propozycję",
    };
    h.requestUrl = "/en/contribute";
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    expect(metaValue(view.meta(), "title")).toBe("Write for us");
    expect(metaValue(view.meta(), "description")).toBe("Pitch us a story");
  });

  it("kanoniczny adres z panelu nadpisuje wyliczony", async () => {
    // Redakcja konsoliduje ranking na innym adresie (np. po migracji strony).
    h.staticSeo = { seo_canonical_url: "https://example.org/kontrybutorzy" };
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    const canonical = view.links().find((link) => link.rel === "canonical");
    expect(canonical?.href).toBe("https://example.org/kontrybutorzy");
  });

  it("obraz OG z panelu dociera do nagłówka", async () => {
    h.staticSeo = { seo_og_image_url: "https://cdn.example.org/og.png" };
    const view = await renderRoute({
      route: ContributeRoute,
      path: "/contribute",
      initialEntry: "/contribute",
    });
    expect(String(metaValue(view.meta(), "og:image"))).toContain("og.png");
  });

  it("`head()` da się odczytać bez montowania trasy", async () => {
    const meta = await routeMeta(ContributeRoute);
    expect(meta.length).toBeGreaterThan(0);
  });
});

describe("/support - cel darowizny", () => {
  async function mountSupport() {
    return renderRoute({ route: SupportRoute, path: "/support", initialEntry: "/support" });
  }

  it("WYŁĄCZONE darowizny pokazują komunikat, NIE przycisk prowadzący nikąd", async () => {
    h.donationTarget = { kind: "disabled" };
    await mountSupport();
    expect(screen.getByText("support.closed")).toBeTruthy();
    expect(screen.queryByText("support.cta")).toBeNull();
    expect(screen.queryByText("support.externalCta")).toBeNull();
  });

  it("WŁASNA kasa prowadzi wewnętrznym odnośnikiem", async () => {
    h.donationTarget = { kind: "internal", href: "/donate" };
    await mountSupport();
    const link = screen.getByText("support.cta").closest("a");
    expect(link?.getAttribute("href")).toBe("/donate");
    // Wewnętrzny cel nie otwiera nowej karty ani nie dokłada `rel`.
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("ZBIÓRKA ZEWNĘTRZNA otwiera nową kartę z bezpiecznym `rel`", async () => {
    // Bez `noopener` obca strona dostaje referencję do naszego okna.
    h.donationTarget = { kind: "external", href: "https://zbiorka.example.org/nes" };
    await mountSupport();
    const link = screen.getByText("support.externalCta").closest("a");
    expect(link?.getAttribute("href")).toBe("https://zbiorka.example.org/nes");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("tryb zewnętrzny ma WŁASNE teksty - nie udaje własnej kasy", async () => {
    h.donationTarget = { kind: "external", href: "https://zbiorka.example.org/nes" };
    await mountSupport();
    expect(screen.getByText("support.externalLead")).toBeTruthy();
    expect(screen.getByText("support.externalNote")).toBeTruthy();
    expect(screen.queryByText("support.ctaLead")).toBeNull();
  });
});

describe("/support - dokument z panelu kontra sekcja wbudowana", () => {
  async function mountSupport() {
    return renderRoute({ route: SupportRoute, path: "/support", initialEntry: "/support" });
  }

  it("BRAK dokumentu renderuje sekcję wbudowaną z powrotem do cennika", async () => {
    h.supportDoc = null;
    await mountSupport();
    expect(screen.getByText("support.title")).toBeTruthy();
    expect(screen.getByText("support.backToPricing").closest("a")?.getAttribute("href")).toBe(
      "/pricing",
    );
    expect(screen.queryByTestId("content-renderer")).toBeNull();
  });

  it("AWARIA odczytu dokumentu też degraduje do sekcji wbudowanej", async () => {
    // Druga droga do tego samego widoku - i ważniejsza: strona wsparcia nie ma
    // prawa zniknąć, gdy zapytanie o dokument padnie.
    h.supportDocFails = true;
    await mountSupport();
    expect(screen.getByText("support.title")).toBeTruthy();
  });

  it("dokument INNEGO rodzaju (np. wpis) nie zastępuje sekcji wbudowanej", async () => {
    // `resolvedContent` rozwiązuje adres na wpis ALBO stronę; wpis pod tym
    // adresem nie jest dokumentem tej strony.
    h.supportDoc = { kind: "post", item: { id: "p1" } };
    await mountSupport();
    expect(screen.getByText("support.title")).toBeTruthy();
  });

  it("dokument PUSTY (bez treści w żadnym języku) nie zastępuje sekcji wbudowanej", async () => {
    // Strona utworzona i nigdy niewypełniona nie może wygasić sekcji, która
    // realnie kieruje do wpłaty.
    h.supportDoc = {
      kind: "page",
      item: { content_pl: null, content_en: null, builder_data: null, blocks_data: null },
    };
    await mountSupport();
    expect(screen.getByText("support.title")).toBeTruthy();
    expect(screen.queryByTestId("content-renderer")).toBeNull();
  });

  it("dokument z TREŚCIĄ zastępuje CAŁY widok wbudowany", async () => {
    // Gdy redakcja opublikuje stronę o tym adresie, jest ona źródłem prawdy -
    // sekcja wbudowana nie ma prawa się dokleić pod nią po raz drugi.
    h.supportDoc = {
      kind: "page",
      item: {
        editor: "html",
        content_pl: "<p>Mecenat obywatelski</p>",
        content_en: null,
        builder_data: null,
        blocks_data: null,
      },
    };
    await mountSupport();
    expect(screen.getByTestId("content-renderer")).toBeTruthy();
    expect(screen.queryByText("support.title")).toBeNull();
    expect(screen.queryByText("support.backToPricing")).toBeNull();
    // Przypisy renderują się razem z dokumentem, nie osobno.
    expect(screen.getByTestId("footnotes")).toBeTruthy();
  });

  it("dokument dostaje treść w JĘZYKU INTERFEJSU", async () => {
    h.language = "en";
    h.supportDoc = {
      kind: "page",
      item: {
        editor: "html",
        content_pl: "<p>Wersja polska</p>",
        content_en: "<p>English version</p>",
        builder_data: null,
        blocks_data: null,
      },
    };
    await mountSupport();
    const renderer = screen.getByTestId("content-renderer");
    expect(renderer.getAttribute("data-lang")).toBe("en");
    expect(renderer.getAttribute("data-html")).toContain("English version");
  });

  it("brak treści w bieżącym języku cofa się do drugiego, nie do pustki", async () => {
    // Strona opublikowana tylko po polsku musi się pokazać także w EN -
    // pusty dokument byłby gorszy od sekcji wbudowanej.
    h.language = "en";
    h.supportDoc = {
      kind: "page",
      item: {
        editor: "html",
        content_pl: "<p>Tylko po polsku</p>",
        content_en: null,
        builder_data: null,
        blocks_data: null,
      },
    };
    await mountSupport();
    expect(screen.getByTestId("content-renderer").getAttribute("data-html")).toContain(
      "Tylko po polsku",
    );
  });

  it("dokument z blokami wybiera zestaw bloków dla bieżącego języka", async () => {
    h.supportDoc = {
      kind: "page",
      item: {
        editor: "blocks",
        content_pl: null,
        content_en: null,
        builder_data: null,
        blocks_data: { pl: { blocks: [{ type: "paragraph", text: "Blok PL" }] }, en: null },
      },
    };
    await mountSupport();
    expect(screen.getByTestId("content-renderer")).toBeTruthy();
  });

  it("trzy punkty „dlaczego” są czytane PER KLUCZ, nie jedną tablicą", async () => {
    // Tablica pod jednym kluczem uchodziła bramce rozjazdu kod ⇄ słownik za
    // klucz nieistniejący w obu językach - stąd trzy osobne klucze.
    await mountSupport();
    expect(screen.getByText("support.whyItems.policy")).toBeTruthy();
    expect(screen.getByText("support.whyItems.openAccess")).toBeTruthy();
    expect(screen.getByText("support.whyItems.community")).toBeTruthy();
  });

  it("sekcja „dlaczego” ma nazwę powiązaną z nagłówkiem", async () => {
    const view = await mountSupport();
    const section = view.container.querySelector('section[aria-labelledby="support-why"]');
    expect(section).toBeTruthy();
    expect(section?.querySelector("#support-why")).toBeTruthy();
  });

  it("nagłówek strony niesie tytuł i opis mecenatu", async () => {
    const view = await mountSupport();
    expect(String(metaValue(view.meta(), "title"))).toContain("New European Strategies");
    expect(String(metaValue(view.meta(), "description")).length).toBeGreaterThan(20);
  });

  it("wersja ANGIELSKA nagłówka mówi o mecenacie po angielsku", async () => {
    h.requestUrl = "/en/support";
    const view = await renderRoute({
      route: SupportRoute,
      path: "/support",
      initialEntry: "/support",
    });
    expect(String(metaValue(view.meta(), "title"))).toContain("Support us");
    expect(String(metaValue(view.meta(), "description"))).toContain("patronage");
  });
});
