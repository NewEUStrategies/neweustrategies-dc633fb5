// Atom: kafel liczbowy nad tabelą (realizacje, przychód, rabat, konwersja).
//
// CO BYŁO W TRASACH. Dokładnie ten sam komponent `Stat` stał na końcu DWÓCH
// plików tras kuponów - `admin.coupons.redemptions.tsx` (dawne 214-222)
// i `admin.coupons.analytics.tsx` (dawne 186-194) - znak w znak, razem
// z klasami. Trzecia kopia (`StatCard`) mieszka w liście kuponów i zniknie
// przy ekstrakcji tamtej trasy.
//
// NAZWA JEST WĘŻSZA NIŻ „CouponStatCard" ŚWIADOMIE: nad listą kuponów pracuje
// równolegle inne zadanie na tej samej powierzchni, a dwa pliki o tej samej
// ścieżce to konflikt, nie ponowne użycie. Ten kafel obsługuje realizacje
// i analitykę; scalenie trzech kopii w jeden atom jest osobnym krokiem.
//
// Bez I/O, bez formatowania: wartość przychodzi GOTOWA jako string, bo to
// wołający wie, czy liczy grosze, sztuki czy procenty.
import { Card, CardContent } from "@/components/ui/card";

export function CouponStatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
