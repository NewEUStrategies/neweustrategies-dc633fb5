import { describe, expect, it, vi } from "vitest";
import { resolveReturnUrl } from "../resolveReturnUrl";

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: vi.fn(),
}));

import { getRequest } from "@tanstack/react-start/server";

function mockRequest(headers: Record<string, string | null>) {
  const map = new Map(Object.entries(headers).filter(([, v]) => v != null) as [string, string][]);
  vi.mocked(getRequest).mockReturnValue({
    headers: { get: (key: string) => map.get(key) ?? null },
  } as unknown as ReturnType<typeof getRequest>);
}

describe("resolveReturnUrl", () => {
  it("uses request origin when available", () => {
    mockRequest({ origin: "https://preview.example.com" });
    expect(resolveReturnUrl("/success")).toBe("https://preview.example.com/success");
  });

  it("falls back to forwarded host/proto", () => {
    mockRequest({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "neweuropeanstrategies.com",
    });
    expect(resolveReturnUrl("/profile/plan")).toBe("https://neweuropeanstrategies.com/profile/plan");
  });

  it("strips external host from client-provided absolute URL", () => {
    mockRequest({ origin: "https://neweuropeanstrategies.com" });
    expect(resolveReturnUrl("https://evil.example.com/steal")).toBe(
      "https://neweuropeanstrategies.com/steal",
    );
  });

  it("preserves query and hash while normalizing origin", () => {
    mockRequest({ origin: "https://neweuropeanstrategies.com" });
    expect(resolveReturnUrl("https://evil.example.com/path?x=1#tab")).toBe(
      "https://neweuropeanstrategies.com/path?x=1#tab",
    );
  });
});
