// Organizm: dialog RODZAJU WYDARZENIA - osiemnaście pól w czterech sekcjach.
//
// DLACZEGO OSOBNY PLIK, A NIE CIAŁO `EventTypesManager`. Dialog jest największą
// pojedynczą powierzchnią tego ekranu i ma własną, testowalną odpowiedzialność:
// pokazać wersję roboczą i oddać JEDNĄ intencję zapisu. Manager odpowiada za coś
// innego - co idzie do mutacji, co się dzieje z odpowiedzią i co widzi
// administrator po odmowie. Sklejone w jeden plik, oba te dowody trzeba by
// prowadzić przez ten sam render.
//
// CZTERY SEKCJE SĄ DECYZJĄ, NIE OZDOBĄ. Osiemnaście pól bez nagłówków to ściana:
// redaktor nie znajduje „limitu miejsc", więc zapisuje i sprawdza metodą prób.
// Grupy odpowiadają na cztery różne pytania - czym jest ten rodzaj, jak startuje
// nowe wydarzenie, kto ma dostęp, gdzie stoi w katalogu.
//
// KLUCZ JEST ZAMROŻONY PRZY EDYCJI, a przy tworzeniu podąża za nazwą polską
// tylko DO PIERWSZEGO tknięcia pola. Zmieniony po zapisie osierociłby wydarzenia
// czytające legacy `events.kind`; podążający bez końca kasowałby ręczną poprawkę
// przy każdej dopisanej literze nazwy.
//
// WALIDACJA JEST W DOMENIE. Dialog woła `eventTypeDraftIssue()` tylko po to, żeby
// ODCIĄĆ przycisk zapisu i pokazać powód pod polem - reguły (zakresy liczb, format
// koloru, długości nazw) mieszkają w `lib/events/adminEventTypeCatalog` i mają tam
// tabelę przypadków. Odcięcie przed żądaniem ma znaczenie: odmowa CHECK-a wraca
// jako `23514` bez wskazania pola.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { LucideIconPicker } from "@/components/admin/builder/ui/molecules/LucideIconPicker";
import { Label } from "@/components/ui/label";
import {
  EVENT_FORMATS,
  EVENT_FORMAT_LABEL_KEYS,
  EVENT_GUEST_MODES,
  EVENT_GUEST_MODE_LABEL_KEYS,
  EVENT_REGISTRATION_FLOWS,
  EVENT_REGISTRATION_FLOW_LABEL_KEYS,
  EVENT_REGISTRATION_MODES,
  EVENT_REGISTRATION_MODE_LABEL_KEYS,
  type EventFormat,
  type EventGuestMode,
  type EventRegistrationFlow,
  type EventRegistrationMode,
} from "@/lib/events/eventTypes";
import {
  EVENT_TYPE_DEFAULT_ICON,
  EVENT_TYPE_MAX_DESCRIPTION,
  EVENT_TYPE_MAX_NAME,
  eventTypeDraftIssue,
  eventTypeDraftWithNamePl,
  type EventTypeDraft,
} from "@/lib/events/adminEventTypeCatalog";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventTypeDialog({
  draft,
  isSaving,
  onDraftChange,
  onClose,
  onSave,
}: {
  /** `null` = dialog zamknięty. Otwarcie i zamknięcie należy do managera. */
  draft: EventTypeDraft | null;
  isSaving: boolean;
  onDraftChange: (draft: EventTypeDraft) => void;
  onClose: () => void;
  onSave: (draft: EventTypeDraft) => void;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();

  // Klucz podąża za nazwą polską tylko dopóki nikt go nie tknął. Stan żyje
  // w dialogu, bo jest własnością TEJ sesji edycji, a nie wersji roboczej -
  // manager, który by go trzymał, musiałby go czyścić przy każdym otwarciu.
  const [keyTouched, setKeyTouched] = useState(false);

  const issue = draft === null ? null : eventTypeDraftIssue(draft);

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) {
          setKeyTouched(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft?.id === null
              ? t("adminEvents.types.dialog.createTitle")
              : t("adminEvents.types.dialog.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("adminEvents.types.dialog.description")}</DialogDescription>
        </DialogHeader>

        {draft === null ? null : (
          <div className="space-y-5">
            <AdminFormSection title={t("adminEvents.types.dialog.sectionIdentity")} columns={2}>
              <AdminFormTextRow
                id="event-type-name-pl"
                label={t("adminEvents.types.dialog.namePlLabel")}
                value={draft.namePl}
                maxLength={EVENT_TYPE_MAX_NAME}
                autoFocus
                onValueChange={(value) =>
                  onDraftChange(eventTypeDraftWithNamePl(draft, value, keyTouched))
                }
              />
              <AdminFormTextRow
                id="event-type-name-en"
                label={t("adminEvents.types.dialog.nameEnLabel")}
                value={draft.nameEn}
                maxLength={EVENT_TYPE_MAX_NAME}
                onValueChange={(value) => onDraftChange({ ...draft, nameEn: value })}
              />
              <AdminFormTextRow
                id="event-type-key"
                label={t("adminEvents.types.dialog.keyLabel")}
                hint={t("adminEvents.types.dialog.keyHint")}
                value={draft.key}
                monospace
                disabled={draft.id !== null}
                onValueChange={(value) => {
                  setKeyTouched(true);
                  onDraftChange({ ...draft, key: value });
                }}
              />
              <div className="space-y-1.5">
                <Label htmlFor="event-type-icon">{t("adminEvents.types.dialog.iconLabel")}</Label>
                <LucideIconPicker
                  value={draft.icon}
                  // Wyczyszczenie selektora wraca do ikony domyslnej, a nie do pustki:
                  // pusty `icon` renderowalby sie jako znak zapytania do momentu zapisu.
                  onChange={(icon) =>
                    onDraftChange({ ...draft, icon: icon ?? EVENT_TYPE_DEFAULT_ICON })
                  }
                />
              </div>
              <AdminFormTextRow
                id="event-type-description-pl"
                label={t("adminEvents.types.dialog.descriptionPlLabel")}
                hint={t("adminEvents.types.dialog.descriptionHint")}
                value={draft.descriptionPl}
                rows={2}
                maxLength={EVENT_TYPE_MAX_DESCRIPTION}
                onValueChange={(value) => onDraftChange({ ...draft, descriptionPl: value })}
              />
              <AdminFormTextRow
                id="event-type-description-en"
                label={t("adminEvents.types.dialog.descriptionEnLabel")}
                value={draft.descriptionEn}
                rows={2}
                maxLength={EVENT_TYPE_MAX_DESCRIPTION}
                onValueChange={(value) => onDraftChange({ ...draft, descriptionEn: value })}
              />
            </AdminFormSection>

            <AdminFormSection title={t("adminEvents.types.dialog.sectionDefaults")} columns={2}>
              <AdminFormEnumRow<EventFormat>
                id="event-type-format"
                label={t("adminEvents.types.dialog.formatLabel")}
                value={draft.defaultFormat}
                options={EVENT_FORMATS}
                labelFor={(option) => t(EVENT_FORMAT_LABEL_KEYS[option])}
                onValueChange={(value) => onDraftChange({ ...draft, defaultFormat: value })}
              />
              <AdminFormEnumRow<EventRegistrationMode>
                id="event-type-registration-mode"
                label={t("adminEvents.types.dialog.registrationModeLabel")}
                value={draft.defaultRegistrationMode}
                options={EVENT_REGISTRATION_MODES}
                labelFor={(option) => t(EVENT_REGISTRATION_MODE_LABEL_KEYS[option])}
                onValueChange={(value) =>
                  onDraftChange({ ...draft, defaultRegistrationMode: value })
                }
              />
              <AdminFormEnumRow<EventRegistrationFlow>
                id="event-type-registration-flow"
                label={t("adminEvents.types.dialog.registrationFlowLabel")}
                value={draft.defaultRegistrationFlow}
                options={EVENT_REGISTRATION_FLOWS}
                labelFor={(option) => t(EVENT_REGISTRATION_FLOW_LABEL_KEYS[option])}
                onValueChange={(value) =>
                  onDraftChange({ ...draft, defaultRegistrationFlow: value })
                }
              />
              <AdminFormTextRow
                id="event-type-capacity"
                label={t("adminEvents.types.dialog.capacityLabel")}
                hint={t("adminEvents.types.dialog.capacityHint")}
                value={draft.defaultCapacity}
                type="number"
                inputMode="numeric"
                onValueChange={(value) => onDraftChange({ ...draft, defaultCapacity: value })}
              />
              <AdminFormTextRow
                id="event-type-duration"
                label={t("adminEvents.types.dialog.durationLabel")}
                hint={t("adminEvents.types.dialog.durationHint")}
                value={draft.defaultDurationMinutes}
                type="number"
                inputMode="numeric"
                onValueChange={(value) =>
                  onDraftChange({ ...draft, defaultDurationMinutes: value })
                }
              />
              <AdminFormTextRow
                id="event-type-accent"
                label={t("adminEvents.types.dialog.accentColorLabel")}
                hint={t("adminEvents.types.dialog.accentColorHint")}
                value={draft.accentColor}
                monospace
                placeholder="#1d4ed8"
                onValueChange={(value) => onDraftChange({ ...draft, accentColor: value })}
              />
            </AdminFormSection>

            <AdminFormSection title={t("adminEvents.types.dialog.sectionAccess")} columns={2}>
              <AdminFormEnumRow<EventGuestMode>
                id="event-type-guest-mode"
                label={t("adminEvents.types.dialog.guestModeLabel")}
                value={draft.defaultGuestMode}
                options={EVENT_GUEST_MODES}
                labelFor={(option) => t(EVENT_GUEST_MODE_LABEL_KEYS[option])}
                onValueChange={(value) => onDraftChange({ ...draft, defaultGuestMode: value })}
              />
              <AdminFormTextRow
                id="event-type-tier-rank"
                label={t("adminEvents.types.dialog.minTierRankLabel")}
                value={String(draft.defaultMinTierRank)}
                type="number"
                inputMode="numeric"
                onValueChange={(value) =>
                  onDraftChange({ ...draft, defaultMinTierRank: Number(value) || 0 })
                }
              />
              <AdminFormSwitchRow
                id="event-type-chatham"
                label={t("adminEvents.types.dialog.chathamHouseLabel")}
                hint={t("adminEvents.types.dialog.chathamHouseHint")}
                checked={draft.defaultChathamHouse}
                onCheckedChange={(checked) =>
                  onDraftChange({ ...draft, defaultChathamHouse: checked })
                }
              />
              <AdminFormSwitchRow
                id="event-type-ticket"
                label={t("adminEvents.types.dialog.requiresTicketLabel")}
                checked={draft.requiresTicket}
                onCheckedChange={(checked) => onDraftChange({ ...draft, requiresTicket: checked })}
              />
            </AdminFormSection>

            <AdminFormSection title={t("adminEvents.types.dialog.sectionCatalog")} columns={2}>
              <AdminFormTextRow
                id="event-type-sort-order"
                label={t("adminEvents.types.dialog.sortOrderLabel")}
                value={String(draft.sortOrder)}
                type="number"
                inputMode="numeric"
                onValueChange={(value) =>
                  onDraftChange({ ...draft, sortOrder: Number(value) || 0 })
                }
              />
              <AdminFormSwitchRow
                id="event-type-active"
                label={t("adminEvents.types.dialog.isActiveLabel")}
                checked={draft.isActive}
                onCheckedChange={(checked) => onDraftChange({ ...draft, isActive: checked })}
              />
            </AdminFormSection>

            {issue === null ? null : (
              <p className="text-sm text-destructive" role="alert">
                {t(issue)}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t("adminEvents.types.dialog.cancelAction")}
              </Button>
              <Button onClick={() => onSave(draft)} disabled={isSaving || issue !== null}>
                {isSaving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {t("adminEvents.types.dialog.saveAction")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
