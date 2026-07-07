// Dynamic, themable contact-form widget with configurable fields,
// columns, button placement, light/dark backgrounds, image background,
// and six subtle animated background variants.
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  readI18nOverride,
  validateCustom,
  type CustomField,
} from "@/lib/builder/formFields";



type Lang = "pl" | "en";
type Cfg = Record<string, unknown>;

function s(data: Cfg, key: string, fallback = ""): string {
  const v = data[key];
  return typeof v === "string" ? v : fallback;
}
function bool(data: Cfg, key: string, fallback = false): boolean {
  const v = data[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v === "true";
  if (typeof v === "number") return v !== 0;
  return fallback;
}
function num(data: Cfg, key: string, fallback: number): number {
  const v = data[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

const T = {
  pl: {
    firstName: "Imię",
    lastName: "Nazwisko",
    email: "E-mail",
    phone: "Telefon",
    company: "Firma",
    subject: "Temat",
    message: "Wiadomość",
    consent: "Wyrażam zgodę na przetwarzanie danych w celu odpowiedzi na zapytanie.",
    newsletter: "Zapisz mnie do newslettera",
    required: "Pole wymagane",
    invalidEmail: "Niepoprawny adres e-mail",
    sending: "Wysyłanie...",
    error: "Wystąpił błąd. Spróbuj ponownie.",
  },
  en: {
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    subject: "Subject",
    message: "Message",
    consent: "I agree to processing of my data to receive a reply.",
    newsletter: "Subscribe me to the newsletter",
    required: "Required field",
    invalidEmail: "Invalid email address",
    sending: "Sending...",
    error: "Something went wrong. Please try again.",
  },
} as const;

/**
 * Render consent text with inline markdown links: [label](https://url).
 * Only http(s), mailto: and same-site "/..." URLs are allowed; everything
 * else is stripped down to plain text. Returns a JSX fragment.
 */
function renderConsentText(text: string): ReactNode {
  if (!text) return null;
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const label = m[1];
    const raw = m[2].trim();
    const safe =
      /^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith("/") ? raw : "";
    if (safe) {
      const external = /^https?:\/\//i.test(safe);
      out.push(
        <a
          key={`l-${i++}`}
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
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function ContactFormView({ data, lang }: { data: Cfg; lang: Lang }) {
  const t = T[lang];
  const submit = useServerFn(submitContactMessage);
  const formId = useId();
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const variant = s(data, "variant", "card");
  const title = s(data, `title_${lang}`);
  const subtitle = s(data, `subtitle_${lang}`);
  const submitLabel = s(data, `submitLabel_${lang}`, lang === "pl" ? "Wyślij" : "Send");
  const successMsg = s(data, `successMsg_${lang}`, lang === "pl" ? "Wysłano!" : "Sent!");
  const iconUrl = s(data, "iconUrl");
  const newsletterLabel = s(data, `newsletterLabel_${lang}`, t.newsletter);

  // Backward compat: legacy `showName` toggled both name parts together.
  const legacyShowName = data.showName === undefined ? null : bool(data, "showName", true);
  const showFirstName = bool(data, "showFirstName", legacyShowName ?? true);
  const showLastName = bool(data, "showLastName", legacyShowName ?? true);
  const showEmail = bool(data, "showEmail", true);
  const showPhone = bool(data, "showPhone");
  const showCompany = bool(data, "showCompany");
  const showSubject = bool(data, "showSubject", true);
  const showMessage = bool(data, "showMessage", true);
  // per-field "wymagane" (spójne z tabelą form_field_policies)
  const requireFirstName = bool(data, "requireFirstName", true);
  const requireLastName = bool(data, "requireLastName", false);
  const requireEmail = bool(data, "requireEmail", true);
  const requirePhone = bool(data, "requirePhone", false);
  const requireCompany = bool(data, "requireCompany", false);
  const requireSubject = bool(data, "requireSubject", false);
  const requireMessage = bool(data, "requireMessage", true);
  const requireConsent = bool(data, "requireConsent", true);
  const showNewsletter = bool(data, "showNewsletterOptIn");
  const consentTextRaw = s(data, `consentText_${lang}`, t.consent);

  // Per-field label / placeholder overrides (fall back to defaults from `t`).
  const L = {
    firstName: readI18nOverride(data, "firstNameLabel", lang, t.firstName),
    lastName: readI18nOverride(data, "lastNameLabel", lang, t.lastName),
    email: readI18nOverride(data, "emailLabel", lang, t.email),
    phone: readI18nOverride(data, "phoneLabel", lang, t.phone),
    company: readI18nOverride(data, "companyLabel", lang, t.company),
    subject: readI18nOverride(data, "subjectLabel", lang, t.subject),
    message: readI18nOverride(data, "messageLabel", lang, t.message),
  };
  const P = {
    firstName: readI18nOverride(data, "firstNamePlaceholder", lang, lang === "pl" ? "Jan" : "John"),
    lastName: readI18nOverride(data, "lastNamePlaceholder", lang, lang === "pl" ? "Kowalski" : "Doe"),
    email: readI18nOverride(data, "emailPlaceholder", lang, "name@example.com"),
    phone: readI18nOverride(data, "phonePlaceholder", lang, ""),
    company: readI18nOverride(data, "companyPlaceholder", lang, ""),
    subject: readI18nOverride(data, "subjectPlaceholder", lang, ""),
    message: readI18nOverride(data, "messagePlaceholder", lang, ""),
  };
  const customFields = useMemo<CustomField[]>(
    () => parseCustomFields(data.customFields),
    [data.customFields],
  );


  const columns = Math.max(1, Math.min(3, num(data, "columns", 2)));
  const buttonAlign = s(data, "buttonAlign", "left") as "left" | "center" | "right" | "full";
  const buttonPosition = s(data, "buttonPosition", "bottom") as "bottom" | "inline-right";
  const buttonVariant = s(data, "buttonVariant", "solid") as
    | "solid"
    | "outline"
    | "ghost"
    | "gradient";
  const buttonSize = s(data, "buttonSize", "md") as "sm" | "md" | "lg";

  // `recipient` (widget override) is intentionally ignored client-side; the
  // server resolves the admin address from trusted contact_form_settings.
  const _unusedRecipient = s(data, "recipient");
  void _unusedRecipient;
  const bgLight = s(data, "bgLight");
  const bgDark = s(data, "bgDark");
  const textColor = s(data, "textColor");
  const borderColor = s(data, "borderColor");
  const radiusPx = num(data, "radiusPx", 12);
  const paddingPx = num(data, "paddingPx", 32);
  const bgImage = s(data, "bgImage");
  const bgImageMobile = s(data, "bgImageMobile");
  const bgOverlay = num(data, "bgOverlay", 0);

  // Font-size overrides (px). 0 = leave default.
  const titleSize = num(data, "titleSize", 0);
  const descriptionSize = num(data, "descriptionSize", 0);
  const labelSize = num(data, "labelSize", 0);
  const placeholderSize = num(data, "placeholderSize", 0);
  const buttonFontSize = num(data, "buttonFontSize", 0);
  const consentSize = num(data, "consentSize", 0);


  const shellStyle = useMemo<CSSProperties>(() => {
    const css: Record<string, string> = {
      "--cf-bg-light": bgLight || "hsl(var(--card))",
      "--cf-bg-dark": bgDark || bgLight || "hsl(var(--card))",
      "--cf-radius": `${radiusPx}px`,
      "--cf-padding": `${paddingPx}px`,
    };
    if (textColor) css["--cf-text"] = textColor;
    if (borderColor) css["--cf-border"] = borderColor;
    return css as CSSProperties;
  }, [bgLight, bgDark, textColor, borderColor, radiusPx, paddingPx]);

  // Scoped CSS for per-instance font sizes. Empty (0) values are skipped so
  // Tailwind defaults still apply.
  const fontSizeCss = useMemo(() => {
    const scope = `[data-cf-id="${formId}"]`;
    const rules: string[] = [];
    if (titleSize > 0) rules.push(`${scope} .cf-title{font-size:${titleSize}px;line-height:1.2;}`);
    if (descriptionSize > 0)
      rules.push(`${scope} .cf-subtitle{font-size:${descriptionSize}px;}`);
    if (labelSize > 0)
      rules.push(`${scope} .cf-field-label{font-size:${labelSize}px;}`);
    if (placeholderSize > 0)
      rules.push(
        `${scope} .cf-input{font-size:${placeholderSize}px;}${scope} .cf-input::placeholder{font-size:${placeholderSize}px;}`,
      );
    if (buttonFontSize > 0)
      rules.push(`${scope} .cf-submit{font-size:${buttonFontSize}px;}`);
    if (consentSize > 0)
      rules.push(`${scope} .cf-consent{font-size:${consentSize}px;}`);
    return rules.join("");
  }, [formId, titleSize, descriptionSize, labelSize, placeholderSize, buttonFontSize, consentSize]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if ((fd.get("website") as string)?.length) return; // honeypot
    const firstName = String(fd.get("firstName") ?? "").trim();
    const lastName = String(fd.get("lastName") ?? "").trim();
    const rodoGiven = fd.get("consent") === "on";
    const newsletterGiven = fd.get("newsletter_optin") === "on";
    const consents: Array<{
      key: string;
      text: string;
      given: boolean;
      lang: string;
      version?: string;
    }> = [];
    if (requireConsent) {
      consents.push({ key: "rodo", text: consentTextRaw, given: rodoGiven, lang });
    }
    if (showNewsletter && newsletterGiven) {
      consents.push({ key: "newsletter", text: newsletterLabel, given: true, lang });
    }
    const requiredMap: Record<string, boolean> = {
      firstName: showFirstName && requireFirstName,
      lastName: showLastName && requireLastName,
      email: showEmail && requireEmail,
      phone: showPhone && requirePhone,
      company: showCompany && requireCompany,
      subject: showSubject && requireSubject,
      message: showMessage && requireMessage,
    };
    const requiredFields = Object.entries(requiredMap)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const payload = {
      name: [firstName, lastName].filter(Boolean).join(" "),
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || undefined,
      company: String(fd.get("company") ?? "").trim() || undefined,
      subject: String(fd.get("subject") ?? "").trim() || undefined,
      message: String(fd.get("message") ?? "").trim(),
      consent: rodoGiven || !requireConsent,
      newsletterOptIn: newsletterGiven,
      lang,
      // `recipient` is intentionally omitted from the payload - see
      // contact.functions.ts, the admin address is resolved server-side to
      // prevent open email relay abuse.
      source: typeof window !== "undefined" ? window.location.pathname : undefined,
      formId: formId,
      formName: title || undefined,
      pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
      referer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      consents,
      requiredFields,
      custom: collectCustomValues(customFields, fd),
    };

    const errs: Record<string, string> = {};
    if (requiredMap.firstName && !firstName) errs.firstName = t.required;
    if (requiredMap.lastName && !lastName) errs.lastName = t.required;
    if (requiredMap.email && !payload.email) errs.email = t.required;
    else if (showEmail && payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))
      errs.email = t.invalidEmail;
    if (requiredMap.phone && !payload.phone) errs.phone = t.required;
    if (requiredMap.company && !payload.company) errs.company = t.required;
    if (requiredMap.subject && !payload.subject) errs.subject = t.required;
    if (requiredMap.message && !payload.message) errs.message = t.required;
    if (requireConsent && !payload.consent) errs.consent = t.required;
    Object.assign(errs, validateCustom(customFields, payload.custom, t.required));

    setErrors(errs);
    if (Object.keys(errs).length) return;

    setStatus("sending");
    try {
      await submit({ data: payload });
      setStatus("ok");
      (e.target as HTMLFormElement).reset();
    } catch {
      setStatus("err");
    }
  }

  const widthCls = (w: 1 | 2 | 3) => {
    if (columns === 1) return "sm:col-span-1";
    if (columns === 2) return w >= 2 ? "sm:col-span-2" : "sm:col-span-1";
    return w === 3 ? "sm:col-span-3" : w === 2 ? "sm:col-span-2" : "sm:col-span-1";
  };
  const gridCols =
    columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  const buttonClasses = useMemo(() => {
    const size =
      buttonSize === "sm"
        ? "px-3 py-1.5 text-xs"
        : buttonSize === "lg"
          ? "px-6 py-3 text-base"
          : "px-4 py-2 text-sm";
    const variantCls =
      buttonVariant === "outline"
        ? "border border-current bg-transparent hover:bg-foreground/10"
        : buttonVariant === "ghost"
          ? "bg-transparent hover:bg-foreground/10"
          : buttonVariant === "gradient"
            ? "bg-gradient-to-r from-primary to-[color-mix(in_oklab,hsl(var(--primary))_70%,white)] text-primary-foreground"
            : "bg-primary text-primary-foreground hover:opacity-90";
    const align = buttonAlign === "full" ? "w-full" : "";
    return `inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-60 ${size} ${variantCls} ${align}`;
  }, [buttonAlign, buttonVariant, buttonSize]);

  const buttonWrapCls =
    buttonAlign === "center"
      ? "flex justify-center"
      : buttonAlign === "right"
        ? "flex justify-end"
        : buttonAlign === "full"
          ? "block"
          : "flex justify-start";

  if (status === "ok") {
    return (
      <div
        className={`cf-shell cf-shell--${variant}`}
        style={shellStyle}
        role="status"
        aria-live="polite"
      >
        <div className="cf-inner text-center">
          <p className="text-lg font-semibold">{successMsg}</p>
        </div>
      </div>
    );
  }

  const submitButton: ReactNode = (
    <button type="submit" disabled={status === "sending"} className={`cf-submit ${buttonClasses}`}>
      {status === "sending" ? t.sending : submitLabel}
    </button>
  );

  return (
    <div className={`cf-shell cf-shell--${variant}`} style={shellStyle}>
      {fontSizeCss && <style dangerouslySetInnerHTML={{ __html: fontSizeCss }} />}
      {/* Image background layer */}
      {(bgImage || bgImageMobile) && (
        <div
          className="cf-bg cf-bg--image"
          aria-hidden
          style={{
            backgroundImage: bgImage ? `url("${bgImage}")` : undefined,
          }}
        >
          {bgImageMobile && (
            <style>{`@media(max-width:640px){[data-cf-id="${formId}"] .cf-bg--image{background-image:url("${bgImageMobile}")}}`}</style>
          )}
          {bgOverlay > 0 && (
            <span
              className="cf-bg__overlay"
              style={{ background: `rgba(0,0,0,${bgOverlay / 100})` }}
            />
          )}
        </div>
      )}



      <form onSubmit={onSubmit} data-cf-id={formId} className="cf-inner relative" noValidate>
        {(iconUrl || title || subtitle) && (
          <header className="space-y-2 mb-4">
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                width={48}
                height={48}
                className="rounded-md object-cover"
              />
            )}
            {title && <h3 className="cf-title text-xl font-semibold leading-tight">{title}</h3>}
            {subtitle && <p className="cf-subtitle text-sm opacity-80">{subtitle}</p>}
          </header>
        )}

        {/* honeypot */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          className="absolute h-0 w-0 -left-[9999px] opacity-0"
          aria-hidden="true"
        />

        <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
          {showFirstName && (
            <Field label={L.firstName} required={requireFirstName} error={errors.firstName} className={widthCls(1)}>
              <input
                name="firstName"
                required={requireFirstName}
                aria-required={requireFirstName || undefined}
                className="cf-input"
                autoComplete="given-name"
                placeholder={P.firstName}
              />
            </Field>
          )}
          {showLastName && (
            <Field label={L.lastName} required={requireLastName} error={errors.lastName} className={widthCls(1)}>
              <input
                name="lastName"
                required={requireLastName}
                aria-required={requireLastName || undefined}
                className="cf-input"
                autoComplete="family-name"
                placeholder={P.lastName}
              />
            </Field>
          )}
          {showEmail && (
            <Field
              label={L.email}
              required={requireEmail}
              error={errors.email}
              className={widthCls(showFirstName || showLastName ? 1 : 2)}
            >
              <input
                name="email"
                type="email"
                required={requireEmail}
                aria-required={requireEmail || undefined}
                className="cf-input"
                autoComplete="email"
                placeholder={P.email}
              />
            </Field>
          )}

          {showPhone && (
            <Field label={L.phone} required={requirePhone} error={errors.phone} className={widthCls(1)}>
              <input
                name="phone"
                type="tel"
                required={requirePhone}
                aria-required={requirePhone || undefined}
                className="cf-input"
                autoComplete="tel"
                placeholder={P.phone}
              />
            </Field>
          )}
          {showCompany && (
            <Field label={L.company} required={requireCompany} error={errors.company} className={widthCls(1)}>
              <input
                name="company"
                required={requireCompany}
                aria-required={requireCompany || undefined}
                className="cf-input"
                autoComplete="organization"
                placeholder={P.company}
              />
            </Field>
          )}
          {showSubject && (
            <Field label={L.subject} required={requireSubject} error={errors.subject} className={widthCls(columns === 3 ? 3 : 2)}>
              <input
                name="subject"
                required={requireSubject}
                aria-required={requireSubject || undefined}
                className="cf-input"
                placeholder={P.subject}
              />
            </Field>
          )}
          {showMessage && (
            <Field
              label={L.message}
              required={requireMessage}
              error={errors.message}
              className={widthCls(columns === 3 ? 3 : 2)}
            >
              <textarea
                name="message"
                rows={10}
                required={requireMessage}
                aria-required={requireMessage || undefined}
                className="cf-input resize-y"
                placeholder={P.message}
              />
            </Field>
          )}

          {customFields.map((f) => {
            const label = pickLabel(f, lang);
            const placeholder = pickPlaceholder(f, lang);
            const err = errors[f.id];
            const name = `custom_${f.id}`;
            const span = widthCls(f.type === "textarea" ? (columns === 3 ? 3 : 2) : 1);
            if (f.type === "checkbox") {
              return (
                <div key={f.id} className={span}>
                  <label className="widget-align-row flex items-start gap-2 text-xs opacity-90">
                    <input type="checkbox" name={name} className="mt-0.5" />
                    <span>
                      {label}
                      {f.required ? <span className="text-destructive ml-0.5" aria-hidden="true">*</span> : null}
                    </span>
                  </label>
                  {err && <span className="block text-[11px] text-destructive">{err}</span>}
                </div>
              );
            }
            if (f.type === "select") {
              return (
                <Field key={f.id} label={label} required={f.required} error={err} className={span}>
                  <select name={name} required={f.required} aria-required={f.required || undefined} className="cf-input" defaultValue="">
                    <option value="" disabled>
                      {placeholder || (lang === "pl" ? "Wybierz..." : "Select...")}
                    </option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {(lang === "pl" ? o.labelPl : o.labelEn) ?? o.value}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            }
            if (f.type === "textarea") {
              return (
                <Field key={f.id} label={label} required={f.required} error={err} className={span}>
                  <textarea
                    name={name}
                    rows={5}
                    required={f.required}
                    aria-required={f.required || undefined}
                    className="cf-input resize-y"
                    placeholder={placeholder}
                    maxLength={f.maxLength ?? 4000}
                  />
                </Field>
              );
            }
            return (
              <Field key={f.id} label={label} required={f.required} error={err} className={span}>
                <input
                  name={name}
                  type={f.type}
                  required={f.required}
                  aria-required={f.required || undefined}
                  className="cf-input"
                  placeholder={placeholder}
                  maxLength={f.maxLength ?? 500}
                />
              </Field>
            );
          })}


          {/* Inline-right button slot inside grid */}
          {buttonPosition === "inline-right" && (
            <div className={`${widthCls(columns === 3 ? 3 : 2)} flex items-end justify-end`}>
              {submitButton}
            </div>
          )}
        </div>

        {(requireConsent || showNewsletter) && (
          <div className="mt-3 space-y-1.5">
            {requireConsent && (
              <label className="cf-consent widget-align-row flex items-start gap-2 text-xs opacity-80">
                <input type="checkbox" name="consent" className="mt-0.5" />
                <span>{renderConsentText(consentTextRaw)}</span>
                {errors.consent && <span className="text-destructive ml-1">*</span>}
              </label>
            )}

            {showNewsletter && (
              <label className="cf-consent widget-align-row flex items-start gap-2 text-xs opacity-80">
                <input type="checkbox" name="newsletter_optin" className="mt-0.5" />
                <span>{newsletterLabel}</span>
              </label>
            )}
          </div>
        )}

        {buttonPosition === "bottom" && (
          <div className={`mt-4 ${buttonWrapCls}`}>{submitButton}</div>
        )}

        {status === "err" && <p className="mt-2 text-sm text-destructive">{t.error}</p>}
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className="cf-field-label text-xs font-semibold tracking-wide opacity-95">
        {label}
        {required ? <span className="text-destructive ml-0.5" aria-hidden="true">*</span> : null}
      </span>
      {children}
      {error && <span className="block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
