// Formularz zapisu do newslettera (publiczny). Zapis idzie przez serwerową
// funkcję subscribeToNewsletter (double opt-in + wysyłka maila potwierdzającego
// po stronie serwera); token potwierdzenia nigdy nie powstaje w przeglądarce.
//
// Opcjonalny `widgetConfig` pozwala nadpisywać etykiety / placeholdery per-pole,
// wymuszać pokazanie dodatkowych pól (imię/nazwisko/firma) oraz renderować
// custom fields zdefiniowane w builderze — całość leci do CRM przez server.
import { useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  readI18nOverride,
  validateCustom,
  type CustomField,
} from "@/lib/builder/formFields";

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
  const { data: s } = useNewsletterSettings();
  const cfg = widgetConfig ?? {};
  const [email, setEmail] = useState("");
  const [name, setName] = useState(""); // legacy single "name" (fallback)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const subscribe = useServerFn(subscribeToNewsletter);

  // Per-widget visibility toggles for the extra fields.
  const showFirstName = boolCfg(cfg, "showFirstName", false);
  const showLastName = boolCfg(cfg, "showLastName", false);
  const showCompany = boolCfg(cfg, "showCompany", false);
  const requireFirstName = boolCfg(cfg, "requireFirstName", false);
  const requireLastName = boolCfg(cfg, "requireLastName", false);
  const requireCompany = boolCfg(cfg, "requireCompany", false);
  const requireEmail = boolCfg(cfg, "requireEmail", true);

  const customFields = useMemo<CustomField[]>(
    () => parseCustomFields(cfg.customFields),
    [cfg.customFields],
  );

  if (!s || !s.enabled) return null;

  // Labels / placeholders (widget override > sensible defaults).
  const L = {
    firstName: readI18nOverride(cfg, "firstNameLabel", lang, lang === "en" ? "First name" : "Imię"),
    lastName: readI18nOverride(cfg, "lastNameLabel", lang, lang === "en" ? "Last name" : "Nazwisko"),
    email: readI18nOverride(cfg, "emailLabel", lang, lang === "en" ? "Email" : "E-mail"),
    company: readI18nOverride(cfg, "companyLabel", lang, lang === "en" ? "Company" : "Firma"),
  };
  const P = {
    firstName: readI18nOverride(cfg, "firstNamePlaceholder", lang, lang === "en" ? "First name" : "Imię"),
    lastName: readI18nOverride(cfg, "lastNamePlaceholder", lang, lang === "en" ? "Last name" : "Nazwisko"),
    email: readI18nOverride(cfg, "emailPlaceholder", lang, lang === "en" ? "your@email.com" : "twoj@email.com"),
    company: readI18nOverride(cfg, "companyPlaceholder", lang, lang === "en" ? "Company" : "Firma"),
    name: lang === "en" ? "Name (optional)" : "Imię (opcjonalnie)",
  };
  const requiredText = lang === "en" ? "Required field" : "Pole wymagane";
  const invalidEmailText = lang === "en" ? "Invalid e-mail address." : "Niepoprawny adres e-mail.";

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
        (lang === "en" ? s.policy_html_en : s.policy_html_pl) ||
        (lang === "en"
          ? "I agree to receive the newsletter and processing of my e-mail address for that purpose."
          : "Wyrażam zgodę na otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym celu.");

      const displayName =
        [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") ||
        name.trim() ||
        undefined;

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
            ? lang === "en"
              ? "Newsletter is not configured."
              : "Newsletter nie jest skonfigurowany."
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
      ? "border border-border rounded-lg p-6 lg:p-8 bg-card"
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
        <form onSubmit={onSubmit} className={hasExtras ? "space-y-2" : "grid sm:grid-cols-[1fr_1fr_auto] gap-2"}>
          {hasExtras ? (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                {showFirstName && (
                  <FieldWrap label={L.firstName} required={requireFirstName} error={errors.firstName}>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={P.firstName}
                      className={inputCls}
                      maxLength={100}
                      required={requireFirstName}
                    />
                  </FieldWrap>
                )}
                {showLastName && (
                  <FieldWrap label={L.lastName} required={requireLastName} error={errors.lastName}>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={P.lastName}
                      className={inputCls}
                      maxLength={100}
                      required={requireLastName}
                    />
                  </FieldWrap>
                )}
                {showCompany && (
                  <FieldWrap label={L.company} required={requireCompany} error={errors.company}>
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder={P.company}
                      className={inputCls}
                      maxLength={200}
                      required={requireCompany}
                    />
                  </FieldWrap>
                )}
                <FieldWrap label={L.email} required={requireEmail} error={errors.email}>
                  <input
                    type="email"
                    required={requireEmail}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={P.email}
                    className={inputCls}
                    maxLength={254}
                  />
                </FieldWrap>
                {customFields.map((f) => (
                  <CustomFieldRender key={f.id} field={f} lang={lang} err={errors[f.id]} inputCls={inputCls} />
                ))}
              </div>
              <button
                type="submit"
                disabled={state === "loading"}
                className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium disabled:opacity-60 w-full sm:w-auto"
              >
                {state === "loading" ? "…" : lang === "en" ? "Subscribe" : "Zapisz się"}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={P.name}
                className="px-3 py-2 rounded border border-input bg-background text-sm"
                maxLength={120}
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={P.email}
                className="px-3 py-2 rounded border border-input bg-background text-sm"
                maxLength={254}
              />
              <button
                type="submit"
                disabled={state === "loading"}
                className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium disabled:opacity-60"
              >
                {state === "loading" ? "…" : lang === "en" ? "Subscribe" : "Zapisz się"}
              </button>
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
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold tracking-wide opacity-95">
        {label}
        {required ? <span className="text-destructive ml-0.5" aria-hidden="true">*</span> : null}
      </span>
      {children}
      {error && <span className="block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}

function CustomFieldRender({
  field,
  lang,
  err,
  inputCls,
}: {
  field: CustomField;
  lang: "pl" | "en";
  err?: string;
  inputCls: string;
}) {
  const label = pickLabel(field, lang);
  const placeholder = pickPlaceholder(field, lang);
  const name = `custom_${field.id}`;

  if (field.type === "checkbox") {
    return (
      <div>
        <label className="flex items-start gap-2 text-xs opacity-90">
          <input type="checkbox" name={name} className="mt-0.5" />
          <span>
            {label}
            {field.required ? <span className="text-destructive ml-0.5" aria-hidden="true">*</span> : null}
          </span>
        </label>
        {err && <span className="block text-[11px] text-destructive">{err}</span>}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <FieldWrap label={label} required={field.required} error={err}>
        <select name={name} required={field.required} className={inputCls} defaultValue="">
          <option value="" disabled>
            {placeholder || (lang === "pl" ? "Wybierz..." : "Select...")}
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
      <FieldWrap label={label} required={field.required} error={err}>
        <textarea
          name={name}
          rows={4}
          required={field.required}
          className={`${inputCls} resize-y`}
          placeholder={placeholder}
          maxLength={field.maxLength ?? 4000}
        />
      </FieldWrap>
    );
  }
  return (
    <FieldWrap label={label} required={field.required} error={err}>
      <input
        name={name}
        type={field.type}
        required={field.required}
        className={inputCls}
        placeholder={placeholder}
        maxLength={field.maxLength ?? 500}
      />
    </FieldWrap>
  );
}
