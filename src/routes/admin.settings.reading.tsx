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
import { TtsVoiceSelect } from "@/components/admin/atoms/TtsVoiceSelect";
import { DEFAULT_TTS_SETTINGS, TTS_MODELS, findTtsModel } from "@/lib/audio/ttsCanonical";

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
  // Kanoniczny lektor AI (TTS) tego najemcy. Czyta to serwerowa ścieżka
  // /api/public/post-tts (lib/server/tts.server.ts) - allowlisty i wartości
  // domyślne pochodzą z lib/audio/ttsCanonical.ts, więc panel, endpoint i
  // CHECK-i w bazie nie mogą się rozjechać. Czytelnik NIE wybiera głosu:
  // na (wpis, język) istnieje dokładnie jedno nagranie.
  tts_voice_pl: string;
  tts_voice_en: string;
  tts_model: string;
};

const DEFAULTS: Reading = {
  posts_per_page: 10,
  homepage_mode: "latest_posts",
  homepage_page_slug: "",
  search_engine_visibility: true,
  reading_mode_ads: true,
  max_ad_zones_free: 2,
  max_ad_zones_paid: 1,
  ...DEFAULT_TTS_SETTINGS,
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

      <Field
        label={t("admin.reading.homepageShows")}
        hint={
          draft.homepage_mode === "latest_posts" ? t("admin.reading.latestPostsHint") : undefined
        }
      >
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

      <h3 className="font-display text-lg mt-8 mb-1">{t("admin.reading.ttsTitle")}</h3>
      <p className="text-xs text-muted-foreground mb-4">{t("admin.reading.ttsHint")}</p>
      <Field label={t("admin.reading.ttsVoicePl")} hint={t("admin.reading.ttsVoicePlHint")}>
        <TtsVoiceSelect
          value={draft.tts_voice_pl}
          onChange={(v) => set("tts_voice_pl", v)}
          ariaLabel={t("admin.reading.ttsVoicePl")}
        />
      </Field>
      <Field label={t("admin.reading.ttsVoiceEn")} hint={t("admin.reading.ttsVoiceEnHint")}>
        <TtsVoiceSelect
          value={draft.tts_voice_en}
          onChange={(v) => set("tts_voice_en", v)}
          ariaLabel={t("admin.reading.ttsVoiceEn")}
        />
      </Field>
      <Field
        label={t("admin.reading.ttsModel")}
        hint={t("admin.reading.ttsModelHint", {
          tier: t(`admin.reading.ttsModelTier.${findTtsModel(draft.tts_model)?.tier ?? "quality"}`),
        })}
      >
        <Select
          value={draft.tts_model}
          onChange={(e) => set("tts_model", e.target.value)}
          aria-label={t("admin.reading.ttsModel")}
        >
          {TTS_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {`${t(`admin.reading.ttsModelTier.${m.tier}`)} - ${m.id}`}
            </option>
          ))}
        </Select>
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
