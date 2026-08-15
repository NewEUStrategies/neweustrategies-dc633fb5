// GUARD KLASY BŁĘDU: dane przykładowe widgetów `post-*` nie mogą wyciec poza
// kanwę buildera.
//
// Regresja, którą ten plik zamyka: `useCtx()` robiło
// `useCurrentPostCtx() ?? PLACEHOLDER_POST_CTX`, a Header, Footer, PopupHost,
// MobileDrawerBody i strony taksonomii renderują `BuilderRenderer` BEZ
// `CurrentPostProvider`. Widget `post-*` wstawiony w takie miejsce pokazywał
// REALNYM ODWIEDZAJĄCYM fikcyjnego "Jana Kowalskiego", "Tytuł przykładowego
// wpisu", tagi "Przykład/CMS" i archiwum "Przykładowe archiwum / 12 wpisów".
//
// Test sprawdza trzy powierzchnie naraz:
//   1. publiczna bez providera  -> pusto (żadnego napisu z próbki),
//   2. kanwa buildera bez providera -> próbka (redaktor musi coś widzieć),
//   3. publiczna z realnym providerem -> realne dane.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DynamicTagWidget } from "../DynamicTagWidgets";
import { makeWidget } from "@/lib/builder/registry";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";
import {
  CurrentPostProvider,
  PLACEHOLDER_POST_CTX,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";
import type { WidgetType } from "@/lib/builder/types";

/** Wszystkie widgety zależne od kontekstu wpisu / archiwum. */
const CONTEXT_WIDGETS: ReadonlyArray<WidgetType> = [
  "post-title",
  "post-meta",
  "post-tags-dyn",
  "post-categories-dyn",
  "post-author-card",
  "post-breadcrumbs",
  "post-cover",
  "post-excerpt",
  "archive-title",
];

/** Napisy, które istnieją WYŁĄCZNIE w próbce buildera. */
const SAMPLE_STRINGS: ReadonlyArray<string> = [
  "Jan Kowalski",
  "Tytuł przykładowego wpisu",
  "Sample post title",
  "Krótki opis wpisu pojawi się tutaj.",
  "jan.kowalski@example.com",
  "Przykład",
  "Przykładowe archiwum",
  "Wszystkie wpisy w tej sekcji.",
];

const REAL_CTX: CurrentPostCtx = {
  kind: "post",
  id: "p-1",
  slug: "realny-wpis",
  title_pl: "Realny tytuł",
  title_en: "Real title",
  excerpt_pl: "Realna zajawka.",
  coverUrl: "https://cdn.example.com/real.jpg",
  publishedAt: "2026-03-01T08:00:00Z",
  readingTimeMin: 4,
  author: { name: "Anna Nowak", slug: "anna-nowak" },
  categories: [{ slug: "ue", name: "Unia Europejska" }],
  tags: [{ slug: "nato", name: "NATO" }],
  breadcrumbs: [{ label: "Start", href: "/" }, { label: "Realny tytuł" }],
  archive: { type: "tag", label: "NATO", description: "Wpisy o NATO", count: 3 },
};

function renderIn(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(cleanup);

describe("post-* na powierzchni publicznej BEZ kontekstu wpisu", () => {
  it.each(CONTEXT_WIDGETS.map((type) => [type] as const))(
    '"%s" nie renderuje niczego (zero danych przykładowych)',
    (type) => {
      const { container } = renderIn(<DynamicTagWidget node={makeWidget(type)} lang="pl" />);
      expect(container.firstChild).toBeNull();
      expect(container.textContent).toBe("");
    },
  );

  it("żaden napis z PLACEHOLDER_POST_CTX nie trafia do DOM", () => {
    for (const type of CONTEXT_WIDGETS) {
      for (const lang of ["pl", "en"] as const) {
        const { container } = renderIn(<DynamicTagWidget node={makeWidget(type)} lang={lang} />);
        for (const sample of SAMPLE_STRINGS) {
          expect(container.textContent).not.toContain(sample);
        }
        cleanup();
      }
    }
  });

  it("nie renderuje też okładki podglądu (data URI z PLACEHOLDER_POST_CTX)", () => {
    const { container } = renderIn(<DynamicTagWidget node={makeWidget("post-cover")} lang="pl" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("post-* w kanwie buildera (BuilderModeProvider, brak providera wpisu)", () => {
  it("post-title pokazuje próbkę", () => {
    const { container } = renderIn(
      <BuilderModeProvider mode="light">
        <DynamicTagWidget node={makeWidget("post-title")} lang="pl" />
      </BuilderModeProvider>,
    );
    expect(container.textContent).toContain("Tytuł przykładowego wpisu");
  });

  it("post-author-card pokazuje próbkowego autora", () => {
    const { container } = renderIn(
      <BuilderModeProvider mode="dark">
        <DynamicTagWidget node={makeWidget("post-author-card")} lang="pl" />
      </BuilderModeProvider>,
    );
    expect(container.textContent).toContain("Jan Kowalski");
  });

  it("archive-title pokazuje próbkę archiwum z kontekstu podglądu, nie z renderera", () => {
    const { container } = renderIn(
      <BuilderModeProvider mode="light">
        <DynamicTagWidget node={makeWidget("archive-title")} lang="pl" />
      </BuilderModeProvider>,
    );
    expect(container.textContent).toContain("Przykładowe archiwum");
    expect(PLACEHOLDER_POST_CTX.archive?.label).toBe("Przykładowe archiwum");
  });

  it("post-cover jest widoczny w kanwie (okładka podglądu) razem z ustawieniami", () => {
    const { container } = renderIn(
      <BuilderModeProvider mode="light">
        <DynamicTagWidget
          node={{ ...makeWidget("post-cover"), content: { aspect: "1/1", rounded: false } }}
          lang="pl"
        />
      </BuilderModeProvider>,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src") ?? "").toContain("data:image/svg+xml");
    const frame = container.querySelector("figure > div");
    expect(frame?.getAttribute("style") ?? "").toContain("1 / 1");
    expect(frame?.className ?? "").not.toContain("rounded-xl");
  });
});

describe("post-* na powierzchni publicznej Z realnym kontekstem", () => {
  it("renderuje wyłącznie realne dane", () => {
    const { container } = renderIn(
      <CurrentPostProvider value={REAL_CTX}>
        <div>
          {CONTEXT_WIDGETS.map((type) => (
            <DynamicTagWidget key={type} node={makeWidget(type)} lang="pl" />
          ))}
        </div>
      </CurrentPostProvider>,
    );
    expect(container.textContent).toContain("Realny tytuł");
    expect(container.textContent).toContain("Anna Nowak");
    expect(container.textContent).toContain("NATO");
    for (const sample of SAMPLE_STRINGS) {
      expect(container.textContent).not.toContain(sample);
    }
  });
});
