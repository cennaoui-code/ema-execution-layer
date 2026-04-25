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

// Debug: log config at startup
console.error(`[ema-mcp] API URL: ${EMA_API_URL}`);
console.error(`[ema-mcp] API Secret: ${EMA_API_SECRET ? '***set***' : 'EMPTY'}`);
if (EMA_WORKSPACE_ID) {
  console.error(`[ema-mcp] Mode: single-workspace (EMA_WORKSPACE_ID=${EMA_WORKSPACE_ID})`);
  console.error(`[ema-mcp] Tool calls can override via workspaceId parameter.`);
} else {
  console.error(`[ema-mcp] Mode: multi-tenant (every tool call MUST pass workspaceId)`);
}

// ── API Helper ───────────────────────────────────────────────────────

/**
 * Resolve the workspaceId for an MCP tool call.
 *
 * Priority:
 *   1. Explicit parameter passed by the calling agent
 *   2. EMA_WORKSPACE_ID env var (legacy single-workspace mode)
 *
 * If neither is set, throws — the server is misconfigured (should run in
 * single-workspace mode with env var OR multi-tenant mode with explicit
 * params on every call, not neither).
 */
function resolveWorkspaceId(explicit?: string): string {
  const ws = (explicit && explicit.trim()) || EMA_WORKSPACE_ID;
  if (!ws) {
    throw new Error(
      'No workspaceId resolved. Either set EMA_WORKSPACE_ID env (single-workspace mode) or pass workspaceId as a tool parameter (multi-tenant mode).',
    );
  }
  return ws;
}

async function emaApi(
  path: string,
  options?: { method?: string; body?: Record<string, unknown>; workspaceId?: string },
): Promise<unknown> {
  const url = `${EMA_API_URL}${path}`;
  const method = options?.method ?? 'GET';
  const wsId = options?.workspaceId || EMA_WORKSPACE_ID;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(EMA_API_SECRET ? { 'x-api-secret': EMA_API_SECRET } : {}),
      ...(wsId ? { 'x-workspace-id': wsId } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ema-mcp] API error: ${method} ${path} → ${res.status} ${res.statusText} | ${body}`);
    throw new Error(`EMA API ${method} ${path}: ${res.status} ${res.statusText} — ${body}`);
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
  'Get all active work orders for the specified workspace (or default from env). Returns WO id, status, vendor, ETA, priority, tenant info.',
  {
    status: z.string().optional().describe('Filter by status: RUNNING, COMPLETED, ERROR, or ALL'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ status, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const query = `workspaceId=${wsId}${status && status !== 'ALL' ? `&status=${status}` : ''}`;
    const result = await emaApi(`/api/workorders?${query}`, { workspaceId: wsId }) as { data: unknown[] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
  },
);

server.tool(
  'get_work_order',
  'Get details of a specific work order by ID.',
  {
    workOrderId: z.string().describe('The work order UUID'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workOrderId, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/workorders?workspaceId=${wsId}&cursor=&take=100`, { workspaceId: wsId });
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
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async (args) => {
    const { workOrderId, workspaceId, ...body } = args;
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/workorders/${workOrderId}/dispatch`, { method: 'PATCH', body, workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Vendor Tools ─────────────────────────────────────────────────────

server.tool(
  'find_vendors',
  'Find available vendors for a specific trade. Returns ranked list by priority, response time, and rate.',
  {
    trade: z.string().describe('Trade type: plumbing, electrical, hvac, locksmith, pest control, handyman, etc.'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ trade, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/vendors/dispatch?trade=${encodeURIComponent(trade)}&workspaceId=${wsId}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_all_vendors',
  'List all vendors for the specified workspace (or default from env).',
  {
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/vendors?workspaceId=${wsId}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Incident Tools ───────────────────────────────────────────────────

server.tool(
  'read_incidents',
  'Get all incidents for the specified workspace (or default from env). Returns incident number, title, severity, status, lead, actions.',
  {
    status: z.string().optional().describe('Filter: INVESTIGATING, FIXING, TRIAGE, MONITORING, RESOLVED'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ status, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    let query = `workspaceId=${wsId}`;
    if (status) query += `&status=${status}`;
    const result = await emaApi(`/api/team-incidents?${query}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'get_incident',
  'Get full details of a specific incident including actions, activities, escalations.',
  {
    incidentId: z.string().describe('The incident UUID'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ incidentId, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/team-incidents/${incidentId}`, { workspaceId: wsId });
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
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ incidentId, workspaceId, ...body }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/team-incidents/${incidentId}`, { method: 'PATCH', body, workspaceId: wsId });
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
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ phone, message, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/send-notification', {
      method: 'POST',
      body: {
        phone,
        template: message, // If not a template name, the service uses it as raw text
        variables: {},
        workspaceId: wsId,
      },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: `SMS sent to ${phone}` }] };
  },
);

// ── NTE / Authorization Tools ────────────────────────────────────────

server.tool(
  'check_nte_limit',
  'Check the Not-To-Exceed spending limit for the specified workspace/property/trade (or default workspace from env).',
  {
    propertyId: z.string().optional().describe('Property UUID (optional, for property-specific NTE)'),
    trade: z.string().optional().describe('Trade type (optional, for trade-specific NTE)'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ propertyId, trade, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    let query = `workspaceId=${wsId}`;
    if (propertyId) query += `&propertyId=${propertyId}`;
    if (trade) query += `&trade=${encodeURIComponent(trade)}`;
    const result = await emaApi(`/api/workorders/nte-limit?${query}`, { workspaceId: wsId });
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
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ propertyId, emergencyType, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    let query = `workspaceId=${wsId}`;
    if (propertyId) query += `&propertyId=${propertyId}`;
    if (emergencyType) query += `&emergencyType=${encodeURIComponent(emergencyType)}`;
    const result = await emaApi(`/api/escalation-paths?${query}`, { workspaceId: wsId });
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
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ phone, callType, context, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    // This will be wired to create a LiveKit room and trigger the appropriate voice skill
    // For now, log the intent
    const result = await emaApi('/api/dispatch/outbound-call', {
      method: 'POST',
      body: {
        phone,
        callType,
        context: JSON.parse(context),
        workspaceId: wsId,
      },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Property Tools ───────────────────────────────────────────────────

server.tool(
  'get_properties',
  'List all properties managed by the specified workspace (or default from env).',
  {
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/properties?workspaceId=${wsId}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── On-Call Tools ────────────────────────────────────────────────────

server.tool(
  'get_oncall_schedule',
  'Get who is currently on-call for the specified workspace (or default from env).',
  {
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/oncall-schedules?workspaceId=${wsId}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Coaching Tools ───────────────────────────────────────────────────

server.tool(
  'get_coaching_rules',
  'Get active coaching rules for the specified workspace (or default from env). These are behavioral directives from the PM.',
  {
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/coaching/rules?workspaceId=${wsId}`, { workspaceId: wsId });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Execution Layer Tools ─────────────────────────────────────────────

server.tool(
  'send_dispatch_notification',
  'Send a templated dispatch SMS. Templates: vendor_dispatched, eta_reminder, vendor_arrived, work_completed, verification_resolved, verification_not_resolved, no_show_alert, escalation.',
  {
    phone: z.string().describe('Recipient phone (E.164)'),
    template: z.string().describe('Template name'),
    variables: z.string().describe('JSON object of template variables: requester_name, vendor_name, issue_type, location, eta, reason'),
    workOrderId: z.string().optional().describe('Work order UUID'),
    incidentId: z.string().optional().describe('Incident UUID'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ phone, template, variables, workOrderId, incidentId, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/send-notification', {
      method: 'POST',
      body: { phone, template, variables: JSON.parse(variables), workspaceId: wsId, workOrderId, incidentId },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'vendor_checkin',
  'Mark a vendor as arrived on-site for a work order.',
  {
    workOrderId: z.string().describe('Work order UUID'),
    vendorName: z.string().optional().describe('Vendor name'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workOrderId, vendorName, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/workorders/${workOrderId}/checkin`, {
      method: 'POST',
      body: { vendorName, workspaceId: wsId },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'vendor_complete',
  'Mark a work order as completed by the vendor.',
  {
    workOrderId: z.string().describe('Work order UUID'),
    notes: z.string().optional().describe('Completion notes'),
    cost: z.number().optional().describe('Final cost'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workOrderId, notes, cost, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/workorders/${workOrderId}/complete`, {
      method: 'POST',
      body: { notes, cost, workspaceId: wsId },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'report_scope_change',
  'Report a scope change on a work order. If revised cost exceeds NTE, triggers re-authorization.',
  {
    workOrderId: z.string().describe('Work order UUID'),
    revisedDiagnosis: z.string().describe('What the vendor found'),
    revisedCost: z.number().describe('New estimated cost'),
    vendorRecommendation: z.string().optional().describe('Vendor recommendation'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ workOrderId, revisedDiagnosis, revisedCost, vendorRecommendation, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi(`/api/workorders/${workOrderId}/scope-change`, {
      method: 'POST',
      body: { revisedDiagnosis, revisedCost, vendorRecommendation, workspaceId: wsId },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'log_agent_action',
  'Log an agent action to the incident timeline for auditability.',
  {
    incidentId: z.string().optional().describe('Incident UUID'),
    workOrderId: z.string().optional().describe('Work order UUID'),
    actionType: z.string().describe('Action type: DISPATCHED_VENDOR, SENT_SMS, CALLED_VENDOR, NO_SHOW_CHECK, VERIFIED, ESCALATED, CLOSED'),
    description: z.string().describe('Human-readable description of what happened'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID (legacy). Required when running in multi-tenant mode.'),
  },
  async ({ incidentId, workOrderId, actionType, description, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/log-action', {
      method: 'POST',
      body: { incidentId, workOrderId, workspaceId: wsId, actionType, description },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Phase 2 tools: queue + cron consumers ────────────────────────────

server.tool(
  'poll_openclaw_events',
  'Claim pending workorder.* / run.* events from the openclaw_event_queue. Returns up to `limit` events oldest-first and atomically marks them acked (same event never delivered twice). Call once per heartbeat cycle.',
  {
    limit: z.number().optional().describe('Max events to claim per call. Default 50.'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID.'),
  },
  async ({ limit, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/openclaw-events/poll', {
      method: 'POST',
      body: { workspaceId: wsId, limit: limit ?? 50 },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'process_due_crons',
  'Claim and fire any wo_cron rows whose firesAt <= now. Returns the list of crons that were just fired (workOrderId, cronType, metadata). The API marks each row fired atomically — caller is responsible for executing the cronType-specific action per HEARTBEAT.md Step 0. Call once per heartbeat cycle.',
  {
    limit: z.number().optional().describe('Max crons to process per call. Default 100.'),
    workspaceId: z.string().optional().describe('Workspace to operate on. Defaults to env EMA_WORKSPACE_ID.'),
  },
  async ({ limit, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/process-due-crons', {
      method: 'POST',
      body: { workspaceId: wsId, limit: limit ?? 100 },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'schedule_cron',
  'Schedule a per-WO cron (eta-reminder | arrival-check | noshow-trigger | verification | warranty). Replaces any prior pending cron of the same (workOrderId, cronType) — ensures ETA changes do not leave stale firings.',
  {
    workOrderId: z.string().describe('Work order UUID'),
    cronType: z.enum(['eta-reminder', 'arrival-check', 'noshow-trigger', 'verification', 'warranty']),
    firesAt: z.string().describe('ISO timestamp when the cron should fire'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional payload to attach to the cron'),
    workspaceId: z.string().optional(),
  },
  async ({ workOrderId, cronType, firesAt, metadata, workspaceId }) => {
    const wsId = resolveWorkspaceId(workspaceId);
    const result = await emaApi('/api/dispatch/schedule-cron', {
      method: 'POST',
      body: { workOrderId, cronType, firesAt, metadata, workspaceId: wsId },
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  'update_runtime_state',
  'Manipulate the per-WO runtime state row (vendorAttemptIndex, currentState, metadata). One endpoint, four actions: upsertOnDispatch / bumpVendorAttempt / transition / get. Used by ema_dispatch_vendor TaskFlow to track which vendor index to try next + which state the WO is logically in. Audit fix C5.',
  {
    action: z.enum(['upsertOnDispatch', 'bumpVendorAttempt', 'transition', 'get']),
    workOrderId: z.string().describe('Work order UUID'),
    workspaceId: z.string().optional().describe('Workspace; required for upsertOnDispatch'),
    incidentId: z.string().optional().describe('Incident UUID, optional, only for upsertOnDispatch'),
    newState: z.string().optional().describe('New state label, required for transition (e.g., ASSIGNED, ESCALATED)'),
    metadataMerge: z.record(z.string(), z.unknown()).optional().describe('Optional shallow-merge metadata for transition'),
  },
  async ({ action, workOrderId, workspaceId, incidentId, newState, metadataMerge }) => {
    const wsId = action === 'upsertOnDispatch' ? resolveWorkspaceId(workspaceId) : workspaceId;
    const body: Record<string, unknown> = { action, workOrderId };
    if (action === 'upsertOnDispatch') {
      body.workspaceId = wsId;
      if (incidentId) body.incidentId = incidentId;
    } else if (action === 'transition') {
      if (!newState) throw new Error('transition requires newState');
      body.newState = newState;
      if (metadataMerge) body.metadataMerge = metadataMerge;
    }
    const result = await emaApi('/api/dispatch/runtime-state', {
      method: 'POST',
      body,
      workspaceId: wsId,
    });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ── Start Server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('EMA MCP Server running on stdio');
  console.error(`API: ${EMA_API_URL}`);
  console.error(`Workspace (default): ${EMA_WORKSPACE_ID || '(none — multi-tenant mode)'}`);
}

main().catch((err) => {
  console.error('EMA MCP Server failed to start:', err);
  process.exit(1);
});
