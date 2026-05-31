import { createFileRoute } from "@tanstack/react-router";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, Checkbox, SaveBar } from "@/components/admin/settings/fields";

type Privacy = {
  privacy_page_slug: string;
  cookie_banner: boolean;
};

const DEFAULTS: Privacy = { privacy_page_slug: "", cookie_banner: true };

export const Route = createFileRoute("/admin/settings/privacy")({
  component: PrivacySettings,
});

function PrivacySettings() {
  const { query, save } = useSettings<Privacy>("privacy", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  const set = <K extends keyof Privacy>(k: K, v: Privacy[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Prywatność</h2>
      <Field label="Strona polityki prywatności" hint="Slug istniejącej, opublikowanej strony.">
        <Text value={draft.privacy_page_slug} onChange={(e) => set("privacy_page_slug", e.target.value)} placeholder="polityka-prywatnosci" />
      </Field>
      <Field label="Baner cookie">
        <Checkbox label="Pokazuj baner zgody na pliki cookie" checked={draft.cookie_banner} onChange={(v) => set("cookie_banner", v)} />
      </Field>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
