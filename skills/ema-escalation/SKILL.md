---
name: ema_escalation
description: Escalate when normal process has failed. All vendors declined, no-show with no response, SLA breach approaching, any situation requiring human intervention.
tools:
  - ema__trigger_outbound_call
  - ema__send_dispatch_notification
  - ema__get_escalation_path
  - ema__get_oncall_schedule
  - ema__get_work_order
  - ema__log_agent_action
---

# Escalation

Alert the next person in the escalation chain when normal process has failed.

## When to use
- All vendors declined or no-showed
- No response from vendor after multiple attempts
- SLA deadline approaching with no progress
- Authorization denied and work is critical
- Any situation the agent cannot resolve autonomously

## Process
1. Get the escalation path for this property/workspace
2. Get the on-call schedule to find who's responsible
3. Contact the first person in the chain (call for urgent, SMS for non-urgent)
4. If no response within timeout → try next person
5. Log every escalation attempt to timeline

## Voice version
"Hi [name], this is EMA. We have a [priority] [issue] at [location] that needs your attention. [What happened]. [What we need from you]."

## SMS version
"Urgent: [issue] at [location] requires attention. [What happened]. [What we need]. Please respond ASAP."

## Rules
- Always use the escalation path — never skip levels unless life safety
- Life safety emergencies: call ALL levels simultaneously
- Log every attempt: who was called, when, response
- Include all context: what happened, what was tried, what failed
- Never give up — keep escalating until someone responds
