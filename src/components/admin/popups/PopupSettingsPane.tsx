// Popup display/trigger settings form (admin editor, "Ustawienia" tab).
// Fully controlled: receives the parsed PopupSettings and emits a full copy on
// every change; the parent owns persistence.
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  PopupAudience,
  PopupPosition,
  PopupSettings,
  PopupTrigger,
  PopupWidth,
} from "@/lib/builder/popups";

interface Props {
  value: PopupSettings;
  onChange: (next: PopupSettings) => void;
}

const pathsToText = (paths: string[]) => paths.join("\n");
const textToPaths = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

export function PopupSettingsPane({ value, onChange }: Props) {
  const { t } = useTranslation();
  const set = <K extends keyof PopupSettings>(key: K, v: PopupSettings[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="grid gap-6 md:grid-cols-2 max-w-4xl">
      <section className="space-y-4">
        <h3 className="text-sm font-medium">
          {t("admin.popups.settings.triggerSection", { defaultValue: "Wyzwalacz" })}
        </h3>

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.trigger", { defaultValue: "Kiedy pokazać popup" })}
          </Label>
          <Select value={value.trigger} onValueChange={(v) => set("trigger", v as PopupTrigger)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">
                {t("admin.popups.settings.triggerImmediate", { defaultValue: "Od razu" })}
              </SelectItem>
              <SelectItem value="delay">
                {t("admin.popups.settings.triggerDelay", { defaultValue: "Po opóźnieniu" })}
              </SelectItem>
              <SelectItem value="scroll">
                {t("admin.popups.settings.triggerScroll", {
                  defaultValue: "Po przewinięciu strony",
                })}
              </SelectItem>
              <SelectItem value="exit-intent">
                {t("admin.popups.settings.triggerExit", {
                  defaultValue: "Przy próbie wyjścia (exit intent)",
                })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.trigger === "delay" && (
          <div className="space-y-1.5">
            <Label>
              {t("admin.popups.settings.delaySeconds", { defaultValue: "Opóźnienie (sekundy)" })}
            </Label>
            <Input
              type="number"
              min={0}
              value={value.delaySeconds}
              onChange={(e) => set("delaySeconds", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        )}

        {value.trigger === "scroll" && (
          <div className="space-y-1.5">
            <Label>
              {t("admin.popups.settings.scrollPercent", {
                defaultValue: "Głębokość przewinięcia (%)",
              })}
            </Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={value.scrollPercent}
              onChange={(e) =>
                set("scrollPercent", Math.min(100, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.frequencyDays", {
              defaultValue: "Częstotliwość (dni między wyświetleniami)",
            })}
          </Label>
          <Input
            type="number"
            min={0}
            value={value.frequencyDays}
            onChange={(e) => set("frequencyDays", Math.max(0, Number(e.target.value) || 0))}
          />
          <p className="text-xs text-muted-foreground">
            {t("admin.popups.settings.frequencyHint", {
              defaultValue: "0 = przy każdej wizycie. Licznik startuje po zamknięciu popupu.",
            })}
          </p>
        </div>

        <h3 className="text-sm font-medium pt-2">
          {t("admin.popups.settings.targetingSection", { defaultValue: "Targetowanie" })}
        </h3>

        <div className="space-y-1.5">
          <Label>{t("admin.popups.settings.audience", { defaultValue: "Odbiorcy" })}</Label>
          <Select value={value.audience} onValueChange={(v) => set("audience", v as PopupAudience)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">
                {t("admin.popups.settings.audienceAny", { defaultValue: "Wszyscy" })}
              </SelectItem>
              <SelectItem value="guest">
                {t("admin.popups.settings.audienceGuest", { defaultValue: "Tylko niezalogowani" })}
              </SelectItem>
              <SelectItem value="user">
                {t("admin.popups.settings.audienceUser", { defaultValue: "Tylko zalogowani" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("admin.popups.settings.devices", { defaultValue: "Urządzenia" })}</Label>
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <div key={d} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {d === "desktop"
                  ? t("admin.popups.settings.deviceDesktop", { defaultValue: "Desktop" })
                  : d === "tablet"
                    ? t("admin.popups.settings.deviceTablet", { defaultValue: "Tablet" })
                    : t("admin.popups.settings.deviceMobile", { defaultValue: "Mobile" })}
              </span>
              <Switch
                checked={value.devices[d]}
                onCheckedChange={(checked) => set("devices", { ...value.devices, [d]: checked })}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.includePaths", {
              defaultValue: "Pokaż tylko na ścieżkach (jedna na linię)",
            })}
          </Label>
          <Textarea
            rows={3}
            value={pathsToText(value.includePaths)}
            onChange={(e) => set("includePaths", textToPaths(e.target.value))}
            placeholder={"/\n/post/*\n/pricing"}
          />
          <p className="text-xs text-muted-foreground">
            {t("admin.popups.settings.pathsHint", {
              defaultValue:
                "Puste = cała witryna. Gwiazdka na końcu dopasowuje prefiks, np. /post/*.",
            })}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.excludePaths", {
              defaultValue: "Wyklucz ścieżki (jedna na linię)",
            })}
          </Label>
          <Textarea
            rows={3}
            value={pathsToText(value.excludePaths)}
            onChange={(e) => set("excludePaths", textToPaths(e.target.value))}
            placeholder={"/checkout/*"}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium">
          {t("admin.popups.settings.appearanceSection", { defaultValue: "Wygląd" })}
        </h3>

        <div className="space-y-1.5">
          <Label>{t("admin.popups.settings.width", { defaultValue: "Szerokość" })}</Label>
          <Select value={value.width} onValueChange={(v) => set("width", v as PopupWidth)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">
                {t("admin.popups.settings.widthSm", { defaultValue: "Wąski (420 px)" })}
              </SelectItem>
              <SelectItem value="md">
                {t("admin.popups.settings.widthMd", { defaultValue: "Średni (640 px)" })}
              </SelectItem>
              <SelectItem value="lg">
                {t("admin.popups.settings.widthLg", { defaultValue: "Szeroki (860 px)" })}
              </SelectItem>
              <SelectItem value="xl">
                {t("admin.popups.settings.widthXl", { defaultValue: "Bardzo szeroki (1080 px)" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("admin.popups.settings.position", { defaultValue: "Pozycja" })}</Label>
          <Select value={value.position} onValueChange={(v) => set("position", v as PopupPosition)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="center">
                {t("admin.popups.settings.positionCenter", { defaultValue: "Środek ekranu" })}
              </SelectItem>
              <SelectItem value="top">
                {t("admin.popups.settings.positionTop", { defaultValue: "Góra ekranu" })}
              </SelectItem>
              <SelectItem value="bottom">
                {t("admin.popups.settings.positionBottom", { defaultValue: "Dół ekranu" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.overlayColor", { defaultValue: "Kolor przyciemnienia tła" })}
          </Label>
          <Input
            value={value.overlayColor}
            onChange={(e) => set("overlayColor", e.target.value)}
            placeholder="rgba(0,0,0,0.7)"
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            {t("admin.popups.settings.borderRadius", { defaultValue: "Zaokrąglenie rogów (px)" })}
          </Label>
          <Input
            type="number"
            min={0}
            value={value.borderRadiusPx}
            onChange={(e) => set("borderRadiusPx", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label className="font-normal">
            {t("admin.popups.settings.showCloseButton", {
              defaultValue: "Pokaż przycisk zamknięcia",
            })}
          </Label>
          <Switch
            checked={value.showCloseButton}
            onCheckedChange={(v) => set("showCloseButton", v)}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label className="font-normal">
            {t("admin.popups.settings.closeOnOverlay", {
              defaultValue: "Zamykaj kliknięciem w tło",
            })}
          </Label>
          <Switch
            checked={value.closeOnOverlay}
            onCheckedChange={(v) => set("closeOnOverlay", v)}
          />
        </div>
      </section>
    </div>
  );
}
