// PRZESTRZEŃ ROBOCZA CZŁONKA - do tej pory 0% pokrycia komponentu, przy
// czterech regułach, których nie widzi NIC innego w repozytorium:
//
//   1. ROZGRZEWANIE NA ZAMIAR. Najechanie kursorem, wejście focusem albo
//      dotknięcie zakładki MUSI pobrać paczkę panelu I jego dane, ZANIM
//      padnie klik. To jest cała odpowiedź na „okienka otwierają się za
//      wolno" - bez tego sieć startuje po kliknięciu, szeregowo.
//   2. ZAPAMIĘTANE NARZĘDZIE PRZEŻYWA MONTAŻ. Poprzednia wersja kasowała
//      zapisany klucz w efekcie montażu (`state.open` jest wtedy `null`),
//      więc podświetlenie „ostatnio używane" nie działało ANI RAZU.
//   3. DWIE OBIETNICE, DWA ELEMENTY. Skrót nawigacyjny to `<a href>`
//      z `aria-current`, zakładka panelu to `<button>` z `aria-expanded`
//      i `aria-controls`. Wcześniej wszystko było przyciskiem z
//      `aria-pressed`, więc pozycji „Sieć" nie dało się otworzyć w nowej
//      karcie ani skopiować.
//   4. OGNISKO UWAGI WRACA NA ZAKŁADKĘ. Zamknięcie panelu niszczyło
//      zogniskowany węzeł, `activeElement` spadał na `<body>`, a następny
//      Tab startował od góry dokumentu (WCAG 2.4.3).
//
// Recepta na atrapy jest wzięta z `chat/__tests__/ChatDock.test.tsx` - to
// najbliższy istniejący test powierzchni okienkowej w tym repozytorium.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { dockPl } from "@/lib/i18n-dock";
import { DOCK_LAST_TOOL_KEY } from "@/lib/dock/dockState";
import { DOCK_RESERVE_KEY } from "@/lib/dock/reservedSpace";
import { axeViolations, summarize } from "@/test/axe";

type ChatListener = (event: { conversationId: string }) => void;

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  pathname: "/",
  listeners: [] as ChatListener[],
  prefetchedPanels: [] as string[],
  prefetchedData: [] as string[],
  openTodos: 0,
  minimized: [] as { id: string; name: string; avatarUrl: string | null }[],
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

// `AppLink` czyta kontekst routera (`useRouter`), którego goły render nie ma.
// Podmieniamy na wspólną atrapę repozytorium, żeby asercje widziały PRAWDZIWY
// `href` - to jest cała rzecz, którą dowodzimy o skrótach nawigacyjnych.
vi.mock("@/components/atoms/AppLink", async () => ({
  AppLink: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/chat/chatDockBus", () => ({
  onOpenChatWindow: (listener: ChatListener) => {
    h.listeners.push(listener);
    return () => {
      h.listeners = h.listeners.filter((l) => l !== listener);
    };
  },
  openChatWindow: (event: { conversationId: string }) => {
    for (const listener of h.listeners) listener(event);
  },
}));

// Rozgrzewanie: atrapa ZAPISUJE wywołania, bo to jedyny sposób udowodnienia,
// że pobranie startuje na ZAMIAR, a nie na kliknięciu.
vi.mock("../panelChunks", () => ({
  prefetchDockPanel: (tool: string) => void h.prefetchedPanels.push(tool),
  loadTodoPanel: () => Promise.resolve({ default: () => <div data-testid="panel-todos" /> }),
  loadNotesPanel: () => Promise.resolve({ default: () => <div data-testid="panel-notes" /> }),
  loadSavedPanel: () => Promise.resolve({ default: () => <div data-testid="panel-saved" /> }),
  loadCalendarPanel: () => Promise.resolve({ default: () => <div data-testid="panel-calendar" /> }),
  loadChatSideDrawer: () =>
    Promise.resolve({
      default: (props: { openRequest?: { conversationId: string } | null }) => (
        <div data-testid="panel-chat" data-conversation={props.openRequest?.conversationId ?? ""} />
      ),
    }),
}));

vi.mock("@/lib/dock/prefetchDockData", () => ({
  prefetchDockData: (_client: unknown, tool: string) => void h.prefetchedData.push(tool),
}));

vi.mock("@/lib/dock/useTodos", () => ({ useOpenTodoCount: () => h.openTodos }));

vi.mock("@/lib/chat/minimizedChats", () => ({
  MINIMIZED_VISIBLE_LIMIT: 2,
  useMinimizedChats: () => ({ minimized: h.minimized, requested: null }),
  minimizedChatsStore: { restore: vi.fn(), remove: vi.fn(), clearRequest: vi.fn() },
}));

// Żywe liczniki mają własne testy; tutaj liczy się tylko to, że nie sięgają
// po sieć podczas renderu paska.
vi.mock("@/components/mobile/bottomBar/LiveTabBadge", () => ({
  LiveTabBadge: () => null,
}));

import { WorkspaceDock } from "../WorkspaceDock";
import { openChatWindow } from "@/lib/chat/chatDockBus";

function renderDock() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceDock />
    </QueryClientProvider>,
  );
}

/** Zakładka po jej identyfikatorze - stabilniejsze niż nazwa dostępna. */
function tab(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-dock-tab="${id}"]`);
  if (!node) throw new Error(`brak zakładki ${id}`);
  return node;
}

/** Wszystkie węzły danej zakładki (rząd mobilny I desktopowy są w DOM). */
function tabs(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-dock-tab="${id}"]`));
}

// happy-dom nie liczy układu, więc `offsetHeight` jest wszędzie zerem, a cała
// ścieżka rezerwacji (publikacja `--mbb-space`, znacznik `data-mbb`, zapis
// wysokości) nigdy by się nie wykonała. Podstawiamy więc wysokość TYLKO dla
// mierzonego węzła paska - 36 px, czyli realny rząd wielkości - i wracamy
// z tym do stanu wyjściowego po każdym teście.
const originalObserver = globalThis.ResizeObserver;
const originalHeight = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  "offsetHeight",
);
const MEASURED_BAR_HEIGHT = 36;

beforeEach(() => {
  h.uid = "user-me";
  h.pathname = "/";
  h.listeners = [];
  h.prefetchedPanels = [];
  h.prefetchedData = [];
  h.openTodos = 0;
  h.minimized = [];
  window.localStorage.clear();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).hasAttribute("data-workspace-dock") ? MEASURED_BAR_HEIGHT : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  globalThis.ResizeObserver = originalObserver;
  if (originalHeight) {
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", originalHeight);
  }
  delete document.documentElement.dataset.mbb;
  delete document.documentElement.dataset.mbbOwner;
  document.documentElement.style.removeProperty("--mbb-space");
});

describe("bramka gościa", () => {
  it("gość nie dostaje paska, nawet wstawiony poza powłokę", () => {
    h.uid = null;
    const { container } = renderDock();
    expect(container.firstChild).toBeNull();
  });
});

describe('ROZGRZEWANIE NA ZAMIAR - odpowiedź na „okienka otwierają się za wolno"', () => {
  it("najechanie kursorem pobiera paczkę I dane, bez kliknięcia", () => {
    renderDock();
    fireEvent.pointerEnter(tab("saved"));

    expect(h.prefetchedPanels).toContain("saved");
    expect(h.prefetchedData).toContain("saved");
    // Panel NIE jest otwarty - rozgrzanie to nie otwarcie.
    expect(screen.queryByTestId("panel-saved")).toBeNull();
  });

  it("wejście FOCUSEM rozgrzewa tak samo - klawiatura nie ma hoveru", () => {
    renderDock();
    fireEvent.focus(tab("calendar"));
    expect(h.prefetchedPanels).toContain("calendar");
    expect(h.prefetchedData).toContain("calendar");
  });

  it("`pointerdown` rozgrzewa - na dotyku hoveru NIE MA", () => {
    // To jest jedyna ścieżka, która działa na telefonie: `pointerdown`
    // wyprzedza `click` o czas przytrzymania palca.
    renderDock();
    fireEvent.pointerDown(tab("notes"));
    expect(h.prefetchedPanels).toContain("notes");
  });

  it("zakładka czatu rozgrzewa paczkę skrzynki", () => {
    renderDock();
    fireEvent.pointerEnter(tab("chats"));
    expect(h.prefetchedPanels).toContain("chat");
  });

  it("SKRÓT NAWIGACYJNY nie woła rozgrzewania paneli - ma własny mechanizm routera", () => {
    renderDock();
    fireEvent.pointerEnter(tab("network"));
    expect(h.prefetchedPanels).toHaveLength(0);
    expect(h.prefetchedData).toHaveLength(0);
  });
});

describe("otwieranie i zamykanie paneli", () => {
  it("kliknięcie zakładki otwiera panel, a drugie kliknięcie go zamyka", async () => {
    renderDock();

    fireEvent.click(tab("todos"));
    expect(await screen.findByTestId("panel-todos")).toBeTruthy();

    fireEvent.click(tab("todos"));
    // Wyjście trzyma węzeł chwilę w drzewie (animacja), więc czekamy na zejście.
    await waitFor(() => expect(screen.queryByTestId("panel-todos")).toBeNull());
  });

  it("JEDEN panel naraz - otwarcie drugiego podmienia pierwszy", async () => {
    renderDock();
    fireEvent.click(tab("todos"));
    expect(await screen.findByTestId("panel-todos")).toBeTruthy();

    fireEvent.click(tab("notes"));
    expect(await screen.findByTestId("panel-notes")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("panel-todos")).toBeNull());
  });

  it("magistrala otwiera skrzynkę czatu ZE WSKAZANĄ rozmową", async () => {
    renderDock();
    await act(async () => {
      openChatWindow({ conversationId: "conv-a" });
    });
    const drawer = await screen.findByTestId("panel-chat");
    expect(drawer.getAttribute("data-conversation")).toBe("conv-a");
  });
});

describe("ZAPAMIĘTANE NARZĘDZIE - regresja, która nie działała ani raz", () => {
  it("wartość z magazynu PRZEŻYWA montaż paska", async () => {
    // To jest dokładna regresja: efekt montażu wołał
    // `writeLastTool(storage, null)`, czyli `removeItem`, więc każde wejście
    // na stronę czyściło klucz, który miał przetrwać między wizytami.
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "notes");
    renderDock();
    await waitFor(() => expect(window.localStorage.getItem(DOCK_LAST_TOOL_KEY)).toBe("notes"));
  });

  it("zapamiętane narzędzie jest PODŚWIETLONE, ale panel zostaje zamknięty", async () => {
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "notes");
    renderDock();

    await waitFor(() =>
      expect(tabs("notes").some((node) => node.dataset.recent === "true")).toBe(true),
    );
    // Wejście na stronę NIE MOŻE przysłonić treści panelem.
    expect(screen.queryByTestId("panel-notes")).toBeNull();
  });

  it("otwarcie zapisuje narzędzie, a zamknięcie klucz USUWA", async () => {
    renderDock();

    fireEvent.click(tab("saved"));
    await waitFor(() => expect(window.localStorage.getItem(DOCK_LAST_TOOL_KEY)).toBe("saved"));

    fireEvent.click(tab("saved"));
    await waitFor(() => expect(window.localStorage.getItem(DOCK_LAST_TOOL_KEY)).toBeNull());
  });

  it("uszkodzona wartość w magazynie nie podświetla niczego i nie rzuca", async () => {
    window.localStorage.setItem(DOCK_LAST_TOOL_KEY, "nie-narzedzie");
    renderDock();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-dock-tab]").length).toBeGreaterThan(0),
    );
    expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-dock-tab]")).some(
        (node) => node.dataset.recent === "true",
      ),
    ).toBe(false);
  });
});

describe("DWIE OBIETNICE, DWA ELEMENTY - semantyka zakładek", () => {
  it("skrót nawigacyjny to LINK z prawdziwym href", () => {
    // `navigate()` z `<button>` odbierał użytkownikowi otwarcie w nowej
    // karcie, kliknięcie środkowym przyciskiem i skopiowanie adresu.
    const node = tabsAfterRender("network")[0];
    expect(node?.tagName).toBe("A");
    expect(node?.getAttribute("href")).toBe("/network");
  });

  it("zakładka panelu to PRZYCISK z aria-expanded i aria-controls", async () => {
    renderDock();
    const node = tab("todos");
    expect(node.tagName).toBe("BUTTON");
    expect(node.getAttribute("aria-expanded")).toBe("false");
    // `aria-pressed` mówiłoby „wciśnięty", a nie „rozwinąłem region".
    expect(node.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(node);
    await waitFor(() => expect(tab("todos").getAttribute("aria-expanded")).toBe("true"));
    const controls = tab("todos").getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? "")).not.toBeNull();
  });

  it("zakładka czatu wskazuje region SKRZYNKI, nie panelu narzędzi", async () => {
    renderDock();
    const controls = tab("chats").getAttribute("aria-controls");
    expect(controls).toBe("workspace-dock-chat");

    fireEvent.click(tab("chats"));
    // Region, na który wskazuje `aria-controls`, MUSI istnieć po otwarciu -
    // wcześniej zakładka czatu wskazywała identyfikator panelu narzędzi,
    // którego przy otwartej skrzynce nie ma w drzewie.
    await waitFor(() => expect(document.getElementById(controls ?? "")).not.toBeNull());
  });

  it("bieżąca trasa jest oznaczona aria-current na LINKU", () => {
    h.pathname = "/network";
    renderDock();
    expect(tabs("network").some((node) => node.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("etykieta zakładki jest w drzewie także wtedy, gdy jest zwinięta", () => {
    // To ONA jest nazwą dostępną - `aria-label` nadpisywał ją i wycinał
    // z nazwy licznik zadań.
    renderDock();
    expect(tab("todos").textContent).toContain(dockPl.dock.tools.todos);
    expect(tab("todos").getAttribute("aria-label")).toBeNull();
  });

  it("licznik zadań WCHODZI do nazwy dostępnej zakładki", () => {
    h.openTodos = 3;
    renderDock();
    expect(tab("todos").textContent).toContain("3");
  });

  it("licznik powyżej stu skraca się do 99+", () => {
    h.openTodos = 128;
    renderDock();
    expect(tab("todos").textContent).toContain("99+");
  });
});

describe("OGNISKO UWAGI wraca na zakładkę po zamknięciu", () => {
  it("zamknięcie oddaje ognisko zakładce, a nie <body>", async () => {
    renderDock();
    const trigger = tab("todos");
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByTestId("panel-todos");

    fireEvent.click(tab("todos"));
    // Powrót idzie klatką animacji, więc czekamy na zmianę `activeElement`.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect((document.activeElement as HTMLElement)?.dataset.dockTab).toBe("todos");
  });
});

describe("szyna zminimalizowanych rozmów", () => {
  it("pusta szyna nie montuje warstwy danych - dwie pigułki, dwa zapytania mniej", () => {
    // Poprzednia wersja subskrybowała `useConversations` i `usePeerProfiles`
    // BEZWARUNKOWO, a potem zwracała `null`. W najczęstszym stanie pasek
    // płacił za dwa zapytania, żeby nie wyrenderować nic.
    renderDock();
    expect(document.querySelector(".wd-pill")).toBeNull();
  });
});

describe("rezerwacja dolnej krawędzi", () => {
  it("publikuje znacznik, zmierzoną wysokość I zapamiętuje ją na następne wejście", async () => {
    renderDock();
    await waitFor(() => expect(document.documentElement.dataset.mbb).toBe("on"));
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe(
      `${MEASURED_BAR_HEIGHT}px`,
    );
    // Zapamiętana wysokość to paliwo dla skryptu sprzed pierwszego malowania -
    // bez niej następne wejście znów podskoczyłoby na dole strony.
    expect(window.localStorage.getItem(DOCK_RESERVE_KEY)).toBe(String(MEASURED_BAR_HEIGHT));
  });

  it("ZNACZNIK IDZIE RAZEM Z LICZBĄ - pomiar zerowy nie włącza rezerwacji", async () => {
    // To jest naprawiona reguła. Poprzednia wersja zapalała `data-mbb="on"`
    // BEZWARUNKOWO, a wysokość publikowała tylko dla `value > 0`, więc pomiar
    // zerowy (węzeł pod `display: none`, pomiar poza układem) zostawiał CSS
    // z zapasem 72 px przy pasku ~36 px - ~35 px pustego pasa.
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 0,
    });
    renderDock();
    await waitFor(() => expect(document.querySelector("[data-workspace-dock]")).not.toBeNull());
    expect(document.documentElement.dataset.mbb).toBeUndefined();
    expect(window.localStorage.getItem(DOCK_RESERVE_KEY)).toBeNull();
  });

  it("odmontowanie zdejmuje rezerwację - przejście na /admin nie zostawia pustego pasa", async () => {
    const view = renderDock();
    await waitFor(() => expect(document.documentElement.dataset.mbb).toBe("on"));
    view.unmount();
    expect(document.documentElement.dataset.mbb).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
  });
});

describe("dostępność paska", () => {
  it("JEDEN landmark nawigacyjny, choć oba rzędy są w drzewie", () => {
    // Rząd mobilny i desktopowy są oba zamontowane (jeden schowany klasą).
    // Dwa `<nav>` o tej samej nazwie to naruszenie `landmark-unique`, a przy
    // niewczytanym arkuszu oba są widoczne dla drzewa dostępności.
    renderDock();
    expect(document.querySelectorAll("nav")).toHaveLength(1);
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe(dockPl.dock.workspace);
  });

  it("grupa narzędzi jest paskiem narzędzi z własną nazwą", () => {
    renderDock();
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.getAttribute("aria-label")).toBe(dockPl.dock.toolbar);
    expect(toolbar.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it('licznik czyta się PO etykiecie i pełnym zdaniem, nie jako „99+ Zadania"', () => {
    // Pigułka licznika stoi w DOM przed etykietą (jest pozycjonowana nad
    // ikoną), więc czytnik ekranu ogłaszał ją pierwszą. Jest teraz
    // `aria-hidden`, a treść dla czytnika idzie `sr-only` za etykietą.
    h.openTodos = 3;
    renderDock();
    const node = tab("todos");
    const label = dockPl.dock.tools.todos;
    const spoken = node.textContent ?? "";
    expect(spoken.indexOf(label)).toBeGreaterThanOrEqual(0);
    expect(spoken.indexOf("Otwarte")).toBeGreaterThan(spoken.indexOf(label));
    // Sama pigułka jest wycięta z nazwy dostępnej (`aria-hidden`).
    const badge = node.querySelector("[data-dock-badge]");
    expect(badge?.textContent).toBe("3");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
  });

  it("pasek nie ma naruszeń axe", async () => {
    const { container } = renderDock();
    await waitFor(() => expect(document.documentElement.dataset.mbb).toBe("on"));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

/** Render + odczyt zakładek w jednym kroku (dla testów bez interakcji). */
function tabsAfterRender(id: string): HTMLElement[] {
  renderDock();
  return tabs(id);
}
