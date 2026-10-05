import * as schema from "./schema";

export function getDb() {
  const g = globalThis as any;
  const db = g.DB || g.__env__?.DB;
  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable."
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/d1");
  return drizzle(db, { schema });
}
