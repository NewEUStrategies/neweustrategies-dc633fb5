// Molekuła: formularz pozycji harmonogramu.
//
// PRZEŁĄCZNIK „CAŁY DZIEŃ" ZMIENIA TYP POLA, nie tylko flagę. Deadline
// konsultacji nie ma godziny, a spotkanie ma - i jeśli formularz każe wpisać
// godzinę do jednego i drugiego, to termin całodniowy dostaje przypadkową
// północ i wygląda jak spotkanie o 00:00.
//
// Wartości pól `datetime-local` i `date` są CZASEM LOKALNYM bez strefy. Do
// bazy jedzie ISO ze strefą, bo `timestamptz` bez strefy interpretuje wejście
// wg strefy serwera - a to jest źródło całodobowych przesunięć terminów.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClubMilestoneInput } from "@/lib/clubs/workspaceApi";
import {
  CLUB_MILESTONE_KINDS,
  CLUB_MILESTONE_STATUSES,
  toClubMilestoneKind,
  toClubMilestoneStatus,
  type ClubMilestoneKind,
  type ClubMilestoneStatus,
  type ClubThreadMilestoneRow,
} from "@/lib/clubs/workspaceTypes";

/** ISO -> wartość pola `datetime-local` (czas LOKALNY, bez strefy i sekund). */
export function toLocalInputValue(iso: string | null, allDay: boolean): string {
  if (iso === null || iso.length === 0) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return allDay ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Wartość pola -> ISO ze strefą. Termin całodniowy kotwiczymy na POŁUDNIU
 * czasu lokalnego, nie na północy: północ przy przeliczeniu na UTC wypada
 * poprzedniego dnia dla całej Europy Środkowej, więc "14 września" pokazywałby
 * się jako 13 września w kalendarzu liczonym w UTC.
 */
export function toIsoValue(input: string, allDay: boolean): string | null {
  if (input.length === 0) return null;
  const date = allDay ? new Date(`${input}T12:00:00`) : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ClubMilestoneForm({
  threadId,
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  threadId: string;
  initial: ClubThreadMilestoneRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: ClubMilestoneInput) => void;
}) {
  const { t } = useTranslation();
  const [allDay, setAllDay] = useState(initial?.all_day ?? false);
  const [kind, setKind] = useState<ClubMilestoneKind>(toClubMilestoneKind(initial?.kind));
  const [status, setStatus] = useState<ClubMilestoneStatus>(toClubMilestoneStatus(initial?.status));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startsAt, setStartsAt] = useState(
    toLocalInputValue(initial?.starts_at ?? null, initial?.all_day ?? false),
  );
  const [endsAt, setEndsAt] = useState(
    toLocalInputValue(initial?.ends_at ?? null, initial?.all_day ?? false),
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");

  const startIso = toIsoValue(startsAt, allDay);
  const endIso = toIsoValue(endsAt, allDay);
  // Koniec przed początkiem odrzuca CHECK bazy - blokujemy wcześniej, żeby nie
  // wracać do użytkownika z surowym błędem 23514 po utracie formularza.
  const rangeInvalid = startIso !== null && endIso !== null && endIso < startIso;
  const invalid = title.trim().length < 3 || startIso === null || rangeInvalid;

  /** Zmiana trybu przepisuje wartości pól - inaczej „2026-09-14T17:00" zostaje
   *  w polu typu `date` i przeglądarka po cichu je czyści. */
  const switchAllDay = (next: boolean) => {
    setAllDay(next);
    setStartsAt((value) =>
      value.length === 0 ? value : toLocalInputValue(toIsoValue(value, allDay), next),
    );
    setEndsAt((value) =>
      value.length === 0 ? value : toLocalInputValue(toIsoValue(value, allDay), next),
    );
  };

  return (
    <form
      className="rounded-xl border border-border/60 bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || startIso === null) return;
        onSubmit({
          ...(initial !== null ? { id: initial.id } : {}),
          thread_id: threadId,
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          kind,
          status,
          starts_at: startIso,
          ends_at: endIso,
          all_day: allDay,
          location: location.trim().length > 0 ? location.trim() : null,
          url: url.trim().length > 0 ? url.trim() : null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="club-ms-title">{t("club.workspace.schedule.titleLabel")}</Label>
          <Input
            id="club-ms-title"
            className="mt-1"
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="club-ms-kind">{t("club.workspace.schedule.kindLabel")}</Label>
          <Select value={kind} onValueChange={(value) => setKind(toClubMilestoneKind(value))}>
            <SelectTrigger id="club-ms-kind" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_MILESTONE_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`club.workspace.milestoneKind.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="club-ms-status">{t("club.workspace.schedule.statusLabel")}</Label>
          <Select value={status} onValueChange={(value) => setStatus(toClubMilestoneStatus(value))}>
            <SelectTrigger id="club-ms-status" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_MILESTONE_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`club.workspace.milestoneStatus.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Switch id="club-ms-allday" checked={allDay} onCheckedChange={switchAllDay} />
          <Label htmlFor="club-ms-allday" className="text-sm font-normal">
            {t("club.workspace.schedule.allDay")}
          </Label>
        </div>

        <div>
          <Label htmlFor="club-ms-start">{t("club.workspace.schedule.startsLabel")}</Label>
          <Input
            id="club-ms-start"
            type={allDay ? "date" : "datetime-local"}
            className="mt-1"
            value={startsAt}
            required
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="club-ms-end">{t("club.workspace.schedule.endsLabel")}</Label>
          <Input
            id="club-ms-end"
            type={allDay ? "date" : "datetime-local"}
            className="mt-1"
            value={endsAt}
            aria-invalid={rangeInvalid}
            aria-describedby={rangeInvalid ? "club-ms-end-error" : undefined}
            onChange={(event) => setEndsAt(event.target.value)}
          />
          {rangeInvalid ? (
            <p id="club-ms-end-error" className="mt-1 text-[11px] text-destructive">
              {t("club.workspace.schedule.rangeError")}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="club-ms-location">{t("club.workspace.schedule.locationLabel")}</Label>
          <Input
            id="club-ms-location"
            className="mt-1"
            value={location}
            maxLength={240}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="club-ms-url">{t("club.workspace.schedule.urlLabel")}</Label>
          <Input
            id="club-ms-url"
            type="url"
            inputMode="url"
            className="mt-1"
            value={url}
            maxLength={2000}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="club-ms-desc">{t("club.workspace.schedule.descriptionLabel")}</Label>
          <Textarea
            id="club-ms-desc"
            className="mt-1"
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid}>
          {initial !== null ? t("club.workspace.save") : t("club.workspace.schedule.add")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("club.workspace.cancel")}
        </Button>
      </div>
    </form>
  );
}
