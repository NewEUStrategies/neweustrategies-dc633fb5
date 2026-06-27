// Floating reading rail - sticky left-side rail on long-form content.
// Combines: reading progress ring + interactive article ToC (scrollspy + jump)
// + social share actions. Desktop only (>= lg). Uses semantic tokens.
import { useEffect, useMemo, useRef, useState } from "react";
import { Twitter, Facebook, Linkedin, Mail, Copy, Share2, Printer, Download, List, X, BookOpen } from "@/lib/lucide-shim";
import { toast } from "sonner";

type Lang = "pl" | "en";

interface Props {
  title: string;
  /** Absolute URL of the post. When empty we use window.location at runtime. */
  url?: string;
  lang: Lang;
  /** Hide automatically until user scrolls past N px from top. Default 240. */
  showAfter?: number;
}

interface TocItem {
  id: string;
  text: string;
  level: 1 | 2 | 3 | 4 | 5;
}

const COPY = {
  pl: {
    share: "Udostępnij",
    copy: "Skopiuj link",
    copied: "Skopiowano link!",
    x: "X (Twitter)",
    fb: "Facebook",
    li: "LinkedIn",
    mail: "E-mail",
    toc: "Spis treści",
    progress: "Postęp czytania",
    print: "Drukuj artykuł",
    pdf: "Pobierz jako PDF",
    pdfHint: "Wybierz \u201EZapisz jako PDF\u201D w oknie drukowania",
    actions: "Akcje",
    tocTitle: "SPIS TREŚCI",
    read: "przeczytano",
  },
  en: {
    share: "Share",
    copy: "Copy link",
    copied: "Link copied!",
    x: "X (Twitter)",
    fb: "Facebook",
    li: "LinkedIn",
    mail: "Email",
    toc: "On this page",
    progress: "Reading progress",
    print: "Print article",
    pdf: "Download as PDF",
    pdfHint: "Choose \"Save as PDF\" in the print dialog",
    actions: "Actions",
    tocTitle: "ON THIS PAGE",
    read: "read",
  },
} as const;

function getArticleRoot(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".article-body") ??
    document.querySelector<HTMLElement>("[data-cms-prose]") ??
    document.querySelector<HTMLElement>("article")
  );
}

function slugifyHeading(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "section"
  );
}

export function FloatingShareBar({ title, url, lang, showAfter = 240 }: Props) {
  const [visible, setVisible] = useState(false);
  const [href, setHref] = useState(url ?? "");
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<TocItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const railRef = useRef<HTMLElement>(null);
  const t = COPY[lang];

  useEffect(() => {
    if (!url && typeof window !== "undefined") setHref(window.location.href);
  }, [url]);

  // Scan headings (h1-h5) within the article body. Assign IDs when missing.
  useEffect(() => {
    const scan = (): void => {
      const root = getArticleRoot();
      if (!root) {
        setItems([]);
        return;
      }
      const hs = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5")) as HTMLHeadingElement[];
      const seen = new Set<string>();
      const next: TocItem[] = hs
        .filter((h) => (h.textContent ?? "").trim().length > 0)
        .map((h) => {
          const text = (h.textContent ?? "").trim();
          let id = h.id || slugifyHeading(text);
          let n = 2;
          while (seen.has(id)) id = `${id}-${n++}`;
          seen.add(id);
          if (!h.id) h.id = id;
          const lvl = Number(h.tagName.substring(1)) as 1 | 2 | 3 | 4 | 5;
          return { id, text, level: lvl };
        });
      setItems(next);
    };
    scan();
    // Re-scan if content lazy-mounts (related posts, ads, etc.).
    const obs = new MutationObserver(() => scan());
    const root = getArticleRoot();
    if (root) obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // Reading progress + visibility.
  useEffect(() => {
    const onScroll = (): void => {
      const y = window.scrollY;
      setVisible(y > showAfter);
      const root = getArticleRoot();
      if (root) {
        const rect = root.getBoundingClientRect();
        const start = window.scrollY + rect.top;
        const end = start + rect.height - window.innerHeight;
        const pct = end > start ? (window.scrollY - start) / (end - start) : 0;
        setProgress(Math.min(1, Math.max(0, pct)));
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [showAfter]);

  // Scrollspy for active heading.
  useEffect(() => {
    if (items.length === 0) return;
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting);
        if (vis.length > 0) {
          const top = vis.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
          setActive(top.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0.01 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [items]);

  const enc = encodeURIComponent;
  const u = href || "";
  const links = useMemo(
    () =>
      [
        { id: "x", label: t.x, icon: Twitter, href: `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(title)}` },
        { id: "fb", label: t.fb, icon: Facebook, href: `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
        { id: "li", label: t.li, icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}` },
        { id: "mail", label: t.mail, icon: Mail, href: `mailto:?subject=${enc(title)}&body=${enc(u)}` },
      ] as const,
    [u, title, t],
  );

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(u);
      toast.success(t.copied);
    } catch {
      // Clipboard may be blocked (insecure context, permission); fall back silently.
    }
  };

  const onPrint = (): void => {
    window.print();
  };

  const onPdf = (): void => {
    toast.info(t.pdfHint);
    // Defer so toast paints before the blocking print dialog
    window.setTimeout(() => window.print(), 120);
  };



  const jumpTo = (id: string): void => {
    const el = document.getElementById(id);
    if (!el) return;
    setMobileOpen(false);
    const targetTop = el.getBoundingClientRect().top + window.scrollY - 80;
    const startTop = window.scrollY;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 2) {
      history.replaceState(null, "", `#${id}`);
      return;
    }
    // Custom rAF tween - bypasses CSS scroll-behavior/reduced-motion conflicts
    // and any router/view-transition interception of hash changes.
    // Duration scales with distance: 350-1100ms.
    const duration = Math.min(1100, Math.max(350, Math.abs(distance) * 0.45));
    const startTime = performance.now();
    // easeInOutCubic
    const ease = (t: number): number =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    let cancelled = false;
    const onUserScroll = (): void => {
      cancelled = true;
    };
    window.addEventListener("wheel", onUserScroll, { passive: true, once: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true, once: true });

    const step = (now: number): void => {
      if (cancelled) {
        window.removeEventListener("wheel", onUserScroll);
        window.removeEventListener("touchstart", onUserScroll);
        return;
      }
      const t = Math.min(1, (now - startTime) / duration);
      window.scrollTo(0, startTop + distance * ease(t));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        history.replaceState(null, "", `#${id}`);
        window.removeEventListener("wheel", onUserScroll);
        window.removeEventListener("touchstart", onUserScroll);
      }
    };
    requestAnimationFrame(step);
  };

  // SVG ring geometry
  const ringSize = 44;
  const ringStroke = 3;
  const r = (ringSize - ringStroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * progress;

  const hasToc = items.length > 0;

  return (
    <>
    <aside
      ref={railRef}
      data-floating-share
      aria-label={t.share}
      className={[
        "hidden lg:flex flex-col fixed left-5 top-1/2 -translate-y-1/2 z-40",
        "w-[248px] max-h-[min(86vh,720px)]",
        "rounded-[5px] border border-border/70 bg-background/90 backdrop-blur-xl",
        "shadow-[0_10px_40px_-12px_rgba(0,0,0,0.25)] px-3 py-3 gap-2",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4 pointer-events-none",
      ].join(" ")}
    >
      {/* Header: progress ring + label */}
      <div className="flex items-center gap-2.5 px-1">
        <div
          className="relative shrink-0"
          style={{ width: ringSize, height: ringSize }}
          title={t.progress}
          aria-label={t.progress}
        >
          <svg width={ringSize} height={ringSize} className="-rotate-90">
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={ringStroke}
              className="text-border"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={ringStroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              className="text-brand transition-[stroke-dasharray] duration-150"
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-foreground tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground leading-none">
            {t.toc}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-1 leading-tight">
            {t.progress}
          </div>
        </div>
      </div>

      {hasToc && <div className="mx-1 h-px bg-border/70" />}

      {/* Interactive ToC list with active rail */}
      {hasToc && (
        <nav aria-label={t.toc} className="relative overflow-y-auto pr-1 -mr-1 flex-1 min-h-0">
          {/* Vertical track */}
          <span aria-hidden className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          <ul className="flex flex-col">
            {items.map((it) => {
              const isActive = active === it.id;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(it.id)}
                    aria-current={isActive ? "true" : undefined}
                    title={it.text}
                    className={[
                      "group relative w-full text-left flex gap-2 items-start py-1.5 pr-1 rounded-[5px] transition-colors",
                      it.level === 1 ? "pl-4"
                        : it.level === 2 ? "pl-5"
                        : it.level === 3 ? "pl-7"
                        : it.level === 4 ? "pl-9"
                        : "pl-11",
                      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {/* Indicator dot/bar */}
                    <span
                      aria-hidden
                      className={[
                        "absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200",
                        isActive
                          ? "left-[4px] w-[7px] h-[7px] bg-brand shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_18%,transparent)]"
                          : "left-[5px] w-[5px] h-[5px] bg-muted-foreground/40 group-hover:bg-foreground",
                      ].join(" ")}
                    />
                    <span
                      className={[
                        "block text-[12.5px] leading-[1.25] tracking-tight",
                        "line-clamp-2",
                        isActive ? "font-semibold" : "font-medium",
                      ].join(" ")}
                    >
                      {it.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* Share + Actions card - visually distinct, premium */}
      <div className="rounded-[5px] border border-border/70 bg-gradient-to-b from-muted/40 to-muted/10 p-2.5 mt-1">
        <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1.5 mb-2 px-0.5">
          <Share2 className="w-3 h-3" /> {t.share}
        </span>

        {/* Social row */}
        <div className="grid grid-cols-5 gap-1">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <a
                key={l.id}
                href={l.href}
                target={l.id === "mail" ? "_self" : "_blank"}
                rel="noopener noreferrer"
                aria-label={l.label}
                title={l.label}
                className="inline-flex items-center justify-center h-9 rounded-[5px] text-muted-foreground hover:text-brand hover:bg-background hover:shadow-sm transition-all"
              >
                <Icon className="w-[15px] h-[15px]" />
              </a>
            );
          })}
          <button
            type="button"
            onClick={onCopy}
            aria-label={t.copy}
            title={t.copy}
            className="inline-flex items-center justify-center h-9 rounded-[5px] text-muted-foreground hover:text-brand hover:bg-background hover:shadow-sm transition-all"
          >
            <Copy className="w-[15px] h-[15px]" />
          </button>
        </div>

        {/* Divider */}
        <div className="my-2 h-px bg-border/60" />

        {/* Print + PDF row - labeled action buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onPdf}
            aria-label={t.pdf}
            title={t.pdf}
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-[5px] bg-brand text-brand-foreground text-[11px] font-semibold tracking-tight hover:opacity-90 active:scale-[0.98] transition shadow-sm"
          >
            <Download className="w-[14px] h-[14px]" />
            PDF
          </button>
          <button
            type="button"
            onClick={onPrint}
            aria-label={t.print}
            title={t.print}
            className="inline-flex items-center justify-center gap-1.5 h-9 rounded-[5px] border border-border bg-background text-foreground text-[11px] font-semibold tracking-tight hover:bg-muted active:scale-[0.98] transition"
          >
            <Printer className="w-[14px] h-[14px]" />
            {lang === "pl" ? "Drukuj" : "Print"}
          </button>
        </div>
      </div>


    </aside>

    {/* Mobile floating progress FAB - bottom-right */}
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label={t.toc}
      aria-expanded={mobileOpen}
      data-floating-share-fab
      className={[
        "lg:hidden fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40",
        "h-14 w-14 rounded-full grid place-items-center",
        "bg-background/95 border border-border/70 backdrop-blur-xl",
        "shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)] active:scale-95",
        "transition-all duration-300 ease-out",
        visible && !mobileOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6 pointer-events-none",
      ].join(" ")}
    >
      <span className="relative grid place-items-center" style={{ width: ringSize, height: ringSize }}>
        <svg width={ringSize} height={ringSize} className="-rotate-90 absolute inset-0">
          <circle cx={ringSize / 2} cy={ringSize / 2} r={r} fill="none" stroke="currentColor" strokeWidth={ringStroke} className="text-border" />
          <circle cx={ringSize / 2} cy={ringSize / 2} r={r} fill="none" stroke="currentColor" strokeWidth={ringStroke} strokeLinecap="round" strokeDasharray={`${dash} ${c}`} className="text-brand" />
        </svg>
        <List className="w-4 h-4 text-foreground" />
      </span>
    </button>

    {/* Mobile bottom sheet */}
    <div
      className={[
        "lg:hidden fixed inset-0 z-50 transition-opacity duration-200",
        mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
      ].join(" ")}
      aria-hidden={!mobileOpen}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setMobileOpen(false)}
      />
      <div
        role="dialog"
        aria-label={t.toc}
        className={[
          "absolute left-0 right-0 bottom-0",
          "max-h-[85vh] flex flex-col",
          "rounded-t-[5px] border-t border-border/70 bg-background",
          "shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.4)]",
          "transition-transform duration-300 ease-out",
          mobileOpen ? "translate-y-0" : "translate-y-full",
          "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        ].join(" ")}
      >
        {/* grab handle */}
        <div className="pt-2 pb-1 flex justify-center">
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pb-3 border-b border-border/60">
          <div className="relative shrink-0" style={{ width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize} className="-rotate-90">
              <circle cx={ringSize / 2} cy={ringSize / 2} r={r} fill="none" stroke="currentColor" strokeWidth={ringStroke} className="text-border" />
              <circle cx={ringSize / 2} cy={ringSize / 2} r={r} fill="none" stroke="currentColor" strokeWidth={ringStroke} strokeLinecap="round" strokeDasharray={`${dash} ${c}`} className="text-brand" />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-foreground tabular-nums">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground leading-none">{t.toc}</div>
            <div className="text-[11px] text-muted-foreground/80 mt-1 leading-tight truncate">{t.progress}</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={lang === "pl" ? "Zamknij" : "Close"}
            className="shrink-0 h-9 w-9 rounded-[5px] grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ToC */}
        {hasToc && (
          <nav aria-label={t.toc} className="relative overflow-y-auto px-3 py-2 flex-1 min-h-0">
            <span aria-hidden className="absolute left-[18px] top-3 bottom-3 w-px bg-border" />
            <ul className="flex flex-col">
              {items.map((it) => {
                const isActive = active === it.id;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(it.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={[
                        "group relative w-full text-left flex gap-2 items-start py-2.5 pr-2 rounded-[5px] transition-colors",
                        it.level === 1 ? "pl-7"
                          : it.level === 2 ? "pl-8"
                          : it.level === 3 ? "pl-10"
                          : it.level === 4 ? "pl-12"
                          : "pl-14",
                        isActive ? "text-foreground bg-muted/60" : "text-muted-foreground active:bg-muted/40",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden
                        className={[
                          "absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200",
                          isActive
                            ? "left-[15px] w-[7px] h-[7px] bg-brand shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_18%,transparent)]"
                            : "left-[16px] w-[5px] h-[5px] bg-muted-foreground/40",
                        ].join(" ")}
                      />
                      <span className={["block text-[13px] leading-[1.3] tracking-tight line-clamp-2", isActive ? "font-semibold" : "font-medium"].join(" ")}>
                        {it.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* Share + actions */}
        <div className="px-4 pt-3 border-t border-border/60">
          <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground inline-flex items-center gap-1.5 mb-2">
            <Share2 className="w-3 h-3" /> {t.share}
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {links.map((l) => {
              const Icon = l.icon;
              return (
                <a
                  key={l.id}
                  href={l.href}
                  target={l.id === "mail" ? "_self" : "_blank"}
                  rel="noopener noreferrer"
                  aria-label={l.label}
                  className="inline-flex items-center justify-center h-11 rounded-[5px] border border-border/60 text-muted-foreground active:text-brand active:bg-muted transition"
                >
                  <Icon className="w-[17px] h-[17px]" />
                </a>
              );
            })}
            <button
              type="button"
              onClick={onCopy}
              aria-label={t.copy}
              className="inline-flex items-center justify-center h-11 rounded-[5px] border border-border/60 text-muted-foreground active:text-brand active:bg-muted transition"
            >
              <Copy className="w-[17px] h-[17px]" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2.5">
            <button
              type="button"
              onClick={onPdf}
              className="inline-flex items-center justify-center gap-1.5 h-11 rounded-[5px] bg-brand text-brand-foreground text-[12px] font-semibold tracking-tight active:scale-[0.98] transition shadow-sm"
            >
              <Download className="w-[15px] h-[15px]" />
              PDF
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center justify-center gap-1.5 h-11 rounded-[5px] border border-border bg-background text-foreground text-[12px] font-semibold tracking-tight active:scale-[0.98] transition"
            >
              <Printer className="w-[15px] h-[15px]" />
              {lang === "pl" ? "Drukuj" : "Print"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
