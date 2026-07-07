// Newsletter Builder - Elementor-style, dedykowany dla formularza inline i popupu.
//
// Layout (3 panele):
//   +---------------------------------------------+
//   | Toolbar: Save | Undo | Redo | Device | Lang |
//   +--------+----------------------+-------------+
//   | Widget | Canvas (@dnd-kit)    | Properties  |
//   | Library| N sekcji + widgety   | (selected)  |
//   +--------+----------------------+-------------+
//
// Tura 3: multi-section canvas.
// - Kazda sekcja renderowana osobno z wlasnym toolbarem (up/down/duplicate/
//   delete/add-below). Klikniecie w chrome sekcji zaznacza ja - prawy panel
//   pokazuje ustawienia stylu (bg, padding, radius, gap, align, layout).
// - Widgety mozna DnD-owac wewnatrz sekcji, pomiedzy kolumnami oraz miedzy
//   sekcjami (dzieki namespaceowanym droppable IDs sec-{id}-...).
// - Persistencja: `doc.sections[]` jako pelna tablica sekcji; kazda sekcja
//   ma wlasne widgets[] i style + layout.
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
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  useNewsletterSettings,
  useSaveNewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import type {
  NlDoc,
  NlWidget,
  NlWidgetType,
  NlLang,
  NlSection,
  NlSectionStyle,
  NlSectionLayout,
} from "@/lib/newsletter-builder/types";
import { buildDefaultDoc, makeSection, makeWidget } from "@/lib/newsletter-builder/defaults";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Button } from "@/components/ui/button";
import {
  Save,
  Undo,
  Redo,
  Monitor,
  Tablet,
  Smartphone,
  Plus,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
} from "lucide-react";
import { WidgetLibrary } from "./WidgetLibrary";
import { BuilderCanvas } from "./BuilderCanvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { WidgetPreview } from "./WidgetPreview";

type Device = "desktop" | "tablet" | "mobile";

const uid = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }
};

interface DropTarget {
  sectionId: string | null;
  col: 0 | 1 | null;
  overWidgetIdx: number | null; // index within the section
}

export function NewsletterBuilder({ variant }: { variant: "inline" | "popup" }) {
  const { data: settings } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();

  const [lang, setLang] = useState<NlLang>("pl");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<NlWidgetType | null>(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);

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
      popupStyle:
        variant === "popup"
          ? {
              bg: settings.popup_bg_color,
              fg: settings.popup_text_color,
              muted: settings.popup_muted_color,
              accent: settings.popup_accent_color,
              accentFg: settings.popup_accent_text_color,
              overlay: settings.popup_overlay_color,
              radius: settings.popup_border_radius_px,
              layout: settings.popup_layout,
              sideImage: settings.popup_side_image_url,
            }
          : undefined,
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

  // ------------- lookup helpers -------------
  const findWidgetLocation = (
    widgetId: string,
  ): { sectionIdx: number; widgetIdx: number } | null => {
    for (let s = 0; s < doc.sections.length; s++) {
      const idx = doc.sections[s]!.widgets.findIndex((w) => w.id === widgetId);
      if (idx >= 0) return { sectionIdx: s, widgetIdx: idx };
    }
    return null;
  };
  const findSectionIdx = (sectionId: string): number =>
    doc.sections.findIndex((s) => s.id === sectionId);

  const selectedWidget = selectedId
    ? (() => {
        const loc = findWidgetLocation(selectedId);
        return loc ? doc.sections[loc.sectionIdx]!.widgets[loc.widgetIdx]! : null;
      })()
    : null;
  const selectedSection = selectedSectionId
    ? doc.sections[findSectionIdx(selectedSectionId)] ?? null
    : null;

  // ------------- section mutators -------------
  const patchSectionById = (
    sectionId: string,
    fn: (section: NlSection) => NlSection,
  ) => {
    history.set((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
    }));
  };

  const patchSectionStyle = (sectionId: string, patch: Partial<NlSectionStyle>) => {
    patchSectionById(sectionId, (s) => ({ ...s, style: { ...(s.style ?? {}), ...patch } }));
  };

  const setSectionLayout = (sectionId: string, layout: NlSectionLayout) => {
    patchSectionById(sectionId, (s) => {
      if (layout === "single") {
        return { ...s, layout: "single", widgets: s.widgets.map((w) => ({ ...w, col: undefined })) };
      }
      return {
        ...s,
        layout,
        widgets: s.widgets.map((w) => ({ ...w, col: (w.col ?? 0) as 0 | 1 })),
      };
    });
  };

  const addSection = (afterSectionId?: string) => {
    const newSec = makeSection();
    history.set((prev) => {
      const next = [...prev.sections];
      const idx = afterSectionId ? next.findIndex((s) => s.id === afterSectionId) : -1;
      const at = idx >= 0 ? idx + 1 : next.length;
      next.splice(at, 0, newSec);
      return { ...prev, sections: next };
    });
    setSelectedSectionId(newSec.id);
    setSelectedId(null);
  };

  const removeSection = (sectionId: string) => {
    if (doc.sections.length <= 1) {
      toast.error(lang === "pl" ? "Musi zostac co najmniej jedna sekcja" : "At least one section required");
      return;
    }
    history.set((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) }));
    if (selectedSectionId === sectionId) setSelectedSectionId(null);
  };

  const duplicateSection = (sectionId: string) => {
    history.set((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return prev;
      const src = prev.sections[idx]!;
      const copy: NlSection = {
        ...src,
        id: uid(),
        widgets: src.widgets.map((w) => ({ ...w, id: uid() })),
      };
      const next = [...prev.sections];
      next.splice(idx + 1, 0, copy);
      return { ...prev, sections: next };
    });
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    history.set((prev) => {
      const idx = prev.sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return prev;
      const to = idx + dir;
      if (to < 0 || to >= prev.sections.length) return prev;
      const next = [...prev.sections];
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item!);
      return { ...prev, sections: next };
    });
  };

  // ------------- widget mutators -------------
  const updateSectionWidgets = (
    sectionId: string,
    fn: (list: NlWidget[]) => NlWidget[],
  ) => {
    patchSectionById(sectionId, (s) => ({ ...s, widgets: fn(s.widgets) }));
  };

  const addWidget = (
    type: NlWidgetType,
    sectionId: string,
    atIndex?: number,
    col: 0 | 1 = 0,
  ) => {
    const section = doc.sections[findSectionIdx(sectionId)];
    if (!section) return;
    const w = makeWidget(type);
    if ((section.layout ?? "single") !== "single") w.col = col;
    updateSectionWidgets(sectionId, (list) => {
      const next = [...list];
      const idx = typeof atIndex === "number" ? Math.max(0, Math.min(atIndex, next.length)) : next.length;
      next.splice(idx, 0, w);
      return next;
    });
    setSelectedId(w.id);
    setSelectedSectionId(null);
  };

  const removeWidget = (id: string) => {
    const loc = findWidgetLocation(id);
    if (!loc) return;
    const sectionId = doc.sections[loc.sectionIdx]!.id;
    updateSectionWidgets(sectionId, (list) => list.filter((w) => w.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateWidget = (id: string) => {
    const loc = findWidgetLocation(id);
    if (!loc) return;
    const sectionId = doc.sections[loc.sectionIdx]!.id;
    updateSectionWidgets(sectionId, (list) => {
      const idx = list.findIndex((w) => w.id === id);
      if (idx < 0) return list;
      const copy: NlWidget = { ...list[idx]!, id: uid() };
      const next = [...list];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const patchWidget = (id: string, patch: Partial<NlWidget>) => {
    const loc = findWidgetLocation(id);
    if (!loc) return;
    const sectionId = doc.sections[loc.sectionIdx]!.id;
    updateSectionWidgets(sectionId, (list) =>
      list.map((w) => (w.id === id ? ({ ...w, ...patch } as NlWidget) : w)),
    );
  };

  const patchPopupStyle = (patch: Partial<NonNullable<NlDoc["popup"]>>) => {
    history.set((prev) => ({ ...prev, popup: { ...(prev.popup ?? {}), ...patch } }));
  };

  // ------------- DnD -------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const resolveDropTarget = (overId: string): DropTarget => {
    // "sec-{sectionId}-drop" | "sec-{sectionId}-col-0" | "sec-{sectionId}-col-1"
    if (overId.startsWith("sec-")) {
      const rest = overId.slice(4);
      const m = rest.match(/^(.+)-(drop|col-0|col-1)$/);
      if (m) {
        const sid = m[1]!;
        const kind = m[2]!;
        return {
          sectionId: sid,
          col: kind === "col-0" ? 0 : kind === "col-1" ? 1 : null,
          overWidgetIdx: null,
        };
      }
    }
    // over widget id -> find location
    const loc = findWidgetLocation(overId);
    if (loc) {
      const section = doc.sections[loc.sectionIdx]!;
      const target = section.widgets[loc.widgetIdx]!;
      return {
        sectionId: section.id,
        col: (target.col ?? 0) as 0 | 1,
        overWidgetIdx: loc.widgetIdx,
      };
    }
    return { sectionId: null, col: null, overWidgetIdx: null };
  };

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
    const target = resolveDropTarget(String(over.id));
    if (!target.sectionId) return;

    const targetSection = doc.sections[findSectionIdx(target.sectionId)]!;
    const targetLayout: NlSectionLayout = targetSection.layout ?? "single";

    // Drop from library
    if (data?.kind === "library" && data.type) {
      const col = targetLayout === "single" ? 0 : (target.col ?? 0);
      addWidget(data.type, target.sectionId, target.overWidgetIdx ?? undefined, col);
      return;
    }

    // Reorder / cross-section move
    if (active.id === over.id) return;
    const activeLoc = findWidgetLocation(String(active.id));
    if (!activeLoc) return;
    const sourceSection = doc.sections[activeLoc.sectionIdx]!;
    const activeWidget = sourceSection.widgets[activeLoc.widgetIdx]!;
    const newCol = targetLayout === "single" ? undefined : ((target.col ?? activeWidget.col ?? 0) as 0 | 1);

    history.set((prev) => {
      // remove from source
      const withoutSource = prev.sections.map((s) =>
        s.id === sourceSection.id
          ? { ...s, widgets: s.widgets.filter((w) => w.id !== activeWidget.id) }
          : s,
      );
      // insert into target
      const nextSections = withoutSource.map((s) => {
        if (s.id !== target.sectionId) return s;
        const list = [...s.widgets];
        const moved: NlWidget = { ...activeWidget, col: newCol } as NlWidget;
        let insertAt: number;
        if (target.overWidgetIdx == null) {
          insertAt = list.length;
        } else {
          const overWidget = targetSection.widgets[target.overWidgetIdx]!;
          const idx = list.findIndex((w) => w.id === overWidget.id);
          insertAt = idx >= 0 ? idx : list.length;
        }
        list.splice(insertAt, 0, moved);
        return { ...s, widgets: list };
      });
      return { ...prev, sections: nextSections };
    });
  };

  // ------------- save -------------
  const onSave = async () => {
    const patch = variant === "inline" ? { inline_doc: doc } : { popup_doc: doc };
    try {
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

  // Realistyczne szerokosci podgladu - popup ma stala szerokosc jak w produkcji,
  // inline dostosowuje sie do dostepnej przestrzeni w kanwie.
  const popupLayout = variant === "popup" ? (doc.popup?.layout ?? settings.popup_layout ?? "stacked") : null;
  const desktopPopupWidth = popupLayout === "split" ? 880 : 520;
  const canvasWidth =
    variant === "popup"
      ? device === "desktop"
        ? desktopPopupWidth
        : device === "tablet"
          ? 560
          : 360
      : device === "desktop"
        ? "100%"
        : device === "tablet"
          ? 720
          : 380;
  const popupBg = variant === "popup" ? (doc.popup?.bg ?? settings.popup_bg_color) : undefined;
  const overlayBg =
    variant === "popup"
      ? (doc.popup?.overlay ?? settings.popup_overlay_color ?? "rgba(0,0,0,0.7)")
      : undefined;
  const popupRadius = variant === "popup" ? (doc.popup?.radius ?? settings.popup_border_radius_px ?? 16) : 0;
  const draggingWidget = draggingWidgetId
    ? doc.sections.flatMap((s) => s.widgets).find((w) => w.id === draggingWidgetId) ?? null
    : null;

  const deviceLabel =
    device === "desktop"
      ? lang === "pl" ? "Desktop" : "Desktop"
      : device === "tablet"
        ? "Tablet"
        : "Mobile";
  const canvasPxLabel = typeof canvasWidth === "number" ? `${canvasWidth}px` : lang === "pl" ? "pelna szerokosc" : "full width";

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl">
              {variant === "inline" ? "Inline builder" : "Popup builder"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Przeciagnij widgety z lewego panelu do kanwy. Klikniecie widgetu lub sekcji otwiera panel wlasciwosci.
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
            <WidgetLibrary
              lang={lang}
              onAdd={(type) => {
                const sid = selectedSectionId ?? doc.sections[0]?.id;
                if (sid) addWidget(type, sid);
              }}
            />
          </aside>

          <main
            className="relative rounded-xl overflow-hidden border border-border/60 bg-[repeating-linear-gradient(45deg,transparent_0_12px,rgba(255,255,255,0.02)_12px_13px)] bg-muted/30"
            onClick={() => {
              setSelectedId(null);
              setSelectedSectionId(null);
            }}
          >
            {/* Device meta bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-background/40 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="font-semibold">{deviceLabel}</span>
              <span>{canvasPxLabel}</span>
            </div>

            <div
              className="p-6 overflow-y-auto max-h-[calc(80vh-2.5rem)]"
              style={
                variant === "popup"
                  ? { backgroundColor: overlayBg }
                  : undefined
              }
            >
            <div
              className={
                "mx-auto transition-all space-y-4 " +
                (variant === "popup"
                  ? "shadow-2xl ring-1 ring-black/10 overflow-hidden"
                  : device !== "desktop"
                    ? "shadow-lg ring-1 ring-border/60 rounded-2xl bg-card"
                    : "")
              }
              style={{
                maxWidth: typeof canvasWidth === "number" ? `${canvasWidth}px` : canvasWidth,
                width: typeof canvasWidth === "number" ? `${canvasWidth}px` : undefined,
                borderRadius: variant === "popup" ? `${popupRadius}px` : undefined,
                backgroundColor: variant === "popup" ? popupBg : undefined,
              }}
            >
              {doc.sections.map((section, sIdx) => {
                const isSelected = selectedSectionId === section.id;
                const st = section.style ?? {};
                return (
                  <div key={section.id} className="space-y-2">
                    <div
                      className={
                        "relative rounded-xl transition-all border-2 " +
                        (isSelected
                          ? "border-primary"
                          : "border-transparent hover:border-primary/30")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSectionId(section.id);
                        setSelectedId(null);
                      }}
                    >
                      {/* Section toolbar */}
                      <div className="absolute -top-3 left-3 z-10 flex items-center gap-1 bg-card border border-border rounded-md shadow-sm text-[10px]">
                        <span className="px-2 py-1 text-muted-foreground uppercase tracking-wider">
                          {lang === "pl" ? "Sekcja" : "Section"} {sIdx + 1}
                        </span>
                        <SectionBtn
                          onClick={() => moveSection(section.id, -1)}
                          disabled={sIdx === 0}
                          label={lang === "pl" ? "W gore" : "Move up"}
                        >
                          <ArrowUp className="w-3 h-3" />
                        </SectionBtn>
                        <SectionBtn
                          onClick={() => moveSection(section.id, 1)}
                          disabled={sIdx === doc.sections.length - 1}
                          label={lang === "pl" ? "W dol" : "Move down"}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </SectionBtn>
                        <SectionBtn
                          onClick={() => duplicateSection(section.id)}
                          label={lang === "pl" ? "Duplikuj sekcje" : "Duplicate"}
                        >
                          <Copy className="w-3 h-3" />
                        </SectionBtn>
                        <SectionBtn
                          onClick={() => removeSection(section.id)}
                          disabled={doc.sections.length <= 1}
                          label={lang === "pl" ? "Usun sekcje" : "Delete"}
                          danger
                        >
                          <Trash2 className="w-3 h-3" />
                        </SectionBtn>
                      </div>

                      <div
                        className="rounded-xl p-4 min-h-[160px]"
                        style={{
                          backgroundColor:
                            st.bg ??
                            (variant === "popup"
                              ? popupBg
                              : sIdx === 0
                                ? "var(--card)"
                                : "transparent"),
                          color:
                            st.fg ??
                            (variant === "popup"
                              ? (doc.popup?.fg ?? settings.popup_text_color)
                              : undefined),
                          borderRadius: st.radius != null ? `${st.radius}px` : undefined,
                          paddingTop: st.paddingY != null ? `${st.paddingY}px` : undefined,
                          paddingBottom: st.paddingY != null ? `${st.paddingY}px` : undefined,
                          paddingLeft: st.paddingX != null ? `${st.paddingX}px` : undefined,
                          paddingRight: st.paddingX != null ? `${st.paddingX}px` : undefined,
                        }}
                      >
                        <BuilderCanvas
                          sectionId={section.id}
                          widgets={section.widgets}
                          lang={lang}
                          layout={section.layout ?? "single"}
                          selectedId={selectedId}
                          onSelect={(id) => {
                            setSelectedId(id);
                            setSelectedSectionId(null);
                          }}
                          onRemove={removeWidget}
                          onDuplicate={duplicateWidget}
                        />
                      </div>
                    </div>

                    {/* Add-section between sections */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addSection(section.id);
                        }}
                        className="opacity-60 hover:opacity-100 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary flex items-center gap-1 px-2 py-1 rounded border border-dashed border-border/60 hover:border-primary/40 transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        {lang === "pl" ? "Dodaj sekcje" : "Add section"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </main>

          <aside className="bg-card border border-border rounded-xl p-4 overflow-y-auto max-h-[80vh]">
            <PropertiesPanel
              variant={variant}
              doc={doc}
              selected={selectedWidget}
              selectedSection={selectedSection}
              onPatch={(patch) => selectedWidget && patchWidget(selectedWidget.id, patch)}
              onPatchPopup={patchPopupStyle}
              onPatchSection={(patch) =>
                selectedSection && patchSectionStyle(selectedSection.id, patch)
              }
              onPatchLayout={(layout) =>
                selectedSection
                  ? setSectionLayout(selectedSection.id, layout)
                  : setSectionLayout(doc.sections[0]!.id, layout)
              }
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
        {draggingWidget && (
          <div className="opacity-80 rotate-1">
            <WidgetPreview widget={draggingWidget} lang={lang} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SectionBtn({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        "p-1 border-l border-border transition-colors " +
        (danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted") +
        " disabled:opacity-30 disabled:cursor-not-allowed"
      }
    >
      {children}
    </button>
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
