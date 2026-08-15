// Regresja panelu popupu rejestracji - jednego komponentu dla strony publicznej
// i podglądu w adminie. Pilnuje rzeczy, które łatwo zepsuć przy edycji układu:
//  1. popup zakłada KONTO (hasło + powtórzenie), a newsletter to checkbox,
//  2. każdy tekst idzie z ustawień w wersji PL/EN (bez hardkodów),
//  3. pola mają platformową etykietę pływającą (jak formularze kontaktowe),
//  4. paleta jasna/ciemna przekłada się na tokeny --nl-* panelu,
//  5. logo bierzemy z poziomego logotypu menu admina,
//  6. kolejność i widoczność bloków lewej kolumny są konfigurowalne.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  signUp: vi.fn(),
  signInOAuth: vi.fn(),
  logoUrl: { current: "https://cdn.example.com/logo-poziome.svg" as string | null },
}));

// Etykiety UI sprowadzamy do defaultValue, żeby test nie zależał od aktywnego
// języka instancji i18n. Reszta modułu zostaje realna - runtime i18n jej używa.
// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

// Tylko useServerFn jest podmieniany - reszta modułu (createIsomorphicFn,
// createMiddleware) jest potrzebna realnie, bo ciągnie ją runtime i18n.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
// Telemetria ciągnie za sobą server functions (middleware) - w teście
// interesuje nas render, więc podmieniamy cały moduł na no-op.
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: vi.fn(),
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => ({ allow_public_signup: true, logged_in_redirect_url: "/" }),
}));
vi.mock("@/lib/brand/useBrandLogoUrl", () => ({
  useBrandLogoUrl: () => h.logoUrl.current,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => h.signUp(...args),
      signInWithOAuth: (...args: unknown[]) => h.signInOAuth(...args),
    },
  },
}));

import { SignupPopupPanel } from "@/components/popups/SignupPopupPanel";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign, type PopupDesign } from "@/lib/newsletter/popupDesign";

function settings(overrides: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_layout: "showcase",
    popup_title_pl: "Załóż konto",
    popup_title_en: "Create an account",
    popup_description_pl: "Opis PL",
    popup_description_en: "Description EN",
    popup_showcase_brand_pl: "New European Strategies",
    popup_showcase_brand_en: "New European Strategies",
    popup_showcase_tagline_pl: "Przestrzeń dla twórców strategii",
    popup_showcase_tagline_en: "A workspace for strategy makers",
    popup_showcase_images: [
      { url: "https://cdn.example.com/1.jpg", caption_pl: "Kadr 1", caption_en: "Frame 1" },
      { url: "https://cdn.example.com/2.jpg", caption_pl: "Kadr 2", caption_en: "Frame 2" },
    ],
    ...overrides,
  };
}

function design(patch: (d: PopupDesign) => PopupDesign): PopupDesign {
  return patch(defaultPopupDesign());
}

const panel = () => document.querySelector<HTMLElement>("[style*='--nl-bg']");

describe("SignupPopupPanel", () => {
  beforeEach(() => {
    h.signUp.mockReset();
    h.signInOAuth.mockReset();
    h.logoUrl.current = "https://cdn.example.com/logo-poziome.svg";
  });
  afterEach(cleanup);

  it("renderuje formularz KONTA (hasło + powtórzenie), nie zapis do newslettera", () => {
    render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" />);
    expect(screen.getByRole("heading", { name: "Załóż konto" })).toBeTruthy();
    expect(screen.getByLabelText("Hasło *")).toBeTruthy();
    expect(screen.getByLabelText("Powtórz hasło *")).toBeTruthy();
    expect(screen.getByLabelText("Twój e-mail *")).toBeTruthy();
    // Newsletter zostaje opcjonalnym checkboxem.
    expect(screen.getByText("Chcę otrzymywać newsletter")).toBeTruthy();
  });

  it("bierze teksty z ustawień w wybranym języku", () => {
    render(<SignupPopupPanel settings={settings()} lang="en" mode="dark" />);
    expect(screen.getByRole("heading", { name: "Create an account" })).toBeTruthy();
    expect(screen.getByText("Description EN")).toBeTruthy();
    expect(screen.getByText("A workspace for strategy makers")).toBeTruthy();
    expect(screen.getByText("Frame 1")).toBeTruthy();
  });

  it("używa poziomego logotypu z menu admina, a nadpisanie ma priorytet", () => {
    const { container } = render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" />);
    expect(
      container.querySelector('img[src="https://cdn.example.com/logo-poziome.svg"]'),
    ).toBeTruthy();

    cleanup();
    const custom = render(
      <SignupPopupPanel
        settings={settings({
          popup_design: design((d) => ({
            ...d,
            gallery: { ...d.gallery, logoUrl: "https://cdn.example.com/own.png" },
          })),
        })}
        lang="pl"
        mode="dark"
      />,
    );
    expect(
      custom.container.querySelector('img[src="https://cdn.example.com/own.png"]'),
    ).toBeTruthy();
  });

  it("przekłada paletę na tokeny --nl-* (ciemna z kolumn, jasna z popup_design)", () => {
    const s = settings();
    render(<SignupPopupPanel settings={s} lang="pl" mode="dark" />);
    expect(panel()?.style.getPropertyValue("--nl-bg")).toBe(s.popup_bg_color);

    cleanup();
    render(<SignupPopupPanel settings={s} lang="pl" mode="light" />);
    expect(panel()?.style.getPropertyValue("--nl-bg")).toBe(s.popup_design.light.bg);
    expect(panel()?.style.getPropertyValue("--nl-radius")).toBe("6px");
  });

  it("pola używają platformowej etykiety pływającej (jak formularze kontaktowe)", () => {
    const { container } = render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" />);
    const groups = container.querySelectorAll(".input-group");
    expect(groups.length).toBeGreaterThan(0);
    // Etykieta jest w DOM obok pola (w spoczynku siedzi w polu, po focusie
    // wjeżdża na ramkę - mechanikę trzyma platformowe CSS `.user-label`).
    for (const group of groups) {
      expect(group.querySelector("input, select")).toBeTruthy();
      expect(group.querySelector("label.user-label")?.textContent).toBeTruthy();
    }
  });

  it("nie ma rejestracji przez dostawców zewnętrznych", () => {
    const { container } = render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" />);
    expect(container.textContent).not.toMatch(/google|apple/i);
    // Jedyny przycisk typu submit to CTA rejestracji; brak przycisków OAuth.
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it("panel przedefiniowuje tokeny platformy (hermetyczny wygląd w adminie)", () => {
    const s = settings();
    render(<SignupPopupPanel settings={s} lang="pl" mode="dark" />);
    const style = panel()?.style;
    // Reguła autouzupełniania Chrome maluje pole `var(--background)` - w popupie
    // musi to być tło panelu, nie tło jasnego adminu.
    expect(style?.getPropertyValue("--background")).toBe(s.popup_bg_color);
    expect(style?.getPropertyValue("--foreground")).toBe(s.popup_text_color);
    expect(style?.getPropertyValue("--primary")).toBe(s.popup_accent_color);
  });

  it("kolejność bloków galerii wynika z ustawień", () => {
    const { container } = render(
      <SignupPopupPanel
        settings={settings({
          popup_design: design((d) => ({
            ...d,
            gallery: { ...d.gallery, order: ["tagline", "grid", "caption", "brand", "dots"] },
          })),
        })}
        lang="pl"
        mode="dark"
      />,
    );
    const gallery = container.querySelector("[style*='linear-gradient']");
    const texts = Array.from(gallery?.children ?? []).map((el) => el.textContent ?? "");
    expect(texts[0]).toContain("Przestrzeń dla twórców strategii");
  });

  it("wyłączone bloki nie renderują się wcale", () => {
    render(
      <SignupPopupPanel
        settings={settings({
          popup_showcase_show_caption: false,
          popup_showcase_show_dots: false,
        })}
        lang="pl"
        mode="dark"
      />,
    );
    expect(screen.queryByText("Kadr 1")).toBeNull();
    expect(screen.queryByLabelText("Slajd 1")).toBeNull();
  });

  it("zgody i notka są konfigurowalne i sanityzowane", () => {
    render(
      <SignupPopupPanel
        settings={settings({
          popup_require_terms: true,
          popup_terms_html_pl: 'Akceptuję <a href="/regulamin">regulamin</a>.<script>x()</script>',
          popup_note_pl: "Zero spamu.",
        })}
        lang="pl"
        mode="dark"
      />,
    );
    expect(screen.getByRole("link", { name: "regulamin" })).toBeTruthy();
    expect(screen.getByText("Zero spamu.")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("przycisk zamykania pojawia się tylko z handlerem onClose", () => {
    const onClose = vi.fn();
    render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" onClose={onClose} />);
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeTruthy();
  });
});
