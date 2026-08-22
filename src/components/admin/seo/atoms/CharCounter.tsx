// Atom: licznik znaków pola SEO ("72/160") z tonacją twardego limitu.
//
// Bez I/O i bez stanu serwera - dostaje wyłącznie długość i limit, więc da się
// go dowieść tabelą wejść, a nie renderem całego panelu. Wyprowadzony z
// `SeoTextField`, gdzie mieszkał jako wklejony `<span>`: liczba znaków i jej
// tonacja to jedyny sygnał, po którym redakcja widzi, że wpis DOTKNĄŁ twardego
// limitu (`maxLength` cicho ucina pisanie, przeglądarka nie mówi nic).
//
// UWAGA NA JEDNOSTKĘ: licznik pokazuje DŁUGOŚĆ JEDNOSTEK KODU UTF-16, dokładnie
// tę samą, którą wymusza atrybut `maxLength` w DOM - inaczej pasek mówiłby coś
// innego niż zachowanie pola. Dla polskich diakrytyków (NFC) to jest to samo co
// liczba znaków; dla emoji z par zastępczych - nie, i tak ma zostać.
import { cn } from "@/lib/utils";

interface CharCounterProps {
  /** Liczba znaków wpisanych przez redakcję (bez wartości domyślnej). */
  length: number;
  /** Twardy limit pola - ten sam, który trafia do `maxLength`. */
  max: number;
}

/** Czy długość dobiła twardego limitu (pole nie przyjmie już znaku). */
export function isAtHardLimit(length: number, max: number): boolean {
  return length >= max;
}

export function CharCounter({ length, max }: CharCounterProps) {
  const atLimit = isAtHardLimit(length, max);
  return (
    <span
      data-testid="seo-char-counter"
      data-at-limit={atLimit ? "true" : "false"}
      className={cn(
        "text-[10px] font-normal tabular-nums",
        atLimit ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {length}/{max}
    </span>
  );
}
