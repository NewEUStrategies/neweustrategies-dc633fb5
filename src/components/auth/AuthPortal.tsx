// Wspólny "portal uwierzytelnienia" (logowanie / rejestracja / reset hasła).
// Jeden komponent zasila trasę /login oraz stronę z kodu
// /membership-registration, dzięki czemu obie są zawsze zsynchronizowane 1:1.
import { useNavigate, Link } from "@tanstack/react-router";
import { uiLang } from "@/lib/i18n/format";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import { useTranslation } from "react-i18next";
import { pickPair } from "@/lib/i18n/pickLocalized";
import "@/lib/i18n-auth-portal";
import { supabase } from "@/integrations/supabase/client";
import { isMfaChallengeRequired } from "@/lib/auth/mfa";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { useAuth } from "@/hooks/useAuth";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { useTheme } from "@/components/ThemeProvider";
import { Logo } from "@/components/atoms/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Eye, Loader2, Mail, Lock, LogIn } from "@/lib/lucide-shim";
import { EyeOff, UserPlus, KeyRound, Sun, Moon } from "lucide-react";
import { FieldBox } from "@/components/ui/field-box";
import {
  buildSignupMetadata,
  useRegistrationFields,
  type RegistrationFieldKey,
} from "@/lib/auth/registrationFields";

import illustrationLight from "@/assets/login-illustration-light.jpg";
import illustrationDark from "@/assets/login-illustration-dark.jpg";

export type Mode = "signin" | "signup" | "reset";

export function AuthPortal({ initialMode = "signin" }: { initialMode?: Mode }) {
  const { t, i18n } = useTranslation();
  const uiLanguage = uiLang(i18n.language);
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const settings = useAuthSettings();
  const { theme, toggle: toggleTheme } = useTheme();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  // Wartości pól rejestracji sterowanych globalną konfiguracją (Admin →
  // Popupy / Strona logowania). Klucze = klucze rejestru pól.
  const [extra, setExtra] = useState<Partial<Record<RegistrationFieldKey, string>>>({});
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  // Holds the auto-redirect while an aal1 session waits for its TOTP step-up.
  const [mfaPending, setMfaPending] = useState(false);

  const reg = useRegistrationFields(uiLanguage);
  const val = (key: RegistrationFieldKey) => extra[key] ?? "";
  const setVal = (key: RegistrationFieldKey, v: string) =>
    setExtra((prev) => ({ ...prev, [key]: v }));

  const runPreAuthGuard = useServerFn(preAuthGuard);
  const themeLabel = t(theme === "dark" ? "common.preview.lightMode" : "common.preview.darkMode");

  useEffect(() => {
    if (loading || !session || mfaPending) return;
    // Po zalogowaniu każdy użytkownik (również staff) trafia na stronę główną.
    navigate({ to: "/" });
  }, [session, loading, mfaPending, navigate]);

  // Napisy portalu idą ze słownika (`i18n-auth-portal.ts`). Tekst bohatera jest
  // treścią REDAKCYJNĄ z ustawień strony logowania, nie napisem interfejsu, więc
  // wybiera go `pickPair` - kanoniczna reguła bliźniaczych kolumn (żądany język,
  // potem drugi, potem pusto), a nie kolejny ternary po języku.
  const heroTitle = pickPair(
    uiLanguage === "pl" ? settings.hero_title_pl : settings.hero_title_en,
    uiLanguage === "pl" ? settings.hero_title_en : settings.hero_title_pl,
  );
  const heroSub = pickPair(
    uiLanguage === "pl" ? settings.hero_subtitle_pl : settings.hero_subtitle_en,
    uiLanguage === "pl" ? settings.hero_subtitle_en : settings.hero_subtitle_pl,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Serwerowy pre-check brute-force: atomowe koszyki per-IP i per-email
      // (fail-closed). Uruchamiane PRZED Supabase Auth, żeby próba nawet nie
      // dotarła do wbudowanego licznika.
      try {
        await runPreAuthGuard({ data: { kind: mode === "signin" ? "login" : mode, email } });
      } catch (guardErr) {
        const msg = guardErr instanceof Error ? guardErr.message : "";
        if (msg.includes("rate_limited")) {
          throw new Error(t("authPortal.errors.rateLimited"));
        }
        if (msg.includes("invalid_input")) {
          // ZodError z walidatora - pokazujemy czytelny komunikat zamiast
          // surowego JSON-a i zostawiamy formularz w bezpiecznym stanie
          // (bez redirectu, bez blank screen); użytkownik poprawia dane.
          throw new Error(t("authPortal.errors.invalidInput"));
        }
        throw guardErr;
      }

      if (mode === "signup") {
        if (!settings.allow_public_signup) {
          throw new Error(t("authPortal.errors.signupDisabled"));
        }
        // Wymagalność pól pochodzi z globalnej konfiguracji rejestracji.
        const missing = reg.visible.find(
          (f) =>
            f.required &&
            f.key !== "email" &&
            f.key !== "password" &&
            f.key !== "password_confirm" &&
            f.key !== "newsletter_optin" &&
            f.key !== "list" &&
            !val(f.key).trim(),
        );
        if (missing) {
          throw new Error(t("authPortal.errors.missingFields"));
        }
        if (reg.isEnabled("password_confirm") && password !== passwordConfirm) {
          throw new Error(t("authPortal.errors.passwordMismatch"));
        }
        const metadata = buildSignupMetadata(
          {
            email,
            firstName: val("first_name"),
            lastName: val("last_name"),
            job: val("job"),
            company: val("company"),
            linkedin: val("linkedin"),
            phone: val("phone"),
          },
          { lang: uiLanguage, source: "auth_page" },
        );
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${
              settings.logged_in_redirect_url?.startsWith("/")
                ? settings.logged_in_redirect_url
                : "/"
            }`,
            data: metadata,
          },
        });
        if (error) throw error;

        toast.success(t("authPortal.toasts.accountCreated"));
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success(t("authPortal.toasts.resetSent"));
        setMode("signin");
      } else {
        setMfaPending(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setMfaPending(false);
          throw error;
        }
        if (await isMfaChallengeRequired()) {
          setMfaOpen(true);
        } else {
          setMfaPending(false);
          toast.success(t("authPortal.toasts.signedIn"));
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const illustration = (() => {
    const isDark = theme === "dark";
    const defaultImg = isDark ? illustrationDark : illustrationLight;
    const heroFallback =
      (isDark ? settings.hero_image_url_dark : settings.hero_image_url_light) ||
      settings.hero_image_url_light ||
      defaultImg;
    if (mode === "signup") {
      return (
        (isDark ? settings.signup_image_url_dark : settings.signup_image_url_light) ||
        settings.signup_image_url_light ||
        heroFallback
      );
    }
    if (mode === "reset") {
      return (
        (isDark ? settings.reset_image_url_dark : settings.reset_image_url_light) ||
        settings.reset_image_url_light ||
        heroFallback
      );
    }
    return heroFallback;
  })();

  // Admin-configured full-page background: the image wins, the colour acts as
  // a fallback (and paints while the image loads). Empty settings keep the
  // theme-aware Tailwind background classes untouched.
  const pageBackground: React.CSSProperties = {};
  const bgColor = settings.login_bg_color.trim();
  const bgUrl = settings.login_bg_url.trim();
  if (bgColor) pageBackground.backgroundColor = bgColor;
  if (bgUrl) {
    pageBackground.backgroundImage = `url("${bgUrl}")`;
    pageBackground.backgroundSize = "cover";
    pageBackground.backgroundPosition = "center";
    pageBackground.backgroundRepeat = "no-repeat";
  }

  // Form column position (admin: "Pozycja formularza"). Applies to the lg
  // grid only - below lg everything is a single column with mobile tabs.
  //   right  - classic layout: rail | hero | form (default)
  //   left   - mirrored:       form | hero | rail
  //   center - hero hidden, narrow container centers rail + form
  const position = settings.login_position;
  const layout =
    position === "left"
      ? {
          container: "max-w-[1280px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_100px]",
          rail: "lg:order-3",
          hero: "lg:order-2",
          form: "lg:order-1",
          showHero: true,
        }
      : position === "center"
        ? {
            container: "max-w-xl lg:grid-cols-[100px_minmax(0,1fr)]",
            rail: "",
            hero: "",
            form: "",
            showHero: false,
          }
        : {
            container: "max-w-[1280px] lg:grid-cols-[100px_minmax(0,1.7fr)_minmax(0,1fr)]",
            rail: "",
            hero: "",
            form: "",
            showHero: true,
          };

  return (
    <div
      className="min-h-screen w-full bg-muted/40 dark:bg-background flex items-center justify-center p-4 sm:p-8"
      style={pageBackground}
    >
      {/* Floating back-to-site */}
      {settings.show_back_to_home && (
        <Link
          to="/"
          className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors z-20"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("authPortal.backHome")}
        </Link>
      )}

      {/* Top-right controls: theme + language */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={themeLabel}
          title={themeLabel}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-border bg-card/80 backdrop-blur text-muted-foreground hover:text-foreground transition-colors"
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        {settings.show_language_switcher && (
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/80 backdrop-blur px-2 py-1 text-xs">
            <button
              type="button"
              onClick={() => i18n.changeLanguage("pl")}
              aria-pressed={uiLanguage === "pl"}
              className={`px-2 py-0.5 rounded-full transition ${uiLanguage === "pl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              PL
            </button>
            <button
              type="button"
              onClick={() => i18n.changeLanguage("en")}
              aria-pressed={uiLanguage !== "pl"}
              className={`px-2 py-0.5 rounded-full transition ${uiLanguage !== "pl" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              EN
            </button>
          </div>
        )}
      </div>

      <div
        className={`relative w-full grid grid-cols-1 gap-0 lg:gap-5 isolate ${layout.container}`}
      >
        {/* Vertical mode rail */}
        <aside
          className={`hidden lg:flex flex-col items-center gap-2 bg-card rounded-2xl shadow-lg shadow-foreground/5 border border-border py-6 px-2 ${layout.rail}`}
        >
          <div className="mb-3 flex items-center justify-center w-full">
            <Logo size="lg" withWordmark={false} />
          </div>
          <div className="w-10 h-px bg-border my-2" />

          <RailButton
            active={mode === "signin"}
            onClick={() => setMode("signin")}
            icon={<LogIn className="w-5 h-5" />}
            label={t("authPortal.signin")}
          />
          <RailButton
            active={mode === "signup"}
            onClick={() => setMode("signup")}
            icon={<UserPlus className="w-5 h-5" />}
            label={t("authPortal.signup")}
          />
          <RailButton
            active={mode === "reset"}
            onClick={() => setMode("reset")}
            icon={<KeyRound className="w-5 h-5" />}
            label={t("authPortal.reset")}
          />
        </aside>

        {/* Hero illustration card (hidden entirely for the centered layout) */}
        {layout.showHero && (
          <section
            key={`hero-${theme}-${illustration}`}
            className={`relative hidden lg:flex flex-col justify-between rounded-2xl overflow-hidden text-white shadow-2xl shadow-primary/20 min-h-[640px] animate-[fadeInUp_.6s_ease-out] bg-muted ${layout.hero}`}
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.15) 45%, rgba(15,23,42,0.65) 100%), url("${illustration}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          >
            <div className="p-8 relative z-10">
              <h2 className="font-display text-3xl xl:text-4xl font-bold leading-tight mb-2 drop-shadow-md">
                {heroTitle}
              </h2>
              <p className="text-sm text-primary-foreground/90 max-w-xs drop-shadow">{heroSub}</p>
            </div>
            <div className="p-6 relative z-10 flex items-center justify-between text-[11px] uppercase tracking-wider text-primary-foreground/80">
              <span>© {new Date().getFullYear()} New European Strategies</span>
              <span className="px-2 py-1 rounded bg-white/15 backdrop-blur-sm">
                {uiLanguage.toUpperCase()}
              </span>
            </div>
          </section>
        )}

        {/* Form column */}
        <main
          id="main-content"
          className={`bg-card rounded-2xl border border-border shadow-lg shadow-foreground/5 p-6 sm:p-10 flex flex-col ${layout.form}`}
        >
          {/* Mobile mode tabs */}
          <div className="flex lg:hidden gap-2 mb-6">
            {(["signin", "signup", "reset"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {m === "signin"
                  ? t("authPortal.signin")
                  : m === "signup"
                    ? t("authPortal.signup")
                    : t("authPortal.reset")}
              </button>
            ))}
          </div>

          <div className="lg:hidden mb-6">
            <Logo size="sm" withWordmark />
          </div>

          <div className="flex items-baseline justify-between mb-6">
            <p className="text-sm text-muted-foreground">
              {mode === "signin" && (
                <>
                  {t("authPortal.haveNo")}{" "}
                  <button
                    onClick={() => setMode("signup")}
                    className="text-primary font-semibold hover:underline"
                  >
                    {t("authPortal.signUpLink")}
                  </button>
                </>
              )}
              {mode === "signup" && (
                <>
                  {t("authPortal.haveYes")}{" "}
                  <button
                    onClick={() => setMode("signin")}
                    className="text-primary font-semibold hover:underline"
                  >
                    {t("authPortal.signInLink")}
                  </button>
                </>
              )}
              {mode === "reset" && (
                <button
                  onClick={() => setMode("signin")}
                  className="text-primary font-semibold hover:underline"
                >
                  ← {t("authPortal.back")}
                </button>
              )}
            </p>
          </div>

          <form
            key={mode}
            onSubmit={submit}
            className="space-y-5 flex-1 animate-[fadeSlide_.35s_ease-out]"
          >
            {/* Rejestracja: pola i etykiety pochodzą z globalnej konfiguracji
                (Admin → Popupy / Strona logowania), więc strona, popup i widget
                zawsze pokazują to samo. */}
            {mode === "signup" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {reg.visible
                  .filter((f) => f.key !== "list" && f.key !== "newsletter_optin")
                  .map((f) => {
                    const full = f.key === "email" || f.key === "linkedin";
                    if (f.key === "password" || f.key === "password_confirm") {
                      const isMain = f.key === "password";
                      return (
                        <FieldBox
                          key={f.key}
                          className={full ? "sm:col-span-2" : ""}
                          label={reg.label(f.key, t("authPortal.password"))}
                          type={showPw ? "text" : "password"}
                          required
                          minLength={8}
                          autoComplete="new-password"
                          placeholder={reg.placeholder(f.key)}
                          value={isMain ? password : passwordConfirm}
                          onChange={(e) =>
                            isMain
                              ? setPassword(e.target.value)
                              : setPasswordConfirm(e.target.value)
                          }
                          trailing={
                            isMain ? (
                              <button
                                type="button"
                                onClick={() => setShowPw((v) => !v)}
                                aria-label={
                                  showPw ? t("authPortal.hidePw") : t("authPortal.showPw")
                                }
                                className="p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
                              >
                                {showPw ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            ) : undefined
                          }
                        />
                      );
                    }
                    const isEmail = f.key === "email";
                    return (
                      <FieldBox
                        key={f.key}
                        className={full ? "sm:col-span-2" : ""}
                        label={reg.label(f.key)}
                        placeholder={reg.placeholder(f.key)}
                        required={f.required}
                        type={
                          isEmail
                            ? "email"
                            : f.key === "phone"
                              ? "tel"
                              : f.key === "linkedin"
                                ? "url"
                                : "text"
                        }
                        autoComplete={
                          isEmail
                            ? "email"
                            : f.key === "first_name"
                              ? "given-name"
                              : f.key === "last_name"
                                ? "family-name"
                                : f.key === "company"
                                  ? "organization"
                                  : f.key === "job"
                                    ? "organization-title"
                                    : f.key === "phone"
                                      ? "tel"
                                      : "off"
                        }
                        value={isEmail ? email : val(f.key)}
                        onChange={(e) =>
                          isEmail ? setEmail(e.target.value) : setVal(f.key, e.target.value)
                        }
                      />
                    );
                  })}
              </div>
            ) : (
              <>
                <Field label={t("authPortal.email")} icon={<Mail className="w-4 h-4" />}>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="youremail@example.com"
                    className="icon-input h-12 placeholder:text-muted-foreground/50 placeholder:font-normal transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </Field>

                {mode === "signin" && (
                  <Field
                    label={t("authPortal.password")}
                    icon={<Lock className="w-4 h-4" />}
                    action={
                      <button
                        type="button"
                        onClick={() => setMode("reset")}
                        className="text-xs text-primary hover:underline"
                      >
                        {t("authPortal.forgot")}
                      </button>
                    }
                  >
                    <Input
                      type={showPw ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("authPortal.passwordPlaceholder")}
                      className="icon-input icon-input-with-action h-12 placeholder:text-muted-foreground/50 placeholder:font-normal tracking-wide transition-shadow focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors p-1 rounded-md"
                      aria-label={showPw ? t("authPortal.hidePw") : t("authPortal.showPw")}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </Field>
                )}
              </>
            )}

            {mode === "reset" && (
              <p className="text-xs text-muted-foreground -mt-2">{t("authPortal.resetSub")}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 font-semibold tracking-wide uppercase text-xs"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === "signin" ? (
                t("authPortal.submitSignin")
              ) : mode === "signup" ? (
                t("authPortal.submitSignup")
              ) : (
                t("authPortal.submitReset")
              )}
            </Button>

            <p className="text-[11px] leading-relaxed text-muted-foreground text-center pt-2">
              {t("authPortal.legalPre")}
              <a
                href={settings.privacy_url || "/polityka-prywatnosci"}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {t("authPortal.legalPrivacy")}
              </a>
              {t("authPortal.legalAnd")}
              <a
                href={settings.terms_url || "/regulamin"}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {t("authPortal.legalTerms")}
              </a>
              {t("authPortal.legalSuf")}
            </p>
          </form>
        </main>
      </div>

      <MfaChallenge
        open={mfaOpen}
        onVerified={() => {
          setMfaOpen(false);
          setMfaPending(false);
          toast.success(t("authPortal.toasts.signedIn"));
        }}
        onCancel={() => {
          setMfaOpen(false);
          setMfaPending(false);
        }}
      />

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

function RailButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full flex flex-col items-center gap-1.5 py-4 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-primary rounded-r-full" />
      )}
      <span className={`p-2 rounded-lg transition-colors ${active ? "bg-primary/10" : ""}`}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Field({
  label,
  icon,
  action,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 group">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </Label>
        {action}
      </div>
      <div className="relative focus-within:[&_.field-icon]:text-primary focus-within:[&_.field-divider]:bg-primary/40">
        <span className="field-icon pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 transition-colors">
          {icon}
        </span>
        <span
          aria-hidden
          className="field-divider pointer-events-none absolute left-[38px] top-1/2 -translate-y-1/2 h-5 w-px bg-border transition-colors"
        />
        {children}
      </div>
    </div>
  );
}
