import React, { useState } from 'react';
import { ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';

/**
 * SchemaTree
 *
 * Recursive renderer for a normalized JSON-Schema-like node (the shape
 * `backend/src/utils/specParser.js` produces for OAS `requestBody`/
 * `responses`/`components.schemas` and RAML `types:`), modeled on how
 * Anypoint Exchange's own API Console (github.com/api-components/
 * amf-components) renders a spec's Reference tab:
 *   - `$ref`s are resolved and INLINE-expanded (not clickable links) against
 *     the `schemas` lookup dict, same as Exchange.
 *   - Array-of-object shows as "Array of <TypeName>" with an expand chevron.
 *   - `oneOf`/`anyOf` render as a variant switcher (Exchange uses radio
 *     buttons for the same "pick one of N shapes" idea).
 *   - `allOf` renders as stacked "Properties inherited from X" sections,
 *     always expanded (no toggle), matching Exchange.
 *   - Enum values render as inline pills.
 *
 * A `visited` Set of ref names already on the current render path guards
 * against infinite recursion for self-referencing schemas (e.g. a tree
 * node whose `children` is an array of itself) — once a ref is seen again
 * on the same path, it renders as a terminal "(circular reference)" chip
 * instead of recursing forever.
 *
 * Props:
 *   schema    {object}  normalized schema node (may contain `$ref`)
 *   schemas   {object}  the full `{ name: schema }` lookup dict for $ref resolution
 *   name      {string}  optional property name this node is rendered under (root = asset/schema name)
 *   depth     {number}  nesting depth — depths >=2 start collapsed by default
 *   required  {boolean} whether this node is required within its parent
 *   visited   {Set}     ref names already expanded on this path (cycle guard)
 */
export default function SchemaTree({ schema, schemas = {}, name, depth = 0, required = false, visited }) {
  const seen = visited || new Set();
  if (!schema) return null;
  return <SchemaNode schema={schema} schemas={schemas} name={name} depth={depth} required={required} visited={seen} />;
}

function resolveRef(schema, schemas, visited) {
  if (!schema?.$ref) return { resolved: schema, refName: null, circular: false };
  const refName = schema.$ref;
  if (visited.has(refName)) return { resolved: schema, refName, circular: true };
  const target = schemas[refName];
  if (!target) return { resolved: schema, refName, circular: false, missing: true };
  return { resolved: target, refName, circular: false };
}

/** Short type label matching Exchange's "Array of Order" / "Order" / "string" convention. */
function typeLabel(schema, schemas, visited) {
  if (!schema) return 'any';
  if (schema.$ref) {
    const { circular, missing } = resolveRef(schema, schemas, visited);
    return schema.$ref + (circular ? ' (circular)' : missing ? ' (unresolved)' : '');
  }
  if (schema.oneOf) return 'one of';
  if (schema.anyOf) return 'any of';
  if (schema.allOf) return 'all of';
  if (schema.type === 'array') {
    const itemLabel = typeLabel(schema.items, schemas, visited);
    return `Array of ${itemLabel}`;
  }
  if (schema.type) return schema.format ? `${schema.type} (${schema.format})` : schema.type;
  if (schema.properties) return 'object';
  return 'any';
}

const TYPE_BADGE_CLS = 'text-[10px] px-1.5 py-0.5 rounded border font-mono bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20';

function EnumPills({ values }) {
  if (!values?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase font-bold self-center">Enum:</span>
      {values.map((v, i) => (
        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md border font-mono bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20">
          {String(v)}
        </span>
      ))}
    </div>
  );
}

function Constraints({ schema }) {
  const items = [];
  if (schema.minLength != null) items.push(`minLength: ${schema.minLength}`);
  if (schema.maxLength != null) items.push(`maxLength: ${schema.maxLength}`);
  if (schema.minimum != null) items.push(`min: ${schema.minimum}`);
  if (schema.maximum != null) items.push(`max: ${schema.maximum}`);
  if (schema.pattern) items.push(`pattern: ${schema.pattern}`);
  if (schema.default !== undefined) items.push(`default: ${JSON.stringify(schema.default)}`);
  if (!items.length) return null;
  return <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">{items.join(' · ')}</p>;
}

/** Renders one node — object/array/scalar/$ref/oneOf/anyOf/allOf — expandable when complex. */
function SchemaNode({ schema, schemas, name, depth, required, visited }) {
  const [open, setOpen] = useState(depth < 1);

  if (schema?.$ref) {
    const { resolved, refName, circular, missing } = resolveRef(schema, schemas, visited);
    if (circular) {
      return (
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs pl-1">
          <AlertCircle size={11} /> {refName} (circular reference — not expanded further)
        </div>
      );
    }
    if (missing) {
      return <span className={TYPE_BADGE_CLS}>{refName} (schema not found)</span>;
    }
    const nextVisited = new Set(visited); nextVisited.add(refName);
    return <SchemaNode schema={resolved} schemas={schemas} name={name} depth={depth} required={required} visited={nextVisited} />;
  }

  if (schema?.oneOf || schema?.anyOf) {
    const variants = schema.oneOf || schema.anyOf;
    const label = schema.oneOf ? 'One of the following schemas' : 'Any of the following schemas';
    return <UnionNode variants={variants} label={label} schemas={schemas} depth={depth} visited={visited} />;
  }

  if (schema?.allOf) {
    return (
      <div className="space-y-2">
        {schema.allOf.map((member, i) => (
          <div key={i} className="border-l-2 border-sfpurple-200 dark:border-sfpurple-400/30 pl-3">
            <p className="text-[10px] text-sfpurple-600 dark:text-sfpurple-400 font-semibold mb-1">
              Properties inherited from {member.$ref || `schema ${i + 1}`}
            </p>
            <SchemaNode schema={member} schemas={schemas} depth={depth} required={required} visited={visited} />
          </div>
        ))}
      </div>
    );
  }

  if (schema?.type === 'array') {
    const itemSchema = schema.items || {};
    const itemIsComplex = !!(itemSchema.$ref || itemSchema.properties || itemSchema.oneOf || itemSchema.anyOf || itemSchema.allOf || itemSchema.type === 'array');
    if (!itemIsComplex) {
      return (
        <div className="pl-1">
          <span className={TYPE_BADGE_CLS}>Array of {typeLabel(itemSchema, schemas, visited)}</span>
          <EnumPills values={itemSchema.enum} />
        </div>
      );
    }
    return (
      <div>
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-sf-700 dark:hover:text-sf-300 font-medium">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Array of {typeLabel(itemSchema, schemas, visited)}
        </button>
        {open && (
          <div className="pl-4 mt-1.5 border-l border-gray-200 dark:border-gray-700/60">
            <SchemaNode schema={itemSchema} schemas={schemas} depth={depth + 1} visited={visited} />
          </div>
        )}
      </div>
    );
  }

  if (schema?.properties && Object.keys(schema.properties).length > 0) {
    const requiredSet = new Set(schema.required || []);
    return (
      <div className="space-y-1.5">
        {Object.entries(schema.properties).map(([propName, propSchema]) => (
          <PropertyRow
            key={propName}
            propName={propName}
            propSchema={propSchema}
            required={requiredSet.has(propName)}
            schemas={schemas}
            depth={depth}
            visited={visited}
          />
        ))}
      </div>
    );
  }

  // Terminal scalar
  return (
    <div className="pl-1">
      <span className={TYPE_BADGE_CLS}>{typeLabel(schema, schemas, visited)}</span>
      <EnumPills values={schema?.enum} />
      <Constraints schema={schema || {}} />
    </div>
  );
}

function UnionNode({ variants, label, schemas, depth, visited }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {variants.map((v, i) => (
          <button key={i} onClick={() => setActive(i)}
            className={`text-[10px] px-2 py-1 rounded-lg border font-mono font-semibold transition-colors ${
              active === i
                ? 'bg-sf-600 text-white border-sf-600'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            {typeLabel(v, schemas, visited)}
          </button>
        ))}
      </div>
      <div className="pl-3 border-l-2 border-sf-200 dark:border-sf-400/30">
        <SchemaNode schema={variants[active]} schemas={schemas} depth={depth + 1} visited={visited} />
      </div>
    </div>
  );
}

function PropertyRow({ propName, propSchema, required, schemas, depth, visited }) {
  const isComplex = !!(propSchema?.$ref || propSchema?.properties || propSchema?.oneOf || propSchema?.anyOf || propSchema?.allOf || propSchema?.type === 'array');
  const [open, setOpen] = useState(depth < 1 && isComplex);
  const label = typeLabel(propSchema, schemas, visited);

  return (
    <div className="rounded-lg border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-gray-900/30 px-3 py-2">
      <div
        className={`flex items-start gap-2 flex-wrap ${isComplex ? 'cursor-pointer' : ''}`}
        onClick={isComplex ? () => setOpen(o => !o) : undefined}
      >
        {isComplex ? (open ? <ChevronDown size={12} className="mt-0.5 text-gray-400" /> : <ChevronRight size={12} className="mt-0.5 text-gray-400" />) : <span className="w-3" />}
        <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-100">{propName}</span>
        <span className={TYPE_BADGE_CLS}>{label}</span>
        {required && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border border-sforange-200/60 dark:border-sforange-400/20">
            required
          </span>
        )}
        {propSchema?.deprecated && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200/60 dark:border-red-400/20">
            deprecated
          </span>
        )}
        {propSchema?.description && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto">{propSchema.description}</span>
        )}
      </div>
      {!isComplex && <EnumPills values={propSchema?.enum} />}
      {!isComplex && <Constraints schema={propSchema || {}} />}
      {propSchema?.example != null && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Example: <code className="font-mono text-gray-600 dark:text-gray-300">{String(propSchema.example)}</code></p>
      )}
      {isComplex && open && (
        <div className="pl-4 mt-2 border-l border-gray-200 dark:border-gray-700/60">
          <SchemaNode schema={propSchema} schemas={schemas} depth={depth + 1} visited={visited} />
        </div>
      )}
    </div>
  );
}
