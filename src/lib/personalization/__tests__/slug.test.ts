import { describe, it, expect } from "vitest";
import { slugFromUrl } from "../slug";

describe("slugFromUrl", () => {
  it("takes the last path segment of a canonical URL", () => {
    expect(slugFromUrl("https://nes.example/aktualnosci/my-post")).toBe("my-post");
  });

  it("takes the last segment of a direct post URL", () => {
    expect(slugFromUrl("https://nes.example/post/hello-world")).toBe("hello-world");
  });

  it("ignores a trailing slash", () => {
    expect(slugFromUrl("https://nes.example/section/my-post/")).toBe("my-post");
  });

  it("resolves a relative path against the placeholder base", () => {
    expect(slugFromUrl("/blog/tanie-loty")).toBe("tanie-loty");
    expect(slugFromUrl("just-a-slug")).toBe("just-a-slug");
  });

  it("decodes percent-encoded segments", () => {
    expect(slugFromUrl("https://nes.example/post/caf%C3%A9")).toBe("café");
  });

  it("returns null when there is no path segment", () => {
    expect(slugFromUrl("https://nes.example/")).toBeNull();
  });
});
