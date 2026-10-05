import * as assert from 'node:assert';
import { afterEach, beforeEach, describe, type Mock, mock, test } from 'node:test';
import command, { type Command } from '../../src/lib/command.ts';
import { captureSentryEvents } from './utils.ts';

const sentry = captureSentryEvents();

/**
 * Helper for running command methods.
 */
async function runCommand(app: Command): Promise<void> {
  return new Promise((resolve) => {
    command(app).addHook('onClose', async (_instance) => {
      // Wait for process.exit to be called (happens after onClose hook)
      setImmediate(resolve);
    });
  });
}

describe('command helper', () => {
  let processExitMock: Mock<(code: number) => void>;

  beforeEach(() => {
    // Mock process.exit to prevent actual process termination
    processExitMock = mock.method(process, 'exit', () => {
      // Do nothing - prevent actual exit
    });
  });

  afterEach(() => {
    processExitMock.mock.restore();
  });

  test('executes command successfully and exits with 0', async () => {
    // Set up process.argv
    process.argv = ['node', 'script.js', '--test=value', '--dry-run'];

    // Create a mock command
    const mockCommand = mock.fn<Command>(async (server, argv) => {
      // Command executes successfully
      assert.ok(server, 'Server should be provided');
      assert.ok(argv, 'Argv should be provided');

      // Arguments are parsed correctly
      assert.equal(argv.test, 'value');
      assert.ok(argv['dry-run']);
    });

    await runCommand(mockCommand);

    // Verify command was called
    assert.strictEqual(mockCommand.mock.calls.length, 1);

    // Verify process.exit was called with 0
    assert.strictEqual(processExitMock.mock.calls.length, 1);
    assert.strictEqual(processExitMock.mock.calls[0].arguments[0], 0);
  });

  test('when command fails exits with 1', async () => {
    // Create a mock command that throws an error
    const mockCommand = mock.fn<Command>(async (_server, _argv) => {
      throw new Error('Test failure');
    });
    await sentry.take();

    await runCommand(mockCommand);

    // No request is involved, so nothing else would report it.
    assert.deepStrictEqual(await sentry.take(), ['Error: Test failure']);

    // Verify command was called
    assert.strictEqual(mockCommand.mock.calls.length, 1);

    // Verify process.exit was called with 1
    assert.strictEqual(processExitMock.mock.calls.length, 1);
    assert.strictEqual(processExitMock.mock.calls[0].arguments[0], 1);
  });

  test('when the server fails to start reports it and exits with 1', async () => {
    const mockCommand = mock.fn<Command>(async () => {});
    await sentry.take();

    command(mockCommand, [
      async () => {
        throw new Error('Plugin failed');
      },
    ]);

    // process.exit is mocked and returns, so wait for its call instead of the close hook.
    while (processExitMock.mock.callCount() === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.strictEqual(processExitMock.mock.calls[0].arguments[0], 1);
    assert.deepStrictEqual(await sentry.take(), ['Error: Plugin failed']);
  });
});
