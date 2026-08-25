// Molekuła: karta ZAMKA sekcji - co jest po drugiej stronie i jak tam wejść.
//
// ZAMEK ZOSTAJE NA STRONIE. Gdyby zamknięta sekcja po prostu znikała, uczestnik
// nie dowiedziałby się nawet, że program kongresu istnieje - a to jest
// argument, dla którego miałby się zapisać. Karta mówi więc: CO tu jest, DLACZEGO
// jest zamknięte i JAKI jest następny krok.
//
// TRZY POWODY, TRZY RÓŻNE DROGI. Logowanie prowadzi do logowania z powrotem
// tutaj, zapis do formularza zapisu, warstwa do cennika - jeden przycisk
// „dowiedz się więcej" byłby ślepą uliczką dla dwóch z trzech.
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  sectionLockCopy,
  type EventSectionKey,
  type EventSectionLockReason,
} from "@/lib/events/eventSections";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function SectionLockCard({
  reason,
  sectionKey,
  eventSlug,
}: {
  reason: EventSectionLockReason;
  sectionKey: EventSectionKey;
  eventSlug: string;
}) {
  const { t } = useTranslation();
  const copy = sectionLockCopy(reason);
  if (copy === null) return null;

  return (
    <div
      className="rounded-[6px] border border-dashed border-border bg-muted/40 p-5"
      data-section={sectionKey}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t(copy.titleKey)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{t(copy.bodyKey)}</p>
      <div className="mt-4">
        {reason === "auth_required" ? (
          <Button asChild size="sm" variant="secondary">
            <Link to="/login">{t(copy.actionKey)}</Link>
          </Button>
        ) : reason === "tier_required" ? (
          <Button asChild size="sm">
            <Link to="/pricing">{t(copy.actionKey)}</Link>
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link to="/events/$slug/register" params={{ slug: eventSlug }}>
              {t(copy.actionKey)}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
