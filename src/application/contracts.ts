import { Execution } from '../domain/execution';
import type { ExecutionEvent } from './messaging';

export const EXECUTION_REPOSITORY = Symbol('EXECUTION_REPOSITORY');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface ExecutionRepository {
  findByOrderId(orderId: string): Promise<Execution | null>;
  saveIdempotently(
    execution: Execution,
    eventId: string,
    expectedVersion: number,
  ): Promise<'saved' | 'duplicate'>;
}

export interface EventPublisher {
  publish(event: ExecutionEvent): Promise<void>;
}
