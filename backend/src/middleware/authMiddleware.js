const { decrypt } = require('../utils/secretCrypto');

const authMiddleware = (req, res, next) => {
  if (!req.session || !req.session.token) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  // session.token is encrypted at rest (see routes/auth.js storeSession()) —
  // decrypt() transparently passes through any pre-existing plaintext token
  // unchanged, so sessions created before this change keep working without
  // a migration step.
  req.anypointToken = decrypt(req.session.token);
  req.orgId = req.session.orgId;
  req.memberOrgs = req.session.memberOrgs || [];
  req.accessibleEnvironments = req.session.accessibleEnvironments || {};
  next();
};

module.exports = authMiddleware;