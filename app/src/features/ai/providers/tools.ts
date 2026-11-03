// Checking a tool call's input against the tool's schema before it runs.
// With eager input streaming (Anthropic) and plain JSON arguments (the
// OpenAI-style API) nothing on the server guarantees the input matches, so
// the providers check it here. A call that fails comes back with its input
// replaced by { INVALID_JSON: "<what was received>" }: the agent should
// answer it with that as an error result instead of running the tool.
import type { ToolCall, ToolSpec } from './types';

export interface InvalidToolInput {
  INVALID_JSON: string;
}

export function isInvalidToolInput(input: unknown): input is InvalidToolInput {
  return !!input && typeof input === 'object' && typeof (input as InvalidToolInput).INVALID_JSON === 'string' && Object.keys(input).length === 1;
}

function typeOk(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) return type.some((t) => typeOk(t, value));
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

// Why the input doesn't fit the schema, or null when it does. Checks the
// top level: required fields, known fields and their types, and enums.
export function validateToolInput(spec: ToolSpec, input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'the input is not an object';
  const props = spec.inputSchema.properties ?? {};
  for (const name of spec.inputSchema.required ?? []) {
    if (!(name in input)) return `"${name}" is missing`;
  }
  for (const [name, value] of Object.entries(input)) {
    const schema = props[name] as { type?: unknown; enum?: unknown[] } | undefined;
    if (!schema) {
      if (spec.inputSchema.additionalProperties === false) return `"${name}" is not a parameter of ${spec.name}`;
      continue;
    }
    if (schema.type !== undefined && !typeOk(schema.type, value)) return `"${name}" should be ${Array.isArray(schema.type) ? schema.type.join(' or ') : String(schema.type)}`;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `"${name}" should be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  }
  return null;
}

// The call as the agent gets it: the input, or the INVALID_JSON marker.
export function checkedCall(tools: ToolSpec[], id: string, name: string, input: unknown, rawText?: string): ToolCall {
  const spec = tools.find((t) => t.name === name);
  const problem = spec ? validateToolInput(spec, input) : null;
  if (spec && !problem) return { id, name, input };
  return { id, name, input: { INVALID_JSON: rawText ?? JSON.stringify(input ?? null) } };
}
