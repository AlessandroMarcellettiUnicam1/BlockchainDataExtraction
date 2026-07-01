/**
 * Fase 4 — Session Store
 * Map in-memory con TTL per associare sessionId → OCEL.
 * Estratto da server.js per consentire il test unitario.
 */

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minuti

function createSession(ocel) {
	const id = `ocel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
	const timer = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
	sessions.set(id, { ocel, timer });
	return id;
}

function getSessionOcel(id) {
	return sessions.get(id)?.ocel ?? null;
}

function updateSessionOcel(id, ocel) {
	const s = sessions.get(id);
	if (!s) return false;
	s.ocel = ocel;
	return true;
}

function deleteSession(id) {
	const s = sessions.get(id);
	if (s) clearTimeout(s.timer);
	sessions.delete(id);
}

function sessionExists(id) {
	return sessions.has(id);
}

module.exports = { createSession, getSessionOcel, updateSessionOcel, deleteSession, sessionExists, SESSION_TTL_MS };
