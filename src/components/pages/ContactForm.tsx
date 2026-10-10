// Simple contact form rendered below the page content when
// template_type === 'contact'. Submits through the same hardened
// submitContactMessage server fn as the builder's ContactFormView widget
// (src/components/blocks/ContactFormView.tsx) - rate-limited, tenant-scoped,
// zod-validated, synced to the admin Contact Center + CRM. The success
// toast only fires once the server call actually resolves.
//
// Zgoda RODO jest RZECZYWISTA: wcześniej formularz wysyłał na sztywno
// `consent: true` bez żadnego pola, więc `contact_messages.consent` i rejestr
// `consents` poświadczały zgodę, której nikt nie wyraził (art. 7 ust. 1 RODO:
// administrator musi umieć WYKAZAĆ zgodę). Teraz bez zaznaczenia pola nie ma
// wywołania serwera, a do rejestru trafia dokładnie ta treść, którą
// użytkownik widział, w jego języku - jak w widżecie buildera.
import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";
import { FloatingInput } from "@/components/ui/floating-input";
import { MessageComposerField } from "@/components/forms/MessageComposerField";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CONTACT_FIELD_LIMITS, contactTextSchema } from "@/lib/forms/contactLimits";
import { CharacterCounter } from "@/components/forms/CharacterCounter";

interface Props {
  lang: "pl" | "en";
}

const L = {
  pl: {
    title: "Skontaktuj się z nami",
    name: "Imię i nazwisko",
    email: "E-mail",
    subject: "Temat",
    msg: "Wiadomość",
    send: "Wyślij",
    sending: "Wysyłanie...",
    required: "Wypełnij imię, e-mail i wiadomość.",
    invalidEmail: "Podaj poprawny adres e-mail.",
    consent: "Wyrażam zgodę na przetwarzanie moich danych w celu odpowiedzi na wiadomość.",
    consentRequired: "Zaznacz zgodę na przetwarzanie danych, aby wysłać wiadomość.",
    ok: "Wiadomość została wysłana.",
    error: "Nie udało się wysłać wiadomości. Spróbuj ponownie.",
    limits: "Sprawdź długość pól i poprawność adresu e-mail.",
  },
  en: {
    title: "Get in touch",
    name: "Full name",
    email: "Email",
    subject: "Subject",
    msg: "Message",
    send: "Send",
    sending: "Sending...",
    required: "Please fill in your name, email and message.",
    invalidEmail: "Please enter a valid email address.",
    consent: "I agree to the processing of my data in order to receive a reply.",
    consentRequired: "Please tick the data processing consent to send your message.",
    ok: "Your message has been sent.",
    error: "Could not send the message. Please try again.",
    limits: "Check field lengths and the email address.",
  },
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm({ lang }: Props) {
  const t = L[lang] ?? L.pl;
  const submit = useServerFn(submitContactMessage);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "ok">("idle");
  // Spójnie z komentarzami: przycisk "Wyślij" jest zablokowany, dopóki
  // wiadomość jest pusta / za długa (walidacja z ComposerShell).
  const [messageOk, setMessageOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const formId = useId();
  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const subjectId = `${formId}-subject`;
  const messageId = `${formId}-message`;
  const consentId = `${formId}-consent`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const message = form.message.trim();
    if (!name || !email || !message) {
      toast.error(t.required);
      return;
    }
    if (!EMAIL_RE.test(email)) {
      toast.error(t.invalidEmail);
      return;
    }
    if (!contactTextSchema.safeParse({ name, email, subject: form.subject, message }).success) {
      toast.error(t.limits);
      return;
    }
    if (!consent) {
      setConsentError(true);
      toast.error(t.consentRequired);
      return;
    }

    setStatus("sending");
    try {
      await submit({
        data: {
          name,
          email,
          subject: form.subject.trim() || undefined,
          message,
          consent,
          consents: [{ key: "rodo", text: t.consent, given: consent, lang }],
          lang,
          source: typeof window !== "undefined" ? window.location.pathname : undefined,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        },
      });
      setStatus("ok");
      setForm({ name: "", email: "", subject: "", message: "" });
      setConsent(false);
      toast.success(t.ok);
    } catch {
      setStatus("idle");
      toast.error(t.error);
    }
  };

  return (
    <section className="mt-12 rounded-xl border border-border bg-card/40 p-6 max-w-2xl mx-auto">
      <h2 className="font-display text-2xl mb-4">{t.title}</h2>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
          <FloatingInput
            id={nameId}
            maxLength={CONTACT_FIELD_LIMITS.name}
            label={t.name}
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <CharacterCounter count={form.name.length} limit={CONTACT_FIELD_LIMITS.name} lang={lang} />
          </div>
          <div>
          <FloatingInput
            id={emailId}
            maxLength={CONTACT_FIELD_LIMITS.email}
            label={t.email}
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <CharacterCounter count={form.email.length} limit={CONTACT_FIELD_LIMITS.email} lang={lang} />
          </div>
        </div>
        <div>
        <FloatingInput
          id={subjectId}
          maxLength={CONTACT_FIELD_LIMITS.subject}
          label={t.subject}
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
        <CharacterCounter count={form.subject.length} limit={CONTACT_FIELD_LIMITS.subject} lang={lang} />
        </div>
        <MessageComposerField
          id={messageId}
          label={t.msg}
          required
          rows={5}
          maxLength={CONTACT_FIELD_LIMITS.message}
          value={form.message}
          onChange={(next) => setForm({ ...form, message: next })}
          lang={lang}
          submitting={status === "sending"}
          onValidationChange={(v) => setMessageOk(v.canSubmit)}
        />
        <div className="space-y-1">
          <label
            htmlFor={consentId}
            className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <Checkbox
              id={consentId}
              name="consent"
              className="mt-0.5"
              checked={consent}
              aria-required="true"
              aria-invalid={consentError ? true : undefined}
              aria-describedby={consentError ? `${consentId}-err` : undefined}
              onCheckedChange={(next) => {
                setConsent(next === true);
                if (next === true) setConsentError(false);
              }}
            />
            <span>{t.consent}</span>
          </label>
          {consentError ? (
            <p id={`${consentId}-err`} role="alert" className="pl-6 text-xs text-destructive">
              {t.consentRequired}
            </p>
          ) : null}
        </div>
        <SubscribeButton
          type="submit"
          loading={status === "sending"}
          loadingLabel={t.sending}
          disabled={!messageOk || status === "sending"}
          className="justify-self-start"
        >
          {t.send}
        </SubscribeButton>
        <p role="status" aria-live="polite" className="sr-only">
          {status === "ok" ? t.ok : ""}
        </p>
      </form>
    </section>
  );
}
