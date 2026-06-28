import { useRouterState } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { RouteProgress } from "@/components/RouteProgress";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";

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
  const { pathname, ownChrome } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      ownChrome: s.matches.some(
        (m) => (m.staticData as { ownChrome?: boolean } | undefined)?.ownChrome === true,
      ),
    }),
  });

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  if (isAdmin || isLogin || ownChrome) {
    return (
      <>
        <RouteProgress />
        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <RouteProgress />
      <Header />
      <main
        className="flex-1"
        style={{ viewTransitionName: "site-main" }}
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
