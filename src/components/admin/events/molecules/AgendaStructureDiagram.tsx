// Molekuła: WYJAŚNIENIE RÓŻNICY między sesją a ścieżką - rysunkiem, nie akapitem.
//
// DLACZEGO RYSUNEK. Organizator, który pierwszy raz otwiera agendę, czyta dwa
// prawie identyczne nagłówki („Sesje", „Ścieżki") i zgaduje, który z nich jest
// programem. Zdanie w podtytule tego nie rozstrzyga - kolumna z kaflami
// rozstrzyga: ścieżka to nagłówek kolumny, sesja to kafel w środku.
//
// RYSUJEMY PRAWDZIWE DANE. Kolumny to realne ścieżki wydarzenia z ich kolorami
// i licznikiem sesji, a nie atrapa - dzięki temu ten sam obrazek jest legendą
// dla nowego użytkownika I podglądem stanu programu dla kogoś, kto tu wraca.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać strukturę. Molekuła nie pyta serwera i nie
// zmienia niczego - dostaje gotowe wiersze od organizmu.
import { useTranslation } from "react-i18next";
import { CalendarClock, Columns3, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AgendaDiagramTrack {
  id: string;
  name: string;
  accentColor: string;
  sessionsCount: number;
}

interface AgendaStructureDiagramProps {
  tracks: readonly AgendaDiagramTrack[];
  /** Sesje bez ścieżki - własna kolumna, bo to normalny stan, nie błąd. */
  unassignedCount: number;
  /** Który element opisu ma być podświetlony na ekranie, na którym stoimy. */
  highlight: "sessions" | "tracks";
  className?: string;
}

/** Ile kafli rysujemy w kolumnie, zanim przejdziemy na „+N". */
const TILES = 3;

export function AgendaStructureDiagram({
  tracks,
  unassignedCount,
  highlight,
  className,
}: AgendaStructureDiagramProps) {
  const { t } = useTranslation();

  const columns: readonly AgendaDiagramTrack[] = [
    ...tracks,
    ...(unassignedCount > 0
      ? [
          {
            id: "__none__",
            name: t("adminEventAgenda.structure.noTrackColumn"),
            accentColor: "transparent",
            sessionsCount: unassignedCount,
          },
        ]
      : []),
  ];

  return (
    <section
      className={cn("rounded-[6px] border border-border/70 bg-muted/30 p-4", className)}
      aria-label={t("adminEventAgenda.structure.title")}
    >
      <header className="space-y-1">
        <h3 className="font-display text-sm">{t("adminEventAgenda.structure.title")}</h3>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t("adminEventAgenda.structure.lead")}
        </p>
      </header>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <DiagramLegend
          icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
          term={t("adminEventAgenda.structure.sessionTerm")}
          detail={t("adminEventAgenda.structure.sessionDetail")}
          active={highlight === "sessions"}
        />
        <DiagramLegend
          icon={<Columns3 className="h-4 w-4" aria-hidden="true" />}
          term={t("adminEventAgenda.structure.trackTerm")}
          detail={t("adminEventAgenda.structure.trackDetail")}
          active={highlight === "tracks"}
        />
        <DiagramLegend
          icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
          term={t("adminEventAgenda.structure.roomTerm")}
          detail={t("adminEventAgenda.structure.roomDetail")}
          active={false}
        />
      </dl>

      {columns.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("adminEventAgenda.structure.emptyDiagram")}
        </p>
      ) : (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {columns.map((column) => {
            const tiles = Math.min(column.sessionsCount, TILES);
            const rest = column.sessionsCount - tiles;
            return (
              <div
                key={column.id}
                className="min-w-[9rem] flex-1 rounded-[6px] border border-border/70 bg-background p-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-[3px] border border-border"
                    style={{ backgroundColor: column.accentColor }}
                  />
                  <p className="truncate text-xs font-medium">{column.name}</p>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("adminEventAgenda.tracks.sessionsCount", { count: column.sessionsCount })}
                </p>
                <div className="mt-2 space-y-1">
                  {Array.from({ length: Math.max(tiles, 1) }, (_, index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      className={cn(
                        "h-6 rounded-[6px] border border-dashed border-border/70",
                        index < tiles ? "bg-muted" : "opacity-40",
                      )}
                      style={
                        index < tiles && column.accentColor !== "transparent"
                          ? { borderLeft: `3px solid ${column.accentColor}` }
                          : undefined
                      }
                    />
                  ))}
                  {rest > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("adminEventAgenda.structure.moreSessions", { count: rest })}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DiagramLegend({
  icon,
  term,
  detail,
  active,
}: {
  icon: React.ReactNode;
  term: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[6px] border p-2",
        active ? "border-primary/60 bg-primary/5" : "border-border/70 bg-background",
      )}
    >
      <dt className="flex items-center gap-2 text-xs font-medium">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        {term}
      </dt>
      <dd className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</dd>
    </div>
  );
}
