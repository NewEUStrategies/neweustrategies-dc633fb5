// Nadpisania miniatur per wpis (`thumbnailOverrides: { [postId]: url }`).
//
// Panel listy wpisów zapisuje mapę przez `setThumbnailOverride`, a lista,
// slider i obraz LCP czytają ją przez `readThumbnailOverrides`. Kontrakt:
//  * zapis jest NIEMUTUJĄCY - panel porównuje poprzednią i nową treść
//    widgetu, więc zmiana w miejscu oznaczałaby „brak zmian" i brak zapisu;
//  * pusty adres (także same spacje) USUWA nadpisanie, zamiast zapisywać "";
//  * odczyt odrzuca wszystko, co nie jest niepustym napisem, więc uszkodzona
//    treść nie wstawi do `<img src>` obiektu ani liczby.
// Bez atrap - moduł jest czysty.
import { describe, expect, it } from "vitest";
import { readThumbnailOverrides, setThumbnailOverride } from "../thumbnailOverrides";

describe("setThumbnailOverride", () => {
  it("dopisuje przycięty adres i nie rusza mapy wejściowej", () => {
    const current = { "p-1": "https://obrazy.example.com/1.jpg" };
    const next = setThumbnailOverride(current, "p-2", "  https://obrazy.example.com/2.jpg ");
    expect(next).toEqual({
      "p-1": "https://obrazy.example.com/1.jpg",
      "p-2": "https://obrazy.example.com/2.jpg",
    });
    expect(next).not.toBe(current);
    expect(current).toEqual({ "p-1": "https://obrazy.example.com/1.jpg" });
  });

  it.each(["", "   "])("pusty adres %j usuwa nadpisanie wpisu", (url) => {
    const current = { "p-1": "https://obrazy.example.com/1.jpg", "p-2": "x.jpg" };
    expect(setThumbnailOverride(current, "p-1", url)).toEqual({ "p-2": "x.jpg" });
    expect(current).toHaveProperty("p-1");
  });
});

describe("readThumbnailOverrides", () => {
  it("zostawia wyłącznie niepuste napisy, przycięte", () => {
    expect(
      readThumbnailOverrides({
        thumbnailOverrides: { a: " /a.jpg ", b: "", c: "   ", d: 5, e: { url: "/e.jpg" } },
      }),
    ).toEqual({ a: "/a.jpg" });
  });

  it.each([undefined, null, "a.jpg", ["a.jpg"]])(
    "zapis %j nie jest mapą - brak nadpisań",
    (raw) => {
      expect(readThumbnailOverrides({ thumbnailOverrides: raw as never })).toEqual({});
    },
  );
});
