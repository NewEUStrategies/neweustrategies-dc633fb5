// Admin "Pixels": Google Ads, Meta, LinkedIn i pozostałe tagi reklamowe. Zasila
// ConsentScriptInjector - nic nie startuje przed zgodą na kategorię Marketing.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Code2 } from "lucide-react";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { adminPageHead } from "@/lib/adminPageHead";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GoogleAdsBrandIcon,
  LinkedInBrandIcon,
  MetaBrandIcon,
} from "@/components/admin/atoms/PixelBrandIcons";
import { defaultMarketingConfig, type MarketingConfig } from "@/lib/analytics/config";
import {
  LINKEDIN_FUNNEL,
  LINKEDIN_GOAL_COUNTING,
  LINKEDIN_GOALS,
  type LinkedInGoal,
} from "@/lib/analytics/linkedinGoals";
import { extractLinkedInConversionId } from "@/lib/analytics/linkedinConversionId";
import { extractXPixelId } from "@/lib/analytics/xPixelId";
import {
  extractGoogleAdsId,
  extractGoogleAdsLabel,
  GOOGLE_ADS_GOAL_COUNTING,
  GOOGLE_ADS_GOALS,
  type GoogleAdsGoal,
} from "@/lib/analytics/googleAdsGoals";
import {
  DEFAULT_PIXELS_TAB,
  parsePixelsTab,
  PIXELS_TABS,
  type PixelsTab,
} from "@/lib/admin/pixelsTabs";

export const Route = createFileRoute("/admin/settings/marketing")({
  validateSearch: (search: Record<string, unknown>): { tab?: PixelsTab } => {
    const tab = parsePixelsTab(search["tab"]);
    return tab ? { tab } : {};
  },
  head: () =>
    adminPageHead(
      "Pixels - Google Ads, Meta, LinkedIn, X i pozostałe tagi - Ustawienia",
      "Tag i konwersje Google Ads, Meta Pixel, LinkedIn Insight z konwersjami ułożonymi według lejka LinkedIn Ads, piksel X Ads, TikTok i własne tagi uruchamiane po zgodzie marketingowej. Panel administracyjny New European Strategies.",
    ),
  component: PixelsSettings,
});

const textareaClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono";

function PixelsSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { tab } = Route.useSearch();
  const activeTab = tab ?? DEFAULT_PIXELS_TAB;
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
  const setAdsLabel = (goal: GoogleAdsGoal, raw: string) =>
    setDraft({
      ...draft,
      google_ads_conversions: { ...draft.google_ads_conversions, [goal]: raw },
    });
  const invalidAdsGoals = GOOGLE_ADS_GOALS.filter((goal) => {
    const raw = draft.google_ads_conversions[goal].trim();
    return raw !== "" && extractGoogleAdsLabel(raw) === "";
  });
  const xPixelInvalid = draft.x_pixel_id.trim() !== "" && extractXPixelId(draft.x_pixel_id) === "";
  const adsIdInvalid =
    draft.google_ads_id.trim() !== "" && extractGoogleAdsId(draft.google_ads_id) === "";
  const normalizedDraft = (): MarketingConfig => {
    const google_ads_conversions = { ...draft.google_ads_conversions };
    for (const goal of GOOGLE_ADS_GOALS) {
      const label = extractGoogleAdsLabel(google_ads_conversions[goal]);
      if (label) google_ads_conversions[goal] = label;
    }
    const google_ads_id = extractGoogleAdsId(draft.google_ads_id) || draft.google_ads_id;
    const linkedin_conversions = { ...draft.linkedin_conversions };
    for (const goal of LINKEDIN_GOALS) {
      // Rozpoznany wpis zapisujemy jako sam numer; nierozpoznany zostaje, jak
      // go wpisano (z ostrzeżeniem), a schemat ustawień i tak go pomija.
      const id = extractLinkedInConversionId(linkedin_conversions[goal]);
      if (id) linkedin_conversions[goal] = id;
    }
    const x_pixel_id = extractXPixelId(draft.x_pixel_id) || draft.x_pixel_id;
    return { ...draft, google_ads_id, google_ads_conversions, linkedin_conversions, x_pixel_id };
  };
  const tabIcon: Record<PixelsTab, ReactNode> = {
    google: <GoogleAdsBrandIcon className="mr-2 h-3.5 w-3.5" />,
    meta: <MetaBrandIcon className="mr-2 h-3.5 w-3.5" />,
    linkedin: <LinkedInBrandIcon className="mr-2 h-3.5 w-3.5" />,
    other: <Code2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />,
  };

  return (
    <div>
      <h2 className="font-display text-xl mb-2">{t("admin.marketing.title")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{t("admin.marketing.hint")}</p>
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = parsePixelsTab(value);
          if (next) void navigate({ search: { tab: next }, replace: true });
        }}
      >
        <TabsList className="mb-5">
          {PIXELS_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {tabIcon[id]}
              {t(`admin.marketing.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="google">
          <p className="text-sm text-muted-foreground mb-4">
            {t("admin.marketing.google.accountHint")}
          </p>
          <Field
            label={t("admin.marketing.google.adsId")}
            hint={t("admin.marketing.google.adsIdHint")}
            htmlFor="pixels-google-ads-id"
          >
            <Text
              id="pixels-google-ads-id"
              value={draft.google_ads_id}
              onChange={(e) => set("google_ads_id", e.target.value)}
              placeholder="AW-123456789"
              aria-invalid={adsIdInvalid}
            />
            {adsIdInvalid ? (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {t("admin.marketing.google.invalidId")}
              </p>
            ) : null}
          </Field>
          <fieldset className="mb-4 rounded-md border border-border p-4">
            <legend className="px-1 font-display text-base">
              {t("admin.marketing.google.conversionsTitle")}
            </legend>
            <p className="text-sm text-muted-foreground mb-4">
              {t("admin.marketing.google.conversionsHint")}
            </p>
            {GOOGLE_ADS_GOALS.map((goal) => (
              <Field
                key={goal}
                label={t(`admin.marketing.google.goals.${goal}`)}
                hint={t("admin.marketing.google.countingLabel", {
                  counting: t(`admin.marketing.google.counting.${GOOGLE_ADS_GOAL_COUNTING[goal]}`),
                })}
                htmlFor={`pixels-gads-${goal}`}
              >
                <Text
                  id={`pixels-gads-${goal}`}
                  value={draft.google_ads_conversions[goal]}
                  onChange={(e) => setAdsLabel(goal, e.target.value)}
                  placeholder="AbCdEfGh123"
                  aria-invalid={invalidAdsGoals.includes(goal)}
                />
                {invalidAdsGoals.includes(goal) ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {t("admin.marketing.google.invalid")}
                  </p>
                ) : null}
              </Field>
            ))}
          </fieldset>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("admin.marketing.google.otherHint")}{" "}
            <Link to="/admin/settings/analytics" className="text-brand-ink underline">
              {t("admin.marketing.other.googleLink")}
            </Link>
          </p>
        </TabsContent>

        <TabsContent value="meta">
          <Field
            label={t("admin.marketing.meta.pixelId")}
            hint={t("admin.marketing.meta.hint")}
            htmlFor="pixels-meta-id"
          >
            <Text
              id="pixels-meta-id"
              value={draft.meta_pixel_id}
              onChange={(e) => set("meta_pixel_id", e.target.value)}
              placeholder="1234567890"
              inputMode="numeric"
            />
          </Field>
          <section className="mb-4 rounded-md border border-border p-4">
            <h3 className="font-display text-base mb-1">{t("admin.marketing.meta.eventsTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("admin.marketing.meta.events")}</p>
          </section>
        </TabsContent>

        <TabsContent value="linkedin">
          <Field label={t("admin.marketing.linkedin.partnerId")} htmlFor="pixels-linkedin-id">
            <Text
              id="pixels-linkedin-id"
              value={draft.linkedin_partner_id}
              onChange={(e) => set("linkedin_partner_id", e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <p className="text-sm text-muted-foreground mb-4">
            {t("admin.marketing.linkedinConversions.hint")}
          </p>
          {LINKEDIN_FUNNEL.map((group) => (
            <fieldset key={group.stage} className="mb-4 rounded-md border border-border p-4">
              <legend className="px-1 font-display text-base">
                {t(`admin.marketing.linkedinConversions.stages.${group.stage}`)}
              </legend>
              {group.goals.map((goal) => (
                <Field
                  key={goal}
                  label={t(`admin.marketing.linkedinConversions.goals.${goal}`)}
                  hint={t("admin.marketing.linkedinConversions.categoryLabel", {
                    category: t(`admin.marketing.linkedinConversions.categories.${goal}`),
                    counting: t(
                      `admin.marketing.linkedinConversions.counting.${LINKEDIN_GOAL_COUNTING[goal]}`,
                    ),
                  })}
                  htmlFor={`pixels-li-${goal}`}
                >
                  <Text
                    id={`pixels-li-${goal}`}
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
              {group.stage === "bottom" ? (
                <p className="text-xs text-muted-foreground">
                  {t("admin.marketing.linkedinConversions.qualifiedNote")}
                </p>
              ) : null}
            </fieldset>
          ))}
        </TabsContent>

        <TabsContent value="other">
          <Field label={t("admin.marketing.other.x")} htmlFor="pixels-x-id">
            <Text
              id="pixels-x-id"
              value={draft.x_pixel_id}
              onChange={(e) => set("x_pixel_id", e.target.value)}
              placeholder="rjppz"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={xPixelInvalid}
              aria-describedby="pixels-x-hint"
            />
            <p id="pixels-x-hint" className="mt-1 text-xs text-muted-foreground">
              {t("admin.marketing.other.xHint")}
            </p>
            {xPixelInvalid ? (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {t("admin.marketing.other.xInvalid")}
              </p>
            ) : null}
          </Field>
          <Field label={t("admin.marketing.other.tiktok")} htmlFor="pixels-tiktok-id">
            <Text
              id="pixels-tiktok-id"
              value={draft.tiktok_pixel_id}
              onChange={(e) => set("tiktok_pixel_id", e.target.value)}
            />
          </Field>
          <Field label={t("admin.marketing.customHead")} htmlFor="pixels-custom-head">
            <textarea
              id="pixels-custom-head"
              value={draft.custom_head_html}
              onChange={(e) => set("custom_head_html", e.target.value)}
              rows={5}
              className={textareaClass}
            />
          </Field>
          <Field label={t("admin.marketing.customBody")} htmlFor="pixels-custom-body">
            <textarea
              id="pixels-custom-body"
              value={draft.custom_body_html}
              onChange={(e) => set("custom_body_html", e.target.value)}
              rows={5}
              className={textareaClass}
            />
          </Field>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("admin.marketing.other.googleHint")}{" "}
            <Link to="/admin/settings/analytics" className="text-brand-ink underline">
              {t("admin.marketing.other.googleLink")}
            </Link>
          </p>
        </TabsContent>
      </Tabs>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(normalizedDraft())} />
    </div>
  );
}
