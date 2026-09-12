// KAFELEK LICZBY - podstawowa jednostka pulpitu.
//
// DLACZEGO NIE `KpiTile` Z `admin/analytics`. Tamten kafelek powstał dla
// warsztatu BI i robi jedną rzecz więcej (iskrę szeregu), a trzy rzeczy mniej:
// nie prowadzi nigdzie, nie ma miejsca na mianownik i liczy deltę sam - w tym
// przy pustym okresie odniesienia wypisuje "+∞". Pulpit nie może tego pokazać:
// nieskończoność nie jest wzrostem, tylko brakiem podstawy do procentu, i cała
// arytmetyka porównania siedzi tu w `compare.ts`, żeby trzydzieści kafelków
// mówiło o zerze jednym głosem. Tamten kafelek zostaje przy swoich panelach.
//
// Każdy kafelek niesie CZTERY rzeczy i żadna nie jest ozdobą: co mierzymy
// (etykieta), ile tego jest (wartość), czy to dużo (delta wobec okresu
// odniesienia) i skąd to wiadomo (podpowiedź z mianownikiem albo metodą).
// Kafelek bez delty pokazywałby liczbę, z której nie wynika żadna decyzja -
// dlatego `delta` jest tu regułą, a jej brak wyjątkiem dla wielkości, które
// są STANEM, a nie przepływem (np. "użytkownicy łącznie").
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import type { MetricDelta } from "@/lib/admin/dashboard/compare";
import { DeltaBadge } from "./DeltaBadge";

export interface StatTileProps {
  label: string;
  value: string;
  /** Zmiana wobec okresu odniesienia. Pomijana dla wielkości stanowych. */
  delta?: MetricDelta;
  /** Mianownik, metoda albo zastrzeżenie - to, bez czego liczba kłamie. */
  hint?: ReactNode;
  icon?: ReactNode;
  /** Dokąd prowadzi kafelek. Bez tego kafelek jest zwykłym prostokątem. */
  to?: string;
  className?: string;
}

export function StatTile({ label, value, delta, hint, icon, to, className }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground leading-tight">{label}</span>
        {icon ? <span className="shrink-0 text-muted-foreground/70">{icon}</span> : null}
      </div>
      <div className="text-xl font-bold font-display leading-tight mt-1 tabular-nums">{value}</div>
      <div className="mt-1 min-h-[16px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {delta ? <DeltaBadge delta={delta} /> : null}
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
    </>
  );

  // Klasy karty wprost, a nie przez `<Card>`: `Card` jest zwykłym `<div>`
  // i nie ma `asChild`, więc opakowanie nim odnośnika dałoby `<div><a>` -
  // czyli kafelek, w którym klikalna jest tylko jego zawartość.
  const shell = cn(
    "rounded-xl border bg-card text-card-foreground shadow p-3 flex flex-col justify-between",
    to && "hover:border-brand transition-colors",
    className,
  );

  // Kafelek prowadzący gdzieś jest ODNOŚNIKIEM, nie kartą z `onClick`: ma
  // trafiać pod Tab, otwierać się środkowym przyciskiem i pokazywać adres
  // w pasku stanu, a to wszystko daje dopiero prawdziwe `<a>`.
  return to ? (
    <Link to={to} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
