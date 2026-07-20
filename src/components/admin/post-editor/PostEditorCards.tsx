// Karty sekcji edytora wpisu (rozbicie monolitu admin.posts.$slug; zachowanie
// bez zmian). Każda sekcja to osobny komponent; PostSidebarBundle składa
// zestaw kart dla zakładki "Publikacja" (scope="publish") i dla panelu
// dokumentu edytora bloków (scope="document" - superset z layoutem,
// taksonomią, dostępem i rewizjami).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Settings as SettingsIcon, Layers, Mic } from "@/lib/lucide-shim";
import { History, ListChecks, Languages, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { AudioPicker } from "@/components/admin/AudioPicker";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { CustomMetaValuesEditor } from "@/components/admin/CustomMetaValuesEditor";
import { PageParentSelect } from "@/components/admin/PageParentSelect";
import { TakeawaysTab } from "@/components/admin/PostSettingsMetabox";
import { RelatedOverrideEditor } from "@/components/admin/RelatedOverrideEditor";
import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";
import { migratePostToBlocks } from "@/lib/posts-migrate.functions";
import { toastError } from "@/lib/toastError";
import type {
  LayoutOverrides,
  LayoutPreset,
  PostFormat,
  PostLayoutSettings,
} from "@/lib/postLayouts";
import { ChangelogCard } from "./ChangelogCard";
import { LayoutOverridesCard } from "./LayoutOverridesCard";
import { PreviewLinksCard } from "./PreviewLinksCard";
import { PublishChecklistCard } from "./PublishChecklistCard";
import { SeriesCard } from "./SeriesCard";
import { SidebarSection, InfoHint } from "./SidebarSection";
import { CategoriesCard, TagsCard, BilingualPickerCard } from "./TaxonomyCards";
import { TranslateCard } from "./TranslateCard";
import { WorkflowStatusSection } from "./WorkflowStatusSection";
import type { EditorType } from "./postForm";
import type { PostEditorData } from "./usePostEditorData";
import type { PostEditorFormApi } from "./usePostEditorForm";
import type { useInlineTaxonomy } from "./useInlineTaxonomy";

type InlineTaxonomyApi = ReturnType<typeof useInlineTaxonomy>;

/** Karta "Ustawienia wpisu": workflow + typ edytora + slug + strona nadrzędna
 *  + czas czytania + okładka. */
export function PostSettingsCard({
  formApi,
  data,
  routeSlug,
  uiLang,
  autoReadMinutes,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  routeSlug: string;
  uiLang: string;
  autoReadMinutes: { pl: { minutes: number }; en: { minutes: number } };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const migrate$ = useServerFn(migratePostToBlocks);
  const { form, set, canPublish, busy, statusOptions, scheduledInPast } = formApi;
  if (!form) return null;

  const workflowSection = (
    <WorkflowStatusSection
      status={form.status}
      publishAt={form.publish_at}
      publishedAt={form.published_at}
      canPublish={canPublish}
      busy={busy}
      statusOptions={statusOptions}
      scheduledInPast={scheduledInPast}
      uiLang={uiLang}
      onStatusChange={(v) => {
        // Zmiana w select też przechodzi przez bramkę - to główna ścieżka
        // publikacji (status -> published, potem Zapisz).
        void (async () => {
          if (await formApi.confirmPublishGaps(v)) set("status", v);
        })();
      }}
      onPublishAtChange={(v) => set("publish_at", v)}
      onApplyStatus={formApi.applyStatus}
    />
  );

  return (
    <SidebarSection
      title={t("admin.posts.settingsCard", { defaultValue: "Ustawienia wpisu" })}
      icon={SettingsIcon}
    >
      {workflowSection}
      <SidebarSection
        title={t("admin.posts.editorAdvanced", { defaultValue: "Zaawansowane: typ edytora" })}
        icon={Layers}
        defaultOpen={false}
      >
        <p className="text-[11px] text-muted-foreground -mt-1">
          {t("admin.posts.editorAdvancedHint", {
            defaultValue:
              "Domyślnie używany jest edytor blokowy. Zmień tylko jeśli wiesz, czego potrzebujesz.",
          })}
        </p>
        <div>
          <Label className="inline-flex items-center gap-1">
            {t("admin.posts.editor")}
            <InfoHint
              text={t("admin.posts.editorHint", {
                defaultValue:
                  "Bloki = zalecany edytor. Visual Builder = układ przeciągnij-i-upuść. Rich text / Markdown = starsze tryby tekstowe.",
              })}
            />
          </Label>
          <Select value={form.editor} onValueChange={(v) => set("editor", v as EditorType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blocks">
                {t("admin.posts.editorBlocks", { defaultValue: "Block editor (zalecane)" })}
              </SelectItem>
              <SelectItem value="builder">
                {t("admin.posts.editorBuilder", { defaultValue: "Visual Builder (Elementor)" })}
              </SelectItem>
              <SelectItem value="richtext">
                {t("admin.posts.editorRichtext", { defaultValue: "Rich text (legacy)" })}
              </SelectItem>
              <SelectItem value="markdown">
                {t("admin.posts.editorMarkdown", { defaultValue: "Markdown (legacy)" })}
              </SelectItem>
            </SelectContent>
          </Select>
          {form.editor !== "blocks" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={async () => {
                try {
                  const res = await migrate$({ data: { id: form.id } });
                  toast.success(
                    t("admin.posts.migrateOk", {
                      defaultValue: "Skonwertowano na bloki (źródło: {{src}})",
                      src: res.source,
                    }),
                  );
                  await qc.invalidateQueries({
                    queryKey: ["post-by-slug", data.tenantId, routeSlug],
                  });
                } catch (e) {
                  toastError(e, "generic");
                }
              }}
            >
              {t("admin.posts.migrateToBlocks", { defaultValue: "Konwertuj na bloki" })}
            </Button>
          )}
        </div>
      </SidebarSection>
      <div>
        <Label className="inline-flex items-center gap-1">
          Slug
          <InfoHint
            text={t("admin.posts.slugHint", {
              defaultValue:
                "Część adresu URL wpisu. Zmiana slug zmienia link; przy kolizji serwer dopisze sufiks.",
            })}
          />
        </Label>
        <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
      </div>
      <div>
        <Label className="inline-flex items-center gap-1">
          {t("admin.posts.parentLabel", { defaultValue: "Strona nadrzędna" })}
          <InfoHint
            text={t("admin.posts.parentHint", {
              defaultValue:
                "Umieszcza wpis w ścieżce URL wybranej strony i wpływa na nawigację/breadcrumbs.",
            })}
          />
        </Label>
        <PageParentSelect
          tenantId={data.tenantId}
          value={form.parent_page_id}
          onChange={(v) => v && set("parent_page_id", v)}
          label=""
          noneLabel={t("admin.posts.parentNone", { defaultValue: "- wybierz stronę -" })}
        />
      </div>
      <div>
        <Label>{t("admin.posts.readMinutes")}</Label>
        <Input
          type="number"
          value={form.read_minutes ?? ""}
          onChange={(e) => set("read_minutes", e.target.value ? Number(e.target.value) : null)}
          placeholder={t("admin.posts.readMinutesAuto", { defaultValue: "auto" })}
        />
        {/* Symultaniczny podgląd automatu dla OBU wersji językowych, liczony
            tym samym rdzeniem i ustawieniami co strona publiczna
            (/admin/reading-time). Puste pole = czytelnik dostaje automat. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("admin.posts.readMinutesHint", {
            defaultValue: "Auto: PL {{pl}} min · EN {{en}} min. Puste pole = automat.",
            pl: autoReadMinutes.pl.minutes,
            en: autoReadMinutes.en.minutes,
          })}
        </p>
      </div>
      <div>
        <CoverImagePicker
          label={t("admin.posts.cover")}
          value={form.cover_image_url ?? ""}
          onChange={(v: string) => set("cover_image_url", v || null)}
        />
      </div>
    </SidebarSection>
  );
}

/** Karta tłumaczenia PL→EN: szkic wchodzi do formularza JEDNĄ zmianą. */
export function PostTranslateCard({ formApi }: { formApi: PostEditorFormApi }) {
  const { t } = useTranslation();
  const { form, history } = formApi;
  if (!form) return null;
  return (
    <SidebarSection
      title={t("adminPostPanes.translate.title")}
      icon={Languages}
      defaultOpen={false}
    >
      <TranslateCard
        source={{
          title_pl: form.title_pl,
          excerpt_pl: form.excerpt_pl,
          takeaways_pl: form.takeaways_pl,
          seo_title_pl: form.seo_title_pl,
          seo_description_pl: form.seo_description_pl,
          content_pl:
            form.editor === "richtext" || form.editor === "markdown" ? form.content_pl : null,
          blocks_pl: form.editor === "blocks" ? (form.blocks_data?.pl?.blocks ?? null) : null,
        }}
        hasEnContent={!!form.title_en.trim() || (form.blocks_data?.en?.blocks?.length ?? 0) > 0}
        onTranslated={(result) => {
          // Szkic tłumaczenia wchodzi do formularza jedną zmianą (undo cofa
          // całość). Dokument bloków EN tylko dla edytora blokowego.
          history.set((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              title_en: result.title_en || prev.title_en,
              excerpt_en: result.excerpt_en ?? prev.excerpt_en,
              takeaways_en:
                result.takeaways_en.length > 0 ? result.takeaways_en : prev.takeaways_en,
              seo_title_en: result.seo_title_en ?? prev.seo_title_en,
              seo_description_en: result.seo_description_en ?? prev.seo_description_en,
              content_en: result.content_en ?? prev.content_en,
              blocks_data:
                prev.editor === "blocks" && result.blocks_en
                  ? {
                      pl: prev.blocks_data?.pl ?? { version: 1, blocks: [] },
                      en: { version: 1, blocks: result.blocks_en },
                    }
                  : prev.blocks_data,
            };
          });
        }}
      />
    </SidebarSection>
  );
}

/** Karta layoutu (format + nadpisania) - wspólna dla zakładki i panelu bloków. */
export function PostLayoutCard({
  formApi,
  ov,
  onOverridesChange,
  currentFormat,
  layoutSet,
  globalLayout,
}: {
  formApi: PostEditorFormApi;
  ov: LayoutOverrides;
  onOverridesChange: (patch: Partial<LayoutOverrides>) => void;
  currentFormat: PostFormat;
  layoutSet: LayoutPreset[];
  globalLayout: PostLayoutSettings | undefined;
}) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <LayoutOverridesCard
      postFormat={form.post_format}
      onPostFormatChange={(v) => set("post_format", v)}
      ov={ov}
      onOverridesChange={onOverridesChange}
      currentFormat={currentFormat}
      layoutSet={layoutSet}
      globalLayout={globalLayout}
    />
  );
}

/** Siatka taksonomii: kategorie, tagi, projekty, regiony. */
export function PostTaxonomyGrid({
  formApi,
  data,
  taxonomy,
  grid,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  taxonomy: InlineTaxonomyApi;
  /** true = układ 2-kolumnowy (zakładka "Kategorie i tagi"). */
  grid?: boolean;
}) {
  const { t } = useTranslation();
  const cards = (
    <>
      <CategoriesCard
        allCats={data.allCats}
        selectedCats={formApi.selectedCats}
        onSelectedCatsChange={formApi.setSelectedCats}
        newCatPl={taxonomy.newCatPl}
        onNewCatPlChange={taxonomy.setNewCatPl}
        newCatEn={taxonomy.newCatEn}
        onNewCatEnChange={taxonomy.setNewCatEn}
        taxonomyBusy={taxonomy.taxonomyBusy}
        onAddCategory={() => void taxonomy.addCategory()}
      />
      <TagsCard
        allTags={data.allTags}
        selectedTags={formApi.selectedTags}
        onSelectedTagsChange={formApi.setSelectedTags}
        newTagName={taxonomy.newTagName}
        onNewTagNameChange={taxonomy.setNewTagName}
        taxonomyBusy={taxonomy.taxonomyBusy}
        onAddTag={() => void taxonomy.addTag()}
      />
      <BilingualPickerCard
        label={t("admin.nav.programs", { defaultValue: "Projekty" })}
        options={data.allPrograms ?? undefined}
        selectedIds={formApi.selectedPrograms}
        onSelectedChange={formApi.setSelectedPrograms}
        emptyHint={t("admin.posts.noPrograms", {
          defaultValue: "Brak projektów - dodaj je w /admin/programs",
        })}
      />
      <BilingualPickerCard
        label={t("admin.nav.regions", { defaultValue: "Regiony" })}
        options={data.allRegions ?? undefined}
        selectedIds={formApi.selectedRegions}
        onSelectedChange={formApi.setSelectedRegions}
        emptyHint={t("admin.posts.noRegions", {
          defaultValue: "Brak regionów - dodaj je w /admin/regions",
        })}
      />
    </>
  );
  if (grid) return <div className="grid md:grid-cols-2 gap-4">{cards}</div>;
  return cards;
}

/** Sekcja "Dowiesz się…" (zakładka szczegółów). */
export function TakeawaysSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold">Dowiesz się…</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Kluczowe punkty wpisu w PL i EN. Wybierz wariant wizualny lub zostaw globalny.
        </p>
      </header>
      <div className="p-4">
        <TakeawaysTab
          pl={form.takeaways_pl ?? []}
          en={form.takeaways_en ?? []}
          onChange={(lang, next) => set(lang === "pl" ? "takeaways_pl" : "takeaways_en", next)}
          variantOverride={form.takeaways_variant ?? null}
          onVariantChange={(next) => set("takeaways_variant", next)}
        />
      </div>
    </section>
  );
}

/** Sekcja audio wpisu (MP3 PL/EN z fallbackiem do lektora AI). */
export function AudioSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold inline-flex items-center gap-2">
          <Mic className="w-4 h-4 text-brand" />
          Audio wpisu (MP3)
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Wgraj własny plik audio dla PL i/lub EN. Dla języka bez wgranego pliku użyty zostanie
          automatyczny lektor AI (ElevenLabs). Max 50 MB · MP3, M4A, AAC, OGG, WAV.
        </p>
      </header>
      <div className="p-4 grid md:grid-cols-2 gap-4">
        <AudioPicker
          label="Plik audio - polski (PL)"
          value={form.audio_url_pl ?? ""}
          onChange={(v: string) => set("audio_url_pl", v || null)}
          hint="Wgrany plik zastępuje ElevenLabs dla PL. Usuń, aby wrócić do lektora AI."
        />
        <AudioPicker
          label="Plik audio - angielski (EN)"
          value={form.audio_url_en ?? ""}
          onChange={(v: string) => set("audio_url_en", v || null)}
          hint="Wgrany plik zastępuje ElevenLabs dla EN. Usuń, aby wrócić do lektora AI."
        />
      </div>
    </section>
  );
}

/** Sekcja własnych pól meta (zakładka szczegółów). */
export function CustomMetaSection({
  formApi,
  data,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
}) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold">Custom meta</h2>
          <p className="text-xs text-muted-foreground">Wartości własnych pól dla tego wpisu.</p>
        </div>
        <Link to="/admin/custom-meta" className="text-xs text-brand underline">
          Edytuj definicje
        </Link>
      </div>
      <CustomMetaValuesEditor
        tenantId={data.tenantId}
        lang="pl"
        values={form.custom_meta}
        onChange={(next) => set("custom_meta", next)}
      />
    </div>
  );
}

/** Sekcja override'u powiązanych wpisów (zakładka szczegółów). */
export function RelatedSection({ formApi }: { formApi: PostEditorFormApi }) {
  const { form, set } = formApi;
  if (!form) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-semibold">Powiązane wpisy - override</h2>
          <p className="text-xs text-muted-foreground">
            Nadpisuje globalną konfigurację dla tego wpisu.
          </p>
        </div>
        <Link to="/admin/related-posts" className="text-xs text-brand underline">
          Konfiguracja globalna
        </Link>
      </div>
      <RelatedOverrideEditor
        value={form.related_override}
        onChange={(next: Record<string, unknown> | null) => set("related_override", next)}
      />
    </div>
  );
}

/** Zestaw kart dokumentu: zakładka "Publikacja" (scope="publish") oraz panel
 *  dokumentu edytora bloków (scope="document" - superset). Kolejność kart
 *  identyczna jak przed rozbiciem. */
export function PostSidebarBundle({
  scope,
  formApi,
  data,
  routeSlug,
  uiLang,
  autoReadMinutes,
  taxonomy,
  layoutCard,
}: {
  scope: "publish" | "document";
  formApi: PostEditorFormApi;
  data: PostEditorData;
  routeSlug: string;
  uiLang: string;
  autoReadMinutes: { pl: { minutes: number }; en: { minutes: number } };
  taxonomy: InlineTaxonomyApi;
  /** Karta layoutu budowana w trasie (dzieli ov/currentFormat z canvasWrap). */
  layoutCard?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { form, publishChecklist } = formApi;
  if (!form || !publishChecklist) return null;
  return (
    <div className="space-y-4">
      <SidebarSection
        title={t("adminPostPanes.publishChecklist.title")}
        icon={ListChecks}
        defaultOpen={!publishChecklist.requiredOk}
      >
        <PublishChecklistCard checklist={publishChecklist} />
      </SidebarSection>
      <PostSettingsCard
        formApi={formApi}
        data={data}
        routeSlug={routeSlug}
        uiLang={uiLang}
        autoReadMinutes={autoReadMinutes}
      />
      <PostTranslateCard formApi={formApi} />
      <SidebarSection title={t("adminPostPanes.series.title")} icon={Layers} defaultOpen={false}>
        <SeriesCard postId={data.id} />
      </SidebarSection>
      <SidebarSection title={t("adminPostPanes.previewLinks.title")} icon={Eye} defaultOpen={false}>
        <PreviewLinksCard postId={data.id} />
      </SidebarSection>
      <SidebarSection
        title={t("adminPostPanes.changelog.title")}
        icon={History}
        defaultOpen={false}
      >
        <ChangelogCard postId={data.id} />
      </SidebarSection>
      {scope === "document" && (
        <>
          {layoutCard}
          <PostTaxonomyGrid formApi={formApi} data={data} taxonomy={taxonomy} />
          <AccessSettingsPane entityType="post" entityId={data.id} />
          <RevisionsCard
            entityType="post"
            entityId={data.id}
            onRestored={formApi.onRevisionRestored}
          />
        </>
      )}
    </div>
  );
}
