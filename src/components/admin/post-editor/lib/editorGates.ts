// Bramki edytora wpisu: SEO przy zapisie, checklista publikacji i wykrycie
// przeterminowanego harmonogramu. Wyjęte 1:1 z `usePostEditorForm`.
//
// Wszystkie trzy zwracają DANE albo KLUCZE i18n - nigdy gotowego tekstu.
// `isScheduledInPast` przyjmuje `now` jako argument, bo wersja w hooku czytała
// `Date.now()` wprost i nie dało się jej sprawdzić bez fałszowania zegara.
import type { PublishChecklist } from "@/lib/content/publishChecklist";
import { hasBlockingSeoIssues, type SeoIssue } from "@/lib/seo/validation";
import type { PostForm } from "../types";

export interface SeoSaveDecision {
  /** Twarda blokada zapisu (severity `error`). */
  blocked: boolean;
  /** Liczba ostrzeżeń pikselowych - zapis przechodzi, ale z ostrzeżeniem. */
  warningCount: number;
}

/**
 * Rozdziela problemy SEO na blokujące i ostrzegające.
 *
 * Rozróżnienie jest istotne: błąd wstrzymuje zapis, ostrzeżenie tylko informuje.
 * Zrównanie ich w jedną stronę albo zablokowałoby publikację z powodu paru
 * pikseli, albo przepuściłoby tytuł ucięty w wynikach wyszukiwania.
 */
export function seoSaveDecision(issues: SeoIssue[]): SeoSaveDecision {
  return {
    blocked: hasBlockingSeoIssues(issues),
    warningCount: issues.filter((i) => i.severity === "warning").length,
  };
}

/**
 * Klucze i18n brakujących pozycji WYMAGANYCH checklisty publikacji - do
 * wypisania w miękkiej bramce („brakuje: tytuł, okładka"). Zwraca klucze, nie
 * tekst, więc test nie zależy od copy.
 */
export function missingRequiredKeys(checklist: PublishChecklist | null): string[] {
  if (!checklist) return [];
  return checklist.missingRequired.map((i) => `adminPostPanes.publishChecklist.items.${i.id}`);
}

/**
 * Wpis zaplanowany na termin, który już minął. Panel pokazuje to jako
 * ostrzeżenie, bo taki wpis czeka na najbliższy przebieg schedulera, a redaktor
 * widzi status „zaplanowany" i zakłada, że wszystko jest w porządku.
 */
export function isScheduledInPast(
  form: Pick<PostForm, "status" | "publish_at"> | null,
  now: number,
): boolean {
  if (!form) return false;
  if (form.status !== "scheduled") return false;
  if (!form.publish_at) return false;
  const at = new Date(form.publish_at).getTime();
  // Nieparsowalna data nie jest „przeszłością" - NaN <= now jest fałszem, ale
  // zapisujemy to jawnie, żeby regułę dało się przeczytać.
  if (Number.isNaN(at)) return false;
  return at <= now;
}
