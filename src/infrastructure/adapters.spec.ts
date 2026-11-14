import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { ConfigService } from '@nestjs/config';
import { DynamoExecutionRepository } from './dynamo-execution.repository';
import { SnsEventPublisher } from './sns-event.publisher';
import { Execution, ExecutionStatus } from '../domain/execution';

describe('AWS adapters', () => {
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'DYNAMODB_TABLE' ? 'executions' : 'arn:aws:sns:us-east-1:123456789012:events',
    ),
  } as unknown as ConfigService;

  it('returns null or restores an execution from DynamoDB', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Item: {
          execution: {
            orderId: 'o1',
            status: ExecutionStatus.DIAGNOSIS_COMPLETED,
            version: 2,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      });
    const repository = new DynamoExecutionRepository(
      { send } as unknown as DynamoDBDocumentClient,
      config,
    );
    await expect(repository.findByOrderId('missing')).resolves.toBeNull();
    await expect(repository.findByOrderId('o1')).resolves.toBeInstanceOf(
      Execution,
    );
  });

  it('atomically creates an execution and idempotency marker', async () => {
    const send = jest.fn().mockResolvedValue({});
    const repository = new DynamoExecutionRepository(
      { send } as unknown as DynamoDBDocumentClient,
      config,
    );
    await expect(
      repository.saveIdempotently(Execution.create('o1'), 'e1', -1),
    ).resolves.toBe('saved');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('uses optimistic versioning for updates', async () => {
    const send = jest.fn().mockResolvedValue({});
    const repository = new DynamoExecutionRepository(
      { send } as unknown as DynamoDBDocumentClient,
      config,
    );
    const execution = Execution.create('o1');
    execution.startDiagnosis();
    await repository.saveIdempotently(execution, 'e1', 0);
    const input = send.mock.calls[0][0].input;
    expect(input.TransactItems[1].Put.ConditionExpression).toContain(
      '#version',
    );
  });

  it('recognizes a duplicate after a transaction cancellation', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('transaction cancelled'))
      .mockResolvedValueOnce({ Item: { eventId: 'e1' } });
    const repository = new DynamoExecutionRepository(
      { send } as unknown as DynamoDBDocumentClient,
      config,
    );
    await expect(
      repository.saveIdempotently(Execution.create('o1'), 'e1', -1),
    ).resolves.toBe('duplicate');
  });

  it('rethrows a concurrency error when event was not processed', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce({});
    const repository = new DynamoExecutionRepository(
      { send } as unknown as DynamoDBDocumentClient,
      config,
    );
    await expect(
      repository.saveIdempotently(Execution.create('o1'), 'e1', -1),
    ).rejects.toThrow('conflict');
  });

  it('publishes an SNS event with routing attributes', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = new SnsEventPublisher(
      { send } as unknown as SNSClient,
      config,
    );
    await publisher.publish({
      schemaVersion: '1.0',
      messageId: 'e2',
      messageType: 'execution.completed',
      aggregateId: 'o1',
      correlationId: 'c1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      source: 'test',
      payload: {},
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      MessageAttributes: {
        eventType: { StringValue: 'execution.completed' },
      },
    });
  });
});
