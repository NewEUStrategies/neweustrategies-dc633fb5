// Docelowa trasa linku aktywacyjnego (/auth/callback). Supabase wraca tu po
// weryfikacji tokenu z e-maila - supabase-js (detectSessionInUrl) wymienia
// token z hasha na sesję, my czekamy na nią i przenosimy użytkownika na
// stronę powitalną z listą benefitów jego planu. Wcześniej ten adres nie
// istniał i link z maila kończył się stroną 404.
//
// BŁĄD W ADRESIE = JEDNO SPRAWDZENIE SESJI, POTEM KOMUNIKAT. Dostawca przy
// wygasłym lub zużytym tokenie wraca tu z `#error=...&error_code=otp_expired`,
// a nasza trasa `/auth/activate` przy odrzuconym linku - z `?error=...`.
// Wcześniej oba przypadki kręciły spinnerem przez pełne MAX_WAIT_MS.
// Błąd w adresie mówi jednak tylko, że TEN link nie dał sesji - nie, że sesji
// nie ma. supabase-js celowo zostawia zapisaną sesję przy nieudanym logowaniu
// z adresu (`GoTrueClient._initialize`: "Don't remove existing session on URL
// login failure. A failed attempt (e.g. reused magic link) shouldn't
// invalidate a valid session"). Najczęstszy przypadek to zalogowany już
// użytkownik, który klika to samo zaproszenie drugi raz - ma trafić na
// /welcome, a nie dostać polecenie proszenia administratora o nowy link.
// Dlatego przy błędzie sprawdzamy sesję RAZ (bez sondowania) i dopiero jej
// brak pokazuje komunikat.
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
/**
 * Twardy limit jednego sprawdzenia sesji przy błędzie w adresie. Odczyt sesji
 * zwykle trwa milisekundy (localStorage), ale przy WYGASŁEJ zapisanej sesji
 * `getSession()` odświeża token, a supabase-js ponawia nieudane odświeżenie
 * (5xx, błąd sieci) z narastającą przerwą - zmierzone na 2.116: ~25 s
 * spinnera. Limit nie czeka na tę odpowiedź; jeśli sesja jednak dojdzie,
 * subskrypcja nadal przeniesie użytkownika dalej.
 */
const ERROR_CHECK_DEADLINE_MS = 1_500;

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
  // Błąd z adresu rozstrzyga się raz, przy wejściu - zmienia tylko to, czy
  // sesję sprawdzamy raz, czy sondujemy do MAX_WAIT_MS.
  const [urlError] = useState(() => urlCarriesError(window.location));
  // Komunikat o nieważnym linku. Subskrypcja sesji zostaje także po nim, więc
  // spóźniona sesja nadal przenosi na stronę powitalną.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let poll = 0;
    let deadline = 0;

    // Jedna nawigacja na wejście: zdarzenie sesji i sondowanie mogą zobaczyć
    // użytkownika w tym samym oknie, a każde z nich wołało `navigate` osobno.
    const goWelcome = () => {
      if (cancelled) return;
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      void navigate({ to: "/welcome", search: { mode: undefined }, replace: true });
    };

    // Komunikat NIE wypisuje subskrypcji - spóźniona sesja nadal przenosi.
    const fail = () => {
      if (cancelled) return;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      setFailed(true);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) goWelcome();
    });

    // Odrzucony odczyt sesji traktujemy jak jej brak: przy błędzie w adresie
    // to komunikat, a przy sondowaniu - kolejna próba.
    const check = () =>
      supabase.auth.getSession().then(
        ({ data }) => {
          if (data.session?.user) goWelcome();
          else if (urlError) fail();
        },
        () => {
          if (urlError) fail();
        },
      );

    // Limit czasu liczony zegarem, nie wewnątrz odpowiedzi `getSession()` -
    // wiszące odświeżenie tokenu nie może trzymać spinnera w nieskończoność.
    deadline = window.setTimeout(fail, urlError ? ERROR_CHECK_DEADLINE_MS : MAX_WAIT_MS);
    if (urlError) void check();
    else poll = window.setInterval(() => void check(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      sub.subscription.unsubscribe();
    };
  }, [navigate, urlError]);

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
