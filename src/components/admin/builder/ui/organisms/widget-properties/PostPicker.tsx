// Lightweight post picker - searches posts by title/slug, returns id.
// Used to bind widget items to live posts so cover/title/href propagate
// automatically from the source entity.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

interface Props {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  lang: "pl" | "en";
}

interface PostHit {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

export function PostPicker({ value, onChange, lang }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: bound } = useQuery({
    queryKey: ["post-picker-bound", value ?? ""],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en")
        .eq("id", value)
        .maybeSingle();
      return (data as PostHit | null) ?? null;
    },
  });

  const { data: hits = [] } = useQuery({
    queryKey: ["post-picker-search", search],
    enabled: open && search.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const q = search.trim();
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en")
        .or(`title_pl.ilike.%${q}%,title_en.ilike.%${q}%,slug.ilike.%${q}%`)
        .eq("status", "published")
        .is("deleted_at", null)
        .limit(12);
      return (data as PostHit[] | null) ?? [];
    },
  });

  const label = useMemo(() => {
    if (!bound) return "";
    return (lang === "en" ? bound.title_en : bound.title_pl) ?? bound.slug;
  }, [bound, lang]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 h-8 px-2 rounded border border-border bg-background text-left text-xs hover:bg-muted truncate"
        >
          {value
            ? `${t("widget.boundTo", "Powiązane:")} ${label || value.slice(0, 8)}`
            : t("widget.bindPost", "Powiąż z wpisem...")}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="h-8 w-8 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive text-xs"
            aria-label={t("widget.unbindPost", "Odepnij wpis")}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="rounded border border-border bg-popover p-2 space-y-1">
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("widget.searchPosts", "Szukaj wpisów...") ?? ""}
            className="h-7 text-xs"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {hits.map((p) => {
              const ttl = (lang === "en" ? p.title_en : p.title_pl) ?? p.slug;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted truncate"
                >
                  {ttl}
                </button>
              );
            })}
            {!hits.length && search.trim().length >= 2 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t("widget.noResults", "Brak wyników")}
              </div>
            )}
            {search.trim().length < 2 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t("widget.searchHint", "Wpisz min. 2 znaki")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
