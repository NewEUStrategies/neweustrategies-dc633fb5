// Admin → Wygląd → Rozmiary czcionek.
// Jedna tabela tokenów typografii UI. CSS w `src/styles.css` konsumuje
// wyłącznie zmienne `--fs-*`, więc zapis tutaj jest JEDYNYM miejscem zmiany
// rozmiarów etykiet, pól, list rozwijanych, przycisków i pola czatu.
//
// POLE POKAZUJE TO, CO WPISANO. Wartość kontrolowana rozmiarem przyciętym do
// zakresu (`effectiveFontSize`) uniemożliwiała wpisanie liczby dwucyfrowej:
// „1” natychmiast stawało się „9” (dolna granica), dopisane „6” dawało „96”,
// a zapis - 18 zamiast 16. Wiersz w edycji trzyma więc SUROWY tekst, liczba
// trafia do szkicu bez przycinania, a przycięcie (i powrót pola do postaci
// kanonicznej) następuje przy wyjściu z pola i przy zapisie.
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Save } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminFontScale, useSaveFontScale } from "@/hooks/useFontScale";
import { adminPageHead } from "@/lib/adminPageHead";
import { cn } from "@/lib/utils";
import {
  EMPTY_FONT_SCALE,
  FONT_SCALE_TOKENS,
  effectiveFontSize,
  normalizeFontScale,
  type FontScaleToken,
  type FontScaleValue,
} from "@/lib/theme/fontScale";
import { ensureI18n as ensureFontSizesI18n } from "@/lib/i18n-admin-font-sizes";

export const Route = createFileRoute("/admin/appearance/font-sizes")({
  head: () =>
    adminPageHead(
      "Font sizes",
      "Set platform font sizes for labels, fields, dropdowns, buttons and the chat composer. New European Strategies administration.",
    ),
  component: FontSizesPage,
});

/**
 * Tekst pola jako liczba px. Przeglądarka sanityzuje `value` pola `number` do
 * poprawnej liczby (z kropką) albo pustego tekstu; przecinek obsługujemy dla
 * środowisk, które podają surowy tekst (happy-dom, ewentualne pole `text`).
 */
const parsePx = (raw: string): number => Number(raw.replace(",", "."));

const outOfRange = (token: FontScaleToken, raw: string): boolean => {
  const px = parsePx(raw);
  return !(px >= token.minPx && px <= token.maxPx);
};

function withoutOverride(value: FontScaleValue, key: string): FontScaleValue {
  const { [key]: _drop, ...rest } = value;
  return rest;
}

function FontSizesPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureFontSizesI18n();
  const { t } = useTranslation();
  const query = useAdminFontScale();
  // Szkic startuje WYŁĄCZNIE z odczytu zakończonego po wejściu na ekran:
  // wpis w cache bywa sprzed minut, a „Zapisz" wysyła `font_scale` w całości,
  // więc szkic ze starego wpisu cofnąłby zmiany innego redaktora. Zatrzask:
  // edytor bierze dane RAZ - późniejszy refetch (także nieudany) nie cofa
  // niezapisanej edycji ani nie odmontowuje tabeli.
  const fresh = query.isSuccess && query.isFetchedAfterMount ? query.data : undefined;
  const [initial, setInitial] = useState<FontScaleValue | undefined>(fresh);
  if (fresh && !initial) setInitial(fresh);

  if (initial) return <FontScaleEditor initial={initial} />;
  if (query.isError && !query.isFetching) {
    // Błąd odczytu to NIE pusta tabela: rozmiary domyślne w polach wyglądałyby
    // jak stan najemcy, a zapis skasowałby jego nadpisania.
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-destructive">{t("fontScale.loadError")}</span>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{t("fontScale.loading")}</p>;
}

function FontScaleEditor({ initial }: { initial: FontScaleValue }) {
  const { t } = useTranslation();
  const save = useSaveFontScale();
  const idBase = useId();
  const [draft, setDraft] = useState<FontScaleValue>(initial);
  // Surowy tekst wierszy w edycji. `null` = przeglądarka ma w polu tekst,
  // którego nie umie odczytać jako liczby (`validity.badInput`), i raportuje
  // wtedy PUSTE `value` - bez tego rozróżnienia śmieć w polu kasowałby
  // nadpisanie tak samo jak świadome wyczyszczenie.
  const [edits, setEdits] = useState<Record<string, string | null>>({});

  const change = (key: string, input: HTMLInputElement) => {
    if (input.validity.badInput) {
      setEdits((prev) => ({ ...prev, [key]: null }));
      return;
    }
    const raw = input.value;
    setEdits((prev) => ({ ...prev, [key]: raw }));
    setDraft((prev) => {
      // Puste pole = powrót wiersza do rozmiaru domyślnego z arkusza.
      if (raw.trim() === "") return withoutOverride(prev, key);
      const px = parsePx(raw);
      // Bez przycinania: „1” to dopiero początek „16”. Strażnik skończoności
      // zostaje, choć pole `number` podaje tylko liczbę albo pusty tekst:
      // `NaN` w szkicu dałby „NaN” w polu i w podglądzie.
      return Number.isFinite(px) ? { ...prev, [key]: px } : prev;
    });
  };

  const commit = (key: string) => {
    setEdits(({ [key]: _done, ...rest }) => rest);
    setDraft((prev) =>
      typeof prev[key] === "number" ? { ...prev, [key]: effectiveFontSize(prev, key) } : prev,
    );
  };

  const reset = () => {
    setEdits({});
    setDraft(EMPTY_FONT_SCALE);
  };

  const submit = () => {
    // Zapis kliknięty bez wyjścia z pola niesie liczbę spoza zakresu. Hak i tak
    // ją przytnie, ale ekran ma pokazywać DOKŁADNIE to, co poszło do bazy.
    const clean = normalizeFontScale(draft);
    setEdits({});
    setDraft(clean);
    save.mutate(clean);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-display text-2xl">{t("fontScale.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("fontScale.intro")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={reset} disabled={save.isPending}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("fontScale.reset")}
          </Button>
          <Button type="button" onClick={submit} disabled={save.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? t("fontScale.saving") : t("fontScale.save")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[6px] border border-border">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.element")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.scope")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.variable")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.defaultSize")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.size")}</th>
              <th className="px-3 py-2 font-medium">{t("fontScale.columns.preview")}</th>
            </tr>
          </thead>
          <tbody>
            {FONT_SCALE_TOKENS.map((token) => {
              const current = effectiveFontSize(draft, token.key);
              const overridden = typeof draft[token.key] === "number";
              const edit = edits[token.key];
              const invalid =
                edit === null ||
                (edit !== undefined && edit.trim() !== "" && outOfRange(token, edit));
              const rangeId = `${idBase}-${token.key}-range`;
              return (
                <tr key={token.key} className="border-t border-border align-middle">
                  <td className="px-3 py-2 font-medium">{t(token.labelKey)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(token.scopeKey)}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{token.cssVar}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {overridden ? `${token.defaultPx} px` : t("fontScale.resetRow")}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min={token.minPx}
                      max={token.maxPx}
                      className="w-24"
                      aria-label={t(token.labelKey)}
                      aria-describedby={rangeId}
                      aria-invalid={invalid}
                      value={edit === undefined ? String(current) : (edit ?? "")}
                      onChange={(e) => change(token.key, e.currentTarget)}
                      // `onChange` Reacta milczy, gdy `value` się nie zmienia, a pole
                      // `number` podaje "" i dla pustego pola, i dla nieczytelnego
                      // tekstu. Przejście jednego w drugie (np. „1e” skasowane
                      // jednym ruchem) widać tylko w surowym zdarzeniu `input`.
                      onInput={(e) => change(token.key, e.currentTarget)}
                      onBlur={() => commit(token.key)}
                    />
                    <span
                      id={rangeId}
                      className={cn(
                        "mt-1 block text-[11px]",
                        invalid ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {t("fontScale.range", { min: token.minPx, max: token.maxPx })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span style={{ fontSize: `${current}px` }}>{t("fontScale.previewText")}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
