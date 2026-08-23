// Molekuła: pola konfiguracji zależne od POZYCJI reklamy.
//
// Decyzja jest w tym, KTÓRA pozycja o co pyta: `mid_post` o numer paragrafu
// (pokazuje 4), `in_feed` o co ile kart (5), `footer_slideup` o opóźnienie
// (3000 ms) i o możliwość zamknięcia (włączone), a pozostałe pozycje o nic.
//
// PRZENIESIONE ZNAK W ZNAK RAZEM Z WADĄ: pokazana wartość domyślna NIE jest
// zapisywana - to tylko `?? 4` w atrybucie `value`, więc nietknięte pole
// zostawia `config` puste. Dziś nikt na tym nie traci, bo renderery mają
// identyczne fallbacki (`MidPostAds` ?? 4, `useInFeedAds` ?? 5,
// `FooterSlideup` ?? 3000 / ?? true), ale te liczby żyją w czterech miejscach
// bez żadnego wiązania. Naprawa idzie osobnym krokiem, nie ekstrakcją.
import { useTranslation } from "react-i18next";
import { FloatingInput } from "@/components/ui/floating-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AdPosition } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export function AdPlacementConfigFields({
  position,
  config,
  onSet,
}: {
  position: AdPosition;
  config: Record<string, unknown>;
  onSet: (key: string, value: unknown) => void;
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  const cfg = config;
  return (
    <>
      {position === "mid_post" && (
        <FloatingInput
          label={t("adsAdmin.placements.fieldAfterParagraph")}
          type="number"
          min={1}
          value={(cfg.paragraph as number) ?? 4}
          onChange={(e) => onSet("paragraph", Number(e.target.value))}
        />
      )}
      {position === "in_feed" && (
        <FloatingInput
          label="Co N kart"
          type="number"
          min={1}
          value={(cfg.every as number) ?? 5}
          onChange={(e) => onSet("every", Number(e.target.value))}
        />
      )}
      {position === "footer_slideup" && (
        <>
          <FloatingInput
            label={t("adsAdmin.placements.fieldDelayMs")}
            type="number"
            value={(cfg.delay_ms as number) ?? 3000}
            onChange={(e) => onSet("delay_ms", Number(e.target.value))}
          />
          <div className="flex items-center gap-2 mt-6">
            <Switch
              checked={(cfg.dismissible as boolean) ?? true}
              onCheckedChange={(v) => onSet("dismissible", v)}
            />
            <Label className="m-0">{t("adsAdmin.placements.fieldDismissible")}</Label>
          </div>
        </>
      )}
    </>
  );
}
