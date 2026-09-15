// Measurement Protocol GA4 - ścieżka PEWNA, bez przeglądarki.
//
// PO CO DUBLOWAĆ ZAKUP. Trafienie z przeglądarki ginie, gdy odwiedzający ma
// bloker reklam, zamknie kartę po powrocie z bramki płatniczej albo zapłaci na
// innym urządzeniu. Webhook operatora płatności wie o zapłacie zawsze, więc to
// on jest źródłem prawdy dla przychodu w GA4. `transaction_id` jest ten sam co
// w przeglądarce, dlatego GA4 deduplikuje zakup i nie liczy go dwa razy.
//
// Bez `GA4_API_SECRET` funkcja milczy - analityka nigdy nie może wywrócić
// realizacji płatności.

const ENDPOINT = "https://www.google-analytics.com/mp/collect";

export interface Ga4ServerEvent {
  name: string;
  params: Record<string, string | number | boolean | unknown[]>;
}

/**
 * @param clientId identyfikator klienta GA4 z cookie `_ga`, jeśli znamy. Gdy
 * brak, budujemy stabilny zastępnik z identyfikatora transakcji - zdarzenie
 * trafia wtedy do GA4 jako nowa sesja, ale przychód jest policzony.
 */
export async function sendGa4ServerEvent(
  events: Ga4ServerEvent[],
  clientId: string | null,
  fallbackSeed: string,
): Promise<void> {
  const apiSecret = process.env["GA4_API_SECRET"];
  if (!apiSecret || events.length === 0) return;

  const { resolveGa4MeasurementId } = await import("./measurementId");
  const measurementId = resolveGa4MeasurementId(null).measurementId;
  if (!measurementId) return;

  const url = `${ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId ?? syntheticClientId(fallbackSeed),
        non_personalized_ads: true,
        events,
      }),
    });
    if (!res.ok) {
      console.error(`GA4 MP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  } catch (error) {
    console.error("GA4 MP failed", error);
  }
}

/** GA4 oczekuje formatu `<liczba>.<liczba>`; seed daje stabilność przy retry webhooka. */
export function syntheticClientId(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 0xffffffff;
  }
  return `${hash}.${1000000000}`;
}

export async function sendGa4Purchase(input: {
  transactionId: string;
  amountCents: number | null;
  currency: string | null;
  clientId?: string | null;
}): Promise<void> {
  if (input.amountCents === null || !input.currency) return;
  await sendGa4ServerEvent(
    [
      {
        name: "purchase",
        params: {
          transaction_id: input.transactionId,
          value: Math.round(input.amountCents) / 100,
          currency: input.currency,
          items: [],
        },
      },
    ],
    input.clientId ?? null,
    input.transactionId,
  );
}
