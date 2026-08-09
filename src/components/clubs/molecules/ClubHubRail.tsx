// Lewa szyna huba - nawigacja po sekcjach klubu i zawężenia.
//
// DLACZEGO PIONOWO, A NIE ZAKŁADKAMI. Poziomy rząd zakładek jest dobry dla
// trzech pozycji i zły dla sześciu: na telefonie chowa połowę za krawędzią,
// a na desktopie zajmuje pełną szerokość treści, żeby pokazać sześć słów.
// Szyna pionowa stoi w kolumnie, która i tak jest pusta, czyta się jak spis
// treści klubu i zostaje na ekranie przy przewijaniu (`sticky`).
//
// DLACZEGO KAFELKI, A NIE LISTA LINIJEK. Sześć linijek tekstu z ikoną 16 px
// to sześć bytów o identycznej wadze - oko nie ma się o co zaczepić i trafia
// w pozycję dopiero po przeczytaniu wszystkich. Kafelek daje każdej sekcji
// własny cel dotyku, ikonę w rozmiarze, który widać kątem oka, i miejsce na
// LICZBĘ: "Dokumenty 12" mówi o klubie coś, czego "Dokumenty" nie powie nigdy.
//
// Cena jest jawna: siatka 2x3 jest o ~50 px WYŻSZA niż sześć linijek. Płacimy
// ją, bo w tej kolumnie pion jest tani (poniżej panelu działów i reżimu zostaje
// puste miejsce na całą wysokość strumienia), a rozpoznawalność pozycji droga.
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
import { useClubGroups } from "@/lib/clubs/useClubs";
import { ClubGroupTree, clubGroupName } from "@/components/clubs/molecules/ClubGroupTree";
import { ClubRegimeMark, hasOwnRegime } from "@/components/clubs/atoms/ClubRegimeMark";
import { toClubAttributionMode } from "@/lib/clubs/types";
import type { ClubAttributionMode, ClubGroupRow, ClubViewRow } from "@/lib/clubs/types";

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

/** Liczby przy kafelkach. Wszystkie są OPCJONALNE: sekcja bez liczby ma
 *  wyglądać jak sekcja, a nie jak sekcja z zerem. */
type SectionCounts = Partial<Record<SectionKey, number>>;

// Wspólny kształt pozycji tekstowej - został przy pasku poziomym i przy
// linku do zasad; szyna ma kafelki.
const ITEM = "flex items-center gap-2.5 rounded-lg font-medium leading-none transition-colors";
const ITEM_MD = "px-2.5 py-2.5 text-sm";
const ITEM_LG = "px-3.5 py-3 text-sm sm:text-[0.9375rem]";
const ITEM_QUIET = "text-muted-foreground hover:bg-muted/60 hover:text-foreground";

// Stan aktywny jedzie przez `data-status`, które `Link` sam dokłada. Klasy
// z `activeProps` są DOKLEJANE do bazowych, więc `text-muted-foreground`
// i `text-primary` trafiłyby do jednego atrybutu i o zwycięzcy decydowałaby
// kolejność reguł w arkuszu, a nie zapis w komponencie. Wariant `data-[...]`
// rozstrzyga to po stronie Tailwinda i pozwala ubrać także IKONĘ w środku.
const TILE =
  "group/tile relative flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-1 py-2.5 text-center text-[11px] font-medium leading-tight text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/60 hover:text-foreground data-[status=active]:border-primary/40 data-[status=active]:bg-primary/10 data-[status=active]:text-primary";

const TILE_CHIP =
  "flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors group-hover/tile:text-foreground group-data-[status=active]/tile:border-primary/30 group-data-[status=active]/tile:bg-primary/15 group-data-[status=active]/tile:text-primary";

function SectionTile({
  to,
  clubSlug,
  icon: Icon,
  label,
  exact,
  count,
}: {
  to: SectionTo;
  clubSlug: string;
  icon: LucideIcon;
  label: string;
  exact: boolean;
  count?: number;
}) {
  return (
    <Link
      to={to}
      params={{ clubSlug }}
      // Sekcja "wątki" celuje w /club/$slug, który jest PREFIKSEM każdej
      // pozostałej trasy klubu - bez dopasowania dokładnego świeciłaby się
      // na wszystkich sześciu ekranach naraz.
      activeOptions={{ exact }}
      className={TILE}
    >
      <span className={TILE_CHIP}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="line-clamp-2 w-full px-0.5">{label}</span>
      {/* Liczba jest OZDOBĄ DLA OKA, nie treścią dla czytnika: nazwa sekcji
          zostaje jedyną nazwą dostępną linku, bo "Dokumenty 12" czytane na
          głos brzmi jak nazwa dokumentu numer dwanaście. */}
      {count !== undefined && count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground group-data-[status=active]/tile:bg-primary/15 group-data-[status=active]/tile:text-primary"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

/** Siatka sekcji - ta sama w hubie i na podstronach przestrzeni roboczej. */
function SectionTiles({
  clubSlug,
  canSeeMembers,
  counts,
}: {
  clubSlug: string;
  canSeeMembers: boolean;
  counts?: SectionCounts;
}) {
  const { t } = useTranslation();
  const visible = SECTIONS.filter((s) => s.key !== "members" || canSeeMembers);
  return (
    <nav aria-label={t("club.hub.sectionsLabel")} className="grid grid-cols-2 gap-1.5">
      {visible.map((section) => (
        <SectionTile
          key={section.key}
          to={section.to}
          clubSlug={clubSlug}
          icon={section.icon}
          label={t(`club.hub.sections.${section.key satisfies SectionKey}`)}
          exact={section.exact}
          count={counts?.[section.key]}
        />
      ))}
    </nav>
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
      className={cn("-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]", className)}
    >
      {visible.map((section) => {
        const Icon = section.icon;
        return (
          <Link
            key={section.key}
            to={section.to}
            params={{ clubSlug }}
            activeOptions={{ exact: section.exact }}
            className={cn(
              ITEM,
              ITEM_LG,
              ITEM_QUIET,
              "shrink-0 whitespace-nowrap border border-border/60 bg-card",
              "data-[status=active]:border-primary/40 data-[status=active]:bg-primary/10 data-[status=active]:text-primary",
            )}
          >
            <Icon className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden="true" />
            <span>{t(`club.hub.sections.${section.key satisfies SectionKey}`)}</span>
          </Link>
        );
      })}
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
  counts,
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
  counts?: SectionCounts;
  hasRules: boolean;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const { topics } = useClubTopics();

  return (
    <div className="space-y-3">
      <ClubRailPanel className="p-2">
        <SectionTiles clubSlug={clubSlug} canSeeMembers={canSeeMembers} counts={counts} />
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
            className={cn(ITEM, ITEM_MD, ITEM_QUIET, "w-full")}
          >
            <ScrollText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("club.rules")}</span>
          </Link>
        </ClubRailPanel>
      ) : null}
    </div>
  );
}

/**
 * Szyna podstron przestrzeni roboczej (biblioteka, kalendarz, harmonogram,
 * pomiar, skład).
 *
 * DLACZEGO TA SAMA, CO W HUBIE. Podstrony miały wcześniej wyłącznie poziomy
 * pasek pigułek, więc ten sam zestaw sekcji miał dwa kształty zależnie od
 * tego, gdzie użytkownik akurat stał. Tu stoi ta sama kolumna, bez filtra
 * działów - dział zawęża STRUMIEŃ, a na bibliotece czy kalendarzu nie miałby
 * czego odsiać.
 */
export function ClubWorkspaceRail({ club, isPl }: { club: ClubViewRow; isPl: boolean }) {
  const { t } = useTranslation();
  const { topics } = useClubTopics();
  const groupsQ = useClubGroups(club.id);
  const groups = groupsQ.data ?? [];
  const hasRules = (isPl ? club.rules_pl : club.rules_en) !== null;

  return (
    <div className="space-y-3">
      <ClubRailPanel className="p-2">
        {/* Podstrona zna tylko liczby, które i tak wiezie wiersz klubu -
            biblioteka i kalendarz mają własne zapytania na SWOICH ekranach
            i szyna nie będzie ich powtarzać po to, żeby narysować plakietkę. */}
        <SectionTiles
          clubSlug={club.slug}
          canSeeMembers={club.can_see_members}
          counts={{ threads: club.thread_count, members: club.member_count }}
        />
      </ClubRailPanel>

      <ClubRegimePanel
        attributionMode={toClubAttributionMode(club.attribution_mode)}
        groups={groups}
        isPl={isPl}
      />

      {club.policy_area !== null && club.policy_area.trim() !== "" ? (
        <ClubRailPanel title={t("club.topic.label")}>
          <ClubTopicChip topic={club.policy_area} lang={isPl ? "pl" : "en"} catalog={topics} />
        </ClubRailPanel>
      ) : null}

      {hasRules ? (
        <ClubRailPanel>
          <Link
            to="/club/$clubSlug/about"
            params={{ clubSlug: club.slug }}
            className={cn(ITEM, ITEM_MD, ITEM_QUIET, "w-full")}
          >
            <ScrollText className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t("club.rules")}</span>
          </Link>
        </ClubRailPanel>
      ) : null}
    </div>
  );
}
