// Simple contact form rendered below the page content when
// template_type === 'contact'. Submits through the same hardened
// submitContactMessage server fn as the builder's ContactFormView widget
// (src/components/blocks/ContactFormView.tsx) - rate-limited, tenant-scoped,
// zod-validated, synced to the admin Contact Center + CRM. The success
// toast only fires once the server call actually resolves.
import { useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

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
    ok: "Wiadomość została wysłana.",
    error: "Nie udało się wysłać wiadomości. Spróbuj ponownie.",
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
    ok: "Your message has been sent.",
    error: "Could not send the message. Please try again.",
  },
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm({ lang }: Props) {
  const t = L[lang] ?? L.pl;
  const submit = useServerFn(submitContactMessage);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "ok">("idle");
  const formId = useId();
  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const subjectId = `${formId}-subject`;
  const messageId = `${formId}-message`;

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

    setStatus("sending");
    try {
      await submit({
        data: {
          name,
          email,
          subject: form.subject.trim() || undefined,
          message,
          consent: true,
          lang,
          source: typeof window !== "undefined" ? window.location.pathname : undefined,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        },
      });
      setStatus("ok");
      setForm({ name: "", email: "", subject: "", message: "" });
      toast.success(t.ok);
    } catch {
      setStatus("idle");
      toast.error(t.error);
    }
  };

  return (
    <section className="mt-12 rounded-xl border border-border bg-card/40 p-6 max-w-2xl mx-auto">
      <h2 className="font-display text-2xl mb-4">{t.title}</h2>
      <form onSubmit={onSubmit} className="grid gap-3" noValidate>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor={nameId}>{t.name}</Label>
            <Input
              id={nameId}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={emailId}>{t.email}</Label>
            <Input
              id={emailId}
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor={subjectId}>{t.subject}</Label>
          <Input
            id={subjectId}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={messageId}>{t.msg}</Label>
          <Textarea
            id={messageId}
            required
            rows={5}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
        </div>
        <Button type="submit" className="justify-self-start" disabled={status === "sending"}>
          {status === "sending" ? t.sending : t.send}
        </Button>
        <p role="status" aria-live="polite" className="sr-only">
          {status === "ok" ? t.ok : ""}
        </p>
      </form>
    </section>
  );
}
