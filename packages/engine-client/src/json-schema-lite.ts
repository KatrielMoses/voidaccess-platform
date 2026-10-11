/**
 * Minimal JSON Schema checker (no dependency) for the subset z.toJSONSchema emits:
 * type, enum, const, required, properties, additionalProperties, items, anyOf, min/max, minLength/maxLength.
 * Used to prove a payload satisfies the committed schemas/*.json files. Not a general validator
 * (no $ref, formats or patterns): the zod schemas remain the strict check in TS.
 */
export type JsonSchema = { [k: string]: unknown };

export function validateJsonSchema(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  const s = schema as {
    type?: string | string[];
    enum?: unknown[];
    const?: unknown;
    required?: string[];
    properties?: Record<string, JsonSchema>;
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema;
    anyOf?: JsonSchema[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
  };
  if (s.anyOf) {
    if (!s.anyOf.some((sub) => validateJsonSchema(sub, value, path).length === 0))
      errs.push(`${path}: no anyOf branch matched`);
    return errs;
  }
  if (s.const !== undefined && value !== s.const) errs.push(`${path}: expected const ${String(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errs.push(`${path}: not in enum`);
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeMatches(t, value))) {
      errs.push(`${path}: expected ${types.join("|")}`);
      return errs;
    }
  }
  if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) errs.push(`${path}: below minimum`);
    if (s.maximum !== undefined && value > s.maximum) errs.push(`${path}: above maximum`);
  }
  if (typeof value === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) errs.push(`${path}: too short`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errs.push(`${path}: too long`);
  }
  if (Array.isArray(value) && s.items) {
    value.forEach((v, i) => errs.push(...validateJsonSchema(s.items as JsonSchema, v, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) errs.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = s.properties?.[k];
      if (sub) errs.push(...validateJsonSchema(sub, v, `${path}.${k}`));
      else if (s.additionalProperties && typeof s.additionalProperties === "object") {
        errs.push(...validateJsonSchema(s.additionalProperties, v, `${path}.${k}`));
      }
    }
  }
  return errs;
}

function typeMatches(t: string, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    default:
      return true;
  }
}
