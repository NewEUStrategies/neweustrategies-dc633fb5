// `StyleSink` - LIŚĆ `<style>` ARKUSZY KORZENIA (P1.2, fala 1 PSI 85/95).
//
// Co przypinamy:
//   1. re-render rodzica z IDENTYCZNYM CSS-em = 0 mutacji `childList` /
//      `characterData` w `<style>` i 0 zapisów `innerHTML` (React 19 porównuje
//      `{__html}` po tożsamości obiektu, więc bez liścia każdy re-render
//      przepisywał arkusz - dla `style[data-brand-tokens]` 26,6 KB `:root`);
//   2. zmiana CSS = DOKŁADNIE jedno `innerHTML =` i jedna podmiana treści;
//   3. HTML serwera bajt w bajt jak dawny literał `<style … dangerouslySetInnerHTML>`
//      (ta sama kolejność atrybutów, `data-css-hash` zachowany) i hydratacja
//      bez dotykania treści bloku;
//   4. `hardenStyleCss` działa w miejscu renderu (bramka `check:dangerous-html`);
//   5. KAŻDY z pięciu arkuszy korzenia przechodzi przez liść: komponent
//      renderuje się ponownie (dowód z `Profiler`), a blok zostaje nietknięty -
//      w tym wyzwalacz z werdyktu H2 (`site_font_scale`: `undefined` -> `{}`
//      przy tym samym skrócie danych).
//
// KONTROLA NEGATYWNA: ten sam przyrząd na zwykłym `<style dangerouslySetInnerHTML>`
// MUSI zobaczyć przepisanie przy re-renderze - inaczej zero mutacji niczego by
// nie dowodziło (happy-dom mógłby po prostu nie raportować zapisów).
import { afterEach, describe, expect, it, vi } from "vitest";
import { Profiler, useState, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hardenStyleCss } from "@/lib/sanitizePure";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pl" } }),
}));

import { StyleSink } from "../StyleSink";
import { DesignTokensStyle } from "@/components/DesignTokensStyle";
import { ThemeOptionsStyle } from "@/components/ThemeOptionsStyle";
import { ContentAreaStyle } from "@/components/ContentAreaStyle";
import { ThemeDesignStyle } from "../ThemeDesignStyle";
import { ThemeFontSizesStyle } from "../ThemeFontSizesStyle";

const CSS_A = ":root{--brand-primary:#123456;--gc-header-icon:#abcdef}";
const CSS_B = ":root{--brand-primary:#654321;--gc-header-icon:#abcdef}";

/** Przyrząd: mutacje TREŚCI bloku + licznik zapisów `innerHTML` na instancji. */
function instrument(style: HTMLStyleElement) {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(style, { childList: true, characterData: true, subtree: true });

  let proto: object | null = Object.getPrototypeOf(style);
  let descriptor: PropertyDescriptor | undefined;
  while (proto && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(proto, "innerHTML");
    proto = Object.getPrototypeOf(proto);
  }
  const native = descriptor;
  if (!native?.get || !native.set) throw new Error("brak akcesora innerHTML w łańcuchu prototypów");
  let writes = 0;
  Object.defineProperty(style, "innerHTML", {
    configurable: true,
    get() {
      return native.get?.call(this);
    },
    set(value: string) {
      writes += 1;
      native.set?.call(this, value);
    },
  });

  return {
    /** Rekordy `childList`/`characterData` (łącznie z oczekującymi). */
    contentMutations: () => {
      records.push(...observer.takeRecords());
      return records.filter((r) => r.type === "childList" || r.type === "characterData");
    },
    writes: () => writes,
    stop: () => observer.disconnect(),
  };
}

/** Rodzic z licznikiem: `bump()` wymusza re-render poddrzewa z tymi samymi propsami. */
function Harness({ children }: { children: (tick: number) => ReactNode }) {
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" data-testid="bump" onClick={() => setTick((n) => n + 1)} />
      {children(tick)}
    </>
  );
}

const bump = (times = 1) => {
  for (let i = 0; i < times; i += 1) {
    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid=bump]")?.click();
    });
  }
};

const styleOf = (selector: string): HTMLStyleElement => {
  const el = document.querySelector<HTMLStyleElement>(selector);
  if (!el) throw new Error(`brak ${selector}`);
  return el;
};

/** Dawny kształt sinka - wyłącznie jako kontrola negatywna i wzorzec HTML-a. */
function LegacyStyle({ css, hash }: { css: string; hash?: string }) {
  return (
    <style
      data-brand-tokens
      data-css-hash={hash}
      dangerouslySetInnerHTML={{ __html: hardenStyleCss(css) }}
    />
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("StyleSink - re-render bez przepisania arkusza", () => {
  it("re-render rodzica z identycznym CSS: 0 mutacji treści i 0 zapisów innerHTML", () => {
    render(
      <Harness>{() => <StyleSink data-brand-tokens data-css-hash="h1" css={CSS_A} />}</Harness>,
    );
    const style = styleOf("style[data-brand-tokens]");
    const textNode = style.firstChild;
    const probe = instrument(style);

    bump(3);

    expect(probe.contentMutations()).toEqual([]);
    expect(probe.writes()).toBe(0);
    // Ten sam węzeł tekstowy - przeglądarka nie ma czego parsować od nowa.
    expect(style.firstChild).toBe(textNode);
    expect(style.textContent).toBe(CSS_A);
    probe.stop();
  });

  it("KONTROLA NEGATYWNA: zwykły literał {__html} przepisuje blok przy każdym re-renderze", () => {
    render(<Harness>{() => <LegacyStyle css={CSS_A} hash="h1" />}</Harness>);
    const probe = instrument(styleOf("style[data-brand-tokens]"));

    bump(3);

    // Bez liścia React 19 widzi nowy obiekt i robi `innerHTML =` za każdym razem.
    expect(probe.writes()).toBe(3);
    expect(probe.contentMutations().length).toBeGreaterThan(0);
    probe.stop();
  });

  it("zmiana CSS: dokładnie jedno innerHTML i jedna podmiana treści", () => {
    render(
      <Harness>
        {(tick) => (
          <StyleSink
            data-brand-tokens
            data-css-hash={tick ? "h2" : "h1"}
            css={tick ? CSS_B : CSS_A}
          />
        )}
      </Harness>,
    );
    const style = styleOf("style[data-brand-tokens]");
    const probe = instrument(style);

    bump(); // A -> B
    expect(probe.writes()).toBe(1);
    const added = probe.contentMutations().filter((r) => r.addedNodes.length > 0);
    expect(added).toHaveLength(1);
    expect(style.textContent).toBe(CSS_B);
    expect(style.getAttribute("data-css-hash")).toBe("h2");

    bump(2); // dalej B - nic więcej
    expect(probe.writes()).toBe(1);
    probe.stop();
  });

  it("atrybut bez skrótu (undefined) nie trafia do DOM-u i nie psuje porównania", () => {
    render(
      <Harness>
        {() => <StyleSink data-brand-tokens data-css-hash={undefined} css={CSS_A} />}
      </Harness>,
    );
    const style = styleOf("style[data-brand-tokens]");
    expect(style.hasAttribute("data-css-hash")).toBe(false);
    const probe = instrument(style);
    bump(2);
    expect(probe.writes()).toBe(0);
    probe.stop();
  });

  it("utwardza CSS w miejscu renderu: wartość nie domyka bloku ani nie otwiera komentarza", () => {
    render(
      <StyleSink data-brand-tokens css={"a{color:red</style><script>x</script>}b{c:d<!--}"} />,
    );
    const css = styleOf("style[data-brand-tokens]").textContent ?? "";
    expect(css).not.toContain("</style");
    expect(css).not.toContain("<!--");
    expect(css).toContain("red/style>");
  });
});

describe("StyleSink - parytet SSR i hydratacja", () => {
  it("HTML serwera jest bajt w bajt taki jak dawny literał <style dangerouslySetInnerHTML>", () => {
    const sink = renderToString(
      <StyleSink data-brand-tokens data-css-hash="sarry70nrrqq4" css={CSS_A} />,
    );
    const legacy = renderToString(<LegacyStyle css={CSS_A} hash="sarry70nrrqq4" />);
    expect(sink).toBe(legacy);
    expect(sink).toBe(
      `<style data-brand-tokens="true" data-css-hash="sarry70nrrqq4">${CSS_A}</style>`,
    );
  });

  it("kolejność atrybutów idzie za wołającym (ThemeDesignStyle: lang, mode, skrót)", () => {
    const html = renderToString(
      <StyleSink
        data-theme-design
        data-lang="pl"
        data-mode="shared"
        data-css-hash="x1"
        css="a{}"
      />,
    );
    expect(html).toBe(
      '<style data-theme-design="true" data-lang="pl" data-mode="shared" data-css-hash="x1">a{}</style>',
    );
  });

  it("hydratacja i późniejszy re-render nie dotykają treści bloku z SSR", () => {
    const ui = (
      <Harness>{() => <StyleSink data-brand-tokens data-css-hash="h1" css={CSS_A} />}</Harness>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.appendChild(container);
    const style = styleOf("style[data-brand-tokens]");
    const textNode = style.firstChild;
    const probe = instrument(style);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(ui, { container, hydrate: true });
    bump(2);

    expect(errors).not.toHaveBeenCalled();
    expect(probe.contentMutations()).toEqual([]);
    expect(probe.writes()).toBe(0);
    expect(style.firstChild).toBe(textNode);
    expect(style.getAttribute("data-css-hash")).toBe("h1");
    probe.stop();
  });
});

// --- Pięć arkuszy korzenia ---------------------------------------------------

const SETTINGS_KEY = ["site_settings_public", "all"] as const;

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(SETTINGS_KEY, {
    theme_options: { toggles: { width: 56 } },
    theme_design: { blockHeading: { fontSize: "11px" } },
    font_sizes: { body: { size: 19, lineHeight: 1.7 } },
  });
  qc.setQueryData(["site_design_tokens"], {
    colors: [{ name: "primary", value: "#123456" }],
    fonts: {},
    scale: {},
  });
  qc.setQueryData(["site_global_colors"], {});
  qc.setQueryData(["post-layout-settings"], null);
  // Jak na produkcji przed powrotem zapytania: `site_font_scale` NIE jest
  // rozgrzane, więc komponent startuje na `EMPTY_FONT_SCALE`.
  qc.setQueryDefaults(["site_font_scale"], { enabled: false });
  return qc;
}

const ROOT_SHEETS = [
  { name: "DesignTokensStyle", marker: "data-brand-tokens", Component: DesignTokensStyle },
  { name: "ThemeOptionsStyle", marker: "data-theme-options", Component: ThemeOptionsStyle },
  { name: "ThemeDesignStyle", marker: "data-theme-design", Component: ThemeDesignStyle },
  { name: "ThemeFontSizesStyle", marker: "data-theme-font-sizes", Component: ThemeFontSizesStyle },
  { name: "ContentAreaStyle", marker: "data-content-area", Component: ContentAreaStyle },
];

describe.each(ROOT_SHEETS)("$name - arkusz korzenia przez StyleSink", ({ marker, Component }) => {
  it("re-render korzenia (komponent renderuje się ponownie) nie przepisuje bloku", async () => {
    const qc = makeClient();
    let renders = 0;
    render(
      <QueryClientProvider client={qc}>
        <Harness>
          {() => (
            <Profiler id="sheet" onRender={() => (renders += 1)}>
              <Component />
            </Profiler>
          )}
        </Harness>
      </QueryClientProvider>,
    );
    await act(async () => {});
    const style = styleOf(`style[${marker}]`);
    expect(style.textContent?.length ?? 0).toBeGreaterThan(0);
    const probe = instrument(style);
    const before = renders;

    bump(3);

    // Dowód, że re-render NAPRAWDĘ dotarł do komponentu arkusza...
    expect(renders - before).toBeGreaterThanOrEqual(3);
    // ...a mimo to blok `<style>` nie został ruszony.
    expect(probe.contentMutations()).toEqual([]);
    expect(probe.writes()).toBe(0);
    probe.stop();
  });
});

describe("DesignTokensStyle - wyzwalacz z werdyktu H2", () => {
  it("site_font_scale: undefined -> {} (ten sam skrót) nie przepisuje 26,6 KB :root", async () => {
    const qc = makeClient();
    let renders = 0;
    render(
      <QueryClientProvider client={qc}>
        <Profiler id="tokens" onRender={() => (renders += 1)}>
          <DesignTokensStyle />
        </Profiler>
      </QueryClientProvider>,
    );
    await act(async () => {});
    const style = styleOf("style[data-brand-tokens]");
    const hash = style.getAttribute("data-css-hash");
    const probe = instrument(style);
    const before = renders;

    // Dokładnie to, co robi pierwsze pobranie po hydratacji: dane z `undefined`
    // na nowy pusty obiekt - skrót wejścia (JSON) bez zmian.
    act(() => {
      qc.setQueryData(["site_font_scale"], {});
    });
    // react-query powiadamia obserwatorów w osobnym makrozadaniu.
    await waitFor(() => expect(renders).toBeGreaterThan(before));
    expect(qc.getQueryData(["site_font_scale"])).toEqual({});
    expect(style.getAttribute("data-css-hash")).toBe(hash);
    expect(probe.contentMutations()).toEqual([]);
    expect(probe.writes()).toBe(0);
    probe.stop();
  });
});
