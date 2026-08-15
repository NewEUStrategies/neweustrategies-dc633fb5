// URL input with inline dropdown that suggests internal pages/posts as the
// user types. Used by SchemaFieldControl for `url` fields so editors can bind
// buttons/links to platform pages without leaving the field.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  lang: "pl" | "en";
  className?: string;
}

interface Hit {
  id: string;
  href: string;
  title: string;
  kind: "page" | "post";
}

export function PageUrlAutocomplete({ value, onChange, placeholder, lang, className }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const search = useMemo(() => value.replace(/^\/+/, "").split(/[?#]/)[0] ?? "", [value]);

  const { data: hits = [] } = useQuery({
    queryKey: ["url-suggest", search, lang],
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<Hit[]> => {
      const q = search.trim();
      const titleCol = lang === "en" ? "title_en" : "title_pl";
      const [pagesRes, postsRes] = await Promise.all([
        (async () => {
          let query = supabase
            .from("pages")
            .select("id, slug, title_pl, title_en")
            .eq("status", "published")
            .is("deleted_at", null)
            .order(titleCol)
            .limit(10);
          if (q.length >= 1) {
            query = query.or(`title_pl.ilike.%${q}%,title_en.ilike.%${q}%,slug.ilike.%${q}%`);
          }
          return query;
        })(),
        (async () => {
          let query = supabase
            .from("posts")
            .select("id, slug, title_pl, title_en")
            .eq("status", "published")
            .is("deleted_at", null)
            .order("published_at", { ascending: false })
            .limit(10);
          if (q.length >= 1) {
            query = query.or(`title_pl.ilike.%${q}%,title_en.ilike.%${q}%,slug.ilike.%${q}%`);
          }
          return query;
        })(),
      ]);
      const pages: Hit[] = (pagesRes.data ?? []).map((p) => ({
        id: `page-${p.id}`,
        href: `/${String(p.slug).replace(/^\/+/, "")}`,
        title: (lang === "en" ? p.title_en : p.title_pl) ?? p.slug,
        kind: "page",
      }));
      const posts: Hit[] = (postsRes.data ?? []).map((p) => ({
        id: `post-${p.id}`,
        href: `/post/${String(p.slug).replace(/^\/+/, "")}`,
        title: (lang === "en" ? p.title_en : p.title_pl) ?? p.slug,
        kind: "post",
      }));
      return [...pages, ...posts];
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const select = (h: Hit) => {
    onChange(h.href);
    setOpen(false);
    setFocused(-1);
  };

  return (
    <div ref={rootRef} className={"relative flex-1 " + (className ?? "")}>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setFocused(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
            e.preventDefault();
            setOpen(true);
            return;
          }
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocused((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocused((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && focused >= 0 && hits[focused]) {
            e.preventDefault();
            select(hits[focused]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-8 text-xs"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && hits.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-[6px] border border-border bg-popover text-popover-foreground shadow-md p-1 max-h-64 overflow-y-auto"
        >
          {hits.map((h, i) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={value === h.href}
              onMouseEnter={() => setFocused(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(h);
              }}
              className={
                "w-full text-left px-2 py-1.5 rounded-[6px] text-xs flex items-center justify-between gap-2 " +
                (i === focused ? "bg-muted" : "hover:bg-muted")
              }
            >
              <span className="truncate flex items-center gap-1.5">
                <span
                  className={
                    "inline-block rounded-[4px] px-1 py-0.5 text-[9px] uppercase tracking-wide " +
                    (h.kind === "page"
                      ? "bg-brand/10 text-brand"
                      : "bg-muted-foreground/10 text-muted-foreground")
                  }
                >
                  {h.kind === "page" ? t("builder.urlSuggest.page") : t("builder.urlSuggest.post")}
                </span>
                <span className="truncate">{h.title}</span>
              </span>
              <span className="text-[10px] text-muted-foreground truncate">{h.href}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
