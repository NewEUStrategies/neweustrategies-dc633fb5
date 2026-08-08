// Nawigacja przestrzeni roboczej klubu.
//
// PO CO ONA ISTNIEJE. Nagłówek klubu rozrósł się do siedmiu przycisków
// (minisite, o klubie, skład, wątki, nowy temat...), a każda nowa powierzchnia
// A28 dokładała kolejny. Siedem przycisków w jednym rzędzie to nie jest
// nawigacja, tylko lista linków - użytkownik nie wie, gdzie JEST, tylko dokąd
// może pójść.
//
// Zakładki odpowiadają na oba pytania naraz: aktywna mówi "jesteś tutaj",
// reszta - "możesz tam". `Link` TanStacka liczy stan aktywny sam
// (`activeProps`), więc nie ma tu drugiego źródła prawdy o bieżącej trasie.
//
// PRZEWIJANIE POZIOME NA TELEFONIE, nie zawijanie do drugiego rzędu: sześć
// zakładek w dwóch rzędach zjada tyle samo ekranu, co nagłówek, który
// zastępują. Pasek chowa nadmiar za krawędź i zostawia treść na wierzchu.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarDays,
  FileText,
  ListChecks,
  MessagesSquare,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Trasy zakładek. `to` jest literałem, bo router TanStacka typuje ścieżki. */
const TABS = [
  { key: "threads", to: "/club/$clubSlug", icon: MessagesSquare },
  { key: "documents", to: "/club/$clubSlug/documents", icon: FileText },
  { key: "calendar", to: "/club/$clubSlug/calendar", icon: CalendarDays },
  { key: "schedule", to: "/club/$clubSlug/schedule", icon: ListChecks },
  { key: "insights", to: "/club/$clubSlug/insights", icon: BarChart3 },
  { key: "members", to: "/club/$clubSlug/members", icon: Users2 },
] as const;

type TabKey = (typeof TABS)[number]["key"];
/** Unia LITERAŁÓW tras, nie `string`: literał daje routerowi szansę sprawdzić
 *  adres przy kompilacji, a `string` zamienia literówkę w martwy link. */
type TabTo = (typeof TABS)[number]["to"];

const BASE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium leading-none transition-colors sm:text-sm";
const QUIET = "border-border/60 bg-card text-muted-foreground hover:border-primary/40";
const ACTIVE = "border-primary bg-primary text-primary-foreground";

function TabLink({
  to,
  clubSlug,
  icon: Icon,
  label,
  exact,
}: {
  to: TabTo;
  clubSlug: string;
  icon: LucideIcon;
  label: string;
  exact: boolean;
}) {
  return (
    <Link
      to={to}
      params={{ clubSlug }}
      // Zakładka "wątki" celuje w /club/$slug, który jest PREFIKSEM każdej
      // pozostałej trasy klubu - bez dopasowania dokładnego świeciłaby się
      // na wszystkich pięciu ekranach naraz.
      activeOptions={{ exact }}
      className={cn(BASE, QUIET)}
      activeProps={{ className: cn(BASE, ACTIVE) }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

export function ClubWorkspaceNav({
  clubSlug,
  canSeeMembers,
  className,
}: {
  clubSlug: string;
  /** Skład klubu pokazujemy tylko wtedy, gdy baza na to pozwala - to jest
   *  `can_see_members` z `club_capabilities`, nie domysł interfejsu. */
  canSeeMembers: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const visible = TABS.filter((tab) => tab.key !== "members" || canSeeMembers);

  return (
    <nav
      aria-label={t("club.workspace.navLabel")}
      className={cn(
        // `-mx-3 px-3` wypuszcza pasek pod krawędź kontenera, więc przewijanie
        // wygląda jak przewijanie, a nie jak ucięty rząd.
        "-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0",
        className,
      )}
      data-testid="club-workspace-nav"
    >
      {visible.map((tab) => (
        <TabLink
          key={tab.key}
          to={tab.to}
          clubSlug={clubSlug}
          icon={tab.icon}
          label={t(`club.workspace.tabs.${tab.key satisfies TabKey}`)}
          exact={tab.key === "threads"}
        />
      ))}
    </nav>
  );
}
