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
import { useNewsletterSettings, useSaveNewsletterSettings } from "@/hooks/useNewsletterSettings";
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
import * as rules from "./builderDoc";
import type { Device, DropTarget } from "./builderDoc";
import { useHistory } from "@/hooks/useHistory";
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

const uid = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }
};

export function NewsletterBuilder({ variant }: { variant: "inline" | "popup" }) {
  const { data: settings } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();

  const [lang, setLang] = useState<NlLang>("pl");
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<"widgets" | "settings">("widgets");
  const [draggingType, setDraggingType] = useState<NlWidgetType | null>(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);

  const initialDoc = useMemo<NlDoc | null>(() => {
    if (!settings) return null;
    const stored = variant === "inline" ? settings.inline_doc : settings.popup_doc;
    if (stored) return stored;
    return buildDefaultDoc(variant, rules.docSeedFromSettings(variant, settings));
  }, [settings, variant]);

  const history = useHistory<NlDoc>({
    version: 1,
    variant,
    sections: [{ id: "s0", widgets: [] }],
  });
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

  // Auto-switch to settings tab when a widget or section is selected.
  useEffect(() => {
    if (selectedId || selectedSectionId) setSideTab("settings");
  }, [selectedId, selectedSectionId]);

  // ------------- lookup -------------
  const selectedWidget = rules.widgetById(doc, selectedId);
  const selectedSection = rules.sectionById(doc, selectedSectionId);

  // ------------- section mutators -------------
  const patchSectionStyle = (sectionId: string, patch: Partial<NlSectionStyle>) => {
    history.set((prev) => rules.applySectionStyle(prev, sectionId, patch));
  };

  const patchSectionMedia = (
    sectionId: string,
    patch: Partial<NonNullable<NlSection["media"]>> | null,
  ) => {
    history.set((prev) => rules.applySectionMedia(prev, sectionId, patch));
  };

  const setSectionLayout = (sectionId: string, layout: NlSectionLayout) => {
    history.set((prev) => rules.applySectionLayout(prev, sectionId, layout));
  };

  const addSection = (afterSectionId?: string) => {
    const newSec = makeSection();
    history.set((prev) => rules.insertSection(prev, newSec, afterSectionId));
    setSelectedSectionId(newSec.id);
    setSelectedId(null);
  };

  const removeSection = (sectionId: string) => {
    if (!rules.canRemoveSection(doc)) {
      toast.error(
        lang === "pl" ? "Musi zostac co najmniej jedna sekcja" : "At least one section required",
      );
      return;
    }
    history.set((prev) => rules.removeSection(prev, sectionId));
    if (selectedSectionId === sectionId) setSelectedSectionId(null);
  };

  const duplicateSection = (sectionId: string) => {
    history.set((prev) => rules.duplicateSection(prev, sectionId, uid));
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    history.set((prev) => rules.moveSection(prev, sectionId, dir));
  };

  // ------------- widget mutators -------------
  const addWidget = (
    type: NlWidgetType,
    sectionId: string,
    atIndex?: number,
    col: 0 | 1 = 0,
    preset?: Partial<NlWidget>,
  ) => {
    const section = rules.sectionById(doc, sectionId);
    if (!section) return;
    const widget = rules.buildWidget(section, makeWidget(type), { col, preset });
    history.set((prev) => rules.insertWidget(prev, sectionId, widget, atIndex));
    setSelectedId(widget.id);
    setSelectedSectionId(null);
  };

  const removeWidget = (id: string) => {
    history.set((prev) => rules.removeWidget(prev, id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateWidget = (id: string) => {
    history.set((prev) => rules.duplicateWidget(prev, id, uid));
  };

  const patchWidget = (id: string, patch: Partial<NlWidget>) => {
    history.set((prev) => rules.patchWidget(prev, id, patch));
  };

  const patchPopupStyle = (patch: Partial<NonNullable<NlDoc["popup"]>>) => {
    history.set((prev) => rules.applyPopupStyle(prev, patch));
  };

  // ------------- DnD -------------
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
    const data = active.data.current as
      { kind?: string; type?: NlWidgetType; preset?: Partial<NlWidget> } | undefined;
    const target: DropTarget = rules.resolveDropTarget(doc, String(over.id));
    if (!target.sectionId) return;

    // Drop from library
    if (data?.kind === "library" && data.type) {
      const targetSection = rules.sectionById(doc, target.sectionId)!;
      const col = (targetSection.layout ?? "single") === "single" ? 0 : (target.col ?? 0);
      addWidget(data.type, target.sectionId, target.overWidgetIdx ?? undefined, col, data.preset);
      return;
    }

    // Reorder / cross-section move
    if (active.id === over.id) return;
    history.set((prev) => rules.moveWidget(prev, String(active.id), target));
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
  const popupLayout =
    variant === "popup" ? (doc.popup?.layout ?? settings.popup_layout ?? "stacked") : null;
  const desktopPopupWidth = popupLayout === "split" || popupLayout === "showcase" ? 880 : 520;
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
  const popupRadius =
    variant === "popup" ? (doc.popup?.radius ?? settings.popup_border_radius_px ?? 16) : 0;
  const draggingWidget = draggingWidgetId
    ? (doc.sections.flatMap((s) => s.widgets).find((w) => w.id === draggingWidgetId) ?? null)
    : null;

  // Nazwy urządzeń są takie same w obu językach - ternary po języku był
  // martwym warunkiem, nie tłumaczeniem.
  const deviceLabel = device === "desktop" ? "Desktop" : device === "tablet" ? "Tablet" : "Mobile";
  const canvasPxLabel =
    typeof canvasWidth === "number"
      ? `${canvasWidth}px`
      : lang === "pl"
        ? "pelna szerokosc"
        : "full width";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="space-y-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-xl">
              {variant === "inline" ? "Inline builder" : "Popup builder"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Przeciagnij widgety z lewego panelu do kanwy. Klikniecie widgetu lub sekcji otwiera
              panel wlasciwosci.
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

        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-3 min-h-[70vh]">
          <aside className="bg-card border border-border rounded-xl flex flex-col overflow-hidden max-h-[80vh]">
            <div
              role="tablist"
              className="flex items-center gap-1 p-1 m-2 rounded-md bg-muted/50 border border-border/60"
            >
              <button
                role="tab"
                aria-selected={sideTab === "widgets"}
                type="button"
                onClick={() => setSideTab("widgets")}
                className={
                  "flex-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors " +
                  (sideTab === "widgets"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {lang === "pl" ? "Widgety" : "Widgets"}
              </button>
              <button
                role="tab"
                aria-selected={sideTab === "settings"}
                type="button"
                onClick={() => setSideTab("settings")}
                className={
                  "flex-1 px-2 py-1.5 text-xs font-semibold rounded transition-colors " +
                  (sideTab === "settings"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {selectedWidget
                  ? "Widget"
                  : selectedSection
                    ? lang === "pl"
                      ? "Sekcja"
                      : "Section"
                    : lang === "pl"
                      ? "Dokument"
                      : "Document"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {sideTab === "widgets" ? (
                <WidgetLibrary
                  lang={lang}
                  onAdd={(type, preset) => {
                    const sid = selectedSectionId ?? doc.sections[0]?.id;
                    if (sid) addWidget(type, sid, undefined, 0, preset);
                  }}
                />
              ) : (
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
                  onPatchSectionMedia={(patch) =>
                    selectedSection && patchSectionMedia(selectedSection.id, patch)
                  }
                  lang={lang}
                />
              )}
            </div>
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
              style={variant === "popup" ? { backgroundColor: overlayBg } : undefined}
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
                        {/* Section toolbar - inline (nie moze byc chowany przez overflow-hidden karty popupu) */}
                        <div className="flex items-center gap-1 mb-2 bg-card border border-border rounded-md shadow-sm text-[10px] w-fit">
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

                        {(() => {
                          const secLayout = section.layout ?? "single";
                          const hasMedia = Boolean(section.media?.url);
                          // single + media -> tlo; 1-1 + media -> kolumna 50%
                          const bgAsBackground = hasMedia && secLayout === "single";
                          const splitMedia = hasMedia && secLayout === "1-1";
                          return (
                            <div
                              className="rounded-xl overflow-hidden"
                              style={{
                                backgroundColor:
                                  st.bg ??
                                  (variant === "popup"
                                    ? "transparent"
                                    : sIdx === 0
                                      ? "var(--card)"
                                      : "transparent"),
                                color:
                                  st.fg ??
                                  (variant === "popup"
                                    ? (doc.popup?.fg ?? settings.popup_text_color)
                                    : undefined),
                                borderRadius: st.radius != null ? `${st.radius}px` : undefined,
                                backgroundImage: bgAsBackground
                                  ? `url(${section.media!.url})`
                                  : undefined,
                                backgroundSize: bgAsBackground ? "cover" : undefined,
                                backgroundPosition: bgAsBackground ? "center" : undefined,
                                backgroundRepeat: bgAsBackground ? "no-repeat" : undefined,
                                display: splitMedia ? "flex" : undefined,
                                flexDirection: splitMedia ? "row" : undefined,
                                alignItems: splitMedia ? "stretch" : undefined,
                                minHeight: 160,
                              }}
                            >
                              {splitMedia && section.media!.position === "left" && (
                                <div
                                  aria-label={section.media!.alt ?? ""}
                                  style={{
                                    flex: "0 0 50%",
                                    alignSelf: "stretch",
                                    backgroundImage: `url(${section.media!.url})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    backgroundRepeat: "no-repeat",
                                  }}
                                />
                              )}
                              <div
                                className="min-h-[160px]"
                                style={{
                                  flex: splitMedia ? "1 1 0%" : undefined,
                                  minWidth: 0,
                                  paddingTop: st.paddingY != null ? `${st.paddingY}px` : 16,
                                  paddingBottom: st.paddingY != null ? `${st.paddingY}px` : 16,
                                  paddingLeft: st.paddingX != null ? `${st.paddingX}px` : 16,
                                  paddingRight: st.paddingX != null ? `${st.paddingX}px` : 16,
                                }}
                              >
                                <BuilderCanvas
                                  sectionId={section.id}
                                  widgets={section.widgets}
                                  lang={lang}
                                  layout={secLayout}
                                  selectedId={selectedId}
                                  onSelect={(id) => {
                                    setSelectedId(id);
                                    setSelectedSectionId(null);
                                  }}
                                  onRemove={removeWidget}
                                  onDuplicate={duplicateWidget}
                                />
                              </div>
                              {splitMedia && section.media!.position === "right" && (
                                <div
                                  aria-label={section.media!.alt ?? ""}
                                  style={{
                                    flex: "0 0 50%",
                                    alignSelf: "stretch",
                                    backgroundImage: `url(${section.media!.url})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                    backgroundRepeat: "no-repeat",
                                  }}
                                />
                              )}
                            </div>
                          );
                        })()}
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
            className={
              "p-1.5 rounded " +
              (active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
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
            (value === l
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
}
