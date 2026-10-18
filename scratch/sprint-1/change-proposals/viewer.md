# Change proposals from @kg/viewer

1. Fixture `session-live-partial`: the cut-off second search has no `pipeline.started`. The 0.5.0/0.6.0 rule is that
   the runner writes `pipeline.started` first after `query` for every search; a live search therefore has it from the
   start. The fixture has `query` (seq 11) and `search.step` (seq 12) and nothing else for that search, so the viewer
   shows it flat and the live overlay (the case the diagram exists for) cannot be exercised on any fixture. Proposal:
   testkit inserts a `pipeline.started` after seq 11 (search, machine `similarity`, version `1`, topology
   `69bc55d30db24c90`, the payload of the other searches), renumbers seq, and the fixture README says so. The
   viewer tests would then add a live overlay case on the real fixture. Blocks nothing; the viewer works without it.

2. Non-search events and the machine map. `MachineMap` nodes carry `logs` (event types), and the viewer maps an
   ingest or eval event to the node whose `logs` contains its type. Nothing says a type is listed by one node only.
   Proposal: state the uniqueness rule in `core/src/machineMap.ts` (or make `validateMachineMap` reject a type listed
   by two nodes), since the mapping is otherwise first-wins by node order.

3. Failed runs. `pipeline.finished` says `state` is "the state that failed or `failed`", but the contract does not say
   whether a failed work state logs its `search.step`. A step that threw has no trace, so the failed state can have no
   visit. The viewer marks it as the stop without counting a visit and draws the path up to it. Proposal: one sentence
   in `events.ts` or the pipeline README saying so; the behaviour is already what the viewer assumes.

4. Card wording for `port`. `createViewerServer` returns an `http.Server` and takes `port?`, which the card does not
   connect to listening. The viewer listens on 127.0.0.1 when `port` is given and leaves listening to the caller
   otherwise. Proposal: the card says which of these is meant (and whether the host is configurable).
