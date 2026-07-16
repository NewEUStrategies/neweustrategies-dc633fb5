// Admin panel for archive layout settings (category / tag).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronUp, ChevronDown } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  archiveLayoutQueryOptions,
  DEFAULT_ARCHIVE_LAYOUT,
  type ArchiveLayoutSettings,
  type ArchiveType,
  type SidebarWidgetKey,
  type HeroBgStyle,
  type ListStyle,
  type SidebarPosition,
} from "@/lib/archive-layout-settings";
import { LAYOUT_REGISTRY, type LayoutVariant } from "@/components/archive/layouts/registry";
import { ArchiveLivePreview } from "./ArchiveLivePreview";
import "@/lib/i18n-archive-layout";



interface Props {
  archiveType: ArchiveType;
  sampleSlug?: string;
}

const ALL_WIDGETS: SidebarWidgetKey[] = ["popular", "related", "newsletter", "ads"];
const HERO_STYLES: HeroBgStyle[] = ["gradient", "image", "solid", "pattern", "mesh", "minimal"];
const LIST_STYLES: ListStyle[] = ["grid", "list", "masonry"];

export function ArchiveLayoutAdmin({ archiveType, sampleSlug }: Props) {
  const { t, i18n } = useTranslation();
  const previewLang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";

  const qc = useQueryClient();
  const { data, isLoading } = useQuery(archiveLayoutQueryOptions(archiveType));
  const [draft, setDraft] = useState<ArchiveLayoutSettings | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async (v: ArchiveLayoutSettings) => {
      const payload = {
        archive_type: archiveType,
        layout_variant: v.layout_variant,
        columns: v.columns,
        list_style: v.list_style,
        show_hero: v.show_hero,
        show_description: v.show_description,
        show_follow: v.show_follow,
        show_breadcrumbs: v.show_breadcrumbs,
        show_sidebar: v.show_sidebar,
        sidebar_position: v.sidebar_position,
        sidebar_widgets: v.sidebar_widgets,
        show_featured_top: v.show_featured_top,
        show_related_taxonomies: v.show_related_taxonomies,
        show_podcasts: v.show_podcasts,
        hero_bg_style: v.hero_bg_style,
        posts_per_page: v.posts_per_page,
      };
      const { error } = await supabase
        .from("archive_layout_settings")
        .upsert(payload, { onConflict: "tenant_id,archive_type" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("archiveLayout.saved"));
      qc.invalidateQueries({ queryKey: ["archive-layout-settings", archiveType] });
    },
    onError: () => toast.error(t("archiveLayout.saveError")),
  });

  if (isLoading || !draft) {
    return <div className="text-muted-foreground text-sm">Loading...</div>;
  }

  const set = <K extends keyof ArchiveLayoutSettings>(key: K, value: ArchiveLayoutSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const moveWidget = (key: SidebarWidgetKey, dir: -1 | 1) => {
    setDraft((d) => {
      if (!d) return d;
      const arr = [...d.sidebar_widgets];
      const idx = arr.indexOf(key);
      if (idx < 0) return d;
      const next = idx + dir;
      if (next < 0 || next >= arr.length) return d;
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return { ...d, sidebar_widgets: arr };
    });
  };

  const toggleWidget = (key: SidebarWidgetKey, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.sidebar_widgets.includes(key);
      if (on && !has) return { ...d, sidebar_widgets: [...d.sidebar_widgets, key] };
      if (!on && has) return { ...d, sidebar_widgets: d.sidebar_widgets.filter((w) => w !== key) };
      return d;
    });
  };

  const title =
    archiveType === "category" ? t("archiveLayout.pageTitleCategory") : t("archiveLayout.pageTitleTag");

  return (
    <div className="space-y-8 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t("archiveLayout.pageDescription")}
          </p>
        </div>
        {sampleSlug && (
          <a
            href={`/${archiveType}/${sampleSlug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
          >
            {t("archiveLayout.previewOnSite")} ↗
          </a>
        )}
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* Layout variant */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("archiveLayout.layoutHeader")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("archiveLayout.layoutHint")}</p>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(LAYOUT_REGISTRY) as unknown as LayoutVariant[]).map((k) => {
              const num = Number(k) as LayoutVariant;
              const entry = LAYOUT_REGISTRY[num];
              const active = draft.layout_variant === num;
              const Preview = entry.preview;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => set("layout_variant", num)}
                  aria-pressed={active}
                  className={`text-left rounded-md border-2 p-2 transition ${
                    active ? "border-brand ring-2 ring-brand/20" : "border-border hover:border-foreground/30"
                  }`}
                >
                  <Preview className="w-full h-auto rounded-md" />
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{t(`archiveLayout.variants.${num}`)}</span>
                    <span className="text-xs text-muted-foreground">#{num}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Live preview updates immediately from the unsaved draft. */}
        <div className="xl:sticky xl:top-4">
          <ArchiveLivePreview archiveType={archiveType} settings={draft} lang={previewLang} />
        </div>
      </div>



      {/* Display toggles */}
      <FieldsGrid title={t("archiveLayout.sections.display")}>
        <Toggle
          label={t("archiveLayout.fields.showBreadcrumbs")}
          checked={draft.show_breadcrumbs}
          onChange={(v) => set("show_breadcrumbs", v)}
        />
        <Toggle
          label={t("archiveLayout.fields.showHero")}
          checked={draft.show_hero}
          onChange={(v) => set("show_hero", v)}
        />
        <Toggle
          label={t("archiveLayout.fields.showDescription")}
          checked={draft.show_description}
          onChange={(v) => set("show_description", v)}
        />
        <Toggle
          label={t("archiveLayout.fields.showFollow")}
          checked={draft.show_follow}
          onChange={(v) => set("show_follow", v)}
        />
      </FieldsGrid>

      {/* Hero */}
      <FieldsGrid title={t("archiveLayout.sections.hero")}>
        <SelectField
          label={t("archiveLayout.fields.heroBgStyle")}
          value={draft.hero_bg_style}
          onChange={(v) => set("hero_bg_style", v as HeroBgStyle)}
          options={HERO_STYLES.map((h) => ({ value: h, label: t(`archiveLayout.heroBg.${h}`) }))}
        />
      </FieldsGrid>

      {/* Grid */}
      <FieldsGrid title={t("archiveLayout.sections.grid")}>
        <SelectField
          label={t("archiveLayout.fields.listStyle")}
          value={draft.list_style}
          onChange={(v) => set("list_style", v as ListStyle)}
          options={LIST_STYLES.map((s) => ({ value: s, label: t(`archiveLayout.listStyles.${s}`) }))}
        />
        <SelectField
          label={t("archiveLayout.fields.columns")}
          value={String(draft.columns)}
          onChange={(v) => set("columns", Number(v) as ArchiveLayoutSettings["columns"])}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
        />
        <NumberField
          label={t("archiveLayout.fields.postsPerPage")}
          value={draft.posts_per_page}
          min={6}
          max={200}
          onChange={(v) => set("posts_per_page", v)}
        />
      </FieldsGrid>

      {/* Sidebar */}
      <FieldsGrid title={t("archiveLayout.sections.sidebar")}>
        <Toggle
          label={t("archiveLayout.fields.showSidebar")}
          checked={draft.show_sidebar}
          onChange={(v) => set("show_sidebar", v)}
        />
        <SelectField
          label={t("archiveLayout.fields.sidebarPosition")}
          value={draft.sidebar_position}
          onChange={(v) => set("sidebar_position", v as SidebarPosition)}
          options={[
            { value: "left", label: t("archiveLayout.positions.left") },
            { value: "right", label: t("archiveLayout.positions.right") },
          ]}
          disabled={!draft.show_sidebar}
        />
        <div className="col-span-full space-y-2">
          <div className="text-sm font-medium">{t("archiveLayout.fields.sidebarWidgets")}</div>
          <ul className="space-y-2">
            {ALL_WIDGETS.map((w) => {
              const enabled = draft.sidebar_widgets.includes(w);
              const idx = draft.sidebar_widgets.indexOf(w);
              return (
                <li
                  key={w}
                  className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2"
                >
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggleWidget(w, v)}
                    aria-label={t("archiveLayout.toggleWidget")}
                  />
                  <span className="flex-1 text-sm">{t(`archiveLayout.widgets.${w}`)}</span>
                  {enabled && (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => moveWidget(w, -1)}
                        disabled={idx <= 0}
                        aria-label={t("archiveLayout.moveUp")}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => moveWidget(w, 1)}
                        disabled={idx < 0 || idx >= draft.sidebar_widgets.length - 1}
                        aria-label={t("archiveLayout.moveDown")}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </FieldsGrid>

      {/* Extras */}
      <FieldsGrid title={t("archiveLayout.sections.extras")}>
        <Toggle
          label={t("archiveLayout.fields.showFeaturedTop")}
          checked={draft.show_featured_top}
          onChange={(v) => set("show_featured_top", v)}
        />
        <Toggle
          label={t("archiveLayout.fields.showRelatedTaxonomies")}
          checked={draft.show_related_taxonomies}
          onChange={(v) => set("show_related_taxonomies", v)}
        />
        <Toggle
          label={t("archiveLayout.fields.showPodcasts")}
          checked={draft.show_podcasts}
          onChange={(v) => set("show_podcasts", v)}
        />
      </FieldsGrid>

      <footer className="flex flex-wrap gap-2 items-center pt-4 border-t border-border">
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          {save.isPending ? t("archiveLayout.saving") : t("archiveLayout.save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setDraft((d) => (d ? { ...d, ...DEFAULT_ARCHIVE_LAYOUT } : d))
          }
        >
          Reset
        </Button>
      </footer>
    </div>
  );
}

function FieldsGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2 text-sm cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="flex-1">{label}</span>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 rounded-md border border-border bg-background px-2 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border border-border bg-background px-2"
      />
    </label>
  );
}
