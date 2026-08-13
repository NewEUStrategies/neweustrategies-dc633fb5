// Bramka: panel zdrowia nie może mówić „poczta skonfigurowana" na innej
// podstawie niż realny dostawca.
//
// CO SIĘ STAŁO. `scheduler.functions.ts` liczyło pole `emailGatewayConfigured`
// na miejscu, jako `Boolean(RESEND_API_KEY || LOVABLE_API_KEY)`. Jedyne miejsce,
// które naprawdę decyduje o wysyłce, mówi coś innego:
//
//   emailProviderConfigured() = resendConfigured() || platformMailerConfigured()
//                             = (LOVABLE && RESEND)  ||  LOVABLE
//
// czyli sam `RESEND_API_KEY` NIE wystarcza. Przy takiej konfiguracji
// `SchedulerHealthPanel` pokazywał zieloną plakietkę i ukrywał ostrzeżenie,
// a poczta nie wyszłaby ani razu. Import `emailProviderConfigured` leżał w tym
// pliku bez użycia - poprawka była zaczęta i nieskończona.
//
// DLACZEGO ASERCJA JEST STATYCZNA. Pole powstaje wewnątrz server function
// czytającej `process.env` i RPC bazy; test integracyjny wymagałby obu.
// Tu chodzi o coś tańszego i trwalszego: żeby ŹRÓDŁEM prawdy pozostała
// funkcja, a nie skopiowane wyrażenie. Ta klasa błędu wraca przez
// „dopiszę tu jeszcze jeden klucz", nie przez zmianę logiki dostawcy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCHEDULER = "src/lib/admin/scheduler.functions.ts";
const PROVIDER = "src/lib/email/provider.server.ts";

const scheduler = readFileSync(SCHEDULER, "utf8");
const provider = readFileSync(PROVIDER, "utf8");

describe("panel zdrowia harmonogramu - źródło prawdy o poczcie", () => {
  it("pole `emailGatewayConfigured` pyta dostawcę, nie zmienne środowiskowe", () => {
    // Nazwa pola występuje w pliku DWA razy: w typie zwrotnym
    // (`emailGatewayConfigured: boolean;`) i w przypisaniu. Interesuje nas
    // wyłącznie przypisanie - pierwsza wersja tej asercji brała deklarację
    // typu i oblewała na poprawnym kodzie.
    const assignments = scheduler
      .split("\n")
      .map((text) => text.trim())
      .filter((text) => text.startsWith("emailGatewayConfigured:"))
      .filter((text) => !/:\s*boolean;?$/.test(text));
    expect(assignments, `brak przypisania emailGatewayConfigured w ${SCHEDULER}`).toHaveLength(1);
    expect(assignments[0]).toContain("emailProviderConfigured()");
  });

  it("w całym pliku nie ma własnego testu kluczy poczty", () => {
    // Nawet poza tym jednym polem: gdyby ktoś dopisał drugie miejsce
    // z `RESEND_API_KEY`, rozjazd wróciłby pod inną nazwą.
    const offenders = scheduler
      .split("\n")
      .map((text, index) => ({ text, line: index + 1 }))
      .filter(({ text }) => /process\.env\.(RESEND_API_KEY|LOVABLE_API_KEY)/.test(text))
      .map(({ line, text }) => `${SCHEDULER}:${line} ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("dostawca nadal uznaje sam RESEND za niewystarczający - inaczej ta bramka nie ma sensu", () => {
    // Gdyby `resendConfigured()` przestało wymagać `LOVABLE_API_KEY`, oba
    // wyrażenia zbiegłyby się i cała powyższa ostrożność byłaby pusta. Wtedy
    // ten test ma zaświecić na czerwono i kazać przeczytać komentarz na górze,
    // a nie cicho chronić nieistniejącej już różnicy.
    expect(provider).toMatch(
      /function resendConfigured\(\)[^}]*LOVABLE_API_KEY[^}]*RESEND_API_KEY/s,
    );
    expect(provider).toMatch(/emailProviderConfigured[\s\S]{0,120}platformMailerConfigured\(\)/);
  });
});
