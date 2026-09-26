// Molekula: formularz KATEGORII MIEJSC (VIP, Prasa) z lista dozwolonych biletow.
//
// KLUCZ NIEZMIENNY PO ZAPISIE (jak klucz sciezki agendy) - pole jest wtedy
// zablokowane, a nie "po cichu ignorowane".
//
// KOLOR MUSI BYC WIDOCZNY NA OBU TLACH PLANU. Kategoria rysuje obrys i wypelnienie
// miejsca, wiec kolor zlewajacy sie z plyta jasna albo ciemna robi z miejsca
// niewidzialne kolko. Ostrzegamy wspolczynnikiem kontrastu z `lib/charts/palette`
// (ten sam, ktorego uzywa silnik wykresow) - ostrzezenie nie blokuje zapisu,
// bo kolor bywa firmowy i organizator moze go swiadomie zostawic.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { CHART_PLATE, contrastRatio } from "@/lib/charts/palette";
import type { SeatCategory, SeatCategoryInput } from "@/lib/events/seatingApi";
import {
  SEAT_CATEGORY_NAME_MAX,
  SEAT_COLOR_PATTERN,
  categoryDraftFromCategory,
  categoryDraftToInput,
  emptyCategoryDraft,
  validateCategoryDraft,
  type CategoryDraft,
  type CategoryField,
} from "@/lib/events/seatingDraft";
import { useEventTickets } from "@/lib/events/useEventRegistrations";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

/** Kolor startowy nowej kategorii - czytelny na plycie jasnej i ciemnej. */
export const DEFAULT_CATEGORY_COLOR = "#2563EB";

/** Minimalny kontrast obiektu graficznego z tlem (WCAG 1.4.11). */
export const CATEGORY_MIN_CONTRAST = 3;

/** Najslabszy kontrast koloru z obiema plytami planu albo `null` dla zlego formatu. */
export function weakestPlateContrast(color: string): number | null {
  if (!SEAT_COLOR_PATTERN.test(color)) return null;
  return Math.min(contrastRatio(color, CHART_PLATE.light), contrastRatio(color, CHART_PLATE.dark));
}

export interface EventSeatCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowa kategoria. */
  category: SeatCategory | null;
  isSaving: boolean;
  onSubmit: (input: SeatCategoryInput) => void;
}

export function EventSeatCategoryDialog({
  open,
  onOpenChange,
  eventId,
  category,
  isSaving,
  onSubmit,
}: EventSeatCategoryDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<CategoryDraft>(() => emptyCategoryDraft(DEFAULT_CATEGORY_COLOR));
  const [touched, setTouched] = useState(false);
  const tickets = useEventTickets(open ? eventId : null);

  const categoryRef = useRef(category);
  categoryRef.current = category;
  const categoryId = category === null ? null : category.id;

  useEffect(() => {
    if (!open) return;
    const current = categoryRef.current;
    setDraft(
      current === null ? emptyCategoryDraft(DEFAULT_CATEGORY_COLOR) : categoryDraftFromCategory(current),
    );
    setTouched(false);
  }, [open, categoryId]);

  const errors = validateCategoryDraft(draft);
  const errorFor = (field: CategoryField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };
  const set = <K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const toggleTicket = (ticketId: string, checked: boolean) =>
    setDraft((previous) => ({
      ...previous,
      ticketTypeIds: checked
        ? [...previous.ticketTypeIds, ticketId]
        : previous.ticketTypeIds.filter((id) => id !== ticketId),
    }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(categoryDraftToInput(draft, eventId));
  };

  const contrast = weakestPlateContrast(draft.color.trim());
  const ticketRows = tickets.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              draft.id === null
                ? "adminEventSeating.categoryDialog.createTitle"
                : "adminEventSeating.categoryDialog.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventSeating.categoryDialog.description")}</DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventSeating.categoryDialog.key")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventSeating.categoryDialog.key")}
            hint={t("adminEventSeating.categoryDialog.keyHint")}
            value={draft.key}
            onValueChange={(value) => set("key", value)}
            maxLength={49}
            monospace
            disabled={draft.id !== null}
            error={errorFor("key")}
          />
          <div className="space-y-1.5">
            <AdminFormTextRow
              label={t("adminEventSeating.categoryDialog.color")}
              value={draft.color}
              onValueChange={(value) => set("color", value)}
              maxLength={7}
              monospace
              error={errorFor("color")}
              endAdornment={
                <input
                  type="color"
                  aria-label={t("adminEventSeating.categoryDialog.colorPicker")}
                  value={contrast === null ? DEFAULT_CATEGORY_COLOR : draft.color.trim()}
                  onChange={(event) => set("color", event.target.value.toUpperCase())}
                  className="h-9 w-12 cursor-pointer rounded-[6px] border border-border bg-background"
                />
              }
            />
            {contrast !== null && contrast < CATEGORY_MIN_CONTRAST ? (
              <p role="status" className="text-xs text-destructive">
                {t("adminEventSeating.categoryDialog.contrastWarning", { ratio: contrast.toFixed(1) })}
              </p>
            ) : null}
          </div>
          <AdminFormTextRow
            label={t("adminEventSeating.categoryDialog.namePl")}
            value={draft.namePl}
            onValueChange={(value) => set("namePl", value)}
            maxLength={SEAT_CATEGORY_NAME_MAX}
            error={errorFor("namePl")}
          />
          <AdminFormTextRow
            label={t("adminEventSeating.categoryDialog.nameEn")}
            value={draft.nameEn}
            onValueChange={(value) => set("nameEn", value)}
            maxLength={SEAT_CATEGORY_NAME_MAX}
            error={errorFor("nameEn")}
          />
        </AdminFormSection>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("adminEventSeating.categoryDialog.tickets")}</legend>
          <p className="text-xs text-muted-foreground">{t("adminEventSeating.categoryDialog.ticketsHint")}</p>
          {ticketRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminEventSeating.categoryDialog.noTickets")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {ticketRows.map((ticket) => {
                const id = `seat-category-ticket-${ticket.id}`;
                return (
                  <li key={ticket.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={draft.ticketTypeIds.includes(ticket.id)}
                      onCheckedChange={(checked) => toggleTicket(ticket.id, checked === true)}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {pickLocalized(ticket, "name", lang)}
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSeating.categoryDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSeating.categoryDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
