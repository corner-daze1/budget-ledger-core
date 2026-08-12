import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
  assert.deepEqual(FIXTURE_NAMES, [
    'normal-accumulated',
    'prepaid-recovery',
    'empty-bills',
    'cross-budget-period',
    'ledger-overview',
    'ledger-expanded',
  ]);
  const fixture = makeFixture('cross-budget-period', '2026-08-04');
  assert.equal(fixture.state.budgetPeriods.length, 2);
  assert.equal(fixture.state.budgetPeriods[0].status, 'closed');
  assert.equal(fixture.state.budgetPeriods[1].status, 'open');
  assert.equal(fixture.expected.budgetPeriodCount, 2);
  assert.equal(fixture.expected.periodId, fixture.state.budgetPeriods[1].id);
  assert.equal(fixture.expected.billCount, 1);
});

test('cross-budget fixture uses only the v3 settlement decision parameter', async () => {
  const script = await fs.readFile(new URL('../scripts/visual-evidence.mjs', import.meta.url), 'utf8');
  assert.match(script, /settleCurrentPeriod\(state, nowDate, \{ decision: 'carry' \}\)/);
  assert.doesNotMatch(script, /positiveMode|overspendMode/);
});

test('ledger visual fixtures contain three dates and expense income refund transfer in both docked modes', () => {
  for (const [name, captureMode] of [['ledger-overview', 'overview'], ['ledger-expanded', 'expanded']]) {
    const fixture = makeFixture(name, '2026-08-04');
    const kinds = new Set(fixture.state.transactions.map((item) => item.kind));
    assert.equal(fixture.captureMode, captureMode);
    assert.equal(fixture.expected.ledgerDateCount, 3);
    assert(kinds.has('controlled_expense'));
    assert(kinds.has('income'));
    assert(kinds.has('refund'));
    assert(kinds.has('transfer'));
  }
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

test('visual evidence resets page and ledger scroll positions to zero before capture', async (t) => {
  assert.equal(typeof visualEvidence.resetPageScrollForEvidence, 'function');
  const previousGetApp = globalThis.getApp;
  const previousGetCurrentPages = globalThis.getCurrentPages;
  const previousWx = globalThis.wx;
  const app = {};
  const page = {
    route: 'pages/home/home',
    data: { ledgerMode: 'overview', ledgerScrollTop: 12 },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => [page];
  globalThis.wx = {
    createSelectorQuery() {
      const query = {
        in() { return query; },
        selectViewport() {
          return {
            scrollOffset(callback) {
              callback({ scrollTop: 0 });
              return this;
            },
            exec() {},
          };
        },
        select() {
          return {
            scrollOffset(callback) {
              callback({ scrollTop: page.data.ledgerScrollTop });
              return query;
            },
          };
        },
        exec() {},
      };
      return query;
    },
  };
  t.after(() => {
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
    if (previousGetCurrentPages === undefined) delete globalThis.getCurrentPages;
    else globalThis.getCurrentPages = previousGetCurrentPages;
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  });
  const calls = [];
  const miniProgram = {
    async pageScrollTo(top) {
      calls.push(['pageScrollTo', top]);
    },
    async evaluate(fn, ...args) {
      return fn(...args);
    },
  };

  const result = await visualEvidence.resetPageScrollForEvidence(miniProgram);
  assert.deepEqual(result, {
    path: 'pages/home/home',
    ledgerMode: 'overview',
    pageScrollTop: 0,
    viewportScrollTop: 0,
    ledgerScrollTop: 0,
  });
  assert.deepEqual(calls, [['pageScrollTo', 0]]);
});

test('visual evidence uses the native viewport readback when page.scrollTop is unavailable', async (t) => {
  const previousGetApp = globalThis.getApp;
  const previousGetCurrentPages = globalThis.getCurrentPages;
  const previousWx = globalThis.wx;
  const app = {};
  const page = {
    route: 'pages/home/home',
    data: { ledgerMode: 'overview', ledgerScrollTop: 22 },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => [page];
  globalThis.wx = {
    createSelectorQuery() {
      const query = {
        in() { return query; },
        selectViewport() {
          return {
            scrollOffset(callback) {
              callback({ scrollTop: 0 });
              return this;
            },
            exec() {},
          };
        },
        select() {
          return {
            scrollOffset(callback) {
              callback({ scrollTop: page.data.ledgerScrollTop });
              return query;
            },
          };
        },
        exec() {},
      };
      return query;
    },
  };
  t.after(() => {
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
    if (previousGetCurrentPages === undefined) delete globalThis.getCurrentPages;
    else globalThis.getCurrentPages = previousGetCurrentPages;
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  });

  const calls = [];
  const miniProgram = {
    async pageScrollTo(top) {
      calls.push(['pageScrollTo', top]);
    },
    async evaluate(fn, ...args) {
      return fn(...args);
    },
  };

  assert.equal(page.scrollTop, undefined);
  assert.equal(page.$, undefined);
  const result = await visualEvidence.resetPageScrollForEvidence(miniProgram);
  assert.equal(result.pageScrollTop, 0);
  assert.equal(result.viewportScrollTop, 0);
  assert.equal(result.ledgerScrollTop, 0);
  assert.deepEqual(calls, [['pageScrollTo', 0]]);
});

test('visual evidence uses evaluate page instances when page automation APIs are unavailable', async (t) => {
  assert.equal(typeof visualEvidence.enterExpandedLedgerForEvidence, 'function');
  assert.equal(typeof visualEvidence.resetPageScrollForEvidence, 'function');
  const previousGetApp = globalThis.getApp;
  const previousGetCurrentPages = globalThis.getCurrentPages;
  const previousWx = globalThis.wx;
  const app = {};
  const page = {
    route: 'pages/home/home',
    data: { ledgerMode: 'overview', ledgerScrollTop: 83 },
    enterLedger() {
      this.setData({ ledgerMode: 'expanded', ledgerScrollEnabled: true, ledgerScrollTop: 0 });
    },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => [page];
  globalThis.wx = {
    createSelectorQuery() {
      const query = {
        in(candidate) {
          assert.equal(candidate, page);
          return query;
        },
        select(selector) {
          assert.equal(selector, 'scroll-view');
          return {
            scrollOffset(callback) {
              callback({ scrollTop: page.data.ledgerScrollTop });
              return query;
            },
          };
        },
        selectViewport() {
          return {
            scrollOffset(callback) {
              callback({ scrollTop: 0 });
              return this;
            },
            exec() {},
          };
        },
        exec() {},
      };
      return query;
    },
    createSelectorQueryViewport() {},
  };
  t.after(() => {
    if (previousGetApp === undefined) delete globalThis.getApp;
    else globalThis.getApp = previousGetApp;
    if (previousGetCurrentPages === undefined) delete globalThis.getCurrentPages;
    else globalThis.getCurrentPages = previousGetCurrentPages;
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
  });

  const calls = [];
  const miniProgram = {
    async pageScrollTo(top) {
      calls.push(['pageScrollTo', top]);
    },
    async evaluate(fn, ...args) {
      return fn(...args);
    },
  };
  assert.equal(page.$, undefined);
  assert.equal(page.callMethod, undefined);
  const expanded = await visualEvidence.enterExpandedLedgerForEvidence(miniProgram);
  const reset = await visualEvidence.resetPageScrollForEvidence(miniProgram, 'scroll-view');

  assert.equal(expanded.mode, 'expanded');
  assert.equal(expanded.ledgerScrollTop, 0);
  assert.equal(reset.path, 'pages/home/home');
  assert.equal(reset.ledgerMode, 'expanded');
  assert.equal(reset.ledgerScrollTop, 0);
  assert.equal(reset.pageScrollTop, 0);
  assert.equal(reset.viewportScrollTop, 0);
  assert.deepEqual(calls, [['pageScrollTo', 0]]);
});

async function freeTestPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForTestPort(port, expectedOpen) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(250, () => finish(false));
    });
    if (open === expectedOpen) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`test port ${port} did not reach expected state ${expectedOpen}`);
}

test('cleanup verification rejects a live QA process and port after close reports success', async (t) => {
  assert.equal(typeof visualEvidence.verifyQaCleanup, 'function');
  const diagnosticRoot = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\yongdu-phase11-diag-b9f5b75e6b3743ba9ba43ddaff8c4907\\.visual-qa';
  const port = await freeTestPort();
  const child = spawn(process.execPath, [
    '-e',
    "const net=require('node:net'); const p=Number(process.argv[process.argv.indexOf('--auto-port')+1]); net.createServer().listen(p,'127.0.0.1'); setInterval(()=>{},1000);",
    'auto',
    '--project',
    diagnosticRoot,
    '--auto-port',
    String(port),
  ], { stdio: 'ignore', windowsHide: true });
  t.after(() => {
    if (!child.killed) child.kill();
  });
  await waitForTestPort(port, true);

  const simulatedLifecycle = { disconnect: 'success', kill: 'success', cliClose: 'success' };
  assert.deepEqual(simulatedLifecycle, { disconnect: 'success', kill: 'success', cliClose: 'success' });
  const verification = await visualEvidence.verifyQaCleanup({ projectPath: diagnosticRoot, port, timeoutMs: 300 });
  assert.equal(verification.confirmed, false);
  assert.equal(verification.portOpen, true);
  assert(verification.residualProcesses.length >= 1);
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
  const greenPath = path.join(outputRoot, 'six-states-green.txt');
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

function validMinimalProbeSession({ ok = true, port = 45_321 } = {}) {
  const startedAt = '2026-08-06T00:00:00.000Z';
  const finishedAt = '2026-08-06T00:00:01.000Z';
  return {
    session: 1,
    stage: 'minimal-screenshot',
    port,
    stages: ['connect', 'currentPage', 'evaluate', 'screenshot', 'cleanup'].map((name) => ({
      name,
      startedAt,
      finishedAt,
      ok: true,
      error: null,
    })),
    request: {
      startedAt,
      finishedAt,
      ok,
      error: ok ? null : { message: 'TIMEOUT screenshot after 30000ms' },
      png: ok ? {
        ok: true,
        path: 'artifacts/visual-evidence/screenshot-diagnostic-system-1.png',
        width: 390,
        height: 753,
        byteLength: 1024,
        sha256: 'a'.repeat(64),
      } : null,
    },
    cleanup: {
      confirmed: true,
      cliCloseCompleted: true,
      residualProcesses: [],
      portOpen: false,
      verification: { confirmed: true, residualProcesses: [], portOpen: false },
    },
  };
}

test('screenshot diagnostic rejects missing request stage port PNG or real cleanup evidence', () => {
  assert.equal(typeof visualEvidence.validateScreenshotDiagnosticResult, 'function');
  const base = {
    schemaVersion: 1,
    project: { kind: 'minimal', appid: 'touristappid' },
    startedAt: '2026-08-06T00:00:00.000Z',
    finishedAt: '2026-08-06T00:00:01.000Z',
    nodeRuns: [{ node: { label: 'system', version: 'v24.16.0' }, sessions: [validMinimalProbeSession()] }],
  };
  const cases = [
    ['request start', (candidate) => { delete candidate.nodeRuns[0].sessions[0].request.startedAt; }],
    ['stage', (candidate) => { candidate.nodeRuns[0].sessions[0].stages = []; }],
    ['port', (candidate) => { delete candidate.nodeRuns[0].sessions[0].port; }],
    ['PNG result', (candidate) => { candidate.nodeRuns[0].sessions[0].request.png = null; }],
    ['cleanup verification', (candidate) => { candidate.nodeRuns[0].sessions[0].cleanup.verification = null; }],
  ];
  for (const [label, mutate] of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.throws(() => visualEvidence.validateScreenshotDiagnosticResult(candidate), new RegExp(label, 'i'));
  }
});

test('screenshot diagnostic never continues current-project probing before a stable minimal 2-of-2', () => {
  assert.equal(typeof visualEvidence.decideScreenshotDiagnostic, 'function');
  const decision = visualEvidence.decideScreenshotDiagnostic({
    nodeRuns: [{
      node: { label: 'system', version: 'v24.16.0' },
      sessions: [validMinimalProbeSession({ ok: true }), validMinimalProbeSession({ ok: false, port: 45_322 })],
    }],
  });
  assert.equal(decision.continueCurrentProject, false);
  assert.equal(decision.canDeclareApplicationIssue, false);
  assert.equal(decision.selectedNode, null);
  assert.equal(decision.conclusion, 'minimal-probe-not-stable');
});

function validStableSingleInstanceSession({ session = 1, ok = true, cleanupConfirmed = true, port = 61_001 } = {}) {
  return {
    session,
    ok,
    port,
    request: { ok, error: ok ? null : { message: 'TIMEOUT strict screenshot after 30000ms' } },
    cleanup: {
      confirmed: cleanupConfirmed,
      verification: {
        confirmed: cleanupConfirmed,
        residualProcesses: cleanupConfirmed ? [] : [{ pid: 9911 }],
        portOpen: !cleanupConfirmed,
      },
      residualProcesses: cleanupConfirmed ? [] : [{ pid: 9911 }],
      portOpen: !cleanupConfirmed,
    },
  };
}

test('strict single-instance entry fixes the C-drive CLI and bundled Node for a minimal touristappid project', () => {
  assert.equal(typeof visualEvidence.stableSingleInstanceConfig, 'function');
  const projectPath = path.resolve('.visual-probe');
  const config = visualEvidence.stableSingleInstanceConfig({ projectPath, port: 61_001 });
  assert.equal(config.cliPath, 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat');
  assert.equal(config.nodeExecutable, 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\node.exe');
  assert.equal(config.projectPath, projectPath);
  assert.equal(config.appid, 'touristappid');
  assert.deepEqual(config.cliArguments, ['auto', '--project', projectPath, '--auto-port', '61001', '--trust-project']);
  assert.doesNotMatch(JSON.stringify(config), /--auto-account|wx9567fb4ff6336d0b/);
});

test('strict single-instance outputs use distinct session paths and never overwrite the old diagnostic result or log', () => {
  assert.equal(typeof visualEvidence.stableSingleInstanceOutputPaths, 'function');
  const root = path.resolve('artifacts/visual-evidence/single-instance');
  const output = visualEvidence.stableSingleInstanceOutputPaths(root);
  assert.equal(output.resultPath, path.join(root, 'result.json'));
  assert.equal(output.logPath, path.join(root, 'run.log'));
  assert.notEqual(output.pngPath(1), output.pngPath(2));
  assert.equal(output.pngPath(1).startsWith(root), true);
  assert.equal(output.pngPath(2).startsWith(root), true);
  assert.doesNotMatch(output.resultPath, /screenshot-diagnostic/);
  assert.doesNotMatch(output.logPath, /screenshot-diagnostic/);
  assert.notEqual(output.resultPath, path.resolve('artifacts/visual-evidence/screenshot-diagnostic.json'));
  assert.notEqual(output.logPath, path.resolve('artifacts/visual-evidence/screenshot-diagnostic.log'));
});

test('strict single-instance starts a second session only after the first cleanup is confirmed', () => {
  assert.equal(typeof visualEvidence.canStartNextStableSingleInstanceSession, 'function');
  assert.equal(visualEvidence.canStartNextStableSingleInstanceSession(validStableSingleInstanceSession({ cleanupConfirmed: false })), false);
  assert.equal(visualEvidence.canStartNextStableSingleInstanceSession(validStableSingleInstanceSession({ cleanupConfirmed: true })), true);
});

test('strict single-instance decision distinguishes 2-of-2, 0-of-2, and 1-of-2 outcomes', () => {
  assert.equal(typeof visualEvidence.decideStableSingleInstance, 'function');
  const stable = visualEvidence.decideStableSingleInstance([
    validStableSingleInstanceSession({ session: 1, ok: true, port: 61_001 }),
    validStableSingleInstanceSession({ session: 2, ok: true, port: 61_002 }),
  ]);
  assert.equal(stable.sessionCount, 2);
  assert.equal(stable.successCount, 2);
  assert.equal(stable.decision, 'stable-single-instance-2-of-2');
  assert.equal(stable.classification, 'important-candidate-variable');

  const failed = visualEvidence.decideStableSingleInstance([
    validStableSingleInstanceSession({ session: 1, ok: false, port: 61_003 }),
    validStableSingleInstanceSession({ session: 2, ok: false, port: 61_004 }),
  ]);
  assert.equal(failed.sessionCount, 2);
  assert.equal(failed.successCount, 0);
  assert.equal(failed.decision, 'stable-single-instance-0-of-2');
  assert.equal(failed.classification, 'd-coexistence-not-necessary');

  const intermittent = visualEvidence.decideStableSingleInstance([
    validStableSingleInstanceSession({ session: 1, ok: true, port: 61_005 }),
    validStableSingleInstanceSession({ session: 2, ok: false, port: 61_006 }),
  ]);
  assert.equal(intermittent.sessionCount, 2);
  assert.equal(intermittent.successCount, 1);
  assert.equal(intermittent.decision, 'stable-single-instance-1-of-2');
  assert.equal(intermittent.classification, 'intermittent');
});

test('screenshot protocol parser extracts direction, UUID, method, and raw debug line', () => {
  assert.equal(typeof visualEvidence.parseProtocolDebugLine, 'function');
  const line = '2026-08-06T22:00:00.000Z SEND ► {"id":"uuid-1","method":"App.captureScreenshot","params":{"path":"C:\\\\tmp\\\\shot.png"}}';
  const parsed = visualEvidence.parseProtocolDebugLine(line);
  assert.equal(parsed.direction, 'SEND');
  assert.equal(parsed.payload.id, 'uuid-1');
  assert.equal(parsed.payload.method, 'App.captureScreenshot');
  assert.equal(parsed.raw, line);
});

test('screenshot protocol trace associates only the matching UUID reply with App.captureScreenshot', () => {
  assert.equal(typeof visualEvidence.associateScreenshotProtocol, 'function');
  const messages = [
    visualEvidence.parseProtocolDebugLine('SEND ► {"id":"other","method":"App.evaluate","params":{}}'),
    visualEvidence.parseProtocolDebugLine('SEND ► {"id":"uuid-2","method":"App.captureScreenshot","params":{"path":"shot.png"}}'),
    visualEvidence.parseProtocolDebugLine('RECV ◀ {"id":"other","result":{}}'),
    visualEvidence.parseProtocolDebugLine('RECV ◀ {"id":"uuid-2","result":{"data":"png"}}'),
  ];
  const trace = visualEvidence.associateScreenshotProtocol(messages);
  assert.equal(trace.uuid, 'uuid-2');
  assert.equal(trace.screenshotSend.payload.id, 'uuid-2');
  assert.equal(trace.screenshotReply.payload.id, 'uuid-2');
  assert.equal(trace.screenshotReply.payload.result.data, 'png');
});

test('screenshot protocol redaction retains metadata but never stores a base64 body', () => {
  assert.equal(typeof visualEvidence.redactProtocolPayload, 'function');
  const body = 'A'.repeat(256);
  const redacted = visualEvidence.redactProtocolPayload({ id: 'uuid-3', result: { data: body }, body });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, new RegExp(body));
  assert.equal(redacted.result.data.redacted, true);
  assert.equal(redacted.result.data.length, body.length);
  assert.equal(redacted.body.redacted, true);
  assert.equal(redacted.body.sha256.length, 64);
});

test('screenshot protocol classification separates missing send, missing reply, protocol error, postprocess failure, success, and inconclusive cleanup', () => {
  assert.equal(typeof visualEvidence.classifyScreenshotProtocolTrace, 'function');
  const send = { payload: { id: 'uuid-4', method: 'App.captureScreenshot' } };
  const successReply = { payload: { id: 'uuid-4', result: { data: 'png' } } };
  const errorReply = { payload: { id: 'uuid-4', error: { code: 'E_TIMEOUT', message: 'timeout' } } };
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: null, screenshotReply: null, screenshotPostprocessOk: false, cleanupConfirmed: true }), 'send-not-observed');
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: send, screenshotReply: null, screenshotPostprocessOk: false, cleanupConfirmed: true }), 'sent-no-matching-reply');
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: send, screenshotReply: errorReply, screenshotPostprocessOk: false, cleanupConfirmed: true }), 'explicit-protocol-error');
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: send, screenshotReply: successReply, screenshotPostprocessOk: false, cleanupConfirmed: true }), 'reply-success-postprocess-failure');
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: send, screenshotReply: successReply, screenshotPostprocessOk: true, cleanupConfirmed: true }), 'screenshot-success');
  assert.equal(visualEvidence.classifyScreenshotProtocolTrace({ screenshotSend: send, screenshotReply: successReply, screenshotPostprocessOk: true, cleanupConfirmed: false }), 'trace-inconclusive');
});

test('screenshot protocol result rejects ambiguous top-level ok and requires separate completion fields', () => {
  assert.equal(typeof visualEvidence.validateProtocolTraceResult, 'function');
  const base = {
    schemaVersion: 1,
    stage: 'trace-screenshot-protocol',
    startedAt: '2026-08-06T00:00:00.000Z',
    finishedAt: '2026-08-06T00:00:01.000Z',
    diagnosticCompleted: true,
    screenshotSucceeded: true,
    classification: 'screenshot-success',
    project: { kind: 'minimal', path: '.visual-probe', appid: 'touristappid', pagePath: '/pages/index/index' },
    screenshotRequestCount: 1,
    protocol: { screenshotSend: { payload: { id: 'uuid-5' } }, screenshotReply: { payload: { id: 'uuid-5' } } },
    cleanup: { confirmed: true, probeRemoved: true, verification: { confirmed: true, residualProcesses: [], portOpen: false } },
  };
  assert.equal(visualEvidence.validateProtocolTraceResult(base), true);
  const ambiguous = { ...structuredClone(base), ok: true };
  assert.throws(() => visualEvidence.validateProtocolTraceResult(ambiguous), /top-level ok/);
  const incomplete = structuredClone(base);
  delete incomplete.diagnosticCompleted;
  assert.throws(() => visualEvidence.validateProtocolTraceResult(incomplete), /diagnosticCompleted/);
});
