import { useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, type ReactNode } from "react";
import { Header } from "@/components/Header";
import { adPageTypeForLocation } from "@/lib/ads/pageType";
import { Footer } from "@/components/Footer";
import { RouteProgress } from "@/components/RouteProgress";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { SkipToContentLink } from "@/components/atoms/SkipToContentLink";
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";

const ChatDock = lazy(() =>
  import("@/components/chat/ChatDock").then((m) => ({ default: m.ChatDock })),
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
  const community = useCommunityModules();

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  // Auth-gated + globalny toggle chat_enabled z site_settings.community_modules.
  // Superadmin może wyłączyć chat globalnie z /admin/community bez rebuildu.
  const chatDock =
    !user || isAdmin || isLogin || !community.chat_enabled ? null : (
      <Suspense fallback={null}>
        <ChatDock />
      </Suspense>
    );

  if (isAdmin || isLogin || ownChrome) {
    return (
      <>
        {(isAdmin || isLogin) && <SkipToContentLink />}
        <ImpersonationBanner />
        <RouteProgress />
        {children}
        {chatDock}
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContentLink />
      <ImpersonationBanner />
      <RouteProgress />
      <Header adPageType={adPageTypeForLocation(pathname, contentKind)} />
      <main id="main-content" className="flex-1" style={{ viewTransitionName: "site-main" }}>
        {children}
      </main>
      <Footer />
      {chatDock}
    </div>
  );
}
