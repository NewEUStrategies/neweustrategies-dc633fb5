import { createFileRoute } from "@tanstack/react-router";
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
  const { query, save } = useSettings<Permalinks>("permalinks", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);
  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  const set = <K extends keyof Permalinks>(k: K, v: Permalinks[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Bezpośrednie odnośniki</h2>
      <Field label="Prefiks wpisów" hint="Adresy wpisów: /[prefiks]/slug. Obecnie używamy /post.">
        <Text value={draft.post_base} onChange={(e) => set("post_base", e.target.value)} className="w-48" />
      </Field>
      <Field label="Prefiks stron" hint="Puste = strony pod adresem /slug. Zmiana wymaga aktualizacji route'ów.">
        <Text value={draft.page_base} onChange={(e) => set("page_base", e.target.value)} className="w-48" placeholder="(brak)" />
      </Field>
      <p className="text-xs text-muted-foreground mt-2">
        Zmiana prefiksów to obecnie tylko wartość konfiguracyjna — fizyczne adresy URL są zaszyte w aplikacji.
      </p>
      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
