// Left-panel widget library: searchable grid of widgets grouped by category,
// plus a structure picker to add a new section, a saved-section template list
// and the tenant's global widgets (synchronized across pages).
import { useState } from "react";
import {
  Search,
  Layers,
  Trash2,
  Save,
  Clock,
  ChevronDown,
  ChevronRight,
  Globe,
  LayoutDashboard,
  Rows,
} from "@/lib/lucide-shim";
import { WIDGETS, WIDGET_MAP } from "@/lib/builder/registry";
import type { WidgetType } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  useSectionTemplates,
  type SectionTemplate,
  type TemplateRevision,
} from "@/lib/builder/templates";
import {
  STARTER_TEMPLATES,
  starterDescription,
  starterName,
  type StarterTemplate,
} from "@/lib/builder/starterTemplates";
import { useGlobalWidgets, type GlobalWidget } from "@/lib/builder/globalWidgets";
import { GLOBAL_WIDGET_MIME, CONTAINER_MIME } from "./builder/VisualCanvas";
import { TemplateHistoryDialog } from "./TemplateHistoryDialog";
import { StructurePicker } from "./StructurePicker";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

interface Props {
  onPickWidget: (t: WidgetType) => void;
  onPickStructure: (spans: number[]) => void;
  onPickTemplate: (tpl: SectionTemplate) => void;
  onPickStarter?: (tpl: StarterTemplate) => void;
  onPickGlobal?: (g: GlobalWidget) => void;
  onPickContainer?: (withTabs: boolean) => void;
}

export function WidgetLibrary({
  onPickWidget,
  onPickStructure,
  onPickTemplate,
  onPickStarter,
  onPickGlobal,
  onPickContainer,
}: Props) {
  const { t, i18n } = useTranslation();
  const adminLang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const wl = (k: string, o?: Record<string, unknown>) => t(`builder.widgetLibrary.${k}`, o);
  const bl = useBuilderLabel();
  const [search, setSearch] = useState("");
  const [historyOf, setHistoryOf] = useState<SectionTemplate | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("builder.lib.collapsed") || "{}");
    } catch {
      return {};
    }
  });
  const toggle = (key: string) => {
    setCollapsed((p) => {
      const next = { ...p, [key]: !p[key] };
      try {
        localStorage.setItem("builder.lib.collapsed", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const filtered = WIDGETS.filter(
    (w) => !w.hiddenInPalette && bl(w.label).toLowerCase().includes(search.toLowerCase()),
  );
  const labels: Record<string, string> = {
    basic: wl("catBasic"),
    media: wl("catMedia"),
    dynamic: wl("catDynamic"),
    features: wl("catFeatures"),
    form: wl("catForm"),
    navigation: wl("catNavigation"),
    blocks: wl("catBlocks"),
  };
  const categoryOrder = [
    "basic",
    "blocks",
    "media",
    "dynamic",
    "features",
    "form",
    "navigation",
  ] as const;

  // Sub-grouping within each category: keeps the palette scannable when a
  // category grows past ~6 items. Missing entries fall back to "misc" and are
  // rendered last without a subheader when they are the only bucket.
  const SUBGROUPS: Partial<Record<WidgetType, string>> = {
    // basic
    heading: "typography",
    "animated-heading": "typography",
    "text-rotate": "typography",
    text: "typography",
    image: "visual",
    button: "actions",
    divider: "layout",
    spacer: "layout",
    "section-label": "layout",
    // blocks
    accordion: "interactive",
    tabs: "interactive",
    "interactive-circle": "interactive",
    "rich-text": "content",
    testimonial: "content",
    "team-member": "content",
    "author-profile-card": "content",
    "dark-featured-card": "content",
    "rated-list": "content",
    pricing: "marketing",
    "hot-topic-bar": "marketing",
    toc: "content",
    "logo-cloud": "marketing",
    "ad-slot": "marketing",
    timeline: "timeline",
    speakers: "events",
    "event-schedule": "events",
    "event-countdown": "events",
    "event-countdown-card": "events",
    "meeting-booking": "events",
    "event-sponsors": "events",
    // media
    video: "visual",
    gallery: "visual",
    slider: "visual",
    icon: "visual",
    map: "location",
    tts: "audio",
    // dynamic
    "post-list": "listings",
    carousel: "listings",
    "event-list": "listings",
    "news-ticker": "listings",
    "trending-now": "listings",
    "podcast-latest": "listings",
    "club-card": "listings",
    "club-threads": "listings",
    "web-stories-carousel": "listings",
    categories: "taxonomy",
    tags: "taxonomy",
    chart: "dataViz",
    "data-map": "dataViz",
    "world-map": "dataViz",
    "post-title": "singlePost",
    "post-meta": "singlePost",
    "post-tags-dyn": "singlePost",
    "post-categories-dyn": "singlePost",
    "post-author-card": "singlePost",
    "post-breadcrumbs": "singlePost",
    "post-cover": "singlePost",
    "post-excerpt": "singlePost",
    "archive-title": "singlePost",
    // form
    newsletter: "growth",
    cta: "growth",
    "join-us": "growth",
    "customize-interests": "growth",
    donations: "growth",
    "login-form": "account",
    "register-form": "account",
    "lost-password-form": "account",
    "reset-password-form": "account",
    "search-form": "utility",
    "contact-form": "utility",
    contact: "utility",
    "onboarding-form": "utility",
    "progress-carousel": "blocks",
    "circular-carousel": "blocks",
    // navigation
    "nav-link": "menus",
    "mega-menu": "menus",
    menu: "menus",
    "social-icons": "utility",
    "lang-switcher": "utility",
    "theme-toggle": "utility",
    "account-link": "utility",
    "search-button": "utility",
    copyright: "footer",
  };
  const SUBGROUP_ORDER: Record<string, string[]> = {
    basic: ["typography", "visual", "actions", "layout"],
    blocks: ["interactive", "content", "marketing", "events", "timeline"],
    media: ["visual", "audio", "location"],
    dynamic: ["listings", "taxonomy", "dataViz", "singlePost"],
    form: ["growth", "account", "utility"],
    navigation: ["menus", "utility", "footer"],
    features: [],
  };
  const tpl = useSectionTemplates();
  const globals = useGlobalWidgets();
  const filteredGlobals = globals.items.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  );

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
          <Layers className="w-4 h-4" /> {wl("title")}
        </h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={wl("searchPh")}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <section>
          <button
            type="button"
            onClick={() => toggle("__container")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1.5 hover:text-foreground"
          >
            {collapsed.__container ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <LayoutDashboard className="w-3.5 h-3.5" /> {wl("newContainer")}
          </button>
          {!collapsed.__container && (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(CONTAINER_MIME, JSON.stringify({ withTabs: false }));
                  e.dataTransfer.setData("text/plain", "Kontener");
                }}
                onClick={() => onPickContainer?.(false)}
                title={wl("containerTitle")}
                className="h-14 bg-muted/30 hover:bg-brand/10 hover:border-brand border border-border rounded flex flex-col items-center justify-center gap-0.5 px-1 py-0.5 transition group cursor-grab active:cursor-grabbing select-none"
              >
                <LayoutDashboard className="w-4 h-4 text-brand" />
                <span className="text-[9px] text-center leading-tight text-foreground group-hover:text-brand">
                  {wl("container")}
                </span>
              </button>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(CONTAINER_MIME, JSON.stringify({ withTabs: true }));
                  e.dataTransfer.setData("text/plain", wl("containerTabs"));
                }}
                onClick={() => onPickContainer?.(true)}
                title={wl("containerTabsTitle")}
                className="h-14 bg-muted/30 hover:bg-brand/10 hover:border-brand border border-border rounded flex flex-col items-center justify-center gap-0.5 px-1 py-0.5 transition group cursor-grab active:cursor-grabbing select-none"
              >
                <Rows className="w-4 h-4 text-brand" />
                <span className="text-[9px] text-center leading-tight text-foreground group-hover:text-brand">
                  {wl("containerTabs")}
                </span>
              </button>
            </div>
          )}
        </section>

        <section>
          <button
            type="button"
            onClick={() => toggle("__struct")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1 hover:text-foreground"
          >
            {collapsed.__struct ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {wl("newSection")}
          </button>
          {!collapsed.__struct && <StructurePicker onPick={onPickStructure} cols={2} />}
        </section>

        {/* Szablony startowe: wbudowane, wielosekcyjne kompozycje stron
            (wydarzenia, networking, sponsorzy...). Klik wstawia komplet
            sekcji ze swiezymi id - patrz lib/builder/starterTemplates. */}
        {onPickStarter && (
          <section>
            <button
              type="button"
              onClick={() => toggle("__starters")}
              className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1.5 hover:text-foreground"
            >
              {collapsed.__starters ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              <LayoutDashboard className="w-3.5 h-3.5" /> {wl("starters")}
            </button>
            {!collapsed.__starters && (
              <ul className="space-y-1">
                {STARTER_TEMPLATES.filter((tpl) =>
                  starterName(tpl, adminLang).toLowerCase().includes(search.toLowerCase()),
                ).map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => onPickStarter(tpl)}
                      title={
                        wl("insertStarter", { name: starterName(tpl, adminLang) }) +
                        " - " +
                        starterDescription(tpl, adminLang)
                      }
                      className="w-full text-left text-xs px-2 py-1.5 bg-brand/5 hover:bg-brand hover:text-brand-foreground border border-brand/30 rounded space-y-0.5"
                    >
                      <span className="block truncate font-medium">
                        {starterName(tpl, adminLang)}
                      </span>
                      <span className="block truncate text-[10px] opacity-70">
                        {starterDescription(tpl, adminLang)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <button
            type="button"
            onClick={() => toggle("__tpl")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1.5 hover:text-foreground"
          >
            {collapsed.__tpl ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <Save className="w-3.5 h-3.5" /> {wl("templates")}
            {tpl.loading && <span className="text-[10px] normal-case">…</span>}
          </button>
          {!collapsed.__tpl &&
            (tpl.items.length === 0 ? (
              <div className="text-[10px] text-muted-foreground px-2 py-3 border border-dashed border-border rounded">
                {wl("templatesEmpty")}
              </div>
            ) : (
              <ul className="space-y-1">
                {tpl.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-1 group/tpl">
                    <button
                      type="button"
                      onClick={() => onPickTemplate(t)}
                      className="flex-1 text-left text-xs px-2 py-1.5 bg-muted/30 hover:bg-brand hover:text-brand-foreground border border-border rounded truncate"
                    >
                      {t.name}
                    </button>
                    <button
                      type="button"
                      title={wl("versionHistory")}
                      onClick={() => setHistoryOf(t)}
                      className="p-1 text-muted-foreground hover:text-brand opacity-0 group-hover/tpl:opacity-100 transition"
                    >
                      <Clock className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      title={wl("deleteTemplate")}
                      onClick={() => {
                        if (confirm(wl("confirmDeleteTemplate", { name: t.name })))
                          void tpl.remove(t.id);
                      }}
                      className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover/tpl:opacity-100 transition"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </section>

        <section>
          <button
            type="button"
            onClick={() => toggle("__global")}
            className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1.5 hover:text-foreground"
          >
            {collapsed.__global ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            <Globe className="w-3.5 h-3.5" /> {wl("globals")}
            {globals.loading && <span className="text-[10px] normal-case">…</span>}
          </button>
          {!collapsed.__global &&
            (filteredGlobals.length === 0 ? (
              <div className="text-[10px] text-muted-foreground px-2 py-3 border border-dashed border-border rounded">
                {wl("globalsEmpty")}
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredGlobals.map((g) => {
                  const def = WIDGET_MAP[g.data.type];
                  const Icon = def?.icon ?? Globe;
                  return (
                    <li key={g.id} className="flex items-center gap-1 group/gw">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            GLOBAL_WIDGET_MIME,
                            JSON.stringify({ id: g.id, data: g.data }),
                          );
                          e.dataTransfer.setData("application/x-widget-type", g.data.type);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onPickGlobal?.(g)}
                        title={wl("insertGlobal", {
                          name: g.name,
                          label: bl(def?.label) ?? g.data.type,
                        })}
                        className="flex-1 min-w-0 text-left text-xs px-2 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 rounded inline-flex items-center gap-1.5 cursor-grab active:cursor-grabbing"
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                        <span className="truncate">{g.name}</span>
                      </button>
                      <button
                        type="button"
                        title={wl("deleteGlobal")}
                        onClick={() => {
                          if (confirm(wl("confirmDeleteGlobal", { name: g.name })))
                            void globals.remove(g.id);
                        }}
                        className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover/gw:opacity-100 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ))}
        </section>

        {categoryOrder.map((cat) => {
          const items = filtered.filter((w) => w.category === cat);
          if (!items.length) return null;
          const isCollapsed = !!collapsed[cat];
          return (
            <section key={cat}>
              <button
                type="button"
                onClick={() => toggle(cat)}
                className="w-full text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider inline-flex items-center gap-1 hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                {labels[cat]}
                <span className="ml-1 text-[10px] normal-case opacity-60">({items.length})</span>
              </button>
              {!isCollapsed &&
                (() => {
                  const renderTile = (w: (typeof items)[number]) => {
                    const Icon = w.icon;
                    return (
                      <div
                        key={w.type}
                        draggable
                        role="button"
                        tabIndex={0}
                        aria-label={wl("dragToSection", { label: bl(w.label) })}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-widget-type", w.type);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onPickWidget?.(w.type)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onPickWidget?.(w.type);
                          }
                        }}
                        className="h-12 bg-muted/30 hover:bg-brand/10 hover:border-brand border border-border rounded flex flex-col items-center justify-center gap-0.5 px-1 py-0.5 transition group cursor-grab active:cursor-grabbing select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                        title={wl("dragToSection", { label: bl(w.label) })}
                      >
                        <Icon className="w-3.5 h-3.5 text-brand group-hover:text-brand" />
                        <span className="text-[8px] text-center leading-[1.05] text-foreground group-hover:text-brand line-clamp-2">
                          {bl(w.label)}
                        </span>
                      </div>
                    );
                  };

                  const order = SUBGROUP_ORDER[cat] ?? [];
                  // Group items by subgroup key; fall back to "misc" for unmapped.
                  const buckets = new Map<string, typeof items>();
                  for (const w of items) {
                    const key = SUBGROUPS[w.type] ?? "misc";
                    const arr = buckets.get(key) ?? [];
                    arr.push(w);
                    buckets.set(key, arr);
                  }
                  // Preserve declared order, then append unknown subgroups alphabetically.
                  const keys = [
                    ...order.filter((k) => buckets.has(k)),
                    ...[...buckets.keys()]
                      .filter((k) => !order.includes(k))
                      .sort((a, b) => a.localeCompare(b)),
                  ];
                  const showHeaders = keys.length > 1 || (keys.length === 1 && keys[0] !== "misc");

                  // When search is active we skip subgroup headers to keep results compact.
                  if (search.trim().length > 0 || !showHeaders) {
                    return <div className="grid grid-cols-2 gap-1.5">{items.map(renderTile)}</div>;
                  }

                  return (
                    <div className="space-y-2.5">
                      {keys.map((key) => {
                        const arr = buckets.get(key) ?? [];
                        if (!arr.length) return null;
                        const subKey = `${cat}__${key}`;
                        const subCollapsed = !!collapsed[subKey];
                        const label = key === "misc" ? "" : wl(`sub.${key}`);
                        return (
                          <div key={key}>
                            <button
                              type="button"
                              onClick={() => toggle(subKey)}
                              className="w-full text-[10px] font-medium text-muted-foreground/80 mb-1 inline-flex items-center gap-1 hover:text-foreground tracking-wide"
                            >
                              {subCollapsed ? (
                                <ChevronRight className="w-2.5 h-2.5" />
                              ) : (
                                <ChevronDown className="w-2.5 h-2.5" />
                              )}
                              <span className="uppercase">{label}</span>
                              <span className="ml-0.5 opacity-60">({arr.length})</span>
                            </button>
                            {!subCollapsed && (
                              <div className="grid grid-cols-2 gap-1.5">{arr.map(renderTile)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
            </section>
          );
        })}
      </div>

      <TemplateHistoryDialog
        template={historyOf}
        open={!!historyOf}
        onOpenChange={(o) => {
          if (!o) setHistoryOf(null);
        }}
        onInsert={insertRevision}
        onRestore={(r) => {
          void restoreToTemplate(r);
        }}
      />
    </div>
  );
}
