// Domknięcie footguna mock-mode billingu (P0 z audytu platformy).
//
// Tryb mock (checkout bez skonfigurowanego dostawcy płatności) istnieje po to,
// by dało się przetestować lejek zakupowy w dev/stagingu. Gdyby włączał się
// samym brakiem konfiguracji, źle skonfigurowana produkcja rozdawałaby płatne
// uprawnienia za darmo, bez żadnego sygnału błędu.
//
// Reguła (fail-closed):
//   * dostawca skonfigurowany -> mock NIGDY (webhook jest źródłem prawdy),
//   * produkcja bez dostawcy  -> mock tylko przy jawnym BILLING_ALLOW_MOCK=1,
//   * dev/test bez dostawcy   -> mock dozwolony (dotychczasowe DX).

/** Czy bramka płatności ma komplet kluczy do wystawienia checkoutu. */
export function paymentsConfiguredServer(): boolean {
  return (
    !!process.env.LOVABLE_API_KEY &&
    (!!process.env.STRIPE_SANDBOX_API_KEY || !!process.env.STRIPE_LIVE_API_KEY)
  );
}

export function mockCheckoutAllowed(): boolean {
  if (paymentsConfiguredServer()) return false;
  if (process.env.BILLING_ALLOW_MOCK === "1") return true;
  return process.env.NODE_ENV !== "production";
}
