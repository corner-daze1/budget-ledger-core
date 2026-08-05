import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import automator from 'miniprogram-automator';

import {
  getHomeModel,
  initializeState,
  listRecentBills,
  recordEntry,
  settleCurrentPeriod,
  todayIso,
} from '../src/application/app-core.js';
import { addDays, budgetSnapshot, dateDistance } from '../src/domain/budget.js';
import { restoreBackup, serializeBackup } from '../src/domain/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA_ROOT = path.join(ROOT, '.visual-qa');
const EVIDENCE_ROOT = path.join(ROOT, 'artifacts', 'visual-evidence');
const COMPAT_ROOT = path.join(EVIDENCE_ROOT, 'compatibility');
const QA_APP_ID = 'touristappid';
const STORAGE_KEY = 'yongdu-ledger-v1';
const HOME_ROUTE = '/pages/home/home';
const AUTOMATOR_TIMEOUT_MS = 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const SESSION_CLEANUP_TIMEOUT_MS = 5_000;
const EVIDENCE_RUN_TIMEOUT_MS = 12 * 60_000;
const FIXTURE_NAMES = [
  'normal-accumulated',
  'prepaid-recovery',
  'empty-bills',
  'cross-budget-period',
];

const ownedOutputNames = new Set([
  'normal-accumulated.png',
  'prepaid-recovery.png',
  'empty-bills.png',
  'cross-budget-period.png',
  'long-text-large-amount.png',
  'console.jsonl',
  'manifest.json',
  'four-states-green.txt',
]);

function json(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === 'bigint') return `${nested}n`;
    if (nested instanceof Error) return { name: nested.name, message: nested.message, stack: nested.stack };
    return nested;
  });
}

function isoNow() {
  return new Date().toISOString();
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content.endsWith('\n') ? content : `${content}\n`}`, 'utf8');
}

async function writeAtomicText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    await fs.writeFile(temporaryPath, `${content.endsWith('\n') ? content : `${content}\n`}`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function removePaths(paths) {
  for (const filePath of paths.filter(Boolean)) {
    await fs.rm(filePath, { force: true });
  }
}

async function removeTemporaryFiles(directory, prefixes) {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      await fs.rm(path.join(directory, entry.name), { force: true });
    }
  }
}

async function removeTemporaryDirectories(directory, prefixes) {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && prefixes.some((prefix) => entry.name.startsWith(prefix))) {
      await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
    }
  }
}

function compatibilityOutputPaths(root = COMPAT_ROOT) {
  return {
    resultPath: path.join(root, 'compatibility.json'),
    screenshotPath: path.join(root, 'sample.png'),
    rawErrorPath: path.join(root, 'compatibility-error.txt'),
  };
}

function visualEvidenceOutputPaths(root = EVIDENCE_ROOT) {
  return {
    consolePath: path.join(root, 'console.jsonl'),
    manifestPath: path.join(root, 'manifest.json'),
    greenPath: path.join(root, 'four-states-green.txt'),
    pngPaths: FIXTURE_NAMES.map((name) => path.join(root, `${name}.png`)),
  };
}

async function withTimeout(operation, label, timeoutMs = AUTOMATOR_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT ${label} after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function withRetryableTimeout(operation, label, timeoutMs = AUTOMATOR_TIMEOUT_MS) {
  try {
    return await withTimeout(operation, label, timeoutMs);
  } catch (error) {
    if (/TIMEOUT/.test(error?.message || '')) {
      error.retryable = true;
      error.retryStage = label;
    }
    throw error;
  }
}

function sessionTimeoutMs(requestedMs, deadline, label) {
  if (deadline == null) return requestedMs;
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    const error = new Error(`TIMEOUT ${label}: evidence run deadline exceeded`);
    error.retryable = true;
    error.retryStage = label;
    throw error;
  }
  return Math.min(requestedMs, remainingMs);
}

function withSessionTimeout(operation, label, timeoutMs = AUTOMATOR_TIMEOUT_MS, { retryable = false, deadline = null } = {}) {
  const effectiveTimeoutMs = sessionTimeoutMs(timeoutMs, deadline, label);
  return retryable
    ? withRetryableTimeout(operation, label, effectiveTimeoutMs)
    : withTimeout(operation, label, effectiveTimeoutMs);
}

function isRetryableSessionError(error) {
  if (error?.retryable === true) return true;
  const message = String(error?.message || error || '');
  if (/fixture|storage|PNG|截图必须|console|runtime error|exception|断言|assert/i.test(message)) return false;
  return /WebSocket|socket|ECONN|transport|not connected|connection|timed out|TIMEOUT|timeout/i.test(message);
}

function attachAttemptDetails(error, attempts) {
  if (error && typeof error === 'object') error.attempts = attempts;
  return error;
}

function relativePath(fullPath) {
  return path.relative(ROOT, fullPath).split(path.sep).join('/');
}

function isAllowedPath(relative) {
  if (relative === 'package.json' || relative === 'package-lock.json' || relative === '.gitignore') return true;
  if (relative === 'PROGRESS.md' || relative === 'BLOCKED.md') return true;
  if (relative === 'docs/VISUAL_EVIDENCE.md') return true;
  if (/^scripts\/visual-evidence\.(?:js|mjs)$/.test(relative)) return true;
  if (/^tests\/visual-evidence[^/]*\.test\.js$/.test(relative)) return true;
  if (relative.startsWith('tests/fixtures/visual/')) return true;
  if (relative.startsWith('artifacts/visual-evidence/')) return true;
  if (relative.startsWith('.visual-qa/')) return true;
  return false;
}

async function walkFiles(directory, relativePrefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.visual-qa') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath, relative));
    else if (entry.isFile()) files.push({ fullPath, relative });
  }
  return files;
}

async function protectedHashRecords() {
  const files = (await walkFiles(ROOT)).filter(({ relative }) => !isAllowedPath(relative));
  const records = [];
  for (const file of files) {
    records.push({ relative: file.relative, sha256: sha256Bytes(await fs.readFile(file.fullPath)) });
  }
  return records.sort((left, right) => left.relative.localeCompare(right.relative));
}

function renderHashManifest(records) {
  return [
    'kind=visual-evidence-protected-files',
    `createdAt=${isoNow()}`,
    `protectedCount=${records.length}`,
    ...records.map(({ sha256, relative }) => `${sha256}  ${relative}`),
  ].join('\n');
}

function parseHashManifest(content) {
  return new Map(content.split(/\r?\n/)
    .filter((line) => /^[0-9a-f]{64}  /.test(line))
    .map((line) => {
      const [sha256, ...pathParts] = line.split('  ');
      return [pathParts.join('  '), sha256];
    }));
}

async function saveProtectedHashes(which) {
  const records = await protectedHashRecords();
  const filePath = path.join(EVIDENCE_ROOT, `protected-hashes-${which}.txt`);
  await writeText(filePath, renderHashManifest(records));
  return { filePath, records };
}

async function compareProtectedHashes() {
  const beforePath = path.join(EVIDENCE_ROOT, 'protected-hashes-before.txt');
  const before = parseHashManifest(await fs.readFile(beforePath, 'utf8'));
  const { filePath: afterPath, records } = await saveProtectedHashes('after');
  const after = new Map(records.map(({ relative, sha256 }) => [relative, sha256]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changed = paths.filter((relative) => before.get(relative) !== after.get(relative));
  const result = {
    beforeCount: before.size,
    afterCount: after.size,
    changed,
    ok: changed.length === 0 && before.size === after.size,
    beforePath: relativePath(beforePath),
    afterPath: relativePath(afterPath),
  };
  await writeText(path.join(EVIDENCE_ROOT, 'protected-hashes-compare.txt'), json(result));
  if (!result.ok) throw new Error(`protected file hash mismatch: ${json(result)}`);
  return result;
}

async function findStableCli() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    process.env.WECHAT_CLI_PATH,
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`未找到微信开发者工具 CLI；候选路径：${candidates.join('；')}`);
}

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function buildCliArguments({ projectPath, port }) {
  if (!path.isAbsolute(projectPath)) throw new Error(`QA project path must be absolute: ${projectPath}`);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid automation port: ${port}`);
  return ['auto', '--project', projectPath, '--auto-port', String(port), '--trust-project'];
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildCliCommand(cliPath, cliArguments) {
  return `& ${powershellQuote(cliPath)} ${cliArguments.map(powershellQuote).join(' ')}`;
}

async function runCliCommand(cliPath, cliArguments, label, timeoutMs = 20_000) {
  const command = buildCliCommand(cliPath, cliArguments);
  const cliProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const cliOutput = { stdout: [], stderr: [] };
  cliProcess.stdout?.on('data', (chunk) => cliOutput.stdout.push(Buffer.from(chunk)));
  cliProcess.stderr?.on('data', (chunk) => cliOutput.stderr.push(Buffer.from(chunk)));
  let exitInfo;
  try {
    exitInfo = await withTimeout(() => observeCliExit(cliProcess, cliOutput), label, timeoutMs);
  } catch (error) {
    if (!cliProcess.killed) cliProcess.kill();
    throw error;
  }
  if (exitInfo.type !== 'exit' || exitInfo.code !== 0) throw formatCliExit(exitInfo, 0);
  return exitInfo;
}

async function closeQaProject(cliPath, timeoutMs = SESSION_CLEANUP_TIMEOUT_MS) {
  return runCliCommand(cliPath, ['close', '--project', QA_ROOT], 'close stale QA project', timeoutMs);
}

async function prepareIsolatedProject(cliPath) {
  try {
    await fs.rm(QA_ROOT, { recursive: true, force: true });
  } catch (error) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error;
    await closeQaProject(cliPath);
    await fs.rm(QA_ROOT, { recursive: true, force: true });
  }
  await fs.mkdir(QA_ROOT, { recursive: true });
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (['.git', 'node_modules', 'artifacts', '.visual-qa'].includes(entry.name)) continue;
    const sourcePath = path.join(ROOT, entry.name);
    const targetPath = path.join(QA_ROOT, entry.name);
    if (entry.isDirectory()) await fs.cp(sourcePath, targetPath, { recursive: true });
    else if (entry.isFile()) await fs.copyFile(sourcePath, targetPath);
  }
  const configPath = path.join(QA_ROOT, 'project.config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.appid = QA_APP_ID;
  config.projectname = 'yongdu-visual-qa';
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const verified = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(verified.appid, QA_APP_ID, '隔离项目必须使用 touristappid');
  const privateConfigPath = path.join(QA_ROOT, 'project.private.config.json');
  if (await exists(privateConfigPath)) {
    const privateConfig = JSON.parse(await fs.readFile(privateConfigPath, 'utf8'));
    privateConfig.setting = { ...privateConfig.setting, useApiHook: false };
    await fs.writeFile(privateConfigPath, `${JSON.stringify(privateConfig, null, 2)}\n`, 'utf8');
  }
  return { projectPath: QA_ROOT, configPath };
}

function pngInfo(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '截图必须是 PNG');
  assert.equal(bytes.readUInt32BE(12), 0x49484452, 'PNG 必须包含 IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function yuanFromCents(cents) {
  assert(Number.isInteger(cents) && cents > 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function fixtureBase({ nowDate, startDay = Number(nowDate.slice(8, 10)), monthlyBudgetYuan = '3000', balanceYuan = '10000' }) {
  return initializeState({
    monthlyBudgetYuan,
    startDay,
    nowDate,
    accounts: [{ id: 'qa-cash', name: '隔离测试现金', type: 'cash', balanceYuan }],
  });
}

function roundTrip(state) {
  const raw = serializeBackup(state);
  const restored = restoreBackup(raw);
  assert.equal(restored.ok, true, 'fixture serializeBackup→restoreBackup 必须成功');
  assert.deepEqual(restored.data, state, 'fixture restoreBackup 必须逐字段等于原状态');
  return { raw, rawSha256: sha256Bytes(Buffer.from(raw, 'utf8')) };
}

function makeFixture(name, nowDate) {
  let state;
  if (name === 'normal-accumulated') {
    state = fixtureBase({ nowDate });
    state = recordEntry(state, {
      amountYuan: '10.00', date: nowDate, accountId: 'qa-cash', categoryLevel1: '餐饮', categoryLevel2: '早餐', note: '隔离正常态第一笔', includeControlledBudget: true,
    });
    state = recordEntry(state, {
      amountYuan: '20.00', date: nowDate, accountId: 'qa-cash', categoryLevel1: '餐饮', categoryLevel2: '午餐', note: '隔离正常态第二笔', includeControlledBudget: true,
    });
  } else if (name === 'prepaid-recovery') {
    state = fixtureBase({ nowDate });
    const period = state.budgetPeriods[0];
    const elapsedDays = dateDistance(period.startDate, nowDate) + 1;
    const totalDays = period.totalDays || dateDistance(period.startDate, period.endDate) + 1;
    const release = budgetSnapshot({
      actualBudgetCents: period.baseBudgetCents,
      elapsedDays,
      totalDays,
      netBudgetSpendCents: 0,
      startDate: period.startDate,
    });
    const amountCents = release.releasedCents + release.fullSingleDayQuotaCents + 10_000;
    state = recordEntry(state, {
      amountYuan: yuanFromCents(amountCents), date: nowDate, accountId: 'qa-cash', categoryLevel1: '购物', categoryLevel2: '数码', note: '隔离预支恢复态', includeControlledBudget: true,
    });
  } else if (name === 'empty-bills') {
    state = fixtureBase({ nowDate });
  } else if (name === 'cross-budget-period') {
    const previousPeriodEndDate = addDays(`${nowDate.slice(0, 8)}01`, -1);
    state = fixtureBase({ nowDate: previousPeriodEndDate, startDay: 1 });
    state = recordEntry(state, {
      amountYuan: '30.00', date: previousPeriodEndDate, accountId: 'qa-cash', categoryLevel1: '餐饮', categoryLevel2: '晚餐',
      note: '隔离跨预算周期上一期账单', includeControlledBudget: true,
    });
    state = settleCurrentPeriod(state, nowDate, { positiveMode: 'carry', overspendMode: 'carry' });
  } else {
    throw new Error(`未知 fixture：${name}`);
  }
  const model = getHomeModel(state, nowDate);
  const bills = listRecentBills(state);
  const { raw, rawSha256 } = roundTrip(state);
  const expected = {
    periodId: model.periodId,
    budgetPeriodCount: state.budgetPeriods.length,
    todayFreeCents: model.todayFreeCents,
    prepaidCents: model.prepaidCents,
    earliestRecoveryDate: model.earliestRecoveryDate,
    fullSingleDayQuotaCents: model.fullSingleDayQuotaCents,
    netBudgetSpendCents: model.netBudgetSpendCents,
    billCount: bills.length,
  };
  if (name === 'prepaid-recovery') {
    assert.equal(expected.todayFreeCents, 0, '预支 fixture 今日可花必须为0');
    assert(expected.prepaidCents > 0, '预支 fixture 必须有正预支金额');
    assert(expected.earliestRecoveryDate, '预支 fixture 必须有恢复日期');
  }
  if (name === 'empty-bills') assert.equal(expected.billCount, 0, '空账单 fixture 不得有账单');
  if (name === 'cross-budget-period') {
    assert.equal(state.budgetPeriods.length, 2, '跨周期 fixture 必须包含已关闭周期和当前周期');
    assert.equal(state.budgetPeriods[0].status, 'closed', '跨周期 fixture 的上一周期必须已关闭');
    assert.equal(state.budgetPeriods[1].status, 'open', '跨周期 fixture 的当前周期必须开放');
    assert.equal(expected.billCount, 1, '跨周期 fixture 必须保留上一周期账单');
  }
  return { name, route: HOME_ROUTE, state, raw, rawSha256, expected };
}

function invalidFixture(kind, nowDate) {
  const fixture = makeFixture('normal-accumulated', nowDate);
  if (kind === 'non-cny') {
    const candidate = JSON.parse(fixture.raw);
    candidate.currency = 'USD';
    fixture.raw = JSON.stringify(candidate);
  } else if (kind === 'duplicate-id') {
    fixture.state.accounts.push({ ...fixture.state.accounts[0] });
    fixture.raw = serializeBackup(fixture.state);
  } else {
    throw new Error(`未知非法 fixture：${kind}`);
  }
  const raw = fixture.raw;
  const restored = restoreBackup(raw);
  assert.equal(restored.ok, false, '非法 fixture 必须在截图前被 restoreBackup 拒绝');
  return { kind, error: restored.error, rawSha256: sha256Bytes(Buffer.from(raw, 'utf8')) };
}

function isEmptyConsoleObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === 0;
}

function classifyConsoleEvent(event) {
  const text = json(event).toLowerCase();
  const level = String(event?.level ?? event?.severity ?? event?.type ?? '').toLowerCase();
  const protocolArtifact = level === 'error'
    && !event?.message
    && !event?.stack
    && Array.isArray(event?.args)
    && event.args.length === 1
    && isEmptyConsoleObject(event.args[0]);
  const isError = !protocolArtifact && (level === 'error' || level === 'exception' || level.includes('error') || /\berror\b|exception|uncaught/.test(text));
  const isWarning = level === 'warning' || level === 'warn' || /\bwarning\b|\bwarn\b/.test(text);
  return { isError, isWarning, protocolArtifact, text };
}

function serializeError(error) {
  const record = {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: error?.stack || '',
  };
  if (Array.isArray(error?.errors)) record.errors = error.errors.map((nested) => serializeError(nested));
  if (Array.isArray(error?.lifecycleStages)) record.lifecycleStages = error.lifecycleStages;
  if (Array.isArray(error?.attempts)) record.attempts = error.attempts;
  if (error?.retryable === true) record.retryable = true;
  if (error?.retryStage) record.retryStage = error.retryStage;
  return record;
}

function combineLifecycleErrors(label, stageErrors) {
  const present = stageErrors.filter((entry) => entry?.error);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0].error;
  const aggregate = new AggregateError(
    present.map((entry) => entry.error),
    `${label}: ${present.map((entry) => `${entry.stage} (${entry.error?.message || String(entry.error)})`).join(', ')}`,
  );
  aggregate.lifecycleStages = present.map((entry) => ({ stage: entry.stage, error: serializeError(entry.error) }));
  return aggregate;
}

function runtimeCliOutputSnapshot(runtime) {
  if (!runtime?.cliOutput) return null;
  try {
    return cliOutputSnapshot(runtime.cliOutput);
  } catch (error) {
    return { error: serializeError(error) };
  }
}

function lifecycleFailureReport({ primaryError, closeError, finalizationError, runtime, events, failure }) {
  return {
    failure: failure ? serializeError(failure) : null,
    primaryError: primaryError ? serializeError(primaryError) : null,
    closeError: closeError ? serializeError(closeError) : null,
    finalizationError: finalizationError ? serializeError(finalizationError) : null,
    cliExit: runtime?.cliExit || null,
    cliOutput: runtimeCliOutputSnapshot(runtime),
    events,
  };
}

function lifecycleFailureText(label, failure, report) {
  return `${label}: ${failure?.stack || failure?.message || String(failure)}\n${json(report)}`;
}

function appendLifecycleFailureEvent(events, stageErrors) {
  const present = stageErrors.filter((entry) => entry?.error);
  if (present.length === 0) return;
  events.push({
    at: isoNow(),
    kind: 'lifecycle-error',
    error: true,
    message: `visual evidence lifecycle failed in ${present.map((entry) => entry.stage).join(', ')}`,
    stageErrors: Object.fromEntries(present.map((entry) => [entry.stage, serializeError(entry.error)])),
  });
}

function describeConsoleValue(value) {
  if (value === null || typeof value !== 'object') return { type: typeof value, value: String(value) };
  return {
    constructor: value.constructor?.name || null,
    ownKeys: Reflect.ownKeys(value).map(String),
    prototypeKeys: Object.getPrototypeOf(value) ? Object.getOwnPropertyNames(Object.getPrototypeOf(value)) : [],
    stringified: String(value),
    name: value.name ?? null,
    message: value.message ?? null,
    stack: value.stack ?? null,
    inspect: inspect(value, { depth: 8, showHidden: true }),
  };
}

function attachEventCapture(miniProgram, events) {
  miniProgram.on('console', (event) => {
    const classified = classifyConsoleEvent(event);
    events.push({ at: isoNow(), kind: 'console', event, raw: inspect(event, { depth: 8, showHidden: true }), argDetails: (event?.args || []).map(describeConsoleValue), warning: classified.isWarning, error: classified.isError, protocolArtifact: classified.protocolArtifact });
  });
  miniProgram.on('exception', (event) => {
    events.push({ at: isoNow(), kind: 'exception', event, raw: inspect(event, { depth: 8, showHidden: true }), warning: false, error: true });
  });
}

async function closeMiniProgram(miniProgram, events, timeoutMs = AUTOMATOR_TIMEOUT_MS) {
  if (!miniProgram) return;
  const closeErrors = [];
  let closeSucceeded = false;
  try {
    await withTimeout(() => miniProgram.miniProgram.close(), 'close', timeoutMs);
    closeSucceeded = true;
  } catch (error) {
    closeErrors.push({ stage: 'close', error });
    events.push({ at: isoNow(), kind: 'close-error', error: true, message: error.message, stack: error.stack });
  }
  if (typeof miniProgram.miniProgram?.disconnect === 'function') {
    try {
      miniProgram.miniProgram.disconnect();
      events.push({ at: isoNow(), kind: 'disconnect', error: false, reason: closeSucceeded ? 'close' : 'close-failed' });
    } catch (error) {
      closeErrors.push({ stage: 'disconnect', error });
      events.push({ at: isoNow(), kind: 'disconnect-error', error: true, message: error.message, stack: error.stack });
    }
  }
  try {
    if (miniProgram.cliProcess && !miniProgram.cliProcess.killed) miniProgram.cliProcess.kill();
  } catch (error) {
    closeErrors.push({ stage: 'terminate-cli', error });
    events.push({ at: isoNow(), kind: 'cli-termination-error', error: true, message: error.message, stack: error.stack });
  }
  const failure = combineLifecycleErrors('mini program close', closeErrors);
  if (failure) throw failure;
}

function cliOutputSnapshot(cliOutput) {
  const stdout = Buffer.concat(cliOutput.stdout);
  const stderr = Buffer.concat(cliOutput.stderr);
  return {
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    stdoutBase64: stdout.toString('base64'),
    stderrBase64: stderr.toString('base64'),
  };
}

function observeCliExit(cliProcess, cliOutput) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    cliProcess.once('error', (error) => finish({ type: 'error', error: serializeError(error), ...cliOutputSnapshot(cliOutput) }));
    cliProcess.once('exit', (code, signal) => finish({ type: 'exit', code, signal, ...cliOutputSnapshot(cliOutput) }));
  });
}

function formatCliExit(exitInfo, port) {
  return new Error(`CLI process exited before automator connection on port ${port}: ${json(exitInfo)}`);
}

function isSuccessfulCliDispatch(exitInfo) {
  return exitInfo?.type === 'exit'
    && exitInfo.code === 0
    && /\bauto\b/.test(`${exitInfo.stdout}\n${exitInfo.stderr}`);
}

async function launchQa(cliPath, events, { deadline = null } = {}) {
  const port = await freeTcpPort();
  const cliArguments = buildCliArguments({ projectPath: QA_ROOT, port });
  const command = buildCliCommand(cliPath, cliArguments);
  const cliProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const cliOutput = { stdout: [], stderr: [] };
  cliProcess.stdout?.on('data', (chunk) => cliOutput.stdout.push(Buffer.from(chunk)));
  cliProcess.stderr?.on('data', (chunk) => cliOutput.stderr.push(Buffer.from(chunk)));
  let cliExitInfo = null;
  const cliExit = observeCliExit(cliProcess, cliOutput).then((exitInfo) => {
    cliExitInfo = exitInfo;
    return exitInfo;
  });
  const abnormalCliExit = cliExit.then((exitInfo) => {
    if (isSuccessfulCliDispatch(exitInfo)) return new Promise(() => {});
    throw formatCliExit(exitInfo, port);
  });
  let miniProgram;
  let lastError;
  let earlyExit = null;
  const connectDeadline = Math.min(Date.now() + AUTOMATOR_TIMEOUT_MS, deadline ?? Number.POSITIVE_INFINITY);
  while (!miniProgram && Date.now() < connectDeadline) {
    try {
      miniProgram = await withTimeout(() => Promise.race([
        automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` }),
        abnormalCliExit.catch((error) => {
          earlyExit = cliExitInfo;
          throw error;
        }),
      ]), 'connect', sessionTimeoutMs(5_000, deadline, 'connect'));
    } catch (error) {
      lastError = error;
      if (earlyExit) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!miniProgram) {
    let connectionError;
    if (!earlyExit && Date.now() >= connectDeadline) {
      connectionError = new Error(`automator connect timed out on port ${port}: ${lastError?.message || 'timeout'}; cliExit=${json(cliExitInfo)}; cli=${json(cliOutputSnapshot(cliOutput))}`);
    } else {
      connectionError = lastError || new Error(`automator connection failed on port ${port}`);
    }
    connectionError.retryable = !earlyExit;
    connectionError.retryStage = 'connect';
    connectionError.cliProcess = cliProcess;
    connectionError.cliExitPromise = cliExit;
    connectionError.port = port;
    connectionError.cliArguments = cliArguments;
    connectionError.cliOutput = cliOutput;
    throw connectionError;
  }
  attachEventCapture(miniProgram, events);
  return { miniProgram, cliProcess, port, cliArguments, cliExit: cliExitInfo, cliExitPromise: cliExit, cliOutput, events };
}

async function clearQaStorage(runtime, { retryableTimeouts = false, deadline = null } = {}) {
  await withSessionTimeout(
    () => runtime.miniProgram.callWxMethod('removeStorageSync', STORAGE_KEY),
    'clear QA storage',
    AUTOMATOR_TIMEOUT_MS,
    { retryable: retryableTimeouts, deadline },
  );
}

async function installRuntimeErrorCapture(runtime, { retryableTimeouts = false, deadline = null } = {}) {
  return withSessionTimeout(() => runtime.miniProgram.evaluate(() => {
    const app = getApp();
    const errors = [];
    const describe = (value) => ({
      name: value?.name || null,
      message: value?.message || String(value),
      stack: value?.stack || null,
    });
    app.__visualEvidenceRuntimeErrors = errors;
    if (typeof wx.onError === 'function') wx.onError((error) => errors.push({ kind: 'error', ...describe(error) }));
    if (typeof wx.onUnhandledRejection === 'function') wx.onUnhandledRejection((event) => errors.push({ kind: 'unhandledrejection', ...describe(event?.reason) }));
    return { onError: typeof wx.onError === 'function', onUnhandledRejection: typeof wx.onUnhandledRejection === 'function' };
  }), 'install runtime error capture', AUTOMATOR_TIMEOUT_MS, { retryable: retryableTimeouts, deadline });
}

async function readRuntimeErrors(runtime, { retryableTimeouts = false, deadline = null } = {}) {
  return withSessionTimeout(
    () => runtime.miniProgram.evaluate(() => getApp().__visualEvidenceRuntimeErrors || []),
    'read runtime errors',
    AUTOMATOR_TIMEOUT_MS,
    { retryable: retryableTimeouts, deadline },
  );
}

async function readSystemInfo(runtime, { retryableTimeouts = false, deadline = null } = {}) {
  return withSessionTimeout(() => runtime.miniProgram.evaluate(() => ({
    window: typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : null,
    device: typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : null,
    app: typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : null,
    setting: typeof wx.getSystemSetting === 'function' ? wx.getSystemSetting() : null,
  })), 'systemInfo', AUTOMATOR_TIMEOUT_MS, { retryable: retryableTimeouts, deadline });
}

async function switchToHomeTab(miniProgram, { retryableTimeouts = false, deadline = null } = {}) {
  if (!miniProgram || typeof miniProgram.switchTab !== 'function') throw new Error('首页 Tab 助手需要 miniProgram.switchTab');
  return withSessionTimeout(
    () => miniProgram.switchTab(HOME_ROUTE),
    `switchTab ${HOME_ROUTE}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: retryableTimeouts, deadline },
  );
}

async function writeAndReadFixture(runtime, fixture, { retryableTimeouts = false, deadline = null } = {}) {
  await clearQaStorage(runtime, { retryableTimeouts, deadline });
  await withSessionTimeout(
    () => runtime.miniProgram.callWxMethod('setStorageSync', STORAGE_KEY, fixture.raw),
    'write QA fixture',
    AUTOMATOR_TIMEOUT_MS,
    { retryable: retryableTimeouts, deadline },
  );
  await withSessionTimeout(() => runtime.miniProgram.evaluate(() => {
    const app = getApp();
    app.onLaunch();
    return Boolean(app.globalData.state);
  }), `reload app from QA fixture ${fixture.name}`, AUTOMATOR_TIMEOUT_MS, { retryable: retryableTimeouts, deadline });
  await switchToHomeTab(runtime.miniProgram, { retryableTimeouts, deadline });
  const readbackRaw = await withSessionTimeout(
    () => runtime.miniProgram.callWxMethod('getStorageSync', STORAGE_KEY),
    `read QA fixture ${fixture.name}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: retryableTimeouts, deadline },
  );
  assert.equal(typeof readbackRaw, 'string', `${fixture.name} storage readback 必须是字符串`);
  const readback = restoreBackup(readbackRaw);
  assert.equal(readback.ok, true, `${fixture.name} storage readback 必须可恢复`);
  assert.deepEqual(readback.data, fixture.state, `${fixture.name} storage readback 必须逐字段等于 fixture`);
  return { runtime, readbackRaw, readbackSha256: sha256Bytes(Buffer.from(readbackRaw, 'utf8')) };
}

async function waitForCliExit(runtime) {
  if (runtime?.cliExitPromise) {
    return withTimeout(() => runtime.cliExitPromise, 'wait CLI exit', SESSION_CLEANUP_TIMEOUT_MS);
  }
  return runtime?.cliExit || null;
}

async function abortQaSession(runtime, cliPath, events = runtime?.events || []) {
  const cleanupErrors = [];
  let cliExit = runtime?.cliExit || null;
  if (runtime) runtime.unusable = true;

  if (typeof runtime?.miniProgram?.disconnect === 'function') {
    try {
      runtime.miniProgram.disconnect();
      events.push({ at: isoNow(), kind: 'disconnect', error: false, reason: 'abort-session' });
    } catch (error) {
      cleanupErrors.push({ stage: 'disconnect', error });
      events.push({ at: isoNow(), kind: 'disconnect-error', error: true, message: error.message, stack: error.stack });
    }
  }

  try {
    if (runtime?.cliProcess && !runtime.cliProcess.killed) runtime.cliProcess.kill();
  } catch (error) {
    cleanupErrors.push({ stage: 'terminate-cli', error });
    events.push({ at: isoNow(), kind: 'cli-termination-error', error: true, message: error.message, stack: error.stack });
  }

  if (runtime?.cliExitPromise) {
    try {
      cliExit = await waitForCliExit(runtime);
    } catch (error) {
      cleanupErrors.push({ stage: 'wait-cli-exit', error });
      events.push({ at: isoNow(), kind: 'cli-exit-timeout', error: true, message: error.message, stack: error.stack });
    }
  }

  if (!cliPath) {
    cleanupErrors.push({ stage: 'close-qa-project', error: new Error('Stable CLI path unavailable while aborting QA session') });
  } else {
    try {
      await closeQaProject(cliPath, SESSION_CLEANUP_TIMEOUT_MS);
      events.push({ at: isoNow(), kind: 'qa-project-closed', error: false, port: runtime?.port ?? null });
    } catch (error) {
      cleanupErrors.push({ stage: 'close-qa-project', error });
      events.push({ at: isoNow(), kind: 'qa-project-close-error', error: true, message: error.message, stack: error.stack });
    }
  }

  const failure = combineLifecycleErrors('QA session abort', cleanupErrors);
  const result = {
    confirmed: !failure,
    port: runtime?.port ?? null,
    cliExit,
    errors: cleanupErrors.map(({ stage, error }) => ({ stage, error: serializeError(error) })),
  };
  if (failure) {
    failure.cleanup = result;
    throw failure;
  }
  return result;
}

async function closeQaSession(runtime, cliPath, events = runtime?.events || []) {
  const cleanupErrors = [];
  let cliExit = runtime?.cliExit || null;
  try {
    await closeMiniProgram(runtime, events, SESSION_CLEANUP_TIMEOUT_MS);
  } catch (error) {
    cleanupErrors.push({ stage: 'close', error });
  }
  try {
    cliExit = await waitForCliExit(runtime);
  } catch (error) {
    cleanupErrors.push({ stage: 'wait-cli-exit', error });
  }
  if (!cliPath) {
    cleanupErrors.push({ stage: 'close-qa-project', error: new Error('Stable CLI path unavailable while closing QA session') });
  } else {
    try {
      await closeQaProject(cliPath, SESSION_CLEANUP_TIMEOUT_MS);
      events.push({ at: isoNow(), kind: 'qa-project-closed', error: false, port: runtime?.port ?? null });
    } catch (error) {
      cleanupErrors.push({ stage: 'close-qa-project', error });
    }
  }
  const failure = combineLifecycleErrors('QA session close', cleanupErrors);
  if (failure) throw failure;
  return { confirmed: true, port: runtime?.port ?? null, cliExit, errors: [] };
}

async function createQaSession(cliPath, { deadline = null } = {}) {
  const events = [];
  let runtime = null;
  try {
    runtime = await launchQa(cliPath, events, { deadline });
    runtime.events = events;
    runtime.runtimeErrorCapture = await installRuntimeErrorCapture(runtime, { retryableTimeouts: true, deadline });
    runtime.systemInfo = await readSystemInfo(runtime, { retryableTimeouts: true, deadline });
    return runtime;
  } catch (error) {
    const partialRuntime = runtime || {
      miniProgram: null,
      cliProcess: error?.cliProcess,
      cliExitPromise: error?.cliExitPromise,
      cliExit: error?.cliExit || null,
      port: error?.port ?? null,
      cliArguments: error?.cliArguments || null,
      cliOutput: error?.cliOutput || null,
      events,
    };
    let cleanup = error?.sessionCleanup || null;
    let cleanupError = null;
    if (!cleanup) {
      try {
        cleanup = await abortQaSession(partialRuntime, cliPath, events);
      } catch (abortError) {
        cleanupError = abortError;
      }
    }
    error.sessionEvents = events;
    error.sessionCleanup = cleanup;
    error.cleanupConfirmed = Boolean(cleanup?.confirmed) && !cleanupError;
    if (cleanupError) {
      error.cleanupError = cleanupError;
      throw combineLifecycleErrors('QA session setup', [
        { stage: 'setup', error },
        { stage: 'cleanup', error: cleanupError },
      ]);
    }
    throw error;
  }
}

async function captureFixtureOnce(session, fixture, {
  outputPath,
  attempt = 1,
  route = fixture.route ?? HOME_ROUTE,
  deadline = null,
} = {}) {
  if (!outputPath) throw new Error(`fixture ${fixture.name} requires a temporary screenshot path`);
  const label = fixture.name;
  const startedAt = isoNow();
  const readback = await writeAndReadFixture(session, fixture, { retryableTimeouts: true, deadline });
  if (route) {
    await withSessionTimeout(
      () => session.miniProgram.reLaunch(route),
      `reLaunch ${label}`,
      AUTOMATOR_TIMEOUT_MS,
      { retryable: true, deadline },
    );
  }
  const page = await withSessionTimeout(
    () => session.miniProgram.currentPage(),
    `currentPage ${label}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: true, deadline },
  );
  if (route) assert.equal(page?.path, route.slice(1), `${label} 当前路由必须是 ${route}`);
  await withSessionTimeout(
    () => page.waitFor(1_500),
    `wait stable ${label}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: true, deadline },
  );
  await fs.rm(outputPath, { force: true });
  await withSessionTimeout(
    () => session.miniProgram.screenshot({ path: outputPath }),
    `screenshot ${label}`,
    SCREENSHOT_TIMEOUT_MS,
    { retryable: true, deadline },
  );
  const bytes = await fs.readFile(outputPath);
  const dimensions = pngInfo(bytes);
  assert(dimensions.width > 0 && dimensions.height > 0, `${label} 截图尺寸必须有效`);
  const runtimeErrors = await readRuntimeErrors(session, { retryableTimeouts: true, deadline });
  const errorEvents = (session.events || []).filter((event) => event.error || event.kind === 'exception');
  if (errorEvents.length || runtimeErrors.length) {
    throw new Error(`${label} captured runtime or console errors: ${json({ errorEvents, runtimeErrors })}`);
  }
  return {
    outputPath,
    ...dimensions,
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes),
    storageReadbackSha256: readback.readbackSha256,
    fixtureSha256: fixture.rawSha256,
    expected: fixture.expected,
    runtimeErrors,
    runtimeErrorCapture: session.runtimeErrorCapture || null,
    systemInfo: session.systemInfo || null,
    cliArguments: session.cliArguments || null,
    startedAt,
    finishedAt: isoNow(),
    attempts: 1,
    failures: [],
    sessionAttempt: attempt,
    port: session.port,
  };
}

async function runFixtureWithFreshSession({
  fixture,
  createSession,
  captureOnce,
  closeSession,
  abortSession,
  maxAttempts = 3,
  deadline = null,
  outputPath = null,
  onAttempt = null,
}) {
  if (!fixture?.name) throw new Error('fixture name is required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('maxAttempts must be between 1 and 3');
  if (typeof createSession !== 'function' || typeof captureOnce !== 'function' || typeof closeSession !== 'function' || typeof abortSession !== 'function') {
    throw new Error(`fresh session executor for ${fixture.name} requires create, capture, close and abort functions`);
  }
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = isoNow();
    let session = null;
    let closeAttempted = false;
    try {
      if (deadline != null && Date.now() >= deadline) {
        const error = new Error(`TIMEOUT ${fixture.name}: evidence run deadline exceeded before session ${attempt}`);
        error.retryable = true;
        error.totalDeadline = true;
        throw error;
      }
      session = await createSession({ fixture, attempt, deadline });
      const capture = await captureOnce(session, fixture, { attempt, deadline, outputPath });
      closeAttempted = true;
      const closeResult = await closeSession(session, { fixture, attempt, deadline });
      if (closeResult?.confirmed === false) throw new Error(`${fixture.name} session close was not confirmed`);
      const record = {
        attempt,
        port: session?.port ?? null,
        startedAt,
        finishedAt: isoNow(),
        retryable: false,
        ok: true,
        error: null,
        cleanup: closeResult || { confirmed: true },
        events: session?.events || [],
      };
      attempts.push(record);
      if (onAttempt) await onAttempt(record);
      return {
        fixture: fixture.name,
        capture: { ...capture, sessionAttempt: attempt, port: session?.port ?? null },
        sessionAttempt: attempt,
        port: session?.port ?? null,
        attempts,
        retrySummary: attempts,
      };
    } catch (primaryError) {
      const retryable = isRetryableSessionError(primaryError);
      let cleanup = primaryError?.sessionCleanup || null;
      let cleanupError = primaryError?.cleanupError || null;
      if (session && !closeAttempted) {
        try {
          cleanup = retryable
            ? await abortSession(session, { fixture, attempt, deadline })
            : await closeSession(session, { fixture, attempt, deadline });
          if (cleanup?.confirmed === false) cleanupError = new Error(`${fixture.name} session cleanup was not confirmed`);
        } catch (error) {
          cleanupError = error;
        }
      }
      const failure = combineLifecycleErrors(`${fixture.name} session attempt ${attempt}`, [
        { stage: 'primary', error: primaryError },
        { stage: 'cleanup', error: cleanupError },
      ]) || primaryError;
      const record = {
        attempt,
        port: session?.port ?? primaryError?.port ?? null,
        startedAt,
        finishedAt: isoNow(),
        retryable,
        ok: false,
        error: serializeError(primaryError),
        cleanup: cleanup ? (cleanup.errors ? cleanup : { confirmed: Boolean(cleanup.confirmed) }) : (cleanupError ? { confirmed: false, error: serializeError(cleanupError) } : null),
        failure: serializeError(failure),
        events: session?.events || primaryError?.sessionEvents || [],
      };
      attempts.push(record);
      if (onAttempt) await onAttempt(record);
      const canRetry = retryable
        && !primaryError?.totalDeadline
        && !cleanupError
        && cleanup?.confirmed !== false
        && attempt < maxAttempts
        && (deadline == null || Date.now() < deadline);
      if (!canRetry) throw attachAttemptDetails(failure, attempts);
    }
  }
  throw attachAttemptDetails(new Error(`${fixture.name} fresh-session retry loop ended unexpectedly`), attempts);
}

async function runFixturesWithFreshSessions({ fixtures, deadline = null, onAttempt = null, onResult = null, ...options }) {
  if (!Array.isArray(fixtures)) throw new Error('fixtures must be an array');
  const results = [];
  for (const fixture of fixtures) {
    const result = await runFixtureWithFreshSession({
      ...options,
      fixture,
      deadline,
      onAttempt,
    });
    results.push(result);
    if (onResult) await onResult(result);
  }
  return results;
}

async function captureScreenshotWithRetries(options, legacyOptions) {
  if (legacyOptions || options?.miniProgram) {
    throw new Error('captureScreenshotWithRetries requires a fresh-session executor; a runtime cannot be retried in place');
  }
  return runFixtureWithFreshSession(options);
}

async function cleanCompatibilityOutputs(paths = compatibilityOutputPaths()) {
  const directory = path.dirname(paths.resultPath);
  await fs.mkdir(directory, { recursive: true });
  await removePaths([paths.resultPath, paths.screenshotPath, paths.rawErrorPath]);
  await removeTemporaryFiles(directory, [
    `.${path.basename(paths.resultPath)}.tmp-`,
    `.${path.basename(paths.screenshotPath)}.tmp-`,
    `.${path.basename(paths.rawErrorPath)}.tmp-`,
  ]);
}

async function completeCompatibilityRun({ resultPath, screenshotPath, rawErrorPath, result, runtime, events, primaryError = null }) {
  let closeError = null;
  try {
    await closeMiniProgram(runtime, events);
  } catch (error) {
    closeError = error;
  }

  const runStages = [
    { stage: 'run', error: primaryError },
    { stage: 'close', error: closeError },
  ];
  const runFailure = combineLifecycleErrors('compatibility run', runStages);
  if (runFailure) {
    let cleanupError = null;
    try {
      await removePaths([resultPath, screenshotPath]);
    } catch (error) {
      cleanupError = error;
    }
    const failureStages = [...runStages, { stage: 'cleanup', error: cleanupError }];
    const failure = combineLifecycleErrors('compatibility run', failureStages);
    const report = lifecycleFailureReport({ primaryError, closeError, runtime, events, failure });
    try {
      await writeAtomicText(rawErrorPath, lifecycleFailureText('compatibility failed', failure, report));
    } catch (error) {
      throw combineLifecycleErrors('compatibility failure reporting', [...failureStages, { stage: 'write-error', error }]);
    }
    throw failure;
  }

  try {
    await fs.rm(rawErrorPath, { force: true });
    const completed = { ...result, finishedAt: isoNow() };
    await writeAtomicText(resultPath, json(completed));
    return completed;
  } catch (finalizationError) {
    let cleanupError = null;
    try {
      await removePaths([resultPath, screenshotPath]);
    } catch (error) {
      cleanupError = error;
    }
    const failureStages = [
      { stage: 'finalization', error: finalizationError },
      { stage: 'cleanup', error: cleanupError },
    ];
    const failure = combineLifecycleErrors('compatibility finalization', failureStages);
    const report = lifecycleFailureReport({ finalizationError, runtime, events, failure });
    try {
      await writeAtomicText(rawErrorPath, lifecycleFailureText('compatibility finalization failed', failure, report));
    } catch (error) {
      throw combineLifecycleErrors('compatibility failure reporting', [...failureStages, { stage: 'write-error', error }]);
    }
    throw failure;
  }
}

async function runCompatibility() {
  const outputPaths = compatibilityOutputPaths();
  await cleanCompatibilityOutputs(outputPaths);
  const events = [];
  let result;
  let primaryError = null;
  let cliPath = null;
  let temporaryRoot = null;
  const startedAt = isoNow();
  try {
    cliPath = await findStableCli();
    await prepareIsolatedProject(cliPath);
    const fixture = makeFixture('empty-bills', todayIso(new Date()));
    temporaryRoot = await fs.mkdtemp(path.join(COMPAT_ROOT, '.session-run-'));
    const execution = await runFixtureWithFreshSession({
      fixture,
      createSession: ({ deadline }) => createQaSession(cliPath, { deadline }),
      captureOnce: (session, currentFixture, { attempt, deadline }) => captureFixtureOnce(session, currentFixture, {
        outputPath: path.join(temporaryRoot, 'sample.png'),
        attempt,
        route: null,
        deadline,
      }),
      closeSession: (session) => closeQaSession(session, cliPath, session.events),
      abortSession: (session) => abortQaSession(session, cliPath, session.events),
      onAttempt: (record) => events.push(...record.events),
    });
    await fs.rename(execution.capture.outputPath, outputPaths.screenshotPath);
    const capture = execution.capture;
    result = {
      ok: true,
      startedAt,
      cliPath,
      projectPath: QA_ROOT,
      appid: QA_APP_ID,
      systemInfo: capture.systemInfo,
      cliArguments: capture.cliArguments,
      runtimeErrorCapture: capture.runtimeErrorCapture,
      runtimeErrors: capture.runtimeErrors,
      fixture: { name: fixture.name, expected: fixture.expected, storageReadbackSha256: capture.storageReadbackSha256, fixtureSha256: capture.fixtureSha256 },
      screenshot: { path: relativePath(outputPaths.screenshotPath), ...capture, outputPath: outputPaths.screenshotPath },
      sessionAttempt: execution.sessionAttempt,
      port: execution.port,
      retrySummary: execution.retrySummary,
      consoleErrors: events.filter((event) => event.error).length,
      exceptions: events.filter((event) => event.kind === 'exception').length,
      warnings: events.filter((event) => event.warning).length,
      protocolArtifacts: events.filter((event) => event.protocolArtifact).length,
    };
    if (result.consoleErrors || result.exceptions || result.runtimeErrors.length) throw new Error(`compatibility captured runtime errors: ${json(result)}`);
  } catch (error) {
    primaryError = error;
  } finally {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  return completeCompatibilityRun({ ...outputPaths, result, runtime: null, events, primaryError });
}

async function cleanOwnedEvidenceOutputs() {
  await fs.mkdir(EVIDENCE_ROOT, { recursive: true });
  for (const name of ownedOutputNames) {
    await fs.rm(path.join(EVIDENCE_ROOT, name), { force: true });
  }
  const outputPaths = visualEvidenceOutputPaths();
  await removeTemporaryFiles(EVIDENCE_ROOT, [
    `.${path.basename(outputPaths.consolePath)}.tmp-`,
    `.${path.basename(outputPaths.manifestPath)}.tmp-`,
    `.${path.basename(outputPaths.greenPath)}.tmp-`,
  ]);
  await removeTemporaryDirectories(EVIDENCE_ROOT, ['.session-run-']);
}

async function completeVisualEvidenceRun({
  outputRoot = EVIDENCE_ROOT,
  runtime,
  events,
  captures = [],
  cliPath = null,
  cliArguments = null,
  systemInfo = null,
  runtimeErrorCapture = null,
  runtimeErrors = [],
  primaryError = null,
}) {
  const outputPaths = visualEvidenceOutputPaths(outputRoot);
  let closeError = null;
  try {
    await closeMiniProgram(runtime, events);
  } catch (error) {
    closeError = error;
  }

  const runStages = [
    { stage: 'run', error: primaryError },
    { stage: 'close', error: closeError },
  ];
  const runFailure = combineLifecycleErrors('visual evidence run', runStages);
  if (runFailure) appendLifecycleFailureEvent(events, runStages);

  let consoleError = null;
  try {
    await writeAtomicText(outputPaths.consolePath, events.map((event) => json(event)).join('\n'));
  } catch (error) {
    consoleError = error;
  }

  const consoleStages = [...runStages, { stage: 'console', error: consoleError }];
  const consoleFailure = combineLifecycleErrors('visual evidence run', consoleStages);
  if (consoleFailure) {
    let cleanupError = null;
    try {
      await removePaths([
        outputPaths.manifestPath,
        outputPaths.greenPath,
        ...[...ownedOutputNames]
          .filter((name) => name.endsWith('.png'))
          .map((name) => path.join(outputRoot, name)),
      ]);
    } catch (error) {
      cleanupError = error;
    }
    let consoleRewriteError = null;
    if (cleanupError) {
      appendLifecycleFailureEvent(events, [{ stage: 'cleanup', error: cleanupError }]);
      try {
        await writeAtomicText(outputPaths.consolePath, events.map((event) => json(event)).join('\n'));
      } catch (error) {
        consoleRewriteError = error;
      }
    }
    throw combineLifecycleErrors('visual evidence failure', [
      ...consoleStages,
      { stage: 'cleanup', error: cleanupError },
      { stage: 'console-rewrite', error: consoleRewriteError },
    ]);
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: isoNow(),
    appid: QA_APP_ID,
    projectPath: relativePath(QA_ROOT),
    cliPath,
    cliArguments: cliArguments ?? runtime?.cliArguments ?? null,
    console: {
      errors: events.filter((event) => event.error).length,
      exceptions: events.filter((event) => event.kind === 'exception').length,
      warnings: events.filter((event) => event.warning).length,
      protocolArtifacts: events.filter((event) => event.protocolArtifact).length,
      timeouts: events.filter((event) => /TIMEOUT/.test(event.message || event.text || '')).length,
    },
    runtimeErrorCapture,
    runtimeErrors,
    captures,
  };

  try {
    await writeAtomicText(outputPaths.manifestPath, json(manifest));
    await writeAtomicText(outputPaths.greenPath, json({ ok: true, pngCount: captures.length, manifest: 'manifest.json' }));
    return manifest;
  } catch (finalizationError) {
    let cleanupError = null;
    try {
      await removePaths([
        outputPaths.manifestPath,
        outputPaths.greenPath,
        ...[...ownedOutputNames]
          .filter((name) => name.endsWith('.png'))
          .map((name) => path.join(outputRoot, name)),
      ]);
    } catch (error) {
      cleanupError = error;
    }
    appendLifecycleFailureEvent(events, [{ stage: 'finalization', error: finalizationError }, { stage: 'cleanup', error: cleanupError }]);
    let consoleRewriteError = null;
    try {
      await writeAtomicText(outputPaths.consolePath, events.map((event) => json(event)).join('\n'));
    } catch (error) {
      consoleRewriteError = error;
    }
    throw combineLifecycleErrors('visual evidence finalization', [
      { stage: 'finalization', error: finalizationError },
      { stage: 'cleanup', error: cleanupError },
      { stage: 'console-rewrite', error: consoleRewriteError },
    ]);
  }
}

async function runVisualEvidence() {
  await cleanOwnedEvidenceOutputs();
  const events = [];
  const captures = [];
  let cliPath = null;
  let primaryError = null;
  let temporaryRoot = null;
  const deadline = Date.now() + EVIDENCE_RUN_TIMEOUT_MS;
  try {
    cliPath = await findStableCli();
    await prepareIsolatedProject(cliPath);
    const nowDate = todayIso(new Date());
    const fixtures = FIXTURE_NAMES.map((name) => makeFixture(name, nowDate));
    temporaryRoot = await fs.mkdtemp(path.join(EVIDENCE_ROOT, '.session-run-'));
    const results = await runFixturesWithFreshSessions({
      fixtures,
      deadline,
      createSession: ({ deadline: sessionDeadline }) => createQaSession(cliPath, { deadline: sessionDeadline }),
      captureOnce: (session, fixture, { attempt, deadline: sessionDeadline }) => captureFixtureOnce(session, fixture, {
        outputPath: path.join(temporaryRoot, `${fixture.name}.png`),
        attempt,
        deadline: sessionDeadline,
      }),
      closeSession: (session) => closeQaSession(session, cliPath, session.events),
      abortSession: (session) => abortQaSession(session, cliPath, session.events),
      onAttempt: (record) => events.push(...record.events),
    });
    for (const result of results) {
      const finalPath = path.join(EVIDENCE_ROOT, `${result.fixture}.png`);
      await fs.rename(result.capture.outputPath, finalPath);
      captures.push({
        fixture: result.fixture,
        route: HOME_ROUTE,
        executedAt: isoNow(),
        systemInfo: result.capture.systemInfo,
        expected: result.capture.expected,
        storageReadbackSha256: result.capture.storageReadbackSha256,
        fixtureSha256: result.capture.fixtureSha256,
        sessionAttempt: result.sessionAttempt,
        port: result.port,
        retrySummary: result.retrySummary,
        runtimeErrorCapture: result.capture.runtimeErrorCapture,
        runtimeErrors: result.capture.runtimeErrors,
        png: { path: relativePath(finalPath), ...result.capture, outputPath: finalPath },
      });
    }
    const errorEvents = events.filter((event) => event.error);
    const runtimeErrors = captures.flatMap((capture) => capture.runtimeErrors || []);
    if (errorEvents.length || events.some((event) => event.kind === 'exception') || events.some((event) => /TIMEOUT/.test(event.message || event.text || '')) || runtimeErrors.length) {
      throw new Error(`console/exception events captured: ${json({ errorEvents, runtimeErrors, captures })}`);
    }
  } catch (error) {
    primaryError = error;
  }
  if (temporaryRoot) {
    try {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      primaryError = combineLifecycleErrors('visual evidence temporary directory cleanup', [
        { stage: 'run', error: primaryError },
        { stage: 'temporary-cleanup', error },
      ]);
    }
  }
  return completeVisualEvidenceRun({
    runtime: null,
    events,
    captures,
    cliPath,
    cliArguments: captures.map((capture) => capture.png.cliArguments).filter(Boolean),
    systemInfo: { sessions: captures.map((capture) => capture.systemInfo) },
    runtimeErrorCapture: { sessions: captures.map((capture) => capture.runtimeErrorCapture) },
    runtimeErrors: captures.flatMap((capture) => capture.runtimeErrors || []),
    primaryError,
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--hash-protected')) {
    const which = process.argv[process.argv.indexOf('--hash-protected') + 1];
    if (!['before', 'after'].includes(which)) throw new Error('--hash-protected 必须是 before 或 after');
    const result = await saveProtectedHashes(which);
    console.log(json({ ok: true, path: relativePath(result.filePath), protectedCount: result.records.length }));
    return;
  }
  if (args.has('--compare-protected')) {
    console.log(json(await compareProtectedHashes()));
    return;
  }
  if (args.has('--compat')) {
    console.log(json(await runCompatibility()));
    return;
  }
  if (args.has('--invalid-fixture')) {
    const kind = process.argv[process.argv.indexOf('--invalid-fixture') + 1];
    const result = invalidFixture(kind, todayIso(new Date()));
    await writeText(path.join(EVIDENCE_ROOT, 'invalid-fixture-red.txt'), json({ ok: false, ...result }));
    throw new Error(`非法 fixture 已在截图前拒绝：${json(result)}`);
  }
  const manifest = await runVisualEvidence();
  console.log(json({ ok: true, pngCount: manifest.captures.length, output: relativePath(EVIDENCE_ROOT) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

export {
  FIXTURE_NAMES,
  HOME_ROUTE,
  QA_APP_ID,
  SCREENSHOT_TIMEOUT_MS,
  abortQaSession,
  classifyConsoleEvent,
  captureFixtureOnce,
  invalidFixture,
  makeFixture,
  pngInfo,
  protectedHashRecords,
  roundTrip,
  buildCliArguments,
  buildCliCommand,
  captureScreenshotWithRetries,
  completeCompatibilityRun,
  completeVisualEvidenceRun,
  formatCliExit,
  runFixtureWithFreshSession,
  runFixturesWithFreshSessions,
  switchToHomeTab,
  writeAndReadFixture,
};
