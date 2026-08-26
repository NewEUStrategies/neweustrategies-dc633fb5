// Molekula: formularz jednego PRZYPIECIA firmy do wydarzenia.
//
// FIRMA WYBIERANA Z CRM, NIE WPISYWANA. Przypiecie wskazuje `crm_companies.id`,
// wiec pole tekstowe „nazwa firmy" tworzyloby duplikaty poza CRM-em. Szukamy
// przez `admin_event_sponsor_companies_search`, ktore od razu mowi, czy firma
// jest juz przypieta.
//
// FIRMA JEST NIEZMIENNA PO ZAPISIE. RPC zapisu nie czyta `company_id` przy
// edycji - „przepniecie" to odpiecie i nowe przypiecie, a nie podmiana pola.
//
// MIGAWKA JEST EDYTOWALNA SWIADOMIE. To ona jedzie na strone publiczna; wpisana
// recznie przestaje byc nadpisywana odswiezaniem z CRM-u.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import { useSponsorCompanySearch } from "@/lib/events/useEventSponsors";
import {
  SPONSOR_MAX_DESCRIPTION,
  SPONSOR_MAX_NAME,
  SPONSOR_MAX_NOTE,
  emptySponsorDraft,
  sponsorDraftFromRow,
  sponsorDraftToInput,
  validateSponsorDraft,
  type SponsorDraft,
} from "@/lib/events/sponsorDraft";
import {
  SPONSOR_ROLES,
  type EventSponsorRow,
  type EventSponsorTierRow,
  type SponsorInput,
  type SponsorRole,
} from "@/lib/events/sponsorsApi";

const TIER_NONE = "__none__";

interface EventSponsorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowe przypiecie. */
  sponsor: EventSponsorRow | null;
  tiers: EventSponsorTierRow[];
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: SponsorInput) => void;
}

export function EventSponsorDialog({
  open,
  onOpenChange,
  eventId,
  sponsor,
  tiers,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventSponsorDialogProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith("en");
  const [draft, setDraft] = useState<SponsorDraft>(() => emptySponsorDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");

  const isNew = draft.id === null;
  const companiesQ = useSponsorCompanySearch(eventId, companyQuery, open && isNew);

  useEffect(() => {
    if (!open) return;
    setDraft(sponsor === null ? emptySponsorDraft(nextSortOrder) : sponsorDraftFromRow(sponsor));
    setTouched(false);
    setCompanyQuery("");
  }, [open, sponsor, nextSortOrder]);

  const errors = validateSponsorDraft(draft);
  const errorFor = (field: keyof SponsorDraft): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };

  const set = <K extends keyof SponsorDraft>(key: K, value: SponsorDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(sponsorDraftToInput(draft, eventId));
  };

  // Radix Select ODRZUCA pusty string jako wartosc pozycji (rzuca wyjatkiem i
  // cale okno przestaje sie renderowac - stad „dodawanie firm nie dziala").
  // Brak poziomu ma wiec wlasny znacznik, tlumaczony na "" w szkicu.
  const tierOptions = useMemo(
    () => [
      { value: TIER_NONE, label: t("adminEventSponsors.sponsors.dialog.tierNone") },
      ...tiers.map((tier) => ({
        value: tier.id,
        label: isEn ? tier.name_en || tier.name_pl : tier.name_pl || tier.name_en,
      })),
    ],
    [tiers, isEn, t],
  );

  const companies = companiesQ.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventSponsors.sponsors.dialog.createTitle"
                : "adminEventSponsors.sponsors.dialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventSponsors.sponsors.subtitle")}</DialogDescription>
        </DialogHeader>

        {isNew ? (
          <AdminFormSection title={t("adminEventSponsors.sponsors.dialog.company")}>
            <div className="space-y-2">
              <Label htmlFor="sponsor-company-search">
                {t("adminEventSponsors.sponsors.companySearch")}
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="sponsor-company-search"
                  className="pl-9"
                  value={companyQuery}
                  onChange={(event) => setCompanyQuery(event.target.value)}
                  placeholder={t("adminEventSponsors.filters.search")}
                />
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("adminEventSponsors.sponsors.companySearchHint")}
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/70 p-1">
                {companies.length === 0 ? (
                  <li className="p-2 text-sm text-muted-foreground">
                    {t("adminEventSponsors.sponsors.noCompanies")}
                  </li>
                ) : (
                  companies.map((company) => {
                    const selected = draft.companyId === company.id;
                    return (
                      <li key={company.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((previous) => ({
                              ...previous,
                              companyId: company.id,
                              companyLabel: company.name,
                              snapshotName:
                                previous.snapshotName.trim() === ""
                                  ? company.name
                                  : previous.snapshotName,
                              snapshotLogoUrl: previous.snapshotLogoUrl || (company.logo_url ?? ""),
                              snapshotWebsite: previous.snapshotWebsite || (company.website ?? ""),
                              snapshotCountry: previous.snapshotCountry || (company.country ?? ""),
                            }))
                          }
                          className={
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors " +
                            (selected ? "bg-primary/10" : "hover:bg-muted")
                          }
                        >
                          {selected ? (
                            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">{company.name}</span>
                          {company.domain === null ? null : (
                            <span className="truncate font-medium tracking-tight text-xs text-muted-foreground">
                              {company.domain}
                            </span>
                          )}
                          {company.is_pinned ? (
                            <Badge variant="secondary">
                              {t("adminEventSponsors.sponsors.companyPinned")}
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {errorFor("companyId") === null ? null : (
                <p className="text-xs text-destructive" role="alert">
                  {errorFor("companyId")}
                </p>
              )}
            </div>
          </AdminFormSection>
        ) : (
          <p className="text-sm text-muted-foreground">
            {`${t("adminEventSponsors.sponsors.dialog.company")}: ${draft.companyLabel}`}
          </p>
        )}

        <AdminFormSection title={t("adminEventSponsors.sponsors.title")} columns={2}>
          <div className="space-y-1.5">
            <Label htmlFor="sponsor-tier">{t("adminEventSponsors.sponsors.dialog.tier")}</Label>
            <FormSelect
              id="sponsor-tier"
              value={draft.tierId === "" ? TIER_NONE : draft.tierId}
              options={tierOptions}
              aria-label={t("adminEventSponsors.sponsors.dialog.tier")}
              onValueChange={(value) => set("tierId", value === TIER_NONE ? "" : value)}
            />
            {errorFor("tierId") === null ? null : (
              <p className="text-xs text-destructive" role="alert">
                {errorFor("tierId")}
              </p>
            )}
          </div>
          <AdminFormEnumRow<SponsorRole>
            label={t("adminEventSponsors.sponsors.dialog.role")}
            value={draft.role}
            options={SPONSOR_ROLES}
            labelFor={(option) => t(`adminEventSponsors.roles.${option}`)}
            onValueChange={(value) => set("role", value)}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.booth")}
            value={draft.boothLabel}
            onValueChange={(value) => set("boothLabel", value)}
            maxLength={80}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.sortOrder")}
            value={draft.sortOrder}
            onValueChange={(value) => set("sortOrder", value)}
            inputMode="numeric"
            error={errorFor("sortOrder")}
          />
          <AdminFormSwitchRow
            label={t("adminEventSponsors.sponsors.dialog.isPublished")}
            checked={draft.isPublished}
            onCheckedChange={(value) => set("isPublished", value)}
          />
        </AdminFormSection>

        <AdminFormSection title={t("adminEventSponsors.labels.snapshotManual")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotName")}
            value={draft.snapshotName}
            onValueChange={(value) => set("snapshotName", value)}
            maxLength={SPONSOR_MAX_NAME}
            error={errorFor("snapshotName")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotCountry")}
            value={draft.snapshotCountry}
            onValueChange={(value) => set("snapshotCountry", value)}
            maxLength={80}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotWebsite")}
            value={draft.snapshotWebsite}
            onValueChange={(value) => set("snapshotWebsite", value)}
            placeholder="https://"
            error={errorFor("snapshotWebsite")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotLogoUrl")}
            value={draft.snapshotLogoUrl}
            onValueChange={(value) => set("snapshotLogoUrl", value)}
            placeholder="https://"
            error={errorFor("snapshotLogoUrl")}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotDescriptionPl")}
            value={draft.snapshotDescriptionPl}
            onValueChange={(value) => set("snapshotDescriptionPl", value)}
            maxLength={SPONSOR_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            label={t("adminEventSponsors.sponsors.dialog.snapshotDescriptionEn")}
            value={draft.snapshotDescriptionEn}
            onValueChange={(value) => set("snapshotDescriptionEn", value)}
            maxLength={SPONSOR_MAX_DESCRIPTION}
            rows={3}
          />
          <AdminFormTextRow
            className="sm:col-span-2"
            label={t("adminEventSponsors.sponsors.dialog.internalNote")}
            value={draft.internalNote}
            onValueChange={(value) => set("internalNote", value)}
            maxLength={SPONSOR_MAX_NOTE}
            rows={2}
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSponsors.sponsors.dialog.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSponsors.sponsors.dialog.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
