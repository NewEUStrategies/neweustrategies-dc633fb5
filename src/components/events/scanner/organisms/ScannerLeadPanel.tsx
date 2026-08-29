// Organizm: SKAN LEADU na stoisku partnera.
//
// ZGODA JEST FAKTEM Z FORMULARZA, NIE PYTANIEM PRZY STOISKU. `event_lead_scan_record`
// oddaje dane kontaktowe WYŁĄCZNIE wtedy, gdy uczestnik zgodził się na
// przekazanie ich partnerowi i zgody nie wycofał. Dlatego przy braku zgody nie
// ma tu żadnego przycisku „dopytaj" ani pola na ręczne wpisanie maila - skan
// jest policzony, a dane po prostu nie wychodzą. Ekran mówi o tym wprost,
// żeby nikt nie próbował obejść tego notatką.
//
// NOTATKA POWSTAJE PO SKANIE, NIE PRZED. Rozmowa dzieje się po piknięciu
// badge'a; wymuszanie notatki przed zapisem zamieniłoby stoisko w formularz.
// Dlatego skan zapisuje się od razu, a notatkę i ocenę dopisuje się do TEGO
// SAMEGO leadu drugim wywołaniem (baza scala je po parze partner-osoba).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LeadScanResult } from "@/lib/events/scannerApi";
import { scannerErrorMessage } from "@/lib/events/scannerErrors";
import type { ScannerRuntime } from "@/lib/events/useScanner";
import { ScanOutcomeBanner } from "@/components/events/scanner/atoms/ScanOutcomeBanner";
import { ScannerCodeInput } from "@/components/events/scanner/molecules/ScannerCodeInput";
import { ensureI18n as ensureScannerI18n } from "@/lib/i18n-event-scanner";

ensureScannerI18n();

const RATINGS = [1, 2, 3, 4, 5] as const;

export function ScannerLeadPanel({ runtime }: { runtime: ScannerRuntime }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<LeadScanResult | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState<number | null>(null);

  const send = (code: string, withNote: boolean) => {
    setBusy(true);
    setFailure(null);
    runtime
      .submitLead({
        code,
        note: withNote && note.trim() !== "" ? note.trim() : null,
        interestRating: withNote ? rating : null,
      })
      .then((outcome) => {
        setBusy(false);
        setLastCode(code);
        if (outcome.queued) {
          setResult(null);
          setQueued(true);
          toast.info(t("eventScanner.outbox.queuedToast"));
          return;
        }
        setQueued(false);
        setResult(outcome.result);
        if (withNote) toast.success(t("eventScanner.lead.saved"));
      })
      .catch((error: unknown) => {
        setBusy(false);
        setResult(null);
        setQueued(false);
        setFailure(scannerErrorMessage(error));
      });
  };

  const scan = (code: string) => {
    // Nowy człowiek przy stoisku - notatka poprzedniego nie może mu się przykleić.
    setNote("");
    setRating(null);
    send(code, false);
  };

  const person = result?.person ?? null;
  const consent = result?.consent === true;

  return (
    <div className="space-y-4">
      <ScannerCodeInput onCode={scan} busy={busy} />

      {failure !== null && (
        <ScanOutcomeBanner
          tone="denied"
          title={t("eventScanner.outcomes.unknown")}
          hint={failure}
        />
      )}

      {queued && (
        <ScanOutcomeBanner
          tone="neutral"
          title={t("eventScanner.outcomes.saved")}
          hint={t("eventScanner.errors.offline")}
        />
      )}

      {result !== null && (
        <div className="space-y-3">
          <ScanOutcomeBanner
            tone={result.outcome === "saved" ? (consent ? "granted" : "warning") : "denied"}
            title={
              result.outcome === "saved"
                ? t("eventScanner.outcomes.saved")
                : result.outcome === "wrong_event"
                  ? t("eventScanner.outcomes.wrongEvent")
                  : t("eventScanner.outcomes.unknownCode")
            }
            hint={
              result.outcome === "saved"
                ? consent
                  ? t("eventScanner.lead.consentYes")
                  : t("eventScanner.lead.consentNoHint")
                : null
            }
          />

          {result.outcome === "saved" && (
            <section className="space-y-3 rounded-[6px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={consent ? "secondary" : "outline"}>
                  {consent ? t("eventScanner.lead.consentYes") : t("eventScanner.lead.consentNo")}
                </Badge>
                <Badge variant="outline">
                  {t("eventScanner.lead.scanCount", { count: result.scanCount })}
                </Badge>
              </div>

              {/* KARTA OSOBY WYCHODZI TYLKO ZA ZGODĄ - i to jest druga zapora,
                  nie ozdoba. Dziś ratuje nas wyłącznie baza:
                  `event_lead_scan_record` oddaje `person => NULL`, gdy zgody
                  nie ma. Warunek na samym `person !== null` znaczył więc, że
                  JEDNA zmiana po stronie SQL - albo cofnięcie zgody między
                  skanem a renderem - wystawia mail i telefon obok plakietki
                  „brak zgody". Nagłówek tego panelu obiecuje, że „dane po
                  prostu nie wychodzą"; teraz to egzekwuje, a nie zakłada.
                  Ukrywamy CAŁĄ kartę, nie same dane kontaktowe, bo dokładnie
                  tak zachowuje się baza - dwie zapory mają mówić to samo. */}
              {consent && person !== null && (
                <div>
                  <p className="text-base font-semibold text-foreground">
                    {[person.firstName, person.lastName]
                      .filter((part): part is string => part !== null && part.trim() !== "")
                      .join(" ")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[person.jobTitle, person.company]
                      .filter((part): part is string => part !== null && part.trim() !== "")
                      .join(" · ")}
                  </p>
                  <p className="mt-1 break-all text-sm text-muted-foreground">
                    {[person.email, person.phone]
                      .filter((part): part is string => part !== null && part.trim() !== "")
                      .join(" · ")}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="lead-note"
                  className="block text-xs uppercase tracking-wide text-muted-foreground"
                >
                  {t("eventScanner.lead.noteLabel")}
                </label>
                <Textarea
                  id="lead-note"
                  rows={3}
                  value={note}
                  maxLength={2000}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("eventScanner.lead.notePlaceholder")}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("eventScanner.lead.ratingLabel")}
                </span>
                {RATINGS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={rating === value ? "secondary" : "outline"}
                    aria-pressed={rating === value}
                    onClick={() => setRating(rating === value ? null : value)}
                    className={cn("w-10")}
                  >
                    {value}
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                disabled={busy || lastCode === null || (note.trim() === "" && rating === null)}
                onClick={() => {
                  if (lastCode !== null) send(lastCode, true);
                }}
              >
                {t("eventScanner.lead.save")}
              </Button>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
