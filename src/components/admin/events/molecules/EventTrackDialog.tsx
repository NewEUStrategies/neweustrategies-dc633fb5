// Molekuła: formularz jednej ŚCIEŻKI programu.
//
// KLUCZA I KOLEJNOŚCI NIE PYTAMY. Klucz jest identyfikatorem technicznym -
// wyprowadzamy go z nazwy (`deriveTrackKey`) i zamrażamy po zapisie, a kolejność
// nadaje lista (`nextSortOrder`). Organizator opisuje pasmo, nie schemat bazy.
//
// KOLOR MA WŁASNY PRÓBNIK, ale trzymamy go jako tekst: `#RRGGBB` wraca na
// publiczną agendę i musi przejść wzór, zanim pojedzie do bazy.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { EventImageDropzone } from "@/components/admin/events/atoms/EventImageDropzone";
import { useEventRooms } from "@/lib/events/useEventSessions";
import {
  AGENDA_MAX_DESCRIPTION,
  AGENDA_MAX_NAME,
  AGENDA_MAX_TAGLINE,
  emptyTrackDraft,
  trackDraftFromRow,
  trackDraftToInput,
  validateTrackDraft,
  type TrackDraft,
} from "@/lib/events/agendaCatalogDraft";
import type { EventTrackInput, EventTrackRow } from "@/lib/events/sessionsApi";

/** Wartownik „bez sali" - Radix Select zabrania pustego `value`. */
const NO_ROOM = "__none__";

interface EventTrackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa ścieżka. */
  track: EventTrackRow | null;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventTrackInput) => void;
}

export function EventTrackDialog({
  open,
  onOpenChange,
  eventId,
  track,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventTrackDialogProps) {
  const { t } = useTranslation();
  // Sala domyślna to podpowiedź pasma, więc lista sal jest tu potrzebna tylko
  // wtedy, gdy formularz jest otwarty.
  const roomsQ = useEventRooms(open ? eventId : null);
  const [draft, setDraft] = useState<TrackDraft>(() => emptyTrackDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  // Szkic odtwarzamy przy KAŻDYM otwarciu - porzucone zmiany nie mogą wrócić
  // do formularza następnej ścieżki.
  //
  // ZALEŻNOŚĆ JEST TOŻSAMOŚCIĄ WIERSZA, NIE OBIEKTEM - dokładnie jak
  // w `EventTicketDialog`. `track` i `nextSortOrder` przelicza rodzic
  // (`AgendaTracksPanel`) z ŻYWEJ listy pasm przy KAŻDYM renderze, więc
  // odświeżenie tej listy w tle - pasmo dołożone przez drugiego organizatora,
  // powrót do karty przeglądarki po `staleTime` - podawało tu nowe referencje,
  // efekt ruszał PRZY OTWARTYM oknie i zamiatał całą wpisaną pracę do wartości
  // z wiersza (a przy nowym paśmie - do pustego formularza), bez ostrzeżenia
  // i bez śladu. Kolejność początkowa idzie przez `ref`, bo jest potrzebna
  // TYLKO w chwili otwarcia i nie ma prawa niczego wznawiać.
  const nextSortOrderRef = useRef(nextSortOrder);
  nextSortOrderRef.current = nextSortOrder;
  const trackRef = useRef(track);
  trackRef.current = track;
  const trackId = track === null ? null : track.id;

  useEffect(() => {
    if (!open) return;
    const row = trackRef.current;
    setDraft(row === null ? emptyTrackDraft(nextSortOrderRef.current) : trackDraftFromRow(row));
    setTouched(false);
  }, [open, trackId]);

  const errors = validateTrackDraft(draft);
  const errorFor = (field: keyof TrackDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof TrackDraft>(key: K, value: TrackDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(trackDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventAgenda.tracks.dialog.createTitle"
                : "adminEventAgenda.tracks.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventAgenda.tracks.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventAgenda.tracks.title")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={AGENDA_MAX_NAME}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={AGENDA_MAX_NAME}
            error={errorFor("nameEn")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.accentColor")}
            value={draft.accentColor}
            onValueChange={(value) => set("accentColor", value)}
            placeholder="#FA9346"
            monospace
            maxLength={7}
          />
          {/* PUSTA WARTOŚĆ NIE MOŻE TRAFIĆ DO <Select.Item> (Radix rzuca wyjątkiem
              i cały ekran ląduje w boundary „nie udało się załadować"), więc brak
              sali jedzie pod wartownikiem i wraca do pustego stringa przy zapisie. */}
          <AdminFormEnumRow
            label={t("adminEventAgenda.tracks.dialog.defaultRoom")}
            hint={t("adminEventAgenda.tracks.dialog.defaultRoomHint")}
            value={draft.defaultRoomId === "" ? NO_ROOM : draft.defaultRoomId}
            options={[NO_ROOM, ...(roomsQ.data ?? []).map((room) => String(room.id))]}
            labelFor={(option) =>
              option === NO_ROOM
                ? t("adminEventAgenda.tracks.dialog.defaultRoomNone")
                : ((roomsQ.data ?? []).find((room) => String(room.id) === option)?.name ?? option)
            }
            onValueChange={(value) => set("defaultRoomId", value === NO_ROOM ? "" : value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventAgenda.tracks.dialog.isActive")}
            hint={t("adminEventAgenda.tracks.dialog.isActiveHint")}
            checked={draft.isActive}
            onCheckedChange={(value) => set("isActive", value)}
          />
          <AdminFormSwitchRow
            label={t("adminEventAgenda.tracks.dialog.isPublic")}
            hint={t("adminEventAgenda.tracks.dialog.isPublicHint")}
            checked={draft.isPublic}
            onCheckedChange={(value) => set("isPublic", value)}
          />
        </AdminFormSection>

        <AdminFormSection title={t("adminEventAgenda.tracks.dialog.storySection")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.taglinePl")}
            value={draft.taglinePl}
            onValueChange={(value) => set("taglinePl", value)}
            maxLength={AGENDA_MAX_TAGLINE}
            error={errorFor("taglinePl")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.taglineEn")}
            value={draft.taglineEn}
            onValueChange={(value) => set("taglineEn", value)}
            maxLength={AGENDA_MAX_TAGLINE}
            error={errorFor("taglineEn")}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.descriptionPl")}
            value={draft.descriptionPl}
            onValueChange={(value) => set("descriptionPl", value)}
            maxLength={AGENDA_MAX_DESCRIPTION}
            rows={5}
          />
          <AdminFormTextRow
            label={t("adminEventAgenda.tracks.dialog.descriptionEn")}
            value={draft.descriptionEn}
            onValueChange={(value) => set("descriptionEn", value)}
            maxLength={AGENDA_MAX_DESCRIPTION}
            rows={5}
          />
          <EventImageDropzone
            className="md:col-span-2"
            label={t("adminEventAgenda.tracks.dialog.coverUrl")}
            hint={t("adminEventAgenda.tracks.dialog.coverUrlHint")}
            recommendation="1600 x 900 px (16:9), JPG/WebP, < 1 MB"
            value={draft.coverUrl}
            onValueChange={(value) => set("coverUrl", value)}
            subfolder="event-tracks"
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventAgenda.tracks.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventAgenda.tracks.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
