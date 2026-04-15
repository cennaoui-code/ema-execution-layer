#!/usr/bin/env node
/**
 * EMA OpenClaw Config Writer
 * Writes the full config to both possible config paths before gateway starts.
 */

import fs from 'fs';

const token = process.env.OPENCLAW_GATEWAY_TOKEN || 'default-token';
const port = parseInt(process.env.PORT || '10000');
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
const emaApiUrl = process.env.EMA_API_URL || 'https://api.samantha.cx';
const emaApiSecret = process.env.EMA_API_SECRET || '';
const emaWorkspaceId = process.env.EMA_WORKSPACE_ID || '';

const config = {
  gateway: {
    port: port,
    bind: 'lan',
    controlUi: {
      dangerouslyAllowHostHeaderOriginFallback: true,
      allowInsecureAuth: true,
      dangerouslyDisableDeviceAuth: true,
    },
    auth: {
      mode: 'token',
      token: token,
    },
  },
  agents: {
    defaults: {
      model: 'anthropic/claude-sonnet-4-6',
      heartbeat: {
        every: '5m',
        target: 'none',
        lightContext: true,
        isolatedSession: true,
        // Use Haiku for heartbeat checks (cost saving — heartbeats are frequent)
        model: 'anthropic/claude-haiku-4-5',
      },
      // Subagent/spawned tasks use Haiku by default (cost control)
      subagents: {
        model: 'anthropic/claude-haiku-4-5',
      },
    },
  },
  mcp: {
    servers: {
      ema: {
        command: 'node',
        args: ['/app/ema-mcp/dist/index.js'],
        env: {
          EMA_API_URL: emaApiUrl,
          EMA_API_SECRET: emaApiSecret,
          EMA_WORKSPACE_ID: emaWorkspaceId,
        },
      },
    },
  },
};

// Write to both possible config paths
// Also check for and remove any stale model config in agents dir
const paths = ['/data/.openclaw', '/home/node/.openclaw'];
for (const dir of paths) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const configPath = dir + '/openclaw.json';

    // Delete old config first to ensure clean state
    try { fs.unlinkSync(configPath); } catch(e) {}

    // Force-write our config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Also check for agent-level model config that may override
    const agentConfigDir = dir + '/agents/main/agent';
    try {
      const modelsPath = agentConfigDir + '/models.json';
      if (fs.existsSync(modelsPath)) {
        fs.unlinkSync(modelsPath);
        console.log(`[ema] Removed stale ${modelsPath}`);
      }
    } catch(e) {}
    console.log(`[ema] Config written to ${configPath}`);
  } catch (err) {
    console.error(`[ema] Failed to write config to ${dir}:`, err.message);
  }
}

// Also write workspace files if they don't exist
const workspaceDirs = ['/data/workspace', '/home/node/.openclaw/workspace'];
for (const wsDir of workspaceDirs) {
  try {
    fs.mkdirSync(wsDir, { recursive: true });

    const soulPath = wsDir + '/SOUL.md';
    if (!fs.existsSync(soulPath)) {
      fs.writeFileSync(soulPath, `# EMA — Emergency Compliance Response Agent

You are EMA, an emergency maintenance compliance response agent for property management companies. You monitor work orders 24/7, dispatch vendors, communicate with tenants, and ensure every emergency gets resolved.

Be concise. Lead with the answer. Sound like a competent operations coordinator, not a chatbot.
`);
      console.log(`[ema] SOUL.md written to ${soulPath}`);
    }

    const heartbeatPath = wsDir + '/HEARTBEAT.md';
    if (!fs.existsSync(heartbeatPath)) {
      fs.writeFileSync(heartbeatPath, `# Heartbeat Checklist

Check active work orders. For each:
- Vendor ETA passed + no check-in? → Alert
- ETA within 15 min + tenant not reminded? → Send reminder
- Work completed + not verified? → Schedule verification
- No vendor assigned? → Find vendors

If nothing needs attention, reply HEARTBEAT_OK.
`);
      console.log(`[ema] HEARTBEAT.md written to ${heartbeatPath}`);
    }
  } catch (err) {
    console.error(`[ema] Failed to write workspace to ${wsDir}:`, err.message);
  }
}

console.log('[ema] Configuration complete');
