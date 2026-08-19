// Reguły edytora treści maili transakcyjnych.
//
// PO CO OSOBNO. Panel edytuje NADPISANIA szablonów: puste pole znaczy „użyj
// domyślnej treści", więc każda edycja jest odwracalna. Reguły, których pomyłka
// jest cicha:
//
//   * PATCH POLA musi trafić w jeden typ maila i jeden język. Zapis, który
//     nadpisuje cały obiekt, wyciera nadpisania pozostałych typów - i dopiero
//     odbiorca zobaczy, że przypomnienie o wygaśnięciu dostępu wróciło do
//     domyślnej treści.
//   * RESET dotyczy JEDNEGO języka. Reset obu wyciera pracę tłumacza.
//   * ZNACZNIK ZMIAN („dirty") decyduje, czy przycisk zapisu jest aktywny.
//     Fałszywe „brak zmian" znaczy, że operator nie może zapisać tego, co
//     właśnie wpisał.
import {
  TxOverridesSchema,
  type EditableTxType,
  type TxCopyOverride,
  type TxOverrides,
} from "@/lib/email/txOverrides";

export type TxLang = "pl" | "en";

/**
 * Nazwy zakładek edytora. Klucze, nie napisy - inaczej powstaje drugi słownik
 * poza zasięgiem bramki parytetu. Wypisane literalnie (a nie składane z
 * `EditableTxType`), żeby bramka pokrycia kluczy widziała każdy z nich.
 */
export const TYPE_LABEL_KEYS: Record<EditableTxType, string> = {
  team_seat_grace: "adminNewsletter.emailContent.types.team_seat_grace",
  team_seat_grace_reminder: "adminNewsletter.emailContent.types.team_seat_grace_reminder",
  team_seat_access_ended: "adminNewsletter.emailContent.types.team_seat_access_ended",
};

/** Pola nadpisania w kolejności, w jakiej redaktor je czyta w mailu. */
export const FIELDS: Array<{
  key: keyof TxCopyOverride;
  labelKey: string;
  multiline?: boolean;
}> = [
  { key: "subject", labelKey: "adminNewsletter.emailContent.fields.subject" },
  { key: "preview", labelKey: "adminNewsletter.emailContent.fields.preview" },
  { key: "eyebrow", labelKey: "adminNewsletter.emailContent.fields.eyebrow" },
  { key: "heading", labelKey: "adminNewsletter.emailContent.fields.heading" },
  { key: "intro", labelKey: "adminNewsletter.emailContent.fields.intro", multiline: true },
  { key: "extra", labelKey: "adminNewsletter.emailContent.fields.extra", multiline: true },
  { key: "cta", labelKey: "adminNewsletter.emailContent.fields.cta" },
  { key: "note", labelKey: "adminNewsletter.emailContent.fields.note", multiline: true },
];

/**
 * Zmiana JEDNEGO pola w JEDNYM języku JEDNEGO typu maila. Pozostałe typy,
 * języki i pola muszą przetrwać bez zmian - to jest cała reguła.
 */
export function setOverrideField(
  draft: TxOverrides,
  type: EditableTxType,
  lang: TxLang,
  key: keyof TxCopyOverride,
  value: string,
): TxOverrides {
  return {
    ...draft,
    [type]: { ...draft[type], [lang]: { ...draft[type][lang], [key]: value } },
  };
}

/**
 * Przywraca domyślną treść dla JEDNEGO języka jednego typu. Drugi język zostaje
 * nietknięty - reset obu wyciera pracę tłumacza.
 */
export function resetOverrideLang(
  draft: TxOverrides,
  type: EditableTxType,
  lang: TxLang,
): TxOverrides {
  const defaults = TxOverridesSchema.parse({});
  return {
    ...draft,
    [type]: { ...draft[type], [lang]: defaults[type][lang] },
  };
}

/** Czy szkic różni się od zapisanego stanu - to decyduje o aktywności zapisu. */
export function hasUnsavedChanges(draft: TxOverrides, saved: TxOverrides): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

/** Podpowiedź z dostępnymi tokenami, w formie, w jakiej wpisuje się je w treść. */
export function tokensHint(tokens: readonly string[]): string {
  return tokens.map((token) => `{${token}}`).join(", ");
}
