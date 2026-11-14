import {
  Execution,
  ExecutionStatus,
  InvalidTransitionError,
} from './execution';

describe('Execution', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');

  it('executes the complete happy path', () => {
    const execution = Execution.create('order-1', now);
    expect(execution.snapshot).toMatchObject({
      orderId: 'order-1',
      status: ExecutionStatus.WAITING_DIAGNOSIS,
      version: 0,
    });
    execution.startDiagnosis(now);
    execution.completeDiagnosis('Trocar pastilhas', now);
    execution.startExecution(now);
    execution.complete(now);
    expect(execution.snapshot).toMatchObject({
      status: ExecutionStatus.COMPLETED,
      diagnosis: 'Trocar pastilhas',
      version: 4,
    });
  });

  it('restores and cancels active executions', () => {
    const execution = Execution.restore({
      orderId: 'order-2',
      status: ExecutionStatus.EXECUTING,
      version: 3,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    execution.cancel(now);
    expect(execution.snapshot.status).toBe(ExecutionStatus.CANCELLED);
  });

  it('records a failure', () => {
    const execution = Execution.create('order-3', now);
    execution.fail('mechanic unavailable', now);
    expect(execution.snapshot).toMatchObject({
      status: ExecutionStatus.FAILED,
      failureReason: 'mechanic unavailable',
    });
  });

  it.each([
    () => Execution.create(' '),
    () => {
      const value = Execution.create('order');
      value.startDiagnosis();
      value.completeDiagnosis(' ');
    },
    () => Execution.create('order').fail(' '),
  ])('rejects invalid values', (operation) => {
    expect(operation).toThrow(Error);
  });

  it('rejects an invalid transition and protects terminal states', () => {
    const execution = Execution.create('order');
    expect(() => execution.complete()).toThrow(InvalidTransitionError);
    execution.cancel();
    expect(() => execution.cancel()).toThrow(InvalidTransitionError);
  });
});
