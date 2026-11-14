import {
  GetCommand,
  TransactWriteCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionRepository } from '../application/contracts';
import { Execution, ExecutionProps } from '../domain/execution';

@Injectable()
export class DynamoExecutionRepository implements ExecutionRepository {
  private readonly table: string;

  constructor(
    private readonly client: DynamoDBDocumentClient,
    config: ConfigService,
  ) {
    this.table = config.getOrThrow<string>('DYNAMODB_TABLE');
  }

  async findByOrderId(orderId: string): Promise<Execution | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: `ORDER#${orderId}`, sk: 'EXECUTION' },
        ConsistentRead: true,
      }),
    );
    return result.Item
      ? Execution.restore(result.Item.execution as ExecutionProps)
      : null;
  }

  async saveIdempotently(
    execution: Execution,
    eventId: string,
    expectedVersion: number,
  ): Promise<'saved' | 'duplicate'> {
    const snapshot = execution.snapshot;
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: `EVENT#${eventId}`,
                  sk: 'PROCESSED',
                  eventId,
                  ttl: Math.floor(Date.now() / 1000) + 604800,
                },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: `ORDER#${snapshot.orderId}`,
                  sk: 'EXECUTION',
                  execution: snapshot,
                  version: snapshot.version,
                },
                ConditionExpression:
                  expectedVersion < 0
                    ? 'attribute_not_exists(pk)'
                    : '#version = :expectedVersion',
                ExpressionAttributeNames:
                  expectedVersion < 0 ? undefined : { '#version': 'version' },
                ExpressionAttributeValues:
                  expectedVersion < 0
                    ? undefined
                    : { ':expectedVersion': expectedVersion },
              },
            },
          ],
        }),
      );
      return 'saved';
    } catch (error) {
      if (await this.wasProcessed(eventId)) return 'duplicate';
      throw error;
    }
  }

  private async wasProcessed(eventId: string): Promise<boolean> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: `EVENT#${eventId}`, sk: 'PROCESSED' },
        ConsistentRead: true,
      }),
    );
    return Boolean(result.Item);
  }
}
