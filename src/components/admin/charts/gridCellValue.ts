// Wartość komórki siatki danych - odczyt szkicu i zapis liczby do pola.
//
// Osobny moduł (bez Reacta), bo te same reguły czytają komórki siatki
// wykresu i siatki mapy, a test sprawdza je bez montowania komponentu.
import { parseImportedCell, readImportedNumber } from "@/lib/charts/importNumber";
import {
  CLIPBOARD_MAX_CHARS,
  readClipboardTable,
  type ClipboardPayload,
} from "@/lib/charts/clipboardTable";

export const gridCellCls =
  "w-full min-w-[72px] h-8 rounded border border-border bg-background px-2 py-1.5 text-xs tabular-nums aria-[invalid=true]:border-destructive";

/** Wynik odczytu szkicu: `ok` - liczba albo świadoma luka; inaczej wpis do poprawy. */
export function readCellDraft(text: string): { ok: boolean; value: number | null } {
  if (text.trim() === "") return { ok: true, value: null };
  const { value } = parseImportedCell(text);
  if (value !== null) return { ok: true, value };
  return readImportedNumber(text).status === "missing"
    ? { ok: true, value: null }
    : { ok: false, value: null };
}

/**
 * Liczba do pola w KONWENCJI DOKUMENTU: wpis polski pokazuje przecinek
 * dziesiętny. Zapis zawsze idzie liczbą, więc wyświetlenie niczego nie
 * zmienia w treści; przecinek czyta z powrotem ta sama reguła.
 */
export function formatCellNumber(value: number | null, lang: "pl" | "en"): string {
  if (value === null || !Number.isFinite(value)) return "";
  const s = String(value);
  return lang === "pl" ? s.replace(".", ",") : s;
}

/**
 * Wartość JEDNEJ komórki skopiowanej z arkusza (tabela HTML 1×1) - napis
 * dokładnie taki, jaki ta sama komórka dałaby w zakresie: surowa liczba
 * (`x:num` Excela, `data-sheets-value` Arkuszy Google, `sdval` LibreOffice)
 * zamiast tekstu wyświetlanego, procent · 100, data jako tekst. `null`, gdy
 * schowek nie niesie komórki arkusza (tabeli HTML albo komórki Arkuszy
 * Google) - wtedy komórka wkleja `text/plain`.
 *
 * PO CO. Bez tego „1,234" z angielskiego Excela wklejone w jedną komórkę
 * dawało 1,234 (tekst wyświetlany, reguła zastana), a ta sama komórka
 * w zakresie - 1234 (surowa wartość). Ta sama liczba z arkusza musi dać tę
 * samą liczbę w siatce bez względu na to, ile komórek autor skopiował.
 *
 * JAK. `readClipboardTable` z rozmysłem nie uznaje jednej komórki za tabelę
 * (wołający wkleja wtedy zwykły napis). Pusta komórka-wypełniacz wstawiona
 * PRZED komórką arkusza robi z niej tabelę 1×2, której drugą komórkę czyta ta
 * sama funkcja, co każdy zakres - z formatem klasy, surową wartością i regułą
 * procentu - więc odczyt nie jest tu powielany.
 *
 * ARKUSZE GOOGLE NIE WKŁADAJĄ TABELI. Jedna komórka z Arkuszy to sam element
 * z `data-sheets-value` („<span data-sheets-root="1" ...>1,234</span>"), bez
 * `<table>` - Excel i LibreOffice dają tabelę 1×1. Taki element staje się
 * komórką tabeli ze WSZYSTKIMI swoimi atrybutami (wartość, format), więc
 * czyta go ta sama reguła.
 */
export function singleSheetCell(p: ClipboardPayload): string | null {
  const html = p.html ?? "";
  if (html === "" || html.length > CLIPBOARD_MAX_CHARS) return null;
  if (!/<table[\s>]/i.test(html) && !html.includes("data-sheets-value")) return null;
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cell = doc.querySelector("table td, table th") ?? komorkaArkuszy(doc);
  if (cell === null || cell.parentNode === null) return null;
  cell.parentNode.insertBefore(doc.createElement("td"), cell);
  const table = readClipboardTable({ html: doc.documentElement.outerHTML });
  if (table === null || table.rows.length !== 1 || table.rows[0].length !== 2) return null;
  return table.rows[0][1];
}

/** Jedna komórka Arkuszy Google bez tabeli -> komórka `<td>` w tabeli 1×1 w miejscu elementu. */
function komorkaArkuszy(doc: Document): Element | null {
  const root = doc.querySelector("[data-sheets-value]");
  if (root === null || root.parentNode === null) return null;
  const td = doc.createElement("td");
  for (const attr of Array.from(root.attributes)) td.setAttribute(attr.name, attr.value);
  while (root.firstChild !== null) td.appendChild(root.firstChild);
  const tr = doc.createElement("tr");
  const table = doc.createElement("table");
  tr.appendChild(td);
  table.appendChild(tr);
  root.parentNode.replaceChild(table, root);
  return td;
}
