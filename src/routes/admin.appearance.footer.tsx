import { createFileRoute } from "@tanstack/react-router";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { Plus, Trash2 } from "@/lib/lucide-shim";

type FooterColumn = {
  title_pl: string;
  title_en: string;
  links: { label_pl: string; label_en: string; url: string }[];
};

type FooterSettings = {
  mission_pl: string;
  mission_en: string;
  contact_email: string;
  contact_phone: string;
  contact_address: string;
  columns: FooterColumn[];
  copyright_pl: string;
  copyright_en: string;
};

const DEFAULTS: FooterSettings = {
  mission_pl: "",
  mission_en: "",
  contact_email: "",
  contact_phone: "",
  contact_address: "",
  columns: [
    { title_pl: "Poznaj nas", title_en: "Know us", links: [] },
    { title_pl: "Współpraca", title_en: "Work with us", links: [] },
  ],
  copyright_pl: "Wszelkie prawa zastrzeżone",
  copyright_en: "All rights reserved",
};

export const Route = createFileRoute("/admin/appearance/footer")({
  component: FooterEditor,
});

function FooterEditor() {
  const { query, save } = useSettings<FooterSettings>("footer", DEFAULTS);
  const [draft, setDraft] = useDraft(query.data);

  if (!draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const set = <K extends keyof FooterSettings>(k: K, v: FooterSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  const updateCol = (i: number, patch: Partial<FooterColumn>) => {
    const cols = [...draft.columns];
    cols[i] = { ...cols[i], ...patch };
    set("columns", cols);
  };

  const addCol = () => set("columns", [...draft.columns, { title_pl: "Nowa kolumna", title_en: "New column", links: [] }]);
  const removeCol = (i: number) => set("columns", draft.columns.filter((_, idx) => idx !== i));

  return (
    <div>
      <h2 className="font-display text-xl mb-4">Stopka</h2>

      <Field label="Misja (PL)"><Text value={draft.mission_pl} onChange={(e) => set("mission_pl", e.target.value)} /></Field>
      <Field label="Misja (EN)"><Text value={draft.mission_en} onChange={(e) => set("mission_en", e.target.value)} /></Field>
      <Field label="E-mail"><Text value={draft.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></Field>
      <Field label="Telefon"><Text value={draft.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
      <Field label="Adres"><Text value={draft.contact_address} onChange={(e) => set("contact_address", e.target.value)} /></Field>

      <div className="py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Kolumny linków</h3>
          <button onClick={addCol} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted">
            <Plus className="w-3 h-3" /> Dodaj kolumnę
          </button>
        </div>
        <div className="space-y-4">
          {draft.columns.map((col, i) => (
            <div key={i} className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Text className="flex-1" placeholder="Tytuł PL" value={col.title_pl} onChange={(e) => updateCol(i, { title_pl: e.target.value })} />
                <Text className="flex-1" placeholder="Tytuł EN" value={col.title_en} onChange={(e) => updateCol(i, { title_en: e.target.value })} />
                <button onClick={() => removeCol(i)} className="p-2 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
              {col.links.map((link, j) => (
                <div key={j} className="flex items-center gap-2 pl-4">
                  <Text className="flex-1" placeholder="Etykieta PL" value={link.label_pl} onChange={(e) => {
                    const links = [...col.links]; links[j] = { ...link, label_pl: e.target.value }; updateCol(i, { links });
                  }} />
                  <Text className="flex-1" placeholder="Etykieta EN" value={link.label_en} onChange={(e) => {
                    const links = [...col.links]; links[j] = { ...link, label_en: e.target.value }; updateCol(i, { links });
                  }} />
                  <Text className="flex-1" placeholder="URL" value={link.url} onChange={(e) => {
                    const links = [...col.links]; links[j] = { ...link, url: e.target.value }; updateCol(i, { links });
                  }} />
                  <button onClick={() => updateCol(i, { links: col.links.filter((_, k) => k !== j) })} className="p-2 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={() => updateCol(i, { links: [...col.links, { label_pl: "", label_en: "", url: "" }] })}
                className="ml-4 text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted">
                <Plus className="w-3 h-3" /> Dodaj link
              </button>
            </div>
          ))}
        </div>
      </div>

      <Field label="Copyright (PL)"><Text value={draft.copyright_pl} onChange={(e) => set("copyright_pl", e.target.value)} /></Field>
      <Field label="Copyright (EN)"><Text value={draft.copyright_en} onChange={(e) => set("copyright_en", e.target.value)} /></Field>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
