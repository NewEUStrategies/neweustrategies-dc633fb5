// Publiczne, strukturalne formularze auth używane przez BlocksRenderer.
// Renderuje semantyczny HTML + integrację Supabase. Nie używać raw HTML.
//
// KONTRAKT ODCZYTU USTAWIEŃ (dlaczego ten plik wygląda tak, a nie inaczej)
//
// 1. Każdy przełącznik idzie przez `asBool` z `@/lib/content-model/contentValue`.
//    Panel właściwości commitował historycznie stringi "0"/"1", a stary idiom
//    `data.showX !== false` uznawał "0" za PRAWDĘ - wyłączenie pola po prostu
//    nie działało. `readAuthFlag()` czyta pierwszy klucz, który niesie rozpoznaną
//    wartość logiczną, więc stare dokumenty ("0"/"1") i nowe (`true`/`false`)
//    znaczą to samo.
// 2. Klucze, które rozjechały się między schematem a komponentem
//    (`showPasswordConfirm` vs `showConfirmPassword`, `newsletterOptIn` vs
//    `showNewsletterOptIn`, `consentText` vs `consentLabel`) są czytane z listy
//    aliasów: nowy kanoniczny klucz najpierw, stary jako fallback. Dzięki temu
//    zapisane dokumenty nie tracą ustawień.
// 3. Warianty (`card` / `flat` / `inline`) renderują się REALNIE inaczej;
//    historyczne wartości `plain` i `split` są mapowane na `flat` / `card`.

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  buildSignupMetadata,
  useRegistrationFields,
  type RegistrationFieldKey,
} from "@/lib/auth/registrationFields";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import "@/lib/i18n-public";
import { Button } from "@/components/ui/button";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, User, KeyRound, ShieldCheck, LogIn } from "lucide-react";

import { toast } from "sonner";
import { asNumInRange, asStr } from "@/lib/content-model/contentValue";
import {
  AUTH_LAYOUT,
  AUTH_SHELL_CLASS,
  pickAuthText,
  readAuthFlag,
  readAuthVariant,
  type AuthContent,
  type AuthLang,
  type AuthVariant,
} from "@/lib/content-model/authFormSettings";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  validateCustom,
  type CustomField,
} from "@/lib/content-model/formFields";

type Lang = AuthLang;
type ContentBag = AuthContent;

interface BaseData extends ContentBag {
  title_pl?: string;
  title_en?: string;
  subtitle_pl?: string;
  subtitle_en?: string;
  submitLabel_pl?: string;
  submitLabel_en?: string;
  redirectTo?: string;
  variant?: string;
}

// Thin wrapper over the canonical picker so every auth field follows the ONE
// documented fallback policy (see src/lib/i18n/pickLocalized.ts).
function pickLang(data: ContentBag, key: string, lang: Lang, fallback = ""): string {
  return pickAuthText(data, [key], lang, fallback);
}

/**
 * Placeholder z panelu trafia do kontrolki tylko wtedy, gdy redakcja coś
 * wpisała. Pusty string oddajemy jako `undefined`, bo `FloatingInput` sam
 * podstawia wtedy spacer wymagany przez `:placeholder-shown` (etykieta
 * pływająca) - patrz `floatingPlaceholder()` w `ui/floating-input.tsx`.
 */
function phOrNone(value: string): string | undefined {
  return value || undefined;
}

/* ---------------- shell + layout (warianty) ---------------- */

function cx(...parts: ReadonlyArray<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

function AuthShell({ variant, children }: { variant: AuthVariant; children: ReactNode }) {
  return (
    <section
      data-auth-variant={variant}
      className={cx("auth-shell not-prose min-w-0", AUTH_SHELL_CLASS[variant])}
    >
      {children}
    </section>
  );
}

function Header({
  title,
  subtitle,
  Icon,
  variant,
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
  variant: AuthVariant;
}) {
  if (!title && !subtitle) return null;
  const compact = variant === "inline";
  return (
    <header className={cx("flex items-start", compact ? "mb-3 gap-2" : "mb-5 gap-3")}>
      <span
        className={cx(
          "inline-flex items-center justify-center rounded-md bg-primary/10 text-primary shrink-0",
          compact ? "h-7 w-7" : "h-9 w-9",
        )}
      >
        <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </span>
      <div className="min-w-0">
        {title && (
          <h2 className={cx("m-0 font-semibold tracking-tight", compact ? "text-base" : "text-xl")}>
            {title}
          </h2>
        )}
        {subtitle && (
          <p className={cx("m-0 mt-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
            {subtitle}
          </p>
        )}
      </div>
    </header>
  );
}

/* ---------------- małe molekuły pól ---------------- */

function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  withToggle,
  revealed,
  onToggle,
  showLabel,
  hideLabel,
  className,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
  withToggle: boolean;
  revealed: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <FloatingInput
        placeholder={phOrNone(placeholder)}
        id={id}
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        label={label}
        className={withToggle ? "pr-11" : undefined}
      />
      {withToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-[calc(50%-2px)] -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
          aria-label={revealed ? hideLabel : showLabel}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function CheckboxRow({
  checked,
  onChange,
  required,
  className,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={cx(
        "widget-align-row flex w-full items-center gap-2 text-sm cursor-pointer leading-snug",
        className,
      )}
    >
      <Checkbox
        className="shrink-0"
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
        required={required}
      />
      <span className="flex-1 min-w-0">{children}</span>
    </label>
  );
}

function OAuthGoogleBlock({
  orLabel,
  googleLabel,
  onClick,
  busy,
  className,
}: {
  orLabel: string;
  googleLabel: string;
  onClick: () => void;
  busy: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="relative my-2 text-center text-xs text-muted-foreground">
        <span className="bg-card px-2 relative z-10">{orLabel}</span>
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={busy}>
        {googleLabel}
      </Button>
    </div>
  );
}

/**
 * Treść zgody z panelu może zawierać linki w składni markdown
 * `[etykieta](/adres)`. Renderujemy je jako prawdziwe <a>, odrzucając schematy
 * inne niż http(s) / mailto / ścieżka absolutna.
 */
function renderConsentText(text: string): ReactNode {
  if (!text) return null;
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const label = match[1];
    const raw = match[2].trim();
    const safe =
      /^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith("/") ? raw : "";
    if (safe) {
      const external = /^https?:\/\//i.test(safe);
      out.push(
        <a
          key={`consent-link-${index++}`}
          href={safe}
          className="underline underline-offset-2 hover:opacity-80"
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {label}
        </a>,
      );
    } else {
      out.push(label);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------------- pola dodatkowe (customFields) ---------------- */

function CustomAuthFields({
  fields,
  lang,
  errors,
  wide,
  selectPlaceholder,
}: {
  fields: ReadonlyArray<CustomField>;
  lang: Lang;
  errors: Record<string, string>;
  wide: string;
  selectPlaceholder: string;
}) {
  if (!fields.length) return null;
  return (
    <>
      {fields.map((field) => {
        const label = pickLabel(field, lang);
        const placeholder = pickPlaceholder(field, lang);
        const name = `custom_${field.id}`;
        const error = errors[field.id];
        if (field.type === "checkbox") {
          return (
            <label
              key={field.id}
              className={cx(
                "widget-align-row flex w-full items-center gap-2 text-sm cursor-pointer leading-snug",
                wide,
              )}
            >
              <Checkbox name={name} className="shrink-0" required={field.required} />
              <span className="flex-1 min-w-0">{label}</span>
            </label>
          );
        }
        if (field.type === "select") {
          return (
            <div key={field.id} className={cx("min-w-0", wide)}>
              <label className="mb-1 block text-xs text-muted-foreground" htmlFor={name}>
                {label}
              </label>
              <select
                id={name}
                name={name}
                required={field.required}
                aria-invalid={error ? true : undefined}
                defaultValue=""
                className="input w-full"
              >
                <option value="" disabled>
                  {placeholder || selectPlaceholder}
                </option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {(lang === "pl" ? option.labelPl : option.labelEn) ?? option.value}
                  </option>
                ))}
              </select>
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>
          );
        }
        if (field.type === "textarea") {
          return (
            <FloatingTextarea
              key={field.id}
              containerClassName={wide || undefined}
              id={name}
              name={name}
              label={label}
              required={field.required}
              maxLength={field.maxLength ?? 4000}
              error={error ?? null}
            />
          );
        }
        return (
          <FloatingInput
            placeholder={phOrNone(placeholder)}
            key={field.id}
            id={name}
            name={name}
            type={field.type}
            label={label}
            required={field.required}
            maxLength={field.maxLength ?? 500}
            error={error ?? null}
          />
        );
      })}
    </>
  );
}

/* ---------------- LOGIN ---------------- */

interface LoginData extends BaseData {
  showRemember?: unknown;
  showShowPassword?: unknown;
  showForgot?: unknown;
  showRegister?: unknown;
  showOAuthGoogle?: unknown;
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

  const variant = readAuthVariant(data.variant);
  const layout = AUTH_LAYOUT[variant];

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
  const rememberLabel = pickLang(data, "rememberLabel", lang, L.remember);

  const showToggle = readAuthFlag(data, ["showShowPassword"], true);
  const showRemember = readAuthFlag(data, ["showRemember"], true);
  const showForgot = readAuthFlag(data, ["showForgot"], true);
  const showRegister = readAuthFlag(data, ["showRegister"], true);
  const showGoogle = readAuthFlag(data, ["showOAuthGoogle"], true);

  return (
    <AuthShell variant={variant}>
      <Header title={title} subtitle={subtitle} Icon={LogIn} variant={variant} />
      <form onSubmit={submit} className={layout.form} noValidate>
        <FloatingInput
          placeholder={phOrNone(emailPlaceholder)}
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={emailLabel}
        />
        <PasswordField
          id="auth-password"
          label={pwdLabel}
          placeholder={pwdPlaceholder}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          withToggle={showToggle}
          revealed={showPw}
          onToggle={() => setShowPw((v) => !v)}
          showLabel={L.show}
          hideLabel={L.hide}
        />

        {(showRemember || showForgot) && (
          <div className={layout.meta}>
            {showRemember ? (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(Boolean(v))} />
                <span>{rememberLabel}</span>
              </label>
            ) : (
              <span />
            )}
            {showForgot && (
              <Link to={asStr(data.forgotHref) || "?mode=reset"} className="form-link">
                {L.forgot}
              </Link>
            )}
          </div>
        )}
        <SubscribeButton
          type="submit"
          className={cx("w-full", layout.wide)}
          loading={busy}
          loadingLabel="…"
        >
          {submitLabel}
        </SubscribeButton>
        {showGoogle && (
          <OAuthGoogleBlock
            orLabel={L.or}
            googleLabel={L.google}
            onClick={onGoogle}
            busy={busy}
            className={layout.wide || undefined}
          />
        )}
        {showRegister && (
          <p className={cx("text-center text-sm text-muted-foreground m-0", layout.wide)}>
            <Link to={asStr(data.registerHref) || "?mode=signup"} className="form-link">
              {L.register}
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  );
}

/* ---------------- REGISTER ---------------- */

export interface RegisterFieldDef {
  /** Baza klucza w treści: `show${Key}` / `require${Key}` / `${key}Label` / `${key}Placeholder`. */
  key: string;
  id: string;
  inputType: "text" | "email" | "tel" | "url";
  autoComplete: string;
  defaultShow: boolean;
  defaultRequire: boolean;
  /** Starsze klucze widoczności, które nadal muszą działać. */
  legacyShowKeys: ReadonlyArray<string>;
  /** Klucz i18n etykiety; `fallbackLabel` używane, gdy tłumaczenia brak. */
  i18nLabelKey: string;
  fallbackLabel: Readonly<Record<Lang, string>>;
  fallbackPlaceholder: Readonly<Record<Lang, string>>;
  /** Pole strukturalne - Supabase signUp go wymaga, więc nie da się go ukryć. */
  structural?: boolean;
  /** Odpowiednik w globalnym rejestrze pól rejestracji (Admin → Popupy). */
  globalKey?: RegistrationFieldKey;
}

/**
 * Rejestr pól formularza rejestracji. Eksportowany, bo bramka wierności
 * ustawień (`registerFormSchemaParity.test.ts`) porównuje go z panelem.
 */
export const REGISTER_FIELDS: ReadonlyArray<RegisterFieldDef> = [
  {
    key: "firstName",
    globalKey: "first_name",
    id: "reg-first-name",
    inputType: "text",
    autoComplete: "given-name",
    defaultShow: true,
    defaultRequire: true,
    // Stary komponent miał jedno pole `name` sterowane kluczem `showName`.
    legacyShowKeys: ["showName"],
    i18nLabelKey: "authForms.firstNameLabel",
    fallbackLabel: { pl: "Imię", en: "First name" },
    fallbackPlaceholder: { pl: "Jan", en: "John" },
  },
  {
    key: "lastName",
    globalKey: "last_name",
    id: "reg-last-name",
    inputType: "text",
    autoComplete: "family-name",
    defaultShow: true,
    defaultRequire: true,
    legacyShowKeys: ["showName"],
    i18nLabelKey: "authForms.lastNameLabel",
    fallbackLabel: { pl: "Nazwisko", en: "Last name" },
    fallbackPlaceholder: { pl: "Kowalski", en: "Doe" },
  },
  {
    key: "email",
    globalKey: "email",
    id: "reg-email",
    inputType: "email",
    autoComplete: "email",
    defaultShow: true,
    defaultRequire: true,
    legacyShowKeys: [],
    structural: true,
    i18nLabelKey: "authForms.emailLabel",
    fallbackLabel: { pl: "E-mail", en: "Email" },
    fallbackPlaceholder: { pl: "name@example.com", en: "name@example.com" },
  },
  {
    key: "phone",
    globalKey: "phone",
    id: "reg-phone",
    inputType: "tel",
    autoComplete: "tel",
    defaultShow: false,
    defaultRequire: false,
    legacyShowKeys: [],
    i18nLabelKey: "authForms.phoneLabel",
    fallbackLabel: { pl: "Telefon", en: "Phone" },
    fallbackPlaceholder: { pl: "+48 600 000 000", en: "+48 600 000 000" },
  },
  {
    key: "company",
    globalKey: "company",
    id: "reg-company",
    inputType: "text",
    autoComplete: "organization",
    defaultShow: false,
    defaultRequire: false,
    legacyShowKeys: [],
    i18nLabelKey: "authForms.companyLabel",
    fallbackLabel: { pl: "Firma", en: "Company" },
    fallbackPlaceholder: { pl: "", en: "" },
  },
  {
    key: "job",
    globalKey: "job",
    id: "reg-job",
    inputType: "text",
    autoComplete: "organization-title",
    defaultShow: false,
    defaultRequire: false,
    legacyShowKeys: [],
    i18nLabelKey: "authForms.jobLabel",
    fallbackLabel: { pl: "Stanowisko", en: "Job position" },
    fallbackPlaceholder: { pl: "", en: "" },
  },
  {
    key: "linkedin",
    globalKey: "linkedin",
    id: "reg-linkedin",
    inputType: "url",
    autoComplete: "url",
    defaultShow: false,
    defaultRequire: false,
    legacyShowKeys: [],
    i18nLabelKey: "authForms.linkedinLabel",
    fallbackLabel: { pl: "LinkedIn", en: "LinkedIn" },
    fallbackPlaceholder: { pl: "", en: "" },
  },
];

function capitalize(key: string): string {
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

interface RegisterData extends BaseData {
  loginHref?: string;
}

export function RegisterFormView({ data, lang }: { data: RegisterData; lang: Lang }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});

  const variant = readAuthVariant(data.variant);
  const layout = AUTH_LAYOUT[variant];
  const reg = useRegistrationFields(lang);

  const title = pickLang(data, "title", lang, t("authForms.signupTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.signupSubmit"));
  const redirectTo = data.redirectTo || "/";

  const L = useMemo(
    () => ({
      password: t("authForms.passwordLabel"),
      confirm: t("authForms.confirmPasswordLabel"),
      newsletter: t("authForms.newsletterOptIn"),
      ok: t("authForms.signupOk"),
      mismatch: t("authForms.passwordsMismatch"),
      consent: t("authForms.consentRequired"),
      consentDefault: t("authForms.consentDefault"),
      login: t("authForms.haveAccount"),
      required: t("authForms.required"),
      show: t("authForms.showPassword"),
      hide: t("authForms.hidePassword"),
      or: t("authForms.or"),
      google: t("authForms.google"),
      select: t("newsletterForm.selectPlaceholder"),
    }),
    [t],
  );

  // Domyślna widoczność, wymagalność i etykiety pochodzą z globalnego rejestru
  // pól rejestracji; ustawienia widgetu (jeśli redakcja je nadpisała) wygrywają.
  const fields = useMemo(
    () =>
      REGISTER_FIELDS.filter(
        (def) =>
          def.structural === true ||
          readAuthFlag(
            data,
            [`show${capitalize(def.key)}`, ...def.legacyShowKeys],
            def.globalKey ? reg.isEnabled(def.globalKey) : def.defaultShow,
          ),
      ).map((def) => ({
        def,
        required:
          def.structural === true ||
          readAuthFlag(
            data,
            [`require${capitalize(def.key)}`],
            def.globalKey ? reg.isRequired(def.globalKey) : def.defaultRequire,
          ),
        label: pickAuthText(
          data,
          [`${def.key}Label`],
          lang,
          def.globalKey
            ? reg.label(def.globalKey, def.fallbackLabel[lang])
            : t(def.i18nLabelKey, { defaultValue: def.fallbackLabel[lang] }),
        ),
        placeholder: pickAuthText(
          data,
          [`${def.key}Placeholder`],
          lang,
          def.globalKey
            ? reg.placeholder(def.globalKey, def.fallbackPlaceholder[lang])
            : def.fallbackPlaceholder[lang],
        ),
      })),
    [data, lang, t, reg],
  );

  const customFields = useMemo<CustomField[]>(
    () => parseCustomFields(data.customFields),
    [data.customFields],
  );

  // Rozjazd kluczy: schemat/registry piszą `showPasswordConfirm`, stary
  // komponent czytał `showConfirmPassword`. Kanoniczny jest ten pierwszy.
  const showConfirm = readAuthFlag(data, ["showPasswordConfirm", "showConfirmPassword"], false);
  const requireConfirm = readAuthFlag(data, ["requirePasswordConfirm"], false);
  const showToggle = readAuthFlag(data, ["showShowPassword"], true);
  const requireConsent = readAuthFlag(data, ["requireConsent"], true);
  // Rozjazd kluczy: schemat pisze `newsletterOptIn`, komponent czytał
  // `showNewsletterOptIn`.
  const showNewsletter = readAuthFlag(data, ["newsletterOptIn", "showNewsletterOptIn"], true);
  const showGoogle = readAuthFlag(data, ["showOAuthGoogle"], true);

  // Rozjazd kluczy: schemat/registry piszą `consentText`, komponent czytał
  // `consentLabel` - własna treść RODO nigdy się nie renderowała.
  const consentText = pickAuthText(data, ["consentText", "consentLabel"], lang, L.consentDefault);
  const newsletterLabel = pickAuthText(data, ["newsletterLabel"], lang, L.newsletter);
  const pwdLabel = pickAuthText(data, ["passwordLabel"], lang, L.password);
  const pwdPlaceholder = pickAuthText(data, ["passwordPlaceholder"], lang, "");
  const confirmLabel = pickAuthText(data, ["passwordConfirmLabel"], lang, L.confirm);
  const confirmPlaceholder = pickAuthText(data, ["passwordConfirmPlaceholder"], lang, "");

  const valueOf = (key: string) => values[key] ?? "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // FormData musi zostać odczytana synchronicznie - po `await` React zeruje
    // `currentTarget`.
    const custom = collectCustomValues(customFields, new FormData(e.currentTarget));
    const missing = fields.find((field) => field.required && !valueOf(field.def.key).trim());
    if (missing || !password) {
      toast.error(L.required);
      return;
    }
    const customIssues = validateCustom(customFields, custom, L.required);
    setCustomErrors(customIssues);
    if (Object.keys(customIssues).length) {
      toast.error(L.required);
      return;
    }
    if (showConfirm && password !== confirm) {
      toast.error(L.mismatch);
      return;
    }
    if (requireConsent && !consent) {
      toast.error(L.consent);
      return;
    }
    setBusy(true);
    try {
      const email = valueOf("email").trim();
      const firstName = valueOf("firstName").trim();
      const lastName = valueOf("lastName").trim();
      const metadata = buildSignupMetadata(
        {
          email,
          firstName,
          lastName,
          job: valueOf("job"),
          company: valueOf("company"),
          linkedin: valueOf("linkedin"),
          phone: valueOf("phone"),
          newsletterOptIn: newsletter,
          customFields: Object.keys(custom).length ? custom : undefined,
        },
        { lang, source: "register_widget" },
      );
      metadata.consent_accepted_at = new Date().toISOString();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectTo}`,
          data: metadata,
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

  return (
    <AuthShell variant={variant}>
      <Header title={title} subtitle={subtitle} Icon={User} variant={variant} />
      <form onSubmit={submit} className={layout.form} noValidate>
        {fields.map((field) => (
          <FloatingInput
            placeholder={phOrNone(field.placeholder)}
            key={field.def.key}
            id={field.def.id}
            type={field.def.inputType}
            autoComplete={field.def.autoComplete}
            required={field.required}
            value={valueOf(field.def.key)}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.def.key]: e.target.value }))}
            label={field.label}
          />
        ))}
        <PasswordField
          id="reg-password"
          label={pwdLabel}
          placeholder={pwdPlaceholder}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          minLength={8}
          withToggle={showToggle}
          revealed={showPw}
          onToggle={() => setShowPw((v) => !v)}
          showLabel={L.show}
          hideLabel={L.hide}
        />
        {showConfirm && (
          <FloatingInput
            placeholder={phOrNone(confirmPlaceholder)}
            id="reg-confirm"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            required={requireConfirm}
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            label={confirmLabel}
          />
        )}

        <CustomAuthFields
          fields={customFields}
          lang={lang}
          errors={customErrors}
          wide={layout.wide}
          selectPlaceholder={L.select}
        />

        {showNewsletter && (
          <CheckboxRow checked={newsletter} onChange={setNewsletter} className={layout.wide}>
            {newsletterLabel}
          </CheckboxRow>
        )}
        {requireConsent && (
          <CheckboxRow checked={consent} onChange={setConsent} required className={layout.wide}>
            {renderConsentText(consentText)}
          </CheckboxRow>
        )}
        <SubscribeButton
          type="submit"
          className={cx("w-full", layout.wide)}
          loading={busy}
          loadingLabel="…"
        >
          {submitLabel}
        </SubscribeButton>
        {showGoogle && (
          <OAuthGoogleBlock
            orLabel={L.or}
            googleLabel={L.google}
            onClick={onGoogle}
            busy={busy}
            className={layout.wide || undefined}
          />
        )}
        <p className={cx("text-center text-sm text-muted-foreground m-0", layout.wide)}>
          <Link to={asStr(data.loginHref) || "?mode=signin"} className="form-link">
            {L.login}
          </Link>
        </p>
      </form>
    </AuthShell>
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

  const variant = readAuthVariant(data.variant);
  const layout = AUTH_LAYOUT[variant];

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

  const emailLabel = pickAuthText(data, ["emailLabel"], lang, L.email);
  const emailPlaceholder = pickAuthText(data, ["emailPlaceholder"], lang, "name@example.com");
  const successText = pickAuthText(data, ["successText"], lang, L.success);

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

  return (
    <AuthShell variant={variant}>
      <Header title={title} subtitle={subtitle} Icon={KeyRound} variant={variant} />
      {sent ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {successText}
        </div>
      ) : (
        <form onSubmit={submit} className={layout.form} noValidate>
          <FloatingInput
            placeholder={phOrNone(emailPlaceholder)}
            id="lost-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            label={emailLabel}
          />

          <SubscribeButton
            type="submit"
            className={cx("w-full", layout.wide)}
            loading={busy}
            loadingLabel="…"
          >
            {submitLabel}
          </SubscribeButton>
          <p className={cx("text-center text-sm text-muted-foreground m-0", layout.wide)}>
            <Link to={asStr(data.loginHref) || "?mode=signin"} className="form-link">
              {L.login}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

/* ---------------- RESET PASSWORD ---------------- */

type ResetPasswordData = BaseData;

export function ResetPasswordFormView({ data, lang }: { data: ResetPasswordData; lang: Lang }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  const variant = readAuthVariant(data.variant);
  const layout = AUTH_LAYOUT[variant];

  const title = pickLang(data, "title", lang, t("authForms.setNewPasswordTitle"));
  const subtitle = pickLang(data, "subtitle", lang);
  const submitLabel = pickLang(data, "submitLabel", lang, t("authForms.savePassword"));
  const minLength = asNumInRange(data.minLength, 8, 6, 128);
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
    show: t("authForms.showPassword"),
    hide: t("authForms.hidePassword"),
  };

  const pwdLabel = pickAuthText(data, ["passwordLabel"], lang, L.password);
  const pwdPlaceholder = pickAuthText(data, ["passwordPlaceholder"], lang, "");
  const confirmLabel = pickAuthText(data, ["passwordConfirmLabel"], lang, L.confirm);
  const confirmPlaceholder = pickAuthText(data, ["passwordConfirmPlaceholder"], lang, "");
  const successText = pickAuthText(data, ["successText"], lang, L.ok);

  // Rozjazd kluczy: schemat pisze `showPasswordConfirm`, komponent czytał
  // `showConfirmPassword`.
  const showConfirm = readAuthFlag(data, ["showPasswordConfirm", "showConfirmPassword"], true);
  const requireConfirm = readAuthFlag(data, ["requirePasswordConfirm"], true);
  const showToggle = readAuthFlag(data, ["showShowPassword"], true);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < minLength) {
      toast.error(L.tooShort);
      return;
    }
    if (showConfirm && password !== confirm) {
      toast.error(L.mismatch);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success(L.ok);
      setSaved(true);
      navigate({ to: redirectTo });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell variant={variant}>
      <Header title={title} subtitle={subtitle} Icon={ShieldCheck} variant={variant} />
      {!ready ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {L.noToken}
        </div>
      ) : saved ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {successText}
        </div>
      ) : (
        <form onSubmit={submit} className={layout.form} noValidate>
          <PasswordField
            id="rs-password"
            label={pwdLabel}
            placeholder={pwdPlaceholder}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            minLength={minLength}
            withToggle={showToggle}
            revealed={showPw}
            onToggle={() => setShowPw((v) => !v)}
            showLabel={L.show}
            hideLabel={L.hide}
          />
          {showConfirm && (
            <FloatingInput
              placeholder={phOrNone(confirmPlaceholder)}
              id="rs-confirm"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              required={requireConfirm}
              minLength={minLength}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              label={confirmLabel}
            />
          )}

          <SubscribeButton
            type="submit"
            className={cx("w-full", layout.wide)}
            loading={busy}
            loadingLabel="…"
          >
            {submitLabel}
          </SubscribeButton>
        </form>
      )}
    </AuthShell>
  );
}
