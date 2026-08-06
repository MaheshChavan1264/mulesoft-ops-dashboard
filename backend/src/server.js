require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

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

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'mulesoft-dashboard-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
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