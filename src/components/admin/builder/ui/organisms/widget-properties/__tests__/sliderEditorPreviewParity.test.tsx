// SliderEditor: podgląd na żywo MUSI pokazywać to samo, co kanwa i strona
// publiczna. Dotąd rozjeżdżał się w obie strony:
//  - `showTitle` i `authorDisplay` nie były w ogóle przekazywane do podglądu
//    (tytuł zawsze widoczny, tryb "label" nieosiągalny),
//  - `authorSizePx` / `authorAvatarSizePx` działały WYŁĄCZNIE w podglądzie,
//    a kanwa i produkcja trzymały sztywne 12 px / 20 px.
// Test asercjuje wyrenderowany DOM podglądu (kontener data-testid), a nie
// kształt configu, więc pilnuje realnej zgodności, nie deklaracji.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Json, WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({ posts: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: db.posts, error: null });
  return { supabase: { from: () => builder, rpc: async () => ({ data: [], error: null }) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { SliderEditor } from "../SliderEditor";

const ITEM = {
  image: "https://cdn.example.com/slide.jpg",
  title_pl: "Tytuł slajdu",
  title_en: "Slide title",
  subtitle_pl: "Zajawka slajdu",
  author: "Anna Nowak",
  authorAvatar: "https://cdn.example.com/anna.png",
  href: "/post/x",
};

function renderEditor(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setContent = vi.fn<(k: string, v: Json) => void>();
  const view = render(
    <QueryClientProvider client={qc}>
      {/* source="posts" - lista slajdów ręcznych (ImageSlot) wymaga kontekstu
          tenanta, a przedmiotem testu jest wyłącznie podgląd na żywo. */}
      <SliderEditor
        c={{ source: "posts", items: [ITEM], ...content }}
        lang={lang}
        setContent={setContent}
      />
    </QueryClientProvider>,
  );
  return { ...view, setContent };
}

const preview = (): HTMLElement => screen.getByTestId("slider-live-preview");

beforeEach(() => {
  db.posts = [];
});
afterEach(cleanup);

describe("SliderEditor - podgląd odzwierciedla sekcję Wyświetlanie", () => {
  it("shows the title in the live preview by default", async () => {
    renderEditor({});
    await waitFor(() => expect(preview().querySelectorAll("h3.cms-post-title").length).toBe(1));
  });

  it("removes the title from the live preview when showTitle=false", async () => {
    renderEditor({ showTitle: false });
    await waitFor(() =>
      expect(preview().querySelector(".eh-slider")?.getAttribute("data-show-title")).toBe("false"),
    );
    expect(preview().querySelectorAll("h3.cms-post-title")).toHaveLength(0);
    expect(preview().textContent).not.toContain("Tytuł slajdu");
  });

  it("renders the author label mode without an avatar", async () => {
    renderEditor({ authorDisplay: "label", authorLabel_pl: "Redakcja" });
    await waitFor(() => expect(preview().textContent).toContain("Redakcja: Anna Nowak"));
    expect(preview().querySelector("[data-author-byline] img")).toBeNull();
  });

  it("drops the author entirely in none mode", async () => {
    renderEditor({ authorDisplay: "none" });
    await waitFor(() => expect(preview().textContent).toContain("Tytuł slajdu"));
    expect(preview().querySelector("[data-author-byline]")).toBeNull();
  });

  it("keeps author sizing identical to the canvas contract (12 / 20 by default)", async () => {
    renderEditor({});
    await waitFor(() => expect(preview().querySelector("[data-author-byline] img")).not.toBeNull());
    const avatar = preview().querySelector<HTMLImageElement>("[data-author-byline] img");
    expect(avatar?.getAttribute("width")).toBe("20");
    expect(preview().querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
      "12px",
    );
  });

  it("applies authorSizePx and authorAvatarSizePx in the live preview", async () => {
    renderEditor({ authorSizePx: 17, authorAvatarSizePx: 36 });
    await waitFor(() => expect(preview().querySelector("[data-author-byline] img")).not.toBeNull());
    const avatar = preview().querySelector<HTMLImageElement>("[data-author-byline] img");
    expect(avatar?.getAttribute("width")).toBe("36");
    expect(preview().querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
      "17px",
    );
  });

  it("hides the cover in the live preview when showCover=false", async () => {
    renderEditor({ showCover: false });
    await waitFor(() =>
      expect(preview().querySelector(".eh-slider")?.getAttribute("data-hide-cover")).toBe("true"),
    );
  });

  it("drops the excerpt in the live preview when showExcerpt=false", async () => {
    renderEditor({ showExcerpt: false });
    await waitFor(() => expect(preview().textContent).toContain("Tytuł slajdu"));
    expect(preview().textContent).not.toContain("Zajawka slajdu");
  });
});
