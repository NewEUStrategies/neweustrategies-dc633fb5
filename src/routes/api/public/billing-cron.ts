// Harmonogram rozliczeń: automatyczne przypomnienia mailowe o zbliżającym się
// odnowieniu subskrypcji oraz o kończącym się dostępie po anulowaniu, domknięcie
// karencji miejsc zespołowych, zawieszenie zespołów po karencji płatności
// (SUB-03) i dobowa siatka bezpieczeństwa zamiatarki dziennika płatności
// (ścieżką podstawową jest tick zadań co 5 minut).
//
// Wywoływany przez zewnętrzny scheduler raz na dobę z sekretem w nagłówku.
// Idempotencja żyje w warstwie wysyłki (klucz = subskrypcja + data graniczna),
// więc powtórne wywołania są bezpieczne.
//
// Sekret jest WŁASNY (PAY-17a, przegląd 3.5/7.9) i otwierają go WYŁĄCZNIE:
//   * `BILLING_CRON_SECRET` ze środowiska (scheduler repo, ręczne wywołanie),
//   * `job_runner_settings.billing_secret` - prywatny sekret rozliczeń, którym
//     puka pg_cron (`invoke_billing_cron`).
// NIGDY sekret wspólny: ani `COMMUNITY_CRON_SECRET`, ani sekret runnera
// (`job_runner_settings.secret`), który otwiera community-cron i jobs-tick
// i który `scheduler.yml` dopuszczał jako sekret społeczności. Kto znał sekret
// od digestów, uruchamiał masową wysyłkę maili do abonentów i odbieranie
// dostępu zespołom - z innym właścicielem i inną rotacją tego sekretu.
//
//   curl -X POST https://neweuropeanstrategies.com/api/public/billing-cron \
//     -H "x-billing-cron-secret: $BILLING_CRON_SECRET" \
//     -H "content-type: application/json" -d '{"leadDays":3}'
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { timingSafeEqual } from "node:crypto";
import { createRateLimiter, rateLimitIpSubject } from "@/lib/http/rateLimit";

const limiter = createRateLimiter({ capacity: 10, refillPerSec: 0.2 });

/**
 * Ile czeka na odpowiedź wołający cyklu (ms): pg_net w `invoke_billing_cron`
 * (`timeout_milliseconds := 60000`, migracja `billing_cron_own_secret`)
 * i scheduler repo (`SCHEDULER_TIMEOUT_MS` kroku „Tick rozliczeń"). Test
 * pilnuje, że wszystkie trzy wartości są równe.
 */
export const BILLING_CRON_CALLER_TIMEOUT_MS = 60_000;

/**
 * Zapas przed terminem wołającego na odpowiedź po zamiatarce (ms).
 */
const BILLING_CRON_RESPONSE_RESERVE_MS = 2_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function constantEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `BILLING_CRON_SECRET` ze środowiska. Wartość równa sekretowi społeczności
 * jest błędem konfiguracji, a nie sekretem rozliczeń: odmawiamy i logujemy,
 * zamiast po cichu otworzyć rozliczenia każdemu, kto zna sekret od digestów.
 */
function envSecretMatches(provided: string | null): boolean {
  const expected = process.env.BILLING_CRON_SECRET;
  if (!expected || !provided) return false;
  if (!constantEquals(provided, expected)) return false;
  const community = process.env.COMMUNITY_CRON_SECRET;
  if (community && constantEquals(expected, community)) {
    console.error(
      "[billing-cron] BILLING_CRON_SECRET jest równy COMMUNITY_CRON_SECRET - odmowa; ustaw osobny sekret rozliczeń",
    );
    return false;
  }
  return true;
}

/**
 * Sekret harmonogramu w bazie (pg_cron -> net.http_post): prywatna kolumna
 * `job_runner_settings.billing_secret` (odczyt wyłącznie service-role, CHECK:
 * różna od sekretu runnera). Sekretu runnera (`secret`) celowo NIE czytamy -
 * otwiera community-cron i jobs-tick, więc nie może otwierać rozliczeń.
 */
async function dbSecretMatches(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("job_runner_settings")
      .select("enabled, billing_secret")
      .eq("id", 1)
      .maybeSingle();
    const cfg = (data ?? null) as { enabled: boolean; billing_secret: string | null } | null;
    if (!cfg?.enabled || !cfg.billing_secret) return false;
    return constantEquals(provided, cfg.billing_secret);
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/billing-cron")({
  server: {
    handlers: {
      POST: async () => {
        // Termin wołającego liczy się od przyjęcia żądania - zamiatarka po
        // przypomnieniach nie może przeciągnąć cyklu poza niego.
        const requestStartedAt = Date.now();
        const req = getRequest();
        if (!limiter.check(rateLimitIpSubject(req.headers), Date.now())) {
          return new Response(null, { status: 429 });
        }
        const provided = req.headers.get("x-billing-cron-secret");
        if (!envSecretMatches(provided) && !(await dbSecretMatches(provided))) {
          return json({ error: "unauthorized" }, 401);
        }

        let leadDays = 3;
        let seatGraceReminderDays: number[] | null = null;
        try {
          const body = (await req.json()) as {
            leadDays?: number;
            seatGraceReminderDays?: unknown;
          };
          if (typeof body?.leadDays === "number" && body.leadDays >= 1 && body.leadDays <= 30) {
            leadDays = Math.round(body.leadDays);
          }
          if (Array.isArray(body?.seatGraceReminderDays)) {
            const parsed = body.seatGraceReminderDays.filter(
              (value): value is number => typeof value === "number",
            );
            if (parsed.length > 0) seatGraceReminderDays = parsed;
          }
        } catch {
          // brak body = domyślne 3 dni i progi z konfiguracji organizacji
        }

        try {
          const { runBillingReminders } = await import("@/lib/billing/reminders.server");
          // Ta sama doba: domykamy karencje miejsc zespołowych, którym minął
          // termin - dostęp gaśnie dopiero tutaj, wraz z mailem końcowym.
          const { expireSeatGrace, sendSeatGraceReminders, suspendTeamsPastPaymentGrace } =
            await import("@/lib/organizations/teamSeats.server");

          // KAŻDE ZADANIE JEST ODDZIELNE. Wcześniej `runBillingReminders`
          // biegło NAGO we wspólnym `try`, więc pojedyncza czkawka bazy
          // (timeout puli, `statement_timeout`, zerwane połączenie) przy odczycie
          // subskrypcji przerywała CAŁY cykl: wspólny `catch` oddawał 500,
          // a dwa pozostałe zadania nie startowały w ogóle. Harmonogram chodzi
          // RAZ NA DOBĘ, więc pominięte `expireSeatGrace()` znaczy, że ludzie
          // po karencji zachowują płatny dostęp do następnej doby, a pominięte
          // `sendSeatGraceReminders()` znaczy, że próg „1 dzień do końca"
          // przepada bezpowrotnie (nazajutrz zostało 0 dni i warunek progu
          // nie zadziała). Jedna sekunda awarii bazy kosztowała więc cichą
          // utratę całego dnia obsługi zespołów.
          let remindersError: unknown = null;
          const result = await runBillingReminders(leadDays).catch((err: unknown) => {
            remindersError = err;
            return null;
          });
          // Najpierw przypomnienia (progi per organizacja albo z body jako
          // nadpisanie), potem domknięcie karencji, żeby ta sama doba nie
          // wysłała przypomnienia i maila końcowego naraz.
          const reminders = await sendSeatGraceReminders(seatGraceReminderDays).catch(() => ({
            checked: 0,
            sent: 0,
            days: [] as number[],
            perOrg: true,
          }));
          const seats = await expireSeatGrace().catch(() => ({ expired: 0, notified: 0 }));
          // Karencja PŁATNOŚCI planu Zespół: po ostatniej nieudanej próbie
          // operator potrafi nie wysłać już żadnego zdarzenia, a organizacja
          // (w odróżnieniu od uprawnienia indywidualnego) nie wygasa sama z daty.
          const paymentGrace = await suspendTeamsPastPaymentGrace().catch(() => ({
            suspended: 0,
          }));

          // NA KOŃCU dobowa siatka bezpieczeństwa zamiatarki dziennika płatności - na
          // wypadek, gdyby tick zadań (pg_cron co minutę) stał. Zamiatarka nie
          // rzuca, a jej wynik NIE zmienia kodu odpowiedzi: o 500 decydują
          // wyłącznie przypomnienia, jak dotąd.
          //
          // TERMIN to chwila, w której wołający zrywa połączenie, minus zapas
          // na odpowiedź (przegląd 3.0) - a nie okno doklejone po
          // przypomnieniach. Zamiatarka zaczyna wiersze do tego terminu i na
          // nie czeka najwyżej do niego. Wiersz zaczęty tuż przed terminem nie
          // ginie z zerwanym połączeniem: jest od startu zarejestrowany „za
          // odpowiedzią", a okno takiej pracy (30 s,
          // `WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS`) mieści budżet wiersza.
          const webhookSweep = await import("@/lib/billing/webhookReplay.server")
            .then(({ sweepWebhookEvents }) =>
              sweepWebhookEvents({
                deadlineAt:
                  requestStartedAt +
                  BILLING_CRON_CALLER_TIMEOUT_MS -
                  BILLING_CRON_RESPONSE_RESERVE_MS,
              }),
            )
            .catch((err: unknown) => ({
              error: err instanceof Error ? err.message : String(err),
            }));

          // KONTRAKT ODPOWIEDZI ZOSTAJE BEZ ZMIAN: padnięcie przypomnień nadal
          // daje 500 `cron_failed`, bo zewnętrzny scheduler opiera na tym kodzie
          // alarmowanie i ponowienie (ponowienie jest bezpieczne - idempotencja
          // siedzi w warstwie wysyłki). Zmienia się WYŁĄCZNIE to, że pozostałe
          // zadania zdążyły się wykonać, zanim zgłosimy porażkę.
          if (result === null) {
            console.error("[billing-cron] failed", remindersError);
            return json({ error: "cron_failed" }, 500);
          }

          return json({
            ok: true,
            leadDays,
            ...result,
            seatGraceReminders: reminders,
            seatGrace: seats,
            teamPaymentGrace: paymentGrace,
            webhookSweep,
          });
        } catch (err) {
          console.error("[billing-cron] failed", err);
          return json({ error: "cron_failed" }, 500);
        }
      },
    },
  },
});
