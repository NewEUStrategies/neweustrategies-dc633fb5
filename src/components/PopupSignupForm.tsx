// Formularz REJESTRACJI KONTA użytkownika w popupie (wariant split/showcase).
// To nie jest formularz newslettera - tworzy realne konto (e-mail + hasło,
// potwierdzenie mailem). Newsletter jest wyłącznie opcjonalnym checkboxem,
// a dane profilowe trafiają do user_metadata i (za zgodą) do listy mailingowej.
//
// Konfiguracja pól (widoczność, etykiety i placeholdery PL/EN, wymagalność)
// pochodzi z `newsletter_settings.popup_fields`, a warstwa prezentacji (kolumny
// par pól, podpowiedź, link do logowania) z `newsletter_settings.popup_design` -
// jedno źródło prawdy z panelem admina.
//
// Kolory nie są tu hardkodowane: panel popupu (SignupPopupPanel) ustawia tokeny
// palety, a pola i checkboxy to niezmienione komponenty platformy.
import { useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sanitizeHtml } from "@/lib/sanitize";
import { Eye } from "@/lib/lucide-shim";
import { EyeOff } from "lucide-react";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { supabase } from "@/integrations/supabase/client";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import { useAuthSettings } from "@/hooks/useAuthSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { trackNewsletterPopupEvent } from "@/lib/newsletter/popupTelemetry";
import { FieldBox } from "@/components/ui/field-box";
import { SignupSuccessPanel } from "@/components/auth/SignupSuccessPanel";

import { SubscribeButton } from "@/components/ui/subscribe-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  popupFieldMap,
  popupFieldLabel,
  popupFieldPlaceholder,
  type PopupFieldKey,
} from "@/lib/newsletter/popupFields";
import { resolvePopupDesign } from "@/lib/newsletter/popupDesign";

interface Props {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  source?: string;
  onSuccess?: () => void;
  compact?: boolean;
  /** Podgląd w adminie: bez realnych zapisów i bez wywołań sieciowych. */
  previewOnly?: boolean;
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
}: Props) {
  const [v, setV] = useState<SignupFields>(empty);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  // Adres, na który poszedł link aktywacyjny - pola są czyszczone po zapisie.
  const [sentTo, setSentTo] = useState("");

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
  const form = design.form;
  // W podglądzie w adminie wyłączamy autouzupełnianie: przeglądarka podstawiała
  // tam zapisane dane logowania administratora (białe plamy w polach).
  const autoFill = (value: string) => (previewOnly ? "off" : value);
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
  // Krótkie pola (imię/nazwisko, hasło/powtórz) stoją w dwóch kolumnach także
  // na telefonie - to skraca scroll popupu o ~2 wiersze. Pary z długą treścią
  // (e-mail + telefon) łamią się do jednej kolumny poniżej `sm`.
  const pairTightClass = form.twoColumnPairs ? "grid grid-cols-2 gap-2.5" : "space-y-2.5";
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (previewOnly) return;

    // Honeypot + minimalny czas wypełnienia: boty dostają "sukces" bez zapisu.
    const elapsed = Date.now() - mountedAt.current;
    if (honey.trim() !== "" || elapsed < 1200) {
      setSentTo(v.email.trim().toLowerCase());
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

      setSentTo(email);
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
      <SignupSuccessPanel
        email={sentTo}
        lang={lang}
        redirectTo={previewOnly ? undefined : `${window.location.origin}${redirectPath}`}
        previewOnly={previewOnly}
      />
    );
  }

  const showFirst = ext && fieldOn("first_name");
  const showLast = ext && fieldOn("last_name");

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

      {hint && (
        <p className="pb-1 text-xs" style={{ color: "var(--nl-muted)" }}>
          {hint}
        </p>
      )}

      {(showFirst || showLast) && (
        <div className={showFirst && showLast ? pairTightClass : ""}>
          {showFirst && (
            <FieldBox
              label={label("first_name")}
              placeholder={placeholder("first_name")}
              required={fields.first_name.required}
              value={v.name}
              onChange={(e) => upd("name", e.target.value)}
              maxLength={80}
              autoComplete={autoFill("given-name")}
            />
          )}
          {showLast && (
            <FieldBox
              label={label("last_name")}
              placeholder={placeholder("last_name")}
              required={fields.last_name.required}
              value={v.surname}
              onChange={(e) => upd("surname", e.target.value)}
              maxLength={80}
              autoComplete={autoFill("family-name")}
            />
          )}
        </div>
      )}
      {ext && fieldOn("job") && (
        <FieldBox
          label={label("job")}
          placeholder={placeholder("job")}
          required={fields.job.required}
          value={v.job}
          onChange={(e) => upd("job", e.target.value)}
          maxLength={120}
          autoComplete={autoFill("organization-title")}
        />
      )}
      {ext && fieldOn("company") && (
        <FieldBox
          label={label("company")}
          placeholder={placeholder("company")}
          required={fields.company.required}
          value={v.company}
          onChange={(e) => upd("company", e.target.value)}
          maxLength={120}
          autoComplete={autoFill("organization")}
        />
      )}
      {ext && fieldOn("linkedin") && (
        <FieldBox
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
          type="email"
          required
          label={label("email")}
          placeholder={placeholder("email")}
          value={v.email}
          onChange={(e) => upd("email", e.target.value)}
          maxLength={254}
          autoComplete={autoFill("email")}
        />
        {showPhone && (
          <FieldBox
            type="tel"
            label={label("phone")}
            placeholder={placeholder("phone")}
            required={fields.phone.required}
            value={v.phone}
            onChange={(e) => upd("phone", e.target.value)}
            maxLength={32}
            autoComplete={autoFill("tel")}
          />
        )}
      </div>

      {/* Hasło + powtórzenie: dwie równe kolumny (albo jedna, gdy tak ustawione). */}
      <div className={pairTightClass}>
        <FieldBox
          type={showPass ? "text" : "password"}
          required
          label={label("password")}
          placeholder={placeholder("password")}
          value={v.password}
          onChange={(e) => upd("password", e.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={72}
          autoComplete={autoFill("new-password")}
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
          type={showPass ? "text" : "password"}
          required
          label={label("password_confirm")}
          placeholder={placeholder("password_confirm")}
          value={v.passwordConfirm}
          onChange={(e) => upd("passwordConfirm", e.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={72}
          autoComplete={autoFill("new-password")}
        />
      </div>

      {/* Lista mailingowa idzie tym samym atomem co pola tekstowe - platformowe
          CSS trzyma etykietę selecta na ramce (select nie ma :placeholder-shown). */}
      {showLists && (
        <div className="input-group min-w-0">
          <select
            id="nl-popup-list"
            className="input"
            value={v.list}
            onChange={(e) => upd("list", e.target.value)}
          >
            <option value="">{placeholder("list") ?? t("Wybierz listę", "Choose a list")}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {isPl ? l.label_pl : l.label_en}
              </option>
            ))}
          </select>
          <label htmlFor="nl-popup-list" className="user-label">
            {label("list")}
            {fields.list.required ? " *" : ""}
          </label>
        </div>
      )}

      {/* Checkboxy: domyślny komponent platformy, jeden blok, spójne odstępy. */}
      <div className="space-y-2 pt-2.5">
        {showNewsletter && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed [color:var(--nl-muted)]">
            <Checkbox
              checked={v.newsletter}
              onCheckedChange={(checked) => upd("newsletter", checked === true)}
              className="mt-px h-[16px] w-[16px] shrink-0"
            />
            <span>{label("newsletter_optin")}</span>
          </label>
        )}

        {requirePrivacy && privacyHtml && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed [color:var(--nl-muted)]">
            <Checkbox
              checked={v.privacy}
              onCheckedChange={(checked) => upd("privacy", checked === true)}
              aria-required="true"
              className="mt-px h-[16px] w-[16px] shrink-0"
            />
            <span
              className="nl-consent"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(privacyHtml) }}
            />
          </label>
        )}

        {requireTerms && (
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed [color:var(--nl-muted)]">
            <Checkbox
              checked={v.terms}
              onCheckedChange={(checked) => upd("terms", checked === true)}
              aria-required="true"
              className="mt-px h-[16px] w-[16px] shrink-0"
            />
            <span
              className="nl-consent"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(termsHtml) }}
            />
          </label>
        )}
      </div>

      <div className="pt-3">
        <SubscribeButton
          loading={state === "loading"}
          loadingLabel={t("Tworzę konto…", "Creating account…")}
          aria-label={cta}
          className="w-full"
          style={{ minHeight: 46, fontSize: "0.9375rem", borderRadius: 6 }}
        >
          {cta}
        </SubscribeButton>
      </div>

      {state === "err" && err && (
        <p
          className="text-[12px] leading-relaxed"
          role="alert"
          style={{ color: "var(--destructive, #f87171)" }}
        >
          {err}
        </p>
      )}

      {(note || form.showLoginLink) && (
        <div className="space-y-1.5 pt-2">
          {note && <p className="text-[11.5px] leading-relaxed [color:var(--nl-muted)]">{note}</p>}
          {form.showLoginLink && (
            <p className="text-[12px] [color:var(--nl-muted)]">
              <a
                href={form.loginLinkHref}
                className="font-medium underline underline-offset-2 transition-opacity hover:opacity-80"
                style={{ color: "var(--nl-fg)" }}
              >
                {isPl ? form.loginLinkPl : form.loginLinkEn}
              </a>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
