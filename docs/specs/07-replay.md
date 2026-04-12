# 07 — Time Travel (Event Replay)

## Goal

Implement a time-travel view (`/time-travel`) that lets admins rewind the audit log to any point in time using a date-time slider. The query reconstructs entity state at timestamp T by selecting the most recent event for each entity up to T.

## Inputs / Outputs / Invariants

- **Input:** Target timestamp T (from the slider), optional entity type and service filters.
- **Output:** List of entities with their state as of timestamp T, plus the event timeline up to T.
- **Invariants:**
  - Query: `SELECT DISTINCT ON (entity_type, entity_id) * FROM events WHERE created_at <= $T ORDER BY entity_type, entity_id, created_at DESC`.
  - Rewinding to before any events exist returns an empty result.
  - Rewinding to the current moment returns the same view as `/audit`.
  - The slider range is bounded by the earliest and latest event timestamps.
  - Time travel is read-only — no mutations.

## Enumerated Test Cases

### Happy path
1. With events at T1, T2, T3 — rewinding to T2 shows entity states as of T2, excluding T3 events.
2. Rewinding to T3 (latest) shows current state.
3. Slider minimum is set to the earliest event's `createdAt`.
4. Slider maximum is set to the current time.
5. Filtering by service during time travel shows only events from that service up to T.
6. Each entity shows its most recent `after` state at the selected timestamp.

### Edge / failure cases
7. Rewinding to a timestamp before any events returns empty state with a "No events before this time" message.
8. Rewinding to the exact timestamp of an event includes that event (inclusive `<=`).
9. Database with zero events — slider is disabled, page shows "No audit data yet."
10. Rapidly dragging the slider debounces queries (≤1 query per 300ms).

### Security
11. `/time-travel` is accessible only to admin (enforced by RBAC spec 03).
12. Time travel queries are read-only — the Server Action uses a SELECT, never INSERT/UPDATE/DELETE.

## Acceptance Criteria

- [ ] `/time-travel` page with date-time slider
- [ ] DISTINCT ON query reconstructs entity state at any T
- [ ] Admin-only access
- [ ] Debounced slider queries
- [ ] All 12 test cases have passing tests
