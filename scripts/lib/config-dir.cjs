const { homedir } = require('node:os');
const { join, normalize, parse, sep } = require('node:path');

function stripTrailingSep(p) {
  if (!p.endsWith(sep)) {
    return p;
  }

  return p === parse(p).root ? p : p.slice(0, -1);
}

function getClaudeConfigDir() {
  const home = homedir();
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();

  if (!configured) {
    return stripTrailingSep(normalize(join(home, '.claude')));
  }

  if (configured === '~') {
    return stripTrailingSep(normalize(home));
  }

  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return stripTrailingSep(normalize(join(home, configured.slice(2))));
  }

  return stripTrailingSep(normalize(configured));
}

function getWiseConfigDir() {
  return join(getClaudeConfigDir(), '.wise');
}

function getUpdateCheckCachePath() {
  return join(getWiseConfigDir(), 'update-check.json');
}

module.exports = { getClaudeConfigDir, getWiseConfigDir, getUpdateCheckCachePath };
