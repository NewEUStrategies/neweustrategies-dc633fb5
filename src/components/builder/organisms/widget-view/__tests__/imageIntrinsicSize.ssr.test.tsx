// NATURALNY ROZMIAR PLIKU W ZNACZNIKU WIDGETU OBRAZU (realny SSR + hydratacja).
//
// SKĄD TEN PLIK. Lighthouse (`unsized-images`) zgłaszał obrazy bez ramki - logo
// w nagłówku i stopce oraz obraz z proporcją "auto" - bo `<img>` nie niósł
// `width`/`height`, a przeglądarka nie znała proporcji przed pobraniem pliku.
// Opcja "Proporcje" tego nie rozwiązuje: każda wartość inna niż "auto" włącza
// ramkę i zdejmuje `site-logo-img` oraz `--img-h` (zwijanie nagłówka).
// Renderer dokłada więc same atrybuty `width`/`height` z naturalnego rozmiaru
// pliku, dobranego po adresie, który REALNIE trafia do `src`:
//   - logo motywu: `theme_options.logo.intrinsic` (pary `[adres, "WxH"]`),
//   - własny plik widgetu: `srcIntrinsic` / `srcDarkIntrinsic` w treści.
//
// CO TU MA DOWÓD
//  1. ZŁOTE ZNACZNIKI. Cztery napisy poniżej zostały zdjęte z komponentu SPRZED
//     zmiany i uruchomione na nim na zielono. Rozmiar nieznany (brak danych,
//     dane uszkodzone, wpis innego pliku) musi dać dokładnie ten sam HTML -
//     produkcyjnych danych nie edytujemy, więc do pierwszego zapisu w panelu
//     strona ma wyglądać bajt w bajt jak dziś.
//  2. Rozmiar znany dokłada WYŁĄCZNIE dwa atrybuty po `alt`: reszta znacznika,
//     style, klasy i opakowania są identyczne ze złotym napisem. Nigdzie nie
//     pojawia się inline `aspect-ratio` (nadpisałby `aspect-square` wariantu
//     "circle" i utrwalił nieaktualną wartość).
//  3. Rozmiar idzie za ADRESEM: każda połowa pary light/dark dostaje rozmiar
//     własnego pliku, a rozmiar z treści nie jest pożyczany plikowi, który go
//     zastąpił (logo motywu podstawione za własny `src`).
//  4. Obraz w ramce (proporcja ustawiona) się nie zmienia.
//  5. Priorytet ładowania, `sizes`, `srcset` i `data-lcp-candidate` nie zależą
//     od obecności rozmiaru.
//  6. HTML serwera = strona po hydratacji (żadnego atrybutu tylko po stronie
//     klienta, żadnego błędu hydratacji).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import type { LcpImage } from "@/lib/builder/aboveFold";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Ustawienia są zasiane w cache'u - klient bazy nie ma prawa zostać wywołany.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("render obrazu nie może odpytywać bazy");
    },
  },
}));

import { ImageWidget } from "@/components/builder/organisms/widget-view/mediaWidgets";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const LIGHT = "https://neweuropeanstrategies.com/media/theme/logo/nes-light.svg";
const DARK = "https://neweuropeanstrategies.com/media/theme/logo/nes-dark.svg";
const OTHER_LOGO = "https://neweuropeanstrategies.com/media/theme/logo/nes-other.svg";
const PHOTO = "https://neweuropeanstrategies.com/media/widgets/panel-1200x675.jpg";
const PHOTO_DARK = "https://neweuropeanstrategies.com/media/widgets/panel-dark-800x600.jpg";

type ThemeLogo = Record<string, unknown>;
interface RenderOpts {
  logo?: ThemeLogo;
  theme?: "light" | "dark";
  lcp?: LcpImage;
}

/** Widget z ustawieniami zasianymi jak przez loader korzenia (wspólny cache). */
function tree(content: WidgetContent, opts: RenderOpts = {}): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    theme_options: { logo: opts.logo ?? {} },
  });
  return (
    <QueryClientProvider client={client}>
      <ImageWidget
        c={content}
        lang="pl"
        theme={opts.theme ?? "light"}
        editable={false}
        lcp={opts.lcp ?? false}
      />
    </QueryClientProvider>
  );
}

const ssr = (content: WidgetContent, opts?: RenderOpts) =>
  renderToStaticMarkup(tree(content, opts));

const imgTags = (html: string) => html.match(/<img[^>]*>/g) ?? [];

/** Wartość atrybutu znacznika; brak znacznika albo atrybutu to `undefined`. */
const attr = (tag: string | undefined, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag ?? "")?.[1];

/** Złoty znacznik z dwoma atrybutami dopisanymi po `alt` wskazanego obrazu. */
function withSize(golden: string, alt: string, sizes: ReadonlyArray<[number, number]>): string {
  let index = 0;
  return golden.replaceAll(` alt="${alt}"`, (match) => {
    const [width, height] = sizes[index] ?? sizes[sizes.length - 1];
    index += 1;
    return `${match} width="${width}" height="${height}"`;
  });
}

// ─── ZŁOTE ZNACZNIKI (zdjęte z komponentu sprzed zmiany) ────────────────────

const THEME_LOGO: ThemeLogo = { main: LIGHT, main_dark: DARK };

/** (a) para logo light/dark z ustawioną wysokością - nagłówek. */
const LOGO_PAIR: WidgetContent = { src: "", alt_pl: "Logo", heightPx: 44 };
const GOLDEN_LOGO_PAIR =
  '<figure class="w-full space-y-2 flex flex-col items-center">' +
  '<div style="width:auto;max-width:100%">' +
  `<img src="${LIGHT}" alt="Logo" loading="lazy" decoding="async" fetchPriority="auto" ` +
  'class="block rounded site-logo-img h-[var(--img-h)]  gc-img-light" ' +
  'style="object-fit:contain;width:auto;max-width:100%;height:44px;--img-h:44px"/>' +
  `<img src="${DARK}" alt="Logo" loading="lazy" decoding="async" fetchPriority="auto" ` +
  'class="block rounded site-logo-img h-[var(--img-h)]  gc-img-dark" ' +
  'style="object-fit:contain;width:auto;max-width:100%;height:44px;--img-h:44px"/>' +
  "</div></figure>";

/** (b) logo z domyślnego zasiewu chrome (sam `maxWidth`) - stopka. */
const LOGO_SEED: WidgetContent = { src: "", alt_pl: "Logo", alt_en: "Logo", maxWidth: "180px" };
const GOLDEN_LOGO_SEED =
  '<figure class="w-full space-y-2 flex flex-col items-center">' +
  '<div style="width:min(100%, 180px);max-width:100%">' +
  `<img src="${LIGHT}" alt="Logo" loading="lazy" decoding="async" fetchPriority="auto" ` +
  'class="block rounded site-logo-img  gc-img-light" ' +
  'style="object-fit:contain;width:100%;max-width:min(100%, 180px);height:auto"/>' +
  `<img src="${DARK}" alt="Logo" loading="lazy" decoding="async" fetchPriority="auto" ` +
  'class="block rounded site-logo-img  gc-img-dark" ' +
  'style="object-fit:contain;width:100%;max-width:min(100%, 180px);height:auto"/>' +
  "</div></figure>";

const PHOTO_PATH = "/media/widgets/panel-1200x675.jpg";
const PHOTO_SRCSET =
  `${PHOTO_PATH}?width=480&amp;resize=contain&amp;quality=76 480w, ` +
  `${PHOTO_PATH}?width=640&amp;resize=contain&amp;quality=76 640w, ` +
  `${PHOTO_PATH}?width=768&amp;resize=contain&amp;quality=80 768w, ` +
  `${PHOTO_PATH}?width=1280&amp;resize=contain&amp;quality=80 1280w, ` +
  `${PHOTO_PATH}?width=1920&amp;resize=contain&amp;quality=80 1920w`;

/** (c) zwykły obraz z proporcją "auto" (bez ramki). */
const AUTO_IMAGE: WidgetContent = { src: PHOTO, alt_pl: "Panel dyskusyjny", ratio: "auto" };
const GOLDEN_AUTO_IMAGE =
  '<figure class="w-full space-y-2 flex flex-col items-center">' +
  '<div style="width:100%;max-width:100%">' +
  '<span class="oi-wrap oi-hover-zoom block overflow-hidden">' +
  `<img src="${PHOTO_PATH}" srcSet="${PHOTO_SRCSET}" sizes="100vw" alt="Panel dyskusyjny" ` +
  'loading="lazy" decoding="async" fetchPriority="auto" ' +
  'class="block rounded oi-img oi-fade-in" ' +
  'style="object-fit:cover;width:100%;max-width:100%;height:auto"/>' +
  "</span></div></figure>";

/** (d) obraz w ramce 16/9. */
const FRAMED_IMAGE: WidgetContent = { src: PHOTO, alt_pl: "Panel dyskusyjny", ratio: "16/9" };
const GOLDEN_FRAMED_IMAGE =
  '<figure class="w-full space-y-2 flex flex-col items-center">' +
  '<div style="width:100%;max-width:100%">' +
  '<span data-widget-media="true" class="relative block w-full overflow-hidden rounded bg-muted" ' +
  'style="width:100%;max-width:100%;aspect-ratio:16 / 9;--widget-media-fit:cover">' +
  '<span class="oi-wrap oi-hover-zoom block overflow-hidden">' +
  `<img src="${PHOTO_PATH}" srcSet="${PHOTO_SRCSET}" sizes="auto, 100vw" alt="Panel dyskusyjny" ` +
  'loading="lazy" decoding="async" fetchPriority="auto" ' +
  'class="absolute inset-0 block h-full w-full rounded widget-media-fg oi-img oi-fade-in" ' +
  'style="object-fit:cover;width:100%;height:100%"/>' +
  "</span></span></div></figure>";

describe("ZŁOTE ZNACZNIKI: rozmiar nieznany = HTML sprzed zmiany, bajt w bajt", () => {
  it("(a) para logo z wysokością", () => {
    expect(ssr(LOGO_PAIR, { logo: THEME_LOGO })).toBe(GOLDEN_LOGO_PAIR);
  });

  it("(b) logo z domyślnego zasiewu (sam maxWidth)", () => {
    expect(ssr(LOGO_SEED, { logo: THEME_LOGO })).toBe(GOLDEN_LOGO_SEED);
  });

  it('(c) obraz z proporcją "auto"', () => {
    expect(ssr(AUTO_IMAGE)).toBe(GOLDEN_AUTO_IMAGE);
  });

  it("(d) obraz w ramce 16/9", () => {
    expect(ssr(FRAMED_IMAGE)).toBe(GOLDEN_FRAMED_IMAGE);
  });

  it.each([
    ["pusta lista", []],
    ["wpis innego pliku", [[OTHER_LOGO, "350x150"]]],
    ["lista jako napis", "350x150"],
    ["lista jako mapa", { [LIGHT]: "350x150", [DARK]: "350x150" }],
    ["para z błędnym rozmiarem", [[LIGHT, "0x0"], [DARK, "350"], null, 7]],
  ])("logo: `intrinsic` bez wpisu renderowanego pliku (%s) -> złoty znacznik", (_label, bad) => {
    const logo = { ...THEME_LOGO, intrinsic: bad };
    expect(ssr(LOGO_PAIR, { logo })).toBe(GOLDEN_LOGO_PAIR);
    expect(ssr(LOGO_SEED, { logo })).toBe(GOLDEN_LOGO_SEED);
  });

  it.each([
    ["zera", "0x0"],
    ["sama szerokość", "1200"],
    ["liczba", 1200],
    ["ułamek", "1200x675.5"],
    ["pusty napis", ""],
  ])("obraz: błędny `srcIntrinsic` (%s) -> złoty znacznik", (_label, bad) => {
    expect(ssr({ ...AUTO_IMAGE, srcIntrinsic: bad })).toBe(GOLDEN_AUTO_IMAGE);
  });
});

// ─── ROZMIAR ZNANY ──────────────────────────────────────────────────────────

describe("logo motywu: rozmiar z `theme_options.logo.intrinsic`, po adresie", () => {
  it("(1) tryb logo witryny: każda połowa pary niesie rozmiar WŁASNEGO pliku, reszta bez zmian", () => {
    const logo = {
      ...THEME_LOGO,
      intrinsic: [
        [LIGHT, "350x150"],
        [DARK, "700x300"],
      ],
    };
    const sizes: Array<[number, number]> = [
      [350, 150],
      [700, 300],
    ];

    expect(ssr(LOGO_PAIR, { logo })).toBe(withSize(GOLDEN_LOGO_PAIR, "Logo", sizes));
    expect(ssr(LOGO_SEED, { logo })).toBe(withSize(GOLDEN_LOGO_SEED, "Logo", sizes));
    // Zapis dosłowny, niezależny od pomocnika: atrybuty stoją zaraz po `alt`,
    // a styl nie zawiera `aspect-ratio`.
    expect(imgTags(ssr(LOGO_PAIR, { logo }))[0]).toBe(
      `<img src="${LIGHT}" alt="Logo" width="350" height="150" loading="lazy" decoding="async" ` +
        'fetchPriority="auto" class="block rounded site-logo-img h-[var(--img-h)]  gc-img-light" ' +
        'style="object-fit:contain;width:auto;max-width:100%;height:44px;--img-h:44px"/>',
    );
  });

  it("jeden wpis na dwa motywy: połowa bez wpisu zostaje bez atrybutów", () => {
    const logo = { ...THEME_LOGO, intrinsic: [[LIGHT, "350x150"]] };
    const [light, dark] = imgTags(ssr(LOGO_PAIR, { logo }));

    expect(attr(light, "width")).toBe("350");
    expect(attr(light, "height")).toBe("150");
    expect(attr(dark, "width")).toBeUndefined();
    expect(attr(dark, "height")).toBeUndefined();
  });

  it("wariant `useSiteLogo: mobile` z łańcuchem awaryjnym: rozmiar idzie za wybranym plikiem", () => {
    // Jasna połowa to plik wariantu `mobile`; ciemnej wariant nie ma, więc
    // łańcuch schodzi do logo głównego - i to JEGO rozmiar trafia do znacznika.
    const logo = {
      main: LIGHT,
      mobile: OTHER_LOGO,
      intrinsic: [
        [LIGHT, "350x150"],
        [OTHER_LOGO, "512x128"],
      ],
    };
    const [light, dark, ...rest] = imgTags(
      ssr({ src: "", useSiteLogo: "mobile", heightPx: 32 }, { logo }),
    );

    expect(rest).toEqual([]);
    expect(attr(light, "src")).toBe(OTHER_LOGO);
    expect([attr(light, "width"), attr(light, "height")]).toEqual(["512", "128"]);
    expect(attr(dark, "src")).toBe(LIGHT);
    expect([attr(dark, "width"), attr(dark, "height")]).toEqual(["350", "150"]);
  });

  it("(2) własny `src` równy adresowi logo motywu: rozmiar z wpisu motywu", () => {
    const logo = { main: LIGHT, intrinsic: [[LIGHT, "350x150"]] };
    const [img] = imgTags(ssr({ src: LIGHT, alt_pl: "Znak serwisu", heightPx: 40 }, { logo }));

    expect(img).toContain("site-logo-img");
    expect(attr(img, "width")).toBe("350");
    expect(attr(img, "height")).toBe("150");
  });

  it("logo w ramce (proporcja ustawiona): bez atrybutów mimo wpisu motywu", () => {
    const logo = { main: LIGHT, intrinsic: [[LIGHT, "350x150"]] };
    const tags = imgTags(ssr({ src: LIGHT, alt_pl: "Znak serwisu", ratio: "16/9" }, { logo }));

    expect(tags).toHaveLength(1);
    expect(attr(tags[0], "class")).toContain("widget-media-fg");
    expect(attr(tags[0], "width")).toBeUndefined();
    expect(attr(tags[0], "height")).toBeUndefined();
  });

  it("(3) wpis motywu dla INNEGO adresu: bez atrybutów", () => {
    const logo = { ...THEME_LOGO, intrinsic: [[OTHER_LOGO, "350x150"]] };

    for (const img of imgTags(ssr(LOGO_PAIR, { logo }))) {
      expect(attr(img, "width")).toBeUndefined();
      expect(attr(img, "height")).toBeUndefined();
    }
  });

  it("(7) logo motywu podstawione za własny `src`: rozmiar z treści NIE przechodzi na inny plik", () => {
    // Treść ma własny plik z pomiarem, ale alt "Logo" podstawia logo motywu,
    // które wpisu nie ma. Rozmiar 1200x675 opisuje inny plik niż renderowany.
    const content = { src: PHOTO, srcIntrinsic: "1200x675", alt_pl: "Logo", heightPx: 44 };
    const html = ssr(content, { logo: THEME_LOGO });

    expect(html).toBe(GOLDEN_LOGO_PAIR);
  });
});

describe("własny plik widgetu: rozmiar z `srcIntrinsic` / `srcDarkIntrinsic`", () => {
  it('(4) obraz "auto": same atrybuty, bez `aspect-ratio`, opakowanie bez stylu', () => {
    const html = ssr({ ...AUTO_IMAGE, srcIntrinsic: "1200x675" });

    expect(html).toBe(withSize(GOLDEN_AUTO_IMAGE, "Panel dyskusyjny", [[1200, 675]]));
    expect(html).toContain(' alt="Panel dyskusyjny" width="1200" height="675" loading="lazy"');
    expect(html).not.toContain("aspect-ratio");
    expect(html).toContain('<span class="oi-wrap oi-hover-zoom block overflow-hidden"><img');
  });

  it("(5) obraz w ramce z `srcIntrinsic`: HTML identyczny ze złotym", () => {
    const html = ssr({ ...FRAMED_IMAGE, srcIntrinsic: "1200x675", srcDarkIntrinsic: "800x600" });

    expect(html).toBe(GOLDEN_FRAMED_IMAGE);
  });

  it("para w ramce: żadna połowa nie dostaje atrybutów", () => {
    const html = ssr({
      ...FRAMED_IMAGE,
      srcDark: PHOTO_DARK,
      srcIntrinsic: "1200x675",
      srcDarkIntrinsic: "800x600",
    });

    expect(imgTags(html)).toHaveLength(2);
    for (const img of imgTags(html)) {
      expect(attr(img, "width")).toBeUndefined();
      expect(attr(img, "height")).toBeUndefined();
    }
  });

  it('(6) wariant "circle": atrybuty są, klasa `aspect-square` zostaje, bez inline proporcji', () => {
    const html = ssr({ ...AUTO_IMAGE, variant: "circle", srcIntrinsic: "1200x675" });
    const [img] = imgTags(html);

    expect(attr(img, "width")).toBe("1200");
    expect(attr(img, "height")).toBe("675");
    expect(attr(img, "class")).toContain("rounded-full aspect-square");
    expect(html).not.toContain("aspect-ratio");
  });

  it('(8) motyw "dark" z samym `src`: ten sam plik, więc `srcIntrinsic`', () => {
    const [img, ...rest] = imgTags(
      ssr(
        { ...AUTO_IMAGE, srcIntrinsic: "1200x675", srcDarkIntrinsic: "800x600" },
        { theme: "dark" },
      ),
    );

    expect(rest).toEqual([]);
    expect(attr(img, "src")).toBe(PHOTO_PATH);
    expect(attr(img, "width")).toBe("1200");
    expect(attr(img, "height")).toBe("675");
  });

  it("(8) para z osobnym `srcDark`: połowa ciemna bierze `srcDarkIntrinsic`", () => {
    const [light, dark] = imgTags(
      ssr({
        ...AUTO_IMAGE,
        srcDark: PHOTO_DARK,
        srcIntrinsic: "1200x675",
        srcDarkIntrinsic: "800x600",
      }),
    );

    expect(attr(light, "class")).toContain("gc-img-light");
    expect([attr(light, "width"), attr(light, "height")]).toEqual(["1200", "675"]);
    expect(attr(dark, "class")).toContain("gc-img-dark");
    expect([attr(dark, "width"), attr(dark, "height")]).toEqual(["800", "600"]);
  });

  it("sam `srcDark` z pomiarem: jedyny obraz bierze `srcDarkIntrinsic` w obu motywach", () => {
    const content = { srcDark: PHOTO_DARK, srcDarkIntrinsic: "800x600", srcIntrinsic: "1200x675" };
    for (const theme of ["light", "dark"] as const) {
      const [img, ...rest] = imgTags(ssr(content, { theme }));
      expect(rest).toEqual([]);
      expect([attr(img, "width"), attr(img, "height")]).toEqual(["800", "600"]);
    }
  });

  it("para bez `srcDarkIntrinsic`: tylko połowa jasna niesie atrybuty", () => {
    const [light, dark] = imgTags(
      ssr({ ...AUTO_IMAGE, srcDark: PHOTO_DARK, srcIntrinsic: "1200x675" }),
    );

    expect(attr(light, "width")).toBe("1200");
    expect(attr(dark, "width")).toBeUndefined();
    expect(attr(dark, "height")).toBeUndefined();
  });
});

describe("(10) ładowanie i kandydat LCP nie zależą od rozmiaru", () => {
  const LOADING_ATTRS = ["loading", "fetchPriority", "sizes", "srcSet", "data-lcp-candidate"];
  const loadingOf = (html: string) =>
    imgTags(html).map((tag) => LOADING_ATTRS.map((name) => attr(tag, name)));

  it.each([false, true, "eager"] as const)('obraz "auto", lcp=%s', (lcp) => {
    const bare = ssr(AUTO_IMAGE, { lcp });
    const sized = ssr({ ...AUTO_IMAGE, srcIntrinsic: "1200x675" }, { lcp });

    expect(loadingOf(sized)).toEqual(loadingOf(bare));
    expect(attr(imgTags(sized)[0], "loading")).toBe(lcp === false ? "lazy" : "eager");
    expect(sized.includes("data-lcp-candidate")).toBe(lcp === true);
    expect(attr(imgTags(sized)[0], "width")).toBe("1200");
  });

  it.each([false, true] as const)("para logo, lcp=%s: obie połowy leniwe jak dotąd", (lcp) => {
    const logo = {
      ...THEME_LOGO,
      intrinsic: [
        [LIGHT, "350x150"],
        [DARK, "350x150"],
      ],
    };
    const bare = ssr(LOGO_PAIR, { logo: THEME_LOGO, lcp });
    const sized = ssr(LOGO_PAIR, { logo, lcp });

    expect(loadingOf(sized)).toEqual(loadingOf(bare));
    expect(loadingOf(sized).map(([loading]) => loading)).toEqual(["lazy", "lazy"]);
    expect(sized).not.toContain("data-lcp-candidate");
  });
});

// ─── HYDRATACJA ─────────────────────────────────────────────────────────────

describe("HTML serwera = strona po hydratacji", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    vi.restoreAllMocks();
  });

  /**
   * Serwer i klient dostają OSOBNE cache z tymi samymi danymi - jak dokument
   * z odwodnionym stanem. Zwraca błędy hydratacji i znaczniki obrazów po niej.
   */
  async function hydrate(content: WidgetContent, opts: RenderOpts) {
    const html = renderToString(tree(content, opts));
    host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const before = [...host.querySelectorAll("img")];
    const snapshot = before.map((img) => img.outerHTML);
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    const root = hydrateRoot(host, tree(content, opts), {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(async () => {});
      const after = [...host.querySelectorAll("img")];
      return {
        errors,
        html,
        sameNodes: after.length === before.length && after.every((img, i) => img === before[i]),
        unchanged: after.map((img) => img.outerHTML).every((tag, i) => tag === snapshot[i]),
        sizes: after.map((img) => [img.getAttribute("width"), img.getAttribute("height")]),
      };
    } finally {
      await act(async () => root.unmount());
    }
  }

  it("para logo: atrybuty z serwera zostają, bez błędu hydratacji", async () => {
    const logo = {
      ...THEME_LOGO,
      intrinsic: [
        [LIGHT, "350x150"],
        [DARK, "700x300"],
      ],
    };
    const result = await hydrate(LOGO_PAIR, { logo });

    expect(result.errors).toEqual([]);
    expect(result.sameNodes).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.sizes).toEqual([
      ["350", "150"],
      ["700", "300"],
    ]);
    expect(result.html).toContain('width="350" height="150"');
  });

  it('obraz "auto": atrybuty z serwera zostają, bez błędu hydratacji', async () => {
    const result = await hydrate({ ...AUTO_IMAGE, srcIntrinsic: "1200x675" }, {});

    expect(result.errors).toEqual([]);
    expect(result.sameNodes).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.sizes).toEqual([["1200", "675"]]);
  });

  it("rozmiar nieznany: po hydratacji dalej żadnego `width`/`height`", async () => {
    const pair = await hydrate(LOGO_PAIR, { logo: THEME_LOGO });
    expect(pair.errors).toEqual([]);
    expect(pair.sizes).toEqual([
      [null, null],
      [null, null],
    ]);

    const auto = await hydrate(AUTO_IMAGE, {});
    expect(auto.errors).toEqual([]);
    expect(auto.sizes).toEqual([[null, null]]);
  });
});
