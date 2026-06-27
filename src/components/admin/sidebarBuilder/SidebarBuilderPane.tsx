// Elementor-style builder for the post sidebar.
// Three columns:
//   1. Library  - widget palette (add to canvas)
//   2. Canvas   - ordered list of widgets in the active layout (drag-free reorder)
//   3. Inspector- settings for the selected widget (social toggles, etc.)
//
// Persists to `post_sidebar_layouts`. Admin-only writes are enforced by RLS.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  Eye,
  Megaphone,
  Plus,
  Trash2,
  Users,
  Mail,
  Tags as TagIcon,
  PanelLeft,
  Newspaper,
} from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import {
  allSidebarLayoutsQueryOptions,
} from "@/lib/queries/sidebarLayouts";
import {
  DEFAULT_READING_PANEL_SETTINGS,
  SOCIAL_KEYS,
  type ReadingPanelSettings,
  type SidebarLayout,
  type SidebarWidget,
  type SidebarWidgetType,
  type SocialKey,
  widgetsArraySchema,
} from "@/lib/sidebarBuilder/types";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";

interface PaletteEntry {
  type: SidebarWidgetType;
  labelPl: string;
  labelEn: string;
  descPl: string;
  descEn: string;
  Icon: typeof PanelLeft;
}

const PALETTE: PaletteEntry[] = [
  { type: "reading-panel", labelPl: "Panel czytania", labelEn: "Reading panel", descPl: "Spis treści + udostępnianie + zapis", descEn: "ToC + share + save", Icon: PanelLeft },
  { type: "tags", labelPl: "Tagi", labelEn: "Tags", descPl: "Tagi przypisane do wpisu", descEn: "Post tags", Icon: TagIcon },
  { type: "author-card", labelPl: "Karta autora", labelEn: "Author card", descPl: "Bio i linki autora", descEn: "Author bio and links", Icon: Users },
  { type: "related-posts", labelPl: "Powiązane wpisy", labelEn: "Related posts", descPl: "Lista podobnych artykułów", descEn: "List of related articles", Icon: Newspaper },
  { type: "newsletter", labelPl: "Newsletter", labelEn: "Newsletter", descPl: "Formularz zapisu", descEn: "Signup form", Icon: Mail },
  { type: "ad-slot", labelPl: "Reklama", labelEn: "Ad slot", descPl: "Slot reklamowy w sidebarze", descEn: "Sidebar ad slot", Icon: Megaphone },
];

const SOCIAL_LABEL: Record<SocialKey, string> = {
  x: "X (Twitter)",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  mail: "E-mail",
  copy: "Copy link",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  reddit: "Reddit",
};

function defaultSettingsFor(type: SidebarWidgetType): Record<string, unknown> {
  if (type === "reading-panel") return { ...DEFAULT_READING_PANEL_SETTINGS };
  return {};
}

function newWidget(type: SidebarWidgetType): SidebarWidget {
  return {
    id: crypto.randomUUID(),
    type,
    hidden: false,
    settings: defaultSettingsFor(type),
  };
}

export function SidebarBuilderPane() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const layoutsQuery = useQuery(allSidebarLayoutsQueryOptions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SidebarLayout | null>(null);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  // Pick default layout when data arrives.
  useEffect(() => {
    if (!layoutsQuery.data || activeId) return;
    const def =
      layoutsQuery.data.find((l) => l.is_default) ?? layoutsQuery.data[0];
    if (def) setActiveId(def.id);
  }, [layoutsQuery.data, activeId]);

  useEffect(() => {
    const found = layoutsQuery.data?.find((l) => l.id === activeId);
    setDraft(found ? { ...found, widgets: [...found.widgets] } : null);
    setSelectedWidgetId(found?.widgets[0]?.id ?? null);
  }, [activeId, layoutsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (layout: SidebarLayout) => {
      const widgets = widgetsArraySchema.parse(layout.widgets);
      const { error } = await supabase
        .from("post_sidebar_layouts")
        .update({
          name: layout.name,
          is_default: layout.is_default,
          widgets: widgets as unknown as never,
        })
        .eq("id", layout.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["post-sidebar-layout"] });
      toast.success(lang === "pl" ? "Zapisano układ sidebaru" : "Sidebar layout saved");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("post_sidebar_layouts")
        .insert({
          name,
          is_default: false,
          widgets: [newWidget("reading-panel")] as unknown as never,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ["post-sidebar-layout"] });
      setActiveId(id);
      toast.success(lang === "pl" ? "Utworzono układ" : "Layout created");
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const layouts = layoutsQuery.data ?? [];

  const selectedWidget = useMemo(
    () => draft?.widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [draft, selectedWidgetId],
  );

  function patchDraft(mut: (d: SidebarLayout) => SidebarLayout) {
    setDraft((d) => (d ? mut(d) : d));
  }

  function addWidget(type: SidebarWidgetType) {
    if (!draft) return;
    const w = newWidget(type);
    patchDraft((d) => ({ ...d, widgets: [...d.widgets, w] }));
    setSelectedWidgetId(w.id);
  }

  function moveWidget(id: string, dir: -1 | 1) {
    patchDraft((d) => {
      const idx = d.widgets.findIndex((w) => w.id === id);
      if (idx < 0) return d;
      const next = [...d.widgets];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, widgets: next };
    });
  }

  function deleteWidget(id: string) {
    patchDraft((d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== id) }));
    setSelectedWidgetId((cur) => (cur === id ? null : cur));
  }

  function toggleHidden(id: string) {
    patchDraft((d) => ({
      ...d,
      widgets: d.widgets.map((w) =>
        w.id === id ? { ...w, hidden: !w.hidden } : w,
      ),
    }));
  }

  function updateSettings(id: string, partial: Record<string, unknown>) {
    patchDraft((d) => ({
      ...d,
      widgets: d.widgets.map((w) =>
        w.id === id ? { ...w, settings: { ...w.settings, ...partial } } : w,
      ),
    }));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">
      {/* === Library === */}
      <aside className="rounded-[5px] border border-border bg-card p-3">
        <h3 className="text-[11px] font-extrabold tracking-[0.18em] mb-3">
          {lang === "pl" ? "BIBLIOTEKA WIDGETÓW" : "WIDGET LIBRARY"}
        </h3>
        <ul className="flex flex-col gap-1.5">
          {PALETTE.map((p) => {
            const { Icon } = p;
            return (
              <li key={p.type}>
                <button
                  type="button"
                  onClick={() => addWidget(p.type)}
                  disabled={!draft}
                  className="w-full text-left flex items-start gap-2.5 p-2 rounded-[5px] border border-border hover:bg-muted disabled:opacity-50 transition"
                >
                  <span className="shrink-0 mt-0.5 h-7 w-7 rounded-[5px] bg-brand/10 grid place-items-center">
                    <Icon className="w-4 h-4 text-brand" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {lang === "pl" ? p.labelPl : p.labelEn}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {lang === "pl" ? p.descPl : p.descEn}
                    </span>
                  </span>
                  <Plus className="w-4 h-4 text-muted-foreground self-center" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            {lang === "pl" ? "Układy" : "Layouts"}
          </h4>
          <ul className="flex flex-col gap-1 mb-2">
            {layouts.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(l.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-[5px] text-sm flex items-center justify-between transition ${
                    activeId === l.id
                      ? "bg-brand/10 text-brand font-semibold"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span className="truncate">{l.name}</span>
                  {l.is_default && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-2">
                      {lang === "pl" ? "domyślny" : "default"}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt(
                lang === "pl" ? "Nazwa nowego układu" : "New layout name",
                "custom",
              );
              if (name && name.trim()) createMutation.mutate(name.trim());
            }}
            className="w-full text-xs px-2 py-1.5 rounded-[5px] border border-dashed border-border hover:bg-muted transition"
          >
            + {lang === "pl" ? "Nowy układ" : "New layout"}
          </button>
        </div>
      </aside>

      {/* === Canvas === */}
      <section className="rounded-[5px] border border-border bg-card p-3 min-h-[480px]">
        <header className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="text"
              value={draft?.name ?? ""}
              onChange={(e) =>
                patchDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder={lang === "pl" ? "Nazwa układu" : "Layout name"}
              className="text-sm font-semibold bg-transparent border border-border rounded-[5px] px-2 py-1 min-w-0 flex-1"
            />
            {draft && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={draft.is_default}
                  onChange={(e) =>
                    patchDraft((d) => ({ ...d, is_default: e.target.checked }))
                  }
                />
                {lang === "pl" ? "domyślny" : "default"}
              </label>
            )}
          </div>
          <button
            type="button"
            onClick={() => draft && saveMutation.mutate(draft)}
            disabled={!draft || saveMutation.isPending}
            className="px-3 py-1.5 rounded-[5px] bg-brand text-brand-foreground text-sm font-semibold disabled:opacity-50"
          >
            {saveMutation.isPending
              ? (lang === "pl" ? "Zapisywanie…" : "Saving…")
              : (lang === "pl" ? "Zapisz" : "Save")}
          </button>
        </header>

        {!draft ? (
          <p className="text-sm text-muted-foreground">
            {lang === "pl" ? "Wybierz lub utwórz układ." : "Pick or create a layout."}
          </p>
        ) : draft.widgets.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center border border-dashed border-border rounded-[5px]">
            {lang === "pl"
              ? "Dodaj widget z biblioteki po lewej."
              : "Add a widget from the library on the left."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {draft.widgets.map((w, idx) => {
              const meta = PALETTE.find((p) => p.type === w.type);
              const { Icon } = meta ?? { Icon: PanelLeft };
              const isSelected = selectedWidgetId === w.id;
              return (
                <li
                  key={w.id}
                  className={`rounded-[5px] border bg-background transition ${
                    isSelected ? "border-brand ring-1 ring-brand/40" : "border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedWidgetId(w.id)}
                    className="w-full flex items-center gap-2 p-2 text-left"
                  >
                    <Icon className="w-4 h-4 text-brand shrink-0" />
                    <span className="text-sm font-semibold flex-1 truncate">
                      {meta ? (lang === "pl" ? meta.labelPl : meta.labelEn) : w.type}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      #{idx + 1}
                    </span>
                  </button>
                  <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
                    <IconBtn
                      label={lang === "pl" ? "W górę" : "Move up"}
                      onClick={() => moveWidget(w.id, -1)}
                      disabled={idx === 0}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      label={lang === "pl" ? "W dół" : "Move down"}
                      onClick={() => moveWidget(w.id, 1)}
                      disabled={idx === draft.widgets.length - 1}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      label={w.hidden ? (lang === "pl" ? "Pokaż" : "Show") : (lang === "pl" ? "Ukryj" : "Hide")}
                      onClick={() => toggleHidden(w.id)}
                    >
                      {w.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </IconBtn>
                    <span className="flex-1" />
                    <IconBtn
                      label={lang === "pl" ? "Usuń" : "Delete"}
                      onClick={() => deleteWidget(w.id)}
                      danger
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Live preview */}
        {draft && draft.widgets.some((w) => w.type === "reading-panel" && !w.hidden) && (
          <div className="mt-6">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              {lang === "pl" ? "Podgląd panelu czytania" : "Reading panel preview"}
            </h4>
            <div className="max-w-[280px]">
              <FloatingShareBar
                title={lang === "pl" ? "Przykładowy tytuł wpisu" : "Sample post title"}
                lang={lang}
                variant="sidebar"
                settings={
                  (draft.widgets.find((w) => w.type === "reading-panel" && !w.hidden)
                    ?.settings as Partial<ReadingPanelSettings>) ?? undefined
                }
              />
            </div>
          </div>
        )}
      </section>

      {/* === Inspector === */}
      <aside className="rounded-[5px] border border-border bg-card p-3">
        <h3 className="text-[11px] font-extrabold tracking-[0.18em] mb-3">
          {lang === "pl" ? "USTAWIENIA WIDGETU" : "WIDGET SETTINGS"}
        </h3>
        {!selectedWidget && (
          <p className="text-sm text-muted-foreground">
            {lang === "pl" ? "Wybierz widget na płótnie." : "Select a widget on the canvas."}
          </p>
        )}
        {selectedWidget?.type === "reading-panel" && (
          <ReadingPanelSettingsForm
            lang={lang}
            settings={
              {
                ...DEFAULT_READING_PANEL_SETTINGS,
                ...(selectedWidget.settings as Partial<ReadingPanelSettings>),
                social: {
                  ...DEFAULT_READING_PANEL_SETTINGS.social,
                  ...((selectedWidget.settings as Partial<ReadingPanelSettings>)
                    ?.social ?? {}),
                },
              } as ReadingPanelSettings
            }
            onChange={(patch) => updateSettings(selectedWidget.id, patch)}
          />
        )}
        {selectedWidget && selectedWidget.type !== "reading-panel" && (
          <p className="text-xs text-muted-foreground">
            {lang === "pl"
              ? "Ten widget nie ma dodatkowych opcji."
              : "This widget has no extra options."}
          </p>
        )}
      </aside>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-7 w-7 grid place-items-center rounded-[5px] border border-border transition disabled:opacity-30 ${
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ReadingPanelSettingsForm({
  lang,
  settings,
  onChange,
}: {
  lang: "pl" | "en";
  settings: ReadingPanelSettings;
  onChange: (patch: Partial<ReadingPanelSettings>) => void;
}) {
  const FEATURE_TOGGLES: Array<[keyof ReadingPanelSettings, string, string]> = [
    ["showToc", "Spis treści", "Table of contents"],
    ["showProgress", "Pasek postępu", "Progress bar"],
    ["showSaveLater", "Zapisz później", "Save for later"],
    ["showPrint", "Drukuj", "Print"],
    ["showPdf", "Pobierz PDF", "Download PDF"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          {lang === "pl" ? "Funkcje" : "Features"}
        </h4>
        <ul className="flex flex-col gap-1.5">
          {FEATURE_TOGGLES.map(([k, pl, en]) => (
            <li key={k as string}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(settings[k])}
                  onChange={(e) => onChange({ [k]: e.target.checked } as Partial<ReadingPanelSettings>)}
                />
                {lang === "pl" ? pl : en}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5" />
          {lang === "pl" ? "Platformy społecznościowe" : "Social platforms"}
        </h4>
        <ul className="grid grid-cols-1 gap-1.5">
          {SOCIAL_KEYS.map((k) => (
            <li key={k}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(settings.social[k])}
                  onChange={(e) =>
                    onChange({
                      social: { ...settings.social, [k]: e.target.checked },
                    })
                  }
                />
                {SOCIAL_LABEL[k]}
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
