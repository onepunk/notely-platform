const express = require('express');
const router = express.Router();

const keyManager = require('../utils/keyManager');

router.get('/jwks.json', (req, res) => {
  res.json(keyManager.getJWKS());
});

module.exports = router;
