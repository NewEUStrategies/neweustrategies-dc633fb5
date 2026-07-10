// Uniwersalny picker linku dla każdego widgetu. Pozwala wybrać:
//   - URL zewnętrzny (dowolny https://... lub /ścieżka),
//   - istniejący wpis (post),
//   - istniejącą stronę (page),
//   - plik z biblioteki mediów (obrazek / dokument).
//
// Wynik zapisywany do `WidgetNode.advanced.link` i renderowany przez
// BuilderRenderer jako niewidoczna warstwa <a> nad widgetem.
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PropField } from "../atoms/PropField";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { ExternalLink, FileText, File as FileIcon, Image as ImageIcon, X, Search } from "lucide-react";
import type { WidgetLink, WidgetLinkKind } from "@/lib/builder/types";
import { useTranslation } from "react-i18next";

interface Props {
  value: WidgetLink | undefined;
  onChange: (link: WidgetLink | undefined) => void;
  lang: "pl" | "en";
}

type Tab = "external" | "post" | "page" | "media";

const TAB_META: Record<Tab, { icon: typeof ExternalLink; kind: WidgetLinkKind }> = {
  external: { icon: ExternalLink, kind: "external" },
  post: { icon: FileText, kind: "post" },
  page: { icon: FileIcon, kind: "page" },
  media: { icon: ImageIcon, kind: "media" },
};

export function LinkPicker({ value, onChange, lang }: Props) {
  const { t } = useTranslation();
  const initialTab: Tab = (value?.kind as Tab | undefined) ?? "external";
  const [tab, setTab] = useState<Tab>(initialTab);

  const update = (patch: Partial<WidgetLink>) => {
    const next: WidgetLink = { ...(value ?? {}), ...patch };
    if (!next.url) {
      onChange(undefined);
      return;
    }
    onChange(next);
  };

  const clear = () => onChange(undefined);

  const labels: Record<Tab, string> = {
    external: lang === "pl" ? "URL" : "URL",
    post: lang === "pl" ? "Wpis" : "Post",
    page: lang === "pl" ? "Strona" : "Page",
    media: lang === "pl" ? "Media" : "Media",
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1 p-0.5 rounded-md border border-border bg-muted/40">
        {(Object.keys(TAB_META) as Tab[]).map((k) => {
          const Icon = TAB_META[k].icon;
          const active = tab === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`inline-flex items-center justify-center gap-1 h-7 rounded text-[10px] transition ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
              {labels[k]}
            </button>
          );
        })}
      </div>

      {tab === "external" && (
        <ExternalUrlEditor
          value={value?.kind === "external" ? value : undefined}
          onChange={(v) =>
            v ? update({ ...v, kind: "external", refId: undefined, refLabel: undefined }) : clear()
          }
        />
      )}

      {tab === "post" && (
        <EntityPicker
          kind="post"
          lang={lang}
          value={value?.kind === "post" ? value : undefined}
          onPick={(url, id, label) =>
            update({ url, kind: "post", refId: id, refLabel: label })
          }
          onClear={clear}
        />
      )}

      {tab === "page" && (
        <EntityPicker
          kind="page"
          lang={lang}
          value={value?.kind === "page" ? value : undefined}
          onPick={(url, id, label) =>
            update({ url, kind: "page", refId: id, refLabel: label })
          }
          onClear={clear}
        />
      )}

      {tab === "media" && (
        <MediaLinkPicker
          value={value?.kind === "media" ? value : undefined}
          onPick={(url, label) => update({ url, kind: "media", refId: undefined, refLabel: label })}
          onClear={clear}
        />
      )}

      {value?.url && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="link-newtab" className="text-[11px]">
              {t("linkPicker.newTab", lang === "pl" ? "Otwórz w nowej karcie" : "Open in new tab")}
            </Label>
            <Switch
              id="link-newtab"
              checked={value.target === "_blank"}
              onCheckedChange={(on) => update({ target: on ? "_blank" : "_self" })}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="link-nofollow" className="text-[11px]">
              {t("linkPicker.nofollow", "rel=nofollow")}
            </Label>
            <Switch
              id="link-nofollow"
              checked={value.nofollow === true}
              onCheckedChange={(on) => update({ nofollow: on })}
            />
          </div>
          <PropField label={lang === "pl" ? "Etykieta ARIA" : "ARIA label"}>
            <Input
              value={value.ariaLabel ?? ""}
              placeholder={lang === "pl" ? "opcjonalna" : "optional"}
              onChange={(e) => update({ ariaLabel: e.target.value || undefined })}
              className="h-8 text-xs"
            />
          </PropField>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            className="w-full h-7 text-[11px] text-destructive hover:text-destructive"
          >
            <X className="w-3 h-3 mr-1" />
            {lang === "pl" ? "Usuń link" : "Remove link"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ExternalUrlEditor({
  value,
  onChange,
}: {
  value: WidgetLink | undefined;
  onChange: (v: WidgetLink | undefined) => void;
}) {
  return (
    <PropField label="URL">
      <Input
        value={value?.url ?? ""}
        placeholder="https://example.com lub /o-nas"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) onChange(undefined);
          else onChange({ ...(value ?? {}), url: v });
        }}
        className="h-8 text-xs"
      />
    </PropField>
  );
}

interface EntityRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

function EntityPicker({
  kind,
  lang,
  value,
  onPick,
  onClear,
}: {
  kind: "post" | "page";
  lang: "pl" | "en";
  value: WidgetLink | undefined;
  onPick: (url: string, id: string, label: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const table = kind === "post" ? "posts" : "pages";
  const prefix = kind === "post" ? "/post" : "";

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["link-picker", kind, q],
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const term = q.trim();
      const { data } = await supabase
        .from(table)
        .select("id, slug, title_pl, title_en")
        .or(`title_pl.ilike.%${term}%,title_en.ilike.%${term}%,slug.ilike.%${term}%`)
        .eq("status", "published")
        .is("deleted_at", null)
        .limit(12);
      return (data as EntityRow[] | null) ?? [];
    },
  });

  const currentLabel = useMemo(() => {
    if (!value?.refLabel && !value?.url) return "";
    return value.refLabel ?? value.url ?? "";
  }, [value]);

  return (
    <div className="space-y-1.5">
      {value?.url && (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded border border-brand/40 bg-brand/5 text-[11px]">
          <span className="flex-1 truncate">{currentLabel}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-destructive"
            aria-label={lang === "pl" ? "Usuń" : "Remove"}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            kind === "post"
              ? lang === "pl"
                ? "Szukaj wpisów..."
                : "Search posts..."
              : lang === "pl"
                ? "Szukaj stron..."
                : "Search pages..."
          }
          className="h-8 pl-7 text-xs"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="max-h-64 overflow-y-auto overscroll-contain rounded border border-border bg-popover">
          {isFetching && (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              {lang === "pl" ? "Wczytywanie..." : "Loading..."}
            </div>
          )}
          {!isFetching &&
            hits.map((row) => {
              const label = (lang === "en" ? row.title_en : row.title_pl) ?? row.slug;
              const url = `${prefix}/${row.slug}`;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onPick(url, row.id, label)}
                  className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-muted truncate"
                >
                  {label}
                  <span className="ml-1 text-muted-foreground">/{row.slug}</span>
                </button>
              );
            })}
          {!isFetching && !hits.length && (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              {lang === "pl" ? "Brak wyników" : "No results"}
            </div>
          )}
        </div>
      )}
      {q.trim().length < 2 && !value?.url && (
        <div className="text-[10px] text-muted-foreground">
          {lang === "pl" ? "Wpisz min. 2 znaki, aby szukać" : "Type at least 2 characters"}
        </div>
      )}
    </div>
  );
}

function MediaLinkPicker({
  value,
  onPick,
  onClear,
}: {
  value: WidgetLink | undefined;
  onPick: (url: string, label: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      {value?.url && (
        <div className="flex items-center gap-1 px-2 py-1.5 rounded border border-brand/40 bg-brand/5 text-[11px]">
          <span className="flex-1 truncate">{value.refLabel ?? value.url}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Usuń"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full h-8 text-xs"
      >
        <ImageIcon className="w-3 h-3 mr-1" />
        {value?.url ? "Zmień plik" : "Wybierz z Biblioteki mediów"}
      </Button>
      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        accept="all"
        onPick={(url) => {
          const label = url.split("/").pop() ?? url;
          onPick(url, label);
          setOpen(false);
        }}
      />
    </div>
  );
}
