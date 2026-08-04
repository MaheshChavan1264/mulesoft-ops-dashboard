const authMiddleware = (req, res, next) => {
  if (!req.session || !req.session.token) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  req.anypointToken = req.session.token;
  req.orgId = req.session.orgId;
  next();
};

module.exports = authMiddleware;