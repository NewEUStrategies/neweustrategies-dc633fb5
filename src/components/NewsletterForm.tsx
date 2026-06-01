// Formularz zapisu do newslettera (publiczny). Wykorzystuje insertową
// politykę RLS pozwalającą każdemu dodać wiersz do newsletter_subscribers.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
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

    // tenant_id wynika z bieżącego site_settings - musimy go pobrać
    const { data: site } = await supabase.from("newsletter_settings").select("tenant_id").maybeSingle();
    if (!site?.tenant_id) {
      setErrMsg(lang === "en" ? "Newsletter is not configured." : "Newsletter nie jest skonfigurowany.");
      setState("err");
      return;
    }

    const token = s.double_opt_in && typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "")
      : null;

    const { error } = await supabase.from("newsletter_subscribers").insert({
      tenant_id: site.tenant_id,
      email: trimmed,
      display_name: name.trim() || null,
      language: lang,
      source,
      status: s.double_opt_in ? "pending" : "subscribed",
      confirmed_at: s.double_opt_in ? null : new Date().toISOString(),
      confirmation_token: token,
      confirmation_expires_at: s.double_opt_in
        ? new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString()
        : null,
    });

    if (error) {
      if (error.code === "23505") {
        setErrMsg(lang === "en" ? "This e-mail is already subscribed." : "Ten adres jest już zapisany.");
      } else {
        setErrMsg(error.message);
      }
      setState("err");
      return;
    }
    setState("ok");
    setEmail("");
    setName("");
  };

  const heading = lang === "en" ? s.heading_en : s.heading_pl;
  const description = lang === "en" ? s.description_en : s.description_pl;
  const policy = lang === "en" ? s.policy_html_en : s.policy_html_pl;
  const success = lang === "en" ? s.success_message_en : s.success_message_pl;

  const containerCls =
    variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-card my-10"
      : "border-t border-b border-border py-8 my-10";

  return (
    <section className={containerCls} aria-labelledby="newsletter-heading">
      <h3 id="newsletter-heading" className="font-display text-2xl mb-2">{heading}</h3>
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
        <p className="text-xs text-muted-foreground mt-3" dangerouslySetInnerHTML={{ __html: sanitizeHtml(policy) }} />
      )}
    </section>
  );
}
