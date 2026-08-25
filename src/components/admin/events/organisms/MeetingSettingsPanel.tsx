// Organizm: siatka slotów i reguła giełdy spotkań 1-1.
//
// SIATKA JEST WIDOCZNA PRZED ZAPISEM. „Giełda daje 19 slotów (19 na dzień)"
// liczy się z tych samych czterech liczb, z których policzy ją Postgres - więc
// organizator widzi skutek zmiany długości spotkania NATYCHMIAST, zamiast
// zapisywać i sprawdzać metodą prób na ekranie uczestnika.
//
// BŁĘDY SĄ LISTĄ, NIE PIERWSZYM Z BRZEGU. Formularz ma dwadzieścia pól; blokada
// zapisu z jednym komunikatem naraz kazałaby klikać „Zapisz" cztery razy.
// Reguły mieszkają w `meetingsSettingsDraft` i są testowane osobno - tutaj
// zostaje wyłącznie ich pokazanie.
//
// GRUPY POKAZUJEMY TYLKO PRZY REGULE `groups`. Przy każdej innej regule baza
// i tak ignoruje przydział, a widoczne pola sugerowałyby, że coś robią.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";
import { uiLang } from "@/lib/i18n/format";
import { MEETING_VISIBILITIES, type MeetingRuleGroup } from "@/lib/events/meetingsApi";
import {
  draftFromSettings,
  settingsInputFromDraft,
  slotsPerDay,
  validateSettingsDraft,
  type MeetingSettingsDraft,
} from "@/lib/events/meetingsSettingsDraft";
import { useMeetingSettings, useSaveMeetingSettings } from "@/lib/events/useMeetings";

/** Klucz szkicu -> zdanie w słowniku. Jedno miejsce, żeby nie sklejać napisów. */
const ERROR_LABEL: Record<string, string> = {
  timezoneRequired: "adminEventMeetings.errors.invalidTimezone",
  slotMinutesRange: "adminEventMeetings.errors.slotRange",
  breakMinutesRange: "adminEventMeetings.errors.breakRange",
  dayOrder: "adminEventMeetings.errors.dayOrder",
  dayTooShort: "adminEventMeetings.errors.dayFitsSlot",
  meetingDaysRequired: "adminEventMeetings.errors.enabledNeedsDays",
  windowOrder: "adminEventMeetings.errors.invitesWindow",
  expiryRange: "adminEventMeetings.errors.expiryRange",
  limitRange: "adminEventMeetings.errors.limitRange",
  groupsRequired: "adminEventMeetings.errors.ruleGroupsRequired",
};

function groupName(group: MeetingRuleGroup, lang: "pl" | "en"): string {
  return lang === "en" ? group.name_en || group.name_pl : group.name_pl || group.name_en;
}

export function MeetingSettingsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const settingsQ = useMeetingSettings(eventId);
  const save = useSaveMeetingSettings(eventId);

  const [draft, setDraft] = useState<MeetingSettingsDraft | null>(null);
  const [newDay, setNewDay] = useState("");

  // Szkic powstaje z odpowiedzi RPC dokładnie raz na wydarzenie: przeładowanie
  // go przy każdym odświeżeniu cache skasowałoby wpisane, jeszcze niezapisane
  // wartości w środku edycji.
  useEffect(() => {
    if (settingsQ.data === undefined) return;
    setDraft(draftFromSettings(settingsQ.data));
  }, [settingsQ.data, eventId]);

  const errors = useMemo(
    () => (draft === null ? [] : validateSettingsDraft(draft)),
    [draft],
  );
  const perDay = draft === null ? 0 : slotsPerDay(draft);

  if (settingsQ.isLoading || draft === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("adminEventMeetings.settings.loading")}
      </div>
    );
  }

  if (settingsQ.error !== null) {
    return (
      <p className="text-sm text-destructive">{t(adminMeetingFailure(settingsQ.error).key)}</p>
    );
  }

  const settings = settingsQ.data;
  const patch = (next: Partial<MeetingSettingsDraft>) =>
    setDraft((prev) => (prev === null ? prev : { ...prev, ...next }));

  const addDay = () => {
    const day = newDay.trim();
    if (day.length === 0 || draft.meetingDays.includes(day)) return;
    patch({ meetingDays: [...draft.meetingDays, day].sort() });
    setNewDay("");
  };

  const toggleGroup = (side: "requesterGroupIds" | "inviteeGroupIds", id: string) => {
    const current = draft[side];
    patch({
      [side]: current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    } as Partial<MeetingSettingsDraft>);
  };

  const submit = () => {
    if (errors.length > 0) return;
    save.mutate(settingsInputFromDraft(eventId, draft), {
      onSuccess: () => toast.success(t("adminEventMeetings.toasts.settingsSaved")),
      onError: (error) => {
        const failure = adminMeetingFailure(error);
        toast.error(t(failure.key, failure.params));
      },
    });
  };

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-lg">{t("adminEventMeetings.settings.title")}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
          {t("adminEventMeetings.settings.subtitle")}
        </p>
      </header>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
        <div>
          <Label htmlFor="meetings-enabled" className="text-sm">
            {t("adminEventMeetings.settings.enabledLabel")}
          </Label>
          <p className="mt-1 max-w-xl text-xs leading-snug text-muted-foreground">
            {t("adminEventMeetings.settings.enabledHint")}
          </p>
        </div>
        <Switch
          id="meetings-enabled"
          checked={draft.isEnabled}
          onCheckedChange={(next) => patch({ isEnabled: next })}
        />
      </div>

      <AdminFormSection
        title={t("adminEventMeetings.settings.gridSection")}
        hint={t("adminEventMeetings.settings.dayHint")}
        columns={2}
      >
        <div className="space-y-1.5">
          <Label htmlFor="slot-minutes">
            {t("adminEventMeetings.settings.slotMinutesLabel")}
          </Label>
          <Input
            id="slot-minutes"
            inputMode="numeric"
            value={draft.slotMinutes}
            onChange={(event) => patch({ slotMinutes: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.slotMinutesHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="break-minutes">
            {t("adminEventMeetings.settings.breakMinutesLabel")}
          </Label>
          <Input
            id="break-minutes"
            inputMode="numeric"
            value={draft.breakMinutes}
            onChange={(event) => patch({ breakMinutes: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.breakMinutesHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="day-start">{t("adminEventMeetings.settings.dayStartLabel")}</Label>
          <Input
            id="day-start"
            type="time"
            value={draft.dayStartTime}
            onChange={(event) => patch({ dayStartTime: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="day-end">{t("adminEventMeetings.settings.dayEndLabel")}</Label>
          <Input
            id="day-end"
            type="time"
            value={draft.dayEndTime}
            onChange={(event) => patch({ dayEndTime: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-timezone">
            {t("adminEventMeetings.settings.timezoneLabel")}
          </Label>
          <Input
            id="meeting-timezone"
            value={draft.timezone}
            onChange={(event) => patch({ timezone: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.timezoneHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiry-hours">
            {t("adminEventMeetings.settings.expiryHoursLabel")}
          </Label>
          <Input
            id="expiry-hours"
            inputMode="numeric"
            value={draft.inviteExpiresAfterHours}
            onChange={(event) => patch({ inviteExpiresAfterHours: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.expiryHoursHint")}
          </p>
        </div>
      </AdminFormSection>

      <AdminFormSection
        title={t("adminEventMeetings.settings.daysLabel")}
        hint={t("adminEventMeetings.settings.daysHint")}
      >
        <div className="flex flex-wrap items-center gap-2">
          {draft.meetingDays.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t("adminEventMeetings.settings.daysEmpty")}
            </span>
          ) : (
            draft.meetingDays.map((day) => (
              <Badge key={day} variant="secondary" className="gap-1 text-[11px]">
                {day}
                <button
                  type="button"
                  aria-label={`${t("adminEventMeetings.tables.deleteAction")} ${day}`}
                  onClick={() =>
                    patch({ meetingDays: draft.meetingDays.filter((value) => value !== day) })
                  }
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={newDay}
            className="max-w-[12rem]"
            onChange={(event) => setNewDay(event.target.value)}
            aria-label={t("adminEventMeetings.settings.daysLabel")}
          />
          <Button type="button" size="sm" variant="outline" onClick={addDay}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminEventMeetings.settings.daysLabel")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("adminEventMeetings.settings.gridPreview", {
            slots: perDay * draft.meetingDays.length,
            perDay,
          })}
        </p>
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.settings.windowSection")} columns={2}>
        <div className="space-y-1.5">
          <Label htmlFor="invites-open">{t("adminEventMeetings.settings.opensAtLabel")}</Label>
          <Input
            id="invites-open"
            type="datetime-local"
            value={draft.invitesOpenAt}
            onChange={(event) => patch({ invitesOpenAt: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.opensAtHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invites-close">{t("adminEventMeetings.settings.closesAtLabel")}</Label>
          <Input
            id="invites-close"
            type="datetime-local"
            value={draft.invitesCloseAt}
            onChange={(event) => patch({ invitesCloseAt: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.closesAtHint")}
          </p>
        </div>
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.settings.limitsSection")} columns={2}>
        <div className="space-y-1.5">
          <Label htmlFor="max-invites">{t("adminEventMeetings.settings.maxInvitesLabel")}</Label>
          <Input
            id="max-invites"
            inputMode="numeric"
            placeholder={t("adminEventMeetings.settings.unlimited")}
            value={draft.maxInvitesPerPerson}
            onChange={(event) => patch({ maxInvitesPerPerson: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.maxInvitesHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max-daily">{t("adminEventMeetings.settings.maxDailyLabel")}</Label>
          <Input
            id="max-daily"
            inputMode="numeric"
            placeholder={t("adminEventMeetings.settings.unlimited")}
            value={draft.maxMeetingsPerDay}
            onChange={(event) => patch({ maxMeetingsPerDay: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.maxDailyHint")}
          </p>
        </div>
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.settings.ruleSection")}>
        <div className="space-y-1.5">
          <Label htmlFor="meeting-visibility">
            {t("adminEventMeetings.settings.visibilityLabel")}
          </Label>
          <Select
            value={draft.visibility}
            onValueChange={(value) =>
              patch({ visibility: value as MeetingSettingsDraft["visibility"] })
            }
          >
            <SelectTrigger id="meeting-visibility" className="max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEETING_VISIBILITIES.map((rule) => (
                <SelectItem key={rule} value={rule}>
                  {t(`eventMeetings.visibility.${rule}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(`eventMeetings.visibilityHints.${draft.visibility}`)}
          </p>
        </div>

        {draft.visibility !== "groups" ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["requesterGroupIds", "requesterGroupsLabel"],
                ["inviteeGroupIds", "inviteeGroupsLabel"],
              ] as const
            ).map(([side, labelKey]) => (
              <div key={side} className="space-y-2 rounded-lg border border-border/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`adminEventMeetings.settings.${labelKey}`)}
                </p>
                {settings.available_groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("adminEventMeetings.settings.groupsHint")}
                  </p>
                ) : (
                  settings.available_groups.map((group) => (
                    <label
                      key={`${side}-${group.group_id}`}
                      className="flex items-start gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={draft[side].includes(group.group_id)}
                        onChange={() => toggleGroup(side, group.group_id)}
                      />
                      <span>
                        {groupName(group, lang)}
                        {group.can_meet ? null : (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            {t("adminEventMeetings.settings.groupCannotMeetBadge")}
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.settings.introSection")} columns={2}>
        <div className="space-y-1.5">
          <Label htmlFor="intro-pl">{t("adminEventMeetings.settings.introPlLabel")}</Label>
          <Textarea
            id="intro-pl"
            rows={3}
            value={draft.introPl}
            onChange={(event) => patch({ introPl: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="intro-en">{t("adminEventMeetings.settings.introEnLabel")}</Label>
          <Textarea
            id="intro-en"
            rows={3}
            value={draft.introEn}
            onChange={(event) => patch({ introEn: event.target.value })}
          />
        </div>
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.settings.readinessSection")}>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>
            {t("adminEventMeetings.settings.readinessTables", { count: settings.tables_count })}
          </li>
          <li>
            {t("adminEventMeetings.settings.readinessSeats", { count: settings.seats_count })}
          </li>
          <li>
            {t("adminEventMeetings.settings.readinessParticipants", {
              count: settings.participants_count,
            })}
          </li>
          <li>
            {t("adminEventMeetings.settings.readinessAvailability", {
              count: settings.with_availability_count,
            })}
          </li>
        </ul>
        {settings.with_availability_count > 0 ? null : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("adminEventMeetings.settings.readinessNoAvailability")}
          </p>
        )}
        {settings.tables_count > 0 ? null : (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t("adminEventMeetings.settings.readinessNoTables")}
          </p>
        )}
      </AdminFormSection>

      {errors.length === 0 ? null : (
        <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errors.map((key) => (
            <li key={key}>{t(ERROR_LABEL[key] ?? "adminEventMeetings.errors.unknown")}</li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={errors.length > 0 || save.isPending}>
          {t("adminEventMeetings.settings.saveAction")}
        </Button>
      </div>
    </section>
  );
}
