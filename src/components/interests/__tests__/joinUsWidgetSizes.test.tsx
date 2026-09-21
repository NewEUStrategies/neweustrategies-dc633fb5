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
      // Builder :is() groups contain HTML tags only (equal specificity).
      // Their commas are not separators between independent selectors.
      .split(/,(?![^()]*\))/)
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

// ── WARTOŚCI DOMYŚLNE WIDGETU "DOŁĄCZ DO NAS" ────────────────────────────────
// `makeWidget("join-us")` z rejestru dokłada komplet pól domyślnych, więc testy
// wyżej nigdy nie renderują widgetu, któremu klucza BRAKUJE. A dokładnie tak
// wyglądają dokumenty sprzed wprowadzenia danego pola i dokumenty budowane
// programowo (import, migracja, duplikat sekcji). Ten blok montuje węzeł BEZ
// domyślnych rejestru.
async function renderJoinUsRaw(content: Record<string, unknown>) {
  const node: WidgetNode = {
    id: "join-us-raw",
    kind: "widget",
    type: "join-us",
    content: content as WidgetNode["content"],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(utils.container.querySelector("[data-jus-id]")).not.toBeNull());
  return utils;
}

describe("widget join-us - węzeł bez domyślnych rejestru", () => {
  it("wariant SPOZA katalogu spada na układ dzielony zamiast pustego renderu", async () => {
    const { container } = await renderJoinUsRaw({
      variant: "kosmiczny",
      imageUrl: "https://cdn.example/tlo.webp",
      imageFit: "contain",
      imageOverlay: 40,
    });
    expect(container.querySelector("[data-jus-id]")).not.toBeNull();
    expect(container.textContent ?? "").not.toContain("undefined");
  });

  // DEFEKT: MARTWY FALLBACK `?? "1"` GASI DOMYSLNA WYMAGALNOSC ADRESU E-MAIL.
  //
  // WEJSCIE: widget "join-us" w dokumencie, ktory NIE MA klucza `requireEmail`
  //   (dokument sprzed wprowadzenia pola, import tresci, duplikat programowy).
  // CO PSUJE: `requireEmail={(getStr(c, "requireEmail") ?? "1") === "1"}`
  //   (WidgetView.tsx:1141). `getStr` (widget-view/frame.ts:260) NIGDY nie
  //   zwraca undefined - dla brakujacego klucza oddaje PUSTY NAPIS - wiec
  //   fallback `?? "1"` jest martwy, a wynik porownania to `"" === "1"`, czyli
  //   false. Zapisane w kodzie "domyslnie wymagany" nie dziala.
  // KONSEKWENCJA: pole e-mail traci atrybut `required` i `aria-required`, znika
  //   gwiazdka przy etykiecie, a walidacja `if (requireEmail && ...)` w
  //   JoinUsForm przepuszcza zgloszenie BEZ adresu. Formularz zapisu na liste
  //   zbiera wtedy rekordy, z ktorymi nie da sie nic zrobic. Kazda inna
  //   implementacja tego samego pola w repo domyslnie WYMAGA adresu:
  //   `JoinUsForm` (`requireEmail = true`), `NewsletterForm`
  //   (`boolCfg(cfg,"requireEmail",true)`), `ContactFormView`
  //   (`bool(data,"requireEmail",true)`) - WidgetView jest jedynym wyjatkiem.
  // WYMAGANA POPRAWKA: czytac wartosc tak, zeby BRAK klucza znaczyl "wymagany",
  //   np. `getBool(c, "requireEmail", true)` (helper juz istnieje w frame.ts)
  //   albo jawnie `getStr(c, "requireEmail") !== "0"`. To samo dotyczy
  //   pozostalych `(getStr(...) ?? "…")` w tym bloku (linie 1139-1147, 1062, 1172).
  it.fails("DEFEKT: BEZ klucza requireEmail pole e-mail powinno pozostać wymagane", async () => {
    const { container } = await renderJoinUsRaw({ variant: "card" });
    const email = container.querySelector('input[type="email"]');
    expect(email).not.toBeNull();
    expect(email?.hasAttribute("required")).toBe(true);
  });

  it("jawne wyłączenie wymagalności adresu zdejmuje atrybut required", async () => {
    const { container } = await renderJoinUsRaw({ variant: "card", requireEmail: "0" });
    const email = container.querySelector('input[type="email"]');
    expect(email).not.toBeNull();
    expect(email?.hasAttribute("required")).toBe(false);
  });

  it("jawne włączenie wymagalności adresu dokłada required i aria-required", async () => {
    const { container } = await renderJoinUsRaw({ variant: "card", requireEmail: "1" });
    const email = container.querySelector('input[type="email"]');
    expect(email?.hasAttribute("required")).toBe(true);
    expect(email?.getAttribute("aria-required")).toBe("true");
  });
});
