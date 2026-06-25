import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Eye, Loader2, Mail, Lock, User, ShieldCheck, Sparkles } from "@/lib/lucide-shim";
import { EyeOff } from "lucide-react";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "signup" ? "signup" : search.mode === "reset" ? "reset" : "signin",
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup" | "reset";

function LoginPage() {
  const { t, i18n } = useTranslation();
  const isPl = i18n.language?.startsWith("pl");
  const navigate = useNavigate();
  const { session, isStaff, loading } = useAuth();
  const settings = useAuthSettings();
  const { mode: initialMode } = Route.useSearch();
  const [mode, setMode] = useState<Mode>(initialMode as Mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session && isStaff) navigate({ to: "/admin" });
  }, [session, isStaff, loading, navigate]);

  const heading = useMemo(() => {
    if (mode === "signup") return isPl ? "Utwórz konto" : "Create account";
    if (mode === "reset") return isPl ? "Resetuj hasło" : "Reset password";
    return isPl ? settings.popup_heading_pl : settings.popup_heading_en;
  }, [mode, isPl, settings]);

  const subtitle = useMemo(() => {
    if (mode === "reset") return isPl ? "Wyślemy link do zmiany hasła." : "We'll send a password reset link.";
    if (mode === "signup") return isPl ? "Dołącz do New European Strategies." : "Join New European Strategies.";
    return isPl ? settings.popup_description_pl : settings.popup_description_en;
  }, [mode, isPl, settings]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
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

  const bgStyle: React.CSSProperties = settings.login_bg_url
    ? { backgroundImage: `url(${settings.login_bg_url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : settings.login_bg_color
    ? { backgroundColor: settings.login_bg_color }
    : {};

  const features = isPl
    ? [
        { icon: ShieldCheck, label: "Bezpieczne logowanie", desc: "Szyfrowanie end-to-end i RLS." },
        { icon: Sparkles, label: "Personalizacja", desc: "Zapisuj artykuły i obserwuj autorów." },
        { icon: User, label: "Twój profil", desc: "Zarządzaj subskrypcjami i powiadomieniami." },
      ]
    : [
        { icon: ShieldCheck, label: "Secure sign-in", desc: "End-to-end encryption with RLS." },
        { icon: Sparkles, label: "Personalized", desc: "Bookmark articles and follow authors." },
        { icon: User, label: "Your profile", desc: "Manage subscriptions and notifications." },
      ];

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      {/* Brand panel */}
      <aside
        className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-primary via-primary to-accent text-primary-foreground"
        style={bgStyle}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/20 to-black/60 pointer-events-none" />
        <div className="relative z-10 flex items-center gap-3">
          {settings.form_logo_url ? (
            <img src={settings.form_logo_url} alt="Logo" className="h-10 w-auto" />
          ) : (
            <span className="font-display text-xl font-bold tracking-tight">New European Strategies</span>
          )}
        </div>
        <div className="relative z-10 space-y-8 max-w-md">
          <div>
            <h2 className="font-display text-4xl font-bold leading-tight mb-3">
              {isPl ? "Panel administracyjny" : "Administration panel"}
            </h2>
            <p className="text-base text-primary-foreground/85">
              {isPl
                ? "Zarządzaj treścią, użytkownikami i kampaniami w jednym miejscu."
                : "Manage content, users and campaigns in one place."}
            </p>
          </div>
          <ul className="space-y-4">
            {features.map((f) => (
              <li key={f.label} className="flex gap-3 items-start">
                <div className="rounded-md bg-white/15 backdrop-blur p-2 shrink-0">
                  <f.icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{f.label}</p>
                  <p className="text-xs text-primary-foreground/75">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 text-xs text-primary-foreground/70">
          © {new Date().getFullYear()} New European Strategies
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {settings.show_back_to_home && (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {isPl ? "Wróć na stronę" : "Back to site"}
            </Link>
          )}

          {settings.form_logo_url && (
            <img src={settings.form_logo_url} alt="Logo" className="h-12 w-auto mb-6 lg:hidden" />
          )}

          <h1 className="font-display text-3xl font-bold tracking-tight mb-2">{heading}</h1>
          <p className="text-sm text-muted-foreground mb-8">{subtitle}</p>

          <form onSubmit={submit} className="space-y-5">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-medium uppercase tracking-wide">
                  {isPl ? "Imię" : "Name"}
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10 h-11"
                    placeholder={isPl ? "Jan Kowalski" : "Jane Doe"}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wide">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-11"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            {mode !== "reset" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wide">
                    {isPl ? "Hasło" : "Password"}
                  </Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => setMode("reset")}
                      className="text-xs text-primary hover:underline"
                    >
                      {isPl ? "Zapomniałeś?" : "Forgot?"}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-11"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPw ? (isPl ? "Ukryj hasło" : "Hide password") : (isPl ? "Pokaż hasło" : "Show password")}
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full h-11 font-medium" disabled={busy}>
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === "signin" ? (
                isPl ? "Zaloguj się" : "Sign in"
              ) : mode === "signup" ? (
                isPl ? "Utwórz konto" : "Create account"
              ) : (
                isPl ? "Wyślij link" : "Send link"
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            {mode === "signin" && settings.allow_public_signup && (
              <>
                {isPl ? "Nie masz konta? " : "No account? "}
                <button type="button" className="text-primary font-medium hover:underline" onClick={() => setMode("signup")}>
                  {isPl ? "Zarejestruj się" : "Sign up"}
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                {isPl ? "Masz już konto? " : "Have an account? "}
                <button type="button" className="text-primary font-medium hover:underline" onClick={() => setMode("signin")}>
                  {isPl ? "Zaloguj się" : "Sign in"}
                </button>
              </>
            )}
            {mode === "reset" && (
              <button type="button" className="text-primary font-medium hover:underline" onClick={() => setMode("signin")}>
                {isPl ? "← Wróć do logowania" : "← Back to sign in"}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
