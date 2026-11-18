// IZOLACJA TESTÓW OD SEKRETÓW HOSTA.
//
// CI (`test-shards` w `.github/workflows/ci.yml`) uruchamia vitest BEZ
// jakichkolwiek kluczy w `process.env`. Środowisko programistyczne (sandbox
// Lovable, lokalna powłoka z wyeksportowanymi zmiennymi) ma natomiast PRAWDZIWE
// adresy i klucze: bazy, Stripe, bramki AI, poczty. Testy, które tego nie
// zakładają, wtedy:
//   * odpytują prawdziwy katalog tenantów i odrzucają host z fiksturki
//     (`tenant-a.eu` nie jest zarejestrowaną domeną) - zapis strony w pamięci
//     podręcznej trafia pod inny klucz niż odczyt;
//   * wysyłają żądania do prawdziwej bramki płatności i wiszą do limitu czasu;
//   * widzą tryb produkcyjny Stripe obok testowego.
// Wynik zależał więc od maszyny, nie od kodu. Ten moduł zdejmuje sekrety
// hosta przed każdym plikiem testowym, żeby lokalny przebieg był tym samym
// przebiegiem co CI. Testy, które potrzebują wartości, nadal ustawiają ją same
// (`vi.stubEnv`), a `vi.unstubAllEnvs` wraca do stanu BEZ sekretów.
//
// Zmienne `VITE_*` zostają: to konfiguracja publiczna, którą Vite i tak wkleja
// do `import.meta.env`, a nie sekret serwera.

/** Nazwy połączenia z backendem, które nie mają sufiksu sekretu, a są nim w praktyce. */
const BACKEND_CONNECTION_NAMES: ReadonlySet<string> = new Set([
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
]);

/** Sufiksy nazw, które w tym projekcie zawsze oznaczają poświadczenie. */
const SECRET_SUFFIXES: readonly string[] = [
  "_API_KEY",
  "_SECRET",
  "_SECRET_KEY",
  "_SERVICE_ROLE_KEY",
  "_PRIVATE_KEY",
  "_ACCESS_TOKEN",
  "_AUTH_TOKEN",
];

/** Rodziny zmiennych dostawców, których każda wartość konfiguruje prawdziwą usługę. */
const PROVIDER_PREFIXES: readonly string[] = ["VAPID_", "LOVABLE_BROWSER_"];

/** Opt-out dla świadomego przebiegu na żywych usługach (nigdy w CI). */
export const KEEP_HOST_SECRETS_FLAG = "VITEST_KEEP_HOST_SECRETS";

export function isHostSecretName(name: string): boolean {
  if (name.startsWith("VITE_")) return false;
  if (BACKEND_CONNECTION_NAMES.has(name)) return true;
  if (PROVIDER_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return SECRET_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Usuwa sekrety hosta z przekazanego środowiska (mutuje je) i zwraca posortowane
 * nazwy usuniętych zmiennych. Wartości nigdy nie są czytane ani zwracane.
 */
export function isolateHostSecrets(env: Record<string, string | undefined>): string[] {
  if (env[KEEP_HOST_SECRETS_FLAG] === "1") return [];
  const removed: string[] = [];
  for (const name of Object.keys(env)) {
    if (!isHostSecretName(name)) continue;
    delete env[name];
    removed.push(name);
  }
  return removed.sort();
}
