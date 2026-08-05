import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildCliArguments,
  buildCliCommand,
  classifyConsoleEvent,
  completeCompatibilityRun,
  completeVisualEvidenceRun,
  FIXTURE_NAMES,
  formatCliExit,
  makeFixture,
  pngInfo,
  runFixtureWithFreshSession,
  runFixturesWithFreshSessions,
  SCREENSHOT_TIMEOUT_MS,
} from '../scripts/visual-evidence.mjs';
import * as visualEvidence from '../scripts/visual-evidence.mjs';

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validPngBytes(width = 390, height = 753) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(0x49484452, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function compatibilityPaths(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-compatibility-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    resultPath: path.join(root, 'compatibility.json'),
    screenshotPath: path.join(root, 'sample.png'),
    rawErrorPath: path.join(root, 'compatibility-error.txt'),
  };
}

function closeRuntime(errorMessage = null) {
  const cliProcess = {
    killed: false,
    kill() {
      this.killed = true;
    },
  };
  return {
    runtime: {
      miniProgram: {
        close: async () => {
          if (errorMessage) throw new Error(errorMessage);
        },
      },
      cliProcess,
      cliExit: { type: 'exit', code: 0, stdout: 'cli stdout', stderr: 'cli stderr' },
      cliOutput: { stdout: [Buffer.from('cli stdout')], stderr: [Buffer.from('cli stderr')] },
    },
    cliProcess,
  };
}

test('visual evidence CLI arguments use the isolated project and never pass an automation account', () => {
  const projectPath = path.resolve('.visual-qa');
  const args = buildCliArguments({ projectPath, port: 45_321 });
  assert.deepEqual(args, ['auto', '--project', projectPath, '--auto-port', '45321', '--trust-project']);
  assert.equal(args.includes('--auto-account'), false);
  assert.equal(args.some((value) => value.includes('wx9567fb4ff6336d0b')), false);
  const command = buildCliCommand('C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat', args);
  assert.match(command, /--project/);
  assert.match(command, /--auto-port/);
  assert.match(command, /--trust-project/);
  assert.doesNotMatch(command, /--auto-account/);
  assert.doesNotMatch(command, /wx9567fb4ff6336d0b/);
});

test('visual evidence CLI argument builder rejects a non-absolute project path or invalid port', () => {
  assert.throws(() => buildCliArguments({ projectPath: '.visual-qa', port: 45321 }), /absolute/);
  assert.throws(() => buildCliArguments({ projectPath: path.resolve('.visual-qa'), port: 0 }), /port/);
  assert.throws(() => buildCliArguments({ projectPath: path.resolve('.visual-qa'), port: 65_536 }), /port/);
});

test('visual evidence reports an early CLI exit with exit code and raw stdout and stderr', () => {
  const error = formatCliExit({
    type: 'exit',
    code: 10,
    signal: null,
    stdout: 'raw stdout',
    stderr: 'raw stderr',
    stdoutBase64: 'cmF3IHN0ZG91dA==',
    stderrBase64: 'cmF3IHN0ZGVycg==',
  }, 45321);
  assert.match(error.message, /45321/);
  assert.match(error.message, /10/);
  assert.match(error.message, /raw stdout/);
  assert.match(error.message, /raw stderr/);
});

test('visual evidence PNG validation reads a non-zero PNG IHDR size', () => {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(0x49484452, 12);
  bytes.writeUInt32BE(428, 16);
  bytes.writeUInt32BE(926, 20);
  assert.deepEqual(pngInfo(bytes), { width: 428, height: 926 });
});

test('visual evidence console classification keeps warnings visible and errors fatal', () => {
  assert.deepEqual(classifyConsoleEvent({ level: 'warning', message: 'deprecated API' }).isWarning, true);
  assert.deepEqual(classifyConsoleEvent({ level: 'warning', message: 'deprecated API' }).isError, false);
  assert.deepEqual(classifyConsoleEvent({ level: 'error', message: 'runtime error' }).isError, true);
  assert.deepEqual(classifyConsoleEvent({ type: 'exception', message: 'uncaught' }).isError, true);
  const protocolArtifact = classifyConsoleEvent({ type: 'error', args: [{}] });
  assert.equal(protocolArtifact.isError, false);
  assert.equal(protocolArtifact.protocolArtifact, true);
});

test('visual evidence fixtures include a real cross-budget-period state', () => {
  assert.deepEqual(FIXTURE_NAMES, ['normal-accumulated', 'prepaid-recovery', 'empty-bills', 'cross-budget-period']);
  const fixture = makeFixture('cross-budget-period', '2026-08-04');
  assert.equal(fixture.state.budgetPeriods.length, 2);
  assert.equal(fixture.state.budgetPeriods[0].status, 'closed');
  assert.equal(fixture.state.budgetPeriods[1].status, 'open');
  assert.equal(fixture.expected.budgetPeriodCount, 2);
  assert.equal(fixture.expected.periodId, fixture.state.budgetPeriods[1].id);
  assert.equal(fixture.expected.billCount, 1);
});

test('home fixture route uses one switchTab assistant and never redirectTo', async () => {
  const { switchToHomeTab, writeAndReadFixture } = visualEvidence;
  assert.equal(typeof switchToHomeTab, 'function');
  assert.equal(typeof writeAndReadFixture, 'function');

  const assistantCalls = [];
  await switchToHomeTab({
    switchTab: async (url) => assistantCalls.push(['switchTab', url]),
    redirectTo: async (url) => assistantCalls.push(['redirectTo', url]),
  });
  assert.deepEqual(assistantCalls, [['switchTab', '/pages/home/home']]);

  const fixture = makeFixture('empty-bills', '2026-08-04');
  let storedRaw = '';
  const routeCalls = [];
  const miniProgram = {
    async callWxMethod(method, ...args) {
      if (method === 'setStorageSync') storedRaw = args[1];
      if (method === 'getStorageSync') return storedRaw;
      return null;
    },
    async evaluate() { return true; },
    async switchTab(url) { routeCalls.push(['switchTab', url]); },
    async redirectTo() { throw new Error('redirectTo must not be called'); },
  };
  await writeAndReadFixture({ miniProgram }, fixture);
  assert.deepEqual(routeCalls, [['switchTab', '/pages/home/home']]);
});

test('compatibility failure removes old success artifacts and records the current failure', async (t) => {
  const paths = await compatibilityPaths(t);
  await fs.writeFile(paths.resultPath, '{"ok":true,"old":true}', 'utf8');
  await fs.writeFile(paths.screenshotPath, validPngBytes());
  await fs.writeFile(paths.rawErrorPath, 'old compatibility error', 'utf8');

  await assert.rejects(
    completeCompatibilityRun({
      ...paths,
      result: { ok: true, old: false },
      runtime: null,
      events: [],
      primaryError: new Error('current compatibility failure'),
    }),
    /current compatibility failure/,
  );

  assert.equal(await pathExists(paths.resultPath), false);
  assert.equal(await pathExists(paths.screenshotPath), false);
  const errorText = await fs.readFile(paths.rawErrorPath, 'utf8');
  assert.match(errorText, /current compatibility failure/);
  assert.doesNotMatch(errorText, /old compatibility error/);
});

test('compatibility close failure removes success artifacts and preserves CLI output', async (t) => {
  const paths = await compatibilityPaths(t);
  await fs.writeFile(paths.resultPath, '{"ok":true,"old":true}', 'utf8');
  await fs.writeFile(paths.screenshotPath, validPngBytes());
  const { runtime, cliProcess } = closeRuntime('compatibility close failed');

  await assert.rejects(
    completeCompatibilityRun({
      ...paths,
      result: { ok: true },
      runtime,
      events: [],
    }),
    /compatibility close failed/,
  );

  assert.equal(cliProcess.killed, true);
  assert.equal(await pathExists(paths.resultPath), false);
  assert.equal(await pathExists(paths.screenshotPath), false);
  const errorText = await fs.readFile(paths.rawErrorPath, 'utf8');
  assert.match(errorText, /compatibility close failed/);
  assert.match(errorText, /cli stdout/);
  assert.match(errorText, /cli stderr/);
  assert.match(errorText, /close-error/);
  assert.doesNotMatch(errorText, /"ok":true/);
});

test('compatibility run and close failures preserve both original errors', async (t) => {
  const paths = await compatibilityPaths(t);
  const { runtime, cliProcess } = closeRuntime('close-stage failure');

  await assert.rejects(
    completeCompatibilityRun({
      ...paths,
      result: { ok: true },
      runtime,
      events: [],
      primaryError: new Error('run-stage failure'),
    }),
    /compatibility run/,
  );

  assert.equal(cliProcess.killed, true);
  const errorText = await fs.readFile(paths.rawErrorPath, 'utf8');
  assert.match(errorText, /run-stage failure/);
  assert.match(errorText, /close-stage failure/);
});

test('successful compatibility close clears an old error and keeps a valid PNG with ok true', async (t) => {
  const paths = await compatibilityPaths(t);
  await fs.writeFile(paths.rawErrorPath, 'stale compatibility error', 'utf8');
  await fs.writeFile(paths.screenshotPath, validPngBytes());
  const { runtime, cliProcess } = closeRuntime();

  const result = await completeCompatibilityRun({
    ...paths,
    result: { ok: true, screenshot: { path: 'sample.png' } },
    runtime,
    events: [],
  });

  assert.equal(result.ok, true);
  assert.equal(cliProcess.killed, true);
  assert.equal(await pathExists(paths.rawErrorPath), false);
  assert.equal(await pathExists(paths.resultPath), true);
  assert.deepEqual(pngInfo(await fs.readFile(paths.screenshotPath)), { width: 390, height: 753 });
  assert.equal(JSON.parse(await fs.readFile(paths.resultPath, 'utf8')).ok, true);
});

test('full evidence close failure kills CLI, retains close-error console evidence, and removes success outputs', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-evidence-'));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const greenPath = path.join(outputRoot, 'four-states-green.txt');
  const pngPath = path.join(outputRoot, 'normal-accumulated.png');
  await fs.writeFile(manifestPath, '{"ok":true,"old":true}', 'utf8');
  await fs.writeFile(greenPath, '{"ok":true,"old":true}', 'utf8');
  await fs.writeFile(pngPath, validPngBytes());
  const { runtime, cliProcess } = closeRuntime('full evidence close failed');
  const events = [];

  await assert.rejects(
    completeVisualEvidenceRun({
      outputRoot,
      runtime,
      events,
      captures: [],
      cliPath: 'stable-cli',
      cliArguments: ['auto'],
      systemInfo: {},
      runtimeErrorCapture: {},
      runtimeErrors: [],
    }),
    /full evidence close failed/,
  );

  assert.equal(cliProcess.killed, true);
  assert.equal(await pathExists(manifestPath), false);
  assert.equal(await pathExists(greenPath), false);
  assert.equal(await pathExists(pngPath), false);
  const consoleText = await fs.readFile(path.join(outputRoot, 'console.jsonl'), 'utf8');
  assert.match(consoleText, /close-error/);
  assert.match(consoleText, /full evidence close failed/);
});

function retryableTimeout(message = 'TIMEOUT screenshot') {
  const error = new Error(message);
  error.retryable = true;
  return error;
}

function injectedSessionFactory(sessions, nextPort = 50_000) {
  return async ({ attempt }) => {
    const session = { id: sessions.length + 1, port: nextPort + attempt, attempt, events: [] };
    sessions.push(session);
    return session;
  };
}

test('fresh-session retry abandons a hung runtime and succeeds with a different runtime and port', async () => {
  assert.equal(SCREENSHOT_TIMEOUT_MS, 30_000);
  const sessions = [];
  const result = await runFixtureWithFreshSession({
    fixture: { name: 'normal-accumulated' },
    createSession: injectedSessionFactory(sessions),
    captureOnce: async (session) => {
      if (session.id === 1) throw retryableTimeout();
      return { outputPath: 'attempt-2.png', width: 390, height: 753 };
    },
    closeSession: async (session) => { session.closed = true; },
    abortSession: async (session) => { session.aborted = true; return { confirmed: true }; },
  });

  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].port, sessions[1].port);
  assert.equal(sessions[0].aborted, true);
  assert.equal(sessions[1].closed, true);
  assert.equal(result.sessionAttempt, 2);
  assert.equal(result.port, sessions[1].port);
});

test('three screenshot timeouts create three distinct sessions and never reuse a failed runtime', async () => {
  const sessions = [];
  await assert.rejects(
    runFixtureWithFreshSession({
      fixture: { name: 'prepaid-recovery' },
      createSession: injectedSessionFactory(sessions, 51_000),
      captureOnce: async () => { throw retryableTimeout('TIMEOUT screenshot attempt'); },
      closeSession: async (session) => { session.closed = true; },
      abortSession: async (session) => { session.aborted = true; return { confirmed: true }; },
      maxAttempts: 3,
    }),
    /screenshot/,
  );

  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map((session) => session.port), [51_001, 51_002, 51_003]);
  assert.deepEqual(sessions.map((session) => session.aborted), [true, true, true]);
});

test('deterministic fixture or application errors close once and do not retry', async () => {
  const sessions = [];
  let captureCount = 0;
  let abortCount = 0;
  await assert.rejects(
    runFixtureWithFreshSession({
      fixture: { name: 'empty-bills' },
      createSession: injectedSessionFactory(sessions, 52_000),
      captureOnce: async () => {
        captureCount += 1;
        throw new Error('fixture storage mismatch');
      },
      closeSession: async (session) => { session.closed = true; },
      abortSession: async () => { abortCount += 1; return { confirmed: true }; },
    }),
    /fixture storage mismatch/,
  );

  assert.equal(sessions.length, 1);
  assert.equal(captureCount, 1);
  assert.equal(sessions[0].closed, true);
  assert.equal(abortCount, 0);
});

test('failed session cleanup preserves the screenshot timeout and cleanup errors and never retries', async () => {
  const sessions = [];
  await assert.rejects(
    runFixtureWithFreshSession({
      fixture: { name: 'cross-budget-period' },
      createSession: injectedSessionFactory(sessions, 53_000),
      captureOnce: async () => { throw retryableTimeout('TIMEOUT screenshot primary'); },
      closeSession: async () => {},
      abortSession: async () => { throw new Error('session cleanup failed'); },
    }),
    (error) => /TIMEOUT screenshot primary/.test(error.message) && /session cleanup failed/.test(error.message),
  );

  assert.equal(sessions.length, 1);
});

test('second fixture retry keeps the first fixture result and fixed fixture order', async () => {
  const sessions = [];
  const captureCounts = new Map();
  const fixtures = [{ name: 'normal-accumulated' }, { name: 'prepaid-recovery' }, { name: 'empty-bills' }, { name: 'cross-budget-period' }];
  const results = await runFixturesWithFreshSessions({
    fixtures,
    createSession: injectedSessionFactory(sessions, 54_000),
    captureOnce: async (session, fixture) => {
      const count = (captureCounts.get(fixture.name) || 0) + 1;
      captureCounts.set(fixture.name, count);
      if (fixture.name === 'prepaid-recovery' && count === 1) throw retryableTimeout('TIMEOUT second fixture');
      return { outputPath: `${fixture.name}-${count}.png`, width: 390, height: 753 };
    },
    closeSession: async (session) => { session.closed = true; },
    abortSession: async (session) => { session.aborted = true; return { confirmed: true }; },
  });

  assert.deepEqual(results.map((result) => result.fixture), fixtures.map((fixture) => fixture.name));
  assert.equal(captureCounts.get('normal-accumulated'), 1);
  assert.equal(captureCounts.get('prepaid-recovery'), 2);
  assert.equal(captureCounts.get('empty-bills'), 1);
  assert.equal(captureCounts.get('cross-budget-period'), 1);
  assert.equal(results[0].capture.outputPath, 'normal-accumulated-1.png');
  assert.equal(results[1].capture.outputPath, 'prepaid-recovery-2.png');
});
