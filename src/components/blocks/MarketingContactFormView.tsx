// Public Gutenberg contact form; isolated from the eager hero/CTA module.
// Owner: Fundacja New European Strategies.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";

type Lang = "pl" | "en";

// ===== Contact Form =====

interface ContactFormProps {
  title?: string;
  description?: string;
  showPhone?: boolean;
  showSubject?: boolean;
  requireConsent?: boolean;
  submitLabel?: string;
  successMessage?: string;
  lang?: Lang;
  cls?: string;
}

const CONTACT_L = {
  pl: {
    name: "Imię i nazwisko",
    email: "Adres e-mail",
    phone: "Telefon",
    subject: "Temat",
    message: "Wiadomość",
    consent: "Wyrażam zgodę na przetwarzanie danych w celu udzielenia odpowiedzi.",
    submit: "Wyślij wiadomość",
    sending: "Wysyłanie...",
    success: "Dziękujemy - wiadomość została wysłana.",
    error: "Nie udało się wysłać wiadomości. Spróbuj ponownie.",
    consentRequired: "Wymagana zgoda na przetwarzanie danych.",
  },
  en: {
    name: "Full name",
    email: "Email address",
    phone: "Phone",
    subject: "Subject",
    message: "Message",
    consent: "I agree to data processing to receive a reply.",
    submit: "Send message",
    sending: "Sending...",
    success: "Thanks - your message has been sent.",
    error: "Could not send the message. Please try again.",
    consentRequired: "Consent is required to submit.",
  },
} as const;

export function ContactFormView({
  title,
  description,
  showPhone = false,
  showSubject = true,
  requireConsent = true,
  submitLabel,
  successMessage,
  lang = "pl",
  cls,
}: ContactFormProps) {
  const t = CONTACT_L[lang];
  const submit = useServerFn(submitContactMessage);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(!requireConsent);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireConsent && !consent) {
      setStatus("err");
      setErrMsg(t.consentRequired);
      return;
    }
    setStatus("loading");
    setErrMsg("");
    try {
      // Publiczny INSERT do contact_messages jest zablokowany na poziomie RLS
      // (migracja 20260730130000) - zapis musi iść przez utwardzony server fn
      // (walidacja + rate limit + tenant pinowany po hoście + service_role).
      await submit({
        data: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          subject: subject.trim() || undefined,
          message: message.trim(),
          consent,
          lang,
          source: typeof window !== "undefined" ? window.location.pathname : undefined,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
          consents: requireConsent
            ? [{ key: "rodo", text: t.consent, given: consent, lang }]
            : undefined,
        },
      });
      setStatus("ok");
      setName("");
      setEmail("");
      setPhone("");
      setSubject("");
      setMessage("");
      if (requireConsent) setConsent(false);
    } catch {
      setStatus("err");
      setErrMsg(t.error);
    }
  };

  const success = successMessage || t.success;

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 ${cls ?? ""}`}>
      {title ? (
        <h2 className="font-serif text-xl md:text-2xl font-bold text-foreground">{title}</h2>
      ) : null}
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            {t.name}
            <input
              required
              autoComplete="name"
              className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t.email}
            <input
              required
              type="email"
              autoComplete="email"
              className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {showPhone ? (
            <label className="block text-xs text-muted-foreground">
              {t.phone}
              <input
                type="tel"
                autoComplete="tel"
                className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          ) : null}
          {showSubject ? (
            <label className="block text-xs text-muted-foreground">
              {t.subject}
              <input
                className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        <label className="block text-xs text-muted-foreground">
          {t.message}
          <textarea
            required
            className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 min-h-[120px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {requireConsent ? (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t.consent}</span>
          </label>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === "loading"}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {status === "loading" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
            {status === "loading" ? t.sending : submitLabel || t.submit}
          </button>
          {status === "ok" ? (
            <span className="text-sm text-emerald-600" role="status">
              {success}
            </span>
          ) : null}
          {status === "err" ? (
            <span className="text-sm text-destructive" role="alert">
              {errMsg || t.error}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
