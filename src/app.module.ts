import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  EVENT_PUBLISHER,
  EXECUTION_REPOSITORY,
} from './application/contracts';
import { ProcessCommand } from './application/process-command';
import { envSchema } from './infrastructure/config';
import { DynamoExecutionRepository } from './infrastructure/dynamo-execution.repository';
import { JsonLogger } from './infrastructure/logger';
import { SnsEventPublisher } from './infrastructure/sns-event.publisher';
import { SqsConsumer } from './infrastructure/sqs-consumer';
import { HealthController } from './interfaces/health.controller';

const awsOptions = (config: ConfigService) => ({
  region: config.getOrThrow<string>('AWS_REGION'),
  endpoint: config.get<string>('AWS_ENDPOINT_URL') || undefined,
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envSchema,
      validationOptions: { abortEarly: false },
    }),
  ],
  controllers: [HealthController],
  providers: [
    ProcessCommand,
    JsonLogger,
    SqsConsumer,
    {
      provide: DynamoDBDocumentClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        DynamoDBDocumentClient.from(new DynamoDBClient(awsOptions(config)), {
          marshallOptions: { removeUndefinedValues: true },
        }),
    },
    {
      provide: SNSClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new SNSClient(awsOptions(config)),
    },
    {
      provide: SQSClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new SQSClient(awsOptions(config)),
    },
    {
      provide: EXECUTION_REPOSITORY,
      useExisting: DynamoExecutionRepository,
    },
    {
      provide: EVENT_PUBLISHER,
      useExisting: SnsEventPublisher,
    },
    DynamoExecutionRepository,
    SnsEventPublisher,
  ],
})
export class AppModule {}
