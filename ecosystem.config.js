module.exports = {
  apps: [{
    name: 'product-factory',
    script: './dist/worker/index.js',
    cwd: '/root/product-factory',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3005,
    },
  }],
};
