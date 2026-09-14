# Tool calls and recovery

These examples target pi-spoke 0.1.0. The connected server's schemas and actual
responses are authoritative. Calls reject unknown fields. Use the host's tool
namespace, and read `structuredContent`, including `error` when `isError: true`.

## Discover and spawn

`spoke_catalog` for an exact model reference:

```json
{"kind":"models","limit":25}
```

`spoke_catalog` for workspace capabilities and permission ceilings:

```json
{"kind":"tools","cwd":"/absolute/path/to/workspace"}
```

`spoke_spawn` for a scoped read-only investigation:

```json
{
  "request_key": "config-review-UNIQUE",
  "task": "Review src/config.ts and its error handling. Identify concrete unhandled edge cases, cite file locations, and explain their impact. Leave files unchanged.",
  "cwd": "/absolute/path/to/workspace",
  "model": {"provider":"PROVIDER_FROM_CATALOG","id":"MODEL_ID_FROM_CATALOG"},
  "tools": ["read","grep","find","ls"],
  "permissions": {"file_write_roots":[],"shell_write_roots":[]},
  "project_context": "agents"
}
```

Choose a unique request key for each logical spawn or send operation (maximum
128 characters). Save the request before sending; retrying the same accepted input
returns its original receipt, which may still say `starting` after the run ends.
Use observation to learn current state. Changed input requires a new key and a
deliberate new operation, after accounting for earlier work.

Optional spawn fields:

| Field | Use |
|---|---|
| `thinking` | An explicitly supported setting; omission keeps the SDK default. |
| `tools: []` | Reasoning from supplied context with no execution/file tools. |
| `context_files` | Explicit readable files; combined project context is limited to 64 KiB. |
| `suggested_skills` | IDs returned by `spoke_catalog` with `kind: "skills"` and `cwd`; choose only entries available for model invocation. |
| `project_context: "none"` | Omit automatic ancestor `AGENTS.md` context when appropriate to the assignment. |
| `attachments` | Up to four `{"type":"image","path":"/absolute/path/image.png"}` inputs; local PNG, JPEG, or WebP, at most 10 MiB each, with an image-capable model. |
| `limits` | Optional positive `wall_time_ms` and `max_turns`, within operator ceilings. Omission uses operator defaults; these are not monetary budgets. |

For a structured edit, change the task, add the required `edit`/`write` tool, and
set `permissions.file_write_roots` to existing absolute directories within the
catalog's file-write ceiling. File-write roots require a file-mutation tool and
vice versa. Keep `shell_write_roots: []`. A permission failure calls for resolving
the scope or operator ceiling, not trying to route the write through another tool.

## Observe and page output

`spoke_observe` for a first observation:

```json
{"run_id":"RUN_ID_FROM_RECEIPT","view":"summary","after_seq":0,"wait_ms":15000}
```

For subsequent observations, use the returned `next_after_seq`. An event or open
question can make a wait return immediately. Read `state`, `reason`,
`cleanup_status`, `effective_config`, `durability_error`, `questions`, and
truncation flags. `view: "events"` uses the same cursor and wait fields; `limit`
is at most 100. Process available events before waiting again.

`spoke_observe` to retrieve output from the beginning:

```json
{"run_id":"RUN_ID_FROM_RECEIPT","view":"output","offset_bytes":0,"max_bytes":16384}
```

While `truncated` is true, request the next page using `next_offset_bytes`. These
are UTF-8 byte offsets; use returned offsets rather than counting characters.
Output view accepts only `run_id`, `view`, `offset_bytes`, and `max_bytes`.
An empty output page during an active run is not evidence of completion.

## Reply, steer, continue, or cancel

`spoke_send` to answer one currently open question:

```json
{
  "kind": "reply",
  "request_key": "config-answer-UNIQUE",
  "run_id": "RUN_ID_FROM_OBSERVATION",
  "question_id": "QUESTION_ID_FROM_OBSERVATION",
  "message": "Include malformed JSON and missing required paths in this review. Keep the current read-only scope."
}
```

Use the current question ID from the same run. Reading a question does not
acknowledge it. A reply supplies information within existing authorization; if a
question requires a user decision you cannot infer, obtain that decision first.

`spoke_send` to change direction while a run is `running`:

```json
{
  "kind": "steer",
  "request_key": "config-focus-UNIQUE",
  "run_id": "RUN_ID_FROM_OBSERVATION",
  "message": "Prioritize configuration loading errors and report the strongest reproducible finding first."
}
```

Steering is queued and does not promise to interrupt a tool already executing.
Check `steer_delivered`, `reply_delivered`, or the corresponding uncertain-delivery
events; a `waiting_input` run needs a correlated reply instead of steering.

`spoke_sessions` to inspect continuation eligibility:

```json
{"cwd":"/absolute/path/to/workspace","limit":25}
```

Choose the intended session using its ID and saved context. Check `active_run_id`,
`latest_run_id`, `checkpoint_available`, and `continuation_eligible`; more entries
may require `next_cursor`. `revalidation_required` means eligibility is not an
admission guarantee.

`spoke_send` for an eligible continuation:

```json
{
  "kind": "continue",
  "request_key": "config-followup-UNIQUE",
  "session_id": "SESSION_ID_FROM_SESSIONS",
  "expected_last_run_id": "LATEST_RUN_ID_FROM_SESSIONS",
  "message": "Check whether the strongest finding also applies to the example configurations. Cite the relevant files."
}
```

Store and observe the new `run_id` returned by this call. Continuation keeps the
session's model, cwd, tool grant, write authority, and project-context policy.
Omitting `suggested_skills` retains the shortlist; an explicit array replaces it,
including `[]` to clear it. Attachments default to empty and limits to operator
defaults on each continuation; supply them again when needed. Other pinned context
or skill changes may prevent continuation.

`spoke_cancel`:

```json
{"run_id":"RUN_ID_FROM_RECEIPT","reason":"This investigation is no longer needed."}
```

Repeated cancellation is safe. If completion won the race, the run can remain
`completed`; if cleanup is unconfirmed, it remains `interrupted`.

## Respond to failures

Use the error code and `safe_to_retry_same_request` along with current state.
Separate a rejected request from an accepted run that later failed. An accepted
receipt is duplicate suppression, not an exactly-once guarantee for tools or
provider billing.

| Error or condition | Next action |
|---|---|
| `IDEMPOTENCY_CONFLICT` | Recover the original request; use a new key only for an intentional distinct operation. |
| `CAPACITY_EXCEEDED`, `SESSION_BUSY` | Observe existing work and retry only after capacity or session state changes. |
| `SESSION_STALE` | Refresh sessions, inspect the latest run, and reassess the follow-up. |
| `QUESTION_REPLY_REQUIRED` | Observe and send `kind: "reply"` with the exact pending question ID. |
| `QUESTION_CLOSED`, `RUN_NOT_ACTIVE` | Refresh state; the target may already have advanced or ended. |
| `MODEL_UNAVAILABLE`, `MODEL_NOT_ALLOWED`, `MODEL_CONFIGURATION_MISMATCH`, `UNSUPPORTED_THINKING` | Check model discovery and the requested setting. Report the mismatch; retain the user's explicit model choice unless they authorize an alternative. |
| `TOOL_NOT_ALLOWED`, `WRITE_SCOPE_REQUIRED`, `PERMISSION_DENIED`, `PROTECTED_PATH`, `PATH_NOT_ALLOWED` | Correct a mistaken request within the authorized task scope, or report the operator capability required. |
| `SKILL_READER_REQUIRED`, `SKILL_NOT_FOUND`, `SKILL_NAME_COLLISION` | Recheck skill discovery and the reader grant; revise the optional shortlist as appropriate. |
| `POLICY_CHANGED`, `RESOURCE_CHANGED` | Inspect what changed before deliberately starting a new session or revising an allowed skill shortlist. |
| `SESSION_NOT_RESUMABLE`, unconfirmed cleanup | Inspect checkpoint and cleanup evidence. A new run cannot be assumed safe to replay prior effects. |
| Sandbox unavailable or `SANDBOX_POLICY_UNSUPPORTED` | Report the unsupported execution policy. Use supported capabilities only when they still satisfy the task and existing authorization. |
| Uncertain delivery, `STATE_WRITE_FAILED`, `durability_error` | Preserve IDs and receipts, inspect available state, and resolve the uncertainty before more mutations. |

For unconfirmed cleanup, the operator must independently inspect uncertain work
and descendants before attesting recovery with the server stopped. Consult the
checkout's `docs/operations.md`; never issue `recover --acknowledge-cleanup` merely
to make a session eligible. Recovery attests cleanup and never replays work.
