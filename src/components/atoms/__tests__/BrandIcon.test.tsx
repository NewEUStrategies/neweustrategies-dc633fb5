// Atom `BrandIcon` - ROZSTRZYGANIE, co ostatecznie trafia na ekran: wiersz
// z biblioteki ikon czy komponent zapasowy (Lucide).
//
// Przedmiotem dowodu są cztery reguły, które atom podejmuje sam:
//   1. TABELA ALIASOW - „x" ma trafić w wiersz zapisany jako „twitter", bo
//      biblioteka bywa wypełniana pod starą nazwą marki; nazwa spoza tabeli
//      szuka samej siebie.
//   2. PRIORYTET KIND-ów przy duplikacie nazwy (brand > custom > flag) - atom
//      celowo czyta WSZYSTKIE kindy (nagłówek `useBrandIcons`), więc kolizja
//      nazw jest stanem normalnym, nie błędem.
//   3. TRYB KOLORU - wariant light/dark wybierany zgodnie z motywem.
//   4. DEGRADACJA DO FALLBACKU - w trzech odmiennych sytuacjach: brak wiersza,
//      wiersz ISTNIEJĄCY bez żadnego URL-a, oraz wiersz z URL-em, którego
//      `resolveIconUrl` nie odda dla bieżącego wariantu. Ostatnia sytuacja
//      jest właściwym ryzykiem: pusty `src` w `<img>` to ZŁAMANA ikona,
//      a nie brak ikony.
//
// Atrapujemy WYŁĄCZNIE zależności: źródło danych (`listIcons`) i motyw
// (`useTheme`). Samo rozstrzyganie - aliasy, priorytet, wybór wariantu URL -
// zostaje prawdziwe, razem z `resolveIconUrl` i `slugifyIconName`.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Globe } from "lucide-react";
import type { ReactElement } from "react";
import type { IconRow } from "@/lib/iconLibrary";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { Facebook } from "@/lib/icons/brandIcons";
import { listIcons } from "@/lib/iconLibrary";
import { BrandIcon } from "../BrandIcon";

const h = vi.hoisted(() => ({
  rows: [] as IconRow[],
  theme: "light" as "light" | "dark",
}));

vi.mock("@/lib/iconLibrary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iconLibrary")>("@/lib/iconLibrary");
  return { ...actual, listIcons: vi.fn(async () => h.rows) };
});

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: () => {}, setTheme: () => {} }),
}));

/** Wiersz biblioteki ikon - pola nieistotne dla rozstrzygania są stałe. */
function iconRow(over: Partial<IconRow> & { name: string }): IconRow {
  return {
    id: `id-${over.name}-${over.kind ?? "brand"}`,
    tenant_id: "tenant-1",
    kind: "brand",
    label: null,
    url_default: "",
    url_light: "",
    url_dark: "",
    default_variant: "auto",
    position: 0,
    created_at: "2026-01-15T10:00:00.000Z",
    updated_at: "2026-01-15T10:00:00.000Z",
    ...over,
  };
}

/** Czeka, aż zapytanie o bibliotekę się rozstrzygnie, i oddaje wyrenderowany `img`. */
async function renderedImage(ui: ReactElement): Promise<HTMLImageElement> {
  const { container } = renderWithQueryClient(ui);
  await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  return container.querySelector("img") as HTMLImageElement;
}

/**
 * Czeka, aż biblioteka ikon FAKTYCZNIE się wczyta, i dopiero wtedy oddaje
 * kontener. Bez tego dowód „padł fallback" byłby pusty: fallback stoi na
 * ekranie także w trakcie ładowania, więc `waitFor` na obecność `<svg>`
 * spełniłby się natychmiast - przed odpowiedzią `listIcons` - i test przeszedłby
 * nawet wtedy, gdyby rozstrzyganie po wczytaniu wybrało `<img>`.
 */
async function renderedAfterLoad(ui: ReactElement): Promise<HTMLElement> {
  const { container, queryClient } = renderWithQueryClient(ui);
  await waitFor(() =>
    expect(queryClient.getQueryState(["icon-library", "all"])?.status).toBe("success"),
  );
  return container;
}

beforeEach(() => {
  h.rows = [];
  h.theme = "light";
});

describe("BrandIcon - rozstrzyganie nazwy", () => {
  it('alias „x" trafia w wiersz zapisany w bibliotece jako „twitter"', async () => {
    h.rows = [iconRow({ name: "twitter", label: "Twitter", url_light: "/i/twitter.svg" })];

    const img = await renderedImage(<BrandIcon name="x" fallback={Globe} className="w-4 h-4" />);

    expect(img.getAttribute("src")).toBe("/i/twitter.svg");
  });

  it("nazwa SPOZA tabeli aliasów szuka wyłącznie samej siebie", async () => {
    h.rows = [iconRow({ name: "mastodon", url_light: "/i/mastodon.svg" })];

    const img = await renderedImage(
      <BrandIcon name="Mastodon" fallback={Globe} className="w-4 h-4" />,
    );

    expect(img.getAttribute("src")).toBe("/i/mastodon.svg");
  });

  it("przy duplikacie nazwy wygrywa `kind='brand'`, a NIE `custom` ani `flag`", async () => {
    h.rows = [
      iconRow({ name: "spotify", kind: "flag", url_light: "/i/flag.svg" }),
      iconRow({ name: "spotify", kind: "brand", url_light: "/i/brand.svg" }),
      iconRow({ name: "spotify", kind: "custom", url_light: "/i/custom.svg" }),
    ];

    const img = await renderedImage(
      <BrandIcon name="spotify" fallback={Globe} className="w-4 h-4" />,
    );

    expect(img.getAttribute("src")).toBe("/i/brand.svg");
  });

  it("ikona zaimportowana hurtowo jako `custom` jest widoczna, gdy NIE MA odpowiednika `brand`", async () => {
    h.rows = [iconRow({ name: "tiktok", kind: "custom", url_light: "/i/tiktok.svg" })];

    const img = await renderedImage(
      <BrandIcon name="tiktok" fallback={Globe} className="w-4 h-4" />,
    );

    expect(img.getAttribute("src")).toBe("/i/tiktok.svg");
  });
});

describe("BrandIcon - tryb koloru", () => {
  it("w trybie jasnym renderuje wariant LIGHT", async () => {
    h.rows = [
      iconRow({ name: "facebook", url_light: "/i/fb-light.svg", url_dark: "/i/fb-dark.svg" }),
    ];

    const img = await renderedImage(
      <BrandIcon name="facebook" fallback={Globe} className="w-4 h-4" />,
    );

    expect(img.getAttribute("src")).toBe("/i/fb-light.svg");
  });

  it("w trybie ciemnym renderuje wariant DARK tej samej ikony", async () => {
    h.theme = "dark";
    h.rows = [
      iconRow({ name: "facebook", url_light: "/i/fb-light.svg", url_dark: "/i/fb-dark.svg" }),
    ];

    const img = await renderedImage(
      <BrandIcon name="facebook" fallback={Globe} className="w-4 h-4" />,
    );

    expect(img.getAttribute("src")).toBe("/i/fb-dark.svg");
  });
});

describe("BrandIcon - degradacja do fallbacku", () => {
  it("BEZ wpisu w bibliotece renderuje komponent zapasowy z przekazanym `className`", async () => {
    h.rows = [iconRow({ name: "linkedin", url_light: "/i/linkedin.svg" })];

    const container = await renderedAfterLoad(
      <BrandIcon name="instagram" fallback={Globe} className="w-4 h-4" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("w-4 h-4");
  });

  it("wiersz BEZ ŻADNEGO URL-a nie wypiera komponentu zapasowego", async () => {
    h.rows = [iconRow({ name: "instagram", label: "Instagram" })];

    const container = await renderedAfterLoad(
      <BrandIcon name="instagram" fallback={Globe} className="w-4 h-4" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("wiersz przypięty do wariantu `light`, mający URL tylko dla trybu ciemnego, NIE renderuje pustego obrazka", async () => {
    // `resolveIconUrl` przy `default_variant='light'` czyta `url_light || url_default`
    // - oba puste, więc jedyny obecny URL (dark) jest celowo pominięty i atom
    // musi wrócić do fallbacku zamiast wystawić `<img src="">`.
    h.rows = [iconRow({ name: "instagram", default_variant: "light", url_dark: "/i/ig-dark.svg" })];

    const container = await renderedAfterLoad(
      <BrandIcon name="instagram" fallback={Globe} className="w-4 h-4" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("dopóki biblioteka się ładuje, na ekranie stoi komponent zapasowy - ŻADNEGO pustego `img`", () => {
    h.rows = [iconRow({ name: "linkedin", url_light: "/i/linkedin.svg" })];

    const { container } = renderWithQueryClient(
      <BrandIcon name="linkedin" fallback={Globe} className="w-4 h-4" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("BrandIcon - etykieta dostępności", () => {
  it("`alt` z propsa wygrywa nad etykietą wiersza", async () => {
    h.rows = [iconRow({ name: "x", label: "Twitter", url_light: "/i/x.svg" })];

    const img = await renderedImage(
      <BrandIcon name="x" fallback={Globe} className="w-4 h-4" alt="X" />,
    );

    expect(img.getAttribute("alt")).toBe("X");
  });

  it("BEZ `alt` etykieta jest `label` wiersza", async () => {
    h.rows = [iconRow({ name: "x", label: "Twitter", url_light: "/i/x.svg" })];

    const img = await renderedImage(<BrandIcon name="x" fallback={Globe} className="w-4 h-4" />);

    expect(img.getAttribute("alt")).toBe("Twitter");
  });

  it("BEZ `alt` i BEZ `label` etykieta jest NAZWA przekazana w propsie, a nie nazwa wiersza", async () => {
    h.rows = [iconRow({ name: "twitter", url_light: "/i/x.svg" })];

    const img = await renderedImage(<BrandIcon name="x" fallback={Globe} className="w-4 h-4" />);

    expect(img.getAttribute("alt")).toBe("x");
  });
});

describe("BrandIcon - wgrana ikona marki ma pierwszeństwo przed glifem w kodzie", () => {
  it("wiersz `facebook` z biblioteki wypiera glif Facebooka z modułu marek", async () => {
    h.rows = [
      iconRow({ name: "facebook", url_light: "/i/fb-light.png", url_dark: "/i/fb-dark.png" }),
    ];

    const img = await renderedImage(
      <BrandIcon name="facebook" fallback={Facebook} className="w-4 h-4" alt="" />,
    );

    expect(img.getAttribute("src")).toBe("/i/fb-light.png");
    expect(img.closest("div")?.querySelector("svg")).toBeNull();
  });

  it("wgrana ikona przejmuje wymiar miejsca (`style`, `width`/`height`) zapasu", async () => {
    h.rows = [iconRow({ name: "linkedin", url_default: "/i/li.png" })];

    const img = await renderedImage(
      <BrandIcon
        name="linkedin"
        fallback={Globe}
        width={14}
        height={14}
        style={{ width: "22px", height: "22px" }}
      />,
    );

    expect(img.getAttribute("width")).toBe("14");
    expect(img.getAttribute("height")).toBe("14");
    expect(img.style.width).toBe("22px");
    expect(img.style.objectFit).toBe("contain");
  });

  it("bez wiersza w bibliotece rysuje glif marki z modułu (Lucide 1.x go nie ma)", async () => {
    const container = await renderedAfterLoad(
      <BrandIcon name="facebook" fallback={Facebook} className="w-4 h-4" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.lucide-facebook")).not.toBeNull();
  });

  it("poza `QueryClientProvider` pokazuje zapas zamiast wywracać render i nie pyta bazy", () => {
    vi.mocked(listIcons).mockClear();
    h.rows = [iconRow({ name: "facebook", url_default: "/i/fb.png" })];

    const { container } = render(<BrandIcon name="facebook" fallback={Facebook} />);

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(listIcons).not.toHaveBeenCalled();
  });
});
