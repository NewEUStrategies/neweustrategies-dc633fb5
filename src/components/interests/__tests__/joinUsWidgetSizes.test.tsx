// Regresja "Dołącz do nas": rozmiary z tooltipa / panelu buildera muszą
// realnie docierać do DOM-u widgetu - i wygrywać z kaskadą platformy.
//
// Historia błędu: `content.titleSize` (i reszta) trafiały do JoinUsForm i
// generowały scoped CSS o specyficzności (0,2,0), ale panel "Typografia" tego
// samego widgetu emituje `[data-w-id]×3 p:not(…)×4 {font-size:… !important}`
// → (0,7,1). Efekt: zmiana rozmiaru nie robiła nic ani w podglądzie, ani na
// stronie publicznej. Ikony w ogóle nie reagowały (twarde `w-4 h-4`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { makeWidget } from "@/lib/builder/registry";
import type { WidgetNode } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of ["select", "eq", "in", "order", "limit", "is", "not"]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

/** WidgetView ładuje JoinUsForm leniwie (lazyWidgets) - czekamy na realny DOM
 *  widgetu, inaczej mierzylibyśmy tylko fallback <Suspense>. */
async function renderJoinUs(content: Record<string, unknown>, style?: WidgetNode["style"]) {
  const node = makeWidget("join-us");
  node.content = { ...node.content, ...content } as WidgetNode["content"];
  if (style) node.style = style;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(utils.container.querySelector("[data-jus-id]")).not.toBeNull());
  return utils;
}

/** Cały CSS wstrzyknięty przez widget (scoped <style> JoinUsForm + WidgetView). */
function widgetCss(container: HTMLElement): string {
  return Array.from(container.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

/** Najniższa liczba atrybutów/klas (człon "b" specyficzności) wśród selektorów
 *  reguły, której treść zawiera podaną deklarację. Bierzemy MINIMUM, bo o
 *  wyniku kaskady decyduje najsłabszy selektor, który trafia w dany element. */
function ruleWeight(css: string, declaration: string): number {
  for (const raw of css.split("}")) {
    const [selector, body] = raw.split("{");
    if (!body || !body.includes(declaration)) continue;
    const weights = selector
      .replace(/^@media[^{]*/, "")
      .split(",")
      .map((sel) => {
        const attrs = sel.match(/\[[^\]]+\]/g)?.length ?? 0;
        const classes = sel.match(/\.[a-zA-Z_-][\w-]*/g)?.length ?? 0;
        return attrs + classes;
      });
    return Math.min(...weights);
  }
  return -1;
}

describe("widget join-us - rozmiary czcionek i ikon", () => {
  it("emituje regułę dla każdego rozmiaru ustawionego w panelu/tooltipie", async () => {
    const { container } = await renderJoinUs({
      titleSize: 30,
      descriptionSize: 19,
      perkSize: 18,
      labelSize: 15,
      placeholderSize: 17,
      buttonSize: 16,
      consentSize: 13,
    });
    const css = widgetCss(container);
    expect(css).toContain('[data-edit-target="titleSize"]{font-size:30px !important;}');
    expect(css).toContain('[data-edit-target="descriptionSize"]{font-size:19px !important;}');
    expect(css).toContain('[data-edit-target="perkSize"]{font-size:18px !important;}');
    expect(css).toContain('[data-edit-target="labelSize"]{font-size:15px !important;}');
    expect(css).toContain('[data-edit-target="placeholderSize"]{font-size:17px !important;}');
    expect(css).toContain('[data-edit-target="buttonSize"]{font-size:16px !important;}');
    expect(css).toContain('[data-edit-target="consentSize"]{font-size:13px !important;}');
    expect(css).toContain(".user-label{font-size:15px !important;}");
  });

  it("nie emituje niczego, dopóki operator nie ustawi rozmiaru", async () => {
    const { container } = await renderJoinUs({});
    expect(widgetCss(container)).not.toContain("data-edit-target");
  });

  it("bije typografię widgetu, która wcześniej zjadała per-elementowe rozmiary", async () => {
    const typographyStyle = {
      typography: { light: { fontSize: { desktop: "11px" } } },
    } as WidgetNode["style"];
    const { container } = await renderJoinUs({ perkSize: 22 }, typographyStyle);
    const css = widgetCss(container);
    // Obie warstwy są obecne...
    expect(css).toContain("font-size:11px !important");
    expect(css).toContain('[data-edit-target="perkSize"]{font-size:22px !important;}');
    // ...ale per-elementowa wygrywa specyficznością.
    const perk = ruleWeight(css, "font-size:22px");
    const typography = ruleWeight(css, "font-size:11px");
    expect(typography).toBeGreaterThan(0);
    expect(perk).toBeGreaterThan(typography);
  });

  it("skaluje ikony razem z tekstem i przypina je, gdy ustawiono iconSize", async () => {
    const { container } = await renderJoinUs({ perkSize: 24 });
    const icons = container.querySelectorAll("[data-jus-icon]");
    expect(icons.length).toBeGreaterThan(0);
    // Bok w `em` => ikona rośnie razem z perkSize/buttonSize.
    icons.forEach((icon) => {
      expect((icon as SVGElement).style.width.endsWith("em")).toBe(true);
      expect((icon as SVGElement).style.height.endsWith("em")).toBe(true);
    });
    // KONTRAKT: każda ikona sterowana polem "Ikony" jest też klikalnym celem
    // tego pola. Bez tego operator klika ikonę, otwiera mu się edytor rodzica
    // (rozmiar przycisku / pola) i zmiana "nie działa".
    const targets = container.querySelectorAll('[data-edit-target="iconSize"]');
    expect(targets.length).toBe(icons.length);
    icons.forEach((icon) => expect(icon.getAttribute("data-edit-target")).toBe("iconSize"));

    cleanup();
    const pinned = await renderJoinUs({ iconSize: 28 });
    expect(widgetCss(pinned.container)).toContain(
      "[data-jus-icon]{width:28px !important;height:28px !important;",
    );
  });
});
