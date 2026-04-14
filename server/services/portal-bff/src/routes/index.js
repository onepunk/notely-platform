const express = require('express');

const adminAIRoutes = require('./adminAI');
const authRoutes = require('./auth');
const adminUsersRoutes = require('./adminUsers');
const usersRoutes = require('./users');
const recordingsRoutes = require('./recordings');
const updatesRoutes = require('./updates');
const adminReleasesRoutes = require('./adminReleases');
const releasesRoutes = require('./releases');
const downloadsRoutes = require('./downloads');
const betaTokenRoutes = require('./betaToken');
const { adminOnly } = require('../middleware/adminOnly');

const router = express.Router();

// Admin routes with real business logic (kept in portal-bff)
router.use('/admin/ai', adminOnly, adminAIRoutes);
router.use('/admin/users', adminOnly, adminUsersRoutes);
router.use('/admin/releases', adminOnly, adminReleasesRoutes);

// Authenticated user routes with real business logic
router.use('/users', usersRoutes);
router.use('/recordings', recordingsRoutes);
router.use('/updates', updatesRoutes);
router.use('/releases', releasesRoutes);
router.use('/downloads', downloadsRoutes);

// Secure beta token exchange (no auth required - handles pre-login flow)
router.use('/beta', betaTokenRoutes);

// Auth routes with IP whitelist enrichment
router.use('/auth', authRoutes);

module.exports = router;
