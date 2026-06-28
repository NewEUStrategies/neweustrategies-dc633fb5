// "Dołącz do nas" / "Join us" widget. Combines newsletter signup with
// optional interests tagging so newly subscribed users immediately receive
// personalized recommendations. Uses public RLS-insert into
// newsletter_subscribers and (for signed-in users) writes interests to
// user_follows.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { useInterestCatalog, useMyInterests } from "@/hooks/useInterests";
import { cn } from "@/lib/utils";
import "@/lib/i18n-interests";

interface Props {
  variant?: "card" | "split" | "inline";
  showInterests?: boolean;
  className?: string;
  source?: string;
  title?: string;
  subtitle?: string;
}

export function JoinUsForm({
  variant = "card",
  showInterests = true,
  className,
  source = "join-us",
  title,
  subtitle,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const { data: nl } = useNewsletterSettings();
  const catalog = useInterestCatalog(lang);
  const my = useMyInterests();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Pre-fill picks from current interests
  useEffect(() => {
    if (!my.data) return;
    setPicked(new Set([...my.data.categoryIds, ...my.data.tagIds]));
  }, [my.data]);

  const allItems = useMemo(() => {
    const cats = catalog.data?.categories ?? [];
    const tags = catalog.data?.tags ?? [];
    return [...cats, ...tags];
  }, [catalog.data]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (nl && !nl.enabled) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrMsg(t("joinUs.errorEmail"));
      setState("err");
      return;
    }

    // Resolve tenant
    const { data: site } = await supabase
      .from("newsletter_settings")
      .select("tenant_id")
      .maybeSingle();
    if (!site?.tenant_id) {
      setErrMsg(t("joinUs.errorGeneric"));
      setState("err");
      return;
    }

    const doubleOptIn = nl?.double_opt_in ?? false;
    const token =
      doubleOptIn && typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "")
        : null;

    const { error } = await supabase.from("newsletter_subscribers").insert({
      tenant_id: site.tenant_id,
      email: trimmed,
      display_name: name.trim() || null,
      language: lang,
      source,
      status: doubleOptIn ? "pending" : "subscribed",
      confirmed_at: doubleOptIn ? null : new Date().toISOString(),
      confirmation_token: token,
      confirmation_expires_at: doubleOptIn
        ? new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString()
        : null,
    });

    if (error) {
      if (error.code === "23505") setErrMsg(t("joinUs.duplicate"));
      else setErrMsg(error.message || t("joinUs.errorGeneric"));
      setState("err");
      return;
    }

    // Persist interests for signed-in users; anon → localStorage via save()
    if (showInterests && allItems.length) {
      const catIds = new Set(catalog.data?.categories.map((c) => c.id) ?? []);
      const tagIds = new Set(catalog.data?.tags.map((c) => c.id) ?? []);
      const nextCats: string[] = [];
      const nextTags: string[] = [];
      picked.forEach((id) => {
        if (catIds.has(id)) nextCats.push(id);
        else if (tagIds.has(id)) nextTags.push(id);
      });
      try {
        await my.save({ categoryIds: nextCats, tagIds: nextTags });
      } catch {
        /* non-fatal */
      }
    }

    setState("ok");
    setEmail("");
    setName("");
  };

  const heading = title || (lang === "en" ? nl?.heading_en : nl?.heading_pl) || t("joinUs.title");
  const description =
    subtitle || (lang === "en" ? nl?.description_en : nl?.description_pl) || t("joinUs.subtitle");

  const containerCls =
    variant === "inline"
      ? "border-t border-b border-border py-6"
      : variant === "split"
      ? "grid gap-6 rounded-xl border border-border bg-card p-6 sm:p-8 md:grid-cols-2"
      : "rounded-xl border border-border bg-card p-6 sm:p-8";

  if (state === "ok") {
    return (
      <section className={cn(containerCls, className)} aria-live="polite">
        <div className="flex items-center gap-3 text-foreground">
          <Check className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-medium">{t("joinUs.success")}</p>
        </div>
      </section>
    );
  }

  const form = (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("joinUs.name")}
          maxLength={120}
          className="px-3 py-2 rounded border border-input bg-background text-sm"
        />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("joinUs.email")}
          maxLength={254}
          className="px-3 py-2 rounded border border-input bg-background text-sm"
        />
      </div>

      {showInterests && allItems.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("joinUs.interestsLabel")}
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto pr-1">
            {allItems.map((it) => {
              const active = picked.has(it.id);
              return (
                <button
                  key={`${it.type}:${it.id}`}
                  type="button"
                  onClick={() => togglePick(it.id)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition",
                    active
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-background hover:border-brand/60",
                  )}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={state === "loading"}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
      >
        {state === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        {state === "loading" ? t("joinUs.submitting") : t("joinUs.submit")}
      </button>

      {state === "err" && errMsg && (
        <p className="text-xs text-destructive">{errMsg}</p>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("joinUs.consent")}</p>
    </form>
  );

  if (variant === "split") {
    return (
      <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
        <div>
          <h3 id="joinus-heading" className="font-display text-2xl mb-2">{heading}</h3>
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 text-brand" />{t("joinUs.perk1")}</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 text-brand" />{t("joinUs.perk2")}</li>
            <li className="flex items-start gap-2"><Check className="w-4 h-4 mt-0.5 text-brand" />{t("joinUs.perk3")}</li>
          </ul>
        </div>
        <div>{form}</div>
      </section>
    );
  }

  return (
    <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
      <h3 id="joinus-heading" className="font-display text-2xl mb-2">{heading}</h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {form}
    </section>
  );
}

export default JoinUsForm;
