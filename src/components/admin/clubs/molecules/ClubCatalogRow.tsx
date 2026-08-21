// Molekuła: JEDEN wpis katalogu taksonomii - znaczniki i trzy akcje.
//
// CO BYŁO W ORGANIZMACH. Wiersz obszaru tematycznego i wiersz specjalizacji to
// dwie kopie tej samej karty: przygaszenie wpisu wyłączonego, znacznik
// „systemowy”, znacznik „wyłączony”, linia z metryką i skupisko akcji po prawej
// (przełącznik, ołówek, kosz). Różniły się WYŁĄCZNIE zawartością tytułu (chip
// obszaru kontra ikona i dwie nazwy) oraz jedną dodatkową akcją specjalizacji
// (podgląd strony publicznej).
//
// DWIE RZECZY, KTÓRE TU SĄ REGUŁĄ, A NIE WYGLĄDEM:
//
//   1. WPIS SYSTEMOWY I WPIS W UŻYCIU NIE KASUJĄ SIĘ. Przycisk kosza dostaje
//      `disabled` z zewnątrz (`catalogDeleteBlocked`), więc jest ODCIĘTY, a nie
//      tylko „nie powinien być klikany”. Reguła jest po stronie danych, a nie
//      po stronie tego, czy administrator zdąży zauważyć znacznik.
//   2. PRZEŁĄCZNIK MA DOSTĘPNĄ NAZWĘ. Sam przełącznik nie ma treści, więc bez
//      `aria-label` z nazwą wpisu czytnik ekranu przy dziewięciu wierszach mówi
//      dziewięć razy to samo - i nie da się rozpoznać, który wpis się wyłącza.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jeden wpis i oddać trzy zdarzenia. Molekuła
// nie zna słownika (napisy dostaje gotowe, bo klucze obu katalogów mieszkają
// w RÓŻNYCH plikach i18n), nie woła mutacji i nie wie, czy wpis jest obszarem,
// czy specjalizacją.
import type { ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export function ClubCatalogRow({
  isActive,
  isSystem,
  systemLabel,
  disabledLabel,
  leading,
  title,
  meta,
  toggleLabel,
  toggleDisabled,
  onToggle,
  extraActions,
  editLabel,
  onEdit,
  deleteLabel,
  deleteDisabled,
  onDelete,
}: {
  isActive: boolean;
  isSystem: boolean;
  systemLabel: string;
  disabledLabel: string;
  /** Ikona albo inny znak wiodący przed tytułem; brak = wiersz bez znaku. */
  leading?: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  toggleLabel: string;
  toggleDisabled?: boolean;
  onToggle: (isActive: boolean) => void;
  /** Akcje SPECYFICZNE dla katalogu (np. podgląd strony publicznej). */
  extraActions?: ReactNode;
  editLabel: string;
  onEdit: () => void;
  deleteLabel: string;
  deleteDisabled: boolean;
  onDelete: () => void;
}) {
  return (
    <Card className={isActive ? "" : "opacity-70"}>
      <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        {leading === undefined ? null : leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {title}
            {isSystem ? (
              <Badge variant="outline" className="text-[10px]">
                {systemLabel}
              </Badge>
            ) : null}
            {isActive ? null : (
              <Badge variant="secondary" className="text-[10px]">
                {disabledLabel}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
        </div>

        <div className="flex items-center gap-1.5">
          {extraActions === undefined ? null : extraActions}
          <Switch
            checked={isActive}
            disabled={toggleDisabled}
            aria-label={toggleLabel}
            onCheckedChange={onToggle}
          />
          <Button variant="ghost" size="icon" aria-label={editLabel} onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={deleteLabel}
            disabled={deleteDisabled}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
