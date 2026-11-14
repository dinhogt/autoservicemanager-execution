import { SQSClient } from "@aws-sdk/client-sqs";
import { ConfigService } from "@nestjs/config";
import { ProcessCommand } from "../application/process-command";
import { HealthController } from "../interfaces/health.controller";
import { envSchema } from "./config";
import {
  emitMetric,
  JsonLogger,
  withCorrelation,
  withTelemetryContext,
} from "./logger";
import { parseCommand, SqsConsumer } from "./sqs-consumer";

describe("infrastructure", () => {
  it("validates required environment and defaults", () => {
    const result = envSchema.validate({
      AWS_REGION: "us-east-1",
      DYNAMODB_TABLE: "execution",
      SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/queue",
      SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:123456789012:events",
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      PORT: 3000,
      SQS_WAIT_TIME_SECONDS: 20,
    });
    expect(envSchema.validate({}).error).toBeDefined();
  });

  it("exposes health status", () => {
    expect(new HealthController().health()).toEqual({ status: "ok" });
  });

  it("writes JSON logs with correlation context", () => {
    const stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    const logger = new JsonLogger();
    withCorrelation("corr-1", () => {
      logger.log("done", "Worker");
      logger.warn({ warning: true });
      logger.debug("debug");
      logger.error("failed");
    });
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"correlationId":"corr-1"'),
    );
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"error"'));
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("emits execution EMF with asynchronous identifiers", () => {
    const stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    withTelemetryContext(
      {
        correlationId: "corr-1",
        sagaId: "saga-1",
        messageId: "message-1",
        aggregateId: "order-1",
      },
      () =>
        emitMetric({
          event: "execution_completed",
          metric: "ExecutionOutcome",
          operation: "execution.start",
          outcome: "success",
        }),
    );
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"messageId":"message-1"'),
    );
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"ExecutionOutcome":1'),
    );
    stdout.mockRestore();
  });

  it("parses valid commands and rejects malformed contracts", () => {
    const valid = JSON.stringify({
      schemaVersion: "1.0",
      messageId: "e1",
      messageType: "execution.start",
      aggregateId: "o1",
      correlationId: "c1",
      occurredAt: "2026-01-01T00:00:00Z",
      source: "test",
      payload: {},
    });
    expect(parseCommand(valid).messageType).toBe("execution.start");
    expect(() => parseCommand("null")).toThrow("Invalid command envelope");
    expect(() => parseCommand("{}")).toThrow("Invalid command field");
    expect(() =>
      parseCommand(
        JSON.stringify({ ...JSON.parse(valid), messageType: "UNKNOWN" }),
      ),
    ).toThrow("Unsupported execution command");
  });

  it("processes, deletes, and discards invalid SQS messages", async () => {
    const send = jest.fn().mockResolvedValue({});
    const execute = jest.fn().mockResolvedValue("processed");
    const consumer = new SqsConsumer(
      { send } as unknown as SQSClient,
      { execute } as unknown as ProcessCommand,
      {
        getOrThrow: jest.fn().mockReturnValue("https://sqs/queue"),
        get: jest.fn(),
      } as unknown as ConfigService,
    );
    const body = JSON.stringify({
      schemaVersion: "1.0",
      messageId: "e1",
      messageType: "execution.cancel",
      aggregateId: "o1",
      correlationId: "c1",
      occurredAt: "2026-01-01T00:00:00Z",
      source: "test",
      payload: {},
    });
    await consumer.processMessage(body, "receipt");
    await consumer.processMessage("{}", "invalid-receipt");
    await consumer.processMessage(undefined, undefined);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    consumer.onApplicationShutdown();
  });

  it("runs and stops the long poll lifecycle", async () => {
    const send = jest.fn().mockImplementation(() => {
      consumer.onApplicationShutdown();
      return Promise.resolve({ Messages: [] });
    });
    const consumer = new SqsConsumer(
      { send } as unknown as SQSClient,
      { execute: jest.fn() } as unknown as ProcessCommand,
      {
        getOrThrow: jest.fn().mockReturnValue("https://sqs/queue"),
        get: jest.fn((_key: string, fallback: number) => fallback),
      } as unknown as ConfigService,
    );
    consumer.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(send).toHaveBeenCalled();
  });
});
