// Czyste reguły panelu „Wersje → Widgety i popupy”.
//
// Wyniesione z `organisms/BuilderVersionsPane.tsx`, bo organizm eksportował
// dwie funkcje budujące dokument podglądu (atomic design nie przewiduje
// eksportu narzędzi z organizmu), a trzecia reguła - który typ encji dostaje
// mutacja przywracania - żyła w wyrażeniu warunkowym wewnątrz ciała
// komponentu, gdzie nie dało się jej sprawdzić bez wyrenderowania całego
// panelu razem z trzema zapytaniami i rendererem buildera.
import { newId, type BuilderDocument, type SectionNode } from "@/lib/builder/types";
import type { BuilderEntityType } from "@/lib/builder/revisions";
import { uiLocale } from "@/lib/i18n/format";

/** Zakładki panelu: dwa typy encji buildera + szablony sekcji. */
export type BuilderVersionsTab = BuilderEntityType | "template";

/**
 * Typ encji, którym ma się posłużyć mutacja przywracania wersji.
 *
 * `null` dla szablonów sekcji: te mają własną warstwę danych
 * (`useTemplateRevisions`) i nie przechodzą przez `useRestoreBuilderRevision`,
 * więc panel nie pokazuje dla nich przycisku przywracania.
 *
 * REGRESJA, którą ta funkcja zamyka: obie gałęzie warunku w organizmie
 * zwracały `"global_widget"` (`tab === "template" ? "global_widget" :
 * "global_widget"`), więc przywracanie wersji POPUPU szło ścieżką widgetu
 * globalnego. Skutek dla redaktora był najbardziej mylący z możliwych:
 * podgląd pokazywał właściwą starą wersję popupu (ta gałąź rozróżniała
 * zakładki poprawnie), a kliknięcie „Przywróć tę wersję" kończyło się
 * ogólnym „Nie udało się przywrócić" - bo `parseGlobalWidgetRevision`
 * dostawał payload popupu (`{builder_data, settings}`) i zwracał `null`.
 * Gdyby kiedykolwiek sparsował, zapis poszedłby UPDATE-em na
 * `builder_global_widgets` po identyfikatorze popupu - czyli w zero wierszy,
 * z komunikatem o sukcesie.
 */
export function restoreEntityType(tab: BuilderVersionsTab): BuilderEntityType | null {
  return tab === "template" ? null : tab;
}

/**
 * Argumenty zapytania o listę wersji buildera dla danej zakładki. Szablony
 * czytają z innego źródła, więc dostają `entityId: null`, co wyłącza zapytanie.
 */
export function builderRevisionsQuery(
  tab: BuilderVersionsTab,
  entityId: string | null,
): { entityType: BuilderEntityType; entityId: string | null } {
  return {
    entityType: tab === "template" ? "global_widget" : tab,
    entityId: tab === "template" ? null : entityId,
  };
}

/** Owija pojedynczą sekcję w dokument, żeby dało się ją wyrenderować. */
export function documentForSection(section: SectionNode): BuilderDocument {
  return { version: 1, sections: [section] };
}

/** Syntetyczny dokument z jednego widgetu (podgląd widgetu globalnego). */
export function documentForWidget(data: {
  type: string;
  content?: Record<string, unknown>;
  style?: unknown;
  advanced?: unknown;
}): BuilderDocument {
  const widget = { id: newId(), kind: "widget", ...data } as unknown as SectionNode["children"][0];
  return {
    version: 1,
    sections: [
      {
        id: newId(),
        kind: "section",
        children: [
          {
            id: newId(),
            kind: "column",
            span: 12,
            children: [widget],
          } as unknown as SectionNode["children"][0],
        ],
      },
    ],
  };
}

/**
 * Data wersji w formacie panelu. Przy niepoprawnym znaczniku oddaje wejście
 * bez zmian - lista wersji ma pokazać, CO jest w bazie, a nie „Invalid Date".
 */
export function formatVersionDate(iso: string, lang: "pl" | "en"): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
