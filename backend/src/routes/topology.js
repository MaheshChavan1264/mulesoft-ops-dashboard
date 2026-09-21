const express = require('express');
const router = express.Router();
const topologyController = require('../controllers/topologyController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/', authMiddleware, topologyController.getTopology);

module.exports = router;
