import { describe, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select","eq","is","in","not","order","range","limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k:string,o?:{defaultValue?:string})=>o?.defaultValue??k, i18n: { language: "pl" } }) }));

describe("d", () => {
  it("dumps", () => {
    const node: WidgetNode = { id:"h", kind:"widget", type:"heading", content:{ text_pl:"T", subtitle_pl:"S" } };
    const qc = new QueryClient({ defaultOptions:{ queries:{ retry:false }}});
    const { container } = render(<QueryClientProvider client={qc}><WidgetView node={node} lang="pl" device="desktop" /></QueryClientProvider>);
    const h2 = container.querySelector("h2");
    console.log("H2 outer:", h2?.outerHTML);
    console.log("H2 style attr:", h2?.getAttribute("style"));
  });
});
