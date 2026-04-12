import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Lazy initialization — only connect when actually used
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_db) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    _sql = postgres(connectionString, { max: 10 });
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

export function getRawSql() {
  if (!_sql) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    _sql = postgres(connectionString, { max: 10 });
  }
  return _sql;
}
