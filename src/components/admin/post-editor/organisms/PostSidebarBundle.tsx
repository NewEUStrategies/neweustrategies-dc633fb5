// Organizm: zestaw kart dokumentu - zakładka "Publikacja" (scope="publish")
// oraz panel dokumentu edytora bloków (scope="document" - superset z layoutem,
// taksonomią, dostępem i rewizjami). Kolejność kart identyczna jak przed
// rozbiciem monolitu.
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Layers } from "@/lib/lucide-shim";
import { History, ListChecks, Eye } from "lucide-react";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";
import { SidebarSection } from "../atoms";
import { PublishChecklistCard, SeriesCard, PreviewLinksCard, ChangelogCard } from "../molecules";
import { PostSettingsCard } from "./PostSettingsCard";
import { PostTranslateCard } from "./PostTranslateCard";
import { PostTaxonomyGrid } from "./PostTaxonomyGrid";
import type { AutoReadMinutes } from "../types";
import type { InlineTaxonomyApi, PostEditorData, PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

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
  autoReadMinutes: AutoReadMinutes;
  taxonomy: InlineTaxonomyApi;
  /** Karta layoutu budowana w trasie (dzieli ov/currentFormat z canvasWrap). */
  layoutCard?: ReactNode;
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
