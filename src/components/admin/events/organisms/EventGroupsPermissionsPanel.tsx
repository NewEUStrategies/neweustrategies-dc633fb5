// Organizm: „Grupy i uprawnienia" wydarzenia.
//
// DWIE RZECZY NA JEDNYM EKRANIE, bo opisuja jedno pytanie: KTO co widzi.
// Grupy dziela zapisanych na role z wlasnymi zdolnosciami (spotkania, lista
// uczestnikow, skanowanie leadow), a tryb goscia rozstrzyga, co widzi ktos,
// kto nie jest zapisany wcale.
//
// GOSC JEST PELNOPRAWNA GRUPA DOCELOWA, a nie „stanem zerowym" - dlatego
// widocznosc dla niezapisanych ma tu wlasny wiersz, a nie wyjatek w kodzie
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §7).
//
// CHATHAM HOUSE WYGRYWA Z TRYBEM GOSCIA. Przy `chatham_house = true` lista
// uczestnikow i nagranie nie moga trafic do trybu gosci - ekran mowi o tym
// wprost, a regule egzekwuje baza.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Info } from "@/lib/lucide-shim";
import { Switch } from "@/components/ui/switch";
import { EventGroupsPanel } from "@/components/admin/events/organisms/EventGroupsPanel";
import {
  EventStudioChoiceCard,
  EventStudioPage,
  EventStudioRow,
  EventStudioSaveBar,
} from "@/components/admin/events/studio/EventStudioSection";
import { adminEventStudioErrorMessage } from "@/lib/events/adminEventStudioErrors";
import {
  EVENT_GUEST_MODES,
  EVENT_GUEST_MODE_LABEL_KEYS,
  asEventGuestMode,
  type EventGuestMode,
} from "@/lib/events/eventTypes";
import { useSaveEventGeneral } from "@/lib/events/useAdminEventDetail";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

/** Tryb, na ktory wraca przelacznik po wlaczeniu widocznosci publicznej. */
const DEFAULT_VISIBLE_MODE: EventGuestMode = "teaser";

export function EventGroupsPermissionsPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  // Panel grup wozi swoje teksty we wlasnym slowniku - bez tej rejestracji
  // lista pokazalaby surowe klucze.
  ensureTermsI18n();
  const { t } = useTranslation();

  const saved = asEventGuestMode(row.guest_mode);
  const [mode, setMode] = useState<EventGuestMode>(saved);
  useEffect(() => setMode(saved), [saved]);

  const save = useSaveEventGeneral(row.id);
  const dirty = mode !== saved;

  const submit = () => {
    save.mutate(
      { id: row.id, guest_mode: mode },
      {
        onSuccess: () => toast.success(t("adminEvents.studio.toasts.visibilitySaved")),
        onError: (error) => toast.error(adminEventStudioErrorMessage(error)),
      },
    );
  };

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.groups")}>
      <EventStudioRow
        label={t("adminEvents.studio.groupsPage.groups")}
        description={t("adminEvents.studio.groupsPage.groupsDescription")}
      >
        <EventGroupsPanel eventId={row.id} />
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.groupsPage.publicVisibility")}
        description={t("adminEvents.studio.groupsPage.publicVisibilityDescription")}
      >
        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t("adminEvents.studio.groupsPage.guestMode")}</p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("adminEvents.studio.groupsPage.guestModeDescription")}
            </p>
          </div>
          <Switch
            checked={mode !== "hidden"}
            aria-label={t("adminEvents.studio.groupsPage.guestMode")}
            onCheckedChange={(next) => setMode(next ? DEFAULT_VISIBLE_MODE : "hidden")}
          />
        </div>

        {mode === "hidden" ? null : (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {t("adminEvents.studio.groupsPage.guestsVisibility")}
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("adminEvents.studio.groupsPage.guestsVisibilityDescription")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {EVENT_GUEST_MODES.filter((value) => value !== "hidden").map((value) => (
                <EventStudioChoiceCard
                  key={value}
                  id={`event-guest-${value}`}
                  name="event-guest-mode"
                  checked={mode === value}
                  label={t(EVENT_GUEST_MODE_LABEL_KEYS[value])}
                  description={t(`adminEvents.studio.groupsPage.guestModeHints.${value}`)}
                  onSelect={() => setMode(value)}
                />
              ))}
            </div>
          </div>
        )}

        {row.chatham_house ? (
          <p className="inline-flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminEvents.studio.groupsPage.chathamWarning")}
          </p>
        ) : null}
      </EventStudioRow>

      <EventStudioSaveBar
        dirty={dirty}
        saving={save.isPending}
        saveLabel={t("adminEvents.studio.actions.save")}
        discardLabel={t("adminEvents.studio.actions.discard")}
        savingLabel={t("adminEvents.studio.actions.saving")}
        onSave={submit}
        onDiscard={() => setMode(saved)}
      />
    </EventStudioPage>
  );
}
