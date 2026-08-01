// Bramka checkoutu dla gościa.
//
// Zamiast twardej odmowy („zaloguj się") dajemy dwie ścieżki, obie kończące
// się prawdziwą tożsamością przed uruchomieniem płatności:
//   1. logowanie istniejącym kontem,
//   2. tymczasowy profil zakładany e-mailem (magic link, `shouldCreateUser`),
//      który po powrocie ląduje z powrotem na tej samej stronie checkoutu.
//
// Świadomie NIE korzystamy z logowania anonimowego - zamówienie, uprawnienie
// i faktura muszą mieć trwałego właściciela, a webhook operatora przypina
// skutki płatności do `user_id`.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { LogIn, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/lib/i18n/useLang";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FloatingInput } from "@/components/ui/floating-input";

const COPY = {
  pl: {
    title: "Dokończ zakup",
    lead: "Zaloguj się albo utwórz konto e-mailem - potrzebujemy go, żeby przypisać zamówienie, dostęp i fakturę.",
    signIn: "Mam konto - zaloguj się",
    orGuest: "Kontynuuj jako gość",
    email: "Adres e-mail",
    name: "Imię i nazwisko",
    send: "Wyślij link i wróć do zakupu",
    sent: "Sprawdź skrzynkę - wysłaliśmy link. Po kliknięciu wrócisz na tę stronę i dokończysz płatność.",
    invalid: "Podaj poprawny adres e-mail.",
    error: "Nie udało się wysłać linku. Spróbuj ponownie.",
  },
  en: {
    title: "Complete your purchase",
    lead: "Sign in or create an account with your email - we need it to attach the order, access and invoice.",
    signIn: "I have an account - sign in",
    orGuest: "Continue as guest",
    email: "Email address",
    name: "Full name",
    send: "Email me a link and return to checkout",
    sent: "Check your inbox - we sent a link. Opening it brings you back here to finish the payment.",
    invalid: "Enter a valid email address.",
    error: "We could not send the link. Please try again.",
  },
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function GuestCheckoutGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const lang = useLang();
  const c = COPY[lang === "en" ? "en" : "pl"];
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          aria-label="loading"
        />
      </div>
    );
  }

  if (session) return <>{children}</>;

  const submit = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      toast.error(c.invalid);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.href,
          data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      toast.error(c.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{c.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{c.lead}</p>

          <Button asChild variant="outline" className="w-full">
            <Link to="/login" search={{ mode: "signin" }}>
              <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
              {c.signIn}
            </Link>
          </Button>

          <div className="relative text-center">
            <span className="relative z-10 bg-card px-3 text-xs uppercase tracking-wide text-muted-foreground">
              {c.orGuest}
            </span>
            <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          </div>

          {sent ? (
            <p
              className="rounded-[6px] bg-primary/10 px-3 py-2 text-sm text-primary"
              aria-live="polite"
            >
              {c.sent}
            </p>
          ) : (
            <div className="space-y-3">
              <FloatingInput
                label={c.name}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
              <FloatingInput
                label={c.email}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <Button className="w-full" disabled={busy} onClick={() => void submit()}>
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                {c.send}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
