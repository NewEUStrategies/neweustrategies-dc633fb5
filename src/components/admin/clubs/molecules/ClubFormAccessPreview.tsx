// Molekuła: ŻYWY PODGLĄD ustawień dostępu plus ostrzeżenia o kombinacjach.
//
// PO CO OSOBNY PLIK. Podgląd jest w zakładce „Dostęp" sednem, nie ozdobą:
// administrator ustawia cztery droplisty, a skutkiem jest ich ILOCZYN - i to
// właśnie tam powstają kluby publiczne, które miały być zamknięte. Wyjęcie
// podglądu z organizmu daje mu własny test kolumny („co widzi administrator")
// niezależny od testu wpinania droplistów.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać złożone zdania i ostrzeżenia. Molekuła nie
// składa zdań (`buildAccessSentences`) ani nie wykrywa ostrzeżeń
// (`detectAccessWarnings`) - dostaje jedno i drugie gotowe.
import { AlertTriangle, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccessWarning } from "@/lib/clubs/accessSentence";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";

export function ClubFormAccessPreview({
  sentences,
  warnings,
}: {
  sentences: readonly string[];
  warnings: readonly AccessWarning[];
}) {
  // Tytuł podglądu i treść ostrzeżeń są w słowniku PANELU.
  ensureAdminClubsI18n();
  const { t } = useTranslation();

  return (
    // Podgląd jest sticky: administrator przewijając droplisty ma go stale
    // w polu widzenia, bo inaczej skutek zmiany widać dopiero po scrollu.
    <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" />
            {t("adminClubs.accessPreviewTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {sentences.map((sentence) => (
              <li key={sentence} className="flex gap-2 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"
                />
                <span>{sentence}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {warnings.length === 0 ? null : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              {t("adminClubs.accessWarning.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-xs text-amber-800 dark:text-amber-200">
              {warnings.map((warning) => (
                <li key={warning}>{t(`adminClubs.accessWarning.${warning}`)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
