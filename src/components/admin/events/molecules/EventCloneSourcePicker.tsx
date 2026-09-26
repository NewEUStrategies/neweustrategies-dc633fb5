// Molekuła: „Kopiuj z poprzedniej edycji" na stronie tworzenia wydarzenia.
//
// DWIE DROGI TWORZENIA NA JEDNYM EKRANIE. Projekt modułu przewiduje obie:
// wydarzenie z rodzaju (kreator) i klon poprzedniej edycji. Wybór źródła stoi
// NAD kreatorem jako zwinięty przycisk - kto tworzy od zera, nie widzi
// wyszukiwarki, a kto przyszedł po kopię, ma ją jednym kliknięciem.
//
// WYSZUKIWARKA TO LISTA WYDARZEŃ. Wyniki idą z `admin_events_list` (ta sama
// fraza co na liście: tytuły, adres, miejsce), więc organizator znajdzie tu
// dokładnie to, co widzi na liście - nie drugą, inaczej filtrowaną kopię.
// Pytamy dopiero od dwóch znaków i po pauzie w pisaniu.
//
// WYBÓR PROWADZI POD ADRES, NIE DO STANU. `onPick` nawiguje na
// `/admin/events/new?from=<id>` - ekran klonu da się odświeżyć i przesłać.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Loader2, X } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cloneStatusKey } from "@/lib/events/eventCloneLabels";
import { formatEventDateTime } from "@/lib/events/timezone";
import { CLONE_SEARCH_MIN_LENGTH, useCloneSourceSearch } from "@/lib/events/useEventClone";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

/** Pauza w pisaniu, po której wyszukiwarka pyta bazę (ms). */
const SEARCH_DEBOUNCE_MS = 250;

export function EventCloneSourcePicker({ onPick }: { onPick: (eventId: string) => void }) {
  ensureCloneI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const phrase = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);
  const searchQ = useCloneSourceSearch(open ? phrase : "");
  const rows = searchQ.data ?? [];
  const searching = phrase.trim().length >= CLONE_SEARCH_MIN_LENGTH;

  if (!open) {
    return (
      <div className="mx-auto mb-4 flex w-full max-w-3xl justify-end">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminEventClone.entry.createFromPrevious")}
        </Button>
      </div>
    );
  }

  return (
    <section
      className="mx-auto mb-4 w-full max-w-3xl space-y-3 rounded-lg border border-border/60 bg-card p-4"
      aria-labelledby="event-clone-picker-title"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id="event-clone-picker-title" className="text-sm font-semibold">
            {t("adminEventClone.entry.pickerTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("adminEventClone.entry.pickerDescription")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("adminEventClone.entry.pickerClose")}
          onClick={() => {
            setOpen(false);
            setQ("");
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <AdminFormTextRow
        id="event-clone-picker-search"
        label={t("adminEventClone.entry.pickerSearch")}
        hint={t("adminEventClone.entry.pickerSearchHint")}
        value={q}
        maxLength={200}
        autoFocus
        onValueChange={setQ}
      />
      {searchQ.isFetching ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("adminEventClone.entry.pickerLoading")}
        </p>
      ) : null}
      {searchQ.isError ? (
        <p className="text-xs text-destructive" role="alert">
          {searchQ.error.message}
        </p>
      ) : null}
      {searching && searchQ.isSuccess && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("adminEventClone.entry.pickerEmpty")}</p>
      ) : null}
      {rows.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const title = pickLocalized(row, "title", lang);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted"
                  aria-label={t("adminEventClone.entry.pickerChoose", { title })}
                  onClick={() => onPick(row.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatEventDateTime(row.starts_at, row.timezone, lang)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t(cloneStatusKey(row.status))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
