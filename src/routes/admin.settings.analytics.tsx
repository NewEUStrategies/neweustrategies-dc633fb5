// Admin analytics config. Powers the ConsentScriptInjector.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { defaultAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics/config";

export const Route = createFileRoute("/admin/settings/analytics")({
  component: AnalyticsSettings,
});

function AnalyticsSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<AnalyticsConfig>("analytics", defaultAnalyticsConfig());
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof AnalyticsConfig>(k: K, v: AnalyticsConfig[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-2">
        {t("admin.analytics.title", { defaultValue: "Analityka" })}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("admin.analytics.hint", {
          defaultValue:
            "Skrypty uruchamiają się dopiero gdy użytkownik wyrazi zgodę na kategorię Analityczne.",
        })}
      </p>
      <Field label="Google Analytics 4 (Measurement ID)">
        <Text
          value={draft.ga4_measurement_id}
          onChange={(e) => set("ga4_measurement_id", e.target.value)}
          placeholder="G-XXXXXXXXXX"
        />
      </Field>
      <Field label="Google Tag Manager (Container ID)">
        <Text
          value={draft.gtm_container_id}
          onChange={(e) => set("gtm_container_id", e.target.value)}
          placeholder="GTM-XXXXXXX"
        />
      </Field>
      <Field label="Plausible domain">
        <Text
          value={draft.plausible_domain}
          onChange={(e) => set("plausible_domain", e.target.value)}
          placeholder="example.com"
        />
      </Field>
      <Field label="Plausible script URL">
        <Text
          value={draft.plausible_script_url}
          onChange={(e) => set("plausible_script_url", e.target.value)}
        />
      </Field>
      <Field label={t("admin.analytics.customHead", { defaultValue: "Custom <head> HTML" })}>
        <textarea
          value={draft.custom_head_html}
          onChange={(e) => set("custom_head_html", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </Field>
      <Field label={t("admin.analytics.customBody", { defaultValue: "Custom <body> HTML" })}>
        <textarea
          value={draft.custom_body_html}
          onChange={(e) => set("custom_body_html", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
