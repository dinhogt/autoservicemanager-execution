import { parseExecutionCommand } from './messaging';

const valid = {
  schemaVersion: '1.0',
  messageId: 'm1',
  messageType: 'diagnosis.start',
  occurredAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'c1',
  aggregateId: 'o1',
  source: 'test',
  payload: {},
};

describe('execution messaging contract', () => {
  it.each(['diagnosis.start', 'execution.start', 'execution.cancel'])(
    'accepts %s',
    (messageType) => {
      expect(parseExecutionCommand({ ...valid, messageType }).messageType).toBe(
        messageType,
      );
    },
  );

  it.each([
    null,
    { ...valid, messageId: '' },
    { ...valid, schemaVersion: '2.0' },
    { ...valid, messageType: 'INICIAR_EXECUCAO' },
    { ...valid, payload: null },
  ])('rejects malformed input %#', (input) => {
    expect(() => parseExecutionCommand(input)).toThrow();
  });
});
