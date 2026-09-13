# pi-spoke

pi-spoke connects a main agent with independent workers for delegated work. Its language distinguishes responsibility, conversation identity, execution, and authority.

## Language

**Operator**:
The person who configures credentials, allowed capabilities, permission ceilings, and operational limits.

**Main agent**:
The host agent responsible for the objective, delegation, coordination, verification, and integration of worker results.
_Avoid_: Bridge planner, router

**Worker**:
An independent agent responsible for its local method within an assignment and granted capabilities.
_Avoid_: Fixed role

**Task**:
The desired outcome assigned to a worker.
_Avoid_: Run, session

**Session**:
A persistent worker conversation with a fixed model, working directory, tool grant, write authority, and project-context policy.
_Avoid_: Process, run

**Run**:
One host-requested execution within a session, potentially containing many model and tool turns.
_Avoid_: Task, session, turn

**Suggested skills**:
An optional shortlist of expertise initially presented to a worker as metadata and locations.
_Avoid_: Required workflow, permission grant

**Project context**:
Explicitly scoped repository instructions and background supplied to a worker.
_Avoid_: Inherited main conversation

**Tool grant**:
The operations a worker is explicitly allowed to call.
_Avoid_: Write authority

**File-write roots**:
The directories in which a worker may perform authorized structured file mutations.
_Avoid_: Shell-write roots

**Shell-write roots**:
The project directories in which explicitly authorized shell execution may mutate files.
_Avoid_: File-write roots

**Safe checkpoint**:
A validated point in a saved conversation from which work may continue without unresolved tool-result obligations.
_Avoid_: Partial transcript

**Improvement proposal**:
A worker's suggestion for a reusable change, subject to deliberate evaluation by the main agent.
_Avoid_: Automatic learning
