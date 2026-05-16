import express from "express";
import { authenticate, authorize } from "../middleware/auth.js";
import { isAdminRole } from "../utils/roles.js";

const router = express.Router();

function getReservationSnapshotForSpot(db, spotId) {
  const snapshot = db.prepare(`
    SELECT
      reservations.id,
      reservations.start_time,
      reservations.end_time,
      reservations.status,
      users.name AS user_name,
      users.email AS user_email,
      users.role AS user_role,
      users.license_plates AS user_license_plates,
      users.phone_number AS user_phone_number
    FROM reservations
    JOIN users ON users.id = reservations.user_id
    WHERE reservations.spot_id = ?
      AND reservations.status IN ('pending', 'approved')
      AND (
        (datetime(reservations.start_time) <= datetime('now') AND datetime(reservations.end_time) > datetime('now'))
        OR (date(reservations.start_time) = date('now') AND datetime(reservations.start_time) > datetime('now'))
      )
    ORDER BY
      CASE
        WHEN datetime(reservations.start_time) <= datetime('now') AND datetime(reservations.end_time) > datetime('now') THEN 0
        ELSE 1
      END,
      datetime(reservations.start_time) ASC
    LIMIT 1
  `).get(spotId);

  if (!snapshot) return null;

  const now = Date.now();
  const start = new Date(snapshot.start_time).getTime();
  const end = new Date(snapshot.end_time).getTime();
  const reservationScope = start <= now && end > now ? "current" : "next";

  return {
    ...snapshot,
    reservation_scope: reservationScope
  };
}

router.get("/public-settings", (req, res) => {
  const settings = req.db.prepare(`
    SELECT student_max_active_reservations, student_max_hours, staff_max_hours, require_admin_approval, default_reservation_mode
    FROM app_settings WHERE id = 1
  `).get();
  res.json(settings);
});

router.get("/", authenticate, (req, res) => {
  const selectedDate = req.query.date ? String(req.query.date) : null;
  const lotType = req.query.lotType ? String(req.query.lotType) : "";
  const overlapStart = selectedDate ? `${selectedDate}T00:00:00.000Z` : null;
  const overlapEnd = selectedDate ? `${selectedDate}T23:59:59.999Z` : null;

  const spots = selectedDate
    ? req.db.prepare(`
        SELECT
          parking_spots.*,
          (
            SELECT status
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.start_time) < datetime(?)
              AND datetime(reservations.end_time) > datetime(?)
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reservation_status
          ,
          (
            SELECT users.name
            FROM reservations
            JOIN users ON users.id = reservations.user_id
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.start_time) < datetime(?)
              AND datetime(reservations.end_time) > datetime(?)
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reserved_by_name,
          (
            SELECT reservations.end_time
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.start_time) < datetime(?)
              AND datetime(reservations.end_time) > datetime(?)
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reserved_until,
          CASE
            WHEN parking_spots.is_available = 0 THEN 0
            WHEN EXISTS(
              SELECT 1
              FROM spot_daily_unavailability
              WHERE spot_daily_unavailability.spot_id = parking_spots.id
                AND spot_daily_unavailability.unavailable_date = ?
            ) THEN 0
            ELSE 1
          END AS effective_is_available,
          EXISTS(
            SELECT 1
            FROM spot_reports
            WHERE spot_reports.spot_id = parking_spots.id
              AND spot_reports.resolved_at IS NULL
              AND date(spot_reports.reported_at) = date(?)
          ) AS is_reported_occupied
          ,
          (
            SELECT spot_reports.id
            FROM spot_reports
            WHERE spot_reports.spot_id = parking_spots.id
              AND spot_reports.resolved_at IS NULL
              AND date(spot_reports.reported_at) = date(?)
            ORDER BY datetime(spot_reports.reported_at) DESC
            LIMIT 1
          ) AS open_report_id
        FROM parking_spots
        WHERE (? = '' OR parking_spots.lot_type = ?)
        ORDER BY
          CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END,
          code
      `).all(overlapEnd, overlapStart, overlapEnd, overlapStart, overlapEnd, overlapStart, selectedDate, selectedDate, selectedDate, lotType, lotType)
    : req.db.prepare(`
        SELECT
          parking_spots.*,
          (
            SELECT status
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.end_time) >= datetime('now')
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reservation_status
          ,
          (
            SELECT users.name
            FROM reservations
            JOIN users ON users.id = reservations.user_id
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.end_time) >= datetime('now')
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reserved_by_name,
          (
            SELECT reservations.end_time
            FROM reservations
            WHERE reservations.spot_id = parking_spots.id
              AND reservations.status IN ('pending', 'approved')
              AND datetime(reservations.end_time) >= datetime('now')
            ORDER BY reservations.start_time ASC
            LIMIT 1
          ) AS current_reserved_until,
          CASE
            WHEN parking_spots.is_available = 0 THEN 0
            WHEN EXISTS(
              SELECT 1
              FROM spot_daily_unavailability
              WHERE spot_daily_unavailability.spot_id = parking_spots.id
                AND spot_daily_unavailability.unavailable_date = date('now')
            ) THEN 0
            ELSE 1
          END AS effective_is_available,
          EXISTS(
            SELECT 1
            FROM spot_reports
            WHERE spot_reports.spot_id = parking_spots.id
              AND spot_reports.resolved_at IS NULL
              AND date(spot_reports.reported_at) = date('now')
          ) AS is_reported_occupied
          ,
          (
            SELECT spot_reports.id
            FROM spot_reports
            WHERE spot_reports.spot_id = parking_spots.id
              AND spot_reports.resolved_at IS NULL
              AND date(spot_reports.reported_at) = date('now')
            ORDER BY datetime(spot_reports.reported_at) DESC
            LIMIT 1
          ) AS open_report_id
        FROM parking_spots
        WHERE (? = '' OR parking_spots.lot_type = ?)
        ORDER BY
          CASE side WHEN 'left' THEN 1 WHEN 'right' THEN 2 ELSE 3 END,
          code
      `).all(lotType, lotType);

  if (isAdminRole(req.user.role)) {
    const withSnapshots = spots.map((spot) => ({
      ...spot,
      reservation_snapshot: getReservationSnapshotForSpot(req.db, spot.id)
    }));
    return res.json(withSnapshots);
  }

  res.json(spots);
});

router.post("/reports", authenticate, (req, res) => {
  const { spotId, licensePlate = "", description = "" } = req.body;
  const spot = req.db.prepare("SELECT id, code, lot_type FROM parking_spots WHERE id = ?").get(spotId);

  if (!spot) {
    return res.status(404).json({ message: "Parking spot not found." });
  }

  const result = req.db.prepare(`
    INSERT INTO spot_reports (spot_id, reported_by_user_id, lot_type, license_plate, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(spot.id, req.user.id, spot.lot_type, String(licensePlate).trim(), String(description).trim());

  const report = req.db.prepare(`
    SELECT
      spot_reports.*,
      parking_spots.code AS spot_code,
      users.name AS reported_by_name
    FROM spot_reports
    JOIN parking_spots ON parking_spots.id = spot_reports.spot_id
    LEFT JOIN users ON users.id = spot_reports.reported_by_user_id
    WHERE spot_reports.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(report);
});

router.get("/reports", authenticate, authorize("security"), (req, res) => {
  const lotType = String(req.query.lotType || "").trim();
  const reports = req.db.prepare(`
    SELECT
      spot_reports.*,
      parking_spots.code AS spot_code,
      users.name AS reported_by_name,
      CASE WHEN spot_reports.resolved_at IS NULL THEN 'open' ELSE 'resolved' END AS report_status
    FROM spot_reports
    JOIN parking_spots ON parking_spots.id = spot_reports.spot_id
    LEFT JOIN users ON users.id = spot_reports.reported_by_user_id
    WHERE (? = '' OR spot_reports.lot_type = ?)
    ORDER BY datetime(spot_reports.reported_at) DESC
  `).all(lotType, lotType);

  res.json(reports);
});

router.get("/:id/reservations", authenticate, authorize("security"), (req, res) => {
  const spotId = Number(req.params.id);
  const reservations = req.db.prepare(`
    SELECT
      reservations.id,
      reservations.start_time,
      reservations.end_time,
      reservations.status,
      users.name AS user_name,
      users.email AS user_email,
      users.role AS user_role
    FROM reservations
    JOIN users ON users.id = reservations.user_id
    WHERE reservations.spot_id = ?
      AND reservations.status IN ('pending', 'approved')
      AND datetime(reservations.end_time) >= datetime('now')
    ORDER BY datetime(reservations.start_time) ASC
  `).all(spotId);
  res.json(reservations);
});

router.patch("/:id/reports/resolve", authenticate, authorize("security"), (req, res) => {
  const spotId = Number(req.params.id);
  const reportDate = String(req.body?.date || "").trim();
  req.db.prepare(`
    UPDATE spot_reports
    SET resolved_at = CURRENT_TIMESTAMP
    WHERE spot_id = ?
      AND resolved_at IS NULL
      AND (? = '' OR date(reported_at) = date(?))
  `).run(spotId, reportDate, reportDate);
  res.json({ message: "Report resolved." });
});

router.patch("/:id/daily-availability", authenticate, authorize("security"), (req, res) => {
  const spotId = Number(req.params.id);
  const date = String(req.body?.date || "").trim();
  const isAvailable = Boolean(req.body?.isAvailable);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "A valid date is required." });
  }

  if (isAvailable) {
    req.db.prepare(`
      DELETE FROM spot_daily_unavailability
      WHERE spot_id = ? AND unavailable_date = ?
    `).run(spotId, date);
  } else {
    req.db.prepare(`
      INSERT INTO spot_daily_unavailability (spot_id, unavailable_date, created_by_user_id)
      VALUES (?, ?, ?)
      ON CONFLICT(spot_id, unavailable_date) DO NOTHING
    `).run(spotId, date, req.user.id);
  }

  res.json({ spotId, date, isAvailable });
});

router.post("/", authenticate, authorize("security"), (req, res) => {
  const { code, side, type = "standard", lotType = "general", isAvailable = true, notes = "" } = req.body;
  const result = req.db.prepare(`
    INSERT INTO parking_spots (code, side, type, lot_type, is_available, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(code, side, type, lotType, isAvailable ? 1 : 0, notes);
  const spot = req.db.prepare("SELECT * FROM parking_spots WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(spot);
});

router.delete("/:id", authenticate, authorize("security"), (req, res) => {
  req.db.prepare("DELETE FROM parking_spots WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

router.patch("/:id", authenticate, authorize("security"), (req, res) => {
  const { isAvailable, notes, type, lotType } = req.body;
  req.db.prepare(`
    UPDATE parking_spots
    SET is_available = COALESCE(?, is_available),
        notes = COALESCE(?, notes),
        type = COALESCE(?, type),
        lot_type = COALESCE(?, lot_type)
    WHERE id = ?
  `).run(
    isAvailable === undefined ? null : Number(Boolean(isAvailable)),
    notes ?? null,
    type ?? null,
    lotType ?? null,
    req.params.id
  );

  const spot = req.db.prepare("SELECT * FROM parking_spots WHERE id = ?").get(req.params.id);
  res.json(spot);
});

export default router;
