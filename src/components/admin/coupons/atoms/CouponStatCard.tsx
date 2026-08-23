// Atom: kafel liczbowy nad listą (kupony, realizacje, wygasłe).
//
// Trzy identyczne kopie tego komponentu stały w trzech plikach tras kuponów
// (`StatCard` na liście, `Stat` w realizacjach i w analityce). Wartość wchodzi
// jako gotowy NAPIS - formatowanie liczby jest decyzją wołającego, nie kafla.
import { Card, CardContent } from "@/components/ui/card";

interface CouponStatCardProps {
  label: string;
  value: string;
}

export function CouponStatCard({ label, value }: CouponStatCardProps) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
