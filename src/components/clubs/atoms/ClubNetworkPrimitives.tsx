// Atomy warstwy sieciującej klubu (A32, plakietka osoby A34).
//
// Kształty, które powtarzają się w modułach mówiących o LUDZIACH: kropka
// obecności, pigułka rodzaju ogłoszenia, stos twarzy, plakietka osoby
// i etykieta liczbowa. Stoją tutaj z tego samego powodu, co `ClubTopicChip`:
// sygnał "ta osoba tu właśnie była" ma wyglądać identycznie w składzie, na
// liście uczestników spotkania i w panelu ekspertów - inaczej ten sam fakt
// czyta się jak trzy różne byty.
//
// Wszystko trzyma promień `rounded-lg` (6 px) i skalę huba - patrz
// `ClubHubPrimitives`.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap, HandHelping, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClubAuthorAvatar } from "@/components/clubs/atoms/ClubAuthorAvatar";
import type { ClubNoticeKind } from "@/lib/clubs/networkTypes";

/**
 * Kropka obecności - "odezwał się w ostatniej dobie".
 *
 * Świadomie NIE jest to zielona kropka „online" z komunikatora: klub nie mierzy
 * połączenia z serwerem, tylko UDZIAŁ, a te dwie rzeczy znaczą co innego.
 * Dlatego kolor jest akcentem marki, a nie uniwersalną zielenią, i dlatego
 * opis dla czytnika ekranu mówi o aktywności, a nie o obecności.
 */
export function ClubPresenceDot({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("club.network.roster.activeDot")}
      className={cn("block h-2.5 w-2.5 rounded-full border-2 border-card bg-primary", className)}
    />
  );
}

/** Twarz ze wskaźnikiem obecności - awatar plus kropka w rogu. */
export function ClubPresenceAvatar({
  name,
  avatarUrl,
  active,
  size = "sm",
  className,
}: {
  name: string;
  avatarUrl: string | null;
  active: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <ClubAuthorAvatar name={name} avatarUrl={avatarUrl} size={size} />
      {active ? <ClubPresenceDot className="absolute -bottom-0.5 -right-0.5" /> : null}
    </span>
  );
}

const NOTICE_ICONS: Record<ClubNoticeKind, LucideIcon> = {
  seeking: Search,
  offering: HandHelping,
};

/**
 * Pigułka rodzaju ogłoszenia.
 *
 * Dwa rodzaje dostają dwa RÓŻNE tony, a nie dwa napisy w jednym tonie: tablicę
 * przegląda się wzrokiem, nie czyta, a kierunek transakcji ("szukam" kontra
 * "oferuję") jest jedyną rzeczą, którą trzeba rozpoznać przed przeczytaniem
 * treści. Bez różnicy koloru każde ogłoszenie wygląda jak prośba.
 */
export function ClubNoticeKindPill({
  kind,
  className,
}: {
  kind: ClubNoticeKind;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = NOTICE_ICONS[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        kind === "seeking"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t(`club.network.board.kind.${kind}`)}
    </span>
  );
}

export interface ClubFace {
  userId: string;
  name: string;
  avatarUrl: string | null;
  active?: boolean;
}

/**
 * Stos twarzy - nachodzące awatary plus "+N".
 *
 * Nachodzenie zamiast siatki, bo ten element odpowiada na pytanie "ilu ludzi
 * i czy kogoś znam", a nie "kto dokładnie" - na to ostatnie jest lista pod
 * spodem albo pełny ekran składu. W kolumnie 20 rem siatka ośmiu awatarów
 * zjada dwa wiersze, stos - jeden.
 *
 * Nazwiska idą do `title` i do warstwy dla czytnika ekranu: stos jest
 * ozdobą dla oka, ale informacja w nim zawarta musi być dostępna bez oczu.
 */
export function ClubFaceStack({
  faces,
  total,
  max = 6,
  size = "sm",
  className,
}: {
  faces: readonly ClubFace[];
  /** Pełna liczba osób; gdy większa niż `faces.length`, dochodzi "+N". */
  total?: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (faces.length === 0) return null;
  const shown = faces.slice(0, max);
  const hidden = Math.max(0, (total ?? faces.length) - shown.length);

  return (
    <div className={cn("flex items-center", className)}>
      <ul className="flex items-center -space-x-2" aria-hidden="true">
        {shown.map((face) => (
          <li key={face.userId} className="relative" title={face.name}>
            <ClubPresenceAvatar
              name={face.name}
              avatarUrl={face.avatarUrl}
              active={face.active === true}
              size={size}
            />
          </li>
        ))}
        {hidden > 0 ? (
          <li
            className={cn(
              "grid shrink-0 place-items-center rounded-lg border border-border/60 bg-muted font-semibold tabular-nums text-muted-foreground",
              size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[11px]",
            )}
          >
            +{hidden}
          </li>
        ) : null}
      </ul>
      <span className="sr-only">{faces.map((face) => face.name).join(", ")}</span>
    </div>
  );
}

/**
 * Plakietka osoby - to, co widać po najechaniu na awatar w składzie.
 *
 * PO CO ONA JEST. Rząd sześciu awatarów bez podpisu jest ozdobą: mówi "tu
 * jest sześć osób" i na tym kończy. Networking zaczyna się dopiero od
 * powodu - kto to jest, czym się zajmuje, na czym się zna. Plakietka niesie
 * dokładnie te trzy rzeczy i nic ponadto: pełna karta osoby ma własny ekran.
 *
 * DLACZEGO TOOLTIP, A NIE POPOVER. Popover trzeba zamknąć, a to jest
 * powierzchnia PRZEGLĄDANIA - przesuwa się po niej wzrokiem sześć razy pod
 * rząd. Tooltip Radiksa otwiera się także z klawiatury (`focus`), więc
 * informacja nie jest zarezerwowana dla myszy.
 *
 * Zawartość jest RÓWNIEŻ w warstwie dla czytnika ekranu przy samym awatarze
 * (patrz `ClubRosterFaces`): tooltip bywa niedostępny przy dotyku, gdzie ten
 * sam awatar jest linkiem i tapnięcie prowadzi wprost do profilu.
 */
export function ClubPersonBadge({
  name,
  headline,
  roleLabel,
  statusLabel,
  topics,
  children,
}: {
  name: string;
  headline: string | null;
  /** Rola w klubie; `member` to stan domyślny i tu nie trafia. */
  roleLabel: string | null;
  /** Jedna linijka o obecności: "aktywny dziś" albo "nowy w klubie". */
  statusLabel: string | null;
  topics: readonly string[];
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[15rem] px-2.5 py-2">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-popover-foreground">{name}</span>
          {roleLabel !== null ? (
            <span className="rounded-lg border border-border/60 px-1 text-[10px] font-medium">
              {roleLabel}
            </span>
          ) : null}
        </p>
        {headline !== null ? <p className="mt-0.5 opacity-80">{headline}</p> : null}
        {topics.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {topics.slice(0, 3).map((topic) => (
              <ClubExpertiseChip key={topic} label={topic} />
            ))}
          </p>
        ) : null}
        {statusLabel !== null ? (
          <p className="mt-1.5 flex items-center gap-1 font-medium text-primary">
            <Sparkles className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {statusLabel}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Etykieta liczbowa modułów sieciujących: liczba nad opisem.
 *
 * Odróżnia się od `ClubStatPill` celowo - tamta jest POZIOMA i stoi w pasku
 * tożsamości, gdzie liczb jest dwie. Tutaj liczby są trzy w kolumnie 20 rem
 * i muszą stać w rzędzie, więc opis schodzi pod wartość.
 */
export function ClubSignalMetric({
  icon: Icon,
  value,
  label,
  emphasis = false,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  /** Wartość niosąca sygnał (np. ktoś tu dziś był) dostaje kolor akcentu. */
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          "text-base font-semibold leading-tight tabular-nums",
          emphasis && "text-primary",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Chip kompetencji - deklaracja członka, nie obszar wpisu.
 *
 * Kształtem bliski `ClubTopicChip`, ale z INNĄ ikoną i bez klikalności: obszar
 * na karcie wątku zawęża strumień, a deklaracja przy twarzy jest opisem osoby.
 * Gdyby wyglądały identycznie, czytelnik próbowałby filtrować klub przez
 * kliknięcie w czyjąś kompetencję.
 */
export function ClubExpertiseChip({ label, className }: { label: string; className?: string }) {
  if (label.trim() === "") return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground",
        className,
      )}
    >
      <GraduationCap className="h-2.5 w-2.5 shrink-0 text-primary/70" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
