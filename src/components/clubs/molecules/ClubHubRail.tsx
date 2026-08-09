// Lewa szyna huba - nawigacja po sekcjach klubu i zawężenia.
//
// DLACZEGO PIONOWO, A NIE ZAKŁADKAMI. Poziomy rząd zakładek jest dobry dla
// trzech pozycji i zły dla sześciu: na telefonie chowa połowę za krawędzią,
// a na desktopie zajmuje pełną szerokość treści, żeby pokazać sześć słów.
// Szyna pionowa stoi w kolumnie, która i tak jest pusta, czyta się jak spis
// treści klubu i zostaje na ekranie przy przewijaniu (`sticky`).
//
// Na telefonie ta sama lista wraca jako poziomy pasek - tam kolumna nie
// istnieje, a spis treści musi zmieścić się w jednym rzędzie.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Layers,
  ListChecks,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { ClubGroupTree, clubGroupName } from "@/components/clubs/molecules/ClubGroupTree";
import { ClubRegimeMark, hasOwnRegime } from "@/components/clubs/atoms/ClubRegimeMark";
import type { ClubAttributionMode, ClubGroupRow } from "@/lib/clubs/types";

const SECTIONS = [
  { key: "threads", to: "/club/$clubSlug", icon: MessagesSquare, exact: true },
  { key: "documents", to: "/club/$clubSlug/documents", icon: FileText, exact: false },
  { key: "calendar", to: "/club/$clubSlug/calendar", icon: CalendarDays, exact: false },
  { key: "schedule", to: "/club/$clubSlug/schedule", icon: ListChecks, exact: false },
  { key: "insights", to: "/club/$clubSlug/insights", icon: BarChart3, exact: false },
  { key: "members", to: "/club/$clubSlug/members", icon: Users2, exact: false },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
/** Unia LITERAŁÓW tras - `string` zamieniłby literówkę w martwy link. */
type SectionTo = (typeof SECTIONS)[number]["to"];

// Jedna pozycja nawigacji ma dwa rozmiary, nie dwa kształty: `md` w szynie
// (kolumna 13,5 rem), `lg` w pasku poziomym, gdzie pozycja jest jedynym
// celem dotyku na ekranie i musi mieć wysokość przycisku.
const ITEM =
  "flex items-center gap-2.5 rounded-lg font-medium leading-none transition-colors";
const ITEM_MD = "px-2.5 py-2.5 text-sm";
const ITEM_LG = "px-3.5 py-3 text-sm sm:text-[0.9375rem]";
const ITEM_QUIET = "text-muted-foreground hover:bg-muted/60 hover:text-foreground";
const ITEM_ACTIVE = "bg-primary/10 text-primary";

function SectionLink({
  to,
  clubSlug,
  icon: Icon,
  label,
  exact,
  compact,
}: {
  to: SectionTo;
  clubSlug: string;
  icon: LucideIcon;
  label: string;
  exact: boolean;
  compact: boolean;
}) {
  const size = compact ? ITEM_LG : ITEM_MD;
  return (
    <Link
      to={to}
      params={{ clubSlug }}
      // Sekcja "wątki" celuje w /club/$slug, który jest PREFIKSEM każdej
      // pozostałej trasy klubu - bez dopasowania dokładnego świeciłaby się
      // na wszystkich sześciu ekranach naraz.
      activeOptions={{ exact }}
      className={cn(
        ITEM,
        size,
        ITEM_QUIET,
        compact && "shrink-0 border border-border/60 bg-card whitespace-nowrap",
      )}
      activeProps={{
        className: cn(
          ITEM,
          size,
          ITEM_ACTIVE,
          compact && "shrink-0 border border-primary/40 bg-primary/10 whitespace-nowrap",
        ),
      }}
    >
      <Icon className={cn("shrink-0", compact ? "h-[1.125rem] w-[1.125rem]" : "h-4 w-4")} aria-hidden="true" />
      <span className={compact ? "" : "truncate"}>{label}</span>
    </Link>
  );
}

/** Poziomy wariant na telefon i tablet - ta sama lista, inny nośnik. */
export function ClubHubSectionBar({
  clubSlug,
  canSeeMembers,
  className,
}: {
  clubSlug: string;
  canSeeMembers: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const visible = SECTIONS.filter((s) => s.key !== "members" || canSeeMembers);
  return (
    <nav
      aria-label={t("club.hub.sectionsLabel")}
      className={cn(
        "-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]",
        className,
      )}
    >
      {visible.map((section) => (
        <SectionLink
          key={section.key}
          to={section.to}
          clubSlug={clubSlug}
          icon={section.icon}
          label={t(`club.hub.sections.${section.key satisfies SectionKey}`)}
          exact={section.exact}
          compact
        />
      ))}
    </nav>
  );
}

/**
 * Panel reżimu - czwarta oś klubu, do tej pory widoczna wyłącznie w panelu
 * administracyjnym.
 *
 * Zdanie o atrybucji KLUBU stoi zawsze, bo dotyczy każdej wypowiedzi. Lista
 * działów pojawia się tylko wtedy, gdy któryś reżim NADPISUJE - klub, w którym
 * wszystko dziedziczy, dostaje jedno zdanie zamiast listy powtarzającej to
 * samo przy każdej pozycji.
 */
function ClubRegimePanel({
  attributionMode,
  groups,
  isPl,
}: {
  attributionMode: ClubAttributionMode;
  groups: readonly ClubGroupRow[];
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const exceptions = groups.filter(hasOwnRegime);

  return (
    <ClubRailPanel title={t("club.regime.title")} icon={ShieldCheck}>
      <p className="text-xs leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">
          {t(`club.attribution.${attributionMode}`)}
        </span>{" "}
        {t(`club.attributionHint.${attributionMode}`)}
      </p>
      {exceptions.length > 0 ? (
        <div className="mt-2.5 space-y-1 border-t border-border/60 pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("club.regime.exceptions")}
          </p>
          <ul className="space-y-1">
            {exceptions.map((group) => (
              <li key={group.id} className="flex items-center gap-1.5 text-xs">
                <ClubRegimeMark group={group} />
                <span className="min-w-0 flex-1 truncate">{clubGroupName(group, isPl)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ClubRailPanel>
  );
}

export function ClubHubRail({
  clubSlug,
  canSeeMembers,
  groups,
  policyArea,
  attributionMode,
  activeGroupId,
  onGroupChange,
  hasRules,
  isPl,
}: {
  clubSlug: string;
  canSeeMembers: boolean;
  groups: readonly ClubGroupRow[];
  policyArea: string | null;
  attributionMode: ClubAttributionMode;
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  hasRules: boolean;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const { topics } = useClubTopics();
  const visible = SECTIONS.filter((s) => s.key !== "members" || canSeeMembers);

  return (
    <div className="space-y-3">
      <ClubRailPanel className="p-2">
        <nav aria-label={t("club.hub.sectionsLabel")} className="flex flex-col gap-0.5">
          {visible.map((section) => (
            <SectionLink
              key={section.key}
              to={section.to}
              clubSlug={clubSlug}
              icon={section.icon}
              label={t(`club.hub.sections.${section.key satisfies SectionKey}`)}
              exact={section.exact}
              compact={false}
            />
          ))}
        </nav>
      </ClubRailPanel>

      {/* Działy klubu są ZAWĘŻENIEM strumienia, nie osobną trasą - dlatego
          stoją w szynie jako filtr, a nie w nawigacji jako sekcja. */}
      {groups.length > 0 ? (
        <ClubRailPanel title={t("club.groups")} icon={Layers}>
          <ClubGroupTree
            groups={groups}
            activeGroupId={activeGroupId}
            onGroupChange={onGroupChange}
            isPl={isPl}
          />
        </ClubRailPanel>
      ) : null}


      <ClubRegimePanel attributionMode={attributionMode} groups={groups} isPl={isPl} />

      {policyArea !== null && policyArea.trim() !== "" ? (
        <ClubRailPanel title={t("club.topic.label")}>
          <ClubTopicChip topic={policyArea} lang={isPl ? "pl" : "en"} catalog={topics} />
        </ClubRailPanel>
      ) : null}

      {hasRules ? (
        <ClubRailPanel>
          <Link
            to="/club/$clubSlug/about"
            params={{ clubSlug }}
            className={cn(ITEM, ITEM_QUIET, "w-full")}
          >
            <ScrollText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("club.rules")}</span>
          </Link>
        </ClubRailPanel>
      ) : null}
    </div>
  );
}
