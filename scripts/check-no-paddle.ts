/**
 * Bramka CI: w kodzie nie może zostać żadna ŻYWA referencja do Paddle.
 *
 * Po migracji na Stripe wolno zostawić wyłącznie wzmianki historyczne w
 * komentarzach ("dawniej Paddle", "zastępuje paddleTransaction.server.ts").
 * Każde wystąpienie w kodzie wykonywalnym - import, identyfikator, literał
 * stringowy, zmienna środowiskowa, adres bramki - jest błędem i wywraca build,
 * bo oznacza ścieżkę, która realnie próbuje rozmawiać z nieistniejącym już
 * operatorem płatności.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", "coverage", "reports"]);
/** Ten plik z definicji zawiera szukane słowo - inaczej nie mógłby go szukać. */
const SELF = "scripts/check-no-paddle.ts";

const PATTERN = /paddle/i;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Usuwa komentarze (blokowe i liniowe), zostawiając kod. `http://` nie jest
 * komentarzem, więc `//` poprzedzone dwukropkiem pomijamy.
 */
function stripComments(source: string): string[] {
  const lines = source.split("\n");
  let inBlock = false;
  return lines.map((raw) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return "";
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf("/*");
      if (start === -1) break;
      const end = line.indexOf("*/", start + 2);
      if (end === -1) {
        inBlock = true;
        line = line.slice(0, start);
        break;
      }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    const lineComment = line.search(/(^|[^:])\/\//);
    if (lineComment !== -1) {
      const at = line.indexOf("//", lineComment);
      line = line.slice(0, at);
    }
    return line;
  });
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  const files = ROOTS.flatMap((root) => walk(root, []));
  for (const file of files) {
    const rel = relative(process.cwd(), file).replaceAll("\\", "/");
    if (rel === SELF) continue;
    const source = readFileSync(file, "utf8");
    if (!PATTERN.test(source)) continue;
    stripComments(source).forEach((line, index) => {
      if (PATTERN.test(line)) hits.push({ file: rel, line: index + 1, text: line.trim() });
    });
  }
  return hits;
}

const hits = scan();
if (hits.length) {
  console.error(
    `Bramka dostawcy płatności: znaleziono ${hits.length} żywych referencji do starego operatora poza komentarzami.\n` +
      "Przepnij je na Stripe (src/lib/stripe.server.ts, src/lib/stripe.ts) albo przenieś wzmiankę do komentarza.\n",
  );
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
  process.exit(1);
}
console.log("Bramka dostawcy płatności: brak żywych referencji - OK.");
