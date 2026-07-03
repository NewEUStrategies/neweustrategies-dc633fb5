import { afterEach, describe, expect, it } from "vitest";

import { getAnchorScrollOffset, replaceHashPreservingRouterState } from "./smoothAnchorScroll";

describe("smooth anchor scroll helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("updates hash without enabling router hash scroll", () => {
    window.history.replaceState({ key: "existing" }, "", "/article?lang=pl#old");

    replaceHashPreservingRouterState("section-a");

    expect(window.location.pathname).toBe("/article");
    expect(window.location.search).toBe("?lang=pl");
    expect(window.location.hash).toBe("#section-a");
    expect(window.history.state).toMatchObject({
      key: "existing",
      __hashScrollIntoViewOptions: false,
    });
  });

  it("uses visible site header height as anchor offset", () => {
    document.body.innerHTML = `<header data-site-header style="height: 64px"></header>`;
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    if (!header) throw new Error("Missing test header");
    header.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 100,
      height: 64,
      top: 0,
      right: 100,
      bottom: 64,
      left: 0,
      toJSON: () => ({}),
    });

    expect(getAnchorScrollOffset()).toBe(76);
  });
});
