// Shared setup for backend tests: an isolated temp data directory (so
// tests never touch a real device registry) and a real server instance
// bound to an OS-assigned port (so tests exercise the actual Express
// app + routes, not a reimplementation of them).
//
// IMPORTANT: this must be required (and setupTestServer() called)
// BEFORE any test file requires server.js or anything under lib/ --
// those modules resolve their data-directory paths the moment they're
// first required, using whatever PIOPS_DATA_DIR is set to at that
// exact point.

const fs = require('fs');
const os = require('os');
const path = require('path');

function setupTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piops-test-'));
  process.env.PIOPS_DATA_DIR = tmpDir;

  // Fresh require each time -- test files run in separate processes
  // under node --test, but guard against re-require within one file.
  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        tmpDir,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

module.exports = { setupTestServer };
