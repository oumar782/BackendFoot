import db from '../db.js';

export const logActivity = async (user, action, entity, entityId = null, details = {}) => {
  if (!user || !user.organizationId) return;
  try {
    await db.query(
      `INSERT INTO activity_logs (organization_id, user_id, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.organizationId,
        user.sub || user.id,
        action,
        entity,
        entityId,
        JSON.stringify(details)
      ]
    );
  } catch (err) {
    console.warn('⚠️ Avertissement journalisation activité (non bloquant):', err.message);
  }
};
