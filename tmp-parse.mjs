import { readFileSync } from 'node:fs';
const txt = readFileSync('src/lib/icons/lucideIconNodes.generated.ts','utf8');
const m = /LUCIDE_ICON_NODES: Record<string, IconNode> = (\{[\s\S]*\});/.exec(txt);
const raw = m[1];
const json = raw.replace(/([,{\[]\s*)([a-zA-Z][a-zA-Z0-9-]*)\s*:/g, '$1"$2":');
try {
  JSON.parse(json);
  console.log('ok');
} catch (e) {
  console.error(e.message);
  // find position
  const pos = e.message.match(/position (\d+)/)?.[1];
  if (pos) {
    console.log('around:', json.slice(Math.max(0, +pos-100), +pos+100));
  }
}
