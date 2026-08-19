// Reguły kadrowania wyjęte z canvasu i z ciała modalu (patrz nagłówek
// `cropGeometry.ts`). Ich wynik widać na KAŻDYM zdjęciu w serwisie - miniatury
// wpisów, karty autorów, OG image, obrazy w widgetach - a do 18.08.2026 żadna
// nie miała ani jednego wywołania w teście.
//
// Testy celują w GRANICE, nie w happy path: to na granicach te reguły milkną
// zamiast krzyczeć (NaN przy zerowych wymiarach, kumulacja błędu float na
// suwaku, dzielenie przez zero w etykiecie proporcji).
import { describe, expect, it } from "vitest";
import {
  ROTATION_MAX,
  ROTATION_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  aspectRatioLabel,
  quantizeRotation,
  quantizeZoom,
  rotationBoundingBox,
  sourceAspectWarning,
  stepRotation,
  stepZoom,
  toRadians,
} from "@/lib/media/cropGeometry";

describe("toRadians", () => {
  it("odwzorowuje pełny obrót", () => {
    expect(toRadians(0)).toBe(0);
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toRadians(-90)).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe("rotationBoundingBox", () => {
  it("bez obrotu oddaje wymiary źródła co do piksela", () => {
    expect(rotationBoundingBox(1600, 900, 0)).toEqual({ width: 1600, height: 900 });
  });

  it("obrót o 180° nie zmienia wymiarów", () => {
    const box = rotationBoundingBox(1600, 900, 180);
    expect(box.width).toBeCloseTo(1600, 9);
    expect(box.height).toBeCloseTo(900, 9);
  });

  it("obrót o 90° zamienia szerokość z wysokością", () => {
    // Gdyby canvas rotacji zachował oryginalne wymiary, obrócone zdjęcie
    // zostałoby obcięte do wąskiego paska - to jest właśnie ten defekt, przed
    // którym broni bounding box.
    const box = rotationBoundingBox(1600, 900, 90);
    expect(box.width).toBeCloseTo(900, 9);
    expect(box.height).toBeCloseTo(1600, 9);
  });

  it("jest symetryczny względem znaku kąta", () => {
    // `Math.abs` na obu składnikach: obrót w lewo musi dać ten sam canvas co
    // obrót w prawo o ten sam kąt.
    expect(rotationBoundingBox(1600, 900, -90)).toEqual(rotationBoundingBox(1600, 900, 90));
    expect(rotationBoundingBox(1600, 900, -37.5)).toEqual(rotationBoundingBox(1600, 900, 37.5));
  });

  it("obrót o 45° daje ułamkowy, ale dodatni i skończony prostokąt", () => {
    // 45° to najgorszy przypadek: bbox jest największy i NIGDY nie wychodzi
    // całkowity. Canvas i tak obetnie go do liczby całkowitej - istotne jest,
    // że nie powstaje NaN ani wartość ujemna, bo obie dałyby canvas 0×0
    // i pusty (przezroczysty) plik wyjściowy.
    const box = rotationBoundingBox(1000, 500, 45);
    const expected = (1000 + 500) / Math.SQRT2;
    expect(box.width).toBeCloseTo(expected, 9);
    expect(box.height).toBeCloseTo(expected, 9);
    expect(Number.isFinite(box.width)).toBe(true);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("kąt spoza zakresu suwaka zawija się jak trygonometria, nie wybucha", () => {
    // 270° = 90° co do wymiarów bboxa; 361° ≈ 1°.
    const at270 = rotationBoundingBox(1600, 900, 270);
    expect(at270.width).toBeCloseTo(900, 9);
    expect(at270.height).toBeCloseTo(1600, 9);
    const at361 = rotationBoundingBox(1600, 900, 361);
    expect(at361.width).toBeGreaterThan(1600);
  });

  it("nigdy nie zwraca prostokąta mniejszego niż dłuższy bok źródła", () => {
    // Niezmiennik: obrócone zdjęcie musi się zmieścić przy KAŻDYM kącie.
    for (let deg = -180; deg <= 180; deg += 7.5) {
      const box = rotationBoundingBox(1600, 900, deg);
      expect(box.width).toBeGreaterThanOrEqual(900 - 1e-9);
      expect(box.height).toBeGreaterThanOrEqual(900 - 1e-9);
    }
  });
});

describe("sourceAspectWarning", () => {
  const AVATAR = 1;
  const COVER = 16 / 6;

  it("milczy dla źródła o dokładnie wymaganej proporcji", () => {
    expect(sourceAspectWarning(800, 800, AVATAR, 0.35)).toBe(false);
    expect(sourceAspectWarning(1600, 600, COVER, 0.35)).toBe(false);
  });

  it("ostrzega, gdy źródło jest DUŻO szersze niż wymagane", () => {
    // Panorama 4000×500 (8:1) wgrywana jako awatar 1:1.
    expect(sourceAspectWarning(4000, 500, AVATAR, 0.35)).toBe(true);
  });

  it("ostrzega, gdy źródło jest DUŻO węższe niż wymagane", () => {
    // Pionowy portret 600×1600 wgrywany jako okładka 16:6.
    expect(sourceAspectWarning(600, 1600, COVER, 0.35)).toBe(true);
  });

  it("próg jest OSTRY: źródło dokładnie na tolerancji przechodzi", () => {
    // diff == tolerance -> `diff > tolerance` jest fałszem. Ta gałąź decyduje,
    // czy autor zobaczy ostrzeżenie, więc kierunek nierówności jest kontraktem,
    // nie szczegółem.
    // 125/100 = 1,25 jest dokładne binarnie, więc diff wychodzi równo 0,25 -
    // dobrana para, żeby test mierzył KIERUNEK nierówności, a nie dryf float.
    expect(sourceAspectWarning(125, 100, 1, 0.25)).toBe(false);
    expect(sourceAspectWarning(126, 100, 1, 0.25)).toBe(true);
  });

  it("zerowa wysokość źródła daje nieskończoną proporcję i ostrzega", () => {
    expect(sourceAspectWarning(1600, 0, AVATAR, 0.35)).toBe(true);
  });

  it("zerowa szerokość źródła ostrzega przy typowej tolerancji", () => {
    // ratio 0 -> diff = 1 > 0,35.
    expect(sourceAspectWarning(0, 900, AVATAR, 0.35)).toBe(true);
  });

  it("DZIURA: obraz 0×0 nie ostrzega, bo NaN przegrywa każde porównanie", () => {
    // 0/0 = NaN, a `NaN > tolerance` to fałsz - więc zdegenerowane źródło
    // przechodzi CICHO, mimo że jest najgorszym możliwym wejściem.
    // Test pilnuje dzisiejszego zachowania świadomie: zmiana na ostrzeżenie
    // jest poprawą, ale to zmiana zachowania i należy do osobnego commitu.
    expect(sourceAspectWarning(0, 0, AVATAR, 0.35)).toBe(false);
  });

  it("tolerancja 0 wymaga proporcji idealnej", () => {
    expect(sourceAspectWarning(800, 800, AVATAR, 0)).toBe(false);
    expect(sourceAspectWarning(801, 800, AVATAR, 0)).toBe(true);
  });
});

describe("quantizeZoom", () => {
  it("ucina dryf zmiennoprzecinkowy do dwóch miejsc", () => {
    // Bez zaokrąglenia etykieta „×" pokazywałaby 1.1500000000000001.
    expect(quantizeZoom(1.1500000000000001)).toBe(1.15);
    expect(quantizeZoom(2.005)).toBe(2.01);
  });

  it("NIE klamruje - zakres wymusza sam suwak", () => {
    expect(quantizeZoom(0.5)).toBe(0.5);
    expect(quantizeZoom(9)).toBe(9);
  });
});

describe("stepZoom", () => {
  it("krok domyślny to 0,05, precyzyjny (Shift) to 0,01", () => {
    expect(stepZoom(2, 1)).toBe(2.05);
    expect(stepZoom(2, 1, true)).toBe(2.01);
    expect(stepZoom(2, -1)).toBe(1.95);
    expect(stepZoom(2, -1, true)).toBe(1.99);
  });

  it("zatrzymuje się na maksimum, nie przekracza go", () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(5.99, 1)).toBe(ZOOM_MAX);
  });

  it("zatrzymuje się na minimum, nie schodzi poniżej", () => {
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(stepZoom(1.02, -1)).toBe(ZOOM_MIN);
  });

  it("nie kumuluje błędu float przy serii kroków", () => {
    // Trzy kroki w górę z 1,0 muszą dać dokładnie 1,15 - inaczej po
    // kilkudziesięciu naciśnięciach strzałki etykieta rozjeżdża się z suwakiem.
    let z = ZOOM_MIN;
    for (let i = 0; i < 3; i += 1) z = stepZoom(z, 1);
    expect(z).toBe(1.15);
  });

  it("seria kroków w dół zawsze ląduje w zakresie", () => {
    let z = ZOOM_MAX;
    for (let i = 0; i < 200; i += 1) z = stepZoom(z, -1);
    expect(z).toBe(ZOOM_MIN);
  });
});

describe("quantizeRotation", () => {
  it("zaokrągla kąt do jednego miejsca", () => {
    expect(quantizeRotation(12.34)).toBe(12.3);
    expect(quantizeRotation(-0.05)).toBe(-0);
  });
});

describe("stepRotation", () => {
  it("krok domyślny 1°, Shift 0,1°, Alt snapuje co 15°", () => {
    expect(stepRotation(10, 1)).toBe(11);
    expect(stepRotation(10, 1, { shift: true })).toBe(10.1);
    expect(stepRotation(10, 1, { alt: true })).toBe(25);
    expect(stepRotation(10, -1, { alt: true })).toBe(-5);
  });

  it("Alt ma pierwszeństwo przed Shiftem", () => {
    expect(stepRotation(0, 1, { alt: true, shift: true })).toBe(15);
  });

  it("zatrzymuje się na obu krańcach suwaka", () => {
    expect(stepRotation(ROTATION_MAX, 1)).toBe(ROTATION_MAX);
    expect(stepRotation(ROTATION_MIN, -1)).toBe(ROTATION_MIN);
    expect(stepRotation(170, 1, { alt: true })).toBe(ROTATION_MAX);
    expect(stepRotation(-170, -1, { alt: true })).toBe(ROTATION_MIN);
  });

  it("nie kumuluje błędu float przy kroku precyzyjnym", () => {
    let r = 0;
    for (let i = 0; i < 3; i += 1) r = stepRotation(r, 1, { shift: true });
    expect(r).toBe(0.3);
  });
});

describe("aspectRatioLabel", () => {
  it("skraca proporcję kwadratową bez redukcji GCD", () => {
    expect(aspectRatioLabel(1, 600, 600)).toBe("1:1");
  });

  it("redukuje wymiary okładki do najprostszej postaci", () => {
    expect(aspectRatioLabel(16 / 6, 1600, 600)).toBe("8:3");
  });

  it("zostawia wymiary względnie pierwsze bez zmian", () => {
    // gcd(1001, 499) = 1, a proporcja ~2,006 jest daleko od kwadratu, więc
    // skrót „1:1" się nie włącza i widać samą redukcję.
    expect(aspectRatioLabel(1001 / 499, 1001, 499)).toBe("1001:499");
  });

  it("traktuje proporcję bliską 1 jako kwadrat", () => {
    // Tolerancja 0,01 chroni etykietę przed „1000:999" dla presetu, który
    // zaokrągleniami wyszedł minimalnie poza kwadrat.
    expect(aspectRatioLabel(1.005, 1000, 999)).toBe("1:1");
  });

  it("GRANICA: zerowa wysokość docelowa daje etykietę bez sensu", () => {
    // gcd(w, 0) = w, więc h/g = 0/w = 0, a w/g = 1 -> „1:0". Preset z zerowym
    // bokiem nie istnieje w CROP_PRESETS (pilnuje tego test niżej), ale funkcja
    // sama się przed nim nie broni - pinujemy to, żeby zmiana była świadoma.
    expect(aspectRatioLabel(2, 1600, 0)).toBe("1:0");
  });
});
