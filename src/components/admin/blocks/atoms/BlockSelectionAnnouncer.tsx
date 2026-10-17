// Komunikat dla czytników ekranu o stanie zaznaczenia blokowego. Zaznaczenie
// w poprzek bloków jest czysto wizualne (podświetlone wiersze), więc bez
// `aria-live` użytkownik czytnika nie wie, ile bloków objęło Shift+strzałka
// albo przeciągnięcie myszą. WP robi to samo przez `speak()`.
//
// Atom bez własnego layoutu: renderuje wyłącznie region `sr-only`, więc nie
// wpływa na grid ani na responsywność kanwy.

import { useTranslation } from "react-i18next";
// `blocks.selection.*` jedzie w nakładce edytora bloków, nie w rdzeniu języka -
// każdy czytelnik `blocks.*` importuje ją sam (bramka `coreScopeSurfaces.test`).
import "@/lib/i18n-admin-blocks";

interface Props {
  /** Liczba zaznaczonych bloków (0 = brak komunikatu). */
  count: number;
}

export function BlockSelectionAnnouncer({ count }: Props) {
  const { t } = useTranslation();
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {count > 0 ? t("blocks.selection.count", { count }) : ""}
    </p>
  );
}
