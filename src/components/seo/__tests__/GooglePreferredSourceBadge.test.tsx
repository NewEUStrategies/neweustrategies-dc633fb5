import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  GooglePreferredSourceBadge,
  googlePreferredSourceUrl,
} from "../GooglePreferredSourceBadge";

describe("GooglePreferredSourceBadge", () => {
  it("buduje adres panelu preferowanych źródeł", () => {
    expect(googlePreferredSourceUrl()).toBe(
      "https://google.com/preferences/source?q=neweuropeanstrategies.com",
    );
    expect(googlePreferredSourceUrl("example.com")).toContain("q=example.com");
  });

  it("renderuje bezpieczny odnośnik zewnętrzny", () => {
    render(<GooglePreferredSourceBadge />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", googlePreferredSourceUrl());
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
