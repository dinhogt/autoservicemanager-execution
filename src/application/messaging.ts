export const MESSAGE_SCHEMA_VERSION = "1.0" as const;

export const CommandType = {
  StartDiagnosis: "diagnosis.start",
  StartExecution: "execution.start",
  CancelExecution: "execution.cancel",
} as const;

export const EventType = {
  DiagnosisCompleted: "diagnosis.completed",
  DiagnosisFailed: "diagnosis.failed",
  ExecutionCompleted: "execution.completed",
  ExecutionFailed: "execution.failed",
} as const;

export interface MessageEnvelope<TType extends string, TPayload> {
  schemaVersion: typeof MESSAGE_SCHEMA_VERSION;
  messageId: string;
  messageType: TType;
  occurredAt: string;
  correlationId: string;
  sagaId?: string;
  aggregateId: string;
  causationId?: string;
  source: string;
  payload: TPayload;
}

export type ExecutionCommand = MessageEnvelope<
  (typeof CommandType)[keyof typeof CommandType],
  { diagnosis?: string; forceFailure?: boolean; reason?: string }
>;

export type ExecutionEvent = MessageEnvelope<
  (typeof EventType)[keyof typeof EventType],
  Record<string, unknown>
>;

export function parseExecutionCommand(input: unknown): ExecutionCommand {
  if (!isRecord(input)) throw new Error("Invalid command envelope");
  for (const field of [
    "messageId",
    "messageType",
    "occurredAt",
    "correlationId",
    "aggregateId",
    "source",
  ]) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new Error(`Invalid command field: ${field}`);
    }
  }
  if (input.schemaVersion !== MESSAGE_SCHEMA_VERSION) {
    throw new Error("Unsupported schema version");
  }
  if (
    !Object.values(CommandType).includes(
      input.messageType as ExecutionCommand["messageType"],
    )
  ) {
    throw new Error("Unsupported execution command");
  }
  if (!isRecord(input.payload)) throw new Error("Invalid command payload");
  return input as unknown as ExecutionCommand;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
