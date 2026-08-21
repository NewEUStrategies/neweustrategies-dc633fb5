// Molekuła: JEDNA wartość słownika bazy jako znacznik do skopiowania.
//
// CO BYŁO W ORGANIZMIE. `ClubElementsCatalog` miał ten przycisk jako lokalny
// `VocabValue` - w tym samym pliku, w którym stoi macierz uprawnień i cztery
// zakładki, więc jedyną drogą do niego był render całego katalogu.
//
// DLACZEGO KLIKNIĘCIE KOPIUJE SUROWĄ WARTOŚĆ, A NIE ETYKIETĘ. To jest realny
// odruch operatora: wartości ze słownika wpisuje się potem do SQL-a i do
// odpowiedzi na zgłoszenie. Etykieta („Reguła Chatham House”) jest do czytania,
// wartość (`chatham`) jest do wklejenia - i kopiuje się właśnie ta druga.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać parę wartość-etykieta i oddać wartość do
// schowka. Molekuła nie zna słownika, nie filtruje i nie wie, w której sekcji
// stoi. Brak API schowka (starsza przeglądarka, kontekst bez uprawnień) nie
// może wywalić katalogu - stąd `?.`: przycisk wtedy po prostu nic nie robi.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";

export function ClubInboxCatalogValueChip({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const copy = () => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t("clubElements.ui.copied", { value })))
      .catch(() => toast.error(t("clubElements.ui.copyFailed")));
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={t("clubElements.ui.copyHint")}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-sm transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <code className="font-mono text-xs text-muted-foreground">{value}</code>
      <span aria-hidden className="text-border">
        ·
      </span>
      <span>{label}</span>
      <Copy
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}
