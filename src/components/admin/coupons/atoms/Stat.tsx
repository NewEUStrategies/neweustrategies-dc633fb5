// Atom: kafelek liczby w panelach kuponow.
//
// JEDEN egzemplarz dla WSZYSTKICH paneli kuponow. Przed ekstrakcja ten sam
// komponent stal osobno - znak w znak - w TRZECH plikach tras:
// `admin.coupons.redemptions.tsx` i `admin.coupons.analytics.tsx` jako `Stat`,
// a `admin.coupons.index.tsx` jako `StatCard`. Trzy kopie to trzy miejsca do
// rozjechania sie i zero testow na ktorakolwiek.
//
// `help` (S1, P10) - podpowiedz definicji obok etykiety (np. konwersja
// oplacona). Geometria kafla bez zmian: podpowiedz siedzi w wierszu etykiety.
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function Stat({ label, value, help }: { label: string; value: string; help?: ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        {/* Etykieta jako WŁASNY tekst wiersza (bez owijki) - podpowiedź jest
            rodzeństwem, więc nazwa kafla i jego wartość dalej leżą w jednej karcie. */}
        <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
          {label}
          {help}
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
