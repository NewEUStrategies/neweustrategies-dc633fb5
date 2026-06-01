// Strona potwierdzenia subskrypcji newslettera. Link z maila prowadzi tu z ?token=…
// Komponent wywołuje /api/public/newsletter/confirm i pokazuje wynik.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/newsletter/confirm")({ component: Page });

type State = "loading" | "ok" | "already" | "expired" | "error";

function Page() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) { setState("error"); setMsg("Brak tokenu w linku."); return; }
    fetch(`/api/public/newsletter/confirm?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (j?.ok && j?.already) return setState("already");
        if (j?.ok) return setState("ok");
        if (j?.error === "expired") return setState("expired");
        setState("error"); setMsg(j?.error ?? `HTTP ${r.status}`);
      })
      .catch((e) => { setState("error"); setMsg(String(e?.message ?? e)); });
  }, []);

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center border border-border rounded-xl p-8 bg-card space-y-3">
        {state === "loading" && <><Loader2 className="w-10 h-10 mx-auto animate-spin text-brand" /><p>Potwierdzanie subskrypcji…</p></>}
        {state === "ok" && <><CheckCircle2 className="w-10 h-10 mx-auto text-brand" /><h1 className="font-display text-2xl">Subskrypcja potwierdzona</h1><p className="text-sm text-muted-foreground">Dziękujemy — od teraz będziesz otrzymywać nasz newsletter.</p></>}
        {state === "already" && <><CheckCircle2 className="w-10 h-10 mx-auto text-brand" /><h1 className="font-display text-2xl">Już potwierdzono</h1><p className="text-sm text-muted-foreground">Ten adres jest już zapisany do newslettera.</p></>}
        {state === "expired" && <><XCircle className="w-10 h-10 mx-auto text-destructive" /><h1 className="font-display text-2xl">Link wygasł</h1><p className="text-sm text-muted-foreground">Zapisz się ponownie, aby otrzymać świeży link.</p></>}
        {state === "error" && <><XCircle className="w-10 h-10 mx-auto text-destructive" /><h1 className="font-display text-2xl">Nie udało się potwierdzić</h1><p className="text-sm text-muted-foreground">{msg || "Spróbuj ponownie lub skontaktuj się z redakcją."}</p></>}
        <Link to="/" className="inline-block mt-2 text-sm text-brand hover:underline">← Wróć na stronę główną</Link>
      </div>
    </main>
  );
}
