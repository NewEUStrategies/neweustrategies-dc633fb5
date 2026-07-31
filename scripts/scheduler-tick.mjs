#!/usr/bin/env node
/**
 * Sterownik ticku zadań tła - ścieżka REPO harmonogramu doręczeń.
 *
 * Woła POST /api/public/community-cron (albo /api/public/billing-cron) sekretem
 * z env i pilnuje, żeby jedno wywołanie GitHub Actions dało kilka ticków:
 * harmonogram Actions ma granulację 5 minut, a push musi wychodzić w minutach,
 * nie w kwadransach. Pętla trzyma się deadline'u poniżej interwału crona, więc
 * kolejne przebiegi nie zachodzą na siebie (a nawet gdy zajdą, praca jest
 * idempotentna - claimy SKIP LOCKED po stronie Postgresa).
 *
 * Ta ścieżka jest SIATKĄ BEZPIECZEŃSTWA. Podstawową jest pg_cron -> pg_net ->
 * /api/public/jobs-tick (co minutę, bez zależności od GitHuba); pierwszy tick
 * stąd uzbraja ją automatycznie (arm_job_runner), więc repo bootstrapuje bazę.
 *
 * Bez zależności (czysty Node >= 18, globalne fetch/AbortSignal) - dzięki temu
 * krok w workflow to jedno `node`, bez instalacji pakietów.
 *
 * Env:
 *   SCHEDULER_BASE_URL        wymagane, np. https://neweuropeanstrategies.com
 *   SCHEDULER_SECRET          wymagane (COMMUNITY_CRON_SECRET albo sekret runnera)
 *   SCHEDULER_ENDPOINT        domyślnie /api/public/community-cron
 *   SCHEDULER_JOB             all | push | digest-daily | digest-weekly |
 *                             event-reminders | crm-task-reminders
 *   SCHEDULER_SOURCE          domyślnie github_actions (ląduje w logu przebiegów)
 *   SCHEDULER_TICKS           liczba ticków w jednym przebiegu (domyślnie 1)
 *   SCHEDULER_INTERVAL_MS     odstęp między tickami (domyślnie 60000)
 *   SCHEDULER_DEADLINE_MS     twardy budżet przebiegu (domyślnie 240000)
 *   SCHEDULER_TIMEOUT_MS      timeout jednego żądania (domyślnie 30000)
 *
 * Kody wyjścia: 0 = wszystkie ticki OK, 1 = tick nieudany, 2 = brak konfiguracji.
 */

const env = process.env;

const BASE_URL = (env.SCHEDULER_BASE_URL ?? "").trim().replace(/\/+$/, "");
const SECRET = (env.SCHEDULER_SECRET ?? "").trim();
const ENDPOINT = (env.SCHEDULER_ENDPOINT ?? "/api/public/community-cron").trim();
const JOB = (env.SCHEDULER_JOB ?? "all").trim();
const SOURCE = (env.SCHEDULER_SOURCE ?? "github_actions").trim();
const TICKS = clampInt(env.SCHEDULER_TICKS, 1, 1, 10);
const INTERVAL_MS = clampInt(env.SCHEDULER_INTERVAL_MS, 60_000, 5_000, 600_000);
const DEADLINE_MS = clampInt(env.SCHEDULER_DEADLINE_MS, 240_000, 10_000, 3_000_000);
const TIMEOUT_MS = clampInt(env.SCHEDULER_TIMEOUT_MS, 30_000, 5_000, 120_000);
const MAX_ATTEMPTS = 3;

/** Nagłówek sekretu zależy od endpointu - rozliczenia mają własny. */
const SECRET_HEADER = ENDPOINT.includes("billing-cron")
  ? "x-billing-cron-secret"
  : "x-community-cron-secret";

function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Sekret nie może wyciec do logu przebiegu - to publiczny artefakt CI. */
function redact(text) {
  const value = String(text ?? "");
  return SECRET ? value.split(SECRET).join("***") : value;
}

function log(message) {
  console.log(redact(message));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pełny jitter na backoffie: równoległe schedulery nie wracają w tej samej chwili. */
function backoffMs(attempt) {
  const base = 2000 * 2 ** (attempt - 1);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

async function callOnce() {
  const url = `${BASE_URL}${ENDPOINT}?job=${encodeURIComponent(JOB)}&source=${encodeURIComponent(SOURCE)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      [SECRET_HEADER]: SECRET,
      "content-type": "application/json",
      "x-cron-source": SOURCE,
      "user-agent": "nes-scheduler-tick/1.0",
    },
    body: JSON.stringify({ job: JOB }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Endpoint zawsze odpowiada JSON-em; treść nie-JSON to sygnał (np. HTML 502).
  }
  return { status: response.status, payload, text: text.slice(0, 2000) };
}

/**
 * Jeden tick z ponowieniami. Ponawiamy wyłącznie to, co bywa przejściowe:
 * błąd sieci, 429 i 5xx. 401/400 to konfiguracja - ponowienie nic nie da,
 * a maskuje przyczynę.
 */
async function tick(index) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { status, payload, text } = await callOnce();
      if (status >= 200 && status < 300) {
        return { ok: true, status, payload };
      }
      const retryable = status === 429 || status >= 500;
      log(
        `tick ${index}/${TICKS}: HTTP ${status} (próba ${attempt}/${MAX_ATTEMPTS})` +
          (text ? ` - ${text}` : ""),
      );
      if (!retryable) return { ok: false, status, payload, detail: text };
      if (attempt === MAX_ATTEMPTS) return { ok: false, status, payload, detail: text };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log(`tick ${index}/${TICKS}: błąd sieci (próba ${attempt}/${MAX_ATTEMPTS}) - ${detail}`);
      if (attempt === MAX_ATTEMPTS) return { ok: false, status: 0, payload: null, detail };
    }
    await sleep(backoffMs(attempt));
  }
  return { ok: false, status: 0, payload: null, detail: "unreachable" };
}

/** Zwięzła linia wyniku: ile zadań push/digestów/przypomnień poszło. */
function summarize(payload) {
  if (!payload || typeof payload !== "object") return "brak treści";
  const parts = [];
  const push = payload.push;
  if (push && typeof push === "object") {
    parts.push(
      push.skipped
        ? `push: pominięty (${push.skipped})`
        : `push: ${push.sent ?? 0}/${push.claimed ?? 0}`,
    );
  }
  for (const [key, label] of [
    ["digestDaily", "digest dzienny"],
    ["digestWeekly", "digest tygodniowy"],
  ]) {
    const value = payload[key];
    if (value && typeof value === "object" && !value.error) {
      parts.push(`${label}: ${value.sent ?? 0}/${value.claimed ?? 0}`);
    }
  }
  if (typeof payload.eventReminders === "number") {
    parts.push(`przypomnienia o wydarzeniach: ${payload.eventReminders}`);
  }
  if (typeof payload.crmTaskReminders === "number") {
    parts.push(`follow-upy CRM: ${payload.crmTaskReminders}`);
  }
  if (payload.runnerArmed === "armed") parts.push("uzbrojono pg_cron");
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    parts.push(`błędy: ${payload.errors.join("; ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "brak pracy w kolejce";
}

async function writeStepSummary(lines) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, `${redact(lines.join("\n"))}\n`, "utf8");
}

async function main() {
  if (!BASE_URL || !SECRET) {
    console.error(
      "Brak konfiguracji: wymagane SCHEDULER_BASE_URL i SCHEDULER_SECRET " +
        "(repo: variables.APP_BASE_URL + secrets.COMMUNITY_CRON_SECRET).",
    );
    return 2;
  }
  if (!/^https?:\/\//i.test(BASE_URL)) {
    console.error(`SCHEDULER_BASE_URL musi być pełnym URL-em (jest: ${BASE_URL}).`);
    return 2;
  }

  const startedAt = Date.now();
  const summary = [`### Tick harmonogramu: \`${JOB}\` -> ${BASE_URL}${ENDPOINT}`, ""];
  let failures = 0;

  for (let index = 1; index <= TICKS; index += 1) {
    if (index > 1) {
      const remaining = DEADLINE_MS - (Date.now() - startedAt);
      if (remaining < INTERVAL_MS) {
        log(`budżet przebiegu wyczerpany - kończę po ${index - 1} tickach`);
        summary.push(`- budżet przebiegu wyczerpany po ${index - 1} tickach`);
        break;
      }
      await sleep(INTERVAL_MS);
    }

    const result = await tick(index);
    const line = summarize(result.payload);
    if (result.ok) {
      log(`tick ${index}/${TICKS}: OK - ${line}`);
      summary.push(`- ✅ tick ${index}: ${line}`);
    } else {
      failures += 1;
      const detail = result.detail ? ` - ${result.detail}` : "";
      console.error(redact(`tick ${index}/${TICKS}: PORAŻKA (HTTP ${result.status})${detail}`));
      summary.push(`- ❌ tick ${index}: HTTP ${result.status}${detail}`);
    }
  }

  summary.push("", failures === 0 ? "Wszystkie ticki OK." : `Nieudane ticki: ${failures}.`);
  await writeStepSummary(summary);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(redact(err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
