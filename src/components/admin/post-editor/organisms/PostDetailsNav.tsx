// Organizm: boczna nawigacja kroku "Szczegóły" edytora wpisu. Grupy zakładek
// metadanych; etykiety i podpowiedzi są w pełni i18n (PL/EN). Wyodrębnione z
// trasy admin.posts.$slug - grupy i kolejność bez zmian.
import { useTranslation } from "react-i18next";
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
import "@/lib/i18n-admin-post-panes";

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
  labelKey: string;
  icon: typeof SettingsIcon;
  hintKey?: string;
};

const GROUPS: { id: string; labelKey: string; tabs: TabDef[] }[] = [
  {
    id: "content",
    labelKey: "adminPostPanes.nav.groupContent",
    tabs: [
      {
        id: "general",
        labelKey: "adminPostPanes.nav.general",
        icon: FileText,
        hintKey: "adminPostPanes.nav.generalHint",
      },
      {
        id: "takeaways",
        labelKey: "adminPostPanes.nav.takeaways",
        icon: ListChecks,
        hintKey: "adminPostPanes.nav.takeawaysHint",
      },
      {
        id: "audio",
        labelKey: "adminPostPanes.nav.audio",
        icon: Mic,
        hintKey: "adminPostPanes.nav.audioHint",
      },
    ],
  },
  {
    id: "structure",
    labelKey: "adminPostPanes.nav.groupStructure",
    tabs: [
      {
        id: "settings",
        labelKey: "adminPostPanes.nav.settings",
        icon: SettingsIcon,
        hintKey: "adminPostPanes.nav.settingsHint",
      },
      {
        id: "layout",
        labelKey: "adminPostPanes.nav.layout",
        icon: Layers,
        hintKey: "adminPostPanes.nav.layoutHint",
      },
      { id: "taxonomy", labelKey: "adminPostPanes.nav.taxonomy", icon: TagIcon },
      {
        id: "related",
        labelKey: "adminPostPanes.nav.related",
        icon: LinkIconLucide,
        hintKey: "adminPostPanes.nav.relatedHint",
      },
    ],
  },
  {
    id: "seo",
    labelKey: "adminPostPanes.nav.groupSeoMeta",
    tabs: [
      {
        id: "seo",
        labelKey: "adminPostPanes.nav.seo",
        icon: Search,
        hintKey: "adminPostPanes.nav.seoHint",
      },
      {
        id: "meta",
        labelKey: "adminPostPanes.nav.meta",
        icon: Database,
        hintKey: "adminPostPanes.nav.metaHint",
      },
    ],
  },
  {
    id: "publication",
    labelKey: "adminPostPanes.nav.groupPublication",
    tabs: [
      {
        id: "publish",
        labelKey: "adminPostPanes.nav.publish",
        icon: SettingsIcon,
        hintKey: "adminPostPanes.nav.publishHint",
      },
      {
        id: "access",
        labelKey: "adminPostPanes.nav.access",
        icon: Lock,
        hintKey: "adminPostPanes.nav.accessHint",
      },
    ],
  },
  {
    id: "history",
    labelKey: "adminPostPanes.nav.groupHistory",
    tabs: [{ id: "revisions", labelKey: "adminPostPanes.nav.revisions", icon: History }],
  },
];

export function PostDetailsNav({
  active,
  onSelect,
}: {
  active: DetailsTab;
  onSelect: (tab: DetailsTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="md:w-64 shrink-0">
      <nav className="bg-card border border-border rounded-lg p-2 space-y-3 sticky top-4">
        {GROUPS.map((group, gi) => (
          <div key={group.id} className={gi > 0 ? "pt-2 border-t border-border" : ""}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {t(group.labelKey)}
            </div>
            <div className="space-y-0.5">
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = active === tab.id;
                const hint = tab.hintKey ? t(tab.hintKey) : undefined;
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
                      <span className="block font-medium leading-tight">{t(tab.labelKey)}</span>
                      {hint && (
                        <span
                          className={`block text-[11px] leading-tight mt-0.5 ${
                            isActive ? "text-brand-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {hint}
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
