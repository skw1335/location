import { SQL } from "bun";

/**
 * Postgres (ParadeDB in development — see compose.yaml). `DATABASE_URL`
 * overrides the local default; the tests point it at a throwaway database.
 */
export const sql = new SQL(
  process.env.DATABASE_URL ?? "postgres://location:location@localhost:5432/location",
);

/** Creates or updates the schema. Idempotent, so it runs on every start. */
export async function migrate(db: SQL = sql) {
  await db.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());
}

/** Deletes everything held for a user — lists, places, overrides, subcategories. */
export const forgetUser = (userKey: string) =>
  sql.begin(async (tx) => {
    await tx`DELETE FROM lists WHERE user_key = ${userKey}`;
    await tx`DELETE FROM place_overrides WHERE user_key = ${userKey}`;
    await tx`DELETE FROM subcategories WHERE user_key = ${userKey}`;
  });
