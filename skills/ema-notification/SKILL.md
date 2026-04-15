---
name: ema_notification
description: Inform someone of a work order state change. Vendor dispatched, vendor arrived, work completed, work order closed.
tools:
  - ema__send_dispatch_notification
  - ema__get_work_order
  - ema__log_agent_action
---

# Notification

Inform someone that a work order state has changed.

## When to use
- Vendor has been dispatched (notify requester of vendor + ETA)
- Vendor has arrived on-site (notify requester)
- Work has been completed (notify requester)
- Work order has been closed (notify all stakeholders)
- Any state transition that a person needs to know about

## Templates (use send_dispatch_notification tool)
- vendor_dispatched: vendor name + ETA
- vendor_arrived: vendor on-site
- work_completed: work done, verification coming
- verification_resolved: confirmed fixed, WO closed
- no_show_alert: vendor didn't show, working on it

## Rules
- Use SMS for all notifications (not calls — notifications are informational)
- Requester gets notified at EVERY state change
- PM gets notified only for: emergencies, escalations, closures
- Never send duplicate notifications for the same event
- Always include: what changed + what happens next
