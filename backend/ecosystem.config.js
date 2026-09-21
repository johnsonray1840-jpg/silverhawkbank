// ==============================================================================
// Silverhawk Digital Banking Platform — PM2 Process Manager Configuration
// Start: pm2 start ecosystem.config.js
// ==============================================================================

module.exports = {
  apps: [
    {
      name: 'silverhawk-api',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};

