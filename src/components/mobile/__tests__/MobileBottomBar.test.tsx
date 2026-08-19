// Kontener mobilnego paska dolnego. Warstwa prezentacji (garb, animacja,
// etykiety) ma własny plik testowy - tutaj chodzi o trzy rzeczy, które robi
// WYŁĄCZNIE kontener i których nie widać w widoku:
//
//   1. KOMU pasek się należy (gość nie ma czego skracać),
//   2. REZERWACJA MIEJSCA na dole strony - pasek jest `position: fixed`, więc
//      bez `--mbb-space` zasłania stopkę i ostatni akapit artykułu; sprzątanie
//      przy odmontowaniu jest równie ważne, bo inaczej wejście na /admin
//      zostawia martwe dopełnienie,
//   3. CHOWANIE przy przewijaniu w dół, z martwą strefą na bounce iOS.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import "@/lib/i18n-mobile-bottom-bar";
import {
  MOBILE_BOTTOM_BAR_DEFAULTS,
  type MobileBottomBarConfig,
} from "@/lib/mobileBottomBar/config";

const env = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  config: null as MobileBottomBarConfig | null,
  pathname: "/",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: env.session, user: env.session?.user ?? null }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: env.pathname } }),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T,>(_key: string, fallback: T): T => (env.config as T) ?? fallback,
}));

const { MobileBottomBar } = await import("@/components/mobile/MobileBottomBar");

function config(over: Partial<MobileBottomBarConfig> = {}): MobileBottomBarConfig {
  return { ...MOBILE_BOTTOM_BAR_DEFAULTS, ...over };
}

// happy-dom nie liczy układu, więc `offsetHeight` jest zawsze zerem, a widok
// zgłasza wysokość JUŻ PRZY MONTOWANIU. Podstawiamy wymiar na prototypie przed
// renderem - inaczej testowalibyśmy wyłącznie gałąź „wysokość nieznana".
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  "offsetHeight",
);

function stubBarHeight(px: number) {
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).classList?.contains("mbb") ? px : 0;
    },
  });
}

function restoreBarHeight() {
  if (originalOffsetHeight) {
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  } else {
    delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  }
}

/**
 * Przewinięcie + poczekanie na skutek. Kontener dławi nasłuch przez
 * `requestAnimationFrame`, więc stan zmienia się o klatkę później - czekamy na
 * WARTOŚĆ, a nie na ustalony czas (pod obciążeniem klatka potrafi się spóźnić).
 */
async function scrollTo(y: number, expectHidden: boolean) {
  await act(async () => {
    window.scrollY = y;
    fireEvent.scroll(window);
  });
  await vi.waitFor(() => {
    expect(document.querySelector(".mbb-slot")).toHaveAttribute(
      "data-hidden",
      String(expectHidden),
    );
  });
}

beforeEach(() => {
  env.session = { user: { id: "u1" } };
  env.config = null;
  env.pathname = "/";
  window.scrollY = 0;
  document.documentElement.removeAttribute("data-mbb");
  document.documentElement.style.removeProperty("--mbb-space");
});

afterEach(() => {
  cleanup();
  restoreBarHeight();
});

describe("komu należy się pasek", () => {
  it("gość NIE dostaje paska ani rezerwacji miejsca", () => {
    // Pasek jest skrótem do przestrzeni użytkownika (sieć, wiadomości, profil) -
    // dla anonimowego czytelnika nie ma czego skracać, a dopełnienie na dole
    // zabierałoby mu wysokość ekranu bez powodu.
    env.session = null;
    const { container } = render(<MobileBottomBar />);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.hasAttribute("data-mbb")).toBe(false);
  });

  it("wyłączony w ustawieniach tenanta też się nie renderuje", () => {
    env.config = config({ enabled: false });
    const { container } = render(<MobileBottomBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("konfiguracja bez ani jednej włączonej pozycji nie zostawia pustej pigułki", () => {
    env.config = config({
      items: MOBILE_BOTTOM_BAR_DEFAULTS.items.map((i) => ({ ...i, enabled: false })),
    });
    const { container } = render(<MobileBottomBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("zalogowany dostaje pasek z pozycjami i podświetleniem bieżącej trasy", () => {
    env.pathname = "/messages";
    render(<MobileBottomBar />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("link", { current: "page" })).toHaveAttribute("href", "/messages");
  });

  it("pasek jest schowany na szerokościach desktopowych", () => {
    // Kontener nie mierzy okna - decyduje CSS. Klasa jest jedynym nośnikiem
    // tej decyzji, więc jej zniknięcie pokazałoby pasek na desktopie.
    const { container } = render(<MobileBottomBar />);
    expect(container.firstElementChild?.className).toContain("md:hidden");
  });
});

describe("rezerwacja miejsca na dole strony", () => {
  it("oznacza dokument i publikuje zajętość dolnej krawędzi", () => {
    stubBarHeight(56);
    render(<MobileBottomBar />);
    expect(document.documentElement.dataset.mbb).toBe("on");
    // 56 px paska + 12 px domyślnego odstępu.
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("68px");
  });

  it("odstęp z ustawień tenanta wchodzi do rezerwacji", () => {
    stubBarHeight(50);
    env.config = config({ offset_bottom: 24 });
    render(<MobileBottomBar />);
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("74px");
  });

  it("odstęp spoza zakresu jest przycinany, a nie przepuszczany do CSS", () => {
    stubBarHeight(40);
    env.config = config({ offset_bottom: 9999 });
    render(<MobileBottomBar />);
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("80px"); // 40 + 40
  });

  it("ODMONTOWANIE sprząta znacznik i zmienną - inaczej /admin zostaje z dziurą", () => {
    stubBarHeight(56);
    const { unmount } = render(<MobileBottomBar />);
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("68px");
    unmount();
    expect(document.documentElement.hasAttribute("data-mbb")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
  });

  it("wysokość nieznana (zero) nie publikuje rezerwacji", () => {
    // Zero to „jeszcze nie zmierzone", nie „pasek nic nie zajmuje" - publikacja
    // zerowej rezerwacji przy pierwszym renderze podskakiwałaby układem strony.
    render(<MobileBottomBar />);
    expect(document.documentElement.dataset.mbb).toBe("on");
    expect(document.documentElement.style.getPropertyValue("--mbb-space")).toBe("");
  });
});

describe("chowanie przy przewijaniu", () => {
  it("na górze strony pasek jest widoczny", () => {
    const { container } = render(<MobileBottomBar />);
    expect(container.firstElementChild).toHaveAttribute("data-hidden", "false");
  });

  it("przewijanie w dół PONIŻEJ progu jeszcze nie chowa paska", async () => {
    // Pierwsze piksele przewijania to często odruch, a nie zamiar czytania -
    // znikający pasek byłby wtedy migotaniem.
    render(<MobileBottomBar />);
    await scrollTo(100, false);
  });

  it("przewijanie w dół powyżej progu chowa, a powrót w górę przywraca", async () => {
    render(<MobileBottomBar />);
    await scrollTo(400, true);
    await scrollTo(200, false);
  });

  it("ruch w martwej strefie (bounce iOS) nie rusza paska", async () => {
    render(<MobileBottomBar />);
    await scrollTo(400, true);
    // 4 px - poniżej martwej strefy, więc stan MA zostać bez zmian.
    await scrollTo(404, true);
  });

  it("wyłączone chowanie w ustawieniach zostawia pasek na miejscu", async () => {
    env.config = config({ hide_on_scroll: false });
    render(<MobileBottomBar />);
    await scrollTo(800, false);
  });
});
