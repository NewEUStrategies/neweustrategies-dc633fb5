// Dynamic, themable contact-form widget with configurable fields,
// columns, button placement, light/dark backgrounds, image background,
// and six subtle animated background variants.
import { useId, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitContactMessage } from "@/lib/contact.functions";
import { ContactFormBackground, type ContactBgVariant } from "./ContactFormBackgrounds";

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
    firstName: "Imię", lastName: "Nazwisko",
    email: "E-mail", phone: "Telefon", company: "Firma",
    subject: "Temat", message: "Wiadomość",
    consent: "Wyrażam zgodę na przetwarzanie danych w celu odpowiedzi na zapytanie.",
    newsletter: "Zapisz mnie do newslettera",
    required: "Pole wymagane", invalidEmail: "Niepoprawny adres e-mail",
    sending: "Wysyłanie...", error: "Wystąpił błąd. Spróbuj ponownie.",
  },
  en: {
    firstName: "First name", lastName: "Last name",
    email: "Email", phone: "Phone", company: "Company",
    subject: "Subject", message: "Message",
    consent: "I agree to processing of my data to receive a reply.",
    newsletter: "Subscribe me to the newsletter",
    required: "Required field", invalidEmail: "Invalid email address",
    sending: "Sending...", error: "Something went wrong. Please try again.",
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
      /^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith("/")
        ? raw
        : "";
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

  const showName = bool(data, "showName", true);
  const showEmail = bool(data, "showEmail", true);
  const showPhone = bool(data, "showPhone");
  const showCompany = bool(data, "showCompany");
  const showSubject = bool(data, "showSubject", true);
  const showMessage = bool(data, "showMessage", true);
  const requireConsent = bool(data, "requireConsent", true);
  const showNewsletter = bool(data, "showNewsletterOptIn");

  const columns = Math.max(1, Math.min(3, num(data, "columns", 2)));
  const buttonAlign = s(data, "buttonAlign", "left") as "left" | "center" | "right" | "full";
  const buttonPosition = s(data, "buttonPosition", "bottom") as "bottom" | "inline-right";
  const buttonVariant = s(data, "buttonVariant", "solid") as "solid" | "outline" | "ghost" | "gradient";
  const buttonSize = s(data, "buttonSize", "md") as "sm" | "md" | "lg";

  const recipient = s(data, "recipient");
  const bgLight = s(data, "bgLight");
  const bgDark = s(data, "bgDark");
  const textColor = s(data, "textColor");
  const borderColor = s(data, "borderColor");
  const radiusPx = num(data, "radiusPx", 12);
  const paddingPx = num(data, "paddingPx", 32);
  const bgImage = s(data, "bgImage");
  const bgImageMobile = s(data, "bgImageMobile");
  const bgOverlay = num(data, "bgOverlay", 0);
  const bgAnimation = s(data, "bgAnimation", "none") as ContactBgVariant;

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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if ((fd.get("website") as string)?.length) return; // honeypot
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || undefined,
      company: String(fd.get("company") ?? "").trim() || undefined,
      subject: String(fd.get("subject") ?? "").trim() || undefined,
      message: String(fd.get("message") ?? "").trim(),
      consent: fd.get("consent") === "on" || !requireConsent,
      newsletterOptIn: fd.get("newsletter_optin") === "on",
      lang,
      recipient: recipient || undefined,
      source: typeof window !== "undefined" ? window.location.pathname : undefined,
    };
    const errs: Record<string, string> = {};
    if (showName && !payload.name) errs.name = t.required;
    if (showEmail && !payload.email) errs.email = t.required;
    else if (showEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errs.email = t.invalidEmail;
    if (showMessage && !payload.message) errs.message = t.required;
    if (requireConsent && !payload.consent) errs.consent = t.required;
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
  const gridCols = columns === 1
    ? "grid-cols-1"
    : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  const buttonClasses = useMemo(() => {
    const size = buttonSize === "sm" ? "px-3 py-1.5 text-xs"
      : buttonSize === "lg" ? "px-6 py-3 text-base" : "px-4 py-2 text-sm";
    const variantCls =
      buttonVariant === "outline" ? "border border-current bg-transparent hover:bg-foreground/10"
      : buttonVariant === "ghost" ? "bg-transparent hover:bg-foreground/10"
      : buttonVariant === "gradient"
        ? "bg-gradient-to-r from-primary to-[color-mix(in_oklab,hsl(var(--primary))_70%,white)] text-primary-foreground"
        : "bg-primary text-primary-foreground hover:opacity-90";
    const align = buttonAlign === "full" ? "w-full" : "";
    return `inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-60 ${size} ${variantCls} ${align}`;
  }, [buttonAlign, buttonVariant, buttonSize]);

  const buttonWrapCls =
    buttonAlign === "center" ? "flex justify-center" :
    buttonAlign === "right" ? "flex justify-end" :
    buttonAlign === "full" ? "block" : "flex justify-start";

  if (status === "ok") {
    return (
      <div className={`cf-shell cf-shell--${variant}`} style={shellStyle} role="status" aria-live="polite">
        <div className="cf-inner text-center">
          <p className="text-lg font-semibold">{successMsg}</p>
        </div>
      </div>
    );
  }

  const submitButton: ReactNode = (
    <button
      type="submit"
      disabled={status === "sending"}
      className={buttonClasses}
    >
      {status === "sending" ? t.sending : submitLabel}
    </button>
  );

  return (
    <div className={`cf-shell cf-shell--${variant}`} style={shellStyle}>
      {/* Image background layer */}
      {(bgImage || bgImageMobile) && (
        <div className="cf-bg cf-bg--image" aria-hidden style={{
          backgroundImage: bgImage ? `url("${bgImage}")` : undefined,
        }}>
          {bgImageMobile && (
            <style>{`@media(max-width:640px){[data-cf-id="${formId}"] .cf-bg--image{background-image:url("${bgImageMobile}")}}`}</style>
          )}
          {bgOverlay > 0 && (
            <span className="cf-bg__overlay" style={{ background: `rgba(0,0,0,${bgOverlay / 100})` }} />
          )}
        </div>
      )}
      {/* Animated background layer */}
      <ContactFormBackground variant={bgAnimation} />

      <form onSubmit={onSubmit} data-cf-id={formId} className="cf-inner relative" noValidate>
        {(iconUrl || title || subtitle) && (
          <header className="space-y-2 mb-4">
            {iconUrl && <img src={iconUrl} alt="" width={48} height={48} className="rounded-md object-cover" />}
            {title && <h3 className="text-xl font-semibold leading-tight">{title}</h3>}
            {subtitle && <p className="text-sm opacity-80">{subtitle}</p>}
          </header>
        )}

        {/* honeypot */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off"
          className="absolute h-0 w-0 -left-[9999px] opacity-0" aria-hidden="true" />

        <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
          {showName && (
            <Field label={t.name} error={errors.name} className={widthCls(showEmail ? 1 : 2)}>
              <input name="name" required className="cf-input" autoComplete="name" />
            </Field>
          )}
          {showEmail && (
            <Field label={t.email} error={errors.email} className={widthCls(showName ? 1 : 2)}>
              <input name="email" type="email" required className="cf-input" autoComplete="email" />
            </Field>
          )}
          {showPhone && (
            <Field label={t.phone} className={widthCls(1)}>
              <input name="phone" type="tel" className="cf-input" autoComplete="tel" />
            </Field>
          )}
          {showCompany && (
            <Field label={t.company} className={widthCls(1)}>
              <input name="company" className="cf-input" autoComplete="organization" />
            </Field>
          )}
          {showSubject && (
            <Field label={t.subject} className={widthCls(columns === 3 ? 3 : 2)}>
              <input name="subject" className="cf-input" />
            </Field>
          )}
          {showMessage && (
            <Field label={t.message} error={errors.message} className={widthCls(columns === 3 ? 3 : 2)}>
              <textarea name="message" rows={5} required className="cf-input resize-y" />
            </Field>
          )}

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
              <label className="flex items-start gap-2 text-xs opacity-80">
                <input type="checkbox" name="consent" className="mt-0.5" />
                <span>{t.consent}</span>
                {errors.consent && <span className="text-destructive ml-1">*</span>}
              </label>
            )}
            {showNewsletter && (
              <label className="flex items-start gap-2 text-xs opacity-80">
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

function Field({ label, error, className, children }: {
  label: string; error?: string; className?: string; children: ReactNode;
}) {
  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className="text-xs font-medium opacity-80">{label}</span>
      {children}
      {error && <span className="block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
