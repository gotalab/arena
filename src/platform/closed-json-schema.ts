type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/** Validates the closed JSON Schema subset accepted by Arena game manifests. */
export function matchesClosedJsonSchema(value: unknown, schema: JsonSchema): boolean {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.filter((branch) => isObject(branch) && matchesClosedJsonSchema(value, branch)).length === 1;
  }
  if (Object.hasOwn(schema, "const") && !equalJson(value, schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => equalJson(value, entry))) return false;

  if (typeof schema.type === "string" && !matchesType(value, schema.type)) return false;
  if (Array.isArray(schema.type)) {
    if (!schema.type.every((entry) => typeof entry === "string")) return false;
    if (!schema.type.some((entry) => matchesType(value, entry))) return false;
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return false;
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) return false;
    if (isObject(schema.items) && !value.every((entry) => matchesClosedJsonSchema(entry, schema.items as JsonSchema))) return false;
  }

  if (isObject(value) && isObject(schema.properties)) {
    const properties = schema.properties as Record<string, unknown>;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(properties, key))) return false;
    if (Array.isArray(schema.required)) {
      if (!schema.required.every((key) => typeof key === "string" && Object.hasOwn(value, key))) return false;
    }
    for (const [key, field] of Object.entries(value)) {
      const fieldSchema = properties[key];
      if (fieldSchema !== undefined && (!isObject(fieldSchema) || !matchesClosedJsonSchema(field, fieldSchema))) return false;
    }
  }

  return true;
}
