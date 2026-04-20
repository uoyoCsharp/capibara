/**
 * SQLite repository tests require the native better-sqlite3 module.
 * On this system, better-sqlite3 is compiled for Electron's ABI (145)
 * while test runner uses system Node.js ABI (127).
 *
 * Repository integration tests should be run with:
 *   npx electron --require tests/setup.ts -e "" (via electron runner)
 *
 * For unit tests, we mock at the repository interface level instead.
 */
export const SQLITE_SKIP_REASON = 'better-sqlite3 compiled for Electron ABI — run via electron test runner';
