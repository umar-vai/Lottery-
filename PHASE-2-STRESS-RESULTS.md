# Phase 2 Ticket Concurrency — Production Probe

Date: 2026-10-06

A controlled production concurrency probe exercised the real `purchase_event_ticket(...)` RPC against the same currently published event from two independent `pg_cron` workers.

## Safety model

Each worker:

1. recorded its starting profile balance and ticket/ledger counts,
2. called the real ticket purchase RPC,
3. held the transaction for 1.5 seconds after purchase so the event row lock stayed active,
4. deleted only the probe ticket and matching purchase ledger row,
5. restored the exact starting balance,
6. asserted balance, per-user ticket count, event ticket count, and ledger count had returned to baseline,
7. self-unscheduled.

Any failure would have aborted the whole worker transaction.

## Result

Both workers started at effectively the same instant.

- Worker 1: about **1.535 seconds**
- Worker 2: about **3.043 seconds**

The second worker took roughly one additional lock-hold interval, demonstrating that it waited behind the same event-row `FOR UPDATE` serialization boundary instead of racing through capacity/accounting checks.

Both jobs reported `succeeded`.

After the probe:

- active event ticket count returned to **11**,
- first probe account balance returned to its exact baseline,
- second probe account balance returned to its exact baseline,
- both per-user event ticket counts returned to baseline,
- both cron jobs had self-unscheduled,
- the temporary private probe helper was dropped.

No permanent test ticket or Draw Credit mutation remained.
