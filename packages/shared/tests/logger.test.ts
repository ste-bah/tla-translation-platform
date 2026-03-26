import { describe, it, expect } from 'vitest';
import { createComponentLogger } from '@tla/shared';

describe('createComponentLogger', () => {
  it('returns a pino logger', () => {
    const logger = createComponentLogger('test-component');
    // pino loggers have info, warn, error, debug, trace, fatal methods
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('logger has component in bindings', () => {
    const logger = createComponentLogger('my-component');
    const bindings = logger.bindings();
    expect(bindings.component).toBe('my-component');
  });

  it('different components produce different child loggers', () => {
    const loggerA = createComponentLogger('component-a');
    const loggerB = createComponentLogger('component-b');

    expect(loggerA.bindings().component).toBe('component-a');
    expect(loggerB.bindings().component).toBe('component-b');
    expect(loggerA).not.toBe(loggerB);
  });
});
