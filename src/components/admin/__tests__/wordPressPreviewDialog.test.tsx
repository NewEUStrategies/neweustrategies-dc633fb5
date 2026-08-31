// DIALOG PODGLĄDU KONWERSJI (`src/components/admin/WordPressPreviewDialog.tsx`, 0%).
//
// PO CO ISTNIEJE TEN EKRAN: to jedyne miejsce, w którym redakcja WIDZI, co
// import zrobi ze stroną, PRZED zapisem - obok siebie oryginalny HTML z
// WordPressa i wynik konwersji na nasze widgety, plus licznik pokrycia.
//
// CO MA TU DOWÓD:
//   1. dane idą przez PRAWDZIWĄ funkcję serwerową `wpPreviewPage` (atrapowany
//      jest tylko framework i sieć), więc test przechodzi całą drogę
//      HTML z WP -> konwersja -> pasek pokrycia w interfejsie,
//   2. RAMKA Z ORYGINAŁEM JEST ODKAŻANA: `srcDoc` nie może zawierać ani
//      `<script>`, ani atrybutów `on*` z importowanej strony - to jedyna
//      obrona przed wykonaniem obcego kodu w panelu administratora,
//   3. pasek pokrycia pokazuje źródło (elementor / gutenberg / html) i liczby
//      zmapowanych widgetów - bez tego nikt nie wie, że strona weszła
//      fallbackiem,
//   4. ostrzeżenia konwersji są widoczne (zwinięte, z licznikiem),
//   5. przełącznik urządzenia zmienia szerokość podglądu wyniku,
//   6. zapytanie NIE leci, dopóki dialog jest zamknięty albo nie ma wpId,
//   7. błąd serwera pokazuje się w dialogu, a nie tylko w konsoli.
//
// CZEGO NIE ATRAPUJEMY: `@/lib/wp-import.functions`, `@/lib/wp-import/*` ani
// `BuilderRenderer` - renderer buildera działa tu prawdziwy, bo inaczej test
// „podglądu" nie dowodziłby niczego o podglądzie.
//
// GAŁĘZIE NIEOSIĄGALNE Z INTERFEJSU: osłona `if (!wpId) throw` w `queryFn`
// (zapytanie ma `enabled: open && !!wpId`, więc bez wpId nie startuje) oraz
// szerokość dla `device === "tablet"` - w pasku są tylko dwa przyciski,
// desktop i mobile.
//
// RODO: URL-e wyłącznie example.com / example.org.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

type Validator = (input: unknown) => unknown;
type Handler = (ctx: { data: unknown; context: unknown }) => Promise<unknown>;
interface ServerFnSpec {
  validator?: Validator;
  handler?: Handler;
}

const h = vi.hoisted(() => ({ language: "pl" }));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => h.language);
});

// Atrapa CZĄSTKOWA: podmieniamy tylko `createServerFn` i `useServerFn`.
// Reszta modułu (m.in. `createIsomorphicFn`) jest potrzebna warstwie i18n,
// którą wciąga renderer buildera.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  interface Chain {
    middleware: (m: unknown) => Chain;
    validator: (v: Validator) => Chain;
    inputValidator: (v: Validator) => Chain;
    handler: (fn: Handler) => ServerFnSpec;
  }
  const createServerFn = (): Chain => {
    const spec: ServerFnSpec = {};
    const chain: Chain = {
      middleware: () => chain,
      validator: (v) => {
        spec.validator = v;
        return chain;
      },
      inputValidator: (v) => {
        spec.validator = v;
        return chain;
      },
      handler: (fn) => {
        spec.handler = fn;
        return spec;
      },
    };
    return chain;
  };
  const useServerFn =
    (spec: ServerFnSpec) =>
    async (args: { data: unknown }): Promise<unknown> => {
      const data = spec.validator ? spec.validator(args.data) : args.data;
      if (!spec.handler) throw new Error("test: brak handlera server fn");
      return spec.handler({ data, context: {} });
    };
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, createServerFn, useServerFn };
});

vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

import { WordPressPreviewDialog } from "@/components/admin/WordPressPreviewDialog";

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

const net = {
  calls: [] as string[],
  body: null as unknown,
  status: 200,
  /** Rzut CZYMŚ INNYM niż Error - tak zachowuje się odpowiedź nie-JSON. */
  rawThrow: null as string | null,
};

function installFetch(): void {
  vi.stubGlobal("fetch", async (input: unknown): Promise<FakeResponse> => {
    net.calls.push(String(input));
    if (net.rawThrow) throw net.rawThrow;
    if (net.status !== 200) {
      return {
        ok: false,
        status: net.status,
        json: async () => ({}),
        text: async () => "brak dostępu",
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => net.body,
      text: async () => JSON.stringify(net.body),
    };
  });
}

const HTML_WITH_SCRIPT = [
  '<div class="elementor-section elementor-top-section">',
  '<div class="elementor-column elementor-col-100">',
  '<div class="elementor-widget elementor-widget-heading"><h2 onclick="alert(1)">Nasza misja</h2></div>',
  '<div class="elementor-widget elementor-widget-countdown"><span>7 dni</span></div>',
  "</div></div>",
  '<script>window.location="https://example.org/atak";</script>',
  '<img src="https://example.com/wp-content/uploads/foto.jpg" onerror="alert(2)" />',
].join("");

beforeEach(() => {
  cleanup();
  h.language = "pl";
  net.calls = [];
  net.status = 200;
  net.rawThrow = null;
  net.body = {
    ID: 5,
    title: "Nasza <b>misja</b>",
    slug: "nasza-misja",
    status: "publish",
    content: HTML_WITH_SCRIPT,
    excerpt: "Zapowiedź",
    featured_image: null,
    URL: "https://example.com/nasza-misja",
  };
  process.env.LOVABLE_API_KEY = "test-platform-key-not-real";
  process.env.WORDPRESS_COM_API_KEY = "test-wp-key-not-real";
  installFetch();
});

function renderDialog(over: Partial<{ open: boolean; wpId: number | null; wpIdEn?: number }> = {}) {
  const onOpenChange = vi.fn();
  const view = renderWithQueryClient(
    <WordPressPreviewDialog
      open={over.open ?? true}
      onOpenChange={onOpenChange}
      siteDomain="example.com"
      wpId={over.wpId === undefined ? 5 : over.wpId}
      wpIdEn={over.wpIdEn}
    />,
  );
  return { ...view, onOpenChange };
}

describe("WordPressPreviewDialog", () => {
  it("nie pyta serwera, dopóki dialog jest zamknięty", () => {
    renderDialog({ open: false });
    expect(net.calls).toHaveLength(0);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("nie pyta serwera bez wpId", () => {
    renderDialog({ wpId: null });
    expect(net.calls).toHaveLength(0);
    expect(screen.getByText("Podgląd konwersji")).toBeInTheDocument();
  });

  it("pokazuje pasek pokrycia z wynikiem PRAWDZIWEJ konwersji", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    expect(screen.getByText(/Podgląd konwersji/).textContent).toContain("Nasza misja");
    // Nagłówek zmapowany, countdown poszedł fallbackiem - i to widać.
    expect(screen.getByText("Elementor: 1")).toBeInTheDocument();
    expect(screen.getByText("Gutenberg: 0")).toBeInTheDocument();
    expect(screen.getByText("Fallback: 1")).toBeInTheDocument();
    expect(screen.getByText(/Razem: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Media: 1/)).toBeInTheDocument();
  });

  it("ODKAŻA ramkę oryginału: bez <script> i bez atrybutów on*", async () => {
    const { container } = renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    const iframe = container.querySelector('iframe[title="wp-original"]');
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error("test: brak ramki oryginału");
    const doc = iframe.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("Nasza misja");
    expect(doc).toContain("https://example.com/wp-content/uploads/foto.jpg");
    expect(doc).not.toContain("<script");
    expect(doc).not.toContain("example.org/atak");
    expect(doc).not.toContain("onclick");
    expect(doc).not.toContain("onerror");
    expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("renderuje wynik konwersji prawdziwym rendererem buildera", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    // Nagłówek z Elementora musi być widoczny po stronie „wynik".
    const headings = screen.getAllByText("Nasza misja");
    expect(headings.length).toBeGreaterThan(0);
    expect(screen.getByText(/Podgląd nie zapisuje niczego/)).toBeInTheDocument();
  });

  it("pokazuje ostrzeżenia konwersji z licznikiem", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    expect(screen.getByText(/Ostrzeżenia \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Nieznany widget Elementor: countdown")).toBeInTheDocument();
  });

  it("bez ostrzeżeń sekcja ostrzeżeń w ogóle się nie pokazuje", async () => {
    net.body = {
      ID: 5,
      title: "Czysta strona",
      slug: "czysta",
      status: "publish",
      content: "<!-- wp:paragraph --><p>Blok Gutenberga.</p><!-- /wp:paragraph -->",
      excerpt: "",
      URL: "https://example.com/czysta",
    };
    renderDialog();
    await waitFor(() => expect(screen.getByText("gutenberg")).toBeInTheDocument());
    expect(screen.queryByText(/Ostrzeżenia/)).not.toBeInTheDocument();
    expect(screen.getByText("Gutenberg: 1")).toBeInTheDocument();
  });

  it("przełącznik urządzenia zwęża podgląd wyniku do 390 px", async () => {
    const { container } = renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    const icon = container.querySelector('svg.lucide-smartphone, svg[class*="smartphone"]');
    const mobile = icon?.closest("button");
    if (!mobile) throw new Error("test: brak przycisku mobile");
    const wrapper = () => container.querySelector("div.mx-auto[style]");
    expect(wrapper()?.getAttribute("style")).toContain("100%");
    fireEvent.click(mobile);
    await waitFor(() => expect(wrapper()?.getAttribute("style")).toContain("390px"));
  });

  it("strona bez tytułu jest opisana identyfikatorem WP", async () => {
    net.body = {
      ID: 5,
      title: "",
      slug: "bez-tytulu",
      status: "publish",
      content: "<p>Treść.</p>",
      excerpt: "",
      URL: "https://example.com/bez-tytulu",
    };
    renderDialog();
    await waitFor(() => expect(screen.getByText("html")).toBeInTheDocument());
    expect(screen.getByText(/Podgląd konwersji/).textContent).toContain("#5");
  });

  it("powrót do widoku desktop przywraca pełną szerokość", async () => {
    const { container } = renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    const wrapper = () => container.querySelector("div.mx-auto[style]");
    const iconFor = (name: string) => container.querySelector(`svg[class*="${name}"]`);
    const mobile = iconFor("smartphone")?.closest("button");
    const desktop = iconFor("monitor")?.closest("button");
    if (!mobile || !desktop) throw new Error("test: brak przycisków urządzeń");
    fireEvent.click(mobile);
    await waitFor(() => expect(wrapper()?.getAttribute("style")).toContain("390px"));
    fireEvent.click(desktop);
    await waitFor(() => expect(wrapper()?.getAttribute("style")).toContain("100%"));
  });

  it("wyjątek NIE-Error z warstwy sieciowej też jest pokazany", async () => {
    net.rawThrow = "<html>502 Bad Gateway</html>";
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("<html>502 Bad Gateway</html>")).toBeInTheDocument(),
    );
  });

  it("błąd serwera jest pokazany w dialogu", async () => {
    net.status = 403;
    renderDialog();
    await waitFor(() => expect(screen.getByText(/WordPress 403/)).toBeInTheDocument());
    expect(screen.queryByText("elementor")).not.toBeInTheDocument();
  });

  it("dokłada wersję angielską, gdy podano wpIdEn", async () => {
    renderDialog({ wpIdEn: 6 });
    await waitFor(() => expect(net.calls.length).toBe(2));
    expect(net.calls[1]).toContain("/posts/6");
  });

  it("teksty przechodzą na angielski razem z interfejsem", async () => {
    h.language = "en";
    renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    expect(screen.getByText(/Conversion preview/)).toBeInTheDocument();
    expect(screen.getByText("Original (WordPress)")).toBeInTheDocument();
    expect(screen.getByText("Converted (our widgets)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("Zamknij zgłasza zamknięcie do rodzica", async () => {
    const { onOpenChange } = renderDialog();
    await waitFor(() => expect(screen.getByText("elementor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
