---
name: ema_authorization_request
description: Request authorization for spend that exceeds the NTE limit. Contacts the approver via call or SMS to get approval.
tools:
  - ema__trigger_outbound_call
  - ema__send_dispatch_notification
  - ema__check_nte_limit
  - ema__get_escalation_path
  - ema__get_work_order
  - ema__update_work_order
  - ema__log_agent_action
---

# Authorization Request

Get approval for spend that exceeds the Not-To-Exceed limit.

## When to use
- Estimated repair cost exceeds NTE limit
- Vendor reports scope change with higher cost (mid-job re-authorization)
- Any situation requiring financial approval before proceeding

## Process
1. Check NTE limit for this workspace/trade
2. Calculate overage (estimated cost - NTE)
3. Get the approval chain (escalation path for authorizations)
4. Contact the first approver:
   - Call for urgent/emergency
   - SMS for routine
5. Present: issue, location, original estimate, revised estimate, overage
6. Capture decision: approved / denied / modified amount
7. If approved → update WO, notify vendor to proceed
8. If denied → update WO, notify vendor to stop or do partial work
9. If no response → try next approver in chain

## Voice version
"Hi [name], this is EMA. We need authorization for a [issue] at [location]. The estimated cost is $[amount], which exceeds the pre-approved limit of $[NTE] by $[overage]. Do you approve?"

## SMS version
"Authorization needed: [issue] at [location]. Cost: $[amount] (limit: $[NTE]). Reply APPROVE or DENY."

## Rules
- Emergency life-safety issues: auto-approve up to 2x NTE, notify after
- Always log the authorization decision with approver name and timestamp
- If all approvers unresponsive: do NOT proceed. Hold the work order.
- Track authorization for audit: who approved, when, what amount
