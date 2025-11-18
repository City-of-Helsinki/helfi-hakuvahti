import * as assert from 'node:assert';
import { afterEach, beforeEach, describe, mock, test, type Mock } from 'node:test';
import command, { type Command } from '../../src/lib/command';

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
    process.argv = ['node', 'script.js', '--test', 'value', '--dry-run'];

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

    await runCommand(mockCommand);

    // Verify command was called
    assert.strictEqual(mockCommand.mock.calls.length, 1);

    // Verify process.exit was called with 1
    assert.strictEqual(processExitMock.mock.calls.length, 1);
    assert.strictEqual(processExitMock.mock.calls[0].arguments[0], 1);
  });
});
