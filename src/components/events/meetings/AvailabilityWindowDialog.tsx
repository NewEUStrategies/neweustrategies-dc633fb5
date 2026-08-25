// Molekula: formularz JEDNEGO okna dostepnosci uczestnika.
//
// DIALOG, A NIE EDYCJA W MIEJSCU. Okno dostepnosci nie jest ozdoba - decyduje
// o tym, na jakie terminy inni moga wyslac uczestnikowi zaproszenie. Zmiana
// przypadkiem, przewijaniem listy, zamykalaby mu terminarz bez sladu.
//
// GODZINE POKAZUJEMY DWA RAZY: raz jako pole (czas lokalny przegladarki, bo tak
// mysli czlowiek) i raz jako podpis w strefie WYDARZENIA. Bez tej drugiej linii
// uczestnik z Brukseli deklaruje "9:30" i nie dowiaduje sie, ze na kongresie
// w Warszawie jest wtedy 10:30 - dopiero na miejscu.
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import {
  NEW_WINDOW_DRAFT,
  localInputToIso,
  validateWindowDraft,
  windowPayload,
  type WindowDraft,
  type WindowPayload,
} from "@/lib/events/meetingWindowDraft";

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
  const [form, setForm] = useState<WindowDraft>(draft ?? NEW_WINDOW_DRAFT);

  // Szkic przychodzi z listy, wiec musi nadpisac stan przy KAZDYM otwarciu -
  // inaczej drugie klikniecie "edytuj" pokazuje poprzedni wiersz.
  useEffect(() => {
    if (open) setForm(draft ?? NEW_WINDOW_DRAFT);
  }, [open, draft]);

  const problem = validateWindowDraft(form);
  const payload = windowPayload(form);

  function eventTimeHint(value: string): string | null {
    const iso = localInputToIso(value);
    if (iso === null) return null;
    return formatEventDateTime(iso, timezone, lang);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {form.id === null
              ? t("eventMeetings.participant.availability.dialogNew")
              : t("eventMeetings.participant.availability.dialogEdit")}
          </DialogTitle>
          <DialogDescription>
            {t("eventMeetings.participant.availability.durationHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="availability-from">
              {t("eventMeetings.participant.availability.from")}
            </Label>
            <Input
              id="availability-from"
              type="datetime-local"
              value={form.startsAtLocal}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, startsAtLocal: event.target.value }))
              }
            />
            {eventTimeHint(form.startsAtLocal) !== null ? (
              <p className="text-xs text-muted-foreground">{eventTimeHint(form.startsAtLocal)}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="availability-to">
              {t("eventMeetings.participant.availability.to")}
            </Label>
            <Input
              id="availability-to"
              type="datetime-local"
              value={form.endsAtLocal}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, endsAtLocal: event.target.value }))
              }
            />
            {eventTimeHint(form.endsAtLocal) !== null ? (
              <p className="text-xs text-muted-foreground">{eventTimeHint(form.endsAtLocal)}</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label htmlFor="availability-open" className="text-sm font-normal">
            {t("eventMeetings.participant.availability.openField")}
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
            {t("common.cancel", { defaultValue: "Anuluj" })}
          </Button>
          <Button
            disabled={isSaving || payload === null}
            onClick={() => {
              if (payload !== null) onSubmit(payload);
            }}
          >
            {t("common.save", { defaultValue: "Zapisz" })}
          </Button>
        </DialogFooter>

        {problem !== null && problem !== "incomplete" ? (
          <p className="text-xs text-destructive">
            {t("eventMeetings.participant.availability.durationHint")}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
