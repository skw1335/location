import { afterAll } from "bun:test";
import { SQL } from "bun";

/**
 * Bun runs every test file in one process, so they all share this one
 * database. It's created fresh per run and dropped at the end, so tests never
 * touch development data. Must run before anything imports db.ts.
 */
const server = process.env.TEST_DATABASE_SERVER ?? "postgres://location:location@localhost:5432";
const name = `location_test_${crypto.randomUUID().replaceAll("-", "")}`;

const admin = new SQL(`${server}/postgres`);
await admin.unsafe(`CREATE DATABASE ${name}`);
process.env.DATABASE_URL = `${server}/${name}`;

const { migrate, sql } = await import("./db");
await migrate();

afterAll(async () => {
  await sql.close();
  await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.close();
});
