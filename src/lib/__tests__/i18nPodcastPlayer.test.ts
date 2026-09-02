// Parzystosc PL/EN slownika odtwarzacza podcastu + pokrycie kluczy WOLANYCH
// w atomie + zapadka na powrocie do recznego `lang === "en" ? ... : ...`.
//
// PO CO OSOBNY PLIK, A NIE WPIS W `i18nPodcasts.test.ts`. Ten slownik obsluguje
// atom montowany na TRZECH niezaleznych powierzchniach (publiczna strona
// odcinka, podglad w edytorze redakcyjnym, widget kreatora stron), wiec nie jest
// czescia slownika publicznej sieci podcastow i nie ma tych samych konsumentow.
//
// KONSEKWENCJA DEFEKTU JEST TU MOCNIEJSZA NIZ PRZY ZWYKLEJ ETYKIECIE:
// przyciski odtwarzacza renderuja SAME IKONY, wiec brakujacy klucz nie zostawia
// pustego napisu, ktory ktos zauwazy - zostawia PRZYCISK BEZ NAZWY, widoczny
// wylacznie dla czytnika ekranu.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { podcastPlayerPl, podcastPlayerEn } from "@/lib/i18n-podcast-player";

type Tree = { [key: string]: string | Tree };

function flatten(node: Tree, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const PLAYER = "src/components/atoms/PodcastPlayer.tsx";
const source = readFileSync(PLAYER, "utf8");

const pl = flatten(podcastPlayerPl as unknown as Tree);
const en = flatten(podcastPlayerEn as unknown as Tree);

describe("i18n-podcast-player", () => {
  it("ma identyczny zestaw kluczy w PL i EN", () => {
    // Ten slownik nie ma form liczby mnogiej, wiec porownanie jest doslowne -
    // normalizacja sufiksow bylaby tu tylko sciezka na skroty dla przyszlego
    // klucza, ktory faktycznie by ich potrzebowal.
    expect(pl.sort()).toEqual(en.sort());
  });

  it("nie zawiera pustych tlumaczen ani pauzy typograficznej", () => {
    const values = [podcastPlayerPl, podcastPlayerEn].map((t) => JSON.stringify(t)).join(" ");
    expect(values).not.toContain("—");
    expect(values).not.toContain('""');
  });

  it("pokrywa KAZDY klucz podcastPlayer.* wolany w atomie", () => {
    // Atom wola etykiety przez `label("play")`, czyli klucz jest sklejany
    // z prefiksu. Skan czyta ARGUMENTY tego pomocnika, bo pelnego klucza
    // (`"podcastPlayer.play"`) nie ma w zrodle ani razu - i wlasnie dlatego
    // bramka rozjazdu kod<->slownik go nie widzi.
    const used = [...source.matchAll(/\blabel\(\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    expect(
      used.length,
      "skan nie znalazl ani jednego wolania label() - zmienil sie ksztalt kodu",
    ).toBeGreaterThan(5);

    const declared = new Set(pl.map((key) => key.replace(/^podcastPlayer\./, "")));
    const missing = [...new Set(used)].filter((key) => !declared.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it("KONTROLA NARZEDZIA: skan wylapuje klucz, ktorego w slowniku NIE MA", () => {
    // Bez tej kontroli poprzedni test przechodzilby tez wtedy, gdyby regex
    // przestal cokolwiek dopasowywac (pusta lista `used` = zielono).
    const fake = '<button aria-label={label("nieistniejacyKlucz")} />';
    const used = [...fake.matchAll(/\blabel\(\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    const declared = new Set(pl.map((key) => key.replace(/^podcastPlayer\./, "")));

    expect(used).toEqual(["nieistniejacyKlucz"]);
    expect(used.filter((key) => !declared.has(key))).toEqual(["nieistniejacyKlucz"]);
  });

  it("zachowuje interpolacje uzywana przez region aria-live", () => {
    // Literowka w nazwie zmiennej zamienia zapowiedz przewiniecia w surowy
    // placeholder czytany przez czytnik ekranu.
    expect(podcastPlayerPl.podcastPlayer.seekedTo).toContain("{{time}}");
    expect(podcastPlayerEn.podcastPlayer.seekedTo).toContain("{{time}}");
  });

  it("etykiety przewijania sa ZDANIAMI, nie skrotami sekundowymi", () => {
    // Stan zastany: `back: "-15s"` / `fwd: "+15s"`. Ikona nie ma tekstu, wiec
    // etykieta jest jedyna informacja o dzialaniu przycisku - a "-15s" czytane
    // na glos nie znaczy nic.
    for (const dict of [podcastPlayerPl, podcastPlayerEn]) {
      expect(dict.podcastPlayer.rewind).toMatch(/15/);
      expect(dict.podcastPlayer.rewind.split(" ").length).toBeGreaterThan(2);
      expect(dict.podcastPlayer.forward.split(" ").length).toBeGreaterThan(2);
    }
  });

  it("atom NIE wybiera juz etykiet recznym ternary po jezyku", () => {
    // Zapadka regresyjna. `lang` zostaje w atomie WYLACZNIE jako `lng` dla
    // `t()`, bo podglad redakcyjny wybiera jezyk PODGLADU zakladka - ale zaden
    // literal tekstowy nie moze wracac do rozgalezienia po jezyku.
    const withoutComments = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    expect(withoutComments).not.toMatch(/lang === "en" \? ["'`]/);
    expect(withoutComments).not.toMatch(/lang === "en" \? en : pl/);
  });
});
