// Boczna nawigacja kroku "Szczegóły" edytora wpisu: grupy zakładek metadanych.
// Wyodrębnione 1:1 z trasy admin.posts.$slug (grupy i etykiety bez zmian).
import {
  FileText,
  Settings as SettingsIcon,
  Layers,
  Search,
  Tags as TagIcon,
  Lock,
  Link as LinkIconLucide,
  Mic,
} from "@/lib/lucide-shim";
import { History, Database, ListChecks } from "lucide-react";

export type DetailsTab =
  | "general"
  | "takeaways"
  | "settings"
  | "seo"
  | "meta"
  | "related"
  | "publish"
  | "layout"
  | "taxonomy"
  | "access"
  | "audio"
  | "revisions";

type TabDef = {
  id: DetailsTab;
  label: string;
  icon: typeof SettingsIcon;
  hint?: string;
};

const GROUPS: { id: string; label: string; tabs: TabDef[] }[] = [
  {
    id: "content",
    label: "Treść",
    tabs: [
      { id: "general", label: "Ogólne", icon: FileText, hint: "Tytuły i zajawki" },
      {
        id: "takeaways",
        label: "Dowiesz się…",
        icon: ListChecks,
        hint: "Kluczowe punkty PL/EN + wariant",
      },
      {
        id: "audio",
        label: "Audio (MP3)",
        icon: Mic,
        hint: "PL/EN · fallback do lektora AI",
      },
    ],
  },
  {
    id: "structure",
    label: "Struktura",
    tabs: [
      {
        id: "settings",
        label: "Ustawienia strony",
        icon: SettingsIcon,
        hint: "Spis treści · Ochrona treści",
      },
      { id: "layout", label: "Layout", icon: Layers, hint: "Format i wygląd" },
      { id: "taxonomy", label: "Kategorie i tagi", icon: TagIcon },
      {
        id: "related",
        label: "Powiązane wpisy",
        icon: LinkIconLucide,
        hint: "Override",
      },
    ],
  },
  {
    id: "seo",
    label: "SEO i meta",
    tabs: [
      {
        id: "seo",
        label: "SEO i podgląd",
        icon: Search,
        hint: "Meta title/description, OG",
      },
      { id: "meta", label: "Custom meta", icon: Database, hint: "Własne pola" },
    ],
  },
  {
    id: "publication",
    label: "Publikacja",
    tabs: [
      {
        id: "publish",
        label: "Publikacja",
        icon: SettingsIcon,
        hint: "Status, slug, cover",
      },
      { id: "access", label: "Dostęp", icon: Lock, hint: "Paywall / role" },
    ],
  },
  {
    id: "history",
    label: "Historia",
    tabs: [{ id: "revisions", label: "Historia zmian", icon: History }],
  },
];

export function PostDetailsNav({
  active,
  onSelect,
}: {
  active: DetailsTab;
  onSelect: (tab: DetailsTab) => void;
}) {
  return (
    <aside className="md:w-64 shrink-0">
      <nav className="bg-card border border-border rounded-lg p-2 space-y-3 sticky top-4">
        {GROUPS.map((group, gi) => (
          <div key={group.id} className={gi > 0 ? "pt-2 border-t border-border" : ""}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = active === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelect(tab.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-start gap-2.5 ${
                      isActive ? "bg-brand text-brand-foreground" : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? "" : "text-muted-foreground"}`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium leading-tight">{tab.label}</span>
                      {tab.hint && (
                        <span
                          className={`block text-[11px] leading-tight mt-0.5 ${
                            isActive ? "text-brand-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {tab.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
