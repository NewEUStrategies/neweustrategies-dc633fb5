// HUB PRYWATNOŚCI (/profile/privacy) - §10 audytu IA prywatności.
//
// STAN ZASTANY. Nazwa „centrum prywatności" była na wyrost: strona zawierała
// wyłącznie ZGODY (cookie CMP + katalog zgód + rejestr RODO), a właściwe
// ustawienia prywatności mieszkały gdzie indziej:
//   * widoczność w katalogu osób, przyjmowanie zapytań do eksperta, kto może
//     zacząć rozmowę, kto może zaprosić do sieci, potwierdzenia odczytu,
//     wskaźnik pisania, status dostępności -> w ŚRODKU formularza edycji
//     tożsamości (/profile/edit), pod przyciskiem „Zapisz", który ich wcale
//     nie dotyczył,
//   * eksport danych (art. 15/20) i usunięcie konta (art. 17) -> na
//     /profile/security, między zmianą hasła a dwuskładnikowym logowaniem.
// Trzy powierzchnie, żadnej odpowiedzi na pytanie „gdzie ustawię prywatność".
//
// TERAZ. Jedna strona, trzy bloki w kolejności rosnącej nieodwracalności:
//   1. Widoczność i kontakt - kogo wpuszczam (zmieniane codziennie),
//   2. Zgody - na co się godzę (zmieniane rzadko, audytowane),
//   3. Twoje dane - co mi wydacie i jak mnie usuniecie (raz w życiu).
// /profile/security zostaje przy bezpieczeństwie KONTA: hasło, e-mail, sesje,
// dwuskładnikowe. Obie strony linkują do siebie, bo granica nie jest oczywista.
//
// Każda zmiana zgody przechodzi przez audytowaną ścieżkę: CMP -> registryBridge
// -> set_user_consent (IP/UA czytane serwerowo), albo wprost set_user_consent.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Cookie, ShieldCheck, ArrowRight } from "lucide-react";
import { ConsentsPanel } from "@/components/notifications/ConsentsPanel";
import { GpcDeclarationSlot } from "@/components/consent/GpcSurfaceSlots";
import { VisibilityAndContactSection } from "@/components/profile/privacy/VisibilityAndContactSection";
import { DataRightsSection } from "@/components/profile/privacy/DataRightsSection";
import { ensureI18n as ensureNetworkI18n } from "@/lib/i18n-network";
import { requestConsentPreferences } from "@/lib/ads/consent";

export const Route = createFileRoute("/profile/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  // Sekcja widoczności czyta słownik sieci kontaktów (network.allowConnections*).
  ensureNetworkI18n();
  const { t } = useTranslation();

  const openBannerPreferences = () => {
    // Helper odkłada żądanie w stanie modułu, więc klik działa także zanim
    // leniwy chunk ConsentBanner zdąży się pobrać i zasubskrybować.
    requestConsentPreferences();
  };

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h2 className="font-display text-2xl font-bold">{t("profile.privacy.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("profile.privacy.hint")}</p>
      </header>

      {/* 1. Widoczność i kontakt - przeniesione z /profile/edit. */}
      <VisibilityAndContactSection />

      {/* 2. Zgody + rejestr RODO + deklaracja GPC. */}
      <section aria-labelledby="privacy-consents-heading" className="space-y-4">
        <h3 id="privacy-consents-heading" className="text-sm font-semibold text-foreground/80">
          {t("profile.privacy.consentsSection")}
        </h3>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            >
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("profile.privacy.registryNote")}
              </p>
              {/* Deklaracja honorowania GPC - link do dokumentu maszynowego, żeby
                  oświadczenie dało się sprawdzić, a nie tylko przeczytać. */}
              <GpcDeclarationSlot />
            </div>
          </div>
          <button
            type="button"
            onClick={openBannerPreferences}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Cookie className="h-3.5 w-3.5" aria-hidden />
            {t("profile.privacy.openBanner")}
          </button>
        </div>

        <ConsentsPanel source="profile_privacy" />
      </section>

      {/* 3. Prawa do danych - przeniesione z /profile/security. */}
      <section aria-labelledby="privacy-data-heading" className="space-y-4">
        <h3 id="privacy-data-heading" className="text-sm font-semibold text-foreground/80">
          {t("profile.privacy.dataSection")}
        </h3>
        <DataRightsSection />
      </section>

      {/* Granica prywatność / bezpieczeństwo konta nie jest oczywista - linkujemy
          wprost, zamiast liczyć na to, że użytkownik zgadnie z nazwy pozycji. */}
      <Link
        to="/profile/security"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        {t("profile.privacy.securityLink")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
