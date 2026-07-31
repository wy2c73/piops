const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { detectLocalCidr, scanSubnet } = require('../lib/networkScan');

router.get('/detect', (req, res) => {
  res.json({ cidr: detectLocalCidr() });
});

router.post('/', async (req, res) => {
  const cidr = req.body?.cidr || detectLocalCidr();
  const port = Number(req.body?.port) || 22;
  try {
    const found = await scanSubnet(cidr, port);
    const existingHosts = new Set(store.list().map((d) => d.host));
    const results = found.map((host) => ({ ...host, alreadyAdded: existingHosts.has(host.ip) }));
    res.json({ cidr, port, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
