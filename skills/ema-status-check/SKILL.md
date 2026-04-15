---
name: ema_status_check
description: Check on someone's status regarding a work order. Used when ETA has passed, vendor hasn't checked in, or any situation where we need a status update from a person.
tools:
  - ema__trigger_outbound_call
  - ema__send_dispatch_notification
  - ema__read_work_orders
  - ema__get_work_order
  - ema__update_work_order
  - ema__log_agent_action
---

# Status Check

Check on someone's status regarding an active work order.

## When to use
- Vendor ETA has passed and no check-in recorded
- Vendor has been on-site for an unusually long time
- Requester hasn't responded to a previous notification
- Any time we need to verify someone's current situation

## Process
1. Determine WHO to check on (vendor, requester, approver)
2. Determine the CHANNEL (call first for urgent, SMS for routine)
3. Make contact and ask for status
4. Record the response
5. Take action based on response (update ETA, re-dispatch, escalate)

## Voice version
"Hi [name], this is EMA checking in about the [issue] at [location]. [Specific question about status]."

## SMS version
"Hi [name], checking on the [issue] at [location]. [Question]. Reply or call [number]."

## Rules
- For vendors: call if ETA passed by more than 15 minutes. SMS if less.
- For requesters: always SMS first, call only if no response in 30 min.
- Never call between 10 PM and 7 AM unless emergency.
- Log every status check to the incident timeline.
- If no response after 2 attempts: escalate to next person.
