import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Execution, InvalidTransitionError } from "../domain/execution";
import {
  EVENT_PUBLISHER,
  EXECUTION_REPOSITORY,
  EventPublisher,
  ExecutionRepository,
} from "./contracts";
import {
  CommandType,
  EventType,
  ExecutionCommand,
  ExecutionEvent,
  MESSAGE_SCHEMA_VERSION,
} from "./messaging";
import { emitMetric } from "../infrastructure/logger";

@Injectable()
export class ProcessCommand {
  constructor(
    @Inject(EXECUTION_REPOSITORY)
    private readonly repository: ExecutionRepository,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  async execute(command: ExecutionCommand): Promise<"processed" | "duplicate"> {
    let execution = await this.repository.findByOrderId(command.aggregateId);
    const expectedVersion = execution?.snapshot.version ?? -1;
    execution ??= Execution.create(command.aggregateId);

    let type: ExecutionEvent["messageType"];
    let payload: Record<string, unknown> = {};
    try {
      if (command.payload.forceFailure) {
        throw new Error(command.payload.reason ?? "forced execution failure");
      }
      if (command.messageType === CommandType.StartDiagnosis) {
        const diagnosis =
          command.payload.diagnosis ?? "Diagnóstico técnico concluído";
        execution.startDiagnosis();
        execution.completeDiagnosis(diagnosis);
        type = EventType.DiagnosisCompleted;
        payload = { diagnosis };
      } else if (command.messageType === CommandType.StartExecution) {
        execution.startExecution();
        execution.complete();
        type = EventType.ExecutionCompleted;
      } else {
        execution.cancel();
        return this.persistWithoutEvent(
          execution,
          command.messageId,
          expectedVersion,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      try {
        execution.fail(reason);
      } catch (failureError) {
        if (!(failureError instanceof InvalidTransitionError)) {
          throw failureError;
        }
      }
      const saved = await this.repository.saveIdempotently(
        execution,
        command.messageId,
        expectedVersion,
      );
      if (saved === "duplicate") return "duplicate";
      const failureType =
        command.messageType === CommandType.StartDiagnosis
          ? EventType.DiagnosisFailed
          : EventType.ExecutionFailed;
      await this.publisher.publish(
        this.event(command, failureType, { reason }),
      );
      emitMetric({
        event: failureType,
        metric: "ExecutionOutcome",
        operation: command.messageType,
        outcome: "failed",
      });
      return "processed";
    }

    const saved = await this.repository.saveIdempotently(
      execution,
      command.messageId,
      expectedVersion,
    );
    if (saved === "duplicate") return "duplicate";
    await this.publisher.publish(this.event(command, type, payload));
    emitMetric({
      event: type,
      metric: "ExecutionOutcome",
      operation: command.messageType,
      outcome: "success",
    });
    return "processed";
  }

  private async persistWithoutEvent(
    execution: Execution,
    messageId: string,
    expectedVersion: number,
  ): Promise<"processed" | "duplicate"> {
    const saved = await this.repository.saveIdempotently(
      execution,
      messageId,
      expectedVersion,
    );
    return saved === "duplicate" ? "duplicate" : "processed";
  }

  private event(
    command: ExecutionCommand,
    messageType: ExecutionEvent["messageType"],
    payload: Record<string, unknown>,
  ): ExecutionEvent {
    return {
      schemaVersion: MESSAGE_SCHEMA_VERSION,
      messageId: randomUUID(),
      messageType,
      aggregateId: command.aggregateId,
      correlationId: command.correlationId,
      sagaId: command.sagaId,
      causationId: command.messageId,
      occurredAt: new Date().toISOString(),
      source: "autoservicemanager-execution",
      payload,
    };
  }
}
