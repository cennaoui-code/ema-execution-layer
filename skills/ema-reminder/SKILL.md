---
name: ema_reminder
description: Send a reminder about an upcoming event related to a work order. ETA approaching, scheduled appointment, upcoming shift change.
tools:
  - ema__send_dispatch_notification
  - ema__get_work_order
  - ema__log_agent_action
---

# Reminder

Send a reminder about an upcoming work-order-related event.

## When to use
- 15 minutes before vendor ETA
- Day before a scheduled appointment
- When a shift change is approaching and active WOs exist
- Any scheduled reminder created by a cron

## Process
1. Check the work order is still active (not already completed/cancelled)
2. Send reminder via SMS (default) or call (if configured)
3. Log the reminder to the incident timeline

## Templates
- ETA approaching: "Reminder: [vendor] should arrive at [location] in about 15 minutes."
- Scheduled appointment: "Reminder: [vendor] is scheduled at [location] tomorrow at [time]."
- Shift change: "Shift change in [time]. [count] active work orders. [summary of urgent ones]."

## Rules
- Always check WO status before sending — don't remind about completed WOs
- Use SMS only — reminders don't warrant a phone call
- One reminder per event — don't spam
