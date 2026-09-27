// Organizm: FORMULARZ NOWEJ EDYCJI Z POPRZEDNIEJ (klon wydarzenia).
//
// SZKIC STARTUJE Z BAZY. Tytuły z podbitym rokiem, termin „ta sama godzina rok
// później" (`target.suggested_starts_at`) i domyślne przełączniki przychodzą
// z podglądu źródła - formularz nie ma własnej listy domyślnych ani własnej
// arytmetyki dat. Organizator zmienia tylko to, co chce zmienić.
//
// PODGLĄD NA ŻYWO. Każda zmiana szkicu (po pauzie w pisaniu) pyta
// `admin_event_clone_preview`, który liczy daty i ostrzeżenia TĄ SAMĄ funkcją co
// klon. Blokady (sesje poza nowym terminem, zajęty adres) zatrzymują zapis,
// zanim baza odmówi.
//
// OPCJE WYŁĄCZONEJ SEKCJI ZNIKAJĄ. „Wszystkie sesje jako szkice" bez kopiowania
// agendy to przełącznik, który niczego nie zmienia - kontrolka kłamiąca o
// skutku. Tak samo przyrostek kodów bez kopiowania kodów i termin zadań CRM
// bez zadań.
//
// ODMOWA PO PRÓBIE, NIE OD WEJŚCIA - ta sama zasada co w kreatorze wydarzenia:
// zdanie o brakującym polu nad świeżo otwartym formularzem czyta się jak awaria.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarDays,
  Copy,
  Layers,
  Loader2,
  SlidersHorizontal,
  Users,
} from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { EventClonePreviewPanel } from "@/components/admin/events/molecules/EventClonePreviewPanel";
import {
  CLONE_INCLUDE_KEYS,
  type CloneFlagKey,
  type CloneIncludeKey,
  type EventCloneInput,
  type EventClonePreview,
} from "@/lib/events/eventCloneApi";
import {
  cloneDraftFromPreview,
  cloneDraftToInput,
  cloneSourceContext,
  eventCloneIssue,
  type EventCloneDraft,
} from "@/lib/events/eventCloneDraft";
import {
  CLONE_INCLUDE_COUNT_KEYS,
  CLONE_INCLUDE_HINT_KEYS,
  CLONE_INCLUDE_LABEL_KEYS,
  CLONE_ITEM_LABEL_KEYS,
  CLONE_OPTION_FLAGS,
  CLONE_OPTION_HINT_KEYS,
  CLONE_OPTION_LABEL_KEYS,
  CLONE_OPTION_REQUIRES,
  cloneStatusKey,
} from "@/lib/events/eventCloneLabels";
import { formatEventDateTime } from "@/lib/events/timezone";
import { timeZoneOptions } from "@/lib/events/timeZoneOptions";
import { useEventClonePreview } from "@/lib/events/useEventClone";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

export function EventCloneForm({
  source,
  isSaving,
  onCancel,
  onSubmit,
  onDraftChange,
}: {
  /** Podgląd samego źródła (bez szkicu) - liczniki, podpowiedź terminu, domyślne. */
  source: EventClonePreview;
  isSaving: boolean;
  onCancel: () => void;
  /** Wejście klonu BEZ klucza idempotencji - dokłada go ekran (jeden na akcję). */
  onSubmit: (input: EventCloneInput) => void;
  /** Szkic w górę - rail studia rysuje tytuł i termin wpisywane tutaj. */
  onDraftChange?: (draft: EventCloneDraft) => void;
}) {
  ensureCloneI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const context = useMemo(() => cloneSourceContext(source), [source]);
  const [draft, setDraft] = useState<EventCloneDraft>(() => cloneDraftFromPreview(source));
  const [attempted, setAttempted] = useState(false);

  // Raport w górę EFEKTEM - `setState` rodzica w trakcie renderu dziecka jest
  // w Reakcie zabroniony.
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const input = useMemo(() => cloneDraftToInput(context, draft), [context, draft]);
  const previewQ = useEventClonePreview(input);
  const preview = previewQ.data ?? null;
  const issue = eventCloneIssue(draft, context.externalMode);
  const blocked = (preview?.blockers.length ?? 0) > 0;
  const zones = timeZoneOptions(draft.timezone);

  const update = (patch: Partial<EventCloneDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const setInclude = (key: CloneIncludeKey, value: boolean) =>
    setDraft((current) => ({ ...current, include: { ...current.include, [key]: value } }));
  const setFlag = (key: CloneFlagKey, value: boolean) =>
    setDraft((current) => ({ ...current, flags: { ...current.flags, [key]: value } }));

  const countsLine = (key: CloneIncludeKey) =>
    CLONE_INCLUDE_COUNT_KEYS[key]
      .map((item) =>
        t("adminEventClone.count", {
          label: t(CLONE_ITEM_LABEL_KEYS[item]),
          count: source.counts[item] ?? 0,
        }),
      )
      .join(" · ");

  const sourceTitle = pickLocalized(
    { title_pl: source.source.titlePl, title_en: source.source.titleEn },
    "title",
    lang,
  );
  const options = CLONE_OPTION_FLAGS.filter((flag) => draft.include[CLONE_OPTION_REQUIRES[flag]]);

  const submit = () => {
    setAttempted(true);
    if (issue !== null || blocked) return;
    onSubmit(input);
  };

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader className="gap-1 space-y-0 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand"
          >
            <Copy className="h-4 w-4" />
          </span>
          <h1 className="text-base font-semibold leading-tight">
            {t("adminEventClone.screen.title")}
          </h1>
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          {t("adminEventClone.screen.description")}
        </p>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <FieldGroup icon={Layers} title={t("adminEventClone.source.title")}>
          <div className="rounded-md border border-border/60 p-3 text-sm">
            <p className="text-xs text-muted-foreground">{t("adminEventClone.source.label")}</p>
            <p className="font-medium">{sourceTitle}</p>
            <p className="text-xs text-muted-foreground">
              {t("adminEventClone.source.startsAt")}:{" "}
              {formatEventDateTime(source.source.startsAt, source.source.timezone, lang)} ·{" "}
              {t(cloneStatusKey(source.source.status))}
            </p>
            <Link
              to="/admin/events/$eventId/overview"
              params={{ eventId: source.source.id }}
              className="mt-1 inline-block text-xs text-brand hover:underline"
            >
              {t("adminEventClone.source.open")}
            </Link>
          </div>
        </FieldGroup>

        <FieldGroup icon={CalendarDays} title={t("adminEventClone.fields.group")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminFormTextRow
              id="event-clone-title-pl"
              label={t("adminEventClone.fields.titlePl")}
              hint={t("adminEventClone.fields.titleHint")}
              value={draft.titlePl}
              maxLength={200}
              onValueChange={(value) => update({ titlePl: value })}
            />
            <AdminFormTextRow
              id="event-clone-title-en"
              label={t("adminEventClone.fields.titleEn")}
              value={draft.titleEn}
              maxLength={200}
              onValueChange={(value) => update({ titleEn: value })}
            />
          </div>
          <AdminFormTextRow
            id="event-clone-slug"
            label={t("adminEventClone.fields.slug")}
            hint={t("adminEventClone.fields.slugHint", {
              slug: preview?.target.slug ?? source.target.slug,
            })}
            value={draft.slug}
            maxLength={120}
            monospace
            onValueChange={(value) => update({ slug: value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminFormDateTimeRow
              id="event-clone-starts-at"
              label={t("adminEventClone.fields.startsAt")}
              hint={t("adminEventClone.fields.startsAtHint")}
              value={draft.startsAt}
              onValueChange={(value) => update({ startsAt: value })}
            />
            <AdminFormDateTimeRow
              id="event-clone-ends-at"
              label={t("adminEventClone.fields.endsAt")}
              hint={t("adminEventClone.fields.endsAtHint")}
              value={draft.endsAt}
              minDate={draft.startsAt === "" ? undefined : new Date(draft.startsAt)}
              onValueChange={(value) => update({ endsAt: value })}
            />
          </div>
          <AdminFormEnumRow<string>
            id="event-clone-timezone"
            label={t("adminEventClone.fields.timezone")}
            hint={t("adminEventClone.fields.timezoneHint")}
            value={draft.timezone}
            options={zones}
            labelFor={(zone) => zone}
            onValueChange={(value) => update({ timezone: value })}
          />
          {context.externalMode ? (
            <AdminFormTextRow
              id="event-clone-external-url"
              label={t("adminEventClone.fields.externalUrl")}
              hint={t("adminEventClone.fields.externalUrlHint")}
              value={draft.externalRegistrationUrl}
              type="url"
              maxLength={2048}
              onValueChange={(value) => update({ externalRegistrationUrl: value })}
            />
          ) : null}
        </FieldGroup>

        <FieldGroup icon={Copy} title={t("adminEventClone.include.title")}>
          <p className="text-xs leading-snug text-muted-foreground">
            {t("adminEventClone.include.description")}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            {t("adminEventClone.include.always")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLONE_INCLUDE_KEYS.map((key) => (
              <AdminFormSwitchRow
                key={key}
                id={`event-clone-include-${key}`}
                label={t(CLONE_INCLUDE_LABEL_KEYS[key])}
                hint={`${t(CLONE_INCLUDE_HINT_KEYS[key])} ${countsLine(key)}`}
                checked={draft.include[key]}
                onCheckedChange={(value) => setInclude(key, value)}
              />
            ))}
          </div>
          {draft.include.codes ? (
            <AdminFormTextRow
              id="event-clone-code-suffix"
              label={t("adminEventClone.options.codeSuffix")}
              hint={t("adminEventClone.options.codeSuffixHint", {
                suffix: draft.codeSuffix.trim().toUpperCase(),
              })}
              value={draft.codeSuffix}
              maxLength={20}
              monospace
              onValueChange={(value) => update({ codeSuffix: value })}
            />
          ) : null}
        </FieldGroup>

        {options.length === 0 ? null : (
          <FieldGroup icon={SlidersHorizontal} title={t("adminEventClone.options.title")}>
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((flag) => (
                <AdminFormSwitchRow
                  key={flag}
                  id={`event-clone-option-${flag}`}
                  label={t(CLONE_OPTION_LABEL_KEYS[flag])}
                  hint={t(CLONE_OPTION_HINT_KEYS[flag])}
                  checked={draft.flags[flag]}
                  onCheckedChange={(value) => setFlag(flag, value)}
                />
              ))}
            </div>
          </FieldGroup>
        )}

        <FieldGroup icon={Users} title={t("adminEventClone.crm.title")}>
          <p className="text-xs leading-snug text-muted-foreground">
            {t("adminEventClone.crm.description")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {draft.include.sponsors ? (
              <AdminFormSwitchRow
                id="event-clone-crm-refresh"
                label={t("adminEventClone.crm.refreshSnapshots")}
                hint={t("adminEventClone.crm.refreshSnapshotsHint")}
                checked={draft.flags.refreshSponsorSnapshots}
                onCheckedChange={(value) => setFlag("refreshSponsorSnapshots", value)}
              />
            ) : null}
            <AdminFormSwitchRow
              id="event-clone-crm-tasks"
              label={t("adminEventClone.crm.renewalTasks")}
              hint={t("adminEventClone.crm.renewalTasksHint", {
                count: source.counts.renewal_contacts ?? 0,
              })}
              checked={draft.flags.crmRenewalTasks}
              onCheckedChange={(value) => setFlag("crmRenewalTasks", value)}
            />
          </div>
          {draft.flags.crmRenewalTasks ? (
            <AdminFormTextRow
              id="event-clone-crm-due-days"
              label={t("adminEventClone.crm.dueDays")}
              hint={t("adminEventClone.crm.dueDaysHint")}
              value={draft.crmTaskDueDays}
              type="number"
              inputMode="numeric"
              maxLength={3}
              onValueChange={(value) => update({ crmTaskDueDays: value })}
            />
          ) : null}
        </FieldGroup>

        <EventClonePreviewPanel
          preview={preview}
          isFetching={previewQ.isFetching}
          error={previewQ.error}
        />

        {attempted && (issue !== null || blocked) ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t(issue ?? "adminEventClone.issues.blocked")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("adminEventClone.actions.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {t(isSaving ? "adminEventClone.actions.submitting" : "adminEventClone.actions.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Sekcja formularza: ikona + nazwa grupy nad polami (ten sam wzorzec co kreator). */
function FieldGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Layers;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}
