// Admin marketing config. Powers ConsentScriptInjector - loads only after
// visitor grants the Marketing category.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { defaultMarketingConfig, type MarketingConfig } from "@/lib/analytics/config";

export const Route = createFileRoute("/admin/settings/marketing")({
  component: MarketingSettings,
});

function MarketingSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<MarketingConfig>("marketing", defaultMarketingConfig());
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof MarketingConfig>(k: K, v: MarketingConfig[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-2">
        {t("admin.marketing.title", { defaultValue: "Marketing" })}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("admin.marketing.hint", {
          defaultValue:
            "Tagi reklamowe uruchamiają się dopiero gdy użytkownik wyrazi zgodę na kategorię Marketingowe.",
        })}
      </p>
      <Field label="Meta (Facebook) Pixel ID">
        <Text
          value={draft.meta_pixel_id}
          onChange={(e) => set("meta_pixel_id", e.target.value)}
          placeholder="1234567890"
        />
      </Field>
      <Field label="LinkedIn Insight Partner ID">
        <Text
          value={draft.linkedin_partner_id}
          onChange={(e) => set("linkedin_partner_id", e.target.value)}
        />
      </Field>
      <Field label="TikTok Pixel ID">
        <Text
          value={draft.tiktok_pixel_id}
          onChange={(e) => set("tiktok_pixel_id", e.target.value)}
        />
      </Field>
      <Field label={t("admin.marketing.customHead", { defaultValue: "Custom <head> HTML" })}>
        <textarea
          value={draft.custom_head_html}
          onChange={(e) => set("custom_head_html", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </Field>
      <Field label={t("admin.marketing.customBody", { defaultValue: "Custom <body> HTML" })}>
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
