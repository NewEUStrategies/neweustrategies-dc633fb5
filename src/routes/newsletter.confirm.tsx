// Strona potwierdzenia subskrypcji newslettera. Link z maila prowadzi tu z ?token=…
// Komponent wywołuje /api/public/newsletter/confirm (JSON) i pokazuje wynik
// w języku interfejsu (PL/EN). Re-klik potwierdzonego linku renderuje stan
// "już potwierdzono" - endpoint jest idempotentny.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/newsletter/confirm")({ component: Page });

type State = "loading" | "ok" | "already" | "expired" | "error";

function Page() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("error");
      return;
    }
    fetch(`/api/public/newsletter/confirm?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          already?: boolean;
          error?: string;
        };
        if (j.ok && j.already) return setState("already");
        if (j.ok) return setState("ok");
        if (j.error === "expired") return setState("expired");
        setState("error");
        setDetail(j.error ?? `HTTP ${r.status}`);
      })
      .catch((e: unknown) => {
        setState("error");
        setDetail(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center border border-border rounded-xl p-8 bg-card space-y-3">
        {state === "loading" && (
          <>
            <Loader2 className="w-10 h-10 mx-auto animate-spin text-brand" />
            <p>{t("newsletter.confirmPage.loading")}</p>
          </>
        )}
        {(state === "ok" || state === "already") && (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto text-brand" />
            <h1 className="font-display text-2xl">
              {t(
                state === "ok"
                  ? "newsletter.confirmPage.okTitle"
                  : "newsletter.confirmPage.alreadyTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                state === "ok"
                  ? "newsletter.confirmPage.okBody"
                  : "newsletter.confirmPage.alreadyBody",
              )}
            </p>
          </>
        )}
        {(state === "expired" || state === "error") && (
          <>
            <XCircle className="w-10 h-10 mx-auto text-destructive" />
            <h1 className="font-display text-2xl">
              {t(
                state === "expired"
                  ? "newsletter.confirmPage.expiredTitle"
                  : "newsletter.confirmPage.errorTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {state === "expired"
                ? t("newsletter.confirmPage.expiredBody")
                : detail || t("newsletter.confirmPage.errorBody")}
            </p>
          </>
        )}
        <Link to="/" className="inline-block mt-2 text-sm text-brand hover:underline">
          {t("newsletter.confirmPage.backHome")}
        </Link>
      </div>
    </main>
  );
}
