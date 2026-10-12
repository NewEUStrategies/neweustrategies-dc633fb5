// Molekula: formularz JEDNEGO okna dostepnosci uczestnika.
//
// DIALOG, A NIE EDYCJA W MIEJSCU. Okno dostepnosci nie jest ozdoba - decyduje
// o tym, na jakie terminy inni moga wyslac uczestnikowi zaproszenie. Zmiana
// przypadkiem, przewijaniem listy, zamykalaby mu terminarz bez sladu.
//
// GODZINY WPISUJE SIE W STREFIE WYDARZENIA (OPS-15). W niej baza liczy siatke
// slotow i w niej wydrukowany jest program. Zdanie nad polami mowi, w jakiej
// strefie sa godziny; gdy strefa uczestnika jest inna, obok stoi przelacznik
// "wpisuje w mojej strefie" z nazwa tej strefy, a pod kazdym polem - ta sama
// chwila w DRUGIEJ strefie. Uczestnik z Londynu widzi wiec przed zapisem, ze
// 9:30 w Warszawie to 8:30 u niego, i moze wpisywac tak, jak mu wygodniej.
//
// Przelacznik przepisuje pola na nowa strefe (ta sama chwila), wiec nie
// przesuwa okna. Wybor przezywa kolejne otwarcia dialogu - kto wpisuje okna we
// wlasnej strefie, nie przelacza przy kazdym.
//
// GODZINA Z NOCY ZMIANY CZASU dostaje wlasne zdanie: brakujaca (wiosna) mowi,
// na ktora godzine ja przesuwamy, podwojna (jesien) - ktore wystapienie
// przyjmujemy. Regula jest ta sama co w bazie (`lib/events/timezone.ts`).
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatEventDateTime, formatEventTime, type ZonedInstant } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import {
  NEW_WINDOW_DRAFT,
  hasZoneChoice,
  switchDraftZone,
  validateWindowDraft,
  windowInstants,
  windowPayload,
  windowZones,
  zoneOf,
  type WindowDraft,
  type WindowInputZone,
  type WindowPayload,
} from "@/lib/events/meetingWindowDraft";

const BASE = "eventMeetings.participant.availability";
const ZONE_NOTE_ID = "availability-zone-active";

export function AvailabilityWindowDialog({
  open,
  draft,
  timezone,
  isSaving,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  /** `null` = nowe okno; niepusty szkic = edycja istniejacego. */
  draft: WindowDraft | null;
  timezone: string | null;
  isSaving: boolean;
  onSubmit: (payload: WindowPayload) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // Strefa przegladarki czytana przy renderze klienta. Na serwerze dialog jest
  // zamkniety (tresc renderuje sie dopiero po otwarciu), wiec strefa maszyny
  // nie trafia do HTML-a.
  const zones = useMemo(() => windowZones(timezone), [timezone]);
  const choice = hasZoneChoice(zones);
  const preferredZone = useRef<WindowInputZone>("event");
  const [form, setForm] = useState<WindowDraft>(draft ?? NEW_WINDOW_DRAFT);

  // Szkic przychodzi z listy, wiec musi nadpisac stan przy KAZDYM otwarciu -
  // inaczej drugie klikniecie "edytuj" pokazuje poprzedni wiersz. Wybrana
  // strefa jest czytana z refa: zmiana strefy nie moze resetowac formularza.
  useEffect(() => {
    if (open) setForm(switchDraftZone(draft ?? NEW_WINDOW_DRAFT, preferredZone.current, zones));
  }, [open, draft, zones]);

  function chooseZone(mine: boolean): void {
    const next: WindowInputZone = mine ? "viewer" : "event";
    preferredZone.current = next;
    setForm((prev) => switchDraftZone(prev, next, zones));
  }

  const problem = validateWindowDraft(form, zones);
  const payload = windowPayload(form, zones);
  const instants = windowInstants(form, zones);
  const inMine = choice && form.inputZone === "viewer";
  const fieldZone = zoneOf(form.inputZone, zones);
  const otherZone = inMine ? zones.event : zones.viewer;

  function fieldNotes(resolved: ZonedInstant | null): string[] {
    if (resolved === null) return [];
    const notes: string[] = [];
    if (resolved.resolution === "gap") {
      notes.push(
        t(`${BASE}.zone.gap`, {
          zone: fieldZone,
          value: formatEventTime(resolved.iso, fieldZone, lang),
        }),
      );
    } else if (resolved.resolution === "overlap") {
      notes.push(
        t(`${BASE}.zone.overlap`, {
          zone: fieldZone,
          value: formatEventDateTime(resolved.iso, fieldZone, lang, {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          }),
        }),
      );
    }
    if (choice) {
      notes.push(
        t(inMine ? `${BASE}.zone.inEvent` : `${BASE}.zone.inMine`, {
          zone: otherZone,
          value: formatEventDateTime(resolved.iso, otherZone, lang),
        }),
      );
    }
    return notes;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {form.id === null ? t(`${BASE}.dialogNew`) : t(`${BASE}.dialogEdit`)}
          </DialogTitle>
          <DialogDescription>{t(`${BASE}.durationHint`)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border px-3 py-2">
          <p id={ZONE_NOTE_ID} className="text-xs text-muted-foreground">
            {inMine
              ? t(`${BASE}.zone.activeMine`, { zone: zones.viewer })
              : t(`${BASE}.zone.activeEvent`, { zone: zones.event })}
          </p>
          {choice ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="availability-my-zone" className="text-sm font-normal">
                {t(`${BASE}.zone.useMine`, { zone: zones.viewer })}
              </Label>
              <Switch
                id="availability-my-zone"
                checked={inMine}
                aria-describedby={ZONE_NOTE_ID}
                onCheckedChange={chooseZone}
              />
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <WindowTimeField
            id="availability-from"
            label={t(`${BASE}.from`)}
            value={form.startsAtLocal}
            notes={fieldNotes(instants.startsAt)}
            onChange={(value) => setForm((prev) => ({ ...prev, startsAtLocal: value }))}
          />
          <WindowTimeField
            id="availability-to"
            label={t(`${BASE}.to`)}
            value={form.endsAtLocal}
            notes={fieldNotes(instants.endsAt)}
            onChange={(value) => setForm((prev) => ({ ...prev, endsAtLocal: value }))}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label htmlFor="availability-open" className="text-sm font-normal">
            {t(`${BASE}.openField`)}
          </Label>
          <Switch
            id="availability-open"
            checked={form.isOpen}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isOpen: checked }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availability-note">{t("eventMeetings.fields.note")}</Label>
          <Textarea
            id="availability-note"
            rows={2}
            maxLength={300}
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("eventMeetings.participant.form.dismiss")}
          </Button>
          <Button
            disabled={isSaving || payload === null}
            onClick={() => {
              if (payload !== null) onSubmit(payload);
            }}
          >
            {t("eventMeetings.participant.form.save")}
          </Button>
        </DialogFooter>

        {problem !== null && problem !== "incomplete" ? (
          <p role="alert" className="text-xs text-destructive">
            {t(`${BASE}.validation.${problem}`)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pole godziny z podpisami. Podpisy sa podpiete pod `aria-describedby` razem
 * ze zdaniem o strefie - czytnik ekranu oglasza strefe przy kazdym polu, a nie
 * tylko raz nad nimi.
 */
function WindowTimeField({
  id,
  label,
  value,
  notes,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  notes: string[];
  onChange: (value: string) => void;
}) {
  const notesId = `${id}-notes`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <DateInput
        id={id}
        type="datetime-local"
        value={value}
        aria-describedby={notes.length > 0 ? `${ZONE_NOTE_ID} ${notesId}` : ZONE_NOTE_ID}
        onChange={(event) => onChange(event.target.value)}
      />
      {notes.length > 0 ? (
        <div id={notesId} className="space-y-0.5">
          {notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
