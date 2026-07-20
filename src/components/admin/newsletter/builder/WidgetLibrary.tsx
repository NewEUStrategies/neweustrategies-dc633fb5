// WidgetLibrary - lewy panel buildera. Karty widgetow pogrupowane po `group`
// z registry.ts. Kazda karta jest draggable (kind="library") - drop w kanwie
// dodaje nowy widget przez NewsletterBuilder.onDragEnd. Klikniecie karty
// dodaje widget na koniec (dostepnosc + touch).
//
// Niektore karty (np. "Imie", "Pracodawca") to warianty tego samego `type`
// z presetem - przekazujemy je razem z `type` do onAdd i onDragEnd.
//
// `context` filtruje widgety po `WidgetMeta.contexts` - np. builder popupu
// nie pokazuje pol formularza newslettera, ktore nie maja sensu poza inline.
import { useDraggable } from "@dnd-kit/core";
// DynamicIcon zamiast namespace-importu lucide-react (namespace-import
// materializuje pełny rejestr ikon w bundlu entry - patrz DynamicIconFull).
import { Square } from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import type { NlWidgetType, NlLang, NlWidget } from "@/lib/newsletter-builder/types";
import {
  libraryItemId,
  widgetsForContext,
  type BuilderContext,
  type WidgetLibraryItem,
} from "@/lib/newsletter-builder/registry";

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
  context = "newsletter",
}: {
  lang: NlLang;
  onAdd: (type: NlWidgetType, preset?: Partial<NlWidget>) => void;
  context?: BuilderContext;
}) {
  const groups = Object.keys(GROUP_LABEL);
  const available = widgetsForContext(context);
  return (
    <div className="space-y-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {lang === "pl" ? "Biblioteka widgetow" : "Widget library"}
      </div>
      {groups.map((g) => {
        const items = available.filter((w) => w.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1">
              {GROUP_LABEL[g]![lang]}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((w) => (
                <LibraryCard key={libraryItemId(w)} item={w} lang={lang} onAdd={onAdd} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LibraryCard({
  item,
  lang,
  onAdd,
}: {
  item: WidgetLibraryItem;
  lang: NlLang;
  onAdd: (type: NlWidgetType, preset?: Partial<NlWidget>) => void;
}) {
  const id = libraryItemId(item);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib-${id}`,
    data: { kind: "library", type: item.type, preset: item.preset },
  });
  const iconName = item.icon;
  const label = lang === "pl" ? item.labelPl : item.labelEn;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onAdd(item.type, item.preset)}
      {...attributes}
      {...listeners}
      className={
        "group flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all cursor-grab active:cursor-grabbing " +
        (isDragging ? "opacity-40" : "")
      }
    >
      {iconName ? (
        <DynamicIcon
          name={iconName}
          className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors"
          size={16}
        />
      ) : (
        <Square className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
      )}
      <span className="text-[10px] leading-tight text-center">{label}</span>
    </button>
  );
}
