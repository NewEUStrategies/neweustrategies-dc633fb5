// Edytor konfiguracji mobilnego drawera - tylko dla super_admina.
// Poziom trasy pod `/admin/*`, więc AdminShell + gate `useAuth` już działa;
// tu dokładamy dodatkowy client-side redirect dla nie-super-adminów.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_DRAWER_CONFIG,
  DRAWER_SECTIONS,
  NAV_ICONS,
  drawerConfigSchema,
  type DrawerConfig,
  type DrawerSection,
  type NavIcon,
  type NavItem,
} from "@/lib/mobileDrawer";
import { mobileDrawerConfigQueryOptions } from "@/lib/queries/mobileDrawer";
import { upsertMobileDrawerConfig } from "@/lib/mobileDrawer.functions";

export const Route = createFileRoute("/admin/super/mobile-drawer")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Mobile drawer - super admin" },
    ],
  }),
  component: MobileDrawerEditor,
});

const SECTION_LABELS: Record<DrawerSection, { pl: string; en: string; desc: { pl: string; en: string } }> = {
  top_tools: {
    pl: "Narzędzia",
    en: "Tools",
    desc: { pl: "Wyszukiwarka, motyw, język", en: "Search, theme, language" },
  },
  account: {
    pl: "Moje konto",
    en: "My account",
    desc: { pl: "Logowanie / panel / wyloguj", en: "Sign in / dashboard / sign out" },
  },
  nav: {
    pl: "Nawigacja",
    en: "Navigation",
    desc: { pl: "Pozycje menu zdefiniowane poniżej", en: "Menu items defined below" },
  },
  builder: {
    pl: "Widgety z buildera",
    en: "Builder widgets",
    desc: {
      pl: "Zawartość zbudowana w Wygląd -> Nagłówek",
      en: "Content authored in Appearance -> Header",
    },
  },
};

function MobileDrawerEditor() {
  const navigate = useNavigate();
  const { isSuperAdmin, loading } = useAuth();
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const t = (pl: string, en: string) => (isPl ? pl : en);

  useEffect(() => {
    if (!loading && !isSuperAdmin) navigate({ to: "/admin" });
  }, [loading, isSuperAdmin, navigate]);

  const { data: initial } = useSuspenseQuery(mobileDrawerConfigQueryOptions);
  const [config, setConfig] = useState<DrawerConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const upsert = useServerFn(upsertMobileDrawerConfig);
  const queryClient = useQueryClient();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (!isSuperAdmin) return null;

  const onSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setConfig((cfg) => {
      const oldIndex = cfg.section_order.indexOf(active.id as DrawerSection);
      const newIndex = cfg.section_order.indexOf(over.id as DrawerSection);
      if (oldIndex < 0 || newIndex < 0) return cfg;
      return { ...cfg, section_order: arrayMove(cfg.section_order, oldIndex, newIndex) };
    });
  };

  const onNavDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setConfig((cfg) => {
      const oldIndex = cfg.nav_items.findIndex((i) => i.id === active.id);
      const newIndex = cfg.nav_items.findIndex((i) => i.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return cfg;
      return { ...cfg, nav_items: arrayMove(cfg.nav_items, oldIndex, newIndex) };
    });
  };

  const addNavItem = () => {
    const id = `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setConfig((cfg) => ({
      ...cfg,
      nav_items: [
        ...cfg.nav_items,
        { id, label_pl: t("Nowa pozycja", "New item"), label_en: "New item", href: "/", icon: "link", enabled: true },
      ],
    }));
  };

  const updateNavItem = (id: string, patch: Partial<NavItem>) => {
    setConfig((cfg) => ({
      ...cfg,
      nav_items: cfg.nav_items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  };
  const removeNavItem = (id: string) => {
    setConfig((cfg) => ({ ...cfg, nav_items: cfg.nav_items.filter((i) => i.id !== id) }));
  };

  const resetDefaults = () => setConfig(DEFAULT_DRAWER_CONFIG);

  const handleSave = async () => {
    setMessage(null);
    const parsed = drawerConfigSchema.safeParse(config);
    if (!parsed.success) {
      setMessage({ kind: "err", text: parsed.error.issues.map((i) => i.message).join(", ") });
      return;
    }
    setSaving(true);
    try {
      const saved = await upsert({ data: parsed.data });
      setConfig(saved);
      queryClient.setQueryData(mobileDrawerConfigQueryOptions.queryKey, saved);
      setMessage({ kind: "ok", text: t("Zapisano.", "Saved.") });
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : t("Błąd zapisu", "Save error"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <header className="space-y-1">
        <p className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
          {t("Super-admin", "Super-admin")}
        </p>
        <h1 className="text-2xl font-bold">{t("Mobilne menu", "Mobile menu")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Uporządkuj bloki mobilnego drawera i zdefiniuj pozycje nawigacji.",
            "Reorder mobile drawer blocks and define navigation items.",
          )}
        </p>
      </header>

      {/* Section order */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider">
            {t("Kolejność bloków", "Block order")}
          </h2>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDragEnd}>
          <SortableContext items={config.section_order} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border">
              {config.section_order.map((section) => (
                <SortableSectionRow
                  key={section}
                  section={section}
                  label={SECTION_LABELS[section][isPl ? "pl" : "en"]}
                  desc={SECTION_LABELS[section].desc[isPl ? "pl" : "en"]}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {DRAWER_SECTIONS.some((s) => !config.section_order.includes(s)) && (
          <div className="p-3 border-t border-border bg-muted/30 text-xs">
            {t("Brakujące bloki: ", "Missing blocks: ")}
            {DRAWER_SECTIONS.filter((s) => !config.section_order.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() =>
                  setConfig((cfg) => ({ ...cfg, section_order: [...cfg.section_order, s] }))
                }
                className="ml-2 underline"
              >
                + {SECTION_LABELS[s][isPl ? "pl" : "en"]}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Top tools toggles */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider">
            {t("Górny pas narzędzi", "Top tools")}
          </h2>
        </div>
        <div className="p-4 flex flex-wrap gap-4">
          {(["search", "theme", "language"] as const).map((key) => (
            <label key={key} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.top_tools[key]}
                onChange={(e) =>
                  setConfig((cfg) => ({
                    ...cfg,
                    top_tools: { ...cfg.top_tools, [key]: e.target.checked },
                  }))
                }
              />
              {key === "search" && t("Wyszukiwarka", "Search")}
              {key === "theme" && t("Motyw", "Theme")}
              {key === "language" && t("Język", "Language")}
            </label>
          ))}
        </div>
      </section>

      {/* Nav items */}
      <section className="rounded-lg border border-border bg-card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider">
            {t("Pozycje nawigacji", "Navigation items")}
          </h2>
          <button
            type="button"
            onClick={addNavItem}
            disabled={config.nav_items.length >= 20}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("Dodaj", "Add")}
          </button>
        </div>
        {config.nav_items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t("Brak pozycji - sekcja nawigacji nie pokaże się w drawerze.", "No items - the navigation section will be hidden in the drawer.")}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onNavDragEnd}>
            <SortableContext
              items={config.nav_items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="divide-y divide-border">
                {config.nav_items.map((item) => (
                  <SortableNavRow
                    key={item.id}
                    item={item}
                    onChange={(patch) => updateNavItem(item.id, patch)}
                    onRemove={() => removeNavItem(item.id)}
                    isPl={isPl}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t("Zapisz", "Save")}
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border text-sm hover:bg-muted transition"
        >
          {t("Przywróć domyślne", "Reset to defaults")}
        </button>
        {message && (
          <span
            role="status"
            className={`text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-destructive"}`}
          >
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function SortableSectionRow({
  section,
  label,
  desc,
}: {
  section: DrawerSection;
  label: string;
  desc: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 p-3 bg-background">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        aria-label="Drag"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </li>
  );
}

function SortableNavRow({
  item,
  onChange,
  onRemove,
  isPl,
}: {
  item: NavItem;
  onChange: (patch: Partial<NavItem>) => void;
  onRemove: () => void;
  isPl: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const t = (pl: string, en: string) => (isPl ? pl : en);
  const inputCls =
    "w-full h-9 px-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  return (
    <li ref={setNodeRef} style={style} className="p-3 bg-background">
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-2 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
          aria-label="Drag"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-xs">
            {t("Etykieta PL", "Label PL")}
            <input
              className={inputCls}
              value={item.label_pl}
              onChange={(e) => onChange({ label_pl: e.target.value })}
              maxLength={80}
            />
          </label>
          <label className="text-xs">
            {t("Etykieta EN", "Label EN")}
            <input
              className={inputCls}
              value={item.label_en}
              onChange={(e) => onChange({ label_en: e.target.value })}
              maxLength={80}
            />
          </label>
          <label className="text-xs md:col-span-2">
            {t("URL (/ ścieżka lub https://...)", "URL (/path or https://...)")}
            <input
              className={inputCls}
              value={item.href}
              onChange={(e) => onChange({ href: e.target.value })}
              maxLength={500}
              placeholder="/blog"
            />
          </label>
          <label className="text-xs">
            {t("Ikona", "Icon")}
            <select
              className={inputCls}
              value={item.icon}
              onChange={(e) => onChange({ icon: e.target.value as NavIcon })}
            >
              {NAV_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs inline-flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            {t("Aktywny", "Enabled")}
          </label>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("Usuń", "Remove")}
          className="mt-1 inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-destructive hover:bg-destructive/10 transition"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}
