require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// ── Session secret validation ─────────────────────────────────────────────────
// Fail fast in production if SESSION_SECRET is not set or is the known default.
// In development, emit a warning but continue.
const SESSION_SECRET = process.env.SESSION_SECRET;
const DEFAULT_SECRET = 'mulesoft-dashboard-secret';
if (!SESSION_SECRET || SESSION_SECRET === DEFAULT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'FATAL: SESSION_SECRET must be set to a strong random string in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
    process.exit(1);
  } else {
    console.warn(
      'WARNING: SESSION_SECRET is not set or is the default. ' +
      'This is insecure — set SESSION_SECRET in .env before deploying to production.'
    );
  }
}

const authRoutes = require('./routes/auth');
const organizationsRoutes = require('./routes/organizations');
const environmentsRoutes = require('./routes/environments');
const applicationsRoutes = require('./routes/applications');
const apisRoutes = require('./routes/apis');
const exchangeRoutes = require('./routes/exchange');
const metricsRoutes = require('./routes/metrics');
const cpsRoutes = require('./routes/cps');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop when running behind nginx / a load balancer.
// Required for req.secure and cookie.secure to work correctly in production.
if (isProd) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(session({
  secret: SESSION_SECRET || DEFAULT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,          // true in production (HTTPS only), false in dev
    httpOnly: true,          // prevents JavaScript access to the cookie
    sameSite: 'lax',         // CSRF mitigation — blocks cross-site POST requests
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/environments', environmentsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/apis', apisRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/cps', cpsRoutes);
app.use('/api/health', healthRoutes);

// Server health check
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`MuleSoft Dashboard Backend running on port ${PORT}`);
});