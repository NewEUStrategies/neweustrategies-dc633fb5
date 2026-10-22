// Próg notki „starsze dni z agregatu dobowego" w lejku huba (I9d-Y1) - moduł
// czysty, bez Reacta (osobno od komponentu: odświeżanie modułów Vite).
//
// Lejek nie zna dokładnej granicy odczytu (RPC S3 jej nie zwraca, a odczyt
// ustawień retencji wymaga roli administratora), więc notka pojawia się, gdy
// okno sięga dalej niż NAJKRÓTSZY dozwolony okres odczytów licznika - bliżej
// agregat nigdy nie wchodzi (granica = późniejsza z progów kategorii).
// Próg liczony lokalnym konstruktorem daty (jak `ProvenanceNote`).
import { DATA_RETENTION_PERIODS } from "@/lib/privacy/dataRetention";

/** Czy któreś z okien sięga przed najkrótszy dozwolony okres odczytów licznika. */
export function windowMayUseAggregate(
  starts: readonly (string | null | undefined)[],
  now: Date = new Date(),
): boolean {
  const months = DATA_RETENTION_PERIODS.metered_views.minMonths;
  const threshold = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  return starts.some((start) => {
    if (!start) return false;
    const at = Date.parse(start);
    return Number.isFinite(at) && at < threshold.getTime();
  });
}
