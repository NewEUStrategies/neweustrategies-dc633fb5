// Newsletter Builder - Elementor-style, dedykowany dla formularza inline i popupu.
//
// Layout (3 panele):
//   +---------------------------------------------+
//   | Toolbar: Save | Undo | Redo | Device | Lang |
//   +--------+----------------------+-------------+
//   | Widget | Canvas (@dnd-kit)    | Properties  |
//   | Library|  sortable widgets    | (selected)  |
//   +--------+----------------------+-------------+
//
// - `variant` decyduje ktory `doc` w newsletter_settings edytujemy
//   (`inline_doc` vs `popup_doc`) i jaki startowy default budujemy.
// - Undo/redo przez useUndoRedo, unsaved guard przez useUnsavedChangesGuard.
// - W Turze 1 kanwa jest plaska: 1 sekcja, N widgetow, sortable po pionie.
//   Sekcje + kolumny sa dolozone w Turze 2 (Elementor-grade).
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useNewsletterSettings,
  useSaveNewsletterSettings,
  defaultNewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import type { NlDoc, NlWidget, NlWidgetType, NlLang } from "@/lib/newsletter-builder/types";
import { buildDefaultDoc, makeWidget } from "@/lib/newsletter-builder/defaults";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Button } from "@/components/ui/button";
import { Save, Undo, Redo, Monitor, Tablet, Smartphone } from "lucide-react";
import { WidgetLibrary } from "./WidgetLibrary";
import { BuilderCanvas } from "./BuilderCanvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { WidgetPreview } from "./WidgetPreview";

type Device = "desktop" | "tablet" | "mobile";

export function NewsletterBuilder({ variant }: { variant: "inline" | "popup" }) {
  const { data: settings } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();

  const [lang, setLang] = useState<NlLang>("pl");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<NlWidgetType | null>(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);

  // Init doc lazily po zaladowaniu settings (unikamy migotania pustego canvasa).
  const initialDoc = useMemo<NlDoc | null>(() => {
    if (!settings) return null;
    const stored = variant === "inline" ? settings.inline_doc : settings.popup_doc;
    if (stored) return stored;
    return buildDefaultDoc(variant, {
      heading: { pl: settings.heading_pl, en: settings.heading_en },
      description: { pl: settings.description_pl, en: settings.description_en },
      policyHtml: { pl: settings.policy_html_pl, en: settings.policy_html_en },
      successMsg: { pl: settings.success_message_pl, en: settings.success_message_en },
      submitLabel:
        variant === "popup"
          ? { pl: settings.popup_cta_pl, en: settings.popup_cta_en }
          : { pl: "Zapisz sie", en: "Subscribe" },
      coverUrl: variant === "popup" ? settings.popup_cover_url : null,
      requireTerms: variant === "popup" && settings.popup_require_terms,
      termsHtml:
        variant === "popup"
          ? { pl: settings.popup_terms_html_pl, en: settings.popup_terms_html_en }
          : { pl: null, en: null },
    });
  }, [settings, variant]);

  const history = useUndoRedo<NlDoc>({ version: 1, variant, sections: [{ id: "s0", widgets: [] }] });
  const initedRef = useRef(false);
  useEffect(() => {
    if (initialDoc && !initedRef.current) {
      history.reset(initialDoc);
      initedRef.current = true;
    }
  }, [initialDoc, history]);

  const doc = history.state;
  const savedRef = useRef<NlDoc | null>(null);
  useEffect(() => {
    if (initedRef.current && !savedRef.current) savedRef.current = initialDoc;
  }, [initialDoc]);

  const isDirty = savedRef.current ? doc !== savedRef.current : false;
  useUnsavedChangesGuard(isDirty);

  const widgets = doc.sections[0]?.widgets ?? [];
  const selected = widgets.find((w) => w.id === selectedId) ?? null;

  const updateWidgets = (fn: (list: NlWidget[]) => NlWidget[]) => {
    history.set((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => (i === 0 ? { ...s, widgets: fn(s.widgets) } : s)),
    }));
  };

  const addWidget = (type: NlWidgetType, atIndex?: number) => {
    const w = makeWidget(type);
    updateWidgets((list) => {
      const next = [...list];
      const idx = typeof atIndex === "number" ? Math.max(0, Math.min(atIndex, next.length)) : next.length;
      next.splice(idx, 0, w);
      return next;
    });
    setSelectedId(w.id);
  };

  const removeWidget = (id: string) => {
    updateWidgets((list) => list.filter((w) => w.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateWidget = (id: string) => {
    updateWidgets((list) => {
      const idx = list.findIndex((w) => w.id === id);
      if (idx < 0) return list;
      const copy: NlWidget = {
        ...list[idx]!,
        id: crypto.randomUUID(),
      };
      const next = [...list];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const patchWidget = (id: string, patch: Partial<NlWidget>) => {
    updateWidgets((list) => list.map((w) => (w.id === id ? ({ ...w, ...patch } as NlWidget) : w)));
  };

  const patchPopupStyle = (patch: Partial<NonNullable<NlDoc["popup"]>>) => {
    history.set((prev) => ({ ...prev, popup: { ...(prev.popup ?? {}), ...patch } }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { kind?: string; type?: NlWidgetType } | undefined;
    if (data?.kind === "library" && data.type) setDraggingType(data.type);
    else setDraggingWidgetId(String(e.active.id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingType(null);
    setDraggingWidgetId(null);
    const { active, over } = e;
    if (!over) return;
    const data = active.data.current as { kind?: string; type?: NlWidgetType } | undefined;

    // Drop from library
    if (data?.kind === "library" && data.type) {
      if (over.id === "canvas-drop") {
        addWidget(data.type);
      } else {
        const overIdx = widgets.findIndex((w) => w.id === over.id);
        addWidget(data.type, overIdx >= 0 ? overIdx : undefined);
      }
      return;
    }

    // Reorder within canvas
    if (active.id !== over.id) {
      const oldIdx = widgets.findIndex((w) => w.id === active.id);
      const newIdx = widgets.findIndex((w) => w.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      updateWidgets((list) => arrayMove(list, oldIdx, newIdx));
    }
  };

  const onSave = async () => {
    const patch =
      variant === "inline" ? { inline_doc: doc } : { popup_doc: doc };
    try {
      // useSaveNewsletterSettings przyjmuje Partial<NewsletterSettings>; JSONB w Supabase.
      await save.mutateAsync(patch as unknown as Parameters<typeof save.mutateAsync>[0]);
      savedRef.current = doc;
      toast.success(variant === "inline" ? "Zapisano formularz inline" : "Zapisano popup");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (!settings) {
    return <div className="text-sm text-muted-foreground p-6">Ladowanie ustawien...</div>;
  }

  const canvasWidth = device === "desktop" ? "100%" : device === "tablet" ? 720 : 380;
  const popupBg = variant === "popup" ? (doc.popup?.bg ?? settings.popup_bg_color) : undefined;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl">
              {variant === "inline" ? "Inline builder" : "Popup builder"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Przeciagnij widgety z lewego panelu do kanwy. Kliknij widget aby edytowac wlasciwosci.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border/60">
              <button
                type="button"
                onClick={() => history.undo()}
                disabled={!history.canUndo}
                className="p-1.5 rounded hover:bg-background disabled:opacity-40"
                aria-label="Cofnij"
              >
                <Undo className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => history.redo()}
                disabled={!history.canRedo}
                className="p-1.5 rounded hover:bg-background disabled:opacity-40"
                aria-label="Ponow"
              >
                <Redo className="w-4 h-4" />
              </button>
            </div>
            <DeviceSwitch value={device} onChange={setDevice} />
            <LangSwitch value={lang} onChange={setLang} />
            <Button onClick={onSave} disabled={!isDirty || save.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {save.isPending ? "Zapisywanie..." : "Zapisz"}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px] gap-3 min-h-[70vh]">
          <aside className="bg-card border border-border rounded-xl p-3 overflow-y-auto max-h-[80vh]">
            <WidgetLibrary lang={lang} onAdd={addWidget} />
          </aside>

          <main className="bg-gradient-to-br from-muted/40 to-muted/10 border border-dashed border-border rounded-xl p-4 overflow-y-auto max-h-[80vh]">
            <div
              className="mx-auto transition-all"
              style={{ maxWidth: typeof canvasWidth === "number" ? `${canvasWidth}px` : canvasWidth }}
            >
              <div
                className="rounded-xl p-4 min-h-[400px]"
                style={
                  variant === "popup"
                    ? {
                        backgroundColor: popupBg,
                        color: doc.popup?.fg ?? settings.popup_text_color,
                        borderRadius: `${doc.popup?.radius ?? settings.popup_border_radius_px}px`,
                      }
                    : { backgroundColor: "var(--card)" }
                }
              >
                <SortableContext items={widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                  <BuilderCanvas
                    widgets={widgets}
                    lang={lang}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onRemove={removeWidget}
                    onDuplicate={duplicateWidget}
                  />
                </SortableContext>
              </div>
            </div>
          </main>

          <aside className="bg-card border border-border rounded-xl p-4 overflow-y-auto max-h-[80vh]">
            <PropertiesPanel
              variant={variant}
              doc={doc}
              selected={selected}
              onPatch={(patch) => selected && patchWidget(selected.id, patch)}
              onPatchPopup={patchPopupStyle}
              lang={lang}
            />
          </aside>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingType && (
          <div className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-lg">
            + {draggingType}
          </div>
        )}
        {draggingWidgetId && (
          <div className="opacity-80 rotate-1">
            <WidgetPreview
              widget={widgets.find((w) => w.id === draggingWidgetId) ?? null}
              lang={lang}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DeviceSwitch({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  const items: { v: Device; icon: typeof Monitor; label: string }[] = [
    { v: "desktop", icon: Monitor, label: "Desktop" },
    { v: "tablet", icon: Tablet, label: "Tablet" },
    { v: "mobile", icon: Smartphone, label: "Mobile" },
  ];
  return (
    <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border/60">
      {items.map((it) => {
        const Icon = it.icon;
        const active = value === it.v;
        return (
          <button
            key={it.v}
            type="button"
            aria-label={it.label}
            onClick={() => onChange(it.v)}
            className={"p-1.5 rounded " + (active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
}

function LangSwitch({ value, onChange }: { value: NlLang; onChange: (l: NlLang) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-md bg-muted/60 border border-border/60">
      {(["pl", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={
            "px-2 py-1 text-xs rounded uppercase font-semibold " +
            (value === l ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
}
