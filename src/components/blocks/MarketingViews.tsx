// Publiczne renderery dla Phase 4 batch 11 (sekcje marketingowe).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Json } from "@/lib/blocks/types";
import { AppLink } from "@/components/atoms/AppLink";
import { ChevronLeft, ChevronRight, Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Lang = "pl" | "en";

// ===== Hero =====

type HeroAlign = "left" | "center";
type HeroHeight = "sm" | "md" | "lg" | "screen";

const HERO_HEIGHT_CLS: Record<HeroHeight, string> = {
  sm: "min-h-[320px]",
  md: "min-h-[480px] md:min-h-[560px]",
  lg: "min-h-[600px] md:min-h-[720px]",
  screen: "min-h-[80vh] md:min-h-[90vh]",
};

interface HeroProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  bgImage?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  align?: HeroAlign;
  height?: HeroHeight;
  overlay?: number;
  cls?: string;
}

export function HeroView({
  eyebrow, title, subtitle, bgImage, ctaLabel, ctaHref,
  secondaryLabel, secondaryHref, align = "center", height = "md",
  overlay = 40, cls,
}: HeroProps) {
  const isCenter = align === "center";
  const ov = Math.max(0, Math.min(90, overlay));
  return (
    <section
      className={[
        "relative overflow-hidden rounded-2xl",
        HERO_HEIGHT_CLS[height],
        bgImage ? "bg-cover bg-center" : "bg-gradient-to-br from-primary/15 via-background to-muted",
        cls ?? "",
      ].join(" ")}
      style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
    >
      {bgImage ? (
        <div className="absolute inset-0 bg-black" style={{ opacity: ov / 100 }} aria-hidden />
      ) : null}
      <div
        className={[
          "relative h-full w-full p-6 md:p-12 flex flex-col justify-center",
          isCenter ? "items-center text-center" : "items-start text-left",
        ].join(" ")}
      >
        <div className={`max-w-3xl ${isCenter ? "mx-auto" : ""} space-y-4`}>
          {eyebrow ? (
            <div
              className={[
                "inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide",
                bgImage ? "bg-white/10 text-white backdrop-blur" : "bg-primary/10 text-primary",
              ].join(" ")}
            >
              {eyebrow}
            </div>
          ) : null}
          {title ? (
            <h1
              className={[
                "font-serif text-3xl md:text-5xl lg:text-6xl font-bold leading-tight",
                bgImage ? "text-white" : "text-foreground",
              ].join(" ")}
            >
              {title}
            </h1>
          ) : null}
          {subtitle ? (
            <p
              className={[
                "text-base md:text-lg leading-relaxed",
                bgImage ? "text-white/90" : "text-muted-foreground",
              ].join(" ")}
            >
              {subtitle}
            </p>
          ) : null}
          {(ctaLabel || secondaryLabel) ? (
            <div className={`flex flex-wrap gap-3 ${isCenter ? "justify-center" : ""} pt-2`}>
              {ctaLabel && ctaHref ? (
                <AppLink
                  href={ctaHref}
                  className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  {ctaLabel}
                </AppLink>
              ) : null}
              {secondaryLabel && secondaryHref ? (
                <AppLink
                  href={secondaryHref}
                  className={[
                    "inline-flex items-center justify-center px-5 py-3 rounded-lg border text-sm font-semibold transition-colors",
                    bgImage
                      ? "border-white/30 text-white hover:bg-white/10"
                      : "border-border text-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {secondaryLabel}
                </AppLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ===== CTA Section =====

type CtaVariant = "primary" | "muted" | "gradient" | "outline";

const CTA_CONTAINER: Record<CtaVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  muted: "bg-muted text-foreground",
  gradient: "bg-gradient-to-br from-primary via-primary/80 to-primary/60 text-primary-foreground",
  outline: "border-2 border-primary text-foreground",
};

const CTA_BUTTON: Record<CtaVariant, string> = {
  primary: "bg-primary-foreground text-primary hover:bg-primary-foreground/90",
  muted: "bg-primary text-primary-foreground hover:bg-primary/90",
  gradient: "bg-white text-primary hover:bg-white/90",
  outline: "bg-primary text-primary-foreground hover:bg-primary/90",
};

interface CtaSectionProps {
  title?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  variant?: CtaVariant;
  cls?: string;
}

export function CtaSectionView({
  title, description, ctaLabel, ctaHref, variant = "primary", cls,
}: CtaSectionProps) {
  return (
    <section
      className={[
        "rounded-2xl p-8 md:p-12 text-center flex flex-col items-center gap-4",
        CTA_CONTAINER[variant],
        cls ?? "",
      ].join(" ")}
    >
      {title ? <h2 className="font-serif text-2xl md:text-3xl font-bold">{title}</h2> : null}
      {description ? <p className="max-w-2xl text-sm md:text-base opacity-90">{description}</p> : null}
      {ctaLabel && ctaHref ? (
        <AppLink
          href={ctaHref}
          className={[
            "mt-2 inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold transition-colors",
            CTA_BUTTON[variant],
          ].join(" ")}
        >
          {ctaLabel}
        </AppLink>
      ) : null}
    </section>
  );
}

// ===== Image Carousel =====

interface SlideLite { url: string; alt: string; caption: string; href: string }

const ASPECT_CLS: Record<string, string> = {
  "16:9": "aspect-[16/9]",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square",
  "21:9": "aspect-[21/9]",
};

interface CarouselProps {
  items?: Json[];
  autoplay?: boolean;
  interval?: number;
  aspect?: string;
  cls?: string;
}

export function ImageCarouselView({ items, autoplay, interval = 5000, aspect = "16:9", cls }: CarouselProps) {
  const parsed: SlideLite[] = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items
      .map((i) => {
        const o = (i ?? {}) as Record<string, Json>;
        return {
          url: String(o.url ?? ""),
          alt: String(o.alt ?? ""),
          caption: String(o.caption ?? ""),
          href: String(o.href ?? ""),
        };
      })
      .filter((s) => s.url.length > 0);
  }, [items]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = parsed.length;

  const go = useCallback((d: number) => {
    if (total === 0) return;
    setIdx((cur) => (cur + d + total) % total);
  }, [total]);

  useEffect(() => {
    if (!autoplay || paused || total < 2) return;
    const t = window.setInterval(() => setIdx((cur) => (cur + 1) % total), Math.max(1500, interval));
    return () => window.clearInterval(t);
  }, [autoplay, paused, interval, total]);

  if (total === 0) return null;
  const aspectCls = ASPECT_CLS[aspect] ?? ASPECT_CLS["16:9"];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${cls ?? ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="region"
      aria-roledescription="karuzela"
    >
      <div className={`relative w-full ${aspectCls} bg-muted`}>
        {parsed.map((s, i) => {
          const visible = i === idx;
          const inner = (
            <>
              <img
                src={s.url}
                alt={s.alt}
                loading={i === 0 ? "eager" : "lazy"}
                className="w-full h-full object-cover"
              />
              {s.caption ? (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm text-white">
                  {s.caption}
                </div>
              ) : null}
            </>
          );
          return (
            <div
              key={i}
              aria-hidden={!visible}
              className={[
                "absolute inset-0 transition-opacity duration-500",
                visible ? "opacity-100" : "opacity-0 pointer-events-none",
              ].join(" ")}
            >
              {s.href ? (
                <AppLink href={s.href} className="block w-full h-full">{inner}</AppLink>
              ) : (
                inner
              )}
            </div>
          );
        })}
      </div>
      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60"
            aria-label="Poprzedni slajd"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60"
            aria-label="Następny slajd"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {parsed.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Slajd ${i + 1}`}
                aria-current={i === idx}
                className={[
                  "h-1.5 rounded-full transition-all",
                  i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80",
                ].join(" ")}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ===== Contact Form =====

interface ContactFormProps {
  title?: string;
  description?: string;
  showPhone?: boolean;
  showSubject?: boolean;
  requireConsent?: boolean;
  submitLabel?: string;
  successMessage?: string;
  lang?: Lang;
  cls?: string;
}

const CONTACT_L = {
  pl: {
    name: "Imię i nazwisko", email: "Adres e-mail", phone: "Telefon", subject: "Temat",
    message: "Wiadomość", consent: "Wyrażam zgodę na przetwarzanie danych w celu udzielenia odpowiedzi.",
    submit: "Wyślij wiadomość", sending: "Wysyłanie...",
    success: "Dziękujemy - wiadomość została wysłana.",
    error: "Nie udało się wysłać wiadomości. Spróbuj ponownie.",
    consentRequired: "Wymagana zgoda na przetwarzanie danych.",
  },
  en: {
    name: "Full name", email: "Email address", phone: "Phone", subject: "Subject",
    message: "Message", consent: "I agree to data processing to receive a reply.",
    submit: "Send message", sending: "Sending...",
    success: "Thanks - your message has been sent.",
    error: "Could not send the message. Please try again.",
    consentRequired: "Consent is required to submit.",
  },
} as const;

export function ContactFormView({
  title, description, showPhone = false, showSubject = true,
  requireConsent = true, submitLabel, successMessage, lang = "pl", cls,
}: ContactFormProps) {
  const t = CONTACT_L[lang];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(!requireConsent);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireConsent && !consent) {
      setStatus("err"); setErrMsg(t.consentRequired);
      return;
    }
    setStatus("loading"); setErrMsg("");
    try {
      const payload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        subject: subject.trim() || null,
        message: message.trim(),
      };
      const { error } = await supabase.from("contact_messages").insert(payload);
      if (error) throw error;
      setStatus("ok");
      setName(""); setEmail(""); setPhone(""); setSubject(""); setMessage("");
      if (requireConsent) setConsent(false);
    } catch (err) {
      setStatus("err");
      setErrMsg(err instanceof Error ? err.message : t.error);
    }
  };

  const success = successMessage || t.success;

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 ${cls ?? ""}`}>
      {title ? <h2 className="font-serif text-xl md:text-2xl font-bold text-foreground">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs text-muted-foreground">
            {t.name}
            <input
              required
              autoComplete="name"
              className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            {t.email}
            <input
              required
              type="email"
              autoComplete="email"
              className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {showPhone ? (
            <label className="block text-xs text-muted-foreground">
              {t.phone}
              <input
                type="tel"
                autoComplete="tel"
                className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          ) : null}
          {showSubject ? (
            <label className="block text-xs text-muted-foreground">
              {t.subject}
              <input
                className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 h-10"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
          ) : null}
        </div>
        <label className="block text-xs text-muted-foreground">
          {t.message}
          <textarea
            required
            className="mt-1 w-full text-sm bg-background border border-border rounded px-3 py-2 min-h-[120px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {requireConsent ? (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t.consent}</span>
          </label>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={status === "loading"}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {status === "loading" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
            {status === "loading" ? t.sending : (submitLabel || t.submit)}
          </button>
          {status === "ok" ? (
            <span className="text-sm text-emerald-600" role="status">{success}</span>
          ) : null}
          {status === "err" ? (
            <span className="text-sm text-destructive" role="alert">{errMsg || t.error}</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

// ===== Map (OpenStreetMap iframe, no API key) =====

interface MapProps {
  lat?: number;
  lng?: number;
  zoom?: number;
  height?: number;
  label?: string;
  cls?: string;
}

export function MapView({ lat = 52.2297, lng = 21.0122, zoom = 13, height = 360, label, cls }: MapProps) {
  // OSM "export" embed - safe, no API key. bbox = ~0.01 degrees around point per zoom level.
  const span = Math.max(0.0008, 0.5 / Math.pow(1.6, Math.max(1, Math.min(18, zoom)) - 1));
  const bbox = `${(lng - span).toFixed(5)},${(lat - span).toFixed(5)},${(lng + span).toFixed(5)},${(lat + span).toFixed(5)}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const linkHref = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  return (
    <figure className={`rounded-2xl overflow-hidden border border-border bg-card ${cls ?? ""}`}>
      <iframe
        title={label || "Mapa"}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ width: "100%", height: `${Math.max(160, Math.min(800, height))}px`, border: 0 }}
      />
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" aria-hidden />
          {label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        </span>
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Otwórz w OpenStreetMap
        </a>
      </figcaption>
    </figure>
  );
}
