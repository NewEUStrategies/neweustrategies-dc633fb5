// Regresja stale-key slidera postow.
//
// queryFn sortuje po `title_pl` albo `title_en` (orderBy="title"), ale klucz
// zapytania nie zawieral jezyka. PL i EN dzielily wiec JEDEN wpis cache:
// ktokolwiek wszedl pierwszy, ustawial kolejnosc dla obu wersji jezykowych na
// caly czas swiezosci wpisu (a przy prefetchu SSR - takze dla HTML-a serwera).
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import {
  sliderPostsInput,
  sliderPostsOrderColumn,
  sliderPostsQueryOptions,
} from "@/lib/builder/sliderPostsQuery";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

const byTitle: WidgetContent = { source: "posts", orderBy: "title", limit: 5 };

describe("klucz zapytania slidera postow", () => {
  it("uzywa kanonicznego korzenia", () => {
    expect(sliderPostsQueryOptions(byTitle, "pl").queryKey[0]).toBe(WIDGET_QUERY_ROOTS.sliderPosts);
  });

  it("niesie jezyk, wiec PL i EN nie dziela wpisu cache", () => {
    const pl = sliderPostsQueryOptions(byTitle, "pl").queryKey;
    const en = sliderPostsQueryOptions(byTitle, "en").queryKey;
    expect(pl).not.toEqual(en);
    expect(JSON.stringify(pl)).toContain('"lang":"pl"');
    expect(JSON.stringify(en)).toContain('"lang":"en"');
  });

  it("jest stabilny dla tej samej tresci i jezyka (SSR = klient, bez refetchu)", () => {
    expect(sliderPostsQueryOptions(byTitle, "pl").queryKey).toEqual(
      sliderPostsQueryOptions({ ...byTitle }, "pl").queryKey,
    );
  });

  it("input jest pochodna wylacznie tresci i jezyka", () => {
    expect(sliderPostsInput({ limit: 3 }, "en")).toEqual({
      limit: 3,
      categoryId: "",
      categorySlugs: [],
      tagSlugs: [],
      excludeIds: [],
      orderBy: "newest",
      lang: "en",
    });
  });
});

describe("kolumna sortowania slidera", () => {
  it("orderBy=title sortuje po kolumnie w jezyku widoku", () => {
    expect(sliderPostsOrderColumn("title", "pl")).toBe("title_pl");
    expect(sliderPostsOrderColumn("title", "en")).toBe("title_en");
  });

  it("pozostale sortowania ida po dacie publikacji", () => {
    expect(sliderPostsOrderColumn("newest", "en")).toBe("published_at");
    expect(sliderPostsOrderColumn("oldest", "pl")).toBe("published_at");
  });
});
