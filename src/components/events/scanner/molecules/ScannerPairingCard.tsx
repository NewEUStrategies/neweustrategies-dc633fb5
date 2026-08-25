// Molekuła: ekran parowania urządzenia.
//
// PIERWSZE, CO WIDZI WOLONTARIUSZ. Dlatego mówi nie tylko „wpisz kod", ale też
// SKĄD ten kod wziąć - ścieżka w panelu organizatora jest w treści, bo przy
// bramce nikt nie ma czasu na szukanie w dokumentacji.
//
// KSZTAŁT SPRAWDZAMY U SIEBIE. `_event_scanner_device_auth` wymaga 16-128
// znaków base64url; kod urwany przy kopiowaniu odrzucamy natychmiast, zamiast
// wysyłać żądanie, które i tak wróci z odmową.
import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isScannerToken } from "@/lib/events/scannerSession";
import { scannerErrorMessage } from "@/lib/events/scannerErrors";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

export function ScannerPairingCard({
  onConnect,
  connecting,
  error,
  online,
}: {
  onConnect: (token: string) => void;
  connecting: boolean;
  error: string | null;
  online: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const malformed = touched && value.trim() !== "" && !isScannerToken(value);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const token = value.trim();
    if (!isScannerToken(token) || connecting) return;
    onConnect(token);
  };

  return (
    <section className="mx-auto w-full max-w-md space-y-5">
      <header className="space-y-2 text-center">
        <p className="inline-flex items-center justify-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {t("eventScanner.appName")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("eventScanner.pairing.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("eventScanner.pairing.subtitle")}</p>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <label
          htmlFor="scanner-token"
          className="block text-xs uppercase tracking-wide text-muted-foreground"
        >
          {t("eventScanner.pairing.tokenLabel")}
        </label>
        <input
          id="scanner-token"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t("eventScanner.pairing.tokenPlaceholder")}
          aria-invalid={malformed}
          className="h-12 w-full rounded-[6px] border border-input bg-background px-3 font-mono text-base text-foreground"
        />

        {malformed && (
          <p className="text-sm text-destructive">{t("eventScanner.pairing.invalidToken")}</p>
        )}
        {!malformed && error !== null && (
          <p className="text-sm text-destructive">{scannerErrorMessage(error)}</p>
        )}
        {!online && (
          <p className="text-sm text-muted-foreground">
            {t("eventScanner.pairing.offlineFirstRun")}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={connecting}>
          {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {connecting ? t("eventScanner.pairing.connecting") : t("eventScanner.pairing.connect")}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">{t("eventScanner.pairing.help")}</p>
    </section>
  );
}
