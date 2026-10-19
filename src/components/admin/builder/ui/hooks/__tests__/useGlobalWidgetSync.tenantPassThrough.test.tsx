// AUTOZAPIS WIDGETU GLOBALNEGO NIESIE NAJEMCĘ Z SESJI (od 2026-10-18).
//
// `pushGlobalWidgetData` domyka `.eq("tenant_id")` obok `.eq("id")` i bez
// najemcy w ogóle nie zapisuje. Najemcę podaje mu WYŁĄCZNIE ten hak - czyta
// go z `useCurrentTenantId` (ta sama droga co lista palety), nigdy z ładunku
// widgetu. Ten plik dowodzi, że:
//   1. opóźniony zapis dostaje najemcę z sesji,
//   2. bierze wartość z CHWILI zapisu (zmiana najemcy w oknie opóźnienia nie
//      wysyła zapisu ze starym najemcą),
//   3. zrzut przy odmontowaniu też go niesie.
//
// Granice: atrapa `pushGlobalWidgetData` (jej zapytanie ma własny test
// w globalWidgets.test.ts) i atrapa hooka najemcy. Opóźnienie 800 ms
// przewijamy sztucznym zegarem zamiast czekać.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";
import type { GlobalWidgetData } from "@/lib/builder/globalWidgets";

const h = vi.hoisted(() => ({
  tenantId: null as string | null,
  push: vi.fn(
    async (_id: string, _data: GlobalWidgetData, _tenantId: string | null): Promise<boolean> =>
      true,
  ),
}));

vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/globalWidgets")>();
  return { ...actual, pushGlobalWidgetData: h.push };
});

vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => h.tenantId,
}));

import { useGlobalWidgetSync } from "../useGlobalWidgetSync";

const TENANT = "11111111-1111-4111-8111-111111111111";
const INNY_TENANT = "22222222-2222-4222-8222-222222222222";

const instancja = (text: string): WidgetNode => ({
  id: "w1",
  kind: "widget",
  type: "text",
  content: { html_pl: text },
  globalId: "g1",
});

const dokument = (w: WidgetNode): BuilderDocument => ({
  version: 1,
  sections: [
    {
      id: "s1",
      kind: "section",
      children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: [w] }],
    },
  ],
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ doc }: { doc: BuilderDocument }) => useGlobalWidgetSync(doc), {
    wrapper,
    initialProps: { doc: dokument(instancja("<p>przed</p>")) },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.tenantId = TENANT;
  h.push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGlobalWidgetSync - najemca w autozapisie", () => {
  it("opóźniony zapis dostaje najemcę z sesji obok id i ładunku", () => {
    const view = setup();

    view.rerender({ doc: dokument(instancja("<p>po</p>")) });
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(h.push).toHaveBeenCalledExactlyOnceWith(
      "g1",
      { type: "text", content: { html_pl: "<p>po</p>" } },
      TENANT,
    );
  });

  it("zmiana najemcy w oknie opóźnienia - zapis idzie z BIEŻĄCYM najemcą", () => {
    const view = setup();

    view.rerender({ doc: dokument(instancja("<p>po</p>")) });
    h.tenantId = INNY_TENANT;
    view.rerender({ doc: dokument(instancja("<p>po</p>")) });
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0]?.[2]).toBe(INNY_TENANT);
  });

  it("zrzut przy odmontowaniu niesie najemcę, a nieznany najemca idzie jako null", () => {
    h.tenantId = null;
    const view = setup();

    view.rerender({ doc: dokument(instancja("<p>szybka zmiana</p>")) });
    view.unmount();

    // Odmowę zapisu bez najemcy podejmuje `pushGlobalWidgetData` - hak nie
    // wymyśla najemcy z ładunku ani z identyfikatora globala.
    expect(h.push).toHaveBeenCalledExactlyOnceWith(
      "g1",
      { type: "text", content: { html_pl: "<p>szybka zmiana</p>" } },
      null,
    );
  });
});
