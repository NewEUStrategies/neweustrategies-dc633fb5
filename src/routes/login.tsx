import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { useTheme } from "@/components/ThemeProvider";
import { Logo } from "@/components/atoms/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Eye, Loader2, Mail, Lock, User, LogIn } from "@/lib/lucide-shim";
import { EyeOff, UserPlus, KeyRound } from "lucide-react";
import illustrationLight from "@/assets/login-illustration-light.jpg";
import illustrationDark from "@/assets/login-illustration-dark.jpg";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" | "signup" | "reset" } => {
    const m = search.mode;
    if (m === "signup" || m === "reset" || m === "signin") return { mode: m };
    return {};
  },
  component: LoginPage,
});

type Mode = "signin" | "signup" | "reset";

function LoginPage() {
  const { i18n } = useTranslation();
  const isPl = i18n.language?.startsWith("pl");
  const navigate = useNavigate();
  const { session, isStaff, loading } = useAuth();
  const settings = useAuthSettings();
  const { theme } = useTheme();
  const { mode: initialMode } = Route.useSearch();
  const [mode, setMode] = useState<Mode>((initialMode ?? "signin") as Mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session && isStaff) navigate({ to: "/admin" });
  }, [session, isStaff, loading, navigate]);

  const t = useMemo(() => {
    const dict = {
      pl: {
        signin: "Zaloguj się", signup: "Zarejestruj się", reset: "Resetuj hasło",
        heroTitle: settings.hero_title_pl, heroSub: settings.hero_subtitle_pl,
        haveNo: "Nie masz konta?", haveYes: "Masz już konto?",
        signUpLink: "Zarejestruj się", signInLink: "Zaloguj się",
        email: "E-mail", password: "Hasło", name: "Imię i nazwisko",
        forgot: "Zapomniałeś hasła?", back: "Wróć do logowania",
        submitSignin: "Zaloguj się", submitSignup: "Utwórz konto", submitReset: "Wyślij link",
        resetSub: "Wyślemy link do zmiany hasła na Twój adres.",
        legalPre: "Klikając przycisk, akceptujesz ",
        legalPrivacy: "Politykę prywatności",
        legalAnd: " i ",
        legalTerms: "Regulamin",
        legalSuf: ".",
        backHome: "Wróć na stronę", showPw: "Pokaż hasło", hidePw: "Ukryj hasło",
      },
      en: {
        signin: "Sign In", signup: "Sign Up", reset: "Reset password",
        heroTitle: settings.hero_title_en, heroSub: settings.hero_subtitle_en,
        haveNo: "Don't have an account?", haveYes: "Already have an account?",
        signUpLink: "Sign Up", signInLink: "Sign In",
        email: "E-Mail", password: "Password", name: "Full name",
        forgot: "Forgot password?", back: "Back to sign in",
        submitSignin: "Sign In", submitSignup: "Create account", submitReset: "Send link",
        resetSub: "We'll email a password reset link.",
        legalPre: "By clicking the button, you agree to the ",
        legalPrivacy: "Privacy Policy",
        legalAnd: " and ",
        legalTerms: "Terms of Service",
        legalSuf: ".",
        backHome: "Back to site", showPw: "Show password", hidePw: "Hide password",
      },
    } as const;
    return isPl ? dict.pl : dict.en;
  }, [isPl, settings.hero_title_pl, settings.hero_title_en, settings.hero_subtitle_pl, settings.hero_subtitle_en]);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/admin`,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success(isPl ? "Konto utworzone - sprawdź email." : "Account created - check your email.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success(isPl ? "Link wysłany. Sprawdź skrzynkę." : "Reset link sent. Check your inbox.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success(isPl ? "Zalogowano" : "Signed in");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const illustration =
    theme === "dark"
      ? (settings.hero_image_url_dark || settings.hero_image_url_light || illustrationDark)
      : (settings.hero_image_url_light || settings.hero_image_url_light || illustrationLight);

  return (
    <div className="min-h-screen w-full bg-muted/40 dark:bg-background flex items-center justify-center p-4 sm:p-8">
      {/* Floating back-to-site */}
      {settings.show_back_to_home && (
        <Link
          to="/"
          className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors z-20"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t.backHome}
        </Link>
      )}

      {/* Language switcher */}
      {settings.show_language_switcher && (
        <div className="absolute top-6 right-6 z-20 inline-flex items-center gap-1 rounded-full border border-border bg-card/80 backdrop-blur px-2 py-1 text-xs">
          <button
            type="button"
            onClick={() => i18n.changeLanguage("pl")}
            aria-pressed={isPl}
            className={`px-2 py-0.5 rounded-full transition ${isPl ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            PL
          </button>
          <button
            type="button"
            onClick={() => i18n.changeLanguage("en")}
            aria-pressed={!isPl}
            className={`px-2 py-0.5 rounded-full transition ${!isPl ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            EN
          </button>
        </div>
      )}

      <div className="relative w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] gap-0 lg:gap-6 isolate">
        {/* LEFT: vertical mode rail */}
        <aside className="hidden lg:flex flex-col items-center gap-2 bg-card rounded-2xl shadow-lg shadow-foreground/5 border border-border py-6 px-3">
          <div className="mb-3 flex items-center justify-center w-full">
            <Logo size="xl" withWordmark={false} />
          </div>
          <div className="w-10 h-px bg-border my-2" />

          <RailButton active={mode === "signin"} onClick={() => setMode("signin")} icon={<LogIn className="w-5 h-5" />} label={t.signin} />
          <RailButton active={mode === "signup"} onClick={() => setMode("signup")} icon={<UserPlus className="w-5 h-5" />} label={t.signup} />
          <RailButton active={mode === "reset"} onClick={() => setMode("reset")} icon={<KeyRound className="w-5 h-5" />} label={t.reset} />
        </aside>

        {/* CENTER: hero illustration card */}
        <section
          key={`hero-${theme}-${illustration}`}
          className="relative hidden lg:flex flex-col justify-between rounded-2xl overflow-hidden text-primary-foreground shadow-2xl shadow-primary/20 min-h-[620px] animate-[fadeInUp_.6s_ease-out]"
          style={{
            backgroundImage: `linear-gradient(180deg, hsl(var(--primary) / 0.55) 0%, hsl(var(--primary) / 0.25) 40%, hsl(var(--primary) / 0.75) 100%), url(${illustration})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="p-8 relative z-10">
            <h2 className="font-display text-3xl xl:text-4xl font-bold leading-tight mb-2 drop-shadow-md">
              {t.heroTitle}
            </h2>
            <p className="text-sm text-primary-foreground/90 max-w-xs drop-shadow">{t.heroSub}</p>
          </div>
          <div className="p-6 relative z-10 flex items-center justify-between text-[11px] uppercase tracking-wider text-primary-foreground/80">
            <span>© {new Date().getFullYear()} New European Strategies</span>
            <span className="px-2 py-1 rounded bg-white/15 backdrop-blur-sm">{isPl ? "PL" : "EN"}</span>
          </div>
        </section>


        {/* RIGHT: form */}
        <main className="bg-card rounded-2xl border border-border shadow-lg shadow-foreground/5 p-6 sm:p-10 flex flex-col">
          {/* Mobile mode tabs */}
          <div className="flex lg:hidden gap-2 mb-6">
            {(["signin", "signup", "reset"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors ${
                  mode === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {m === "signin" ? t.signin : m === "signup" ? t.signup : t.reset}
              </button>
            ))}
          </div>

          <div className="lg:hidden mb-6"><Logo size="sm" withWordmark /></div>

          <div className="flex items-baseline justify-between mb-6">
            <p className="text-sm text-muted-foreground">
              {mode === "signin" && (
                <>
                  {t.haveNo}{" "}
                  <button onClick={() => setMode("signup")} className="text-primary font-semibold hover:underline">
                    {t.signUpLink}
                  </button>
                </>
              )}
              {mode === "signup" && (
                <>
                  {t.haveYes}{" "}
                  <button onClick={() => setMode("signin")} className="text-primary font-semibold hover:underline">
                    {t.signInLink}
                  </button>
                </>
              )}
              {mode === "reset" && (
                <button onClick={() => setMode("signin")} className="text-primary font-semibold hover:underline">
                  ← {t.back}
                </button>
              )}
            </p>
          </div>

          <form
            key={mode}
            onSubmit={submit}
            className="space-y-5 flex-1 animate-[fadeSlide_.35s_ease-out]"
          >
            {mode === "signup" && (
              <Field label={t.name} icon={<User className="w-4 h-4" />}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={isPl ? "Jan Kowalski" : "Jane Doe"} className="pl-10 h-12" />
              </Field>
            )}

            <Field label={t.email} icon={<Mail className="w-4 h-4" />}>
              <Input
                type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="youremail@example.com" className="pl-10 h-12"
              />
            </Field>

            {mode !== "reset" && (
              <Field
                label={t.password}
                icon={<Lock className="w-4 h-4" />}
                action={mode === "signin" ? (
                  <button type="button" onClick={() => setMode("reset")} className="text-xs text-primary hover:underline">
                    {t.forgot}
                  </button>
                ) : null}
              >
                <Input
                  type={showPw ? "text" : "password"} required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••" className="pl-10 pr-10 h-12"
                />
                <button
                  type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPw ? t.hidePw : t.showPw}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </Field>
            )}

            {mode === "reset" && (
              <p className="text-xs text-muted-foreground -mt-2">{t.resetSub}</p>
            )}

            <Button type="submit" className="w-full h-12 font-semibold tracking-wide uppercase text-xs" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> :
                mode === "signin" ? t.submitSignin :
                mode === "signup" ? t.submitSignup : t.submitReset}
            </Button>

            <p className="text-[11px] leading-relaxed text-muted-foreground text-center pt-2">
              {t.legalPre}
              <a href={settings.privacy_url || "/polityka-prywatnosci"} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {t.legalPrivacy}
              </a>
              {t.legalAnd}
              <a href={settings.terms_url || "/regulamin"} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {t.legalTerms}
              </a>
              {t.legalSuf}
            </p>

          </form>
        </main>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateX(12px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

function RailButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full flex flex-col items-center gap-1.5 py-4 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-primary rounded-r-full" />}
      <span className={`p-2 rounded-lg transition-colors ${active ? "bg-primary/10" : ""}`}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Field({
  label, icon, action, children,
}: { label: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
        {action}
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>
        {children}
      </div>
    </div>
  );
}
