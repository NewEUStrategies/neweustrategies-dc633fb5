// Wiersz dossier - wspólny szkielet dla WSZYSTKICH pozycji strumienia klubu.
//
// DLACZEGO WIERSZ, A NIE KARTA. Dyskusje, pytania, stanowiska, materiały,
// terminy i etapy stoją jedna pod drugą w tej samej kolumnie. Karta z własnym
// nagłówkiem, własnym paskiem meta i własnym rytmem odstępów powodowała, że
// każdy rodzaj wyglądał jak osobny komponent, a pion listy nie dawał się
// zeskanować wzrokiem - trzeba było CZYTAĆ, żeby wiedzieć, na co się patrzy.
//
// Wiersz dossier ma trzy strefy i zawsze te same:
//   1. GRZBIET  - pionowy akcent rodzaju + ikona w kwadracie 6 px. To on
//                 odpowiada na pytanie „co to jest" bez czytania.
//   2. TREŚĆ    - meta (rodzaj, dział, temat, status), tytuł, streszczenie.
//   3. METRYKI  - prawa kolumna wyrównana w pionie przez CAŁĄ listę, więc
//                 liczby czytają się jak tabela, a nie jak podpis pod kartą.
//
// Gęstość jest KOMPAKTOWA z założenia (py-2.5, ikona 28 px, tytuł `sm`):
// lista ma pokazać maksimum pozycji, a rozwinięcie treści należy do wątku.
// Akcje pojawiają się przy najeździe i przy fokusie klawiatury - „przy
// fokusie" jest tu warunkiem dostępności, nie ozdobą.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Ton grzbietu = RODZAJ pozycji, a dla wątków - rodzaj wątku (dyskusja,
// pytanie, stanowisko, materiał, ogłoszenie, sondaż). Kolor jest jedyną
// rzeczą, która odróżnia je bez czytania etykiety, dlatego każdy rodzaj ma
// własny odcień. Nasycenie trzymamy nisko (60 % grzbiet, 10 % tło ikony),
// żeby lista nie zamieniła się w paletę - w module klubów `--primary` jest
// celowo neutralny i te akcenty są jedynym kolorem w wierszu.
export type ClubDossierTone =
  | "thread"
  | "discussion"
  | "question"
  | "position"
  | "resource"
  | "announcement"
  | "poll"
  | "post"
  | "event"
  | "document"
  | "milestone";

const SPINE: Record<ClubDossierTone, string> = {
  thread: "bg-primary/60",
  discussion: "bg-violet-500/60",
  question: "bg-amber-500/70",
  position: "bg-rose-500/60",
  resource: "bg-teal-500/60",
  announcement: "bg-orange-500/60",
  poll: "bg-fuchsia-500/60",
  post: "bg-foreground/25",
  event: "bg-sky-500/60",
  document: "bg-muted-foreground/40",
  milestone: "bg-emerald-500/60",
};

const ICON_BOX: Record<ClubDossierTone, string> = {
  thread: "border-primary/30 bg-primary/10 text-foreground",
  discussion: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  question: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  position: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  resource: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  announcement: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  poll: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  post: "border-border/70 bg-muted/60 text-foreground",
  event: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  document: "border-border/70 bg-muted/60 text-muted-foreground",
  milestone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const THREAD_TONES: Record<string, ClubDossierTone> = {
  discussion: "discussion",
  question: "question",
  position: "position",
  resource: "resource",
  announcement: "announcement",
  poll: "poll",
};

/**
 * Ton wiersza dla wątku. Nieznany rodzaj (starszy wiersz w bazie) degraduje
 * się do neutralnego `thread`, zamiast wywracać kolorystykę listy.
 */
export function clubThreadTone(kind: string | null | undefined): ClubDossierTone {
  if (typeof kind !== "string") return "thread";
  return THREAD_TONES[kind] ?? "thread";
}


export interface ClubDossierMetric {
  readonly key: string;
  readonly icon: ReactNode;
  readonly value: string | number;
  /** Pełny opis dla czytnika ekranu i tooltipa - liczba sama nic nie znaczy. */
  readonly label: string;
}

/**
 * Kolumna metryk. Na mobile leży pod treścią w jednej linii, od `sm` wchodzi
 * w prawą kolumnę siatki i wyrównuje się z sąsiednimi wierszami.
 */
/**
 * Klasa grzbietu rodzaju - dla powierzchni, które nie są wierszem listy
 * (np. post otwierający wątek), ale mają mówić tym samym kolorem.
 */
export function clubDossierSpineClass(tone: ClubDossierTone): string {
  return SPINE[tone];
}

/** Klasa kwadratu ikony rodzaju - patrz `clubDossierSpineClass`. */
export function clubDossierIconBoxClass(tone: ClubDossierTone): string {
  return ICON_BOX[tone];
}

export function ClubDossierMetrics({
  metrics,
  trailing,
  className,
}: {
  metrics: readonly ClubDossierMetric[];
  trailing?: ReactNode;
  className?: string;
}) {
  if (metrics.length === 0 && trailing === undefined) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground",
        "sm:flex-col sm:items-end sm:gap-y-1.5",
        className,
      )}
    >
      {metrics.map((metric) => (
        <span
          key={metric.key}
          className="inline-flex items-center gap-1.5"
          title={metric.label}
          data-metric={metric.key}
        >
          {metric.icon}
          <span className="tabular-nums">{metric.value}</span>
          <span className="sr-only">{metric.label}</span>
        </span>
      ))}
      {trailing}
    </div>
  );
}

export function ClubDossierRow({
  tone,
  icon,
  meta,
  title,
  excerpt,
  metrics,
  footer,
  unread = false,
  pinned = false,
  testId,
  className,
}: {
  tone: ClubDossierTone;
  /** Ikona rodzaju - renderowana w kwadracie grzbietu. */
  icon: ReactNode;
  /** Pasek meta nad tytułem: rodzaj, dział, temat, statusy. */
  meta?: ReactNode;
  title: ReactNode;
  excerpt?: ReactNode;
  /** Prawa kolumna - zwykle `<ClubDossierMetrics />`. */
  metrics?: ReactNode;
  /** Pas akcji pod treścią (reakcje, pobranie, przejście dalej). */
  footer?: ReactNode;
  unread?: boolean;
  pinned?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <article
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "group/dossier relative grid gap-x-3 gap-y-1.5 overflow-hidden rounded-lg border border-border/60 bg-card",
        "grid-cols-[auto_minmax(0,1fr)] py-2.5 pl-2.5 pr-3 transition-colors",
        "hover:border-primary/40 focus-within:border-primary/40",
        "sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:py-3 sm:pr-4",
        pinned && "border-primary/40",
        unread && "bg-primary/[0.03]",
        className,
      )}
    >
      {/* Grzbiet: pasek rodzaju przez całą wysokość + ikona. Pasek jest
          absolutny, bo ma sięgać krawędzi wiersza, a nie wysokości ikony. */}
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-[3px]", SPINE[tone])}
      />
      <span
        aria-hidden="true"
        className={cn(
          "ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
          ICON_BOX[tone],
        )}
      >
        {icon}
      </span>

      <div className="min-w-0">
        {meta !== undefined ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {unread ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            ) : null}
            {meta}
          </div>
        ) : null}

        <div className={cn("min-w-0", meta !== undefined && "mt-1")}>{title}</div>

        {excerpt !== undefined ? (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {excerpt}
          </div>
        ) : null}

        {footer !== undefined ? (
          // Akcje trzymają wysokość wiersza stałą: są zawsze w DOM, a zmienia
          // się tylko ich widoczność - inaczej lista skakałaby przy najeździe.
          <div className="mt-1.5 opacity-70 transition-opacity group-hover/dossier:opacity-100 focus-within:opacity-100">
            {footer}
          </div>
        ) : null}
      </div>

      {metrics !== undefined ? (
        <div className="col-span-2 sm:col-span-1 sm:self-start">{metrics}</div>
      ) : null}
    </article>
  );
}
