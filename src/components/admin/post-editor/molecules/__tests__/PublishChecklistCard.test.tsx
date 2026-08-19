// CO DOWODZI TEN PLIK: karta „Checklista publikacji" pokazuje redaktorowi TĘ
// SAMĄ ocenę, która steruje bramką przejścia w `published`/`scheduled`
// (`buildPublishChecklist` -> `usePostEditorForm`), i pokazuje ją w rozbiciu na
// pozycje WYMAGANE i ZALECANE oraz jako wynik 0-100.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA. Karta jest jedynym miejscem, w którym
// redaktor widzi braki PRZED naciśnięciem „publikuj". Gdy reguła pęknie:
//   * pozycja wymagana wyrenderowana w sekcji zalecanych (albo odwrotnie) uczy
//     redakcję, że brak okładki jest „opcjonalny" - a dialog przy publikacji
//     powie coś innego; karta i bramka rozjadą się w oczach użytkownika,
//   * pozycja NIEPUNKTOWANA (`sponsoredDisclosure`) zniknięta z listy zabiera
//     jedyny widoczny sygnał, że deklaracja komercyjna jest niekompletna -
//     a to brak USTAWOWY, nie kosmetyczny,
//   * `aria-valuenow` rozjechane z liczbą przy pasku odcina od wyniku osoby
//     korzystające z czytnika ekranu (pasek jest grafiką, liczba jest tekstem).
//
// Asercje idą po KLUCZACH i18n (stub `reactI18nextStub`), nie po polskim copy -
// brzmienia pilnują osobne bramki parytetu i18n.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { publishChecklist } from "@/test/post-editor/fixtures";
import type { ChecklistItem, PublishChecklist } from "@/lib/content/publishChecklist";
import { PublishChecklistCard } from "../PublishChecklistCard";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

const K = {
  score: "adminPostPanes.publishChecklist.scoreLabel",
  required: "adminPostPanes.publishChecklist.requiredHeading",
  recommended: "adminPostPanes.publishChecklist.recommendedHeading",
  item: (id: ChecklistItem["id"]) => `adminPostPanes.publishChecklist.items.${id}`,
} as const;

function item(id: ChecklistItem["id"], level: ChecklistItem["level"], ok: boolean): ChecklistItem {
  return { id, level, ok };
}

function renderCard(overrides: Partial<PublishChecklist> = {}) {
  return render(<PublishChecklistCard checklist={publishChecklist(overrides)} />);
}

/**
 * Sekcja („wymagane" / „zalecane") to nagłówek + lista pod nim. Szukamy przez
 * NAGŁÓWEK, a nie przez klasę CSS ani kolejność w drzewie: kontraktem karty
 * jest „pod tym nagłówkiem stoją te pozycje", nie konkretny kształt DOM.
 */
function itemsUnder(headingKey: string): string[] {
  const heading = screen.getByText(headingKey);
  const box = heading.parentElement;
  if (!box) throw new Error(`brak kontenera sekcji dla nagłówka ${headingKey}`);
  return within(box)
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

afterEach(cleanup);

describe("PublishChecklistCard - wynik punktowy widziany i ogłaszany", () => {
  it.each([
    [0, "0/100"],
    [45, "45/100"],
    [85, "85/100"],
    [100, "100/100"],
  ])("wynik %i jest pokazany liczbowo i ogłoszony przez pasek postępu", (score, text) => {
    renderCard({ score });
    expect(screen.getByText(text)).toBeInTheDocument();
    // Liczba dla patrzącego i `aria-valuenow` dla czytnika ekranu muszą mówić
    // to samo - inaczej jedna z grup dostaje inny wynik niż druga.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(score));
  });

  it("pasek postępu ma domkniętą skalę i nazwę dostępną", () => {
    renderCard({ score: 70 });
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    // Bez nazwy pasek jest dla czytnika ekranu anonimowym „70" bez kontekstu.
    expect(bar).toHaveAttribute("aria-label", K.score);
  });

  it("wypełnienie paska odpowiada wynikowi, a nie stałej szerokości", () => {
    renderCard({ score: 45 });
    const fill = screen.getByRole("progressbar").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("45%");
  });

  it("trzy poziomy ryzyka dają TRZY różne paski (zielony / pomarańczowy / czerwony)", () => {
    // Kolor paska jest jedynym nośnikiem sygnału „jak blisko publikacji jesteś".
    // Nie przywiązujemy się do nazw klas (te wolno refaktorować), ale progi
    // 80 i 50 MUSZĄ rozdzielać trzy różne wyglądy - inaczej redaktor widzi
    // wpis w 10% tak samo jak wpis gotowy.
    const fillClass = (score: number): string => {
      renderCard({ score });
      const cls = (screen.getByRole("progressbar").firstElementChild as HTMLElement).className;
      cleanup();
      return cls;
    };
    const classes = [fillClass(80), fillClass(50), fillClass(49)];
    expect(new Set(classes).size).toBe(3);
    // Granice są włączające: 80 to już „dobrze", 50 to jeszcze „ostrzeżenie".
    expect(fillClass(100)).toBe(classes[0]);
    expect(fillClass(79)).toBe(classes[1]);
    expect(fillClass(0)).toBe(classes[2]);
  });
});

describe("PublishChecklistCard - rozdział pozycji wymaganych i zalecanych", () => {
  it("pozycja wymagana stoi pod nagłówkiem wymaganych, zalecana pod zalecanymi", () => {
    renderCard();
    expect(itemsUnder(K.required)).toEqual([
      K.item("titlePl"),
      K.item("cover"),
      K.item("category"),
    ]);
    expect(itemsUnder(K.recommended)).toEqual([K.item("descriptionPl")]);
  });

  it("kolejność pozycji w sekcji jest kolejnością z oceny, nie alfabetyczną", () => {
    // Kolejność niesie priorytet redakcyjny (tytuł przed okładką przed
    // kategorią) - przetasowanie zmieniłoby to, co redaktor poprawia pierwsze.
    renderCard({
      items: [
        item("category", "required", false),
        item("titlePl", "required", true),
        item("cover", "required", false),
      ],
    });
    expect(itemsUnder(K.required)).toEqual([
      K.item("category"),
      K.item("titlePl"),
      K.item("cover"),
    ]);
  });

  it("braki są widoczne razem ze spełnionymi pozycjami, a nie ukryte", () => {
    // Lista pełna (spełnione + braki) jest jedynym miejscem, gdzie redaktor
    // widzi, CZEGO brakuje. Filtrowanie braków „żeby było czyściej" zabrałoby
    // funkcję karty.
    renderCard({
      items: [
        item("titlePl", "required", true),
        item("cover", "required", false),
        item("tags", "recommended", false),
      ],
      missingRequired: [item("cover", "required", false)],
      missingRecommended: [item("tags", "recommended", false)],
      requiredOk: false,
      score: 25,
    });
    expect(itemsUnder(K.required)).toEqual([K.item("titlePl"), K.item("cover")]);
    expect(itemsUnder(K.recommended)).toEqual([K.item("tags")]);
  });

  it("pozycja niepunktowana (deklaracja komercyjna) też jest pokazana jako wymagana", () => {
    // `sponsoredDisclosure` jest świadomie POZA punktacją (skala 0-100), ale
    // pełni rolę bramki. Gdyby wypadła z listy, redaktor nie miałby ŻADNEGO
    // sygnału, że brak ujawnienia zablokuje publikację - a to obowiązek
    // ustawowy, nie miara jakości tekstu.
    renderCard({
      items: [item("titlePl", "required", true), item("sponsoredDisclosure", "required", false)],
      missingRequired: [item("sponsoredDisclosure", "required", false)],
      requiredOk: false,
      score: 100,
    });
    expect(itemsUnder(K.required)).toContain(K.item("sponsoredDisclosure"));
    // Wynik zostaje na 100 - pozycja nie jest składnikiem oceny.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("puste sekcje zachowują nagłówki, więc lista nie wygląda na uciętą", () => {
    renderCard({ items: [], missingRequired: [], missingRecommended: [], score: 0 });
    expect(screen.getByText(K.required)).toBeInTheDocument();
    expect(screen.getByText(K.recommended)).toBeInTheDocument();
    expect(itemsUnder(K.required)).toEqual([]);
    expect(itemsUnder(K.recommended)).toEqual([]);
  });

  it("sekcja zalecanych nie pokazuje pozycji wymaganych, gdy zalecanych nie ma", () => {
    renderCard({ items: [item("titlePl", "required", true)] });
    expect(itemsUnder(K.recommended)).toEqual([]);
    expect(itemsUnder(K.required)).toEqual([K.item("titlePl")]);
  });
});
