module.exports = {
  apps: [
    {
      name: 'fitnes-server',
      script: 'dist/src/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
