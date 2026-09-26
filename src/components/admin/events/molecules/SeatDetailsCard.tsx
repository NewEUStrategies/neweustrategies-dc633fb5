// Molekula: SZCZEGOL zaznaczonych miejsc planu sali i akcje na nich.
//
// JEDNO MIEJSCE: kto siedzi (osoba, firma w projekcji CRM, bilet), stan,
// rezerwacja z nazwa firmy/sponsora/zamowienia, kategoria (nadpisanie albo
// "jak w sekcji") i dostepnosc dla wozka. KILKA MIEJSC: liczba i akcje
// zbiorcze (stan, zwolnienie zajetych).
//
// DECYZJE PODEJMUJE BAZA. Przycisk "posadz" jest widoczny tylko przy wolnym,
// niezablokowanym miejscu, ale rezerwacje dla innej firmy i reguly kategorii
// rozstrzyga RPC - organizm dopyta wtedy o swiadome obejscie.
import { useTranslation } from "react-i18next";

import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { SEAT_STATUS_LABEL_KEYS } from "@/components/admin/events/molecules/SeatMapTable";
import type { Seat, SeatAssignment, SeatMapDetail } from "@/lib/events/seatingApi";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

/** Wartosc listy kategorii oznaczajaca "jak w sekcji" (`category_id = null`). */
const SECTION_CATEGORY = "__section__";

export interface SeatDetailsCardProps {
  seats: readonly Seat[];
  detail: SeatMapDetail;
  occupantBySeat: ReadonlyMap<string, SeatAssignment>;
  labelFor: (seat: Seat) => string;
  armedName: string | null;
  busy: boolean;
  onAssignArmed: (seatId: string) => void;
  onRelease: (seatIds: string[]) => void;
  onEditStatus: () => void;
  onSetAccessible: (seatIds: string[], value: boolean) => void;
  onSetCategory: (seatIds: string[], categoryId: string | null) => void;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function SeatDetailsCard({
  seats,
  detail,
  occupantBySeat,
  labelFor,
  armedName,
  busy,
  onAssignArmed,
  onRelease,
  onEditStatus,
  onSetAccessible,
  onSetCategory,
}: SeatDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (seats.length === 0) {
    return (
      <section className="rounded-[6px] border border-dashed border-border p-4 text-sm text-muted-foreground">
        {t("adminEventSeating.details.none")}
      </section>
    );
  }

  const ids = seats.map((seat) => seat.id);
  const occupied = seats.filter((seat) => occupantBySeat.has(seat.id)).map((seat) => seat.id);

  if (seats.length > 1) {
    return (
      <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">
          {t("adminEventSeating.workspace.selectionCount", { count: seats.length })}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEditStatus} disabled={busy}>
            {t("adminEventSeating.details.changeStatus")}
          </Button>
          {occupied.length === 0 ? null : (
            <Button size="sm" variant="outline" onClick={() => onRelease(occupied)} disabled={busy}>
              {t("adminEventSeating.details.releaseSelected", { count: occupied.length })}
            </Button>
          )}
        </div>
      </section>
    );
  }

  const seat = seats[0];
  const occupant = occupantBySeat.get(seat.id) ?? null;
  const categoryOptions = [
    { value: SECTION_CATEGORY, label: t("adminEventSeating.details.sectionCategory") },
    ...detail.categories.map((category) => ({
      value: category.id,
      label: pickLocalized({ name_pl: category.namePl, name_en: category.nameEn }, "name", lang),
    })),
  ];
  const heldFor = seat.holdCompanyName ?? seat.holdSponsorName ?? seat.holdPackageBuyer;
  const occupantMeta =
    occupant === null
      ? ""
      : [
          occupant.company ?? "",
          pickLocalized(
            { name_pl: occupant.ticketNamePl, name_en: occupant.ticketNameEn },
            "name",
            lang,
          ),
        ]
          .filter((part) => part !== "")
          .join(" · ");

  return (
    <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{labelFor(seat)}</h3>
      <dl className="space-y-1">
        <Fact
          label={t("adminEventSeating.details.status")}
          value={t(SEAT_STATUS_LABEL_KEYS[seat.status])}
        />
        {seat.status === "held" && heldFor !== null ? (
          <Fact label={t("adminEventSeating.details.heldFor")} value={heldFor} />
        ) : null}
        {seat.holdNote === null ? null : (
          <Fact label={t("adminEventSeating.details.note")} value={seat.holdNote} />
        )}
        {seat.blockReason === null ? null : (
          <Fact label={t("adminEventSeating.details.blockReason")} value={seat.blockReason} />
        )}
      </dl>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("adminEventSeating.details.occupant")}
        </p>
        {occupant === null ? (
          <p className="text-sm text-muted-foreground">{t("adminEventSeating.details.free")}</p>
        ) : (
          <div className="text-sm">
            <p className="font-medium">{`${occupant.firstName} ${occupant.lastName}`.trim()}</p>
            {occupantMeta === "" ? null : (
              <p className="text-muted-foreground">{occupantMeta}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`seat-category-${seat.id}`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("adminEventSeating.details.categoryOverride")}
        </label>
        <FormSelect
          id={`seat-category-${seat.id}`}
          value={seat.categoryId ?? SECTION_CATEGORY}
          options={categoryOptions}
          disabled={busy}
          onValueChange={(value) => onSetCategory(ids, value === SECTION_CATEGORY ? null : value)}
        />
      </div>

      <AdminFormSwitchRow
        label={t("adminEventSeating.details.accessible")}
        checked={seat.isAccessible}
        disabled={busy}
        onCheckedChange={(value) => onSetAccessible(ids, value)}
      />

      <div className="flex flex-wrap gap-2">
        {armedName !== null && occupant === null && seat.status !== "blocked" ? (
          <Button size="sm" onClick={() => onAssignArmed(seat.id)} disabled={busy}>
            {t("adminEventSeating.details.assignArmed", { name: armedName })}
          </Button>
        ) : null}
        {occupant === null ? null : (
          <Button size="sm" variant="outline" onClick={() => onRelease(ids)} disabled={busy}>
            {t("adminEventSeating.details.release")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEditStatus} disabled={busy}>
          {t("adminEventSeating.details.changeStatus")}
        </Button>
      </div>
    </section>
  );
}
