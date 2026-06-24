// Simple, hardened contact form rendered below the page content
// when template_type === 'contact'. Stores submissions via mailto:
// fallback - integrators can swap the handler to a server fn.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Props {
  lang: "pl" | "en";
  recipient?: string;
}

const L = {
  pl: { title: "Skontaktuj się z nami", name: "Imię i nazwisko", email: "E-mail", subject: "Temat", msg: "Wiadomość", send: "Wyślij", ok: "Otwarto klienta e-mail." },
  en: { title: "Get in touch", name: "Full name", email: "Email", subject: "Subject", msg: "Message", send: "Send", ok: "Email client opened." },
} as const;

export function ContactForm({ lang, recipient }: Props) {
  const t = L[lang] ?? L.pl;
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const to = recipient || "hello@example.com";
    const body = `${form.message}\n\n— ${form.name} <${form.email}>`;
    const href = `mailto:${to}?subject=${encodeURIComponent(form.subject)}&body=${encodeURIComponent(body)}`;
    if (typeof window !== "undefined") window.location.href = href;
    toast.success(t.ok);
  };

  return (
    <section className="mt-12 rounded-xl border border-border bg-card/40 p-6 max-w-2xl mx-auto">
      <h2 className="font-display text-2xl mb-4">{t.title}</h2>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>{t.name}</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>{t.email}</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        </div>
        <div><Label>{t.subject}</Label><Input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
        <div><Label>{t.msg}</Label><Textarea required rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
        <Button type="submit" className="justify-self-start">{t.send}</Button>
      </form>
    </section>
  );
}
