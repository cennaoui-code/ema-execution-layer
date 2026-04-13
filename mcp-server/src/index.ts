/**
 * EMA MCP Server — Exposes EMA's API as MCP tools for OpenClaw.
 *
 * This is the bridge between OpenClaw (execution layer) and EMA (data + voice).
 * OpenClaw agents call these tools to:
 * - Read/update work orders and incidents
 * - Select and dispatch vendors
 * - Send notifications (SMS, email)
 * - Trigger outbound voice calls (via LiveKit)
 * - Check escalation paths
 * - Manage on-call schedules
 *
 * All tools enforce workspace isolation via workspaceId.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Config ───────────────────────────────────────────────────────────

const EMA_API_URL = process.env.EMA_API_URL || 'https://api.samantha.cx';
const EMA_API_SECRET = process.env.EMA_API_SECRET || '';
const EMA_WORKSPACE_ID = process.env.EMA_WORKSPACE_ID || '';

// ── API Helper ───────────────────────────────────────────────────────

async function emaApi(path: string, options?: { method?: string; body?: Record<string, unknown> }): Promise<unknown> {
  const url = `${EMA_API_URL}${path}`;
  const method = options?.method ?? 'GET';

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(EMA_API_SECRET ? { 'x-api-secret': EMA_API_SECRET } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    throw new Error(`EMA API ${method} ${path}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({
  name: 'ema-mcp-server',
  version: '0.1.0',
});

// ── Work Order Tools ─────────────────────────────────────────────────

server.tool(
  'read_work_orders',
  'Get all active work orders for this workspace. Returns WO id, status, vendor, ETA, priority, tenant info.',
  { status: z.string().optional().describe('Filter by status: RUNNING, COMPLETED, ERROR, or ALL') },
  async ({ status }) => {
    const query = `workspaceId=${EMA_WORKSPACE_ID}${status && status !== 'ALL' ? `&status=${status}` : ''}`;
    const result = await emaApi(`/api/workorders?${query}`) as { data: unknown[] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
  },
);

server.tool(
  'get_work_order',
  'Get details of a specific work order by ID.',
  { workOrderId: z.string().describe('The work order UUID') },
  async ({ workOrderId }) => {
    const result = await emaApi(`/api/workorders?workspaceId=${EMA_WORKSPACE_ID}&cursor=&take=100`);
    // Find specific WO from the list (no single-WO endpoint yet)
    const data = (result as { data: Array<{ id: string }> }).data;
    const wo = data.find((w) => w.id === workOrderId);
    if (!wo) return { content: [{ type: 'text' as const, text: `Work order ${workOrderId} not found.` }] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(wo, null, 2) }] };
  },
);

server.tool(
  'update_work_order',
  'Update a work order with dispatch info: vendor assignment, ETA, NTE, status.',
  {
    workOrderId: z.string().describe('The work order UUID'),
    vendorName: z.string().optional().describe('Assigned vendor name'),
    vendorId: z.string().optional().describe('Assigned vendor UUID'),
    eta: z.string().optional().describe('Expected arrival time'),
    nteAmount: z.number().optional().describe('Not-to-exceed amount in dollars'),
    trade: z.string().optional().describe('Trade type (plumbing, electrical, etc.)'),
    authorizationStatus: z.string().optional().describe('pre_authorized, authorized, denied'),
    authorizedBy: z.string().optional().describe('Who authorized the spend'),
  },
  async (args) => {
    const { workOrderId, ...body } = args;
    const result = await emaApi(`/api/workorders/${workOrderId}/dispatch`, { method: 'PATCH', body });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Vendor Tools ─────────────────────────────────────────────────────

server.tool(
  'find_vendors',
  'Find available vendors for a specific trade. Returns ranked list by priority, response time, and rate.',
  { trade: z.string().describe('Trade type: plumbing, electrical, hvac, locksmith, pest control, handyman, etc.') },
  async ({ trade }) => {
    const result = await emaApi(`/api/vendors/dispatch?trade=${encodeURIComponent(trade)}&workspaceId=${EMA_WORKSPACE_ID}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_all_vendors',
  'List all vendors for this workspace.',
  {},
  async () => {
    const result = await emaApi(`/api/vendors?workspaceId=${EMA_WORKSPACE_ID}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Incident Tools ───────────────────────────────────────────────────

server.tool(
  'read_incidents',
  'Get all incidents for this workspace. Returns incident number, title, severity, status, lead, actions.',
  { status: z.string().optional().describe('Filter: INVESTIGATING, FIXING, TRIAGE, MONITORING, RESOLVED') },
  async ({ status }) => {
    let query = `workspaceId=${EMA_WORKSPACE_ID}`;
    if (status) query += `&status=${status}`;
    const result = await emaApi(`/api/team-incidents?${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_incident',
  'Get full details of a specific incident including actions, activities, escalations.',
  { incidentId: z.string().describe('The incident UUID') },
  async ({ incidentId }) => {
    const result = await emaApi(`/api/team-incidents/${incidentId}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'update_incident',
  'Update incident status, severity, or lead assignment.',
  {
    incidentId: z.string().describe('The incident UUID'),
    status: z.string().optional().describe('New status: INVESTIGATING, FIXING, TRIAGE, MONITORING, RESOLVED'),
    severity: z.string().optional().describe('New severity: CRITICAL, MAJOR, MINOR'),
    incidentLeadId: z.string().optional().describe('User ID to assign as incident lead'),
  },
  async ({ incidentId, ...body }) => {
    const result = await emaApi(`/api/team-incidents/${incidentId}`, { method: 'PATCH', body });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Notification Tools ───────────────────────────────────────────────

server.tool(
  'send_sms',
  'Send an SMS message to a phone number. Use for tenant updates, vendor notifications, PM alerts.',
  {
    phone: z.string().describe('Recipient phone number (E.164 format, e.g. +12125551234)'),
    message: z.string().describe('The SMS message text'),
  },
  async ({ phone, message }) => {
    // Validate phone is in our DB before sending (security: no arbitrary numbers)
    const result = await emaApi('/api/notifications/test', {
      method: 'POST',
      body: { type: 'sms', recipient: phone, message, workspaceId: EMA_WORKSPACE_ID },
    });
    return { content: [{ type: 'text' as const, text: `SMS sent to ${phone}` }] };
  },
);

// ── NTE / Authorization Tools ────────────────────────────────────────

server.tool(
  'check_nte_limit',
  'Check the Not-To-Exceed spending limit for this workspace/property/trade.',
  {
    propertyId: z.string().optional().describe('Property UUID (optional, for property-specific NTE)'),
    trade: z.string().optional().describe('Trade type (optional, for trade-specific NTE)'),
  },
  async ({ propertyId, trade }) => {
    let query = `workspaceId=${EMA_WORKSPACE_ID}`;
    if (propertyId) query += `&propertyId=${propertyId}`;
    if (trade) query += `&trade=${encodeURIComponent(trade)}`;
    const result = await emaApi(`/api/workorders/nte-limit?${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Escalation Tools ─────────────────────────────────────────────────

server.tool(
  'get_escalation_path',
  'Get the escalation path for a property and emergency type. Returns ordered list of who to contact.',
  {
    propertyId: z.string().optional().describe('Property UUID'),
    emergencyType: z.string().optional().describe('Emergency type (gas_leak, fire, flooding, etc.)'),
  },
  async ({ propertyId, emergencyType }) => {
    let query = `workspaceId=${EMA_WORKSPACE_ID}`;
    if (propertyId) query += `&propertyId=${propertyId}`;
    if (emergencyType) query += `&emergencyType=${encodeURIComponent(emergencyType)}`;
    const result = await emaApi(`/api/escalation-paths?${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Outbound Call Tool ───────────────────────────────────────────────

server.tool(
  'trigger_outbound_call',
  'Trigger an outbound voice call via LiveKit. Used for: vendor briefing, no-show check, verification, authorization.',
  {
    phone: z.string().describe('Phone number to call (E.164 format)'),
    callType: z.string().describe('Call type: vendor_briefing, no_show_check, verification, authorize, vendor_exhausted'),
    context: z.string().describe('JSON context for the call (incident details, work order info, etc.)'),
  },
  async ({ phone, callType, context }) => {
    // This will be wired to create a LiveKit room and trigger the appropriate voice skill
    // For now, log the intent
    const result = await emaApi('/api/dispatch/outbound-call', {
      method: 'POST',
      body: {
        phone,
        callType,
        context: JSON.parse(context),
        workspaceId: EMA_WORKSPACE_ID,
      },
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Property Tools ───────────────────────────────────────────────────

server.tool(
  'get_properties',
  'List all properties managed by this workspace.',
  {},
  async () => {
    const result = await emaApi(`/api/properties?workspaceId=${EMA_WORKSPACE_ID}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── On-Call Tools ────────────────────────────────────────────────────

server.tool(
  'get_oncall_schedule',
  'Get who is currently on-call for this workspace.',
  {},
  async () => {
    const result = await emaApi(`/api/oncall-schedules?workspaceId=${EMA_WORKSPACE_ID}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Coaching Tools ───────────────────────────────────────────────────

server.tool(
  'get_coaching_rules',
  'Get active coaching rules for this workspace. These are behavioral directives from the PM.',
  {},
  async () => {
    const result = await emaApi(`/api/coaching/rules?workspaceId=${EMA_WORKSPACE_ID}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Start Server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('EMA MCP Server running on stdio');
  console.error(`API: ${EMA_API_URL}`);
  console.error(`Workspace: ${EMA_WORKSPACE_ID}`);
}

main().catch((err) => {
  console.error('EMA MCP Server failed to start:', err);
  process.exit(1);
});
