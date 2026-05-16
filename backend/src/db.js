import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { defaultRoleRules } from "./utils/roles.js";

function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

function migrateUsersRoleConstraint(db) {
  const usersTableSql = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'users'
  `).get()?.sql || "";

  if (!usersTableSql.includes("CHECK(role IN")) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN TRANSACTION");
  try {
    db.exec("ALTER TABLE users RENAME TO users_legacy");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        license_plates TEXT NOT NULL DEFAULT '',
        phone_number TEXT NOT NULL DEFAULT '',
        profile_note TEXT NOT NULL DEFAULT '',
        is_verified INTEGER NOT NULL DEFAULT 1,
        verification_token_hash TEXT DEFAULT NULL,
        verification_expires_at TEXT DEFAULT NULL,
        password_reset_token_hash TEXT DEFAULT NULL,
        password_reset_expires_at TEXT DEFAULT NULL,
        verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
        approval_mode_override TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users (
        id, name, email, password_hash, role, license_plates, phone_number, profile_note,
        is_verified, verification_token_hash, verification_expires_at,
        password_reset_token_hash, password_reset_expires_at,
        verified_at, approval_mode_override, status, created_at
      )
      SELECT
        id, name, email, password_hash, role, COALESCE(license_plates, ''), COALESCE(phone_number, ''), COALESCE(profile_note, ''),
        is_verified, verification_token_hash, verification_expires_at,
        password_reset_token_hash, password_reset_expires_at,
        verified_at, approval_mode_override, status, created_at
      FROM users_legacy
    `);
    db.exec("DROP TABLE users_legacy");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function repairBrokenLegacyForeignKeys(db) {
  const brokenForeignKeys = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND sql LIKE '%users_legacy%'
  `).all();

  if (!brokenForeignKeys.length) {
    return;
  }

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN TRANSACTION");
  try {
    db.exec("DROP TABLE IF EXISTS reservations");
    db.exec("DROP TABLE IF EXISTS recurring_reservations");
    db.exec("DROP TABLE IF EXISTS audit_logs");
    db.exec("DROP TABLE IF EXISTS spot_reports");

    db.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        spot_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
        recurring_group_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_by INTEGER,
        approval_note TEXT DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS recurring_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        spot_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        semester_start TEXT NOT NULL,
        semester_end TEXT NOT NULL,
        recurrence_type TEXT NOT NULL DEFAULT 'weekly',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS spot_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spot_id INTEGER NOT NULL,
        reported_by_user_id INTEGER,
        lot_type TEXT NOT NULL,
        license_plate TEXT DEFAULT '',
        description TEXT DEFAULT '',
        reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
        FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    db.exec("DROP TABLE IF EXISTS users_legacy");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function ensureSpot(db, spot) {
  const existing = db.prepare("SELECT id FROM parking_spots WHERE code = ?").get(spot.code);
  if (existing) {
    db.prepare(`
      UPDATE parking_spots
      SET side = ?,
          type = ?,
          lot_type = ?,
          is_available = COALESCE(is_available, ?),
          notes = COALESCE(notes, ?)
      WHERE code = ?
    `).run(spot.side, spot.type, spot.lotType, spot.isAvailable, spot.notes, spot.code);
    return;
  }

  db.prepare(`
    INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(spot.code, spot.side, spot.type, spot.lotType, spot.isAvailable, spot.notes);
}

function reconcileParkingLayout(db) {
  const spotCount = db.prepare("SELECT COUNT(*) AS count FROM parking_spots").get().count;
  if (!spotCount) {
    return;
  }

  db.prepare("DELETE FROM parking_spots WHERE code IN ('E-01', 'E-02')").run();

  for (let index = 1; index <= 20; index += 1) {
    ensureSpot(db, {
      code: `L-${String(index).padStart(2, "0")}`,
      side: "left",
      type: "standard",
      lotType: "general",
      isAvailable: 1,
      notes: ""
    });
  }

  for (let index = 1; index <= 20; index += 1) {
    ensureSpot(db, {
      code: `R-${String(index).padStart(2, "0")}`,
      side: "right",
      type: "standard",
      lotType: "staff",
      isAvailable: 1,
      notes: ""
    });
  }
}

function ensureRoleSchedulingRules(db) {
  const knownRoles = db.prepare(`
    SELECT DISTINCT role AS role_name
    FROM users
    WHERE role IS NOT NULL AND trim(role) <> ''
  `).all().map((row) => row.role_name);

  ["student role 1", "student role 2", "student role 3", "staff", "professor", "security"].forEach((roleName) => {
    if (!knownRoles.includes(roleName)) {
      knownRoles.push(roleName);
    }
  });

  const upsertRule = db.prepare(`
    INSERT INTO role_scheduling_rules (
      role_name,
      max_days_ahead,
      max_daily_active_reservations,
      max_reservation_hours,
      approval_mode,
      role_description,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(role_name) DO UPDATE SET
      max_days_ahead = COALESCE(role_scheduling_rules.max_days_ahead, excluded.max_days_ahead),
      max_daily_active_reservations = COALESCE(
        role_scheduling_rules.max_daily_active_reservations,
        excluded.max_daily_active_reservations
      ),
      max_reservation_hours = COALESCE(
        role_scheduling_rules.max_reservation_hours,
        excluded.max_reservation_hours
      ),
      approval_mode = CASE
        WHEN role_scheduling_rules.approval_mode IS NULL OR role_scheduling_rules.approval_mode = ''
        THEN excluded.approval_mode
        ELSE role_scheduling_rules.approval_mode
      END,
      role_description = CASE
        WHEN role_scheduling_rules.role_description IS NULL OR role_scheduling_rules.role_description = ''
        THEN excluded.role_description
        ELSE role_scheduling_rules.role_description
      END
  `);

  knownRoles.forEach((roleName) => {
    const defaults = defaultRoleRules(roleName);
    upsertRule.run(
      roleName,
      defaults.maxDaysAhead,
      defaults.maxDailyActiveReservations,
      defaults.maxReservationHours,
      defaults.approvalMode,
      defaults.roleDescription
    );
  });
}

export function createDatabase(dbPath = config.dbPath) {
  if (dbPath !== ":memory:") {
    const absolutePath = path.resolve(process.cwd(), dbPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = TRUNCATE");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      license_plates TEXT NOT NULL DEFAULT '',
      phone_number TEXT NOT NULL DEFAULT '',
      profile_note TEXT NOT NULL DEFAULT '',
      is_verified INTEGER NOT NULL DEFAULT 1,
      verification_token_hash TEXT DEFAULT NULL,
      verification_expires_at TEXT DEFAULT NULL,
      password_reset_token_hash TEXT DEFAULT NULL,
      password_reset_expires_at TEXT DEFAULT NULL,
      verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
      approval_mode_override TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parking_spots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'standard',
      lot_type TEXT NOT NULL DEFAULT 'general',
      is_available INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spot_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
      recurring_group_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by INTEGER,
      approval_note TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spot_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      semester_start TEXT NOT NULL,
      semester_end TEXT NOT NULL,
      recurrence_type TEXT NOT NULL DEFAULT 'weekly',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      student_max_active_reservations INTEGER NOT NULL DEFAULT 5,
      student_max_hours INTEGER NOT NULL DEFAULT 6,
      staff_max_hours INTEGER NOT NULL DEFAULT 12,
      default_reservation_mode TEXT NOT NULL DEFAULT 'approved',
      require_admin_approval INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS spot_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id INTEGER NOT NULL,
      reported_by_user_id INTEGER,
      lot_type TEXT NOT NULL,
      license_plate TEXT DEFAULT '',
      description TEXT DEFAULT '',
      reported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT DEFAULT NULL,
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS spot_daily_unavailability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id INTEGER NOT NULL,
      unavailable_date TEXT NOT NULL,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(spot_id, unavailable_date),
      FOREIGN KEY (spot_id) REFERENCES parking_spots(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS role_scheduling_rules (
      role_name TEXT PRIMARY KEY,
      max_days_ahead INTEGER NOT NULL DEFAULT 10,
      max_daily_active_reservations INTEGER DEFAULT NULL,
      max_reservation_hours INTEGER DEFAULT NULL,
      approval_mode TEXT NOT NULL DEFAULT 'approved',
      role_description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  migrateUsersRoleConstraint(db);
  repairBrokenLegacyForeignKeys(db);

  ensureColumn(db, "users", "license_plates", "license_plates TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "phone_number", "phone_number TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "profile_note", "profile_note TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "users", "is_verified", "is_verified INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "users", "verification_token_hash", "verification_token_hash TEXT DEFAULT NULL");
  ensureColumn(db, "users", "verification_expires_at", "verification_expires_at TEXT DEFAULT NULL");
  ensureColumn(db, "users", "password_reset_token_hash", "password_reset_token_hash TEXT DEFAULT NULL");
  ensureColumn(db, "users", "password_reset_expires_at", "password_reset_expires_at TEXT DEFAULT NULL");
  ensureColumn(db, "users", "verified_at", "verified_at TEXT DEFAULT NULL");
  ensureColumn(db, "users", "approval_mode_override", "approval_mode_override TEXT DEFAULT NULL");
  ensureColumn(db, "parking_spots", "lot_type", "lot_type TEXT NOT NULL DEFAULT 'general'");
  ensureColumn(db, "app_settings", "default_reservation_mode", "default_reservation_mode TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn(db, "role_scheduling_rules", "max_daily_active_reservations", "max_daily_active_reservations INTEGER DEFAULT NULL");
  ensureColumn(db, "role_scheduling_rules", "max_reservation_hours", "max_reservation_hours INTEGER DEFAULT NULL");
  ensureColumn(db, "role_scheduling_rules", "approval_mode", "approval_mode TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn(db, "spot_reports", "resolved_at", "resolved_at TEXT DEFAULT NULL");

  db.prepare(`
    UPDATE users
    SET role = 'student role 1'
    WHERE lower(trim(role)) = 'student'
  `).run();

  db.prepare(`
    DELETE FROM role_scheduling_rules
    WHERE lower(trim(role_name)) = 'student'
  `).run();

  db.prepare(`
    UPDATE users
    SET is_verified = 1,
        verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
  `).run();

  db.prepare(`
    UPDATE users
    SET verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
    WHERE is_verified = 1
  `).run();

  db.prepare(`
    INSERT INTO app_settings (id, student_max_active_reservations, student_max_hours, staff_max_hours, default_reservation_mode, require_admin_approval)
    VALUES (1, 5, 6, 12, 'approved', 0)
    ON CONFLICT(id) DO NOTHING
  `).run();

  db.prepare(`
    UPDATE app_settings
    SET default_reservation_mode = 'approved',
        require_admin_approval = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
      AND default_reservation_mode = 'pending'
      AND require_admin_approval = 1
  `).run();

  db.prepare(`
    UPDATE app_settings
    SET default_reservation_mode = CASE
      WHEN default_reservation_mode IS NULL OR default_reservation_mode = ''
      THEN CASE WHEN require_admin_approval = 1 THEN 'pending' ELSE 'approved' END
      ELSE default_reservation_mode
    END
    WHERE id = 1
  `).run();

  db.prepare(`
    UPDATE parking_spots
    SET lot_type = CASE
      WHEN side = 'right' THEN 'staff'
      ELSE 'general'
    END
    WHERE code LIKE 'L-%' OR code LIKE 'R-%' OR code LIKE 'E-%'
  `).run();

  reconcileParkingLayout(db);
  ensureRoleSchedulingRules(db);

  return db;
}
