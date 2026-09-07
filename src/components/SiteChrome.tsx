import { useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, type CSSProperties, type ReactNode } from "react";
import { Header } from "@/components/Header";
import { adPageTypeForLocation } from "@/lib/ads/pageType";
import { Footer } from "@/components/Footer";

import { RouteProgress } from "@/components/RouteProgress";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { SkipToContentLink } from "@/components/atoms/SkipToContentLink";
import { useAuth } from "@/hooks/useAuth";

// Przestrzeń robocza członka (pasek narzędzi: czat, zadania, notatki,
// zapisane, kalendarz, do przeczytania). Lazy - gość nie pobiera jej kodu.
const WorkspaceDock = lazy(() =>
  import("@/components/dock/WorkspaceDock").then((m) => ({ default: m.WorkspaceDock })),
);

/**
 * Global layout chrome. Renders <Header/> and <Footer/> around every route
 * EXCEPT:
 *   - /admin/*  -> admin shell owns its own layout
 *   - /login    -> standalone auth screen
 *   - routes that opted in via `staticData: { ownChrome: true }` (they
 *     already render Header/Footer themselves with custom logic, e.g. the
 *     dynamic page renderer in src/routes/$.tsx which honours
 *     `header_override`).
 *
 * This guarantees every public surface (profile, pricing, checkout, post,
 * podcast, web stories, newsletter confirmation, ...) ships with the site
 * header and footer without each route having to wire them up.
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const { pathname, ownChrome, contentKind } = useRouterState({
    select: (s) => {
      // Wpis vs strona statyczna nie wynika z URL-a (catch-all $) - czytamy
      // kind z loaderData dopasowanej trasy, by baner nagłówka dostał właściwy
      // typ strony reklamowej (post/page) zamiast generycznego "all".
      let kind: "post" | "page" | null = null;
      for (const m of s.matches) {
        const ld = m.loaderData as { kind?: string } | undefined;
        if (ld?.kind === "post" || ld?.kind === "page") {
          kind = ld.kind;
          break;
        }
      }
      return {
        pathname: s.location.pathname,
        ownChrome: s.matches.some(
          (m) => (m.staticData as { ownChrome?: boolean } | undefined)?.ownChrome === true,
        ),
        contentKind: kind,
      };
    },
  });
  const { user } = useAuth();

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  // Pasek narzędzi członka: te same bramki co czat (zalogowany, poza /admin
  // i /login), ale bez zależności od toggle'a czatu - zadania i notatki
  // działają nawet przy wyłączonych rozmowach.
  const workspaceDock =
    !user || isAdmin || isLogin ? null : (
      <Suspense fallback={null}>
        <WorkspaceDock />
      </Suspense>
    );

  // Wszystkie strony poza główną dostają domyślny 15px odstęp góra/dół
  // między treścią a header/footer. Homepage zachowuje edge-to-edge hero.
  const isHome = pathname === "/" || pathname === "/en" || pathname === "/en/";
  const mainStyle: CSSProperties = {
    viewTransitionName: "site-main",
    ...(isHome ? null : { paddingTop: 15, paddingBottom: 15 }),
  };

  const body =
    isAdmin || isLogin || ownChrome ? (
      <>
        {(isAdmin || isLogin) && <SkipToContentLink />}
        <ImpersonationBanner />
        <RouteProgress />
        {children}
      </>
    ) : (
      // data-site-shell: stabilny uchwyt dla reguł, które muszą znać wysokość
      // powłoki strony - m.in. rezerwacja miejsca pod paskiem doku
      // (styles.css, html[data-mbb="on"]), która obniża min-height o zajęty pas.
      <div data-site-shell className="flex min-h-screen flex-col">
        <SkipToContentLink />
        <ImpersonationBanner />
        <RouteProgress />
        {/* contentKind idzie do headera nie tylko po reklamy: rozstrzyga, czy
            górną krawędź przejmuje ReadingHeader wpisu (lib/layout/headerMode). */}
        <Header
          adPageType={adPageTypeForLocation(pathname, contentKind)}
          contentKind={contentKind}
        />
        <main id="main-content" className="flex-1" style={mainStyle}>
          {children}
        </main>
        <Footer />
      </div>
    );

  // DOK STOI W JEDNEJ, STAŁEJ POZYCJI DRZEWA - drugie dziecko tego samego
  // fragmentu, niezależnie od wybranego wariantu powłoki.
  //
  // DLACZEGO TO MA ZNACZENIE. React uzgadnia drzewo po POZYCJI i typie. Dok
  // był renderowany z dwóch strukturalnie różnych rodziców - raz z fragmentu
  // gałęzi `admin`/`login`/`ownChrome`, raz z wnętrza `<div data-site-shell>` -
  // więc przejście przez tę granicę było ODMONTOWANIEM i świeżym montażem,
  // nie aktualizacją. Ścieżka jest realna: `staticData: { ownChrome: true }`
  // niesie trasa `/quiz`, czyli wyjście z quizu na dowolną stronę treści
  // przebudowywało dok od zera. Skutki były widoczne: otwarty panel cicho się
  // zamykał (`state.open` wracał do `null`), a sprzątanie pomiaru zdejmowało
  // `data-mbb` i `--mbb-space`, dając kolejną klatkę bez rezerwacji.
  // Poprawność zależała wyłącznie od kolejności, w jakiej React zatwierdza
  // usunięcia względem efektów nowego poddrzewa - czyli od wiedzy o wnętrzu
  // biblioteki, a nie od czegokolwiek napisanego w kodzie.
  return (
    <>
      {body}
      {workspaceDock}
    </>
  );
}
