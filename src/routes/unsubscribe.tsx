import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, MailX } from "lucide-react";

import { Button } from "@/components/ui/button";

type UnsubscribeState = "checking" | "ready" | "submitting" | "success" | "used" | "invalid";

export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [
      { title: "Rezygnacja z wiadomości | New European Strategies" },
      {
        name: "description",
        content: "Bezpieczne zarządzanie zgodą na wiadomości New European Strategies.",
      },
      { property: "og:title", content: "Rezygnacja z wiadomości | New European Strategies" },
      {
        property: "og:description",
        content: "Bezpieczne zarządzanie zgodą na wiadomości New European Strategies.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const token =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState<UnsubscribeState>(token ? "checking" : "invalid");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) return setState("invalid");
        if (typeof body === "object" && body !== null && "valid" in body && body.valid === true) {
          setState("ready");
          return;
        }
        setState("used");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setState("invalid");
      });
    return () => controller.abort();
  }, [token]);

  const unsubscribe = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const response = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body: unknown = await response.json();
      if (
        response.ok &&
        typeof body === "object" &&
        body !== null &&
        "success" in body &&
        body.success === true
      ) {
        setState("success");
      } else if (response.ok) {
        setState("used");
      } else {
        setState("invalid");
      }
    } catch {
      setState("invalid");
    }
  };

  const busy = state === "checking" || state === "submitting";
  const complete = state === "success" || state === "used";

  return (
    <main className="mx-auto flex min-h-[58vh] w-full max-w-xl items-center px-4 py-16">
      <section className="w-full border-y border-border py-10 text-center">
        {busy ? (
          <Loader2 className="mx-auto size-7 animate-spin text-primary" aria-hidden />
        ) : complete ? (
          <CheckCircle2 className="mx-auto size-7 text-primary" aria-hidden />
        ) : (
          <MailX className="mx-auto size-7 text-primary" aria-hidden />
        )}
        <h1 className="mt-5 font-display text-2xl">
          {state === "ready"
            ? "Potwierdź rezygnację"
            : complete
              ? "Preferencje zostały zapisane"
              : busy
                ? "Sprawdzamy link"
                : "Link jest nieprawidłowy lub wygasł"}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[0.8125rem] text-muted-foreground">
          {state === "ready"
            ? "Po potwierdzeniu nie będziemy wysyłać na ten adres wiadomości objętych rezygnacją."
            : complete
              ? "Nie musisz wykonywać żadnych dodatkowych działań."
              : busy
                ? "To potrwa tylko chwilę."
                : "Poproś o nowy link lub skontaktuj się z zespołem New European Strategies."}
        </p>
        {state === "ready" ? (
          <Button className="mt-6 h-11 rounded-[6px]" onClick={unsubscribe}>
            Potwierdzam rezygnację
          </Button>
        ) : null}
      </section>
    </main>
  );
}
