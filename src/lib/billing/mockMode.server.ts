// Domknięcie footguna mock-mode billingu (P0 z audytu platformy).
//
// Tryb mock (checkout bez Stripe) istnieje po to, by dało się przetestować
// lejek zakupowy w dev/stagingu. Dotąd włączał się SAMYM brakiem
// STRIPE_SECRET_KEY - czyli źle skonfigurowana produkcja (zgubiony env)
// rozdawała płatne uprawnienia za darmo, bez żadnego sygnału błędu.
//
// Nowa reguła (fail-closed):
//   * STRIPE_SECRET_KEY ustawiony  -> mock NIGDY (webhook jest źródłem prawdy),
//   * produkcja bez klucza         -> mock tylko przy jawnym BILLING_ALLOW_MOCK=1,
//   * dev/test bez klucza          -> mock dozwolony (dotychczasowe DX).
export function mockCheckoutAllowed(): boolean {
  if (process.env.STRIPE_SECRET_KEY) return false;
  if (process.env.BILLING_ALLOW_MOCK === "1") return true;
  return process.env.NODE_ENV !== "production";
}
