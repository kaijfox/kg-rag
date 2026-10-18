import type { EventEnvelope, MachineMap } from '@kg/core';

export type ItemInfo = { label: string; text: string } | null;
export type Run = { start: EventEnvelope; events: EventEnvelope[] };
export type Overlay = {
  visits: Record<string, number>;
  moves: { from: string; to: string; count: number }[];
  stop: string | null;
  final: string | null;
  next?: string[];
};

export function escapeHtml(s: unknown): string;
export function renderTimeline(events: EventEnvelope[], itemInfo?: (id: string) => ItemInfo): string;
export function pathOverlay(map: MachineMap, events: EventEnvelope[]): Overlay;
export function nextOf(map: MachineMap, events: EventEnvelope[]): string[];
export function runsOf(events: EventEnvelope[]): Run[];
export function mermaidOf(map: MachineMap, overlay?: Overlay | null): string;
export function orderSessions<S extends { sessionId: string; startedAt: string }>(sessions: readonly S[]): S[];
export function pickRun(keys: readonly string[], current: string | null, follow: boolean): string | null;
export function diagramOf(map: MachineMap | null | undefined, run: EventEnvelope[]): string | null;
