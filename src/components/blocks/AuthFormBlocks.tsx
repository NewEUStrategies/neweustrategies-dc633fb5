// Publiczne, strukturalne formularze auth używane przez BlocksRenderer.
// Renderuje semantyczny HTML + integrację Supabase. Nie używać raw HTML.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Loader2, Mail, Lock, User, KeyRound, ShieldCheck, LogIn } from "lucide-react";
import { toast } from "sonner";

type Lang = "pl" | "en";
type Variant = "card" | "plain" | "split";

interface BaseData {
  title_pl?: string;
  title_en?: string;
  subtitle_pl?: string;
  subtitle_en?: string;
  submitLabel_pl?: string;
  submitLabel_en?: string;
  redirectTo?: string;
  variant?: Variant;
  [k: string]: unknown;
}

function pickLang(data: Record<string, unknown>, key: string, lang: Lang, fallback = ""): string {
  return String(data[`${key}_${lang}`] ?? data[`${key}_pl`] ?? fallback);
}

function wrap(variant: Variant | undefined, children: React.ReactNode) {
  if (variant === "plain") return <div className="not-prose my-6 max-w-md mx-auto">{children}</div>;
  return (
    <section className="not-prose my-6 max-w-md mx-auto rounded-xl border border-border bg-card shadow-sm p-6">
      {children}
    </section>
  );
}

function Header({
  title,
  subtitle,
  Icon,
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  if (!title && !subtitle) return null;
  return (
    <header className="mb-5 flex items-start gap-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        {title && <h2 className="m-0 text-xl font-semibold tracking-tight">{title}</h2>}
        {subtitle && <p className="m-0 mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </header>
  );
}

/* ---------------- LOGIN ---------------- */

interface LoginData extends BaseData {
  showRemember?: boolean;
  showShowPassword?: boolean;
  showForgot?: boolean;
  showRegister?: boolean;
  showOAuthGoogle?: boolean;
  registerHref?: string;
  forgotHref?: string;
}

export function LoginFormView({ data, lang }: { data: LoginData; lang: Lang }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = pickLang(data, "title", lang, lang === "pl" ? "Zaloguj się" : "Sign in");
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(
    data,
    "submitLabel",
    lang,
    lang === "pl" ? "Zaloguj się" : "Sign in",
  );
  const redirectTo = data.redirectTo || "/";

  const L = useMemo(
    () =>
      lang === "pl"
        ? {
            email: "E-mail",
            password: "Hasło",
            remember: "Zapamiętaj mnie",
            show: "Pokaż hasło",
            hide: "Ukryj hasło",
            forgot: "Nie pamiętasz hasła?",
            register: "Załóż konto",
            or: "lub",
            google: "Kontynuuj z Google",
            required: "Wypełnij pola",
            ok: "Zalogowano",
          }
        : {
            email: "Email",
            password: "Password",
            remember: "Remember me",
            show: "Show password",
            hide: "Hide password",
            forgot: "Forgot password?",
            register: "Create account",
            or: "or",
            google: "Continue with Google",
            required: "Fill all fields",
            ok: "Signed in",
          },
    [lang],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error(L.required);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success(L.ok);
      navigate({ to: redirectTo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${redirectTo}` },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  };

  return wrap(
    data.variant,
    <>
      <Header title={title} subtitle={subtitle} Icon={LogIn} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="auth-email" className="text-sm">
            {L.email}
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="auth-password" className="text-sm">
            {L.password}
          </Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="auth-password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 pr-10"
            />
            {data.showShowPassword !== false && (
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={showPw ? L.hide : L.show}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          {data.showRemember !== false ? (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} />
              <span>{L.remember}</span>
            </label>
          ) : (
            <span />
          )}
          {data.showForgot !== false && (
            <Link to={data.forgotHref || "?mode=reset"} className="text-primary hover:underline">
              {L.forgot}
            </Link>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
        </Button>
        {data.showOAuthGoogle && (
          <>
            <div className="relative my-2 text-center text-xs text-muted-foreground">
              <span className="bg-card px-2 relative z-10">{L.or}</span>
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={onGoogle}
              disabled={busy}
            >
              {L.google}
            </Button>
          </>
        )}
        {data.showRegister !== false && (
          <p className="text-center text-sm text-muted-foreground m-0">
            <Link to={data.registerHref || "?mode=signup"} className="text-primary hover:underline">
              {L.register}
            </Link>
          </p>
        )}
      </form>
    </>,
  );
}

/* ---------------- REGISTER ---------------- */

interface RegisterData extends BaseData {
  showName?: boolean;
  showConfirmPassword?: boolean;
  showNewsletterOptIn?: boolean;
  requireConsent?: boolean;
  consentLabel_pl?: string;
  consentLabel_en?: string;
  loginHref?: string;
}

export function RegisterFormView({ data, lang }: { data: RegisterData; lang: Lang }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = pickLang(data, "title", lang, lang === "pl" ? "Utwórz konto" : "Create account");
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(
    data,
    "submitLabel",
    lang,
    lang === "pl" ? "Zarejestruj się" : "Sign up",
  );
  const consentLabel = pickLang(data, "consentLabel", lang);
  const redirectTo = data.redirectTo || "/";

  const L = useMemo(
    () =>
      lang === "pl"
        ? {
            name: "Imię",
            email: "E-mail",
            password: "Hasło",
            confirm: "Powtórz hasło",
            newsletter: "Chcę otrzymywać newsletter",
            ok: "Konto utworzone - sprawdź e-mail.",
            mismatch: "Hasła muszą być identyczne.",
            consent: "Wymagana zgoda.",
            login: "Masz już konto? Zaloguj się",
          }
        : {
            name: "First name",
            email: "Email",
            password: "Password",
            confirm: "Confirm password",
            newsletter: "Subscribe to newsletter",
            ok: "Account created - check your email.",
            mismatch: "Passwords must match.",
            consent: "Consent is required.",
            login: "Already have an account? Sign in",
          },
    [lang],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (data.showConfirmPassword !== false && password !== confirm) {
      toast.error(L.mismatch);
      return;
    }
    if (data.requireConsent !== false && !consent) {
      toast.error(L.consent);
      return;
    }
    setBusy(true);
    try {
      const trimmed = name.trim();
      const parts = trimmed.split(/\s+/).filter(Boolean);
      const firstName = parts[0] ?? "";
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
      const displayName = trimmed || email.split("@")[0];
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
          data: {
            display_name: displayName,
            first_name: firstName,
            last_name: lastName,
            full_name: trimmed || displayName,
            newsletter_opt_in: newsletter,
            consent_accepted_at: new Date().toISOString(),
          },
        },
      });
      if (error) throw error;
      toast.success(L.ok);
      navigate({ to: redirectTo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return wrap(
    data.variant,
    <>
      <Header title={title} subtitle={subtitle} Icon={User} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {data.showName !== false && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-name" className="text-sm">
              {L.name}
            </Label>
            <Input
              id="reg-name"
              autoComplete="given-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="reg-email" className="text-sm">
            {L.email}
          </Label>
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-password" className="text-sm">
            {L.password}
          </Label>
          <div className="relative">
            <Input
              id="reg-password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {data.showConfirmPassword !== false && (
          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm" className="text-sm">
              {L.confirm}
            </Label>
            <Input
              id="reg-confirm"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}
        {data.showNewsletterOptIn !== false && (
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={newsletter} onCheckedChange={(v) => setNewsletter(Boolean(v))} />
            <span>{L.newsletter}</span>
          </label>
        )}
        {data.requireConsent !== false && (
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} required />
            <span>
              {consentLabel ||
                (lang === "pl"
                  ? "Akceptuję regulamin i politykę prywatności."
                  : "I accept the terms and privacy policy.")}
            </span>
          </label>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
        </Button>
        <p className="text-center text-sm text-muted-foreground m-0">
          <Link to={data.loginHref || "?mode=signin"} className="text-primary hover:underline">
            {L.login}
          </Link>
        </p>
      </form>
    </>,
  );
}

/* ---------------- LOST PASSWORD ---------------- */

interface LostPasswordData extends BaseData {
  loginHref?: string;
}

export function LostPasswordFormView({ data, lang }: { data: LostPasswordData; lang: Lang }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const title = pickLang(data, "title", lang, lang === "pl" ? "Resetuj hasło" : "Reset password");
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(
    data,
    "submitLabel",
    lang,
    lang === "pl" ? "Wyślij link" : "Send link",
  );
  const redirectTo = data.redirectTo || "/reset-password";

  const L =
    lang === "pl"
      ? {
          email: "E-mail",
          ok: "Link wysłany. Sprawdź skrzynkę.",
          login: "Powrót do logowania",
          success: "Sprawdź swoją skrzynkę - wysłaliśmy link do resetu hasła.",
        }
      : {
          email: "Email",
          ok: "Reset link sent. Check your inbox.",
          login: "Back to sign in",
          success: "Check your inbox - we sent you a reset link.",
        };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${redirectTo}`,
      });
      if (error) throw error;
      toast.success(L.ok);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return wrap(
    data.variant,
    <>
      <Header title={title} subtitle={subtitle} Icon={KeyRound} />
      {sent ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {L.success}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="lost-email" className="text-sm">
              {L.email}
            </Label>
            <Input
              id="lost-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
          </Button>
          <p className="text-center text-sm text-muted-foreground m-0">
            <Link to={data.loginHref || "?mode=signin"} className="text-primary hover:underline">
              {L.login}
            </Link>
          </p>
        </form>
      )}
    </>,
  );
}

/* ---------------- RESET PASSWORD ---------------- */

interface ResetPasswordData extends BaseData {
  showConfirmPassword?: boolean;
  minLength?: number;
}

export function ResetPasswordFormView({ data, lang }: { data: ResetPasswordData; lang: Lang }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const title = pickLang(
    data,
    "title",
    lang,
    lang === "pl" ? "Ustaw nowe hasło" : "Set new password",
  );
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(
    data,
    "submitLabel",
    lang,
    lang === "pl" ? "Zapisz hasło" : "Save password",
  );
  const minLength = Math.max(6, Number(data.minLength ?? 8));
  const redirectTo = data.redirectTo || "/login";

  useEffect(() => {
    // Supabase password-recovery: hash contains type=recovery; SDK sets session automatically.
    supabase.auth.getSession().then(({ data: s }) => setReady(Boolean(s.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const L =
    lang === "pl"
      ? {
          password: "Nowe hasło",
          confirm: "Powtórz hasło",
          ok: "Hasło zapisane.",
          mismatch: "Hasła muszą być identyczne.",
          tooShort: `Min. ${minLength} znaków.`,
          noToken: "Otwórz link z e-maila resetującego hasło, aby kontynuować.",
        }
      : {
          password: "New password",
          confirm: "Confirm password",
          ok: "Password saved.",
          mismatch: "Passwords must match.",
          tooShort: `At least ${minLength} characters.`,
          noToken: "Open the password-reset link from your email to continue.",
        };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < minLength) {
      toast.error(L.tooShort);
      return;
    }
    if (data.showConfirmPassword !== false && password !== confirm) {
      toast.error(L.mismatch);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(L.ok);
      navigate({ to: redirectTo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return wrap(
    data.variant,
    <>
      <Header title={title} subtitle={subtitle} Icon={ShieldCheck} />
      {!ready ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {L.noToken}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="rs-password" className="text-sm">
              {L.password}
            </Label>
            <div className="relative">
              <Input
                id="rs-password"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={minLength}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {data.showConfirmPassword !== false && (
            <div className="space-y-1.5">
              <Label htmlFor="rs-confirm" className="text-sm">
                {L.confirm}
              </Label>
              <Input
                id="rs-confirm"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={minLength}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
          </Button>
        </form>
      )}
    </>,
  );
}
