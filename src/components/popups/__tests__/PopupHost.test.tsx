// Publiczny host popupów buildera - montowany raz w korzeniu aplikacji.
//
// PO CO GO TESTOWAĆ. To on decyduje, czy odwiedzający dostanie modal na środku
// ekranu. Pomyłki są tu widoczne dla KAŻDEGO odwiedzającego, a operator nie ma
// jak ich zauważyć w panelu:
//   * popup w panelu ADMINA albo na logowaniu (host nie może pokazywać się na
//     powierzchniach roboczych - to nie jest ruch, który da się konwertować);
//   * popup z PUSTYM dokumentem, czyli puste okno z samym przyciskiem zamknięcia;
//   * popup po ZAMKNIĘCIU, w tej samej wizycie - najszybszy sposób, żeby
//     odwiedzający wyszedł ze strony;
//   * PUŁAPKA A11Y: brak przycisku zamknięcia przy wyłączonym zamykaniu tłem -
//     na urządzeniu dotykowym (bez klawisza Escape) popupu nie da się zamknąć.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

interface FakePopup {
  id: string;
  name: string;
  status: "active";
  builder_data: unknown;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const env = vi.hoisted(() => ({
  popups: [] as unknown[],
  session: null as unknown,
  pathname: "/",
  width: 1280,
  empty: ((_doc: unknown) => false) as (doc: unknown) => boolean,
  beacons: [] as Array<{ kind: string; id: string }>,
  slotGranted: true,
  released: 0,
  cancelled: [] as string[],
}));

vi.mock("@/lib/builder/popups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/builder/popups")>();
  return {
    ...actual,
    useActivePopups: (enabled: boolean) => ({ data: enabled ? env.popups : undefined }),
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: env.session }) }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: () => ({ pathname: env.pathname }),
}));
// Renderer dokumentu buildera ma własne testy - tu liczy się, CZY został użyty.
vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ lang }: { lang: string }) => (
    <div data-testid="dokument">
      <a href="https://example.test/oferta">przejdz-do-oferty</a>
      <span>{lang}</span>
    </div>
  ),
}));
vi.mock("@/lib/analytics/events", () => ({
  beaconPopupEvent: (kind: string, id: string) => {
    env.beacons.push({ kind, id });
  },
}));
vi.mock("@/lib/builder/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/builder/types")>()),
  isEmptyDocument: (doc: unknown) => env.empty(doc),
}));
vi.mock("@/lib/overlayCoordinator", () => ({
  requestOverlaySlot: async () =>
    env.slotGranted
      ? () => {
          env.released += 1;
        }
      : () => {},
  cancelOverlayRequest: (key: string) => {
    env.cancelled.push(key);
  },
}));
vi.mock("@/lib/a11y/useFocusTrap", () => ({ useFocusTrap: () => {} }));

import { PopupHost } from "@/components/popups/PopupHost";
import { defaultPopupSettings } from "@/lib/builder/popups";

function popup(settings: Record<string, unknown> = {}, id = "popup-1"): FakePopup {
  return {
    id,
    name: "Powitalny",
    status: "active",
    builder_data: { sections: [{ id: "s1" }] },
    settings: { ...defaultPopupSettings(), trigger: "immediate", ...settings },
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

/** Montuje hosta i przepuszcza wyzwalacz natychmiastowy (400 ms). */
async function mountAndFire(popups: unknown[] = [popup()]) {
  env.popups = popups;
  const utils = render(<PopupHost />);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  return utils;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  env.popups = [];
  env.session = null;
  env.pathname = "/";
  env.width = 1280;
  env.empty = () => false;
  env.beacons = [];
  env.slotGranted = true;
  env.released = 0;
  env.cancelled = [];
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { value: env.width, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
describe("kiedy host MILCZY", () => {
  it("bez żadnego popupu nie renderuje niczego", async () => {
    const { container } = await mountAndFire([]);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("na powierzchni ADMINA nie pokazuje popupu", async () => {
    // Panel to nie ruch, który da się konwertować - modal tylko przeszkadza.
    env.pathname = "/admin/posts";

    const { container } = await mountAndFire();

    expect(container.innerHTML).toBe("");
  });

  it("na LOGOWANIU też nie pokazuje popupu", async () => {
    env.pathname = "/login";

    const { container } = await mountAndFire();

    expect(container.innerHTML).toBe("");
  });

  it("popup z PUSTYM dokumentem jest pomijany, nie renderowany jako puste okno", async () => {
    // Panel pokazuje to jako stan „utwórz pierwszą sekcję"; odwiedzający nie może
    // dostać okna z samym przyciskiem zamknięcia.
    env.empty = () => true;

    const { container } = await mountAndFire();

    expect(container.innerHTML).toBe("");
  });

  it("popup ZAMKNIĘTY w tej wizycie nie wraca po nawigacji", async () => {
    // Najszybszy sposób, żeby odwiedzający wyszedł ze strony.
    await mountAndFire();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Zamknij"));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("popup wyciszony CZĘSTOTLIWOŚCIĄ nie pokazuje się ponownie", async () => {
    window.localStorage.setItem("cms_popup_last:popup-1", String(Date.now()));

    const { container } = await mountAndFire([popup({ frequencyDays: 7 })]);

    expect(container.innerHTML).toBe("");
  });

  it("częstotliwość 0 dni znaczy „pokazuj zawsze”, także po zamknięciu", async () => {
    window.localStorage.setItem("cms_popup_last:popup-1", String(Date.now()));

    await mountAndFire([popup({ frequencyDays: 0 })]);

    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("targetowanie", () => {
  it("popup dla GOŚCI nie pokazuje się zalogowanemu", async () => {
    env.session = { user: { id: "u1" } };

    const { container } = await mountAndFire([popup({ audience: "guest" })]);

    expect(container.innerHTML).toBe("");
  });

  it("popup dla ZALOGOWANYCH nie pokazuje się gościowi", async () => {
    env.session = null;

    const { container } = await mountAndFire([popup({ audience: "user" })]);

    expect(container.innerHTML).toBe("");
  });

  it("popup wyłączony na TYM urządzeniu jest pomijany", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });

    const { container } = await mountAndFire([
      popup({ devices: { desktop: true, tablet: true, mobile: false } }),
    ]);

    expect(container.innerHTML).toBe("");
  });

  it("popup ograniczony do innej ŚCIEŻKI jest pomijany", async () => {
    env.pathname = "/blog/wpis";

    const { container } = await mountAndFire([popup({ includePaths: ["/pricing"] })]);

    expect(container.innerHTML).toBe("");
  });

  it("ścieżka WYKLUCZONA wygrywa nad dozwoloną", async () => {
    env.pathname = "/checkout/krok-1";

    const { container } = await mountAndFire([
      popup({ includePaths: ["/"], excludePaths: ["/checkout/*"] }),
    ]);

    expect(container.innerHTML).toBe("");
  });

  it("PIERWSZY pasujący popup wygrywa - dwa modale naraz to pułapka", async () => {
    await mountAndFire([
      popup({ audience: "user" }, "tylko-dla-zalogowanych"),
      popup({}, "dla-wszystkich"),
    ]);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Powitalny");
  });
});

// ---------------------------------------------------------------------------
describe("wyzwalacze", () => {
  it("NATYCHMIASTOWY czeka chwilę, a nie wyskakuje w pierwszej klatce", async () => {
    // Modal w tej samej klatce co treść czyta się jako awaria strony.
    env.popups = [popup({ trigger: "immediate" })];
    render(<PopupHost />);

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("OPÓŹNIONY czeka zadaną liczbę sekund", async () => {
    env.popups = [popup({ trigger: "delay", delaySeconds: 5 })];
    render(<PopupHost />);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opóźnienie 0 s nie znaczy „natychmiast” - minimum to jedna sekunda", async () => {
    env.popups = [popup({ trigger: "delay", delaySeconds: 0 })];
    render(<PopupHost />);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("PRZEWINIĘCIE otwiera popup po przekroczeniu progu", async () => {
    env.popups = [popup({ trigger: "scroll", scrollPercent: 50 })];
    render(<PopupHost />);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      value: 1000,
      configurable: true,
    });

    Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("strona BEZ pasków przewijania nie otwiera popupu przewinięciem", async () => {
    // Dzielenie przez zero dałoby „nieskończony procent" i modal na wejściu.
    env.popups = [popup({ trigger: "scroll", scrollPercent: 50 })];
    render(<PopupHost />);
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      value: 800,
      configurable: true,
    });

    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("EXIT-INTENT otwiera popup przy wyjściu kursora GÓRĄ okna", async () => {
    env.popups = [popup({ trigger: "exit-intent" })];
    render(<PopupHost />);

    await act(async () => {
      document.dispatchEvent(Object.assign(new MouseEvent("mouseleave"), { clientY: 300 }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      document.dispatchEvent(Object.assign(new MouseEvent("mouseleave"), { clientY: 0 }));
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("odmontowanie ANULUJE prośbę o miejsce na nakładkę", async () => {
    // Bez anulowania nakładka zostaje zarezerwowana i banner zgód nigdy się nie
    // pokaże.
    env.popups = [popup({ trigger: "delay", delaySeconds: 10 })];
    const { unmount } = render(<PopupHost />);

    unmount();

    expect(env.cancelled).toContain("builder-popup:popup-1");
  });
});

// ---------------------------------------------------------------------------
describe("okno popupu", () => {
  it("jest MODALEM z nazwą dostępną", async () => {
    await mountAndFire();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Powitalny");
  });

  it("renderuje dokument buildera w języku strony", async () => {
    await mountAndFire();

    expect(screen.getByTestId("dokument")).toBeTruthy();
    expect(screen.getByTestId("dokument").textContent).toContain("pl");
  });

  it("szerokość i zaokrąglenie idą za ustawieniami", async () => {
    await mountAndFire([popup({ width: "sm", borderRadiusPx: 24 })]);

    const panel = screen.getByTestId("dokument").parentElement as HTMLElement;
    expect(panel.style.maxWidth).toBe("420px");
    expect(panel.style.borderRadius).toBe("24px");
  });

  it("pozycja zmienia wyrównanie okna", async () => {
    await mountAndFire([popup({ position: "top" })]);
    expect(screen.getByRole("dialog").className).toContain("items-start");
    cleanup();

    await mountAndFire([popup({ position: "bottom" }, "popup-2")]);
    expect(screen.getByRole("dialog").className).toContain("items-end");
  });

  it("kolor przysłony pochodzi z ustawień", async () => {
    await mountAndFire([popup({ overlayColor: "rgba(1, 2, 3, 0.5)" })]);

    expect(screen.getByRole("dialog").style.backgroundColor).toBe("rgba(1, 2, 3, 0.5)");
  });
});

// ---------------------------------------------------------------------------
describe("zamykanie", () => {
  it("ESCAPE zamyka popup", async () => {
    await mountAndFire();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("inny klawisz NIE zamyka popupu", async () => {
    await mountAndFire();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("kliknięcie TŁA zamyka, gdy ustawienia na to pozwalają", async () => {
    await mountAndFire([popup({ closeOnOverlay: true })]);

    fireEvent.click(screen.getByRole("dialog"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("kliknięcie w PANEL nie zamyka popupu", async () => {
    // Bez zatrzymania propagacji każde kliknięcie treści zamykałoby okno.
    await mountAndFire([popup({ closeOnOverlay: true })]);

    fireEvent.click(screen.getByTestId("dokument").parentElement!);

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("z wyłączonym zamykaniem tłem klik w tło NIE zamyka", async () => {
    await mountAndFire([popup({ closeOnOverlay: false, showCloseButton: true })]);

    fireEvent.click(screen.getByRole("dialog"));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("PUŁAPKA A11Y: bez zamykania tłem przycisk zamknięcia jest WYMUSZANY", async () => {
    // Na urządzeniu dotykowym nie ma klawisza Escape - popup bez żadnego wyjścia
    // blokuje stronę na dobre.
    await mountAndFire([popup({ closeOnOverlay: false, showCloseButton: false })]);

    expect(screen.getByLabelText("Zamknij")).toBeTruthy();
  });

  it("przy zamykaniu tłem przycisk można ukryć", async () => {
    await mountAndFire([popup({ closeOnOverlay: true, showCloseButton: false })]);

    expect(screen.queryByLabelText("Zamknij")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("zamknięcie ZWALNIA miejsce na nakładkę - inaczej banner zgód nie wróci", async () => {
    await mountAndFire();

    fireEvent.click(screen.getByLabelText("Zamknij"));

    expect(env.released).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("telemetria wzrostu", () => {
  it("otwarcie zgłasza WYŚWIETLENIE tego popupu", async () => {
    await mountAndFire();

    expect(env.beacons).toEqual([{ kind: "view", id: "popup-1" }]);
  });

  it("klik w link w treści zgłasza KONWERSJĘ", async () => {
    await mountAndFire();

    fireEvent.click(screen.getByText("przejdz-do-oferty"));

    expect(env.beacons).toContainEqual({ kind: "conversion", id: "popup-1" });
  });

  it("klik w ZAMKNIĘCIE nie jest konwersją", async () => {
    // Inaczej każdy popup miałby 100% konwersji i wskaźnik nic nie znaczyłby.
    await mountAndFire();

    fireEvent.click(screen.getByLabelText("Zamknij"));

    expect(env.beacons.filter((b) => b.kind === "conversion")).toHaveLength(0);
  });

  it("konwersja liczy się RAZ na pokazanie, nie na każdy klik", async () => {
    await mountAndFire();

    fireEvent.click(screen.getByText("przejdz-do-oferty"));
    fireEvent.click(screen.getByText("przejdz-do-oferty"));

    expect(env.beacons.filter((b) => b.kind === "conversion")).toHaveLength(1);
  });

  it("klik w tło (poza panelem) nie jest konwersją", async () => {
    await mountAndFire([popup({ closeOnOverlay: false })]);

    fireEvent.click(screen.getByRole("dialog"));

    expect(env.beacons.filter((b) => b.kind === "conversion")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("język", () => {
  it("dokument dostaje język strony", async () => {
    await mountAndFire();

    await waitFor(() => expect(screen.getByTestId("dokument").textContent).toContain("pl"));
  });

  it("etykieta zamknięcia jest tłumaczona", async () => {
    await mountAndFire();

    expect(screen.getByLabelText("Zamknij")).toBeTruthy();
  });
});
