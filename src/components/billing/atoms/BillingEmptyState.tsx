// Atom: „nic tu jeszcze nie ma" na karcie rozliczeniowej.
//
// Trzy identyczne akapity (dokumenty, zamówienia, historia płatności) różniły
// się wyłącznie treścią.
//
// Kontrakt dostępności: `role="status"`. Pusta lista jest ODPOWIEDZIĄ na
// wczytanie danych. Dla klienta, który sprawdza, czy jego płatność przeszła,
// „nie ma nic" to informacja - i musi dać się odróżnić od trwającego zapytania,
// a nie być ciszą.
import type { ReactNode } from "react";

export function BillingEmptyState({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}
