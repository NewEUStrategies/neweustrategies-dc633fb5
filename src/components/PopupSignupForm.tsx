// Formularz REJESTRACJI KONTA użytkownika w popupie (wariant split/showcase).
// To nie jest formularz newslettera - tworzy realne konto (e-mail + hasło,
// potwierdzenie mailem). Newsletter jest wyłącznie opcjonalnym checkboxem,
// a dane profilowe trafiają do user_metadata i (za zgodą) do listy mailingowej.
//
// Konfiguracja pól (widoczność, etykiety i placeholdery PL/EN, wymagalność)
// pochodzi z `newsletter_settings.popup_fields`, a warstwa prezentacji
// (wariant etykiet, kolumny, separator, logowanie społecznościowe, wyrównanie)
// z `newsletter_settings.popup_design` - jedno źródło prawdy z panelem admina.
import { useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sanitizeHtml } from "@/lib/sanitize";
import { Check, Mail, Eye } from "@/lib/lucide-shim";
import { EyeOff } from "lucide-react";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { supabase } from "@/integrations/supabase/client";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { trackNewsletterPopupEvent } from "@/lib/newsletter/popupTelemetry";
import { FieldBox } from "@/components/ui/field-box";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  popupFieldMap,
  popupFieldLabel,
  popupFieldPlaceholder,
  type PopupFieldKey,
} from "@/lib/newsletter/popupFields";
import {
  resolvePopupDesign,
  resolvePopupPalette,
  type PopupPalette,
} from "@/lib/newsletter/popupDesign";

interface Props {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  source?: string;
  onSuccess?: () => void;
  compact?: boolean;
  /** Podgląd w adminie: bez realnych zapisów i bez wywołań sieciowych. */
  previewOnly?: boolean;
  /** Paleta panelu; brak = paleta ciemna z kolumn ustawień. */
  palette?: PopupPalette;
}

interface SignupFields {
  name: string;
  surname: string;
  job: string;
  company: string;
  linkedin: string;
  email: string;
  phone: string;
  password: string;
  passwordConfirm: string;
  list: string;
  newsletter: boolean;
  terms: boolean;
  privacy: boolean;
}

const empty: SignupFields = {
  name: "",
  surname: "",
  job: "",
  company: "",
  linkedin: "",
  email: "",
  phone: "",
  password: "",
  passwordConfirm: "",
  list: "",
  newsletter: true,
  terms: false,
  privacy: false,
};

const MIN_PASSWORD = 8;

export function PopupSignupForm({
  settings,
  lang,
  source = "popup",
  onSuccess,
  compact = false,
  previewOnly = false,
  palette,
}: Props) {
  const [v, setV] = useState<SignupFields>(empty);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [honey, setHoney] = useState("");
  const mountedAt = useRef<number>(Date.now());
  const runPreAuthGuard = useServerFn(preAuthGuard);
  const subscribe = useServerFn(subscribeToNewsletter);
  const authSettings = useAuthSettings();

  const isPl = lang === "pl";
  const ext = settings.popup_extended_fields;
  const lists = settings.popup_mailing_lists ?? [];
  const fields = popupFieldMap(settings.popup_fields);
  const design = resolvePopupDesign(settings.popup_design);
  const skin = palette ?? resolvePopupPalette(settings, "dark");
  const form = design.form;
  const labelVariant = form.labelStyle;
  const onDark = skin.onDark;
  const fieldOn = (key: PopupFieldKey) => fields[key].enabled;
  const label = (key: PopupFieldKey) => popupFieldLabel(fields[key], lang);
  const placeholder = (key: PopupFieldKey) => popupFieldPlaceholder(fields[key], lang) || undefined;
  const showLists = lists.length > 0 && fieldOn("list");
  const showPhone = ext && fieldOn("phone");
  const showNewsletter = fieldOn("newsletter_optin");
  const requireTerms = settings.popup_require_terms;
  const requirePrivacy = settings.popup_require_privacy !== false;
  const privacyHtml =
    (isPl
      ? settings.popup_privacy_html_pl || settings.policy_html_pl
      : settings.popup_privacy_html_en || settings.policy_html_en) ?? "";
  const termsHtml = (isPl ? settings.popup_terms_html_pl : settings.popup_terms_html_en) ?? "";
  // Dwie kolumny dopiero od `sm` - w wąskim popupie na telefonie para pól
  // obok siebie ścina etykiety.
  const pairClass = form.twoColumnPairs ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2" : "space-y-2.5";

  const t = (pl: string, en: string) => (isPl ? pl : en);

  const track = (event: "submit" | "success" | "error", errorCode?: string) =>
    trackNewsletterPopupEvent({
      event,
      lang,
      layout: settings.popup_layout,
      source,
      errorCode,
    });

  const fail = (message: string, code: string) => {
    setErr(message);
    setState("err");
    track("error", code);
  };

  const upd = <K extends keyof SignupFields>(k: K, val: SignupFields[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  const redirectPath = authSettings.logged_in_redirect_url?.startsWith("/")
    ? authSettings.logged_in_redirect_url
    : "/";

  // Rejestracja przez Google - ta sama ścieżka co w blokach /login, więc
  // konfiguracja providera jest wspólna dla całej platformy.
  const onGoogle = async () => {
    if (previewOnly) return;
    setErr(null);
    setState("loading");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${redirectPath}` },
      });
      if (error) throw error;
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), "oauth_google");
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (previewOnly) return;

    // Honeypot + minimalny czas wypełnienia: boty dostają "sukces" bez zapisu.
    const elapsed = Date.now() - mountedAt.current;
    if (honey.trim() !== "" || elapsed < 1200) {
      setState("ok");
      setV(empty);
      onSuccess?.();
      return;
    }

    const email = v.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail(t("Niepoprawny adres e-mail.", "Invalid e-mail address."), "invalid_email");
      return;
    }

    const nameRe = /^[\p{L}\p{M}'’\- ]{2,80}$/u;
    if (ext) {
      if (v.name.trim() && !nameRe.test(v.name.trim())) {
        fail(
          t(
            "Imię zawiera niedozwolone znaki (min. 2 znaki).",
            "Name contains invalid characters (min. 2 chars).",
          ),
          "invalid_first_name",
        );
        return;
      }
      if (v.surname.trim() && !nameRe.test(v.surname.trim())) {
        fail(
          t(
            "Nazwisko zawiera niedozwolone znaki (min. 2 znaki).",
            "Surname contains invalid characters (min. 2 chars).",
          ),
          "invalid_last_name",
        );
        return;
      }
      if (v.linkedin.trim()) {
        const liOk =
          /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/(in|pub|company)\/[A-Za-z0-9_\-%.]{2,100}\/?$/i.test(
            v.linkedin.trim(),
          );
        if (!liOk) {
          fail(
            t(
              "Niepoprawny URL LinkedIn (np. https://linkedin.com/in/jan-kowalski).",
              "Invalid LinkedIn URL (e.g. https://linkedin.com/in/jane-doe).",
            ),
            "invalid_linkedin",
          );
          return;
        }
      }
      if (v.phone.trim()) {
        const phone = v.phone.trim().replace(/[\s\-().]/g, "");
        if (!/^\+?[0-9]{7,15}$/.test(phone)) {
          fail(
            t(
              "Niepoprawny numer telefonu (7-15 cyfr, opcjonalnie z +).",
              "Invalid phone number (7-15 digits, optional leading +).",
            ),
            "invalid_phone",
          );
          return;
        }
      }
    }

    const requiredMap: Array<[PopupFieldKey, string]> = [
      ["first_name", v.name],
      ["last_name", v.surname],
      ["job", v.job],
      ["company", v.company],
      ["linkedin", v.linkedin],
      ["phone", v.phone],
      ["list", v.list],
    ];
    for (const [key, value] of requiredMap) {
      const cfg = fields[key];
      const visible = key === "list" ? showLists : ext && cfg.enabled;
      if (visible && cfg.required && !value.trim()) {
        fail(
          t(`Pole "${cfg.label_pl}" jest wymagane.`, `The "${cfg.label_en}" field is required.`),
          `required_${key}`,
        );
        return;
      }
    }

    if (v.password.length < MIN_PASSWORD) {
      fail(
        t(
          `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`,
          `Password must be at least ${MIN_PASSWORD} characters long.`,
        ),
        "weak_password",
      );
      return;
    }
    if (v.password !== v.passwordConfirm) {
      fail(t("Hasła nie są identyczne.", "Passwords do not match."), "password_mismatch");
      return;
    }

    if (requirePrivacy && privacyHtml && !v.privacy) {
      fail(
        t("Wymagana akceptacja Polityki prywatności.", "Please accept the Privacy Policy."),
        "privacy_required",
      );
      return;
    }
    if (requireTerms && !v.terms) {
      fail(t("Wymagana akceptacja regulaminu.", "Please accept the terms."), "terms_required");
      return;
    }

    if (!authSettings.allow_public_signup) {
      fail(t("Rejestracja jest wyłączona.", "Sign-up is disabled."), "signup_disabled");
      return;
    }

    setState("loading");
    track("submit");

    const firstName = v.name.trim();
    const lastName = v.surname.trim();
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];

    try {
      // Serwerowy pre-check brute-force (per-IP i per-email), tak samo jak na /login.
      try {
        await runPreAuthGuard({ data: { kind: "signup", email } });
      } catch (guardErr) {
        const msg = guardErr instanceof Error ? guardErr.message : "";
        if (msg.includes("rate_limited")) {
          fail(
            t(
              "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
              "Too many attempts - please try again in a few minutes.",
            ),
            "rate_limited",
          );
          return;
        }
        throw guardErr;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password: v.password,
        options: {
          emailRedirectTo: `${window.location.origin}${redirectPath}`,
          data: {
            display_name: displayName,
            first_name: firstName,
            last_name: lastName,
            full_name: displayName,
            position: v.job.trim() || undefined,
            company: v.company.trim() || undefined,
            linkedin: v.linkedin.trim() || undefined,
            phone: v.phone.trim() || undefined,
            signup_type: "reader",
            signup_source: source,
            preferred_language: lang,
            marketing_opt_in: showNewsletter ? v.newsletter : false,
          },
        },
      });
      if (error) throw error;

      // Newsletter tylko gdy użytkownik świadomie zaznaczył zgodę.
      if (showNewsletter && v.newsletter) {
        const meta: Record<string, string> = {};
        if (v.job.trim()) meta.position = v.job.trim();
        if (v.company.trim()) meta.company = v.company.trim();
        if (v.linkedin.trim()) meta.linkedin = v.linkedin.trim();
        if (v.phone.trim()) meta.phone = v.phone.trim();
        if (showLists && v.list) meta.mailing_list = v.list;
        const consents: Array<{ key: string; text: string; given: boolean; lang: "pl" | "en" }> = [
          {
            key: "newsletter",
            text: isPl
              ? "Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych."
              : "I subscribe to the newsletter and accept receiving marketing messages.",
            given: true,
            lang,
          },
        ];
        if (requirePrivacy && privacyHtml) {
          consents.push({ key: "privacy", text: privacyHtml, given: v.privacy, lang });
        }
        if (requireTerms && termsHtml) {
          consents.push({ key: "terms", text: termsHtml, given: v.terms, lang });
        }
        try {
          await subscribe({
            data: {
              email,
              name: displayName,
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              language: lang,
              source: `signup_${source}`,
              consents,
              meta: Object.keys(meta).length ? meta : undefined,
            },
          });
        } catch {
          /* zapis na listę nie może blokować rejestracji konta */
        }
      }

      setState("ok");
      track("success", undefined);
      setV(empty);
      onSuccess?.();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), "exception");
    }
  };

  const cta =
    (isPl ? settings.popup_cta_pl : settings.popup_cta_en) || t("Załóż konto", "Create account");
  const note =
    (isPl ? settings.popup_note_pl : settings.popup_note_en) ??
    t(
      "Zakładając konto potwierdzasz adres e-mail. Zero spamu.",
      "Creating an account confirms your e-mail. Zero spam.",
    );
  const hint = isPl ? form.hintPl : form.hintEn;

  if (state === "ok") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-3 border border-emerald-500/30 bg-emerald-500/10 p-5"
        style={{ borderRadius: 6 }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
            <Mail className="h-5 w-5 text-emerald-500" />
          </div>
          <h3 className="font-display text-lg" style={{ color: "var(--nl-fg)" }}>
            {t("Konto utworzone!", "Account created!")}
          </h3>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--nl-muted)" }}>
          {t(
            "Wysłaliśmy link potwierdzający na Twój adres e-mail - kliknij go, aby aktywować konto. Sprawdź też folder Spam.",
            "We've sent a confirmation link to your e-mail - click it to activate your account. Please also check your Spam folder.",
          )}
        </p>
        <p
          className="flex items-center gap-1.5 text-[11px] opacity-80"
          style={{ color: "var(--nl-muted)" }}
        >
          <Check className="h-3.5 w-3.5" />
          {t("Status: oczekuje potwierdzenia e-mail.", "Status: pending e-mail confirmation.")}
        </p>
      </div>
    );
  }

  const showFirst = ext && fieldOn("first_name");
  const showLast = ext && fieldOn("last_name");

  const socialBlock = form.socialEnabled ? (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void onGoogle()}
        disabled={state === "loading"}
        className="flex h-11 w-full items-center justify-center gap-2 border text-sm font-medium transition-colors disabled:opacity-60"
        style={{
          borderRadius: 6,
          borderColor: "color-mix(in srgb, var(--nl-fg) 22%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--nl-fg) 6%, transparent)",
          color: "var(--nl-fg)",
        }}
      >
        <GoogleIcon />
        <span className="whitespace-nowrap">
          {isPl ? form.socialGoogleLabelPl : form.socialGoogleLabelEn}
        </span>
      </button>
      {form.showDivider && (
        <div
          className="flex items-center gap-4 text-xs uppercase tracking-wider"
          style={{ color: "var(--nl-muted)" }}
        >
          <span
            className="h-px flex-1"
            style={{ backgroundColor: "color-mix(in srgb, var(--nl-fg) 16%, transparent)" }}
          />
          {isPl ? form.dividerPl : form.dividerEn}
          <span
            className="h-px flex-1"
            style={{ backgroundColor: "color-mix(in srgb, var(--nl-fg) 16%, transparent)" }}
          />
        </div>
      )}
    </div>
  ) : null;

  return (
    <form
      onSubmit={onSubmit}
      className={compact ? "space-y-2 text-left" : "space-y-2.5 text-left"}
      noValidate
    >
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      >
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honey}
            onChange={(e) => setHoney(e.target.value)}
          />
        </label>
      </div>

      {form.socialPosition === "top" && socialBlock}

      {hint && (
        <p className="pb-1 text-xs" style={{ color: "var(--nl-muted)" }}>
          {hint}
        </p>
      )}

      {(showFirst || showLast) && (
        <div className={showFirst && showLast ? pairClass : ""}>
          {showFirst && (
            <FieldBox
              variant={labelVariant}
              onDark={onDark}
              label={label("first_name")}
              placeholder={placeholder("first_name")}
              required={fields.first_name.required}
              value={v.name}
              onChange={(e) => upd("name", e.target.value)}
              maxLength={80}
              autoComplete="given-name"
            />
          )}
          {showLast && (
            <FieldBox
              variant={labelVariant}
              onDark={onDark}
              label={label("last_name")}
              placeholder={placeholder("last_name")}
              required={fields.last_name.required}
              value={v.surname}
              onChange={(e) => upd("surname", e.target.value)}
              maxLength={80}
              autoComplete="family-name"
            />
          )}
        </div>
      )}
      {ext && fieldOn("job") && (
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          label={label("job")}
          placeholder={placeholder("job")}
          required={fields.job.required}
          value={v.job}
          onChange={(e) => upd("job", e.target.value)}
          maxLength={120}
          autoComplete="organization-title"
        />
      )}
      {ext && fieldOn("company") && (
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          label={label("company")}
          placeholder={placeholder("company")}
          required={fields.company.required}
          value={v.company}
          onChange={(e) => upd("company", e.target.value)}
          maxLength={120}
          autoComplete="organization"
        />
      )}
      {ext && fieldOn("linkedin") && (
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          label={label("linkedin")}
          placeholder={placeholder("linkedin")}
          required={fields.linkedin.required}
          value={v.linkedin}
          onChange={(e) => upd("linkedin", e.target.value)}
          maxLength={200}
          inputMode="url"
        />
      )}
      {/* E-mail + telefon w dwoch rownych kolumnach (jak imie/nazwisko). */}
      <div className={showPhone ? pairClass : ""}>
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          type="email"
          required
          label={label("email")}
          placeholder={placeholder("email")}
          value={v.email}
          onChange={(e) => upd("email", e.target.value)}
          maxLength={254}
          autoComplete="email"
        />
        {showPhone && (
          <FieldBox
            variant={labelVariant}
            onDark={onDark}
            type="tel"
            label={label("phone")}
            placeholder={placeholder("phone")}
            required={fields.phone.required}
            value={v.phone}
            onChange={(e) => upd("phone", e.target.value)}
            maxLength={32}
            autoComplete="tel"
          />
        )}
      </div>

      {/* Hasło + powtórzenie: dwie równe kolumny (albo jedna, gdy tak ustawione). */}
      <div className={pairClass}>
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          type={showPass ? "text" : "password"}
          required
          label={label("password")}
          value={v.password}
          onChange={(e) => upd("password", e.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={72}
          autoComplete="new-password"
          trailing={
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={
                showPass ? t("Ukryj hasło", "Hide password") : t("Pokaż hasło", "Show password")
              }
              className="shrink-0 rounded-[6px] p-1 opacity-60 transition-opacity hover:opacity-100"
              style={{ color: "var(--nl-fg)" }}
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <FieldBox
          variant={labelVariant}
          onDark={onDark}
          type={showPass ? "text" : "password"}
          required
          label={label("password_confirm")}
          value={v.passwordConfirm}
          onChange={(e) => upd("passwordConfirm", e.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={72}
          autoComplete="new-password"
        />
      </div>

      {showLists && (
        <div
          className="flex h-12 items-center gap-3 border px-4 focus-within:border-[var(--nl-accent)]"
          style={{
            borderRadius: 6,
            borderColor: "color-mix(in srgb, var(--nl-fg) 18%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--nl-fg) 5%, transparent)",
          }}
        >
          <select
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--nl-fg)" }}
            aria-label={label("list")}
            value={v.list}
            onChange={(e) => upd("list", e.target.value)}
          >
            <option value="" style={{ color: "#111" }}>
              {t("Wybierz listę mailingową", "Choose your main mailing list")}
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id} style={{ color: "#111" }}>
                {isPl ? l.label_pl : l.label_en}
              </option>
            ))}
          </select>
          <span
            className="shrink-0 whitespace-nowrap text-sm"
            style={{ color: "color-mix(in srgb, var(--nl-fg) 45%, transparent)" }}
          >
            {label("list")}
          </span>
        </div>
      )}

      {showNewsletter && (
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[12px] leading-relaxed [color:var(--nl-muted)]">
          <Checkbox
            checked={v.newsletter}
            onCheckedChange={(checked) => upd("newsletter", checked === true)}
            className="mt-0.5 h-[16px] w-[16px] shrink-0"
          />
          <span>{label("newsletter_optin")}</span>
        </label>
      )}

      {requirePrivacy && privacyHtml && (
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[12px] leading-relaxed [color:var(--nl-muted)]">
          <Checkbox
            checked={v.privacy}
            onCheckedChange={(checked) => upd("privacy", checked === true)}
            aria-required="true"
            className="mt-0.5 h-[16px] w-[16px] shrink-0"
          />
          <span
            className="nl-consent"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(privacyHtml) }}
          />
        </label>
      )}

      {requireTerms && (
        <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed [color:var(--nl-muted)]">
          <Checkbox
            checked={v.terms}
            onCheckedChange={(checked) => upd("terms", checked === true)}
            aria-required="true"
            className="mt-0.5 h-[16px] w-[16px] shrink-0"
          />
          <span
            className="nl-consent"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(termsHtml) }}
          />
        </label>
      )}

      <div className="pt-2">
        <SubscribeButton
          loading={state === "loading"}
          aria-label={cta}
          className="w-full"
          style={{ minHeight: 48, fontSize: "1rem", borderRadius: 6 }}
        >
          {cta}
        </SubscribeButton>
      </div>

      {form.socialPosition === "bottom" && socialBlock}

      {state === "err" && err && (
        <p className="text-xs text-red-400" role="alert">
          {err}
        </p>
      )}

      {note && <p className="pt-1 text-[11px] opacity-80 [color:var(--nl-muted)]">{note}</p>}

      {form.showLoginLink && (
        <p className="pt-1 text-[12px] [color:var(--nl-muted)]">
          <a
            href={form.loginLinkHref}
            className="underline underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--nl-fg)" }}
          >
            {isPl ? form.loginLinkPl : form.loginLinkEn}
          </a>
        </p>
      )}
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
        fill="#EB4335"
      />
    </svg>
  );
}
