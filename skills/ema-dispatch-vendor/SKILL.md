---
name: ema_dispatch_vendor
description: Smallest dispatch TaskFlow — given a workorder.dispatched event, iterate the ranked vendor list, call each via trigger_outbound_call, capture accept/decline/no-answer, update WoRuntimeState. Stops on first acceptance or all-vendors-exhausted.
tools:
  - get_work_order
  - find_vendors
  - trigger_outbound_call
  - update_work_order
  - log_agent_action
  - schedule_cron
  - update_runtime_state   # C5: shipped Apr 25, single endpoint w/ 4 actions
---

# EMA Dispatch Vendor — TaskFlow

Triggered by a `workorder.dispatched` event from the openclaw_event_queue (HEARTBEAT.md Step 0.5). Owns the dispatch happy path: pick a vendor, call them, handle the outcome, advance state.

## Inputs (from event payload)

- `workOrderId` — the WO that just transitioned to DISPATCHING
- `workspaceId` — workspace context
- `incidentId` — optional, for timeline fan-out

## Step-by-step

### Step 1 — Read WO state
Call `get_work_order` with `workOrderId`. Extract: `priority`, `dispatchTrade`, `nteAmount`, `tenantPhone`.

Then call `update_runtime_state` with `action="upsertOnDispatch"` and the same `workOrderId` + `workspaceId`. This either creates the runtime row (currentState=DISPATCHING, vendorAttemptIndex=0) or returns the existing one (preserves vendorAttemptIndex from a prior attempt). The response gives you `vendorAttemptIndex` — use that as the index for Step 2.

### Step 2 — Pick the next vendor
Call `find_vendors` with `trade=dispatchTrade`. The result is a ranked list. Skip the first `vendorAttemptIndex` candidates (they were already tried). Take the next.

If no vendors remain → ALL_VENDORS_EXHAUSTED. Call `log_agent_action` with `actionType="ALL_VENDORS_EXHAUSTED"`. STOP.

### Step 3 — Outbound call to vendor
Call `trigger_outbound_call` with:
- `phone`: vendor.phone
- `callType`: "vendor_briefing"
- `context`: { workOrderId, summary, priority, nteAmount, tenantPhone, vendorName: vendor.name }
- `workOrderId`, `workspaceId`, `incidentId`

This is a real LiveKit-backed call. The result comes back asynchronously — the LK agent posts back to the WO via state-change endpoints. For Phase 2 mock-mode (eval), the response is one of: `accepted` / `declined` / `no_answer`.

### Step 4 — Handle outcome

#### Outcome: accepted
- Call `update_work_order` with `vendorName=vendor.name`, `vendorEta=<from-call>`, `dispatchedAt=now`, `workflowStatus="ASSIGNED"`
- Call `update_runtime_state` with `action="transition", newState="ASSIGNED", metadataMerge={vendorId, vendorName, eta}`
- Call `log_agent_action` with `actionType="VENDOR_ACCEPTED"` and metadata={vendorId, vendorName, eta}
- Call `schedule_cron` for `eta-reminder` (firesAt = ETA - 15min)
- Call `schedule_cron` for `arrival-check` (firesAt = ETA)
- Call `schedule_cron` for `noshow-trigger` (firesAt = ETA + 15min, or +10min for EMERGENCY)
- STOP.

#### Outcome: declined
- Call `log_agent_action` with `actionType="VENDOR_DECLINED"` and metadata={vendorId, reason if given}
- Call `update_runtime_state` with `action="bumpVendorAttempt"` to advance the index by 1 atomically
- Re-enter Step 2 with the new index. (Same heartbeat cycle — don't wait.)

#### Outcome: no_answer
- Call `log_agent_action` with `actionType="VENDOR_NO_ANSWER"` and metadata={vendorId}
- Call `update_runtime_state` with `action="bumpVendorAttempt"` to advance the index by 1 atomically
- Re-enter Step 2 with the new index.

## Suppression / safety

- Maximum vendor attempts per heartbeat cycle: 5. After 5 declines/no-answers in one cycle, log "DISPATCH_BACKOFF" and STOP — let the next heartbeat continue.
- Never call the same vendor twice in the same dispatch attempt (vendorAttemptIndex prevents this).
- If WO status is already not in (CREATED, TRIAGED, DISPATCHING) when this skill enters Step 1, log "DISPATCH_RACE" and STOP — another path already handled this WO.

## Phase 2 mock-mode (for evals)

When `EMA_MOCK_LIVEKIT=true` is set in the workspace env, `trigger_outbound_call` returns a synthetic response based on the vendor's index:
- Index 0 → `declined`
- Index 1 → `no_answer`
- Index 2 → `accepted` with eta = now + 45min

This proves the multi-attempt loop works end-to-end without real phones. Real LK wiring is P2.5.

## Eval scenarios this supports

1. Single vendor accepts → 1 vendor call, 3 crons scheduled, WO state ASSIGNED.
2. First vendor declines, second accepts → 2 calls, attempt index bumps once.
3. All vendors exhausted → log + escalate via ema_escalation skill.
4. Idempotency: replay of the same `workorder.dispatched` event is queue-side no-op.
5. Race: WO already ASSIGNED when skill enters → DISPATCH_RACE log, no double-call.
