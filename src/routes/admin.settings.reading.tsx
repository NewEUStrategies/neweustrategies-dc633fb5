import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import {
  Field,
  Text,
  NumberInput,
  Select,
  Checkbox,
  SaveBar,
} from "@/components/admin/settings/fields";

type Reading = {
  posts_per_page: number;
  homepage_mode: "latest_posts" | "static_page";
  homepage_page_slug: string;
  search_engine_visibility: boolean;
  // Tryb czytania artykułu: między-strefowy budżet reklam (czyta go
  // useReadingAdBudget na stronie publicznej). Wartości domyślne muszą być
  // spójne z READING_AD_DEFAULTS w src/lib/ads/readingMode.ts.
  reading_mode_ads: boolean;
  max_ad_zones_free: number;
  max_ad_zones_paid: number;
};

const DEFAULTS: Reading = {
  posts_per_page: 10,
  homepage_mode: "latest_posts",
  homepage_page_slug: "",
  search_engine_visibility: true,
  reading_mode_ads: true,
  max_ad_zones_free: 2,
  max_ad_zones_paid: 1,
};

export const Route = createFileRoute("/admin/settings/reading")({
  component: ReadingSettings,
});

function ReadingSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<Reading>("reading", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Reading>(k: K, v: Reading[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.reading.title")}</h2>

      <Field label={t("admin.reading.homepageShows")}>
        <Select
          value={draft.homepage_mode}
          onChange={(e) => set("homepage_mode", e.target.value as Reading["homepage_mode"])}
        >
          <option value="latest_posts">{t("admin.reading.latestPosts")}</option>
          <option value="static_page">{t("admin.reading.staticPage")}</option>
        </Select>
      </Field>
      {draft.homepage_mode === "static_page" && (
        <Field label={t("admin.reading.homepageSlug")} hint={t("admin.reading.homepageSlugHint")}>
          <Text
            value={draft.homepage_page_slug}
            onChange={(e) => set("homepage_page_slug", e.target.value)}
            placeholder="o-nas"
          />
        </Field>
      )}
      <Field label={t("admin.reading.postsPerPage")}>
        <NumberInput
          min={1}
          max={100}
          value={draft.posts_per_page}
          onChange={(e) => set("posts_per_page", Number(e.target.value))}
        />
      </Field>
      <Field
        label={t("admin.reading.searchVisibility")}
        hint={t("admin.reading.searchVisibilityHint")}
      >
        <Checkbox
          label={t("admin.reading.allowIndexing")}
          checked={draft.search_engine_visibility}
          onChange={(v) => set("search_engine_visibility", v)}
        />
      </Field>

      <h3 className="font-display text-lg mt-8 mb-1">{t("admin.reading.readingModeTitle")}</h3>
      <p className="text-xs text-muted-foreground mb-4">{t("admin.reading.readingModeHint")}</p>
      <Field label={t("admin.reading.readingModeTitle")}>
        <Checkbox
          label={t("admin.reading.readingModeAds")}
          checked={draft.reading_mode_ads}
          onChange={(v) => set("reading_mode_ads", v)}
        />
      </Field>
      {draft.reading_mode_ads && (
        <>
          <Field label={t("admin.reading.maxAdZonesFree")}>
            <NumberInput
              min={0}
              max={8}
              value={draft.max_ad_zones_free}
              onChange={(e) => set("max_ad_zones_free", Number(e.target.value))}
            />
          </Field>
          <Field
            label={t("admin.reading.maxAdZonesPaid")}
            hint={t("admin.reading.maxAdZonesPaidHint")}
          >
            <NumberInput
              min={0}
              max={8}
              value={draft.max_ad_zones_paid}
              onChange={(e) => set("max_ad_zones_paid", Number(e.target.value))}
            />
          </Field>
        </>
      )}

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
