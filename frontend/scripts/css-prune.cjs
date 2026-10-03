const fs = require('fs');

const css = fs.readFileSync('index.css', 'utf8');
const lines = css.split('\n');
const result = JSON.parse(fs.readFileSync('.css_audit_result.json', 'utf8'));

const startIdx = lines.findIndex((l) => l.includes('Auto-generated dark-mode overrides'));

// Everything before the auto-generated block (base layer + doc comment) is kept verbatim.
const header = lines.slice(0, startIdx).join('\n');

// Keep only the "live" rule lines, in their original relative order, de-duplicated by exact line text.
const liveIdxSet = new Set(result.live.map((r) => r.i));
const seen = new Set();
const keptLines = [];
for (let i = startIdx; i < lines.length; i++) {
  if (!liveIdxSet.has(i)) continue;
  const text = lines[i];
  if (seen.has(text)) continue;
  seen.add(text);
  keptLines.push(text);
}

const banner = [
  '/* ===================================================================',
  ' * Dark-mode retrofit overrides — PRUNED',
  ' *',
  ' * This block began as an exhaustive, mechanically-generated sweep of',
  ' * every raw (non `dark:`-prefixed) Tailwind utility class the app might',
  ' * ever use, across every opacity step (5-95%) for several colors. Most',
  ' * of those combinations were never actually used anywhere in the',
  ' * source, so this file has been pruned down to only the rules whose',
  ' * exact Tailwind class string is verified (via a literal substring scan',
  ' * of every .jsx/.js file) to still appear in the codebase.',
  ' *',
  ' * This removed ~1,170 dead rules (out of ~1,540) with zero functional',
  ' * change, since a selector that never matches any element can never',
  ' * have had any visual effect.',
  ' *',
  ' * This is still a retrofit, not a fix: components below are relying on',
  ' * this global override instead of an explicit `dark:` variant. The real',
  ' * fix is migrating each remaining raw-class usage to a `dark:` variant',
  ' * and deleting its corresponding rule here. Until that migration is',
  ' * complete, keep this file in sync by re-running the audit script used',
  ' * to prune it (see FRONTEND_ARCHITECTURE_REVIEW.md Phase 5) whenever a',
  ' * component\u2019s raw-class usage changes.',
  ' * =================================================================== */',
].join('\n');

const out = `${header}\n${banner}\n${keptLines.join('\n')}\n`;
fs.writeFileSync('index.css', out);

console.log('Original lines:', lines.length);
console.log('New total lines:', out.split('\n').length);
console.log('Kept rules:', keptLines.length);
