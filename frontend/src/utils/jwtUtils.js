/**
 * Lightweight, dependency-free JWT helpers.
 *
 * Used by the ping test UI (PingTestPanel, PingTestPage) to surface JWT
 * details whenever a ping response body happens to carry a JWT string
 * (e.g. an app echoing back an access/id token it validated). This never
 * verifies a signature — it only base64url-decodes the header/payload for
 * display, exactly like jwt.io's "decoded" panel.
 */

// Three base64url segments separated by dots — good enough to flag a string
// as "JWT-shaped" without false-positiving on arbitrary dotted strings.
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function isJwtLike(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 16 || !JWT_PATTERN.test(trimmed)) return false;
  const [header] = trimmed.split('.');
  try {
    const decoded = JSON.parse(base64UrlDecode(header));
    return !!decoded && typeof decoded === 'object' && ('alg' in decoded || 'typ' in decoded);
  } catch {
    return false;
  }
}

function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  // atob gives a binary string — re-decode as UTF-8 so non-ASCII claims survive.
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Decode a JWT's header + payload (no signature verification).
 * @param {string} token
 * @returns {{ header: object, payload: object, signature: string, raw: string } | null}
 */
export function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { header, payload, signature: parts[2], raw: trimmed };
  } catch {
    return null;
  }
}

const CLAIM_TIME_FIELDS = ['exp', 'iat', 'nbf'];

/**
 * Decode a JWT and compute display-friendly expiry info.
 * @param {string} token
 * @returns {{ header, payload, signature, raw, expiresAt: Date|null, issuedAt: Date|null, notBefore: Date|null, isExpired: boolean|null } | null}
 */
export function decodeJwtWithExpiry(token) {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  const toDate = (v) => (typeof v === 'number' ? new Date(v * 1000) : null);
  const expiresAt = toDate(decoded.payload.exp);
  const issuedAt = toDate(decoded.payload.iat);
  const notBefore = toDate(decoded.payload.nbf);
  return {
    ...decoded,
    expiresAt,
    issuedAt,
    notBefore,
    isExpired: expiresAt ? expiresAt.getTime() < Date.now() : null,
  };
}

/**
 * Recursively scan a JSON-like value for the first string that looks like a
 * JWT, returning its location (dotted key path) alongside the token.
 * Depth-limited to avoid pathological payloads.
 *
 * @param {*} value
 * @param {string} path
 * @param {number} depth
 * @returns {{ path: string, token: string } | null}
 */
export function findJwtInValue(value, path = '', depth = 0) {
  if (value == null || depth > 6) return null;
  if (typeof value === 'string') {
    return isJwtLike(value) ? { path: path || '(root)', token: value.trim() } : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findJwtInValue(value[i], path ? `${path}[${i}]` : `[${i}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = findJwtInValue(value[key], path ? `${path}.${key}` : key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Does this ping result look like it needs a JWT Bearer token?
 *
 * Deliberately NOT gated on `result.status` — the backend only derives
 * status from the HTTP status code (any 2xx is "SUCCESS"), so an app can
 * return HTTP 200 with a body/error that still says "JWT token required"
 * (e.g. an app-level auth check happening after the transport-level ping
 * succeeds). We scan the raw payload/error text for that case too, not just
 * PARTIAL/FAILED pings with 401/403/400.
 *
 * @param {{ status?: string, httpStatus?: number, payload?: *, error?: string }} result
 * @returns {boolean}
 */
export function looksLikeJwtRequired(result) {
  if (!result) return false;
  // Hard auth-rejection codes always qualify, regardless of response body wording.
  if ([401, 403].includes(result.httpStatus)) return true;

  const bodyText = (() => {
    try { return typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload ?? ''); }
    catch { return ''; }
  })();
  const text = `${bodyText} ${result.error || ''}`.toLowerCase();
  const mentionsAuth = /(jwt|bearer|access[\s_]?token|authoriz(e|ation))/.test(text);
  const looksRequired = /unauthoriz|unauthenticated|invalid[\s_-]?token|missing[\s_-]?token|token[\s_-]?(required|missing|expired)|no\s+auth/.test(text);
  return mentionsAuth && looksRequired;
}

export { CLAIM_TIME_FIELDS };
