// Strona samoobsługowego wypisania z newslettera. Link z maila prowadzi tu z ?token=…
// Pierwszy GET walidacyjnie sprawdza token, dopiero kliknięcie „Potwierdź wypisanie"
// wysyła POST i finalizuje operację (zapobiega niechcianym wypisom przez
// prefetch/skanery URL w klientach pocztowych).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Loader2, MailX } from "lucide-react";

export const Route = createFileRoute("/newsletter/unsubscribe")({
  head: () => ({
    meta: [{ title: "Unsubscribe" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Page,
});

type State = "loading" | "confirm" | "already" | "ok" | "invalid" | "error";

function Page() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const token =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("token") ?? "")
      : "";

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    fetch(`/api/public/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          already?: boolean;
          error?: string;
          email?: string;
        };
        if (!j.ok) {
          if (j.error === "invalid_token" || j.error === "not_found") return setState("invalid");
          setDetail(j.error ?? `HTTP ${r.status}`);
          return setState("error");
        }
        setEmail(j.email ?? null);
        setState(j.already ? "already" : "confirm");
      })
      .catch((e: unknown) => {
        setState("error");
        setDetail(e instanceof Error ? e.message : String(e));
      });
  }, [token]);

  async function confirm() {
    setBusy(true);
    try {
      const r = await fetch("/api/public/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) setState("ok");
      else {
        setDetail(j.error ?? `HTTP ${r.status}`);
        setState("error");
      }
    } catch (e) {
      setDetail(e instanceof Error ? e.message : String(e));
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center border border-border rounded-xl p-8 bg-card space-y-3">
        {state === "loading" && (
          <>
            <Loader2 className="w-10 h-10 mx-auto animate-spin text-brand" />
            <p>{t("newsletter.unsubscribePage.loading")}</p>
          </>
        )}
        {state === "confirm" && (
          <>
            <MailX className="w-10 h-10 mx-auto text-brand" />
            <h1 className="font-display text-2xl">{t("newsletter.unsubscribePage.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {email
                ? t("newsletter.unsubscribePage.bodyWithEmail", { email })
                : t("newsletter.unsubscribePage.body")}
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-block mt-2 rounded-md bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? t("newsletter.unsubscribePage.working")
                : t("newsletter.unsubscribePage.confirmBtn")}
            </button>
          </>
        )}
        {(state === "ok" || state === "already") && (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto text-brand" />
            <h1 className="font-display text-2xl">
              {t(
                state === "ok"
                  ? "newsletter.unsubscribePage.okTitle"
                  : "newsletter.unsubscribePage.alreadyTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                state === "ok"
                  ? "newsletter.unsubscribePage.okBody"
                  : "newsletter.unsubscribePage.alreadyBody",
              )}
            </p>
          </>
        )}
        {(state === "invalid" || state === "error") && (
          <>
            <XCircle className="w-10 h-10 mx-auto text-destructive" />
            <h1 className="font-display text-2xl">
              {t(
                state === "invalid"
                  ? "newsletter.unsubscribePage.invalidTitle"
                  : "newsletter.unsubscribePage.errorTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {state === "invalid"
                ? t("newsletter.unsubscribePage.invalidBody")
                : detail || t("newsletter.unsubscribePage.errorBody")}
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
