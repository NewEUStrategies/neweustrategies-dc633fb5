// Molekuła: wydanie POŚWIADCZENIA urządzenia skanującego oraz jednorazowy
// pokaz jawnego tokenu.
//
// TOKEN WIDZISZ RAZ. Baza trzyma wyłącznie skrót SHA-256 i nie ma funkcji, która
// odtworzy jawny token. Dlatego pokaz tokenu jest OSOBNYM okienkiem z jawnym
// ostrzeżeniem i przyciskiem kopiowania - a nie linijką w liście urządzeń, którą
// operator przeoczy i wróci po nią za pół godziny.
//
// TOKEN NIE JEDZIE DO STANU GLOBALNEGO. Żyje w propsie tego okienka i ginie z
// jego zamknięciem: cache React Query jest widoczny w devtoolsach, a to nie jest
// miejsce na poświadczenie wpuszczające ludzi na wydarzenie.
//
// UPRAWNIENIE `lead` WYMAGA SPONSORA. Skan leada zapisuje zgodę marketingową na
// czyjąś rzecz - bez wskazanego sponsora nie ma czyjej.
//
// LISTA OFFLINE TO ŚWIADOMA DECYZJA Z OSTRZEŻENIEM RODO. Zaznaczenie wysyła na
// telefon listę uczestników (bez e-maili i telefonów, ze skrótami kodów zamiast
// kodów), więc pole jest domyślnie puste, stoi obok ostrzeżenia i działa tylko
// razem z uprawnieniem do odprawy.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, KeyRound, Link as LinkIcon, ShieldAlert } from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import {
  SCANNER_SCOPES,
  type ScannerDeviceCredential,
  type ScannerDeviceIssueInput,
  type ScannerScope,
} from "@/lib/events/onsiteApi";
import {
  ONSITE_MAX_NAME,
  emptyScannerDeviceDraft,
  scannerDeviceDraftToInput,
  validateScannerDeviceDraft,
  type ScannerDeviceDraft,
} from "@/lib/events/onsiteDraft";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";

ensureOnsiteI18n();

const NONE = "__none__";

export interface ScannerRelationOption {
  id: string;
  label: string;
}

interface ScannerDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  checkpoints: ScannerRelationOption[];
  sponsors: ScannerRelationOption[];
  isSaving: boolean;
  onSubmit: (input: ScannerDeviceIssueInput) => void;
}

export function ScannerDeviceDialog({
  open,
  onOpenChange,
  eventId,
  checkpoints,
  sponsors,
  isSaving,
  onSubmit,
}: ScannerDeviceDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ScannerDeviceDraft>(() => emptyScannerDeviceDraft());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(emptyScannerDeviceDraft());
    setTouched(false);
  }, [open]);

  const errors = validateScannerDeviceDraft(draft);
  const hasCheckin = draft.scopes.includes("checkin");
  const errorFor = (field: string): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const toggleScope = (scope: ScannerScope, next: boolean) =>
    setDraft((previous) => ({
      ...previous,
      scopes: next
        ? [...previous.scopes.filter((item) => item !== scope), scope]
        : previous.scopes.filter((item) => item !== scope),
    }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(scannerDeviceDraftToInput(draft, eventId));
  };

  const options = (items: ScannerRelationOption[], noneLabel: string) => [
    { value: NONE, label: noneLabel },
    ...items.map((item) => ({ value: item.id, label: item.label })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventOnsite.devices.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("adminEventOnsite.devices.subtitle")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventOnsite.devices.title")} columns={1}>
          <AdminFormTextRow
            label={t("adminEventOnsite.devices.dialog.label")}
            hint={t("adminEventOnsite.devices.dialog.labelHint")}
            value={draft.label}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, label: value }))}
            maxLength={ONSITE_MAX_NAME}
            error={errorFor("label")}
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {t("adminEventOnsite.devices.dialog.scopes")}
            </legend>
            <div className="flex flex-wrap gap-4">
              {SCANNER_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.scopes.includes(scope)}
                    onCheckedChange={(next) => toggleScope(scope, next === true)}
                    aria-label={t(`adminEventOnsite.scopes.${scope}`)}
                  />
                  {t(`adminEventOnsite.scopes.${scope}`)}
                </label>
              ))}
            </div>
            {errorFor("scopes") === null ? null : (
              <p className="text-xs text-destructive">{errorFor("scopes")}</p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="device-checkpoint">
              {t("adminEventOnsite.devices.dialog.checkpoint")}
            </Label>
            <FormSelect
              id="device-checkpoint"
              value={draft.checkpointId === "" ? NONE : draft.checkpointId}
              options={options(checkpoints, t("adminEventOnsite.devices.dialog.checkpointNone"))}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, checkpointId: value === NONE ? "" : value }))
              }
              aria-label={t("adminEventOnsite.devices.dialog.checkpoint")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="device-sponsor">{t("adminEventOnsite.devices.dialog.sponsor")}</Label>
            <FormSelect
              id="device-sponsor"
              value={draft.sponsorId === "" ? NONE : draft.sponsorId}
              options={options(sponsors, t("adminEventOnsite.devices.dialog.sponsorNone"))}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, sponsorId: value === NONE ? "" : value }))
              }
              error={errorFor("sponsorId")}
              aria-label={t("adminEventOnsite.devices.dialog.sponsor")}
            />
          </div>

          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="device-offline-roster"
                checked={draft.offlineRoster && hasCheckin}
                disabled={!hasCheckin}
                onCheckedChange={(next) =>
                  setDraft((prev) => ({ ...prev, offlineRoster: next === true }))
                }
              />
              <div className="space-y-1">
                <Label htmlFor="device-offline-roster" className="text-sm font-medium">
                  {t("adminEventOnsite.devices.dialog.offlineRoster")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {hasCheckin
                    ? t("adminEventOnsite.devices.dialog.offlineRosterHint")
                    : t("adminEventOnsite.devices.dialog.offlineRosterNeedsCheckin")}
                </p>
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("adminEventOnsite.devices.dialog.offlineRosterWarning")}
            </p>
          </div>

          <AdminFormTextRow
            label={t("adminEventOnsite.devices.dialog.expiresAt")}
            hint={t("adminEventOnsite.devices.dialog.expiresHint")}
            value={draft.expiresAtLocal}
            onValueChange={(value) => setDraft((prev) => ({ ...prev, expiresAtLocal: value }))}
            type="datetime-local"
            error={errorFor("expiresAtLocal")}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventOnsite.actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventOnsite.actions.issueDevice")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScannerCredentialDialogProps {
  credential: ScannerDeviceCredential | null;
  onClose: () => void;
}

/**
 * Jednorazowy pokaz jawnego tokenu - zamknięcie okienka kasuje go z pamięci.
 *
 * KOD QR JEST TU NAJWAŻNIEJSZY. Wolontariusz nie przepisze trzydziestu dwóch
 * znaków base64url z ekranu laptopa na telefon bez pomyłki, a przepisany
 * z pomyłką token wygląda jak awaria systemu. Kod prowadzi wprost do
 * `/scanner?t=…`, więc telefon jest sparowany w jednym geście - a trasa
 * skanera natychmiast czyści token z paska adresu.
 *
 * ADRES POWSTAJE W PRZEGLĄDARCE, NIE NA SERWERZE. `window.location.origin`
 * daje tę samą domenę, na której stoi organizator - a przy wielu domenach
 * najemców to jest jedyna wartość, która na pewno wskaże właściwą.
 */
export function ScannerCredentialDialog({ credential, onClose }: ScannerCredentialDialogProps) {
  const { t } = useTranslation();
  const open = credential !== null;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const pairingUrl =
    credential === null || typeof window === "undefined"
      ? null
      : `${window.location.origin}/scanner?t=${encodeURIComponent(credential.token)}`;

  useEffect(() => {
    if (pairingUrl === null) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(pairingUrl, { width: 320, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [pairingUrl]);

  const copyLink = async () => {
    if (pairingUrl === null) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      toast.success(t("adminEventOnsite.devices.credential.copied"));
    } catch {
      toast.error(t("adminEventOnsite.errors.unknown"));
    }
  };

  const copy = async () => {
    if (credential === null) return;
    try {
      await navigator.clipboard.writeText(credential.token);
      toast.success(t("adminEventOnsite.devices.credential.copied"));
    } catch {
      // Brak dostępu do schowka nie może zabrać tokenu z ekranu - operator
      // przepisze go ręcznie, bo drugiego pokazu nie będzie.
      toast.error(t("adminEventOnsite.errors.unknown"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="event-dialog-compact max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("adminEventOnsite.devices.credential.title")}</DialogTitle>
          <DialogDescription>
            {t("adminEventOnsite.devices.credential.description")}
          </DialogDescription>
        </DialogHeader>

        {credential === null ? null : (
          <div className="space-y-3">
            <p className="text-sm font-medium">{credential.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {credential.scopes.map((scope) => (
                <Badge key={scope} variant="secondary">
                  {t(`adminEventOnsite.scopes.${scope}`, { defaultValue: scope })}
                </Badge>
              ))}
            </div>
            <code className="block break-all rounded-md border border-border bg-muted/40 p-3 font-medium tracking-tight text-xs">
              {credential.token}
            </code>

            {qrDataUrl !== null && (
              <div className="flex flex-col items-center gap-2 rounded-md border border-border p-3">
                <img src={qrDataUrl} alt="" width={200} height={200} className="h-48 w-48" />
                <p className="text-center text-xs text-muted-foreground">
                  {t("adminEventOnsite.devices.credential.qrHint")}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventOnsite.actions.copyToken")}
          </Button>
          <Button variant="outline" onClick={copyLink} disabled={pairingUrl === null}>
            <LinkIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventOnsite.actions.copyPairingLink")}
          </Button>
          <Button onClick={onClose}>{t("adminEventOnsite.devices.credential.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
