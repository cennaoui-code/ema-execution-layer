---
name: ema_verification
description: Verify completed repairs by contacting tenants. Determine if the issue is resolved, partially fixed, or not fixed. Re-dispatch if needed.
tools:
  - read_work_orders
  - update_work_order
  - trigger_outbound_call
  - send_sms
  - find_vendors
---

# EMA Verification

After a vendor completes work, verify with the tenant that the issue is resolved.

## When to trigger

- Work order status changed to COMPLETED
- 2-4 hours after vendor check-out (for non-emergency)
- 30 minutes after vendor check-out (for emergency)

## Process

1. Call `trigger_outbound_call` with type `verification` and the tenant's phone number
2. The voice agent will ask: "Is everything working now?"
3. Based on response:
   - **RESOLVED** → `update_work_order` to close. `send_sms` confirmation to tenant.
   - **PARTIALLY RESOLVED** → `update_work_order` with notes. Schedule follow-up work order.
   - **NOT RESOLVED** → `find_vendors` and `trigger_outbound_call` with type `vendor_briefing` to re-dispatch.
   - **NEW ISSUE** → Create new work order for the new problem.

## Rules

- Only verify during reasonable hours (8 AM - 9 PM) unless it was an emergency
- If tenant doesn't answer, try SMS: "Hi, this is EMA following up on the repair at [unit]. Is everything working? Reply YES or NO."
- If no response within 24 hours, mark as verified (assumed resolved) and note in work order
- Never call the same tenant more than twice for verification
