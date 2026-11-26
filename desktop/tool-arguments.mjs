// One argument checker for every tool Fairy offers, whether through the shared tool registry (desktop/tool-registry.mjs)
// or WorkTools (desktop/work-tools.mjs), including tools from MCP connectors. Covers the JSON Schema subset Fairy's tools
// use; unknown keywords are ignored, never a reason to refuse. Pure, no library.
export const OUTCOMES = Object.freeze(['ok', 'invalid', 'refused', 'failed', 'unknown']);

const TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array', 'null']);
const TYPE_WORDS = { object: 'an object', string: 'a string', number: 'a number', integer: 'a whole number', boolean: 'true or false', array: 'a list', null: 'null' };
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  const keysA = Object.keys(a), keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

function matchesType(type, value) {
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  return true;
}

function rangeHint(schema) {
  const hasMin = typeof schema.minimum === 'number' && Number.isFinite(schema.minimum);
  const hasMax = typeof schema.maximum === 'number' && Number.isFinite(schema.maximum);
  if (hasMin && hasMax) return ` between ${schema.minimum} and ${schema.maximum}`;
  if (hasMin) return ` of at least ${schema.minimum}`;
  if (hasMax) return ` of at most ${schema.maximum}`;
  return '';
}

function formatEnum(values) {
  const shown = values.slice(0, 12).map(value => typeof value === 'string' ? value : JSON.stringify(value));
  return values.length > 12 ? `${shown.join(', ')}, …` : shown.join(', ');
}

// Validates a tool's own schema at definition time, so a broken schema fails the suite rather than a live turn.
// Unknown JSON Schema keywords are ignored.
export function checkSchema(schema, name = 'tool') {
  if (!isPlainObject(schema)) throw new Error(`${name} schema must be an object.`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.length || types.some(type => !TYPES.has(type))) throw new Error(`${name} has an invalid schema type.`);
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) throw new Error(`${name} properties must be an object.`);
    for (const [key, prop] of Object.entries(schema.properties)) checkSchema(prop, `${name}.${key}`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !key)) throw new Error(`${name} required must be a list of names.`);
    if (isPlainObject(schema.properties)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(schema.properties, key)) throw new Error(`${name} requires an input it doesn't describe.`);
      }
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    if (!isPlainObject(schema.additionalProperties)) throw new Error(`${name} additionalProperties must be a boolean or schema.`);
    checkSchema(schema.additionalProperties, `${name}.*`);
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error(`${name} enum must be a non-empty list.`);
  if (schema.minimum !== undefined && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum))) throw new Error(`${name} minimum must be a finite number.`);
  if (schema.maximum !== undefined && (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum))) throw new Error(`${name} maximum must be a finite number.`);
  if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) throw new Error(`${name} minimum cannot exceed maximum.`);
  for (const bound of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[bound] !== undefined && (!Number.isInteger(schema[bound]) || schema[bound] < 0)) throw new Error(`${name} ${bound} must be a non-negative integer.`);
  }
  if (typeof schema.minLength === 'number' && typeof schema.maxLength === 'number' && schema.minLength > schema.maxLength) throw new Error(`${name} minLength cannot exceed maxLength.`);
  if (typeof schema.minItems === 'number' && typeof schema.maxItems === 'number' && schema.minItems > schema.maxItems) throw new Error(`${name} minItems cannot exceed maxItems.`);
  if (schema.items !== undefined) checkSchema(schema.items, `${name}[]`);
}

// Checks args against schema, returning '' when valid or the first problem in plain words the model can act on.
// Never echoes argument values, so the returned problem is safe to log.
export function checkArguments(schema, value, path = '') {
  if (!isPlainObject(schema)) return '';
  const label = path || 'arguments';

  // Type check (supports a single type or a list of types, e.g. from a connector).
  if (schema.type !== undefined) {
    const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter(type => TYPES.has(type));
    if (types.length && !types.some(type => matchesType(type, value))) {
      if (types.length === 1) {
        const only = types[0];
        if (only === 'object' && !path) return 'Arguments must be an object.';
        if (only === 'integer' || only === 'number') return `${label} must be ${TYPE_WORDS[only]}${rangeHint(schema)}.`;
        return `${label} must be ${TYPE_WORDS[only]}.`;
      }
      return `${label} must be ${types.map(type => TYPE_WORDS[type]).join(' or ')}.`;
    }
  } else if ((schema.properties || schema.required || schema.additionalProperties === false) && !isPlainObject(value)) {
    return path ? `${label} must be an object.` : 'Arguments must be an object.';
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => sameValue(value, item))) {
    return `${label} must be one of: ${formatEnum(schema.enum)}.`;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return `${label} must be at least ${schema.minLength} ${schema.minLength === 1 ? 'character' : 'characters'}.`;
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return `${label} must be at most ${schema.maxLength} ${schema.maxLength === 1 ? 'character' : 'characters'}.`;
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const whole = schema.type === 'integer' ? 'a whole number of ' : '';
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return `${label} must be ${whole}at least ${schema.minimum}.`;
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return `${label} must be ${whole}at most ${schema.maximum}.`;
    }
  }

  if (Array.isArray(value)) {
    if (isPlainObject(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const problem = checkArguments(schema.items, value[index], `${label}[${index}]`);
        if (problem) return problem;
      }
    }
  }

  if (isPlainObject(value)) {
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key) || value[key] === undefined) {
          const field = path ? `${path}.${key}` : key;
          return `${field} is required.`;
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(props, key)) {
          const safeKey = key.slice(0, 80);
          const field = path ? `${path}.${safeKey}` : safeKey;
          return `Unknown argument ${field}.`;
        }
      }
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
      const field = path ? `${path}.${key}` : key;
      const problem = checkArguments(propSchema, value[key], field);
      if (problem) return problem;
    }
    if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(props, key) || value[key] === undefined) continue;
        const safeKey = key.slice(0, 80);
        const field = path ? `${path}.${safeKey}` : safeKey;
        const problem = checkArguments(schema.additionalProperties, value[key], field);
        if (problem) return problem;
      }
    }
  }

  return '';
}
