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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ThemeProvider, useTheme } from "../ThemeProvider";

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
