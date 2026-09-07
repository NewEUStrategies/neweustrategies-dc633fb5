// RENDER SERWEROWY I HYDRATACJA PASKA PRZESTRZENI ROBOCZEJ.
//
// ── DLACZEGO OSOBNY PLIK I DLACZEGO `renderToString` ─────────────────────
// `render()` z testing-library wykonuje efekty PRZED powrotem, więc widzi stan
// PO korekcie - a wszystko, co tu jest dowodzone, dotyczy stanu PRZED nią:
// tego, co serwer wpisuje do HTML-a i co klient MUSI policzyć identycznie.
// Przy rozjeździe React 19 porzuca serwerowe poddrzewo i renderuje je od zera,
// czyli traci dokładnie ten HTML, po który jest SSR. Tę samą granicę opisuje
// nagłówek `components/__tests__/ssrRenderSafety.test.tsx`, na którym ten plik
// jest wzorowany.
//
// ── UCZCIWIE O TYM, CZEGO TU NIE MA ─────────────────────────────────────
// Dziś dok NIE DOCHODZI do serwera: `AuthProvider` startuje z `session = null`
// i rozstrzyga sesję w efekcie (`getSession()`), a `SiteChrome` bramkuje pasek
// na `user`. Serwer emituje więc pustkę, pierwszy render klienta też, a pasek
// pojawia się dopiero w późniejszym przejściu. Test NIE UDAJE, że jest inaczej -
// pierwszy blok to właśnie dowodzi.
//
// Pozostałe bloki renderują pasek z sesją OBECNĄ, i to nie jest sztuczna
// sytuacja: to jest kontrakt na dzień, w którym sesja zostanie zasiana
// z ciasteczka albo z odwodnionego zapytania (plauzybilny następny krok dla
// paska tylko-dla-członków). Wtedy trzy rzeczy z tego pliku stają się
// warunkiem poprawności, a nie higieną - i lepiej mieć je przypięte ZANIM ta
// zmiana nastąpi, niż debugować porzucone poddrzewo po fakcie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { DOCK_LAST_TOOL_KEY } from "@/lib/dock/dockState";

const h = vi.hoisted(() => ({
  uid: null as string | null,
  pathname: "/",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
    select({ location: { pathname: h.pathname } }),
  useNavigate: () => () => Promise.resolve(),
}));

vi.mock("@/components/atoms/AppLink", async () => ({
  AppLink: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/chat/chatDockBus", () => ({
  onOpenChatWindow: () => () => {},
  openChatWindow: () => {},
}));

vi.mock("@/lib/dock/prefetchDockData", () => ({ prefetchDockData: () => {} }));
vi.mock("../panelChunks", () => ({
  prefetchDockPanel: () => {},
  loadTodoPanel: () => Promise.resolve({ default: () => null }),
  loadNotesPanel: () => Promise.resolve({ default: () => null }),
  loadSavedPanel: () => Promise.resolve({ default: () => null }),
  loadCalendarPanel: () => Promise.resolve({ default: () => null }),
  loadChatSideDrawer: () => Promise.resolve({ default: () => null }),
}));
vi.mock("@/lib/dock/useTodos", () => ({ useOpenTodoCount: () => 0 }));
vi.mock("@/lib/chat/minimizedChats", () => ({
  MINIMIZED_VISIBLE_LIMIT: 2,
  useMinimizedChats: () => ({ minimized: [], requested: null }),
  minimizedChatsStore: { restore: () => {}, remove: () => {}, clearRequest: () => {} },
}));
vi.mock("@/components/mobile/bottomBar/LiveTabBadge", () => ({ LiveTabBadge: () => null }));

import { WorkspaceDock } from "../WorkspaceDock";

function tree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <WorkspaceDock />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  h.uid = null;
  h.pathname = "/";
  window.localStorage.clear();
  delete document.documentElement.dataset.mbb;
  document.documentElement.style.removeProperty("--mbb-space");
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.mbb;
  document.documentElement.style.removeProperty("--mbb-space");
});

describe("stan faktyczny: dok nie dochodzi do serwera", () => {
  it("bez sesji render serwerowy jest PUSTY", () => {
    expect(renderToString(tree())).toBe("");
  });
});

describe("pierwsze przejście z sesją obecną - determinizm HTML-a", () => {
  beforeEach(() => {
    h.uid = "user-me";
  });

  it("HTML nie niesie ŻADNEJ wartości z magazynu lokalnego", () => {
    // To jest naprawa odczytu `readLastTool` z ciała renderu - jedynego
    // takiego odczytu w całym `src/`. Serwer magazynu NIE MA, więc każda
    // wartość stąd byłaby czymś, czego klient nie może odtworzyć identycznie.
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "notes");
    const html = renderToString(tree());
    // Podświetlenie „ostatnio używane" jedzie atrybutem `data-recent`.
    expect(html).toContain('data-recent="false"');
    expect(html).not.toContain('data-recent="true"');
  });

  it("HTML nie niesie ani jednej wartości pochodnej od ZEGARA", () => {
    const html = renderToString(tree());
    const year = new Date().getUTCFullYear();
    // Pasek nie ma prawa wydrukować roku, daty ani znacznika czasu - to
    // rodzina rozjazdów, którą `ssrRenderSafety` trzyma dla reszty serwisu.
    expect(html).not.toContain(String(year));
    expect(html).not.toMatch(/\b1[6-9]\d{11}\b/);
  });

  it("żaden panel nie jest otwarty - wejście na stronę nie przysłania treści", () => {
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "saved");
    const html = renderToString(tree());
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("pasek NIE jest ukryty atrybutem, który musiałby przestawić JavaScript", () => {
    // Wariant „`data-enter=false` w znaczniku, `true` z efektu" zostawiał
    // pasek zepchnięty poza ekran, gdy JS nie dojechał (błąd hydratacji,
    // wyłączony skrypt). Wejście robi klatka CSS, więc w HTML-u nie ma
    // żadnego stanu do odwrócenia.
    const html = renderToString(tree());
    expect(html).toContain("wd-bar");
    expect(html).not.toContain("data-enter");
  });

  it("dwa rendery TEJ SAMEJ konfiguracji dają bit w bit ten sam HTML", () => {
    // Determinizm to warunek konieczny hydratacji bez rozjazdu. Gdyby
    // gdziekolwiek w drzewie siedział `Math.random()` albo `Date.now()`,
    // ta asercja padłaby jako pierwsza.
    expect(renderToString(tree())).toBe(renderToString(tree()));
  });

  it("skróty nawigacyjne wychodzą z serwera jako LINKI z adresem", () => {
    // Powierzchnia nawigacyjna musi być w HTML-u linkiem, żeby działała
    // przed hydratacją i była widoczna dla czytnika ekranu bez JS.
    const html = renderToString(tree());
    expect(html).toContain('href="/network"');
    expect(html).toContain('href="/club"');
  });
});

describe("HYDRATACJA: klient nie porzuca serwerowego poddrzewa", () => {
  beforeEach(() => {
    h.uid = "user-me";
  });

  it("hydratacja serwerowego HTML-a nie zgłasza rozjazdu", async () => {
    // React 19 raportuje rozjazd hydratacji przez `console.error`. Test
    // przechwytuje ten kanał i wymaga CISZY - to jest jedyny sposób
    // zobaczenia rozjazdu z poziomu testu jednostkowego.
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "notes");
    const html = renderToString(tree());

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    });

    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, tree());
    });

    spy.mockRestore();
    const mismatches = errors.filter((message) =>
      /hydrat|did not match|server (?:HTML|rendered)/i.test(message),
    );
    expect(mismatches, `rozjazd hydratacji:\n${mismatches.join("\n")}`).toEqual([]);

    // PO hydratacji podświetlenie z magazynu MOŻE się już pojawić - efekty
    // wykonały się i to jest właściwe miejsce na tę wartość.
    expect(container.querySelector('[data-dock-tab="notes"][data-recent="true"]')).not.toBeNull();

    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });

  it("odmontowanie sprząta rezerwację, którą pasek postawił na <html>", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree());
    document.body.appendChild(container);

    let root: ReturnType<typeof hydrateRoot> | null = null;
    await act(async () => {
      root = hydrateRoot(container, tree());
    });

    // Przejście na /admin odmontowuje pasek. Zostawione dopełnienie strony
    // byłoby martwym pasem na każdej podstronie panelu.
    await act(async () => {
      root?.unmount();
    });
    expect(document.documentElement.dataset.mbb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
    container.remove();
  });
});
