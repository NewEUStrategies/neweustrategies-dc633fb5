import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";

type Permalinks = {
  post_base: string;
  page_base: string;
};

const DEFAULTS: Permalinks = { post_base: "post", page_base: "" };

export const Route = createFileRoute("/admin/settings/permalinks")({
  component: PermalinksSettings,
});

function PermalinksSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<Permalinks>("permalinks", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Permalinks>(k: K, v: Permalinks[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.permalinks.title")}</h2>
      <Field label={t("admin.permalinks.postBase")} hint={t("admin.permalinks.postBaseHint")}>
        <Text
          value={draft.post_base}
          onChange={(e) => set("post_base", e.target.value)}
          className="w-48"
        />
      </Field>
      <Field label={t("admin.permalinks.pageBase")} hint={t("admin.permalinks.pageBaseHint")}>
        <Text
          value={draft.page_base}
          onChange={(e) => set("page_base", e.target.value)}
          className="w-48"
          placeholder={t("admin.permalinks.pageBasePlaceholder")}
        />
      </Field>
      <p className="text-xs text-muted-foreground mt-2">{t("admin.permalinks.note")}</p>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
