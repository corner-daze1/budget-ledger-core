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
  addAssetAccount,
  getHomeModel,
  initializeState,
  listRecentBills,
  listRecentTransactions,
  recordIncomeEntry,
  recordEntry,
  recordTransferEntry,
  settleCurrentPeriod,
  todayIso,
} from '../src/application/app-core.js';
import { addDays, budgetSnapshot, dateDistance } from '../src/domain/budget.js';
import { recordRefund } from '../src/domain/ledger.js';
import { restoreBackup, serializeBackup } from '../src/domain/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA_ROOT = path.join(ROOT, '.visual-qa');
const PROBE_ROOT = path.join(ROOT, '.visual-probe');
const DIAGNOSTIC_ROOT = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\yongdu-phase11-diag-b9f5b75e6b3743ba9ba43ddaff8c4907\\.visual-qa';
const EVIDENCE_ROOT = path.join(ROOT, 'artifacts', 'visual-evidence');
const COMPAT_ROOT = path.join(EVIDENCE_ROOT, 'compatibility');
const SINGLE_INSTANCE_ROOT = path.join(EVIDENCE_ROOT, 'single-instance');
const PROTOCOL_TRACE_ROOT = path.join(EVIDENCE_ROOT, 'protocol-trace');
const C_STABLE_CLI_PATH = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const C_STABLE_NODE_PATH = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\node.exe';
const QA_APP_ID = 'touristappid';
const STORAGE_KEY = 'yongdu-ledger-v1';
const HOME_ROUTE = '/pages/home/home';
const SCREENSHOT_DIAGNOSTIC_PREFIX = 'screenshot-diagnostic-';
const DIAGNOSTIC_STAGE_NAMES = ['connect', 'currentPage', 'evaluate', 'screenshot', 'cleanup'];
const STABLE_NODE_CANDIDATES = [
  process.env.WECHAT_STABLE_NODE,
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\node.exe',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\node.exe',
].filter(Boolean);
const AUTOMATOR_TIMEOUT_MS = 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const SESSION_CLEANUP_TIMEOUT_MS = 5_000;
const QA_CLEANUP_VERIFY_TIMEOUT_MS = 10_000;
const PROCESS_QUERY_TIMEOUT_MS = 10_000;
const EVIDENCE_RUN_TIMEOUT_MS = 12 * 60_000;
const PROTOCOL_TRACE_CLASSIFICATIONS = [
  'send-not-observed',
  'sent-no-matching-reply',
  'explicit-protocol-error',
  'reply-success-postprocess-failure',
  'screenshot-success',
  'trace-inconclusive',
];
const FIXTURE_NAMES = [
  'normal-accumulated',
  'prepaid-recovery',
  'empty-bills',
  'cross-budget-period',
  'ledger-overview',
  'ledger-expanded',
];

const ownedOutputNames = new Set([
  'normal-accumulated.png',
  'prepaid-recovery.png',
  'empty-bills.png',
  'cross-budget-period.png',
  'ledger-overview.png',
  'ledger-expanded.png',
  'long-text-large-amount.png',
  'console.jsonl',
  'manifest.json',
  'six-states-green.txt',
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
    greenPath: path.join(root, 'six-states-green.txt'),
    pngPaths: FIXTURE_NAMES.map((name) => path.join(root, `${name}.png`)),
  };
}

function screenshotDiagnosticOutputPaths(root = EVIDENCE_ROOT) {
  return {
    resultPath: path.join(root, 'screenshot-diagnostic.json'),
    logPath: path.join(root, 'screenshot-diagnostic.log'),
  };
}

function stableSingleInstanceOutputPaths(root = SINGLE_INSTANCE_ROOT) {
  return {
    resultPath: path.join(root, 'result.json'),
    logPath: path.join(root, 'run.log'),
    pngPath(sessionNumber) {
      if (!Number.isInteger(sessionNumber) || sessionNumber < 1 || sessionNumber > 2) {
        throw new Error(`invalid strict single-instance session number: ${sessionNumber}`);
      }
      return path.join(root, `stable-single-instance-${sessionNumber}.png`);
    },
  };
}

function protocolTraceOutputPaths(root = PROTOCOL_TRACE_ROOT) {
  return {
    rawProtocolPath: path.join(root, 'raw-protocol.log'),
    resultPath: path.join(root, 'result.json'),
    processBeforePath: path.join(root, 'process-before.json'),
    processAfterPath: path.join(root, 'process-after.json'),
    reportPath: path.join(root, 'report.md'),
    screenshotPath: path.join(root, 'screenshot.png'),
  };
}

function stableSingleInstanceConfig({ projectPath = PROBE_ROOT, port }) {
  return {
    cliPath: C_STABLE_CLI_PATH,
    nodeExecutable: C_STABLE_NODE_PATH,
    projectPath,
    appid: QA_APP_ID,
    cliArguments: buildCliArguments({ projectPath, port }),
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
  if (relative.startsWith('.visual-probe/')) return true;
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

async function findStableNode() {
  for (const candidate of STABLE_NODE_CANDIDATES) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`未找到 Stable 内置 Node；候选路径：${STABLE_NODE_CANDIDATES.join('；')}`);
}

async function freeTcpPort(excludedPorts = []) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (excludedPorts.includes(port)) return freeTcpPort(excludedPorts);
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

async function closeQaProject(cliPath, timeoutMs = SESSION_CLEANUP_TIMEOUT_MS, projectPath = QA_ROOT) {
  return runCliCommand(cliPath, ['close', '--project', projectPath], `close QA project ${projectPath}`, timeoutMs);
}

async function runCapturedProcess(file, args, label, timeoutMs = PROCESS_QUERY_TIMEOUT_MS, { env = null } = {}) {
  const child = spawn(file, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...(env ? { env } : {}),
  });
  const output = { stdout: [], stderr: [] };
  child.stdout?.on('data', (chunk) => output.stdout.push(Buffer.from(chunk)));
  child.stderr?.on('data', (chunk) => output.stderr.push(Buffer.from(chunk)));
  try {
    return await withTimeout(() => observeCliExit(child, output), label, timeoutMs);
  } catch (error) {
    if (!child.killed) child.kill();
    throw error;
  }
}

function normalizeWindowsPath(value) {
  return path.resolve(String(value)).replaceAll('/', '\\').toLowerCase();
}

function normalizeCommandLine(value) {
  return String(value || '').replaceAll('/', '\\').toLowerCase();
}

function commandLineHasProject(commandLine, projectPath) {
  return normalizeCommandLine(commandLine).includes(normalizeWindowsPath(projectPath));
}

function commandLineHasPort(commandLine, port) {
  if (port == null) return true;
  const command = normalizeCommandLine(commandLine);
  const token = String(port);
  return new RegExp(`(?:--auto-port|--port)\\s+["']?${token}["']?(?:\\s|$)`, 'i').test(command);
}

function commandLinePorts(commandLine) {
  const ports = [];
  const expression = /(?:--auto-port|--port)\s+["']?(\d{1,5})["']?/gi;
  for (const match of String(commandLine || '').matchAll(expression)) {
    const port = Number(match[1]);
    if (port >= 1 && port <= 65_535) ports.push(port);
  }
  return [...new Set(ports)];
}

function isAutoCommandLine(commandLine) {
  return /(?:^|[\\/\s"'])auto(?:[\\/\s"']|$)/i.test(String(commandLine || ''));
}

function normalizeProcessRecord(record) {
  return {
    processId: Number(record?.ProcessId ?? record?.processId),
    parentProcessId: Number(record?.ParentProcessId ?? record?.parentProcessId),
    name: String(record?.Name ?? record?.name ?? ''),
    commandLine: String(record?.CommandLine ?? record?.commandLine ?? ''),
  };
}

async function listWindowsProcesses() {
  if (process.platform !== 'win32') return [];
  const script = [
    '$ErrorActionPreference = \'Stop\'',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress',
  ].join('; ');
  const exitInfo = await runCapturedProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    'inspect Windows QA processes',
  );
  if (exitInfo.type !== 'exit' || exitInfo.code !== 0) {
    throw new Error(`Windows QA process inspection failed: ${json(exitInfo)}`);
  }
  const raw = exitInfo.stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(normalizeProcessRecord).filter((record) => Number.isInteger(record.processId));
}

function processLooksLikeWeChatTool(record) {
  const text = `${record?.name || ''} ${record?.commandLine || ''}`;
  return /wechatdevtools|wxfilewatcher_x64|微信web开发者工具|(?:^|[\\/])cli\.js(?:["'\s]|$)/i.test(text);
}

function processCommandLineStartsOnDrive(record, drive) {
  const commandLine = normalizeCommandLine(record?.commandLine || '');
  return commandLine.includes(`${String(drive).toLowerCase()}:\\`);
}

async function captureProtocolTraceProcessSnapshot({ ports = [] } = {}) {
  const records = await listWindowsProcesses();
  const toolRecords = records.filter(processLooksLikeWeChatTool);
  const dProcesses = toolRecords.filter((record) => processCommandLineStartsOnDrive(record, 'D'));
  const cProcesses = toolRecords.filter((record) => processCommandLineStartsOnDrive(record, 'C'));
  const exactAutomationResidual = records.filter((record) => {
    const commandLine = record.commandLine || '';
    const ownedProject = commandLineHasProject(commandLine, PROBE_ROOT) || commandLineHasProject(commandLine, QA_ROOT);
    return ownedProject && (/(?:^|[\\/])cli\.js(?:["'\s]|$)/i.test(commandLine) || isAutoCommandLine(commandLine));
  });
  const portStates = {};
  for (const port of [...new Set(ports.filter((candidate) => Number.isInteger(candidate)))]) {
    portStates[String(port)] = await probeTcpPort(port);
  }
  return {
    schemaVersion: 1,
    capturedAt: isoNow(),
    cToolProcessCount: cProcesses.length,
    dToolProcessCount: dProcesses.length,
    cProcesses,
    dProcesses,
    exactAutomationResidualCount: exactAutomationResidual.length,
    exactAutomationResidual,
    probeDirectoryExists: await exists(PROBE_ROOT),
    portStates,
  };
}

function matchingQaProcesses(records, projectPath, port = null) {
  return records.filter((record) => {
    if (!commandLineHasProject(record.commandLine, projectPath)) return false;
    const watcher = /(?:^|[\\/])wxfilewatcher_x64\.exe(?:["\s]|$)/i.test(record.name || record.commandLine);
    return watcher || (isAutoCommandLine(record.commandLine) && commandLineHasPort(record.commandLine, port));
  });
}

async function findQaProcesses(projectPath, port = null) {
  return matchingQaProcesses(await listWindowsProcesses(), projectPath, port);
}

async function probeTcpPort(port, timeoutMs = 500) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function terminateExactQaProcesses(processes, events = []) {
  const pids = [...new Set(processes.map((record) => record.processId).filter((pid) => Number.isInteger(pid) && pid > 0))];
  const results = [];
  if (process.platform !== 'win32') return results;
  for (const pid of pids) {
    let result;
    try {
      result = await runCapturedProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'], `terminate exact QA process tree ${pid}`);
    } catch (error) {
      result = { type: 'error', error: serializeError(error) };
    }
    const record = { pid, result };
    results.push(record);
    events.push({ at: isoNow(), kind: 'qa-process-termination', error: false, pid, result });
  }
  return results;
}

async function verifyQaCleanup({ projectPath = QA_ROOT, port = null, ports: requestedPorts = [], timeoutMs = SESSION_CLEANUP_TIMEOUT_MS } = {}) {
  const ports = new Set([
    ...(Array.isArray(requestedPorts) ? requestedPorts : []),
    ...(Number.isInteger(port) ? [port] : []),
  ].filter((candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= 65_535));
  const startedAt = isoNow();
  let residualProcesses = [];
  let portOpen = false;
  let lastQueryError = null;
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      residualProcesses = await findQaProcesses(projectPath, port);
      for (const record of residualProcesses) {
        for (const candidate of commandLinePorts(record.commandLine)) ports.add(candidate);
      }
      const portStates = await Promise.all([...ports].map(async (candidate) => [candidate, await probeTcpPort(candidate)]));
      portOpen = portStates.some(([, open]) => open);
      lastQueryError = null;
      if (residualProcesses.length === 0 && !portOpen) {
        return {
          confirmed: true,
          projectPath,
          port: port ?? null,
          residualProcesses,
          ports: [...ports],
          portOpen: false,
          startedAt,
          finishedAt: isoNow(),
        };
      }
    } catch (error) {
      lastQueryError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return {
    confirmed: false,
    projectPath,
    port: port ?? null,
    residualProcesses,
    ports: [...ports],
    portOpen,
    error: lastQueryError ? serializeError(lastQueryError) : null,
    startedAt,
    finishedAt: isoNow(),
  };
}

async function terminateAndVerifyQaCleanup({ projectPath = QA_ROOT, port = null, ports = [], events = [], timeoutMs = QA_CLEANUP_VERIFY_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let residual = [];
  let termination = [];
  let verification = null;
  const knownPorts = new Set([
    ...(Array.isArray(ports) ? ports : []),
    ...(Number.isInteger(port) ? [port] : []),
  ]);
  while (Date.now() < deadline) {
    residual = await findQaProcesses(projectPath, port);
    for (const record of residual) {
      for (const candidate of commandLinePorts(record.commandLine)) knownPorts.add(candidate);
    }
    if (residual.length) termination.push(...await terminateExactQaProcesses(residual, events));
    const remainingMs = Math.max(1, Math.min(500, deadline - Date.now()));
    verification = await verifyQaCleanup({ projectPath, port, ports: [...knownPorts], timeoutMs: remainingMs });
    if (verification.confirmed) return { residual: [], termination, verification };
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { residual: verification?.residualProcesses || residual, termination, verification: verification || { confirmed: false, projectPath, port, residualProcesses: residual, portOpen: false } };
}

async function clearStaleAutomationProject(projectPath, cliPath = null, events = []) {
  let before = [];
  try {
    before = await findQaProcesses(projectPath);
  } catch (error) {
    throw new Error(`无法检查待清理的 QA 进程树 ${projectPath}: ${error.message}`, { cause: error });
  }
  let closeError = null;
  if (before.length && cliPath) {
    try {
      await runCliCommand(cliPath, ['close', '--project', projectPath], `close stale QA project ${projectPath}`, SESSION_CLEANUP_TIMEOUT_MS);
    } catch (error) {
      closeError = error;
      events.push({ at: isoNow(), kind: 'qa-project-close-error', error: true, message: error.message, stack: error.stack, projectPath });
    }
  }
  const cleanup = await terminateAndVerifyQaCleanup({
    projectPath,
    ports: before.flatMap((record) => commandLinePorts(record.commandLine)),
    events,
  });
  const result = { projectPath, before, termination: cleanup.termination, verification: cleanup.verification, closeError: closeError ? serializeError(closeError) : null };
  if (closeError || !cleanup.verification.confirmed) {
    throw new Error(`清理 QA 自动化进程未确认：${json(result)}`);
  }
  return result;
}

async function prepareIsolatedProject(cliPath) {
  await clearStaleAutomationProject(QA_ROOT, cliPath);
  await clearStaleAutomationProject(DIAGNOSTIC_ROOT, cliPath);
  await fs.rm(DIAGNOSTIC_ROOT, { recursive: true, force: true });
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

async function prepareMinimalProbeProject(cliPath) {
  await clearStaleAutomationProject(PROBE_ROOT, cliPath);
  await fs.rm(PROBE_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(PROBE_ROOT, 'pages', 'index'), { recursive: true });
  const files = new Map([
    ['project.config.json', {
      description: 'minimal screenshot diagnostic probe',
      packOptions: { ignore: [], include: [] },
      setting: {
        compileType: 'miniprogram',
        es6: true,
        enhance: true,
        postcss: true,
        minified: false,
        urlCheck: false,
        compileHotReLoad: false,
        minifyWXML: true,
        minifyWXSS: true,
      },
      appid: QA_APP_ID,
      compileType: 'miniprogram',
      miniprogramRoot: './',
      projectname: 'yongdu-screenshot-probe',
      condition: {},
    }],
    ['app.json', { pages: ['pages/index/index'], window: { navigationBarTitleText: 'Screenshot probe' } }],
    ['app.js', 'App({});'],
    ['sitemap.json', { desc: 'minimal screenshot diagnostic probe', rules: [] }],
    [path.join('pages', 'index', 'index.json'), {}],
    [path.join('pages', 'index', 'index.js'), 'Page({});'],
    [path.join('pages', 'index', 'index.wxml'), '<view></view>'],
    [path.join('pages', 'index', 'index.wxss'), ''],
  ]);
  for (const [relative, content] of files) {
    const target = path.join(PROBE_ROOT, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeText(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  const verified = JSON.parse(await fs.readFile(path.join(PROBE_ROOT, 'project.config.json'), 'utf8'));
  assert.equal(verified.appid, QA_APP_ID, '最小探针必须使用 touristappid');
  assert.equal(verified.miniprogramRoot, './', '最小探针不得引用当前项目 miniprogram 目录');
  return { projectPath: PROBE_ROOT, appid: QA_APP_ID, pagePath: '/pages/index/index' };
}

function pngInfo(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '截图必须是 PNG');
  assert.equal(bytes.readUInt32BE(12), 0x49484452, 'PNG 必须包含 IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function diagnosticRequire(condition, message) {
  if (!condition) throw new Error(`screenshot diagnostic result missing ${message}`);
}

function diagnosticTimestamp(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateScreenshotDiagnosticResult(result) {
  diagnosticRequire(result && typeof result === 'object', 'result object');
  diagnosticRequire(result.schemaVersion === 1, 'schemaVersion');
  diagnosticRequire(diagnosticTimestamp(result.startedAt), 'run start');
  diagnosticRequire(diagnosticTimestamp(result.finishedAt), 'run finish');
  diagnosticRequire(result.project?.kind === 'minimal', 'minimal project kind');
  diagnosticRequire(result.project?.appid === QA_APP_ID, 'touristappid project');
  diagnosticRequire(Array.isArray(result.nodeRuns) && result.nodeRuns.length > 0, 'node runs');

  for (const [runIndex, run] of result.nodeRuns.entries()) {
    diagnosticRequire(run?.node?.label, `node label for run ${runIndex + 1}`);
    diagnosticRequire(run?.node?.version, `node version for run ${runIndex + 1}`);
    diagnosticRequire(Array.isArray(run.sessions) && run.sessions.length >= 1 && run.sessions.length <= 2, `sessions for run ${runIndex + 1}`);
    for (const [sessionIndex, session] of run.sessions.entries()) {
      const label = `run ${runIndex + 1} session ${sessionIndex + 1}`;
      diagnosticRequire(session.stage, `${label} stage`);
      diagnosticRequire(Number.isInteger(session.port) && session.port >= 1 && session.port <= 65_535, `${label} port`);
      diagnosticRequire(Array.isArray(session.stages), `${label} stage records`);
      for (const requiredStage of DIAGNOSTIC_STAGE_NAMES) {
        const stage = session.stages.find((candidate) => candidate?.name === requiredStage);
        diagnosticRequire(stage, `${label} ${requiredStage} stage`);
        diagnosticRequire(diagnosticTimestamp(stage.startedAt), `${label} ${requiredStage} start`);
        diagnosticRequire(diagnosticTimestamp(stage.finishedAt), `${label} ${requiredStage} finish`);
        diagnosticRequire(typeof stage.ok === 'boolean', `${label} ${requiredStage} result`);
      }
      diagnosticRequire(session.request && typeof session.request === 'object', `${label} request`);
      diagnosticRequire(diagnosticTimestamp(session.request.startedAt), `${label} request start`);
      diagnosticRequire(diagnosticTimestamp(session.request.finishedAt), `${label} request finish`);
      diagnosticRequire(typeof session.request.ok === 'boolean', `${label} request result`);
      diagnosticRequire(session.request.png && typeof session.request.png === 'object', `${label} PNG result`);
      if (session.request.ok) {
        diagnosticRequire(session.request.png.ok === true, `${label} successful PNG result`);
        diagnosticRequire(typeof session.request.png.path === 'string' && session.request.png.path.length > 0, `${label} PNG path`);
        diagnosticRequire(Number(session.request.png.width) > 0 && Number(session.request.png.height) > 0, `${label} PNG dimensions`);
        diagnosticRequire(Number(session.request.png.byteLength) > 0, `${label} PNG byte length`);
        diagnosticRequire(typeof session.request.png.sha256 === 'string' && session.request.png.sha256.length === 64, `${label} PNG hash`);
      } else {
        diagnosticRequire(session.request.png.ok === false, `${label} failed PNG result`);
        diagnosticRequire(session.request.error && typeof session.request.error === 'object', `${label} screenshot error`);
      }
      diagnosticRequire(session.cleanup && typeof session.cleanup === 'object', `${label} cleanup`);
      diagnosticRequire(typeof session.cleanup.confirmed === 'boolean', `${label} cleanup confirmed result`);
      diagnosticRequire(typeof session.cleanup.cliCloseCompleted === 'boolean', `${label} CLI close result`);
      diagnosticRequire(Array.isArray(session.cleanup.residualProcesses), `${label} cleanup residual process result`);
      diagnosticRequire(typeof session.cleanup.portOpen === 'boolean', `${label} cleanup port result`);
      diagnosticRequire(session.cleanup.verification && typeof session.cleanup.verification === 'object', `${label} cleanup verification`);
      diagnosticRequire(typeof session.cleanup.verification.confirmed === 'boolean', `${label} cleanup verification confirmed result`);
      diagnosticRequire(Array.isArray(session.cleanup.verification.residualProcesses), `${label} cleanup verification processes`);
      diagnosticRequire(typeof session.cleanup.verification.portOpen === 'boolean', `${label} cleanup verification port`);
    }
  }
  return true;
}

function minimalProbeSessionSucceeded(session) {
  return Boolean(
    session?.request?.ok === true
    && session.request.png?.ok === true
    && Number(session.request.png.width) > 0
    && Number(session.request.png.height) > 0
    && Number(session.request.png.byteLength) > 0
    && session.cleanup?.confirmed === true
    && session.cleanup?.cliCloseCompleted === true
    && Array.isArray(session.cleanup?.residualProcesses)
    && session.cleanup.residualProcesses.length === 0
    && session.cleanup.portOpen === false
    && session.cleanup.verification?.confirmed === true
    && Array.isArray(session.cleanup.verification.residualProcesses)
    && session.cleanup.verification.residualProcesses.length === 0
    && session.cleanup.verification.portOpen === false
  );
}

function decideScreenshotDiagnostic(matrix) {
  const nodeRuns = Array.isArray(matrix?.nodeRuns) ? matrix.nodeRuns : [];
  const stableRun = nodeRuns.find((run) => Array.isArray(run.sessions)
    && run.sessions.length === 2
    && run.sessions.every(minimalProbeSessionSucceeded));
  const counts = nodeRuns.map((run) => ({
    node: run?.node?.label || null,
    sessions: Array.isArray(run.sessions) ? run.sessions.length : 0,
    successful: Array.isArray(run.sessions) ? run.sessions.filter(minimalProbeSessionSucceeded).length : 0,
  }));
  if (stableRun) {
    return {
      continueCurrentProject: true,
      canDeclareApplicationIssue: false,
      selectedNode: stableRun.node.label,
      conclusion: 'minimal-probe-stable',
      counts,
    };
  }
  return {
    continueCurrentProject: false,
    canDeclareApplicationIssue: false,
    selectedNode: null,
    conclusion: 'minimal-probe-not-stable',
    counts,
  };
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

function makeLedgerFixtureState(nowDate) {
  const oldestDate = addDays(nowDate, -2);
  const middleDate = addDays(nowDate, -1);
  let state = fixtureBase({ nowDate, startDay: 1 });
  state = addAssetAccount(state, {
    id: 'qa-bank',
    name: '隔离测试储蓄卡',
    type: 'bank',
    balanceYuan: '0',
  });
  state = recordEntry(state, {
    amountYuan: '25.00',
    date: oldestDate,
    accountId: 'qa-cash',
    categoryLevel1: '餐饮',
    categoryLevel2: '晚餐',
    note: '账本三日 fixture 最早支出',
    includeControlledBudget: true,
  });
  const originalExpense = state.transactions[state.transactions.length - 1];
  state = recordIncomeEntry(state, {
    amountYuan: '200.00',
    date: middleDate,
    accountId: 'qa-cash',
    categoryLevel2: '工资',
    source: 'visual-ledger-fixture',
  });
  state = recordTransferEntry(state, {
    amountYuan: '10.00',
    date: middleDate,
    fromAccountId: 'qa-cash',
    toAccountId: 'qa-bank',
    source: 'visual-ledger-fixture',
  });
  state = recordEntry(state, {
    amountYuan: '50.00',
    date: nowDate,
    accountId: 'qa-cash',
    categoryLevel1: '购物',
    categoryLevel2: '日用品',
    note: '账本三日 fixture 今日支出',
    includeControlledBudget: true,
  });
  state = recordRefund(state, {
    id: 'qa-ledger-refund',
    date: middleDate,
    originalTransactionId: originalExpense.id,
    amountCents: 500,
    source: 'visual-ledger-fixture',
  });
  return state;
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
    state = settleCurrentPeriod(state, nowDate, { decision: 'carry' });
  } else if (name === 'ledger-overview' || name === 'ledger-expanded') {
    state = makeLedgerFixtureState(nowDate);
  } else {
    throw new Error(`未知 fixture：${name}`);
  }
  const model = getHomeModel(state, nowDate);
  const bills = listRecentBills(state);
  const transactions = listRecentTransactions(state);
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
    ledgerTransactionCount: transactions.length,
    ledgerDateCount: new Set(transactions.map((item) => item.date)).size,
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
  if (name === 'ledger-overview' || name === 'ledger-expanded') {
    assert.equal(expected.ledgerDateCount, 3, '账本 fixture 必须覆盖至少三天');
    assert(transactions.some((item) => item.kind === 'controlled_expense'), '账本 fixture 必须包含支出');
    assert(transactions.some((item) => item.kind === 'income'), '账本 fixture 必须包含收入');
    assert(transactions.some((item) => item.kind === 'refund'), '账本 fixture 必须包含退款');
    assert(transactions.some((item) => item.kind === 'transfer'), '账本 fixture 必须包含转账');
  }
  return {
    name,
    route: HOME_ROUTE,
    captureMode: name === 'ledger-expanded' ? 'expanded' : 'overview',
    state,
    raw,
    rawSha256,
    expected,
  };
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

function parseProtocolDebugLine(line) {
  const raw = String(line ?? '');
  const sendMarker = raw.match(/(?:^|\s)SEND\s*(?:►|->)/u);
  const recvMarker = raw.match(/(?:◀\s*RECV|\bRECV\s*(?:◀|<-))/u);
  let direction = null;
  let markerIndex = -1;
  if (sendMarker) {
    direction = 'SEND';
    markerIndex = sendMarker.index ?? -1;
  } else if (recvMarker) {
    direction = 'RECV';
    markerIndex = recvMarker.index ?? -1;
  }
  if (!direction) return null;
  const payloadStart = raw.indexOf('{', markerIndex);
  if (payloadStart < 0) {
    return {
      direction,
      raw,
      payload: null,
      parseError: { name: 'ProtocolPayloadMissing', message: 'protocol debug line has no JSON payload' },
    };
  }
  const payloadText = raw.slice(payloadStart).trim();
  try {
    return { direction, raw, payload: JSON.parse(payloadText), parseError: null };
  } catch (error) {
    return {
      direction,
      raw,
      payload: null,
      parseError: { name: error.name || 'SyntaxError', message: error.message || String(error) },
    };
  }
}

function parseProtocolDebugOutput(output) {
  const messages = [];
  const parseErrors = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const parsed = parseProtocolDebugLine(line);
    if (!parsed) continue;
    messages.push(parsed);
    if (parsed.parseError) parseErrors.push({ direction: parsed.direction, raw: parsed.raw, error: parsed.parseError });
  }
  return { messages, parseErrors };
}

function associateScreenshotProtocol(messages) {
  const records = Array.isArray(messages) ? messages : [];
  const screenshotSends = records.filter((record) => record?.direction === 'SEND' && record.payload?.method === 'App.captureScreenshot');
  const screenshotSend = screenshotSends[0] || null;
  const uuid = screenshotSend?.payload?.id || null;
  const screenshotReplies = uuid == null
    ? []
    : records.filter((record) => record?.direction === 'RECV' && record.payload?.id === uuid);
  return {
    uuid,
    screenshotSend,
    screenshotReply: screenshotReplies[0] || null,
    screenshotSendCount: screenshotSends.length,
    screenshotReplyCount: screenshotReplies.length,
    parseErrors: records.filter((record) => record?.parseError).map((record) => ({ direction: record.direction, raw: record.raw, error: record.parseError })),
  };
}

function protocolStringLooksLikeBase64(value) {
  const compact = value.replace(/[\r\n\t ]/g, '');
  return compact.length >= 128 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact) && compact.length % 4 === 0;
}

function protocolStringMustBeRedacted(key, value) {
  const normalizedKey = String(key || '').toLowerCase();
  const sensitiveKey = normalizedKey === 'body'
    || normalizedKey.includes('base64')
    || normalizedKey === 'data'
    || normalizedKey.endsWith('bytes');
  return (sensitiveKey && value.length >= 32) || protocolStringLooksLikeBase64(value);
}

function redactProtocolPayload(value, key = '') {
  if (typeof value === 'string') {
    if (!protocolStringMustBeRedacted(key, value)) return value;
    return {
      redacted: true,
      originalType: 'string',
      length: value.length,
      sha256: sha256Bytes(Buffer.from(value, 'utf8')),
    };
  }
  if (Array.isArray(value)) return value.map((nested) => redactProtocolPayload(nested, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    redactProtocolPayload(nestedValue, nestedKey),
  ]));
}

function redactProtocolDebugRaw(raw, payload) {
  const text = String(raw ?? '');
  const payloadStart = text.indexOf('{');
  if (payloadStart < 0 || !payload || typeof payload !== 'object') return text;
  return `${text.slice(0, payloadStart)}${JSON.stringify(redactProtocolPayload(payload))}`;
}

function sanitizeProtocolRecord(record) {
  if (!record) return null;
  return {
    direction: record.direction || null,
    raw: redactProtocolDebugRaw(record.raw, record.payload),
    payload: record.payload == null ? null : redactProtocolPayload(record.payload),
    parseError: record.parseError || null,
  };
}

function classifyScreenshotProtocolTrace({
  screenshotSend,
  screenshotReply,
  screenshotPostprocessOk = false,
  cleanupConfirmed = false,
  traceInconclusive = false,
} = {}) {
  if (traceInconclusive || !cleanupConfirmed) return 'trace-inconclusive';
  if (!screenshotSend) return 'send-not-observed';
  if (!screenshotReply) return 'sent-no-matching-reply';
  if (screenshotReply.payload?.error) return 'explicit-protocol-error';
  if (!screenshotPostprocessOk) return 'reply-success-postprocess-failure';
  return 'screenshot-success';
}

function validateProtocolTraceResult(result) {
  diagnosticRequire(result && typeof result === 'object', 'result object');
  diagnosticRequire(!Object.hasOwn(result, 'ok'), 'top-level ok is forbidden');
  diagnosticRequire(result.schemaVersion === 1, 'schemaVersion');
  diagnosticRequire(result.stage === 'trace-screenshot-protocol', 'stage');
  diagnosticRequire(diagnosticTimestamp(result.startedAt), 'run start');
  diagnosticRequire(diagnosticTimestamp(result.finishedAt), 'run finish');
  diagnosticRequire(typeof result.diagnosticCompleted === 'boolean', 'diagnosticCompleted');
  diagnosticRequire(typeof result.screenshotSucceeded === 'boolean', 'screenshotSucceeded');
  diagnosticRequire(PROTOCOL_TRACE_CLASSIFICATIONS.includes(result.classification), 'classification');
  diagnosticRequire(result.project?.kind === 'minimal', 'minimal project kind');
  diagnosticRequire(result.project?.appid === QA_APP_ID, 'touristappid project');
  diagnosticRequire(result.project?.pagePath === '/pages/index/index', 'probe page path');
  diagnosticRequire(result.screenshotRequestCount === 1, 'exactly one screenshot request');
  diagnosticRequire(result.protocol && typeof result.protocol === 'object', 'protocol trace');
  diagnosticRequire(result.cleanup && typeof result.cleanup === 'object', 'cleanup');
  diagnosticRequire(typeof result.cleanup.confirmed === 'boolean', 'cleanup confirmed');
  diagnosticRequire(typeof result.cleanup.probeRemoved === 'boolean', 'probe removal');
  diagnosticRequire(result.cleanup.verification && typeof result.cleanup.verification === 'object', 'cleanup verification');
  diagnosticRequire(typeof result.cleanup.verification.confirmed === 'boolean', 'cleanup verification confirmed');
  diagnosticRequire(Array.isArray(result.cleanup.verification.residualProcesses), 'cleanup residual processes');
  diagnosticRequire(typeof result.cleanup.verification.portOpen === 'boolean', 'cleanup port state');
  if (result.screenshotSucceeded) {
    diagnosticRequire(result.classification === 'screenshot-success', 'successful screenshot classification');
    diagnosticRequire(result.protocol.screenshotSend?.payload?.id, 'screenshot SEND UUID');
    diagnosticRequire(result.protocol.screenshotReply?.payload?.id === result.protocol.screenshotSend.payload.id, 'matching screenshot RECV UUID');
  }
  return true;
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

async function launchQa(cliPath, events, { deadline = null, projectPath = QA_ROOT, usedPorts = [] } = {}) {
  const port = await freeTcpPort(usedPorts);
  const cliArguments = buildCliArguments({ projectPath, port });
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
  return { miniProgram, cliProcess, port, projectPath, cliArguments, cliExit: cliExitInfo, cliExitPromise: cliExit, cliOutput, events };
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

function normalizedScrollTop(value, label) {
  const scalar = Array.isArray(value) ? value[0] : value;
  const numeric = Number(scalar);
  assert(Number.isFinite(numeric), `${label} 必须能读回为数字`);
  return numeric;
}

async function evidenceStep(operation, label, timeoutMs = 15_000) {
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

async function readViewportScrollTop(miniProgram) {
  if (!miniProgram || typeof miniProgram.evaluate !== 'function') return null;
  const property = '__visualEvidenceViewportScrollTop';
  await evidenceStep(
    () => miniProgram.evaluate((key) => {
      const app = getApp();
      app[key] = null;
      wx.createSelectorQuery()
        .selectViewport()
        .scrollOffset((offset) => {
          app[key] = Number(offset?.scrollTop) || 0;
        })
        .exec();
      return true;
    }, property),
    'request viewport scrollTop()',
  );

  const deadline = Date.now() + 15_000;
  let value = null;
  while (Date.now() < deadline) {
    value = await evidenceStep(
      () => miniProgram.evaluate((key) => getApp()[key], property),
      'read viewport scrollTop()',
      2_000,
    );
    if (value !== null && value !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await miniProgram.evaluate((key) => { delete getApp()[key]; }, property).catch(() => {});
  if (value === null || value === undefined) throw new Error('viewport scrollTop() 未返回读回值');
  return normalizedScrollTop(value, 'viewport scrollTop');
}

async function evaluateCurrentPageInstance(miniProgram, operation, selector = 'scroll-view') {
  if (!miniProgram || typeof miniProgram.evaluate !== 'function') throw new Error('页面实例取证需要 miniProgram.evaluate');
  const property = `__visualEvidencePageInstance_${crypto.randomUUID().replaceAll('-', '')}`;
  await evidenceStep(
    () => miniProgram.evaluate((key, action, selectorName) => {
      const app = getApp();
      app[key] = null;
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const page = pages[pages.length - 1];
      if (!page) {
        app[key] = { ok: false, error: '当前页面实例不存在' };
        return false;
      }
      const describe = (error) => ({ name: error?.name || 'Error', message: String(error?.message || error), stack: error?.stack || null });
      const readState = () => ({
        path: page.route || page.__route__ || null,
        ledgerMode: page.data?.ledgerMode ?? null,
        stateLedgerScrollTop: Number(page.data?.ledgerScrollTop),
      });
      const finish = (state) => {
        app[key] = {
          ok: true,
          path: state.path,
          ledgerMode: state.ledgerMode,
          ledgerScrollTop: state.stateLedgerScrollTop,
          stateLedgerScrollTop: state.stateLedgerScrollTop,
          selectorScrollTop: null,
        };
      };
      try {
        if (action === 'read') {
          finish(readState());
          return true;
        }
        if (action === 'expand') {
          if (typeof page.enterLedger !== 'function') throw new Error('当前页面实例没有 enterLedger');
          page.enterLedger();
        }
        if (typeof page.setData !== 'function') throw new Error('当前页面实例没有 setData');
        page.setData({ ledgerScrollTop: 0 }, () => finish(readState()));
      } catch (error) {
        app[key] = { ok: false, error: describe(error) };
      }
      return true;
    }, property, operation, selector),
    `evaluate page instance ${operation}`,
  );

  let result = null;
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      result = await evidenceStep(
        () => miniProgram.evaluate((key) => getApp()[key], property),
        `read page instance ${operation}`,
        2_000,
      );
      if (result !== null && result !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    await miniProgram.evaluate((key) => { delete getApp()[key]; }, property).catch(() => {});
  }
  if (!result) throw new Error(`页面实例 ${operation} 未返回读回值`);
  if (!result.ok) throw new Error(`页面实例 ${operation} 失败：${json(result.error)}`);
  assert(Number.isFinite(Number(result.ledgerScrollTop)), '账本 scrollTop 必须能读回为数字');
  return result;
}

async function resetPageScrollForEvidence(miniProgram, selector = 'scroll-view', { resetLedger = true } = {}) {
  if (!miniProgram || typeof miniProgram.pageScrollTo !== 'function') throw new Error('取证滚动归零需要 miniProgram.pageScrollTo');
  await evidenceStep(() => miniProgram.pageScrollTo(0), 'pageScrollTo(0)');
  const pageState = await evaluateCurrentPageInstance(miniProgram, resetLedger ? 'reset' : 'read', selector);
  const pageScrollTop = normalizedScrollTop(await readViewportScrollTop(miniProgram), '页面 viewport scrollTop');
  assert.equal(pageScrollTop, 0, '页面滚动归零后必须读回0');
  const ledgerScrollTop = normalizedScrollTop(pageState.ledgerScrollTop, '账本 scrollTop');
  if (resetLedger) assert.equal(ledgerScrollTop, 0, '账本滚动归零后必须读回0');
  return {
    path: pageState.path,
    ledgerMode: pageState.ledgerMode,
    pageScrollTop,
    viewportScrollTop: pageScrollTop,
    ledgerScrollTop,
  };
}

async function enterExpandedLedgerForEvidence(miniProgram, selector = 'scroll-view') {
  const pageState = await evaluateCurrentPageInstance(miniProgram, 'expand', selector);
  const mode = pageState.ledgerMode;
  assert.equal(mode, 'expanded', '账本全屏 fixture 必须由真实页面实例进入展开态');
  const ledgerScrollTop = normalizedScrollTop(pageState.ledgerScrollTop, '展开态账本 scrollTop');
  assert.equal(ledgerScrollTop, 0, '展开态首次进入必须位于列表顶部');
  return { path: pageState.path, mode, ledgerScrollTop };
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

async function cleanupQaRuntime(runtime, cliPath, {
  mode = 'close',
  projectPath = QA_ROOT,
  events = runtime?.events || [],
  closeProject = (stableCliPath, timeoutMs) => closeQaProject(stableCliPath, timeoutMs, projectPath),
} = {}) {
  const cleanupErrors = [];
  let cliExit = runtime?.cliExit || null;
  if (runtime && mode === 'abort') runtime.unusable = true;
  const port = runtime?.port ?? null;
  let before = [];
  try {
    before = await findQaProcesses(projectPath, port);
  } catch (error) {
    cleanupErrors.push({ stage: 'inspect-before-cleanup', error });
  }

  if (mode === 'close') {
    try {
      await closeMiniProgram(runtime, events, SESSION_CLEANUP_TIMEOUT_MS);
    } catch (error) {
      cleanupErrors.push({ stage: 'close', error });
    }
  } else if (typeof runtime?.miniProgram?.disconnect === 'function') {
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

  try {
    cliExit = await waitForCliExit(runtime);
  } catch (error) {
    cleanupErrors.push({ stage: 'wait-cli-exit', error });
    events.push({ at: isoNow(), kind: 'cli-exit-timeout', error: true, message: error.message, stack: error.stack });
  }

  if (!cliPath) {
    cleanupErrors.push({ stage: 'close-qa-project', error: new Error(`Stable CLI path unavailable while ${mode === 'abort' ? 'aborting' : 'closing'} QA session`) });
  } else {
    try {
      await closeProject(cliPath, SESSION_CLEANUP_TIMEOUT_MS);
      events.push({ at: isoNow(), kind: 'qa-project-closed', error: false, port });
    } catch (error) {
      cleanupErrors.push({ stage: 'close-qa-project', error });
      events.push({ at: isoNow(), kind: 'qa-project-close-error', error: true, message: error.message, stack: error.stack });
    }
  }

  let residual = [];
  let termination = [];
  let verification;
  try {
    const cleanup = await terminateAndVerifyQaCleanup({ projectPath, port, events });
    residual = cleanup.residual;
    termination = cleanup.termination;
    verification = cleanup.verification;
  } catch (error) {
    cleanupErrors.push({ stage: 'terminate-exact-qa-process-tree', error });
  }
  if (!verification) {
    try {
      verification = await verifyQaCleanup({ projectPath, port, timeoutMs: SESSION_CLEANUP_TIMEOUT_MS });
    } catch (error) {
      cleanupErrors.push({ stage: 'verify-qa-cleanup', error });
      verification = { confirmed: false, projectPath, port, residualProcesses: residual, portOpen: true, error: serializeError(error) };
    }
  }
  const result = {
    confirmed: cleanupErrors.length === 0 && verification.confirmed === true,
    port,
    cliExit,
    errors: cleanupErrors.map(({ stage, error }) => ({ stage, error: serializeError(error) })),
    processVerification: { before, residual, termination, verification },
  };
  events.push({
    at: isoNow(),
    kind: 'qa-cleanup-verification',
    error: !result.confirmed,
    confirmed: result.confirmed,
    projectPath,
    port,
    beforeProcessCount: before.length,
    residualProcessCount: verification.residualProcesses?.length ?? residual.length,
    portOpen: verification.portOpen ?? null,
    verification,
  });
  return result;
}

async function abortQaSession(runtime, cliPath, events = runtime?.events || [], options = {}) {
  return cleanupQaRuntime(runtime, cliPath, { ...options, mode: 'abort', events });
}

async function closeQaSession(runtime, cliPath, events = runtime?.events || [], options = {}) {
  return cleanupQaRuntime(runtime, cliPath, { ...options, mode: 'close', events });
}

async function createQaSession(cliPath, { deadline = null, projectPath = QA_ROOT } = {}) {
  const events = [];
  let runtime = null;
  try {
    runtime = await launchQa(cliPath, events, { deadline, projectPath });
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

function diagnosticStageRecords(startedAt) {
  return DIAGNOSTIC_STAGE_NAMES.map((name) => ({
    name,
    attempted: false,
    startedAt,
    finishedAt: startedAt,
    ok: false,
    error: { name: 'NotReached', message: `${name} stage not reached`, stack: null },
  }));
}

async function runDiagnosticStage(stages, name, operation, { timeoutMs = AUTOMATOR_TIMEOUT_MS, summarize = (value) => value } = {}) {
  const stage = stages.find((candidate) => candidate.name === name);
  assert(stage, `diagnostic stage ${name} must be declared`);
  stage.attempted = true;
  stage.startedAt = isoNow();
  stage.finishedAt = null;
  stage.error = null;
  try {
    const value = await withTimeout(operation, `diagnostic ${name}`, timeoutMs);
    stage.ok = true;
    stage.result = summarize(value);
    return value;
  } catch (error) {
    stage.ok = false;
    stage.error = serializeError(error);
    throw error;
  } finally {
    stage.finishedAt = isoNow();
  }
}

function diagnosticCleanupRecord(cleanupResult, events) {
  const verification = cleanupResult?.processVerification?.verification || {
    confirmed: false,
    residualProcesses: [],
    portOpen: true,
  };
  const closeEvent = (events || []).find((event) => event.kind === 'qa-project-closed' && event.error === false);
  return {
    confirmed: cleanupResult?.confirmed === true,
    cliCloseCompleted: Boolean(closeEvent),
    residualProcesses: verification.residualProcesses || [],
    portOpen: verification.portOpen ?? true,
    verification: {
      confirmed: verification.confirmed === true,
      projectPath: verification.projectPath || PROBE_ROOT,
      port: verification.port ?? null,
      ports: verification.ports || [],
      residualProcesses: verification.residualProcesses || [],
      portOpen: verification.portOpen ?? true,
      startedAt: verification.startedAt || null,
      finishedAt: verification.finishedAt || null,
    },
    errors: cleanupResult?.errors || [],
  };
}

async function runMinimalProbeSession({
  cliPath,
  nodeLabel,
  sessionNumber,
  outputRoot = EVIDENCE_ROOT,
  outputPrefix = SCREENSHOT_DIAGNOSTIC_PREFIX,
  usedPorts = [],
}) {
  const sessionStartedAt = isoNow();
  const stages = diagnosticStageRecords(sessionStartedAt);
  const events = [];
  const outputPath = path.join(outputRoot, `${outputPrefix}${nodeLabel}-${sessionNumber}.png`);
  let runtime = null;
  let primaryError = null;
  let port = null;
  const request = {
    startedAt: sessionStartedAt,
    finishedAt: sessionStartedAt,
    reached: false,
    ok: false,
    error: { name: 'NotReached', message: 'screenshot stage not reached', stack: null },
    png: { ok: false, path: null, width: 0, height: 0, byteLength: 0, sha256: null },
  };
  let cleanup = {
    confirmed: false,
    cliCloseCompleted: false,
    residualProcesses: [],
    portOpen: false,
    verification: { confirmed: false, projectPath: PROBE_ROOT, port: null, ports: [], residualProcesses: [], portOpen: false },
    errors: [],
  };

  try {
    runtime = await runDiagnosticStage(
      stages,
      'connect',
      () => launchQa(cliPath, events, { projectPath: PROBE_ROOT, usedPorts }),
      { summarize: (value) => ({ projectPath: value.projectPath, port: value.port, cliArguments: value.cliArguments }) },
    );
    port = runtime.port;
    if (Number.isInteger(port) && !usedPorts.includes(port)) usedPorts.push(port);

    const currentPage = await runDiagnosticStage(
      stages,
      'currentPage',
      () => runtime.miniProgram.currentPage(),
      { summarize: (value) => ({ id: value?.id ?? null, path: value?.path ?? null }) },
    );
    assert(currentPage, 'minimal probe currentPage must return a page');

    const constant = await runDiagnosticStage(
      stages,
      'evaluate',
      () => runtime.miniProgram.evaluate(() => 7),
      { summarize: (value) => ({ value }) },
    );
    assert.equal(constant, 7, 'minimal probe evaluate constant must round-trip');

    request.startedAt = isoNow();
    request.reached = true;
    try {
      const screenshot = await runDiagnosticStage(
        stages,
        'screenshot',
        async () => {
          await fs.rm(outputPath, { force: true });
          await runtime.miniProgram.screenshot({ path: outputPath });
          const bytes = await fs.readFile(outputPath);
          const dimensions = pngInfo(bytes);
          assert(bytes.length > 0, 'minimal probe screenshot must not be empty');
          return { ...dimensions, byteLength: bytes.length, sha256: sha256Bytes(bytes) };
        },
        { timeoutMs: SCREENSHOT_TIMEOUT_MS },
      );
      request.ok = true;
      request.error = null;
      request.png = { ok: true, path: relativePath(outputPath), ...screenshot };
    } catch (error) {
      request.error = serializeError(error);
      request.png = { ok: false, path: null, width: 0, height: 0, byteLength: 0, sha256: null };
      throw error;
    } finally {
      request.finishedAt = isoNow();
    }
  } catch (error) {
    primaryError = error;
    port = port ?? error?.port ?? null;
  }

  const partialRuntime = runtime || {
    miniProgram: null,
    cliProcess: primaryError?.cliProcess || null,
    cliExitPromise: primaryError?.cliExitPromise || null,
    cliExit: primaryError?.cliExit || null,
    port,
    projectPath: PROBE_ROOT,
    cliArguments: primaryError?.cliArguments || null,
    cliOutput: primaryError?.cliOutput || null,
    events,
  };
  const cleanupStage = stages.find((stage) => stage.name === 'cleanup');
  cleanupStage.attempted = true;
  cleanupStage.startedAt = isoNow();
  cleanupStage.finishedAt = null;
  cleanupStage.error = null;
  try {
    const cleanupResult = primaryError
      ? await abortQaSession(partialRuntime, cliPath, events, { projectPath: PROBE_ROOT })
      : await closeQaSession(partialRuntime, cliPath, events, { projectPath: PROBE_ROOT });
    cleanup = diagnosticCleanupRecord(cleanupResult, events);
    cleanupStage.ok = cleanup.confirmed;
    cleanupStage.result = {
      confirmed: cleanup.confirmed,
      cliCloseCompleted: cleanup.cliCloseCompleted,
      residualProcessCount: cleanup.residualProcesses.length,
      portOpen: cleanup.portOpen,
    };
  } catch (error) {
    cleanupStage.ok = false;
    cleanupStage.error = serializeError(error);
    cleanup = {
      ...cleanup,
      errors: [{ stage: 'cleanup', error: serializeError(error) }],
      verification: { ...cleanup.verification, port: port, portOpen: true },
      portOpen: true,
    };
  } finally {
    cleanupStage.finishedAt = isoNow();
  }

  const finishedAt = isoNow();
  return {
    session: sessionNumber,
    stage: 'minimal-screenshot',
    node: nodeLabel,
    port,
    startedAt: sessionStartedAt,
    finishedAt,
    ok: !primaryError && request.ok && cleanup.confirmed,
    error: primaryError ? serializeError(primaryError) : null,
    stages,
    request,
    cleanup,
    events,
    cliOutput: runtime?.cliOutput ? cliOutputSnapshot(runtime.cliOutput) : primaryError?.cliOutput ? cliOutputSnapshot(primaryError.cliOutput) : null,
  };
}

async function runMinimalProbeSessions({ cliPath, nodeLabel, nodeExecutable }) {
  const startedAt = isoNow();
  const sessions = [];
  for (let sessionNumber = 1; sessionNumber <= 2; sessionNumber += 1) {
    sessions.push(await runMinimalProbeSession({ cliPath, nodeLabel, sessionNumber }));
  }
  return {
    node: { label: nodeLabel, executable: nodeExecutable, version: process.version },
    project: { kind: 'minimal', path: relativePath(PROBE_ROOT), appid: QA_APP_ID, pagePath: '/pages/index/index' },
    startedAt,
    finishedAt: isoNow(),
    sessions,
  };
}

function stableSingleInstanceCleanupConfirmed(session) {
  const cleanup = session?.cleanup;
  const verification = cleanup?.verification;
  return Boolean(
    cleanup?.confirmed === true
    && verification?.confirmed === true
    && Array.isArray(cleanup.residualProcesses)
    && cleanup.residualProcesses.length === 0
    && cleanup.portOpen === false
    && Array.isArray(verification.residualProcesses)
    && verification.residualProcesses.length === 0
    && verification.portOpen === false
  );
}

function canStartNextStableSingleInstanceSession(previousSession) {
  return stableSingleInstanceCleanupConfirmed(previousSession);
}

function stableSingleInstanceSessionSucceeded(session) {
  return session?.ok === true && stableSingleInstanceCleanupConfirmed(session);
}

function decideStableSingleInstance(sessions) {
  const records = Array.isArray(sessions) ? sessions : [];
  const successCount = records.filter(stableSingleInstanceSessionSucceeded).length;
  const ports = records.map((session) => session?.port).filter((port) => Number.isInteger(port));
  const distinctPorts = ports.length === records.length && new Set(ports).size === ports.length;
  let decision = 'infrastructure-stop';
  let classification = 'infrastructure-failure';

  if (records.length === 2 && distinctPorts) {
    if (successCount === 2) {
      decision = 'stable-single-instance-2-of-2';
      classification = 'important-candidate-variable';
    } else if (successCount === 0) {
      decision = 'stable-single-instance-0-of-2';
      classification = 'd-coexistence-not-necessary';
    } else {
      decision = 'stable-single-instance-1-of-2';
      classification = 'intermittent';
    }
  }

  return {
    sessionCount: records.length,
    successCount,
    ports,
    distinctPorts,
    decision,
    classification,
    continueCurrentProject: false,
    canDeclareApplicationIssue: false,
  };
}

async function runStableSingleInstanceSessions({ cliPath = C_STABLE_CLI_PATH, nodeExecutable = C_STABLE_NODE_PATH } = {}) {
  const startedAt = isoNow();
  const sessions = [];
  const usedPorts = [];
  for (let sessionNumber = 1; sessionNumber <= 2; sessionNumber += 1) {
    const session = await runMinimalProbeSession({
      cliPath,
      nodeLabel: 'stable-single-instance',
      sessionNumber,
      outputRoot: SINGLE_INSTANCE_ROOT,
      outputPrefix: 'stable-single-instance-',
      usedPorts,
    });
    sessions.push(session);
    if (sessionNumber < 2 && !canStartNextStableSingleInstanceSession(session)) break;
  }
  return {
    schemaVersion: 1,
    stage: 'stable-single-instance',
    node: { label: 'stable-internal', executable: nodeExecutable, version: process.version },
    project: { kind: 'minimal', path: relativePath(PROBE_ROOT), appid: QA_APP_ID, pagePath: '/pages/index/index' },
    startedAt,
    finishedAt: isoNow(),
    sessions,
    decision: decideStableSingleInstance(sessions),
  };
}

async function runStableSingleInstanceWorker() {
  // This worker intentionally assumes the parent already prepared .visual-probe;
  // it never prepares or deletes the probe directory.
  return runStableSingleInstanceSessions({ cliPath: C_STABLE_CLI_PATH, nodeExecutable: C_STABLE_NODE_PATH });
}

async function runStableSingleInstanceDiagnostic() {
  const outputPaths = stableSingleInstanceOutputPaths();
  const startedAt = isoNow();
  const events = [];
  await removePaths([
    outputPaths.resultPath,
    outputPaths.logPath,
    outputPaths.pngPath(1),
    outputPaths.pngPath(2),
  ]);

  let preparation = { attempted: false, projectPath: relativePath(PROBE_ROOT), appid: QA_APP_ID, verified: false };
  let workerProcess = null;
  let workerResult = { sessions: [], decision: decideStableSingleInstance([]) };
  let primaryError = null;
  let totalCleanup = {
    attempted: false,
    confirmed: false,
    probeRemoved: false,
    verification: null,
    error: null,
  };

  try {
    if (!(await exists(C_STABLE_CLI_PATH))) throw new Error(`C盘 Stable CLI 不存在：${C_STABLE_CLI_PATH}`);
    if (!(await exists(C_STABLE_NODE_PATH))) throw new Error(`C盘 Stable 内置 Node 不存在：${C_STABLE_NODE_PATH}`);
    preparation = { ...preparation, attempted: true };
    const prepared = await prepareMinimalProbeProject(C_STABLE_CLI_PATH);
    preparation = { ...preparation, projectPath: relativePath(prepared.projectPath), verified: true };

    workerProcess = await runCapturedProcess(
      C_STABLE_NODE_PATH,
      [fileURLToPath(import.meta.url), '--stable-single-instance-worker'],
      'C盘 Stable 内置 Node 严格两场探针',
      180_000,
    );
    if (workerProcess.type !== 'exit' || workerProcess.code !== 0) throw formatCliExit(workerProcess, null);
    const stdout = workerProcess.stdout.trim();
    if (!stdout) throw new Error('严格两场 worker 未返回结果');
    workerResult = JSON.parse(stdout);
  } catch (error) {
    primaryError = error;
  } finally {
    const knownPorts = workerResult.sessions.map((session) => session.port).filter(Number.isInteger);
    if (await exists(PROBE_ROOT)) {
      totalCleanup.attempted = true;
      try {
        const cleared = await clearStaleAutomationProject(PROBE_ROOT, C_STABLE_CLI_PATH, events);
        const verification = cleared.verification;
        if (verification?.confirmed === true) await fs.rm(PROBE_ROOT, { recursive: true, force: true });
        totalCleanup = {
          attempted: true,
          confirmed: verification?.confirmed === true,
          probeRemoved: !(await exists(PROBE_ROOT)),
          verification,
          before: cleared.before,
          termination: cleared.termination,
          error: cleared.closeError,
        };
      } catch (error) {
        let verification = null;
        try {
          verification = await verifyQaCleanup({ projectPath: PROBE_ROOT, ports: knownPorts, timeoutMs: SESSION_CLEANUP_TIMEOUT_MS });
        } catch (verificationError) {
          totalCleanup.error = { cleanup: serializeError(error), verification: serializeError(verificationError) };
        }
        totalCleanup = {
          attempted: true,
          confirmed: verification?.confirmed === true,
          probeRemoved: !(await exists(PROBE_ROOT)),
          verification,
          error: totalCleanup.error || serializeError(error),
        };
      }
    } else {
      totalCleanup = { attempted: false, confirmed: true, probeRemoved: true, verification: null, error: null };
    }
  }

  const finishedAt = isoNow();
  const decision = workerResult.decision || decideStableSingleInstance(workerResult.sessions || []);
  if (!primaryError && decision.decision === 'infrastructure-stop') {
    primaryError = new Error(`严格两场实验因基础设施条件停止：${json(decision)}`);
  }
  if (!primaryError && (!totalCleanup.confirmed || !totalCleanup.probeRemoved)) {
    primaryError = new Error(`严格两场实验总清理未确认：${json(totalCleanup)}`);
  }

  const result = {
    schemaVersion: 1,
    stage: 'stable-single-instance-diagnostic',
    command: 'npm run evidence:visual -- --stable-single-instance-diagnostic',
    startedAt,
    finishedAt,
    fixedRuntime: { cliPath: C_STABLE_CLI_PATH, nodeExecutable: C_STABLE_NODE_PATH },
    project: { kind: 'minimal', path: relativePath(PROBE_ROOT), appid: QA_APP_ID, pagePath: '/pages/index/index' },
    preparation,
    workerProcess: workerProcess ? {
      type: workerProcess.type,
      code: workerProcess.code ?? null,
      signal: workerProcess.signal ?? null,
      stdout: workerProcess.stdout,
      stderr: workerProcess.stderr,
    } : null,
    sessions: workerResult.sessions || [],
    decision,
    totalCleanup,
    ok: !primaryError && totalCleanup.confirmed === true && totalCleanup.probeRemoved === true,
    error: primaryError ? serializeError(primaryError) : null,
  };
  const log = {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    events,
    result,
  };
  await writeAtomicText(outputPaths.resultPath, json(result));
  await writeAtomicText(outputPaths.logPath, json(log));
  if (primaryError) throw primaryError;
  return result;
}

const PROTOCOL_TRACE_STAGE_NAMES = ['connect', 'currentPage', 'evaluate', 'systemInfo', 'screenshot', 'cleanup'];

function protocolTraceStageRecords(startedAt) {
  return PROTOCOL_TRACE_STAGE_NAMES.map((name) => ({
    name,
    attempted: false,
    startedAt,
    finishedAt: startedAt,
    ok: false,
    error: { name: 'NotReached', message: `${name} stage not reached`, stack: null },
  }));
}

async function runProtocolTraceStage(stages, name, operation, { timeoutMs = AUTOMATOR_TIMEOUT_MS, summarize = (value) => value } = {}) {
  const stage = stages.find((candidate) => candidate.name === name);
  assert(stage, `protocol trace stage ${name} must be declared`);
  stage.attempted = true;
  stage.startedAt = isoNow();
  stage.finishedAt = null;
  stage.error = null;
  try {
    const value = await withTimeout(operation, `protocol trace ${name}`, timeoutMs);
    stage.ok = true;
    stage.result = summarize(value);
    return value;
  } catch (error) {
    stage.ok = false;
    stage.error = serializeError(error);
    throw error;
  } finally {
    stage.finishedAt = isoNow();
  }
}

function rawOutputSummary(snapshot) {
  if (!snapshot) return null;
  return {
    stdoutLength: Buffer.byteLength(snapshot.stdout || '', 'utf8'),
    stderrLength: Buffer.byteLength(snapshot.stderr || '', 'utf8'),
    stdoutSha256: sha256Bytes(Buffer.from(snapshot.stdout || '', 'utf8')),
    stderrSha256: sha256Bytes(Buffer.from(snapshot.stderr || '', 'utf8')),
  };
}

async function runProtocolTraceSession({ cliPath = C_STABLE_CLI_PATH } = {}) {
  const startedAt = isoNow();
  const stages = protocolTraceStageRecords(startedAt);
  const events = [];
  const outputPath = protocolTraceOutputPaths().screenshotPath;
  let runtime = null;
  let primaryError = null;
  let port = null;
  let screenshotRequestCount = 0;
  let screenshotPostprocessOk = false;
  let screenshot = {
    ok: false,
    path: null,
    width: 0,
    height: 0,
    byteLength: 0,
    sha256: null,
    error: { name: 'NotReached', message: 'screenshot stage not reached', stack: null },
  };

  try {
    runtime = await runProtocolTraceStage(
      stages,
      'connect',
      () => launchQa(cliPath, events, { projectPath: PROBE_ROOT }),
      { summarize: (value) => ({ projectPath: value.projectPath, port: value.port, cliArguments: value.cliArguments }) },
    );
    port = runtime.port;

    const currentPage = await runProtocolTraceStage(
      stages,
      'currentPage',
      () => runtime.miniProgram.currentPage(),
      { summarize: (value) => ({ id: value?.id ?? null, path: value?.path ?? null }) },
    );
    assert(currentPage, 'minimal probe currentPage must return a page');

    const constant = await runProtocolTraceStage(
      stages,
      'evaluate',
      () => runtime.miniProgram.evaluate(() => 7),
      { summarize: (value) => ({ value }) },
    );
    assert.equal(constant, 7, 'minimal probe evaluate constant must round-trip');

    await runProtocolTraceStage(
      stages,
      'systemInfo',
      () => readSystemInfo(runtime),
      { summarize: (value) => ({ keys: value && typeof value === 'object' ? Object.keys(value) : [] }) },
    );

    screenshotRequestCount = 1;
    try {
      const captured = await runProtocolTraceStage(
        stages,
        'screenshot',
        async () => {
          await fs.rm(outputPath, { force: true });
          await runtime.miniProgram.screenshot({ path: outputPath });
          const bytes = await fs.readFile(outputPath);
          const dimensions = pngInfo(bytes);
          assert(bytes.length > 0, 'protocol trace screenshot must not be empty');
          return { ...dimensions, byteLength: bytes.length, sha256: sha256Bytes(bytes) };
        },
        { timeoutMs: SCREENSHOT_TIMEOUT_MS },
      );
      screenshotPostprocessOk = true;
      screenshot = { ok: true, path: relativePath(outputPath), ...captured, error: null };
    } catch (error) {
      screenshot = { ...screenshot, error: serializeError(error) };
      throw error;
    }
  } catch (error) {
    primaryError = error;
    port = port ?? error?.port ?? null;
  }

  const partialRuntime = runtime || {
    miniProgram: null,
    cliProcess: primaryError?.cliProcess || null,
    cliExitPromise: primaryError?.cliExitPromise || null,
    cliExit: primaryError?.cliExit || null,
    port,
    projectPath: PROBE_ROOT,
    cliArguments: primaryError?.cliArguments || null,
    cliOutput: primaryError?.cliOutput || null,
    events,
  };
  const cleanupStage = stages.find((stage) => stage.name === 'cleanup');
  cleanupStage.attempted = true;
  cleanupStage.startedAt = isoNow();
  cleanupStage.finishedAt = null;
  cleanupStage.error = null;
  let cleanup = {
    confirmed: false,
    cliCloseCompleted: false,
    residualProcesses: [],
    portOpen: false,
    verification: { confirmed: false, projectPath: PROBE_ROOT, port, ports: [], residualProcesses: [], portOpen: false },
    errors: [],
  };
  try {
    const cleanupResult = primaryError
      ? await abortQaSession(partialRuntime, cliPath, events, { projectPath: PROBE_ROOT })
      : await closeQaSession(partialRuntime, cliPath, events, { projectPath: PROBE_ROOT });
    cleanup = diagnosticCleanupRecord(cleanupResult, events);
    cleanupStage.ok = cleanup.confirmed;
    cleanupStage.result = {
      confirmed: cleanup.confirmed,
      cliCloseCompleted: cleanup.cliCloseCompleted,
      residualProcessCount: cleanup.residualProcesses.length,
      portOpen: cleanup.portOpen,
    };
  } catch (error) {
    cleanupStage.ok = false;
    cleanupStage.error = serializeError(error);
    cleanup = {
      ...cleanup,
      errors: [{ stage: 'cleanup', error: serializeError(error) }],
      verification: { ...cleanup.verification, port, portOpen: true },
      portOpen: true,
    };
  } finally {
    cleanupStage.finishedAt = isoNow();
  }

  const cliOutputRaw = partialRuntime.cliOutput ? cliOutputSnapshot(partialRuntime.cliOutput) : null;
  return {
    schemaVersion: 1,
    stage: 'trace-screenshot-protocol-session',
    startedAt,
    finishedAt: isoNow(),
    node: { executable: process.execPath, version: process.version },
    port,
    stages,
    screenshotRequestCount,
    screenshotPostprocessOk,
    screenshot,
    cleanup,
    protocol: { messages: [], parseErrors: [], screenshotSend: null, screenshotReply: null, uuid: null },
    error: primaryError ? serializeError(primaryError) : null,
    cliOutput: rawOutputSummary(cliOutputRaw),
    cliOutputRaw,
  };
}

async function runTraceScreenshotProtocolWorker() {
  // The parent prepares .visual-probe exactly once; the worker never prepares or deletes it.
  return runProtocolTraceSession({ cliPath: C_STABLE_CLI_PATH });
}

function parseProtocolTraceWorkerOutput(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const raw = lines.at(-1);
  if (!raw) throw new Error('协议定位 worker 未返回结构化结果');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`协议定位 worker 输出不是 JSON：${raw}`, { cause: error });
  }
}

function protocolTraceReport(result, processBefore, processAfter) {
  const protocol = result.protocol || {};
  const sendObserved = Boolean(protocol.screenshotSend);
  const replyObserved = Boolean(protocol.screenshotReply);
  const cleanup = result.cleanup || {};
  const facts = [
    `- classification: \`${result.classification}\``,
    `- diagnosticCompleted: \`${result.diagnosticCompleted}\`; screenshotSucceeded: \`${result.screenshotSucceeded}\``,
    `- screenshot request count recorded by the worker: \`${result.screenshotRequestCount}\``,
    `- parsed protocol messages: \`${protocol.messageCount}\`; parse errors: \`${protocol.parseErrors?.length || 0}\``,
    `- App.captureScreenshot SEND observed: \`${sendObserved}\`; matching RECV observed: \`${replyObserved}\`; UUID: \`${protocol.uuid || 'none'}\``,
    `- cleanup confirmed: \`${cleanup.confirmed}\`; .visual-probe removed: \`${cleanup.probeRemoved}\`; exact residuals after run: \`${processAfter?.exactAutomationResidualCount ?? 'unknown'}\``,
    `- C-drive tool processes before/after: \`${processBefore?.cToolProcessCount ?? 'unknown'} / ${processAfter?.cToolProcessCount ?? 'unknown'}\`; D-drive tool processes before/after: \`${processBefore?.dToolProcessCount ?? 'unknown'} / ${processAfter?.dToolProcessCount ?? 'unknown'}\``,
  ];
  const inferences = [
    '- A SEND line is evidence that the client-side automator protocol logger emitted a request; it is not independent proof that DevTools received the request.',
    replyObserved ? '- The matching UUID RECV line shows a client-observed protocol reply associated with the screenshot request.' : '- No matching UUID RECV line was observed for the screenshot request.',
    result.screenshotSucceeded ? '- A valid PNG was read after the automator call, so the post-processing check succeeded.' : '- The PNG post-processing check did not establish screenshot success.',
  ];
  const unknowns = [
    '- This trace does not identify a DevTools internal cause or change business/runtime code.',
    '- It does not prove a GUI-visible screenshot was rendered unless the protocol and PNG checks both succeed.',
  ];
  return [
    '# Screenshot protocol trace',
    '',
    '## Facts',
    ...facts,
    '',
    '## Inferences',
    ...inferences,
    '',
    '## Unknowns',
    ...unknowns,
    '',
    '## Boundary',
    '',
    '本次只完成 App.captureScreenshot 协议层定位；没有修复、重试或修改业务代码。下一阶段应依据本分类另行决定，不把本次结果扩大解释为应用结论。',
  ].join('\n');
}

async function runTraceScreenshotProtocol() {
  const outputPaths = protocolTraceOutputPaths();
  await fs.mkdir(PROTOCOL_TRACE_ROOT, { recursive: true });
  await removePaths([outputPaths.rawProtocolPath, outputPaths.resultPath, outputPaths.processAfterPath, outputPaths.reportPath, outputPaths.screenshotPath]);
  const startedAt = isoNow();
  const processBefore = await captureProtocolTraceProcessSnapshot();
  const events = [];
  let workerProcess = null;
  let workerResult = null;
  let primaryError = null;
  let totalCleanup = { attempted: false, confirmed: false, probeRemoved: false, verification: null, error: null };
  let processAfter = null;

  try {
    if (processBefore.dToolProcessCount > 0) {
      throw new Error(`D盘 DevTools 进程在协议实验前运行，按规则停止且不终止：${json(processBefore.dProcesses)}`);
    }
    if (!(await exists(C_STABLE_CLI_PATH))) throw new Error(`C盘 Stable CLI 不存在：${C_STABLE_CLI_PATH}`);
    if (!(await exists(C_STABLE_NODE_PATH))) throw new Error(`C盘 Stable 内置 Node 不存在：${C_STABLE_NODE_PATH}`);
    await prepareMinimalProbeProject(C_STABLE_CLI_PATH);
    workerProcess = await runCapturedProcess(
      C_STABLE_NODE_PATH,
      [fileURLToPath(import.meta.url), '--trace-screenshot-protocol-worker'],
      'C盘 Stable 内置 Node 单次 screenshot 协议定位',
      180_000,
      { env: { ...process.env, DEBUG: 'automator:protocol', DEBUG_COLORS: '0' } },
    );
    if (workerProcess.type !== 'exit' || workerProcess.code !== 0) throw formatCliExit(workerProcess, null);
    workerResult = parseProtocolTraceWorkerOutput(workerProcess.stdout);
  } catch (error) {
    primaryError = error;
  } finally {
    const knownPorts = workerResult?.port ? [workerResult.port] : [];
    if (await exists(PROBE_ROOT)) {
      totalCleanup.attempted = true;
      try {
        const cleared = await clearStaleAutomationProject(PROBE_ROOT, C_STABLE_CLI_PATH, events);
        const verification = cleared.verification;
        if (verification?.confirmed === true) await fs.rm(PROBE_ROOT, { recursive: true, force: true });
        totalCleanup = {
          attempted: true,
          confirmed: verification?.confirmed === true,
          probeRemoved: !(await exists(PROBE_ROOT)),
          verification,
          before: cleared.before,
          termination: cleared.termination,
          error: cleared.closeError,
        };
      } catch (error) {
        totalCleanup = {
          attempted: true,
          confirmed: false,
          probeRemoved: !(await exists(PROBE_ROOT)),
          verification: null,
          error: serializeError(error),
        };
      }
    } else {
      totalCleanup = { attempted: false, confirmed: true, probeRemoved: true, verification: null, error: null };
    }
    try {
      processAfter = await captureProtocolTraceProcessSnapshot({ ports: knownPorts });
    } catch (error) {
      processAfter = { schemaVersion: 1, capturedAt: isoNow(), error: serializeError(error), exactAutomationResidualCount: null };
    }
  }

  const rawWorkerStdout = workerProcess?.stdout || '';
  const rawWorkerStderr = workerProcess?.stderr || '';
  const parsedProtocol = parseProtocolDebugOutput(rawWorkerStderr);
  const association = associateScreenshotProtocol(parsedProtocol.messages);
  const traceInconclusive = parsedProtocol.messages.length === 0
    || parsedProtocol.parseErrors.length > 0
    || workerResult?.screenshotRequestCount !== 1
    || processAfter?.exactAutomationResidualCount !== 0;
  const cleanupConfirmed = totalCleanup.confirmed === true
    && totalCleanup.probeRemoved === true
    && processAfter?.exactAutomationResidualCount === 0;
  const classification = classifyScreenshotProtocolTrace({
    screenshotSend: association.screenshotSend,
    screenshotReply: association.screenshotReply,
    screenshotPostprocessOk: workerResult?.screenshotPostprocessOk === true,
    cleanupConfirmed,
    traceInconclusive,
  });
  const screenshotSucceeded = classification === 'screenshot-success';
  const diagnosticCompleted = Boolean(
    workerResult
    && cleanupConfirmed
    && classification !== 'trace-inconclusive'
    && Array.isArray(workerResult.stages)
    && workerResult.stages.some((stage) => stage.name === 'cleanup' && stage.ok === true),
  );
  const result = {
    schemaVersion: 1,
    stage: 'trace-screenshot-protocol',
    command: 'npm run evidence:visual -- --trace-screenshot-protocol',
    startedAt,
    finishedAt: isoNow(),
    fixedRuntime: { cliPath: C_STABLE_CLI_PATH, nodeExecutable: C_STABLE_NODE_PATH },
    project: { kind: 'minimal', path: relativePath(PROBE_ROOT), appid: QA_APP_ID, pagePath: '/pages/index/index', copiedBusinessCode: false },
    screenshotRequestCount: workerResult?.screenshotRequestCount || 0,
    diagnosticCompleted,
    screenshotSucceeded,
    classification,
    stages: workerResult?.stages || [],
    screenshot: workerResult?.screenshot || { ok: false, path: null, width: 0, height: 0, byteLength: 0, sha256: null, error: primaryError ? serializeError(primaryError) : null },
    protocol: {
      messageCount: parsedProtocol.messages.length,
      parseErrors: parsedProtocol.parseErrors.map((entry) => ({ direction: entry.direction, error: entry.error })),
      messages: parsedProtocol.messages.map(sanitizeProtocolRecord),
      uuid: association.uuid,
      screenshotSendCount: association.screenshotSendCount,
      screenshotReplyCount: association.screenshotReplyCount,
      screenshotSend: sanitizeProtocolRecord(association.screenshotSend),
      screenshotReply: sanitizeProtocolRecord(association.screenshotReply),
    },
    cleanup: totalCleanup,
    workerProcess: workerProcess ? {
      type: workerProcess.type,
      code: workerProcess.code ?? null,
      signal: workerProcess.signal ?? null,
      stdoutLength: Buffer.byteLength(rawWorkerStdout, 'utf8'),
      stderrLength: Buffer.byteLength(rawWorkerStderr, 'utf8'),
      stdoutSha256: sha256Bytes(Buffer.from(rawWorkerStdout, 'utf8')),
      stderrSha256: sha256Bytes(Buffer.from(rawWorkerStderr, 'utf8')),
    } : null,
    error: primaryError ? serializeError(primaryError) : workerResult?.error || null,
    processBefore,
    processAfter,
  };
  try {
    validateProtocolTraceResult(result);
    result.validation = { valid: true };
  } catch (error) {
    result.validation = { valid: false, error: serializeError(error) };
  }
  const rawCliOutput = workerResult?.cliOutputRaw || { stdout: '', stderr: '' };
  const rawLog = [
    '=== worker stdout (raw) ===',
    rawWorkerStdout,
    '=== worker stderr (raw; DEBUG=automator:protocol) ===',
    rawWorkerStderr,
    '=== worker CLI stdout (raw captured) ===',
    rawCliOutput.stdout || '',
    '=== worker CLI stderr (raw captured) ===',
    rawCliOutput.stderr || '',
    '=== parsed protocol messages (sanitized view) ===',
    parsedProtocol.messages.map((message) => json(sanitizeProtocolRecord(message))).join('\n'),
  ].join('\n');
  await writeAtomicText(outputPaths.rawProtocolPath, rawLog);
  await writeAtomicText(outputPaths.resultPath, json(result));
  await writeAtomicText(outputPaths.processAfterPath, json(processAfter));
  await writeAtomicText(outputPaths.reportPath, protocolTraceReport(result, processBefore, processAfter));
  if (primaryError && !workerResult) throw primaryError;
  return result;
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
  await withSessionTimeout(
    () => new Promise((resolve) => setTimeout(resolve, 1_500)),
    `wait stable ${label}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: true, deadline },
  );
  const pageState = await withSessionTimeout(
    () => evaluateCurrentPageInstance(session.miniProgram, 'read', 'scroll-view'),
    `current page instance ${label}`,
    AUTOMATOR_TIMEOUT_MS,
    { retryable: true, deadline },
  );
  if (route) assert.equal(pageState.path, route.slice(1), `${label} 当前路由必须是 ${route}`);
  let expandedState = null;
  if (fixture.captureMode === 'expanded') {
    expandedState = await withSessionTimeout(
      () => enterExpandedLedgerForEvidence(session.miniProgram),
      `expand ledger ${label}`,
      AUTOMATOR_TIMEOUT_MS,
      { retryable: true, deadline },
    );
  }
  const scrollReset = await withSessionTimeout(
    () => resetPageScrollForEvidence(session.miniProgram, 'scroll-view', { resetLedger: fixture.captureMode === 'expanded' }),
    `reset scroll ${label}`,
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
    captureMode: fixture.captureMode || 'overview',
    expandedState,
    scrollReset,
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
      if (closeResult?.confirmed === false) {
        const cleanupFailure = new Error(`${fixture.name} session close was not confirmed`);
        cleanupFailure.sessionCleanup = closeResult;
        throw cleanupFailure;
      }
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

async function cleanScreenshotDiagnosticOutputs(paths = screenshotDiagnosticOutputPaths()) {
  await fs.mkdir(path.dirname(paths.resultPath), { recursive: true });
  await removePaths([paths.resultPath, paths.logPath]);
  const entries = await fs.readdir(path.dirname(paths.resultPath), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(SCREENSHOT_DIAGNOSTIC_PREFIX) && entry.name.endsWith('.png')) {
      await fs.rm(path.join(path.dirname(paths.resultPath), entry.name), { force: true });
    }
  }
}

function screenshotDiagnosticLogLines(result) {
  const lines = [{
    at: result.startedAt,
    kind: 'diagnostic-run',
    project: result.project,
    decision: result.decision,
  }];
  for (const run of result.nodeRuns || []) {
    lines.push({ at: run.startedAt, kind: 'node-run', node: run.node });
    for (const session of run.sessions || []) {
      lines.push({
        at: session.startedAt,
        kind: 'session',
        node: run.node.label,
        session: session.session,
        port: session.port,
        ok: session.ok,
        error: session.error,
      });
      for (const stage of session.stages || []) {
        lines.push({
          at: stage.startedAt,
          kind: 'stage',
          node: run.node.label,
          session: session.session,
          stage: stage.name,
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt,
          attempted: stage.attempted,
          ok: stage.ok,
          result: stage.result || null,
          error: stage.error || null,
        });
      }
      for (const event of session.events || []) lines.push({ kind: 'runtime-event', node: run.node.label, session: session.session, event });
    }
  }
  lines.push({ kind: 'probe-project-cleanup', cleanup: result.probeProjectCleanup || null });
  if (result.errors?.length) lines.push({ kind: 'diagnostic-errors', errors: result.errors });
  return lines.map((line) => json(line)).join('\n');
}

function parseDiagnosticWorkerOutput(stdout, nodeLabel) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  const raw = lines.at(-1);
  if (!raw) throw new Error(`Stable Node ${nodeLabel} 探针没有结构化输出`);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Stable Node ${nodeLabel} 探针输出不是 JSON：${raw}`, { cause: error });
  }
}

async function runScreenshotDiagnosticWorker(nodeLabel = 'stable') {
  const cliPath = await findStableCli();
  return runMinimalProbeSessions({ cliPath, nodeLabel, nodeExecutable: process.execPath });
}

async function runScreenshotDiagnostic() {
  const outputPaths = screenshotDiagnosticOutputPaths();
  await cleanScreenshotDiagnosticOutputs(outputPaths);
  const startedAt = isoNow();
  const nodeRuns = [];
  const errors = [];
  let cliPath = null;
  let projectPrepared = false;
  let result;
  try {
    cliPath = await findStableCli();
    await prepareMinimalProbeProject(cliPath);
    projectPrepared = true;
    nodeRuns.push(await runMinimalProbeSessions({
      cliPath,
      nodeLabel: 'system',
      nodeExecutable: process.execPath,
    }));

    let decision = decideScreenshotDiagnostic({ nodeRuns });
    if (!decision.continueCurrentProject) {
      const stableNode = await findStableNode();
      await prepareMinimalProbeProject(cliPath);
      const child = await runCapturedProcess(
        stableNode,
        [fileURLToPath(import.meta.url), '--screenshot-diagnostic-worker', 'stable'],
        'stable Node minimal screenshot probe',
        180_000,
      );
      if (child.type !== 'exit' || child.code !== 0) {
        throw formatCliExit(child, 0);
      }
      nodeRuns.push(parseDiagnosticWorkerOutput(child.stdout, 'stable'));
      decision = decideScreenshotDiagnostic({ nodeRuns });
    }
    result = {
      schemaVersion: 1,
      startedAt,
      finishedAt: null,
      project: {
        kind: 'minimal',
        path: relativePath(PROBE_ROOT),
        appid: QA_APP_ID,
        pagePath: '/pages/index/index',
        copiedBusinessCode: false,
      },
      cliPath,
      nodeRuns,
      decision,
      errors,
      probeProjectCleanup: null,
    };
  } catch (error) {
    errors.push({ stage: 'diagnostic-run', error: serializeError(error) });
    result = {
      schemaVersion: 1,
      startedAt,
      finishedAt: null,
      project: { kind: 'minimal', path: relativePath(PROBE_ROOT), appid: QA_APP_ID, pagePath: '/pages/index/index', copiedBusinessCode: false },
      cliPath,
      nodeRuns,
      decision: decideScreenshotDiagnostic({ nodeRuns }),
      errors,
      probeProjectCleanup: null,
    };
  }

  let probeProjectCleanup;
  if (cliPath && (projectPrepared || await exists(PROBE_ROOT))) {
    try {
      probeProjectCleanup = await clearStaleAutomationProject(PROBE_ROOT, cliPath);
      if (probeProjectCleanup.verification?.confirmed === true) {
        await fs.rm(PROBE_ROOT, { recursive: true, force: true });
        probeProjectCleanup.removed = true;
      } else {
        probeProjectCleanup.removed = false;
      }
    } catch (error) {
      probeProjectCleanup = { removed: false, error: serializeError(error) };
    }
  } else {
    probeProjectCleanup = { removed: false, error: { name: 'NotPrepared', message: 'minimal probe project was not prepared', stack: null } };
  }

  result.probeProjectCleanup = probeProjectCleanup;
  result.finishedAt = isoNow();
  try {
    validateScreenshotDiagnosticResult(result);
    result.validation = { ok: true };
  } catch (error) {
    result.validation = { ok: false, error: serializeError(error) };
    result.errors.push({ stage: 'validate-diagnostic-result', error: serializeError(error) });
  }
  await writeAtomicText(outputPaths.resultPath, json(result));
  await writeAtomicText(outputPaths.logPath, screenshotDiagnosticLogLines(result));
  return result;
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
  if (args.has('--trace-screenshot-protocol-worker')) {
    console.log(json(await runTraceScreenshotProtocolWorker()));
    return;
  }
  if (args.has('--trace-screenshot-protocol')) {
    console.log(json(await runTraceScreenshotProtocol()));
    return;
  }
  if (args.has('--stable-single-instance-worker')) {
    console.log(json(await runStableSingleInstanceWorker()));
    return;
  }
  if (args.has('--stable-single-instance-diagnostic')) {
    console.log(json(await runStableSingleInstanceDiagnostic()));
    return;
  }
  if (args.has('--screenshot-diagnostic-worker')) {
    const nodeLabel = process.argv[process.argv.indexOf('--screenshot-diagnostic-worker') + 1] || 'stable';
    console.log(json(await runScreenshotDiagnosticWorker(nodeLabel)));
    return;
  }
  if (args.has('--screenshot-diagnostic')) {
    console.log(json(await runScreenshotDiagnostic()));
    return;
  }
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
  main().then(() => {
    process.exit(0);
  }).catch(async (error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

export {
  C_STABLE_CLI_PATH,
  C_STABLE_NODE_PATH,
  DIAGNOSTIC_ROOT,
  FIXTURE_NAMES,
  HOME_ROUTE,
  PROTOCOL_TRACE_ROOT,
  PROBE_ROOT,
  QA_APP_ID,
  SCREENSHOT_TIMEOUT_MS,
  abortQaSession,
  cleanupQaRuntime,
  classifyConsoleEvent,
  classifyScreenshotProtocolTrace,
  associateScreenshotProtocol,
  captureFixtureOnce,
  canStartNextStableSingleInstanceSession,
  decideScreenshotDiagnostic,
  decideStableSingleInstance,
  invalidFixture,
  makeFixture,
  pngInfo,
  parseProtocolDebugLine,
  parseProtocolDebugOutput,
  protectedHashRecords,
  roundTrip,
  buildCliArguments,
  buildCliCommand,
  captureScreenshotWithRetries,
  completeCompatibilityRun,
  completeVisualEvidenceRun,
  formatCliExit,
  enterExpandedLedgerForEvidence,
  evaluateCurrentPageInstance,
  runScreenshotDiagnostic,
  runStableSingleInstanceDiagnostic,
  stableSingleInstanceConfig,
  stableSingleInstanceOutputPaths,
  runFixtureWithFreshSession,
  runFixturesWithFreshSessions,
  resetPageScrollForEvidence,
  redactProtocolPayload,
  screenshotDiagnosticOutputPaths,
  switchToHomeTab,
  validateScreenshotDiagnosticResult,
  validateProtocolTraceResult,
  verifyQaCleanup,
  writeAndReadFixture,
};
