// Edytor wpisu - trasa-orkiestrator (atomic design). Cienki korzeń kompozycji:
//   * dane:       usePostEditorData (RPC get_post_for_edit + taksonomie, w
//                 pełni tenant-scoped - obszar jednej firmy nie widzi danych
//                 innej),
//   * formularz:  usePostEditorForm (undo/redo + autosave + zapisy ze zmianą
//                 statusu + miękka bramka checklisty publikacji),
//   * krok:       usePostEditorStep (details -> content, content-first),
//   * czas czyt.: useBilingualReadingStats (podgląd PL/EN),
//   * layout:     readLayoutOverrides / nextLayoutOverrides / resolvePostFormat
//                 / layoutSetFor (czyste helpery z ./lib),
//   * widok:      PostEditorHeader / PostDetailsPanel / PostContentEditor
//                 (+ PostLayoutCard) z drzewa atoms / molecules / organisms.
// Zachowanie 1:1 z monolitem ~1550 linii - to refactor bez zmian funkcji.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EditPresenceBanner } from "@/components/admin/molecules/EditPresenceBanner";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import type { LayoutOverrides } from "@/lib/postLayouts";
import {
  usePostEditorData,
  usePostEditorForm,
  useInlineTaxonomy,
  usePostEditorStep,
  useBilingualReadingStats,
  readLayoutOverrides,
  nextLayoutOverrides,
  resolvePostFormat,
  layoutSetFor,
  PostEditorHeader,
  PostDetailsPanel,
  PostContentEditor,
  PostLayoutCard,
  type DetailsTab,
} from "@/components/admin/post-editor";
import "@/lib/i18n-admin-post-panes";

export const Route = createFileRoute("/admin/posts/$slug")({
  component: EditPost,
});

function EditPost() {
  const { slug: routeSlug } = Route.useParams();
  const { i18n } = useTranslation();
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

  const { step, setStep } = usePostEditorStep(form);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("general");
  const autoReadMinutes = useBilingualReadingStats(form);

  if (data.isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const ov = readLayoutOverrides(form);
  const setOv = (patch: Partial<LayoutOverrides>) =>
    set("layout_overrides", nextLayoutOverrides(ov, patch));
  const currentFormat = resolvePostFormat(ov, form);
  const layoutSet = layoutSetFor(currentFormat);

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
          <PostDetailsPanel
            formApi={formApi}
            data={data}
            routeSlug={routeSlug}
            uiLang={uiLang}
            autoReadMinutes={autoReadMinutes}
            taxonomy={taxonomy}
            layoutCard={layoutCard}
            detailsTab={detailsTab}
            onDetailsTabChange={setDetailsTab}
            onGoToContent={() => setStep("content")}
          />
        ) : (
          <PostContentEditor
            formApi={formApi}
            data={data}
            routeSlug={routeSlug}
            uiLang={uiLang}
            autoReadMinutes={autoReadMinutes}
            taxonomy={taxonomy}
            globalLayout={globalLayout}
            ov={ov}
            currentFormat={currentFormat}
            layoutCard={layoutCard}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
