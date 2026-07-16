// Panel dodawania pozycji do menu - accordion w stylu WordPress:
// Strony / Wpisy / Własne odnośniki / Kategorie / Tagi.
// Każda sekcja ma wyszukiwarkę i checkboxy "wybierz wszystko".
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Plus } from "@/lib/lucide-shim";
import { useTranslation } from "react-i18next";
import type { MenuItemType } from "@/lib/menus/types";

interface Row {
  id: string;
  label: string;
  href: string;
}

interface Props {
  onAdd: (payload: {
    item_type: MenuItemType;
    ref_id: string | null;
    label_pl: string;
    label_en: string;
    href: string;
  }[]) => void;
}

type Section = "pages" | "posts" | "custom" | "categories" | "tags";

export function AddItemPanel({ onAdd }: Props) {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language?.startsWith("en") ? "en" : "pl";
  const [open, setOpen] = useState<Section>("pages");

  return (
    <div className="space-y-2">
      <SectionShell
        title={t("admin.menu.sections.pages", { defaultValue: "Strony" })}
        open={open === "pages"}
        onToggle={() => setOpen(open === "pages" ? "posts" : "pages")}
      >
        <PickList
          type="page"
          table="pages"
          titleField={lang === "en" ? "title_en" : "title_pl"}
          fallbackField={lang === "en" ? "title_pl" : "title_en"}
          hrefBuilder={(slug) => `/${slug}`}
          statusFilter="published"
          onAdd={onAdd}
        />
      </SectionShell>

      <SectionShell
        title={t("admin.menu.sections.posts", { defaultValue: "Wpisy" })}
        open={open === "posts"}
        onToggle={() => setOpen(open === "posts" ? "custom" : "posts")}
      >
        <PickList
          type="post"
          table="posts"
          titleField={lang === "en" ? "title_en" : "title_pl"}
          fallbackField={lang === "en" ? "title_pl" : "title_en"}
          hrefBuilder={(slug) => `/post/${slug}`}
          statusFilter="published"
          onAdd={onAdd}
        />
      </SectionShell>

      <SectionShell
        title={t("admin.menu.sections.custom", { defaultValue: "Własne odnośniki" })}
        open={open === "custom"}
        onToggle={() => setOpen(open === "custom" ? "categories" : "custom")}
      >
        <CustomLinkForm onAdd={onAdd} />
      </SectionShell>

      <SectionShell
        title={t("admin.menu.sections.categories", { defaultValue: "Kategorie" })}
        open={open === "categories"}
        onToggle={() => setOpen(open === "categories" ? "tags" : "categories")}
      >
        <PickList
          type="category"
          table="categories"
          titleField={lang === "en" ? "name_en" : "name_pl"}
          fallbackField={lang === "en" ? "name_pl" : "name_en"}
          hrefBuilder={(slug) => `/kategoria/${slug}`}
          onAdd={onAdd}
        />
      </SectionShell>

      <SectionShell
        title={t("admin.menu.sections.tags", { defaultValue: "Tagi" })}
        open={open === "tags"}
        onToggle={() => setOpen(open === "tags" ? "pages" : "tags")}
      >
        <PickList
          type="tag"
          table="tags"
          titleField={lang === "en" ? "name_en" : "name_pl"}
          fallbackField={lang === "en" ? "name_pl" : "name_en"}
          hrefBuilder={(slug) => `/tag/${slug}`}
          onAdd={onAdd}
        />
      </SectionShell>
    </div>
  );
}

function SectionShell({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-md bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/60"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="p-3 border-t border-border">{children}</div>}
    </div>
  );
}

interface PickListProps {
  type: MenuItemType;
  table: "pages" | "posts" | "categories" | "tags";
  titleField: string;
  fallbackField: string;
  statusFilter?: string;
  hrefBuilder: (slug: string) => string;
  onAdd: Props["onAdd"];
}

function PickList({
  type,
  table,
  titleField,
  fallbackField,
  statusFilter,
  hrefBuilder,
  onAdd,
}: PickListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const { data: rows = [] } = useQuery({
    queryKey: ["menu-picker", table, statusFilter ?? "any", search],
    staleTime: 30_000,
    queryFn: async (): Promise<Array<Row & { title_pl: string; title_en: string; slug: string }>> => {
      let q = supabase
        .from(table)
        .select(`id, slug, ${titleField}, ${fallbackField}`)
        .order(titleField)
        .limit(30);
      if (statusFilter && (table === "pages" || table === "posts")) {
        q = q.eq("status", statusFilter).is("deleted_at", null);
      }
      const term = search.trim();
      if (term.length >= 2) {
        q = q.or(`${titleField}.ilike.%${term}%,${fallbackField}.ilike.%${term}%,slug.ilike.%${term}%`);
      }
      const { data } = await q;
      return (data ?? []).map((r) => {
        const rec = r as unknown as Record<string, unknown>;
        const primary = String(rec[titleField] ?? "");
        const fallback = String(rec[fallbackField] ?? "");
        const slug = String(rec.slug ?? "");
        return {
          id: String(rec.id ?? ""),
          slug,
          title_pl: table === "pages" || table === "posts" ? String(rec["title_pl"] ?? "") : String(rec["name_pl"] ?? ""),
          title_en: table === "pages" || table === "posts" ? String(rec["title_en"] ?? "") : String(rec["name_en"] ?? ""),
          label: primary || fallback || slug,
          href: hrefBuilder(slug),
        };
      });
    },
  });

  const toggle = (id: string) => {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const addSelected = () => {
    const items = rows
      .filter((r) => checked.has(r.id))
      .map((r) => ({
        item_type: type,
        ref_id: r.id,
        label_pl: (table === "pages" || table === "posts" ? r.title_pl : (r as unknown as { name_pl?: string }).name_pl) || r.label,
        label_en: (table === "pages" || table === "posts" ? r.title_en : (r as unknown as { name_en?: string }).name_en) || "",
        href: r.href,
      }));
    if (items.length === 0) return;
    onAdd(items);
    setChecked(new Set());
  };

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("admin.menu.searchPlaceholder", { defaultValue: "Szukaj..." })}
        className="h-8 text-xs"
      />
      <div className="max-h-56 overflow-y-auto border border-border rounded bg-background">
        {rows.map((r) => (
          <label
            key={r.id}
            className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted cursor-pointer border-b border-border/60 last:border-b-0"
          >
            <Checkbox checked={checked.has(r.id)} onCheckedChange={() => toggle(r.id)} />
            <span className="flex-1 truncate">{r.label}</span>
            <span className="text-[10px] text-muted-foreground truncate">/{r.slug}</span>
          </label>
        ))}
        {rows.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">
            {t("admin.menu.empty", { defaultValue: "Brak wyników" })}
          </div>
        )}
      </div>
      <Button size="sm" onClick={addSelected} disabled={checked.size === 0} className="w-full">
        <Plus className="h-3 w-3 mr-1" />
        {t("admin.menu.addToMenu", { defaultValue: "Dodaj do menu" })} ({checked.size})
      </Button>
    </div>
  );
}

function CustomLinkForm({ onAdd }: { onAdd: Props["onAdd"] }) {
  const { t } = useTranslation();
  const [href, setHref] = useState("");
  const [labelPl, setLabelPl] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const disabled = useMemo(() => !href.trim() || !labelPl.trim(), [href, labelPl]);
  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] font-medium text-muted-foreground">URL</label>
        <Input value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://... lub /sciezka" className="h-8 text-xs" />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground">
          {t("admin.menu.labelPl", { defaultValue: "Etykieta (PL)" })}
        </label>
        <Input value={labelPl} onChange={(e) => setLabelPl(e.target.value)} className="h-8 text-xs" />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground">
          {t("admin.menu.labelEn", { defaultValue: "Etykieta (EN)" })}
        </label>
        <Input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} className="h-8 text-xs" />
      </div>
      <Button
        size="sm"
        disabled={disabled}
        onClick={() => {
          onAdd([
            {
              item_type: "custom",
              ref_id: null,
              label_pl: labelPl.trim(),
              label_en: labelEn.trim(),
              href: href.trim(),
            },
          ]);
          setHref("");
          setLabelPl("");
          setLabelEn("");
        }}
        className="w-full"
      >
        <Plus className="h-3 w-3 mr-1" />
        {t("admin.menu.addToMenu", { defaultValue: "Dodaj do menu" })}
      </Button>
    </div>
  );
}
