import { describe, expect, it } from "vitest";
import { audioContentPath } from "../contentPath";

describe("audio content navigation", () => {
  it("keeps canonical article navigation inside the running app", () => {
    expect(audioContentPath("https://neweuropeanstrategies.com/blog/article?lang=pl#intro")).toBe("/blog/article?lang=pl#intro");
  });
  it("preserves local author links", () => {
    expect(audioContentPath("/author/anna")).toBe("/author/anna");
  });
  it("rejects malformed destinations", () => {
    expect(audioContentPath("not a URL")).toBe("/");
  });
});