// Molekula: WIDOK TABELI planu sali - rownorzedna droga do kazdego miejsca.
//
// PO CO, SKORO JEST PLOTNO. Plotno SVG jest wygodne myszka, ale tabela jest
// kanalem, ktorego nie zastapi zaden `aria-label`: czytnik ekranu czyta
// wiersz po wierszu (miejsce, kategoria, stan, osoba), a organizator z lista
// w reku szuka nazwiska przez Ctrl+F. Te same akcje (zaznacz, posadz, zwolnij)
// sa dostepne tu i na plotnie - tak jak `ChartFrame` zawsze oferuje tabele
// obok wykresu.
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Seat, SeatAssignment, SeatMapDetail } from "@/lib/events/seatingApi";
import { SEAT_STATUS_LABEL_KEYS } from "@/lib/events/seatingDraft";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

export interface SeatMapTableProps {
  detail: SeatMapDetail;
  selected: ReadonlySet<string>;
  occupantBySeat: ReadonlyMap<string, SeatAssignment>;
  labelFor: (seat: Seat) => string;
  /** `true`, gdy wybrano uczestnika do posadzenia. */
  canAssign: boolean;
  onToggle: (seatId: string) => void;
  onAssign: (seatId: string) => void;
  onRelease: (seatId: string) => void;
}

export function SeatMapTable({
  detail,
  selected,
  occupantBySeat,
  labelFor,
  canAssign,
  onToggle,
  onAssign,
  onRelease,
}: SeatMapTableProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const categoryName = new Map(
    detail.categories.map((category) => [
      category.id,
      pickLocalized({ name_pl: category.namePl, name_en: category.nameEn }, "name", lang),
    ]),
  );
  // Kolejnosc czytania: sekcja po sekcji (jak na planie), w sekcji po `sort_key`.
  const rows = detail.sections.flatMap((section) =>
    detail.seats
      .filter((seat) => seat.sectionId === section.id)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((seat) => ({ seat, section })),
  );

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("adminEventSeating.table.empty")}</p>;
  }

  return (
    <Table>
      <caption className="sr-only">
        {t("adminEventSeating.table.caption", { name: detail.map.name })}
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <span className="sr-only">{t("adminEventSeating.legend.selected")}</span>
          </TableHead>
          <TableHead>{t("adminEventSeating.table.seat")}</TableHead>
          <TableHead>{t("adminEventSeating.table.category")}</TableHead>
          <TableHead>{t("adminEventSeating.table.status")}</TableHead>
          <TableHead>{t("adminEventSeating.table.occupant")}</TableHead>
          <TableHead className="text-right">{t("adminEventSeating.table.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ seat, section }) => {
          const label = labelFor(seat);
          const occupant = occupantBySeat.get(seat.id) ?? null;
          const categoryId = seat.categoryId ?? section.categoryId;
          const category = categoryId === null ? undefined : categoryName.get(categoryId);
          return (
            <TableRow key={seat.id} data-state={selected.has(seat.id) ? "selected" : undefined}>
              <TableCell>
                <Checkbox
                  checked={selected.has(seat.id)}
                  onCheckedChange={() => onToggle(seat.id)}
                  aria-label={t("adminEventSeating.table.select", { seat: label })}
                />
              </TableCell>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell>{category ?? t("adminEventSeating.table.noCategory")}</TableCell>
              <TableCell>{t(SEAT_STATUS_LABEL_KEYS[seat.status])}</TableCell>
              <TableCell>
                {occupant === null
                  ? t("adminEventSeating.table.nobody")
                  : `${occupant.firstName} ${occupant.lastName}`.trim()}
              </TableCell>
              <TableCell className="text-right">
                {occupant !== null ? (
                  <Button size="sm" variant="outline" onClick={() => onRelease(seat.id)}>
                    {t("adminEventSeating.table.release")}
                  </Button>
                ) : canAssign && seat.status !== "blocked" ? (
                  <Button size="sm" onClick={() => onAssign(seat.id)}>
                    {t("adminEventSeating.table.assign")}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
