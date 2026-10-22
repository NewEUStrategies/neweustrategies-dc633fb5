// Molekuła: sygnał Diagnostyki na ekranie modułu (SPEC §2.7, §6.1
// `RevenueSignalChip`) - „2 otwarte diagnozy · Zobacz w Diagnostyce" nad
// cennikiem, paywallem, kuponami, CRM… Mapę „ekran → obszary" trzyma
// `SIGNAL_SURFACES` (`lib/revenue/diagnostics/surfaces.ts`); montaż w modułach
// robi integracja (I9).
//
// LEKKIE OPAKOWANIE + LENIWA TREŚĆ. Ten plik zostaje w chunku ekranu modułu,
// więc trzyma wyłącznie bramkę sesji; rejestr reguł, ocena faktów i słownik
// diagnostyki jadą w chunku `diagnostics/SignalChipBody` ładowanym dopiero,
// gdy chip ma się pokazać (budżet D-08). Z tego samego powodu ekran może
// podać `surface="paywall"` zamiast listy obszarów: import `SIGNAL_SURFACES`
// w pliku trasy pociągnąłby cały rejestr do jej chunku.
//
// `useHydrated()` PRZED SESJĄ: ekrany modułów renderuje serwer, który nie zna
// sesji jak klient - do hydratacji chip nie istnieje, więc znacznik serwera
// i pierwszego renderu klienta jest ten sam. Role DOKŁADNE (`admin`,
// `editor`) - tak pyta `admin_revenue_facts()`; autor i sam `super_admin`
// nie dostają ani chipu, ani żądania.
import { lazy, Suspense } from "react";
import { useHydrated } from "@tanstack/react-router";

import { useAuth } from "@/hooks/useAuth";
import type { RevenueArea } from "@/lib/admin/revenue/hubTabs";
import type { SignalSurface } from "@/lib/revenue/diagnostics/surfaces";

const SignalChipBody = lazy(() => import("@/components/admin/revenue/diagnostics/SignalChipBody"));

interface SignalChipLook {
  /** `bar` - pasek nad treścią modułu; `chip` - zwarta pigułka w nagłówku. */
  variant?: "bar" | "chip";
  className?: string;
}

/** Obszary wprost (SPEC §6.1) albo ekran z `SIGNAL_SURFACES`. */
export type RevenueSignalChipProps = SignalChipLook &
  ({ areas: readonly RevenueArea[]; surface?: never } | { surface: SignalSurface; areas?: never });

export function RevenueSignalChip({
  variant = "chip",
  className,
  ...target
}: RevenueSignalChipProps) {
  const hydrated = useHydrated();
  const { roles, tenantId } = useAuth();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  if (!hydrated || !roleOk || !tenantId) return null;
  return (
    <Suspense fallback={null}>
      <SignalChipBody
        areas={target.areas}
        surface={target.surface}
        variant={variant}
        tenantId={tenantId}
        className={className}
      />
    </Suspense>
  );
}
