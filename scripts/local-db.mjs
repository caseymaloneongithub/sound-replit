// The app's own local Postgres for development (owner, 2026-10-16: "Can you create a
// dev database locally?", the hosted dev endpoint having been disabled that day).
//
// Uses the PostgreSQL 18 binaries already installed on this machine, but its OWN
// cluster, so nothing here touches the installed service or needs its password:
//   data      %LOCALAPPDATA%\sound-devdb  (outside OneDrive: a synced data directory corrupts)
//   port      5433                        (the installed service keeps 5432)
//   auth      trust, localhost only       (no password; it is a dev database on a laptop)
//   role/db   sound / sound_dev
//
//   node scripts/local-db.mjs init                          create the cluster (once)
//   node scripts/local-db.mjs start | stop | status
//   node --env-file=.env scripts/local-db.mjs refresh       replace sound_dev with a copy of
//                                                           prod: schema + data, minus sessions
//
// The app reaches it through .env.local (DATABASE_URL=postgresql://sound@localhost:5433/sound_dev),
// loaded by `npm run staging:local` / the sound-staging-local launch config, and
// server/db-pool.ts picks node-postgres for a localhost URL.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG_BIN = process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const DATA_DIR = process.env.LOCAL_DB_DIR || join(process.env.LOCALAPPDATA || tmpdir(), "sound-devdb");
const PORT = process.env.LOCAL_DB_PORT || "5433";
const ROLE = "sound";
const DB = "sound_dev";
const URL = `postgresql://${ROLE}@localhost:${PORT}/${DB}`;
const LOG = join(DATA_DIR, "server.log");

const bin = (name) => join(PG_BIN, `${name}.exe`);
const run = (name, args, opts = {}) => execFileSync(bin(name), args, { stdio: "inherit", ...opts });
const psql = (args, db = "postgres") =>
  run("psql", ["-h", "localhost", "-p", PORT, "-U", ROLE, "-d", db, "-v", "ON_ERROR_STOP=1", ...args]);
const running = () => spawnSync(bin("pg_ctl"), ["status", "-D", DATA_DIR], { stdio: "ignore" }).status === 0;

// A staff login that exists only here: the snapshot carries real accounts with real
// password hashes. Same hashing as server/auth.ts (scrypt, "hash.salt"), so the
// normal staff login accepts it. Dev-only credentials, for this laptop's database.
const DEV_STAFF = { username: "dev", email: "dev@sound.local", password: "test1234", firstName: "Dev", lastName: "Local" };
async function seedStaffLogin() {
  const { scrypt, randomBytes } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const salt = randomBytes(16).toString("hex");
  const hash = (await promisify(scrypt)(DEV_STAFF.password, salt, 64)).toString("hex") + "." + salt;
  psql(["-c", `INSERT INTO users (username, email, password, first_name, last_name, role, is_admin)
    VALUES ('${DEV_STAFF.username}', '${DEV_STAFF.email}', '${hash}', '${DEV_STAFF.firstName}', '${DEV_STAFF.lastName}', 'super_admin', true)
    ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'super_admin', is_admin = true, deleted_at = NULL`], DB);
  console.log(`staff login seeded: ${DEV_STAFF.email} (password in scripts/local-db.mjs)`);
}

if (!existsSync(bin("pg_ctl"))) {
  console.error(`PostgreSQL binaries not found at ${PG_BIN} (set PG_BIN to the bin directory)`);
  process.exit(1);
}

const cmd = process.argv[2];
if (cmd === "init") {
  if (existsSync(join(DATA_DIR, "PG_VERSION"))) {
    console.log("cluster already exists at", DATA_DIR);
  } else {
    mkdirSync(DATA_DIR, { recursive: true });
    run("initdb", [
      "-D", DATA_DIR, "-U", ROLE, "--auth=trust", "--encoding=UTF8",
      "--locale=C", "--locale-provider=icu", "--icu-locale=en-US",
    ]);
    appendFileSync(join(DATA_DIR, "postgresql.conf"), `\n# sound dev database (scripts/local-db.mjs)\nport = ${PORT}\nlisten_addresses = 'localhost'\n`);
    console.log("cluster created at", DATA_DIR);
  }
} else if (cmd === "start") {
  if (running()) {
    console.log("already running:", URL);
  } else {
    // No shared stdio here: the postmaster pg_ctl launches would inherit our pipes
    // and hold them open for as long as it runs, so a shell waiting on this
    // command's output would wait forever. The server log has the details.
    const started = spawnSync(bin("pg_ctl"), ["start", "-D", DATA_DIR, "-l", LOG, "-w"], { stdio: "ignore", windowsHide: true });
    if (started.status !== 0 || !running()) {
      console.error(`pg_ctl start failed (exit ${started.status}); see ${LOG}`);
      process.exit(1);
    }
    console.log("running:", URL);
  }
} else if (cmd === "stop") {
  if (!running()) console.log("not running");
  else run("pg_ctl", ["stop", "-D", DATA_DIR, "-m", "fast", "-w"]);
} else if (cmd === "status") {
  console.log(running() ? `running: ${URL}` : "not running");
} else if (cmd === "refresh") {
  const prod = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD;
  if (!prod) { console.error("DATABASE_URL_PROD is not set (run with --env-file=.env)"); process.exit(1); }
  if (!running()) { console.error("the local database is not running: npm run db:local:start"); process.exit(1); }
  const dump = join(tmpdir(), `sound-prod-${Date.now()}.sql`);
  try {
    console.log("dumping prod (schema + data, without sessions)...");
    run("pg_dump", ["--dbname", prod, "--no-owner", "--no-privileges", "--exclude-table-data=sessions", "-f", dump]);
    console.log("recreating", DB, "...");
    psql(["-c", `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
    psql(["-c", `CREATE DATABASE ${DB}`]);
    psql(["-q", "-f", dump], DB);
    console.log("done:", URL, "now mirrors prod");
  } finally {
    rmSync(dump, { force: true }); // customer data: never leave the dump lying around
  }
  await seedStaffLogin();
} else if (cmd === "seed") {
  await seedStaffLogin();
} else {
  console.error("usage: node scripts/local-db.mjs init | start | stop | status | refresh");
  process.exit(1);
}
