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
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Clock, Link as LinkIcon, MapPin, Type, Users } from "lucide-react";

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
import {
  buildClubEventUpsert,
  clubAllDayFieldValue,
  clubEventDurationLabelKey,
  clubEventEndValue,
  clubEventFormInvalid,
  clubEventPreviewTitle,
  clubEventRangeLabel,
  clubEventShowsSlug,
  clubEventStartPreset,
  toLocalInputValue,
} from "@/lib/clubs/workspaceForms";
import { clubEventSlug } from "@/lib/clubs/eventSlug";

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
  // Reguły składania payloadu i przeliczania terminu mieszkają w
  // `lib/clubs/workspaceForms` - tutaj zostaje wyłącznie stan i układ.
  const draft = {
    titlePl,
    titleEn,
    descriptionPl: descPl,
    descriptionEn: descEn,
    kind,
    status,
    allDay,
    startsAt,
    endsAt,
    location,
    meetingUrl,
    rsvpEnabled,
    capacity,
  };
  const invalid = clubEventFormInvalid(draft);

  const submit = () => {
    if (invalid) return;
    onSubmit(buildClubEventUpsert(draft, editing ? initial.id : null, Date.now()));
  };

  // Presety terminu: kurator najczęściej ustawia "dziś/jutro 18:00" i domyka
  // koniec po godzinie - klikanie w natywny kalendarz przy każdym wydarzeniu
  // jest wolniejsze niż jeden guzik.
  const setStartPreset = (offsetDays: number) => {
    setStartsAt(clubEventStartPreset(new Date(), offsetDays, allDay));
  };

  const setDuration = (minutes: number) => {
    setEndsAt((current) => clubEventEndValue(current, startsAt, minutes, allDay));
  };

  const previewTitle = clubEventPreviewTitle(titlePl, titleEn);
  const previewSlug = previewTitle.length > 0 ? clubEventSlug(previewTitle) : "";
  const showsSlug = clubEventShowsSlug(editing, previewSlug);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
            {editing ? t("club.eventForm.editTitle") : t("club.eventForm.createTitle")}
          </DialogTitle>
          <DialogDescription>{t("club.eventForm.lead")}</DialogDescription>
        </DialogHeader>

        <form
          id="club-event-form"
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid min-w-0 gap-5">
            <Section
              icon={<Type className="h-4 w-4" aria-hidden />}
              title={t("club.eventForm.sectionBasics")}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  htmlFor="club-event-title-pl"
                  label={t("club.eventForm.titlePl")}
                  hint={t("club.eventForm.titleHint")}
                >
                  <Input
                    id="club-event-title-pl"
                    maxLength={200}
                    value={titlePl}
                    onChange={(event) => setTitlePl(event.target.value)}
                  />
                </Field>
                <Field htmlFor="club-event-title-en" label={t("club.eventForm.titleEn")}>
                  <Input
                    id="club-event-title-en"
                    maxLength={200}
                    value={titleEn}
                    onChange={(event) => setTitleEn(event.target.value)}
                  />
                </Field>
                <Field htmlFor="club-event-kind" label={t("club.eventForm.kind")}>
                  <Select value={kind} onValueChange={(value) => setKind(toEventKind(value))}>
                    <SelectTrigger id="club-event-kind">
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
                </Field>
                <Field htmlFor="club-event-status" label={t("club.eventForm.status")}>
                  <Select value={status} onValueChange={(value) => setStatus(toEventStatus(value))}>
                    <SelectTrigger id="club-event-status">
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
                </Field>
              </div>
            </Section>

            <Section
              icon={<Clock className="h-4 w-4" aria-hidden />}
              title={t("club.eventForm.sectionWhen")}
            >
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
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
                    setStartsAt((current) => clubAllDayFieldValue(current, value));
                    setEndsAt((current) => clubAllDayFieldValue(current, value));
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Chip onClick={() => setStartPreset(0)}>{t("club.eventForm.today")}</Chip>
                <Chip onClick={() => setStartPreset(1)}>{t("club.eventForm.tomorrow")}</Chip>
                <Chip onClick={() => setStartPreset(7)}>{t("club.eventForm.nextWeek")}</Chip>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field htmlFor="club-event-start" label={t("club.eventForm.startsAt")} required>
                  <Input
                    id="club-event-start"
                    type={allDay ? "date" : "datetime-local"}
                    required
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </Field>
                <Field htmlFor="club-event-end" label={t("club.eventForm.endsAt")}>
                  <Input
                    id="club-event-end"
                    type={allDay ? "date" : "datetime-local"}
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </Field>
              </div>

              {!allDay && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("club.eventForm.durationLabel")}
                  </span>
                  {[30, 60, 90, 120].map((minutes) => (
                    <Chip
                      key={minutes}
                      disabled={startsAt.length === 0}
                      onClick={() => setDuration(minutes)}
                    >
                      {t(clubEventDurationLabelKey(minutes))}
                    </Chip>
                  ))}
                </div>
              )}
            </Section>

            <Section
              icon={<MapPin className="h-4 w-4" aria-hidden />}
              title={t("club.eventForm.sectionWhere")}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  htmlFor="club-event-location"
                  label={t("club.eventForm.location")}
                  hint={t("club.eventForm.locationHint")}
                >
                  <Input
                    id="club-event-location"
                    maxLength={200}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </Field>
                <Field
                  htmlFor="club-event-url"
                  label={t("club.eventForm.meetingUrl")}
                  hint={t("club.eventForm.meetingUrlHint")}
                >
                  <Input
                    id="club-event-url"
                    type="url"
                    inputMode="url"
                    value={meetingUrl}
                    onChange={(event) => setMeetingUrl(event.target.value)}
                  />
                </Field>
                <Field htmlFor="club-event-desc-pl" label={t("club.eventForm.descriptionPl")}>
                  <Textarea
                    id="club-event-desc-pl"
                    rows={4}
                    value={descPl}
                    onChange={(event) => setDescPl(event.target.value)}
                  />
                </Field>
                <Field htmlFor="club-event-desc-en" label={t("club.eventForm.descriptionEn")}>
                  <Textarea
                    id="club-event-desc-en"
                    rows={4}
                    value={descEn}
                    onChange={(event) => setDescEn(event.target.value)}
                  />
                </Field>
              </div>
            </Section>

            <Section
              icon={<Users className="h-4 w-4" aria-hidden />}
              title={t("club.eventForm.sectionAccess")}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <Label htmlFor="club-event-rsvp" className="text-sm font-normal">
                    {t("club.eventForm.rsvpEnabled")}
                  </Label>
                  <Switch
                    id="club-event-rsvp"
                    checked={rsvpEnabled}
                    onCheckedChange={setRsvpEnabled}
                  />
                </div>
                <Field
                  htmlFor="club-event-capacity"
                  label={t("club.eventForm.capacity")}
                  hint={t("club.eventForm.capacityHint")}
                >
                  <Input
                    id="club-event-capacity"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                  />
                </Field>
              </div>
            </Section>
          </div>

          <aside className="lg:sticky lg:top-2 lg:self-start">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("club.eventForm.summary")}
              </p>
              {previewTitle.length === 0 || startsAt.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("club.eventForm.summaryEmpty")}
                </p>
              ) : (
                <div className="mt-3 space-y-3 text-sm">
                  <p className="font-semibold leading-snug">{previewTitle}</p>
                  <SummaryRow icon={<Clock className="h-3.5 w-3.5" aria-hidden />}>
                    {clubEventRangeLabel(startsAt, endsAt, allDay)}
                  </SummaryRow>
                  {location.trim().length > 0 && (
                    <SummaryRow icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}>
                      {location.trim()}
                    </SummaryRow>
                  )}
                  {meetingUrl.trim().length > 0 && (
                    <SummaryRow icon={<LinkIcon className="h-3.5 w-3.5" aria-hidden />}>
                      <span className="break-all">{meetingUrl.trim()}</span>
                    </SummaryRow>
                  )}
                  <SummaryRow icon={<Users className="h-3.5 w-3.5" aria-hidden />}>
                    {rsvpEnabled
                      ? `${t("club.eventForm.rsvpEnabled")}${capacity.trim().length > 0 ? ` - ${capacity.trim()}` : ""}`
                      : "-"}
                  </SummaryRow>
                  {showsSlug && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {t("club.eventForm.slugLabel")}:{" "}
                      <code className="rounded bg-muted px-1 py-0.5">{previewSlug}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </form>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("club.eventForm.cancel")}
          </Button>
          <Button type="submit" form="club-event-form" disabled={invalid || pending}>
            {editing ? t("club.eventForm.save") : t("club.eventForm.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-border/50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  required,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        {label}
        {required === true && <span className="text-destructive">*</span>}
      </Label>
      <div className="mt-1">{children}</div>
      {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Chip({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled === true}
      onClick={onClick}
      className="rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SummaryRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-muted-foreground">
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
