// Molekula: EDYTOR SZKICU dokumentu (faktura, proforma, korekta) w oknie.
//
// Organizator poprawia nabywce, daty, sposob platnosci i pozycje, widzi na
// zywo netto/VAT/brutto i podsumowanie stawek (lustro bazy
// `eventInvoiceMath`), a potem "Zapisz i wystaw". Zapis jest JAWNY - okno
// niczego nie zapisuje samo. Wystawienie pyta o potwierdzenie, bo po nim
// dokumentu nie da sie juz zmienic (tylko korekta) i dostaje on numer.
//
// ROZJAZD Z ZAMOWIENIAMI. Faktura z zamowien powinna sumowac sie do kwot
// tych zamowien; edytor ostrzega, gdy suma pozycji sie z nimi rozjezdza.
// Faktury za OPLACONE zamowienia baza nie wystawi z inna kwota niz wplaty
// (`amount_mismatch`, INV-14) - proforma i zamowienia nieoplacone moga sie
// roznic swiadomie.
//
// PODATEK (INV-12, INV-06). Sekcja "Podatek" pojawia sie przy pozycji "np"
// albo nabywcy-firmie spoza Polski: podstawa prawna (pusta = z ustawien),
// decyzja o odwrotnym obciazeniu i weryfikacja numeru VAT UE w VIES - wynik
// zapisuje serwer, panel tylko go pokazuje. Dokument w walucie obcej mowi,
// z ktorego dnia kurs NBP trafi na fakture; pobiera go wystawienie.
//
// KOREKTA. Podglad sum korekty liczy podatek od sum w stawce przed i po
// korekcie (`doc.rateGrossBefore`) - tak samo jak baza przy wystawieniu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";

import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { InvoiceBuyerFields } from "@/components/events/invoices/molecules/InvoiceBuyerFields";
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
import { confirmDialog } from "@/lib/appDialogs";
import { formatMoney } from "@/lib/billing/types";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import {
  LOCALE_LABEL_KEYS,
  PAYMENT_METHOD_LABEL_KEYS,
  VAT_RATE_LABEL_KEYS,
} from "@/lib/events/adminEventInvoiceLabels";
import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import {
  documentDraftFromDocument,
  documentDraftPreview,
  documentDraftToUpdate,
  draftNeedsTaxSection,
  draftReverseChargeEffective,
  hasDocumentErrors,
  isDocumentDraftDirty,
  lineDraftAmounts,
  newLineDraft,
  validateDocumentDraft,
  INVOICE_REVERSE_CHARGE_CHOICES,
  type InvoiceDocumentDraft,
  type InvoiceLineDraft,
} from "@/lib/events/eventInvoiceDraft";
import {
  EVENT_INVOICE_LOCALES,
  EVENT_INVOICE_PAYMENT_METHODS,
  pickEnum,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES } from "@/lib/events/eventInvoiceMath";
import { sourcesGrossCents, type IssuedInvoice } from "@/lib/events/eventInvoicesApi";
import { downloadEventInvoicePdf } from "@/lib/events/eventInvoicePdfLabels";
import {
  useEventInvoice,
  useIssueInvoice,
  useUpdateInvoiceDraft,
  useVerifyInvoiceVies,
} from "@/lib/events/useEventInvoices";
import { EU_COUNTRIES } from "@/lib/tracker/euCountries";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

export interface EventInvoiceDraftDialogProps {
  eventId: string;
  invoiceId: string | null;
  onClose: () => void;
  onIssued: (issued: IssuedInvoice) => void;
}

export function EventInvoiceDraftDialog({
  eventId,
  invoiceId,
  onClose,
  onIssued,
}: EventInvoiceDraftDialogProps) {
  ensureAdminEventInvoicesI18n();
  ensureEventInvoicesI18n();
  const { t } = useTranslation();
  const docQ = useEventInvoice(eventId, invoiceId);
  const doc = docQ.data;
  return (
    <Dialog open={invoiceId !== null} onOpenChange={onClose}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {doc?.kind === "correction"
              ? t("adminEventInvoices.draft.titleCorrection")
              : t("adminEventInvoices.draft.title")}
          </DialogTitle>
          <DialogDescription>{t("adminEventInvoices.draft.issueDateHint")}</DialogDescription>
        </DialogHeader>
        {docQ.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {adminEventInvoiceErrorMessage(docQ.error)}
          </p>
        ) : doc === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminEventInvoices.loading")}
          </p>
        ) : doc.status !== "draft" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminEventInvoices.draft.readOnly")}
          </p>
        ) : (
          <DraftEditor
            key={doc.id}
            eventId={eventId}
            doc={doc}
            onClose={onClose}
            onIssued={onIssued}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DraftEditor({
  eventId,
  doc,
  onClose,
  onIssued,
}: {
  eventId: string;
  doc: EventInvoiceDocument;
  onClose: () => void;
  onIssued: (issued: IssuedInvoice) => void;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateInvoiceDraft(eventId);
  const issue = useIssueInvoice(eventId);
  const vies = useVerifyInvoiceVies(eventId);
  const [initial, setInitial] = useState(() => documentDraftFromDocument(doc));
  const [draft, setDraft] = useState<InvoiceDocumentDraft>(initial);
  const [ordinal, setOrdinal] = useState(1);
  const [showErrors, setShowErrors] = useState(false);
  const errors = validateDocumentDraft(draft, doc.kind);
  const preview = documentDraftPreview(
    draft,
    doc.kind === "correction" ? doc.rateGrossBefore : undefined,
  );
  const money = (cents: number) => formatMoney(cents, doc.currency, i18n.language);
  const sourcesGross = sourcesGrossCents(doc);
  const mismatch =
    doc.kind !== "correction" &&
    doc.sources.length > 0 &&
    preview.totals.grossCents !== sourcesGross;
  const busy = update.isPending || issue.isPending || vies.isPending;
  const showTax = doc.kind !== "correction" && draftNeedsTaxSection(draft);
  const reverseCharge = draftReverseChargeEffective(draft);
  const euBuyer =
    draft.buyer.isCompany &&
    draft.buyer.country !== "PL" &&
    EU_COUNTRIES.some((country) => country.code === draft.buyer.country);

  function setLine(key: string, patch: Partial<InvoiceLineDraft>): void {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }

  async function persist(): Promise<boolean> {
    setShowErrors(true);
    if (hasDocumentErrors(errors)) {
      toast.error(t("adminEventInvoices.draft.errors.fix"));
      return false;
    }
    try {
      await update.mutateAsync(documentDraftToUpdate(doc.id, draft, doc.kind));
    } catch (failure: unknown) {
      toast.error(adminEventInvoiceErrorMessage(failure));
      return false;
    }
    setInitial(draft);
    return true;
  }

  async function save(): Promise<void> {
    if (await persist()) toast.success(t("adminEventInvoices.toasts.saved"));
  }

  async function verifyVies(): Promise<void> {
    // VIES pyta o nabywce ZAPISANEGO szkicu - niezapisana zmiana najpierw idzie do bazy.
    if (isDocumentDraftDirty(draft, initial) && !(await persist())) return;
    try {
      const result = await vies.mutateAsync(doc.id);
      if (result.valid) toast.success(t("adminEventInvoices.draft.tax.viesValid"));
      else toast.error(t("adminEventInvoices.draft.tax.viesInvalid"));
    } catch (failure: unknown) {
      toast.error(adminEventInvoiceErrorMessage(failure));
    }
  }

  async function issueNow(): Promise<void> {
    if (isDocumentDraftDirty(draft, initial) || hasDocumentErrors(errors)) {
      if (!(await persist())) return;
    }
    const confirmed = await confirmDialog({
      title: t("adminEventInvoices.documents.issueTitle"),
      description: t("adminEventInvoices.documents.issueBody"),
      confirmLabel: t("adminEventInvoices.documents.issue"),
      cancelLabel: t("adminEventInvoices.documents.keep"),
    });
    if (!confirmed) return;
    try {
      const issued = await issue.mutateAsync(doc.id);
      onIssued(issued);
      onClose();
    } catch (failure: unknown) {
      toast.error(adminEventInvoiceErrorMessage(failure));
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("adminEventInvoices.draft.buyerSection")}</h3>
        <InvoiceBuyerFields
          value={draft.buyer}
          onChange={(buyer) => setDraft((current) => ({ ...current, buyer }))}
          errors={errors.buyer}
          showErrors={showErrors}
          disabled={busy}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("adminEventInvoices.draft.datesSection")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminFormTextRow
            type="date"
            label={t("adminEventInvoices.draft.saleDate")}
            value={draft.saleDate}
            onValueChange={(saleDate) => setDraft((current) => ({ ...current, saleDate }))}
          />
          <AdminFormTextRow
            type="date"
            label={t("adminEventInvoices.draft.dueDate")}
            hint={t("adminEventInvoices.draft.dueDateHint")}
            value={draft.dueDate}
            onValueChange={(dueDate) => setDraft((current) => ({ ...current, dueDate }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor={`invoice-method-${doc.id}`}>
              {t("adminEventInvoices.draft.paymentMethod")}
            </Label>
            <FormSelect
              id={`invoice-method-${doc.id}`}
              value={draft.paymentMethod}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  paymentMethod: pickEnum(EVENT_INVOICE_PAYMENT_METHODS, value),
                }))
              }
              options={EVENT_INVOICE_PAYMENT_METHODS.map((method) => ({
                value: method,
                label: t(PAYMENT_METHOD_LABEL_KEYS[method]),
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`invoice-locale-${doc.id}`}>
              {t("adminEventInvoices.draft.locale")}
            </Label>
            <FormSelect
              id={`invoice-locale-${doc.id}`}
              value={draft.locale}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  locale: pickEnum(EVENT_INVOICE_LOCALES, value),
                }))
              }
              options={EVENT_INVOICE_LOCALES.map((locale) => ({
                value: locale,
                label: t(LOCALE_LABEL_KEYS[locale]),
              }))}
            />
          </div>
        </div>
        {doc.kind === "correction" ? (
          <AdminFormTextRow
            label={t("adminEventInvoices.draft.correctionReason")}
            value={draft.correctionReason}
            maxLength={500}
            onValueChange={(correctionReason) =>
              setDraft((current) => ({ ...current, correctionReason }))
            }
          />
        ) : null}
        <AdminFormTextRow
          label={t("adminEventInvoices.draft.note")}
          value={draft.note}
          rows={2}
          maxLength={1000}
          onValueChange={(note) => setDraft((current) => ({ ...current, note }))}
        />
      </section>

      {showTax ? (
        <TaxSection
          doc={doc}
          draft={draft}
          reverseCharge={reverseCharge}
          euBuyer={euBuyer}
          buyerDirty={JSON.stringify(draft.buyer) !== JSON.stringify(initial.buyer)}
          busy={busy}
          verifying={vies.isPending}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onVerify={() => void verifyVies()}
        />
      ) : null}
      {doc.fxNeed !== null ? (
        <p role="status" className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          {t(
            doc.fxNeed.loaded
              ? "adminEventInvoices.draft.fx.loaded"
              : "adminEventInvoices.draft.fx.pending",
            { currency: doc.fxNeed.currency, date: doc.fxNeed.rateDate },
          )}
        </p>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("adminEventInvoices.draft.linesSection")}</h3>
        <ol className="space-y-3">
          {draft.lines.map((line, index) => (
            <LineEditor
              key={line.key}
              line={line}
              position={index + 1}
              error={showErrors ? errors.lines[line.key] : undefined}
              gross={lineDraftAmounts(line)?.grossCents ?? null}
              money={money}
              disabled={busy}
              onChange={(patch) => setLine(line.key, patch)}
              onRemove={() =>
                setDraft((current) => ({
                  ...current,
                  lines: current.lines.filter((item) => item.key !== line.key),
                }))
              }
            />
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDraft((current) => ({
              ...current,
              lines: [
                ...current.lines,
                newLineDraft(ordinal, current.lines[0]?.vatRate ?? "23", current.locale),
              ],
            }));
            setOrdinal((value) => value + 1);
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("adminEventInvoices.draft.addLine")}
        </Button>
        {showErrors && errors.document !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {t(errors.document)}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">{t("adminEventInvoices.draft.vatSummary")}</h3>
          <ul className="mt-2 space-y-1 text-sm tabular-nums">
            {preview.summary.map((row) => (
              <li key={row.vatRate} className="flex justify-between gap-3">
                <span>{t(VAT_RATE_LABEL_KEYS[row.vatRate])}</span>
                <span>
                  {money(row.netCents)} + {money(row.vatCents)} = {money(row.grossCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid grid-cols-2 gap-1 text-sm tabular-nums">
          <dt>{t("adminEventInvoices.draft.totals.net")}</dt>
          <dd className="text-right">{money(preview.totals.netCents)}</dd>
          <dt>{t("adminEventInvoices.draft.totals.vat")}</dt>
          <dd className="text-right">{money(preview.totals.vatCents)}</dd>
          <dt className="font-semibold">{t("adminEventInvoices.draft.totals.gross")}</dt>
          <dd className="text-right font-semibold">{money(preview.totals.grossCents)}</dd>
        </dl>
      </section>
      {mismatch ? (
        <p role="status" className="rounded-md border border-brand/50 bg-brand/10 p-3 text-sm">
          {t("adminEventInvoices.draft.sourcesMismatch", {
            lines: money(preview.totals.grossCents),
            sources: money(sourcesGross),
          })}
        </p>
      ) : null}

      <DialogFooter className="flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={() => downloadEventInvoicePdf(doc)}>
          {t("adminEventInvoices.draft.preview")}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("adminEventInvoices.draft.close")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
          {update.isPending
            ? t("adminEventInvoices.draft.saving")
            : t("adminEventInvoices.draft.save")}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void issueNow()}>
          {issue.isPending
            ? t("adminEventInvoices.draft.issuing")
            : t("adminEventInvoices.draft.issue")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function TaxSection({
  doc,
  draft,
  reverseCharge,
  euBuyer,
  buyerDirty,
  busy,
  verifying,
  onChange,
  onVerify,
}: {
  doc: EventInvoiceDocument;
  draft: InvoiceDocumentDraft;
  reverseCharge: boolean;
  euBuyer: boolean;
  buyerDirty: boolean;
  busy: boolean;
  verifying: boolean;
  onChange: (patch: Partial<InvoiceDocumentDraft>) => void;
  onVerify: () => void;
}) {
  const { t, i18n } = useTranslation();
  const hasNp = draft.lines.some((line) => line.vatRate === "np");
  const settingsBasis = doc.npBasis.trim() === "" ? doc.npBasisEffective : "";
  // Wynik VIES dotyczy nabywcy ZAPISANEGO szkicu; zmiana danych nabywcy
  // uniewaznia go w bazie przy zapisie.
  const viesResult = buyerDirty ? null : doc.buyerVies;
  const checkedAt =
    viesResult === null ? "" : new Date(viesResult.checkedAt).toLocaleString(i18n.language);
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t("adminEventInvoices.draft.tax.section")}</h3>
      <AdminFormTextRow
        label={t("adminEventInvoices.draft.tax.npBasis")}
        hint={
          settingsBasis === ""
            ? t("adminEventInvoices.draft.tax.npBasisHint")
            : t("adminEventInvoices.draft.tax.npBasisFromSettings", { basis: settingsBasis })
        }
        value={draft.npBasis}
        maxLength={300}
        disabled={busy}
        onValueChange={(npBasis) => onChange({ npBasis })}
      />
      {hasNp && draft.npBasis.trim() === "" && settingsBasis === "" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("adminEventInvoices.errors.vatNpBasisRequired")}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`invoice-reverse-charge-${doc.id}`}>
          {t("adminEventInvoices.draft.tax.reverseCharge")}
        </Label>
        <FormSelect
          id={`invoice-reverse-charge-${doc.id}`}
          value={draft.reverseCharge}
          disabled={busy}
          onValueChange={(value) =>
            onChange({ reverseCharge: pickEnum(INVOICE_REVERSE_CHARGE_CHOICES, value) })
          }
          options={INVOICE_REVERSE_CHARGE_CHOICES.map((choice) => ({
            value: choice,
            label: t(REVERSE_CHARGE_LABEL_KEYS[choice]),
          }))}
        />
        <p className="text-xs text-muted-foreground">
          {reverseCharge
            ? t("adminEventInvoices.draft.tax.reverseChargeOn")
            : t("adminEventInvoices.draft.tax.reverseChargeOff")}
        </p>
      </div>
      {reverseCharge && euBuyer ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || draft.buyer.taxId.trim() === ""}
            onClick={onVerify}
          >
            <ShieldCheck className="mr-1 h-4 w-4" aria-hidden="true" />
            {verifying
              ? t("adminEventInvoices.draft.tax.viesChecking")
              : t("adminEventInvoices.draft.tax.viesVerify")}
          </Button>
          <p role="status" className="min-w-0 flex-1">
            {viesResult === null
              ? t("adminEventInvoices.draft.tax.viesNone")
              : viesResult.valid
                ? t("adminEventInvoices.draft.tax.viesStatusValid", {
                    subject: viesResult.subject,
                    at: checkedAt,
                    request: viesResult.requestId ?? "-",
                  })
                : t("adminEventInvoices.draft.tax.viesStatusInvalid", {
                    subject: viesResult.subject,
                    at: checkedAt,
                  })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

const REVERSE_CHARGE_LABEL_KEYS = {
  auto: "adminEventInvoices.draft.tax.reverseChargeAuto",
  yes: "adminEventInvoices.draft.tax.reverseChargeYes",
  no: "adminEventInvoices.draft.tax.reverseChargeNo",
} as const;

function LineEditor({
  line,
  position,
  error,
  gross,
  money,
  disabled,
  onChange,
  onRemove,
}: {
  line: InvoiceLineDraft;
  position: number;
  error: string | undefined;
  gross: number | null;
  money: (cents: number) => string;
  disabled: boolean;
  onChange: (patch: Partial<InvoiceLineDraft>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const base = `invoice-line-${line.key}`;
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_8rem_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor={`${base}-description`}>
            {t("adminEventInvoices.draft.line.description")}
          </Label>
          <Input
            id={`${base}-description`}
            value={line.description}
            maxLength={300}
            disabled={disabled}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${base}-unit`}>{t("adminEventInvoices.draft.line.unit")}</Label>
          <Input
            id={`${base}-unit`}
            value={line.unit}
            maxLength={20}
            disabled={disabled}
            onChange={(event) => onChange({ unit: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${base}-quantity`}>{t("adminEventInvoices.draft.line.quantity")}</Label>
          <Input
            id={`${base}-quantity`}
            value={line.quantity}
            inputMode="numeric"
            disabled={disabled}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${base}-price`}>{t("adminEventInvoices.draft.line.unitGross")}</Label>
          <Input
            id={`${base}-price`}
            value={line.unitGross}
            inputMode="decimal"
            disabled={disabled}
            onChange={(event) => onChange({ unitGross: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${base}-rate`}>{t("adminEventInvoices.draft.line.vatRate")}</Label>
          <FormSelect
            id={`${base}-rate`}
            value={line.vatRate}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({ vatRate: pickEnum(EVENT_INVOICE_VAT_RATES, value) })
            }
            options={EVENT_INVOICE_VAT_RATES.map((rate) => ({
              value: rate,
              label: t(VAT_RATE_LABEL_KEYS[rate]),
            }))}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t("adminEventInvoices.draft.removeLine", { position })}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {t("adminEventInvoices.draft.line.gross")}: {gross === null ? "-" : money(gross)}
      </p>
      {error === undefined ? null : (
        <p role="alert" className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
    </li>
  );
}
