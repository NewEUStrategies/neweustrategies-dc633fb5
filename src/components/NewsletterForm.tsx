// Formularz zapisu do newslettera (publiczny). Zapis idzie przez serwerową
// funkcję subscribeToNewsletter (double opt-in + wysyłka maila potwierdzającego
// po stronie serwera); token potwierdzenia nigdy nie powstaje w przeglądarce.
//
// Opcjonalny `widgetConfig` pozwala nadpisywać etykiety / placeholdery per-pole,
// wymuszać pokazanie dodatkowych pól (imię/nazwisko/firma) oraz renderować
// custom fields zdefiniowane w builderze — całość leci do CRM przez server.
import * as React from "react";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import "@/lib/i18n-public";
import { useBuilderMode } from "@/lib/builder/modeContext";
import { useNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { sanitizeHtml } from "@/lib/sanitize";
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  readI18nOverride,
  validateCustom,
  type CustomField,
} from "@/lib/builder/formFields";

function BuilderInlineWrapper({
  settings,
  lang,
  source,
  variant,
}: {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  source: string;
  variant: "card" | "inline";
}) {
  if (!settings.inline_doc) return null;
  const containerCls =
    variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-transparent"
      : "border-t border-b border-border py-8";
  return (
    <section className={containerCls + " nl-shell nl-shell--" + variant} aria-label="Newsletter">
      <NewsletterDocRenderer
        doc={settings.inline_doc}
        settings={settings}
        lang={lang}
        source={source}
      />
    </section>
  );
}

interface Props {
  lang?: "pl" | "en";
  source?: string;
  variant?: "card" | "inline";
  /** Full widget content JSON from the builder (optional). */
  widgetConfig?: Record<string, unknown>;
}

function boolCfg(c: Record<string, unknown> | undefined, k: string, fb = false): boolean {
  const v = c?.[k];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v === "true";
  if (typeof v === "number") return v !== 0;
  return fb;
}

export function NewsletterForm({
  lang = "pl",
  source = "post-bottom",
  variant = "card",
  widgetConfig,
}: Props) {
  const { t } = useTranslation();
  const { data: s } = useNewsletterSettings();
  // Inside the CMS builder canvas the widget must stay visible even when the
  // newsletter is disabled — otherwise it silently vanishes mid-edit.
  const inBuilder = useBuilderMode() !== null;
  const cfg = widgetConfig ?? {};

  // ALL hooks must run before any conditional return: settings load async, so
  // the inline_doc branch below can flip between renders — an early return
  // above these hooks made React throw "Rendered fewer hooks than expected"
  // and the whole widget vanished into the error boundary.
  const [email, setEmail] = useState("");
  const [name, setName] = useState(""); // legacy single "name" (fallback)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const subscribe = useServerFn(subscribeToNewsletter);

  const customFields = useMemo<CustomField[]>(
    () => parseCustomFields(cfg.customFields),
    [cfg.customFields],
  );

  // Nowy builder: jesli tenant ma inline_doc i tryb pozwala na inline, uzywamy
  // NewsletterDocRenderer (Elementor-style). Legacy fallback nizej.
  if (s && s.enabled && s.inline_doc && s.mode !== "off" && s.mode !== "popup") {
    return <BuilderInlineWrapper settings={s} lang={lang} source={source} variant={variant} />;
  }

  // Per-widget visibility toggles for the extra fields.
  const showFirstName = boolCfg(cfg, "showFirstName", false);
  const showLastName = boolCfg(cfg, "showLastName", false);
  const showCompany = boolCfg(cfg, "showCompany", false);
  const requireFirstName = boolCfg(cfg, "requireFirstName", false);
  const requireLastName = boolCfg(cfg, "requireLastName", false);
  const requireCompany = boolCfg(cfg, "requireCompany", false);
  const requireEmail = boolCfg(cfg, "requireEmail", true);

  if (!s || !s.enabled) {
    if (!inBuilder) return null;
    return (
      <div
        role="status"
        className="rounded border border-dashed border-amber-500/60 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-600"
      >
        {!s
          ? "Newsletter: wczytywanie ustawień…"
          : "Newsletter jest wyłączony w ustawieniach — ten widget nie wyświetla się na stronie."}
      </div>
    );
  }

  // Labels / placeholders (widget override > sensible defaults).
  const L = {
    firstName: readI18nOverride(cfg, "firstNameLabel", lang, t("newsletterForm.firstNameLabel")),
    lastName: readI18nOverride(cfg, "lastNameLabel", lang, t("newsletterForm.lastNameLabel")),
    email: readI18nOverride(cfg, "emailLabel", lang, t("newsletterForm.emailLabel")),
    company: readI18nOverride(cfg, "companyLabel", lang, t("newsletterForm.companyLabel")),
  };
  const P = {
    firstName: readI18nOverride(
      cfg,
      "firstNamePlaceholder",
      lang,
      t("newsletterForm.firstNamePlaceholder"),
    ),
    lastName: readI18nOverride(
      cfg,
      "lastNamePlaceholder",
      lang,
      t("newsletterForm.lastNamePlaceholder"),
    ),
    email: readI18nOverride(cfg, "emailPlaceholder", lang, t("newsletterForm.emailPlaceholder")),
    company: readI18nOverride(
      cfg,
      "companyPlaceholder",
      lang,
      t("newsletterForm.companyPlaceholder"),
    ),
    name: t("newsletterForm.namePlaceholder"),
  };
  const requiredText = t("newsletterForm.requiredField");
  const invalidEmailText = t("newsletterForm.invalidEmail");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);
    setErrors({});

    const fd = new FormData(e.currentTarget);
    const trimmedEmail = email.trim().toLowerCase();
    const custom = collectCustomValues(customFields, fd);

    const errs: Record<string, string> = {};
    if (requireEmail && !trimmedEmail) errs.email = requiredText;
    else if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      errs.email = invalidEmailText;
    if (showFirstName && requireFirstName && !firstName.trim()) errs.firstName = requiredText;
    if (showLastName && requireLastName && !lastName.trim()) errs.lastName = requiredText;
    if (showCompany && requireCompany && !company.trim()) errs.company = requiredText;
    Object.assign(errs, validateCustom(customFields, custom, requiredText));

    if (Object.keys(errs).length) {
      setErrors(errs);
      setState("err");
      return;
    }

    try {
      const consentText =
        (lang === "en" ? s.policy_html_en : s.policy_html_pl) || t("newsletterForm.consentDefault");

      const displayName =
        [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || name.trim() || undefined;

      const meta: Record<string, string> = {};
      if (company.trim()) meta.company = company.trim();

      const res = await subscribe({
        data: {
          email: trimmedEmail,
          name: displayName,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          language: lang,
          source,
          formName: (lang === "en" ? s.heading_en : s.heading_pl) || undefined,
          consents: [{ key: "newsletter", text: consentText, given: true, lang }],
          meta: Object.keys(meta).length ? meta : undefined,
          custom: Object.keys(custom).length ? custom : undefined,
        },
      });

      if (!res.ok) {
        setErrMsg(
          res.error === "not_configured" || res.error === "disabled"
            ? t("newsletterForm.notConfigured")
            : res.error,
        );
        setState("err");
        return;
      }
      setState("ok");
      setEmail("");
      setName("");
      setFirstName("");
      setLastName("");
      setCompany("");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setState("err");
    }
  };

  const heading = lang === "en" ? s.heading_en : s.heading_pl;
  const description = lang === "en" ? s.description_en : s.description_pl;
  const policy = lang === "en" ? s.policy_html_en : s.policy_html_pl;
  const success = lang === "en" ? s.success_message_en : s.success_message_pl;

  const containerCls =
    (variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-transparent"
      : "border-t border-b border-border py-8") + ` nl-shell nl-shell--${variant}`;

  const inputCls = "px-3 py-2 rounded border border-input bg-background text-sm w-full";
  const hasExtras = showFirstName || showLastName || showCompany || customFields.length > 0;

  return (
    <section className={containerCls} aria-labelledby="newsletter-heading">
      <h3 id="newsletter-heading" className="font-display text-2xl mb-2">
        {heading}
      </h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {state === "ok" ? (
        <p className="text-sm font-medium text-foreground bg-muted rounded p-3">{success}</p>
      ) : (
        <form
          onSubmit={onSubmit}
          className={hasExtras ? "space-y-2" : "grid sm:grid-cols-[1fr_1fr_auto] gap-2"}
        >
          {hasExtras ? (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                {showFirstName && (
                  <FieldWrap
                    label={L.firstName}
                    required={requireFirstName}
                    showMark={inBuilder}
                    error={errors.firstName}
                  >
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={P.firstName}
                      className={inputCls}
                      maxLength={100}
                      required={requireFirstName}
                      aria-required={requireFirstName || undefined}
                    />
                  </FieldWrap>
                )}
                {showLastName && (
                  <FieldWrap
                    label={L.lastName}
                    required={requireLastName}
                    showMark={inBuilder}
                    error={errors.lastName}
                  >
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={P.lastName}
                      className={inputCls}
                      maxLength={100}
                      required={requireLastName}
                      aria-required={requireLastName || undefined}
                    />
                  </FieldWrap>
                )}
                {showCompany && (
                  <FieldWrap
                    label={L.company}
                    required={requireCompany}
                    showMark={inBuilder}
                    error={errors.company}
                  >
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder={P.company}
                      className={inputCls}
                      maxLength={200}
                      required={requireCompany}
                      aria-required={requireCompany || undefined}
                    />
                  </FieldWrap>
                )}
                <FieldWrap
                  label={L.email}
                  required={requireEmail}
                  showMark={inBuilder}
                  error={errors.email}
                >
                  <input
                    type="email"
                    required={requireEmail}
                    aria-required={requireEmail || undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={P.email}
                    className={inputCls}
                    maxLength={254}
                  />
                </FieldWrap>
                {customFields.map((f) => (
                  <CustomFieldRender
                    key={f.id}
                    field={f}
                    lang={lang}
                    err={errors[f.id]}
                    inputCls={inputCls}
                    showMark={inBuilder}
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={state === "loading"}
                className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium disabled:opacity-60 w-full sm:w-auto"
              >
                {state === "loading" ? "…" : t("newsletterForm.subscribe")}
              </button>
            </>
          ) : (
            <>
              <FieldWrap label={P.name}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </FieldWrap>
              <FieldWrap label={L.email} required error={errors.email}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </FieldWrap>
              <SubscribeButton
                loading={state === "loading"}
                aria-label={t("newsletterForm.subscribe")}
                className="!min-h-0 !py-0 !px-6 self-stretch"
              >
                {t("newsletterForm.subscribe")}
              </SubscribeButton>
            </>
          )}
        </form>
      )}
      {state === "err" && errMsg && <p className="text-xs text-destructive mt-2">{errMsg}</p>}
      {policy && (
        <p
          className="text-xs text-muted-foreground mt-3"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(policy) }}
        />
      )}
    </section>
  );
}

function FieldWrap({
  label,
  showMark: _showMark,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  /** Legacy builder option retained for schema compatibility. */
  showMark?: boolean;
  error?: string;
  children: React.ReactElement<{ className?: string; placeholder?: string }>;
}) {
  // Floating-label wrapper: injects `.input` + neutralny placeholder do dziecka,
  // dzięki czemu label unosi się na obramowanie po focus / gdy pole ma wartość.
  // Semantyczne tokeny (border/ring/destructive/background) => light+dark OK.
  const injectedClass = ["input", children.props.className].filter(Boolean).join(" ");
  const cloned = React.cloneElement(children, {
    className: injectedClass,
    placeholder: " ",
  });
  return (
    <div className="input-group" data-invalid={error ? "true" : undefined}>
      {cloned}
      <label className="user-label">{label}</label>
      {error && <span className="mt-1.5 block pl-1 text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

function CustomFieldRender({
  field,
  lang,
  err,
  inputCls,
  showMark,
}: {
  field: CustomField;
  lang: "pl" | "en";
  err?: string;
  inputCls: string;
  showMark?: boolean;
}) {
  const { t } = useTranslation();
  const label = pickLabel(field, lang);
  const placeholder = pickPlaceholder(field, lang);
  const name = `custom_${field.id}`;

  if (field.type === "checkbox") {
    return (
      <div>
        <label className="widget-align-row flex items-start gap-2 text-xs opacity-90">
          <input
            type="checkbox"
            name={name}
            className="mt-0.5"
            aria-required={field.required || undefined}
          />
          <span>
            {label}
            {null}
          </span>
        </label>
        {err && <span className="block text-[11px] text-destructive">{err}</span>}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <FieldWrap label={label} required={field.required} showMark={showMark} error={err}>
        <select
          name={name}
          required={field.required}
          aria-required={field.required || undefined}
          className={inputCls}
          defaultValue=""
        >
          <option value="" disabled>
            {placeholder || t("newsletterForm.selectPlaceholder")}
          </option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {(lang === "pl" ? o.labelPl : o.labelEn) ?? o.value}
            </option>
          ))}
        </select>
      </FieldWrap>
    );
  }
  if (field.type === "textarea") {
    return (
      <FieldWrap label={label} required={field.required} showMark={showMark} error={err}>
        <textarea
          name={name}
          rows={4}
          required={field.required}
          aria-required={field.required || undefined}
          className={`${inputCls} resize-y`}
          placeholder={placeholder}
          maxLength={field.maxLength ?? 4000}
        />
      </FieldWrap>
    );
  }
  return (
    <FieldWrap label={label} required={field.required} showMark={showMark} error={err}>
      <input
        name={name}
        type={field.type}
        required={field.required}
        aria-required={field.required || undefined}
        className={inputCls}
        placeholder={placeholder}
        maxLength={field.maxLength ?? 500}
      />
    </FieldWrap>
  );
}
