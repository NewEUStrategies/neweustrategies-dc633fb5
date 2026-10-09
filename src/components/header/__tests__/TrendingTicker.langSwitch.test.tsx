// Pasek „Na czasie" przy MIĘKKIEJ zmianie języka (P3.7b, T4b).
//
// Od P3.7b klucz paska niesie język, a wpis - tytuł wyłącznie w tym języku
// (`headerTickerQuery.ts`). Zmiana języka bez przeładowania to więc NOWY klucz
// bez danych. Bez `placeholderData: keepPreviousData` pasek wracałby wtedy do
// rezerwy wysokości (pusty pas), a po odpowiedzi znów do treści - mignięcie
// i przesunięcie strony pod nagłówkiem. Ten test montuje PRAWDZIWE opcje
// zapytania (podmienione są tylko server functions) i trzyma odpowiedź dla EN
// w zawieszeniu, żeby zobaczyć stan pośredni.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

interface Row {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  href: string;
  cover_image_url: null;
  published_at: null;
  parent_page_id: string;
  views_count: number;
  author_display_name: null;
  author_avatar_url: null;
}

const h = vi.hoisted(() => ({
  calls: [] as Array<{ resolve: (rows: unknown) => void }>,
}));

vi.mock("@/lib/views/postViews.functions", () => ({
  getTrendingPosts: () =>
    new Promise((resolve) => {
      h.calls.push({ resolve });
    }),
  getTickerPosts: () => Promise.resolve([]),
}));

// Punkt ciszy bramki ruchu wyłączony - pasek stoi (bez rotacji porcji).
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

const { TrendingTicker } = await import("@/components/header/TrendingTicker");

function row(id: string): Row {
  return {
    id,
    slug: id,
    title_pl: `Wpis ${id}`,
    title_en: `Post ${id}`,
    href: `/analizy/${id}`,
    cover_image_url: null,
    published_at: null,
    parent_page_id: "strona",
    views_count: 0,
    author_display_name: null,
    author_avatar_url: null,
  };
}

afterEach(async () => {
  cleanup();
  h.calls = [];
  const i18n = (await import("@/lib/i18n")).default;
  if (i18n.language !== "pl") {
    await act(async () => {
      await i18n.changeLanguage("pl");
    });
  }
});

describe("miękka zmiana języka paska (P3.7b, T4b)", () => {
  it("pasek NIE zapada się do rezerwy: poprzedni wpis stoi, aż przyjdą tytuły EN", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TrendingTicker mode="fade" />
      </QueryClientProvider>,
    );
    // Zimny start PL: rezerwa (ta sama geometria co gotowy pasek), potem treść.
    expect(screen.getByTestId("trending-ticker-reserve")).toBeTruthy();
    await waitFor(() => expect(h.calls).toHaveLength(1));
    await act(async () => {
      h.calls[0].resolve([row("a"), row("b")]);
    });
    expect(await screen.findByRole("link", { name: /Wpis a/ })).toBeTruthy();

    // Zmiana języka bez przeładowania: nowy klucz `en`, odpowiedź w zawieszeniu.
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    await waitFor(() => expect(h.calls).toHaveLength(2));
    // Stan pośredni: wciąż gotowy pasek z poprzednimi wpisami (tytuł PL jako
    // zejście `itemTitle`), żadnej rezerwy - zero przesunięcia pod nagłówkiem.
    expect(screen.queryByTestId("trending-ticker-reserve")).toBeNull();
    expect(screen.getByTestId("trending-ticker")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis a/ })).toBeTruthy();

    await act(async () => {
      h.calls[1].resolve([row("a"), row("b")]);
    });
    expect(await screen.findByRole("link", { name: /Post a/ })).toBeTruthy();
    expect(screen.queryByTestId("trending-ticker-reserve")).toBeNull();
    // Wpis EN niesie wyłącznie tytuł EN (projekcja na język klucza).
    const en = client
      .getQueryCache()
      .getAll()
      .find((q) => q.queryKey.includes("en"));
    expect(en?.state.data).toEqual([
      expect.not.objectContaining({ title_pl: expect.anything() }),
      expect.not.objectContaining({ title_pl: expect.anything() }),
    ]);
  });
});
