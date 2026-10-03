// `switchUiLanguage` z PRAWDZIWYM routerem TanStack (przywracanie scrolla
// włączone, jak w `src/router.tsx`). Atrapy routera w pozostałych testach nie
// odtwarzają tego, co router robi z adresem PO nawigacji - a tu siedzi pułapka:
// przełącznik przenosi hash (ten sam adres w drugim języku), a router domyślnie
// przewija do elementu z hasha (`hashScrollIntoView`), nawet przy
// `resetScroll: false`. Czytelnik, który kliknął spis treści (#sekcja) i
// doczytał dalej, po zmianie języka lądowałby z powrotem przy kotwicy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => "pl",
  setClientLang: () => {},
}));

import { switchUiLanguage } from "../switchUiLanguage";

const Page = () => (
  <div>
    <h2 id="sekcja">Sekcja</h2>
  </div>
);

function makeRouter() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/o-nas", component: Page }),
    // Bez rewrite'u z `src/router.tsx` angielski adres to po prostu osobna trasa.
    createRoute({ getParentRoute: () => root, path: "/en/o-nas", component: Page }),
  ]);
  return createRouter({ routeTree, scrollRestoration: true });
}

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnv: boolean | undefined;
const originalScrollIntoView = Element.prototype.scrollIntoView;
const scrollIntoView = vi.fn();

beforeEach(() => {
  // Router renderuje z wnętrza zdarzeń historii, poza `act(...)`.
  previousActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  actEnv.IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  window.history.replaceState(null, "", "/");
});

describe("switchUiLanguage + prawdziwy router", () => {
  it("przenosi hash do adresu, ale NIE przewija do kotwicy (pozycja czytelnika zostaje)", async () => {
    window.history.replaceState(null, "", "/o-nas?tab=zespol#sekcja");
    const router = makeRouter();
    render(<RouterProvider router={router} />);
    await vi.waitFor(() => {
      expect(router.state.status).toBe("idle");
      expect(router.state.resolvedLocation?.pathname).toBe("/o-nas");
    });
    scrollIntoView.mockClear();

    switchUiLanguage("en", "pl", { i18n: { changeLanguage: () => undefined }, router });

    await vi.waitFor(() => {
      expect(router.state.resolvedLocation?.pathname).toBe("/en/o-nas");
      expect(router.state.status).toBe("idle");
    });
    // Ten sam adres w drugim języku - query i hash przeszły...
    expect(window.location.pathname).toBe("/en/o-nas");
    expect(window.location.search).toBe("?tab=zespol");
    expect(window.location.hash).toBe("#sekcja");
    // ...a widok nie skoczył do kotwicy.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
