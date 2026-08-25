// Molekuła: wejście kodu - aparat, czytnik sprzętowy i klawiatura w jednym.
//
// TRZY DROGI, BO KAŻDA ZAWODZI GDZIE INDZIEJ. Aparat nie działa w Safari
// i przy odmowie zgody. Czytnik sprzętowy („keyboard wedge") jest najszybszy,
// ale wymaga, żeby kursor stał w polu - i dokładnie o to dba ten komponent,
// przywracając focus po każdym skanie. Klawiatura zostaje jako ostatnia deska
// ratunku, gdy kod z biletu trzeba przepisać z papieru.
//
// CZYTNIK SPRZĘTOWY „PISZE" I NACISKA ENTER. Nie ma dla niego osobnego API -
// to zwykłe zdarzenia klawiatury. Dlatego wysyłka dzieje się na `submit`
// formularza, a nie na przycisk: Enter z czytnika i Enter z klawiatury są
// tym samym zdarzeniem, więc obsługujemy je raz.
//
// POLE CZYŚCI SIĘ SAMO. Po wysłaniu kod znika, a kursor wraca - bez tego
// drugi skan dokleiłby się do pierwszego i powstałby kod, którego nie ma
// na żadnym bilecie.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CameraOff, Flashlight, Loader2, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerCodeInput({
  onCode,
  busy,
  disabled = false,
}: {
  onCode: (code: string) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scanner = useBarcodeScanner({
    onCode: (code) => {
      if (disabled) return;
      onCode(code);
    },
  });

  // Kursor wraca do pola po każdym zakończonym skanie - czytnik sprzętowy
  // „pisze" tam, gdzie stoi kursor, a nie tam, gdzie patrzy operator.
  useEffect(() => {
    if (!busy && !disabled && !scanner.active) inputRef.current?.focus();
  }, [busy, disabled, scanner.active]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = value.trim();
    if (code === "" || busy || disabled) return;
    setValue("");
    onCode(code);
  };

  const cameraMessageKey =
    scanner.error === "permission_denied"
      ? "eventScanner.camera.permissionDenied"
      : scanner.error === "insecure_context" || scanner.support === "insecure"
        ? "eventScanner.camera.insecureContext"
        : scanner.error === "not_supported" || scanner.support === "unsupported"
          ? "eventScanner.camera.notSupported"
          : scanner.error === "camera_unavailable"
            ? "eventScanner.camera.notSupported"
            : null;

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <label
          htmlFor="scanner-code"
          className="block text-xs uppercase tracking-wide text-muted-foreground"
        >
          {t("eventScanner.manual.label")}
        </label>
        <div className="flex gap-2">
          <input
            id="scanner-code"
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t("eventScanner.manual.placeholder")}
            className="h-12 min-w-0 flex-1 rounded-[6px] border border-input bg-background px-3 font-mono text-base text-foreground disabled:opacity-50"
          />
          <Button type="submit" size="lg" disabled={busy || disabled || value.trim() === ""}>
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <ScanLine className="h-5 w-5" aria-hidden="true" />
            )}
            <span className="sr-only">{t("eventScanner.manual.submit")}</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("eventScanner.manual.hint")}</p>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={scanner.active ? "secondary" : "outline"}
          size="sm"
          disabled={disabled || scanner.starting || scanner.support === "checking"}
          onClick={() => (scanner.active ? scanner.stop() : scanner.start())}
        >
          {scanner.starting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : scanner.active ? (
            <CameraOff className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {scanner.starting
            ? t("eventScanner.camera.starting")
            : scanner.active
              ? t("eventScanner.camera.stop")
              : t("eventScanner.camera.start")}
        </Button>

        {scanner.active && scanner.torchAvailable && (
          <Button type="button" variant="outline" size="sm" onClick={scanner.toggleTorch}>
            <Flashlight className="mr-2 h-4 w-4" aria-hidden="true" />
            {scanner.torchOn ? t("eventScanner.camera.torchOff") : t("eventScanner.camera.torchOn")}
          </Button>
        )}
      </div>

      {cameraMessageKey !== null && !scanner.active && (
        <p className="text-xs text-muted-foreground">{t(cameraMessageKey)}</p>
      )}

      {/* Podgląd z aparatu trzymamy w drzewie zawsze, bo `videoRef` musi
          istnieć w chwili, w której strumień jest gotowy - inaczej pierwszy
          start gasłby natychmiast po przyznaniu zgody. */}
      <div
        className={cn(
          "overflow-hidden rounded-[6px] border border-border",
          !scanner.active && "hidden",
        )}
      >
        <video
          ref={scanner.videoRef}
          muted
          playsInline
          className="aspect-[4/3] w-full bg-black object-cover"
        />
        <p className="bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
          {t("eventScanner.camera.hint")}
        </p>
      </div>
    </div>
  );
}
