import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDefinition } from "../diff.js";
import { applyPatchOps } from "../apply.js";
import type { StateMachineDefinition, StateDef } from "../definition.js";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function findState(root: StateDef, name: string): StateDef | null {
  if (root.name === name) return root;
  for (const child of root.states ?? []) {
    const found = findState(child, name);
    if (found) return found;
  }
  return null;
}

function assertRoundTrip(prev: StateMachineDefinition, next: StateMachineDefinition, label: string): void {
  const ops = diffDefinition(prev, next);
  const applied = applyPatchOps(prev, ops);
  assert.deepStrictEqual(applied, next, `round-trip failed for: ${label}`);
  // diff must not mutate its inputs
  assert.notStrictEqual(applied, next);
}

// --- hand-written pairs ---------------------------------------------------

const settings = { namespace: 'ns', asynchronous: false };
const events = [{ name: 'src', events: [{ id: 'go', parameters: [{ name: 'x', type: 'int' }] }] }];

function base(state: StateDef): StateMachineDefinition {
  return { settings: clone(settings), events: clone(events), state };
}

const handPairs: { label: string; prev: StateMachineDefinition; next: StateMachineDefinition }[] = [
  {
    label: 'add leaf',
    prev: base({ name: 'Root' }),
    next: base({ name: 'Root', states: [{ name: 'A' }] }),
  },
  {
    label: 'remove state with inbound transition',
    prev: base({
      name: 'Root',
      states: [{ name: 'A', transitions: [{ event: 'go', nextState: 'B' }] }, { name: 'B' }],
    }),
    next: base({ name: 'Root', states: [{ name: 'A' }] }),
  },
  {
    label: 'reparent B under A',
    prev: base({ name: 'Root', states: [{ name: 'A' }, { name: 'B' }] }),
    next: base({ name: 'Root', states: [{ name: 'A', states: [{ name: 'B' }] }] }),
  },
  {
    label: 'nested composite: add child + transition + kind + action',
    prev: base({
      name: 'Root',
      states: [{ name: 'A', states: [{ name: 'A1' }] }, { name: 'B' }],
    }),
    next: base({
      name: 'Root',
      states: [
        {
          name: 'A',
          kind: 'normal',
          states: [{ name: 'A1' }, { name: 'A2' }],
          transitions: [{ event: 'go', nextState: 'B' }],
          onEntry: { actions: [{ action: 'code', code: 'enterA()' }] },
        },
        { name: 'B', description: 'terminal' },
      ],
    }),
  },
  {
    label: 'settings + event + parameter growth',
    prev: base({ name: 'Root' }),
    next: {
      settings: { namespace: 'ns', asynchronous: true, name: 'M', description: 'd' },
      events: [
        { name: 'src', events: [{ id: 'go', parameters: [{ name: 'x', type: 'int' }, { name: 'z', type: 'bool' }] }] },
        { name: 'timer', events: [{ id: 'tick' }] },
      ],
      state: { name: 'Root' },
    },
  },
  {
    label: 'deep reparent with descendants + removal',
    prev: base({
      name: 'Root',
      states: [
        { name: 'A', states: [{ name: 'A1', states: [{ name: 'A1a' }] }] },
        { name: 'B' },
        { name: 'Doomed', transitions: [{ event: 'go' }] },
      ],
    }),
    next: base({
      name: 'Root',
      states: [
        { name: 'A' },
        { name: 'B', states: [{ name: 'A1', states: [{ name: 'A1a', kind: 'final' }] }] },
      ],
    }),
  },
];

for (const { label, prev, next } of handPairs) {
  test(`round-trip (hand): ${label}`, () => {
    assertRoundTrip(prev, next, label);
  });
}

test('identity diff is empty and apply is a no-op clone', () => {
  const d = handPairs[3].next;
  assert.deepStrictEqual(diffDefinition(d, d), []);
  assert.deepStrictEqual(applyPatchOps(d, []), d);
  assert.notStrictEqual(applyPatchOps(d, []), d);
});

test('null prev builds next from the empty baseline', () => {
  const next = handPairs[3].next;
  const baseline: StateMachineDefinition = {
    settings: { namespace: '', asynchronous: false },
    events: [],
    state: { name: next.state.name, states: [] },
  };
  const applied = applyPatchOps(baseline, diffDefinition(null, next));
  assert.deepStrictEqual(applied, next);
});

test('runtime.* ops are ignored by applyPatchOps', () => {
  const d = base({ name: 'Root', states: [{ name: 'A' }] });
  const applied = applyPatchOps(d, [
    { op: 'runtime.enter', state: 'A', from: 'Root', eventId: 'go' },
    { op: 'runtime.exit', state: 'A' },
  ]);
  assert.deepStrictEqual(applied, d);
});

// --- seeded generator (variety by index, no Math.random) ------------------

function makePair(i: number): { prev: StateMachineDefinition; next: StateMachineDefinition } {
  const prev: StateMachineDefinition = {
    settings: { namespace: `ns${i}`, asynchronous: i % 2 === 0 },
    events: [
      { name: 'ui', events: [{ id: `click${i}`, parameters: [{ name: 'x', type: 'int' }] }] },
    ],
    state: {
      name: 'Root',
      states: [
        {
          name: 'Idle',
          transitions: [
            { event: `click${i}`, nextState: 'Active' },
            { event: `click${i}`, nextState: 'Temp' },
          ],
        },
        { name: 'Active', states: [{ name: 'Sub1' }] },
        { name: 'Temp' },
      ],
    },
  };

  const next = clone(prev);

  // A (always): change a scalar on Idle
  findState(next.state, 'Idle')!.description = `d${i}`;

  // B: append a new leaf under Root
  if (i % 2 === 0) {
    next.state.states!.push({ name: `New${i}` });
  }

  // C: append a transition on Active
  if (i % 3 === 0) {
    const active = findState(next.state, 'Active')!;
    active.transitions = [...(active.transitions ?? []), { event: `click${i}`, nextState: 'Idle' }];
  }

  // D: append a new event + parameter to source 0
  if (i % 4 === 0) {
    next.events[0].events!.push({ id: `hover${i}`, parameters: [{ name: 'y', type: 'str' }] });
  }

  // E: reparent Sub1 from Active to Idle (append; prune emptied parent)
  if (i % 5 === 0) {
    const active = findState(next.state, 'Active')!;
    const sub = active.states?.find((s) => s.name === 'Sub1');
    if (sub) {
      active.states = active.states!.filter((s) => s.name !== 'Sub1');
      if (active.states.length === 0) delete active.states;
      const idle = findState(next.state, 'Idle')!;
      idle.states = [...(idle.states ?? []), sub];
    }
  }

  // F: add an onEntry action to Active
  if (i % 7 === 0) {
    findState(next.state, 'Active')!.onEntry = { actions: [{ action: 'code', code: `enter(${i})` }] };
  }

  // G: change settings.asynchronous + add a name
  if (i % 6 === 0) {
    next.settings.asynchronous = !next.settings.asynchronous;
    next.settings.name = `machine${i}`;
  }

  // H: remove Temp and its inbound transition on Idle
  if (i % 9 === 0) {
    const idle = findState(next.state, 'Idle')!;
    idle.transitions = (idle.transitions ?? []).filter((t) => t.nextState !== 'Temp');
    if (idle.transitions.length === 0) delete idle.transitions;
    next.state.states = next.state.states!.filter((s) => s.name !== 'Temp');
  }

  return { prev, next };
}

test('round-trip (generated): 40 seeded pairs (forward transforms)', () => {
  for (let i = 0; i < 40; i++) {
    const { prev, next } = makePair(i);
    assertRoundTrip(prev, next, `generated #${i}`);
    // identity
    assert.deepStrictEqual(diffDefinition(prev, prev), [], `identity #${i}`);
    assert.deepStrictEqual(diffDefinition(next, next), [], `identity next #${i}`);
  }
});
