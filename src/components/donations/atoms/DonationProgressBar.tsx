// Pasek postępu zbiórki (atom).
//
// W `DonationsWidgetView.tsx` ten sam pasek był wklejony TRZY RAZY inline
// (wariant `progress`, `thermometer` i `hero`) - trzy kopie tej samej reguły
// „szerokość = procent, tło = akcent albo motyw". Kopie już się rozjechały:
// dwie z nich liczą wypełnienie z `resolveBarPct` (przy braku celu:
// darczyńcy × 5), trzecia bierze czysty `progressPct`. Atom nie decyduje NIC
// o liczbie - dostaje gotowy procent propsem, żeby ta rozbieżność została
// widoczna w widoku i dała się przypiąć testem.
//
// Klasy toru są propsem, bo każdy wariant ma inny tor (h-3 / h-2 / pionowa
// tuba 56x14) - DOM po ekstrakcji jest identyczny z poprzednim.
import type { ReactNode } from "react";

export interface DonationProgressBarProps {
  /** Wypełnienie w procentach - liczba bez znaku „%". */
  pct: number;
  /** Kolor akcentu z edytora CMS; puste = kolor motywu (`bg-primary`). */
  accent?: string;
  /** Klasy toru - różne w każdym wariancie wizualnym. */
  trackClassName: string;
  /** Termometr wypełnia się WYSOKOŚCIĄ, pozostałe warianty szerokością. */
  orientation?: "horizontal" | "vertical";
  /** Nakładka toru (etykieta procentu w termometrze). */
  children?: ReactNode;
}

export function DonationProgressBar({
  pct,
  accent,
  trackClassName,
  orientation = "horizontal",
  children,
}: DonationProgressBarProps) {
  const vertical = orientation === "vertical";
  return (
    <div className={trackClassName}>
      <div
        className={
          vertical
            ? "w-full rounded-full bg-primary transition-all duration-700"
            : "h-full rounded-full bg-primary transition-all duration-700"
        }
        style={
          vertical
            ? { height: `${pct}%`, background: accent || undefined }
            : { width: `${pct}%`, background: accent || undefined }
        }
      />
      {children}
    </div>
  );
}
