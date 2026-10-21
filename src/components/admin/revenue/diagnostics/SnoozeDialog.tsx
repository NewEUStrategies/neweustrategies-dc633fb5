// Molekuła: wyciszenie diagnozy (SPEC §4.5, §2.5 - tylko administrator).
//
// Dwa rodzaje = dwa CHECK-i tabeli: „na określony czas" (termin do 180 dni)
// albo „świadomie - tak ma być" (bez terminu, z powodem i odciskiem faktów:
// zmiana liczby albo listy obiektów przywraca diagnozę). Powód za długi jest
// ODRZUCANY komunikatem i blokuje zapis - nigdy przycinany (AGENTS: limit
// widoczny = limit zapisany, `REVENUE_LIMITS.snoozeReason*`). Licznik znaków
// i walidacja liczą powód BEZ białych znaków na brzegach, bo tak samo liczy
// SQL (`btrim`) - i taki powód wysyłamy.
//
// Termin liczymy od LOKALNEGO teraz w przeglądarce i odejmujemy minutę:
// zegar klienta wyprzedzający bazę o sekundy nie może zamienić „180 dni"
// w odmowę `until_too_far`.
//
// ODMOWA W DIALOGU, NIE W TOAŚCIE: kod 22023 (`invalid.<kod>`), brak roli,
// brak funkcji w bazie i wymagane MFA (`MfaRequiredNotice`) zostają w treści
// dialogu, dopóki admin go nie zamknie. Sukces zgłasza tablica w swoim
// regionie `aria-live` (`onSaved`) - dialog się wtedy zamyka.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PlatformSelect } from "@/components/ui/platform-select";
import { Textarea } from "@/components/ui/textarea";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { useSnoozeRevenueCheck } from "@/lib/revenue/diagnostics/queries";
import type { RevenueFinding } from "@/lib/revenue/diagnostics/registry";
import { REVENUE_LIMITS, type SnoozeKind } from "@/lib/revenue/limits";
import { checkTitle } from "./findingText";

/** Gotowe terminy (dni) - wybór admina, nie benchmark; maksimum = CHECK tabeli. */
export const SNOOZE_DAY_CHOICES = [7, 30, 90, REVENUE_LIMITS.snoozeMaxDays] as const;

const DAY_MS = 86_400_000;
const CLOCK_MARGIN_MS = 60_000;

type SnoozeError = { kind: "text"; text: string } | { kind: "mfa" } | null;

export interface SnoozeDialogProps {
  finding: RevenueFinding;
  tenantId: string | null;
  open: boolean;
  initialKind?: SnoozeKind;
  onOpenChange(open: boolean): void;
  /** Zapis przyjęty - tablica ogłasza wynik i zamyka dialog. */
  onSaved?(): void;
}

export function SnoozeDialog({
  finding,
  tenantId,
  open,
  initialKind = "days",
  onOpenChange,
  onSaved,
}: SnoozeDialogProps) {
  ensureI18n();
  const { t } = useTranslation();
  const snooze = useSnoozeRevenueCheck(tenantId);
  const [kind, setKind] = useState<SnoozeKind>(initialKind);
  const [days, setDays] = useState<number>(SNOOZE_DAY_CHOICES[1]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<SnoozeError>(null);
  const kindName = useId();
  const daysId = useId();
  const reasonId = useId();
  const hintId = useId();
  const errorId = useId();

  const trimmedReason = reason.trim();
  const trimmed = trimmedReason.length;
  const tooLong = trimmed > REVENUE_LIMITS.snoozeReasonMax;
  const tooShort = trimmed > 0 && trimmed < REVENUE_LIMITS.snoozeReasonMin;
  const reasonRequired = kind === "intentional";
  const reasonOk = reasonRequired
    ? trimmed >= REVENUE_LIMITS.snoozeReasonMin && !tooLong
    : trimmed === 0 || (!tooShort && !tooLong);
  const reasonError = tooLong
    ? t("adminRevenue.snooze.reasonTooLong", { max: REVENUE_LIMITS.snoozeReasonMax })
    : tooShort
      ? t("adminRevenue.snooze.reasonTooShort", { min: REVENUE_LIMITS.snoozeReasonMin })
      : null;

  const submit = async () => {
    if (!reasonOk || snooze.isPending) return;
    setError(null);
    try {
      const result = await snooze.mutateAsync({
        checkId: finding.checkId,
        scopeKey: "*",
        kind,
        until:
          kind === "days"
            ? new Date(Date.now() + days * DAY_MS - CLOCK_MARGIN_MS).toISOString()
            : null,
        reason: trimmed === 0 ? null : trimmedReason,
        scopeHash: kind === "intentional" ? finding.factHash : null,
      });
      if (result.state === "ok") {
        onSaved?.();
        onOpenChange(false);
        return;
      }
      if (result.state === "invalid") {
        setError({ kind: "text", text: t(`adminRevenue.snooze.invalid.${result.code}`) });
      } else if (result.state === "mfa_required") {
        setError({ kind: "mfa" });
      } else if (result.state === "unavailable") {
        setError({ kind: "text", text: t("adminRevenue.snooze.unavailable") });
      } else {
        setError({ kind: "text", text: t("adminRevenue.snooze.forbidden") });
      }
    } catch {
      setError({ kind: "text", text: t("adminRevenue.snooze.failed") });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="snooze-dialog">
        <DialogHeader>
          <DialogTitle>{t("adminRevenue.snooze.title")}</DialogTitle>
          <DialogDescription>{checkTitle(t, finding.checkId)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.snooze.description")}
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("adminRevenue.snooze.kindLabel")}</legend>
            {(["days", "intentional"] as const).map((candidate) => (
              <label key={candidate} className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={kindName}
                  value={candidate}
                  className="h-4 w-4"
                  checked={kind === candidate}
                  onChange={() => setKind(candidate)}
                />
                {t(`adminRevenue.snooze.kind.${candidate}`)}
              </label>
            ))}
          </fieldset>
          {kind === "days" ? (
            <div className="space-y-1">
              <Label htmlFor={daysId}>{t("adminRevenue.snooze.daysLabel")}</Label>
              <PlatformSelect
                id={daysId}
                value={String(days)}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                {SNOOZE_DAY_CHOICES.map((n) => (
                  <option key={n} value={String(n)}>
                    {t("adminRevenue.snooze.days", { count: n })}
                  </option>
                ))}
              </PlatformSelect>
            </div>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.snooze.intentionalHint")}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor={reasonId}>
              {t(
                reasonRequired
                  ? "adminRevenue.snooze.reason"
                  : "adminRevenue.snooze.reasonOptional",
              )}
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required={reasonRequired}
              aria-invalid={reasonError !== null || undefined}
              aria-describedby={reasonError ? `${hintId} ${errorId}` : hintId}
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span id={hintId}>
                {t("adminRevenue.snooze.reasonHint", {
                  min: REVENUE_LIMITS.snoozeReasonMin,
                  max: REVENUE_LIMITS.snoozeReasonMax,
                })}
              </span>
              <span aria-hidden="true" className={tooLong ? "text-destructive" : undefined}>
                {t("adminRevenue.snooze.reasonCount", {
                  value: trimmed,
                  max: REVENUE_LIMITS.snoozeReasonMax,
                })}
              </span>
            </div>
            {reasonError ? (
              <p id={errorId} className="m-0 text-xs text-destructive">
                {reasonError}
              </p>
            ) : null}
          </div>
          {error?.kind === "mfa" ? <MfaRequiredNotice /> : null}
          {error?.kind === "text" ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {error.text}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" className="h-8" onClick={() => onOpenChange(false)}>
            {t("adminRevenue.snooze.cancel")}
          </Button>
          <Button
            type="button"
            className="h-8"
            disabled={!reasonOk || snooze.isPending}
            onClick={() => void submit()}
          >
            {t("adminRevenue.snooze.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
