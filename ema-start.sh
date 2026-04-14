#!/bin/sh
# EMA OpenClaw startup script
# Patches the config before starting the gateway

CONFIG_PATH="/home/node/.openclaw/openclaw.json"
mkdir -p /home/node/.openclaw

# Write config with controlUi settings
node -e "
const fs = require('fs');
let config = {};
try { config = JSON.parse(fs.readFileSync('${CONFIG_PATH}', 'utf8')); } catch(e) {}
config.gateway = config.gateway || {};
config.gateway.port = parseInt(process.env.PORT || '10000');
config.gateway.bind = 'lan';
config.gateway.controlUi = { allowInsecureAuth: true, dangerouslyAllowHostHeaderOriginFallback: true };
config.gateway.auth = { mode: 'token' };
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.model = 'anthropic/claude-sonnet-4-6';
config.agents.defaults.heartbeat = { every: '5m', target: 'none' };
fs.writeFileSync('${CONFIG_PATH}', JSON.stringify(config, null, 2));
console.log('[ema] Config written to ${CONFIG_PATH}');
console.log('[ema] Config:', JSON.stringify(config, null, 2));
"

# Start the gateway
exec node openclaw.mjs gateway --allow-unconfigured --bind lan --port ${PORT:-10000}
