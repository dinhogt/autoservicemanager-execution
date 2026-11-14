import { Injectable, LoggerService } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

export type TelemetryContext = {
  correlationId: string;
  sagaId?: string;
  messageId?: string;
  aggregateId?: string;
};
const context = new AsyncLocalStorage<TelemetryContext>();

export function withCorrelation<T>(
  correlationId: string,
  callback: () => T,
): T {
  return context.run({ correlationId }, callback);
}

export function withTelemetryContext<T>(
  telemetry: TelemetryContext,
  callback: () => T,
): T {
  return context.run(telemetry, callback);
}

export function emitMetric(input: {
  event: string;
  metric: string;
  operation: string;
  outcome: string;
  value?: number;
  unit?: "Count" | "Milliseconds";
  durationMs?: number;
}): void {
  const now = Date.now();
  const current = context.getStore();
  const environment =
    process.env.METRICS_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  process.stdout.write(
    `${JSON.stringify({
      _aws: {
        Timestamp: now,
        CloudWatchMetrics: [
          {
            Namespace: `AutoServiceManager/${environment}`,
            Dimensions: [["Service"], ["Service", "Operation", "Outcome"]],
            Metrics: [{ Name: input.metric, Unit: input.unit ?? "Count" }],
          },
        ],
      },
      Service: "execution",
      Operation: input.operation,
      Outcome: input.outcome,
      [input.metric]: input.value ?? 1,
      level: input.outcome === "failed" ? "error" : "info",
      timestamp: new Date(now).toISOString(),
      service: "execution",
      environment,
      correlationId: current?.correlationId ?? "system",
      sagaId: current?.sagaId ?? "none",
      messageId: current?.messageId ?? "none",
      aggregateId: current?.aggregateId ?? "none",
      durationMs: input.durationMs ?? 0,
      event: input.event,
      outcome: input.outcome,
    })}\n`,
  );
}

@Injectable()
export class JsonLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]): void {
    this.write("info", message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.write("warn", message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }

  private write(level: string, message: unknown, params: unknown[]): void {
    const payload = JSON.stringify({
      level,
      message: typeof message === "string" ? message : JSON.stringify(message),
      service: "execution",
      environment:
        process.env.METRICS_ENVIRONMENT ??
        process.env.NODE_ENV ??
        "development",
      correlationId: context.getStore()?.correlationId ?? "system",
      sagaId: context.getStore()?.sagaId ?? "none",
      messageId: context.getStore()?.messageId ?? "none",
      aggregateId: context.getStore()?.aggregateId ?? "none",
      context: typeof params[0] === "string" ? params[0] : undefined,
      timestamp: new Date().toISOString(),
    });
    (level === "error" ? process.stderr : process.stdout).write(`${payload}\n`);
  }
}
