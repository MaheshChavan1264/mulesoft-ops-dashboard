const fs = require('fs');

const css = fs.readFileSync('index.css', 'utf8');
const allSrc = fs.readFileSync('.all_src_cache.txt', 'utf8');
const lines = css.split('\n');

const startIdx = lines.findIndex((l) => l.includes('Auto-generated dark-mode overrides'));
console.log('Auto-generated block starts at line', startIdx + 1);
console.log('Total lines:', lines.length);

const results = { live: [], dead: [], skipped: [] };

// Matches: .dark .CLASS { ... }   or   .dark .CLASS:hover { ... }  or compound selectors
// ending in a final ".CLASS" segment right before optional pseudo and the "{"
const ruleRe = /\.((?:\\.|[^\s{:])+)(:hover|:focus)?\s*\{/;

for (let i = startIdx; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  if (!trimmed) continue;
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.endsWith('*/')) {
    results.skipped.push(i);
    continue;
  }
  if (!trimmed.startsWith('.dark')) {
    results.skipped.push(i);
    continue;
  }

  // Only look at the selector portion (before the first unescaped '{') —
  // otherwise decimal fractions in the declaration body (e.g. "0.05)")
  // get misdetected as class names.
  const braceIdx = trimmed.indexOf('{');
  const selectorPart = braceIdx >= 0 ? trimmed.slice(0, braceIdx) : trimmed;

  // Get the LAST class-looking segment in the selector (handles compound selectors
  // like ".dark .group:hover .group-hover\:bg-white")
  const matches = [...selectorPart.matchAll(/\.((?:\\.|[^\s{:])+)(:hover|:focus)?/g)];
  if (matches.length === 0) {
    results.skipped.push(i);
    continue;
  }
  const last = matches[matches.length - 1];
  let rawClass = last[1];
  // Unescape CSS escapes: \: -> :  \/ -> /  \. -> .
  rawClass = rawClass.replace(/\\(.)/g, '$1');

  const found = allSrc.includes(rawClass);
  if (found) {
    results.live.push({ i, rawClass });
  } else {
    results.dead.push({ i, rawClass });
  }
}

console.log('Live:', results.live.length);
console.log('Dead:', results.dead.length);
console.log('Skipped:', results.skipped.length);
fs.writeFileSync('.css_audit_result.json', JSON.stringify(results));
console.log('Sample dead classes:', results.dead.slice(0, 25).map((d) => d.rawClass));
