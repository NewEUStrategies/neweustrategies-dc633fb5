// Molekuła: WIERSZE TABELI wydarzeń - nagłówkowy i danych.
//
// DLACZEGO KARTA ZNIKŁA. Wiersz był kartą z chipami, więc miał tyle elementów,
// ile miał NIEPUSTYCH wartości: wydarzenie bez miejsca nie miało miejsca,
// wydarzenie bez zapisów nie miało licznika. Dwa sąsiednie wiersze nie zgadzały
// się co do niczego i lista czytała się wyłącznie w poziomie, po jednej karcie.
// Redaktor porównuje wydarzenia w PIONIE („które nie ma miejsca”, „które nie ma
// prelegentów”) i na to odpowiada kolumna, a nie karta.
//
// NAGŁÓWEK I WIERSZ SĄ W JEDNYM PLIKU, bo muszą zgadzać się co do ZBIORU
// i KOLEJNOŚCI kolumn. Rozdzielone (nagłówek w organizmie, komórki w molekule)
// rozjeżdżają się przy pierwszej dodanej kolumnie, a rozjazd jest CICHY: tabela
// renderuje się dalej, tylko wartości siedzą pod cudzymi nagłówkami.
//
// ZERO JEST MYŚLNIKIEM w kolumnach liczników. „0 zapisanych” i „nikt się nie
// zapisał” to ta sama informacja, a kolumna wypełniona zerami czyta się jak dane
// i przykrywa te wiersze, w których liczba naprawdę coś znaczy.
//
// KOSZA W WIERSZU NIE MA. Usuwanie stoi na pasku operacji masowych nad tabelą
// (organizm), bo kosz powtórzony w każdym wierszu to tyle okazji na kliknięcie
// nie do cofnięcia, ile jest wierszy. Wiersz zachowuje jedną drogę do rekordu -
// TYTUŁ - i drugą, wyraźnie inną, do strony publicznej.
//
// LICZBA MIEJSC MA TRZY STANY, NIE DWA. `capacity IS NULL` znaczy „bez limitu”,
// a nie „zero wolnych” - i to są przeciwne odpowiedzi. Zdania o limicie i kolejce
// przychodzą gotowe (`registrationNotes`) i stoją pod liczbą zapisanych, bo tam
// są potrzebne: przy liczbie, którą tłumaczą.
//
// FLAGI TRANSMISJI I NAGRANIA, NIE ADRESY. `join_url` i `recording_url` są
// odcięte od klienta GRANT-em kolumnowym (migracja 20260702200000). Kolumna
// formatu pokazuje, ŻE istnieją - adres jest w ustawieniach wydarzenia.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jedno wydarzenie w komórkach i oddać cztery
// intencje (zaznaczenie, edycja, podgląd publiczny, sortowanie w nagłówku).
// Molekuła nie zna słownika ani serwera - napisy dostaje gotowe.
import type { ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mic,
  MoveVertical,
  Video,
} from "@/lib/lucide-shim";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";

/** Myślnik pustej komórki. Jedna stała, żeby w tabeli nie było dwóch kresek. */
const EMPTY_CELL = "-";

/** Kolumny, po których wolno sortować. Zbiór jest ZAMKNIĘTY - typ pilnuje, że
 *  organizm nie poprosi o sortowanie kolumny, której nagłówek nie ma przycisku. */
export const EVENT_TABLE_SORT_KEYS = ["title", "date", "registrations", "speakers"] as const;
export type EventTableSortKey = (typeof EVENT_TABLE_SORT_KEYS)[number];
export type EventTableSortDir = "asc" | "desc";

export interface EventTableSort {
  key: EventTableSortKey;
  dir: EventTableSortDir;
}

/** Napisy nagłówków - wszystkie naraz, bo kolejność kolumn rysuje ten plik. */
export interface EventTableColumnLabels {
  title: string;
  date: string;
  type: string;
  format: string;
  location: string;
  status: string;
  registrations: string;
  speakers: string;
}

/** Wartość pustej komórki tekstowej sprowadzona do myślnika. */
function textCell(value: string | null): string {
  return value === null || value.trim() === "" ? EMPTY_CELL : value;
}

/**
 * Glif sortowania: podwójna strzałka z LITERAMI dla tekstu i CYFRAMI dla liczb
 * oraz dat.
 *
 * Rozróżnienie nie jest ozdobą: „A-Z” i „1-2” mówią, CO stanie się z kolumną po
 * kliknięciu, a te dwie odpowiedzi są różne. Litery zamieniają się miejscami
 * razem z kierunkiem, więc glif pokazuje stan, a nie tylko możliwość.
 * Akcent niesie „to jest sortowanie CZYNNE” - u nas pomarańcz, u wzorca zieleń.
 * Akcentem jest `text-brand-ink`, a NIE `text-primary`: `--primary` to w tej
 * palecie prawie czerń w jasnym motywie (oklch 0.18) i prawie biel w ciemnym,
 * więc czynne sortowanie różniłoby się od bezczynnego samą jasnością szarości -
 * czyli sygnału by nie było. `--brand-ink` istnieje dokładnie po to: surowy
 * `--brand` daje na jasnym tle 2.2:1 i nie przechodzi AA jako tekst, a glif ma
 * litery po osiem pikseli (strażnik: `src/lib/__tests__/brandContrast.test.ts`).
 */
function SortGlyph({ kind, dir }: { kind: "letters" | "digits"; dir: EventTableSortDir | null }) {
  const [first, second] = kind === "letters" ? ["A", "Z"] : ["1", "2"];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center",
        dir === null ? "text-muted-foreground/60" : "text-brand-ink",
      )}
    >
      <span className="flex flex-col text-[8px] font-semibold leading-[1.05]">
        <span>{dir === "desc" ? second : first}</span>
        <span>{dir === "desc" ? first : second}</span>
      </span>
      {dir === null ? (
        <MoveVertical className="h-3 w-3" />
      ) : dir === "asc" ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronUp className="h-3 w-3" />
      )}
    </span>
  );
}

/**
 * Nagłówek kolumny sortowalnej.
 *
 * KIERUNEK JEST W `aria-sort` ORAZ W SŁOWIE. Podwójna strzałka nie mówi
 * czytnikowi ekranu niczego, a `aria-sort` czytają nie wszystkie czytniki -
 * dlatego kierunek stoi też jako napis dla czytnika, POZA przyciskiem: gdyby był
 * w środku, `aria-label` przycisku by go przykrył.
 */
function SortableHead({
  label,
  sortKey,
  kind,
  align,
  sort,
  sortLabel,
  directionLabels,
  onSort,
  className,
}: {
  label: string;
  sortKey: EventTableSortKey;
  kind: "letters" | "digits";
  align: "left" | "right";
  sort: EventTableSort | null;
  sortLabel: string;
  directionLabels: { asc: string; desc: string };
  onSort: (key: EventTableSortKey) => void;
  className?: string;
}) {
  const dir = sort !== null && sort.key === sortKey ? sort.dir : null;
  return (
    <TableHead
      className={cn(align === "right" && "text-right", className)}
      aria-sort={dir === null ? "none" : dir === "asc" ? "ascending" : "descending"}
    >
      <button
        type="button"
        aria-label={sortLabel}
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dir === null ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <span>{label}</span>
        <SortGlyph kind={kind} dir={dir} />
      </button>
      {dir === null ? null : (
        <span className="sr-only">
          {dir === "asc" ? directionLabels.asc : directionLabels.desc}
        </span>
      )}
    </TableHead>
  );
}

export function EventListHeaderRow({
  labels,
  sortLabels,
  directionLabels,
  sort,
  onSort,
  selectAllLabel,
  selectedAll,
  selectedSome,
  onSelectAll,
}: {
  labels: EventTableColumnLabels;
  /** Gotowe „Sortuj według …” dla każdej sortowalnej kolumny - odmiana w słowniku. */
  sortLabels: Record<EventTableSortKey, string>;
  directionLabels: { asc: string; desc: string };
  sort: EventTableSort | null;
  onSort: (key: EventTableSortKey) => void;
  selectAllLabel: string;
  selectedAll: boolean;
  /** Część wierszy zaznaczona - checkbox nagłówka idzie w stan nieokreślony. */
  selectedSome: boolean;
  onSelectAll: (next: boolean) => void;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      {/* PIERWSZA KOLUMNA TO ZAZNACZANIE. Operacje masowe bez tej kolumny znaczą
          „zrób to wszystkim albo klikaj po jednym”, a nad tabelą stoi kasowanie. */}
      <TableHead className="w-10">
        <Checkbox
          checked={selectedAll ? true : selectedSome ? "indeterminate" : false}
          aria-label={selectAllLabel}
          onCheckedChange={(next) => onSelectAll(next === true)}
        />
      </TableHead>
      <SortableHead
        label={labels.title}
        sortKey="title"
        kind="letters"
        align="left"
        sort={sort}
        sortLabel={sortLabels.title}
        directionLabels={directionLabels}
        onSort={onSort}
        className="min-w-[15rem]"
      />
      <SortableHead
        label={labels.date}
        sortKey="date"
        kind="digits"
        align="left"
        sort={sort}
        sortLabel={sortLabels.date}
        directionLabels={directionLabels}
        onSort={onSort}
        className="min-w-[11rem]"
      />
      <TableHead>{labels.type}</TableHead>
      <TableHead>{labels.format}</TableHead>
      <TableHead>{labels.location}</TableHead>
      <TableHead>{labels.status}</TableHead>
      <SortableHead
        label={labels.registrations}
        sortKey="registrations"
        kind="digits"
        align="right"
        sort={sort}
        sortLabel={sortLabels.registrations}
        directionLabels={directionLabels}
        onSort={onSort}
      />
      <SortableHead
        label={labels.speakers}
        sortKey="speakers"
        kind="digits"
        align="right"
        sort={sort}
        sortLabel={sortLabels.speakers}
        directionLabels={directionLabels}
        onSort={onSort}
      />
    </TableRow>
  );
}

export function EventListRow({
  selected,
  selectLabel,
  onSelectedChange,
  title,
  slug,
  statusLabel,
  statusTone,
  typeName,
  typeIcon,
  typeAccentColor,
  formatLabel,
  dateLabel,
  timeZoneLabel,
  location,
  badges,
  registrationsCount,
  registrationNotes,
  speakersCount,
  editLabel,
  onEdit,
  publicHref,
  publicLabel,
  hasStream,
  hasRecording,
  streamLabel,
  recordingLabel,
}: {
  selected: boolean;
  selectLabel: string;
  onSelectedChange: (next: boolean) => void;
  title: string;
  slug: string;
  statusLabel: string;
  /** `published` niesie akcent, reszta jest przygaszona - status to nie ozdoba. */
  statusTone: "draft" | "published" | "cancelled";
  /** Nazwa rodzaju albo gotowe „Bez rodzaju”; pusty napis = myślnik. */
  typeName: string;
  /** Nazwa ikony Lucide z katalogu rodzajów; brak = kalendarz. */
  typeIcon: string | null;
  typeAccentColor: string | null;
  formatLabel: string;
  /** Data w STREFIE WYDARZENIA, gotowa; pusty napis = myślnik. */
  dateLabel: string;
  /** Krótka nazwa strefy obok godziny („CEST”); pusty napis = nie pokazuj. */
  timeZoneLabel: string;
  location: string | null;
  /** Plakietki dodatkowe (Chatham House, tylko członkowie) - gotowe napisy. */
  badges: readonly string[];
  /** Liczba zapisanych; zero renderuje się myślnikiem. */
  registrationsCount: number;
  /** Zdania o limicie i kolejce - gotowe, stoją pod liczbą zapisanych. */
  registrationNotes: readonly string[];
  speakersCount: number;
  editLabel: string;
  onEdit: () => void;
  /** Adres strony publicznej; `null` dla szkicu - nie ma czego otwierać. */
  publicHref: string | null;
  publicLabel: string;
  hasStream: boolean;
  hasRecording: boolean;
  streamLabel: string;
  recordingLabel: string;
}) {
  const typeGlyph: ReactNode =
    typeIcon === null ? (
      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    ) : (
      <DynamicIcon name={typeIcon} size={14} />
    );

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={cn(statusTone === "cancelled" && "opacity-70")}
    >
      <TableCell className="w-10">
        <Checkbox
          checked={selected}
          aria-label={selectLabel}
          onCheckedChange={(next) => onSelectedChange(next === true)}
        />
      </TableCell>

      {/* TYTUŁ JEST DROGĄ DO REKORDU - jak we wzorcu, gdzie wiersz nie ma kolumny
          akcji. Adres publiczny dostaje osobną, wyraźnie inną ikonę: „otwórz
          w nowej karcie” i „edytuj” to dwa różne miejsca i nie wolno ich
          pomylić jednym kliknięciem. */}
      <TableCell className="max-w-[22rem] align-top">
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            aria-label={editLabel}
            onClick={onEdit}
            className="rounded-sm text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {title}
          </button>
          {publicHref === null ? null : (
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              aria-label={publicLabel}
              className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tracking-tight">{slug}</span>
          {/* CHATHAM HOUSE I „TYLKO CZŁONKOWIE” ZOSTAJĄ PRZY TYTULE, choć wzorzec
              nie ma plakietek w wierszu. Pierwsza z nich to reguła poufności
              spotkania, a nie ozdoba: redaktor musi ją widzieć na liście, bo od
              niej zależy, co wolno opublikować. */}
          {badges.map((badge) => (
            <Badge key={badge} variant="outline" className="text-[10px]">
              {badge}
            </Badge>
          ))}
        </div>
      </TableCell>

      <TableCell className="align-top">
        {dateLabel === "" ? (
          EMPTY_CELL
        ) : (
          <span>
            {dateLabel}
            {timeZoneLabel === "" ? null : (
              <span className="text-muted-foreground"> ({timeZoneLabel})</span>
            )}
          </span>
        )}
      </TableCell>

      <TableCell className="align-top">
        {typeName.trim() === "" ? (
          EMPTY_CELL
        ) : (
          <span
            className="inline-flex items-center gap-1.5"
            style={typeAccentColor === null ? undefined : { color: typeAccentColor }}
          >
            {typeGlyph}
            <span className="text-foreground">{typeName}</span>
          </span>
        )}
      </TableCell>

      <TableCell className="align-top">
        <span className="inline-flex items-center gap-1.5">
          {textCell(formatLabel)}
          {hasStream ? (
            <span className="text-muted-foreground">
              <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{streamLabel}</span>
            </span>
          ) : null}
          {hasRecording ? (
            <span className="text-muted-foreground">
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{recordingLabel}</span>
            </span>
          ) : null}
        </span>
      </TableCell>

      <TableCell className="max-w-[14rem] align-top">{textCell(location)}</TableCell>

      <TableCell className="align-top">
        <Badge
          variant={statusTone === "published" ? "default" : "secondary"}
          className="text-[10px]"
        >
          {statusLabel}
        </Badge>
      </TableCell>

      <TableCell className="align-top text-right">
        <span className="tabular-nums">
          {registrationsCount === 0 ? EMPTY_CELL : registrationsCount}
        </span>
        {registrationNotes.length === 0 ? null : (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {registrationNotes.join(" · ")}
          </span>
        )}
      </TableCell>

      <TableCell className="align-top text-right tabular-nums">
        {speakersCount === 0 ? EMPTY_CELL : speakersCount}
      </TableCell>
    </TableRow>
  );
}
