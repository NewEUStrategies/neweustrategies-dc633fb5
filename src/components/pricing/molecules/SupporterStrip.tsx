// Darowizna celowo NIE jest kartą w drabince cen (paradoks wyboru: karty
// decyzyjne osobno, wsparcie misji jako osobna, spokojna ścieżka).
//
// STRIP NIE ZALEŻY OD WARSTWY „Wspierający". Audyt katalogu v6.1, rozdział 4:
// katalog v6 wycofał próg Wspierający z drabinki, a strip renderował się
// WYŁĄCZNIE wtedy, gdy taki wiersz istniał w `membership_tiers`. Wycofanie
// progu zabrałoby więc ostatnie stałe wejście do kompletnego, zbudowanego
// i przetestowanego modułu darowizn - osiem modułów obsługi wpłat zostałoby
// osiągalne tylko przez widget CMS, który redakcja musi gdzieś ręcznie wstawić.
// „Zbudowana funkcja, która nie ma wejścia w interfejsie, jest czystą stratą".
//
// Warstwa, jeżeli istnieje, dostarcza wyłącznie NAZWĘ i OPIS. Bez niej strip
// mówi własnym głosem ze słownika.
//
// DLACZEGO LINK DO `/support`, A NIE OD RAZU DO CELU WPŁATY. Cel rozstrzyga
// `resolveDonationTarget` z konfiguracji (`site_settings.donations`), ale
// odczyt tej konfiguracji idzie przez server function - a `/pricing` jest
// stroną renderowaną serwerowo, w której pasek o wysokości pięciu linijek nie
// ma prawa ciągnąć za sobą modułu `donations.functions`. `/support` i tak
// rozstrzyga cel u siebie i sam degraduje się przy wyłączonym module, więc
// jedno przekierowanie kupuje tu czystą granicę.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { HandHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

export function SupporterStrip({
  tier = null,
  lang,
}: {
  /** Opcjonalna warstwa „Wspierający" - wyłącznie źródło nazwy i opisu. */
  tier?: MembershipTierRow | null;
  lang: string;
}) {
  const { t } = useTranslation();

  const description = tier ? (lang === "en" ? tier.description_en : tier.description_pl) : null;
  const label = tier ? tierName(tier, lang) : t("pricing.supporterStrip.title");

  return (
    <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 p-5 sm:flex-row">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <HandHeart className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">
            {description || t("pricing.supporterStrip.body")}
          </p>
          {/* Jawne zastrzeżenie, że wpłata nie kupuje benefitów - tego właśnie
              żąda audyt, żeby darowizna nie wróciła bocznymi drzwiami jako
              próg cennika. */}
          <p className="mt-1 text-xs text-muted-foreground">{t("pricing.supporterStrip.note")}</p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link to="/support" search={{ status: undefined }}>
          {t("pricing.tiers.supporterCta")}
        </Link>
      </Button>
    </div>
  );
}
