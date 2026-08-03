// Molekuła: publiczna deklaracja honorowania sygnału GPC z linkiem do dokumentu
// maszynowego (`/.well-known/gpc.json`).
//
// Oświadczenie musi być SPRAWDZALNE, nie tylko czytelne - dlatego obok zdania
// stoi link do pliku, który spec Global Privacy Control uznaje za dowód. Ścieżka
// pochodzi ze stałej `GPC_WELL_KNOWN_PATH`, więc tekst i trasa nie mogą się
// rozjechać.
import { useTranslation } from "react-i18next";
import { GPC_WELL_KNOWN_PATH } from "@/lib/consent/gpc";
import { ensureI18n } from "@/lib/i18n-consent-gpc";

ensureI18n();

export function GpcDeclarationLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p
      data-testid="gpc-declaration"
      className={className ?? "text-xs leading-relaxed text-muted-foreground"}
    >
      {t("consentGpc.declaration")}{" "}
      <a
        href={GPC_WELL_KNOWN_PATH}
        className="font-medium text-[var(--brand)] underline underline-offset-2 hover:opacity-80"
      >
        {GPC_WELL_KNOWN_PATH}
      </a>
    </p>
  );
}
