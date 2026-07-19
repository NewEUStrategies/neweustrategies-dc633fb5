// Combobox-style page picker - typing into the input immediately opens a
// dropdown with matching published pages. Used by MegaMenuEditor so each
// column can be linked to a page from the platform via a searchable dropdown
// matching the rest of the builder side-panel (h-8 text-xs, border-border,
// popover styles).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
        query = query.or(`title_pl.ilike.%${q}%,title_en.ilike.%${q}%,slug.ilike.%${q}%`);
      }
      const { data } = await query;
      return (data as PageHit[] | null) ?? [];
    },
  });

  const label = useMemo(() => {
    if (!bound) return boundSlug;
    return (lang === "en" ? bound.title_en : bound.title_pl) ?? bound.slug;
  }, [bound, lang, boundSlug]);

  const displayValue = open ? search : label;

  useEffect(() => {
    if (open) {
      setSearch("");
      setFocusedIndex(-1);
    }
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

  const selectHit = (p: PageHit) => {
    onChange(hrefOf(p.slug));
    setOpen(false);
    setSearch("");
    setFocusedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && hits[focusedIndex]) {
        selectHit(hits[focusedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={rootRef} className="space-y-1">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={displayValue}
            onChange={(e) => {
              const next = e.target.value;
              setSearch(next);
              if (!open) setOpen(true);
              setFocusedIndex(-1);
            }}
            onFocus={() => {
              setSearch(open ? search : "");
              setOpen(true);
              setFocusedIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? t("builder.picker.bindPage")}
            className="h-8 text-xs pr-7"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? "page-picker-listbox" : undefined}
            aria-activedescendant={
              open && focusedIndex >= 0 ? `page-picker-hit-${hits[focusedIndex]?.id}` : undefined
            }
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(undefined);
                setSearch("");
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded hover:bg-destructive/10 text-destructive text-xs"
              aria-label={t("builder.picker.unbindPage")}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {open && (
        <div
          id="page-picker-listbox"
          className="rounded border border-border bg-popover text-popover-foreground shadow-md p-1 space-y-0.5"
          role="listbox"
        >
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {hits.map((p, i) => {
              const ttl = (lang === "en" ? p.title_en : p.title_pl) ?? p.slug;
              return (
                <button
                  key={p.id}
                  id={`page-picker-hit-${p.id}`}
                  type="button"
                  role="option"
                  aria-selected={boundSlug === p.slug}
                  onClick={() => selectHit(p)}
                  onMouseEnter={() => setFocusedIndex(i)}
                  className={
                    "w-full text-left px-2 py-1.5 rounded text-xs truncate flex items-center justify-between gap-2 " +
                    (i === focusedIndex ? "bg-muted" : "hover:bg-muted")
                  }
                >
                  <span className="truncate">{ttl}</span>
                  <span className="text-[10px] text-muted-foreground truncate">/{p.slug}</span>
                </button>
              );
            })}
            {!hits.length && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t("builder.picker.noResults")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
