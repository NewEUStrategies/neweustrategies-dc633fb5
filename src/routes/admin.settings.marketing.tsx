// Admin marketing config. Powers ConsentScriptInjector - loads only after
// visitor grants the Marketing category.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { defaultMarketingConfig, type MarketingConfig } from "@/lib/analytics/config";
import { LINKEDIN_GOALS, type LinkedInGoal } from "@/lib/analytics/linkedinInsightEvents";
import { extractLinkedInConversionId } from "@/lib/analytics/linkedinConversionId";

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
  const setConversion = (goal: LinkedInGoal, raw: string) =>
    setDraft({ ...draft, linkedin_conversions: { ...draft.linkedin_conversions, [goal]: raw } });
  const invalidGoals = LINKEDIN_GOALS.filter((goal) => {
    const raw = draft.linkedin_conversions[goal].trim();
    return raw !== "" && extractLinkedInConversionId(raw) === "";
  });
  const normalizedDraft = (): MarketingConfig => {
    const linkedin_conversions = { ...draft.linkedin_conversions };
    for (const goal of LINKEDIN_GOALS) {
      // Rozpoznany wpis zapisujemy jako sam numer; nierozpoznany zostaje, jak
      // go wpisano (z ostrzeżeniem), a schemat ustawień i tak go pomija.
      const id = extractLinkedInConversionId(linkedin_conversions[goal]);
      if (id) linkedin_conversions[goal] = id;
    }
    return { ...draft, linkedin_conversions };
  };

  return (
    <div>
      <h2 className="font-display text-xl mb-2">{t("admin.marketing.title")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{t("admin.marketing.hint")}</p>
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
      <fieldset className="mb-4 rounded-md border border-border p-4">
        <legend className="px-1 font-display text-base">
          {t("admin.marketing.linkedinConversions.title")}
        </legend>
        <p className="text-sm text-muted-foreground mb-3">
          {t("admin.marketing.linkedinConversions.hint")}
        </p>
        {LINKEDIN_GOALS.map((goal) => (
          <Field key={goal} label={t(`admin.marketing.linkedinConversions.goals.${goal}`)}>
            <Text
              value={draft.linkedin_conversions[goal]}
              onChange={(e) => setConversion(goal, e.target.value)}
              placeholder="12345678"
              inputMode="numeric"
              aria-invalid={invalidGoals.includes(goal)}
            />
            {invalidGoals.includes(goal) ? (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {t("admin.marketing.linkedinConversions.invalid")}
              </p>
            ) : null}
          </Field>
        ))}
      </fieldset>
      <Field label="TikTok Pixel ID">
        <Text
          value={draft.tiktok_pixel_id}
          onChange={(e) => set("tiktok_pixel_id", e.target.value)}
        />
      </Field>
      <Field label={t("admin.marketing.customHead")}>
        <textarea
          value={draft.custom_head_html}
          onChange={(e) => set("custom_head_html", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </Field>
      <Field label={t("admin.marketing.customBody")}>
        <textarea
          value={draft.custom_body_html}
          onChange={(e) => set("custom_body_html", e.target.value)}
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
      </Field>
      <SaveBar
        saving={save.isPending}
        onSave={() => save.mutate(normalizedDraft())}
      />
    </div>
  );
}
