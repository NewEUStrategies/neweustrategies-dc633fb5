import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, NumberInput, Select, Checkbox, SaveBar } from "@/components/admin/settings/fields";

type Reading = {
  posts_per_page: number;
  homepage_mode: "latest_posts" | "static_page";
  homepage_page_slug: string;
  search_engine_visibility: boolean;
};

const DEFAULTS: Reading = {
  posts_per_page: 10,
  homepage_mode: "latest_posts",
  homepage_page_slug: "",
  search_engine_visibility: true,
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
        <Select value={draft.homepage_mode} onChange={(e) => set("homepage_mode", e.target.value as Reading["homepage_mode"])}>
          <option value="latest_posts">{t("admin.reading.latestPosts")}</option>
          <option value="static_page">{t("admin.reading.staticPage")}</option>
        </Select>
      </Field>
      {draft.homepage_mode === "static_page" && (
        <Field label={t("admin.reading.homepageSlug")} hint={t("admin.reading.homepageSlugHint")}>
          <Text value={draft.homepage_page_slug} onChange={(e) => set("homepage_page_slug", e.target.value)} placeholder="o-nas" />
        </Field>
      )}
      <Field label={t("admin.reading.postsPerPage")}>
        <NumberInput min={1} max={100} value={draft.posts_per_page} onChange={(e) => set("posts_per_page", Number(e.target.value))} />
      </Field>
      <Field label={t("admin.reading.searchVisibility")} hint={t("admin.reading.searchVisibilityHint")}>
        <Checkbox
          label={t("admin.reading.allowIndexing")}
          checked={draft.search_engine_visibility}
          onChange={(v) => set("search_engine_visibility", v)}
        />
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
