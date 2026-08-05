// Tests install.sh's derive_github_repo_slug() function by extracting
// it directly from the real file and sourcing just that function into
// bash -- not a reimplementation, so this can't silently drift from
// what install.sh actually does. Sourcing the whole script would be
// unsafe (it immediately runs the install flow under `set -e`), so we
// pull out just the one function definition.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const INSTALL_SH = path.join(__dirname, '..', '..', 'install.sh');
const source = fs.readFileSync(INSTALL_SH, 'utf8');

const match = source.match(/derive_github_repo_slug\(\)\s*\{[\s\S]*?\n\}/);
if (!match) {
  throw new Error('Could not find derive_github_repo_slug() in install.sh -- has it been renamed or restructured?');
}
const functionSource = match[0];

function deriveSlug(url) {
  const script = `${functionSource}\nderive_github_repo_slug "$1"`;
  const result = execFileSync('bash', ['-c', script, '--', url], { encoding: 'utf8' });
  return result.trim();
}

test('derives owner/repo from plain github.com HTTPS URLs', () => {
  assert.equal(deriveSlug('https://github.com/wy2c73/piops.git'), 'wy2c73/piops');
  assert.equal(deriveSlug('https://github.com/wy2c73/piops'), 'wy2c73/piops');
  assert.equal(deriveSlug('https://github.com/wy2c73/piops/'), 'wy2c73/piops');
  assert.equal(deriveSlug('https://github.com/wy2c73/piops.git/'), 'wy2c73/piops');
});

test('leaves it empty for anything else, rather than deriving something wrong', () => {
  // SSH-style URL
  assert.equal(deriveSlug('git@github.com:wy2c73/piops.git'), '');
  // A local path (used for testing install.sh itself)
  assert.equal(deriveSlug('/tmp/fake-remote.git'), '');
  // A different git host entirely
  assert.equal(deriveSlug('https://gitlab.com/someone/somerepo.git'), '');
});
