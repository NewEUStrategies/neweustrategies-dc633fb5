// Rozszerzony formularz popupu newslettera - zgodny z układem split.
// Dodatkowe pola są zapisywane w `meta jsonb` w tabeli subscribers, więc
// nie wymagamy migracji kolumn per field. Walidacja PL/EN, zgody RODO.
import { useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sanitizeHtml } from "@/lib/sanitize";
import { Check, Mail } from "@/lib/lucide-shim";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";

interface Props {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  source?: string;
  onSuccess?: () => void;
  compact?: boolean;
}

interface ExtendedFields {
  name: string;
  surname: string;
  job: string;
  company: string;
  linkedin: string;
  email: string;
  phone: string;
  list: string;
  terms: boolean;
}

const empty: ExtendedFields = {
  name: "", surname: "", job: "", company: "",
  linkedin: "", email: "", phone: "", list: "", terms: false,
};

export function NewsletterPopupForm({ settings, lang, source = "popup", onSuccess, compact = false }: Props) {
  const [v, setV] = useState<ExtendedFields>(empty);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [honey, setHoney] = useState("");
  const mountedAt = useRef<number>(Date.now());
  const subscribe = useServerFn(subscribeToNewsletter);

  const isPl = lang === "pl";
  const ext = settings.popup_extended_fields;
  const lists = settings.popup_mailing_lists ?? [];
  const showLists = lists.length > 0;
  const requireTerms = settings.popup_require_terms;

  const t = (pl: string, en: string) => (isPl ? pl : en);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);

    // Honeypot: bot fills hidden "website" field, or submits in <1.2s.
    // We silently "succeed" without writing to DB so bots get no signal.
    const elapsed = Date.now() - mountedAt.current;
    if (honey.trim() !== "" || elapsed < 1200) {
      setState("ok");
      setV(empty);
      onSuccess?.();
      return;
    }

    const email = v.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr(t("Niepoprawny adres e-mail.", "Invalid e-mail address."));
      setState("err");
      return;
    }

    if (ext) {
      const nameRe = /^[\p{L}\p{M}'’\- ]{2,80}$/u;
      if (v.name.trim() && !nameRe.test(v.name.trim())) {
        setErr(t("Imię zawiera niedozwolone znaki (min. 2 znaki).", "Name contains invalid characters (min. 2 chars)."));
        setState("err"); return;
      }
      if (v.surname.trim() && !nameRe.test(v.surname.trim())) {
        setErr(t("Nazwisko zawiera niedozwolone znaki (min. 2 znaki).", "Surname contains invalid characters (min. 2 chars)."));
        setState("err"); return;
      }
      if (v.linkedin.trim()) {
        const li = v.linkedin.trim();
        const liOk = /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/(in|pub|company)\/[A-Za-z0-9_\-%.]{2,100}\/?$/i.test(li);
        if (!liOk) {
          setErr(t("Niepoprawny URL LinkedIn (np. https://linkedin.com/in/jan-kowalski).", "Invalid LinkedIn URL (e.g. https://linkedin.com/in/jane-doe)."));
          setState("err"); return;
        }
      }
      if (v.phone.trim()) {
        const phone = v.phone.trim().replace(/[\s\-().]/g, "");
        if (!/^\+?[0-9]{7,15}$/.test(phone)) {
          setErr(t("Niepoprawny numer telefonu (7-15 cyfr, opcjonalnie z +).", "Invalid phone number (7-15 digits, optional leading +)."));
          setState("err"); return;
        }
      }
    }

    if (requireTerms && !v.terms) {
      setErr(t("Wymagana akceptacja regulaminu.", "Please accept the terms."));
      setState("err");
      return;
    }

    setState("loading");

    const displayName = [v.name.trim(), v.surname.trim()].filter(Boolean).join(" ");
    const meta: Record<string, string> = {};
    if (ext) {
      if (v.name.trim()) meta.first_name = v.name.trim();
      if (v.surname.trim()) meta.last_name = v.surname.trim();
      if (v.job.trim()) meta.job_position = v.job.trim();
      if (v.company.trim()) meta.company = v.company.trim();
      if (v.linkedin.trim()) meta.linkedin = v.linkedin.trim();
      if (v.phone.trim()) meta.phone = v.phone.trim();
    }
    if (showLists && v.list) meta.mailing_list = v.list;

    try {
      const res = await subscribe({
        data: {
          email,
          name: displayName || undefined,
          language: lang,
          source,
          meta: Object.keys(meta).length ? meta : undefined,
        },
      });
      if (!res.ok) {
        setErr(
          res.error === "not_configured" || res.error === "disabled"
            ? t("Newsletter nie jest skonfigurowany.", "Newsletter is not configured.")
            : res.error,
        );
        setState("err");
        return;
      }
      setState("ok");
      setV(empty);
      onSuccess?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setState("err");
    }
  };

  const upd = <K extends keyof ExtendedFields>(k: K, val: ExtendedFields[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const cta = isPl ? settings.popup_cta_pl : settings.popup_cta_en;
  const successMsg = isPl ? settings.success_message_pl : settings.success_message_en;
  const termsHtml = (isPl ? settings.popup_terms_html_pl : settings.popup_terms_html_en) ?? "";

  if (state === "ok") {
    const doi = settings.double_opt_in;
    const headline = doi
      ? t("Sprawdź swoją skrzynkę!", "Check your inbox!")
      : t("Zapisano. Dziękujemy!", "You're in. Thanks!");
    const body = doi
      ? t(
          "Wysłaliśmy link potwierdzający - kliknij go w ciągu 48 godzin, aby aktywować subskrypcję. Sprawdź też folder Spam.",
          "We've sent you a confirmation link - click it within 48 hours to activate your subscription. Please also check your Spam folder.",
        )
      : successMsg;
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-5 space-y-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            {doi ? <Mail className="w-5 h-5 text-emerald-300" /> : <Check className="w-5 h-5 text-emerald-300" />}
          </div>
          <h3 className="font-display text-lg text-emerald-100">{headline}</h3>
        </div>
        <p className="text-sm text-emerald-100/80 leading-relaxed">{body}</p>
        {doi && (
          <p className="text-[11px] text-emerald-100/60">
            {t("Status: oczekuje potwierdzenia (double opt-in).",
               "Status: pending confirmation (double opt-in).")}
          </p>
        )}
      </div>
    );
  }

  const inputCls = compact
    ? "w-full px-3 py-2 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/50 text-sm focus:outline-none focus:border-[var(--brand,#f97316)]"
    : "w-full px-3.5 py-2.5 rounded-md bg-white/5 border border-white/10 text-white placeholder-white/50 text-sm focus:outline-none focus:border-[var(--brand,#f97316)] focus:bg-white/10 transition-colors";

  return (
    <form onSubmit={onSubmit} className="space-y-2.5" noValidate>
      {/* Honeypot: hidden from real users (CSS + tabIndex + aria-hidden), tempting for bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honey}
            onChange={(e) => setHoney(e.target.value)}
          />
        </label>
      </div>

      {ext && (
        <>
          <input className={inputCls} placeholder={t("Imię", "Name")} value={v.name}
            onChange={(e) => upd("name", e.target.value)} maxLength={80} />
          <input className={inputCls} placeholder={t("Nazwisko", "Surname")} value={v.surname}
            onChange={(e) => upd("surname", e.target.value)} maxLength={80} />
          <input className={inputCls} placeholder={t("Stanowisko", "Job position")} value={v.job}
            onChange={(e) => upd("job", e.target.value)} maxLength={120} />
          <input className={inputCls} placeholder={t("Firma / organizacja", "Company")} value={v.company}
            onChange={(e) => upd("company", e.target.value)} maxLength={120} />
          <input className={inputCls} placeholder="LinkedIn" value={v.linkedin}
            onChange={(e) => upd("linkedin", e.target.value)} maxLength={200} />
        </>
      )}
      <input className={inputCls} type="email" required placeholder={t("Twój e-mail", "Your e-mail")}
        value={v.email} onChange={(e) => upd("email", e.target.value)} maxLength={254} />
      {ext && (
        <input className={inputCls} type="tel" placeholder={t("Numer telefonu", "Phone number")}
          value={v.phone} onChange={(e) => upd("phone", e.target.value)} maxLength={32} />
      )}
      {showLists && (
        <select className={inputCls} value={v.list} onChange={(e) => upd("list", e.target.value)}>
          <option value="">{t("Wybierz listę mailingową", "Choose your main mailing list")}</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>{isPl ? l.label_pl : l.label_en}</option>
          ))}
        </select>
      )}

      <div className="pt-1">
        <button
          type="submit"
          disabled={state === "loading"}
          className="px-5 py-2 rounded-md bg-[var(--brand,#f97316)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {state === "loading" ? "…" : cta}
        </button>
      </div>

      {requireTerms && (
        <label className="flex items-start gap-2 text-[12px] text-white/70 leading-relaxed pt-1">
          <input type="checkbox" checked={v.terms}
            onChange={(e) => upd("terms", e.target.checked)}
            className="mt-0.5 accent-[var(--brand,#f97316)]" />
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(termsHtml) }} />
        </label>
      )}

      {state === "err" && err && (
        <p className="text-xs text-red-300">{err}</p>
      )}

      <p className="text-[11px] text-white/50 pt-1">
        {t("Zero spamu. Możesz się wypisać w każdej chwili.", "Zero spam, unsubscribe at any time.")}
      </p>
    </form>
  );
}
