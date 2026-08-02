// Kontrakt sortowania i bylinu post-listy.
//
// 1. "created_at" bylo oferowane przez edytor (PostListEditor.ORDER_BY), ale
//    `safeOrderBy` cicho koercowalo je do "published_at" - ustawienie dawalo
//    sie wybrac i nie robilo NIC.
// 2. Lista wariantow z bylinem byla utrzymywana osobno od widoku i zawierala
//    "numbered" (wariant, ktory autora w ogole nie rysuje), a nie zawierala
//    wariantow, ktore go rysuja - czyli jednoczesnie zbedny round-trip do
//    profiles_public i brak nazwisk tam, gdzie byly potrzebne.
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import {
  POST_LIST_BYLINE_VARIANTS,
  POST_LIST_ORDER_BY,
  postListAuthorDisplay,
  postListInput,
  postListOrderColumn,
  postListQueryOptions,
  postListVariantHasByline,
} from "@/lib/builder/postListQuery";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

describe("sortowanie post-listy", () => {
  it("zachowuje created_at zamiast cicho koercowac je do published_at", () => {
    expect(postListInput({ orderBy: "created_at" }, "pl").orderByRaw).toBe("created_at");
    expect(postListOrderColumn("created_at", "pl")).toBe("created_at");
    expect(postListOrderColumn("created_at", "en")).toBe("created_at");
  });

  it("przepuszcza kazde sortowanie oferowane przez edytor", () => {
    for (const orderBy of POST_LIST_ORDER_BY) {
      expect(postListInput({ orderBy }, "pl").orderByRaw).toBe(orderBy);
    }
  });

  it("nadal odrzuca wartosci spoza listy (fallback na published_at)", () => {
    expect(postListInput({ orderBy: "drop table" }, "pl").orderByRaw).toBe("published_at");
    expect(postListInput({}, "pl").orderByRaw).toBe("published_at");
    expect(postListInput({ orderBy: 7 } as WidgetContent, "pl").orderByRaw).toBe("published_at");
  });

  it("sortowanie po tytule wybiera kolumne jezyka, a random/popular kolumne bazowa", () => {
    expect(postListOrderColumn("title", "pl")).toBe("title_pl");
    expect(postListOrderColumn("title", "en")).toBe("title_en");
    expect(postListOrderColumn("random", "pl")).toBe("published_at");
    expect(postListOrderColumn("popular", "en")).toBe("published_at");
    expect(postListOrderColumn("published_at", "pl")).toBe("published_at");
  });

  it("created_at zmienia klucz zapytania (inny wynik = inny wpis cache)", () => {
    const byPublished = postListQueryOptions({ orderBy: "published_at" }, "pl").queryKey;
    const byCreated = postListQueryOptions({ orderBy: "created_at" }, "pl").queryKey;
    expect(byCreated[0]).toBe(WIDGET_QUERY_ROOTS.postList);
    expect(byCreated).not.toEqual(byPublished);
  });
});

describe("warianty z bylinem autora", () => {
  it("nie obejmuja wariantu numbered (nie rysuje autora)", () => {
    expect(POST_LIST_BYLINE_VARIANTS).not.toContain("numbered");
    expect(postListVariantHasByline("numbered")).toBe(false);
  });

  it("obejmuja warianty, ktore autora rysuja", () => {
    for (const variant of ["card", "list", "ranked", "classic", "boxed-list", "overlay"]) {
      expect(postListVariantHasByline(variant)).toBe(true);
    }
  });

  it("wariant numbered nie zamawia autorow (bez round-tripu do profiles_public)", () => {
    expect(postListInput({ variant: "numbered" }, "pl").withAuthors).toBe(false);
  });

  it("wariant z bylinem zamawia autorow, dopoki autor nie jest wylaczony", () => {
    expect(postListInput({ variant: "ranked" }, "pl").withAuthors).toBe(true);
    expect(postListInput({}, "pl").withAuthors).toBe(true);
    expect(postListInput({ variant: "card", authorDisplay: "none" }, "pl").withAuthors).toBe(false);
    expect(
      postListInput({ variant: "card", showAuthorAvatar: "0", showAuthorLabel: "0" }, "pl")
        .withAuthors,
    ).toBe(false);
  });
});

describe("postListAuthorDisplay", () => {
  it("nowe pole authorDisplay wygrywa", () => {
    expect(postListAuthorDisplay({ authorDisplay: "label" })).toBe("label");
    expect(postListAuthorDisplay({ authorDisplay: "none" })).toBe("none");
    expect(postListAuthorDisplay({ authorDisplay: "avatar" })).toBe("avatar");
  });

  it("starsza tresc wyprowadza wynik z pary showAuthorAvatar/showAuthorLabel", () => {
    expect(postListAuthorDisplay({})).toBe("avatar");
    expect(postListAuthorDisplay({ showAuthorAvatar: "0" })).toBe("label");
    expect(postListAuthorDisplay({ showAuthorAvatar: "0", showAuthorLabel: "0" })).toBe("none");
    // Boolean zapisany przez panel znaczy to samo co historyczne "0"/"1".
    expect(postListAuthorDisplay({ showAuthorAvatar: false, showAuthorLabel: false })).toBe("none");
  });

  it("wartosc spoza zbioru nie wylacza autora po cichu", () => {
    expect(postListAuthorDisplay({ authorDisplay: "cokolwiek" })).toBe("avatar");
  });
});
