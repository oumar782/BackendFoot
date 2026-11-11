// Gestion/Auth.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

/* ============================================================
 * CONSTANTES & HELPERS
 * ============================================================ */

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-prod";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/* ---------- Password ---------- */
export const hashPassword = (p) => bcrypt.hash(p, 12);
export const verifyPassword = (p, h) => bcrypt.compare(p, h);

/* ---------- Validation ---------- */
const isValidEmail = (e) => typeof e === "string" && /^\S+@\S+\.\S+$/.test(e);
const isValidPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 72;
const isValidFullName = (n) => typeof n === "string" && n.trim().length >= 2 && n.trim().length <= 100;

/* ---------- Colonnes + format ---------- */
const USER_COLUMNS = `
  id, full_name, email, phone, city, quartier, role, skill_level,
  preferred_sports, preferred_city, preferred_quartier,
  onboarding_completed, is_active, last_login_at, created_at, updated_at
`;

const formatUser = (u) => ({
  id: u.id,
  fullName: u.full_name,
  email: u.email,
  phone: u.phone,
  city: u.city,
  quartier: u.quartier,
  role: u.role,
  skillLevel: u.skill_level,
  preferredSports: u.preferred_sports,
  preferredCity: u.preferred_city,
  preferredQuartier: u.preferred_quartier,
  onboardingCompleted: u.onboarding_completed,
  isActive: u.is_active,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
  updatedAt: u.updated_at,
});

/* ============================================================
 * HELPERS EXPORTÉS (utilisés par tenantFilter, creneaux_analyse, etc.)
 * ============================================================ */

/** Retourne true si l'utilisateur est admin */
export const isAdmin = (user) => {
  return !!user && user.role === "ADMIN";
};

/** Retourne true si l'utilisateur est manager ou admin */
export const isManagerOrAdmin = (user) => {
  return !!user && (user.role === "BUSINESS_MANAGER" || user.role === "ADMIN");
};

/* ============================================================
 * MIDDLEWARES EXPORTÉS
 * ============================================================ */

/** Vérifie le JWT et charge req.user */
export const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Token manquant" });
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);

    const { rows } = await pool.query(
      `SELECT id, full_name, email, city, quartier, role, is_active
         FROM authpf WHERE id = $1`,
      [payload.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ success: false, message: "Utilisateur invalide" });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Token invalide" });
  }
};

/** Restreint à certains rôles */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Non authentifié" });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Accès refusé. Rôles requis: ${roles.join(",")}`,
    });
  }
  next();
};

/** Raccourcis */
export const requireManagerOrAdmin = requireRole("BUSINESS_MANAGER", "ADMIN");
export const requireAdmin = requireRole("ADMIN");
export const requireAdminForGlobalAnalytics = requireRole("ADMIN");

/* ============================================================
 * ROUTES
 * ============================================================ */

/* ---------- POST /register ---------- */
router.get("/register", (req, res) => {
  res.set("Allow", "POST").status(405).json({
    success: false,
    message: "L'inscription nécessite une requête POST avec les données du formulaire en JSON.",
    method: "POST",
    endpoint: `${req.baseUrl}/register`,
  });
});

router.post("/register", async (req, res) => {
  try {
    const {
      full_name: submittedFullName,
      fullName,
      name,
      email,
      password,
      phone,
      city,
      quartier,
      role,
      skill_level: submittedSkillLevel,
      skillLevel,
      preferred_sports: submittedPreferredSports,
      preferredSports,
      sports,
      preferred_city,
      preferred_quartier,
    } = req.body;
    const full_name = submittedFullName ?? fullName ?? name;
    const skill_level = submittedSkillLevel ?? skillLevel;
    const preferred_sports = submittedPreferredSports ?? preferredSports ?? sports;

    if (!full_name || !email || !password) {
      return res.status(400).json({ success: false, message: "Champs requis: full_name, email, password" });
    }
    if (!isValidFullName(full_name)) {
      return res.status(400).json({ success: false, message: "full_name: 2 à 100 caractères" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Email invalide" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: "Mot de passe: 8 à 72 caractères" });
    }

    const exists = await pool.query(
      `SELECT id FROM authpf WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ success: false, message: "Email déjà utilisé" });
    }

    const password_hash = await hashPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO authpf
         (full_name, email, password_hash, phone, city, quartier,
          role, skill_level, preferred_sports, preferred_city, preferred_quartier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${USER_COLUMNS}`,
      [
        full_name.trim(),
        email.trim().toLowerCase(),
        password_hash,
        phone || null,
        city || "Casablanca",
        quartier || "Maârif",
        role || "PLAYER",
        skill_level || "INTERMEDIATE",
        Array.isArray(preferred_sports) && preferred_sports.length ? preferred_sports : ["football"],
        preferred_city || null,
        preferred_quartier || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Compte créé",
      data: formatUser(rows[0]),
    });
  } 
  catch (err) {
    console.error("❌ register:", err.message);
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Email déjà utilisé" });
    }
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- POST /login ---------- */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Champs requis: email, password" });
    }

    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password_hash FROM authpf WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    const INVALID = { success: false, message: "Email ou mot de passe incorrect" };
    if (rows.length === 0) return res.status(401).json(INVALID);

    const user = rows[0];
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json(INVALID);

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: "Compte désactivé" });
    }

    await pool.query(
      `UPDATE authpf SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    );

    //  Génère un JWT
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: "Connexion réussie",
      token,
      data: formatUser(user),
    });
  } catch (err) {
    console.error("❌ login:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- GET /me ---------- */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM authpf WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json({ success: true, data: formatUser(rows[0]) });
  } catch (err) {
    console.error("❌ me:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- GET /users ---------- */
router.get("/users", async (req, res) => {
  try {
    const { role, city, search, is_active } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const conditions = [];
    const params = [];

    if (role) { params.push(role); conditions.push(`role = $${params.length}`); }
    if (city) { params.push(`%${city}%`); conditions.push(`city ILIKE $${params.length}`); }
    if (is_active === "true" || is_active === "false") {
      params.push(is_active === "true");
      conditions.push(`is_active = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(full_name ILIKE $${i} OR email ILIKE $${i})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::INT AS total FROM authpf ${where}`,
      [...params]
    );

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM authpf ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      success: true,
      total: countResult.rows[0].total,
      limit, offset,
      count: rows.length,
      data: rows.map(formatUser),
    });
  } catch (err) {
    console.error("❌ users:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- GET /users/:id ---------- */
router.get("/users/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "ID invalide" });

    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM authpf WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json({ success: true, data: formatUser(rows[0]) });
  } catch (err) {
    console.error("❌ users/:id:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- PUT /users/:id ---------- */
router.put("/users/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "ID invalide" });

    const {
      full_name, phone, city, quartier, role, skill_level,
      preferred_sports, preferred_city, preferred_quartier, onboarding_completed,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE authpf SET
         full_name            = COALESCE($1,  full_name),
         phone                = COALESCE($2,  phone),
         city                 = COALESCE($3,  city),
         quartier             = COALESCE($4,  quartier),
         role                 = COALESCE($5,  role),
         skill_level          = COALESCE($6,  skill_level),
         preferred_sports     = COALESCE($7,  preferred_sports),
         preferred_city       = COALESCE($8,  preferred_city),
         preferred_quartier   = COALESCE($9,  preferred_quartier),
         onboarding_completed = COALESCE($10, onboarding_completed)
       WHERE id = $11
       RETURNING ${USER_COLUMNS}`,
      [
        full_name ?? null, phone ?? null, city ?? null, quartier ?? null,
        role ?? null, skill_level ?? null, preferred_sports ?? null,
        preferred_city ?? null, preferred_quartier ?? null,
        typeof onboarding_completed === "boolean" ? onboarding_completed : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json({ success: true, message: "Profil mis à jour", data: formatUser(rows[0]) });
  } catch (err) {
    console.error("❌ put users:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- PATCH /users/:id/password ---------- */
router.patch("/users/:id/password", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "ID invalide" });

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: "Champs requis: current_password, new_password" });
    }
    if (!isValidPassword(new_password)) {
      return res.status(400).json({ success: false, message: "Nouveau mot de passe: 8 à 72 caractères" });
    }

    const { rows } = await pool.query(
      `SELECT password_hash FROM authpf WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }

    const ok = await verifyPassword(current_password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ success: false, message: "Mot de passe actuel incorrect" });

    const newHash = await hashPassword(new_password);
    await pool.query(`UPDATE authpf SET password_hash = $1 WHERE id = $2`, [newHash, id]);

    res.json({ success: true, message: "Mot de passe modifié" });
  } catch (err) {
    console.error("❌ password:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- PATCH /users/:id/onboarding ---------- */
router.patch("/users/:id/onboarding", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "ID invalide" });

    const { rows } = await pool.query(
      `UPDATE authpf SET onboarding_completed = TRUE WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json({ success: true, message: "Onboarding terminé", data: formatUser(rows[0]) });
  } catch (err) {
    console.error("❌ onboarding:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- DELETE /users/:id ---------- */
router.delete("/users/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: "ID invalide" });

    const { rows } = await pool.query(
      `UPDATE authpf SET is_active = FALSE WHERE id = $1
       RETURNING id, full_name, email, is_active`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json({ success: true, message: "Compte désactivé", data: rows[0] });
  } catch (err) {
    console.error("❌ delete:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ---------- GET /stats/overview ---------- */
router.get("/stats/overview", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::INT                                     AS total_users,
        COUNT(*) FILTER (WHERE is_active)::INT            AS active_users,
        COUNT(*) FILTER (WHERE onboarding_completed)::INT AS onboarded_users,
        COUNT(DISTINCT city)::INT                         AS total_cities,
        MIN(created_at)                                   AS first_signup,
        MAX(created_at)                                   AS last_signup
      FROM authpf
    `);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("❌ stats:", err.message);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

/* ============================================================
 * EXPORTS
 * ============================================================ */

export default router;