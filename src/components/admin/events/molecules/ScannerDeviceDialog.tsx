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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
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
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
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

/** Jednorazowy pokaz jawnego tokenu - zamknięcie okienka kasuje go z pamięci. */
export function ScannerCredentialDialog({ credential, onClose }: ScannerCredentialDialogProps) {
  const { t } = useTranslation();
  const open = credential !== null;

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
      <DialogContent className="max-w-lg">
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
            <code className="block break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
              {credential.token}
            </code>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("adminEventOnsite.actions.copyToken")}
          </Button>
          <Button onClick={onClose}>{t("adminEventOnsite.devices.credential.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
