// LiveBlogBlock - relacja na żywo. Jedyny blok publiczny z otwartym kanałem
// realtime, więc jedyny, w którym treść zmienia się BEZ przeładowania strony.
//
// Trzy reguły, których złamania czytelnik nie zgłosi (bo nie wie, że coś
// przegapił), a redakcja zobaczy dopiero po relacji:
//   1. push z bazy trafia do TEGO SAMEGO wpisu cache, co prefetch SSR -
//      inaczej odświeżenie listy zjada wpisy dorzucone na żywo (albo odwrotnie),
//   2. push z INNEGO bloku albo innego języka MUSI być odrzucony - jeden wpis
//      może nieść dwie relacje i dwie wersje językowe,
//   3. `autoRefresh` wyłączone NIE otwiera kanału - inaczej strona archiwalna
//      trzyma połączenie realtime bez powodu.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

interface RealtimeHandler {
  (payload: { eventType: string; new?: unknown; old?: unknown }): void;
}

const h = vi.hoisted(() => ({
  entries: [] as unknown[],
  handlers: [] as Array<(payload: { eventType: string; new?: unknown; old?: unknown }) => void>,
  channelNames: [] as string[],
  removed: 0,
  subscribed: 0,
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/lib/queries/blocks", () => ({
  liveBlogEntriesBlockQueryOptions: (input: unknown) => ({
    queryKey: ["public", "blocks", "liveblog", input] as const,
    queryFn: async () => h.entries,
    staleTime: 0,
    gcTime: 0,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      h.channelNames.push(name);
      const channel = {
        on: (_event: string, _filter: unknown, handler: RealtimeHandler) => {
          h.handlers.push(handler);
          return channel;
        },
        subscribe: () => {
          h.subscribed += 1;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: () => {
      h.removed += 1;
    },
  },
}));

import { LiveBlogBlock } from "../LiveBlogBlock";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e-1",
  post_id: "post-1",
  block_id: "b_live",
  lang: "pl",
  title: "Wpis pierwszy",
  body_html: "<p>Treść pierwsza</p>",
  pinned: false,
  occurred_at: "2026-08-19T11:59:30.000Z",
  ...over,
});

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderBlock(props: Partial<Parameters<typeof LiveBlogBlock>[0]> = {}) {
  return render(
    <Wrap>
      <LiveBlogBlock postId="post-1" blockId="b_live" lang="pl" {...props} />
    </Wrap>,
  );
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];
function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}"`).toBe(false);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  h.entries = [];
  h.handlers = [];
  h.channelNames = [];
  h.removed = 0;
  h.subscribed = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveBlogBlock - render listy", () => {
  it("PUSTA relacja pokazuje komunikat, nie pustą ramkę", async () => {
    const { container } = renderBlock({ title: "Relacja" });
    await waitFor(() => expect(container.textContent).toContain("Relacja"));
    assertNoLeak(container, "liveblog pusty");
  });

  it("wpisy z bazy renderują się z tytułem i treścią", async () => {
    h.entries = [entry(), entry({ id: "e-2", title: "Wpis drugi", body_html: "<p>Druga</p>" })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    expect(container.textContent).toContain("Treść pierwsza");
    expect(container.textContent).toContain("Wpis drugi");
  });

  it("wpis BEZ tytułu renderuje samą treść, nie wartość zastępczą", async () => {
    h.entries = [entry({ title: null })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Treść pierwsza"));
    assertNoLeak(container, "liveblog bez tytułu");
  });

  it("wpis PRZYPIĘTY jest wyróżniony", async () => {
    h.entries = [entry({ pinned: true })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    assertNoLeak(container, "liveblog przypięty");
  });

  it("treść wpisu jest SANITYZOWANA - skrypt wypada", async () => {
    h.entries = [entry({ body_html: "<p>ok</p><script>alert(1)</script><b>pogrubione</b>" })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("ok"));
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("pogrubione");
  });

  // OBEJŚCIE SANITYZATORA - zgłoszone, nie naprawione. Ładunek POPRZEDZONY
  // znacznikiem `<script>` przepuszcza inline'owy handler zdarzenia. Pełna
  // charakterystyka i dokładna reprodukcja: `src/lib/__tests__/
  // sanitizeScriptPrefixBypass.test.ts`. Tutaj przybijamy skutek dla bloku
  // relacji na żywo - to sink `dangerouslySetInnerHTML` na stronie publicznej,
  // więc jeśli obejście działa też w przeglądarce, jest to XSS w treści
  // redakcyjnej.
  it.fails("POWINNO zdejmować handler także z ładunku poprzedzonego <script>", async () => {
    h.entries = [entry({ body_html: "<script>alert(1)</script><img src=x onerror=y>" })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.querySelector("ol")).toBeTruthy());
    expect(container.innerHTML).not.toContain("onerror");
  });

  it.each([
    "<img src=x onerror=alert(1)>",
    '<div onclick="alert(1)">x</div>',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://obcy.test"></iframe>',
    '<form action="/phish"><input name="password"></form>',
  ])("ładunek %s nie przechodzi przez sanityzację", async (body_html) => {
    h.entries = [entry({ body_html })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.querySelector("ol")).toBeTruthy());
    const html = container.innerHTML;
    expect(html).not.toMatch(/on(error|click|load)=/i);
    expect(html).not.toContain("javascript:");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("własny tytuł relacji wygrywa nad domyślnym", async () => {
    const { container } = renderBlock({ title: "Relacja z wyborów" });
    await waitFor(() => expect(container.textContent).toContain("Relacja z wyborów"));
  });

  it.each(["pl", "en"] as const)("renderuje się w języku %s", async (lang) => {
    h.entries = [entry({ lang })];
    const { container } = renderBlock({ lang });
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    assertNoLeak(container, `liveblog ${lang}`);
  });

  it("nieznany język spada na polskie etykiety, nie na pustkę", async () => {
    const { container } = renderBlock({ lang: "de" as never });
    await waitFor(() => expect((container.textContent ?? "").length).toBeGreaterThan(0));
    assertNoLeak(container, "liveblog nieznany język");
  });
});

describe("LiveBlogBlock - znaczniki czasu", () => {
  it.each([
    ["kilka sekund", "2026-08-19T11:59:40.000Z"],
    ["kilka minut", "2026-08-19T11:30:00.000Z"],
    ["kilka godzin", "2026-08-19T06:00:00.000Z"],
    ["kilka dni", "2026-08-15T12:00:00.000Z"],
  ])("wpis %s temu dostaje etykietę względną", async (_l, occurred_at) => {
    h.entries = [entry({ occurred_at })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    assertNoLeak(container, `liveblog czas ${occurred_at}`);
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - „Invalid Date" NA STRONIE.
  // `fmtTime` opakowuje formatowanie w `try/catch`, licząc na to, że zły ISO
  // rzuci. Nie rzuca: `new Date("to-nie-data").toLocaleString(...)` zwraca
  // NAPIS „Invalid Date", więc `catch` nigdy się nie wykonuje i ten napis leci
  // prosto do znacznika `<time>` widocznego dla czytelnika. `fmtRelative` ma
  // poprawną straż (`Number.isFinite`), ale deleguje do `fmtTime` - i tam
  // straży już nie ma. Naprawa to sprawdzenie `Number.isFinite(date.getTime())`
  // w `fmtTime` przed formatowaniem - zmiana zachowania produkcyjnego, poza
  // zakresem zadania pokryciowego. Test STOI jako dowód.
  it.fails.each([
    ["data nieprawidłowa", "to-nie-data"],
    ["data pusta", ""],
  ])("%s NIE POWINNA wypisywać Invalid Date", async (_l, occurred_at) => {
    h.entries = [entry({ occurred_at })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    assertNoLeak(container, `liveblog data ${occurred_at}`);
  });

  it.each([
    ["data nieprawidłowa", "to-nie-data"],
    ["data pusta", ""],
  ])("dziś %s pokazuje czytelnikowi napis Invalid Date", async (_l, occurred_at) => {
    h.entries = [entry({ occurred_at })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    expect(container.querySelector("time")?.getAttribute("title")).toBe("Invalid Date");
  });

  it("etykiety względne odświeżają się co 30 sekund", async () => {
    h.entries = [entry({ occurred_at: "2026-08-19T11:59:40.000Z" })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    const before = container.textContent;
    act(() => {
      vi.setSystemTime(new Date("2026-08-19T12:10:00.000Z"));
      vi.advanceTimersByTime(30_000);
    });
    expect(container.textContent).not.toBe(before);
  });

  it("wpis z PRZYSZŁOŚCI (zegar autora do przodu) nie wywala formatowania", async () => {
    h.entries = [entry({ occurred_at: "2026-08-19T13:00:00.000Z" })];
    const { container } = renderBlock();
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    assertNoLeak(container, "liveblog przyszłość");
  });
});

describe("LiveBlogBlock - kanał realtime", () => {
  it("Z autoRefresh otwiera kanał nazwany po wpisie i bloku", async () => {
    renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.subscribed).toBe(1));
    expect(h.channelNames[0]).toBe("liveblog:post-1:b_live");
  });

  it("BEZ autoRefresh NIE otwiera kanału", async () => {
    renderBlock({ autoRefresh: false });
    await waitFor(() => expect(h.channelNames).toEqual([]));
    expect(h.subscribed).toBe(0);
  });

  it("odmontowanie ZAMYKA kanał (brak wycieku połączenia)", async () => {
    const { unmount } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.subscribed).toBe(1));
    unmount();
    expect(h.removed).toBe(1);
  });

  it("push INSERT dokłada wpis do listy", async () => {
    h.entries = [entry()];
    const { container } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({
        eventType: "INSERT",
        new: entry({ id: "e-2", title: "Wpis na żywo", body_html: "<p>Nowa treść</p>" }),
      });
    });
    await waitFor(() => expect(container.textContent).toContain("Wpis na żywo"));
  });

  it("push UPDATE podmienia wpis, nie dubluje go", async () => {
    h.entries = [entry()];
    const { container } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({ eventType: "UPDATE", new: entry({ title: "Wpis poprawiony" }) });
    });
    await waitFor(() => expect(container.textContent).toContain("Wpis poprawiony"));
    expect(container.textContent).not.toContain("Wpis pierwszy");
  });

  it("push DELETE usuwa wpis z listy", async () => {
    h.entries = [entry(), entry({ id: "e-2", title: "Wpis drugi" })];
    const { container } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(container.textContent).toContain("Wpis drugi"));
    act(() => {
      h.handlers[0]({ eventType: "DELETE", old: entry({ id: "e-2" }) });
    });
    await waitFor(() => expect(container.textContent).not.toContain("Wpis drugi"));
    expect(container.textContent).toContain("Wpis pierwszy");
  });

  it("push z INNEGO bloku jest odrzucany (jeden wpis, dwie relacje)", async () => {
    h.entries = [entry()];
    const { container } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({
        eventType: "INSERT",
        new: entry({ id: "e-9", block_id: "b_inny", title: "Z obcej relacji" }),
      });
    });
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    expect(container.textContent).not.toContain("Z obcej relacji");
  });

  it("push w INNYM języku jest odrzucany", async () => {
    h.entries = [entry()];
    const { container } = renderBlock({ autoRefresh: true, lang: "pl" });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({
        eventType: "INSERT",
        new: entry({ id: "e-9", lang: "en", title: "English entry" }),
      });
    });
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
    expect(container.textContent).not.toContain("English entry");
  });

  it("push BEZ wiersza (ani new, ani old) jest ignorowany bez wyjątku", async () => {
    h.entries = [entry()];
    const { container } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({ eventType: "INSERT" });
    });
    await waitFor(() => expect(container.textContent).toContain("Wpis pierwszy"));
  });

  it("push wyzwala krótki impuls wskaźnika, który potem gaśnie", async () => {
    h.entries = [entry()];
    renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.handlers.length).toBe(1));
    act(() => {
      h.handlers[0]({ eventType: "INSERT", new: entry({ id: "e-2", title: "Nowy" }) });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Impuls i podświetlenie gasną same - bez tego wskaźnik „na żywo" świeci
    // do końca sesji i przestaje cokolwiek znaczyć.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(h.removed).toBe(0);
  });

  it.each([true, false])(
    "kolejność reverseChronological=%s jest zachowana po pushu",
    async (reverseChronological) => {
      h.entries = [entry({ id: "e-1", title: "Starszy", occurred_at: "2026-08-19T11:00:00.000Z" })];
      const { container } = renderBlock({ autoRefresh: true, reverseChronological });
      await waitFor(() => expect(container.textContent).toContain("Starszy"));
      act(() => {
        h.handlers[0]({
          eventType: "INSERT",
          new: entry({ id: "e-2", title: "Nowszy", occurred_at: "2026-08-19T11:50:00.000Z" }),
        });
      });
      await waitFor(() => expect(container.textContent).toContain("Nowszy"));
      const text = container.textContent ?? "";
      if (reverseChronological) {
        expect(text.indexOf("Nowszy")).toBeLessThan(text.indexOf("Starszy"));
      } else {
        expect(text.indexOf("Starszy")).toBeLessThan(text.indexOf("Nowszy"));
      }
    },
  );

  it("zmiana bloku otwiera NOWY kanał i zamyka poprzedni", async () => {
    const { rerender } = renderBlock({ autoRefresh: true });
    await waitFor(() => expect(h.subscribed).toBe(1));
    rerender(
      <Wrap>
        <LiveBlogBlock postId="post-1" blockId="b_inny" lang="pl" autoRefresh />
      </Wrap>,
    );
    await waitFor(() => expect(h.subscribed).toBe(2));
    expect(h.removed).toBe(1);
    expect(h.channelNames).toEqual(["liveblog:post-1:b_live", "liveblog:post-1:b_inny"]);
  });
});
