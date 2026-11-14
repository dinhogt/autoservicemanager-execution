export enum ExecutionStatus {
  WAITING_DIAGNOSIS = 'AGUARDANDO_DIAGNOSTICO',
  DIAGNOSING = 'EM_DIAGNOSTICO',
  DIAGNOSIS_COMPLETED = 'DIAGNOSTICO_CONCLUIDO',
  EXECUTING = 'EM_EXECUCAO',
  COMPLETED = 'CONCLUIDA',
  FAILED = 'FALHA',
  CANCELLED = 'CANCELADA',
}

export interface ExecutionProps {
  orderId: string;
  status: ExecutionStatus;
  version: number;
  diagnosis?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export class InvalidTransitionError extends Error {}

export class Execution {
  private constructor(private readonly props: ExecutionProps) {}

  static create(orderId: string, now = new Date()): Execution {
    if (!orderId.trim()) throw new Error('orderId is required');
    const timestamp = now.toISOString();
    return new Execution({
      orderId,
      status: ExecutionStatus.WAITING_DIAGNOSIS,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  static restore(props: ExecutionProps): Execution {
    return new Execution({ ...props });
  }

  get snapshot(): Readonly<ExecutionProps> {
    return { ...this.props };
  }

  startDiagnosis(now = new Date()): void {
    this.transition(
      [ExecutionStatus.WAITING_DIAGNOSIS],
      ExecutionStatus.DIAGNOSING,
      now,
    );
  }

  completeDiagnosis(diagnosis: string, now = new Date()): void {
    if (!diagnosis.trim()) throw new Error('diagnosis is required');
    this.transition(
      [ExecutionStatus.DIAGNOSING],
      ExecutionStatus.DIAGNOSIS_COMPLETED,
      now,
    );
    this.props.diagnosis = diagnosis;
  }

  startExecution(now = new Date()): void {
    this.transition(
      [ExecutionStatus.DIAGNOSIS_COMPLETED],
      ExecutionStatus.EXECUTING,
      now,
    );
  }

  complete(now = new Date()): void {
    this.transition([ExecutionStatus.EXECUTING], ExecutionStatus.COMPLETED, now);
  }

  cancel(now = new Date()): void {
    this.transition(
      [
        ExecutionStatus.WAITING_DIAGNOSIS,
        ExecutionStatus.DIAGNOSING,
        ExecutionStatus.DIAGNOSIS_COMPLETED,
        ExecutionStatus.EXECUTING,
      ],
      ExecutionStatus.CANCELLED,
      now,
    );
  }

  fail(reason: string, now = new Date()): void {
    if (!reason.trim()) throw new Error('failure reason is required');
    this.transition(
      [
        ExecutionStatus.WAITING_DIAGNOSIS,
        ExecutionStatus.DIAGNOSING,
        ExecutionStatus.DIAGNOSIS_COMPLETED,
        ExecutionStatus.EXECUTING,
      ],
      ExecutionStatus.FAILED,
      now,
    );
    this.props.failureReason = reason;
  }

  private transition(
    allowed: ExecutionStatus[],
    next: ExecutionStatus,
    now: Date,
  ): void {
    if (!allowed.includes(this.props.status)) {
      throw new InvalidTransitionError(
        `Cannot transition from ${this.props.status} to ${next}`,
      );
    }
    this.props.status = next;
    this.props.version += 1;
    this.props.updatedAt = now.toISOString();
  }
}
