// Molekula: formularz PLANU SALI (nazwa, sala agendy, sesja, rozmiar, scena).
//
// SALA I SESJA SA OPCJONALNE. Plan "Gala 19:00" wskazuje sale i sesje, plan
// konferencji - tylko sale, a plan plenerowy - nic. Sesja NULL znaczy "cale
// wydarzenie".
//
// EFEKT ZALEZY OD TOZSAMOSCI PLANU, NIE OD OBIEKTU (wzorzec `EventRoomDialog`):
// lista planow odswieza sie w tle i podaje nowe referencje - efekt na obiekcie
// kasowalby wpisana prace przy otwartym oknie.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { SeatMapInfo, SeatMapInput } from "@/lib/events/seatingApi";
import {
  SEAT_MAP_NAME_MAX,
  emptyMapDraft,
  mapDraftFromMap,
  mapDraftToInput,
  validateMapDraft,
  type MapDraft,
  type MapField,
} from "@/lib/events/seatingDraft";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useEventRooms, useEventSessions } from "@/lib/events/useEventSessions";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

const NONE = "__none__";

export interface EventSeatMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy plan. */
  map: SeatMapInfo | null;
  isSaving: boolean;
  onSubmit: (input: SeatMapInput) => void;
}

export function EventSeatMapDialog({
  open,
  onOpenChange,
  eventId,
  map,
  isSaving,
  onSubmit,
}: EventSeatMapDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<MapDraft>(emptyMapDraft);
  const [touched, setTouched] = useState(false);
  const rooms = useEventRooms(open ? eventId : null);
  const sessions = useEventSessions(open ? { eventId, ...DEFAULT_SESSIONS_QUERY } : null);

  const mapRef = useRef(map);
  mapRef.current = map;
  const mapId = map === null ? null : map.id;

  useEffect(() => {
    if (!open) return;
    const current = mapRef.current;
    setDraft(current === null ? emptyMapDraft() : mapDraftFromMap(current));
    setTouched(false);
  }, [open, mapId]);

  const errors = validateMapDraft(draft);
  const errorFor = (field: MapField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };
  const set = <K extends keyof MapDraft>(key: K, value: MapDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(mapDraftToInput(draft, eventId));
  };

  const roomOptions = [
    { value: NONE, label: t("adminEventSeating.mapDialog.noRoom") },
    ...(rooms.data ?? []).map((room) => ({ value: room.id, label: room.name })),
  ];
  const sessionOptions = [
    { value: NONE, label: t("adminEventSeating.mapDialog.noSession") },
    ...(sessions.data ?? []).map((session) => ({
      value: session.id,
      label: pickLocalized(session, "title", lang),
    })),
  ];
  const stageError = errorFor("stage");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              draft.id === null
                ? "adminEventSeating.mapDialog.createTitle"
                : "adminEventSeating.mapDialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventSeating.mapDialog.description")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventSeating.mapDialog.name")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventSeating.mapDialog.name")}
            value={draft.name}
            onValueChange={(value) => set("name", value)}
            maxLength={SEAT_MAP_NAME_MAX}
            error={errorFor("name")}
            className="sm:col-span-2"
          />
          <div className="space-y-1.5">
            <Label htmlFor="seat-map-room">{t("adminEventSeating.mapDialog.room")}</Label>
            <FormSelect
              id="seat-map-room"
              value={draft.roomId ?? NONE}
              options={roomOptions}
              onValueChange={(value) => set("roomId", value === NONE ? null : value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seat-map-session">{t("adminEventSeating.mapDialog.session")}</Label>
            <FormSelect
              id="seat-map-session"
              value={draft.sessionId ?? NONE}
              options={sessionOptions}
              onValueChange={(value) => set("sessionId", value === NONE ? null : value)}
            />
          </div>
          <AdminFormTextRow
            label={t("adminEventSeating.mapDialog.width")}
            value={draft.width}
            onValueChange={(value) => set("width", value)}
            inputMode="numeric"
            error={errorFor("width")}
          />
          <AdminFormTextRow
            label={t("adminEventSeating.mapDialog.height")}
            value={draft.height}
            onValueChange={(value) => set("height", value)}
            inputMode="numeric"
            error={errorFor("height")}
          />
          <AdminFormSwitchRow
            label={t("adminEventSeating.mapDialog.stage")}
            hint={t("adminEventSeating.mapDialog.stageHint")}
            checked={draft.stageEnabled}
            onCheckedChange={(value) => set("stageEnabled", value)}
            className="sm:col-span-2"
          />
          {draft.stageEnabled ? (
            <>
              <AdminFormTextRow
                label={t("adminEventSeating.mapDialog.stageX")}
                value={draft.stageX}
                onValueChange={(value) => set("stageX", value)}
                inputMode="decimal"
                error={stageError}
              />
              <AdminFormTextRow
                label={t("adminEventSeating.mapDialog.stageY")}
                value={draft.stageY}
                onValueChange={(value) => set("stageY", value)}
                inputMode="decimal"
              />
              <AdminFormTextRow
                label={t("adminEventSeating.mapDialog.stageW")}
                value={draft.stageW}
                onValueChange={(value) => set("stageW", value)}
                inputMode="decimal"
              />
              <AdminFormTextRow
                label={t("adminEventSeating.mapDialog.stageH")}
                value={draft.stageH}
                onValueChange={(value) => set("stageH", value)}
                inputMode="decimal"
              />
            </>
          ) : null}
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSeating.mapDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSeating.mapDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
