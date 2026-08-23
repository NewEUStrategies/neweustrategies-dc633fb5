// Atom: komórka CTR w tabeli statystyk.
//
// Zero wyświetleń daje KRESKĘ, nie "0%" i nie "NaN%": 0% czytałoby się jak
// zmierzony wynik ("nikt nie kliknął"), a slot bez ani jednego wyświetlenia
// nie ma czego mierzyć. Znak i format przeniesione ZNAK W ZNAK z trasy -
// pauza typograficzna zostaje, mimo że bramka słownikowa zakazuje jej
// w tłumaczeniach (to osobny dług, nie zmiana tej ekstrakcji).
export function adCtr(imp: number, clk: number): string {
  return imp > 0 ? `${((clk / imp) * 100).toFixed(1)}%` : "—";
}

export function AdCtrCell({ impressions, clicks }: { impressions: number; clicks: number }) {
  return <td className="p-3 text-right tabular-nums">{adCtr(impressions, clicks)}</td>;
}
