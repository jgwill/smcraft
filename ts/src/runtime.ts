/**
 * State Machine Runtime Engine (Spec 61)
 *
 * Provides Context, State, Event, Observer, and TransitionHelper
 * for executing state machines at runtime.
 */

// --- State ---

export enum StateKind {
  LEAF = "leaf",
  COMPOSITE = "composite",
  ROOT = "root",
  FINAL = "final",
  PARALLEL = "parallel",
  HISTORY = "history",
}

export class State {
  name: string;
  kind: StateKind;
  parent: State | null;

  constructor(name: string, kind: StateKind = StateKind.LEAF, parent: State | null = null) {
    this.name = name;
    this.kind = kind;
    this.parent = parent;
  }

  onEntry(_context: ContextBase): void {}
  onExit(_context: ContextBase): void {}
}

// --- Observer ---

export interface IObserver {
  onEntry(contextName: string, stateName: string): void;
  onExit(contextName: string, stateName: string): void;
  onTransitionBegin(contextName: string, statePrev: string, stateNext: string, transitionName: string): void;
  onTransitionEnd(contextName: string, statePrev: string, stateNext: string, transitionName: string): void;
  onTimerStart(contextName: string, timerName: string, duration: number): void;
  onTimerStop(contextName: string, timerName: string): void;
}

export class ObserverNull implements IObserver {
  private static _instance: ObserverNull;

  static instance(): ObserverNull {
    if (!ObserverNull._instance) ObserverNull._instance = new ObserverNull();
    return ObserverNull._instance;
  }

  onEntry(): void {}
  onExit(): void {}
  onTransitionBegin(): void {}
  onTransitionEnd(): void {}
  onTimerStart(): void {}
  onTimerStop(): void {}
}

export class ObserverConsole implements IObserver {
  private static _instance: ObserverConsole;

  static instance(): ObserverConsole {
    if (!ObserverConsole._instance) ObserverConsole._instance = new ObserverConsole();
    return ObserverConsole._instance;
  }

  onEntry(contextName: string, stateName: string): void {
    console.log(`${contextName}: enter ${stateName}`);
  }
  onExit(contextName: string, stateName: string): void {
    console.log(`${contextName}: exit ${stateName}`);
  }
  onTransitionBegin(contextName: string, statePrev: string, stateNext: string, transitionName: string): void {
    console.log(`${contextName}: transition begin ${statePrev} -> ${stateNext} [${transitionName}]`);
  }
  onTransitionEnd(contextName: string, statePrev: string, stateNext: string, transitionName: string): void {
    console.log(`${contextName}: transition end ${statePrev} -> ${stateNext} [${transitionName}]`);
  }
  onTimerStart(contextName: string, timerName: string, duration: number): void {
    console.log(`${contextName}: timer start ${timerName} (${duration}ms)`);
  }
  onTimerStop(contextName: string, timerName: string): void {
    console.log(`${contextName}: timer stop ${timerName}`);
  }
}

// --- Transition Helper ---

export class TransitionHelper {
  static findCommonAncestor(stateA: State, stateB: State): State | null {
    const ancestorsA = new Set<string>();
    let s: State | null = stateA;
    while (s) {
      ancestorsA.add(s.name);
      s = s.parent;
    }
    s = stateB;
    while (s) {
      if (ancestorsA.has(s.name)) return s;
      s = s.parent;
    }
    return null;
  }

  static processTransitionBegin(
    context: ContextBase,
    statePrev: State,
    stateNext: State,
    transitionName: string,
  ): void {
    context.transitionName = transitionName;
    const lca = TransitionHelper.findCommonAncestor(statePrev, stateNext);
    TransitionHelper.walkChainExit(context, statePrev, lca);
    context.observer.onTransitionBegin(context.name, statePrev.name, stateNext.name, transitionName);
  }

  static processTransitionEnd(
    context: ContextBase,
    statePrev: State,
    stateNext: State,
  ): void {
    const lca = TransitionHelper.findCommonAncestor(statePrev, stateNext);
    TransitionHelper.walkChainEntry(context, stateNext, lca);
    context.observer.onTransitionEnd(context.name, statePrev.name, stateNext.name, context.transitionName);
    context.transitionName = "";
    if (stateNext.kind === StateKind.FINAL) {
      context.onEnd();
    }
  }

  private static walkChainExit(context: ContextBase, stateFrom: State | null, stateTo: State | null): void {
    if (!stateFrom || stateFrom === stateTo) return;
    context.observer.onExit(context.name, stateFrom.name);
    stateFrom.onExit(context);
    if (stateFrom.parent && stateFrom.parent !== stateTo) {
      TransitionHelper.walkChainExit(context, stateFrom.parent, stateTo);
    }
  }

  private static walkChainEntry(context: ContextBase, stateTo: State, stateFrom: State | null): void {
    const path: State[] = [];
    let s: State | null = stateTo;
    while (s && s !== stateFrom) {
      path.push(s);
      s = s.parent;
    }
    for (let i = path.length - 1; i >= 0; i--) {
      context.observer.onEntry(context.name, path[i].name);
      path[i].onEntry(context);
    }
  }
}

// --- Context ---

export type EndHandler = (context: ContextBase) => void;

export abstract class ContextBase {
  name: string;
  transitionName = "";
  observer: IObserver = ObserverNull.instance();
  private endHandlers: EndHandler[] = [];
  private children: ContextBase[] = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(name = "Context") {
    this.name = name;
  }

  setObserver(observer: IObserver): void {
    this.observer = observer;
    for (const child of this.children) {
      child.setObserver(observer);
    }
  }

  registerEndHandler(handler: EndHandler): void {
    this.endHandlers.push(handler);
  }

  onEnd(): void {
    for (const handler of this.endHandlers) {
      handler(this);
    }
  }

  addChild(child: ContextBase): void {
    this.children.push(child);
  }

  startTimer(timerName: string, durationMs: number, callback: () => void): void {
    this.stopTimer(timerName);
    const id = setTimeout(callback, durationMs);
    this.timers.set(timerName, id);
    this.observer.onTimerStart(this.name, timerName, durationMs);
  }

  stopTimer(timerName: string): void {
    const id = this.timers.get(timerName);
    if (id !== undefined) {
      clearTimeout(id);
      this.timers.delete(timerName);
      this.observer.onTimerStop(this.name, timerName);
    }
  }

  stopAllTimers(): void {
    for (const name of this.timers.keys()) {
      this.stopTimer(name);
    }
  }

  abstract enterInitialState(): void;

  serialize(): Record<string, unknown> {
    return { state: (this as unknown as Context).stateCurrent?.name ?? null };
  }

  deserialize(data: Record<string, unknown>): void {
    const stateName = data.state as string;
    if (stateName) this.setState(stateName);
  }

  setState(_stateName: string): void {}
}

export class Context extends ContextBase {
  stateCurrent: State | null = null;
  statePrevious: State | null = null;
  stateNext: State | null = null;
  stateHistory: State | null = null;

  constructor(name = "Context") {
    super(name);
  }

  enterInitialState(): void {}

  leaveCurrentState(): void {
    let s: State | null = this.stateCurrent;
    while (s) {
      this.observer.onExit(this.name, s.name);
      s.onExit(this);
      s = s.parent;
    }
  }

  saveState(): void {
    this.stateHistory = this.stateCurrent;
  }
}

export class ContextAsync extends Context {
  maxEvents: number;
  private eventQueue: Array<{ handler: (...args: unknown[]) => void; args: unknown[] }> = [];
  private processing = false;

  constructor(name = "Context", maxEvents = 1024) {
    super(name);
    this.maxEvents = maxEvents;
  }

  scheduleEvent(handler: (...args: unknown[]) => void, ...args: unknown[]): void {
    this.eventQueue.push({ handler, args });
    if (!this.processing) {
      this.processing = true;
      queueMicrotask(() => this.processEvents());
    }
  }

  private processEvents(): void {
    let processed = 0;
    while (processed < this.maxEvents && this.eventQueue.length > 0) {
      const event = this.eventQueue.shift()!;
      try {
        event.handler(...event.args);
      } catch (e) {
        console.error(`Error processing event in ${this.name}:`, e);
      }
      processed++;
    }
    if (this.eventQueue.length > 0) {
      queueMicrotask(() => this.processEvents());
    } else {
      this.processing = false;
    }
  }
}
