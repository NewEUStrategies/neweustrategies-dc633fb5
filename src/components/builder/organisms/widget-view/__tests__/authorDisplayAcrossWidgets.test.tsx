// KONTRAKT AUTORA JEST JEDEN - dla KAŻDEGO widgetu, który go rysuje.
//
// PROBLEM, KTÓRY TEN TEST ZAMYKA
// Rozmiar bylinu (nazwisko 12 px, zdjęcie 20 px) i możliwość jego zmiany żyły
// wcześniej WYŁĄCZNIE w sliderze. Post-lista miała zaszyte 20 px awatara bez
// żadnej kontroli nad czcionką, a lista z oceną, rekomendacje i metadane wpisu
// dostawały wartości domyślne komponentu, których panel w ogóle nie oferował.
// Do tego trójstan `authorDisplay` nie potrafił wyrazić „samo zdjęcie".
//
// Test jest CELOWO wielowidgetowy: mierzy wyrenderowany DOM każdego renderera
// osobno, więc regresja w JEDNYM z nich (np. ktoś znów zaszyje 20 px w karcie)
// zapala się natychmiast, zamiast czekać na wizualny przegląd strony.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów pokazuje fallback Suspense i synchroniczne asercje
// widzą pustkę tam, gdzie w produkcji SSR wypełnia boundary. Lustro eager jest
// kontraktowo identyczne z rejestrem (src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts).
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"])
      b[m] = () => b;
    b.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PostListView } from "../PostListView";
import { RatedListView } from "../RatedListView";
import { DynamicTagWidget } from "../DynamicTagWidgets";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

const AUTHOR = "Anna Autorka";
const AVATAR = "https://cdn.example.com/anna.png";

const POST = {
  id: "p1",
  slug: "wpis",
  title_pl: "Tytuł PL",
  title_en: "Title EN",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  cover_image_url: "https://cdn.example.com/cover.jpg",
  published_at: "2026-01-01T00:00:00Z",
  post_format: null,
  author_id: "a1",
  author_display_name: AUTHOR,
  author_avatar_url: AVATAR,
  author_slug: "anna",
};

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "p1",
  slug: "wpis",
  title_pl: "Tytuł PL",
  publishedAt: "2026-01-01T10:00:00Z",
  author: { id: "a1", name: AUTHOR, slug: "anna", avatarUrl: AVATAR },
};

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Byline dowolnego widgetu - jeden `data-*` dla całego buildera. */
const byline = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("[data-author-byline]");
const bylineAvatar = (root: HTMLElement): HTMLImageElement | null =>
  root.querySelector<HTMLImageElement>("[data-author-byline] img");

/**
 * Każdy widget rysujący byline, w formie „treść -> wyrenderowany element".
 * Nowy widget z autorem DOPISUJE SIĘ TUTAJ - inaczej jego byline nie ma
 * przypiętego kontraktu rozmiarów i widoczności.
 */
const WIDGETS: ReadonlyArray<{
  label: string;
  render: (c: WidgetContent) => ReactElement;
  prepare?: () => void;
}> = [
  {
    label: "post-list",
    render: (c) => <PostListView c={{ variant: "card", ...c }} lang="pl" />,
    prepare: () => {
      db.tables.posts = [POST];
    },
  },
  {
    label: "rated-list",
    render: (c) => (
      <RatedListView
        c={{
          source: "manual",
          items: [{ title_pl: "Tytuł PL", author: AUTHOR, authorAvatar: AVATAR }],
          ...c,
        }}
        lang="pl"
      />
    ),
  },
  {
    label: "post-meta",
    render: (c) => (
      <CurrentPostProvider value={POST_CTX}>
        <DynamicTagWidget
          node={
            {
              id: "pm",
              kind: "widget",
              type: "post-meta",
              content: c,
            } as WidgetNode
          }
          lang="pl"
        />
      </CurrentPostProvider>
    ),
  },
  {
    label: "post-author-card (inline)",
    render: (c) => (
      <CurrentPostProvider value={POST_CTX}>
        <DynamicTagWidget
          node={
            {
              id: "pac",
              kind: "widget",
              type: "post-author-card",
              content: { variant: "inline", ...c },
            } as WidgetNode
          }
          lang="pl"
        />
      </CurrentPostProvider>
    ),
  },
  {
    label: "testimonial",
    render: (c) => (
      <WidgetView
        node={
          {
            id: "tst",
            kind: "widget",
            type: "testimonial",
            content: { quote_pl: "Cytat", author: AUTHOR, avatar: AVATAR, ...c },
          } as WidgetNode
        }
        lang="pl"
        device="desktop"
      />
    ),
  },
];

beforeEach(() => {
  db.tables = { posts: [POST], profiles_public: [] };
});
afterEach(cleanup);

describe("byline autora - domyślnie 12 px nazwiska i 20 px zdjęcia w KAŻDYM widgecie", () => {
  it.each(WIDGETS.map((w) => [w.label, w] as const))("%s", async (_label, widget) => {
    widget.prepare?.();
    const { container } = wrap(widget.render({}));
    await waitFor(() => expect(bylineAvatar(container)).not.toBeNull());

    expect(bylineAvatar(container)?.getAttribute("width")).toBe("20");
    expect(bylineAvatar(container)?.style.height).toBe("20px");
    expect(byline(container)?.style.fontSize).toBe("12px");
  });
});

describe("byline autora - 6 px zaokrąglenia i nieściśliwe pudełko w KAŻDYM widgecie", () => {
  it.each(WIDGETS.map((w) => [w.label, w] as const))("%s", async (_label, widget) => {
    widget.prepare?.();
    const { container } = wrap(widget.render({}));
    await waitFor(() => expect(bylineAvatar(container)).not.toBeNull());

    const s = bylineAvatar(container)!.style;
    expect(s.borderRadius).toBe("6px");
    // Domknięcie z obu stron: ani flex, ani `max-width:100%` z globalnych
    // reguł obrazów nie zmieni realnych pikseli zdjęcia.
    expect([s.minWidth, s.maxWidth, s.minHeight, s.maxHeight]).toEqual([
      "20px",
      "20px",
      "20px",
      "20px",
    ]);
    expect(s.flex).toBe("0 0 auto");
  });
});

describe("byline autora - typografia sekcji nie ma jak przejąć rozmiaru", () => {
  it.each(WIDGETS.map((w) => [w.label, w] as const))("%s", async (_label, widget) => {
    widget.prepare?.();
    const { container } = wrap(widget.render({}));
    await waitFor(() => expect(byline(container)).not.toBeNull());

    const root = byline(container)!;
    const unguarded = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter(
      (el) => !el.hasAttribute("data-typography-exempt"),
    );
    expect(
      unguarded.map((el) => el.tagName),
      "węzeł bez wyłączenia zostanie przejęty przez `font-size !important` typografii widgetu",
    ).toEqual([]);
  });
});

describe("byline autora - oba rozmiary zmieniane niezależnie w KAŻDYM widgecie", () => {
  it.each(WIDGETS.map((w) => [w.label, w] as const))("%s", async (_label, widget) => {
    widget.prepare?.();
    const { container } = wrap(widget.render({ authorSizePx: 17, authorAvatarSizePx: 44 }));
    await waitFor(() => expect(bylineAvatar(container)).not.toBeNull());

    expect(bylineAvatar(container)?.getAttribute("width")).toBe("44");
    expect(bylineAvatar(container)?.style.width).toBe("44px");
    expect(byline(container)?.style.fontSize).toBe("17px");
  });
});

describe("byline autora - osie widoczności chowane niezależnie w KAŻDYM widgecie", () => {
  it.each(WIDGETS.map((w) => [w.label, w] as const))(
    "%s: bez zdjęcia zostaje etykieta „Autor: Imię Nazwisko”",
    async (_label, widget) => {
      widget.prepare?.();
      const { container } = wrap(widget.render({ showAuthorAvatar: false }));
      await waitFor(() => expect(byline(container)).not.toBeNull());

      expect(bylineAvatar(container)).toBeNull();
      expect(byline(container)?.getAttribute("data-author-byline")).toBe("label");
      expect(container.textContent).toContain(`Autor: ${AUTHOR}`);
    },
  );

  it.each(WIDGETS.map((w) => [w.label, w] as const))(
    "%s: bez nazwiska zostaje samo zdjęcie",
    async (_label, widget) => {
      widget.prepare?.();
      const { container } = wrap(widget.render({ showAuthorName: false }));
      await waitFor(() => expect(bylineAvatar(container)).not.toBeNull());

      expect(container.textContent).not.toContain(AUTHOR);
      // Zdjęcie niesie teraz treść, więc MUSI mieć opis dla czytnika ekranu.
      expect(bylineAvatar(container)?.getAttribute("alt")).toBe(AUTHOR);
    },
  );

  it.each(WIDGETS.map((w) => [w.label, w] as const))(
    "%s: obie osie wyłączone = brak bylinu",
    async (_label, widget) => {
      widget.prepare?.();
      const { container } = wrap(widget.render({ showAuthorName: false, showAuthorAvatar: false }));
      await waitFor(() => expect(container.innerHTML.length).toBeGreaterThan(0));

      expect(byline(container)).toBeNull();
      expect(container.textContent).not.toContain(AUTHOR);
    },
  );
});

describe("byline autora - etykieta redakcji i język", () => {
  it("własna etykieta zastępuje domyślne „Autor”", async () => {
    db.tables.posts = [POST];
    const { container } = wrap(
      <PostListView
        c={{ variant: "card", showAuthorAvatar: false, authorLabel_pl: "Redakcja" }}
        lang="pl"
      />,
    );
    await screen.findByText(AUTHOR);
    expect(container.textContent).toContain(`Redakcja: ${AUTHOR}`);
  });

  it("angielski byline używa „By” bez konfiguracji", async () => {
    db.tables.posts = [POST];
    const { container } = wrap(
      <PostListView c={{ variant: "card", showAuthorAvatar: false }} lang="en" />,
    );
    await screen.findByText(AUTHOR);
    expect(container.textContent).toContain(`By: ${AUTHOR}`);
  });
});
