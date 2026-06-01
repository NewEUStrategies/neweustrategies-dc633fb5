import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Checkbox, SaveBar } from "@/components/admin/settings/fields";

type Discussion = {
  allow_comments: boolean;
  require_login_to_comment: boolean;
  moderate_new_comments: boolean;
};

const DEFAULTS: Discussion = {
  allow_comments: false,
  require_login_to_comment: true,
  moderate_new_comments: true,
};

export const Route = createFileRoute("/admin/settings/discussion")({
  component: DiscussionSettings,
});

function DiscussionSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<Discussion>("discussion", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;
  const set = <K extends keyof Discussion>(k: K, v: Discussion[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">{t("admin.discussion.title")}</h2>
      <Field label={t("admin.discussion.comments")}>
        <Checkbox label={t("admin.discussion.allowComments")} checked={draft.allow_comments} onChange={(v) => set("allow_comments", v)} />
      </Field>
      <Field label={t("admin.discussion.requireLogin")}>
        <Checkbox label={t("admin.discussion.requireLoginLabel")} checked={draft.require_login_to_comment} onChange={(v) => set("require_login_to_comment", v)} />
      </Field>
      <Field label={t("admin.discussion.moderation")}>
        <Checkbox label={t("admin.discussion.moderateLabel")} checked={draft.moderate_new_comments} onChange={(v) => set("moderate_new_comments", v)} />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
