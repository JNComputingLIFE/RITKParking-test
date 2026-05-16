const API_URL = import.meta.env.VITE_API_URL || "";

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function request(path, options = {}) {
  const token = localStorage.getItem("auk-token");
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Request failed.");
    error.code = data.code;
    error.email = data.email;
    error.previewUrl = data.previewUrl;
    throw error;
  }

  return data;
}

export const api = {
  me: () => request("/auth/me"),
  updateMe: (payload) => request("/auth/me", { method: "PATCH", body: JSON.stringify(payload) }),
  login: (payload) => request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  verifyEmail: (payload) => request("/auth/verify-email", { method: "POST", body: JSON.stringify(payload) }),
  resendVerification: (payload) => request("/auth/resend-verification", { method: "POST", body: JSON.stringify(payload) }),
  forgotPassword: (payload) => request("/auth/forgot-password", { method: "POST", body: JSON.stringify(payload) }),
  resetPassword: (payload) => request("/auth/reset-password", { method: "POST", body: JSON.stringify(payload) }),
  meReservations: () => request("/reservations"),
  recurringReservations: () => request("/reservations/recurring/list"),
  createReservation: (payload) => request("/reservations", { method: "POST", body: JSON.stringify(payload) }),
  createRecurringReservation: (payload) => request("/reservations/recurring", { method: "POST", body: JSON.stringify(payload) }),
  cancelReservation: (id) => request(`/reservations/${id}/cancel`, { method: "PATCH" }),
  spots: (date, lotType) => request(withQuery("/spots", { date, lotType })),
  publicSettings: () => request("/spots/public-settings"),
  users: (query = {}) => request(withQuery("/users", query)),
  createUser: (payload) => request("/users", { method: "POST", body: JSON.stringify(payload) }),
  banUser: (id) => request(`/users/${id}/ban`, { method: "PATCH" }),
  unbanUser: (id) => request(`/users/${id}/unban`, { method: "PATCH" }),
  updateUserRole: (id, payload) => request(`/users/${id}/role`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateUserApprovalMode: (id, payload) => request(`/users/${id}/approval-mode`, { method: "PATCH", body: JSON.stringify(payload) }),
  createSpot: (payload) => request("/spots", { method: "POST", body: JSON.stringify(payload) }),
  deleteSpot: (id) => request(`/spots/${id}`, { method: "DELETE" }),
  createSpotReport: (payload) => request("/spots/reports", { method: "POST", body: JSON.stringify(payload) }),
  spotReports: (lotType) => request(withQuery("/spots/reports", lotType ? { lotType } : {})),
  spotReservations: (spotId) => request(`/spots/${spotId}/reservations`),
  resolveSpotReports: (spotId, payload = {}) => request(`/spots/${spotId}/reports/resolve`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateSpotDailyAvailability: (spotId, payload) => request(`/spots/${spotId}/daily-availability`, { method: "PATCH", body: JSON.stringify(payload) }),
  dashboard: () => request("/admin/dashboard"),
  approvals: () => request("/admin/approvals"),
  updateReservationStatus: (id, payload) => request(`/reservations/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) }),
  settings: () => request("/admin/settings"),
  updateSettings: (payload) => request("/admin/settings", { method: "PATCH", body: JSON.stringify(payload) }),
  roleRules: () => request("/admin/role-rules"),
  updateRoleRule: (roleName, payload) => request(`/admin/role-rules/${encodeURIComponent(roleName)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateSpot: (id, payload) => request(`/spots/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
};
