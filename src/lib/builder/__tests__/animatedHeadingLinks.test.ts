import { describe, expect, it } from "vitest";
import { toAnimatedHeadingLink, toWidgetLink } from "../animatedHeadingLinks";

describe("animated heading links", () => {
  it("ignores empty and unsafe urls", () => {
    expect(toAnimatedHeadingLink(undefined)).toBeUndefined();
    expect(toAnimatedHeadingLink({ url: "   " })).toBeUndefined();
    expect(toAnimatedHeadingLink({ url: "javascript:alert(1)" })).toBeUndefined();
  });

  it("normalizes target, rel and nofollow", () => {
    expect(
      toAnimatedHeadingLink({ url: "/tag/eu", target: "_blank", nofollow: true, rel: "ugc" }),
    ).toEqual({
      href: "/tag/eu",
      target: "_blank",
      rel: "ugc nofollow",
      ariaLabel: undefined,
    });
  });

  it("restores picker state for taxonomy links", () => {
    expect(toWidgetLink({ url: "/category/analizy", kind: "category", refLabel: "Analizy" })).toEqual(
      {
        url: "/category/analizy",
        kind: "category",
        refId: undefined,
        refLabel: "Analizy",
        target: "_self",
        rel: undefined,
        nofollow: false,
        ariaLabel: undefined,
      },
    );
  });
});
