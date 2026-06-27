// Floating reading rail - sticky left-side rail on long-form content.
// Combines: reading progress ring + interactive article ToC (scrollspy + jump)
// + social share actions. Desktop only (>= lg). Uses semantic tokens.
import { useEffect, useMemo, useRef, useState } from "react";
import { Twitter, Facebook, Linkedin, Mail, Copy, Share2 } from "@/lib/lucide-shim";
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
  level: 2 | 3;
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
  const [hovered, setHovered] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const t = COPY[lang];

  useEffect(() => {
    if (!url && typeof window !== "undefined") setHref(window.location.href);
  }, [url]);

  // Scan headings (h2/h3) within the article body. Assign IDs when missing.
  useEffect(() => {
    const scan = (): void => {
      const root = getArticleRoot();
      if (!root) {
        setItems([]);
        return;
      }
      const hs = Array.from(root.querySelectorAll("h2, h3")) as HTMLHeadingElement[];
      const seen = new Set<string>();
      const next: TocItem[] = hs.map((h) => {
        const text = (h.textContent ?? "").trim();
        let id = h.id || slugifyHeading(text);
        let n = 2;
        while (seen.has(id)) id = `${id}-${n++}`;
        seen.add(id);
        if (!h.id) h.id = id;
        return { id, text, level: h.tagName === "H2" ? 2 : 3 };
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

  const jumpTo = (id: string): void => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: "smooth" });
    history.replaceState(null, "", `#${id}`);
  };

  // SVG ring geometry
  const ringSize = 44;
  const ringStroke = 3;
  const r = (ringSize - ringStroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * progress;

  const hasToc = items.length > 0;

  return (
    <aside
      ref={railRef}
      aria-label={t.share}
      className={[
        "hidden lg:flex flex-col fixed left-5 top-1/2 -translate-y-1/2 z-40",
        "rounded-2xl border border-border/70 bg-background/85 backdrop-blur-xl",
        "shadow-[0_10px_40px_-12px_rgba(0,0,0,0.25)] px-2 py-3 gap-2",
        "transition-all duration-300 ease-out",
        visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4 pointer-events-none",
      ].join(" ")}
    >
      {/* Reading progress ring */}
      <div
        className="relative mx-auto"
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

      {/* Interactive ToC dots */}
      {hasToc && (
        <nav
          aria-label={t.toc}
          className="flex flex-col items-center gap-1.5 mt-1 mb-1 px-1"
        >
          {items.map((it) => {
            const isActive = active === it.id;
            const isHover = hovered === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => jumpTo(it.id)}
                onMouseEnter={() => setHovered(it.id)}
                onMouseLeave={() => setHovered((h) => (h === it.id ? null : h))}
                onFocus={() => setHovered(it.id)}
                onBlur={() => setHovered((h) => (h === it.id ? null : h))}
                aria-label={it.text}
                aria-current={isActive ? "true" : undefined}
                className="relative group flex items-center justify-center w-6 h-6"
              >
                <span
                  className={[
                    "block rounded-full transition-all duration-200",
                    it.level === 3 ? "w-1.5 h-1.5" : "w-2 h-2",
                    isActive
                      ? "bg-brand scale-150 shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_18%,transparent)]"
                      : "bg-muted-foreground/40 group-hover:bg-foreground",
                  ].join(" ")}
                />
                {/* Tooltip with heading text */}
                <span
                  role="tooltip"
                  className={[
                    "pointer-events-none absolute left-full ml-3 whitespace-nowrap",
                    "rounded-md border border-border bg-popover text-popover-foreground",
                    "px-2.5 py-1 text-xs shadow-md max-w-[260px] truncate",
                    "transition-all duration-150",
                    isHover || isActive
                      ? "opacity-100 translate-x-0"
                      : "opacity-0 -translate-x-1",
                  ].join(" ")}
                >
                  {it.text}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {hasToc && <div className="mx-2 my-1 h-px bg-border/70" />}

      {/* Share label */}
      <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground text-center px-1 inline-flex items-center justify-center gap-1">
        <Share2 className="w-3 h-3" /> {t.share}
      </span>

      {/* Share actions */}
      <div className="flex flex-col gap-1">
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
              className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
            >
              <Icon className="w-4 h-4" />
            </a>
          );
        })}
        <button
          type="button"
          onClick={onCopy}
          aria-label={t.copy}
          title={t.copy}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
