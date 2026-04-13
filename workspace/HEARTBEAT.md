# Heartbeat Checklist

Every heartbeat, do the following in order:

## 1. Check active work orders
Call `read_work_orders` with status RUNNING. For each:

- **Vendor ETA passed + no check-in?** → Trigger no-show check call
- **ETA within 15 min + tenant not reminded?** → Send SMS reminder
- **Work completed + not verified?** → Schedule verification call (if 2+ hours since completion)
- **No vendor assigned?** → Find vendors and dispatch

## 2. Check emergencies
For any EMERGENCY priority work orders, check more aggressively:
- ETA passed + 15 min → immediate no-show check (don't wait 30 min)
- Verification within 30 min of completion (not 2 hours)

## 3. If nothing needs attention
Reply HEARTBEAT_OK — don't send any messages or take any actions.
