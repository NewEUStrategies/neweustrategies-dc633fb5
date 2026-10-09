// KAWAŁEK SILNIKA WYKRESÓW, KTÓRY SIĘ NIE ZAŁADOWAŁ (zerwane łącze, stary
// deploy bez chunka) nie może zostawić pustej dziury ani wywrócić granicy
// błędu - czytelnik dostaje w miejscu wykresu zdanie, co się stało i co
// zrobić. Ten plik jest celowo malutki i NIE importuje silnika: stoi
// statycznie obok leniwych importów bloku CMS i widgetu buildera.
import { useTranslation } from "react-i18next";
// Słownik publiczny jest już w grafie każdej strony (menu, renderer bloków),
// więc ta krawędź nie dokłada bajtów - gwarantuje tylko, że napis jest.
import "@/lib/i18n-public";

export function ChartLoadFailed() {
  const { t } = useTranslation();
  return (
    <p
      role="status"
      className="not-prose my-6 rounded-[6px] border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
    >
      {t("blocksUi.chartLoadFailed")}
    </p>
  );
}
