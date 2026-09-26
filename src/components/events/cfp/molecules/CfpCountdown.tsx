// Molekuła: odliczanie do otwarcia albo do końca naboru.
//
// ZEGAR TYLKO PO MONTAŻU (`useNowMs`). SSR i pierwszy render klienta nie
// rysują odliczania wcale - termin absolutny w strefie wydarzenia stoi obok
// i jest deterministyczny, więc hydratacja nie ma czego rozjechać.
//
// FAZA NIE WYNIKA Z TEGO ZEGARA. O tym, czy nabór przyjmuje zgłoszenia,
// rozstrzyga baza (`_event_cfp_phase`); odliczanie jest wyłącznie informacją.
// Gdy dojdzie do zera, komponent milknie - nie przełącza strony w „otwarte".
import { useTranslation } from "react-i18next";

import { countdownParts, parseCountdownTarget } from "@/lib/events/countdown";
import { useNowMs } from "@/lib/time/useNowMs";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";

const TICK_MS = 30_000;

export function CfpCountdown({
  target,
  mode,
}: {
  target: string | null;
  mode: "toOpen" | "toClose";
}) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const now = useNowMs(TICK_MS);
  const targetMs = target === null ? null : parseCountdownTarget(target);
  if (now === null || targetMs === null) return null;
  const parts = countdownParts(targetMs, now);
  if (parts.done) return null;
  const value = t("eventCfp.page.countdown.value", {
    days: parts.days,
    hours: parts.hours,
    minutes: parts.minutes,
  });
  return (
    <p className="text-sm font-medium tabular-nums" aria-live="polite">
      {t(mode === "toOpen" ? "eventCfp.page.countdown.toOpen" : "eventCfp.page.countdown.toClose", {
        value,
      })}
    </p>
  );
}
