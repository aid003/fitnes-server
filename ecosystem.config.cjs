module.exports = {
  apps: [
    {
      name: 'fitnes-server',
      script: 'dist/main.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
