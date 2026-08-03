// Molekuła: objaśnienie kolumny GPC w historii rejestru zgód.
//
// Renderowana WYŁĄCZNIE wtedy, gdy w historii jest choć jedno zdarzenie ze
// znacznikiem sygnału - inaczej użytkownik czytałby wyjaśnienie skrótu, którego
// nigdzie nie widzi. Wyjaśnienie jest za to obowiązkowe, gdy znacznik już się
// pojawia: „GPC" bez rozwinięcia nie jest przejrzystą informacją (art. 12 RODO).
import { useTranslation } from "react-i18next";
import { ensureI18n } from "@/lib/i18n-consent-gpc";

ensureI18n();

export function GpcRegistryNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p
      data-testid="gpc-registry-note"
      className={className ?? "mt-1 text-[11px] leading-relaxed text-muted-foreground/80"}
    >
      {t("consentGpc.registry.note")}
    </p>
  );
}
