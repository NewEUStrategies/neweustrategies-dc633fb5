// Kaskada wyboru logotypu marki (src/lib/brand/useBrandLogoUrl.ts).
//
// Dlaczego ten plik istnieje: `useBrandLogoUrl` jest podmieniany atrapą w
// CZTERECH testach powierzchni, które go używają (SignupPopupEditor,
// signupPopupTabs, SignupPopupPanel, SignupPopupPanelLayout) - każda z nich
// zwraca null albo stałą, więc PRAWDZIWA kaskada nigdy się nie wykonała.
// Tutaj wołamy hook NAPRAWDĘ; atrapowane są wyłącznie jego dwie zależności
// (`useAuthSettings`, `useSiteSetting`), bo bez nich hook szedłby do bazy.
//
// Czego pilnują te testy: nie „czy coś zwraca", tylko PEŁNA KOLEJNOŚĆ
// pierwszeństwa. Zła kolejność nie wywraca żadnego renderu - daje ciemny znak
// na ciemnym tle, czego CI nie zauważa. Dlatego dla każdej pozycji kaskady
// wypełniamy ją ORAZ wszystkie pozycje po niej, i sprawdzamy, że wygrywa ta
// wcześniejsza.
//
// Zmierzona długość kaskady `useBrandLogoUrl`: 8 kandydatów dla powierzchni
// ciemnej i 7 dla jasnej (jasna nie ma w ogóle wariantu `transparent_dark`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

type LogoField =
  | "main"
  | "main_dark"
  | "mobile"
  | "mobile_dark"
  | "transparent"
  | "transparent_dark"
  | "sidebar_expanded"
  | "sidebar_expanded_dark";
type AuthField = "form_logo_url" | "form_logo_url_dark";
type LogoCfg = Record<LogoField, string>;
type AuthCfg = Record<AuthField, string>;
type Slot = { group: "logo"; key: LogoField } | { group: "auth"; key: AuthField };
type Surface = "dark" | "light";
type Shape = "horizontal" | "any";

const h = vi.hoisted(() => ({
  logo: {
    main: "",
    main_dark: "",
    mobile: "",
    mobile_dark: "",
    transparent: "",
    transparent_dark: "",
    sidebar_expanded: "",
    sidebar_expanded_dark: "",
  } as LogoCfg | null,
  auth: { form_logo_url: "", form_logo_url_dark: "" } as AuthCfg,
}));

// `theme_options` to jedyny klucz, po który sięga ten moduł; `null` odwzorowuje
// wiersz, którego nie da się zdeserializować do kształtu ThemeLogoCfg.
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T>(key: string, defaults: T): T =>
    key === "theme_options" ? ((h.logo === null ? null : { logo: h.logo }) as T) : defaults,
}));

vi.mock("@/hooks/useAuthSettings", async () => {
  const { AUTH_DEFAULTS } = await import("@/lib/authSettings");
  return { useAuthSettings: () => ({ ...AUTH_DEFAULTS, ...h.auth }) };
});

import { useBrandLogoUrl, useBrandMarkUrl } from "@/lib/brand/useBrandLogoUrl";

const L = (key: LogoField): Slot => ({ group: "logo", key });
const A = (key: AuthField): Slot => ({ group: "auth", key });

function emptyLogo(): LogoCfg {
  return {
    main: "",
    main_dark: "",
    mobile: "",
    mobile_dark: "",
    transparent: "",
    transparent_dark: "",
    sidebar_expanded: "",
    sidebar_expanded_dark: "",
  };
}

function reset(): void {
  h.logo = emptyLogo();
  h.auth = { form_logo_url: "", form_logo_url_dark: "" };
}

function slotName(slot: Slot): string {
  return slot.group === "logo" ? `theme.logo.${slot.key}` : `auth.${slot.key}`;
}

function urlFor(slot: Slot): string {
  return `https://cdn.example.com/${slot.group}-${slot.key.replace(/_/g, "-")}.svg`;
}

function setSlot(slot: Slot, url: string): void {
  if (slot.group === "logo") {
    if (h.logo === null) h.logo = emptyLogo();
    h.logo[slot.key] = url;
  } else {
    h.auth[slot.key] = url;
  }
}

/**
 * Wypełnia kandydata pod indeksem `index` ORAZ wszystkich słabszych od niego,
 * zostawiając pustymi wszystkich silniejszych. Zwraca URL, który MUSI wygrać.
 */
function fillFrom(cascade: readonly Slot[], index: number): string {
  reset();
  for (let i = index; i < cascade.length; i++) setSlot(cascade[i], urlFor(cascade[i]));
  return urlFor(cascade[index]);
}

function logoUrl(surface: Surface, shape: Shape): string | null {
  return renderHook(() => useBrandLogoUrl(surface, shape)).result.current;
}

function markUrl(surface: Surface): string | null {
  return renderHook(() => useBrandMarkUrl(surface)).result.current;
}

const LOGO_CASCADES: ReadonlyArray<{
  surface: Surface;
  shape: Shape;
  expected: readonly Slot[];
}> = [
  {
    surface: "dark",
    shape: "horizontal",
    expected: [
      L("sidebar_expanded_dark"),
      L("sidebar_expanded"),
      A("form_logo_url_dark"),
      A("form_logo_url"),
      L("transparent_dark"),
      L("main_dark"),
      L("transparent"),
      L("main"),
    ],
  },
  {
    surface: "dark",
    shape: "any",
    expected: [
      A("form_logo_url_dark"),
      A("form_logo_url"),
      L("transparent_dark"),
      L("main_dark"),
      L("transparent"),
      L("main"),
      L("sidebar_expanded_dark"),
      L("sidebar_expanded"),
    ],
  },
  {
    surface: "light",
    shape: "horizontal",
    expected: [
      L("sidebar_expanded"),
      L("sidebar_expanded_dark"),
      A("form_logo_url"),
      A("form_logo_url_dark"),
      L("transparent"),
      L("main"),
      L("main_dark"),
    ],
  },
  {
    surface: "light",
    shape: "any",
    expected: [
      A("form_logo_url"),
      A("form_logo_url_dark"),
      L("transparent"),
      L("main"),
      L("main_dark"),
      L("sidebar_expanded"),
      L("sidebar_expanded_dark"),
    ],
  },
];

const MARK_CASCADES: ReadonlyArray<{ surface: Surface; expected: readonly Slot[] }> = [
  {
    surface: "dark",
    expected: [
      L("mobile_dark"),
      L("transparent_dark"),
      L("main_dark"),
      L("mobile"),
      L("transparent"),
      L("main"),
    ],
  },
  {
    surface: "light",
    expected: [
      L("mobile"),
      L("transparent"),
      L("main"),
      L("mobile_dark"),
      L("transparent_dark"),
      L("main_dark"),
    ],
  },
];

beforeEach(() => {
  reset();
});

afterEach(() => {
  cleanup();
});

describe("useBrandLogoUrl - długość kaskady", () => {
  it.each(LOGO_CASCADES)(
    "powierzchnia $surface o kształcie $shape rozważa dokładnie tyle kandydatów, ile pozycji ma tabela",
    ({ surface, shape, expected }) => {
      expect(expected).toHaveLength(surface === "dark" ? 8 : 7);
      // Każdy kandydat jest osobnym polem - powtórka w kaskadzie znaczyłaby,
      // że jedna pozycja jest martwa i tabela pierwszeństwa kłamie.
      expect(new Set(expected.map(slotName)).size).toBe(expected.length);
      expect(logoUrl(surface, shape)).toBeNull();
    },
  );
});

describe("useBrandLogoUrl - pełna kolejność pierwszeństwa", () => {
  for (const { surface, shape, expected } of LOGO_CASCADES) {
    for (let index = 0; index < expected.length; index++) {
      const slot = expected[index];
      const weaker = expected.slice(index + 1).map(slotName);
      it(`na powierzchni ${surface} (kształt ${shape}) pole ${slotName(slot)} WYGRYWA z ${
        weaker.length === 0 ? "niczym - jest ostatnie w kaskadzie" : weaker.join(", ")
      }`, () => {
        const expectedUrl = fillFrom(expected, index);

        expect(logoUrl(surface, shape)).toBe(expectedUrl);
      });
    }
  }
});

describe("useBrandLogoUrl - przypadki brzegowe", () => {
  it.each(LOGO_CASCADES)(
    "zwraca null, gdy dla powierzchni $surface o kształcie $shape KAŻDE pole jest puste",
    ({ surface, shape }) => {
      expect(logoUrl(surface, shape)).toBeNull();
    },
  );

  it("BEZ argumentów zachowuje się jak wywołanie dla powierzchni ciemnej i kształtu dowolnego", () => {
    h.auth.form_logo_url_dark = "https://cdn.example.com/auth-form-logo-url-dark.svg";
    h.auth.form_logo_url = "https://cdn.example.com/auth-form-logo-url.svg";

    const domyslne = renderHook(() => useBrandLogoUrl()).result.current;

    expect(domyslne).toBe("https://cdn.example.com/auth-form-logo-url-dark.svg");
    expect(domyslne).toBe(logoUrl("dark", "any"));
  });

  it("NIE bierze pod uwagę sygnetu mobilnego - on należy do useBrandMarkUrl", () => {
    if (h.logo === null) throw new Error("konfiguracja logo powinna byc obiektem");
    h.logo.mobile = "https://cdn.example.com/logo-mobile.svg";
    h.logo.mobile_dark = "https://cdn.example.com/logo-mobile-dark.svg";

    expect(logoUrl("dark", "any")).toBeNull();
    expect(logoUrl("dark", "horizontal")).toBeNull();
    expect(logoUrl("light", "any")).toBeNull();
    expect(logoUrl("light", "horizontal")).toBeNull();
  });

  it("na powierzchni JASNEJ nigdy nie sięga po wariant transparent_dark", () => {
    if (h.logo === null) throw new Error("konfiguracja logo powinna byc obiektem");
    h.logo.transparent_dark = "https://cdn.example.com/logo-transparent-dark.svg";

    expect(logoUrl("light", "any")).toBeNull();
    expect(logoUrl("light", "horizontal")).toBeNull();
    // Ta sama wartość na powierzchni ciemnej jest natomiast pełnoprawnym kandydatem.
    expect(logoUrl("dark", "any")).toBe("https://cdn.example.com/logo-transparent-dark.svg");
  });

  it("gdy ustawienia motywu w ogóle NIE dają się odczytać, korzysta wyłącznie z logo formularza logowania", () => {
    h.logo = null;
    h.auth.form_logo_url_dark = "https://cdn.example.com/auth-form-logo-url-dark.svg";

    expect(logoUrl("dark", "horizontal")).toBe(
      "https://cdn.example.com/auth-form-logo-url-dark.svg",
    );
  });

  it("gdy ustawienia motywu NIE dają się odczytać i nie ma logo formularza, zwraca null", () => {
    h.logo = null;

    expect(logoUrl("dark", "horizontal")).toBeNull();
    expect(logoUrl("light", "any")).toBeNull();
  });
});

describe("useBrandMarkUrl - pełna kolejność pierwszeństwa", () => {
  for (const { surface, expected } of MARK_CASCADES) {
    for (let index = 0; index < expected.length; index++) {
      const slot = expected[index];
      const weaker = expected.slice(index + 1).map(slotName);
      it(`na powierzchni ${surface} sygnet ${slotName(slot)} WYGRYWA z ${
        weaker.length === 0 ? "niczym - jest ostatni w kaskadzie" : weaker.join(", ")
      }`, () => {
        const expectedUrl = fillFrom(expected, index);

        expect(markUrl(surface)).toBe(expectedUrl);
      });
    }
  }
});

describe("useBrandMarkUrl - przypadki brzegowe", () => {
  it.each(MARK_CASCADES)(
    "na powierzchni $surface rozważa dokładnie 6 kandydatów i zwraca null, gdy wszystkie są puste",
    ({ surface, expected }) => {
      expect(expected).toHaveLength(6);
      expect(markUrl(surface)).toBeNull();
    },
  );

  it("BEZ argumentu zachowuje się jak wywołanie dla powierzchni JASNEJ", () => {
    if (h.logo === null) throw new Error("konfiguracja logo powinna byc obiektem");
    h.logo.mobile = "https://cdn.example.com/logo-mobile.svg";
    h.logo.mobile_dark = "https://cdn.example.com/logo-mobile-dark.svg";

    const domyslny = renderHook(() => useBrandMarkUrl()).result.current;

    expect(domyslny).toBe("https://cdn.example.com/logo-mobile.svg");
    expect(domyslny).toBe(markUrl("light"));
  });

  it("NIE bierze pod uwagę logo formularza logowania ani poziomego logo menu admina", () => {
    if (h.logo === null) throw new Error("konfiguracja logo powinna byc obiektem");
    h.auth.form_logo_url = "https://cdn.example.com/auth-form-logo-url.svg";
    h.auth.form_logo_url_dark = "https://cdn.example.com/auth-form-logo-url-dark.svg";
    h.logo.sidebar_expanded = "https://cdn.example.com/logo-sidebar-expanded.svg";
    h.logo.sidebar_expanded_dark = "https://cdn.example.com/logo-sidebar-expanded-dark.svg";

    expect(markUrl("dark")).toBeNull();
    expect(markUrl("light")).toBeNull();
  });

  it("gdy ustawienia motywu NIE dają się odczytać, zwraca null", () => {
    h.logo = null;

    expect(markUrl("dark")).toBeNull();
    expect(markUrl("light")).toBeNull();
  });
});
