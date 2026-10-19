// Listy mailingowe jako SEGMENT kampanii kuponowej (P04, R-25).
//
// DLACZEGO. Segment kampanii kuponowej był wolnym tekstem („vip"), którego
// serwer wysyłki nie znał - kody szły do CAŁEJ listy. Serwer dopasowuje dziś
// segment do `id` listy z `newsletter_settings.popup_mailing_lists`
// (subskrybent ma ją w `meta.mailing_lists`) i odrzuca nieznany segment
// (fail-closed). Panel wybiera więc segment WYŁĄCZNIE z tych list, a „cała
// lista" jest osobną, jawnie nazwaną decyzją. Liść bez importów runtime.
import type { NewsletterMailingList } from "@/hooks/useNewsletterSettings";

/** Wartość opcji „cała lista subskrybentów" (w bazie: `newsletter_segment = NULL`). */
export const WHOLE_LIST_SEGMENT = "__whole_list__";

export interface MailingListOption {
  value: string;
  label: string;
}

/** Etykieta listy w języku interfejsu (druga wersja językowa, gdy pierwszej brak). */
function listLabel(list: NewsletterMailingList, lang: "pl" | "en"): string {
  const primary = lang === "en" ? list.label_en : list.label_pl;
  const other = lang === "en" ? list.label_pl : list.label_en;
  const label = [primary, other].find((v) => typeof v === "string" && v.trim() !== "");
  return label ?? list.id;
}

/** Listy z poprawnym `id` (puste i powtórzone identyfikatory odpadają). */
export function mailingListOptions(
  lists: readonly NewsletterMailingList[] | undefined,
  lang: "pl" | "en",
): MailingListOption[] {
  const seen = new Set<string>();
  const options: MailingListOption[] = [];
  for (const list of lists ?? []) {
    const id = typeof list?.id === "string" ? list.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ value: id, label: listLabel(list, lang) });
  }
  return options;
}

/**
 * Etykieta segmentu kampanii: nazwa listy albo `null`, gdy segmentu nie ma
 * wśród list (stary wolny tekst albo lista usunięta z ustawień - wysyłka go
 * odrzuci, więc ekran musi to pokazać, a nie udawać znaną listę).
 */
export function mailingListLabel(
  segment: string,
  lists: readonly NewsletterMailingList[] | undefined,
  lang: "pl" | "en",
): string | null {
  return mailingListOptions(lists, lang).find((o) => o.value === segment)?.label ?? null;
}
