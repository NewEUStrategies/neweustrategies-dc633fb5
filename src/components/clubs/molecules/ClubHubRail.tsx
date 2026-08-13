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
// DWIE KOLUMNY, NIE TRZY - sprawdzone, nie wybrane. Wzorzec, z którego to jest
// wzięte, ma siatkę 3x2, ale jego etykiety są jednosylabowe ("Czat", "Biuro").
// "Harmonogram" w kolumnie 15 rem / 3 nie mieści się ani w jednej linii, ani
// w dwóch (to jedno słowo, nie ma gdzie go złamać) i zostaje ucięte w połowie.
// Wierne przepisanie wzorca dałoby tu gorszy wynik niż odstępstwo od niego.
//
// Na telefonie ta sama lista wraca jako poziomy pasek - tam kolumna nie
// istnieje, a spis treści musi zmieścić się w jednym rzędzie.
import { Link } from "@tanstack/react-router";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Layers,
  ListChecks,
  Megaphone,
  MessagesSquare,
  ScrollText,
  GraduationCap,
  UserRoundSearch,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClubRailPanel } from "@/components/clubs/atoms/ClubHubPrimitives";
import { ClubTopicChip } from "@/components/clubs/atoms/ClubTopicChip";
import { useClubTopics } from "@/lib/clubs/useClubTopics";
import { ClubGroupTree } from "@/components/clubs/molecules/ClubGroupTree";
import type { ClubGroupRow, ClubViewRow } from "@/lib/clubs/types";

// DLACZEGO TRZY GRUPY, A NIE JEDNA SIATKA. Do A31 sekcji było sześć i płaska
// siatka 2x3 czytała się jednym rzutem oka. Po A32/A33 jest ich dziewięć,
// a dziewięć jednakowych kafelków to nie jest spis treści, tylko ściana -
// żeby znaleźć „Tablicę", trzeba przeczytać wszystkie.
//
// Podział idzie po PYTANIU, które sekcja obsługuje, a nie po dacie dodania:
//   * KLUB   - o czym tu mowa i z czego się to bierze,
//   * LUDZIE - kto tu jest i z kim się odezwać,
//   * PRACA  - co i kiedy się dzieje.
//
// Sekcja „Dorobek" wypadła stąd w A34 razem z całym modułem - pytanie „co ten
// klub wytworzył" ma już odpowiedź w bibliotece i drugi kafelek obok niej
// mówił to samo innym słowem.
//
// Grupa „ludzie" jest w całości nowa i to jest teza tej przebudowy: klub
// think tanku ma tyle samo powierzchni o ludziach, co o treści.
const SECTIONS = [
  { key: "threads", to: "/club/$clubSlug", icon: MessagesSquare, exact: true, group: "club" },
  {
    key: "documents",
    to: "/club/$clubSlug/documents",
    icon: FileText,
    exact: false,
    group: "club",
  },

  { key: "members", to: "/club/$clubSlug/members", icon: Users2, exact: false, group: "people" },
  {
    key: "experts",
    to: "/club/$clubSlug/experts",
    icon: GraduationCap,
    exact: false,
    group: "people",
  },
  { key: "board", to: "/club/$clubSlug/board", icon: Megaphone, exact: false, group: "people" },
  {
    key: "spotlight",
    to: "/club/$clubSlug/spotlight",
    icon: UserRoundSearch,
    exact: false,
    group: "people",
  },

  {
    key: "calendar",
    to: "/club/$clubSlug/calendar",
    icon: CalendarDays,
    exact: false,
    group: "work",
  },
  {
    key: "schedule",
    to: "/club/$clubSlug/schedule",
    icon: ListChecks,
    exact: false,
    group: "work",
  },
  { key: "insights", to: "/club/$clubSlug/insights", icon: BarChart3, exact: false, group: "work" },
] as const;

/** Kolejność grup jest kolejnością pytań - patrz komentarz wyżej. */
const SECTION_GROUPS = ["club", "people", "work"] as const;
type SectionGroup = (typeof SECTION_GROUPS)[number];

/** Sekcje mówiące o LUDZIACH milkną tam, gdzie klub ukrywa skład. */
const PEOPLE_SECTIONS: readonly string[] = ["members", "experts", "spotlight"];

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
  "group/tile relative flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-1 py-2.5 text-center text-[11px] font-medium leading-tight text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/60 hover:text-foreground data-[status=active]:border-primary data-[status=active]:bg-primary/10 data-[status=active]:font-semibold data-[status=active]:text-foreground";

// Aktywna ikona w JASNYM motywie jedzie na PEŁNYM primary z `primary-foreground`:
// przezroczysta poświata primary/15 dawała ikonę ledwo odróżnialną od nieaktywnych.
// W CIEMNYM motywie `--primary` to jasny popiel, więc ten sam kafel dawał niemal
// biały kwadrat - ikony rysowane własnym kolorem (np. pomarańcz z pakietu ikon)
// znikały na nim. Dlatego w dark mode aktywna ikona zostaje na ciemnej płycie
// z wyraźną obwódką: kontrast robi ramka i tło kafla, a nie inwersja koloru.
const TILE_CHIP =
  "flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground transition-colors group-hover/tile:text-foreground group-data-[status=active]/tile:border-primary group-data-[status=active]/tile:bg-primary group-data-[status=active]/tile:text-primary-foreground group-data-[status=active]/tile:shadow-sm dark:group-data-[status=active]/tile:bg-primary/15 dark:group-data-[status=active]/tile:text-foreground dark:group-data-[status=active]/tile:ring-1 dark:group-data-[status=active]/tile:ring-primary/50";

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

/** Sekcje widoczne dla tego czytelnika - jedna reguła dla obu nośników. */
function visibleSections(canSeeMembers: boolean) {
  return SECTIONS.filter((s) => canSeeMembers || !PEOPLE_SECTIONS.includes(s.key));
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
  const { t, i18n } = useTranslation();
  const visible = visibleSections(canSeeMembers);

  return (
    <nav aria-label={t("club.hub.sectionsLabel")} className="space-y-2.5">
      {SECTION_GROUPS.map((group) => {
        const items = visible.filter((section) => section.group === group);
        // Grupa, z której nic nie zostało (klub ukrywa skład), znika razem
        // z nagłówkiem - pusty nagłówek jest gorszy niż jego brak.
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <h3 className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`club.hub.sectionGroups.${group satisfies SectionGroup}`)}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((section) => (
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
            </div>
          </div>
        );
      })}
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
  const { t, i18n } = useTranslation();
  // Bez nagłówków grup: w poziomym scrollerze etykieta zjadałaby szerokość,
  // której i tak brakuje. Kolejność zostaje pogrupowana, więc sąsiedztwo
  // niesie tę samą informację, co nagłówek w kolumnie.
  const visible = visibleSections(canSeeMembers);
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
              "data-[status=active]:border-primary data-[status=active]:bg-primary data-[status=active]:font-semibold data-[status=active]:text-primary-foreground",
              // Dark: `--primary` to jasny popiel - pełne wypełnienie gasi ikony
              // rysowane własnym kolorem. Kontrast bierzemy z ramki i tła.
              "dark:data-[status=active]:bg-primary/15 dark:data-[status=active]:text-foreground",
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

export function ClubHubRail({
  clubSlug,
  canSeeMembers,
  groups,
  policyArea,
  activeGroupId,
  onGroupChange,
  counts,
  hasRules,
}: {
  clubSlug: string;
  canSeeMembers: boolean;
  groups: readonly ClubGroupRow[];
  policyArea: string | null;
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  counts?: SectionCounts;
  hasRules: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
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
          />
        </ClubRailPanel>
      ) : null}

      {policyArea !== null && policyArea.trim() !== "" ? (
        <ClubRailPanel title={t("club.topic.label")}>
          <ClubTopicChip topic={policyArea} lang={lang} catalog={topics} />
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
export function ClubWorkspaceRail({ club }: { club: ClubViewRow }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { topics } = useClubTopics();
  // `pickLocalized` zwraca "" (nie null), a puste albo bialoznakowe zasady
  // to brak zasad - dawne `!== null` pokazywalo zakladke "Zasady" dla klubu,
  // ktory mial w kolumnie pusty ciag.
  const hasRules = pickLocalized(club, "rules", lang) !== "";

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

      {club.policy_area !== null && club.policy_area.trim() !== "" ? (
        <ClubRailPanel title={t("club.topic.label")}>
          <ClubTopicChip topic={club.policy_area} lang={lang} catalog={topics} />
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
