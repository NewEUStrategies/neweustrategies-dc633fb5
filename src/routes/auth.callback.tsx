// Docelowa trasa linku aktywacyjnego (/auth/callback). Supabase wraca tu po
// weryfikacji tokenu z e-maila - supabase-js (detectSessionInUrl) wymienia
// token z hasha na sesję, my czekamy na nią i przenosimy użytkownika na
// stronę powitalną z listą benefitów jego planu. Wcześniej ten adres nie
// istniał i link z maila kończył się stroną 404.
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

function AuthCallbackPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const isEn = i18n.language?.startsWith("en");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();

    const goWelcome = () => {
      if (cancelled) return;
      void navigate({ to: "/welcome", search: { mode: undefined }, replace: true });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) goWelcome();
    });

    const poll = window.setInterval(() => {
      void supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (data.session?.user) {
          goWelcome();
          return;
        }
        if (Date.now() - started > MAX_WAIT_MS) {
          window.clearInterval(poll);
          setFailed(true);
        }
      });
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="container mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
      {failed ? (
        <>
          <h1 className="text-xl font-semibold">
            {isEn ? "Activation link expired" : "Link aktywacyjny wygasł"}
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
