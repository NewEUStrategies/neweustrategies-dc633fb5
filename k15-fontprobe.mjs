// Sprawdza, czy rodzina "Red Hat Display Fallback" W OGÓLE POWSTAJE przy danym
// FONTCONFIG_FILE: porównuje szerokość tekstu w tej rodzinie z szerokością
// w rodzinie, której na pewno nie ma (czyli w domyślnym kroju systemowym).
import { chromium } from "playwright";

const SRC_OLD = 'local("Arial")';
const SRC_NEW = 'local("Arial"), local("Liberation Sans"), local("Arimo"), local("Helvetica")';

const page_html = (src) => `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:"RHD Fallback";src:${src};size-adjust:96.03%;ascent-override:106.01%;descent-override:31.76%;line-gap-override:0%}
body{margin:0}
span{font-size:100px;white-space:pre}
#a{font-family:"RHD Fallback"}
#b{font-family:"__nie-ma-takiej-rodziny__"}
</style><span id=a>Wiadomości ze świata AGHIJ</span><br><span id=b>Wiadomości ze świata AGHIJ</span>`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const page = await browser.newPage();
for (const [label, src] of [["stare (tylko Arial)", SRC_OLD], ["nowe (4 kandydatury)", SRC_NEW]]) {
  await page.setContent(page_html(src));
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const w = (id) => document.getElementById(id).getBoundingClientRect();
    return { a: w("a").width, ah: w("a").height, b: w("b").width, bh: w("b").height };
  });
  const formed = Math.abs(r.a - r.b) > 0.5 || Math.abs(r.ah - r.bh) > 0.5;
  console.log(
    `${label.padEnd(22)} fallback=${r.a.toFixed(2)}x${r.ah.toFixed(2)}  system=${r.b.toFixed(2)}x${r.bh.toFixed(2)}  rodzina POWSTAŁA: ${formed ? "TAK" : "NIE"}`,
  );
}
await browser.close();
