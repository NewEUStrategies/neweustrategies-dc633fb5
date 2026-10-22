// Wspólny "tick" zadań tła wywoływany przez /api/public/jobs-tick
// (pg_cron + pg_net co minutę) oraz - awaryjnie - przez powierzchnie admina.
//
// SQL w cronie nie może wysyłać e-maili ani push-y (potrzebuje env HTTP:
// RESEND_API_KEY / VAPID_*), więc cron jedynie PUKA po HTTP do aplikacji,
// a właściwa praca dzieje się tutaj, ograniczona budżetem na wywołanie.
// Każdy rodzaj pracy jest niezależny: błąd jednego nie blokuje pozostałych.
//
// Kanały powiadomień idą przez KANONICZNY dispatcher
// (src/lib/notifications/dispatch.server.ts - kolejka notification_push_queue,
// claim_push_jobs / claim_due_digests, przypomnienia o wydarzeniach), ten sam
// co POST /api/public/community-cron. Dzięki temu push, digesty i reminders
// działają bez zewnętrznego harmonogramu - wystarczy pg_cron z migracji
// 20260713170000. Claimy są atomowe (SKIP LOCKED), więc równoległe ticki
// z obu endpointów niczego nie dublują.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { drainEmailQueues, type DrainResult } from "@/lib/email/queueDrain.server";
import { tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";
import {
  processDigests,
  processPushJobs,
  runCrmTaskReminders,
  runEventReminders,
} from "@/lib/notifications/dispatch.server";
import { countTickFailures, type SchedulerSource } from "@/lib/jobs/scheduler";
import { DATA_RETENTION_RULES } from "@/lib/privacy/dataRetention";
import { isNewsletterSunsetMailWindow } from "@/lib/privacy/newsletterSunset";
import type { NewsletterSunsetMailResult } from "@/lib/privacy/newsletterSunsetMail.server";
import { isNewsletterMeasurementMailWindow } from "@/lib/privacy/measurementReconfirm";
import type { NewsletterMeasurementMailResult } from "@/lib/privacy/measurementReconfirmMail.server";
import type { ParticipantJobResult } from "@/lib/events/jobs/types";
import { recordJobRun } from "@/lib/server/jobScheduler.server";
import type { PendingTicketRevocationsResult } from "@/lib/events/ticketRevokedNotify.server";
import type { WebhookSweepResult } from "@/lib/billing/webhookReplay.server";
import type { WalletRevocationsResult } from "@/lib/events/wallet/walletRevocationJob.server";

type DbClient = SupabaseClient<Database>;

export interface JobsTickResult {
  newsletter: { fired: number; continued: number; sent: number } | { error: string };
  /**
   * Dren kolejek pocztowych (auth_emails, transactional_emails). Do 20260731120000
   * konsumenta tej kolejki w repo NIE BYŁO: maile transakcyjne wchodziły do pgmq
   * i zostawały tam do przekroczenia TTL. Teraz drenuje je ten sam tick, który
   * wysyła kampanie - jeden harmonogram dla całej poczty wychodzącej.
   */
  emailQueue: DrainResult | { error: string };
  /**
   * Zadania funkcji uczestnika F1-F5 (spec B.10): przypomnienia (tor A),
   * cykl życia biletu - oferty z listy rezerwowej, przekazania, zwroty (tor B)
   * i follow-up po wydarzeniu - ankieta, certyfikat (tor C). Biegną PRZED
   * drenem poczty, bo to one kolejkują maile, które dren ma wysłać w tym samym
   * ticku; wspólny budżet 6 s (`PARTICIPANT_JOBS_DEADLINE_MS`).
   */
  eventParticipantReminders: ParticipantJobResult | { error: string };
  eventTicketLifecycle: ParticipantJobResult | { error: string };
  eventFollowUp: ParticipantJobResult | { error: string };
  /**
   * `skipped: "vapid_not_configured"` zamiast cichego zera: brak kluczy VAPID
   * wygląda w logu identycznie jak pusta kolejka, a to najczęstsza przyczyna
   * „push nie wychodzi" przy sprawnym harmonogramie.
   */
  push: { claimed: number; sent: number; skipped?: string } | { error: string };
  digestDaily: { claimed: number; sent: number } | { error: string };
  digestWeekly: { claimed: number; sent: number } | { error: string };
  eventReminders: number | { error: string };
  crmTaskReminders: number | { error: string };
  /**
   * Bilety z kodem QR dla zgłoszeń przyjętych DOWOLNĄ drogą (decyzja
   * organizatora, kaskada grupy, awans z rezerwy, płatność) i ponowienia po
   * nieudanej wysyłce. Do 20260926100000 krok stał wyłącznie w `community-cron`
   * (co 5 minut, szósty pod wspólnym budżetem), więc gość przyjęty przez
   * organizatora czekał na bilet do pięciu minut - albo dłużej, gdy wcześniejsze
   * kroki zjadły budżet.
   */
  eventTicketCodes: { registrations: number; sent: number; deferred: number } | { error: string };
  /**
   * Zawiadomienia gości grupy o bilecie odwołanym razem z grupą (odrzucenie
   * albo anulowanie prowadzącego, zwrot). `skipped: "migration_pending"` -
   * baza nie ma jeszcze funkcji zajęcia (migracje produkcji idą ręcznie).
   */
  eventTicketRevocations: PendingTicketRevocationsResult | { error: string };
  /**
   * Zamiatarka dziennika płatności: zdarzenia operatora `failed` (z odstępem
   * rosnącym wykładniczo) i porzucone `received` są ponawiane tą samą ścieżką
   * co dostawa od operatora. Co 5 minut - w typowym ticku to jeden pusty
   * odczyt; termin (okno 8 s, nie dalej niż koniec budżetu ticku minus
   * zapas) chroni joby po niej i zapis przebiegu przed zerwanym połączeniem.
   */
  webhookSweep: WebhookSweepResult | { error: string };
  /**
   * Przepustki Google Wallet unieważnionych biletów -> INACTIVE (OPS-14):
   * anulowanie, zwrot, nowy kod, odwołane wydarzenie. Zgłasza je baza
   * triggerami, ten krok woła Google. `skipped: "not_configured"` - portfel
   * Google nie jest skonfigurowany (nic nie zajęto), `"migration_pending"` -
   * baza nie ma jeszcze kolejki.
   */
  walletPassRevocations: WalletRevocationsResult | { error: string };
  /**
   * `archived`/`alerted`: skaner nie tylko raportuje martwe linki, ale też
   * dobiera im migawkę Internet Archive i - po przekroczeniu progu - powiadamia
   * redakcję. Oba licznikami w logu przebiegów, żeby dało się odróżnić "brak
   * zepsutych linków" od "polityka działania przestała działać".
   */
  linkCheck:
    | {
        postsScanned: number;
        linksChecked: number;
        broken: number;
        archived: number;
        alerted: number;
      }
    | { error: string };
  integrations: { claimed: number; delivered: number; failed: number } | { error: string };
  semanticIndex: { scanned: number; embedded: number; skipped?: string } | { error: string };
  /**
   * Warstwa semantyczna KATALOGU OSÓB (20260807144000). Osobne pole, nie
   * wspólny licznik z wpisami: obie kolejki mogą degradować niezależnie
   * (bramka bez embeddingów gasi obie, ale pusty katalog gasi tylko tę), a bez
   * rozdzielenia nie da się z logu odczytać, KTÓRA kolejka stoi.
   * `pruned` = wektory usunięte po opt-oucie z katalogu.
   */
  profileIndex:
    { scanned: number; embedded: number; pruned?: number; skipped?: string } | { error: string };
  /**
   * Warstwa semantyczna WĄTKÓW KLUBOWYCH. Znowu osobne pole, nie wspólny
   * licznik z profilami: tabela wektorów klubu (A6) stała pusta, bo nikt jej
   * nie karmił, i po wspólnym liczniku nie dałoby się tego odczytać z logu.
   */
  clubThreadIndex:
    { scanned: number; embedded: number; pruned?: number; skipped?: string } | { error: string };
  /**
   * Harmonogram Discussion Club (V2 §5): otwarcia grup zaplanowanych, zamknięcia
   * okien dyskusji, wygasłe kadencje ról i zaproszenia, usypianie martwych
   * tematów, odświeżenie rankingu. JEDEN job zamiast pięciu - runbook społeczności
   * opisuje jeden kanoniczny potok doręczeń, a drugi cron by go rozspoił.
   */
  clubScheduler:
    | {
        groups_opened: number;
        groups_closed: number;
        roles_expired: number;
        invitations_expired: number;
        threads_dormant: number;
        hotness_refreshed: number;
      }
    | { error: string };
  /**
   * Wygaszanie nieaktywnych subskrybentów newslettera (I9d-Y1, Z-I9c-08):
   * prośby o potwierdzenie subskrypcji w oknie dziennym (08-17 czasu
   * polskiego, minuta 9 co 10 minut - `isNewsletterSunsetMailWindow`).
   * Cykle zakłada nocny przebieg retencji; dzienny limit na najemcę
   * (reputacja domeny) trzyma baza przy zajęciu porcji. `deferred` = porcja
   * nieobsłużona przed terminem kroku (wraca po dzierżawie 15 min);
   * `skipped: "migration_pending"` = baza bez migracji 20261020162000.
   */
  newsletterSunset: NewsletterSunsetMailResult | { error: string };
  /**
   * Prośby o zgodę na pomiar otwarć i kliknięć (I9d-Y2, „Poproś o zgodę na
   * pomiar" z panelu newslettera): okno dzienne 08-17 czasu polskiego,
   * minuta 4 co 10 minut (`isNewsletterMeasurementMailWindow`) - nigdy
   * w ticku próśb wygaszania; dzienny limit najemcy WSPÓLNY z prośbami
   * wygaszania trzyma baza przy zajęciu; `skipped: "migration_pending"` =
   * baza bez 20261020162500.
   */
  newsletterMeasurement: NewsletterMeasurementMailResult | { error: string };
  /**
   * Retencja danych (I9c-X2, Z-I9b-10): jedno zadanie dzienne w oknie nocnym
   * (`isDataRetentionWindow`) - `data_retention_run` przechodzi najemców bez
   * przebiegu z 20 h, każda kategoria osobno (podgląd do `enforce_after`).
   * `more: true` = budżet czasu wyczerpany, reszta w kolejnym wywołaniu okna;
   * `skipped: "migration_pending"` = baza bez migracji 20261020161100.
   * Stan każdej kategorii pokazuje karta „Retencja danych" w
   * /admin/settings/privacy (dziennik `data_retention_runs`).
   */
  dataRetention:
    { tenants: number; more: boolean; skipped?: "migration_pending" } | { error: string };
}

/** Kto wywołał tick - ląduje w logu przebiegów (public.job_runner_runs). */
export interface JobsTickMeta {
  source?: SchedulerSource;
  /** Tylko tick ręczny z panelu: ślad audytowy (tenant + operator). */
  tenantId?: string | null;
  actorId?: string | null;
}

// Globalny budżet czasu jednego ticku. Joby biegną sekwencyjnie; gdy budżet się
// wyczerpie, KOLEJNE grupy są pomijane (zwracają { error: "skipped_time_budget" })
// zamiast ryzykować przekroczenie timeoutu workera i zabicie ticku w połowie.
// Wszystkie joby są idempotentne/watermarkowe, więc pominięte wracają w następnym
// ticku. Uzupełnia to re-claim dostaw integracji utkniętych w 'delivering'.
const JOBS_TICK_DEADLINE_MS = 25_000;

/**
 * Deadline drenu poczty w ramach ticku. Kolejka po awarii dostawcy potrafi mieć
 * tysiące wiadomości; bez własnego, wcześniejszego limitu jeden dren wyczerpałby
 * cały budżet ticku i zagłodził przypomnienia oraz push. Reszta kolejki wyjdzie
 * w następnej minucie - tick biegnie co minutę, a wysyłka jest idempotentna.
 */
const EMAIL_DRAIN_DEADLINE_MS = 10_000;

/**
 * Wspólny budżet trzech zadań uczestnika (liczony od startu ticku). Każde
 * zadanie ma też własne sufity porcji (A <= 60 rezerwacji, B <= 20 pozycji,
 * C <= 30) - deadline chroni dren poczty, sufity chronią bazę.
 */
export const PARTICIPANT_JOBS_DEADLINE_MS = 6_000;

/**
 * Minimum czasu, które dren poczty dostaje NAWET po zadaniach uczestnika.
 * Zadania mogą zjeść swoje 6 s; bez tego minimum dren startowałby z deadline'em
 * już w przeszłości i nie wysłał nic - także maili, które te zadania właśnie
 * zakolejkowały.
 */
const EMAIL_DRAIN_MIN_WINDOW_MS = 4_000;

/**
 * Termin wysyłki biletów z kodem QR, liczony od startu ticku - z tego samego
 * powodu co dren poczty. Jedno zgłoszenie z kolejki bywa grupą do 50 osób,
 * więc partia bez terminu po wdrożeniu (zaległe zapisy RSVP, naprawa backfillu
 * 0044) zjadłaby cały budżet i zagłodziła skan linków, integracje i klub.
 * 7 s zapasu do budżetu ticku zostaje na joby po biletach.
 */
const TICKET_CODES_DEADLINE_MS = 18_000;

/**
 * Termin zawiadomień o biletach odwołanych razem z grupą - 2 s po terminie
 * biletów, bo krok stoi zaraz za nimi, a zawiadomienie to jeden mail bez
 * wydania kodu. 5 s zapasu do budżetu ticku zostaje dla jobów sieciowych.
 */
const TICKET_REVOCATIONS_DEADLINE_MS = 20_000;

/**
 * Okno zamiatarki dziennika płatności, liczone od JEJ startu (ms). Jedno
 * odtworzenie zdarzenia to kilka zapytań i czasem żądanie do operatora, więc
 * 8 s mieści kilka wierszy, a reszta wraca za 5 minut - przejęcia są
 * warunkowe, nic się nie dubluje. Okno, a nie „do końca budżetu ticku":
 * zaległość w dzienniku nie może co piąty tick zjadać czasu jobom po
 * zamiatarce (integracje, indeksy).
 */
const WEBHOOK_SWEEP_WINDOW_MS = 8_000;

/**
 * Zapas ticku po zamiatarce (ms): zapis przebiegu w `job_runner_runs`
 * i odpowiedź muszą zdążyć przed zerwaniem połączenia przez pg_net
 * (25 s = `JOBS_TICK_DEADLINE_MS`). Termin zamiatarki nigdy nie wychodzi
 * poza koniec budżetu ticku minus ten zapas.
 *
 * Termin to chwila, do której zamiatarka ZACZYNA wiersze i na nie czeka
 * (przegląd 3.0 i regresja po nim). Wiersz zaczęty tuż przed terminem nie
 * ginie z zerwanym połączeniem: zamiatarka rejestruje każdy wiersz „za
 * odpowiedzią" od startu, a runtime daje takiej pracy 30 s po rozłączeniu
 * (`WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS`). Bramka „pełne 20 s budżetu
 * wiersza PRZED terminem" przy terminie 23 s od startu ticku przepuszczała
 * wiersze tylko wtedy, gdy zamiatarka ruszyła w pierwszych ~3 s - po
 * zwykłym drenie poczty czy digestach odkładała wszystko, a log pokazywał
 * `ok:true`.
 */
const WEBHOOK_SWEEP_TAIL_RESERVE_MS = 2_000;

/**
 * Termin dezaktywacji przepustek Google Wallet - 2 s po zawiadomieniach.
 * Partia jest mała (10), a każde wywołanie ma własny limit 8 s, więc krok
 * zostawia budżet jobom sieciowym za nim; reszta kolejki wraca w następnej
 * minucie (dzierżawa w bazie).
 */
const WALLET_REVOCATIONS_DEADLINE_MS = 22_000;

/**
 * Okno kroku wygaszania newslettera, liczone od JEGO startu (ms). Prośba to
 * render maila i kilka zapytań, więc 4 s mieści sensowną porcję, a reszta
 * wraca po dzierżawie bazy - krok stoi za jobami sieciowymi i nie może zjeść
 * zapasu na zapis przebiegu (termin przycięty jak u zamiatarki płatności).
 * Ten sam termin ma krok próśb o zgodę na pomiar (I9d-Y2) - mail tej samej
 * wagi, inna minuta okna.
 */
const NEWSLETTER_SUNSET_WINDOW_MS = 4_000;

/** Uruchamia krok joba tylko w ramach budżetu czasu; błąd/pominięcie łapie w
 *  wspólnym kształcie `{ error }` (każde pole JobsTickResult go dopuszcza). */
async function runJobStep<T>(
  overBudget: () => boolean,
  fn: () => Promise<T>,
): Promise<T | { error: string }> {
  if (overBudget()) return { error: "skipped_time_budget" };
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cykl pracy: tick biegnie co minutę (push musi być natychmiastowy), ale joby
 * kosztowne sieciowo nie mają sensu z taką częstotliwością - link-check i
 * embeddingi mielą wtedy ten sam budżet co minutę i zjadają czas potrzebny
 * na wysyłki. Bramkujemy je po minucie zegara UTC: praca jest watermarkowa,
 * więc rzadszy rytm niczego nie gubi, jedynie rozkłada koszt.
 */
export function everyNthMinute(n: number, now = new Date()): boolean {
  return now.getUTCMinutes() % n === 0;
}

/**
 * Okno nocne retencji danych: 02:07-02:57 UTC co 10 minut (sześć szans na
 * dobę). Jedna minuta wypadająca z ticku (awaria, budżet) nie przesuwa
 * zadania o dobę, a baza i tak przyjmuje najemcę tylko raz na 20 h (albo
 * ponownie przy zaległości). Minuta 7 omija pełne godziny i dziesiątki, na
 * których stoją inne zadania; godzina 2 UTC - przed czyszczeniami pg_cron
 * (03:20-03:53 UTC), które nie dotykają tych samych tabel.
 */
export function isDataRetentionWindow(now = new Date()): boolean {
  return now.getUTCHours() === 2 && now.getUTCMinutes() % 10 === 7;
}

export async function runJobsTick(
  admin: DbClient,
  meta: JobsTickMeta = {},
): Promise<JobsTickResult> {
  const startedAt = Date.now();
  const tickTime = new Date(startedAt);
  const overBudget = () => Date.now() - startedAt > JOBS_TICK_DEADLINE_MS;
  const skipped = { error: "skipped_duty_cycle" } as const;

  // Kolejność: tanie joby (DB-only) najpierw, kosztowne sieciowe (link-check,
  // integracje, embeddingi) na końcu - to one są pomijane pierwsze przy
  // wyczerpaniu budżetu, a nie krytyczne wysyłki/przypomnienia.
  const newsletter = await runJobStep(overBudget, () => tickNewsletterCampaigns(admin, {}));
  // Zadania uczestnika F1-F5 PRZED drenem poczty: kolejkują przypomnienia,
  // oferty miejsc i zaproszenia do ankiety, które dren wyśle w tym samym
  // ticku. Moduły są ładowane leniwie (każdy tor wymienia treść swojego).
  const participantDeadlineAt = startedAt + PARTICIPANT_JOBS_DEADLINE_MS;
  const eventParticipantReminders = await runJobStep(overBudget, async () => {
    const { runEventParticipantReminders } = await import("@/lib/events/jobs/reminderJob.server");
    return runEventParticipantReminders(admin, { deadlineAt: participantDeadlineAt });
  });
  const eventTicketLifecycle = await runJobStep(overBudget, async () => {
    const { runEventTicketLifecycle } = await import("@/lib/events/jobs/ticketLifecycleJob.server");
    return runEventTicketLifecycle(admin, { deadlineAt: participantDeadlineAt });
  });
  const eventFollowUp = await runJobStep(overBudget, async () => {
    const { runEventFollowUp } = await import("@/lib/events/jobs/followUpJob.server");
    return runEventFollowUp(admin, { deadlineAt: participantDeadlineAt });
  });
  // Poczta 1:1 (autoryzacja, transakcyjne, digesty) idzie zaraz po kampaniach
  // i zadaniach uczestnika: link do logowania i ostrzeżenie o nieudanej
  // płatności starzeją się szybciej niż cokolwiek innego w ticku. Dren dostaje
  // własny, krótszy deadline, żeby duża kolejka nie zjadła budżetu
  // przypomnieniom i przypisaniom - ale nigdy mniej niż 4 s od teraz.
  const emailQueue = await runJobStep(overBudget, () =>
    drainEmailQueues(admin, {
      maxMessages: 60,
      deadlineAt: Math.max(
        startedAt + EMAIL_DRAIN_DEADLINE_MS,
        Date.now() + EMAIL_DRAIN_MIN_WINDOW_MS,
      ),
    }),
  );
  const push = await runJobStep(overBudget, () => processPushJobs(100));
  // Digesty mają własne okna czasowe w claim_due_digests - wystarczy zaglądać
  // co 5 minut zamiast co minutę (dwa RPC mniej na tick).
  const digestsDue = everyNthMinute(5, tickTime);
  const digestDaily = digestsDue
    ? await runJobStep(overBudget, () => processDigests("daily", 50))
    : skipped;
  const digestWeekly = digestsDue
    ? await runJobStep(overBudget, () => processDigests("weekly", 50))
    : skipped;
  // Follow-upy CRM: skaner watermarkowy (run_crm_task_reminders) enqueue'uje
  // notyfikacje kind 'crm_task' + emituje crm_task.due.v1 na szynę.
  const eventReminders = await runJobStep(overBudget, () => runEventReminders());
  const crmTaskReminders = await runJobStep(overBudget, () => runCrmTaskReminders());
  // Bilety z kodem QR: to też wysyłka 1:1, więc stoi razem z przypomnieniami,
  // PRZED jobami kosztownymi sieciowo. Partia 20, nie 50 jak w community-cron:
  // każdy bilet to dwa rendery maila i kilka zapytań, a tick biegnie co minutę -
  // mniejsza partia co minutę daje większą przepustowość niż duża co pięć.
  // `community-cron` zostaje siatką bezpieczeństwa (zajęcia są dzierżawione,
  // więc oba ticki niczego nie dublują).
  const eventTicketCodes = await runJobStep(overBudget, async () => {
    const { runPendingTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    return runPendingTicketCodes(20, startedAt + TICKET_CODES_DEADLINE_MS);
  });
  // Zawiadomienia o biletach odwołanych razem z grupą: ta sama rodzina poczty
  // 1:1, zaraz po biletach. Stempel stawia baza w instrukcji zamykającej gościa.
  const eventTicketRevocations = await runJobStep(overBudget, async () => {
    const { runPendingTicketRevocations } = await import("@/lib/events/ticketRevokedNotify.server");
    return runPendingTicketRevocations(20, startedAt + TICKET_REVOCATIONS_DEADLINE_MS);
  });
  // Zamiatarka dziennika płatności: PO wysyłkach 1:1 (one starzeją się
  // szybciej), ale PRZED jobami kosztownymi sieciowo - zdarzenie, które padło,
  // to klient, który zapłacił i czeka na dostęp. Co 5 minut: odstęp ponowień
  // i tak liczy się w minutach, a pusty dziennik kosztuje jeden odczyt.
  // Termin = własne okno zamiatarki (8 s od jej startu), przycięte do końca
  // budżetu ticku minus zapas na zapis przebiegu.
  const webhookSweep = everyNthMinute(5, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { sweepWebhookEvents } = await import("@/lib/billing/webhookReplay.server");
        return sweepWebhookEvents({
          deadlineAt: Math.min(
            Date.now() + WEBHOOK_SWEEP_WINDOW_MS,
            startedAt + JOBS_TICK_DEADLINE_MS - WEBHOOK_SWEEP_TAIL_RESERVE_MS,
          ),
        });
      })
    : skipped;

  // Przepustki Google Wallet unieważnionych biletów: wywołanie zewnętrznego
  // API, więc ZA wysyłkami 1:1 i przed jobami kosztownymi sieciowo.
  const walletPassRevocations = await runJobStep(overBudget, async () => {
    const { runWalletPassRevocations } =
      await import("@/lib/events/wallet/walletRevocationJob.server");
    return runWalletPassRevocations(admin, {
      limit: 10,
      deadlineAt: startedAt + WALLET_REVOCATIONS_DEADLINE_MS,
    });
  });
  // Rotacyjny skan linków wychodzących (B7): 6 wpisów co 15 minut zamiast 3 co
  // minutę - ta sama przepustowość dzienna przy ~15x mniejszym ruchu HTTP.
  const linkCheck = everyNthMinute(15, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runLinkCheckBatch } = await import("@/lib/server/linkCheck.server");
        return runLinkCheckBatch(admin, 6);
      })
    : skipped;
  // Dren outboxu integracji (D2): dostawy webhooków płyną cronem.
  const integrations = await runJobStep(overBudget, async () => {
    const { runIntegrationDispatch } = await import("@/lib/integrations/dispatch.functions");
    return runIntegrationDispatch(20);
  });
  // Warstwa semantyczna wyszukiwarki: embeddingi tytuł+zajawka, co 5 minut.
  const semanticIndex = everyNthMinute(5, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runSemanticIndexBatch } = await import("@/lib/server/embeddings.server");
        return runSemanticIndexBatch(admin, 24);
      })
    : skipped;
  // Wektory PROFILI: rzadziej niż wpisy (co 15 minut, partia 16), bo profil
  // zmienia się o rzędy wielkości rzadziej niż pojawia się nowa treść, a obie
  // kolejki dzielą ten sam limit bramki. Sprzątanie po opt-oucie z katalogu
  // (`prune`) jest raz na godzinę - to operacja czysto bazowa i tania.
  const profileIndex = everyNthMinute(15, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runProfileSemanticIndexBatch } = await import("@/lib/server/embeddings.server");
        return runProfileSemanticIndexBatch(admin, 16, { prune: everyNthMinute(60, tickTime) });
      })
    : skipped;

  // Wektory WĄTKÓW KLUBOWYCH: co 15 minut, partia 16 - ta sama kadencja co
  // profile, bo obie kolejki dzielą limit bramki embeddingów, a dyskusja
  // klubowa nie musi być przeszukiwalna semantycznie w minutę od publikacji.
  // Sprzątanie raz na godzinę (operacja czysto bazowa).
  const clubThreadIndex = everyNthMinute(15, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runClubThreadIndexBatch } = await import("@/lib/server/embeddings.server");
        return runClubThreadIndexBatch(admin, 16, { prune: everyNthMinute(60, tickTime) });
      })
    : skipped;

  // Harmonogram klubów: operacja czysto bazowa i tania (jeden RPC), ale nie ma
  // sensu co minutę - grupa otwierana "co do minuty" i tak czeka na najbliższy
  // tick, a kadencje ról są egzekwowane w locie przez club_effective_member_role,
  // więc ten job je tylko sprząta. Co 5 minut wystarcza.
  const clubScheduler = everyNthMinute(5, tickTime)
    ? await runJobStep(overBudget, async () => {
        const { data, error } = await admin.rpc("club_scheduler_tick");
        if (error) throw error;
        const row = (data ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
        return {
          groups_opened: n(row.groups_opened),
          groups_closed: n(row.groups_closed),
          roles_expired: n(row.roles_expired),
          invitations_expired: n(row.invitations_expired),
          threads_dormant: n(row.threads_dormant),
          hotness_refreshed: n(row.hotness_refreshed),
        };
      })
    : skipped;

  // Wygaszanie newslettera (I9d-Y1): prośby o potwierdzenie subskrypcji
  // w oknie dziennym. Poczta masowa o najniższym priorytecie - ZA wysyłkami
  // 1:1 i jobami sieciowymi; wiadomości wychodzą drenem w następnym ticku.
  // Moduł ładowany leniwie (render React Email, podpis linku).
  const newsletterSunset = isNewsletterSunsetMailWindow(tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runNewsletterSunsetMail } =
          await import("@/lib/privacy/newsletterSunsetMail.server");
        return runNewsletterSunsetMail(admin, {
          deadlineAt: Math.min(
            Date.now() + NEWSLETTER_SUNSET_WINDOW_MS,
            startedAt + JOBS_TICK_DEADLINE_MS - WEBHOOK_SWEEP_TAIL_RESERVE_MS,
          ),
        });
      })
    : skipped;

  // Prośby o zgodę na pomiar (I9d-Y2): ta sama klasa poczty co wygaszanie
  // (masowa, najniższy priorytet, za jobami sieciowymi) i ten sam termin
  // kroku - inna minuta okna, więc oba kroki nigdy nie dzielą jednego ticku,
  // a wspólny dzienny limit najemcy pilnuje baza. Moduł ładowany leniwie.
  const newsletterMeasurement = isNewsletterMeasurementMailWindow(tickTime)
    ? await runJobStep(overBudget, async () => {
        const { runNewsletterMeasurementMail } =
          await import("@/lib/privacy/measurementReconfirmMail.server");
        return runNewsletterMeasurementMail(admin, {
          deadlineAt: Math.min(
            Date.now() + NEWSLETTER_SUNSET_WINDOW_MS,
            startedAt + JOBS_TICK_DEADLINE_MS - WEBHOOK_SWEEP_TAIL_RESERVE_MS,
          ),
        });
      })
    : skipped;

  // Retencja danych: OSTATNIA - czysto bazowa, raz na dobę, z własnym budżetem
  // czasu w SQL (8 s); stoi za wszystkim, co ma termin dla czytelnika.
  const dataRetention = isDataRetentionWindow(tickTime)
    ? await runJobStep(overBudget, async () => {
        const { data, error } = await admin.rpc("data_retention_run", {
          p_limit: DATA_RETENTION_RULES.batchDefault,
        });
        if (error) {
          const { isMigrationPending } = await import("@/lib/supabase/migrationPending");
          if (isMigrationPending(error)) {
            return { tenants: 0, more: false, skipped: "migration_pending" as const };
          }
          throw error;
        }
        const row = (data ?? {}) as Record<string, unknown>;
        return {
          tenants: typeof row.tenants === "number" ? row.tenants : Number(row.tenants ?? 0),
          more: row.more === true,
        };
      })
    : skipped;

  const result: JobsTickResult = {
    newsletter,
    eventParticipantReminders,
    eventTicketLifecycle,
    eventFollowUp,
    emailQueue,
    push,
    digestDaily,
    digestWeekly,
    eventReminders,
    crmTaskReminders,
    eventTicketCodes,
    eventTicketRevocations,
    webhookSweep,
    walletPassRevocations,
    linkCheck,
    integrations,
    semanticIndex,
    profileIndex,
    clubThreadIndex,
    clubScheduler,
    newsletterSunset,
    newsletterMeasurement,
    dataRetention,
  };

  // Heartbeat: KAŻDY tick (cron bazy, scheduler repo, ręczny z panelu) zostawia
  // wpis w public.job_runner_runs. To jedyny sposób, żeby odróżnić "kolejka
  // pusta" od "nikt nie woła dyspozytora" - pg_net jest fire-and-forget, więc
  // bez tego wpisu awaria harmonogramu jest niewidzialna. Zapis jest
  // best-effort i nie może unieważnić pracy, która już się wykonała.
  const failures = countTickFailures(result);
  try {
    await recordJobRun(
      {
        source: meta.source ?? "external",
        job: "all",
        ok: failures.length === 0,
        durationMs: Date.now() - startedAt,
        result,
        error: failures.length > 0 ? failures.join("; ") : null,
        tenantId: meta.tenantId ?? null,
        actorId: meta.actorId ?? null,
      },
      admin,
    );
  } catch (error) {
    console.error("[jobs-tick] recording completed work failed", error);
  }

  return result;
}

/**
 * Porównanie sekretów w STAŁYM CZASIE (`node:crypto`, nie `===`) ze ŚWIADOMYM
 * strażnikiem długości.
 *
 * CO NAPRAWDĘ ZACHODZI. `&&` zwraca `false` bez wchodzenia w `timingSafeEqual`,
 * więc różnica DŁUGOŚCI jest rozstrzygana wcześniej - i tak ma być. Poprzednia
 * wersja tego komentarza twierdziła coś przeciwnego („długości też nie
 * zdradzamy wcześniej"); kod był poprawny, zdanie nie.
 *
 * DLACZEGO STRAŻNIK TU STOI. `timingSafeEqual` RZUCA `RangeError` na buforach
 * różnej długości, a żaden z czterech wołających nie owija wywołania w `try`
 * (`api/public/jobs-tick`, `platform/email/transactional/preview`,
 * `platform/email/auth/preview`, `platform/email/queue/process`). Bez strażnika
 * sekret złej długości dawałby 500 zamiast 401/403 na trasie publicznej: ten
 * sam oracle dla atakującego, tylko głośniejszy i z fałszywym alarmem
 * w monitoringu.
 *
 * DLACZEGO WYCIEK DŁUGOŚCI JEST TU BEZ WARTOŚCI. Sekret ticku powstaje jako
 * `encode(gen_random_bytes(24), 'hex')` - DEFAULT kolumny (migracja
 * 20260713170000) i ta sama formuła w obu ścieżkach samozbrojenia
 * (20260731110000, 20260731120352) - więc na każdej ścieżce zapisu W TYM
 * REPOZYTORIUM ma 48 znaków, a panel nie umie go nadpisać:
 * `updateJobRunnerSettings` zapisuje wyłącznie `enabled` i `base_url`.
 * ŚWIADOMIE nie piszę „stała schematu": kolumna nie ma CHECK-a, więc dostęp
 * service-role albo ręczny SQL może wpisać dowolną długość. Ta długość jest
 * jednak opublikowana w migracjach tego repozytorium, czyli nie niesie
 * entropii; tajne są BAJTY i to one idą przez `timingSafeEqual`. Pozostali
 * trzej wołający porównują klucze ze zmiennych środowiskowych, których
 * długość narzuca wystawca, nie my.
 */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
