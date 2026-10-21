import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import { integer, isoDateTime, nonBlank, seg, uuid, withQuery } from "./shared";

/**
 * feathers (spec 21 §5): live CRUD on feathers-demo, the service feathers-cli generated from
 * `feathers.yaml`. Schemas mirror feathers_demo's contract-v2 `schemas/user.py` (`UserResponse`,
 * `UserCreate`); field limits come from `feathers.yaml` (email 255, full_name 100).
 *
 * Grants follow `feathers.yaml`, which declares `POST /users` and `DELETE /users/{id}` as
 * `auth: admin` — an editor token would be refused 403 `insufficient_role`.
 *
 * Ruling I: feathers-demo answers 401/403/422 before the handler and 404 before any write, so a 4xx
 * releases the `feathers.write` budget.
 */

const role = z.enum(["admin", "editor", "viewer"]);

const user = z.object({
  id: uuid,
  email: z.string(),
  full_name: z.string(),
  role,
  created_at: isoDateTime,
  updated_at: isoDateTime,
  deleted_at: isoDateTime.nullable(),
});

export type FeathersUser = z.infer<typeof user>;

const usersInput = z.strictObject({ limit: integer(1, 100).optional(), cursor: uuid.optional() });
const byId = z.strictObject({ id: uuid });
const createInput = z.strictObject({
  email: z.email().max(255),
  full_name: nonBlank.pipe(z.string().max(100)),
  role: role.optional(),
});

const users: Capability<z.infer<typeof usersInput>, FeathersUser[]> = {
  id: "feathers.users",
  service: "feathers-demo",
  method: "GET",
  path: (i) => withQuery("/users", { limit: i.limit, cursor: i.cursor }),
  input: usersInput,
  output: z.array(user),
  grant: "viewer",
  cost: "free",
};

const userGet: Capability<z.infer<typeof byId>, FeathersUser> = {
  id: "feathers.user",
  service: "feathers-demo",
  method: "GET",
  path: (i) => `/users/${seg(i.id)}`,
  input: byId,
  output: user,
  grant: "viewer",
  cost: "free",
};

const createUser: Capability<z.infer<typeof createInput>, FeathersUser> = {
  id: "feathers.createUser",
  service: "feathers-demo",
  method: "POST",
  path: () => "/users",
  body: (i) => i,
  input: createInput,
  output: user,
  grant: "admin",
  cost: "quota",
  budget: "feathers.write",
};

const deleteUser: Capability<z.infer<typeof byId>, null> = {
  id: "feathers.deleteUser",
  service: "feathers-demo",
  method: "DELETE",
  path: (i) => `/users/${seg(i.id)}`,
  input: byId,
  // 204 No Content: the gateway parses an empty body as null.
  output: z.null(),
  grant: "admin",
  cost: "quota",
  budget: "feathers.write",
};

export const feathers = { users, user: userGet, createUser, deleteUser } as const;
