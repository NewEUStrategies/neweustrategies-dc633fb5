// Maszyna przewijania Web Story.
//
// Każdy przypadek odpowiada decyzji, która przed wyprowadzeniem z
// `StoryViewer.tsx` dała się sprawdzić wyłącznie przez sterowanie pętlą
// `requestAnimationFrame` i zegarem naraz.
import { describe, expect, it } from "vitest";
import {
  advance,
  backgroundKind,
  clampStartIndex,
  DEFAULT_PAGE_SECONDS,
  keyAction,
  MIN_PAGE_SECONDS,
  pageDurationMs,
  progressWidth,
  rewind,
} from "@/lib/web-stories/viewerNav";

describe("keyAction", () => {
  it.each([
    ["Escape", "close"],
    ["ArrowRight", "next"],
    ["ArrowLeft", "prev"],
    [" ", "togglePause"],
  ] as const)("%s -> %s", (key, action) => {
    expect(keyAction(key)).toBe(action);
  });

  it.each(["Enter", "a", "Tab", "ArrowUp", "ArrowDown", "Spacebar", ""])(
    "%s nie jest naszą klawiszą",
    (key) => {
      expect(keyAction(key)).toBeNull();
    },
  );

  it("rozróżnia spację od jej starej nazwy `Spacebar`", () => {
    // Stare przeglądarki podawały `Spacebar`. Obsługa obu wyglądałaby na
    // ostrożność, ale znaczyłaby, że pauzę da się wywołać dwoma zdarzeniami -
    // ten test przypina, że kontraktem jest WYŁĄCZNIE nowoczesne " ".
    expect(keyAction(" ")).toBe("togglePause");
    expect(keyAction("Spacebar")).toBeNull();
  });
});

describe("clampStartIndex", () => {
  it("wpuszcza indeks z zakresu", () => {
    expect(clampStartIndex(2, 5)).toBe(2);
  });

  it("przycina indeks spoza historii", () => {
    // `?page=12` w historii o trzech planszach przychodzi z adresu, więc to
    // wejście użytkownika, nie stan wewnętrzny.
    expect(clampStartIndex(12, 3)).toBe(2);
  });

  it("nie schodzi poniżej zera", () => {
    expect(clampStartIndex(-4, 3)).toBe(0);
  });

  it("historia bez plansz daje zero, nie -1", () => {
    expect(clampStartIndex(0, 0)).toBe(0);
    expect(clampStartIndex(5, 0)).toBe(0);
  });

  it("historia jednoplanszowa zawsze startuje od zera", () => {
    expect(clampStartIndex(3, 1)).toBe(0);
  });
});

describe("advance", () => {
  it("przechodzi na następną planszę", () => {
    expect(advance(0, 3)).toEqual({ index: 1, ended: false });
    expect(advance(1, 3)).toEqual({ index: 2, ended: false });
  });

  it("na OSTATNIEJ planszy kończy historię, zamiast na niej stać", () => {
    // To jest cała reguła zakończenia Web Story i jest wspólna dla trzech
    // wejść: kliknięcia w prawą strefę, strzałki i dobiegnięcia paska postępu.
    // Gdyby ostatnia plansza „zostawała", autoodtwarzanie zapętliłoby się na
    // niej w nieskończoność, mieląc klatki animacji.
    expect(advance(2, 3)).toEqual({ index: 2, ended: true });
  });

  it("historia jednoplanszowa kończy się od razu", () => {
    expect(advance(0, 1)).toEqual({ index: 0, ended: true });
  });

  it("historia bez plansz kończy się, a nie przewija w nieskończoność", () => {
    expect(advance(0, 0).ended).toBe(true);
  });

  it("indeks spoza zakresu też kończy historię", () => {
    expect(advance(9, 3).ended).toBe(true);
  });
});

describe("rewind", () => {
  it("cofa o jedną planszę", () => {
    expect(rewind(2)).toBe(1);
  });

  it("na pierwszej planszy STOI - cofanie nie zamyka historii", () => {
    // Asymetria wobec `advance` jest zamierzona: „w tył" nigdy nie wychodzi
    // z widoku, bo użytkownik cofa się, żeby coś doczytać, a nie żeby wyjść.
    expect(rewind(0)).toBe(0);
  });

  it("nie daje ujemnego indeksu przy popsutym stanie", () => {
    expect(rewind(-5)).toBe(0);
  });
});

describe("pageDurationMs", () => {
  it("liczy czas z pola redakcyjnego", () => {
    expect(pageDurationMs(8)).toBe(8000);
  });

  it("brak wartości daje czas domyślny", () => {
    expect(pageDurationMs(undefined)).toBe(DEFAULT_PAGE_SECONDS * 1000);
    expect(pageDurationMs(null)).toBe(DEFAULT_PAGE_SECONDS * 1000);
  });

  it("wymusza minimum dwóch sekund - to reguła CZYTELNOŚCI", () => {
    // Plansza znikająca po pół sekundy jest nie do przeczytania dla kogoś,
    // kto czyta wolniej. Wartość przychodzi z formularza redakcyjnego, więc
    // zero i liczby ujemne są realnym wejściem, nie hipotezą.
    expect(pageDurationMs(0)).toBe(MIN_PAGE_SECONDS * 1000);
    expect(pageDurationMs(-10)).toBe(MIN_PAGE_SECONDS * 1000);
    expect(pageDurationMs(1)).toBe(MIN_PAGE_SECONDS * 1000);
  });

  it("dokładnie minimum przechodzi bez zmiany", () => {
    expect(pageDurationMs(MIN_PAGE_SECONDS)).toBe(MIN_PAGE_SECONDS * 1000);
  });
});

describe("backgroundKind", () => {
  it("plansza wideo z adresem gra film", () => {
    expect(backgroundKind({ background: "video", media_url: "https://x/f.mp4" })).toBe("video");
  });

  it("plansza wideo BEZ adresu nie próbuje grać pustki", () => {
    // `<video src="">` zostawia czarny prostokąt bez sterowania. Spadamy na
    // jednolite tło, bo lepiej pokazać planszę niż zepsuty odtwarzacz.
    expect(backgroundKind({ background: "video", media_url: "" })).toBe("blank");
  });

  it("plansza kolorowa nie potrzebuje żadnego adresu", () => {
    expect(backgroundKind({ background: "color", media_url: "" })).toBe("color");
  });

  it("kolor wygrywa z ustawionym adresem obrazka", () => {
    expect(backgroundKind({ background: "color", media_url: "https://x/a.jpg" })).toBe("color");
  });

  it("plansza obrazkowa z adresem pokazuje obraz", () => {
    expect(backgroundKind({ background: "image", media_url: "https://x/a.jpg" })).toBe("image");
  });

  it("plansza obrazkowa BEZ adresu dostaje jednolite tło", () => {
    // `<img src="">` w części przeglądarek rysuje ikonę zepsutego obrazka na
    // pełnym ekranie - gorsze niż ciemne tło.
    expect(backgroundKind({ background: "image", media_url: "" })).toBe("blank");
  });

  it("brak pól w ogóle daje jednolite tło", () => {
    expect(backgroundKind({})).toBe("blank");
    expect(backgroundKind({ background: null, media_url: null })).toBe("blank");
  });
});

describe("progressWidth", () => {
  it("plansze przed aktywną są pełne", () => {
    expect(progressWidth(0, 2, 0.5)).toBe("100%");
    expect(progressWidth(1, 2, 0)).toBe("100%");
  });

  it("plansze po aktywnej są puste", () => {
    expect(progressWidth(3, 2, 0.9)).toBe("0%");
  });

  it("aktywna plansza rośnie razem z postępem", () => {
    expect(progressWidth(2, 2, 0)).toBe("0%");
    expect(progressWidth(2, 2, 0.25)).toBe("25%");
    expect(progressWidth(2, 2, 1)).toBe("100%");
  });

  it("postęp spoza zakresu nie wypycha paska poza ramkę", () => {
    // Pętla klatek liczy postęp z różnicy czasów; przy uśpionej karcie
    // pierwsza klatka po powrocie potrafi dać wartość ponad 1.
    expect(progressWidth(2, 2, 1.8)).toBe("100%");
    expect(progressWidth(2, 2, -0.3)).toBe("0%");
  });
});
