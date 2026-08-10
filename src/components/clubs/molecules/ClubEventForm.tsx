// Molekuła: okno tworzenia i redakcji wydarzenia klubu.
//
// JEDEN komponent na "dodaj" i "edytuj", tak jak przy dokumentach: pola są te
// same, a rozdzielenie kończy się dwiema ścieżkami, z których jedna nigdy nie
// jest przetestowana.
//
// SLUG NIE JEST POLEM FORMULARZA. Kurator wpisuje tytuł, adres wydarzenia
// powstaje z niego automatycznie (`clubEventSlug`) - przy redakcji zostaje
// nietknięty, bo zmiana adresu psuje linki rozesłane w zaproszeniach.
//
// CZAS: pola `datetime-local` / `date` niosą czas LOKALNY bez strefy, a do
// bazy jedzie ISO ze strefą. Wydarzenie całodniowe kotwiczymy w POŁUDNIE, bo
// północ po przeliczeniu na UTC wypada dzień wcześniej w całej Europie.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CLUB_EVENT_KINDS,
  CLUB_EVENT_STATUSES,
  toEventKind,
  toEventStatus,
  type ClubEventKind,
  type ClubEventRow,
  type ClubEventStatus,
  type ClubEventUpsertInput,
} from "@/lib/clubs/workspaceTypes";
import { clubEventSlug } from "@/lib/clubs/eventSlug";
import { toIsoValue, toLocalInputValue } from "@/components/clubs/molecules/ClubMilestoneForm";

export function ClubEventForm({
  open,
  initial,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** `null` = nowe wydarzenie. */
  initial: ClubEventRow | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ClubEventUpsertInput) => void;
}) {
  const { t } = useTranslation();
  const editing = initial !== null;

  const [allDay, setAllDay] = useState(initial?.all_day ?? false);
  const [titlePl, setTitlePl] = useState(initial?.title_pl ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title_en ?? "");
  const [descPl, setDescPl] = useState(initial?.description_pl ?? "");
  const [descEn, setDescEn] = useState(initial?.description_en ?? "");
  const [kind, setKind] = useState<ClubEventKind>(toEventKind(initial?.kind ?? ""));
  const [status, setStatus] = useState<ClubEventStatus>(toEventStatus(initial?.status ?? ""));
  const [startsAt, setStartsAt] = useState(
    toLocalInputValue(initial?.starts_at ?? null, initial?.all_day ?? false),
  );
  const [endsAt, setEndsAt] = useState(
    toLocalInputValue(initial?.ends_at ?? null, initial?.all_day ?? false),
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(initial?.meeting_url ?? "");
  const [rsvpEnabled, setRsvpEnabled] = useState(initial?.rsvp_enabled ?? true);
  const [capacity, setCapacity] = useState(
    initial?.capacity !== null && initial?.capacity !== undefined ? String(initial.capacity) : "",
  );

  // Tytuł w drugim języku nie jest wymagany od kuratora - baza wymaga obu
  // (CHECK na długość), więc pusty przepisujemy z tego, który wpisano.
  const pl = titlePl.trim();
  const en = titleEn.trim();
  const invalid = (pl.length < 2 && en.length < 2) || startsAt.length === 0;

  const submit = () => {
    if (invalid) return;
    const finalPl = pl.length >= 2 ? pl : en;
    const finalEn = en.length >= 2 ? en : pl;
    const capacityValue = capacity.trim().length > 0 ? Number.parseInt(capacity, 10) : null;

    onSubmit({
      ...(editing ? { id: initial.id } : { slug: clubEventSlug(finalPl) }),
      title_pl: finalPl,
      title_en: finalEn,
      description_pl: descPl.trim().length > 0 ? descPl.trim() : null,
      description_en: descEn.trim().length > 0 ? descEn.trim() : null,
      kind,
      status,
      all_day: allDay,
      starts_at: toIsoValue(startsAt, allDay) ?? new Date().toISOString(),
      ends_at: endsAt.length > 0 ? toIsoValue(endsAt, allDay) : null,
      location: location.trim().length > 0 ? location.trim() : null,
      meeting_url: meetingUrl.trim().length > 0 ? meetingUrl.trim() : null,
      rsvp_enabled: rsvpEnabled,
      capacity:
        capacityValue !== null && Number.isFinite(capacityValue) && capacityValue > 0
          ? capacityValue
          : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("club.eventForm.editTitle") : t("club.eventForm.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("club.eventForm.lead")}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="club-event-title-pl">{t("club.eventForm.titlePl")}</Label>
            <Input
              id="club-event-title-pl"
              className="mt-1"
              maxLength={200}
              value={titlePl}
              onChange={(event) => setTitlePl(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="club-event-title-en">{t("club.eventForm.titleEn")}</Label>
            <Input
              id="club-event-title-en"
              className="mt-1"
              maxLength={200}
              value={titleEn}
              onChange={(event) => setTitleEn(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="club-event-kind">{t("club.eventForm.kind")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(toEventKind(value))}>
              <SelectTrigger id="club-event-kind" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLUB_EVENT_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`club.calendar.kind.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="club-event-status">{t("club.eventForm.status")}</Label>
            <Select value={status} onValueChange={(value) => setStatus(toEventStatus(value))}>
              <SelectTrigger id="club-event-status" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLUB_EVENT_STATUSES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`club.calendar.status.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2 sm:col-span-2">
            <Label htmlFor="club-event-allday" className="text-sm font-normal">
              {t("club.eventForm.allDay")}
            </Label>
            <Switch
              id="club-event-allday"
              checked={allDay}
              onCheckedChange={(value) => {
                // Zmiana typu pola musi przyciąć wartości, inaczej "2026-08-10T18:00"
                // zostaje w polu typu `date` i przeglądarka je czyści po cichu.
                setAllDay(value);
                setStartsAt((current) => (value ? current.slice(0, 10) : current));
                setEndsAt((current) => (value ? current.slice(0, 10) : current));
              }}
            />
          </div>

          <div>
            <Label htmlFor="club-event-start">{t("club.eventForm.startsAt")}</Label>
            <Input
              id="club-event-start"
              className="mt-1"
              type={allDay ? "date" : "datetime-local"}
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="club-event-end">{t("club.eventForm.endsAt")}</Label>
            <Input
              id="club-event-end"
              className="mt-1"
              type={allDay ? "date" : "datetime-local"}
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="club-event-location">{t("club.eventForm.location")}</Label>
            <Input
              id="club-event-location"
              className="mt-1"
              maxLength={200}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="club-event-url">{t("club.eventForm.meetingUrl")}</Label>
            <Input
              id="club-event-url"
              className="mt-1"
              type="url"
              inputMode="url"
              value={meetingUrl}
              onChange={(event) => setMeetingUrl(event.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="club-event-desc-pl">{t("club.eventForm.descriptionPl")}</Label>
            <Textarea
              id="club-event-desc-pl"
              className="mt-1"
              rows={3}
              value={descPl}
              onChange={(event) => setDescPl(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="club-event-desc-en">{t("club.eventForm.descriptionEn")}</Label>
            <Textarea
              id="club-event-desc-en"
              className="mt-1"
              rows={3}
              value={descEn}
              onChange={(event) => setDescEn(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2">
            <Label htmlFor="club-event-rsvp" className="text-sm font-normal">
              {t("club.eventForm.rsvpEnabled")}
            </Label>
            <Switch id="club-event-rsvp" checked={rsvpEnabled} onCheckedChange={setRsvpEnabled} />
          </div>
          <div>
            <Label htmlFor="club-event-capacity">{t("club.eventForm.capacity")}</Label>
            <Input
              id="club-event-capacity"
              className="mt-1"
              type="number"
              min={1}
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("club.eventForm.cancel")}
            </Button>
            <Button type="submit" disabled={invalid || pending}>
              {editing ? t("club.eventForm.save") : t("club.eventForm.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
