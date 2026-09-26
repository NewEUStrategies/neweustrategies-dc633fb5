// Molekula: formularz SEKCJI planu sali z PODGLADEM NA ZYWO.
//
// PODGLAD LICZY KLIENT, ZAPIS - BAZA. Podglad rysuje `generateSectionSeats()`,
// czyli to samo, co po zapisie zmaterializuje `_event_seat_section_layout()`
// (parytet obu formul pilnuje test na zlotym wzorcu z harnessu). Organizator
// widzi numeracje "od srodka" i przejscia, zanim cokolwiek zapisze.
//
// ZMIANA PARAMETROW ZACHOWUJE MIEJSCA po kluczu naturalnym (rzad, numer) -
// rezerwacje i przydzialy zostaja; baza odmowi tylko wtedy, gdy zmiana usunelaby
// zajete miejsce (`seats_in_use`).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
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
import { Label } from "@/components/ui/label";
import {
  SEAT_NUMBERINGS,
  SEAT_ROW_LABEL_SCHEMES,
  SEAT_SECTION_KINDS,
  SEAT_TABLE_SHAPES,
  type SeatCategory,
  type SeatNumbering,
  type SeatRowLabelScheme,
  type SeatSection,
  type SeatSectionInput,
  type SeatSectionKind,
  type SeatTableShape,
} from "@/lib/events/seatingApi";
import {
  SEAT_SECTION_LABEL_MAX,
  emptySectionDraft,
  sectionDraftFromSection,
  sectionDraftLayout,
  sectionDraftToInput,
  validateSectionDraft,
  type SectionDraft,
  type SectionField,
} from "@/lib/events/seatingDraft";
import {
  boundsOf,
  generateSectionSeats,
  seatRadius,
  toMapPoint,
  type SectionLayoutParams,
} from "@/lib/events/seatingGeometry";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

const NO_CATEGORY = "__none__";

const KIND_LABEL_KEYS: Record<SeatSectionKind, string> = {
  rows: "adminEventSeating.sectionDialog.kinds.rows",
  table: "adminEventSeating.sectionDialog.kinds.table",
};
const SCHEME_LABEL_KEYS: Record<SeatRowLabelScheme, string> = {
  alpha: "adminEventSeating.sectionDialog.schemes.alpha",
  numeric: "adminEventSeating.sectionDialog.schemes.numeric",
};
const NUMBERING_LABEL_KEYS: Record<SeatNumbering, string> = {
  ltr: "adminEventSeating.sectionDialog.numberings.ltr",
  rtl: "adminEventSeating.sectionDialog.numberings.rtl",
  odd_even: "adminEventSeating.sectionDialog.numberings.odd_even",
};
const SHAPE_LABEL_KEYS: Record<SeatTableShape, string> = {
  round: "adminEventSeating.sectionDialog.shapes.round",
  rect: "adminEventSeating.sectionDialog.shapes.rect",
};

/** Podglad sekcji w jej ukladzie lokalnym (z obrotem), bez reszty planu. */
function SectionPreview({ params, rotationDeg }: { params: SectionLayoutParams; rotationDeg: number }) {
  const { t } = useTranslation();
  const seats = generateSectionSeats(params).map((seat) => ({
    ...seat,
    ...toMapPoint(seat, { originX: 0, originY: 0, rotationDeg }),
  }));
  const radius = seatRadius(params.seatPitch, params.rowPitch);
  const box = boundsOf(seats, radius * 2);
  return (
    <figure className="space-y-1">
      <svg
        role="img"
        aria-label={t("adminEventSeating.sectionDialog.previewCount", { count: seats.length })}
        viewBox={`${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`}
        className="h-48 w-full rounded-[6px] border border-border bg-muted/30"
      >
        {seats.map((seat) => (
          <g key={`${seat.rowLabel ?? ""}-${seat.seatNumber}`}>
            <circle cx={seat.x} cy={seat.y} r={radius} className="fill-card stroke-muted-foreground" strokeWidth={2} />
            <text
              x={seat.x}
              y={seat.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={radius}
              className="fill-foreground"
            >
              {seat.seatNumber}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        {t("adminEventSeating.sectionDialog.previewCount", { count: seats.length })}
      </figcaption>
    </figure>
  );
}

export interface EventSeatSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapId: string;
  /** `null` = nowa sekcja rodzaju `kind`. */
  section: SeatSection | null;
  kind: SeatSectionKind;
  categories: readonly SeatCategory[];
  isSaving: boolean;
  onSubmit: (input: SeatSectionInput) => void;
}

export function EventSeatSectionDialog({
  open,
  onOpenChange,
  mapId,
  section,
  kind,
  categories,
  isSaving,
  onSubmit,
}: EventSeatSectionDialogProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [draft, setDraft] = useState<SectionDraft>(() => emptySectionDraft(kind));
  const [touched, setTouched] = useState(false);

  const sectionRef = useRef(section);
  sectionRef.current = section;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const sectionId = section === null ? null : section.id;

  useEffect(() => {
    if (!open) return;
    const current = sectionRef.current;
    setDraft(current === null ? emptySectionDraft(kindRef.current) : sectionDraftFromSection(current));
    setTouched(false);
  }, [open, sectionId]);

  const errors = validateSectionDraft(draft);
  const errorFor = (field: SectionField): string | null => {
    if (!touched) return null;
    const found = errors.find((error) => error.field === field);
    return found === undefined ? null : t(found.messageKey);
  };
  const set = <K extends keyof SectionDraft>(key: K, value: SectionDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (errors.length > 0) return;
    onSubmit(sectionDraftToInput(draft, mapId));
  };

  const layout = sectionDraftLayout(draft);
  const rotation = Number(draft.rotationDeg.replace(",", "."));
  const title =
    draft.id !== null
      ? "adminEventSeating.sectionDialog.editTitle"
      : draft.kind === "rows"
        ? "adminEventSeating.sectionDialog.createRowsTitle"
        : "adminEventSeating.sectionDialog.createTableTitle";

  const select = (
    id: string,
    labelKey: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <FormSelect id={id} value={value} options={options} onValueChange={onChange} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(title)}</DialogTitle>
          <DialogDescription>{t("adminEventSeating.sectionDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <AdminFormSection title={t("adminEventSeating.sectionDialog.label")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.label")}
              hint={t("adminEventSeating.sectionDialog.labelHint")}
              value={draft.label}
              onValueChange={(value) => set("label", value)}
              maxLength={SEAT_SECTION_LABEL_MAX}
              error={errorFor("label")}
            />
            {select(
              "seat-section-kind",
              "adminEventSeating.sectionDialog.kind",
              draft.kind,
              SEAT_SECTION_KINDS.map((value) => ({ value, label: t(KIND_LABEL_KEYS[value]) })),
              (value) => set("kind", value as SeatSectionKind),
            )}
            {select(
              "seat-section-category",
              "adminEventSeating.sectionDialog.category",
              draft.categoryId ?? NO_CATEGORY,
              [
                { value: NO_CATEGORY, label: t("adminEventSeating.sectionDialog.noCategory") },
                ...categories.map((category) => ({
                  value: category.id,
                  label: pickLocalized(
                    { name_pl: category.namePl, name_en: category.nameEn },
                    "name",
                    lang,
                  ),
                })),
              ],
              (value) => set("categoryId", value === NO_CATEGORY ? null : value),
            )}
            {draft.kind === "rows" ? (
              <>
                <AdminFormTextRow
                  label={t("adminEventSeating.sectionDialog.rowsCount")}
                  value={draft.rowsCount}
                  onValueChange={(value) => set("rowsCount", value)}
                  inputMode="numeric"
                  error={errorFor("rowsCount")}
                />
                <AdminFormTextRow
                  label={t("adminEventSeating.sectionDialog.seatsPerRow")}
                  value={draft.seatsPerRow}
                  onValueChange={(value) => set("seatsPerRow", value)}
                  inputMode="numeric"
                  error={errorFor("seatsPerRow")}
                />
                {select(
                  "seat-section-scheme",
                  "adminEventSeating.sectionDialog.rowLabelScheme",
                  draft.rowLabelScheme,
                  SEAT_ROW_LABEL_SCHEMES.map((value) => ({ value, label: t(SCHEME_LABEL_KEYS[value]) })),
                  (value) => set("rowLabelScheme", value as SeatRowLabelScheme),
                )}
                <AdminFormTextRow
                  label={t("adminEventSeating.sectionDialog.rowLabelStart")}
                  hint={t("adminEventSeating.sectionDialog.rowLabelStartHint")}
                  value={draft.rowLabelStart}
                  onValueChange={(value) => set("rowLabelStart", value)}
                  inputMode="numeric"
                  error={errorFor("rowLabelStart")}
                />
                {select(
                  "seat-section-numbering",
                  "adminEventSeating.sectionDialog.seatNumbering",
                  draft.seatNumbering,
                  SEAT_NUMBERINGS.map((value) => ({ value, label: t(NUMBERING_LABEL_KEYS[value]) })),
                  (value) => set("seatNumbering", value as SeatNumbering),
                )}
                <AdminFormTextRow
                  label={t("adminEventSeating.sectionDialog.aisles")}
                  hint={t("adminEventSeating.sectionDialog.aislesHint")}
                  value={draft.aisles}
                  onValueChange={(value) => set("aisles", value)}
                  error={errorFor("aisles")}
                />
              </>
            ) : (
              <>
                {select(
                  "seat-section-shape",
                  "adminEventSeating.sectionDialog.tableShape",
                  draft.tableShape,
                  SEAT_TABLE_SHAPES.map((value) => ({ value, label: t(SHAPE_LABEL_KEYS[value]) })),
                  (value) => set("tableShape", value as SeatTableShape),
                )}
                <AdminFormTextRow
                  label={t("adminEventSeating.sectionDialog.tableSeats")}
                  value={draft.tableSeats}
                  onValueChange={(value) => set("tableSeats", value)}
                  inputMode="numeric"
                  error={errorFor("tableSeats")}
                />
              </>
            )}
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.seatNumberStart")}
              value={draft.seatNumberStart}
              onValueChange={(value) => set("seatNumberStart", value)}
              inputMode="numeric"
              error={errorFor("seatNumberStart")}
            />
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.seatPitch")}
              value={draft.seatPitch}
              onValueChange={(value) => set("seatPitch", value)}
              inputMode="decimal"
              error={errorFor("seatPitch")}
            />
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.rowPitch")}
              value={draft.rowPitch}
              onValueChange={(value) => set("rowPitch", value)}
              inputMode="decimal"
              error={errorFor("rowPitch")}
            />
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.originX")}
              value={draft.originX}
              onValueChange={(value) => set("originX", value)}
              inputMode="decimal"
              error={errorFor("origin")}
            />
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.originY")}
              value={draft.originY}
              onValueChange={(value) => set("originY", value)}
              inputMode="decimal"
            />
            <AdminFormTextRow
              label={t("adminEventSeating.sectionDialog.rotation")}
              value={draft.rotationDeg}
              onValueChange={(value) => set("rotationDeg", value)}
              inputMode="decimal"
              error={errorFor("rotationDeg")}
            />
          </AdminFormSection>

          <section aria-label={t("adminEventSeating.sectionDialog.preview")} className="space-y-2">
            <h3 className="text-sm font-semibold">{t("adminEventSeating.sectionDialog.preview")}</h3>
            {layout === null ? (
              <p className="text-sm text-muted-foreground">
                {t("adminEventSeating.sectionDialog.previewInvalid")}
              </p>
            ) : (
              <SectionPreview params={layout} rotationDeg={rotation} />
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventSeating.sectionDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventSeating.sectionDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
