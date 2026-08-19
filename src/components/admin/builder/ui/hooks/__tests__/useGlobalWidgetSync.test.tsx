// Synchronizacja WIDGETÓW GLOBALNYCH edytowanych w builderze.
//
// Widget globalny stoi na wielu stronach. Renderer nakłada na instancję ŻYWY
// rekord z bazy (cache React Query), więc edycja instancji w panelu byłaby na
// kanwie NIEWIDOCZNA, dopóki nie trafi do bazy. Ten hak: (1) natychmiast
// wpisuje ładunek do cache (wszystkie instancje na kanwie odświeżają się od
// razu) i (2) wypycha go do bazy z opóźnieniem, co rozsyła zmianę na każdą
// stronę.
//
// Najważniejsza reguła i jednocześnie najłatwiejsza do zepsucia: BASELINE.
// Pierwsze zobaczenie węzła NIE wypycha niczego - inaczej samo otwarcie strony
// nadpisywałoby świeższą wersję globalnego widgetu starym zapisem z dokumentu.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";
import { globalWidgetKey } from "@/lib/builder/globalWidgets";
import { useGlobalWidgetSync } from "../useGlobalWidgetSync";

const push = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/builder/globalWidgets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/globalWidgets")>();
  return { ...actual, pushGlobalWidgetData: push };
});

const widget = (id: string, globalId: string | undefined, text: string): WidgetNode => ({
  id,
  kind: "widget",
  type: "text",
  content: { html_pl: text },
  ...(globalId ? { globalId } : {}),
});

function docWith(...widgets: WidgetNode[]): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [{ id: "c1", kind: "column", span: { desktop: 12 }, children: widgets }],
      },
    ],
  };
}

function docWithInner(...widgets: WidgetNode[]): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "i1",
            kind: "inner-section",
            columns: [{ id: "ic1", kind: "column", span: { desktop: 6 }, children: widgets }],
          },
        ],
      },
    ],
  };
}

function setup(initial: BuilderDocument) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(({ doc }: { doc: BuilderDocument }) => useGlobalWidgetSync(doc), {
    wrapper,
    initialProps: { doc: initial },
  });
  return { ...view, client };
}

beforeEach(() => {
  push.mockClear();
});

describe("useGlobalWidgetSync - baseline", () => {
  it("pierwsze zobaczenie instancji nie wypycha niczego", async () => {
    setup(docWith(widget("w1", "g1", "wersja z dokumentu")));
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });

  it("dokument bez widgetów globalnych nie robi nic", async () => {
    const { client } = setup(docWith(widget("w1", undefined, "zwykły")));
    await waitFor(() => expect(push).not.toHaveBeenCalled());
    expect(client.getQueryData(globalWidgetKey("g1"))).toBeUndefined();
  });

  it("ponowny render z tym samym dokumentem nie wypycha", async () => {
    const doc = docWith(widget("w1", "g1", "a"));
    const { rerender } = setup(doc);
    rerender({ doc: { ...doc } });
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });
});

describe("useGlobalWidgetSync - zmiana instancji", () => {
  it("zmiana treści wpisuje ładunek do cache NATYCHMIAST", () => {
    const { rerender, client } = setup(docWith(widget("w1", "g1", "przed")));
    rerender({ doc: docWith(widget("w1", "g1", "po")) });
    const cached = client.getQueryData<{ content: Record<string, unknown> }>(globalWidgetKey("g1"));
    // Bez tego kanwa pokazywałaby starą treść do zakończenia zapisu w bazie.
    expect(cached?.content.html_pl).toBe("po");
  });

  it("zmiana treści wypycha do bazy po opóźnieniu", async () => {
    const { rerender } = setup(docWith(widget("w1", "g1", "przed")));
    rerender({ doc: docWith(widget("w1", "g1", "po")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(push.mock.calls[0][0]).toBe("g1");
  });

  it("seria szybkich zmian wypycha JEDEN raz, z ostatnią wartością", async () => {
    const { rerender } = setup(docWith(widget("w1", "g1", "przed")));
    rerender({ doc: docWith(widget("w1", "g1", "krok 1")) });
    rerender({ doc: docWith(widget("w1", "g1", "krok 2")) });
    rerender({ doc: docWith(widget("w1", "g1", "krok 3")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Pisanie w panelu to dziesiątki renderów - bez zwijania każdy znak byłby
    // osobnym zapisem do bazy i rozsyłką na wszystkie strony.
    const payload = push.mock.calls[0][1] as { content: Record<string, unknown> };
    expect(payload.content.html_pl).toBe("krok 3");
  });

  it("dwa różne globalne widgety wypychają się osobno", async () => {
    const { rerender } = setup(docWith(widget("w1", "g1", "a"), widget("w2", "g2", "b")));
    rerender({ doc: docWith(widget("w1", "g1", "a2"), widget("w2", "g2", "b2")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(push.mock.calls.map((c) => c[0]).sort()).toEqual(["g1", "g2"]);
  });

  it("instancja w sekcji wewnętrznej też jest obserwowana", async () => {
    const { rerender } = setup(docWithInner(widget("w1", "g1", "przed")));
    rerender({ doc: docWithInner(widget("w1", "g1", "po")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("powrót do poprzedniej treści też jest zmianą (cofnięcie się rozsyła)", async () => {
    const { rerender } = setup(docWith(widget("w1", "g1", "a")));
    rerender({ doc: docWith(widget("w1", "g1", "b")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1), { timeout: 3000 });
    rerender({ doc: docWith(widget("w1", "g1", "a")) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const payload = push.mock.calls[1][1] as { content: Record<string, unknown> };
    expect(payload.content.html_pl).toBe("a");
  });
});

describe("useGlobalWidgetSync - usuwanie i odmontowanie", () => {
  it("usunięcie instancji i dodanie jej z powrotem zaczyna od nowego baseline", async () => {
    const { rerender } = setup(docWith(widget("w1", "g1", "a")));
    rerender({ doc: docWith() });
    rerender({ doc: docWith(widget("w1", "g1", "zupełnie inna treść")) });
    // Baseline usuniętego węzła jest czyszczony, więc jego powrót to znowu
    // „pierwsze zobaczenie” - a nie wypchnięcie treści z dokumentu na serwer.
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });

  it("odmontowanie domyka zapis w trakcie opóźnienia", () => {
    const { rerender, unmount } = setup(docWith(widget("w1", "g1", "przed")));
    rerender({ doc: docWith(widget("w1", "g1", "po")) });
    expect(push).not.toHaveBeenCalled();
    unmount();
    // Szybka edycja i natychmiastowe wyjście ze strony nie może zgubić zmiany.
    expect(push).toHaveBeenCalledTimes(1);
    const payload = push.mock.calls[0][1] as { content: Record<string, unknown> };
    expect(payload.content.html_pl).toBe("po");
  });

  it("odmontowanie bez zmian nie wypycha niczego", () => {
    const { unmount } = setup(docWith(widget("w1", "g1", "a")));
    unmount();
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["bez listy sekcji", { version: 1 }],
    ["z pustym wpisem sekcji", { version: 1, sections: [null] }],
    [
      "z pustym dzieckiem sekcji",
      { version: 1, sections: [{ id: "s1", kind: "section", children: [null] }] },
    ],
    [
      "z sekcją wewnętrzną bez kolumn",
      {
        version: 1,
        sections: [{ id: "s1", kind: "section", children: [{ id: "i1", kind: "inner-section" }] }],
      },
    ],
    [
      "z kolumną bez dzieci",
      {
        version: 1,
        sections: [{ id: "s1", kind: "section", children: [{ id: "c1", kind: "column" }] }],
      },
    ],
  ])("dokument %s nie wywala haka", async (_label, broken) => {
    // Hak biega po dokumencie SUROWYM (przed sanityzacją), bo obserwuje stan
    // z historii cofania - musi znosić każdy kształt, jaki tam trafi.
    setup(broken as unknown as BuilderDocument);
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });
});
