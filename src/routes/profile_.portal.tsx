// Wejście do portalu operatora płatności z maila (`PROFILE_PORTAL_PATH`).
//
// PO CO TA STRONA. Sesja portalu operatora jest jednorazowa i żyje kilka minut,
// więc nie wolno jej wysyłać mailem - po godzinie w skrzynce link był martwy.
// Mail niesie więc STAŁY adres tej strony na hoście najemcy, a sesja powstaje
// dopiero tutaj: po otwarciu przez zalogowanego właściciela, po stronie
// serwera (`openMyBillingPortal`), wyłącznie dla użytkownika z sesji. Adres nie
// niesie identyfikatora konta - jedynym parametrem jest środowisko operatora.
//
// DLACZEGO POZA POWŁOKĄ `/profile` (`profile_.portal`). Powłoka dla gościa
// rysuje ekran 401 z linkiem do `/login`, a logowanie kończy się na stronie
// głównej - wejście z maila gubiłoby cel. Własna bramka otwiera logowanie
// W MIEJSCU (`openLoginPopup`); gdy sesja się pojawi, strona sama kontynuuje
// otwarcie portalu. Wyłączone okienko logowania schodzi na `/login` (decyzja
// panelu logowania) - wtedy wystarczy kliknąć link z maila jeszcze raz.
//
// Powrót z portalu: `/profile/plan` przez bramkę `absoluteReturnUrl`
// (`portalLink.server`), czyli istniejąca trasa na hoście serwisu.
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2, LogIn } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { openMyBillingPortal } from "@/lib/billing/portalLink.functions";
import { ensureI18n as ensureProfileI18n } from "@/lib/i18n-profile";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { getStripeEnvironmentSafe, type StripeEnv } from "@/lib/stripe";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PortalEntrySearch {
  environment?: StripeEnv;
}

/** Jedynym parametrem adresu jest środowisko - wszystko inne odpada. */
function validatePortalEntrySearch(search: Record<string, unknown>): PortalEntrySearch {
  const environment = search.environment;
  return environment === "live" || environment === "sandbox" ? { environment } : {};
}

export const Route = createFileRoute("/profile_/portal")({
  validateSearch: validatePortalEntrySearch,
  head: () => ({
    meta: [
      { title: "Portal płatności - Mój panel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BillingPortalEntryRoute,
});

type Phase = "opening" | "no_customer" | "failed";

/** Adres sesji od operatora - wyłącznie https, inaczej to nie jest portal. */
function isPortalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function BillingPortalEntryRoute() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureProfileI18n();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const { environment } = Route.useSearch();
  const openPortal = useServerFn(openMyBillingPortal);
  const [phase, setPhase] = useState<Phase>("opening");
  // Jedno otwarcie na wejście: podwójny efekt (StrictMode, zmiana tożsamości
  // obiektu sesji po odświeżeniu tokenu) nie może tworzyć drugiej sesji portalu.
  const started = useRef(false);

  const start = useCallback(async () => {
    setPhase("opening");
    try {
      const result = await openPortal({
        data: { environment: environment ?? getStripeEnvironmentSafe() },
      });
      if (result.ok && isPortalUrl(result.urls.overviewUrl)) {
        // `replace`: „wstecz" z portalu nie wraca na tę stronę - inaczej każde
        // cofnięcie otwierałoby kolejną sesję.
        window.location.replace(result.urls.overviewUrl);
        return;
      }
      setPhase(!result.ok && result.error === "no_customer" ? "no_customer" : "failed");
    } catch {
      setPhase("failed");
    }
  }, [openPortal, environment]);

  useEffect(() => {
    if (loading || !session || started.current) return;
    started.current = true;
    void start();
  }, [loading, session, start]);

  const tp = (key: string) => t(`profile.subscription.portal.${key}`);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          aria-label="loading"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
            {session ? tp("entry.title") : tp("entry.signInTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!session ? (
            <>
              <p className="text-muted-foreground">{tp("entry.signInBody")}</p>
              <Button
                type="button"
                onClick={() =>
                  openLoginPopup({
                    mode: "signin",
                    title: tp("entry.signInTitle"),
                    description: tp("entry.signInBody"),
                  })
                }
              >
                <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                {tp("entry.signInCta")}
              </Button>
            </>
          ) : phase === "opening" ? (
            <p
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-muted-foreground"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {tp("opening")}
            </p>
          ) : (
            <>
              <p role="alert" className="text-muted-foreground">
                {phase === "no_customer" ? tp("noCustomer") : tp("error")}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {phase === "failed" ? (
                  <Button type="button" onClick={() => void start()}>
                    {tp("entry.retry")}
                  </Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link to="/profile/plan">{tp("entry.back")}</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
