/**
 * Verifies js_automations/locales/de/translation.json and .../en/translation.json
 * declare exactly the same set of leaf keys.
 *
 * Nothing else in the build/lint/typecheck/test pipeline catches a key added to
 * only one language, so a missed translation silently falls back to the raw
 * i18next key at runtime. Run as part of `npm run lint`.
 */
const fs = require('fs');
const path = require('path');

const DE_PATH = path.join(__dirname, '..', 'js_automations', 'locales', 'de', 'translation.json');
const EN_PATH = path.join(__dirname, '..', 'js_automations', 'locales', 'en', 'translation.json');

function collectLeafKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function loadKeySet(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return new Set(collectLeafKeys(parsed));
}

const deKeys = loadKeySet(DE_PATH);
const enKeys = loadKeySet(EN_PATH);

const missingInEn = [...deKeys].filter((k) => !enKeys.has(k)).sort();
const missingInDe = [...enKeys].filter((k) => !deKeys.has(k)).sort();

if (missingInEn.length === 0 && missingInDe.length === 0) {
  console.log(`i18n parity OK — ${deKeys.size} keys in both de/translation.json and en/translation.json.`);
  process.exit(0);
}

console.error('i18n parity check failed.');
if (missingInEn.length > 0) {
  console.error(`\nIn de/translation.json but missing from en/translation.json (${missingInEn.length}):`);
  for (const key of missingInEn) console.error(`  - ${key}`);
}
if (missingInDe.length > 0) {
  console.error(`\nIn en/translation.json but missing from de/translation.json (${missingInDe.length}):`);
  for (const key of missingInDe) console.error(`  - ${key}`);
}
process.exit(1);
