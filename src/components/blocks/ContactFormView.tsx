// Structural contact form widget — submits via createServerFn (no raw HTML markup).
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";

type Lang = "pl" | "en";
type Cfg = Record<string, unknown>;

function s(data: Cfg, key: string, fallback = ""): string {
  const v = data[key];
  return typeof v === "string" ? v : fallback;
}
function b(data: Cfg, key: string, fallback = false): boolean {
  const v = data[key];
  return typeof v === "boolean" ? v : fallback;
}

const T = {
  pl: {
    name: "Imię i nazwisko", email: "E-mail", phone: "Telefon", company: "Firma",
    subject: "Temat", message: "Wiadomość",
    consent: "Wyrażam zgodę na przetwarzanie danych w celu odpowiedzi na zapytanie.",
    required: "Pole wymagane", invalidEmail: "Niepoprawny adres e-mail",
    sending: "Wysyłanie...", error: "Wystąpił błąd. Spróbuj ponownie.",
  },
  en: {
    name: "Full name", email: "Email", phone: "Phone", company: "Company",
    subject: "Subject", message: "Message",
    consent: "I agree to processing of my data to receive a reply.",
    required: "Required field", invalidEmail: "Invalid email address",
    sending: "Sending...", error: "Something went wrong. Please try again.",
  },
} as const;

export function ContactFormView({ data, lang }: { data: Cfg; lang: Lang }) {
  const t = T[lang];
  const submit = useServerFn(submitContactMessage);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const variant = s(data, "variant", "card");
  const title = s(data, `title_${lang}`);
  const subtitle = s(data, `subtitle_${lang}`);
  const submitLabel = s(data, `submitLabel_${lang}`, lang === "pl" ? "Wyślij" : "Send");
  const successMsg = s(data, `successMsg_${lang}`, lang === "pl" ? "Wysłano!" : "Sent!");
  const showPhone = b(data, "showPhone");
  const showCompany = b(data, "showCompany");
  const showSubject = b(data, "showSubject", true);
  const requireConsent = b(data, "requireConsent", true);
  const recipient = s(data, "recipient");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // honeypot
    if ((fd.get("website") as string)?.length) return;
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || undefined,
      company: String(fd.get("company") ?? "").trim() || undefined,
      subject: String(fd.get("subject") ?? "").trim() || undefined,
      message: String(fd.get("message") ?? "").trim(),
      consent: fd.get("consent") === "on",
      lang,
      recipient: recipient || undefined,
    };
    const errs: Record<string, string> = {};
    if (!payload.name) errs.name = t.required;
    if (!payload.email) errs.email = t.required;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errs.email = t.invalidEmail;
    if (!payload.message) errs.message = t.required;
    if (requireConsent && !payload.consent) errs.consent = t.required;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setStatus("sending");
    try {
      await submit({ data: payload });
      setStatus("ok");
      (e.target as HTMLFormElement).reset();
    } catch {
      setStatus("err");
    }
  }

  if (status === "ok") {
    return (
      <div className={variant === "card" ? "rounded-lg border border-border bg-card p-8 text-center" : "p-4 text-center"}>
        <p className="text-lg font-semibold">{successMsg}</p>
      </div>
    );
  }

  const wrap = variant === "card" ? "rounded-lg border border-border bg-card p-6 sm:p-8" : "";

  return (
    <form onSubmit={onSubmit} className={`space-y-4 ${wrap}`} noValidate>
      {(title || subtitle) && (
        <header className="space-y-1">
          {title && <h3 className="text-xl font-semibold">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </header>
      )}
      {/* honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off"
        className="absolute h-0 w-0 -left-[9999px] opacity-0" aria-hidden="true" />

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t.name} error={errors.name}>
          <input name="name" required className="cf-input" autoComplete="name" />
        </Field>
        <Field label={t.email} error={errors.email}>
          <input name="email" type="email" required className="cf-input" autoComplete="email" />
        </Field>
        {showPhone && (
          <Field label={t.phone}>
            <input name="phone" type="tel" className="cf-input" autoComplete="tel" />
          </Field>
        )}
        {showCompany && (
          <Field label={t.company}>
            <input name="company" className="cf-input" autoComplete="organization" />
          </Field>
        )}
      </div>
      {showSubject && (
        <Field label={t.subject}>
          <input name="subject" className="cf-input" />
        </Field>
      )}
      <Field label={t.message} error={errors.message}>
        <textarea name="message" rows={5} required className="cf-input resize-y" />
      </Field>
      {requireConsent && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="consent" className="mt-0.5" />
          <span>{t.consent}</span>
          {errors.consent && <span className="text-destructive ml-1">*</span>}
        </label>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {status === "sending" ? t.sending : submitLabel}
      </button>
      {status === "err" && <p className="text-sm text-destructive">{t.error}</p>}

      <style>{`.cf-input{display:block;width:100%;border:1px solid hsl(var(--border));background:hsl(var(--background));border-radius:6px;padding:8px 10px;font-size:14px;line-height:1.4;color:inherit;outline:none}.cf-input:focus{border-color:hsl(var(--primary));box-shadow:0 0 0 2px hsl(var(--primary)/0.2)}`}</style>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {children}
      {error && <span className="block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
