// Atom: kafel wskaźnika, którego ta sesja NIE MOŻE zobaczyć (SPEC §2.5, §6.1).
//
// DLACZEGO KAFEL, A NIE BRAK KAFLA. Redaktor na Kokpicie widzi te same
// miejsca co administrator. Gdy kafel MRR po prostu znika, siatka przeskakuje,
// a redaktor nie wie, czy przychodu nie ma, czy nie wolno mu go oglądać -
// „0 zł" byłoby jeszcze gorsze, bo wygląda jak prawdziwy wynik. Kafel
// zablokowany mówi wprost: liczba istnieje, ale nie dla tej roli (albo nie
// bez drugiego składnika logowania).
//
// GEOMETRIA JAK `KpiTile` (`Card p-3`, etykieta 11 px wersalikami, wiersz
// wartości `text-xl`), żeby kafel zablokowany stał w siatce KPI bez
// przesunięć w obu motywach - zmienia się wyłącznie kolor (AGENTS).
//
// `role="group"` NAZWANY ETYKIETĄ kafla: czytnik ogłasza „MRR, grupa", a potem
// powód blokady słowami. Kłódka jest dekoracją (`aria-hidden`), bo powód stoi
// obok tekstem - kolor ani ikona nigdy nie są jedynym nośnikiem informacji.
import { useId } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/card";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";

export type LockedReason = "admin_only" | "mfa_required";

const REASON_KEY: Readonly<Record<LockedReason, string>> = {
  admin_only: "adminRevenue.locked.admin_only",
  mfa_required: "adminRevenue.locked.mfa_required",
};

export interface LockedMetricTileProps {
  /** Etykieta wskaźnika - ta sama, którą miałby odblokowany `KpiTile`. */
  label: string;
  reason: LockedReason;
}

export function LockedMetricTile({ label, reason }: LockedMetricTileProps) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;

  return (
    <Card
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hintId}
      data-locked-reason={reason}
      className="p-3 relative overflow-hidden"
    >
      <div className="min-w-0">
        <div
          id={labelId}
          className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"
        >
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xl font-semibold leading-tight text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {/* Kreska zajmuje miejsce liczby (ta sama wysokość wiersza co
              `KpiTile`), ale czytnikowi nic nie mówi - powód jest niżej. */}
          <span aria-hidden="true">-</span>
        </div>
        <p className="mt-1.5 mb-0 text-[11px] leading-snug text-muted-foreground">
          {t(REASON_KEY[reason])}
        </p>
        <span id={hintId} className="sr-only">
          {t("adminRevenue.locked.hint")}
        </span>
      </div>
    </Card>
  );
}
