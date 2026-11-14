import {
  EventPublisher,
  ExecutionRepository,
} from './contracts';
import {
  CommandType,
  ExecutionCommand,
  MESSAGE_SCHEMA_VERSION,
} from './messaging';
import { ProcessCommand } from './process-command';
import { Execution, ExecutionStatus } from '../domain/execution';

describe('ProcessCommand', () => {
  let repository: jest.Mocked<ExecutionRepository>;
  let publisher: jest.Mocked<EventPublisher>;
  let useCase: ProcessCommand;

  const command = (
    messageType: ExecutionCommand['messageType'],
    payload: ExecutionCommand['payload'] = {},
  ): ExecutionCommand => ({
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    messageId: 'event-1',
    messageType,
    aggregateId: 'order-1',
    correlationId: 'correlation-1',
    occurredAt: '2026-09-22T12:00:00.000Z',
    source: 'test',
    payload,
  });

  beforeEach(() => {
    repository = {
      findByOrderId: jest.fn(),
      saveIdempotently: jest.fn().mockResolvedValue('saved'),
    };
    publisher = { publish: jest.fn() };
    useCase = new ProcessCommand(repository, publisher);
  });

  it('runs diagnosis and publishes its result', async () => {
    repository.findByOrderId.mockResolvedValue(null);
    await expect(
      useCase.execute(
        command(CommandType.StartDiagnosis, { diagnosis: 'Alternador' }),
      ),
    ).resolves.toBe('processed');
    expect(repository.saveIdempotently).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'event-1',
      -1,
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'diagnosis.completed',
        payload: { diagnosis: 'Alternador' },
      }),
    );
  });

  it('uses a default diagnosis and handles duplicate events', async () => {
    repository.findByOrderId.mockResolvedValue(null);
    repository.saveIdempotently.mockResolvedValue('duplicate');
    await expect(
      useCase.execute(command(CommandType.StartDiagnosis)),
    ).resolves.toBe('duplicate');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('completes execution from diagnosed state', async () => {
    repository.findByOrderId.mockResolvedValue(
      restored(ExecutionStatus.DIAGNOSIS_COMPLETED, 2),
    );
    await useCase.execute(command(CommandType.StartExecution));
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'execution.completed' }),
    );
  });

  it('cancels an active execution', async () => {
    repository.findByOrderId.mockResolvedValue(
      restored(ExecutionStatus.EXECUTING, 3),
    );
    await useCase.execute(command(CommandType.CancelExecution));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('persists and publishes a business failure', async () => {
    repository.findByOrderId.mockResolvedValue(
      restored(ExecutionStatus.COMPLETED, 4),
    );
    await useCase.execute(command(CommandType.CancelExecution));
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'execution.failed',
        payload: expect.objectContaining({ reason: expect.any(String) }),
      }),
    );
  });

  it('does not republish a duplicated failed command', async () => {
    repository.findByOrderId.mockResolvedValue(
      restored(ExecutionStatus.DIAGNOSIS_COMPLETED, 2),
    );
    repository.saveIdempotently.mockResolvedValue('duplicate');
    await expect(
      useCase.execute(command(CommandType.StartDiagnosis)),
    ).resolves.toBe('duplicate');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishes diagnosis and execution failures with canonical types', async () => {
    repository.findByOrderId.mockResolvedValueOnce(null);
    await useCase.execute(
      command(CommandType.StartDiagnosis, {
        forceFailure: true,
        reason: 'scanner offline',
      }),
    );
    expect(publisher.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'diagnosis.failed' }),
    );

    repository.findByOrderId.mockResolvedValueOnce(
      restored(ExecutionStatus.DIAGNOSIS_COMPLETED, 2),
    );
    await useCase.execute(
      command(CommandType.StartExecution, { forceFailure: true }),
    );
    expect(publisher.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageType: 'execution.failed' }),
    );
  });

  function restored(status: ExecutionStatus, version: number): Execution {
    return Execution.restore({
      orderId: 'order-1',
      status,
      version,
      createdAt: '2026-09-22T12:00:00.000Z',
      updatedAt: '2026-09-22T12:00:00.000Z',
    });
  }
});
