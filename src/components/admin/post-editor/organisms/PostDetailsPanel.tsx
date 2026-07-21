// Organizm: krok "Szczegóły" edytora wpisu - boczna nawigacja + panel sekcji
// (Ogólne, Ustawienia, Dowiesz się…, SEO, Custom meta, Powiązane, Publikacja,
// Layout, Kategorie i tagi, Dostęp, Audio, Historia) + przycisk przejścia do
// treści. Wyodrębnione 1:1 z trasy admin.posts.$slug.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { PostSettingsMetabox } from "@/components/admin/PostSettingsMetabox";
import { PostGeneralOverview } from "@/components/admin/PostGeneralOverview";
import { SeoPanel } from "@/components/admin/seo/SeoPanel";
import { InternalLinkSuggestions } from "@/components/admin/seo/InternalLinkSuggestions";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";
import { PostDetailsNav, type DetailsTab } from "./PostDetailsNav";
import { TakeawaysSection } from "./TakeawaysSection";
import { AudioSection } from "./AudioSection";
import { CustomMetaSection } from "./CustomMetaSection";
import { RelatedSection } from "./RelatedSection";
import { PostTaxonomyGrid } from "./PostTaxonomyGrid";
import { PostSidebarBundle } from "./PostSidebarBundle";
import type { AutoReadMinutes } from "../types";
import type { InlineTaxonomyApi, PostEditorData, PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function PostDetailsPanel({
  formApi,
  data,
  routeSlug,
  uiLang,
  autoReadMinutes,
  taxonomy,
  layoutCard,
  detailsTab,
  onDetailsTabChange,
  onGoToContent,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  routeSlug: string;
  uiLang: string;
  autoReadMinutes: AutoReadMinutes;
  taxonomy: InlineTaxonomyApi;
  layoutCard: ReactNode;
  detailsTab: DetailsTab;
  onDetailsTabChange: (tab: DetailsTab) => void;
  onGoToContent: () => void;
}) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <PostDetailsNav active={detailsTab} onSelect={onDetailsTabChange} />
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
              postFormat={form.post_format ?? "standard"}
              layoutOverrides={form.layout_overrides}
              selectedCatNames={(data.allCats ?? [])
                .filter((c) => formApi.selectedCats.includes(c.id))
                .map((c) => (uiLang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en))}
              selectedTagNames={(data.allTags ?? [])
                .filter((tg) => formApi.selectedTags.includes(tg.id))
                .map((tg) => tg.name)}
              onNavigate={(tab) => onDetailsTabChange(tab)}
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
                  data.allCats?.find((c) => formApi.selectedCats.includes(c.id))?.name_pl ?? null
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

          {detailsTab === "access" && <AccessSettingsPane entityType="post" entityId={data.id} />}

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
              onClick={onGoToContent}
              disabled={!form.title_pl.trim() && !form.title_en.trim()}
            >
              {t("adminPostPanes.editor.goToContent")} <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
