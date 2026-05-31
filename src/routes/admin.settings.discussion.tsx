import { createFileRoute } from "@tanstack/react-router";
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
  const { query, save } = useSettings<Discussion>("discussion", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  const set = <K extends keyof Discussion>(k: K, v: Discussion[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Dyskusja</h2>
      <Field label="Komentarze">
        <Checkbox label="Zezwalaj na komentarze pod wpisami" checked={draft.allow_comments} onChange={(v) => set("allow_comments", v)} />
      </Field>
      <Field label="Wymagaj zalogowania">
        <Checkbox label="Tylko zalogowani użytkownicy mogą komentować" checked={draft.require_login_to_comment} onChange={(v) => set("require_login_to_comment", v)} />
      </Field>
      <Field label="Moderacja">
        <Checkbox label="Nowe komentarze wymagają zatwierdzenia" checked={draft.moderate_new_comments} onChange={(v) => set("moderate_new_comments", v)} />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
