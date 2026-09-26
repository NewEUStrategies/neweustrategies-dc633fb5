// Molekula: STAN WYBRANYCH MIEJSC - wolne, zablokowane albo zarezerwowane.
//
// BLOKADA wylacza miejsca z przydzialu (filar, kamera, wyjscie ewakuacyjne).
// Zajetego miejsca nie da sie zablokowac bez jawnego "zwolnij osoby" - baza
// odrzuca to kodem `seat_assigned`, a my pokazujemy przelacznik tylko wtedy,
// gdy w zaznaczeniu naprawde ktos siedzi.
//
// REZERWACJA (CRM). Miejsca trzymamy dla FIRMY z kartoteki CRM (stol partnera,
// rzad delegacji), dla SPONSORA wydarzenia (czyli jego firmy) albo dla
// ZAMOWIENIA PAKIETOWEGO. Osoby tej firmy/pakietu siadaja od razu, inne tylko
// po swiadomym obejsciu. Wyszukiwarka firm to istniejace, bramkowane
// `admin_event_sponsor_companies_search` - nie budujemy drugiego rejestru firm.
//
// LISTY SPONSOROW I ZAMOWIEN LADUJA SIE DOPIERO PO WYBORZE CELU (osobne
// podkomponenty montowane warunkowo), zeby otwarcie dialogu blokady nie
// ciagnelo trzech list, z ktorych zadna nie jest potrzebna.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
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
import { SEAT_STATUSES, type SeatStatus, type SeatsUpdateInput } from "@/lib/events/seatingApi";
import {
  HOLD_TARGETS,
  SEAT_NOTE_MAX,
  SEAT_STATUS_LABEL_KEYS,
  emptyHoldDraft,
  holdDraftToInput,
  validateHoldDraft,
  type HoldDraft,
  type HoldField,
  type HoldTarget,
} from "@/lib/events/seatingDraft";
import { usePackageOrders } from "@/lib/events/useEventPackages";
import { useSponsorCompanySearch, useSponsors } from "@/lib/events/useEventSponsors";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

const TARGET_LABEL_KEYS: Record<HoldTarget, string> = {
  company: "adminEventSeating.holdDialog.targets.company",
  sponsor: "adminEventSeating.holdDialog.targets.sponsor",
  package: "adminEventSeating.holdDialog.targets.package",
  note: "adminEventSeating.holdDialog.targets.note",
};

const NONE = "__none__";

function CompanyPicker({
  eventId,
  value,
  onChange,
}: {
  eventId: string;
  value: string | null;
  onChange: (companyId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const companies = useSponsorCompanySearch(eventId, q);
  const rows = companies.data ?? [];
  return (
    <div className="space-y-2">
      <Label htmlFor="seat-hold-company-q">{t("adminEventSeating.holdDialog.companySearch")}</Label>
      <Input
        id="seat-hold-company-q"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={t("adminEventSeating.holdDialog.companySearch")}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("adminEventSeating.holdDialog.companyNone")}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="seat-hold-company">{t("adminEventSeating.holdDialog.company")}</Label>
          <FormSelect
            id="seat-hold-company"
            value={value ?? NONE}
            options={[
              { value: NONE, label: t("adminEventSeating.holdDialog.company") },
              ...rows.map((row) => ({ value: row.id, label: row.name })),
            ]}
            onValueChange={(next) => onChange(next === NONE ? null : next)}
          />
        </div>
      )}
    </div>
  );
}

function SponsorPicker({
  eventId,
  value,
  onChange,
}: {
  eventId: string;
  value: string | null;
  onChange: (sponsorId: string | null) => void;
}) {
  const { t } = useTranslation();
  const sponsors = useSponsors({ eventId });
  const rows = sponsors.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("adminEventSeating.holdDialog.sponsorNone")}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="seat-hold-sponsor">{t("adminEventSeating.holdDialog.sponsor")}</Label>
      <FormSelect
        id="seat-hold-sponsor"
        value={value ?? NONE}
        options={[
          { value: NONE, label: t("adminEventSeating.holdDialog.sponsor") },
          ...rows.map((row) => ({ value: row.id, label: row.snapshot_name })),
        ]}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
      />
    </div>
  );
}

function PackagePicker({
  eventId,
  value,
  onChange,
}: {
  eventId: string;
  value: string | null;
  onChange: (orderId: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const orders = usePackageOrders(eventId, null);
  const rows = orders.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("adminEventSeating.holdDialog.packageNone")}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="seat-hold-package">{t("adminEventSeating.holdDialog.package")}</Label>
      <FormSelect
        id="seat-hold-package"
        value={value ?? NONE}
        options={[
          { value: NONE, label: t("adminEventSeating.holdDialog.package") },
          ...rows.map((row) => ({
            value: row.id,
            label: t("adminEventSeating.holdDialog.packageOption", {
              buyer: row.buyer_name,
              package: pickLocalized(row, "package_name", lang),
            }),
          })),
        ]}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
      />
    </div>
  );
}

export interface SeatHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  mapId: string;
  seatIds: readonly string[];
  /** Ile z zaznaczonych miejsc jest zajetych - od tego zalezy przelacznik zwolnienia. */
  occupiedCount: number;
  initialStatus: SeatStatus;
  isSaving: boolean;
  onSubmit: (input: SeatsUpdateInput) => void;
}

export function SeatHoldDialog({
  open,
  onOpenChange,
  eventId,
  mapId,
  seatIds,
  occupiedCount,
  initialStatus,
  isSaving,
  onSubmit,
}: SeatHoldDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<HoldDraft>(() => emptyHoldDraft(initialStatus));
  const [touched, setTouched] = useState(false);
  const statusRef = useRef(initialStatus);
  statusRef.current = initialStatus;

  useEffect(() => {
    if (!open) return;
    setDraft(emptyHoldDraft(statusRef.current));
    setTouched(false);
  }, [open]);

  const errors = validateHoldDraft(draft);
  const errorFor = (field: HoldField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };
  const set = <K extends keyof HoldDraft>(key: K, value: HoldDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(holdDraftToInput(draft, mapId, seatIds));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("adminEventSeating.holdDialog.title")}</DialogTitle>
          <DialogDescription>{t("adminEventSeating.holdDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm font-medium">
            {t("adminEventSeating.workspace.selectionCount", { count: seatIds.length })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="seat-hold-status">{t("adminEventSeating.holdDialog.status")}</Label>
            <FormSelect
              id="seat-hold-status"
              value={draft.status}
              options={SEAT_STATUSES.map((value) => ({
                value,
                label: t(SEAT_STATUS_LABEL_KEYS[value]),
              }))}
              onValueChange={(value) => set("status", value as SeatStatus)}
            />
          </div>

          {draft.status === "blocked" ? (
            <>
              <AdminFormTextRow
                label={t("adminEventSeating.holdDialog.blockReason")}
                value={draft.blockReason}
                onValueChange={(value) => set("blockReason", value)}
                maxLength={SEAT_NOTE_MAX}
                error={errorFor("blockReason")}
              />
              {occupiedCount === 0 ? null : (
                <AdminFormSwitchRow
                  label={t("adminEventSeating.holdDialog.release")}
                  hint={t("adminEventSeating.holdDialog.releaseHint")}
                  checked={draft.release}
                  onCheckedChange={(value) => set("release", value)}
                />
              )}
            </>
          ) : null}

          {draft.status === "held" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="seat-hold-target">{t("adminEventSeating.holdDialog.target")}</Label>
                <FormSelect
                  id="seat-hold-target"
                  value={draft.target}
                  options={HOLD_TARGETS.map((value) => ({
                    value,
                    label: t(TARGET_LABEL_KEYS[value]),
                  }))}
                  onValueChange={(value) => set("target", value as HoldTarget)}
                  error={errorFor("target")}
                />
              </div>
              {draft.target === "company" ? (
                <CompanyPicker
                  eventId={eventId}
                  value={draft.companyId}
                  onChange={(value) => set("companyId", value)}
                />
              ) : null}
              {draft.target === "sponsor" ? (
                <SponsorPicker
                  eventId={eventId}
                  value={draft.sponsorId}
                  onChange={(value) => set("sponsorId", value)}
                />
              ) : null}
              {draft.target === "package" ? (
                <PackagePicker
                  eventId={eventId}
                  value={draft.packageOrderId}
                  onChange={(value) => set("packageOrderId", value)}
                />
              ) : null}
              <AdminFormTextRow
                label={t("adminEventSeating.holdDialog.note")}
                hint={t("adminEventSeating.holdDialog.noteHint")}
                value={draft.note}
                onValueChange={(value) => set("note", value)}
                maxLength={SEAT_NOTE_MAX}
                error={errorFor("note")}
              />
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSeating.holdDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSeating.holdDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
