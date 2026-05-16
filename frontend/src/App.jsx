import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function isAdminRole(role) {
  const normalized = normalizeRole(role);
  return normalized.includes("security") || normalized.includes("admin");
}

function isStaffLikeRole(role) {
  const normalized = normalizeRole(role);
  return normalized.includes("staff") || normalized.includes("professor");
}

function isStudentRole(role) {
  return normalizeRole(role).includes("student");
}

const ROLE_LABELS = {
  "student role 1": "Regular Student",
  "student role 2": "Priority Student",
  "student role 3": "Limited Access Student",
  staff: "Staff Member",
  professor: "Professor",
  security: "Security/Admin"
};

const ROLE_DESCRIPTIONS = {
  "student role 1": "Standard student parking access with normal limits.",
  "student role 2": "Student with extended parking access approved by security/admin.",
  "student role 3": "Student with stricter limits because of policy, availability, or behavior.",
  staff: "Staff parking access with broader scheduling rights.",
  professor: "Professor parking access with broader scheduling rights.",
  security: "Manages users, parking spots, reports, rules, and approvals."
};

function getRoleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || String(role || "Unknown role");
}

function getRoleDescription(role, descriptionFromRule = "") {
  const normalized = normalizeRole(role);
  return String(descriptionFromRule || "").trim() || ROLE_DESCRIPTIONS[normalized] || "";
}

function getTabsForRole(role) {
  if (isAdminRole(role)) {
    return ["map", "admin", "reservations", "profile"];
  }
  return ["map", "reservations", "profile"];
}

const labels = {
  map: "Reserve",
  reservations: "My Bookings",
  profile: "Profile",
  admin: "Admin"
};

function getTabLabel(role, tab) {
  if (tab === "map") {
    return isAdminRole(role) ? "Map" : "Reserve";
  }

  return labels[tab];
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function spotVisualStatus(spot) {
  const isAvailable = spot.effective_is_available ?? spot.is_available;
  if (!isAvailable) return "unavailable";
  if (spot.is_reported_occupied) return "reported";
  if (spot.current_reservation_status === "pending") return "pending";
  if (spot.current_reservation_status === "approved") return "reserved";
  return "available";
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function getNextTenDays() {
  return Array.from({ length: 10 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);

    return {
      value: formatDateValue(date),
      shortLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      dayLabel: date.toLocaleDateString([], { weekday: "short" })
    };
  });
}

function getDayOfWeek(dateValue) {
  return new Date(`${dateValue}T12:00:00`).getDay();
}

function getMonday(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function getWeekdays(weekStart) {
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return {
      value: formatDateValue(date),
      shortLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      dayLabel: date.toLocaleDateString([], { weekday: "short" })
    };
  });
}

function formatReservationMode(value) {
  if (value === "approved") return "Auto-approved";
  if (value === "pending") return "Pending approval";
  return "Use default";
}

function formatLotLabel(value) {
  return value === "staff" ? "Staff Parking Lot" : "General Parking Lot";
}

function getHourSlotOptions() {
  return Array.from({ length: 13 }, (_, index) => {
    const hour = 8 + index;
    return {
      label: String(hour),
      value: `${String(hour).padStart(2, "0")}:00`
    };
  });
}

function getStudentSlotOptions() {
  const options = [];
  for (let minutes = 7 * 60 + 30; minutes <= 20 * 60; minutes += 30) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mins = String(minutes % 60).padStart(2, "0");
    options.push({
      label: `${hours}:${mins}`,
      value: `${hours}:${mins}`,
      minutes
    });
  }
  return options;
}

function getStoredSession() {
  const raw = localStorage.getItem("auk-user");
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, user) {
  localStorage.setItem("auk-token", token);
  localStorage.setItem("auk-user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("auk-token");
  localStorage.removeItem("auk-user");
}

function clearQueryParam(key) {
  const url = new URL(window.location.href);
  url.searchParams.delete(key);
  window.history.replaceState({}, "", url.toString());
}

function SplashScreen({ onContinue }) {
  return (
    <div className="screen splash-screen">
      <div className="badge">AUK Faculty Parking</div>
      <h1>AUK Smart Parking System</h1>
      <p>Reserve faculty parking in seconds with a mobile-first experience.</p>
      <button className="primary-button" onClick={onContinue}>Enter App</button>
    </div>
  );
}

function AuthScreen({ mode, resetToken, onModeChange, onAuthenticated, notice, onForgotPassword }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInfoMessage("");

    try {
      if (mode === "register") {
        const payload = await api.register(form);
        onAuthenticated(null, {
          type: "success",
          message: payload.message,
          email: form.email
        });
        onModeChange("login");
        setForm({ name: "", email: form.email, password: "", confirmPassword: "" });
        return;
      }

      if (mode === "forgot") {
        const payload = await onForgotPassword(form.email);
        setInfoMessage(payload.message);
        return;
      }

      if (mode === "reset") {
        if (form.password !== form.confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const payload = await api.resetPassword({ token: resetToken, password: form.password });
        clearQueryParam("reset");
        saveSession(payload.token, payload.user);
        onAuthenticated(payload.user, { type: "success", message: payload.message });
        return;
      }

      const payload = await api.login({ email: form.email, password: form.password });
      saveSession(payload.token, payload.user);
      onAuthenticated(payload.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen auth-screen">
      <div className="hero-card">
        <span className="eyebrow">Faculty Reservation Portal</span>
        <h2>
          {mode === "register"
            ? "Create student account"
            : mode === "forgot"
              ? "Forgot password"
              : mode === "reset"
                ? "Reset password"
                : "Sign in"}
        </h2>
        <p>
          {mode === "register"
            ? "Students can self-register with an @auk.org email."
            : mode === "forgot"
              ? "Enter your email and we will send you a reset link."
              : mode === "reset"
                ? "Choose a new password for your account."
                : "Use your AUK account to continue."}
        </p>
      </div>

      <form className="panel form-panel" onSubmit={handleSubmit}>
        {mode === "register" ? (
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
        ) : null}

        {mode !== "reset" ? (
          <label>
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
        ) : null}

        {mode !== "forgot" ? (
          <label>
            Password
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
        ) : null}

        {mode === "reset" ? (
          <label>
            Confirm password
            <input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
          </label>
        ) : null}

        {error ? <div className="inline-message error">{error}</div> : null}
        {notice ? <div className={`inline-message ${notice.type}`}>{notice.message}</div> : null}
        {infoMessage ? <div className="inline-message success">{infoMessage}</div> : null}

        <button className="primary-button" type="submit" disabled={loading}>
          {loading
            ? "Please wait..."
            : mode === "register"
              ? "Register"
              : mode === "forgot"
                ? "Send reset link"
                : mode === "reset"
                  ? "Update password"
                  : "Login"}
        </button>
      </form>

      <div className="panel note-panel">
        {mode === "login" ? <p>Need a student account or password help?</p> : null}
        {mode === "register" ? <p>Staff and security accounts are created by Security/Admin.</p> : null}
        {mode === "forgot" ? <p>Remembered your password?</p> : null}
        {mode === "reset" ? <p>Need to go back?</p> : null}

        {mode === "login" ? (
          <>
            <button className="ghost-button" onClick={() => onModeChange("register")}>
              Register as student
            </button>
            <button className="ghost-button" onClick={() => onModeChange("forgot")}>
              I forgot my password
            </button>
          </>
        ) : null}

        {mode === "register" ? (
          <button className="ghost-button" onClick={() => onModeChange("login")}>
            Back to login
          </button>
        ) : null}

        {mode === "forgot" || mode === "reset" ? (
          <button className="ghost-button" onClick={() => onModeChange("login")}>
            Back to login
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PhoneShell({ children, title, footer }) {
  return (
    <div className="app-shell">
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="app-screen">
          {title ? (
            <header className="topbar">
              <div>
                <span className="eyebrow">AUK Smart Parking</span>
                <h1>{title}</h1>
              </div>
            </header>
          ) : null}
          <main className="content">{children}</main>
          {footer ? <div className="app-footer">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ value }) {
  return <span className={`status-pill status-${value}`}>{value}</span>;
}

function HomeScreen({ user, stats, settings, onQuickTab }) {
  const cards = isAdminRole(user.role)
    ? [
        { label: "Pending approvals", value: stats.pendingReservations ?? 0 },
        { label: "Available spots", value: (stats.totalSpots ?? 0) - (stats.unavailableSpots ?? 0) },
        { label: "Active users", value: stats.users ?? 0 }
      ]
    : [
        { label: "Active booking cap", value: settings.student_max_active_reservations ?? 5 },
        { label: "Today status", value: isStaffLikeRole(user.role) ? "Faculty access" : "Student access" },
        { label: "Booking mode", value: isStaffLikeRole(user.role) ? "Recurring enabled" : "Single slots" }
      ];

  return (
    <div className="screen">
      <div className="hero-card compact">
        <span className="eyebrow">Welcome back</span>
        <h2>{user.name}</h2>
        <p>{isAdminRole(user.role) ? "Manage approvals, spots, and user settings." : "Reserve a spot and manage your parking schedule."}</p>
      </div>

      <div className="card-grid">
        {cards.map((card) => (
          <div className="panel stat-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="panel action-panel">
        <h3>Quick actions</h3>
        <div className="action-stack">
          <button className="secondary-button" onClick={() => onQuickTab("map")}>Open parking map</button>
          <button className="secondary-button" onClick={() => onQuickTab("reservations")}>View reservations</button>
          {isAdminRole(user.role) ? <button className="secondary-button" onClick={() => onQuickTab("admin")}>Review admin tools</button> : null}
        </div>
      </div>
    </div>
  );
}

function ParkingMap({ spots, selectedSpotId, onSelect }) {
  const left = spots.filter((spot) => spot.side === "left" || String(spot.code || "").startsWith("L-"));
  const right = spots.filter((spot) => spot.side === "right" || String(spot.code || "").startsWith("R-"));
  const extras = spots.filter((spot) => spot.side === "entrance" || String(spot.code || "").startsWith("E-"));
  const showFallback = !left.length && !right.length && spots.length > 0;

  return (
    <div className="map-shell">
      <div className="map-side">
        {left.map((spot) => (
          <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
            <span>{spot.code}</span>
            <small>{spotVisualStatus(spot)}</small>
          </button>
        ))}
      </div>

      <div className="drive-lane">
        <span>Entrance</span>
        <div className="lane-line" />
        <div className="extra-row">
          {extras.map((spot) => (
            <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} compact ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
              <span>{spot.code}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="map-side">
        {right.map((spot) => (
          <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
            <span>{spot.code}</span>
            <small>{spotVisualStatus(spot)}</small>
          </button>
        ))}
      </div>

      {showFallback ? (
        <div className="fallback-spot-grid">
          {spots.map((spot) => (
            <button key={spot.id} className={`spot-card spot-${spotVisualStatus(spot)} ${selectedSpotId === spot.id ? "selected" : ""}`} onClick={() => onSelect(spot)}>
              <span>{spot.code}</span>
              <small>{spotVisualStatus(spot)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WeekStrip({ dates, selectedDate, onSelect, onPreviousWeek, onNextWeek, canGoPrevious, todayValue }) {
  return (
    <div className="week-strip">
      <button className={`week-arrow ${!canGoPrevious ? "disabled" : ""}`} onClick={onPreviousWeek} disabled={!canGoPrevious}>
        {"<"}
      </button>
      <div className="date-strip" role="tablist" aria-label="Choose reservation date">
        {dates.map((date) => {
          const isPast = date.value < todayValue;
          return (
            <button
              key={date.value}
              className={`date-chip ${selectedDate === date.value ? "active" : ""} ${isPast ? "disabled" : ""}`}
              onClick={() => onSelect(date.value)}
              disabled={isPast}
            >
              <span>{date.dayLabel}</span>
              <strong>{date.shortLabel}</strong>
            </button>
          );
        })}
      </div>
      <button className="week-arrow" onClick={onNextWeek}>
        {">"}
      </button>
    </div>
  );
}

function SpotModal({
  user,
  spot,
  selectedDate,
  onClose,
  onToggleAvailability,
  onReportOccupied,
  onLoadReservations,
  onResolveReport,
  spotReservations,
  reservationsLoading,
  detailsLoading,
  message,
  error
}) {
  if (!spot) return null;

  const status = spotVisualStatus(spot);
  const isCurrentlyUnavailable = status === "unavailable";
  const [reportForm, setReportForm] = useState({ licensePlate: "", description: "" });
  const [adminAction, setAdminAction] = useState("menu");

  useEffect(() => {
    setAdminAction("menu");
    setReportForm({ licensePlate: "", description: "" });
  }, [spot?.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <h3>{spot.code}</h3>
            <p>{formatLongDate(selectedDate)} | {spot.side} side | {spot.type}</p>
          </div>
          <button className="icon-button" onClick={onClose}>Close</button>
        </div>

        <StatusPill value={status} />
        {detailsLoading ? <div className="inline-message warning">Loading reservation details...</div> : null}
        {isAdminRole(user.role) && !detailsLoading ? (
          <>
            {adminAction === "menu" ? (
              <div className="action-row align-start">
                <button className="secondary-button" type="button" onClick={() => setAdminAction("report")}>Report Spot</button>
                <button className="secondary-button" type="button" onClick={() => {
                  setAdminAction("reservations");
                  onLoadReservations?.(spot.id);
                }}>View Reservations</button>
                <button className="secondary-button" type="button" onClick={onToggleAvailability}>
                  {isCurrentlyUnavailable ? "Make Available" : "Make Unavailable"}
                </button>
              </div>
            ) : null}

            {adminAction === "report" ? (
              <form className="stack-form" onSubmit={async (event) => {
                event.preventDefault();
                await onReportOccupied({
                  spotId: spot.id,
                  licensePlate: reportForm.licensePlate,
                  description: reportForm.description
                });
                setReportForm({ licensePlate: "", description: "" });
                setAdminAction("menu");
              }}>
                <h4>Report Spot</h4>
                <p><strong>Parking lot:</strong> {formatLotLabel(spot.lot_type)}</p>
                <p><strong>Parking spot:</strong> {spot.code}</p>
                <label>
                  License plate
                  <input
                    value={reportForm.licensePlate}
                    onChange={(event) => setReportForm((current) => ({ ...current, licensePlate: event.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Description
                  <input
                    value={reportForm.description}
                    onChange={(event) => setReportForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Optional"
                  />
                </label>
                <div className="action-row align-start">
                  <button className="secondary-button" type="submit">Save report</button>
                  <button className="ghost-button" type="button" onClick={() => setAdminAction("menu")}>Back</button>
                </div>
              </form>
            ) : null}

            {adminAction === "reservations" ? (
              <div className="stack-form">
                <h4>Reservations for {spot.code}</h4>
                {reservationsLoading ? <p>Loading reservations...</p> : null}
                {!reservationsLoading && spotReservations.length ? (
                  <div className="compact-bookings-list">
                    {spotReservations.map((reservation) => (
                      <div className="compact-booking-row" key={reservation.id}>
                        <span>#{reservation.id}</span>
                        <span>{reservation.user_name}</span>
                        <span>{reservation.user_email}</span>
                        <span>{getRoleLabel(reservation.user_role)}</span>
                        <span>{formatDateTime(reservation.start_time)}</span>
                        <span>{formatDateTime(reservation.end_time)}</span>
                        <span>{reservation.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!reservationsLoading && !spotReservations.length ? <p>No current or upcoming reservations.</p> : null}
                <div className="action-row align-start">
                  <button className="ghost-button" type="button" onClick={() => setAdminAction("menu")}>Back</button>
                </div>
              </div>
            ) : null}

            {spot.is_reported_occupied ? (
              <button className="mini-button danger" type="button" onClick={onResolveReport}>
                Resolve Report
              </button>
            ) : null}
          </>
        ) : null}
        {!isAdminRole(user.role) && spot.current_reserved_by_name ? (
          <p><strong>Reserved by:</strong> {spot.current_reserved_by_name}</p>
        ) : null}
        {!isAdminRole(user.role) && spot.current_reserved_until ? (
          <p><strong>Reserved until:</strong> {formatDateTime(spot.current_reserved_until)}</p>
        ) : null}
        {spot.is_reported_occupied ? (
          <div className="inline-message warning">This spot was reported occupied.</div>
        ) : null}

        {error ? <div className="inline-message error">{error}</div> : null}
        {message ? <div className="inline-message success">{message}</div> : null}
      </div>
    </div>
  );
}

function SecurityMapScreen({ user, spots, onUpdateSpot, onReportSpot }) {
  const todayValue = useMemo(() => formatDateValue(new Date()), []);
  const currentWeekStart = useMemo(() => getMonday(new Date()), []);
  const initialWeekStart = useMemo(() => {
    const currentWeekDates = getWeekdays(currentWeekStart);
    if (currentWeekDates.some((date) => date.value >= todayValue)) {
      return currentWeekStart;
    }

    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }, [currentWeekStart, todayValue]);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const [selectedLotType, setSelectedLotType] = useState("all");
  const weekDates = useMemo(() => getWeekdays(weekStart), [weekStart]);
  const [selectedDate, setSelectedDate] = useState(
    weekDates.find((date) => date.value >= todayValue)?.value || weekDates[0]?.value || formatDateValue(new Date())
  );
  const [mapSpots, setMapSpots] = useState(spots);
  const [activeSpot, setActiveSpot] = useState(null);
  const [spotReservations, setSpotReservations] = useState([]);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!weekDates.some((date) => date.value === selectedDate && date.value >= todayValue)) {
      setSelectedDate(
        weekDates.find((date) => date.value >= todayValue)?.value ||
        weekDates[0]?.value ||
        selectedDate
      );
    }
  }, [weekDates, selectedDate, todayValue]);

  useEffect(() => {
    setMapSpots(spots);
  }, [spots]);

  useEffect(() => {
    if (!activeSpot) return;
    const updatedSpot = mapSpots.find((spot) => spot.id === activeSpot.id);
    if (updatedSpot) {
      setActiveSpot(updatedSpot);
    }
  }, [mapSpots, activeSpot]);

  async function refreshMapSpots(dateValue, lotType = selectedLotType) {
    try {
      setMapLoading(true);
      const nextSpots = await api.spots(dateValue, lotType === "all" ? "" : lotType);
      setMapSpots(nextSpots);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setMapLoading(false);
    }
  }

  useEffect(() => {
    if (selectedDate) {
      refreshMapSpots(selectedDate, selectedLotType);
    }
  }, [selectedDate, selectedLotType]);

  function handleDateSelect(value) {
    setSelectedDate(value);
    setMessage("");
    setError("");
    setActiveSpot(null);
  }

  function handleSpotSelect(spot) {
    setActiveSpot(spot);
    setMessage("");
    setError("");
  }

  async function loadSpotReservations(spotId) {
    try {
      setReservationsLoading(true);
      const rows = await api.spotReservations(spotId);
      setSpotReservations(rows);
    } catch (requestError) {
      setError(requestError.message);
      setSpotReservations([]);
    } finally {
      setReservationsLoading(false);
    }
  }

  async function toggleAvailability() {
    if (!activeSpot) return;
    try {
      const currentlyUnavailable = spotVisualStatus(activeSpot) === "unavailable";
      await api.updateSpotDailyAvailability(activeSpot.id, {
        date: selectedDate,
        isAvailable: currentlyUnavailable
      });
      await refreshMapSpots(selectedDate, selectedLotType);
      setMessage(`Spot ${activeSpot.code} updated for ${selectedDate}.`);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function reportOccupied(payload) {
    try {
      await onReportSpot(payload);
      await refreshMapSpots(selectedDate, selectedLotType);
      setMessage("Occupied report saved.");
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function resolveReport() {
    if (!activeSpot) return;
    try {
      await api.resolveSpotReports(activeSpot.id, { date: selectedDate });
      await refreshMapSpots(selectedDate, selectedLotType);
      setMessage("Report resolved.");
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function goToPreviousWeek() {
    const previous = new Date(weekStart);
    previous.setDate(weekStart.getDate() - 7);
    if (previous < currentWeekStart) {
      return;
    }
    setWeekStart(previous);
    setActiveSpot(null);
  }

  function goToNextWeek() {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    setWeekStart(next);
    setActiveSpot(null);
  }

  const canGoPrevious = weekStart.getTime() > currentWeekStart.getTime();

  return (
    <div className="screen">
      <div className="panel minimal-panel">
        <label>
          Parking lot
          <select value={selectedLotType} onChange={(event) => setSelectedLotType(event.target.value)}>
            <option value="all">All Parking Lots</option>
            <option value="general">General Parking Lot</option>
            <option value="staff">Staff Parking Lot</option>
          </select>
        </label>

        <WeekStrip
          dates={weekDates}
          selectedDate={selectedDate}
          onSelect={handleDateSelect}
          onPreviousWeek={goToPreviousWeek}
          onNextWeek={goToNextWeek}
          canGoPrevious={canGoPrevious}
          todayValue={todayValue}
        />

        <div className="selected-date-banner">
          <strong>{selectedDate ? formatLongDate(selectedDate) : "Choose a date"} | {selectedLotType === "all" ? "All Parking Lots" : formatLotLabel(selectedLotType)}</strong>
        </div>

        <div className="map-stage">
          <ParkingMap spots={mapSpots} selectedSpotId={activeSpot?.id} onSelect={handleSpotSelect} />
        </div>
      </div>

      <SpotModal
        user={user}
        spot={activeSpot}
        selectedDate={selectedDate}
        onClose={() => {
          setActiveSpot(null);
          setSpotReservations([]);
          setMessage("");
          setError("");
        }}
        onToggleAvailability={toggleAvailability}
        onReportOccupied={reportOccupied}
        onLoadReservations={loadSpotReservations}
        onResolveReport={resolveReport}
        spotReservations={spotReservations}
        reservationsLoading={reservationsLoading}
        detailsLoading={mapLoading}
        message={message}
        error={error}
      />
    </div>
  );
}

function LotReservationScreen({ user, settings, onCreateReservation, onCreateRecurring }) {
  const isUnverified = user.is_verified === false;
  const studentSlotOptions = useMemo(() => getStudentSlotOptions(), []);
  const todayValue = useMemo(() => formatDateValue(new Date()), []);
  const currentWeekStart = useMemo(() => getMonday(new Date()), []);
  const initialWeekStart = useMemo(() => {
    const currentWeekDates = getWeekdays(currentWeekStart);
    if (currentWeekDates.some((date) => date.value >= todayValue)) {
      return currentWeekStart;
    }

    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }, [currentWeekStart, todayValue]);
  const [weekStart, setWeekStart] = useState(initialWeekStart);
  const weekDates = useMemo(() => getWeekdays(weekStart), [weekStart]);
  const [selectedDate, setSelectedDate] = useState(
    weekDates.find((date) => date.value >= todayValue)?.value || weekDates[0]?.value || formatDateValue(new Date())
  );
  const [selectedLotType, setSelectedLotType] = useState(isStaffLikeRole(user.role) ? "staff" : "general");
  const [form, setForm] = useState({
    startClock: "07:30",
    endClock: isStaffLikeRole(user.role) ? "16:00" : "09:00",
    semesterStart: selectedDate,
    semesterEnd: selectedDate,
    recurrenceType: "weekly"
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!weekDates.some((date) => date.value === selectedDate && date.value >= todayValue)) {
      const nextDate = weekDates.find((date) => date.value >= todayValue)?.value || weekDates[0]?.value || selectedDate;
      setSelectedDate(nextDate);
      setForm((current) => ({ ...current, semesterStart: nextDate, semesterEnd: nextDate }));
    }
  }, [weekDates, selectedDate, todayValue]);

  function handleDateSelect(value) {
    setSelectedDate(value);
    setForm((current) => ({
      ...current,
      semesterStart: current.semesterStart < value ? value : current.semesterStart,
      semesterEnd: current.semesterEnd < value ? value : current.semesterEnd
    }));
    setMessage("");
    setError("");
  }

  function goToPreviousWeek() {
    const previous = new Date(weekStart);
    previous.setDate(weekStart.getDate() - 7);
    if (previous < currentWeekStart) {
      return;
    }
    setWeekStart(previous);
  }

  function goToNextWeek() {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    setWeekStart(next);
  }

  async function submitReservation(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const payload = {
        lotType: isStudentRole(user.role) ? "general" : selectedLotType,
        startTime: new Date(`${selectedDate}T${form.startClock}`).toISOString(),
        endTime: new Date(`${selectedDate}T${form.endClock}`).toISOString()
      };

      if (isStudentRole(user.role)) {
        payload.startClock = form.startClock;
        payload.endClock = form.endClock;
      }

      const response = await onCreateReservation({
        ...payload
      });
      setMessage(`Reserved ${response.spot_code} as ${response.status}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitRecurring(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await onCreateRecurring({
        lotType: selectedLotType,
        dayOfWeek: getDayOfWeek(selectedDate),
        startTime: new Date(`${selectedDate}T${form.startClock}`).toISOString(),
        endTime: new Date(`${selectedDate}T${form.endClock}`).toISOString(),
        semesterStart: form.semesterStart,
        semesterEnd: form.semesterEnd,
        recurrenceType: form.recurrenceType
      });
      setMessage(`Recurring booking saved for ${response.spot_code}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  const canGoPrevious = weekStart.getTime() > currentWeekStart.getTime();
  const selectedStartMinutes = studentSlotOptions.find((option) => option.value === form.startClock)?.minutes ?? 450;
  const studentEndOptions = studentSlotOptions.filter((option) => option.minutes >= selectedStartMinutes + 60);
  const lotCards = isStudentRole(user.role)
    ? [{ key: "general", title: "General Parking Lot", description: "Students reserve from the general parking lot." }]
    : [
        { key: "general", title: "General Parking Lot", description: "Shared lot available for staff reservations." },
        { key: "staff", title: "Staff Parking Lot", description: "Staff-only lot with dedicated availability." }
      ];

  return (
    <div className="screen">
      <div className="panel minimal-panel">
        <WeekStrip
          dates={weekDates}
          selectedDate={selectedDate}
          onSelect={handleDateSelect}
          onPreviousWeek={goToPreviousWeek}
          onNextWeek={goToNextWeek}
          canGoPrevious={canGoPrevious}
          todayValue={todayValue}
        />

        <div className="selected-date-banner">
          <strong>{formatLongDate(selectedDate)}</strong>
        </div>

        <div className="lot-grid">
          {lotCards.map((lot) => (
            <button
              key={lot.key}
              className={`lot-card ${selectedLotType === lot.key ? "active" : ""}`}
              onClick={() => setSelectedLotType(lot.key)}
              disabled={isStudentRole(user.role)}
            >
              <strong>{lot.title}</strong>
              <span>{lot.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>{isStudentRole(user.role) ? "Reserve a parking space" : "Reserve from selected lot"}</h3>
        {isUnverified ? (
          <div className="inline-message warning">
            Verify your email first. You can browse booking times now, but you cannot reserve a parking spot until your account is verified.
          </div>
        ) : null}
        <form className="stack-form" onSubmit={submitReservation}>
          <label>
            Start time
            <select
              value={form.startClock}
              onChange={(event) => {
                const nextStart = event.target.value;
                const nextStartMinutes = studentSlotOptions.find((option) => option.value === nextStart)?.minutes ?? 450;
                const fallbackEnd = studentSlotOptions.find((option) => option.minutes >= nextStartMinutes + 60)?.value || "20:00";
                setForm((current) => {
                  const currentEndMinutes = studentSlotOptions.find((option) => option.value === current.endClock)?.minutes ?? 0;
                  return {
                    ...current,
                    startClock: nextStart,
                    endClock: currentEndMinutes >= nextStartMinutes + 60 ? current.endClock : fallbackEnd
                  };
                });
              }}
            >
              {studentSlotOptions.slice(0, -3).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            End time
            <select value={form.endClock} onChange={(event) => setForm({ ...form, endClock: event.target.value })}>
              {studentEndOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="helper-text">Bookings run from 07:30 to 20:00 in 30-minute steps, with a minimum stay of 1 hour.</p>
          <button className="primary-button" type="submit" disabled={loading || isUnverified}>
            {loading ? "Saving..." : "Reserve spot"}
          </button>
        </form>
        {error ? <div className="inline-message error">{error}</div> : null}
        {message ? <div className="inline-message success">{message}</div> : null}
      </div>

      {isStaffLikeRole(user.role) ? (
        <div className="panel">
          <h3>Recurring reservation</h3>
          <form className="stack-form" onSubmit={submitRecurring}>
            {isUnverified ? (
              <div className="inline-message warning">
                Verify your email before creating recurring reservations.
              </div>
            ) : null}
            <label>
              Semester start
              <input type="date" value={form.semesterStart} onChange={(event) => setForm({ ...form, semesterStart: event.target.value })} />
            </label>
            <label>
              Semester end
              <input type="date" value={form.semesterEnd} onChange={(event) => setForm({ ...form, semesterEnd: event.target.value })} />
            </label>
            <label>
              Recurrence type
              <select value={form.recurrenceType} onChange={(event) => setForm({ ...form, recurrenceType: event.target.value })}>
                <option value="weekly">Weekly</option>
                <option value="semester">Semester-long</option>
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={loading || isUnverified}>
              {loading ? "Saving..." : "Create recurring booking"}
            </button>
          </form>
        </div>
      ) : null}

    </div>
  );
}

function ReservationList({ title, reservations, onCancel, onReport, showUser = false }) {
  const [reportDrafts, setReportDrafts] = useState({});

  return (
    <div className="panel">
      <div className="section-heading">
        <h3>{title}</h3>
        <p>{reservations.length} records</p>
      </div>
      <div className="reservation-list">
        {reservations.map((reservation) => (
          <div className="reservation-card" key={reservation.id}>
            <div>
              <strong>Spot: {reservation.spot_code || "Pending assignment"}</strong>
              <p><strong>Booking ID:</strong> #{reservation.id}</p>
              <p><strong>Time:</strong> {formatDateTime(reservation.start_time)} to {formatDateTime(reservation.end_time)}</p>
              {reservation.lot_type ? <small>{reservation.lot_type} lot</small> : null}
              {showUser && reservation.user_name ? <small>{reservation.user_name} | {getRoleLabel(reservation.user_role)}</small> : null}
              {onReport ? (
                <div className="stack-form">
                  <label>
                    Report note
                    <input
                      value={reportDrafts[reservation.id] || ""}
                      onChange={(event) => setReportDrafts((current) => ({ ...current, [reservation.id]: event.target.value }))}
                      placeholder="Describe the issue"
                    />
                  </label>
                  <button
                    className="mini-button"
                    onClick={() => onReport({
                      spotId: reservation.spot_id,
                      description: reportDrafts[reservation.id] || "",
                      licensePlate: ""
                    })}
                  >
                    Report
                  </button>
                </div>
              ) : null}
            </div>
            <div className="reservation-actions">
              <StatusPill value={reservation.status} />
              {onCancel && ["pending", "approved"].includes(reservation.status) ? <button className="mini-button" onClick={() => onCancel(reservation.id)}>Cancel</button> : null}
            </div>
          </div>
        ))}
        {!reservations.length ? <p className="empty-state">No reservations yet.</p> : null}
      </div>
    </div>
  );
}

function AdminScreen({
  currentUser,
  users,
  approvals,
  reports,
  reservations,
  roleRules,
  onApprove,
  onReject,
  onCreateUser,
  onCreateSpot,
  onSearchUsers,
  onBanUser,
  onUnbanUser,
  onUpdateUserRole,
  onUpdateRoleRule
}) {
  const [activeSection, setActiveSection] = useState("parkings");
  const [showBookingsList, setShowBookingsList] = useState(false);
  const [bookingsMode, setBookingsMode] = useState("mine");
  const [bookingsDate, setBookingsDate] = useState(formatDateValue(new Date()));
  const [usersMode, setUsersMode] = useState("search");
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [spotForm, setSpotForm] = useState({ code: "", side: "left", type: "standard", lotType: "general", notes: "" });
  const [selectedLotType, setSelectedLotType] = useState("general");
  const [userFilters, setUserFilters] = useState({ name: "", email: "", role: "", licensePlate: "" });
  const [selectedRoleRule, setSelectedRoleRule] = useState(roleRules[0]?.role_name || "");
  const [roleRuleForm, setRoleRuleForm] = useState({
    maxDaysAhead: 10,
    maxDailyActiveReservations: "",
    maxReservationHours: "",
    approvalMode: "approved",
    roleDescription: ""
  });

  useEffect(() => {
    const nextRole = selectedRoleRule || roleRules[0]?.role_name || "";
    if (!nextRole) return;
    const rule = roleRules.find((item) => item.role_name === nextRole);
    if (!rule) return;
    setSelectedRoleRule(nextRole);
    setRoleRuleForm({
      maxDaysAhead: rule.max_days_ahead ?? 10,
      maxDailyActiveReservations: rule.max_daily_active_reservations ?? "",
      maxReservationHours: rule.max_reservation_hours ?? "",
      approvalMode: rule.approval_mode || "approved",
      roleDescription: rule.role_description || ""
    });
  }, [roleRules, selectedRoleRule]);

  return (
    <div className="screen">

      <div className="panel">
        <div className="section-tabs">
          {[
            { key: "parkings", label: "Parkings" },
            { key: "users", label: "Users" },
            { key: "reports", label: "Reports" },
            { key: "rules", label: "Rules" }
          ].map((section) => (
            <button
              key={section.key}
              className={activeSection === section.key ? "active" : ""}
              onClick={() => setActiveSection(section.key)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {activeSection === "parkings" ? (
        <div className="panel">
          <div className="section-heading">
            <h3>Parking operations</h3>
            <select className="compact-select" value={selectedLotType} onChange={(event) => setSelectedLotType(event.target.value)}>
              <option value="general">General Parking Lot</option>
              <option value="staff">Staff Parking Lot</option>
            </select>
          </div>
          <p>Use this section to add spots, review lot status, and process pending parking approvals.</p>
        </div>
      ) : null}

      {activeSection === "users" ? (
        <div className="panel">
        <div className="section-heading">
          <div>
            <h3>User management</h3>
            <p>Search users, review details, and manage banned access.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setUsersMode((mode) => (mode === "search" ? "create" : "search"))}
          >
            {usersMode === "search" ? "Switch to user create" : "Switch to user search"}
          </button>
        </div>
        {usersMode === "search" ? (
          <>
        <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          onSearchUsers(userFilters);
        }}>
          <label>
            Name
            <input value={userFilters.name} onChange={(event) => setUserFilters({ ...userFilters, name: event.target.value })} />
          </label>
          <label>
            Email
            <input value={userFilters.email} onChange={(event) => setUserFilters({ ...userFilters, email: event.target.value })} />
          </label>
          <label>
            Role
            <select value={userFilters.role} onChange={(event) => setUserFilters({ ...userFilters, role: event.target.value })}>
              <option value="">All roles</option>
              <option value="student role 1">Regular Student</option>
              <option value="student role 2">Priority Student</option>
              <option value="student role 3">Limited Access Student</option>
              <option value="staff">Staff Member</option>
              <option value="professor">Professor</option>
              <option value="security">Security/Admin</option>
            </select>
          </label>
          <label>
            License plate
            <input value={userFilters.licensePlate} onChange={(event) => setUserFilters({ ...userFilters, licensePlate: event.target.value })} />
          </label>
          <div className="action-row align-start">
            <button className="secondary-button" type="submit">Search users</button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                const cleared = { name: "", email: "", role: "", licensePlate: "" };
                setUserFilters(cleared);
                onSearchUsers(cleared);
              }}
            >
              Clear search
            </button>
          </div>
        </form>
        <div className="user-list">
          {users.map((account) => (
            <div className="user-row stacked-row" key={account.id}>
              <div>
                <strong>{account.name}</strong>
                <p>{account.email}</p>
                <p>{getRoleLabel(account.role)} | {account.license_plates || "No license plate saved"}</p>
                <p>{account.phone_number || "No phone number saved"}</p>
                <p>{getRoleDescription(account.role, account.role_description)}</p>
                {account.profile_note ? <p>{account.profile_note}</p> : null}
              </div>
              <div className="user-control-stack">
                <StatusPill value={account.status} />
                <StatusPill value={getRoleLabel(account.role)} />
                <select
                  value={account.role}
                  onChange={(event) => onUpdateUserRole(account.id, event.target.value)}
                >
                  {roleRules.map((rule) => (
                    <option key={rule.role_name} value={rule.role_name}>{getRoleLabel(rule.role_name)}</option>
                  ))}
                </select>
                <button
                  className={account.status === "banned" ? "mini-button success" : "mini-button danger"}
                  onClick={() => (account.status === "banned" ? onUnbanUser(account.id) : onBanUser(account.id))}
                >
                  {account.status === "banned" ? "Unban user" : "Ban user"}
                </button>
              </div>
            </div>
          ))}
          {!users.length ? <p className="empty-state">No users match the current search.</p> : null}
        </div>
          </>
        ) : (
          <>
        <h3>Create user account</h3>
        <form className="stack-form" onSubmit={(e) => {
          e.preventDefault();
          onCreateUser(userForm);
          setUserForm({ name: "", email: "", password: "", role: "staff" });
        }}>
          <label>
            Name
            <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
          </label>
          <label>
            Email
            <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
          </label>
          <label>
            Role
            <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              <option value="student role 1">Regular Student</option>
              <option value="student role 2">Priority Student</option>
              <option value="student role 3">Limited Access Student</option>
              <option value="staff">Staff Member</option>
              <option value="professor">Professor</option>
              <option value="security">Security/Admin</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">Create account</button>
        </form>
          </>
        )}
        </div>
      ) : null}

      {activeSection === "bookings" ? (
        <div className="panel">
          <div className="section-heading">
            <h3>My Bookings</h3>
            <button className="secondary-button" type="button" onClick={() => setShowBookingsList((value) => !value)}>
              {showBookingsList ? "Hide booking list" : "Show booking list"}
            </button>
          </div>
          <div className="action-row align-start">
            <button className={bookingsMode === "mine" ? "mini-button success" : "mini-button"} type="button" onClick={() => setBookingsMode("mine")}>My Bookings</button>
            <button className={bookingsMode === "users" ? "mini-button success" : "mini-button"} type="button" onClick={() => setBookingsMode("users")}>User Bookings</button>
          </div>
          <label>
            Day
            <input type="date" value={bookingsDate} onChange={(event) => setBookingsDate(event.target.value)} />
          </label>
          <p>Compact list, newest to oldest, filtered by selected day.</p>
          {showBookingsList ? (
            <div className="compact-bookings-list">
              {reservations
                .filter((reservation) => {
                  const sameDay = String(reservation.start_time || "").slice(0, 10) === bookingsDate;
                  if (!sameDay) return false;
                  if (bookingsMode === "mine") {
                    return Number(reservation.user_id) === Number(currentUser?.id);
                  }
                  return Number(reservation.user_id) !== Number(currentUser?.id);
                })
                .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
                .map((reservation) => (
                <div className="compact-booking-row" key={reservation.id}>
                  <span>#{reservation.id}</span>
                  <span>{reservation.spot_code || "N/A"}</span>
                  <span>{reservation.user_name || "N/A"}</span>
                  <span>{reservation.status}</span>
                </div>
              ))}
              {!reservations
                .filter((reservation) => {
                  const sameDay = String(reservation.start_time || "").slice(0, 10) === bookingsDate;
                  if (!sameDay) return false;
                  if (bookingsMode === "mine") return Number(reservation.user_id) === Number(currentUser?.id);
                  return Number(reservation.user_id) !== Number(currentUser?.id);
                }).length ? <p className="empty-state">No bookings found for this day.</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeSection === "rules" ? (
        <div className="panel">
          <h3>Role scheduling rules</h3>
          <form className="stack-form" onSubmit={(event) => {
            event.preventDefault();
            if (!selectedRoleRule) return;
            onUpdateRoleRule(selectedRoleRule, roleRuleForm);
          }}>
          <label>
            Choose role
            <select value={selectedRoleRule} onChange={(event) => setSelectedRoleRule(event.target.value)}>
              {roleRules.map((rule) => (
                <option key={rule.role_name} value={rule.role_name}>{getRoleLabel(rule.role_name)}</option>
              ))}
            </select>
          </label>
          <p className="helper-text">{getRoleDescription(selectedRoleRule, roleRuleForm.roleDescription) || "Current rights for selected role are shown below. Change values and save."}</p>
          <label>
            Max days ahead
            <input type="number" min={0} max={365} value={roleRuleForm.maxDaysAhead} onChange={(event) => setRoleRuleForm({ ...roleRuleForm, maxDaysAhead: Number(event.target.value) })} />
          </label>
          <label>
            Active reservations per day
            <input type="number" min={0} max={20} value={roleRuleForm.maxDailyActiveReservations} onChange={(event) => setRoleRuleForm({ ...roleRuleForm, maxDailyActiveReservations: event.target.value })} placeholder="Leave empty for no daily cap" />
          </label>
          <label>
            Max reservation hours
            <input type="number" min={1} max={24} value={roleRuleForm.maxReservationHours} onChange={(event) => setRoleRuleForm({ ...roleRuleForm, maxReservationHours: event.target.value })} placeholder="Leave empty for app default" />
          </label>
          <label>
            Reservation approval mode
            <select value={roleRuleForm.approvalMode} onChange={(event) => setRoleRuleForm({ ...roleRuleForm, approvalMode: event.target.value })}>
              <option value="pending">Pending approval</option>
              <option value="approved">Auto-approved</option>
            </select>
          </label>
          <label>
            Role description
            <input maxLength={120} value={roleRuleForm.roleDescription} onChange={(event) => setRoleRuleForm({ ...roleRuleForm, roleDescription: event.target.value })} />
          </label>
          <button className="primary-button" type="submit">Save role rules</button>
        </form>
        </div>
      ) : null}

      {activeSection === "parkings" ? (
        <div className="panel">
        <h3>Add parking spot</h3>
        <form className="stack-form" onSubmit={(e) => {
          e.preventDefault();
          onCreateSpot({ ...spotForm, isAvailable: true });
          setSpotForm({ code: "", side: "left", type: "standard", lotType: "general", notes: "" });
        }}>
          <label>
            Spot code
            <input value={spotForm.code} onChange={(e) => setSpotForm({ ...spotForm, code: e.target.value })} />
          </label>
          <label>
            Side
            <select value={spotForm.side} onChange={(e) => setSpotForm({ ...spotForm, side: e.target.value })}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Type
            <input value={spotForm.type} onChange={(e) => setSpotForm({ ...spotForm, type: e.target.value })} />
          </label>
          <label>
            Lot type
            <select value={spotForm.lotType} onChange={(e) => setSpotForm({ ...spotForm, lotType: e.target.value })}>
              <option value="general">General</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <label>
            Notes
            <input value={spotForm.notes} onChange={(e) => setSpotForm({ ...spotForm, notes: e.target.value })} />
          </label>
          <button className="secondary-button" type="submit">Add spot</button>
        </form>
        <div className="section-heading">
          <h3>Pending approvals</h3>
          <p>Review and decide reservation requests.</p>
        </div>
        <div className="reservation-list">
          {approvals.map((reservation) => (
            <div className="reservation-card" key={reservation.id}>
              <div>
                <strong>{reservation.user_name} | {reservation.spot_code}</strong>
                <p>{formatDateTime(reservation.start_time)} to {formatDateTime(reservation.end_time)}</p>
              </div>
              <div className="action-row">
                <button className="mini-button success" onClick={() => onApprove(reservation.id)}>Approve</button>
                <button className="mini-button danger" onClick={() => onReject(reservation.id)}>Reject</button>
              </div>
            </div>
          ))}
          {!approvals.length ? <p className="empty-state">No pending approvals.</p> : null}
        </div>
        </div>
      ) : null}

      {activeSection === "reports" ? (
        <div className="panel">
        <h3>Occupied spot reports</h3>
        <div className="reservation-list">
          {reports.map((report) => (
            <div className="reservation-card" key={report.id}>
              <div>
                <strong>{report.reported_by_name || "Unknown user"} | {report.spot_code}</strong>
                <p>{formatDateTime(report.reported_at)}</p>
                <p>{report.description || "No description provided"}</p>
                <p>{report.license_plate || "No license plate provided"}</p>
                <small>{report.lot_type} parking lot</small>
              </div>
              <StatusPill value="reported" />
            </div>
          ))}
          {!reports.length ? <p className="empty-state">No spot reports yet.</p> : null}
        </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileScreen({ user, settings, onResendVerification, onSaveProfile, onLogout }) {
  const [form, setForm] = useState({
    licensePlates: user.license_plates || "",
    phoneNumber: user.phone_number || "",
    profileNote: user.profile_note || ""
  });

  useEffect(() => {
    setForm({
      licensePlates: user.license_plates || "",
      phoneNumber: user.phone_number || "",
      profileNote: user.profile_note || ""
    });
  }, [user]);

  return (
    <div className="screen">
      <div className="panel">
        <h3>Profile</h3>
        <p><strong>Name:</strong> {user.name}</p>
        <p><strong>Email:</strong> {user.email}</p>
        <p><strong>Role:</strong> {getRoleLabel(user.role)}</p>
        <p><strong>Status:</strong> {user.status}</p>
        <p><strong>Email verification:</strong> {user.is_verified === false ? "Not verified yet" : "Verified"}</p>
      </div>

      {user.is_verified === false ? (
        <div className="panel">
          <h3>Verify Email</h3>
          <p>A verified AUK email is required before you can reserve a parking spot.</p>
          <button className="secondary-button full-width" onClick={onResendVerification}>
            Resend verification email
          </button>
        </div>
      ) : null}

      <div className="panel">
        <h3>{isStudentRole(user.role) ? "Vehicle details" : "Staff / professor details"}</h3>
        <form className="stack-form" onSubmit={(event) => {
          event.preventDefault();
          onSaveProfile(form);
        }}>
          <label>
            License plate(s)
            <input
              value={form.licensePlates}
              onChange={(event) => setForm({ ...form, licensePlates: event.target.value })}
              placeholder="Example: ABC-123, XYZ-456"
            />
          </label>
          <p className="helper-text">Up to 5 plates, max 10 characters each. Separate multiple plates with commas.</p>
          <label>
            Phone number
            <input
              value={form.phoneNumber}
              onChange={(event) => setForm({ ...form, phoneNumber: event.target.value })}
              placeholder="+355 69 123 4567"
            />
          </label>
          <label>
            {isStudentRole(user.role) ? "Profile note" : "Description / note"}
            <input
              value={form.profileNote}
              onChange={(event) => setForm({ ...form, profileNote: event.target.value })}
              placeholder="Optional"
            />
          </label>
          <button className="secondary-button" type="submit">Save profile</button>
        </form>
      </div>

      <div className="panel">
        <h3>Booking privileges</h3>
        <p><strong>Active booking limit:</strong> {isStudentRole(user.role) ? `${settings.student_max_active_reservations ?? 5} active bookings` : "Not limited by student cap"}</p>
        <p><strong>Single reservation length:</strong> {isStudentRole(user.role) ? `${settings.student_max_hours ?? 6} hours max` : `${settings.staff_max_hours ?? 12} hours max`}</p>
        <p><strong>Recurring reservations:</strong> {isStudentRole(user.role) ? "Not available" : "Available"}</p>
        <p><strong>Approval rights:</strong> {isAdminRole(user.role) ? "Can approve and reject reservations" : "No approval access"}</p>
        <p><strong>Spot management:</strong> {isAdminRole(user.role) ? "Can manage parking spots" : "View and reserve only"}</p>
      </div>

      <div className="panel">
        <button className="primary-button full-width" onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [resetToken, setResetToken] = useState("");
  const [user, setUser] = useState(getStoredSession());
  const [authNotice, setAuthNotice] = useState(null);
  const [activeTab, setActiveTab] = useState("map");
  const [spots, setSpots] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [recurringReservations, setRecurringReservations] = useState([]);
  const [users, setUsers] = useState([]);
  const [spotReports, setSpotReports] = useState([]);
  const [roleRules, setRoleRules] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [settings, setSettings] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData(currentUser = user) {
    if (!currentUser) return;
    try {
      const me = await api.me();
      setUser((existing) => {
        const mergedUser = { ...existing, ...me };
        return JSON.stringify(existing) === JSON.stringify(mergedUser) ? existing : mergedUser;
      });
      saveSession(localStorage.getItem("auk-token"), { ...currentUser, ...me });

      const [spotData, reservationData, recurringData] = await Promise.all([
        api.spots(),
        api.meReservations(),
        api.recurringReservations()
      ]);
      setSpots(spotData);
      setReservations(reservationData);
      setRecurringReservations(recurringData);

      if (isAdminRole(currentUser.role)) {
        const [approvalsData, usersData, settingsData, reportsData, roleRulesData] = await Promise.all([
          api.approvals(),
          api.users(),
          api.settings(),
          api.spotReports(),
          api.roleRules()
        ]);
        setApprovals(approvalsData);
        setUsers(usersData);
        setSettings(settingsData);
        setSpotReports(reportsData);
        setRoleRules(roleRulesData);
      } else {
        setSettings(await api.publicSettings().catch(() => ({ student_max_active_reservations: 5 })));
        setSpotReports([]);
        setRoleRules([]);
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verify");
    const passwordResetToken = params.get("reset");

    if (passwordResetToken) {
      setResetToken(passwordResetToken);
      setAuthMode("reset");
    }

    if (!verifyToken) {
      return;
    }

    let isMounted = true;

    api.verifyEmail({ token: verifyToken })
      .then((payload) => {
        if (!isMounted) return;
        saveSession(payload.token, payload.user);
        setAuthNotice({ type: "success", message: payload.message });
        setUser(payload.user);
      })
      .catch((requestError) => {
        if (!isMounted) return;
        setAuthNotice({ type: "error", message: requestError.message });
      })
      .finally(() => {
        if (isMounted) {
          clearQueryParam("verify");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (user) {
      loadData(user);
      setActiveTab("map");
    }
  }, [user]);

  const visibleReservations = useMemo(
    () => [...reservations].sort((first, second) => new Date(second.start_time).getTime() - new Date(first.start_time).getTime()),
    [reservations]
  );

  useEffect(() => {
    window.scrollTo(0, 0);
    const content = document.querySelector(".content");
    if (content) {
      content.scrollTop = 0;
    }
  }, [user, authMode, activeTab]);
  async function handleCreateReservation(payload) {
    setError("");
    const response = await api.createReservation(payload);
    setMessage("Reservation submitted.");
    await loadData();
    return response;
  }

  async function handleCreateRecurring(payload) {
    setError("");
    const response = await api.createRecurringReservation(payload);
    setMessage("Recurring reservation created.");
    await loadData();
    return response;
  }

  async function handleCancelReservation(id) {
    await api.cancelReservation(id);
    setMessage("Reservation cancelled.");
    await loadData();
  }

  async function handleApprove(id) {
    await api.updateReservationStatus(id, { status: "approved", approvalNote: "Approved by security." });
    setMessage("Reservation approved.");
    await loadData();
  }

  async function handleReject(id) {
    await api.updateReservationStatus(id, { status: "rejected", approvalNote: "Rejected by security." });
    setMessage("Reservation rejected.");
    await loadData();
  }

  async function handleCreateUser(payload) {
    await api.createUser(payload);
    setMessage("Account created.");
    await loadData();
  }

  async function handleSearchUsers(filters) {
    const results = await api.users(filters);
    setUsers(results);
  }

  async function handleCreateSpot(payload) {
    await api.createSpot(payload);
    setMessage("Spot created.");
    await loadData();
  }

  async function handleUpdateUserRole(userId, role) {
    await api.updateUserRole(userId, { role });
    setMessage("User role updated.");
    await loadData();
  }

  async function handleUpdateRoleRule(roleName, payload) {
    await api.updateRoleRule(roleName, payload);
    setMessage("Role scheduling rule updated.");
    await loadData();
  }

  async function handleCreateSpotReport(payload) {
    await api.createSpotReport(payload);
    setMessage("Spot report submitted.");
    await loadData();
  }

  async function handleBanUser(userId) {
    await api.banUser(userId);
    setMessage("User banned from new reservations.");
    await loadData();
  }

  async function handleUnbanUser(userId) {
    await api.unbanUser(userId);
    setMessage("User ban removed.");
    await loadData();
  }

  async function handleUpdateSpot(id, payload) {
    const updated = await api.updateSpot(id, payload);
    setMessage("Spot updated.");
    await loadData();
    return updated;
  }

  async function handleSaveProfile(profile) {
    const plates = String(profile.licensePlates || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (plates.length > 5) {
      setError("You can save up to 5 license plates.");
      return;
    }
    if (plates.some((plate) => plate.length > 10)) {
      setError("Each license plate must be 10 characters or fewer.");
      return;
    }

    const updatedUser = await api.updateMe(profile);
    setUser((current) => ({ ...current, ...updatedUser }));
    saveSession(localStorage.getItem("auk-token"), { ...user, ...updatedUser });
    setMessage("Profile updated.");
    setError("");
  }

  async function handleResendVerification() {
    if (!user?.email) return;
    const response = await api.resendVerification({ email: user.email });
    setMessage(response.message);
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setActiveTab("map");
    setAuthNotice(null);
    setSpots([]);
    setReservations([]);
    setRecurringReservations([]);
    setUsers([]);
    setSpotReports([]);
    setRoleRules([]);
    setApprovals([]);
    setDashboard({});
    setSettings({});
  }

  if (booting) {
    return (
      <PhoneShell>
        <SplashScreen onContinue={() => setBooting(false)} />
      </PhoneShell>
    );
  }

  if (!user) {
    const authTitle = authMode === "register"
      ? "Create Account"
      : authMode === "forgot"
        ? "Forgot Password"
        : authMode === "reset"
          ? "Reset Password"
          : "Sign In";

    return (
      <PhoneShell title={authTitle}>
        <AuthScreen
          mode={authMode}
          resetToken={resetToken}
          onModeChange={(nextMode) => {
            setAuthMode(nextMode);
            if (nextMode !== "reset") {
              setResetToken("");
              clearQueryParam("reset");
            }
          }}
          notice={authNotice}
          onAuthenticated={(nextUser, notice = null) => {
            if (notice) {
              setAuthNotice(notice);
            } else {
              setAuthNotice(null);
            }
            if (nextUser) {
              setUser(nextUser);
            }
          }}
          onForgotPassword={(email) => api.forgotPassword({ email })}
        />
      </PhoneShell>
    );
  }

  const tabs = getTabsForRole(user.role);
  const footer = (
    <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((tab) => (
        <button key={tab} className={tab === activeTab ? "active" : ""} onClick={() => setActiveTab(tab)}>
          {getTabLabel(user.role, tab)}
        </button>
      ))}
    </nav>
  );

  return (
    <PhoneShell footer={footer}>
      {message ? <div className="banner success">{message}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {activeTab === "map" ? (
        isAdminRole(user.role)
          ? <SecurityMapScreen user={user} spots={spots} onUpdateSpot={handleUpdateSpot} onReportSpot={handleCreateSpotReport} />
          : <LotReservationScreen user={user} settings={settings} onCreateReservation={handleCreateReservation} onCreateRecurring={handleCreateRecurring} />
      ) : null}
      {activeTab === "reservations" ? (
        <div className="screen">
          <ReservationList
            title="My bookings"
            reservations={visibleReservations}
            onCancel={handleCancelReservation}
            onReport={!isAdminRole(user.role) ? handleCreateSpotReport : undefined}
            showUser={isAdminRole(user.role)}
          />
          {recurringReservations.length ? <ReservationList title="Recurring reservations" reservations={recurringReservations.map((item) => ({ ...item, spot_code: item.spot_code, status: item.status }))} /> : null}
        </div>
      ) : null}
      {activeTab === "profile" ? (
        <ProfileScreen
          user={user}
          settings={settings}
          onResendVerification={handleResendVerification}
          onSaveProfile={handleSaveProfile}
          onLogout={handleLogout}
        />
      ) : null}
      {activeTab === "admin" && isAdminRole(user.role) ? (
        <AdminScreen
          currentUser={user}
          users={users}
          approvals={approvals}
          reports={spotReports}
          reservations={reservations}
          roleRules={roleRules}
          onApprove={handleApprove}
          onReject={handleReject}
          onCreateUser={handleCreateUser}
          onSearchUsers={handleSearchUsers}
          onCreateSpot={handleCreateSpot}
          onBanUser={handleBanUser}
          onUnbanUser={handleUnbanUser}
          onUpdateUserRole={handleUpdateUserRole}
          onUpdateRoleRule={handleUpdateRoleRule}
        />
      ) : null}
    </PhoneShell>
  );
}
