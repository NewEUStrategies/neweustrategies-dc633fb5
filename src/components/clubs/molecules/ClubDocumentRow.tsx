// Molekuła: jedna pozycja w bibliotece źródeł wątku.
//
// Wiersz jest POZYCJĄ BIBLIOGRAFICZNĄ, nie kafelkiem pliku: tytuł, wydawca,
// data wydania, kto wniósł. Za pół roku to właśnie te cztery rzeczy decydują,
// czy z dyskusji da się cokolwiek odtworzyć - nazwa pliku i ikonka nie.
//
// Adres otwiera się w nowej karcie z `rel="noopener noreferrer"`: źródła
// wskazują poza platformę, a `window.opener` zostawiony obcej stronie to
// klasyczne tabnabbing.
import { useTranslation } from "react-i18next";
import { ExternalLink, Pencil, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClubDocumentIcon } from "@/components/clubs/atoms/ClubEntryIcon";
import { formatDateShort, formatNumber } from "@/lib/i18n/format";
import { toClubDocumentKind, type ClubThreadDocumentRow } from "@/lib/clubs/workspaceTypes";

/** Rozmiar pliku dla człowieka. Zwraca `null`, gdy baza go nie zna - "0 B"
 *  przy nieznanym rozmiarze byłoby informacją nieprawdziwą. */
export function formatBytes(bytes: number | null, lang: string): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${formatNumber(rounded, lang)} ${units[unit]}`;
}

export function ClubDocumentRow({
  row,
  lang,
  onEdit,
  onRemove,
}: {
  row: ClubThreadDocumentRow;
  lang: "pl" | "en";
  onEdit?: (row: ClubThreadDocumentRow) => void;
  onRemove?: (row: ClubThreadDocumentRow) => void;
}) {
  const { t } = useTranslation();
  const kind = toClubDocumentKind(row.kind);
  const size = formatBytes(row.byte_size, lang);
  const canAct = row.can_edit && (onEdit !== undefined || onRemove !== undefined);
  const host = toHostLabel(row.url);

  // Metadane jako OSOBNE znaczniki, nie jeden string sklejony kropkami: przy
  // czterech pozycjach ciąg "Dokument · Komisja Europejska · 12.03.2026 · 1,2 MB"
  // czyta się jak zdanie, a to są cztery niezależne fakty o źródle.
  const meta = [
    t(`club.workspace.documentKind.${kind}`),
    row.source_label,
    row.published_on !== null ? formatDateShort(row.published_on, lang) : null,
    size,
    host,
  ].filter((part): part is string => part !== null && part.length > 0);

  return (
    <li className="group/doc rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3 p-3 sm:gap-3.5 sm:p-4">
        {/* Kafel rodzaju: kwadrat 40px z delikatnym tłem. Wcześniej ikona stała
            na 32px bez kontrastu i przy trzech pozycjach nie dawało się
            odróżnić zbioru danych od notatki bez czytania etykiety. */}
        <span
          className={
            "grid h-10 w-10 shrink-0 place-items-center rounded-lg border " +
            (row.is_primary
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border/60 bg-muted/60 text-muted-foreground")
          }
        >
          <ClubDocumentIcon kind={kind} className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {row.url !== null && row.url.length > 0 ? (
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-snug underline-offset-4 hover:underline"
              >
                <span className="truncate">{row.title}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
              </a>
            ) : (
              <span className="truncate text-[15px] font-semibold leading-snug">{row.title}</span>
            )}
            {row.is_primary ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-none text-primary"
                title={t("club.workspace.documents.primaryHint")}
              >
                <Star className="h-3 w-3" aria-hidden="true" />
                {t("club.workspace.documents.primary")}
              </span>
            ) : null}
          </div>

          {meta.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap items-center gap-1">
              {meta.map((part) => (
                <li
                  key={part}
                  className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
                >
                  {part}
                </li>
              ))}
            </ul>
          ) : null}

          {row.description !== null && row.description.length > 0 ? (
            <p className="mt-2 line-clamp-3 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
              {row.description}
            </p>
          ) : null}

          {/* Kto wniósł - pod regułą Chatham House baza nie zwraca autora,
              więc ten wiersz po prostu nie powstaje. */}
          {row.added_by_name !== null ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("club.workspace.documents.addedBy", { name: row.added_by_name })}
            </p>
          ) : null}
        </div>

        {canAct ? (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/doc:opacity-100 sm:opacity-60">
            {onEdit !== undefined ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label={t("club.editor.edit")}
                onClick={() => onEdit(row)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {onRemove !== undefined ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                aria-label={t("club.workspace.remove")}
                onClick={() => onRemove(row)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Domena źródła - jedyna informacja, która na pierwszy rzut oka odróżnia
 * dokument Komisji od wpisu na blogu. Adres bez `http(s)://` i bez `www.`,
 * bo w tym pasku liczy się nazwa, nie protokół. Zwraca `null`, gdy adresu nie
 * ma albo nie da się go sparsować - zgadywanie po `split("/")` produkowałoby
 * śmieci w miejscu, które ma budować zaufanie.
 */
export function toHostLabel(url: string | null): string | null {
  if (url === null || url.length === 0) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
