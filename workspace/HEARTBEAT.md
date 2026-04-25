# Heartbeat — Execution Layer Rules

Every heartbeat, execute these DETERMINISTIC rules in order. Do NOT improvise or add actions not listed here.

## Step 0: Process due crons (Phase 2 — replaces in-API timer)
Call `ema__process_due_crons` to claim any `wo_cron` rows whose `firesAt <= now`. The tool returns the list of crons that just fired (atomic claim — same cron is never delivered twice). For each fired cron, the action depends on `cronType`:

- `eta-reminder` → call `ema__send_dispatch_notification` with template="eta_reminder" to the requester phone
- `arrival-check` → call `ema__read_work_orders` filtered to that WO id; if status != ON_SITE, follow Rule 1 below
- `noshow-trigger` → call `ema__trigger_outbound_call` with callType="no_show_check" to the vendor phone
- `verification` → call `ema__trigger_outbound_call` with callType="verification" to the requester phone
- `warranty` → call `ema__read_work_orders` filtered to the asset to detect recurring issues; if found, call `ema__log_agent_action` with actionType="WARRANTY_RECURRING"

After acting on each, call `ema__log_agent_action` with actionType=`CRON_FIRED.{cronType}` and metadata={cronId, workOrderId}. The `process_due_crons` tool already marks each row fired before returning — your action is the consequence, not the firing.

If `process_due_crons` returns an empty list, proceed to Step 1.

## Step 0.5: Drain queued events (one-shot signals)
Call `ema__poll_openclaw_events` to claim up to 50 pending events. For each event, the action depends on `eventType`:

- `workorder.scope_changed` → if payload.needsReauthorization=true, follow Rule 6 below (re-authorization)
- `workorder.checkin` → call `ema__log_agent_action` with actionType="VENDOR_ARRIVED" (the WO state-scan in Step 1 will pick up the new status, but the queue event ensures we don't miss it)
- `workorder.completed` → schedule a verification cron via `ema__schedule_cron` cronType="verification", firesAt=now+2h (or +30min if EMERGENCY)
- `workorder.created` → no immediate action; covered by Rule 4 (NO VENDOR ASSIGNED)
- `cron.fired.*` → echo to timeline only; the actual cron consequence already ran in Step 0
- Unknown eventType → call `ema__log_agent_action` with actionType="QUEUE_EVENT_UNKNOWN" and metadata={eventType, eventId}, then continue

The poll tool atomically marks events acked. If poll returns empty, proceed to Step 1.

## Step 1: Read all active work orders
Call `ema__read_work_orders` with status RUNNING.

## Step 2: For EACH work order, evaluate these rules

### Rule 1: VENDOR OVERDUE (ETA passed, no arrival)
**Condition:** Work order has vendorEta AND current time > vendorEta + 15 min AND status != ON_SITE AND status != COMPLETED
**Action:** Call `ema__trigger_outbound_call` with callType="no_show_check" to the vendor phone
**Then:** Call `ema__log_agent_action` with actionType="NO_SHOW_CHECK"
**Priority override:** For EMERGENCY work orders, check at ETA + 10 min instead of +15

### Rule 2: ETA APPROACHING (reminder)
**Condition:** Work order has vendorEta AND current time is within 15 min of vendorEta AND no reminder sent yet for this WO
**Action:** Call `ema__send_dispatch_notification` with template="eta_reminder" to the requester phone
**Then:** Call `ema__log_agent_action` with actionType="SENT_REMINDER"

### Rule 3: COMPLETED BUT NOT VERIFIED
**Condition:** Work order status = COMPLETED AND completedAt + 2 hours < current time AND no verification call made
**Action:** Call `ema__trigger_outbound_call` with callType="verification" to the requester phone
**Then:** Call `ema__log_agent_action` with actionType="VERIFICATION_CALL"
**Priority override:** For EMERGENCY, verify at completedAt + 30 min

### Rule 4: NO VENDOR ASSIGNED
**Condition:** Work order has NO vendorName AND createdAt + 10 min < current time
**Action:** Call `ema__find_vendors` with the work order trade, then `ema__trigger_outbound_call` with callType="vendor_briefing"
**Then:** Call `ema__log_agent_action` with actionType="DISPATCHED_VENDOR"

### Rule 5: SLA BREACH APPROACHING
**Condition:** Work order priority = EMERGENCY AND createdAt + 2 hours approaching AND vendor not on-site
**Action:** Call `ema__log_agent_action` with actionType="SLA_WARNING", then use ema_escalation skill
**Note:** This escalates to the PM team, not the vendor

## Step 3: Suppression
- Do NOT re-trigger the same action for the same work order within 30 minutes
- Track which WOs have been acted on in this heartbeat cycle
- If the same condition persists across 3 heartbeats, escalate instead of repeating

## Step 4: If nothing needs attention
Reply HEARTBEAT_OK — take no actions, send no messages.

## Time Rules
- Never send SMS or make calls between 10 PM and 7 AM UNLESS the work order priority is EMERGENCY
- Weekends: only act on EMERGENCY and HIGH priority work orders
