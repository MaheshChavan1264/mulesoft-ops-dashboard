/**
 * generateCodeSample
 *
 * Builds a representative example request (URL, headers, query params, body)
 * from a parsed endpoint + the asset's `schemas`/`securitySchemes`/`servers`
 * (the shape `backend/src/utils/specParser.js` produces), then renders it as
 * a cURL / JavaScript (fetch) / Python (requests) snippet — mirroring the
 * "Code Example" section Anypoint Exchange's API Console shows per endpoint.
 *
 * Example VALUES are best-effort: explicit `example`/`enum` values are
 * preferred, falling back to format-aware placeholders (date-time, email,
 * uuid) and finally a generic placeholder per JSON type. `$ref`s are
 * resolved against the `schemas` dict with a cycle guard — a self-
 * referencing schema renders a `"<TypeName>"` placeholder string instead of
 * recursing forever.
 */

/** Resolve one schema node to a representative example JS value. */
export function exampleForSchema(schema, schemas = {}, visited = new Set()) {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;

  if (schema.$ref) {
    if (visited.has(schema.$ref)) return `<${schema.$ref}>`;
    const target = schemas[schema.$ref];
    if (!target) return `<${schema.$ref}>`;
    const nextVisited = new Set(visited);
    nextVisited.add(schema.$ref);
    return exampleForSchema(target, schemas, nextVisited);
  }

  if (schema.enum?.length) return schema.enum[0];
  if (schema.oneOf?.length) return exampleForSchema(schema.oneOf[0], schemas, visited);
  if (schema.anyOf?.length) return exampleForSchema(schema.anyOf[0], schemas, visited);
  if (schema.allOf?.length) {
    return schema.allOf.reduce((acc, member) => {
      const v = exampleForSchema(member, schemas, visited);
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...acc, ...v } : acc;
    }, {});
  }

  if (schema.type === 'array') {
    return [exampleForSchema(schema.items, schemas, visited)];
  }

  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
      obj[propName] = exampleForSchema(propSchema, schemas, visited);
    }
    return obj;
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return new Date().toISOString().slice(0, 10);
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uuid') return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      return 'string';
    case 'integer': return 0;
    case 'number': return 0;
    case 'boolean': return true;
    default: return null;
  }
}

/** Substitute `{param}` placeholders in a path with example/placeholder values. */
function fillPathParams(path, pathParams) {
  return (pathParams || []).reduce(
    (p, param) => p.replace(`{${param.name}}`, encodeURIComponent(param.example || `<${param.name}>`)),
    path
  );
}

/**
 * Resolve the Authorization-related header(s) a security requirement
 * implies, using `securitySchemes` to tell apiKey/bearer/basic/oauth2 apart.
 * Returns `{}` when the scheme can't be identified (nothing added) rather
 * than guessing.
 */
function securityHeaders(security, securitySchemes) {
  const headers = {};
  for (const req of security || []) {
    const scheme = securitySchemes?.[req.name];
    if (!scheme) continue;
    if (scheme.type === 'apiKey' && scheme.in === 'header') {
      headers[scheme.name || req.name] = `<${(scheme.name || 'API_KEY').toUpperCase()}>`;
    } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
      headers.Authorization = 'Basic <BASE64_CREDENTIALS>';
    } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      headers.Authorization = `Bearer <${scheme.bearerFormat || 'TOKEN'}>`;
    } else if (scheme.type === 'oauth2') {
      headers.Authorization = 'Bearer <ACCESS_TOKEN>';
    }
  }
  return headers;
}

/**
 * Build { method, url, headers, queryParams, body } for one endpoint.
 *
 * @param {object} ep           normalized endpoint (from specParser)
 * @param {object} pingSpec     the full ping-spec response ({ servers, schemas, securitySchemes })
 */
export function buildExampleRequest(ep, pingSpec) {
  const baseUrl = pingSpec?.servers?.[0]?.url?.replace(/\/+$/, '') || '';
  const path = fillPathParams(ep.path, ep.pathParams);
  const url = `${baseUrl}${path}`;

  const queryParams = (ep.queryParams || [])
    .filter((p) => p.required || p.example)
    .map((p) => ({ name: p.name, value: p.example || `<${p.name}>` }));

  const headers = {};
  for (const h of (ep.headers || [])) {
    if (h.required || h.example) headers[h.name] = h.example || `<${h.name}>`;
  }
  Object.assign(headers, securityHeaders(ep.security, pingSpec?.securitySchemes));

  let body = null;
  const bodyContent = ep.requestBody?.content;
  if (bodyContent) {
    const mediaType = Object.keys(bodyContent).find((mt) => mt.includes('json')) || Object.keys(bodyContent)[0];
    if (mediaType) {
      headers['Content-Type'] = headers['Content-Type'] || mediaType;
      body = exampleForSchema(bodyContent[mediaType]?.schema, pingSpec?.schemas || {});
    }
  } else {
    headers.Accept = headers.Accept || 'application/json';
  }

  return { method: ep.method, url, queryParams, headers, body };
}

function urlWithQuery(url, queryParams) {
  if (!queryParams?.length) return url;
  const qs = queryParams.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/** Render a built request as a cURL command. */
export function toCurl(req) {
  const lines = [`curl -X ${req.method} "${urlWithQuery(req.url, req.queryParams)}"`];
  for (const [name, value] of Object.entries(req.headers)) {
    lines.push(`  -H "${name}: ${value}"`);
  }
  if (req.body != null) {
    const json = JSON.stringify(req.body, null, 2);
    lines.push(`  -d '${json}'`);
  }
  return lines.join(' \\\n');
}

/** Render a built request as a JavaScript `fetch` snippet. */
export function toFetchJs(req) {
  const url = urlWithQuery(req.url, req.queryParams);
  const headerEntries = Object.entries(req.headers);
  const opts = [`method: "${req.method}"`];
  if (headerEntries.length) {
    opts.push(`headers: {\n${headerEntries.map(([k, v]) => `    "${k}": "${v}"`).join(',\n')}\n  }`);
  }
  if (req.body != null) {
    opts.push(`body: JSON.stringify(${JSON.stringify(req.body, null, 2).split('\n').join('\n  ')})`);
  }
  return `fetch("${url}", {\n  ${opts.join(',\n  ')}\n})\n  .then(res => res.json())\n  .then(data => console.log(data));`;
}

/** Render a built request as a Python `requests` snippet. */
export function toPython(req) {
  const headerEntries = Object.entries(req.headers);
  const lines = ['import requests', '', `url = "${req.url}"`];
  if (headerEntries.length) {
    lines.push(`headers = {${headerEntries.map(([k, v]) => `\n    "${k}": "${v}"`).join(',')}\n}`);
  }
  if (req.queryParams?.length) {
    lines.push(`params = {${req.queryParams.map((p) => `\n    "${p.name}": "${p.value}"`).join(',')}\n}`);
  }
  if (req.body != null) {
    lines.push(`payload = ${JSON.stringify(req.body, null, 4).replace(/^/gm, '').replace(/null/g, 'None').replace(/true/g, 'True').replace(/false/g, 'False')}`);
  }
  const callArgs = ['url'];
  if (headerEntries.length) callArgs.push('headers=headers');
  if (req.queryParams?.length) callArgs.push('params=params');
  if (req.body != null) callArgs.push('json=payload');
  lines.push('', `response = requests.${req.method.toLowerCase()}(${callArgs.join(', ')})`, 'print(response.status_code, response.json())');
  return lines.join('\n');
}

export const CODE_SAMPLE_LANGS = [
  { id: 'curl', label: 'cURL', generate: toCurl },
  { id: 'js', label: 'JavaScript', generate: toFetchJs },
  { id: 'python', label: 'Python', generate: toPython },
];
