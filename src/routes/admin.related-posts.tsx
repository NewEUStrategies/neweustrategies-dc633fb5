// Admin: konfiguracja + BI-analiza silnika rekomendacji (singleton per tenant).
//
// ZAPIS: wyłącznie przez `useSaveRelatedPostsConfig` (lib/relatedPosts/adminConfig),
// czyli upsert z jawnym `tenant_id` + POTWIERDZENIEM zapisanego wiersza.
// Poprzednia implementacja robiła `update(next).neq("tenant_id", zero-uuid)` -
// UPDATE bez dopasowania jest dla PostgREST sukcesem, więc tenant bez zasianego
// wiersza (brak provisioningu po migracji z 24.06) widział „Zapisano" przy
// zerowej zmianie. Szczegóły w nagłówku lib/relatedPosts/settings.
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingInput } from "@/components/ui/floating-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import {
  relatedPostsAdminConfigQueryOptions,
  useSaveRelatedPostsConfig,
} from "@/lib/relatedPosts/adminConfig";
import {
  RELATED_POSTS_LIMITS,
  RelatedPostsSaveError,
  type RelatedPostsSaveFailure,
} from "@/lib/relatedPosts/settings";
import { RelatedPostsAnalytics } from "@/components/admin/analytics/RelatedPostsAnalytics";
import { RelatedLayoutPreview } from "@/components/admin/RelatedLayoutPreview";
import { SettingToggle } from "@/components/admin/atoms/SettingToggle";
import { WeightSlider } from "@/components/admin/atoms/WeightSlider";
import { ensureI18n } from "@/lib/i18n-admin-related-posts";

export const Route = createFileRoute("/admin/related-posts")({
  component: AdminRelatedPostsPage,
  notFoundComponent: () => <NotFound />,
  errorComponent: (props) => <RouteErrorFallback {...props} variant="admin" />,
});

function NotFound() {
  ensureI18n();
  const { t } = useTranslation();
  return <div className="p-8">{t("adminRelatedPosts.notFound")}</div>;
}

/** Mapa przyczyn nieudanego zapisu na komunikaty i18n (PL/EN). */
const SAVE_FAILURE_KEYS: Readonly<Record<RelatedPostsSaveFailure, string>> = {
  no_tenant: "adminRelatedPosts.toast.noTenant",
  tenant_lookup_failed: "adminRelatedPosts.toast.tenantLookupFailed",
  write_failed: "adminRelatedPosts.toast.writeFailed",
  not_persisted: "adminRelatedPosts.toast.notPersisted",
};

function AdminRelatedPostsPage() {
  ensureI18n();
  const { t } = useTranslation();
  const { data } = useQuery(relatedPostsAdminConfigQueryOptions());
  const [form, setForm] = useState<RelatedPostsConfig>(RELATED_POSTS_DEFAULTS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useSaveRelatedPostsConfig();

  const onSave = (): void => {
    save.mutate(form, {
      onSuccess: (saved) => {
        // Formularz przyjmuje wartości PO normalizacji, żeby UI nigdy nie
        // pokazywał czegoś innego niż to, co faktycznie stoi w bazie.
        const { tenant_id: _tenantId, ...config } = saved;
        setForm(config);
        toast.success(t("adminRelatedPosts.toast.saved"));
      },
      onError: (error: Error) => {
        if (error instanceof RelatedPostsSaveError) {
          toast.error(t(SAVE_FAILURE_KEYS[error.reason], { msg: error.cause ?? error.message }));
          return;
        }
        toast.error(t("adminRelatedPosts.toast.writeFailed", { msg: error.message }));
      },
    });
  };

  const set = <K extends keyof RelatedPostsConfig>(k: K, v: RelatedPostsConfig[K]): void => {
    setForm((s) => ({ ...s, [k]: v }));
  };

  const saveLabel = save.isPending
    ? t("adminRelatedPosts.actions.saving")
    : t("adminRelatedPosts.actions.save");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl">{t("adminRelatedPosts.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminRelatedPosts.intro")}</p>
      </header>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">{t("adminRelatedPosts.tabs.config")}</TabsTrigger>
          <TabsTrigger value="engine">{t("adminRelatedPosts.tabs.engine")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("adminRelatedPosts.tabs.analytics")}</TabsTrigger>
        </TabsList>

        {/* ---- Konfiguracja podstawowa ---------------------------------- */}
        <TabsContent value="config" className="mt-4">
          <section className="space-y-5 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-sm font-semibold">
                  {t("adminRelatedPosts.fields.enabled")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("adminRelatedPosts.fields.enabledHint")}
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => set("enabled", v)}
                className="shrink-0"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FloatingInput
                label={t("adminRelatedPosts.fields.titlePl")}
                value={form.title_pl}
                onChange={(e) => set("title_pl", e.target.value)}
              />
              <FloatingInput
                label={t("adminRelatedPosts.fields.titleEn")}
                value={form.title_en}
                onChange={(e) => set("title_en", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.position")}</Label>
                <Select
                  value={form.position}
                  onValueChange={(v) => set("position", v as RelatedPostsConfig["position"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="end">{t("adminRelatedPosts.position.end")}</SelectItem>
                    <SelectItem value="sidebar">
                      {t("adminRelatedPosts.position.sidebar")}
                    </SelectItem>
                    <SelectItem value="after_paragraph">
                      {t("adminRelatedPosts.position.afterParagraph")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.afterParagraph")}</Label>
                <Input
                  type="number"
                  min={RELATED_POSTS_LIMITS.afterParagraph.min}
                  max={RELATED_POSTS_LIMITS.afterParagraph.max}
                  value={form.after_paragraph}
                  onChange={(e) =>
                    set(
                      "after_paragraph",
                      clamp(e.target.value, RELATED_POSTS_LIMITS.afterParagraph),
                    )
                  }
                  disabled={form.position !== "after_paragraph"}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.itemsLimit")}</Label>
                <Input
                  type="number"
                  min={RELATED_POSTS_LIMITS.itemsLimit.min}
                  max={RELATED_POSTS_LIMITS.itemsLimit.max}
                  value={form.items_limit}
                  onChange={(e) =>
                    set("items_limit", clamp(e.target.value, RELATED_POSTS_LIMITS.itemsLimit))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.layout")}</Label>
                <Select
                  value={form.layout}
                  onValueChange={(v) => set("layout", v as RelatedPostsConfig["layout"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grid">{t("adminRelatedPosts.layout.grid")}</SelectItem>
                    <SelectItem value="list">{t("adminRelatedPosts.layout.list")}</SelectItem>
                    <SelectItem value="slider">{t("adminRelatedPosts.layout.slider")}</SelectItem>
                    <SelectItem value="cards">{t("adminRelatedPosts.layout.cards")}</SelectItem>
                    <SelectItem value="magazine">
                      {t("adminRelatedPosts.layout.magazine")}
                    </SelectItem>
                    <SelectItem value="timeline">
                      {t("adminRelatedPosts.layout.timeline")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.columns")}</Label>
                <Select
                  value={String(form.columns)}
                  onValueChange={(v) => set("columns", Number(v) as RelatedPostsConfig["columns"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.sourceStrategy")}</Label>
                <Select
                  value={form.source_strategy}
                  onValueChange={(v) =>
                    set("source_strategy", v as RelatedPostsConfig["source_strategy"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">{t("adminRelatedPosts.source.both")}</SelectItem>
                    <SelectItem value="categories">
                      {t("adminRelatedPosts.source.categories")}
                    </SelectItem>
                    <SelectItem value="tags">{t("adminRelatedPosts.source.tags")}</SelectItem>
                    <SelectItem value="author">{t("adminRelatedPosts.source.author")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Label className="text-sm font-semibold">
                  {t("adminRelatedPosts.fields.layoutPreview")}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("adminRelatedPosts.fields.layoutPreviewHint")}
                </span>
              </div>
              <RelatedLayoutPreview value={form.layout} onChange={(v) => set("layout", v)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SettingToggle
                label={t("adminRelatedPosts.fields.showCover")}
                checked={form.show_cover}
                onCheckedChange={(v) => set("show_cover", v)}
              />
              <SettingToggle
                label={t("adminRelatedPosts.fields.showExcerpt")}
                checked={form.show_excerpt}
                onCheckedChange={(v) => set("show_excerpt", v)}
              />
              <SettingToggle
                label={t("adminRelatedPosts.fields.showMeta")}
                checked={form.show_meta}
                onCheckedChange={(v) => set("show_meta", v)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.recencyBoostDays")}</Label>
                <Input
                  type="number"
                  min={RELATED_POSTS_LIMITS.recencyBoostDays.min}
                  max={RELATED_POSTS_LIMITS.recencyBoostDays.max}
                  value={form.recency_boost_days}
                  onChange={(e) =>
                    set(
                      "recency_boost_days",
                      clamp(e.target.value, RELATED_POSTS_LIMITS.recencyBoostDays),
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.sliderIntervalMs")}</Label>
                <Input
                  type="number"
                  min={RELATED_POSTS_LIMITS.sliderIntervalMs.min}
                  max={RELATED_POSTS_LIMITS.sliderIntervalMs.max}
                  step={500}
                  value={form.slider_interval_ms}
                  onChange={(e) =>
                    set(
                      "slider_interval_ms",
                      clamp(e.target.value, RELATED_POSTS_LIMITS.sliderIntervalMs),
                    )
                  }
                  disabled={!form.slider_autoplay}
                />
              </div>
              <SettingToggle
                className="self-end"
                label={t("adminRelatedPosts.fields.sliderAutoplay")}
                checked={form.slider_autoplay}
                onCheckedChange={(v) => set("slider_autoplay", v)}
              />
            </div>

            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={onSave} disabled={save.isPending}>
                {saveLabel}
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* ---- Silnik: wagi sygnałów ------------------------------------ */}
        <TabsContent value="engine" className="mt-4">
          <section className="space-y-5 rounded-lg border border-border bg-card p-5">
            <div className="space-y-1">
              <h2 className="font-display text-lg">{t("adminRelatedPosts.engine.heading")}</h2>
              <p className="text-xs text-muted-foreground">{t("adminRelatedPosts.engine.intro")}</p>
            </div>

            <WeightSlider
              label={t("adminRelatedPosts.engine.categories")}
              hint={t("adminRelatedPosts.engine.categoriesHint")}
              value={form.weight_categories}
              onChange={(v) => set("weight_categories", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.tags")}
              hint={t("adminRelatedPosts.engine.tagsHint")}
              value={form.weight_tags}
              onChange={(v) => set("weight_tags", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.author")}
              hint={t("adminRelatedPosts.engine.authorHint")}
              value={form.weight_author}
              onChange={(v) => set("weight_author", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.recency")}
              hint={t("adminRelatedPosts.engine.recencyHint")}
              value={form.weight_recency}
              onChange={(v) => set("weight_recency", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.popularity")}
              hint={t("adminRelatedPosts.engine.popularityHint")}
              value={form.weight_popularity}
              onChange={(v) => set("weight_popularity", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.dwell")}
              hint={t("adminRelatedPosts.engine.dwellHint")}
              value={form.weight_dwell}
              onChange={(v) => set("weight_dwell", v)}
            />
            <WeightSlider
              label={t("adminRelatedPosts.engine.personalization")}
              hint={t("adminRelatedPosts.engine.personalizationHint")}
              value={form.weight_personalization}
              onChange={(v) => set("weight_personalization", v)}
            />

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <SettingToggle
                label={t("adminRelatedPosts.fields.useIdf")}
                checked={form.use_idf}
                onCheckedChange={(v) => set("use_idf", v)}
              />
              <div className="space-y-1">
                <Label>{t("adminRelatedPosts.fields.minScore")}</Label>
                <Input
                  type="number"
                  min={RELATED_POSTS_LIMITS.minScore.min}
                  max={RELATED_POSTS_LIMITS.minScore.max}
                  value={form.min_score}
                  onChange={(e) =>
                    set("min_score", clamp(e.target.value, RELATED_POSTS_LIMITS.minScore))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("adminRelatedPosts.fields.minScoreHint")}
                </p>
              </div>
            </div>

            <div className="flex justify-end border-t border-border pt-3">
              <Button onClick={onSave} disabled={save.isPending}>
                {save.isPending
                  ? t("adminRelatedPosts.actions.saving")
                  : t("adminRelatedPosts.actions.saveWeights")}
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* ---- BI dashboard --------------------------------------------- */}
        <TabsContent value="analytics" className="mt-4">
          <RelatedPostsAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Przycięcie wartości z pola numerycznego do tych samych granic, których
 * pilnuje warstwa zapisu (`RELATED_POSTS_LIMITS`) - UI i baza nie mogą mieć
 * dwóch różnych zdań o dopuszczalnym zakresie.
 */
function clamp(raw: string, bounds: { min: number; max: number }): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}
