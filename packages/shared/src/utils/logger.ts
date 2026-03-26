import pino from 'pino';

const level = process.env['TLA_LOG_LEVEL'] ?? 'info';

const rootLogger = pino({ level, name: 'tla' });

/**
 * Creates a child logger scoped to a specific component.
 *
 * @param component - The component name for log context
 * @returns A pino Logger instance with the component field set
 *
 * @example
 * const logger = createComponentLogger('registry');
 * logger.info('Registry loaded');
 */
export function createComponentLogger(component: string): pino.Logger {
  return rootLogger.child({ component });
}
