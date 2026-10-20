// Ustawienia silnika ścieżek (S8, SPEC §6.3 „Ustawienia ścieżek”) - jedno
// miejsce dla każdego przełącznika `journey_settings`: włączenie, limit maili
// marketingowych 1-20 na 7 dni, cisza nocna, strefa, domyślna osoba zadań,
// próg otwarć maszynowych, nazwa nadawcy, Reply-To i piksel otwarć.
//
// KTO EDYTUJE. Zapis (`admin_journey_settings_save`) jest tylko dla admina;
// redaktor dostaje ten sam formularz w podglądzie (pola wyłączone, zdanie
// „zmienia wyłącznie administrator”) - widzi limity, które dotyczą jego
// ścieżek, zamiast przycisku kończącego się odmową.
//
// ODRZUCENIE, NIE PRZYCIĘCIE (AGENTS). Liczniki znaków pokazują limit bazy
// (`JOURNEY_SENDER_LIMITS`), a wartość za długa albo z niedozwolonym znakiem
// blokuje zapis z komunikatem - nic nie jest po cichu ucinane, więc to, co
// admin widzi, jest dokładnie tym, co trafi do pola „Od”.
//
// WSPÓŁBIEŻNOŚĆ (CAS). Zapis niesie `expectedUpdatedAt` z odczytu (`null`,
// gdy wiersza jeszcze nie ma - `exists: false`). Konflikt = ktoś zapisał
// w innej karcie: mówimy to wprost i wczytujemy świeże wartości (formularz
// montuje się od nowa po zmianie tokenu), zamiast nadpisywać cudzą zmianę.
//
// WŁĄCZENIE SILNIKA wymaga potwierdzenia z podsumowaniem (limit, cisza nocna,
// strefa, nadawca) - to moment, od którego aktywne ścieżki zaczynają pisać do
// ludzi. Brak `aal2` (middleware: `mfa_required`) -> `MfaRequiredNotice`.
import { useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
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
import { PlatformSelect } from "@/components/ui/platform-select";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import { mutationErrorText, useSaveJourneySettings } from "@/lib/admin/journeys/journeyMutations";
import { crmStaffUsersQueryOptions } from "@/lib/crm/leadMutations";
import { timeZoneOptions } from "@/lib/events/timeZoneOptions";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import { JOURNEY_SENDER_LIMITS, type JourneySettingsDto } from "@/lib/journeys/dto";
import type { JourneySettingsPatch } from "@/lib/journeys/journeys.functions";
import { journeyKeys } from "@/lib/journeys/keys";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import { journeySettingsQueryOptions } from "@/lib/journeys/queries";

export interface JourneySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  /** Admin - formularz; redaktor - podgląd tylko do odczytu. */
  canManage: boolean;
}

export function JourneySettingsDialog({
  open,
  onOpenChange,
  tenantId,
  canManage,
}: JourneySettingsDialogProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="journeys-engine-settings"
        data-testid="journey-settings-dialog"
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]"
      >
        <DialogHeader>
          <DialogTitle>{t("adminJourneys.engineSettings.title")}</DialogTitle>
          <DialogDescription>{t("adminJourneys.engineSettings.description")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <SettingsBody tenantId={tenantId} canManage={canManage} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody({
  tenantId,
  canManage,
  onClose,
}: {
  tenantId: string | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery(journeySettingsQueryOptions(tenantId));

  if (query.isLoading) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t("adminJourneys.engineSettings.loading")}
      </p>
    );
  }
  if (query.isError) {
    if (isMfaRequiredError(query.error)) return <MfaRequiredNotice />;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="text-destructive">{t("adminJourneys.engineSettings.loadError")}</p>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => void query.refetch()}>
          {t("adminJourneys.common.retry")}
        </Button>
      </div>
    );
  }
  if (query.data?.state === "forbidden") return <RoleGateNotice requiredRole="admin_or_editor" />;
  if (query.data?.state === "unavailable") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("adminJourneys.engineStrip.unavailable")}
      </p>
    );
  }
  if (query.data?.state !== "ready") return null;
  const settings = query.data.data;
  // Nowy token (zapis tutaj albo w innej karcie) = świeży formularz.
  return (
    <SettingsForm
      key={settings.updatedAt ?? "defaults"}
      initial={settings}
      tenantId={tenantId}
      canManage={canManage}
      onClose={onClose}
    />
  );
}

interface FormState {
  enabled: boolean;
  cap: number;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  assignee: string;
  machineSeconds: string;
  senderName: string;
  replyTo: string;
  openTracking: boolean;
}

type FieldError =
  | "quietStart"
  | "quietEnd"
  | "machineSeconds"
  | "senderName"
  | "replyTo";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Ten sam kształt co `z.string().email()` po stronie serwera - prosty, bez
// spacji; serwer i tak waliduje drugi raz.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENDER_FORBIDDEN = /[<>"\r\n]/;

function fromDto(dto: JourneySettingsDto): FormState {
  return {
    enabled: dto.enabled,
    cap: dto.marketingCapPer7d,
    // Baza oddaje `time` jako „21:00” albo „21:00:00” - pole ma minuty.
    quietStart: dto.quietStart.slice(0, 5),
    quietEnd: dto.quietEnd.slice(0, 5),
    timezone: dto.timezone,
    assignee: dto.defaultTaskAssigneeId ?? "",
    machineSeconds: String(dto.machineOpenSeconds),
    senderName: dto.senderName ?? "",
    replyTo: dto.replyTo ?? "",
    openTracking: dto.openTrackingEnabled,
  };
}

function validate(form: FormState): Partial<Record<FieldError, string>> {
  const errors: Partial<Record<FieldError, string>> = {};
  if (!TIME_RE.test(form.quietStart)) errors.quietStart = "adminJourneys.engineSettings.quietInvalid";
  if (!TIME_RE.test(form.quietEnd)) errors.quietEnd = "adminJourneys.engineSettings.quietInvalid";
  const seconds = Number(form.machineSeconds);
  if (
    form.machineSeconds.trim() === "" ||
    !Number.isInteger(seconds) ||
    seconds < JOURNEY_LIMITS.machineOpenSecondsMin ||
    seconds > JOURNEY_LIMITS.machineOpenSecondsMax
  ) {
    errors.machineSeconds = "adminJourneys.engineSettings.machineOpenInvalid";
  }
  const sender = form.senderName.trim();
  if (sender.length > JOURNEY_SENDER_LIMITS.senderNameMax || SENDER_FORBIDDEN.test(form.senderName)) {
    errors.senderName = "adminJourneys.engineSettings.senderNameInvalid";
  }
  const replyTo = form.replyTo.trim();
  if (replyTo !== "" && (replyTo.length > JOURNEY_SENDER_LIMITS.replyToMax || !EMAIL_RE.test(replyTo))) {
    errors.replyTo = "adminJourneys.engineSettings.replyToInvalid";
  }
  return errors;
}

/** Łatka wyłącznie ze zmienionych pól (biała lista kluczy SQL, snake_case). */
function buildPatch(initial: FormState, form: FormState): JourneySettingsPatch {
  const patch: JourneySettingsPatch = {};
  if (form.enabled !== initial.enabled) patch.enabled = form.enabled;
  if (form.cap !== initial.cap) patch.marketing_cap_per_7d = form.cap;
  if (form.quietStart !== initial.quietStart) patch.quiet_start = form.quietStart;
  if (form.quietEnd !== initial.quietEnd) patch.quiet_end = form.quietEnd;
  if (form.timezone !== initial.timezone) patch.timezone = form.timezone;
  if (form.assignee !== initial.assignee) patch.default_task_assignee_id = form.assignee || null;
  if (form.machineSeconds.trim() !== initial.machineSeconds) {
    patch.machine_open_seconds = Number(form.machineSeconds);
  }
  if (form.senderName.trim() !== initial.senderName.trim()) {
    patch.sender_name = form.senderName.trim() || null;
  }
  if (form.replyTo.trim() !== initial.replyTo.trim()) patch.reply_to = form.replyTo.trim() || null;
  if (form.openTracking !== initial.openTracking) patch.open_tracking_enabled = form.openTracking;
  return patch;
}

function SettingsForm({
  initial,
  tenantId,
  canManage,
  onClose,
}: {
  initial: JourneySettingsDto;
  tenantId: string | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const start = fromDto(initial);
  const [form, setForm] = useState<FormState>(start);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const staff = useQuery({ ...crmStaffUsersQueryOptions(), enabled: canManage });
  const save = useSaveJourneySettings(tenantId);

  const errors = validate(form);
  const patch = buildPatch(start, form);
  const dirty = Object.keys(patch).length > 0;
  const valid = Object.keys(errors).length === 0;
  const readOnly = !canManage;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const persist = async () => {
    setNotice(null);
    try {
      const result = await save.mutateAsync({
        patch,
        expectedUpdatedAt: initial.exists ? initial.updatedAt : null,
      });
      if (result.ok) {
        toast.success(t("adminJourneys.engineSettings.saved"));
        onClose();
        return;
      }
      if (result.error === "conflict") {
        setNotice(t("adminJourneys.engineSettings.conflict"));
        if (tenantId) await queryClient.invalidateQueries({ queryKey: journeyKeys.settings(tenantId) });
        return;
      }
      setNotice(mutationErrorText(t, result));
    } catch (error) {
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else setNotice(t("adminJourneys.engineSettings.error"));
    }
  };

  const submit = () => {
    if (!dirty || !valid || readOnly) return;
    if (patch.enabled === true) {
      setConfirm({
        title: t("adminJourneys.engineSettings.confirmEnableTitle"),
        description: t("adminJourneys.engineSettings.confirmEnableBody", {
          cap: t("adminJourneys.engineSettings.marketingCapUnit", { count: form.cap }),
          start: form.quietStart,
          end: form.quietEnd,
          zone: form.timezone,
          sender: form.senderName.trim() || t("adminJourneys.engineSettings.senderFallback"),
        }),
        confirmLabel: t("adminJourneys.engineSettings.confirmEnable"),
        cancelLabel: t("adminJourneys.common.cancel"),
        onConfirm: persist,
      });
      return;
    }
    void persist();
  };

  if (mfaRequired) return <MfaRequiredNotice />;

  const staffOptions = staff.data ?? [];
  const assigneeKnown = form.assignee === "" || staffOptions.some((user) => user.id === form.assignee);
  const senderLength = form.senderName.trim().length;
  const replyLength = form.replyTo.trim().length;
  const describedBy = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ") || undefined;

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {readOnly ? (
        <p role="note" className="rounded-[6px] border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          {t("adminJourneys.engineSettings.readOnly")}
        </p>
      ) : null}
      {!initial.exists ? (
        <p className="text-xs text-muted-foreground">{t("adminJourneys.engineSettings.notStored")}</p>
      ) : null}

      <Section legend={t("adminJourneys.engineSettings.sectionEngine")}>
        <SwitchRow
          id={`${id}-enabled`}
          label={t("adminJourneys.settings.enabled")}
          hint={t("adminJourneys.settings.enabledHint")}
          checked={form.enabled}
          disabled={readOnly}
          onChange={(value) => set("enabled", value)}
        />
      </Section>

      <Section legend={t("adminJourneys.engineSettings.sectionLimits")}>
        <Field id={`${id}-cap`} label={t("adminJourneys.settings.marketingCap")} hint={t("adminJourneys.settings.marketingCapHint")}>
          <PlatformSelect
            id={`${id}-cap`}
            value={String(form.cap)}
            disabled={readOnly}
            aria-describedby={`${id}-cap-hint`}
            onChange={(event) => set("cap", Number(event.target.value))}
          >
            {Array.from(
              { length: JOURNEY_LIMITS.capPer7dMax - JOURNEY_LIMITS.capPer7dMin + 1 },
              (_, i) => JOURNEY_LIMITS.capPer7dMin + i,
            ).map((value) => (
              <option key={value} value={String(value)}>
                {t("adminJourneys.engineSettings.marketingCapUnit", { count: value })}
              </option>
            ))}
          </PlatformSelect>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-quiet-start`} label={t("adminJourneys.settings.quietStart")} error={errors.quietStart && t(errors.quietStart)}>
            <TimeInput
              id={`${id}-quiet-start`}
              value={form.quietStart}
              required
              disabled={readOnly}
              aria-invalid={errors.quietStart ? true : undefined}
              aria-describedby={describedBy(`${id}-quiet-hint`, !!errors.quietStart && `${id}-quiet-start-error`)}
              onChange={(event) => set("quietStart", event.target.value)}
            />
          </Field>
          <Field id={`${id}-quiet-end`} label={t("adminJourneys.settings.quietEnd")} error={errors.quietEnd && t(errors.quietEnd)}>
            <TimeInput
              id={`${id}-quiet-end`}
              value={form.quietEnd}
              required
              disabled={readOnly}
              aria-invalid={errors.quietEnd ? true : undefined}
              aria-describedby={describedBy(`${id}-quiet-hint`, !!errors.quietEnd && `${id}-quiet-end-error`)}
              onChange={(event) => set("quietEnd", event.target.value)}
            />
          </Field>
        </div>
        <p id={`${id}-quiet-hint`} className="text-xs text-muted-foreground">
          {t("adminJourneys.settings.quietHint")}
        </p>
        <Field id={`${id}-timezone`} label={t("adminJourneys.settings.timezone")}>
          <PlatformSelect
            id={`${id}-timezone`}
            value={form.timezone}
            disabled={readOnly}
            onChange={(event) => set("timezone", event.target.value)}
          >
            {timeZoneOptions(form.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </PlatformSelect>
        </Field>
        <Field id={`${id}-assignee`} label={t("adminJourneys.settings.defaultTaskAssignee")}>
          <PlatformSelect
            id={`${id}-assignee`}
            value={form.assignee}
            disabled={readOnly}
            onChange={(event) => set("assignee", event.target.value)}
          >
            <option value="">{t("adminJourneys.engineSettings.assigneeNone")}</option>
            {!assigneeKnown ? (
              <option value={form.assignee}>{t("adminJourneys.engineSettings.assigneeUnknown")}</option>
            ) : null}
            {staffOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </PlatformSelect>
        </Field>
      </Section>

      <Section legend={t("adminJourneys.engineSettings.sectionSender")}>
        <Field
          id={`${id}-sender`}
          label={t("adminJourneys.settings.senderName")}
          hint={t("adminJourneys.settings.senderNameHint")}
          counter={t("adminJourneys.common.counter", {
            count: senderLength,
            max: JOURNEY_SENDER_LIMITS.senderNameMax,
          })}
          error={errors.senderName && t(errors.senderName)}
        >
          <Input
            id={`${id}-sender`}
            value={form.senderName}
            disabled={readOnly}
            placeholder={t("adminJourneys.engineSettings.senderNamePlaceholder")}
            aria-invalid={errors.senderName ? true : undefined}
            aria-describedby={describedBy(
              `${id}-sender-hint`,
              `${id}-sender-counter`,
              !!errors.senderName && `${id}-sender-error`,
            )}
            onChange={(event) => set("senderName", event.target.value)}
          />
        </Field>
        {form.senderName.trim() === "" ? (
          <p className="text-xs text-muted-foreground">{t("adminJourneys.engineSettings.senderNameMissing")}</p>
        ) : null}
        <Field
          id={`${id}-reply`}
          label={t("adminJourneys.settings.replyTo")}
          hint={t("adminJourneys.engineSettings.replyToHint")}
          counter={t("adminJourneys.common.counter", {
            count: replyLength,
            max: JOURNEY_SENDER_LIMITS.replyToMax,
          })}
          error={errors.replyTo && t(errors.replyTo)}
        >
          <Input
            id={`${id}-reply`}
            type="email"
            value={form.replyTo}
            disabled={readOnly}
            aria-invalid={errors.replyTo ? true : undefined}
            aria-describedby={describedBy(
              `${id}-reply-hint`,
              `${id}-reply-counter`,
              !!errors.replyTo && `${id}-reply-error`,
            )}
            onChange={(event) => set("replyTo", event.target.value)}
          />
        </Field>
      </Section>

      <Section legend={t("adminJourneys.engineSettings.sectionTracking")}>
        <Field
          id={`${id}-machine`}
          label={t("adminJourneys.settings.machineOpenSeconds")}
          hint={t("adminJourneys.engineSettings.machineOpenHint")}
          error={errors.machineSeconds && t(errors.machineSeconds)}
        >
          <Input
            id={`${id}-machine`}
            type="number"
            inputMode="numeric"
            min={JOURNEY_LIMITS.machineOpenSecondsMin}
            max={JOURNEY_LIMITS.machineOpenSecondsMax}
            step={1}
            value={form.machineSeconds}
            disabled={readOnly}
            className="max-w-32"
            aria-invalid={errors.machineSeconds ? true : undefined}
            aria-describedby={describedBy(`${id}-machine-hint`, !!errors.machineSeconds && `${id}-machine-error`)}
            onChange={(event) => set("machineSeconds", event.target.value)}
          />
        </Field>
        <SwitchRow
          id={`${id}-pixel`}
          label={t("adminJourneys.engineSettings.openTracking")}
          hint={t("adminJourneys.engineSettings.openTrackingHint")}
          checked={form.openTracking}
          disabled={readOnly}
          onChange={(value) => set("openTracking", value)}
        />
      </Section>

      {notice !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      ) : null}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onClose}>
          {t(readOnly ? "adminJourneys.common.close" : "adminJourneys.common.cancel")}
        </Button>
        {readOnly ? null : (
          <Button type="submit" disabled={!dirty || !valid || save.isPending}>
            {t(save.isPending ? "adminJourneys.engineSettings.saving" : "adminJourneys.engineSettings.save")}
          </Button>
        )}
      </DialogFooter>
      {!readOnly && !dirty ? (
        <p className="sr-only" aria-live="polite">
          {t("adminJourneys.engineSettings.noChanges")}
        </p>
      ) : null}
      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </form>
  );
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  counter,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  counter?: string;
  error?: string | false;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
        <div className="min-w-0 space-y-0.5">
          {hint ? (
            <p id={`${id}-hint`} className="text-muted-foreground">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={`${id}-error`} className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        {counter ? (
          <span id={`${id}-counter`} className="shrink-0 tabular-nums text-muted-foreground">
            {counter}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}
