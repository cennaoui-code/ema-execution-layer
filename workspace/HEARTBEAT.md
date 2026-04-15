# Heartbeat — Execution Layer Rules

Every heartbeat, execute these DETERMINISTIC rules in order. Do NOT improvise or add actions not listed here.

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
