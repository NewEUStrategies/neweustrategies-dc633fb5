// Migawka bloku `<style>` i skrót danych wejściowych generatora - fundament
// odroczenia generatorów CSS korzenia (`useDeferredStyleCss`). Skrót MUSI być
// identyczny po obu stronach dla tych samych danych i różny dla różnych -
// inaczej klient albo liczy CSS na darmo, albo zostaje ze starym blokiem.
import { afterEach, describe, expect, it } from "vitest";
import { STYLE_HASH_ATTR, hashStyleInput, readStyleSnapshot } from "../styleSnapshot";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("hashStyleInput", () => {
  it("jest deterministyczny dla równych strukturalnie danych", () => {
    const a = { tokens: { colors: [{ name: "x", value: "#fff" }] }, globals: {} };
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(hashStyleInput(a)).toBe(hashStyleInput(b));
  });

  it("rozróżnia różne dane, w tym brak wiersza od pustego i `null`", () => {
    const seen = new Set([
      hashStyleInput(undefined),
      hashStyleInput(null),
      hashStyleInput({}),
      hashStyleInput({ a: 1 }),
      hashStyleInput({ a: 2 }),
      hashStyleInput({ a: "1" }),
    ]);
    expect(seen.size).toBe(6);
  });

  it("daje krótki identyfikator zdatny na atrybut HTML (base36, bez cudzysłowów)", () => {
    const hash = hashStyleInput({ blockHeading: { fontSize: "11px" } });
    expect(hash).toMatch(/^[0-9a-z]{8,14}$/);
  });

  it("ignoruje właściwości `undefined` tak samo jak serializacja do klienta", () => {
    // Dehydratacja gubi `undefined`, więc serwer i klient muszą dać ten sam skrót.
    expect(hashStyleInput({ a: 1, b: undefined })).toBe(hashStyleInput({ a: 1 }));
  });
});

describe("readStyleSnapshot", () => {
  it("zwraca null, gdy w dokumencie nie ma bloku z danym znacznikiem", () => {
    expect(readStyleSnapshot("data-theme-design")).toBeNull();
  });

  it("czyta treść i skrót z pierwszego bloku ze znacznikiem", () => {
    const el = document.createElement("style");
    el.setAttribute("data-theme-design", "");
    el.setAttribute(STYLE_HASH_ATTR, "abc123");
    el.textContent = ":root{--td-bh-size:11px;}";
    document.head.appendChild(el);
    expect(readStyleSnapshot("data-theme-design")).toEqual({
      css: ":root{--td-bh-size:11px;}",
      hash: "abc123",
    });
  });

  it("blok bez skrótu (HTML sprzed wdrożenia) daje pusty skrót, nie wyjątek", () => {
    const el = document.createElement("style");
    el.setAttribute("data-brand-tokens", "");
    el.textContent = ":root{}";
    document.head.appendChild(el);
    expect(readStyleSnapshot("data-brand-tokens")).toEqual({ css: ":root{}", hash: "" });
  });
});
