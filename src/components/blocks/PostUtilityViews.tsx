// Publiczne renderery dla Phase 2 batch 6:
// breadcrumbs, reading-time, share-buttons, post-views.
// Czytają CurrentPostCtx; bez side-effectów, bezpieczne dla SSR.

import { useMemo, useState, useCallback } from "react";
import { useCurrentPostCtx } from "@/lib/builder/currentPostContext";
import { AppLink } from "@/components/atoms/AppLink";
import {
  ChevronRight,
  Home,
  Clock,
  Eye,
  Facebook,
  Twitter,
  Linkedin,
  MessageCircle,
  Send,
  Mail,
  Link2,
  Check,
} from "lucide-react";

type Lang = "pl" | "en";

const L = {
  pl: {
    home: "Strona główna",
    readingTime: (m: number) => `${m} min czytania`,
    views: "wyświetleń",
    share: "Udostępnij",
    copied: "Skopiowano!",
    copy: "Kopiuj link",
  },
  en: {
    home: "Home",
    readingTime: (m: number) => `${m} min read`,
    views: "views",
    share: "Share",
    copied: "Copied!",
    copy: "Copy link",
  },
} as const;

// -------- Breadcrumbs --------

interface BreadcrumbsProps {
  separator?: string;
  showHome?: boolean;
  lang?: Lang;
  cls?: string;
}

export function BreadcrumbsView({ separator = "/", showHome = true, lang = "pl", cls }: BreadcrumbsProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const crumbs = ctx?.breadcrumbs ?? [];

  const items = useMemo(() => {
    const base = showHome ? [{ label: t.home, href: "/" }] : [];
    return [...base, ...crumbs];
  }, [showHome, crumbs, t.home]);

  if (items.length === 0) {
    return (
      <nav aria-label="breadcrumbs" className={cls}>
        <span className="text-xs text-muted-foreground italic">[breadcrumbs]</span>
      </nav>
    );
  }

  return (
    <nav aria-label="breadcrumbs" className={cls}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground/60">
                  {separator === "/" ? <ChevronRight className="w-3.5 h-3.5" /> : separator}
                </span>
              )}
              {!last && c.href ? (
                <AppLink href={c.href} className="hover:text-foreground transition-colors inline-flex items-center gap-1">
                  {i === 0 && showHome ? <Home className="w-3.5 h-3.5" aria-hidden /> : null}
                  <span>{c.label}</span>
                </AppLink>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-foreground font-medium" : ""}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// -------- Reading time --------

interface ReadingTimeProps {
  wpm?: number;
  prefix?: string;
  lang?: Lang;
  cls?: string;
}

export function ReadingTimeView({ wpm = 220, prefix = "", lang = "pl", cls }: ReadingTimeProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];

  const minutes = useMemo(() => {
    if (typeof ctx?.readingTimeMin === "number" && ctx.readingTimeMin > 0) return ctx.readingTimeMin;
    const text = lang === "pl" ? ctx?.excerpt_pl : ctx?.excerpt_en;
    const words = (text ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (!words) return 1;
    return Math.max(1, Math.round(words / Math.max(60, wpm)));
  }, [ctx?.readingTimeMin, ctx?.excerpt_pl, ctx?.excerpt_en, lang, wpm]);

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${cls ?? ""}`}>
      <Clock className="w-3.5 h-3.5" aria-hidden />
      {prefix ? <span>{prefix}</span> : null}
      <span>{t.readingTime(minutes)}</span>
    </span>
  );
}

// -------- Post views --------

interface PostViewsProps {
  suffix?: string;
  lang?: Lang;
  cls?: string;
}

export function PostViewsView({ suffix, lang = "pl", cls }: PostViewsProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const count = typeof ctx?.viewCount === "number" ? ctx.viewCount : 0;
  const formatted = new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US").format(count);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${cls ?? ""}`}>
      <Eye className="w-3.5 h-3.5" aria-hidden />
      <span className="tabular-nums">{formatted}</span>
      <span>{suffix && suffix.trim() ? suffix : t.views}</span>
    </span>
  );
}

// -------- Share buttons --------

type Network = "facebook" | "x" | "linkedin" | "whatsapp" | "telegram" | "email" | "copy";

const NETWORK_META: Record<Network, { label: string; Icon: typeof Facebook; color: string }> = {
  facebook: { label: "Facebook", Icon: Facebook, color: "bg-[#1877F2] text-white" },
  x: { label: "X", Icon: Twitter, color: "bg-foreground text-background" },
  linkedin: { label: "LinkedIn", Icon: Linkedin, color: "bg-[#0A66C2] text-white" },
  whatsapp: { label: "WhatsApp", Icon: MessageCircle, color: "bg-[#25D366] text-white" },
  telegram: { label: "Telegram", Icon: Send, color: "bg-[#229ED9] text-white" },
  email: { label: "Email", Icon: Mail, color: "bg-muted text-foreground" },
  copy: { label: "Copy", Icon: Link2, color: "bg-muted text-foreground" },
};

interface ShareProps {
  networks?: string[];
  variant?: "filled" | "outline" | "ghost";
  lang?: Lang;
  cls?: string;
}

export function ShareButtonsView({ networks, variant = "filled", lang = "pl", cls }: ShareProps) {
  const ctx = useCurrentPostCtx();
  const t = L[lang];
  const [copied, setCopied] = useState(false);

  const list = (networks?.length ? networks : ["facebook", "x", "linkedin", "copy"]).filter(
    (n): n is Network => n in NETWORK_META,
  );

  const url = typeof window !== "undefined" ? window.location.href : "";
  const title = (lang === "pl" ? ctx?.title_pl : ctx?.title_en) ?? ctx?.title_pl ?? ctx?.title_en ?? "";

  const buildHref = useCallback(
    (n: Network): string => {
      const u = encodeURIComponent(url);
      const txt = encodeURIComponent(title);
      switch (n) {
        case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
        case "x": return `https://twitter.com/intent/tweet?url=${u}&text=${txt}`;
        case "linkedin": return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
        case "whatsapp": return `https://wa.me/?text=${txt}%20${u}`;
        case "telegram": return `https://t.me/share/url?url=${u}&text=${txt}`;
        case "email": return `mailto:?subject=${txt}&body=${u}`;
        default: return "#";
      }
    },
    [url, title],
  );

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  }, [url]);

  const variantCls = (active: string): string => {
    if (variant === "outline") return "bg-transparent border border-border text-foreground hover:bg-muted";
    if (variant === "ghost") return "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted";
    return `${active} border border-transparent hover:opacity-90`;
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${cls ?? ""}`} role="group" aria-label={t.share}>
      <span className="text-sm font-medium text-foreground mr-1">{t.share}:</span>
      {list.map((n) => {
        const meta = NETWORK_META[n];
        const { Icon } = meta;
        const className = `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${variantCls(meta.color)}`;
        if (n === "copy") {
          return (
            <button key={n} type="button" onClick={onCopy} className={className} aria-label={copied ? t.copied : t.copy}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              <span>{copied ? t.copied : t.copy}</span>
            </button>
          );
        }
        return (
          <a
            key={n}
            href={buildHref(n)}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            aria-label={`${t.share} ${meta.label}`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{meta.label}</span>
          </a>
        );
      })}
    </div>
  );
}
