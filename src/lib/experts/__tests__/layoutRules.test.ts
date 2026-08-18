// Reguły układu huba eksperta.
//
// Dwie z tych funkcji to ZAPORY BEZPIECZEŃSTWA, nie kosmetyka: obie wypuszczają
// wartość do surowego CSS wstrzykiwanego przez `dangerouslySetInnerHTML`,
// a od czasu inline-edytora ta wartość pochodzi także od EKSPERTA, nie tylko
// od administratora tenanta. Do 18.08.2026 nie miały ani jednego testu, bo
// mieszkały w komponentach na 1172 i 577 linii.
import { describe, expect, it } from "vitest";
import { defaultExpertLayoutSettings, type ExpertLayoutSettings } from "@/lib/expertLayouts";
import {
  expertLayoutCssVars,
  expertLayoutScopeCss,
  overridesSignature,
  visibleExpertSections,
} from "@/lib/experts/layoutRules";

function settings(overrides: Partial<ExpertLayoutSettings> = {}): ExpertLayoutSettings {
  return { ...defaultExpertLayoutSettings("tenant-1"), ...overrides };
}

/** Tokeny w kształcie, w jakim czyta je test (CSSProperties jest szeroki). */
function vars(input: ExpertLayoutSettings, theme?: "light" | "dark"): Record<string, string> {
  return expertLayoutCssVars(input, theme) as unknown as Record<string, string>;
}

describe("expertLayoutCssVars - sanityzacja kolorów", () => {
  it("przepuszcza poprawny kolor", () => {
    expect(vars(settings({ accent_color: "#ff0044" }))["--pv-accent"]).toBe("#ff0044");
  });

  it("wartość próbująca domknąć deklarację degraduje się do tokenu motywu", () => {
    // To jest cały powód, dla którego sanityzacja jest NA WYJŚCIU, a nie tylko
    // przy zapisie: gdyby taka wartość przeszła, ekspert dopisałby dowolne
    // reguły CSS do własnej strony publicznej.
    const hostile = "red; } body { display: none; } .x {";
    expect(vars(settings({ accent_color: hostile }))["--pv-accent"]).toBe("hsl(var(--brand))");
  });

  it("kolor z adresem URL nie przechodzi", () => {
    expect(vars(settings({ hero_bg_color: "url(https://obcy/x.png)" }))["--pv-hero-bg"]).toBe(
      "transparent",
    );
  });

  it("brak koloru daje neutralne wartości domyślne, nie puste tokeny", () => {
    const result = vars(settings());
    expect(result["--pv-accent"]).toBe("hsl(var(--brand))");
    expect(result["--pv-hero-bg"]).toBe("transparent");
    expect(result["--pv-hero-text"]).toBe("inherit");
  });

  it("punktor biografii dziedziczy kolor akcentu, gdy nie ma własnego", () => {
    // Trójstopniowy łańcuch: własny -> akcent -> token motywu. Bez środkowego
    // ogniwa punktory rozjeżdżałyby się kolorystycznie z resztą strony.
    expect(vars(settings({ accent_color: "#00aa55" }))["--pv-bio-bullet"]).toBe("#00aa55");
  });

  it("własny kolor punktora wygrywa z akcentem", () => {
    const result = vars(settings({ accent_color: "#00aa55", bio_bullet_color: "#112233" }));
    expect(result["--pv-bio-bullet"]).toBe("#112233");
  });
});

describe("expertLayoutCssVars - tryb ciemny", () => {
  it("tryb jasny bierze kolory jasne", () => {
    const input = settings({ accent_color: "#111111", accent_color_dark: "#eeeeee" });
    expect(vars(input, "light")["--pv-accent"]).toBe("#111111");
  });

  it("tryb ciemny bierze warianty *_dark", () => {
    const input = settings({ accent_color: "#111111", accent_color_dark: "#eeeeee" });
    expect(vars(input, "dark")["--pv-accent"]).toBe("#eeeeee");
  });

  it("domyślnie zachowuje się jak tryb jasny", () => {
    const input = settings({ hero_bg_color: "#101010", hero_bg_color_dark: "#f0f0f0" });
    expect(vars(input)["--pv-hero-bg"]).toBe("#101010");
  });

  it("brak wariantu ciemnego NIE spada na jasny - spada na token motywu", () => {
    // Świadome zachowanie: kolor dobrany do jasnego tła bywa nieczytelny na
    // ciemnym, więc lepiej oddać stronę motywowi niż wymusić zły kontrast.
    const input = settings({ accent_color: "#111111", accent_color_dark: null });
    expect(vars(input, "dark")["--pv-accent"]).toBe("hsl(var(--brand))");
  });

  it("wrogi kolor w wariancie ciemnym też jest przycinany", () => {
    const input = settings({ accent_color_dark: 'red"; } * { display:none' });
    expect(vars(input, "dark")["--pv-accent"]).toBe("hsl(var(--brand))");
  });
});

describe("expertLayoutCssVars - rozmiary hero", () => {
  it("przepisuje ustawione rozmiary", () => {
    const result = vars(settings({ name_size_base: 30, name_size_lg: 50 }));
    expect(result["--pv-name-size-base"]).toBe("30px");
    expect(result["--pv-name-size-lg"]).toBe("50px");
  });

  it("rozmiar `lg` nigdy nie schodzi poniżej `base`", () => {
    // Odwrócona para dałaby `clamp()` z minimum większym od maksimum -
    // przeglądarki rozstrzygają to różnie, więc nagłówek raz rośnie,
    // a raz się zapada.
    const result = vars(settings({ name_size_base: 60, name_size_lg: 20 }));
    expect(result["--pv-name-size-lg"]).toBe("60px");
  });

  it("zero czytane jest jako `nie ustawiono` i wraca do wartości domyślnej", () => {
    // Pole liczbowe wyczyszczone w formularzu przychodzi jako 0, nie jako null.
    const result = vars(
      settings({ name_size_base: 0, name_size_lg: 0, role_size_base: 0, role_size_lg: 0 }),
    );
    expect(result["--pv-name-size-base"]).toBe("28px");
    expect(result["--pv-name-size-lg"]).toBe("44px");
    expect(result["--pv-role-size"]).toContain("14px");
    expect(result["--pv-role-size"]).toContain("18px");
  });

  it("wymusza minimalny czytelny rozmiar", () => {
    const result = vars(settings({ name_size_base: 4, name_size_lg: 6 }));
    expect(result["--pv-name-size-base"]).toBe("12px");
  });

  it("buduje płynny rozmiar przez clamp()", () => {
    const result = vars(settings({ name_size_base: 30, name_size_lg: 50 }));
    expect(result["--pv-name-size"]).toBe(
      "clamp(30px, calc(30px + (50 - 30) * ((100vw - 375px) / (1200 - 375))), 50px)",
    );
  });

  it("przenosi maksymalną szerokość treści", () => {
    expect(vars(settings({ max_width: 980 }))["--pv-max-width"]).toBe("980px");
  });
});

describe("expertLayoutScopeCss", () => {
  it("ogranicza nadpisanie do wrappera o danym identyfikatorze", () => {
    const css = expertLayoutScopeCss("tenant-1", settings());
    expect(css.startsWith('.dark [data-pv-scope="tenant-1"]{')).toBe(true);
    expect(css.endsWith("}")).toBe(true);
  });

  it("wypuszcza WARIANTY CIEMNE, bo cała reguła dotyczy trybu ciemnego", () => {
    const css = expertLayoutScopeCss("t", settings({ accent_color_dark: "#abcdef" }));
    expect(css).toContain("--pv-accent: #abcdef;");
  });

  it("przycina identyfikator do bezpiecznego alfabetu", () => {
    // `scopeId` wchodzi do SELEKTORA w surowym CSS. Wartość z cudzysłowem
    // domknęłaby atrybut i blok reguły, dopisując dowolne CSS do strony.
    const css = expertLayoutScopeCss('a"]{} body{display:none} [x="', settings());
    expect(css).toContain('[data-pv-scope="abodydisplaynonex"]');
    expect(css).not.toContain("body{display:none}");
  });

  it("wycina znaki spoza alfabetu, zostawiając myślnik i podkreślenie", () => {
    expect(expertLayoutScopeCss("ab_c-1<>", settings())).toContain('[data-pv-scope="ab_c-1"]');
  });

  it("pusty identyfikator nie tworzy selektora bez wartości atrybutu", () => {
    expect(expertLayoutScopeCss("", settings())).toContain('[data-pv-scope=""]');
  });
});

describe("visibleExpertSections", () => {
  it("domyślnie pokazuje wszystkie sekcje w kolejności domyślnej", () => {
    expect(visibleExpertSections(settings())).toEqual([
      "hero_cover",
      "expertise_bar",
      "details",
      "social_row",
      "contact_card",
      "media_mentions",
      "podcast_strip",
      "materials",
      "cv",
      "programs",
    ]);
  });

  it("pomija sekcje wyłączone przez redakcję", () => {
    const visible = visibleExpertSections(
      settings({ show_cv: false, show_programs: false, show_podcast_strip: false }),
    );
    expect(visible).not.toContain("cv");
    expect(visible).not.toContain("programs");
    expect(visible).not.toContain("podcast_strip");
    expect(visible).toContain("materials");
  });

  it("zachowuje WŁASNĄ kolejność sekcji, a nie domyślną", () => {
    const visible = visibleExpertSections(
      settings({ section_order: ["cv", "hero_cover", "materials"] }),
    );
    expect(visible).toEqual(["cv", "hero_cover", "materials"]);
  });

  it("filtrowanie działa na własnej kolejności", () => {
    const visible = visibleExpertSections(
      settings({ section_order: ["cv", "hero_cover", "materials"], show_hero_cover: false }),
    );
    expect(visible).toEqual(["cv", "materials"]);
  });

  it("pusta kolejność wraca do domyślnej, zamiast dać pustą stronę", () => {
    // Wiersz zapisany przed migracją kolejności ma pustą tablicę. Bez tego
    // fallbacku hub eksperta wyrenderowałby się bez ANI JEDNEJ sekcji.
    expect(visibleExpertSections(settings({ section_order: [] }))).toHaveLength(10);
  });

  it("wyłączenie wszystkiego daje pustą listę, a nie wyjątek", () => {
    const allOff = settings({
      show_hero_cover: false,
      show_expertise_bar: false,
      show_details: false,
      show_social_row: false,
      show_contact_card: false,
      show_media_mentions: false,
      show_podcast_strip: false,
      show_materials: false,
      show_cv: false,
      show_programs: false,
    });
    expect(visibleExpertSections(allOff)).toEqual([]);
  });
});

describe("overridesSignature", () => {
  it("brak nadpisań ma własną, stabilną sygnaturę", () => {
    expect(overridesSignature(null)).toBe("null");
  });

  it("jest NIEZALEŻNA od kolejności wstawiania kluczy", () => {
    // To jest cały powód istnienia tej funkcji. Settery edytora robią
    // delete/add, więc `JSON.stringify` samego obiektu dawałby różne napisy
    // dla tego samego stanu - i przycisk „Zapisz" świeciłby się bez zmiany.
    const a = { preset: "classic" as const, center_hero: true };
    const b = { center_hero: true, preset: "classic" as const };
    expect(overridesSignature(a)).toBe(overridesSignature(b));
  });

  it("jest niezależna od kolejności kluczy widoczności", () => {
    const a = { visibility: { cv: false, materials: true } };
    const b = { visibility: { materials: true, cv: false } };
    expect(overridesSignature(a)).toBe(overridesSignature(b));
  });

  it("zmiana wartości zmienia sygnaturę", () => {
    expect(overridesSignature({ center_hero: true })).not.toBe(
      overridesSignature({ center_hero: false }),
    );
  });

  it("zmiana widoczności sekcji zmienia sygnaturę", () => {
    expect(overridesSignature({ visibility: { cv: true } })).not.toBe(
      overridesSignature({ visibility: { cv: false } }),
    );
  });

  it("zmiana kolejności sekcji zmienia sygnaturę", () => {
    // Tu kolejność JEST treścią, w odróżnieniu od kolejności kluczy obiektu.
    expect(overridesSignature({ section_order: ["cv", "materials"] })).not.toBe(
      overridesSignature({ section_order: ["materials", "cv"] }),
    );
  });

  it("pusty obiekt nadpisań różni się od braku nadpisań", () => {
    expect(overridesSignature({})).not.toBe(overridesSignature(null));
  });

  it("brak pola i jawne `null` dają tę samą sygnaturę", () => {
    // Edytor kasuje pole zamiast ustawiać null - obie postacie znaczą
    // „dziedzicz z tenanta", więc nie mogą wyglądać na różny stan.
    expect(overridesSignature({ accent_color: null })).toBe(overridesSignature({}));
  });
});
