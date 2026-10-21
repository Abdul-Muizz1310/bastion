import type { Capability } from "@/platform/gateway/call";
import { feathers } from "./feathers";
import { inkprint } from "./inkprint";
import { inkthread } from "./inkthread";
import { magpie } from "./magpie";
import { paperTrail } from "./paper-trail";
import { slowquery } from "./slowquery";

/**
 * Every capability bastion has, by id (spec 21 §4) — the table the tools route and the platform
 * page read. Callers that know which capability they want import it typed from its module
 * (`paperTrail.debate`); only lookups by an id string come through here.
 */

// The registry seam, and the one `any` the plan allows: each capability has its own input and
// output types, and a lookup by a runtime id string cannot know which. `callCapability` parses the
// input and the response with the capability's own schemas, so nothing untyped crosses it.
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry keyed by a runtime id
export type AnyCapability = Capability<any, any>;

export const CAPABILITY_LIST: readonly AnyCapability[] = Object.freeze([
  ...Object.values(magpie),
  ...Object.values(inkprint),
  ...Object.values(paperTrail),
  ...Object.values(inkthread),
  ...Object.values(slowquery),
  ...Object.values(feathers),
]);

/** The capabilities keyed by id; a repeated id is a programming error, refused at load. */
export function indexById(list: readonly AnyCapability[]): Readonly<Record<string, AnyCapability>> {
  const table: Record<string, AnyCapability> = Object.create(null);
  for (const cap of list) {
    if (Object.hasOwn(table, cap.id)) throw new Error(`duplicate capability id ${cap.id}`);
    table[cap.id] = cap;
  }
  return Object.freeze(table);
}

export const CAPABILITIES: Readonly<Record<string, AnyCapability>> = indexById(CAPABILITY_LIST);

/** The capability with this id, or undefined — never a prototype property. */
export function capabilityById(id: string): AnyCapability | undefined {
  return Object.hasOwn(CAPABILITIES, id) ? CAPABILITIES[id] : undefined;
}
