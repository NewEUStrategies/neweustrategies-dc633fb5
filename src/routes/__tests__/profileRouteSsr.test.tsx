// @vitest-environment node
//
// TRASA `/profile` - CO POWSTAJE NA SERWERZE: bramka sesji, nigdy `<Outlet/>`.
//
// PO CO TEN PLIK ISTNIEJE. Wtyczka `nes:client-only-route-stub`
// (scripts/lib/clientOnlyRouteStubPlugin.ts) podmienia w artefakcie serwera komponenty
// podstron `/profile/*` na zaślepkę, bo serwer ich nie renderuje: layout owija `<Outlet/>`
// w `AuthGate`, a sesja Supabase żyje w `localStorage` - `AuthProvider` zaczyna od
// `session: null` i ustawia ją wyłącznie w efektach, które w renderze serwerowym nie biegną.
// Ta własność jest warunkiem poprawności zaślepki: layout, który zacząłby renderować
// `<Outlet/>` na serwerze (np. sesja z ciasteczka), dostałby pustą podstronę w HTML-u
// i rozjazd hydratacji. Test przypina ją na PRAWDZIWYM `AuthProvider`, `useAuth` i `AuthGate`,
// w środowisku bez `window` - tak jak w Workerze.
//
// GRANICA DOWODU. `renderToString` widzi wyjście serwera; stan po hydratacji (sesja obecna ->
// zawartość, brak sesji -> 401) dowodzi `profileShellRoutes.test.tsx`.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Ile razy ktokolwiek wyrenderował `<Outlet/>` layoutu. W SSR musi zostać zerem. */
  outletRenders: 0,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/profile/useHeaderProfile", () => ({ useHeaderProfile: () => ({ data: null }) }));
vi.mock("@/lib/profile/guestPreviewStore", () => ({ useGuestPreview: () => false }));
vi.mock("@/components/profile/ProfileNav", () => ({ ProfileNav: () => null }));

// `AuthGate`, `useAuth` i `AuthProvider` zostają PRAWDZIWE - to one są przedmiotem dowodu.
// Atrapujemy wyłącznie to, co bez runtime'u routera nie ma jak zadziałać.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    useLocation: () => ({ pathname: "/profile/edit" }),
    Outlet: () => {
      h.outletRenders += 1;
      return createElement("div", { "data-testid": "profile-outlet" });
    },
  };
});

import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { AuthProvider } from "@/hooks/useAuth";
import { Route as ProfileRoute } from "@/routes/profile";

/** Komponent trasy jako funkcja - STRAŻNIK, nie rzutowanie. */
function profileLayout(): () => ReactElement {
  const component: unknown = ProfileRoute.options.component;
  if (typeof component !== "function") throw new Error("test: trasa nie ma komponentu");
  return component as () => ReactElement;
}

describe("/profile w renderze serwerowym", () => {
  it("środowisko testu nie ma `window` - jak Worker", () => {
    expect(typeof window).toBe("undefined");
  });

  it("atrapa `<Outlet/>` zostawia ślad w HTML-u - asercje niżej nie są puste", () => {
    h.outletRenders = 0;
    expect(renderToString(<Outlet />)).toContain("profile-outlet");
    expect(h.outletRenders).toBe(1);
  });

  it("pod prawdziwym `AuthProvider` serwer oddaje bramkę sesji i nie renderuje `<Outlet/>`", () => {
    h.outletRenders = 0;
    const Layout = profileLayout();
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Layout />
        </AuthProvider>
      </QueryClientProvider>,
    );
    // Stan „nie wiemy, czy to gość": spinner `AuthGate`, bez powłoki panelu i bez podstrony.
    expect(html).toContain('aria-label="loading"');
    expect(html).not.toContain("profile-shell");
    expect(html).not.toContain("profile-outlet");
    expect(h.outletRenders).toBe(0);
  });

  it("bez dostawcy (wartość domyślna kontekstu) wynik jest ten sam", () => {
    h.outletRenders = 0;
    const Layout = profileLayout();
    const html = renderToString(<Layout />);
    expect(html).toContain('aria-label="loading"');
    expect(html).not.toContain("profile-outlet");
    expect(h.outletRenders).toBe(0);
  });

  it("trasa nie ma `loader`, `beforeLoad` ani `ssr: false` - layout renderuje się na serwerze", () => {
    // Layout zostaje w artefakcie w całości; zaślepkę dostają wyłącznie komponenty jego dzieci.
    expect(ProfileRoute.options.loader).toBeUndefined();
    expect(ProfileRoute.options.beforeLoad).toBeUndefined();
    expect(ProfileRoute.options.ssr).toBeUndefined();
  });
});
