import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProcessCommand } from "../application/process-command";
import {
  ExecutionCommand,
  parseExecutionCommand,
} from "../application/messaging";
import { emitMetric, withTelemetryContext } from "./logger";

export function parseCommand(body: string): ExecutionCommand {
  return parseExecutionCommand(JSON.parse(body) as unknown);
}

@Injectable()
export class SqsConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumer.name);
  private running = false;
  private readonly queueUrl: string;

  constructor(
    private readonly client: SQSClient,
    private readonly processor: ProcessCommand,
    private readonly config: ConfigService,
  ) {
    this.queueUrl = config.getOrThrow<string>("SQS_QUEUE_URL");
  }

  onModuleInit(): void {
    this.running = true;
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: this.config.get<number>(
              "SQS_WAIT_TIME_SECONDS",
              20,
            ),
            VisibilityTimeout: this.config.get<number>(
              "SQS_VISIBILITY_TIMEOUT",
              60,
            ),
          }),
        );
        for (const message of response.Messages ?? []) {
          await this.processMessage(message.Body, message.ReceiptHandle);
        }
      } catch (error) {
        this.logger.error("SQS polling failed", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async processMessage(body?: string, receiptHandle?: string): Promise<void> {
    if (!body || !receiptHandle) return;
    let command: ExecutionCommand;
    try {
      command = parseCommand(body);
    } catch (error) {
      this.logger.warn(`Discarding invalid command: ${String(error)}`);
      await this.delete(receiptHandle);
      return;
    }
    await withTelemetryContext(
      {
        correlationId: command.correlationId,
        sagaId: command.sagaId,
        messageId: command.messageId,
        aggregateId: command.aggregateId,
      },
      async () => {
        const startedAt = Date.now();
        emitMetric({
          event: "execution_command_received",
          metric: "QueueMessageAge",
          unit: "Milliseconds",
          value: Math.max(0, startedAt - Date.parse(command.occurredAt)),
          operation: command.messageType,
          outcome: "received",
        });
        const outcome = await this.processor.execute(command);
        const durationMs = Date.now() - startedAt;
        emitMetric({
          event: "execution_command_processed",
          metric: "ExecutionDuration",
          unit: "Milliseconds",
          value: durationMs,
          durationMs,
          operation: command.messageType,
          outcome,
        });
      },
    );
    await this.delete(receiptHandle);
  }

  private async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
