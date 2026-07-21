import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { BlocksDoc } from "@/lib/blocks/types";
import { BlocksTenantProvider, useBlocksTenantScope } from "../tenant";
import { BlocksRenderer } from "../../BlocksRenderer";

const doc = (blocks: BlocksDoc["blocks"]): BlocksDoc => ({ version: 1, blocks });

function ScopeProbe() {
  const { host } = useBlocksTenantScope();
  return <span data-testid="scope">{host ?? "ambient"}</span>;
}

describe("blocks tenant isolation boundary", () => {
  it("defaults to the ambient scope (host resolved from the request by RLS)", () => {
    const { getByTestId } = render(<ScopeProbe />);
    expect(getByTestId("scope").textContent).toBe("ambient");
  });

  it("BlocksTenantProvider exposes an explicit tenant host to the subtree", () => {
    const { getByTestId } = render(
      <BlocksTenantProvider host="acme.example.com">
        <ScopeProbe />
      </BlocksTenantProvider>,
    );
    expect(getByTestId("scope").textContent).toBe("acme.example.com");
  });

  it("BlocksRenderer stamps data-tenant-scope only when a host is supplied", () => {
    const blocks: BlocksDoc["blocks"] = [
      { id: "p", type: "paragraph", data: { html: "<p>Body</p>" } },
    ];

    const scoped = render(<BlocksRenderer doc={doc(blocks)} tenantHost="acme.example.com" />);
    const scopedArticle = scoped.container.querySelector("article");
    expect(scopedArticle?.getAttribute("data-tenant-scope")).toBe("acme.example.com");

    const ambient = render(<BlocksRenderer doc={doc(blocks)} />);
    const ambientArticle = ambient.container.querySelector("article");
    // No attribute in the ambient case -> identical SSR/client markup, no
    // hydration drift; isolation still enforced by RLS + x-tenant-host.
    expect(ambientArticle?.hasAttribute("data-tenant-scope")).toBe(false);
  });
});
