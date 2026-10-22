// Render kampanii po wyniesieniu z `newsletter-campaigns.functions.ts` (S1).
//
// DOWÓD „BAJT W BAJT". Funkcja została przeniesiona bez zmiany ciała, a jedyny
// dodatek (kod kuponu) ma nie zmieniać wyniku, gdy kodu nie ma. Tablica
// `BASE_SHA256` to skróty SHA-256 HTML-a policzone na implementacji z
// a90e66c4 (wyciąg funkcji z `git show a90e66c4:src/lib/newsletter-campaigns.functions.ts`
// uruchomiony na tej samej macierzy) - 48 przypadków: język × tracking (brak /
// bez podpisu linku / z podpisem) × stopka wypisu (jest / brak) × zmienne
// (zwykłe / ze znakami specjalnymi) × szablon (linki / tag nieużyty). Skróty
// zamiast pełnych napisów, bo katalog `__snapshots__` jest poza manifestem
// wycinka, a 48 pełnych HTML-i w pliku testu byłoby nieczytelne; dwa
// reprezentatywne przypadki stoją niżej w całości.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SAMPLE_COUPON_CODE, renderCampaignHtml } from "@/lib/newsletter/renderCampaign.server";

const HTML = {
  links:
    "<h1>Cześć {{firstName}} {{lastName}}</h1><p>Twój adres: {{email}}</p><p><a href=\"https://example.test/a?x=1&amp;y=2\">Czytaj</a> i <a href='http://example.test/b'>więcej</a></p>",
  unusedTag: "<p>Kod: <strong>{{coupon_code}}</strong>, {{unknown_tag}} - {{firstName}}</p>",
} as const;
const VARS = {
  plain: { email: "anna@example.test", firstName: "Anna", lastName: "Nowak" },
  special: {
    email: "o'brien+x@example.test",
    firstName: '<b>"Zoë"</b>',
    lastName: "Kowalska & Syn's",
  },
} as const;
const UNSUB = {
  url: "https://example.test/api/public/newsletter/unsubscribe?token=abc&x=<1>",
  none: null,
} as const;
const TRACKING = {
  none: null,
  plain: {
    origin: "https://example.test",
    campaignId: "11111111-2222-3333-4444-555555555555",
    token: "tok.sig",
  },
  signed: {
    origin: "https://example.test",
    campaignId: "11111111-2222-3333-4444-555555555555",
    token: "tok.sig",
    signLink: (target: string) => `sig-${target.length}`,
  },
} as const;

const BASE_SHA256: Record<string, string> = {
  "pl|none|url|plain|links": "3d74ff855b8c7a31630597206ec989ffddde04cae661e69ec0b1d3a94dcfd160",
  "pl|none|url|plain|unusedTag": "811c98a81557b42f2fab8df11e359ef0fa95937c1de73edcaca47adea8f7fca5",
  "pl|none|url|special|links": "4d1899efb53c89a7314e89f37b12e0c1c6a68c57d308d6d007bab377e7705c06",
  "pl|none|url|special|unusedTag":
    "7c4ba0da9e84bfd6de6bf36a7047a28c237607c211e11a2df07c25653b0e6982",
  "pl|none|none|plain|links": "be30a7f6ffe646325029b07cf7a881c8c65ee07014e0d76454f3dcf10d4874e2",
  "pl|none|none|plain|unusedTag":
    "7d15cb45892ad1e3f6b81bd39869f9b606affe8ed8f8da499df769ba9bd72b25",
  "pl|none|none|special|links": "bfe9cde2796a5bfa36f11d4c4d94472a53548ce95ce27cf1415b37f05dadc5a6",
  "pl|none|none|special|unusedTag":
    "0e6ea6aefcb354c89f3c6e88f7706c3268097fe383e77d90f09d47234f55be7c",
  "pl|plain|url|plain|links": "efd82657dd65fbc33caf92939ff0c33db12b5043a943be8b1a6c95e800641cdc",
  "pl|plain|url|plain|unusedTag":
    "3d4caaa3a2a3dc20cb2a606ed89cd0ed98908d7e103b057a929b75cb899ad537",
  "pl|plain|url|special|links": "6dabf859395521d1d827cb5ef3c2cd8143b41eb034aba2658d6c0c59901ad9d4",
  "pl|plain|url|special|unusedTag":
    "7d70f0d11e0ae467fa8babbe5bf0dc00f132a41e2d80459c7332783ae5cd2ebe",
  "pl|plain|none|plain|links": "0e468266f71c59873e87434276896529c5ef49d255cc0e46b286ffd92ae53a9e",
  "pl|plain|none|plain|unusedTag":
    "186d0c1dade7896d4d0b5c1e4ecaed69bf6a46429219319e1cac075e03b4e556",
  "pl|plain|none|special|links": "8bc1bb755ee0648df242dde9e7b4901e4ed0375a46fa815cad10e623c307c05c",
  "pl|plain|none|special|unusedTag":
    "aef9313bad4a3dcf39d4858489eeb0685f6e5df89d8e3c6a0709e2165f655e95",
  "pl|signed|url|plain|links": "9f02c6eaab528bab21175e28caccf14156b2c64ab63008a868a6c303bdb9b276",
  "pl|signed|url|plain|unusedTag":
    "3d4caaa3a2a3dc20cb2a606ed89cd0ed98908d7e103b057a929b75cb899ad537",
  "pl|signed|url|special|links": "83ca8840d1d8fe3ff374f2c6b80e9a2d890836a97945ee4c705fcd3b2abcefce",
  "pl|signed|url|special|unusedTag":
    "7d70f0d11e0ae467fa8babbe5bf0dc00f132a41e2d80459c7332783ae5cd2ebe",
  "pl|signed|none|plain|links": "0f41feea95c1dec7259453707893111c8eff1f9e4430a62ca2f4799779d5aaea",
  "pl|signed|none|plain|unusedTag":
    "186d0c1dade7896d4d0b5c1e4ecaed69bf6a46429219319e1cac075e03b4e556",
  "pl|signed|none|special|links":
    "659963f09c459ae9439b4690cf56125537869e066c7e0363dafd6a42297e870f",
  "pl|signed|none|special|unusedTag":
    "aef9313bad4a3dcf39d4858489eeb0685f6e5df89d8e3c6a0709e2165f655e95",
  "en|none|url|plain|links": "ed6b027be746befc957426e5cdc67c4762635f8e978d6a448fd2ca073f3d5288",
  "en|none|url|plain|unusedTag": "4e3b2c012836926fd03174a7bd472201eec88d1e64bcfbd051eaccd79a973aef",
  "en|none|url|special|links": "6e05abee36f0e7cd647656e646d32f2ac0a3e0c88b103827c986b416845f423b",
  "en|none|url|special|unusedTag":
    "6f590dc7e9f985fc444e273c0b6f6fc35489561bb76554d5571f52579b74b52b",
  "en|none|none|plain|links": "be30a7f6ffe646325029b07cf7a881c8c65ee07014e0d76454f3dcf10d4874e2",
  "en|none|none|plain|unusedTag":
    "7d15cb45892ad1e3f6b81bd39869f9b606affe8ed8f8da499df769ba9bd72b25",
  "en|none|none|special|links": "bfe9cde2796a5bfa36f11d4c4d94472a53548ce95ce27cf1415b37f05dadc5a6",
  "en|none|none|special|unusedTag":
    "0e6ea6aefcb354c89f3c6e88f7706c3268097fe383e77d90f09d47234f55be7c",
  "en|plain|url|plain|links": "1cd45c7408b0a6aca6b64875881014802c512fa2c4d700df81f87dd12e14edb0",
  "en|plain|url|plain|unusedTag":
    "2c584974d86bf22fcfc8c81782924c37f5af17ae5d1eee11574e0af9b2b65cff",
  "en|plain|url|special|links": "afdee045b688d6a2028e370d4ba273a515d9e7e3e0bcefa640d978dba1bd6479",
  "en|plain|url|special|unusedTag":
    "2ce8c5112147c3671568e3c9c715e2cbc5cd444499e9a2ea3c6f93ed2d1eb124",
  "en|plain|none|plain|links": "0e468266f71c59873e87434276896529c5ef49d255cc0e46b286ffd92ae53a9e",
  "en|plain|none|plain|unusedTag":
    "186d0c1dade7896d4d0b5c1e4ecaed69bf6a46429219319e1cac075e03b4e556",
  "en|plain|none|special|links": "8bc1bb755ee0648df242dde9e7b4901e4ed0375a46fa815cad10e623c307c05c",
  "en|plain|none|special|unusedTag":
    "aef9313bad4a3dcf39d4858489eeb0685f6e5df89d8e3c6a0709e2165f655e95",
  "en|signed|url|plain|links": "790bcfa1a67e815f7cd2fb6dcd1f39534050fa8d2d6ddd8db849a104179d2aad",
  "en|signed|url|plain|unusedTag":
    "2c584974d86bf22fcfc8c81782924c37f5af17ae5d1eee11574e0af9b2b65cff",
  "en|signed|url|special|links": "97a1d5fafe1bbbe3b5ad91910d2c2c8328be58da0bc206e2bcb8e071e1c9d273",
  "en|signed|url|special|unusedTag":
    "2ce8c5112147c3671568e3c9c715e2cbc5cd444499e9a2ea3c6f93ed2d1eb124",
  "en|signed|none|plain|links": "0f41feea95c1dec7259453707893111c8eff1f9e4430a62ca2f4799779d5aaea",
  "en|signed|none|plain|unusedTag":
    "186d0c1dade7896d4d0b5c1e4ecaed69bf6a46429219319e1cac075e03b4e556",
  "en|signed|none|special|links":
    "659963f09c459ae9439b4690cf56125537869e066c7e0363dafd6a42297e870f",
  "en|signed|none|special|unusedTag":
    "aef9313bad4a3dcf39d4858489eeb0685f6e5df89d8e3c6a0709e2165f655e95",
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function matrix(): Array<[string, () => string]> {
  const cases: Array<[string, () => string]> = [];
  for (const lang of ["pl", "en"] as const)
    for (const [tk, tracking] of Object.entries(TRACKING))
      for (const [uk, unsub] of Object.entries(UNSUB))
        for (const [vk, vars] of Object.entries(VARS))
          for (const [hk, html] of Object.entries(HTML)) {
            cases.push([
              `${lang}|${tk}|${uk}|${vk}|${hk}`,
              () => renderCampaignHtml(html, { ...vars }, lang, unsub, tracking),
            ]);
          }
  return cases;
}

describe("renderCampaignHtml - bajt w bajt z implementacją sprzed wyniesienia", () => {
  it("macierz ma 48 przypadków i każdy ma skrót bazowy", () => {
    expect(matrix()).toHaveLength(48);
    expect(Object.keys(BASE_SHA256).sort()).toEqual(
      matrix()
        .map(([key]) => key)
        .sort(),
    );
  });

  it.each(matrix())("%s", (key, render) => {
    expect(sha256(render())).toBe(BASE_SHA256[key]);
  });

  it("couponCode: null/undefined nie zmienia wyniku (macierz bez tagu identyczna)", () => {
    for (const [key, render] of matrix()) {
      const [lang, tk, uk, vk, hk] = key.split("|") as [
        "pl" | "en",
        keyof typeof TRACKING,
        keyof typeof UNSUB,
        keyof typeof VARS,
        keyof typeof HTML,
      ];
      const withNull = renderCampaignHtml(
        HTML[hk],
        { ...VARS[vk], couponCode: null },
        lang,
        UNSUB[uk],
        TRACKING[tk],
      );
      expect(withNull).toBe(render());
    }
  });

  it("pełny wynik: PL, tracking z podpisem, stopka, znaki specjalne", () => {
    expect(
      renderCampaignHtml(HTML.links, { ...VARS.special }, "pl", UNSUB.url, TRACKING.signed),
    ).toBe(
      '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">' +
        "<h1>Cześć &lt;b&gt;&quot;Zoë&quot;&lt;/b&gt; Kowalska &amp; Syn&#39;s</h1><p>Twój adres: o&#39;brien+x@example.test</p>" +
        '<p><a href="https://example.test/api/public/nl-click?c=11111111-2222-3333-4444-555555555555&amp;s=tok.sig&amp;u=https%3A%2F%2Fexample.test%2Fa%3Fx%3D1%26y%3D2&amp;k=sig-30">Czytaj</a>' +
        " i <a href='https://example.test/api/public/nl-click?c=11111111-2222-3333-4444-555555555555&amp;s=tok.sig&amp;u=http%3A%2F%2Fexample.test%2Fb&amp;k=sig-21'>więcej</a></p>" +
        '<hr style="border:none;border-top:1px solid #eee;margin:24px 0" />\n' +
        '       <p style="color:#888;font-size:12px;text-align:center">\n' +
        '         Nie chcesz otrzymywać tych wiadomości? <a href="https://example.test/api/public/newsletter/unsubscribe?token=abc&amp;x=&lt;1&gt;" style="color:#888">Wypisz się jednym kliknięciem</a>.\n' +
        "       </p>" +
        '<img src="https://example.test/api/public/nl-open?c=11111111-2222-3333-4444-555555555555&amp;s=tok.sig" width="1" height="1" alt="" style="display:none;width:1px;height:1px" /></div>',
    );
  });

  it("pełny wynik: EN, bez trackingu i stopki - nieznane tagi zostają nietknięte", () => {
    expect(renderCampaignHtml(HTML.unusedTag, { ...VARS.plain }, "en", null, null)).toBe(
      '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">' +
        "<p>Kod: <strong>{{coupon_code}}</strong>, {{unknown_tag}} - Anna</p></div>",
    );
  });
});

describe("renderCampaignHtml - kod kuponu (P04)", () => {
  it("podstawia {{coupon_code}} we wszystkich wystąpieniach, z escapowaniem", () => {
    const html = renderCampaignHtml(
      "<p>{{coupon_code}}</p><p>Jeszcze raz: {{coupon_code}}</p>",
      { ...VARS.plain, couponCode: "JES<IEN>&25" },
      "pl",
      null,
      null,
    );
    expect(html).toContain("<p>JES&lt;IEN&gt;&amp;25</p><p>Jeszcze raz: JES&lt;IEN&gt;&amp;25</p>");
    expect(html).not.toContain("{{coupon_code}}");
  });

  it("kod nie przechodzi przez tracking, a pozostałe zmienne działają jak dotąd", () => {
    const html = renderCampaignHtml(
      HTML.unusedTag,
      { ...VARS.plain, couponCode: "ABCD-1234" },
      "en",
      UNSUB.url,
      TRACKING.signed,
    );
    expect(html).toContain("<strong>ABCD-1234</strong>, {{unknown_tag}} - Anna");
  });

  it("imię z napisem {{coupon_code}} nie staje się nośnikiem kodu", () => {
    const html = renderCampaignHtml(
      "<p>{{firstName}}: {{coupon_code}}</p>",
      { ...VARS.plain, firstName: "{{coupon_code}}", couponCode: "SEKRET-1" },
      "pl",
      null,
      null,
    );
    expect(html).toContain("<p>{{coupon_code}}: SEKRET-1</p>");
  });

  it("szablon bez tagu z kodem = wynik bez kodu", () => {
    for (const [key, render] of matrix().filter(([k]) => k.endsWith("|links"))) {
      const [lang, tk, uk, vk] = key.split("|") as [
        "pl" | "en",
        keyof typeof TRACKING,
        keyof typeof UNSUB,
        keyof typeof VARS,
      ];
      expect(
        renderCampaignHtml(
          HTML.links,
          { ...VARS[vk], couponCode: "KOD-1" },
          lang,
          UNSUB[uk],
          TRACKING[tk],
        ),
      ).toBe(render());
    }
  });

  it('linia „Nie mierz moich otwarć i kliknięć" (I9d-Y2): poza przekierowaniem, PL i EN, brak = bajt w bajt jak dotąd', () => {
    const optOut = "https://nes.example.test/api/public/newsletter/measurement?token=ws1&lang=pl";
    for (const [key, render] of matrix()) {
      const [lang, tk, uk, vk, hk] = key.split("|") as [
        "pl" | "en",
        keyof typeof TRACKING,
        keyof typeof UNSUB,
        keyof typeof VARS,
        keyof typeof HTML,
      ];
      // Jawne `null` = ten sam wynik co dotąd (skróty SHA-256 macierzy wyżej).
      expect(renderCampaignHtml(HTML[hk], VARS[vk], lang, UNSUB[uk], TRACKING[tk], null)).toBe(
        render(),
      );
      const html = renderCampaignHtml(HTML[hk], VARS[vk], lang, UNSUB[uk], TRACKING[tk], optOut);
      expect(html).toContain(`href="${optOut.replace(/&/g, "&amp;")}"`);
      expect(html).toContain(
        lang === "pl"
          ? "Nie mierz moich otwarć i kliknięć</a>"
          : "Don&#39;t measure my opens and clicks</a>",
      );
      // Adres wycofania nie trafia do przekierowania trackingu.
      expect(html).not.toContain(`u=${encodeURIComponent(optOut)}`);
    }
  });

  it("przykładowy kod wysyłki testowej jest stały i czytelny", () => {
    expect(SAMPLE_COUPON_CODE).toBe("PRZYKLAD-KOD");
  });
});
