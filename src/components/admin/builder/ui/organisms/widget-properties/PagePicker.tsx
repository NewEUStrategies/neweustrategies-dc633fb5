// Lightweight page picker - searches published pages by title/slug and returns
// the public URL (/{slug}). Used by MegaMenuEditor so each column can be
// linked to a page from the platform via a searchable dropdown matching the
// rest of the builder side-panel (h-8 text-xs, border-border, popover styles).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

interface Props {
  /** Currently bound href (e.g. "/about"). */
  value: string | undefined;
  onChange: (href: string | undefined) => void;
  lang: "pl" | "en";
  placeholder?: string;
}

interface PageHit {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

const hrefOf = (slug: string): string => `/${slug.replace(/^\/+/, "")}`;

export function PagePicker({ value, onChange, lang, placeholder }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const boundSlug = useMemo(() => {
    if (!value) return "";
    return value.replace(/^\/+/, "").split(/[?#]/)[0] ?? "";
  }, [value]);

  const { data: bound } = useQuery({
    queryKey: ["page-picker-bound", boundSlug],
    enabled: boundSlug.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pages")
        .select("id, slug, title_pl, title_en")
        .eq("slug", boundSlug)
        .is("deleted_at", null)
        .maybeSingle();
      return (data as PageHit | null) ?? null;
    },
  });

  const { data: hits = [] } = useQuery({
    queryKey: ["page-picker-search", search],
    enabled: open,
    staleTime: 30_000,
    queryFn: async (): Promise<PageHit[]> => {
      const q = search.trim();
      let query = supabase
        .from("pages")
        .select("id, slug, title_pl, title_en")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("title_pl")
        .limit(20);
      if (q.length >= 2) {
        query = query.or(
          `title_pl.ilike.%${q}%,title_en.ilike.%${q}%,slug.ilike.%${q}%`,
        );
      }
      const { data } = await query;
      return (data as PageHit[] | null) ?? [];
    },
  });

  const label = useMemo(() => {
    if (!bound) return "";
    return (lang === "en" ? bound.title_en : bound.title_pl) ?? bound.slug;
  }, [bound, lang]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 h-8 px-2 rounded border border-border bg-background text-left text-xs hover:bg-muted truncate"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {value
            ? `${t("widget.boundToPage", "Strona:")} ${label || boundSlug}`
            : (placeholder ??
              t("widget.bindPage", "Wybierz stronę z platformy..."))}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="h-8 w-8 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive text-xs"
            aria-label={t("widget.unbindPage", "Odepnij stronę")}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="rounded border border-border bg-popover text-popover-foreground shadow-md p-2 space-y-1">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("widget.searchPages", "Szukaj stron...") ?? ""}
            className="h-7 text-xs"
          />
          <div className="max-h-56 overflow-y-auto space-y-0.5" role="listbox">
            {hits.map((p) => {
              const ttl = (lang === "en" ? p.title_en : p.title_pl) ?? p.slug;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={boundSlug === p.slug}
                  onClick={() => {
                    onChange(hrefOf(p.slug));
                    setOpen(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted truncate flex items-center justify-between gap-2"
                >
                  <span className="truncate">{ttl}</span>
                  <span className="text-[10px] text-muted-foreground truncate">/{p.slug}</span>
                </button>
              );
            })}
            {!hits.length && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t("widget.noResults", "Brak wyników")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
