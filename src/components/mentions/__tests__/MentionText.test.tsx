import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// <Link> czyta kontekst routera - w teście prezentacyjnym podmieniamy go na
// zwykłą kotwicę (współdzielony stub), żeby nie stawiać RouterProvidera.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { MentionText } from "@/components/mentions/MentionText";

describe("MentionText", () => {
  it("renders plain text unchanged with no links", () => {
    const { container } = render(<MentionText body="just a normal comment" />);
    expect(container.textContent).toBe("just a normal comment");
    expect(container.querySelector("a")).toBeNull();
  });

  it("turns a mention into a link carrying the canonical slug", () => {
    const { container } = render(<MentionText body="thanks @Alice for this" />);
    const link = container.querySelector("a[data-mention]");
    expect(link).not.toBeNull();
    // Slug do linku jest małymi literami; widoczny tekst zachowuje wielkość.
    expect(link?.getAttribute("data-mention")).toBe("alice");
    expect(link?.textContent).toBe("@Alice");
    // Reszta treści pozostaje tekstem wokół linku.
    expect(container.textContent).toBe("thanks @Alice for this");
  });

  it("does not linkify an email address", () => {
    const { container } = render(<MentionText body="reach me at user@example.com ok" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("reach me at user@example.com ok");
  });

  it("renders multiple mentions as separate links in order", () => {
    const { container } = render(<MentionText body="cc @jan and @anna-k" />);
    const links = Array.from(container.querySelectorAll("a[data-mention]"));
    expect(links.map((l) => l.getAttribute("data-mention"))).toEqual(["jan", "anna-k"]);
  });

  it("does not inject markup from hostile input (text stays escaped)", () => {
    const { container } = render(<MentionText body={"<img src=x onerror=alert(1)> @bob"} />);
    // Brak realnego <img> - wrogi tekst pozostał tekstem; tylko wzmianka to link.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[data-mention]")?.getAttribute("data-mention")).toBe("bob");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders nothing for empty body", () => {
    const { container } = render(<MentionText body="" />);
    expect(container.textContent).toBe("");
  });
});
