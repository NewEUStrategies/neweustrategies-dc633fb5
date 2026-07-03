// Formularz zapisu do newslettera (publiczny). Zapis idzie przez serwerową
// funkcję subscribeToNewsletter (double opt-in + wysyłka maila potwierdzającego
// po stronie serwera); token potwierdzenia nigdy nie powstaje w przeglądarce.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { sanitizeHtml } from "@/lib/sanitize";

interface Props {
  lang?: "pl" | "en";
  source?: string;
  variant?: "card" | "inline";
}

export function NewsletterForm({ lang = "pl", source = "post-bottom", variant = "card" }: Props) {
  const { data: s } = useNewsletterSettings();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const subscribe = useServerFn(subscribeToNewsletter);

  if (!s || !s.enabled) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrMsg(lang === "en" ? "Invalid e-mail address." : "Niepoprawny adres e-mail.");
      setState("err");
      return;
    }

    try {
      const res = await subscribe({
        data: { email: trimmed, name: name.trim() || undefined, language: lang, source },
      });
      if (!res.ok) {
        setErrMsg(
          res.error === "not_configured" || res.error === "disabled"
            ? lang === "en"
              ? "Newsletter is not configured."
              : "Newsletter nie jest skonfigurowany."
            : res.error,
        );
        setState("err");
        return;
      }
      setState("ok");
      setEmail("");
      setName("");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setState("err");
    }
  };

  const heading = lang === "en" ? s.heading_en : s.heading_pl;
  const description = lang === "en" ? s.description_en : s.description_pl;
  const policy = lang === "en" ? s.policy_html_en : s.policy_html_pl;
  const success = lang === "en" ? s.success_message_en : s.success_message_pl;

  const containerCls =
    variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-card"
      : "border-t border-b border-border py-8";

  return (
    <section className={containerCls} aria-labelledby="newsletter-heading">
      <h3 id="newsletter-heading" className="font-display text-2xl mb-2">
        {heading}
      </h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {state === "ok" ? (
        <p className="text-sm font-medium text-foreground bg-muted rounded p-3">{success}</p>
      ) : (
        <form onSubmit={onSubmit} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lang === "en" ? "Name (optional)" : "Imię (opcjonalnie)"}
            className="px-3 py-2 rounded border border-input bg-background text-sm"
            maxLength={120}
          />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={lang === "en" ? "your@email.com" : "twoj@email.com"}
            className="px-3 py-2 rounded border border-input bg-background text-sm"
            maxLength={254}
          />
          <button
            type="submit"
            disabled={state === "loading"}
            className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium disabled:opacity-60"
          >
            {state === "loading" ? "…" : lang === "en" ? "Subscribe" : "Zapisz się"}
          </button>
        </form>
      )}
      {state === "err" && errMsg && <p className="text-xs text-destructive mt-2">{errMsg}</p>}
      {policy && (
        <p
          className="text-xs text-muted-foreground mt-3"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(policy) }}
        />
      )}
    </section>
  );
}
