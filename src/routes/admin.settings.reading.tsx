import { createFileRoute } from "@tanstack/react-router";
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
  const { query, save } = useSettings<Reading>("reading", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  const set = <K extends keyof Reading>(k: K, v: Reading[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Czytanie</h2>

      <Field label="Strona główna pokazuje">
        <Select value={draft.homepage_mode} onChange={(e) => set("homepage_mode", e.target.value as Reading["homepage_mode"])}>
          <option value="latest_posts">Najnowsze wpisy</option>
          <option value="static_page">Statyczną stronę</option>
        </Select>
      </Field>
      {draft.homepage_mode === "static_page" && (
        <Field label="Slug strony głównej" hint="Slug istniejącej, opublikowanej strony.">
          <Text value={draft.homepage_page_slug} onChange={(e) => set("homepage_page_slug", e.target.value)} placeholder="o-nas" />
        </Field>
      )}
      <Field label="Wpisów na stronę bloga">
        <NumberInput min={1} max={100} value={draft.posts_per_page} onChange={(e) => set("posts_per_page", Number(e.target.value))} />
      </Field>
      <Field label="Widoczność dla wyszukiwarek" hint="Wyłącz, aby poprosić wyszukiwarki o nieindeksowanie witryny.">
        <Checkbox
          label="Zezwalaj wyszukiwarkom na indeksowanie"
          checked={draft.search_engine_visibility}
          onChange={(v) => set("search_engine_visibility", v)}
        />
      </Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
