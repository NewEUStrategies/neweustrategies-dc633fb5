// Organizm: „Ustawienia naboru" - pierwszy ekran grupy „Nabór prelegentów".
//
// PO CO. Tu zapada, CZY i NA JAKICH ZASADACH ktokolwiek zgłosi wystąpienie:
// stan naboru i okno, teksty strony naboru, formy i ścieżki do wyboru, limit
// zgłoszeń, zasady oceny (w ciemno, skala, kryteria, minimum ocen) oraz to,
// do jakiej grupy i z jakim biletem trafi przyjęty prelegent.
//
// OTWARCIE LICZY BAZA. Ekran pokazuje fazę policzoną przez `_event_cfp_phase`
// (zegar bazy), a nie przez przeglądarkę - organizator widzi to samo, co strona
// publiczna. Zapis zostawia wyliczenie bazie.
//
// ZAPIS JEST JAWNY (pasek zapisu), jak w całym studiu - studio nie zapisuje
// samo. Po zapisie odpowiedź RPC staje się nowym stanem formularza.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import {
  EventStudioChoiceCard,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { CfpLabelledListEditor } from "@/components/admin/events/molecules/CfpLabelledListEditor";
import { adminCfpErrorMessage } from "@/lib/events/adminCfpErrors";
import { CFP_PHASE_LABEL_KEYS } from "@/lib/events/adminCfpLabels";
import { CFP_STATUSES, localizedPair, type CfpStatus } from "@/lib/events/cfpEnums";
import {
  CFP_MAX_CRITERIA,
  CFP_MAX_FORMATS,
  CFP_SCORE_MAX_OPTIONS,
  CFP_TEXT_MAX,
  cfpSettingsDirty,
  cfpSettingsDraftFromSettings,
  cfpSettingsPayload,
  emptyCriterionDraft,
  emptyFormatDraft,
  toggleId,
  validateCfpSettingsDraft,
  type CfpSettingsDraft,
  type CfpSettingsField,
} from "@/lib/events/cfpSettingsDraft";
import type { CfpSettings } from "@/lib/events/cfpSurface";
import { useCfpSettings, useSaveCfpSettings } from "@/lib/events/useEventCfp";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

/** Wartownik „brak" - Radix Select zabrania pustego `value`. */
const NONE = "__none__";

const STATUS_LABEL_KEYS: Record<CfpStatus, string> = {
  draft: "adminEventCfp.settings.status.draft",
  open: "adminEventCfp.settings.status.open",
  closed: "adminEventCfp.settings.status.closed",
};

const STATUS_HINT_KEYS: Record<CfpStatus, string> = {
  draft: "adminEventCfp.settings.status.draftHint",
  open: "adminEventCfp.settings.status.openHint",
  closed: "adminEventCfp.settings.status.closedHint",
};

export function CfpSettingsPanel({ eventId }: { eventId: string }) {
  ensureAdminEventCfpI18n();
  const { t } = useTranslation();
  const settingsQ = useCfpSettings(eventId);
  const settings = settingsQ.data;

  if (settings === undefined) {
    return (
      <AdminCatalogListState
        isLoading={settingsQ.isLoading}
        loadingLabel={t("adminEventCfp.common.loading")}
        errorMessage={settingsQ.error ? adminCfpErrorMessage(settingsQ.error) : null}
        isEmpty={false}
        emptyLabel=""
      >
        {null}
      </AdminCatalogListState>
    );
  }
  return <CfpSettingsForm eventId={eventId} settings={settings} />;
}

function CfpSettingsForm({ eventId, settings }: { eventId: string; settings: CfpSettings }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const saved = useMemo(() => cfpSettingsDraftFromSettings(settings), [settings]);
  const [draft, setDraft] = useState<CfpSettingsDraft>(saved);
  const [touched, setTouched] = useState(false);
  // Stan z serwera wygrywa po zapisie - ale tylko ZMIANA TREŚCI. Odświeżenie
  // w tle daje nowy obiekt o tej samej treści i nie może zamieść niezapisanych
  // zmian organizatora.
  const signature = JSON.stringify(saved);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => setDraft(savedRef.current), [signature]);

  const save = useSaveCfpSettings(eventId);
  const issues = validateCfpSettingsDraft(draft);
  const dirty = cfpSettingsDirty(draft, saved);

  const set = <K extends keyof CfpSettingsDraft>(key: K, value: CfpSettingsDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const errorFor = (field: CfpSettingsField): string | null => {
    if (!touched) return null;
    const found = issues.find((issue) => issue.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const submit = () => {
    setTouched(true);
    if (issues.length > 0) return;
    save.mutate(cfpSettingsPayload(eventId, draft), {
      onSuccess: (next) => {
        // Odpowiedź RPC jest nowym stanem formularza - wprost, bez czekania na
        // to, czy zmiana treści w cache zdąży uruchomić efekt przed odświeżeniem.
        setDraft(cfpSettingsDraftFromSettings(next));
        setTouched(false);
        toast.success(t("adminEventCfp.toasts.settingsSaved"));
      },
      onError: (error) => toast.error(adminCfpErrorMessage(error)),
    });
  };

  const nameOf = (option: { namePl: string; nameEn: string }) =>
    localizedPair(lang, option.namePl, option.nameEn);

  const groupOptions = [NONE, ...settings.groups.map((group) => group.id)];
  const ticketOptions = [NONE, ...settings.tickets.map((ticket) => ticket.id)];

  return (
    <div className="space-y-8">
      <EventStudioRow
        label={t("adminEventCfp.settings.statusTitle")}
        description={t("adminEventCfp.settings.statusDescription")}
        hint={
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground">
              {t("adminEventCfp.settings.phaseNow", {
                phase: t(CFP_PHASE_LABEL_KEYS[settings.phase]),
              })}
            </p>
            {settings.eventStatus === "published" ? null : (
              <p className="text-amber-600 dark:text-amber-400">
                {t("adminEventCfp.settings.eventNotPublished")}
              </p>
            )}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {CFP_STATUSES.map((status) => (
            <EventStudioChoiceCard
              key={status}
              id={`cfp-status-${status}`}
              name="cfp-status"
              checked={draft.status === status}
              label={t(STATUS_LABEL_KEYS[status])}
              description={t(STATUS_HINT_KEYS[status])}
              onSelect={() => set("status", status)}
            />
          ))}
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.windowTitle")}
        description={t("adminEventCfp.settings.windowDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormDateTimeRow
            id="cfp-opens-at"
            label={t("adminEventCfp.settings.opensAt")}
            value={draft.opensAt}
            hint={t("adminEventCfp.settings.opensAtHint")}
            onValueChange={(value) => set("opensAt", value)}
          />
          <AdminFormDateTimeRow
            id="cfp-closes-at"
            label={t("adminEventCfp.settings.closesAt")}
            value={draft.closesAt}
            hint={t("adminEventCfp.settings.closesAtHint")}
            error={errorFor("window")}
            onValueChange={(value) => set("closesAt", value)}
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.textsTitle")}
        description={t("adminEventCfp.settings.textsDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormTextRow
            id="cfp-intro-pl"
            label={t("adminEventCfp.settings.introPl")}
            value={draft.introPl}
            rows={4}
            maxLength={CFP_TEXT_MAX}
            onValueChange={(value) => set("introPl", value)}
          />
          <AdminFormTextRow
            id="cfp-intro-en"
            label={t("adminEventCfp.settings.introEn")}
            value={draft.introEn}
            rows={4}
            maxLength={CFP_TEXT_MAX}
            onValueChange={(value) => set("introEn", value)}
          />
          <AdminFormTextRow
            id="cfp-guidelines-pl"
            label={t("adminEventCfp.settings.guidelinesPl")}
            value={draft.guidelinesPl}
            rows={6}
            maxLength={CFP_TEXT_MAX}
            onValueChange={(value) => set("guidelinesPl", value)}
          />
          <AdminFormTextRow
            id="cfp-guidelines-en"
            label={t("adminEventCfp.settings.guidelinesEn")}
            value={draft.guidelinesEn}
            rows={6}
            maxLength={CFP_TEXT_MAX}
            error={errorFor("texts")}
            onValueChange={(value) => set("guidelinesEn", value)}
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.formatsTitle")}
        description={t("adminEventCfp.settings.formatsDescription")}
      >
        <CfpLabelledListEditor
          idPrefix="cfp-format"
          rows={draft.formats.map((format) => ({ ...format, value: format.durationMin }))}
          onChange={(rows) =>
            set(
              "formats",
              rows.map((row) => ({
                key: row.key,
                labelPl: row.labelPl,
                labelEn: row.labelEn,
                durationMin: row.value,
              })),
            )
          }
          valueLabel={t("adminEventCfp.settings.formatDuration")}
          addLabel={t("adminEventCfp.settings.addFormat")}
          emptyLabel={t("adminEventCfp.settings.noFormats")}
          newRow={() => {
            const row = emptyFormatDraft();
            return {
              key: row.key,
              labelPl: row.labelPl,
              labelEn: row.labelEn,
              value: row.durationMin,
            };
          }}
          max={CFP_MAX_FORMATS}
          error={errorFor("formats")}
        />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.tracksTitle")}
        description={t("adminEventCfp.settings.tracksDescription")}
      >
        {settings.tracks.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("adminEventCfp.settings.noTracks")}</p>
        ) : (
          <ul className="space-y-2">
            {settings.tracks.map((track) => (
              <li key={track.id}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.trackIds.includes(track.id)}
                    onCheckedChange={() => set("trackIds", toggleId(draft.trackIds, track.id))}
                  />
                  <span>{nameOf(track)}</span>
                  {track.isActive ? null : (
                    <span className="text-xs text-muted-foreground">
                      {t("adminEventCfp.settings.trackInactive")}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.rulesTitle")}
        description={t("adminEventCfp.settings.rulesDescription")}
      >
        <AdminFormTextRow
          id="cfp-max-per-submitter"
          label={t("adminEventCfp.settings.maxPerSubmitter")}
          value={draft.maxPerSubmitter}
          inputMode="numeric"
          hint={t("adminEventCfp.settings.maxPerSubmitterHint")}
          error={errorFor("maxPerSubmitter")}
          onValueChange={(value) => set("maxPerSubmitter", value)}
        />
        <AdminFormSwitchRow
          id="cfp-allow-co-speakers"
          label={t("adminEventCfp.settings.allowCoSpeakers")}
          hint={t("adminEventCfp.settings.allowCoSpeakersHint")}
          checked={draft.allowCoSpeakers}
          onCheckedChange={(checked) => set("allowCoSpeakers", checked)}
        />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.reviewTitle")}
        description={t("adminEventCfp.settings.reviewDescription")}
      >
        <AdminFormSwitchRow
          id="cfp-review-blind"
          label={t("adminEventCfp.settings.reviewBlind")}
          hint={t("adminEventCfp.settings.reviewBlindHint")}
          checked={draft.reviewBlind}
          onCheckedChange={(checked) => set("reviewBlind", checked)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormEnumRow<string>
            id="cfp-score-max"
            label={t("adminEventCfp.settings.scoreMax")}
            value={draft.scoreMax}
            options={CFP_SCORE_MAX_OPTIONS.map(String)}
            labelFor={(option) => option}
            error={errorFor("scoreMax")}
            onValueChange={(value) => set("scoreMax", value)}
          />
          <AdminFormTextRow
            id="cfp-min-reviews"
            label={t("adminEventCfp.settings.minReviews")}
            value={draft.minReviews}
            inputMode="numeric"
            hint={t("adminEventCfp.settings.minReviewsHint")}
            error={errorFor("minReviews")}
            onValueChange={(value) => set("minReviews", value)}
          />
        </div>
        <CfpLabelledListEditor
          idPrefix="cfp-criterion"
          rows={draft.criteria.map((criterion) => ({ ...criterion, value: criterion.weight }))}
          onChange={(rows) =>
            set(
              "criteria",
              rows.map((row) => ({
                key: row.key,
                labelPl: row.labelPl,
                labelEn: row.labelEn,
                weight: row.value,
              })),
            )
          }
          valueLabel={t("adminEventCfp.settings.criterionWeight")}
          addLabel={t("adminEventCfp.settings.addCriterion")}
          emptyLabel={t("adminEventCfp.settings.noCriteria")}
          newRow={() => {
            const row = emptyCriterionDraft();
            return { key: row.key, labelPl: row.labelPl, labelEn: row.labelEn, value: row.weight };
          }}
          max={CFP_MAX_CRITERIA}
          error={errorFor("criteria")}
        />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventCfp.settings.speakerTitle")}
        description={t("adminEventCfp.settings.speakerDescription")}
      >
        <AdminFormEnumRow<string>
          id="cfp-speaker-group"
          label={t("adminEventCfp.settings.speakerGroup")}
          value={draft.speakerGroupId ?? NONE}
          options={groupOptions}
          labelFor={(option) => {
            const group = settings.groups.find((entry) => entry.id === option);
            return group === undefined ? t("adminEventCfp.settings.noGroup") : nameOf(group);
          }}
          hint={t("adminEventCfp.settings.speakerGroupHint")}
          onValueChange={(value) => set("speakerGroupId", value === NONE ? null : value)}
        />
        <AdminFormEnumRow<string>
          id="cfp-speaker-ticket"
          label={t("adminEventCfp.settings.speakerTicket")}
          value={draft.speakerTicketTypeId ?? NONE}
          options={ticketOptions}
          labelFor={(option) => {
            const ticket = settings.tickets.find((entry) => entry.id === option);
            return ticket === undefined ? t("adminEventCfp.settings.noTicket") : nameOf(ticket);
          }}
          hint={t("adminEventCfp.settings.speakerTicketHint")}
          onValueChange={(value) => set("speakerTicketTypeId", value === NONE ? null : value)}
        />
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        disabled={touched && issues.length > 0}
        saveLabel={t("adminEventCfp.common.save")}
        discardLabel={t("adminEventCfp.common.discard")}
        savingLabel={t("adminEventCfp.common.saving")}
        onSave={submit}
        onDiscard={() => {
          setDraft(saved);
          setTouched(false);
        }}
      />
    </div>
  );
}
