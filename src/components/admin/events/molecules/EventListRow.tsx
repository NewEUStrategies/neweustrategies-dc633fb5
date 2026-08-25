// Molekuła: JEDEN wiersz listy wydarzeń.
//
// CO WIERSZ MUSI POWIEDZIEĆ, ŻEBY LISTA BYŁA PO COŚ. Organizator patrzący na
// listę zadaje trzy pytania i wiersz musi odpowiedzieć na wszystkie bez
// klikania: kiedy to jest (data w STREFIE WYDARZENIA), czy ktoś się zapisał
// (liczniki), czy da się to wystawić (status, rodzaj, komplet ustawień).
// Wiersz pokazujący tylko tytuł i status zmusza do wejścia w każde wydarzenie.
//
// LICZBA MIEJSC MA TRZY STANY, NIE DWA. `capacity IS NULL` znaczy „bez limitu",
// a nie „zero wolnych" - i to są przeciwne odpowiedzi. RPC oddaje `seats_left`
// jako `null` właśnie po to; wiersz nie ma prawa tego spłaszczyć.
//
// FLAGI TRANSMISJI I NAGRANIA, NIE ADRESY. `join_url` i `recording_url` są
// odcięte od klienta GRANT-em kolumnowym (migracja 20260702200000). Lista
// pokazuje, ŻE istnieją - adres jest w ustawieniach wydarzenia, pod bramką.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jedno wydarzenie i oddać dwie intencje
// (edycja, podgląd publiczny). Molekuła nie zna słownika ani serwera.
import type { ReactNode } from "react";
import { CalendarDays, ExternalLink, Mic, Pencil, Users, Video } from "@/lib/lucide-shim";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { cn } from "@/lib/utils";

export function EventListRow({
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
  metrics,
  editLabel,
  onEdit,
  publicHref,
  publicLabel,
  hasStream,
  hasRecording,
  streamLabel,
  recordingLabel,
}: {
  title: string;
  slug: string;
  statusLabel: string;
  /** `published` niesie akcent, reszta jest przygaszona - status to nie ozdoba. */
  statusTone: "draft" | "published" | "cancelled";
  typeName: string;
  /** Nazwa ikony Lucide z katalogu rodzajów; brak = kalendarz. */
  typeIcon: string | null;
  typeAccentColor: string | null;
  formatLabel: string;
  /** Data w STREFIE WYDARZENIA, gotowa; pusty napis = brak terminu. */
  dateLabel: string;
  /** Krótka nazwa strefy obok godziny („CEST"); pusty napis = nie pokazuj. */
  timeZoneLabel: string;
  location: string | null;
  /** Plakietki dodatkowe (Chatham House, tylko członkowie) - gotowe napisy. */
  badges: readonly string[];
  /** Liczniki zapisów i obsady - gotowe zdania, po jednym na chip. */
  metrics: readonly string[];
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
  const accent: ReactNode = (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60"
      style={
        typeAccentColor === null
          ? undefined
          : { color: typeAccentColor, borderColor: typeAccentColor }
      }
    >
      {typeIcon === null ? (
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      ) : (
        <DynamicIcon name={typeIcon} size={16} />
      )}
    </span>
  );

  return (
    <Card className={cn(statusTone === "cancelled" && "opacity-70")}>
      <CardContent className="flex flex-wrap items-start gap-3 p-3 sm:p-4">
        {accent}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            <Badge
              variant={statusTone === "published" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {statusLabel}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {formatLabel}
            </Badge>
            {badges.map((badge) => (
              <Badge key={badge} variant="outline" className="text-[10px]">
                {badge}
              </Badge>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {dateLabel === "" ? null : (
              <span>
                {dateLabel}
                {timeZoneLabel === "" ? null : ` (${timeZoneLabel})`}
              </span>
            )}
            {location === null || location === "" ? null : <span> · {location}</span>}
            <span> · </span>
            <span className="font-medium tracking-tight">{slug}</span>
            <span> · {typeName}</span>
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {metrics.map((metric) => (
              <span key={metric} className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden="true" />
                {metric}
              </span>
            ))}
            {hasStream ? (
              <span className="inline-flex items-center gap-1">
                <Mic className="h-3 w-3" aria-hidden="true" />
                {streamLabel}
              </span>
            ) : null}
            {hasRecording ? (
              <span className="inline-flex items-center gap-1">
                <Video className="h-3 w-3" aria-hidden="true" />
                {recordingLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {publicHref === null ? null : (
            <Button variant="ghost" size="icon" aria-label={publicLabel} asChild>
              <a href={publicHref} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label={editLabel} onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
