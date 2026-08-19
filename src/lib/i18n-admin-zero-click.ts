// Zasoby i18n ściągawki zero-click w edytorze wpisu (PL/EN). Osobny moduł,
// bo ładuje się razem z chunkiem edytora wpisów - nie wchodzi do słownika
// żadnej innej trasy (wzorzec: i18n-admin-post-panes.ts).
import i18n from "@/lib/i18n";

const pl = {
  adminZeroClick: {
    nav: {
      label: "Zero-click",
      hint: "Ściągawka projektowania wpisu + stan tego wpisu",
    },
    title: "Zero-click - jak zaprojektować ten wpis",
    intro:
      "Zero-click znaczy: wpis rozwiązuje problem czytelnika TAM, gdzie się z nim styka - w wynikach wyszukiwania, w odpowiedzi AI, w feedzie - bez wymuszania kliknięcia. Celem jest cytowanie i popyt na markę, nie sesja. Poniżej szkielet, który to umożliwia, i stan tego wpisu względem reguł.",
    checklist: {
      title: "Ten wpis",
      score: "{{passed}} z {{total}} reguł spełnionych",
      langPl: "Polski",
      langEn: "Angielski",
      statusOk: "OK",
      statusWarn: "Do poprawy",
      statusTodo: "Brak",
      hint: "Checklista mierzy kształt tekstu, nie jego jakość. Zielone wiersze nie zwalniają z redakcji.",
    },
    rules: {
      lead: {
        title: "Akapit definicyjny na starcie",
        body: "Pierwszy akapit odpowiada na pytanie z tytułu w 40-70 słowach: definicja, po co to komu, dla kogo. To jest ten fragment, który Google podnosi do snippetu, a model do odpowiedzi.",
        do: "Zacznij od odpowiedzi: „Zero-click marketing to strategia, w której…”.",
        dont: "Nie zaczynaj od „W dzisiejszych czasach…” - rozbiegówka nie nadaje się do zacytowania.",
        okWords: "{{words}} słów - w budżecie {{min}}-{{max}}.",
        shortWords: "{{words}} słów - za mało, żeby wyciąć samodzielną odpowiedź (min. {{min}}).",
        longWords: "{{words}} słów - wyszukiwarka to przytnie (maks. {{max}}).",
        filler: "Akapit zaczyna się rozbiegówką zamiast odpowiedzi.",
        todo: "Brak akapitu otwierającego.",
      },
      questionHeadings: {
        title: "Nagłówki w formie pytań",
        body: "H2/H3 zapisane pełnym pytaniem („Jak działa…?”, „Ile kosztuje…?”) trafiają w realne frazy i w sekcje „Podobne pytania”. Każda sekcja zaczyna się od krótkiej odpowiedzi, dopiero potem rozwinięcie.",
        do: "Nagłówek = pytanie czytelnika, pierwsze zdanie pod nim = odpowiedź.",
        dont: "Unikaj nagłówków-etykiet („Wprowadzenie”, „Kontekst”) - nie odpowiadają na nic.",
        ok: "{{value}} z {{total}} nagłówków H2/H3 jest pytaniem.",
        warn: "Tylko {{value}} z {{total}} nagłówków H2/H3 jest pytaniem.",
        todoFew: "Za mało nagłówków, żeby wpis dał się skanować i cytować sekcjami.",
        todo: "Żaden nagłówek H2/H3 nie jest pytaniem.",
      },
      faq: {
        title: "Sekcja FAQ jako blok, nie jako tekst",
        body: "Blok FAQ dokłada dane strukturalne FAQPage - dopiero one dają szansę na „Podobne pytania”. Ręcznie napisana sekcja pytań wygląda tak samo dla czytelnika i jest niewidoczna dla crawlera.",
        do: "Dodaj blok FAQ (Widgety → FAQ) z 3-6 pytaniami zadawanymi przez czytelników.",
        dont: "Nie zastępuj bloku listą pogrubionych pytań w akapicie.",
        ok: "Blok FAQ: {{value}} par pytanie-odpowiedź.",
        warn: "Sekcja pytań jest, ale poza blokiem FAQ - crawler nie dostaje FAQPage.",
        todo: "Brak sekcji FAQ.",
      },
      faqAnswerLength: {
        title: "Odpowiedzi w FAQ do 60 słów",
        body: "Odpowiedź dłuższa niż 60 słów przestaje być cytowalna w całości - zostaje przycięta w losowym miejscu. Rozwinięcie zostaw w treści wpisu, w FAQ daj rozstrzygnięcie.",
        do: "Jedna odpowiedź = jedno rozstrzygnięcie + ewentualnie jeden warunek.",
        dont: "Nie wklejaj do FAQ akapitów z treści.",
        ok: "Wszystkie {{total}} odpowiedzi mieszczą się w {{max}} słowach.",
        warn: "{{value}} z {{total}} odpowiedzi przekracza {{max}} słów (np. „{{snippet}}”).",
        todo: "Brak odpowiedzi do zmierzenia - najpierw dodaj blok FAQ.",
      },
      takeaways: {
        title: "Punkty „Dowiesz się…” (3-5)",
        body: "Punkty z zakładki „Dowiesz się…” lądują w JSON-LD jako `abstract` i w `speakable` - to gotowe streszczenie dla asystentów głosowych i odpowiedzi AI. Każdy punkt ma być samodzielnym zdaniem, nie zapowiedzią.",
        do: "„Zero-click nie znosi CTA - przenosi je do profilu i bio.” - zdanie, które broni się bez wpisu.",
        dont: "„Omówimy też kwestię metryk.” - zapowiedź nic nie wnosi do streszczenia.",
        ok: "{{value}} punktów.",
        warnFew: "{{value}} - za mało na streszczenie (min. {{min}}).",
        warnMany: "{{value}} - powyżej {{max}} streszczenie przestaje być streszczeniem.",
        todo: "Brak punktów - JSON-LD wpisu pójdzie bez `abstract`.",
      },
      scannable: {
        title: "Lista kroków albo checklista",
        body: "Wypunktowanie jest formatem, który wyszukiwarki i modele wyciągają najchętniej, bo nie wymaga streszczania. Jedna lista kroków lub warunków na wpis to minimum.",
        do: "Zamień „najpierw…, potem…, na końcu…” na listę numerowaną.",
        dont: "Nie ukrywaj procedury w ciągłym akapicie.",
        ok: "Wpis ma listę.",
        todo: "Brak listy punktowanej ani numerowanej.",
      },
    },
    skeleton: {
      title: "Szkielet wpisu pod zero-click",
      intro:
        "Kolejność, która działa dla wpisu odpowiadającego na jedno pytanie. Nie każdy wpis musi mieć wszystkie sekcje - kolejność pierwszych trzech jest nienegocjowalna.",
      s1: "H1 = pełne pytanie („Czym jest zero-click marketing?”).",
      s2: "Akapit definicyjny 40-70 słów - odpowiedź, nie wstęp.",
      s3: "„Dlaczego to ma znaczenie” - 2-3 krótkie akapity z konkretem.",
      s4: "H2 pytaniowe („Jak to działa?”) - krótka odpowiedź + lista kroków.",
      s5: "H2 „Przykłady…” - akapit + wypunktowanie.",
      s6: "H2 „Jak mierzyć efekty?” - metryki, nie obietnice.",
      s7: "Blok FAQ - 3-6 pytań, każda odpowiedź do 60 słów.",
    },
    breadcrumbs: {
      title: "Oddajesz wiedzę - zostaw ślad marki",
      intro:
        "Zero-click nie znaczy „bez konwersji”. Znaczy: konwersja przenosi się z przycisku do pamięci czytelnika. Trzy miejsca, które to robią bez psucia zasięgu:",
      b1: "Nazwa marki i własnej metody wpleciona w definicję, a nie doklejona na końcu.",
      b2: "Wzmianka, że istnieje pełny raport / kurs / narzędzie - bez „kliknij teraz”.",
      b3: "Twarde CTA przenieś do profilu, bio i przypiętego posta; wpis zostaw samodzielny.",
    },
    balance: {
      title: "Kiedy zero-click, a kiedy klasyczny wpis",
      intro:
        "Nie każdy wpis ma być zero-click. Rozdziel dwa tory, zanim zaczniesz pisać - inaczej wpis sprzedażowy oddaje wiedzę za darmo, a wpis edukacyjny straszy przyciskiem.",
      b1: "Fraza informacyjna („czym jest…”, „jak działa…”) - gramy o cytowanie: pełna odpowiedź w treści.",
      b2: "Fraza komercyjna („cennik”, „konsultacja”) - gramy o klik: wpis prowadzi do decyzji.",
      b3: "Fraza mieszana - odpowiedź w treści + powód, żeby wejść po głębszą warstwę (dane, szablon, narzędzie).",
    },
    metrics: {
      title: "Po czym poznasz, że działa",
      intro: "CTR na tych wpisach spada z definicji. Zestaw miar, który nie skłamie o zero-click:",
      m1: "Obecność w snippetach, „Podobnych pytaniach” i AI Overview.",
      m2: "Cytowania domeny w odpowiedziach asystentów (ChatGPT, Perplexity, Claude).",
      m3: "Wyszukiwania brandowe i wejścia bezpośrednie po publikacji.",
      m4: "Zapisy, udostępnienia i komentarze zamiast samych odsłon.",
    },
    hints: {
      takeaways:
        "Zero-click: 3-5 punktów, każdy samodzielnym zdaniem. Trafiają do JSON-LD wpisu jako `abstract` - to z nich asystenci budują streszczenie.",
      excerpt:
        "Zero-click: zapowiedź ma odpowiadać, nie zachęcać. Pierwsze zdanie powinno dać się zacytować bez wpisu.",
      seo: "Zero-click: opis SEO to często jedyne, co czytelnik zobaczy. Ma zawierać odpowiedź, nie obietnicę odpowiedzi.",
    },
  },
};

const en = {
  adminZeroClick: {
    nav: {
      label: "Zero-click",
      hint: "Post design cheat sheet + this post's status",
    },
    title: "Zero-click - how to design this post",
    intro:
      "Zero-click means the post solves the reader's problem WHERE they meet it - in search results, in an AI answer, in the feed - without forcing a click. The goal is citation and brand demand, not a session. Below: the skeleton that makes it possible, and this post's status against the rules.",
    checklist: {
      title: "This post",
      score: "{{passed}} of {{total}} rules met",
      langPl: "Polish",
      langEn: "English",
      statusOk: "OK",
      statusWarn: "Needs work",
      statusTodo: "Missing",
      hint: "The checklist measures the shape of the text, not its quality. Green rows do not replace editing.",
    },
    rules: {
      lead: {
        title: "Definition paragraph up front",
        body: "The first paragraph answers the title's question in 40-70 words: definition, why it matters, who it is for. This is the fragment Google lifts into a snippet and a model lifts into an answer.",
        do: 'Open with the answer: "Zero-click marketing is a strategy where…".',
        dont: 'Do not open with "In today\'s world…" - a warm-up cannot be quoted.',
        okWords: "{{words}} words - within the {{min}}-{{max}} budget.",
        shortWords: "{{words}} words - too few to cut a standalone answer from (min. {{min}}).",
        longWords: "{{words}} words - search engines will truncate it (max. {{max}}).",
        filler: "The paragraph opens with a warm-up instead of an answer.",
        todo: "No opening paragraph.",
      },
      questionHeadings: {
        title: "Headings written as questions",
        body: 'H2/H3 written as full questions ("How does… work?", "How much does… cost?") match real queries and the People Also Ask box. Every section starts with a short answer; the elaboration comes after.',
        do: "Heading = the reader's question, first sentence below = the answer.",
        dont: 'Avoid label headings ("Introduction", "Context") - they answer nothing.',
        ok: "{{value}} of {{total}} H2/H3 headings are questions.",
        warn: "Only {{value}} of {{total}} H2/H3 headings are questions.",
        todoFew: "Too few headings for the post to be scannable and quotable by section.",
        todo: "No H2/H3 heading is a question.",
      },
      faq: {
        title: "FAQ as a block, not as prose",
        body: "The FAQ block adds FAQPage structured data - that is what earns a shot at People Also Ask. A hand-written question section looks identical to the reader and is invisible to the crawler.",
        do: "Add the FAQ block (Widgets → FAQ) with 3-6 questions readers actually ask.",
        dont: "Do not replace the block with a list of bolded questions in a paragraph.",
        ok: "FAQ block: {{value}} question/answer pairs.",
        warn: "There is a question section, but outside the FAQ block - the crawler gets no FAQPage.",
        todo: "No FAQ section.",
      },
      faqAnswerLength: {
        title: "FAQ answers under 60 words",
        body: "An answer longer than 60 words stops being quotable whole - it gets cut at a random point. Keep the elaboration in the body; in the FAQ give the verdict.",
        do: "One answer = one verdict plus, at most, one condition.",
        dont: "Do not paste body paragraphs into the FAQ.",
        ok: "All {{total}} answers fit within {{max}} words.",
        warn: '{{value}} of {{total}} answers exceed {{max}} words (e.g. "{{snippet}}").',
        todo: "Nothing to measure yet - add the FAQ block first.",
      },
      takeaways: {
        title: "Takeaways (3-5)",
        body: 'Points from the "Takeaways" tab land in JSON-LD as `abstract` and in `speakable` - a ready-made summary for voice assistants and AI answers. Each point must be a standalone sentence, not a promise.',
        do: '"Zero-click does not kill the CTA - it moves it to the profile and bio." - a sentence that stands without the post.',
        dont: '"We will also cover metrics." - an announcement adds nothing to a summary.',
        ok: "{{value}} points.",
        warnFew: "{{value}} - too few for a summary (min. {{min}}).",
        warnMany: "{{value}} - past {{max}} a summary stops being a summary.",
        todo: "No points - the post's JSON-LD ships without `abstract`.",
      },
      scannable: {
        title: "A step list or a checklist",
        body: "Bulleted structure is the format search engines and models extract most readily, because it needs no summarising. One list of steps or conditions per post is the minimum.",
        do: 'Turn "first…, then…, finally…" into a numbered list.',
        dont: "Do not bury a procedure inside running prose.",
        ok: "The post has a list.",
        todo: "No bulleted or numbered list.",
      },
    },
    skeleton: {
      title: "Zero-click post skeleton",
      intro:
        "The order that works for a post answering one question. Not every post needs every section - the order of the first three is non-negotiable.",
      s1: 'H1 = a full question ("What is zero-click marketing?").',
      s2: "Definition paragraph, 40-70 words - an answer, not an intro.",
      s3: '"Why it matters" - 2-3 short paragraphs with something concrete.',
      s4: 'Question H2 ("How does it work?") - short answer + list of steps.',
      s5: 'H2 "Examples…" - paragraph + bullets.',
      s6: 'H2 "How do you measure it?" - metrics, not promises.',
      s7: "FAQ block - 3-6 questions, each answer under 60 words.",
    },
    breadcrumbs: {
      title: "You give the knowledge away - leave a brand trail",
      intro:
        'Zero-click does not mean "no conversion". It means the conversion moves from a button into the reader\'s memory. Three places that do this without hurting reach:',
      b1: "Brand name and your own method woven into the definition, not bolted on at the end.",
      b2: 'A mention that a full report / course / tool exists - without "click now".',
      b3: "Move the hard CTA to the profile, bio and pinned post; leave the post self-contained.",
    },
    balance: {
      title: "When zero-click, when a classic post",
      intro:
        "Not every post should be zero-click. Split the two tracks before you write - otherwise the sales post gives the knowledge away and the educational post scares readers with a button.",
      b1: 'Informational query ("what is…", "how does… work") - we play for citation: the full answer stays in the body.',
      b2: 'Commercial query ("pricing", "consultation") - we play for the click: the post leads to a decision.',
      b3: "Mixed query - the answer in the body plus a reason to come for the deeper layer (data, template, tool).",
    },
    metrics: {
      title: "How you know it works",
      intro:
        "CTR on these posts drops by design. The set of measures that will not lie about zero-click:",
      m1: "Presence in snippets, People Also Ask and AI Overviews.",
      m2: "Citations of the domain in assistant answers (ChatGPT, Perplexity, Claude).",
      m3: "Branded searches and direct visits after publication.",
      m4: "Saves, shares and comments instead of pageviews alone.",
    },
    hints: {
      takeaways:
        "Zero-click: 3-5 points, each a standalone sentence. They land in the post's JSON-LD as `abstract` - assistants build their summary from them.",
      excerpt:
        "Zero-click: the excerpt should answer, not tease. The first sentence must be quotable without the post.",
      seo: "Zero-click: the SEO description is often all the reader sees. It should carry the answer, not the promise of one.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w komponencie, nie side-effectowym importem trasy - rejestracja
 * słownika jedzie wtedy w chunku edytora wpisu (wzorzec: i18n-admin-post-panes.ts).
 */
export function ensureI18n(): void {}
