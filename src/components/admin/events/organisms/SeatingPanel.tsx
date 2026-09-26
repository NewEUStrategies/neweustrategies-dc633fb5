// Organizm: PLAN SALI w studiu wydarzenia - lista planow albo jeden plan.
//
// OTWARTY PLAN ZYJE W ADRESIE (`?map=<id>`), nie w stanie komponentu: link do
// planu da sie wyslac drugiemu organizatorowi, a "wstecz" w przegladarce wraca
// do listy (precedens `?track=` w sciezkach agendy). Trasa czyta parametr
// i podaje go tutaj; panel prosi o zmiane przez `onOpenMap`.
//
// LICZNIKI Z BAZY, NIE Z PRZEGLADARKI. Kafelki pokazuja to, co policzyl
// `admin_event_seat_maps_list` (miejsca, zajete, zarezerwowane, zablokowane,
// uprawnieni bez miejsca) - panel nie sklada ich z drugiego zapytania.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Armchair, Ban, Lock, UserX } from "lucide-react";

import { EventSeatMapDialog } from "@/components/admin/events/molecules/EventSeatMapDialog";
import { SeatMapWorkspace } from "@/components/admin/events/organisms/SeatMapWorkspace";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { Pencil, Plus, Trash2, Users } from "@/lib/lucide-shim";
import { adminSeatingErrorMessage } from "@/lib/events/adminSeatingErrors";
import type { SeatMapInfo, SeatMapRow } from "@/lib/events/seatingApi";
import { useDeleteSeatMap, useSaveSeatMap, useSeatMaps } from "@/lib/events/useEventSeating";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

/**
 * Wiersz listy -> ksztalt dialogu edycji. Lista niesie KOMPLET pol planu,
 * razem ze scena - bez niej zapis z listy czyscilby scene narysowana w planie.
 * Generator typow opisuje kolumny `numeric` sceny jako `number`, choc baza
 * oddaje w nich NULL (plan bez sceny).
 */
export function mapInfoFromRow(row: SeatMapRow): SeatMapInfo {
  const stage =
    row.stage_x === null || row.stage_y === null || row.stage_w === null || row.stage_h === null
      ? null
      : { x: row.stage_x, y: row.stage_y, w: row.stage_w, h: row.stage_h };
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    roomId: row.room_id,
    sessionId: row.session_id,
    status: row.status === "published" ? "published" : "draft",
    width: row.width,
    height: row.height,
    stage,
    sortOrder: row.sort_order,
    publishedAt: row.published_at,
  };
}

export interface SeatingPanelProps {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  /** Otwarty plan z adresu albo `null` = lista planow. */
  mapId: string | null;
  onOpenMap: (mapId: string | null) => void;
}

export function SeatingPanel({ eventId, eventSlug, eventTitle, mapId, onOpenMap }: SeatingPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const maps = useSeatMaps(eventId);
  const saveMap = useSaveSeatMap(eventId);
  const deleteMap = useDeleteSeatMap(eventId);
  const [dialog, setDialog] = useState<{ map: SeatMapInfo | null } | null>(null);

  if (mapId !== null) {
    return (
      <SeatMapWorkspace
        eventId={eventId}
        eventSlug={eventSlug}
        eventTitle={eventTitle}
        mapId={mapId}
        onBack={() => onOpenMap(null)}
      />
    );
  }

  const rows = maps.data ?? [];

  const remove = async (row: SeatMapRow) => {
    const ok = await confirmDialog({
      title: t("adminEventSeating.list.deleteTitle", { name: row.name }),
      description: t("adminEventSeating.list.deleteBody"),
      confirmLabel: t("adminEventSeating.list.deleteConfirm"),
      cancelLabel: t("adminEventSeating.list.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMap.mutateAsync(row.id);
      toast.success(t("adminEventSeating.toasts.mapDeleted"));
    } catch (error: unknown) {
      toast.error(adminSeatingErrorMessage(error));
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminEventSeating.list.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("adminEventSeating.list.subtitle")}</p>
        </div>
        <Button onClick={() => setDialog({ map: null })}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("adminEventSeating.list.add")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={maps.isLoading}
        loadingLabel={t("adminEventSeating.list.loading")}
        errorMessage={maps.error === null ? null : adminSeatingErrorMessage(maps.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventSeating.list.empty")}
      >
        <ul className="space-y-3">
          {rows.map((row) => {
            const session = pickLocalized(row, "session_title", lang);
            const unseated = Math.max(0, row.seatable_registrations - row.seats_assigned);
            return (
              <li key={row.id} className="space-y-3 rounded-[6px] border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{row.name}</h3>
                      <Badge variant={row.status === "published" ? "default" : "outline"}>
                        {t(
                          row.status === "published"
                            ? "adminEventSeating.status.published"
                            : "adminEventSeating.status.draft",
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        row.room_name === null ? null : t("adminEventSeating.list.room", { name: row.room_name }),
                        session === ""
                          ? t("adminEventSeating.list.wholeEvent")
                          : t("adminEventSeating.list.session", { title: session }),
                      ]
                        .filter((part): part is string => part !== null)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => onOpenMap(row.id)}>
                      {t("adminEventSeating.list.open")}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("adminEventSeating.list.edit", { name: row.name })}
                      onClick={() => setDialog({ map: mapInfoFromRow(row) })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("adminEventSeating.list.delete", { name: row.name })}
                      onClick={() => void remove(row)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <AdminMetricTile icon={Armchair} label={t("adminEventSeating.list.metrics.seats")} value={row.seats_total} />
                  <AdminMetricTile
                    icon={Users}
                    label={t("adminEventSeating.list.metrics.assigned")}
                    value={row.seats_assigned}
                    tone="ok"
                  />
                  <AdminMetricTile icon={Lock} label={t("adminEventSeating.list.metrics.held")} value={row.seats_held} />
                  <AdminMetricTile icon={Ban} label={t("adminEventSeating.list.metrics.blocked")} value={row.seats_blocked} />
                  <AdminMetricTile
                    icon={UserX}
                    label={t("adminEventSeating.list.metrics.unseated")}
                    hint={t("adminEventSeating.list.metrics.unseatedHint")}
                    value={unseated}
                    tone={unseated > 0 ? "warn" : "neutral"}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>

      <EventSeatMapDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        eventId={eventId}
        map={dialog?.map ?? null}
        isSaving={saveMap.isPending}
        onSubmit={(input) =>
          saveMap.mutate(input, {
            onSuccess: (id) => {
              const created = input.id === undefined;
              setDialog(null);
              toast.success(t("adminEventSeating.toasts.mapSaved"));
              if (created) onOpenMap(id);
            },
            onError: (error) => toast.error(adminSeatingErrorMessage(error)),
          })
        }
      />
    </section>
  );
}
