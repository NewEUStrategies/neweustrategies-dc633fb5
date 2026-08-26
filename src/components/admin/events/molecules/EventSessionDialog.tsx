// Molekuła: formularz jednej SESJI programu.
//
// LIMIT MIEJSC ZALEŻY OD ZAPISÓW. Baza odmawia limitu bez włączonych zapisów
// (`capacity_requires_signup`), więc pole limitu jest zablokowane, dopóki
// przełącznik zapisów jest wyłączony - zamiast pozwalać wpisać liczbę, która
// wróci odmową.
//
// ŚCIEŻKA, SALA I SESJA NADRZĘDNA TO DROPLISTY Z DANYCH WYDARZENIA. Wpisywany
// identyfikator byłby jedynym miejscem panelu, gdzie organizator musi znać UUID.
//
// SESJA NADRZĘDNA NIE MOŻE BYĆ TĄ SESJĄ ani podsesją innej (`parent_depth`),
// więc lista kandydatów jest już odfiltrowana - odmowa bazy to ostatnia linia,
// nie pierwsza.
import { useEffect, useMemo, useState } from "react";
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
import { useSessionDetail } from "@/lib/events/useEventSessions";
import {
  SESSION_MAX_DESCRIPTION,
  SESSION_MAX_TITLE,
  emptySessionDraft,
  sessionDraftFromRow,
  sessionDraftToInput,
  validateSessionDraft,
  type SessionDraft,
} from "@/lib/events/sessionDraft";
import {
  SESSION_FORMATS,
  SESSION_STATUSES,
  type EventRoomRow,
  type EventSessionInput,
  type EventSessionRow,
  type EventTrackRow,
} from "@/lib/events/sessionsApi";

/** Wartość dropslisty dla „brak wyboru" - `SelectItem` nie przyjmuje pustego stringu. */
const NONE = "__none__";

interface EventSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa sesja. */
  session: EventSessionRow | null;
  tracks: readonly EventTrackRow[];
  rooms: readonly EventRoomRow[];
  /** Kandydaci na sesję nadrzędną - pełna lista sesji wydarzenia. */
  sessions: readonly EventSessionRow[];
  /** Strefa wydarzenia; godziny wpisuje się w niej, nie w UTC. */
  timeZoneLabel: string;
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventSessionInput) => void;
}

export function EventSessionDialog({
  open,
  onOpenChange,
  eventId,
  session,
  tracks,
  rooms,
  sessions,
  timeZoneLabel,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventSessionDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pl";
  const [draft, setDraft] = useState<SessionDraft>(() => emptySessionDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  // SZCZEGOL, A NIE WIERSZ LISTY. `stream_url` i `recording_url` sa odciete
  // od klienckiego SELECT-a grantem kolumnowym (patrz granty w migracji
  // 20260823140000), wiec wiersz listy ICH NIE NIESIE. Budowanie draftu
  // z listy dawalo w obu polach pusty ciag, a zapis odsylal go jako `null` -
  // czyli KAZDE otwarcie i zapisanie sesji kasowalo adres transmisji
  // i nagrania. Panel czyta te kolumny wylacznie przez
  // `admin_event_session_detail`, dokladnie jak zapowiada naglowek migracji.
  const detailQuery = useSessionDetail(open && session !== null ? session.id : null);
  const detail = detailQuery.data ?? null;

  useEffect(() => {
    if (!open) return;
    if (session === null) {
      setDraft(emptySessionDraft(nextSortOrder));
      setTouched(false);
      return;
    }
    // Do czasu przyjscia szczegolu draft zostaje pusty, a zapis jest zablokowany
    // nizej - inaczej wrocilaby ta sama utrata danych, tylko przez wyscig.
    if (detail === null) return;
    setDraft(sessionDraftFromRow(detail));
    setTouched(false);
  }, [open, session, detail, nextSortOrder]);

  /** Edycja czeka na szczegol; nowa sesja nie ma na co czekac. */
  const isLoadingDetail = session !== null && detail === null;

  const errors = validateSessionDraft(draft);
  const errorFor = (field: keyof SessionDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof SessionDraft>(key: K, value: SessionDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const parentCandidates = useMemo(
    () =>
      sessions.filter((row) => {
        if (draft.id !== null && row.id === draft.id) return false;
        // Drzewo ma dwa poziomy: sesja, która sama ma rodzica, nie może być rodzicem.
        return row.parent_session_id === "" || row.parent_session_id === null;
      }),
    [sessions, draft.id],
  );

  const label = (pl: string, en: string): string => (lang === "en" ? en || pl : pl || en);

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(sessionDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;
  const trackValue = draft.trackId ?? NONE;
  const roomValue = draft.roomId ?? NONE;
  const parentValue = draft.parentSessionId ?? NONE;

  const trackOptions: readonly string[] = [NONE, ...tracks.map((row) => row.id)];
  const roomOptions: readonly string[] = [NONE, ...rooms.map((row) => row.id)];
  const parentOptions: readonly string[] = [NONE, ...parentCandidates.map((row) => row.id)];

  const trackLabel = (value: string): string => {
    if (value === NONE) return t("adminEventAgenda.sessions.noTrack");
    const found = tracks.find((row) => row.id === value);
    return found === undefined ? value : label(found.name_pl, found.name_en);
  };
  const roomLabel = (value: string): string => {
    if (value === NONE) return t("adminEventAgenda.sessions.noRoom");
    const found = rooms.find((row) => row.id === value);
    return found === undefined ? value : found.name;
  };
  const parentLabel = (value: string): string => {
    if (value === NONE) return "-";
    const found = parentCandidates.find((row) => row.id === value);
    return found === undefined ? value : label(found.title_pl, found.title_en);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventAgenda.sessionDialog.createTitle"
                : "adminEventAgenda.sessionDialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {t("adminEventAgenda.sessionDialog.timeZoneHint", { zone: timeZoneLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <AdminFormSection title={t("adminEventAgenda.sessions.title")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.titlePl")}
              value={draft.titlePl}
              onValueChange={(value) => set("titlePl", value)}
              maxLength={SESSION_MAX_TITLE}
              error={errorFor("titlePl")}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.titleEn")}
              value={draft.titleEn}
              onValueChange={(value) => set("titleEn", value)}
              maxLength={SESSION_MAX_TITLE}
              error={errorFor("titleEn")}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.descriptionPl")}
              value={draft.descriptionPl}
              onValueChange={(value) => set("descriptionPl", value)}
              rows={3}
              maxLength={SESSION_MAX_DESCRIPTION}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.descriptionEn")}
              value={draft.descriptionEn}
              onValueChange={(value) => set("descriptionEn", value)}
              rows={3}
              maxLength={SESSION_MAX_DESCRIPTION}
            />
          </AdminFormSection>

          <AdminFormSection
            title={t("adminEventAgenda.sessionDialog.startsAt")}
            hint={t("adminEventAgenda.sessionDialog.timeZoneHint", { zone: timeZoneLabel })}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.startsAt")}
              value={draft.startsAt}
              onValueChange={(value) => set("startsAt", value)}
              type="datetime-local"
              error={errorFor("startsAt")}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.endsAt")}
              value={draft.endsAt}
              onValueChange={(value) => set("endsAt", value)}
              type="datetime-local"
              error={errorFor("endsAt")}
            />
            <AdminFormEnumRow
              label={t("adminEventAgenda.sessionDialog.format")}
              value={draft.format}
              options={SESSION_FORMATS}
              labelFor={(option) => t(`adminEventAgenda.formats.${option}`)}
              onValueChange={(value) => set("format", value)}
            />
            <AdminFormEnumRow
              label={t("adminEventAgenda.sessionDialog.status")}
              value={draft.status}
              options={SESSION_STATUSES}
              labelFor={(option) => t(`adminEventAgenda.statuses.${option}`)}
              onValueChange={(value) => set("status", value)}
            />
          </AdminFormSection>

          <AdminFormSection title={t("adminEventAgenda.nav.tracks")} columns={2}>
            <AdminFormEnumRow
              label={t("adminEventAgenda.sessionDialog.track")}
              value={trackValue}
              options={trackOptions}
              labelFor={trackLabel}
              onValueChange={(value) => set("trackId", value === NONE ? null : value)}
            />
            <AdminFormEnumRow
              label={t("adminEventAgenda.sessionDialog.room")}
              value={roomValue}
              options={roomOptions}
              labelFor={roomLabel}
              onValueChange={(value) => set("roomId", value === NONE ? null : value)}
            />
            <AdminFormEnumRow
              label={t("adminEventAgenda.sessionDialog.parentSession")}
              hint={t("adminEventAgenda.sessionDialog.parentSessionHint")}
              value={parentValue}
              options={parentOptions}
              labelFor={parentLabel}
              onValueChange={(value) => set("parentSessionId", value === NONE ? null : value)}
              className="sm:col-span-2"
            />
          </AdminFormSection>

          <AdminFormSection title={t("adminEventAgenda.sessionDialog.requiresSignup")} columns={2}>
            <AdminFormSwitchRow
              label={t("adminEventAgenda.sessionDialog.requiresSignup")}
              checked={draft.requiresSignup}
              onCheckedChange={(value) =>
                // Wyłączenie zapisów zdejmuje limit razem z nimi - inaczej szkic
                // zostawałby w stanie, który baza odmawia zapisać.
                setDraft((previous) => ({
                  ...previous,
                  requiresSignup: value,
                  capacity: value ? previous.capacity : "",
                }))
              }
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.capacity")}
              hint={t("adminEventAgenda.sessionDialog.capacityHint")}
              value={draft.capacity}
              onValueChange={(value) => set("capacity", value)}
              inputMode="numeric"
              disabled={!draft.requiresSignup}
              error={errorFor("capacity")}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.minTierRank")}
              value={draft.minTierRank}
              onValueChange={(value) => set("minTierRank", value)}
              inputMode="numeric"
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.tracks.dialog.sortOrder")}
              value={draft.sortOrder}
              onValueChange={(value) => set("sortOrder", value)}
              inputMode="numeric"
            />
            <AdminFormSwitchRow
              label={t("adminEventAgenda.sessionDialog.allowOverlap")}
              checked={draft.allowOverlap}
              onCheckedChange={(value) => set("allowOverlap", value)}
            />
            <AdminFormSwitchRow
              label={t("adminEventAgenda.sessionDialog.chathamHouse")}
              hint={t("adminEventAgenda.sessionDialog.chathamHouseHint")}
              checked={draft.chathamHouse}
              onCheckedChange={(value) => set("chathamHouse", value)}
            />
            <AdminFormSwitchRow
              label={t("adminEventAgenda.sessionDialog.isPrivate")}
              checked={draft.isPrivate}
              onCheckedChange={(value) => set("isPrivate", value)}
            />
          </AdminFormSection>

          <AdminFormSection
            title={t("adminEventAgenda.sessionDialog.streamUrl")}
            hint={t("adminEventAgenda.sessionDialog.urlHint")}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.streamUrl")}
              value={draft.streamUrl}
              onValueChange={(value) => set("streamUrl", value)}
              error={errorFor("streamUrl")}
            />
            <AdminFormTextRow
              label={t("adminEventAgenda.sessionDialog.recordingUrl")}
              value={draft.recordingUrl}
              onValueChange={(value) => set("recordingUrl", value)}
              error={errorFor("recordingUrl")}
            />
          </AdminFormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventAgenda.sessionDialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving || isLoadingDetail}>
            {t("adminEventAgenda.sessionDialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
