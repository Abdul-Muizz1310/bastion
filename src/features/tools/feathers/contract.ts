import { z } from "zod";

/**
 * The contract feathers-demo was generated with (spec 21 §5, §5.1), read from its `feathers.yaml`:
 * each endpoint with its role gate, and each model's soft-delete promise. A small reader for the
 * flow-mapping lines feathers-cli writes (`- { method: GET, path: "/users", … }`) — never a guess:
 * a line it cannot read, an unknown method or role gate, or no endpoints at all is an error.
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const GATES = ["any", "viewer", "editor", "admin"] as const;

const endpointSchema = z.strictObject({
  method: z.enum(METHODS),
  path: z.string().startsWith("/"),
  handler: z.string().min(1),
  auth: z.enum(GATES),
  paginate: z.string().min(1).optional(),
});

export type ContractEndpoint = z.infer<typeof endpointSchema>;
export type ContractModel = { name: string; softDelete: boolean };
export type Contract = { endpoints: ContractEndpoint[]; models: ContractModel[] };

/** The lines of one top-level section (`endpoints:`), up to the next top-level key. */
function section(yaml: string, key: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf(`${key}:`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim() !== "");
}

const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, "$1");

function readEndpoint(line: string): ContractEndpoint {
  const body = /^\s*-\s*\{(.*)\}\s*$/.exec(line)?.[1];
  if (body === undefined) throw new Error(`feathers contract: cannot read endpoint line ${line}`);
  const fields: Record<string, string> = {};
  for (const part of body.split(",")) {
    const match = /^\s*([a-z_]+)\s*:\s*(.+?)\s*$/.exec(part);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`feathers contract: cannot read endpoint field ${part.trim()}`);
    }
    fields[match[1]] = unquote(match[2]);
  }
  const parsed = endpointSchema.safeParse(fields);
  if (!parsed.success) {
    throw new Error(
      `feathers contract: endpoint ${line.trim()} — ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

function readModels(lines: readonly string[]): ContractModel[] {
  const models: ContractModel[] = [];
  for (const line of lines) {
    const name = /^\s{2}-\s*name:\s*(\S+)\s*$/.exec(line)?.[1];
    if (name !== undefined) {
      models.push({ name, softDelete: false });
      continue;
    }
    const soft = /^\s{4}soft_delete:\s*(true|false)\s*$/.exec(line)?.[1];
    const current = models.at(-1);
    if (soft !== undefined && current) current.softDelete = soft === "true";
  }
  return models;
}

export function contractOf(yaml: string): Contract {
  const endpoints = section(yaml, "endpoints").map(readEndpoint);
  if (endpoints.length === 0) throw new Error("feathers contract: the schema has no endpoints");
  return { endpoints, models: readModels(section(yaml, "models")) };
}
