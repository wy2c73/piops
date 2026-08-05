// Central definition of where PiOps stores its persistent data (device
// registry, encryption key, auth config, groups, alerts, custom
// commands). Override with PIOPS_DATA_DIR for test isolation -- normal
// operation (install.sh, Docker, manual) never sets this and gets the
// exact same backend/data/ path as always.

const path = require('path');

const DATA_DIR = process.env.PIOPS_DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = { DATA_DIR };
