import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelatedPostsAnalytics } from "@/components/admin/analytics/RelatedPostsAnalytics";
import { RelatedPostsConfigSection } from "@/components/admin/postExperience/molecules/RelatedPostsConfigSection";
import { RelatedPostsEngineSection } from "@/components/admin/postExperience/molecules/RelatedPostsEngineSection";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import {
  relatedPostsAdminConfigQueryOptions,
  useSaveRelatedPostsConfig,
} from "@/lib/relatedPosts/adminConfig";
import { saveFailureKey } from "@/lib/relatedPosts/panelRules";
import { RelatedPostsSaveError } from "@/lib/relatedPosts/settings";
import { ensureI18n } from "@/lib/i18n-admin-related-posts";

/**
 * Organizm: panel konfiguracji i analityki silnika rekomendacji.
 *
 * ZAPIS idzie wyłącznie przez `useSaveRelatedPostsConfig`, czyli upsert z jawnym
 * `tenant_id` i POTWIERDZENIEM zapisanego wiersza. Wcześniejsza implementacja
 * robiła `update(next).neq("tenant_id", zero-uuid)` - UPDATE bez dopasowania
 * jest dla PostgREST sukcesem, więc obszar roboczy bez zasianego wiersza
 * widział „Zapisano" przy zerowej zmianie. Szczegóły w nagłówku
 * `lib/relatedPosts/settings`.
 */
export function RelatedPostsSettingsPanel() {
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
          toast.error(t(saveFailureKey(error.reason), { msg: error.cause ?? error.message }));
          return;
        }
        toast.error(t("adminRelatedPosts.toast.writeFailed", { msg: error.message }));
      },
    });
  };

  const set = <K extends keyof RelatedPostsConfig>(k: K, v: RelatedPostsConfig[K]): void => {
    setForm((s) => ({ ...s, [k]: v }));
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl">{t("adminRelatedPosts.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminRelatedPosts.intro")}</p>
      </header>

      <Tabs defaultValue="config">
        <TabsList aria-label={t("adminRelatedPosts.pageTitle")}>
          <TabsTrigger value="config">{t("adminRelatedPosts.tabs.config")}</TabsTrigger>
          <TabsTrigger value="engine">{t("adminRelatedPosts.tabs.engine")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("adminRelatedPosts.tabs.analytics")}</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          <RelatedPostsConfigSection
            form={form}
            onChange={set}
            onSave={onSave}
            pending={save.isPending}
          />
        </TabsContent>

        <TabsContent value="engine" className="mt-4">
          <RelatedPostsEngineSection
            form={form}
            onChange={set}
            onSave={onSave}
            pending={save.isPending}
          />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <RelatedPostsAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}
