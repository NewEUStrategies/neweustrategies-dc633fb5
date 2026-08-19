// Reguły moderacji klubu - operacje NIEODWRACALNE.
//
// `ClubModerationTab.tsx` wykonuje cztery rzeczy, których nie da się cofnąć
// z interfejsu: usunięcie wątku, wyrzucenie członka, ukrycie wpisu
// i ujawnienie autora anonimowej wypowiedzi. Trzy z nich mają regułę, która
// psuje się CICHO - i to te reguły są tutaj.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLUB_LOG_TARGETS } from "@/lib/clubs/types";
import {
  MIN_REVEAL_REASON,
  isAllSelected,
  isKnownModerationTarget,
  needsConfirmation,
  revealReasonAccepted,
  splitModerationBatch,
  toggleSelection,
  type ModerationQueueItem,
} from "@/lib/clubs/moderationRules";

function item(target_id: string, target_type: "thread" | "reply"): ModerationQueueItem {
  return { target_id, target_type };
}

const QUEUE: ModerationQueueItem[] = [
  item("t1", "thread"),
  item("r1", "reply"),
  item("t2", "thread"),
  item("r2", "reply"),
];

describe("splitModerationBatch - jedno RPC na typ celu", () => {
  it("rozbija zaznaczenie na wątki i odpowiedzi", () => {
    const batch = splitModerationBatch(QUEUE, new Set(["t1", "r1", "t2"]));

    // `admin_club_bulk_moderate` przyjmuje JEDEN typ celu, a kolejka miesza
    // wątki z odpowiedziami. Bez rozbicia część zaznaczenia po prostu nie
    // zostałaby zmoderowana, a komunikat i tak powiedziałby „gotowe".
    expect(batch.threadIds).toEqual(["t1", "t2"]);
    expect(batch.replyIds).toEqual(["r1"]);
    expect(batch.total).toBe(3);
  });

  it("zaznaczenie SAMYCH wątków nie tworzy pustej partii odpowiedzi", () => {
    const batch = splitModerationBatch(QUEUE, new Set(["t1", "t2"]));

    // Pusta partia oznaczałaby drugie wywołanie RPC o zero pozycji.
    expect(batch.replyIds).toEqual([]);
    expect(batch.threadIds).toHaveLength(2);
  });

  it("zaznaczenie SAMYCH odpowiedzi też", () => {
    const batch = splitModerationBatch(QUEUE, new Set(["r1", "r2"]));

    expect(batch.threadIds).toEqual([]);
    expect(batch.replyIds).toEqual(["r1", "r2"]);
  });

  it("puste zaznaczenie daje zerowy wsad", () => {
    expect(splitModerationBatch(QUEUE, new Set())).toEqual({
      threadIds: [],
      replyIds: [],
      total: 0,
    });
  });

  it("zaznaczenie pozycji, której NIE MA w kolejce, nie trafia do wsadu", () => {
    // Pozycja mogła zniknąć z kolejki między zaznaczeniem a kliknięciem
    // (ktoś inny ją zmoderował). `total` musi liczyć to, co REALNIE idzie,
    // żeby komunikat „47 z 50" mówił prawdę.
    const batch = splitModerationBatch(QUEUE, new Set(["t1", "znikniete"]));

    expect(batch.threadIds).toEqual(["t1"]);
    expect(batch.total).toBe(1);
  });

  it("nieznany typ celu NIE wpada do żadnej partii", () => {
    const queue = [...QUEUE, item("x1", "thread"), { target_id: "x2", target_type: "post" }];

    const batch = splitModerationBatch(queue, new Set(["x1", "x2"]));

    // Typ spoza kontraktu RPC nie ma dokąd pójść - lepiej go pominąć niż
    // wysłać jako wątek i skasować nie to, co trzeba.
    expect(batch.threadIds).toEqual(["x1"]);
    expect(batch.replyIds).toEqual([]);
    expect(batch.total).toBe(1);
  });

  it("zachowuje kolejność kolejki, nie kolejność zaznaczania", () => {
    const batch = splitModerationBatch(QUEUE, new Set(["t2", "t1"]));

    expect(batch.threadIds).toEqual(["t1", "t2"]);
  });

  it("pusta kolejka przy niepustym zaznaczeniu daje zero", () => {
    expect(splitModerationBatch([], new Set(["t1"])).total).toBe(0);
  });
});

describe("needsConfirmation - dialog tylko tam, gdzie nie ma odwrotu", () => {
  it("usunięcie PYTA", () => {
    expect(needsConfirmation("delete")).toBe(true);
  });

  it("zatwierdzenie i ukrycie NIE pytają - obie akcje da się cofnąć", () => {
    // Dialog przy każdej akcji uczy klikania „tak" bez czytania; wtedy dialog
    // przy usunięciu też przestaje cokolwiek chronić.
    expect(needsConfirmation("approve")).toBe(false);
    expect(needsConfirmation("hide")).toBe(false);
  });
});

describe("revealReasonAccepted - jedyna akcja łamiąca Chatham House", () => {
  it("powód poniżej progu jest odrzucany PRZED wysłaniem", () => {
    // RPC odrzuca pusty powód błędem 22023, ale moderator ma się o tym
    // dowiedzieć przed kliknięciem, nie po.
    expect(revealReasonAccepted("")).toBe(false);
    expect(revealReasonAccepted("krótko")).toBe(false);
  });

  it("same białe znaki to nie powód", () => {
    expect(revealReasonAccepted(" ".repeat(MIN_REVEAL_REASON + 5))).toBe(false);
  });

  it("próg liczy się PO przycięciu", () => {
    const exact = "a".repeat(MIN_REVEAL_REASON);

    expect(revealReasonAccepted(`   ${exact}   `)).toBe(true);
    expect(revealReasonAccepted(`   ${"a".repeat(MIN_REVEAL_REASON - 1)}   `)).toBe(false);
  });

  it("granica jest inkluzywna", () => {
    expect(revealReasonAccepted("a".repeat(MIN_REVEAL_REASON))).toBe(true);
    expect(revealReasonAccepted("a".repeat(MIN_REVEAL_REASON - 1))).toBe(false);
  });
});

describe("isKnownModerationTarget", () => {
  it("rozpoznaje KAŻDY typ ze słownika dziennika", () => {
    for (const target of CLUB_LOG_TARGETS) {
      expect(isKnownModerationTarget(target)).toBe(true);
    }
  });

  it("wpis HISTORYCZNY spoza słownika jest nieznany - widok pokaże wartość surową", () => {
    // Bez tego rozróżnienia trzeba by użyć `defaultValue`, a wtedy brak
    // klucza przechodzi przez bramkę parytetu niezauważony.
    expect(isKnownModerationTarget("nieznany_typ")).toBe(false);
    expect(isKnownModerationTarget("")).toBe(false);
  });

  it("NIE buduje klucza i18n - prefiks panelu należy do powierzchni panelu", () => {
    // Sekcja `adminClubs.moderation.*` żyje w słowniku dociąganym jawnie
    // (`ensureAdminClubsI18n`). Budowanie jej klucza w module osiągalnym
    // z tras publicznych obchodziłoby bramkę `adminClubsI18nLoading.gate`.
    const source = readFileSync(join(process.cwd(), "src/lib/clubs/moderationRules.ts"), "utf8");
    expect(source).not.toContain("adminClubs.moderation.target.");
  });
});

describe("toggleSelection / isAllSelected", () => {
  it("dokłada i zdejmuje id", () => {
    const empty: ReadonlySet<string> = new Set();

    const one = toggleSelection(empty, "t1");
    expect([...one]).toEqual(["t1"]);

    expect([...toggleSelection(one, "t1")]).toEqual([]);
  });

  it("NIE mutuje wejścia - stan Reacta musi dostać nowy zbiór", () => {
    const before: ReadonlySet<string> = new Set(["t1"]);

    const after = toggleSelection(before, "t2");

    expect([...before]).toEqual(["t1"]);
    expect(after).not.toBe(before);
  });

  it("'zaznacz wszystko' jest zaznaczone dopiero przy komplecie widocznej strony", () => {
    expect(isAllSelected(QUEUE, new Set(["t1", "r1", "t2"]))).toBe(false);
    expect(isAllSelected(QUEUE, new Set(["t1", "r1", "t2", "r2"]))).toBe(true);
  });

  it("PUSTA kolejka nie jest 'zaznaczona w całości'", () => {
    // Inaczej nagłówek pustej kolejki pokazywałby zaznaczony checkbox.
    expect(isAllSelected([], new Set())).toBe(false);
  });
});
