// Fabryka kluczy react-query dla czatu. Jeden inwariant nadrzędny: KAŻDY klucz
// niesie id użytkownika, więc przełączenie konta nie może pokazać wątków
// poprzedniego. Ten plik miał 16% pokrycia, a jest jedyną barierą przed
// wyciekiem cache'u między kontami - awarią, której nie widzi ani `tsc`, ani
// RLS (dane są już po stronie klienta).
import { describe, expect, it } from "vitest";
import { chatKeys } from "../keys";
import { CHAT_IDS } from "@/test/chat/fixtures";

/** Wszystkie klucze wyliczone dla danego użytkownika - do porównań między kontami. */
function allKeysFor(uid: string | undefined): string[] {
  return [
    chatKeys.conversations(uid),
    chatKeys.messages(uid, CHAT_IDS.conversation),
    chatKeys.reactions(uid, CHAT_IDS.conversation),
    chatKeys.peers(uid, [CHAT_IDS.peer]),
    chatKeys.people(uid, "anna"),
    chatKeys.attachments(uid, CHAT_IDS.conversation),
    chatKeys.stars(uid, CHAT_IDS.conversation),
    chatKeys.nicknames(uid),
    chatKeys.messageSearch(uid, CHAT_IDS.conversation, "polityka"),
    chatKeys.starredList(uid, CHAT_IDS.conversation),
  ].map((key) => JSON.stringify(key));
}

describe("chatKeys - izolacja kont", () => {
  it("KAŻDY klucz per użytkownik różni się między kontami", () => {
    const mine = allKeysFor(CHAT_IDS.me);
    const theirs = allKeysFor(CHAT_IDS.peer);
    const shared = mine.filter((key) => theirs.includes(key));
    expect(shared).toEqual([]);
  });

  it("brak sesji dostaje własną przestrzeń `anon`, nie klucz bez segmentu", () => {
    for (const key of allKeysFor(undefined)) {
      expect(key).toContain('"anon"');
    }
  });

  it("wszystkie klucze wychodzą z korzenia `chat` (hurtowe unieważnienie działa)", () => {
    const roots = allKeysFor(CHAT_IDS.me).map((key) => (JSON.parse(key) as string[])[0]);
    // Podpis załącznika jest kluczem PER ŚCIEŻKA (bez id użytkownika), ale też
    // musi wychodzić z tego samego korzenia - inaczej `invalidateQueries(["chat"])`
    // go nie obejmie.
    roots.push(chatKeys.attachmentUrl("t/c/u/a.png")[0]);
    expect(new Set(roots)).toEqual(new Set(["chat"]));
    expect(chatKeys.all).toEqual(["chat"]);
  });
});

describe("chatKeys - stabilność i rozdzielność", () => {
  it("klucz profili jest niezależny od KOLEJNOŚCI id (jedno zapytanie, nie dwa)", () => {
    expect(chatKeys.peers(CHAT_IDS.me, [CHAT_IDS.peer, CHAT_IDS.peerTwo])).toEqual(
      chatKeys.peers(CHAT_IDS.me, [CHAT_IDS.peerTwo, CHAT_IDS.peer]),
    );
  });

  it("klucz profili nie mutuje przekazanej tablicy", () => {
    const ids = [CHAT_IDS.peerTwo, CHAT_IDS.peer];
    chatKeys.peers(CHAT_IDS.me, ids);
    expect(ids).toEqual([CHAT_IDS.peerTwo, CHAT_IDS.peer]);
  });

  it("różne rozmowy tego samego użytkownika mają różne klucze historii", () => {
    expect(chatKeys.messages(CHAT_IDS.me, CHAT_IDS.conversation)).not.toEqual(
      chatKeys.messages(CHAT_IDS.me, CHAT_IDS.otherConversation),
    );
  });

  it("wyszukiwanie w skrzynce (null) nie zderza się z wyszukiwaniem w rozmowie", () => {
    expect(chatKeys.messageSearch(CHAT_IDS.me, null, "x")).toEqual([
      "chat",
      "message-search",
      CHAT_IDS.me,
      "all",
      "x",
    ]);
    expect(chatKeys.messageSearch(CHAT_IDS.me, null, "x")).not.toEqual(
      chatKeys.messageSearch(CHAT_IDS.me, CHAT_IDS.conversation, "x"),
    );
  });

  it("gwiazdki bąbelkowe i lista gwiazdkowanych to ROZŁĄCZNE klucze", () => {
    expect(chatKeys.stars(CHAT_IDS.me, CHAT_IDS.conversation)).not.toEqual(
      chatKeys.starredList(CHAT_IDS.me, CHAT_IDS.conversation),
    );
  });

  it("podpisany URL załącznika jest kluczem PER ŚCIEŻKA, wspólnym dla kont", () => {
    // Świadomie bez id użytkownika: ścieżka w prywatnym buckecie jest już
    // scoped tenantem i rozmową, a storage RLS i tak sprawdza członkostwo -
    // wspólny klucz oszczędza podpisy przy dwóch otwartych powierzchniach.
    expect(chatKeys.attachmentUrl("t/c/u/a.png")).toEqual([
      "chat",
      "attachment-url",
      "t/c/u/a.png",
    ]);
  });
});
