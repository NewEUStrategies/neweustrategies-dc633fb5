// Edytor wpisu - trasa-orkiestrator po rozbiciu monolitu (~1550 linii):
//   * dane:      usePostEditorData (wiersz posta przez RPC + taksonomie),
//   * formularz: usePostEditorForm (undo/redo + autosave + zapisy + bramka
//                checklisty + inwalidacje przy wyjściu),
//   * widok:     PostEditorHeader / PostDetailsNav / karty per sekcja
//                (PostEditorCards) + edytory treści (bloki/builder/legacy).
// Zachowanie 1:1 z wersją sprzed rozbicia - to refactor bez zmian funkcji.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { computeBilingualReadingStats } from "@/lib/readingTime";
import { useReadingTimeSettings } from "@/hooks/useReadingTimeSettings";
import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";
import { EditPresenceBanner } from "@/components/admin/molecules/EditPresenceBanner";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PostEditor } from "@/components/admin/PostEditor";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import { ArrowRight } from "@/lib/lucide-shim";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { PostBlockEditor } from "@/components/admin/blocks/PostBlockEditor";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { getLayoutSet, mergeOverrides, pickLayoutId } from "@/lib/postLayouts";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { PostSettingsMetabox } from "@/components/admin/PostSettingsMetabox";
import { SeoPanel } from "@/components/admin/seo/SeoPanel";
import { InternalLinkSuggestions } from "@/components/admin/seo/InternalLinkSuggestions";
import { PostGeneralOverview } from "@/components/admin/PostGeneralOverview";
import { promptDialog } from "@/lib/appDialogs";
import { usePostEditorData } from "@/components/admin/post-editor/usePostEditorData";
import { usePostEditorForm } from "@/components/admin/post-editor/usePostEditorForm";
import { useInlineTaxonomy } from "@/components/admin/post-editor/useInlineTaxonomy";
import { PostEditorHeader } from "@/components/admin/post-editor/PostEditorHeader";
import { PostDetailsNav, type DetailsTab } from "@/components/admin/post-editor/PostDetailsNav";
import {
  AudioSection,
  CustomMetaSection,
  PostLayoutCard,
  PostSidebarBundle,
  PostTaxonomyGrid,
  RelatedSection,
  TakeawaysSection,
} from "@/components/admin/post-editor/PostEditorCards";

export const Route = createFileRoute("/admin/posts/$slug")({
  component: EditPost,
});

function EditPost() {
  const { slug: routeSlug } = Route.useParams();
  const { t, i18n } = useTranslation();
  const uiLang = i18n.language ?? "pl";
  const { data: globalLayout } = usePostLayoutSettings();

  const data = usePostEditorData(routeSlug);
  const formApi = usePostEditorForm(routeSlug, data);
  const { form, set } = formApi;
  const taxonomy = useInlineTaxonomy({
    tenantId: data.tenantId,
    onCategoryCreated: (catId) => formApi.setSelectedCats((s) => [...s, catId]),
    onTagCreated: (tagId) => formApi.setSelectedTags((s) => [...s, tagId]),
  });

  // Two-step flow: "details" shows metadata + titles + descriptions in both
  // languages; "content" opens the actual editor (builder / rich text).
  const [step, setStep] = useState<"details" | "content">("details");
  // Content-first: an established post (already titled) opens straight in the
  // editor so writing - not the dense metadata - is the landing view. Brand-new
  // / untitled posts stay on "details" so the author sets a title first. Runs
  // exactly once after the post loads and never fights later manual navigation.
  const autoStepRef = useRef(false);
  useEffect(() => {
    if (autoStepRef.current || !form) return;
    autoStepRef.current = true;
    if (form.title_pl?.trim() || form.title_en?.trim()) {
      setStep("content");
    }
  }, [form]);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("general");

  // Symultaniczny podgląd czasu czytania PL/EN dla hinta przy read_minutes -
  // ten sam rdzeń i ustawienia (/admin/reading-time) co strona publiczna.
  const readingTimeSettings = useReadingTimeSettings();
  const autoReadMinutes = useMemo(
    () =>
      computeBilingualReadingStats(
        {
          pl: {
            html: form?.content_pl ?? "",
            docs: [form?.builder_data, form?.blocks_data?.pl],
            extraText: form?.excerpt_pl ?? undefined,
          },
          en: {
            html: form?.content_en ?? "",
            docs: [form?.builder_data, form?.blocks_data?.en],
            extraText: form?.excerpt_en ?? undefined,
          },
        },
        readingTimeSettings,
      ),
    [
      form?.content_pl,
      form?.content_en,
      form?.builder_data,
      form?.blocks_data,
      form?.excerpt_pl,
      form?.excerpt_en,
      readingTimeSettings,
    ],
  );

  if (data.isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const pickImage = async (): Promise<string | null> =>
    promptDialog({
      title: t("admin.imageUrlTitle", { defaultValue: "Adres URL obrazka" }),
      placeholder: "https://…",
      confirmLabel: t("admin.insert", { defaultValue: "Wstaw" }),
    });

  const ov: LayoutOverrides = (form.layout_overrides ?? {}) as LayoutOverrides;
  const setOv = (patch: Partial<LayoutOverrides>) => {
    const next = { ...ov, ...patch };
    // Drop empty object to null for cleanliness
    const hasAny = Object.values(next).some((v) => v !== undefined && v !== null && v !== "");
    set("layout_overrides", hasAny ? next : null);
  };
  const currentFormat: PostFormat = (ov.format ?? form.post_format ?? "standard") as PostFormat;
  const layoutSet = getLayoutSet(currentFormat);

  const layoutCard = (
    <PostLayoutCard
      formApi={formApi}
      ov={ov}
      onOverridesChange={setOv}
      currentFormat={currentFormat}
      layoutSet={layoutSet}
      globalLayout={globalLayout}
    />
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <PostEditorHeader step={step} onStepChange={setStep} formApi={formApi} />

        <EditPresenceBanner entityType="post" entityId={data.id} />

        {step === "details" ? (
          <div className="flex flex-col md:flex-row gap-6">
            <PostDetailsNav active={detailsTab} onSelect={setDetailsTab} />
            <section className="flex-1 min-w-0">
              <div className="bg-card border border-border rounded-lg p-5 md:p-6 space-y-5">
                {detailsTab === "general" && (
                  <PostGeneralOverview
                    entityId={data.id}
                    titlePl={form.title_pl}
                    titleEn={form.title_en}
                    onTitlePlChange={(v) => set("title_pl", v)}
                    onTitleEnChange={(v) => set("title_en", v)}
                    excerptPl={form.excerpt_pl ?? ""}
                    excerptEn={form.excerpt_en ?? ""}
                    onExcerptPlChange={(v) => set("excerpt_pl", v)}
                    onExcerptEnChange={(v) => set("excerpt_en", v)}
                    status={form.status}
                    slug={form.slug}
                    coverImageUrl={form.cover_image_url}
                    publishedAt={form.published_at}
                    publishAt={form.publish_at}
                    seoTitlePl={form.seo_title_pl}
                    seoTitleEn={form.seo_title_en}
                    seoDescriptionPl={form.seo_description_pl}
                    seoDescriptionEn={form.seo_description_en}
                    seoNoindex={form.seo_noindex}
                    seoIssues={formApi.seoIssues}
                    tocOverride={form.toc_override ?? null}
                    takeawaysPl={form.takeaways_pl ?? []}
                    takeawaysEn={form.takeaways_en ?? []}
                    customMeta={form.custom_meta}
                    relatedOverride={form.related_override}
                    postFormat={(form.post_format ?? "standard") as PostFormat}
                    layoutOverrides={form.layout_overrides}
                    selectedCatNames={(data.allCats ?? [])
                      .filter((c) => formApi.selectedCats.includes(c.id))
                      .map((c) =>
                        uiLang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en,
                      )}
                    selectedTagNames={(data.allTags ?? [])
                      .filter((tg) => formApi.selectedTags.includes(tg.id))
                      .map((tg) => tg.name)}
                    onNavigate={(tab) => setDetailsTab(tab)}
                  />
                )}

                {detailsTab === "settings" && (
                  <PostSettingsMetabox
                    entityType="post"
                    entityId={data.id}
                    tocOverride={form.toc_override ?? null}
                    onTocOverrideChange={(next) => set("toc_override", next)}
                    postBlocks={form.blocks_data ?? null}
                    hideTakeawaysTab
                  />
                )}

                {detailsTab === "takeaways" && <TakeawaysSection formApi={formApi} />}

                {detailsTab === "seo" && (
                  <div className="space-y-3">
                    <SeoPanel
                      value={{
                        seo_title_pl: form.seo_title_pl,
                        seo_title_en: form.seo_title_en,
                        seo_description_pl: form.seo_description_pl,
                        seo_description_en: form.seo_description_en,
                        seo_canonical_url: form.seo_canonical_url,
                        seo_noindex: form.seo_noindex ?? false,
                        seo_og_image_url: form.seo_og_image_url,
                        og_image_generated_url: form.og_image_generated_url,
                      }}
                      onChange={(patch) =>
                        formApi.history.set((f) => (f ? { ...f, ...patch } : f), {
                          coalesceKey: Object.keys(patch).sort().join("|"),
                        })
                      }
                      entity={{ kind: "post", id: data.id }}
                      slug={form.slug}
                      pathSourcePageId={form.parent_page_id}
                      fallbackTitle={{ pl: form.title_pl, en: form.title_en }}
                      fallbackDescription={{ pl: form.excerpt_pl, en: form.excerpt_en }}
                      coverImageUrl={form.cover_image_url}
                      ogKicker={
                        data.allCats?.find((c) => formApi.selectedCats.includes(c.id))?.name_pl ??
                        null
                      }
                      contentHtml={{ pl: form.content_pl, en: form.content_en }}
                      contentBlocks={form.blocks_data}
                      onIssuesChange={formApi.setSeoIssues}
                    />
                    <InternalLinkSuggestions
                      postId={data.id === "new" ? null : data.id}
                      titlePl={form.title_pl}
                      titleEn={form.title_en}
                      contentPl={form.content_pl}
                      contentEn={form.content_en}
                      categoryIds={formApi.selectedCats}
                      tagIds={formApi.selectedTags}
                    />
                  </div>
                )}

                {detailsTab === "meta" && <CustomMetaSection formApi={formApi} data={data} />}

                {detailsTab === "related" && <RelatedSection formApi={formApi} />}

                {detailsTab === "publish" && (
                  <PostSidebarBundle
                    scope="publish"
                    formApi={formApi}
                    data={data}
                    routeSlug={routeSlug}
                    uiLang={uiLang}
                    autoReadMinutes={autoReadMinutes}
                    taxonomy={taxonomy}
                  />
                )}

                {detailsTab === "layout" && <div className="space-y-4">{layoutCard}</div>}

                {detailsTab === "taxonomy" && (
                  <PostTaxonomyGrid formApi={formApi} data={data} taxonomy={taxonomy} grid />
                )}

                {detailsTab === "access" && (
                  <AccessSettingsPane entityType="post" entityId={data.id} />
                )}

                {detailsTab === "audio" && <AudioSection formApi={formApi} />}

                {detailsTab === "revisions" && (
                  <RevisionsCard
                    entityType="post"
                    entityId={data.id}
                    onRestored={formApi.onRevisionRestored}
                  />
                )}

                <div className="flex justify-end pt-2 border-t border-border">
                  <Button
                    onClick={() => setStep("content")}
                    disabled={!form.title_pl.trim() && !form.title_en.trim()}
                  >
                    Przejdź do edycji treści <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 bg-card border border-border rounded-lg p-2 pl-4">
              <div className="text-xs text-muted-foreground">
                {t("admin.posts.editorMode", { defaultValue: "Tryb edytora" })}
              </div>
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => set("editor", "blocks")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${form.editor === "blocks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={form.editor === "blocks"}
                >
                  Gutenberg
                </button>
                <button
                  type="button"
                  onClick={() => set("editor", "builder")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${form.editor === "builder" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={form.editor === "builder"}
                >
                  Elementor
                </button>
              </div>
            </div>
            {form.editor === "blocks" ? (
              <PostBlockEditor
                value={form.blocks_data ?? { pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC }}
                onChange={(v) => set("blocks_data", v)}
                canvasWrap={(canvas, lang) => {
                  if (!globalLayout) return canvas;
                  const effective = mergeOverrides(globalLayout, ov);
                  const layoutId = pickLayoutId(globalLayout, currentFormat, ov.layout);
                  const title =
                    lang === "en" ? form.title_en || form.title_pl : form.title_pl || form.title_en;
                  const excerpt = lang === "en" ? form.excerpt_en : form.excerpt_pl;
                  return (
                    <LayoutScaffold
                      format={currentFormat}
                      layoutId={layoutId}
                      settings={effective}
                      title={title}
                      excerpt={excerpt}
                      coverImageUrl={form.cover_image_url}
                    >
                      {canvas}
                    </LayoutScaffold>
                  );
                }}
                documentPane={
                  <PostSidebarBundle
                    scope="document"
                    formApi={formApi}
                    data={data}
                    routeSlug={routeSlug}
                    uiLang={uiLang}
                    autoReadMinutes={autoReadMinutes}
                    taxonomy={taxonomy}
                    layoutCard={layoutCard}
                  />
                }
              />
            ) : form.editor === "builder" ? (
              <BuilderPane form={form} set={set} />
            ) : (
              <Tabs defaultValue="pl">
                <TabsList>
                  <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
                  <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
                </TabsList>
                <TabsContent value="pl" className="space-y-4 mt-4">
                  <div>
                    <Label>{t("admin.posts.content")} (PL)</Label>
                    <PostEditor
                      mode={form.editor === "markdown" ? "markdown" : "richtext"}
                      value={form.content_pl ?? ""}
                      onChange={(v) => set("content_pl", v)}
                      onPickImage={pickImage}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="en" className="space-y-4 mt-4">
                  <div>
                    <Label>{t("admin.posts.content")} (EN)</Label>
                    <PostEditor
                      mode={form.editor === "markdown" ? "markdown" : "richtext"}
                      value={form.content_en ?? ""}
                      onChange={(v) => set("content_en", v)}
                      onPickImage={pickImage}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function BuilderPane({
  form,
  set,
}: {
  form: { builder_data: BuilderDocument | null };
  set: (k: "builder_data", v: BuilderDocument) => void;
}) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return (
    <Builder
      value={form.builder_data}
      onChange={(v) => set("builder_data", v)}
      lang={lang}
      onLangChange={setLang}
    />
  );
}
