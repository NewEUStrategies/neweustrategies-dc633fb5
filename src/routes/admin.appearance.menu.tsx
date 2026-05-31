import { createFileRoute } from "@tanstack/react-router";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Text, SaveBar } from "@/components/admin/settings/fields";
import { Plus, Trash2, ChevronUp, ChevronDown } from "@/lib/lucide-shim";

type MenuItem = { label_pl: string; label_en: string; url: string };
type MenuSettings = { items: MenuItem[] };

const DEFAULTS: MenuSettings = {
  items: [
    { label_pl: "Analizy", label_en: "Analyses", url: "/analyses" },
    { label_pl: "Wywiady", label_en: "Interviews", url: "/interviews" },
    { label_pl: "O nas", label_en: "About", url: "/about" },
  ],
};

export const Route = createFileRoute("/admin/appearance/menu")({
  component: MenuEditor,
});

function MenuEditor() {
  const { query, save } = useSettings<MenuSettings>("menu_primary", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const update = (i: number, patch: Partial<MenuItem>) => {
    const items = [...draft.items];
    items[i] = { ...items[i], ...patch };
    setDraft({ items });
  };
  const add = () => setDraft({ items: [...draft.items, { label_pl: "", label_en: "", url: "/" }] });
  const remove = (i: number) => setDraft({ items: draft.items.filter((_, idx) => idx !== i) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.items.length) return;
    const items = [...draft.items];
    [items[i], items[j]] = [items[j], items[i]];
    setDraft({ items });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl">Menu główne</h2>
        <button onClick={add} className="text-sm inline-flex items-center gap-1 px-3 py-2 rounded-md border border-border hover:bg-muted">
          <Plus className="w-4 h-4" /> Dodaj pozycję
        </button>
      </div>

      <div className="space-y-2">
        {draft.items.map((item, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-2 border border-border rounded-md p-2">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} className="p-1 hover:bg-muted rounded"><ChevronUp className="w-3 h-3" /></button>
              <button onClick={() => move(i, 1)} className="p-1 hover:bg-muted rounded"><ChevronDown className="w-3 h-3" /></button>
            </div>
            <Text placeholder="Etykieta PL" value={item.label_pl} onChange={(e) => update(i, { label_pl: e.target.value })} />
            <Text placeholder="Etykieta EN" value={item.label_en} onChange={(e) => update(i, { label_en: e.target.value })} />
            <Text placeholder="URL (/about)" value={item.url} onChange={(e) => update(i, { url: e.target.value })} />
            <button onClick={() => remove(i)} className="p-2 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {draft.items.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">Brak pozycji. Kliknij „Dodaj pozycję".</p>
        )}
      </div>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
