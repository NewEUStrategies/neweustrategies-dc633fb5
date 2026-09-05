/**
 * <SiteChrome /> - rozstrzygnięcie, KTÓRA powłoka opakowuje daną trasę.
 *
 * DLACZEGO TO WARSTWA WARTA OSOBNEGO PLIKU. Sąsiedni
 * `siteChromePersistence.test.tsx` dowodzi jednej rzeczy (chrome NIE
 * przemontowuje się przy nawigacji) i celowo karmi atrapę routera pustą listą
 * dopasowań. Tu przedmiotem dowodu jest cała reszta: trzy tryby powłoki
 * (publiczna / panel admina i logowanie / trasa z własnym chrome), odczyt
 * `kind` z `loaderData` dopasowanej trasy oraz bramka doku czatu. Te decyzje
 * zapadają w jednym `select` i jednym warunku, a mylą się cicho - stąd osobne
 * przypadki na każdą gałąź.
 *
 * CO PRZYPINAMY.
 *  1. Trasa publiczna dostaje komplet: pasek postępu, baner impersonacji, link
 *     "przejdź do treści", Header, <main id="main-content">, Footer i mobilny
 *     pasek dolny.
 *  2. `adPageType` dla Headera liczy się z lokalizacji I z `kind` loadera
 *     (wpisy nie mają rozpoznawalnego adresu), a `contentKind` jedzie do
 *     Headera osobno, bo rozstrzyga tryb paska (patrz lib/layout/headerMode).
 *  3. `/admin/*` i `/login` renderują SAMĄ treść (bez Headera i Footera) - to
 *     jest granica, za którą panel ma własny układ.
 *  4. Trasa z `staticData.ownChrome` też traci Header/Footer, ale - inaczej niż
 *     panel - NIE dostaje linku "przejdź do treści" (renderuje własny).
 *  5. Strona główna zostaje edge-to-edge (bez odstępów `main`), każda inna
 *     dostaje 15 px góra/dół.
 *  6. Dok czatu: slot stoi w drzewie ZAWSZE (żeby nie przemontowywać go przy
 *     przejściu panel <-> serwis), a sam czat pojawia się wyłącznie dla
 *     zalogowanego użytkownika przy włączonym module.
 *
 * CO JEST ZAATRAPOWANE: router (kontrolowana lokalizacja i dopasowania),
 * `useAuth` oraz wszystkie dzieci powłoki (Header, Footer, pasek dolny, baner,
 * link, dok czatu) - każde ma własny plik testowy, a tutaj liczy się WYŁĄCZNIE
 * to, które z nich są montowane i z jakimi propsami. Prawdziwe zostają:
 * `adPageTypeForLocation`, `useCommunityModules` (na prawdziwym `QueryClient`
 * z zasianym cache ustawień) i `React.lazy` doku czatu.
 *
 * RODO: użytkownik w atrapie to zmyślony identyfikator, bez danych osobowych.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface MatchLike {
  loaderData?: unknown;
  staticData?: unknown;
}

const h = vi.hoisted(() => ({
  pathname: "/",
  matches: [] as { loaderData?: unknown; staticData?: unknown }[],
  user: null as { id: string } | null,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: <T,>({
    select,
  }: {
    select: (state: { location: { pathname: string }; matches: MatchLike[] }) => T;
  }): T => select({ location: { pathname: h.pathname }, matches: h.matches }),
}));

vi.mock("@/components/Header", () => ({
  Header: ({ adPageType, contentKind }: { adPageType?: string; contentKind?: string | null }) => (
    <header
      data-testid="header"
      data-ad-page-type={String(adPageType)}
      data-content-kind={String(contentKind)}
    />
  ),
}));

vi.mock("@/components/Footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/mobile/MobileBottomBar", () => ({
  MobileBottomBar: () => <div data-testid="mobile-bottom-bar" />,
}));

vi.mock("@/components/RouteProgress", () => ({
  RouteProgress: () => <div data-testid="route-progress" />,
}));

vi.mock("@/components/admin/ImpersonationBanner", () => ({
  ImpersonationBanner: () => <div data-testid="impersonation-banner" />,
}));

vi.mock("@/components/atoms/SkipToContentLink", () => ({
  SkipToContentLink: () => <a data-testid="skip-link" href="#main-content" />,
}));

vi.mock("@/components/chat/ChatDock", () => ({
  ChatDock: () => <div data-testid="chat-dock" />,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, tenantId: null }),
}));

import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { SiteChrome } from "@/components/SiteChrome";

type SettingsSeed = Record<string, unknown>;

function wrap(client: QueryClient, ui: ReactNode): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function renderChrome(seed: SettingsSeed = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, seed);
  return render(
    wrap(
      client,
      <SiteChrome>
        <div data-testid="strona">treść trasy</div>
      </SiteChrome>,
    ),
  );
}

/** Rozwiązanie leniwego `ChatDock` (mikrozadanie). */
async function settleLazyChat(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.pathname = "/";
  h.matches = [];
  h.user = null;
});

afterEach(() => {
  cleanup();
});

describe("SiteChrome - powłoka publiczna", () => {
  it("opakowuje treść kompletem elementów powłoki", async () => {
    h.pathname = "/analizy";
    renderChrome();
    await settleLazyChat();

    expect(screen.getByTestId("route-progress")).toBeInTheDocument();
    expect(screen.getByTestId("impersonation-banner")).toBeInTheDocument();
    expect(screen.getByTestId("skip-link")).toBeInTheDocument();
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-bottom-bar")).toBeInTheDocument();
    expect(screen.getByTestId("strona")).toBeInTheDocument();
    expect(document.querySelector("[data-site-shell]")).not.toBeNull();
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("strona główna zostaje edge-to-edge, pozostałe dostają odstępy", async () => {
    h.pathname = "/";
    const home = renderChrome();
    await settleLazyChat();
    const homeMain = document.getElementById("main-content");
    expect(homeMain?.style.paddingTop).toBe("");
    expect(homeMain?.style.paddingBottom).toBe("");
    home.unmount();

    h.pathname = "/en";
    const homeEn = renderChrome();
    await settleLazyChat();
    expect(document.getElementById("main-content")?.style.paddingTop).toBe("");
    homeEn.unmount();

    h.pathname = "/analizy";
    renderChrome();
    await settleLazyChat();
    const main = document.getElementById("main-content");
    expect(main?.style.paddingTop).toBe("15px");
    expect(main?.style.paddingBottom).toBe("15px");
  });

  it("typ strony reklamowej liczy się ze ścieżki", async () => {
    h.pathname = "/category/geopolityka";
    renderChrome();
    await settleLazyChat();

    expect(screen.getByTestId("header")).toHaveAttribute("data-ad-page-type", "category");
    expect(screen.getByTestId("header")).toHaveAttribute("data-content-kind", "null");
  });

  it("kind z loaderData dopasowanej trasy jedzie do Headera i rozstrzyga typ wpisu", async () => {
    h.pathname = "/analizy/przyklad";
    h.matches = [{ loaderData: { nic: true } }, { loaderData: { kind: "post" } }];
    renderChrome();
    await settleLazyChat();

    const header = screen.getByTestId("header");
    expect(header).toHaveAttribute("data-content-kind", "post");
    expect(header).toHaveAttribute("data-ad-page-type", "post");
  });

  it("kind 'page' jest rozpoznawany tak samo jak 'post'", async () => {
    h.pathname = "/o-nas";
    h.matches = [{ loaderData: { kind: "page" } }];
    renderChrome();
    await settleLazyChat();

    expect(screen.getByTestId("header")).toHaveAttribute("data-ad-page-type", "page");
  });

  it("dopasowanie bez loaderData nie psuje odczytu kind", async () => {
    h.pathname = "/wydarzenia";
    h.matches = [{}, { loaderData: undefined }];
    renderChrome();
    await settleLazyChat();

    expect(screen.getByTestId("header")).toHaveAttribute("data-content-kind", "null");
  });
});

describe("SiteChrome - trasy z własnym układem", () => {
  it("panel admina renderuje samą treść, bez Headera i Footera", async () => {
    h.pathname = "/admin/posts";
    renderChrome();
    await settleLazyChat();

    expect(screen.queryByTestId("header")).toBeNull();
    expect(screen.queryByTestId("footer")).toBeNull();
    expect(screen.queryByTestId("mobile-bottom-bar")).toBeNull();
    expect(screen.getByTestId("skip-link")).toBeInTheDocument();
    expect(screen.getByTestId("impersonation-banner")).toBeInTheDocument();
    expect(screen.getByTestId("strona")).toBeInTheDocument();
    expect(document.querySelector("[data-site-shell]")).toBeNull();
  });

  it("ekran logowania też jest samodzielny", async () => {
    h.pathname = "/login";
    renderChrome();
    await settleLazyChat();

    expect(screen.queryByTestId("header")).toBeNull();
    expect(screen.getByTestId("skip-link")).toBeInTheDocument();
  });

  it("trasa z ownChrome traci Header i Footer ORAZ link do treści (renderuje własny)", async () => {
    h.pathname = "/strona-z-wlasnym-chrome";
    h.matches = [{ staticData: { inne: true } }, { staticData: { ownChrome: true } }];
    renderChrome();
    await settleLazyChat();

    expect(screen.queryByTestId("header")).toBeNull();
    expect(screen.queryByTestId("footer")).toBeNull();
    expect(screen.queryByTestId("skip-link")).toBeNull();
    expect(screen.getByTestId("strona")).toBeInTheDocument();
  });

  it("staticData bez flagi ownChrome zostawia zwykłą powłokę", async () => {
    h.pathname = "/analizy";
    h.matches = [{ staticData: { ownChrome: false } }, {}];
    renderChrome();
    await settleLazyChat();

    expect(screen.getByTestId("header")).toBeInTheDocument();
  });
});

describe("SiteChrome - dok czatu", () => {
  it("slot doku stoi w drzewie także wtedy, gdy czat się nie renderuje", async () => {
    renderChrome();
    await settleLazyChat();

    expect(document.querySelector("[data-chat-dock-slot]")).not.toBeNull();
    expect(screen.queryByTestId("chat-dock")).toBeNull();
  });

  it("zalogowany użytkownik przy włączonym module dostaje dok czatu", async () => {
    h.user = { id: "user-testowy" };
    renderChrome({ community_modules: { chat_enabled: true } });
    await settleLazyChat();

    expect(screen.getByTestId("chat-dock")).toBeInTheDocument();
  });

  it("wyłączony moduł czatu chowa dok mimo zalogowania", async () => {
    h.user = { id: "user-testowy" };
    renderChrome({ community_modules: { chat_enabled: false } });
    await settleLazyChat();

    expect(screen.queryByTestId("chat-dock")).toBeNull();
    expect(document.querySelector("[data-chat-dock-slot]")).not.toBeNull();
  });

  it("w panelu admina dok czatu nie wchodzi, nawet dla zalogowanego", async () => {
    h.user = { id: "user-testowy" };
    h.pathname = "/admin";
    renderChrome({ community_modules: { chat_enabled: true } });
    await settleLazyChat();

    expect(screen.queryByTestId("chat-dock")).toBeNull();
    expect(document.querySelector("[data-chat-dock-slot]")).not.toBeNull();
  });

  it("na ekranie logowania dok czatu również nie wchodzi", async () => {
    h.user = { id: "user-testowy" };
    h.pathname = "/login";
    renderChrome({ community_modules: { chat_enabled: true } });
    await settleLazyChat();

    expect(screen.queryByTestId("chat-dock")).toBeNull();
  });
});
