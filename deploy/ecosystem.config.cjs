// How pm2 runs Pakske on the Pi.
// The settings (port, secrets, data folder) come from ~/.config/pakske.env, outside the
// repository, so nothing secret is ever committed.
const home = require('node:os').homedir()
const state = `${home}/.local/share/pakske`

module.exports = {
  apps: [
    {
      name: 'pakske',
      // the live release; deploy.sh points this link at each new build
      cwd: `${state}/current`,
      script: '.output/server/index.mjs',
      // Pakske's own Node, not the Pi's: see deploy/node-version
      interpreter: `${state}/node/current/bin/node`,
      node_args: `--env-file=${home}/.config/pakske.env`,
      env: { NODE_ENV: 'production' },
      // every line in ~/.pm2/logs/pakske-*.log starts with when it was written
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
