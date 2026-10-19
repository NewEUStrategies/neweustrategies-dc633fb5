import { describe, expect, it } from "vitest";
import {
  isSafeHttpUrl,
  normalizeLinkPreviewData,
  normalizeUrl,
  pickIntro,
  pickLabel,
  previewImageUrl,
} from "@/lib/blocks/linkPreview";

// Blok „Podgląd linku" bez statycznego obrazka pokazuje zrzut ekranu strony
// docelowej z Microlinka - to JEDYNE zapytanie, które ten blok wysyła poza
// serwis, więc jego parametry są kontraktem: adres strony (już po
// normalizacji do http/https), rozmiar ekranu z ustawień bloku i schemat
// kolorów motywu. Sąsiedni `linkPreview.test.ts` dowodzi ścieżki ze
// statycznym obrazkiem; tu - ścieżki zrzutu i brzegów normalizacji wejścia.
// Moduł jest czysty - zero atrap, nic nie wychodzi do sieci (budujemy URL).

const params = (url: string) => new URL(url).searchParams;

describe("previewImageUrl - zrzut ekranu, gdy brak statycznego obrazka", () => {
  const model = normalizeLinkPreviewData({
    items: [{ labelPl: "A", url: "a.pl/raport?x=1", imageSrc: "   " }],
    width: 300,
    height: "150",
  });

  it("pyta Microlinka o znormalizowany adres w rozmiarze bloku x3 (jasny motyw domyślnie)", () => {
    const url = previewImageUrl(model.items[0], model);
    expect(url.startsWith("https://api.microlink.io/?")).toBe(true);
    const q = params(url);
    expect(q.get("url")).toBe("https://a.pl/raport?x=1");
    expect(q.get("screenshot")).toBe("true");
    expect(q.get("embed")).toBe("screenshot.url");
    expect(q.get("colorScheme")).toBe("light");
    expect(q.get("viewport.width")).toBe("900");
    expect(q.get("viewport.height")).toBe("450");
  });

  it("w ciemnym motywie prosi o ciemny zrzut", () => {
    expect(params(previewImageUrl(model.items[0], model, "dark")).get("colorScheme")).toBe("dark");
  });
});

describe("normalizacja wejścia redakcji", () => {
  it.each(["", "   ", "nie jest adresem", "ftp://a.pl/plik"])(
    "isSafeHttpUrl(%j) odrzuca wartość, która nie jest adresem http(s)",
    (value) => {
      expect(isSafeHttpUrl(value)).toBe(false);
    },
  );

  it.each([
    ["", ""],
    ["   ", ""],
    ["a b.pl", ""],
    ["http://", ""],
    ["mailto:redakcja@a.pl", ""],
    ["  HTTPS://A.pl/x  ", "HTTPS://A.pl/x"],
    ["a.pl", "https://a.pl"],
  ])("normalizeUrl(%j) -> %j", (raw, expected) => {
    expect(normalizeUrl(raw)).toBe(expected);
  });

  it("etykieta bez tekstu w obu językach pokazuje adres, a nie pusty link", () => {
    const [item] = normalizeLinkPreviewData({
      items: [{ labelPl: "  ", labelEn: "", url: "a.pl" }],
    }).items;
    expect(pickLabel(item, "pl")).toBe("https://a.pl");
    expect(pickLabel(item, "en")).toBe("https://a.pl");
  });

  it("intro EN spada na PL, a brak obu daje pusty napis", () => {
    expect(pickIntro(normalizeLinkPreviewData({ introEn: "See" }), "pl")).toBe("See");
    expect(pickIntro(normalizeLinkPreviewData({ introPl: " ", introEn: "" }), "en")).toBe("");
  });

  it("dane bloku z wartościami złego typu dają bezpieczne domyślne", () => {
    const model = normalizeLinkPreviewData({
      items: "nie lista",
      preview: "false",
      layout: "grid",
      width: "abc",
      height: 99999,
      introPl: 5,
    });
    expect(model).toEqual({
      introPl: "",
      introEn: "",
      items: [],
      preview: true,
      layout: "inline",
      width: 200,
      height: 480,
    });
  });
});
