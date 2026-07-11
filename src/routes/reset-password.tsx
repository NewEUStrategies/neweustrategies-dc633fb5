// Docelowa strona linku "resetuj hasło" z e-maila Supabase (type=recovery).
// Do tej pory login.tsx wysyłał użytkowników na /reset-password, ale trasa
// nie istniała - link z tokenem odzyskiwania lądował na 404.
//
// supabase-js (detectSessionInUrl domyślnie włączone) sam wymienia token
// z hasha na sesję; tu tylko czekamy na tę sesję, przyjmujemy nowe hasło
// i wylogowujemy pozostałe sesje użytkownika.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { Logo } from "@/components/atoms/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PasswordStrengthMeter } from "@/components/molecules/PasswordStrengthMeter";
import { toast } from "sonner";
import { Eye, Loader2, Lock } from "@/lib/lucide-shim";
import { EyeOff, Info, KeyRound } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Reset hasła" }],
  }),
  component: ResetPasswordPage,
});

const MIN_PASSWORD_LENGTH = 8;

type Phase = "checking" | "ready" | "invalid" | "done";

function ResetPasswordPage() {
  const { i18n } = useTranslation();
  const isPl = i18n.language?.startsWith("pl");
  const navigate = useNavigate();
  const settings = useAuthSettings();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const t = useMemo(
    () =>
      isPl
        ? {
            title: "Ustaw nowe hasło",
            sub: "Wpisz nowe hasło do swojego konta.",
            password: "Nowe hasło",
            passwordHint:
              "Minimum 8 znaków. Dla bezpieczeństwa użyj małych i wielkich liter, cyfr oraz znaków specjalnych.",
            confirm: "Powtórz hasło",
            submit: "Zapisz nowe hasło",
            checking: "Weryfikujemy link resetujący…",
            invalidTitle: "Link wygasł lub jest nieprawidłowy",
            invalidSub: "Poproś o nowy link resetujący i spróbuj ponownie.",
            requestNew: "Wyślij nowy link",
            backToLogin: "Wróć do logowania",
            tooShort: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`,
            mismatch: "Hasła nie są identyczne.",
            saved: "Hasło zmienione. Pozostałe sesje zostały wylogowane.",
            showPw: "Pokaż hasło",
            hidePw: "Ukryj hasło",
          }
        : {
            title: "Set a new password",
            sub: "Enter a new password for your account.",
            password: "New password",
            passwordHint:
              "At least 8 characters. For a strong password mix lower- and upper-case letters, numbers and symbols.",
            confirm: "Repeat password",
            submit: "Save new password",
            checking: "Verifying the reset link…",
            invalidTitle: "This link is invalid or has expired",
            invalidSub: "Request a fresh reset link and try again.",
            requestNew: "Send a new link",
            backToLogin: "Back to sign in",
            tooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
            mismatch: "Passwords do not match.",
            saved: "Password changed. Other sessions were signed out.",
            showPw: "Show password",
            hidePw: "Hide password",
          },
    [isPl],
  );

  useEffect(() => {
    let cancelled = false;
    // Sesja z tokenu recovery pojawia się asynchronicznie po sparsowaniu
    // hasha; nasłuch + krótki deadline zamiast wyścigu z getSession().
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        setPhase((p) => (p === "checking" ? "ready" : p));
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setPhase((p) => (p === "checking" ? "ready" : p));
    });
    const deadline = window.setTimeout(() => {
      if (!cancelled) setPhase((p) => (p === "checking" ? "invalid" : p));
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return toast.error(t.tooShort);
    if (password !== confirm) return toast.error(t.mismatch);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Link recovery mógł wyciec (skrzynka, forward) - po zmianie hasła
      // ubijamy wszystkie inne sesje konta.
      await supabase.auth.signOut({ scope: "others" });
      setPhase("done");
      toast.success(t.saved);
      const target = settings.logged_in_redirect_url?.startsWith("/")
        ? settings.logged_in_redirect_url
        : "/";
      navigate({ to: target });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen w-full bg-muted/40 dark:bg-background flex items-center justify-center p-4">
        <main className="w-full max-w-md bg-card rounded-2xl border border-border shadow-lg shadow-foreground/5 p-6 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <Logo size="sm" withWordmark />
          </div>

          {phase === "checking" && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-8">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.checking}
            </div>
          )}

          {phase === "invalid" && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <KeyRound className="w-5 h-5 text-destructive" />
                {t.invalidTitle}
              </div>
              <p className="text-sm text-muted-foreground">{t.invalidSub}</p>
              <div className="flex gap-3 pt-2">
                <Button asChild>
                  <Link to="/login" search={{ mode: "reset" }}>
                    {t.requestNew}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/login" search={{ mode: "signin" }}>
                    {t.backToLogin}
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {(phase === "ready" || phase === "done") && (
            <>
              <h1 className="text-xl font-bold mb-1">{t.title}</h1>
              <p className="text-sm text-muted-foreground mb-6">{t.sub}</p>
              <form onSubmit={submit} className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {t.password}
                    </Label>
                    <Tooltip delayDuration={150}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t.passwordHint}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-balance">
                        {t.passwordHint}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70">
                      <Lock className="w-4 h-4" />
                    </span>
                    <Input
                      type={showPw ? "text" : "password"}
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 h-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors p-1 rounded-md"
                      aria-label={showPw ? t.hidePw : t.showPw}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <PasswordStrengthMeter password={password} lang={isPl ? "pl" : "en"} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t.confirm}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70">
                      <Lock className="w-4 h-4" />
                    </span>
                    <Input
                      type={showPw ? "text" : "password"}
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="pl-10 h-12"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 font-semibold tracking-wide uppercase text-xs"
                  disabled={busy || phase === "done"}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t.submit}
                </Button>
              </form>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
