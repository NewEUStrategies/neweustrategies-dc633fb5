// Docelowa trasa linku aktywacyjnego (/auth/callback). Supabase wraca tu po
// weryfikacji tokenu z e-maila - supabase-js (detectSessionInUrl) wymienia
// token z hasha na sesję, my czekamy na nią i przenosimy użytkownika na
// stronę powitalną z listą benefitów jego planu. Wcześniej ten adres nie
// istniał i link z maila kończył się stroną 404.
//
// BŁĄD W ADRESIE = KOMUNIKAT OD RAZU. Dostawca przy wygasłym lub zużytym
// tokenie wraca tu z `#error=...&error_code=otp_expired`, a nasza trasa
// `/auth/activate` przy odrzuconym linku - z `?error=...`. Wcześniej oba
// przypadki kręciły spinnerem przez pełne MAX_WAIT_MS, choć z adresu było
// wiadomo od pierwszej klatki, że sesji nie będzie.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "@/lib/lucide-shim";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: AuthCallbackPage,
});

const MAX_WAIT_MS = 8_000;
const POLL_MS = 250;

/** Czy adres powrotu niesie błąd - w zapytaniu (nasza trasa) albo we fragmencie (dostawca). */
function urlCarriesError(location: Location): boolean {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  return query.has("error") || fragment.has("error") || fragment.has("error_code");
}

function AuthCallbackPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isEn = i18n.language?.startsWith("en");
  // Błąd z adresu rozstrzyga się raz, przy wejściu. Przekroczenie czasu to
  // osobny stan: po nim subskrypcja sesji zostaje, więc spóźniona sesja nadal
  // przenosi na stronę powitalną.
  const [failedOnArrival] = useState(() => urlCarriesError(window.location));
  const [timedOut, setTimedOut] = useState(false);
  const failed = failedOnArrival || timedOut;

  useEffect(() => {
    if (failedOnArrival) return;
    let cancelled = false;
    let poll = 0;
    const started = Date.now();

    // Jedna nawigacja na wejście: zdarzenie sesji i sondowanie mogą zobaczyć
    // użytkownika w tym samym oknie, a każde z nich wołało `navigate` osobno.
    const goWelcome = () => {
      if (cancelled) return;
      cancelled = true;
      window.clearInterval(poll);
      void navigate({ to: "/welcome", search: { mode: undefined }, replace: true });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) goWelcome();
    });

    poll = window.setInterval(() => {
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          goWelcome();
          return;
        }
        if (Date.now() - started > MAX_WAIT_MS) {
          window.clearInterval(poll);
          setTimedOut(true);
        }
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      sub.subscription.unsubscribe();
    };
  }, [navigate, failedOnArrival]);

  return (
    <div className="container mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
      {failed ? (
        <>
          <h1 className="text-xl font-semibold">
            {isEn ? "Activation link is no longer valid" : "Link aktywacyjny jest nieważny"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "Ask an administrator to resend the invitation, then open the link again."
              : "Poproś administratora o ponowne wysłanie zaproszenia i otwórz link jeszcze raz."}
          </p>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {isEn ? "Activating your account…" : "Aktywujemy Twoje konto…"}
          </p>
        </>
      )}
    </div>
  );
}
