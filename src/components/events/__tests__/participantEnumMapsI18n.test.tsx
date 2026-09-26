// MAPY ETYKIET FUNKCJI UCZESTNIKA F1-F5 - render z PRAWDZIWYM słownikiem.
//
// Każda mapa `Record<Enum, "pełny.klucz">` dostaje tu JEDEN render z `i18nReal`
// w obu językach (spec B.14): tekst na ekranie nie może zaczynać się od
// prefiksu klucza - to jest dokładnie to, co widzi użytkownik, gdy klucza nie
// ma w nakładce (`t()` oddaje wtedy sam klucz). Bramka `eventsI18nKeys` łapie
// brak klucza statycznie; ten plik łapie go od strony EKRANU.
//
// Mapy: tony plakietki stanu (`REGISTRATION_STATUS_TONE_LABEL_KEYS`), wyprzedzenia
// przypomnień (`LEAD_PRESET_LABEL_KEYS` + etykieta własna), rodzaje/kanały/stany
// doręczeń (`DELIVERY_*_LABEL_KEYS`), tryby zwrotu (`REFUND_MODE_*_KEYS`)
// i komunikaty walidacji ustawień (`PARTICIPANT_SETTINGS_ERROR_KEYS`).
import { afterAll, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";

// PRAWDZIWY `react-i18next` na prawdziwej instancji - bez atrapy modułu (atrapa
// importująca `@/test/i18nReal` z własnej fabryki zapętla rozwiązywanie).
// Język przełączamy `changeLanguage` przed każdym renderem.
const { realT } = await import("@/test/i18nReal");
const { default: i18n } = await import("@/lib/i18n");
const { RegistrationStatusBadge } =
  await import("@/components/events/participant/atoms/RegistrationStatusBadge");
const { ReminderLeadsField } =
  await import("@/components/admin/events/molecules/ReminderLeadsField");
const { MessageDeliveryStatsTable } =
  await import("@/components/admin/events/molecules/MessageDeliveryStatsTable");
const { REGISTRATION_STATUS_TONE } = await import("@/lib/events/participantSurface");
const { DELIVERY_CHANNELS, DELIVERY_KINDS } = await import("@/lib/events/participantDeliveryKinds");
const {
  PARTICIPANT_SETTINGS_ERROR_KEYS,
  LEAD_PRESET_LABEL_KEYS,
  REFUND_MODE_HINT_KEYS,
  REFUND_MODE_LABEL_KEYS,
} = await import("@/lib/events/participantSettingsDraft");
const { REFUND_MODES } = await import("@/lib/events/participantSettings");

const JEZYKI = ["pl", "en"] as const;

async function jezyk(lang: "pl" | "en"): Promise<void> {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

afterAll(async () => {
  await i18n.changeLanguage("pl");
});

/** Wszystkie niepuste węzły tekstowe drzewa. */
function teksty(container: HTMLElement): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? "";
    if (text !== "") out.push(text);
  }
  return out;
}

function bezSurowychKluczy(container: HTMLElement, prefix: string): void {
  const surowe = teksty(container).filter((text) => text.startsWith(prefix));
  expect(surowe).toEqual([]);
}

describe.each(JEZYKI)("mapy etykiet F1-F5 w języku %s", (lang) => {
  it("tony plakietki stanu zgłoszenia", async () => {
    await jezyk(lang);
    for (const status of Object.keys(REGISTRATION_STATUS_TONE)) {
      const { container, unmount } = render(<RegistrationStatusBadge status={status} />);
      expect(teksty(container)).toHaveLength(1);
      bezSurowychKluczy(container, "eventParticipant.");
      unmount();
    }
  });

  it("wyprzedzenia przypomnień (gotowe + własne)", async () => {
    await jezyk(lang);
    const { container } = render(
      <ReminderLeadsField value={[90]} onChange={() => {}} error={null} />,
    );
    // 8 gotowych + 1 własne, legenda i podpowiedź.
    expect(teksty(container).length).toBeGreaterThanOrEqual(11);
    bezSurowychKluczy(container, "adminEventParticipant.");
    expect(Object.keys(LEAD_PRESET_LABEL_KEYS)).toHaveLength(8);
  });

  it("rodzaje, kanały i stany doręczeń", async () => {
    await jezyk(lang);
    const rows = DELIVERY_KINDS.flatMap((kind) =>
      DELIVERY_CHANNELS.map((channel) => ({
        kind,
        channel,
        claimed: 0,
        sent: 1,
        skipped: 0,
        failed: 0,
      })),
    );
    const { container } = render(
      <MessageDeliveryStatsTable
        stats={{ rows, lastSentAt: "2026-09-15T08:30:00.000Z" }}
        timezone="Europe/Warsaw"
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(33);
    bezSurowychKluczy(container, "adminEventParticipant.");
  });

  it("tryby zwrotu i komunikaty walidacji ustawień mają zdanie, a nie klucz", () => {
    const t = realT(lang);
    const klucze = [
      ...REFUND_MODES.flatMap((mode) => [
        REFUND_MODE_LABEL_KEYS[mode],
        REFUND_MODE_HINT_KEYS[mode],
      ]),
      ...PARTICIPANT_SETTINGS_ERROR_KEYS,
    ];
    const { container } = render(
      <ul>
        {klucze.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>,
    );
    expect(teksty(container)).toHaveLength(klucze.length);
    bezSurowychKluczy(container, "adminEventParticipant.");
  });
});
