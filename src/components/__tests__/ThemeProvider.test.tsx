// DOSTAWCA MOTYWU - przyjęcie zapisanego wyboru, przełączanie, synchronizacja
// między kartami i podążanie za systemem.
//
// REGUŁA, KTÓREJ TEN PLIK PILNUJE: „jawny wybór wygrywa z systemem, a brak
// wyboru oddaje głos systemowi" stoi RAZ w `lib/theme/themeChoice.ts`
// (`resolveTheme` + `parseThemeChoice`). Każda kopia tej reguły w komponencie
// jest okazją do rozjazdu - i jedna taka kopia stała w synchronizacji między
// kartami: `newValue === "dark" ? "dark" : "light"`. Wybór usunięty w innej
// karcie (wyczyszczone dane witryny) albo wartość nieznana („sepia" ze starszej
// wersji) dawały JASNY motyw przy ciemnym systemie. Naprawione w tej samej
// zmianie; przypadki niżej to przypinają.
//
// ŚRODOWISKO. `matchMedia` jest atrapą sterowaną z testu (stan + słuchacze
// `change`), bo happy-dom nie ma preferencji systemu.
//
// STAŁA WARTOŚĆ KONTEKSTU (I2, P2.2). Motyw jedzie magazynem z lustrem w
// konsumencie, nie wartością kontekstu: przyjęcie zapisanego ciemnego motywu
// przy boocie i przełączenie motywu nie docierają do czekającej wyspy
// hydratacji (HTML serwera zostaje, wyspa nie otwiera się przez górną
// granicę), a klasa na `<html>` zmienia się synchronicznie w handlerze.
// Kontrola negatywna: dostawca, który przyjmuje motyw ZMIANĄ wartości
// kontekstu (jak przed P2.2), budzi tę samą wyspę.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";

import { ThemeProvider, useTheme } from "../ThemeProvider";
import { HydrationIsland } from "@/lib/performance/hydrationIsland";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

const system = {
  dark: false,
  listeners: new Set<() => void>(),
};

function setSystemDark(dark: boolean) {
  system.dark = dark;
  act(() => {
    for (const listener of system.listeners) listener();
  });
}

function Probe() {
  const { theme, toggle, setTheme } = useTheme();
  return (
    <div>
      <output aria-label="motyw">{theme}</output>
      <button type="button" onClick={toggle}>
        przełącz
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        ciemny
      </button>
    </div>
  );
}

function storageEvent(key: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

const shown = () => screen.getByRole("status", { name: "motyw" }).textContent;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  system.dark = false;
  system.listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return system.dark;
      },
      addEventListener: (_: string, fn: () => void) => system.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => system.listeners.delete(fn),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeProvider - start i przełączanie", () => {
  it("po montażu przyjmuje zapisany wybór", async () => {
    window.localStorage.setItem("theme", "dark");
    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
    expect(shown()).toBe("dark");
  });

  it("bez wyboru idzie za systemem", async () => {
    system.dark = true;
    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
    expect(shown()).toBe("dark");
  });

  it("przełącznik zapisuje JAWNY wybór i ustawia klasę na <html> od razu", async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "przełącz" }));
    });
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(shown()).toBe("dark");

    // Drugi klik czyta klasę <html>, nie odroczony stan - wraca do jasnego.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "przełącz" }));
    });
    expect(window.localStorage.getItem("theme")).toBe("light");
    expect(shown()).toBe("light");
  });

  it("poza dostawcą `useTheme` oddaje motyw serwera i bezczynne akcje", () => {
    render(<Probe />);
    expect(shown()).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "ciemny" }));
    expect(shown()).toBe("light");
  });
});

describe("ThemeProvider - podążanie za systemem", () => {
  it("zmiana systemu przestawia motyw, dopóki użytkownik nie wybrał jawnie", async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
    setSystemDark(true);
    expect(shown()).toBe("dark");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "przełącz" }));
    });
    expect(shown()).toBe("light");
    // Jawny wybór wygrywa - zmiana systemu już go nie rusza.
    setSystemDark(true);
    expect(shown()).toBe("light");
  });
});

describe("ThemeProvider - synchronizacja między kartami", () => {
  async function mount() {
    await act(async () => {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
  }

  it("wybór z innej karty przechodzi do tej", async () => {
    await mount();
    storageEvent("theme", "dark");
    expect(shown()).toBe("dark");
    storageEvent("theme", "light");
    expect(shown()).toBe("light");
  });

  it("zmiana INNEGO klucza magazynu nie rusza motywu", async () => {
    await mount();
    storageEvent("theme", "dark");
    storageEvent("nes.chat.minimized", "[]");
    expect(shown()).toBe("dark");
  });

  it("wybór USUNIĘTY w innej karcie oddaje głos systemowi (ciemnemu), a nie jasnemu", async () => {
    system.dark = true;
    window.localStorage.setItem("theme", "light");
    await mount();
    expect(shown()).toBe("light");

    window.localStorage.removeItem("theme");
    storageEvent("theme", null);
    expect(shown()).toBe("dark");
  });

  it("wartość nieznana („sepia” ze starszej wersji) to brak wyboru, nie jasny motyw", async () => {
    system.dark = true;
    window.localStorage.setItem("theme", "light");
    await mount();
    storageEvent("theme", "sepia");
    expect(shown()).toBe("dark");
  });

  it("wyczyszczenie całego magazynu w innej karcie (`key: null`) też wraca do systemu", async () => {
    system.dark = true;
    window.localStorage.setItem("theme", "light");
    await mount();
    storageEvent(null, null);
    expect(shown()).toBe("dark");
  });
});

describe("ThemeProvider - stała wartość kontekstu przy boocie (I2, P2.2)", () => {
  const roots: Array<{ root: Root; host: HTMLElement }> = [];

  beforeEach(() => {
    __resetFirstInteractionForTests();
    __resetPostInteractionQueueForTests();
  });

  afterEach(async () => {
    for (const { root, host } of roots.splice(0)) {
      await act(async () => root.unmount());
      host.remove();
    }
    __resetPostInteractionQueueForTests();
    __resetFirstInteractionForTests();
    vi.unstubAllEnvs();
  });

  function Outside(): ReactElement {
    const { theme, toggle } = useTheme();
    return (
      <button type="button" data-testid="outside" data-theme={theme} onClick={toggle}>
        motyw
      </button>
    );
  }

  function Inside(): ReactElement {
    const { theme } = useTheme();
    return (
      <article data-testid="inside" data-theme={theme}>
        Sekcja poniżej zgięcia
      </article>
    );
  }

  function page(Provider: ComponentType<{ children: ReactNode }>): ReactElement {
    return (
      <Provider>
        <Outside />
        <HydrationIsland id="sec" trigger={{ quiescent: false }}>
          <Inside />
        </HydrationIsland>
      </Provider>
    );
  }

  async function hydratePage(Provider: ComponentType<{ children: ReactNode }>) {
    const host = document.createElement("div");
    vi.stubEnv("SSR", true);
    host.innerHTML = renderToString(page(Provider));
    vi.stubEnv("SSR", false);
    document.body.append(host);
    const serverInside = host.querySelector('[data-testid="inside"]');
    const errors: unknown[] = [];
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, page(Provider), { onRecoverableError: (e) => errors.push(e) });
    });
    roots.push({ root, host });
    // Kilka klatek i makrozadań: kolejka P0.3 zdążyłaby otworzyć wyspę.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const state = () =>
      host.querySelector('[data-island-id="sec"]')?.getAttribute("data-island-state");
    const inside = () => host.querySelector<HTMLElement>('[data-testid="inside"]');
    const outside = () => host.querySelector<HTMLElement>('[data-testid="outside"]');
    return { host, serverInside, errors, state, inside, outside };
  }

  /** Dostawca jak przed P2.2: motyw w wartości kontekstu, przyjęcie w przejściu. */
  const LegacyCtx = createContext("light");
  function LegacyProvider({ children }: { children: ReactNode }): ReactElement {
    const [theme, setTheme] = useState("light");
    useEffect(() => {
      startTransition(() => setTheme(window.localStorage.getItem("theme") ?? "light"));
    }, []);
    return <LegacyCtx.Provider value={theme}>{children}</LegacyCtx.Provider>;
  }
  function LegacyRoot({ children }: { children: ReactNode }): ReactElement {
    // `useTheme` poza dostawcą (motyw serwera) + kontekst starego dostawcy nad wyspą.
    useContext(LegacyCtx);
    return <LegacyProvider>{children}</LegacyProvider>;
  }

  it("zapisany ciemny motyw: konsument poza wyspą przechodzi na „dark”, czekająca wyspa zostaje pending z HTML serwera", async () => {
    window.localStorage.setItem("theme", "dark");
    const t = await hydratePage(ThemeProvider);

    expect(t.outside()?.getAttribute("data-theme")).toBe("dark");
    expect(t.state()).toBe("pending");
    expect(t.inside()).toBe(t.serverInside);
    expect(t.inside()?.getAttribute("data-theme")).toBe("light");
    expect(t.errors).toEqual([]);

    // Otwarcie wyspy (dotknięcie we wnętrzu): hydratacja z motywem serwera
    // (bez rozjazdu), potem lustro przechodzi na bieżący motyw.
    await act(async () => {
      t.inside()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(t.state()).toBe("hydrated");
    expect(t.inside()).toBe(t.serverInside);
    expect(t.inside()?.getAttribute("data-theme")).toBe("dark");
    expect(t.errors).toEqual([]);
  });

  it("kontrola negatywna: dostawca ze zmianą wartości kontekstu przy boocie budzi czekającą wyspę (górna granica)", async () => {
    window.localStorage.setItem("theme", "dark");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await hydratePage(LegacyRoot);

    expect(t.state()).toBe("hydrated");
    expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining('"sec": an update reached the pending island'),
    );
    warn.mockRestore();
  });

  it("przełączenie przed hydratacją wyspy: klasa na <html> w tym samym handlerze, wyspa zostaje pending", async () => {
    const t = await hydratePage(ThemeProvider);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      t.outside()?.click();
      // Synchronicznie, przed jakąkolwiek klatką i przejściem.
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(t.outside()?.getAttribute("data-theme")).toBe("dark");
    expect(t.state()).toBe("pending");
    expect(t.inside()).toBe(t.serverInside);
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(t.errors).toEqual([]);
  });

  it("świeży montaż po zmianie motywu dostaje bieżący motyw od pierwszego renderu (bez mignięcia jasnym)", async () => {
    const seen: string[] = [];
    function Late(): ReactElement {
      const { theme } = useTheme();
      seen.push(theme);
      return <output aria-label="późny">{theme}</output>;
    }
    function Shell(): ReactElement {
      const [show, setShow] = useState(false);
      return (
        <>
          <Probe />
          <button type="button" onClick={() => setShow(true)}>
            pokaż
          </button>
          {show ? <Late /> : null}
        </>
      );
    }
    await act(async () => {
      render(
        <ThemeProvider>
          <Shell />
        </ThemeProvider>,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ciemny" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "pokaż" }));
    });

    expect(seen[0]).toBe("dark");
    expect(screen.getByRole("status", { name: "późny" }).textContent).toBe("dark");
  });
});
