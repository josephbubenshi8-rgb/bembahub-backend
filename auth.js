import jwt from "jsonwebtoken";
import { getUserById, publicUser } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "bembahub-dev-secret-change-me";
const JWT_EXPIRES_IN = "30d";

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing or invalid Authorization header." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: "User no longer exists." });
    if (user.status === "suspended") return res.status(403).json({ error: "Account suspended." });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// Like requireAuth, but never rejects — attaches req.user when a valid token
// is present, otherwise leaves req.user undefined and continues. Used on
// endpoints that must stay publicly callable (e.g. /translate) but can make
// use of an identity when one's available (e.g. unique-contributor tracking).
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.sub);
    if (user && user.status !== "suspended") req.user = user;
  } catch (e) { /* invalid/expired token on a public endpoint — just proceed anonymously */ }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions." });
    }
    next();
  };
}

export { publicUser };
