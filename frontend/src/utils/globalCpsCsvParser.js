import { parseCsvLine } from './csvCredentialStore';

/**
 * Parses the Global CPS CSV format with headers:
 * ch1_uat_client_id, ch1_uat_client_secret, ch1_prod_client_id, ch1_prod_client_secret,
 * ch2_uat_client_id, ch2_uat_client_secret, ch2_prod_client_id, ch2_prod_client_secret,
 * business-group
 *
 * Optional URL columns — ch1_uat_url, ch1_prod_url, ch2_uat_url, ch2_prod_url — may
 * also be supplied per row to specify the real CPS base URL for that business
 * group + CH version + environment. This is the ONLY source of real,
 * business-group-specific CPS URLs: GlobalCpsManagerPage has no other way to
 * know a given BG's actual CPS host, so a row that omits these columns leaves
 * that BG's URL unconfigured (shown as "Not configured" in the UI, with no
 * invented/example fallback) until either a URL column is added or the user
 * types a Custom CPS Host override.
 *
 * Returns an array of objects representing each business group's credentials
 * (and, where supplied, URLs).
 */
export function parseGlobalCpsCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  
  // Find indices for each expected header with lenient matching
  const idxMap = {
    ch1_uat_client_id: headers.findIndex(h => h.includes('ch1') && h.includes('uat') && h.includes('id')),
    ch1_uat_client_secret: headers.findIndex(h => h.includes('ch1') && h.includes('uat') && h.includes('secret')),
    ch1_prod_client_id: headers.findIndex(h => h.includes('ch1') && h.includes('prod') && h.includes('id')),
    ch1_prod_client_secret: headers.findIndex(h => h.includes('ch1') && h.includes('prod') && h.includes('secret')),
    ch2_uat_client_id: headers.findIndex(h => h.includes('ch2') && h.includes('uat') && h.includes('id')),
    ch2_uat_client_secret: headers.findIndex(h => h.includes('ch2') && h.includes('uat') && h.includes('secret')),
    ch2_prod_client_id: headers.findIndex(h => h.includes('ch2') && h.includes('prod') && h.includes('id')),
    ch2_prod_client_secret: headers.findIndex(h => h.includes('ch2') && h.includes('prod') && h.includes('secret')),
    // 'id'/'secret' columns above are matched before these — matching 'url' here
    // deliberately excludes anything that also contains 'id' so e.g. a header
    // like "ch1_uat_client_id" is never mistaken for a URL column.
    ch1_uat_url: headers.findIndex(h => h.includes('ch1') && h.includes('uat') && h.includes('url')),
    ch1_prod_url: headers.findIndex(h => h.includes('ch1') && h.includes('prod') && h.includes('url')),
    ch2_uat_url: headers.findIndex(h => h.includes('ch2') && h.includes('uat') && h.includes('url')),
    ch2_prod_url: headers.findIndex(h => h.includes('ch2') && h.includes('prod') && h.includes('url')),
    business_group: headers.findIndex(h => h.includes('business') && h.includes('group') || h.includes('bg') || h.includes('bussiness')),
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const getVal = (idx) => idx >= 0 && idx < parts.length ? parts[idx].replace(/^"|"$/g, '').trim() : '';
    
    const bg = getVal(idxMap.business_group);
    if (!bg) continue;

    results.push({
      businessGroup: bg,
      ch1: {
        uat: { clientId: getVal(idxMap.ch1_uat_client_id), clientSecret: getVal(idxMap.ch1_uat_client_secret), url: getVal(idxMap.ch1_uat_url) },
        prod: { clientId: getVal(idxMap.ch1_prod_client_id), clientSecret: getVal(idxMap.ch1_prod_client_secret), url: getVal(idxMap.ch1_prod_url) },
      },
      ch2: {
        uat: { clientId: getVal(idxMap.ch2_uat_client_id), clientSecret: getVal(idxMap.ch2_uat_client_secret), url: getVal(idxMap.ch2_uat_url) },
        prod: { clientId: getVal(idxMap.ch2_prod_client_id), clientSecret: getVal(idxMap.ch2_prod_client_secret), url: getVal(idxMap.ch2_prod_url) },
      }
    });
  }

  return results;
}
