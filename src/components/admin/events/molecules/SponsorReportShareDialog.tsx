// Molekuła: okno „Udostępnij raport sponsorowi" - wydanie linku bez logowania.
//
// TOKEN WIDAĆ RAZ. Baza oddaje jawny token wyłącznie w odpowiedzi na wydanie
// i trzyma tylko jego skrót. Okno pokazuje pełny link w polu tylko do odczytu
// z przyciskiem kopiowania i mówi wprost, że później zobaczymy już tylko jego
// początek. Zamknięcie okna zapomina token (stan komponentu), a do cache
// zapytań token nie trafia nigdy - wydanie jest mutacją.
//
// ZEGAR Z CHWILI OTWARCIA. Domyślna ważność i granice pola daty liczą się od
// chwili otwarcia okna (efekt), nie od `Date.now()` w renderze.
//
// KONTAKTY SĄ DOMYŚLNIE WYŁĄCZONE. Przełącznik mówi, co dokładnie wyjdzie poza
// system: kontakt tylko przy zgodzie na przekazanie partnerowi, a pozostałe
// wiersze bez danych osobowych.
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FormSelect } from "@/components/atoms/FormSelect";
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
import { Switch } from "@/components/ui/switch";
import { adminSponsorReportErrorMessage } from "@/lib/events/adminSponsorReportErrors";
import {
  defaultSponsorLinkDraft,
  sponsorLinkExpiryBounds,
  sponsorLinkInput,
  validateSponsorLinkDraft,
  type SponsorLinkDraft,
  type SponsorLinkField,
} from "@/lib/events/sponsorReportDraft";
import { sponsorReportLinkUrl } from "@/lib/events/sponsorReportLink";
import { useIssueSponsorReportLink } from "@/lib/events/useSponsorReport";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";
import type { SponsorOption } from "@/components/admin/events/molecules/SponsorReportFiltersBar";

export function SponsorReportShareDialog({
  open,
  onOpenChange,
  eventId,
  eventSlug,
  eventEndsAt,
  sponsors,
  sponsorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventSlug: string;
  eventEndsAt: string | null;
  sponsors: readonly SponsorOption[];
  /** Sponsor wybrany z wiersza tabeli ("" = do wyboru w oknie). */
  sponsorId: string;
}) {
  ensureSponsorReportI18n();
  const { t } = useTranslation();
  const baseId = useId();
  const issue = useIssueSponsorReportLink(eventId);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [draft, setDraft] = useState<SponsorLinkDraft | null>(null);
  const [errors, setErrors] = useState<SponsorLinkField[]>([]);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    setNowMs(now);
    setDraft(defaultSponsorLinkDraft(sponsorId, eventEndsAt, now));
    setErrors([]);
    setLink(null);
  }, [open, sponsorId, eventEndsAt]);

  const close = () => onOpenChange(false);
  const bounds = nowMs === null ? null : sponsorLinkExpiryBounds(nowMs);
  const invalid = (field: SponsorLinkField) => errors.includes(field);
  const errorId = (field: SponsorLinkField) => `${baseId}-${field}-error`;

  const submit = () => {
    if (draft === null || nowMs === null) return;
    const found = validateSponsorLinkDraft(draft, nowMs);
    setErrors(found);
    if (found.length > 0) return;
    issue.mutate(sponsorLinkInput(draft, nowMs), {
      onSuccess: (issued) => {
        setLink(sponsorReportLinkUrl(window.location.origin, eventSlug, issued.token));
        toast.success(t("adminEventSponsorReport.share.created"));
      },
      onError: (error) => toast.error(adminSponsorReportErrorMessage(error)),
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link ?? "");
      toast.success(t("adminEventSponsorReport.share.copied"));
    } catch {
      toast.error(t("adminEventSponsorReport.share.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventSponsorReport.share.title")}</DialogTitle>
          <DialogDescription>{t("adminEventSponsorReport.share.description")}</DialogDescription>
        </DialogHeader>

        {link !== null ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground" role="status">
              {t("adminEventSponsorReport.share.tokenOnce")}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-link`}>
                {t("adminEventSponsorReport.share.linkLabel")}
              </Label>
              <Input
                id={`${baseId}-link`}
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => void copy()}>
                {t("adminEventSponsorReport.share.copy")}
              </Button>
              <Button type="button" onClick={close}>
                {t("adminEventSponsorReport.share.done")}
              </Button>
            </DialogFooter>
          </div>
        ) : draft === null || bounds === null ? null : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-sponsor`}>
                {t("adminEventSponsorReport.share.sponsor")}
              </Label>
              <FormSelect
                id={`${baseId}-sponsor`}
                value={draft.sponsorId}
                placeholder={t("adminEventSponsorReport.share.sponsorPlaceholder")}
                error={
                  invalid("sponsorId")
                    ? t("adminEventSponsorReport.share.invalidSponsor")
                    : undefined
                }
                onValueChange={(value) => setDraft({ ...draft, sponsorId: value })}
                options={sponsors.map((sponsor) => ({ value: sponsor.id, label: sponsor.name }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-label`}>{t("adminEventSponsorReport.share.label")}</Label>
              <Input
                id={`${baseId}-label`}
                value={draft.label}
                maxLength={120}
                aria-invalid={invalid("label") || undefined}
                aria-describedby={invalid("label") ? errorId("label") : `${baseId}-label-hint`}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              />
              {invalid("label") ? (
                <p id={errorId("label")} className="text-xs text-destructive">
                  {t("adminEventSponsorReport.share.invalidLabel")}
                </p>
              ) : (
                <p id={`${baseId}-label-hint`} className="text-xs text-muted-foreground">
                  {t("adminEventSponsorReport.share.labelHint")}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${baseId}-expires`}>
                {t("adminEventSponsorReport.share.expiresOn")}
              </Label>
              <Input
                id={`${baseId}-expires`}
                type="date"
                min={bounds.min}
                max={bounds.max}
                value={draft.expiresOn}
                aria-invalid={invalid("expiresOn") || undefined}
                aria-describedby={
                  invalid("expiresOn") ? errorId("expiresOn") : `${baseId}-expires-hint`
                }
                onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })}
              />
              {invalid("expiresOn") ? (
                <p id={errorId("expiresOn")} className="text-xs text-destructive">
                  {t("adminEventSponsorReport.share.invalidExpires")}
                </p>
              ) : (
                <p id={`${baseId}-expires-hint`} className="text-xs text-muted-foreground">
                  {t("adminEventSponsorReport.share.expiresHint")}
                </p>
              )}
            </div>
            <div className="flex items-start gap-3 rounded-[6px] border border-border p-3">
              <Switch
                id={`${baseId}-leads`}
                checked={draft.includeLeads}
                aria-describedby={`${baseId}-leads-hint`}
                onCheckedChange={(includeLeads) => setDraft({ ...draft, includeLeads })}
              />
              <div className="space-y-1">
                <Label htmlFor={`${baseId}-leads`}>
                  {t("adminEventSponsorReport.share.includeLeads")}
                </Label>
                <p id={`${baseId}-leads-hint`} className="text-xs text-muted-foreground">
                  {t("adminEventSponsorReport.share.includeLeadsHint")}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("adminEventSponsorReport.share.cancel")}
              </Button>
              <Button type="submit" disabled={issue.isPending}>
                {issue.isPending
                  ? t("adminEventSponsorReport.share.issuing")
                  : t("adminEventSponsorReport.share.issue")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
