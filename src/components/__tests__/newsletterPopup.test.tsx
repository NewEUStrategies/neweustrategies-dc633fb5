// Popup rejestracji montowany globalnie w `__root.tsx`.
//
// DLACZEGO TEN PLIK PRZEŁADOWUJE MODUŁ PRZED KAŻDYM TESTEM. `NewsletterPopup`
// trzyma na poziomie modułu flagę `shownThisSession` - raz przyznany slot
// wyłącza wyzwalacz do końca wizyty. Bez `vi.resetModules()` drugi test w pliku
// mierzyłby wyłącznie tę flagę, a nie regułę wyzwalacza.
//
// Popup jest przerwaniem: pojawia się bez pytania, przykrywa treść i zabiera
// fokus. Dlatego testy pilnują tego, co dla czytelnika jest kosztem - kiedy
// wolno mu się pokazać, czy da się go zamknąć każdą z trzech dróg, czy pamięta
// zamknięcie i czy oddaje klawiaturę tam, skąd ją wziął.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

interface SignUpArgs {
  email: string;
  password: string;
  options: { emailRedirectTo: string; data: Record<string, unknown> };
}

const h = vi.hoisted(() => ({
  language: "pl",
  theme: "dark" as "dark" | "light",
  pathname: "/artykul/analiza",
  settings: null as unknown,
  track: vi.fn<(payload: Record<string, unknown>) => void>(),
  release: vi.fn<() => void>(),
  requestSlot: vi.fn<(id: string, opts: Record<string, unknown>) => Promise<() => void>>(),
  cancelSlot: vi.fn<(id: string) => void>(),
  preAuthGuardFn: { serverFn: "preAuthGuard" },
  subscribeFn: { serverFn: "subscribeToNewsletter" },
  guard: vi.fn<(input: { data: { kind: string; email: string } }) => Promise<unknown>>(),
  subscribe: vi.fn<(input: { data: Record<string, unknown> }) => Promise<{ ok: boolean }>>(),
  signUp: vi.fn<(args: SignUpArgs) => Promise<{ error: Error | null }>>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-signup-popup", () => ({}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: h.pathname }) }));
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: () => {}, setTheme: () => {} }),
}));
vi.mock("@/lib/overlayCoordinator", () => ({
  requestOverlaySlot: h.requestSlot,
  cancelOverlayRequest: h.cancelSlot,
}));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: h.track,
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useNewsletterSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useNewsletterSettings")>()),
  useNewsletterSettings: () => ({ data: h.settings }),
}));

// Rodzeństwo popupu ma własne suity - tutaj wchodzą atrapy, żeby test mierzył
// decyzje POPUPU (kiedy się otwiera, jak znika), a nie cudze formularze.
// Wyjątkiem jest `PopupSignupForm`: zostaje prawdziwy, bo to on wypełnia wnętrze
// okna i bez niego badanie dostępności nie miałoby czego sprawdzać.
vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: ({ lang, source }: { lang: string; source: string }) => (
    <div data-testid="newsletter-form" data-lang={lang} data-source={source} />
  ),
}));
vi.mock("@/components/newsletter/NewsletterDocRenderer", () => ({
  NewsletterDocRenderer: ({ source }: { source: string }) => (
    <div data-testid="newsletter-doc" data-source={source} />
  ),
}));
vi.mock("@/components/popups/SignupPopupPanel", () => ({
  SignupPopupPanel: ({ titleId, onClose }: { titleId: string; onClose: () => void }) => (
    <section data-testid="showcase-panel">
      <h2 id={titleId}>Panel showcase</h2>
      <button type="button" onClick={onClose}>
        zamknij panel
      </button>
    </section>
  ),
}));

vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: h.preAuthGuardFn }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: h.subscribeFn }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => (fn === h.preAuthGuardFn ? h.guard : h.subscribe),
}));
vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => ({ allow_public_signup: true, logged_in_redirect_url: "/" }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: h.signUp, resend: vi.fn() } },
}));

import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

const LS_KEY = "nl_popup_last";
const NOW = new Date("2026-08-22T10:00:00.000Z");

function popupSettings(over: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_trigger: "delay",
    popup_delay_seconds: 15,
    ...over,
  };
}

/** Domyka mikrozadania (obietnica koordynatora nakładek) wewnątrz `act`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flush();
}

/**
 * Świeży moduł na każdy test - patrz nagłówek pliku. Obok popupu stoi przycisk
 * strony, żeby dało się sprawdzić, dokąd wraca fokus po zamknięciu.
 */
async function mountWith(raw: unknown) {
  h.settings = raw;
  vi.resetModules();
  const { NewsletterPopup } = await import("@/components/NewsletterPopup");
  // Za każdym razem ŚWIEŻE drzewo: przekazanie tego samego elementu do
  // `rerender` pozwala Reactowi pominąć render, a wtedy efekt wyzwalacza
  // nie zobaczyłby zmiany ścieżki.
  const tree = () => (
    <>
      <button type="button" data-testid="wyzwalacz">
        czytaj dalej
      </button>
      <NewsletterPopup />
    </>
  );
  const view = render(tree());
  await flush();
  return { ...view, remount: () => view.rerender(tree()) };
}

async function mount(over: Partial<NewsletterSettings> = {}) {
  return mountWith(popupSettings(over));
}

/** Otwiera popup wyzwalaczem czasowym (najprostsza droga do stanu „otwarty"). */
async function openByDelay(over: Partial<NewsletterSettings> = {}) {
  const view = await mount(over);
  await advance(15_000);
  return view;
}

const dialog = () => screen.getByRole("dialog");

function setScrollGeometry(scrollHeight: number, clientHeight: number, scrollY: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  h.language = "pl";
  h.theme = "dark";
  h.pathname = "/artykul/analiza";
  h.track.mockReset();
  h.release.mockReset();
  h.cancelSlot.mockReset();
  h.requestSlot.mockReset().mockResolvedValue(h.release);
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.subscribe.mockReset().mockResolvedValue({ ok: true });
  h.signUp.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// KIEDY POPUP WOLNO POKAZAĆ
// ---------------------------------------------------------------------------

describe("NewsletterPopup: reguła wyzwalacza decyduje, kiedy czytelnik zostaje przerwany", () => {
  it("wyłączony popup nie przerywa lektury ani nie zgłasza się po slot", async () => {
    await mount({ popup_enabled: false });
    await advance(60_000);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.requestSlot).not.toHaveBeenCalled();
    expect(h.track).not.toHaveBeenCalled();
  });

  it("wyzwalacz czasowy czeka pełne opóźnienie z ustawień, a nie pokazuje się od razu", async () => {
    await mount({ popup_delay_seconds: 15 });

    await advance(14_000);
    expect(screen.queryByRole("dialog")).toBeNull();

    await advance(1_000);
    expect(dialog()).toBeInTheDocument();
  });

  it("zerowe opóźnienie z panelu nie zamienia popupu w błysk przy pierwszym pikselu", async () => {
    await mount({ popup_delay_seconds: 0 });

    await advance(999);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Podłoga wynosi jedną sekundę - popup nie mignie przy pierwszym pikselu.
    await advance(1);
    expect(dialog()).toBeInTheDocument();
  });

  it("wyzwalacz przewinięcia czeka na zadeklarowany procent strony", async () => {
    await mount({ popup_trigger: "scroll", popup_scroll_percent: 50 });

    setScrollGeometry(2000, 1000, 100);
    fireEvent.scroll(window);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();

    setScrollGeometry(2000, 1000, 600);
    fireEvent.scroll(window);
    await flush();
    expect(dialog()).toBeInTheDocument();
  });

  it("strona krótsza niż okno nie wyzwala popupu przewinięciem (dzielenie przez zero)", async () => {
    await mount({ popup_trigger: "scroll", popup_scroll_percent: 50 });

    setScrollGeometry(800, 800, 0);
    fireEvent.scroll(window);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.requestSlot).not.toHaveBeenCalled();
  });

  it("wyzwalacz przewinięcia strzela raz - po pokazaniu przestaje nasłuchiwać", async () => {
    await mount({ popup_trigger: "scroll", popup_scroll_percent: 10 });

    setScrollGeometry(2000, 1000, 900);
    fireEvent.scroll(window);
    await flush();
    fireEvent.scroll(window);
    await flush();

    expect(h.requestSlot).toHaveBeenCalledTimes(1);
  });

  it("exit-intent reaguje na kursor uciekający górą okna, a nie na każdy ruch myszy", async () => {
    await mount({ popup_trigger: "exit-intent" });

    fireEvent.mouseLeave(document, { clientY: 40 });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.mouseLeave(document, { clientY: 0 });
    await flush();
    expect(dialog()).toBeInTheDocument();

    fireEvent.mouseLeave(document, { clientY: 0 });
    await flush();
    expect(h.requestSlot).toHaveBeenCalledTimes(1);
  });

  it("panel administracyjny i ekrany logowania są wolne od popupu marketingowego", async () => {
    h.pathname = "/admin/newsletter";
    await mount();
    await advance(60_000);
    expect(screen.queryByRole("dialog")).toBeNull();

    cleanup();
    h.pathname = "/auth/callback";
    await mount();
    await advance(60_000);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.requestSlot).not.toHaveBeenCalled();
  });

  it("popup nie otwiera się sam - najpierw musi dostać slot od koordynatora nakładek", async () => {
    const pending: { grant: (release: () => void) => void } = { grant: () => {} };
    h.requestSlot.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          pending.grant = resolve;
        }),
    );

    await mount();
    await advance(15_000);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.requestSlot).toHaveBeenCalledWith("newsletter-popup", {
      marketing: true,
      priority: 0,
    });

    await act(async () => {
      pending.grant(h.release);
      await Promise.resolve();
    });
    expect(dialog()).toBeInTheDocument();
  });

  it("slot przyznany po opuszczeniu strony jest natychmiast oddawany, nie pokazuje okna", async () => {
    const pending: { grant: (release: () => void) => void } = { grant: () => {} };
    h.requestSlot.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          pending.grant = resolve;
        }),
    );

    const view = await mount();
    await advance(15_000);
    view.unmount();

    await act(async () => {
      pending.grant(h.release);
      await Promise.resolve();
    });

    expect(h.release).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.cancelSlot).toHaveBeenCalledWith("newsletter-popup");
  });

  it("kwalifikacja i pokazanie to dwa różne zdarzenia telemetrii", async () => {
    await mount();
    expect(h.track).toHaveBeenCalledWith({
      event: "impression",
      lang: "pl",
      layout: "stacked",
      source: "popup",
    });
    expect(h.track).toHaveBeenCalledTimes(1);

    await advance(15_000);
    expect(h.track).toHaveBeenCalledWith({
      event: "open",
      lang: "pl",
      layout: "stacked",
      source: "popup",
    });
  });

  it("przejście na inną podstronę nie pokazuje popupu drugi raz w tej samej wizycie", async () => {
    const view = await mount();
    await advance(15_000);
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));

    h.pathname = "/artykul/inny";
    view.remount();
    await advance(60_000);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.track.mock.calls.filter((call) => call[0].event === "impression")).toHaveLength(1);
  });

  it("język interfejsu jedzie w telemetrii i do formularza", async () => {
    h.language = "en-GB";
    await openByDelay({ popup_layout: "split" });

    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ event: "open", lang: "en" }));
  });
});

// ---------------------------------------------------------------------------
// ZAMYKANIE I PAMIĘĆ ZAMKNIĘCIA
// ---------------------------------------------------------------------------

describe("NewsletterPopup: zamykanie ma trzy drogi i jest zapamiętywane", () => {
  it("krzyżyk zamyka okno i zwalnia slot dla innych nakładek", async () => {
    await openByDelay();

    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("Escape zamyka okno - użytkownik klawiatury nie jest w nim uwięziony", async () => {
    await openByDelay();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("inny klawisz nie zamyka okna przez pomyłkę", async () => {
    await openByDelay();

    fireEvent.keyDown(window, { key: "Enter" });
    expect(dialog()).toBeInTheDocument();
  });

  it("kliknięcie w tło zamyka, kliknięcie w treść popupu nie", async () => {
    await openByDelay();

    fireEvent.click(screen.getByRole("heading", { level: 2 }));
    expect(dialog()).toBeInTheDocument();

    fireEvent.click(dialog());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zamknięcie jest zapamiętane: kolejna wizyta w oknie częstotliwości nie przerywa lektury", async () => {
    await openByDelay({ popup_frequency_days: 7 });
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    // Zegar przesunął się o zadeklarowane 15 s opóźnienia wyzwalacza.
    expect(window.localStorage.getItem(LS_KEY)).toBe(String(NOW.getTime() + 15_000));

    cleanup();
    h.requestSlot.mockClear();
    vi.setSystemTime(new Date("2026-08-25T10:00:00.000Z"));
    await mount({ popup_frequency_days: 7 });
    await advance(60_000);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.requestSlot).not.toHaveBeenCalled();
  });

  it("po upływie okna częstotliwości popup wraca", async () => {
    window.localStorage.setItem(LS_KEY, String(NOW.getTime()));

    vi.setSystemTime(new Date("2026-09-02T10:00:00.000Z"));
    await mount({ popup_frequency_days: 7 });
    await advance(15_000);

    expect(dialog()).toBeInTheDocument();
  });

  it("uszkodzony wpis w pamięci przeglądarki nie blokuje popupu na zawsze", async () => {
    window.localStorage.setItem(LS_KEY, "nie-liczba");

    await mount();
    await advance(15_000);
    expect(dialog()).toBeInTheDocument();
  });

  it("udana rejestracja zapamiętuje popup jako zamknięty, ale okna nie zatrzaskuje", async () => {
    await openByDelay({ popup_layout: "split" });

    const email = dialog().querySelector<HTMLInputElement>('input[type="email"]');
    const passwords = Array.from(dialog().querySelectorAll<HTMLInputElement>("input[minlength]"));
    const privacy = dialog().querySelectorAll<HTMLElement>('[role="checkbox"]')[1];
    expect(email).not.toBeNull();

    fireEvent.change(email as HTMLInputElement, { target: { value: "jan@firma.pl" } });
    fireEvent.change(passwords[0], { target: { value: "TajneHaslo1" } });
    fireEvent.change(passwords[1], { target: { value: "TajneHaslo1" } });
    fireEvent.click(privacy);

    // Bariera antybotowa formularza: wypełnienie musi zająć ponad 1,2 s.
    vi.setSystemTime(new Date("2026-08-22T10:00:20.000Z"));
    fireEvent.click(
      dialog().querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement,
    );
    await flush();
    await flush();

    expect(window.localStorage.getItem(LS_KEY)).toBe(
      String(new Date("2026-08-22T10:00:20.000Z").getTime()),
    );
    expect(dialog()).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ I FOKUS
// ---------------------------------------------------------------------------

describe("NewsletterPopup: dostępność okna, które zabiera uwagę", () => {
  it("okno modalne nie ma naruszeń dostępności (układ split z prawdziwym formularzem)", async () => {
    await openByDelay({ popup_layout: "split" });

    // axe-core planuje własne zadania przez `setTimeout`; z atrapą zegarów
    // nigdy by się nie doczekało własnego wyniku.
    vi.useRealTimers();
    const violations = await axeViolations(dialog());
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("okno w układzie stacked z formularzem newslettera też jest czyste", async () => {
    await openByDelay({ popup_layout: "stacked", popup_cover_url: "https://cdn/okladka.jpg" });

    vi.useRealTimers();
    const violations = await axeViolations(dialog());
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("okno jest ogłaszane jako modal i ma nazwę wziętą z własnego nagłówka", async () => {
    await openByDelay();

    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(dialog()).toHaveAttribute("aria-labelledby", "nl-popup-title");
    expect(document.getElementById("nl-popup-title")).toHaveTextContent("Załóż konto");
  });

  it("fokus wchodzi do środka okna, więc klawiatura nie zostaje pod nakładką", async () => {
    await mount();
    const trigger = screen.getByTestId("wyzwalacz");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await advance(15_000);

    const panel = dialog().firstElementChild as HTMLElement;
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("po zamknięciu fokus wraca na element, z którego popup przejął klawiaturę", async () => {
    await mount();
    const trigger = screen.getByTestId("wyzwalacz");
    trigger.focus();

    await advance(15_000);
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// UKŁADY I PALETA
// ---------------------------------------------------------------------------

describe("NewsletterPopup: każdy układ renderuje właściwą treść", () => {
  it("układ showcase oddaje całe wnętrze wspólnemu panelowi (ten sam markup co podgląd w adminie)", async () => {
    await openByDelay({ popup_layout: "showcase" });

    expect(screen.getByTestId("showcase-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "zamknij panel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("układ split z własną grafiką nie rysuje zastępczego gradientu z nazwą marki", async () => {
    await openByDelay({
      popup_layout: "split",
      popup_side_image_url: "https://cdn/bok.jpg",
      popup_eyebrow_pl: "Nadtytuł",
    });

    expect(screen.queryByText("Nadtytuł")).toBeNull();
    expect(dialog().innerHTML).toContain("https://cdn/bok.jpg");
  });

  it("układ split bez grafiki pokazuje gradient z nadtytułem i tytułem", async () => {
    await openByDelay({
      popup_layout: "split",
      popup_side_image_url: null,
      popup_eyebrow_pl: "Nadtytuł",
    });

    expect(screen.getByText("Nadtytuł")).toBeInTheDocument();
    expect(screen.getAllByText("Załóż konto").length).toBeGreaterThan(1);
  });

  it("pusty nadtytuł cofa się do słowa Newsletter zamiast zostawić puste miejsce", async () => {
    await openByDelay({
      popup_layout: "split",
      popup_side_image_url: null,
      popup_eyebrow_pl: "",
      popup_eyebrow_en: "",
    });

    expect(screen.getByText("Newsletter")).toBeInTheDocument();
  });

  it("dokument z buildera wypiera domyślną treść popupu", async () => {
    await openByDelay({
      popup_doc: { version: 1, variant: "popup", sections: [] },
      popup_layout: "split",
    });

    expect(screen.getByTestId("newsletter-doc")).toHaveAttribute("data-source", "popup");
    expect(dialog().querySelector('input[type="email"]')).toBeNull();
  });

  it("prosty popup bez pól rozszerzonych pokazuje krótki formularz newslettera, nie rejestrację konta", async () => {
    await openByDelay({
      popup_layout: "stacked",
      popup_extended_fields: false,
      popup_mailing_lists: [],
      popup_require_terms: false,
    });

    expect(screen.getByTestId("newsletter-form")).toHaveAttribute("data-source", "popup");
    expect(dialog().querySelector("input[minlength]")).toBeNull();
  });

  it.each([
    ["pola rozszerzone", { popup_extended_fields: true }],
    ["lista mailingowa", { popup_mailing_lists: [{ id: "a", label_pl: "A", label_en: "A" }] }],
    ["wymagany regulamin", { popup_require_terms: true }],
  ])(
    "%s przełącza popup na pełną rejestrację konta",
    async (_name, over: Partial<NewsletterSettings>) => {
      await openByDelay({ popup_layout: "stacked", ...over });

      expect(screen.queryByTestId("newsletter-form")).toBeNull();
      expect(dialog().querySelectorAll("input[minlength]")).toHaveLength(2);
    },
  );

  it("okładka pojawia się tylko wtedy, gdy redakcja ją ustawiła", async () => {
    await openByDelay({ popup_layout: "stacked", popup_cover_url: null });
    expect(dialog().querySelector("img")).toBeNull();

    cleanup();
    await openByDelay({ popup_layout: "stacked", popup_cover_url: "https://cdn/okladka.jpg" });
    expect(dialog().querySelector("img")).toHaveAttribute("src", "https://cdn/okladka.jpg");
  });

  it("pusty opis nie zostawia pustego akapitu pod tytułem", async () => {
    await openByDelay({ popup_description_pl: "", popup_description_en: "" });
    expect(dialog().querySelectorAll("p")).toHaveLength(0);

    cleanup();
    await openByDelay({ popup_description_pl: "Zajrzyj za kulisy." });
    expect(screen.getByText("Zajrzyj za kulisy.")).toBeInTheDocument();
  });

  it("paleta automatyczna podąża za motywem strony, zamiast świecić na biało w trybie ciemnym", async () => {
    const design = defaultPopupDesign();
    const auto = { ...design, colorScheme: "auto" as const };

    h.theme = "light";
    await openByDelay({ popup_design: auto });
    const light = dialog().firstElementChild as HTMLElement;
    const lightBg = light.style.backgroundColor;

    cleanup();
    h.theme = "dark";
    await openByDelay({ popup_design: auto });
    const dark = dialog().firstElementChild as HTMLElement;

    expect(lightBg).not.toBe("");
    expect(dark.style.backgroundColor).not.toBe(lightBg);
  });

  it("zerowy promień z panelu daje ostre narożniki, a nie domyślne zaokrąglenie", async () => {
    await openByDelay({ popup_border_radius_px: 0 });
    const panel = dialog().firstElementChild as HTMLElement;
    expect(panel.style.borderRadius).toBe("0px");
  });

  it("pusta kolumna promienia w bazie cofa się do 6 px, zamiast dać narożniki bez wartości", async () => {
    // Kolumna `popup_border_radius_px` jest w bazie NULLowalna, a hook ustawień
    // rozlewa surowy wiersz na defaulty - do komponentu naprawdę może dojść null.
    await mountWith({ ...popupSettings(), popup_border_radius_px: null });
    await advance(15_000);

    const panel = dialog().firstElementChild as HTMLElement;
    expect(panel.style.borderRadius).toBe("6px");
  });
});
