// Publiczne, strukturalne formularze auth używane przez BlocksRenderer.
// Renderuje semantyczny HTML + integrację Supabase. Nie używać raw HTML.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import "@/lib/i18n-public";
import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Loader2, User, KeyRound, ShieldCheck, LogIn } from "lucide-react";

import { toast } from "sonner";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

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

// Thin wrapper over the canonical picker so every auth field follows the ONE
// documented fallback policy (see src/lib/i18n/pickLocalized.ts). Unlike the
// old nullish (`??`) version, an explicitly-blank field now falls back to the
// other language / `fallback` instead of rendering empty.
function pickLang(data: Record<string, unknown>, key: string, lang: Lang, fallback = ""): string {
  return pickLocalized(data, key, lang, fallback);
}

function wrap(variant: Variant | undefined, children: React.ReactNode) {
  if (variant === "plain")
    return (
      <div className="auth-shell auth-shell--plain not-prose my-6 max-w-md mx-auto">{children}</div>
    );
  return (
    <section className="auth-shell auth-shell--card not-prose my-6 max-w-md mx-auto rounded-xl border border-border bg-transparent shadow-sm p-6">
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = pickLang(data, "title", lang, t("authForms.signinTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.signinTitle"));
  const redirectTo = data.redirectTo || "/";

  const L = useMemo(
    () => ({
      email: t("authForms.emailLabel"),
      password: t("authForms.passwordLabel"),
      remember: t("authForms.remember"),
      show: t("authForms.showPassword"),
      hide: t("authForms.hidePassword"),
      forgot: t("authForms.forgot"),
      register: t("authForms.registerLink"),
      or: t("authForms.or"),
      google: t("authForms.google"),
      required: t("authForms.required"),
      ok: t("authForms.signinOk"),
    }),
    [t],
  );

  const runPreAuthGuard = useServerFn(preAuthGuard);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error(L.required);
      return;
    }
    setBusy(true);
    try {
      try {
        await runPreAuthGuard({ data: { kind: "login", email } });
      } catch (guardErr) {
        const msg = guardErr instanceof Error ? guardErr.message : "";
        if (msg.includes("rate_limited")) {
          throw new Error(
            t("auth.rateLimited", {
              defaultValue: "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
            }),
          );
        }
        if (msg.includes("invalid_input")) {
          throw new Error(
            t("auth.invalidInput", {
              defaultValue: "Nieprawidłowe dane - sprawdź adres email i spróbuj ponownie.",
            }),
          );
        }
        throw guardErr;
      }
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

  const emailLabel = pickLang(data, "emailLabel", lang, L.email);
  const emailPlaceholder = pickLang(data, "emailPlaceholder", lang, "name@example.com");
  const pwdLabel = pickLang(data, "passwordLabel", lang, L.password);
  const pwdPlaceholder = pickLang(data, "passwordPlaceholder", lang, "");

  return wrap(
    data.variant,
    <>
      <Header title={title} subtitle={subtitle} Icon={LogIn} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FloatingInput
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={emailLabel}
        />
        <div className="relative">
          <FloatingInput
            id="auth-password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            label={pwdLabel}
            className={data.showShowPassword !== false ? "pr-11" : undefined}
          />
          {data.showShowPassword !== false && (
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-[calc(50%-2px)] -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label={showPw ? L.hide : L.show}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = pickLang(data, "title", lang, t("authForms.signupTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.signupSubmit"));
  const consentLabel = pickLang(data, "consentLabel", lang);
  const redirectTo = data.redirectTo || "/";

  const L = useMemo(
    () => ({
      name: t("authForms.firstNameLabel"),
      email: t("authForms.emailLabel"),
      password: t("authForms.passwordLabel"),
      confirm: t("authForms.confirmPasswordLabel"),
      newsletter: t("authForms.newsletterOptIn"),
      ok: t("authForms.signupOk"),
      mismatch: t("authForms.passwordsMismatch"),
      consent: t("authForms.consentRequired"),
      login: t("authForms.haveAccount"),
    }),
    [t],
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
            // Explicit reader signup - staff/tenant provisioning happens only
            // server-side via app_metadata (see handle_new_user).
            signup_type: "reader",
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
          <FloatingInput
            id="reg-name"
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            label={L.name}
          />
        )}
        <FloatingInput
          id="reg-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={L.email}
        />
        <div className="relative">
          <FloatingInput
            id="reg-password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            label={L.password}
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-[calc(50%-2px)] -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={showPw ? t("authForms.hidePassword") : t("authForms.showPassword")}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {data.showConfirmPassword !== false && (
          <FloatingInput
            id="reg-confirm"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            label={L.confirm}
          />
        )}

        {data.showNewsletterOptIn !== false && (
          <label className="widget-align-row flex w-full items-center gap-2 text-sm cursor-pointer leading-snug">
            <Checkbox
              className="shrink-0"
              checked={newsletter}
              onCheckedChange={(v) => setNewsletter(Boolean(v))}
            />
            <span className="flex-1 min-w-0">{L.newsletter}</span>
          </label>
        )}
        {data.requireConsent !== false && (
          <label className="widget-align-row flex w-full items-center gap-2 text-sm cursor-pointer leading-snug">
            <Checkbox
              className="shrink-0"
              checked={consent}
              onCheckedChange={(v) => setConsent(Boolean(v))}
              required
            />
            <span className="flex-1 min-w-0">{consentLabel || t("authForms.consentDefault")}</span>
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
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const title = pickLang(data, "title", lang, t("authForms.resetTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.sendLink"));
  const redirectTo = data.redirectTo || "/reset-password";

  const L = {
    email: t("authForms.emailLabel"),
    ok: t("authForms.resetLinkSent"),
    login: t("authForms.backToSignin"),
    success: t("authForms.resetSuccess"),
  };

  const runPreAuthGuard = useServerFn(preAuthGuard);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      try {
        await runPreAuthGuard({ data: { kind: "reset", email } });
      } catch (guardErr) {
        const msg = guardErr instanceof Error ? guardErr.message : "";
        if (msg.includes("rate_limited")) {
          throw new Error(
            t("auth.rateLimited", {
              defaultValue: "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
            }),
          );
        }
        if (msg.includes("invalid_input")) {
          throw new Error(
            t("auth.invalidInput", {
              defaultValue: "Nieprawidłowy adres email - popraw i spróbuj ponownie.",
            }),
          );
        }
        throw guardErr;
      }
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
          <FloatingInput
            id="lost-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            label={L.email}
          />

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const title = pickLang(data, "title", lang, t("authForms.setNewPasswordTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.savePassword"));
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

  const L = {
    password: t("authForms.newPasswordLabel"),
    confirm: t("authForms.confirmPasswordLabel"),
    ok: t("authForms.passwordSaved"),
    mismatch: t("authForms.passwordsMismatch"),
    tooShort: t("authForms.tooShort", { minLength }),
    noToken: t("authForms.noToken"),
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
          <div className="relative">
            <FloatingInput
              id="rs-password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={minLength}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              label={L.password}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-[calc(50%-2px)] -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
              aria-label={showPw ? t("authForms.hidePassword") : t("authForms.showPassword")}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {data.showConfirmPassword !== false && (
            <FloatingInput
              id="rs-confirm"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={minLength}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              label={L.confirm}
            />
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
          </Button>
        </form>
      )}
    </>,
  );
}
