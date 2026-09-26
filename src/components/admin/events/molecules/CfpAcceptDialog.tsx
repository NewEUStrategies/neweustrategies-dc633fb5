// Molekuła: okno „Przyjmij i zaplanuj".
//
// JEDNO KLIKNIĘCIE = CAŁY ŁAŃCUCH PRELEGENTA. Przyjęcie dopisuje każdą osobę
// zgłoszenia do rejestru prelegentów wydarzenia (ten sam łańcuch, co ręczne
// dodanie prelegenta w panelu), zakłada jej kartę w CRM i - jeśli organizator
// tak zdecyduje - bezpłatną, zatwierdzoną rejestrację oraz szkic sesji z obsadą.
// Okno mówi to wprost, bo skutki wychodzą daleko poza listę zgłoszeń.
//
// PLAN JEST OPCJONALNY. Program często układa się dopiero po zamknięciu naboru;
// przyjęcie bez terminu jest pełnoprawne, a sesję dodaje się później w agendzie.
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
import { AdminFormDateTimeRow } from "@/components/admin/molecules/AdminFormDateTimeRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import type { CfpAcceptInput } from "@/lib/events/cfpApi";
import { CFP_SESSION_FORMATS, localizedPair, type CfpSessionFormat } from "@/lib/events/cfpEnums";
import {
  cfpAcceptDraftFrom,
  cfpAcceptIssue,
  cfpAcceptPayload,
  type CfpAcceptDraft,
} from "@/lib/events/cfpReviewDraft";
import type { CfpRoomOption, CfpTrackOption } from "@/lib/events/cfpSurface";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";

/** Wartownik „brak" - Radix Select zabrania pustego `value`. */
const NONE = "__none__";

const FORMAT_LABEL_KEYS: Record<CfpSessionFormat, string> = {
  onsite: "adminEventCfp.accept.formats.onsite",
  online: "adminEventCfp.accept.formats.online",
  hybrid: "adminEventCfp.accept.formats.hybrid",
};

export function CfpAcceptDialog({
  open,
  onOpenChange,
  submissionId,
  decisionNote,
  feedbackToSpeaker,
  trackId,
  tracks,
  rooms,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  decisionNote: string;
  feedbackToSpeaker: string;
  /** Ścieżka ze zgłoszenia - podpowiedź dla szkicu sesji. */
  trackId: string | null;
  tracks: readonly CfpTrackOption[];
  rooms: readonly CfpRoomOption[];
  isSaving: boolean;
  onSubmit: (input: CfpAcceptInput) => void;
}) {
  ensureAdminEventCfpI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<CfpAcceptDraft>(() =>
    cfpAcceptDraftFrom({ decisionNote, feedbackToSpeaker, trackId }),
  );
  const [touched, setTouched] = useState(false);

  // Każde otwarcie zaczyna od tego, co organizator wpisał w formularzu decyzji.
  useEffect(() => {
    if (!open) return;
    setDraft(cfpAcceptDraftFrom({ decisionNote, feedbackToSpeaker, trackId }));
    setTouched(false);
  }, [open, decisionNote, feedbackToSpeaker, trackId]);

  const set = <K extends keyof CfpAcceptDraft>(key: K, value: CfpAcceptDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const issue = cfpAcceptIssue(draft);
  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(cfpAcceptPayload(submissionId, draft));
  };

  const roomOptions = [NONE, ...rooms.filter((room) => room.isActive).map((room) => room.id)];
  const trackOptions = [NONE, ...tracks.map((track) => track.id)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventCfp.accept.title")}</DialogTitle>
          <DialogDescription>{t("adminEventCfp.accept.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <AdminFormSwitchRow
            id="cfp-accept-register"
            label={t("adminEventCfp.accept.register")}
            hint={t("adminEventCfp.accept.registerHint")}
            checked={draft.register}
            onCheckedChange={(checked) => set("register", checked)}
          />
          <AdminFormSwitchRow
            id="cfp-accept-schedule"
            label={t("adminEventCfp.accept.schedule")}
            hint={t("adminEventCfp.accept.scheduleHint")}
            checked={draft.schedule}
            onCheckedChange={(checked) => set("schedule", checked)}
          />
          {draft.schedule ? (
            <div className="space-y-3 rounded-[6px] border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminFormDateTimeRow
                  id="cfp-accept-starts"
                  label={t("adminEventCfp.accept.startsAt")}
                  value={draft.startsAt}
                  onValueChange={(value) => set("startsAt", value)}
                />
                <AdminFormDateTimeRow
                  id="cfp-accept-ends"
                  label={t("adminEventCfp.accept.endsAt")}
                  value={draft.endsAt}
                  error={
                    touched && issue === "adminEventCfp.accept.validation.schedule"
                      ? t(issue)
                      : null
                  }
                  onValueChange={(value) => set("endsAt", value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <AdminFormEnumRow<string>
                  id="cfp-accept-room"
                  label={t("adminEventCfp.accept.room")}
                  value={draft.roomId === "" ? NONE : draft.roomId}
                  options={roomOptions}
                  labelFor={(option) =>
                    rooms.find((room) => room.id === option)?.name ??
                    t("adminEventCfp.accept.noRoom")
                  }
                  onValueChange={(value) => set("roomId", value === NONE ? "" : value)}
                />
                <AdminFormEnumRow<string>
                  id="cfp-accept-track"
                  label={t("adminEventCfp.accept.track")}
                  value={draft.trackId === "" ? NONE : draft.trackId}
                  options={trackOptions}
                  labelFor={(option) => {
                    const track = tracks.find((entry) => entry.id === option);
                    return track === undefined
                      ? t("adminEventCfp.accept.noTrack")
                      : localizedPair(lang, track.namePl, track.nameEn);
                  }}
                  onValueChange={(value) => set("trackId", value === NONE ? "" : value)}
                />
                <AdminFormEnumRow<CfpSessionFormat>
                  id="cfp-accept-format"
                  label={t("adminEventCfp.accept.format")}
                  value={draft.format}
                  options={CFP_SESSION_FORMATS}
                  labelFor={(option) => t(FORMAT_LABEL_KEYS[option])}
                  onValueChange={(value) => set("format", value)}
                />
              </div>
            </div>
          ) : null}
          {touched && issue !== null && issue !== "adminEventCfp.accept.validation.schedule" ? (
            <p className="text-xs text-destructive" role="alert">
              {t(issue)}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("adminEventCfp.common.cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {t(isSaving ? "adminEventCfp.common.saving" : "adminEventCfp.accept.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
