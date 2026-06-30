// Left-panel widget library: searchable grid of widgets grouped by category,
// plus a structure picker to add a new section, plus a saved-section template list.
import { useState } from "react";
import { Search, Layers, Trash2, Save, Clock, ChevronDown, ChevronRight } from "@/lib/lucide-shim";
import { WIDGETS } from "@/lib/builder/registry";
import type { WidgetType } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { useSectionTemplates, type SectionTemplate, type TemplateRevision } from "@/lib/builder/templates";
import { TemplateHistoryDialog } from "./TemplateHistoryDialog";
import { StructurePicker } from "./StructurePicker";

interface Props {
  onPickWidget: (t: WidgetType) => void;
  onPickStructure: (spans: number[]) => void;
  onPickTemplate: (tpl: SectionTemplate) => void;
}

export function WidgetLibrary({ onPickStructure, onPickTemplate }: Props) {
  const [search, setSearch] = useState("");
  const [historyOf, setHistoryOf] = useState<SectionTemplate | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("builder.lib.collapsed") || "{}"); } catch { return {}; }
  });
  const toggle = (key: string) => {
    setCollapsed((p) => {
      const next = { ...p, [key]: !p[key] };
      try { localStorage.setItem("builder.lib.collapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const filtered = WIDGETS.filter((w) => !w.hiddenInPalette && w.label.toLowerCase().includes(search.toLowerCase()));
  const labels: Record<string, string> = {
    basic: "Podstawowe", media: "Media", dynamic: "Dynamiczne",
    form: "Formularze", navigation: "Nawigacja", blocks: "Bloki",
  };
  const tpl = useSectionTemplates();

  const restoreToTemplate = async (rev: TemplateRevision) => {
    await tpl.update(rev.template_id, { section: rev.data, name: rev.name });
    setHistoryOf(null);
  };
  const insertRevision = (rev: TemplateRevision) => {
    onPickTemplate({
      id: rev.template_id,
      name: rev.name,
      data: rev.data,
      created_at: rev.created_at,
      created_by: rev.created_by,
    });
    setHistoryOf(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-2">
        <h3 className="text-sm font-medium inline-flex items-center gap-2">
          <Layers className="w-4 h-4" /> Widgety
        </h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj widgetu..."
            className="pl-7 h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <section>
          <button type="button" onClick={() => toggle("__struct")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1 hover:text-foreground">
            {collapsed.__struct ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Nowa sekcja - wybierz strukturę
          </button>
          {!collapsed.__struct && <StructurePicker onPick={onPickStructure} cols={2} />}
        </section>

        <section>
          <button type="button" onClick={() => toggle("__tpl")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1.5 hover:text-foreground">
            {collapsed.__tpl ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <Save className="w-3.5 h-3.5" /> Szablony sekcji
            {tpl.loading && <span className="text-[10px] normal-case">…</span>}
          </button>
          {!collapsed.__tpl && (tpl.items.length === 0 ? (
            <div className="text-[10px] text-muted-foreground px-2 py-3 border border-dashed border-border rounded">
              Brak zapisanych. Zaznacz sekcję na canvasie i kliknij ikonę zapisu.
            </div>
          ) : (
            <ul className="space-y-1">
              {tpl.items.map((t) => (
                <li key={t.id} className="flex items-center gap-1 group/tpl">
                  <button type="button" onClick={() => onPickTemplate(t)}
                    className="flex-1 text-left text-xs px-2 py-1.5 bg-muted/30 hover:bg-brand hover:text-brand-foreground border border-border rounded truncate">
                    {t.name}
                  </button>
                  <button type="button" title="Historia wersji" onClick={() => setHistoryOf(t)}
                    className="p-1 text-muted-foreground hover:text-brand opacity-0 group-hover/tpl:opacity-100 transition">
                    <Clock className="w-3 h-3" />
                  </button>
                  <button type="button" title="Usuń szablon" onClick={() => { if (confirm(`Usunąć szablon "${t.name}"?`)) void tpl.remove(t.id); }}
                    className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover/tpl:opacity-100 transition">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </section>

        {(["basic", "blocks", "media", "dynamic", "form", "navigation"] as const).map((cat) => {
          const items = filtered.filter((w) => w.category === cat);
          if (!items.length) return null;
          const isCollapsed = !!collapsed[cat];
          return (
            <section key={cat}>
              <button type="button" onClick={() => toggle(cat)}
                className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1 hover:text-foreground">
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {labels[cat]}
                <span className="ml-1 text-[10px] normal-case opacity-60">({items.length})</span>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((w) => {
                    const Icon = w.icon;
                    return (
                      <div
                        key={w.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-widget-type", w.type);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className="h-16 bg-muted/30 hover:bg-brand/10 hover:border-brand border border-border rounded flex flex-col items-center justify-center gap-0.5 p-1 transition group cursor-grab active:cursor-grabbing select-none"
                        title={`Przeciągnij na sekcję: ${w.label}`}
                      >
                        <Icon className="w-4 h-4 text-brand group-hover:text-brand" />
                        <span className="text-[9px] text-center leading-tight text-foreground group-hover:text-brand">{w.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <TemplateHistoryDialog
        template={historyOf}
        open={!!historyOf}
        onOpenChange={(o) => { if (!o) setHistoryOf(null); }}
        onInsert={insertRevision}
        onRestore={(r) => { void restoreToTemplate(r); }}
      />
    </div>
  );
}
