// Sidebar treści wpisu: spis treści (ToC z H2/H3) + tagi.
// Renderuje się tylko dla layoutów z hasSidebar=true (Layout 3/8/11).
import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { List, Tags as TagIcon } from "@/lib/lucide-shim";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface PostSidebarProps {
  articleRef: RefObject<HTMLDivElement | null>;
  tags?: Array<{ slug: string; name: string }>;
  /** Re-scan headings when this value changes (e.g. content/lang). */
  scanKey?: string | number;
}

function slugifyHeading(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

export function PostSidebar({ articleRef, tags, scanKey }: PostSidebarProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TocItem[]>([]);
  const [active, setActive] = useState<string | null>(null);

  // Build ToC by scanning headings, assigning ids when missing.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
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
  }, [articleRef, scanKey]);

  // Simple scrollspy.
  useEffect(() => {
    if (items.length === 0) return;
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          setActive(top.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0.01 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [items]);

  if (items.length === 0 && (!tags || tags.length === 0)) return null;

  return (
    <div className="space-y-6 lg:sticky lg:top-24 self-start">
      {items.length > 0 && (
        <nav aria-label={t("post.sidebar.toc")} className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 inline-flex items-center gap-1.5">
            <List className="w-3.5 h-3.5" /> {t("post.sidebar.toc")}
          </h2>
          <ul className="space-y-1.5 text-sm">
            {items.map((it) => (
              <li key={it.id} className={it.level === 3 ? "pl-3" : ""}>
                <a
                  href={`#${it.id}`}
                  className={`block leading-snug transition-colors hover:text-foreground ${
                    active === it.id ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                  onClick={(e) => {
                    const el = document.getElementById(it.id);
                    if (el) {
                      e.preventDefault();
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                      history.replaceState(null, "", `#${it.id}`);
                    }
                  }}
                >
                  {it.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {tags && tags.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 inline-flex items-center gap-1.5">
            <TagIcon className="w-3.5 h-3.5" /> {t("post.sidebar.tags")}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tg) => (
              <li key={tg.slug}>
                <span className="inline-block rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  #{tg.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
