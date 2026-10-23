import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDefinition } from "../diff.js";
import type { StateMachineDefinition } from "../definition.js";
import type { PatchOp } from "../ops.js";

const settings = { namespace: 'ns', asynchronous: false };
const oneEvent: StateMachineDefinition['events'] = [{ name: 'src', events: [{ id: 'go' }] }];

function def(
  state: StateMachineDefinition['state'],
  events: StateMachineDefinition['events'] = oneEvent,
): StateMachineDefinition {
  return { settings: { ...settings }, events: JSON.parse(JSON.stringify(events)), state };
}

test('add a leaf state → single state.add', () => {
  const prev = def({ name: 'Root' });
  const next = def({ name: 'Root', states: [{ name: 'S1' }] });
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'state.add', parent: 'Root', state: { name: 'S1' } },
  ] satisfies PatchOp[]);
});

test('remove a state with an inbound transition → transition.remove precedes state.remove', () => {
  const prev = def({
    name: 'Root',
    states: [
      { name: 'A', transitions: [{ event: 'go', nextState: 'B' }] },
      { name: 'B' },
    ],
  });
  const next = def({ name: 'Root', states: [{ name: 'A' }] });
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'transition.remove', state: 'A', index: 0 },
    { op: 'state.remove', name: 'B' },
  ] satisfies PatchOp[]);

  const removeTransitionIdx = ops.findIndex((o) => o.op === 'transition.remove');
  const removeStateIdx = ops.findIndex((o) => o.op === 'state.remove');
  assert.ok(removeTransitionIdx < removeStateIdx, 'transition.remove must come before state.remove');
});

test('reparent a state → state.nest', () => {
  const prev = def({ name: 'Root', states: [{ name: 'A' }, { name: 'B' }] });
  const next = def({ name: 'Root', states: [{ name: 'A', states: [{ name: 'B' }] }] });
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'state.nest', child: 'B', newParent: 'A' },
  ] satisfies PatchOp[]);
});

test('update kind → state.update with only the changed key', () => {
  const prev = def({ name: 'Root', states: [{ name: 'A' }] });
  const next = def({ name: 'Root', states: [{ name: 'A', kind: 'final' }] });
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'state.update', name: 'A', patch: { kind: 'final' } },
  ] satisfies PatchOp[]);
});

test('add a transition → transition.add', () => {
  const prev = def({ name: 'Root', states: [{ name: 'A' }, { name: 'B' }] });
  const next = def({
    name: 'Root',
    states: [{ name: 'A', transitions: [{ event: 'go', nextState: 'B' }] }, { name: 'B' }],
  });
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'transition.add', state: 'A', transition: { event: 'go', nextState: 'B' }, index: 0 },
  ] satisfies PatchOp[]);
});

test('add a parameter to an existing event → parameter.add', () => {
  const prev = def({ name: 'Root' }, [{ name: 'src', events: [{ id: 'go' }] }]);
  const next = def({ name: 'Root' }, [
    { name: 'src', events: [{ id: 'go', parameters: [{ name: 'x', type: 'int' }] }] },
  ]);
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'parameter.add', eventId: 'go', parameter: { name: 'x', type: 'int' }, index: 0 },
  ] satisfies PatchOp[]);
});

test('add a new event (parameter bundled) → event.add', () => {
  const prev = def({ name: 'Root' }, [{ name: 'src', events: [{ id: 'go' }] }]);
  const next = def({ name: 'Root' }, [
    {
      name: 'src',
      events: [{ id: 'go' }, { id: 'stop', parameters: [{ name: 'y', type: 'str' }] }],
    },
  ]);
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    {
      op: 'event.add',
      sourceIndex: 0,
      event: { id: 'stop', parameters: [{ name: 'y', type: 'str' }] },
      index: 1,
    },
  ] satisfies PatchOp[]);
});

test('settings change → settings.update with only changed keys', () => {
  const prev = def({ name: 'Root' });
  const next: StateMachineDefinition = {
    settings: { namespace: 'ns2', asynchronous: false },
    events: JSON.parse(JSON.stringify(oneEvent)),
    state: { name: 'Root' },
  };
  const ops = diffDefinition(prev, next);
  assert.deepStrictEqual(ops, [
    { op: 'settings.update', patch: { namespace: 'ns2' } },
  ] satisfies PatchOp[]);
});

test('identical definitions → no ops', () => {
  const prev = def({ name: 'Root', states: [{ name: 'A', transitions: [{ event: 'go' }] }] });
  const next = def({ name: 'Root', states: [{ name: 'A', transitions: [{ event: 'go' }] }] });
  assert.deepStrictEqual(diffDefinition(prev, next), []);
});
