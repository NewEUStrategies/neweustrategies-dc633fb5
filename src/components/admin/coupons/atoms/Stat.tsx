// Atom: kafelek liczby w panelach kuponow.
//
// JEDEN egzemplarz dla WSZYSTKICH paneli kuponow. Przed ekstrakcja ten sam
// komponent stal osobno - znak w znak - w TRZECH plikach tras:
// `admin.coupons.redemptions.tsx` i `admin.coupons.analytics.tsx` jako `Stat`,
// a `admin.coupons.index.tsx` jako `StatCard`. Trzy kopie to trzy miejsca do
// rozjechania sie i zero testow na ktorakolwiek.
import { Card, CardContent } from "@/components/ui/card";

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
