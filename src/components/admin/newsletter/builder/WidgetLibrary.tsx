// WidgetLibrary - lewy panel buildera. Karty widgetow pogrupowane po `group`
// z registry.ts. Kazda karta jest draggable (kind="library") - drop w kanwie
// dodaje nowy widget przez NewsletterBuilder.onDragEnd. Klikniecie karty
// dodaje widget na koniec (dostepnosc + touch).
import { useDraggable } from "@dnd-kit/core";
import * as Lucide from "lucide-react";
import type { NlWidgetType, NlLang } from "@/lib/newsletter-builder/types";
import { WIDGET_REGISTRY, widgetLabel } from "@/lib/newsletter-builder/registry";

const GROUP_LABEL: Record<string, { pl: string; en: string }> = {
  content: { pl: "Tresc", en: "Content" },
  media: { pl: "Media", en: "Media" },
  layout: { pl: "Uklad", en: "Layout" },
  fields: { pl: "Pola formularza", en: "Form fields" },
  action: { pl: "Akcje", en: "Actions" },
};

export function WidgetLibrary({
  lang,
  onAdd,
}: {
  lang: NlLang;
  onAdd: (type: NlWidgetType) => void;
}) {
  const groups = Object.keys(GROUP_LABEL);
  return (
    <div className="space-y-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {lang === "pl" ? "Biblioteka widgetow" : "Widget library"}
      </div>
      {groups.map((g) => {
        const items = WIDGET_REGISTRY.filter((w) => w.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1">
              {GROUP_LABEL[g]![lang]}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((w) => (
                <LibraryCard key={w.type} type={w.type} lang={lang} icon={w.icon} onAdd={onAdd} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LibraryCard({
  type,
  lang,
  icon,
  onAdd,
}: {
  type: NlWidgetType;
  lang: NlLang;
  icon: string;
  onAdd: (type: NlWidgetType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib-${type}`,
    data: { kind: "library", type },
  });
  const IconCmp = (Lucide as unknown as Record<string, React.ComponentType<{ className?: string }>>)[icon] ?? Lucide.Square;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onAdd(type)}
      {...attributes}
      {...listeners}
      className={
        "group flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all cursor-grab active:cursor-grabbing " +
        (isDragging ? "opacity-40" : "")
      }
    >
      <IconCmp className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
      <span className="text-[10px] leading-tight text-center">{widgetLabel(type, lang)}</span>
    </button>
  );
}
