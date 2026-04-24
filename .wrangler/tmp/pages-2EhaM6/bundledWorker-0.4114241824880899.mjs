var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn2 = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn2, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// ../node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn2) {
    return fn2;
  }
  runInAsyncScope(fn2, thisArg, ...args) {
    return fn2.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// ../node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// ../node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// ../node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// ../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// ../node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// _worker.js
var Yr = Object.defineProperty;
var qt = /* @__PURE__ */ __name((e) => {
  throw TypeError(e);
}, "qt");
var Vr = /* @__PURE__ */ __name((e, t, r) => t in e ? Yr(e, t, { enumerable: true, configurable: true, writable: true, value: r }) : e[t] = r, "Vr");
var _ = /* @__PURE__ */ __name((e, t, r) => Vr(e, typeof t != "symbol" ? t + "" : t, r), "_");
var vt = /* @__PURE__ */ __name((e, t, r) => t.has(e) || qt("Cannot " + r), "vt");
var d = /* @__PURE__ */ __name((e, t, r) => (vt(e, t, "read from private field"), r ? r.call(e) : t.get(e)), "d");
var w = /* @__PURE__ */ __name((e, t, r) => t.has(e) ? qt("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, r), "w");
var E = /* @__PURE__ */ __name((e, t, r, n) => (vt(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r), "E");
var S = /* @__PURE__ */ __name((e, t, r) => (vt(e, t, "access private method"), r), "S");
var Ht = /* @__PURE__ */ __name((e, t, r, n) => ({ set _(s) {
  E(e, t, s, r);
}, get _() {
  return d(e, t, n);
} }), "Ht");
var Bt = /* @__PURE__ */ __name((e, t, r) => (n, s) => {
  let i = -1;
  return a(0);
  async function a(o) {
    if (o <= i) throw new Error("next() called multiple times");
    i = o;
    let c, l = false, f;
    if (e[o] ? (f = e[o][0][0], n.req.routeIndex = o) : f = o === e.length && s || void 0, f) try {
      c = await f(n, () => a(o + 1));
    } catch (h) {
      if (h instanceof Error && t) n.error = h, c = await t(h, n), l = true;
      else throw h;
    }
    else n.finalized === false && r && (c = await r(n));
    return c && (n.finalized === false || l) && (n.res = c), n;
  }
  __name(a, "a");
}, "Bt");
var Gr = /* @__PURE__ */ Symbol();
var Xr = /* @__PURE__ */ __name(async (e, t = /* @__PURE__ */ Object.create(null)) => {
  const { all: r = false, dot: n = false } = t, i = (e instanceof yr ? e.raw.headers : e.headers).get("Content-Type");
  return i != null && i.startsWith("multipart/form-data") || i != null && i.startsWith("application/x-www-form-urlencoded") ? Jr(e, { all: r, dot: n }) : {};
}, "Xr");
async function Jr(e, t) {
  const r = await e.formData();
  return r ? Zr(r, t) : {};
}
__name(Jr, "Jr");
function Zr(e, t) {
  const r = /* @__PURE__ */ Object.create(null);
  return e.forEach((n, s) => {
    t.all || s.endsWith("[]") ? Qr(r, s, n) : r[s] = n;
  }), t.dot && Object.entries(r).forEach(([n, s]) => {
    n.includes(".") && (en(r, n, s), delete r[n]);
  }), r;
}
__name(Zr, "Zr");
var Qr = /* @__PURE__ */ __name((e, t, r) => {
  e[t] !== void 0 ? Array.isArray(e[t]) ? e[t].push(r) : e[t] = [e[t], r] : t.endsWith("[]") ? e[t] = [r] : e[t] = r;
}, "Qr");
var en = /* @__PURE__ */ __name((e, t, r) => {
  if (/(?:^|\.)__proto__\./.test(t)) return;
  let n = e;
  const s = t.split(".");
  s.forEach((i, a) => {
    a === s.length - 1 ? n[i] = r : ((!n[i] || typeof n[i] != "object" || Array.isArray(n[i]) || n[i] instanceof File) && (n[i] = /* @__PURE__ */ Object.create(null)), n = n[i]);
  });
}, "en");
var hr = /* @__PURE__ */ __name((e) => {
  const t = e.split("/");
  return t[0] === "" && t.shift(), t;
}, "hr");
var tn = /* @__PURE__ */ __name((e) => {
  const { groups: t, path: r } = rn(e), n = hr(r);
  return nn(n, t);
}, "tn");
var rn = /* @__PURE__ */ __name((e) => {
  const t = [];
  return e = e.replace(/\{[^}]+\}/g, (r, n) => {
    const s = `@${n}`;
    return t.push([s, r]), s;
  }), { groups: t, path: e };
}, "rn");
var nn = /* @__PURE__ */ __name((e, t) => {
  for (let r = t.length - 1; r >= 0; r--) {
    const [n] = t[r];
    for (let s = e.length - 1; s >= 0; s--) if (e[s].includes(n)) {
      e[s] = e[s].replace(n, t[r][1]);
      break;
    }
  }
  return e;
}, "nn");
var et = {};
var sn = /* @__PURE__ */ __name((e, t) => {
  if (e === "*") return "*";
  const r = e.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (r) {
    const n = `${e}#${t}`;
    return et[n] || (r[2] ? et[n] = t && t[0] !== ":" && t[0] !== "*" ? [n, r[1], new RegExp(`^${r[2]}(?=/${t})`)] : [e, r[1], new RegExp(`^${r[2]}$`)] : et[n] = [e, r[1], true]), et[n];
  }
  return null;
}, "sn");
var Ct = /* @__PURE__ */ __name((e, t) => {
  try {
    return t(e);
  } catch {
    return e.replace(/(?:%[0-9A-Fa-f]{2})+/g, (r) => {
      try {
        return t(r);
      } catch {
        return r;
      }
    });
  }
}, "Ct");
var an = /* @__PURE__ */ __name((e) => Ct(e, decodeURI), "an");
var pr = /* @__PURE__ */ __name((e) => {
  const t = e.url, r = t.indexOf("/", t.indexOf(":") + 4);
  let n = r;
  for (; n < t.length; n++) {
    const s = t.charCodeAt(n);
    if (s === 37) {
      const i = t.indexOf("?", n), a = t.indexOf("#", n), o = i === -1 ? a === -1 ? void 0 : a : a === -1 ? i : Math.min(i, a), c = t.slice(r, o);
      return an(c.includes("%25") ? c.replace(/%25/g, "%2525") : c);
    } else if (s === 63 || s === 35) break;
  }
  return t.slice(r, n);
}, "pr");
var on2 = /* @__PURE__ */ __name((e) => {
  const t = pr(e);
  return t.length > 1 && t.at(-1) === "/" ? t.slice(0, -1) : t;
}, "on");
var _e = /* @__PURE__ */ __name((e, t, ...r) => (r.length && (t = _e(t, ...r)), `${(e == null ? void 0 : e[0]) === "/" ? "" : "/"}${e}${t === "/" ? "" : `${(e == null ? void 0 : e.at(-1)) === "/" ? "" : "/"}${(t == null ? void 0 : t[0]) === "/" ? t.slice(1) : t}`}`), "_e");
var mr = /* @__PURE__ */ __name((e) => {
  if (e.charCodeAt(e.length - 1) !== 63 || !e.includes(":")) return null;
  const t = e.split("/"), r = [];
  let n = "";
  return t.forEach((s) => {
    if (s !== "" && !/\:/.test(s)) n += "/" + s;
    else if (/\:/.test(s)) if (/\?/.test(s)) {
      r.length === 0 && n === "" ? r.push("/") : r.push(n);
      const i = s.replace("?", "");
      n += "/" + i, r.push(n);
    } else n += "/" + s;
  }), r.filter((s, i, a) => a.indexOf(s) === i);
}, "mr");
var gt = /* @__PURE__ */ __name((e) => /[%+]/.test(e) ? (e.indexOf("+") !== -1 && (e = e.replace(/\+/g, " ")), e.indexOf("%") !== -1 ? Ct(e, gr) : e) : e, "gt");
var vr = /* @__PURE__ */ __name((e, t, r) => {
  let n;
  if (!r && t && !/[%+]/.test(t)) {
    let a = e.indexOf("?", 8);
    if (a === -1) return;
    for (e.startsWith(t, a + 1) || (a = e.indexOf(`&${t}`, a + 1)); a !== -1; ) {
      const o = e.charCodeAt(a + t.length + 1);
      if (o === 61) {
        const c = a + t.length + 2, l = e.indexOf("&", c);
        return gt(e.slice(c, l === -1 ? void 0 : l));
      } else if (o == 38 || isNaN(o)) return "";
      a = e.indexOf(`&${t}`, a + 1);
    }
    if (n = /[%+]/.test(e), !n) return;
  }
  const s = {};
  n ?? (n = /[%+]/.test(e));
  let i = e.indexOf("?", 8);
  for (; i !== -1; ) {
    const a = e.indexOf("&", i + 1);
    let o = e.indexOf("=", i);
    o > a && a !== -1 && (o = -1);
    let c = e.slice(i + 1, o === -1 ? a === -1 ? void 0 : a : o);
    if (n && (c = gt(c)), i = a, c === "") continue;
    let l;
    o === -1 ? l = "" : (l = e.slice(o + 1, a === -1 ? void 0 : a), n && (l = gt(l))), r ? (s[c] && Array.isArray(s[c]) || (s[c] = []), s[c].push(l)) : s[c] ?? (s[c] = l);
  }
  return t ? s[t] : s;
}, "vr");
var cn = vr;
var ln = /* @__PURE__ */ __name((e, t) => vr(e, t, true), "ln");
var gr = decodeURIComponent;
var Ut = /* @__PURE__ */ __name((e) => Ct(e, gr), "Ut");
var xe;
var $;
var Z;
var _r;
var Er;
var Ot;
var Q;
var or;
var yr = (or = class {
  static {
    __name(this, "or");
  }
  constructor(e, t = "/", r = [[]]) {
    w(this, Z);
    _(this, "raw");
    w(this, xe);
    w(this, $);
    _(this, "routeIndex", 0);
    _(this, "path");
    _(this, "bodyCache", {});
    w(this, Q, (e2) => {
      const { bodyCache: t2, raw: r2 } = this, n = t2[e2];
      if (n) return n;
      const s = Object.keys(t2)[0];
      return s ? t2[s].then((i) => (s === "json" && (i = JSON.stringify(i)), new Response(i)[e2]())) : t2[e2] = r2[e2]();
    });
    this.raw = e, this.path = t, E(this, $, r), E(this, xe, {});
  }
  param(e) {
    return e ? S(this, Z, _r).call(this, e) : S(this, Z, Er).call(this);
  }
  query(e) {
    return cn(this.url, e);
  }
  queries(e) {
    return ln(this.url, e);
  }
  header(e) {
    if (e) return this.raw.headers.get(e) ?? void 0;
    const t = {};
    return this.raw.headers.forEach((r, n) => {
      t[n] = r;
    }), t;
  }
  async parseBody(e) {
    var t;
    return (t = this.bodyCache).parsedBody ?? (t.parsedBody = await Xr(this, e));
  }
  json() {
    return d(this, Q).call(this, "text").then((e) => JSON.parse(e));
  }
  text() {
    return d(this, Q).call(this, "text");
  }
  arrayBuffer() {
    return d(this, Q).call(this, "arrayBuffer");
  }
  blob() {
    return d(this, Q).call(this, "blob");
  }
  formData() {
    return d(this, Q).call(this, "formData");
  }
  addValidatedData(e, t) {
    d(this, xe)[e] = t;
  }
  valid(e) {
    return d(this, xe)[e];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [Gr]() {
    return d(this, $);
  }
  get matchedRoutes() {
    return d(this, $)[0].map(([[, e]]) => e);
  }
  get routePath() {
    return d(this, $)[0].map(([[, e]]) => e)[this.routeIndex].path;
  }
}, xe = /* @__PURE__ */ new WeakMap(), $ = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakSet(), _r = /* @__PURE__ */ __name(function(e) {
  const t = d(this, $)[0][this.routeIndex][1][e], r = S(this, Z, Ot).call(this, t);
  return r && /\%/.test(r) ? Ut(r) : r;
}, "_r"), Er = /* @__PURE__ */ __name(function() {
  const e = {}, t = Object.keys(d(this, $)[0][this.routeIndex][1]);
  for (const r of t) {
    const n = S(this, Z, Ot).call(this, d(this, $)[0][this.routeIndex][1][r]);
    n !== void 0 && (e[r] = /\%/.test(n) ? Ut(n) : n);
  }
  return e;
}, "Er"), Ot = /* @__PURE__ */ __name(function(e) {
  return d(this, $)[1] ? d(this, $)[1][e] : e;
}, "Ot"), Q = /* @__PURE__ */ new WeakMap(), or);
var we = { Stringify: 1, BeforeStream: 2, Stream: 3 };
var P = /* @__PURE__ */ __name((e, t) => {
  const r = new String(e);
  return r.isEscaped = true, r.callbacks = t, r;
}, "P");
var un = /[&<>'"]/;
var br = /* @__PURE__ */ __name(async (e, t) => {
  let r = "";
  t || (t = []);
  const n = await Promise.all(e);
  for (let s = n.length - 1; r += n[s], s--, !(s < 0); s--) {
    let i = n[s];
    typeof i == "object" && t.push(...i.callbacks || []);
    const a = i.isEscaped;
    if (i = await (typeof i == "object" ? i.toString() : i), typeof i == "object" && t.push(...i.callbacks || []), i.isEscaped ?? a) r += i;
    else {
      const o = [r];
      ie(i, o), r = o[0];
    }
  }
  return P(r, t);
}, "br");
var ie = /* @__PURE__ */ __name((e, t) => {
  const r = e.search(un);
  if (r === -1) {
    t[0] += e;
    return;
  }
  let n, s, i = 0;
  for (s = r; s < e.length; s++) {
    switch (e.charCodeAt(s)) {
      case 34:
        n = "&quot;";
        break;
      case 39:
        n = "&#39;";
        break;
      case 38:
        n = "&amp;";
        break;
      case 60:
        n = "&lt;";
        break;
      case 62:
        n = "&gt;";
        break;
      default:
        continue;
    }
    t[0] += e.substring(i, s) + n, i = s + 1;
  }
  t[0] += e.substring(i, s);
}, "ie");
var wr = /* @__PURE__ */ __name((e) => {
  const t = e.callbacks;
  if (!(t != null && t.length)) return e;
  const r = [e], n = {};
  return t.forEach((s) => s({ phase: we.Stringify, buffer: r, context: n })), r[0];
}, "wr");
var ct = /* @__PURE__ */ __name(async (e, t, r, n, s) => {
  typeof e == "object" && !(e instanceof String) && (e instanceof Promise || (e = e.toString()), e instanceof Promise && (e = await e));
  const i = e.callbacks;
  if (!(i != null && i.length)) return Promise.resolve(e);
  s ? s[0] += e : s = [e];
  const a = Promise.all(i.map((o) => o({ phase: t, buffer: s, context: n }))).then((o) => Promise.all(o.filter(Boolean).map((c) => ct(c, t, false, n, s))).then(() => s[0]));
  return r ? P(await a, i) : a;
}, "ct");
var fn = "text/plain; charset=UTF-8";
var yt = /* @__PURE__ */ __name((e, t) => ({ "Content-Type": e, ...t }), "yt");
var Ie = /* @__PURE__ */ __name((e, t) => new Response(e, t), "Ie");
var We;
var ze;
var V;
var Re;
var G;
var I;
var Ke;
var Se;
var Oe;
var le;
var Ye;
var Ve;
var ee;
var Ee;
var cr;
var dn = (cr = class {
  static {
    __name(this, "cr");
  }
  constructor(e, t) {
    w(this, ee);
    w(this, We);
    w(this, ze);
    _(this, "env", {});
    w(this, V);
    _(this, "finalized", false);
    _(this, "error");
    w(this, Re);
    w(this, G);
    w(this, I);
    w(this, Ke);
    w(this, Se);
    w(this, Oe);
    w(this, le);
    w(this, Ye);
    w(this, Ve);
    _(this, "render", (...e2) => (d(this, Se) ?? E(this, Se, (t2) => this.html(t2)), d(this, Se).call(this, ...e2)));
    _(this, "setLayout", (e2) => E(this, Ke, e2));
    _(this, "getLayout", () => d(this, Ke));
    _(this, "setRenderer", (e2) => {
      E(this, Se, e2);
    });
    _(this, "header", (e2, t2, r) => {
      this.finalized && E(this, I, Ie(d(this, I).body, d(this, I)));
      const n = d(this, I) ? d(this, I).headers : d(this, le) ?? E(this, le, new Headers());
      t2 === void 0 ? n.delete(e2) : r != null && r.append ? n.append(e2, t2) : n.set(e2, t2);
    });
    _(this, "status", (e2) => {
      E(this, Re, e2);
    });
    _(this, "set", (e2, t2) => {
      d(this, V) ?? E(this, V, /* @__PURE__ */ new Map()), d(this, V).set(e2, t2);
    });
    _(this, "get", (e2) => d(this, V) ? d(this, V).get(e2) : void 0);
    _(this, "newResponse", (...e2) => S(this, ee, Ee).call(this, ...e2));
    _(this, "body", (e2, t2, r) => S(this, ee, Ee).call(this, e2, t2, r));
    _(this, "text", (e2, t2, r) => !d(this, le) && !d(this, Re) && !t2 && !r && !this.finalized ? new Response(e2) : S(this, ee, Ee).call(this, e2, t2, yt(fn, r)));
    _(this, "json", (e2, t2, r) => S(this, ee, Ee).call(this, JSON.stringify(e2), t2, yt("application/json", r)));
    _(this, "html", (e2, t2, r) => {
      const n = /* @__PURE__ */ __name((s) => S(this, ee, Ee).call(this, s, t2, yt("text/html; charset=UTF-8", r)), "n");
      return typeof e2 == "object" ? ct(e2, we.Stringify, false, {}).then(n) : n(e2);
    });
    _(this, "redirect", (e2, t2) => {
      const r = String(e2);
      return this.header("Location", /[^\x00-\xFF]/.test(r) ? encodeURI(r) : r), this.newResponse(null, t2 ?? 302);
    });
    _(this, "notFound", () => (d(this, Oe) ?? E(this, Oe, () => Ie()), d(this, Oe).call(this, this)));
    E(this, We, e), t && (E(this, G, t.executionCtx), this.env = t.env, E(this, Oe, t.notFoundHandler), E(this, Ve, t.path), E(this, Ye, t.matchResult));
  }
  get req() {
    return d(this, ze) ?? E(this, ze, new yr(d(this, We), d(this, Ve), d(this, Ye))), d(this, ze);
  }
  get event() {
    if (d(this, G) && "respondWith" in d(this, G)) return d(this, G);
    throw Error("This context has no FetchEvent");
  }
  get executionCtx() {
    if (d(this, G)) return d(this, G);
    throw Error("This context has no ExecutionContext");
  }
  get res() {
    return d(this, I) || E(this, I, Ie(null, { headers: d(this, le) ?? E(this, le, new Headers()) }));
  }
  set res(e) {
    if (d(this, I) && e) {
      e = Ie(e.body, e);
      for (const [t, r] of d(this, I).headers.entries()) if (t !== "content-type") if (t === "set-cookie") {
        const n = d(this, I).headers.getSetCookie();
        e.headers.delete("set-cookie");
        for (const s of n) e.headers.append("set-cookie", s);
      } else e.headers.set(t, r);
    }
    E(this, I, e), this.finalized = true;
  }
  get var() {
    return d(this, V) ? Object.fromEntries(d(this, V)) : {};
  }
}, We = /* @__PURE__ */ new WeakMap(), ze = /* @__PURE__ */ new WeakMap(), V = /* @__PURE__ */ new WeakMap(), Re = /* @__PURE__ */ new WeakMap(), G = /* @__PURE__ */ new WeakMap(), I = /* @__PURE__ */ new WeakMap(), Ke = /* @__PURE__ */ new WeakMap(), Se = /* @__PURE__ */ new WeakMap(), Oe = /* @__PURE__ */ new WeakMap(), le = /* @__PURE__ */ new WeakMap(), Ye = /* @__PURE__ */ new WeakMap(), Ve = /* @__PURE__ */ new WeakMap(), ee = /* @__PURE__ */ new WeakSet(), Ee = /* @__PURE__ */ __name(function(e, t, r) {
  const n = d(this, I) ? new Headers(d(this, I).headers) : d(this, le) ?? new Headers();
  if (typeof t == "object" && "headers" in t) {
    const i = t.headers instanceof Headers ? t.headers : new Headers(t.headers);
    for (const [a, o] of i) a.toLowerCase() === "set-cookie" ? n.append(a, o) : n.set(a, o);
  }
  if (r) for (const [i, a] of Object.entries(r)) if (typeof a == "string") n.set(i, a);
  else {
    n.delete(i);
    for (const o of a) n.append(i, o);
  }
  const s = typeof t == "number" ? t : (t == null ? void 0 : t.status) ?? d(this, Re);
  return Ie(e, { status: s, headers: n });
}, "Ee"), cr);
var C = "ALL";
var hn = "all";
var pn = ["get", "post", "put", "delete", "options", "patch"];
var xr = "Can not add a route since the matcher is already built.";
var Rr = class extends Error {
  static {
    __name(this, "Rr");
  }
};
var mn = "__COMPOSED_HANDLER";
var vn = /* @__PURE__ */ __name((e) => e.text("404 Not Found", 404), "vn");
var Wt = /* @__PURE__ */ __name((e, t) => {
  if ("getResponse" in e) {
    const r = e.getResponse();
    return t.newResponse(r.body, r);
  }
  return console.error(e), t.text("Internal Server Error", 500);
}, "Wt");
var q;
var D;
var Sr;
var H;
var ae;
var rt;
var nt;
var Te;
var gn = (Te = class {
  static {
    __name(this, "Te");
  }
  constructor(t = {}) {
    w(this, D);
    _(this, "get");
    _(this, "post");
    _(this, "put");
    _(this, "delete");
    _(this, "options");
    _(this, "patch");
    _(this, "all");
    _(this, "on");
    _(this, "use");
    _(this, "router");
    _(this, "getPath");
    _(this, "_basePath", "/");
    w(this, q, "/");
    _(this, "routes", []);
    w(this, H, vn);
    _(this, "errorHandler", Wt);
    _(this, "onError", (t2) => (this.errorHandler = t2, this));
    _(this, "notFound", (t2) => (E(this, H, t2), this));
    _(this, "fetch", (t2, ...r) => S(this, D, nt).call(this, t2, r[1], r[0], t2.method));
    _(this, "request", (t2, r, n2, s2) => t2 instanceof Request ? this.fetch(r ? new Request(t2, r) : t2, n2, s2) : (t2 = t2.toString(), this.fetch(new Request(/^https?:\/\//.test(t2) ? t2 : `http://localhost${_e("/", t2)}`, r), n2, s2)));
    _(this, "fire", () => {
      addEventListener("fetch", (t2) => {
        t2.respondWith(S(this, D, nt).call(this, t2.request, t2, void 0, t2.request.method));
      });
    });
    [...pn, hn].forEach((i) => {
      this[i] = (a, ...o) => (typeof a == "string" ? E(this, q, a) : S(this, D, ae).call(this, i, d(this, q), a), o.forEach((c) => {
        S(this, D, ae).call(this, i, d(this, q), c);
      }), this);
    }), this.on = (i, a, ...o) => {
      for (const c of [a].flat()) {
        E(this, q, c);
        for (const l of [i].flat()) o.map((f) => {
          S(this, D, ae).call(this, l.toUpperCase(), d(this, q), f);
        });
      }
      return this;
    }, this.use = (i, ...a) => (typeof i == "string" ? E(this, q, i) : (E(this, q, "*"), a.unshift(i)), a.forEach((o) => {
      S(this, D, ae).call(this, C, d(this, q), o);
    }), this);
    const { strict: n, ...s } = t;
    Object.assign(this, s), this.getPath = n ?? true ? t.getPath ?? pr : on2;
  }
  route(t, r) {
    const n = this.basePath(t);
    return r.routes.map((s) => {
      var a;
      let i;
      r.errorHandler === Wt ? i = s.handler : (i = /* @__PURE__ */ __name(async (o, c) => (await Bt([], r.errorHandler)(o, () => s.handler(o, c))).res, "i"), i[mn] = s.handler), S(a = n, D, ae).call(a, s.method, s.path, i);
    }), this;
  }
  basePath(t) {
    const r = S(this, D, Sr).call(this);
    return r._basePath = _e(this._basePath, t), r;
  }
  mount(t, r, n) {
    let s, i;
    n && (typeof n == "function" ? i = n : (i = n.optionHandler, n.replaceRequest === false ? s = /* @__PURE__ */ __name((c) => c, "s") : s = n.replaceRequest));
    const a = i ? (c) => {
      const l = i(c);
      return Array.isArray(l) ? l : [l];
    } : (c) => {
      let l;
      try {
        l = c.executionCtx;
      } catch {
      }
      return [c.env, l];
    };
    s || (s = (() => {
      const c = _e(this._basePath, t), l = c === "/" ? 0 : c.length;
      return (f) => {
        const h = new URL(f.url);
        return h.pathname = h.pathname.slice(l) || "/", new Request(h, f);
      };
    })());
    const o = /* @__PURE__ */ __name(async (c, l) => {
      const f = await r(s(c.req.raw), ...a(c));
      if (f) return f;
      await l();
    }, "o");
    return S(this, D, ae).call(this, C, _e(t, "*"), o), this;
  }
}, q = /* @__PURE__ */ new WeakMap(), D = /* @__PURE__ */ new WeakSet(), Sr = /* @__PURE__ */ __name(function() {
  const t = new Te({ router: this.router, getPath: this.getPath });
  return t.errorHandler = this.errorHandler, E(t, H, d(this, H)), t.routes = this.routes, t;
}, "Sr"), H = /* @__PURE__ */ new WeakMap(), ae = /* @__PURE__ */ __name(function(t, r, n) {
  t = t.toUpperCase(), r = _e(this._basePath, r);
  const s = { basePath: this._basePath, path: r, method: t, handler: n };
  this.router.add(t, r, [n, s]), this.routes.push(s);
}, "ae"), rt = /* @__PURE__ */ __name(function(t, r) {
  if (t instanceof Error) return this.errorHandler(t, r);
  throw t;
}, "rt"), nt = /* @__PURE__ */ __name(function(t, r, n, s) {
  if (s === "HEAD") return (async () => new Response(null, await S(this, D, nt).call(this, t, r, n, "GET")))();
  const i = this.getPath(t, { env: n }), a = this.router.match(s, i), o = new dn(t, { path: i, matchResult: a, env: n, executionCtx: r, notFoundHandler: d(this, H) });
  if (a[0].length === 1) {
    let l;
    try {
      l = a[0][0][0][0](o, async () => {
        o.res = await d(this, H).call(this, o);
      });
    } catch (f) {
      return S(this, D, rt).call(this, f, o);
    }
    return l instanceof Promise ? l.then((f) => f || (o.finalized ? o.res : d(this, H).call(this, o))).catch((f) => S(this, D, rt).call(this, f, o)) : l ?? d(this, H).call(this, o);
  }
  const c = Bt(a[0], this.errorHandler, d(this, H));
  return (async () => {
    try {
      const l = await c(o);
      if (!l.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
      return l.res;
    } catch (l) {
      return S(this, D, rt).call(this, l, o);
    }
  })();
}, "nt"), Te);
var Or = [];
function yn(e, t) {
  const r = this.buildAllMatchers(), n = /* @__PURE__ */ __name(((s, i) => {
    const a = r[s] || r[C], o = a[2][i];
    if (o) return o;
    const c = i.match(a[0]);
    if (!c) return [[], Or];
    const l = c.indexOf("", 1);
    return [a[1][l], c];
  }), "n");
  return this.match = n, n(e, t);
}
__name(yn, "yn");
var lt = "[^/]+";
var Fe = ".*";
var qe = "(?:|/.*)";
var be = /* @__PURE__ */ Symbol();
var _n = new Set(".\\+*[^]$()");
function En(e, t) {
  return e.length === 1 ? t.length === 1 ? e < t ? -1 : 1 : -1 : t.length === 1 || e === Fe || e === qe ? 1 : t === Fe || t === qe ? -1 : e === lt ? 1 : t === lt ? -1 : e.length === t.length ? e < t ? -1 : 1 : t.length - e.length;
}
__name(En, "En");
var ue;
var fe;
var B;
var pe;
var bn = (pe = class {
  static {
    __name(this, "pe");
  }
  constructor() {
    w(this, ue);
    w(this, fe);
    w(this, B, /* @__PURE__ */ Object.create(null));
  }
  insert(t, r, n, s, i) {
    if (t.length === 0) {
      if (d(this, ue) !== void 0) throw be;
      if (i) return;
      E(this, ue, r);
      return;
    }
    const [a, ...o] = t, c = a === "*" ? o.length === 0 ? ["", "", Fe] : ["", "", lt] : a === "/*" ? ["", "", qe] : a.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let l;
    if (c) {
      const f = c[1];
      let h = c[2] || lt;
      if (f && c[2] && (h === ".*" || (h = h.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:"), /\((?!\?:)/.test(h)))) throw be;
      if (l = d(this, B)[h], !l) {
        if (Object.keys(d(this, B)).some((u) => u !== Fe && u !== qe)) throw be;
        if (i) return;
        l = d(this, B)[h] = new pe(), f !== "" && E(l, fe, s.varIndex++);
      }
      !i && f !== "" && n.push([f, d(l, fe)]);
    } else if (l = d(this, B)[a], !l) {
      if (Object.keys(d(this, B)).some((f) => f.length > 1 && f !== Fe && f !== qe)) throw be;
      if (i) return;
      l = d(this, B)[a] = new pe();
    }
    l.insert(o, r, n, s, i);
  }
  buildRegExpStr() {
    const r = Object.keys(d(this, B)).sort(En).map((n) => {
      const s = d(this, B)[n];
      return (typeof d(s, fe) == "number" ? `(${n})@${d(s, fe)}` : _n.has(n) ? `\\${n}` : n) + s.buildRegExpStr();
    });
    return typeof d(this, ue) == "number" && r.unshift(`#${d(this, ue)}`), r.length === 0 ? "" : r.length === 1 ? r[0] : "(?:" + r.join("|") + ")";
  }
}, ue = /* @__PURE__ */ new WeakMap(), fe = /* @__PURE__ */ new WeakMap(), B = /* @__PURE__ */ new WeakMap(), pe);
var ht;
var Ge;
var lr;
var wn = (lr = class {
  static {
    __name(this, "lr");
  }
  constructor() {
    w(this, ht, { varIndex: 0 });
    w(this, Ge, new bn());
  }
  insert(e, t, r) {
    const n = [], s = [];
    for (let a = 0; ; ) {
      let o = false;
      if (e = e.replace(/\{[^}]+\}/g, (c) => {
        const l = `@\\${a}`;
        return s[a] = [l, c], a++, o = true, l;
      }), !o) break;
    }
    const i = e.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let a = s.length - 1; a >= 0; a--) {
      const [o] = s[a];
      for (let c = i.length - 1; c >= 0; c--) if (i[c].indexOf(o) !== -1) {
        i[c] = i[c].replace(o, s[a][1]);
        break;
      }
    }
    return d(this, Ge).insert(i, t, n, d(this, ht), r), n;
  }
  buildRegExp() {
    let e = d(this, Ge).buildRegExpStr();
    if (e === "") return [/^$/, [], []];
    let t = 0;
    const r = [], n = [];
    return e = e.replace(/#(\d+)|@(\d+)|\.\*\$/g, (s, i, a) => i !== void 0 ? (r[++t] = Number(i), "$()") : (a !== void 0 && (n[Number(a)] = ++t), "")), [new RegExp(`^${e}`), r, n];
  }
}, ht = /* @__PURE__ */ new WeakMap(), Ge = /* @__PURE__ */ new WeakMap(), lr);
var xn = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var st = /* @__PURE__ */ Object.create(null);
function Tr(e) {
  return st[e] ?? (st[e] = new RegExp(e === "*" ? "" : `^${e.replace(/\/\*$|([.\\+*[^\]$()])/g, (t, r) => r ? `\\${r}` : "(?:|/.*)")}$`));
}
__name(Tr, "Tr");
function Rn() {
  st = /* @__PURE__ */ Object.create(null);
}
__name(Rn, "Rn");
function Sn(e) {
  var l;
  const t = new wn(), r = [];
  if (e.length === 0) return xn;
  const n = e.map((f) => [!/\*|\/:/.test(f[0]), ...f]).sort(([f, h], [u, p]) => f ? 1 : u ? -1 : h.length - p.length), s = /* @__PURE__ */ Object.create(null);
  for (let f = 0, h = -1, u = n.length; f < u; f++) {
    const [p, m, v] = n[f];
    p ? s[m] = [v.map(([y]) => [y, /* @__PURE__ */ Object.create(null)]), Or] : h++;
    let g;
    try {
      g = t.insert(m, h, p);
    } catch (y) {
      throw y === be ? new Rr(m) : y;
    }
    p || (r[h] = v.map(([y, b]) => {
      const k = /* @__PURE__ */ Object.create(null);
      for (b -= 1; b >= 0; b--) {
        const [R, O] = g[b];
        k[R] = O;
      }
      return [y, k];
    }));
  }
  const [i, a, o] = t.buildRegExp();
  for (let f = 0, h = r.length; f < h; f++) for (let u = 0, p = r[f].length; u < p; u++) {
    const m = (l = r[f][u]) == null ? void 0 : l[1];
    if (!m) continue;
    const v = Object.keys(m);
    for (let g = 0, y = v.length; g < y; g++) m[v[g]] = o[m[v[g]]];
  }
  const c = [];
  for (const f in a) c[f] = r[a[f]];
  return [i, c, s];
}
__name(Sn, "Sn");
function ge(e, t) {
  if (e) {
    for (const r of Object.keys(e).sort((n, s) => s.length - n.length)) if (Tr(r).test(t)) return [...e[r]];
  }
}
__name(ge, "ge");
var te;
var re;
var pt;
var Ar;
var ur;
var On = (ur = class {
  static {
    __name(this, "ur");
  }
  constructor() {
    w(this, pt);
    _(this, "name", "RegExpRouter");
    w(this, te);
    w(this, re);
    _(this, "match", yn);
    E(this, te, { [C]: /* @__PURE__ */ Object.create(null) }), E(this, re, { [C]: /* @__PURE__ */ Object.create(null) });
  }
  add(e, t, r) {
    var o;
    const n = d(this, te), s = d(this, re);
    if (!n || !s) throw new Error(xr);
    n[e] || [n, s].forEach((c) => {
      c[e] = /* @__PURE__ */ Object.create(null), Object.keys(c[C]).forEach((l) => {
        c[e][l] = [...c[C][l]];
      });
    }), t === "/*" && (t = "*");
    const i = (t.match(/\/:/g) || []).length;
    if (/\*$/.test(t)) {
      const c = Tr(t);
      e === C ? Object.keys(n).forEach((l) => {
        var f;
        (f = n[l])[t] || (f[t] = ge(n[l], t) || ge(n[C], t) || []);
      }) : (o = n[e])[t] || (o[t] = ge(n[e], t) || ge(n[C], t) || []), Object.keys(n).forEach((l) => {
        (e === C || e === l) && Object.keys(n[l]).forEach((f) => {
          c.test(f) && n[l][f].push([r, i]);
        });
      }), Object.keys(s).forEach((l) => {
        (e === C || e === l) && Object.keys(s[l]).forEach((f) => c.test(f) && s[l][f].push([r, i]));
      });
      return;
    }
    const a = mr(t) || [t];
    for (let c = 0, l = a.length; c < l; c++) {
      const f = a[c];
      Object.keys(s).forEach((h) => {
        var u;
        (e === C || e === h) && ((u = s[h])[f] || (u[f] = [...ge(n[h], f) || ge(n[C], f) || []]), s[h][f].push([r, i - l + c + 1]));
      });
    }
  }
  buildAllMatchers() {
    const e = /* @__PURE__ */ Object.create(null);
    return Object.keys(d(this, re)).concat(Object.keys(d(this, te))).forEach((t) => {
      e[t] || (e[t] = S(this, pt, Ar).call(this, t));
    }), E(this, te, E(this, re, void 0)), Rn(), e;
  }
}, te = /* @__PURE__ */ new WeakMap(), re = /* @__PURE__ */ new WeakMap(), pt = /* @__PURE__ */ new WeakSet(), Ar = /* @__PURE__ */ __name(function(e) {
  const t = [];
  let r = e === C;
  return [d(this, te), d(this, re)].forEach((n) => {
    const s = n[e] ? Object.keys(n[e]).map((i) => [i, n[e][i]]) : [];
    s.length !== 0 ? (r || (r = true), t.push(...s)) : e !== C && t.push(...Object.keys(n[C]).map((i) => [i, n[C][i]]));
  }), r ? Sn(t) : null;
}, "Ar"), ur);
var ne;
var X;
var fr;
var Tn = (fr = class {
  static {
    __name(this, "fr");
  }
  constructor(e) {
    _(this, "name", "SmartRouter");
    w(this, ne, []);
    w(this, X, []);
    E(this, ne, e.routers);
  }
  add(e, t, r) {
    if (!d(this, X)) throw new Error(xr);
    d(this, X).push([e, t, r]);
  }
  match(e, t) {
    if (!d(this, X)) throw new Error("Fatal error");
    const r = d(this, ne), n = d(this, X), s = r.length;
    let i = 0, a;
    for (; i < s; i++) {
      const o = r[i];
      try {
        for (let c = 0, l = n.length; c < l; c++) o.add(...n[c]);
        a = o.match(e, t);
      } catch (c) {
        if (c instanceof Rr) continue;
        throw c;
      }
      this.match = o.match.bind(o), E(this, ne, [o]), E(this, X, void 0);
      break;
    }
    if (i === s) throw new Error("Fatal error");
    return this.name = `SmartRouter + ${this.activeRouter.name}`, a;
  }
  get activeRouter() {
    if (d(this, X) || d(this, ne).length !== 1) throw new Error("No active router has been determined yet.");
    return d(this, ne)[0];
  }
}, ne = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakMap(), fr);
var Pe = /* @__PURE__ */ Object.create(null);
var An = /* @__PURE__ */ __name((e) => {
  for (const t in e) return true;
  return false;
}, "An");
var se;
var L;
var de;
var Ae;
var N;
var J;
var oe;
var ke;
var kn = (ke = class {
  static {
    __name(this, "ke");
  }
  constructor(t, r, n) {
    w(this, J);
    w(this, se);
    w(this, L);
    w(this, de);
    w(this, Ae, 0);
    w(this, N, Pe);
    if (E(this, L, n || /* @__PURE__ */ Object.create(null)), E(this, se, []), t && r) {
      const s = /* @__PURE__ */ Object.create(null);
      s[t] = { handler: r, possibleKeys: [], score: 0 }, E(this, se, [s]);
    }
    E(this, de, []);
  }
  insert(t, r, n) {
    E(this, Ae, ++Ht(this, Ae)._);
    let s = this;
    const i = tn(r), a = [];
    for (let o = 0, c = i.length; o < c; o++) {
      const l = i[o], f = i[o + 1], h = sn(l, f), u = Array.isArray(h) ? h[0] : l;
      if (u in d(s, L)) {
        s = d(s, L)[u], h && a.push(h[1]);
        continue;
      }
      d(s, L)[u] = new ke(), h && (d(s, de).push(h), a.push(h[1])), s = d(s, L)[u];
    }
    return d(s, se).push({ [t]: { handler: n, possibleKeys: a.filter((o, c, l) => l.indexOf(o) === c), score: d(this, Ae) } }), s;
  }
  search(t, r) {
    var f;
    const n = [];
    E(this, N, Pe);
    let i = [this];
    const a = hr(r), o = [], c = a.length;
    let l = null;
    for (let h = 0; h < c; h++) {
      const u = a[h], p = h === c - 1, m = [];
      for (let g = 0, y = i.length; g < y; g++) {
        const b = i[g], k = d(b, L)[u];
        k && (E(k, N, d(b, N)), p ? (d(k, L)["*"] && S(this, J, oe).call(this, n, d(k, L)["*"], t, d(b, N)), S(this, J, oe).call(this, n, k, t, d(b, N))) : m.push(k));
        for (let R = 0, O = d(b, de).length; R < O; R++) {
          const x = d(b, de)[R], T = d(b, N) === Pe ? {} : { ...d(b, N) };
          if (x === "*") {
            const me = d(b, L)["*"];
            me && (S(this, J, oe).call(this, n, me, t, d(b, N)), E(me, N, T), m.push(me));
            continue;
          }
          const [F, U, W] = x;
          if (!u && !(W instanceof RegExp)) continue;
          const K = d(b, L)[F];
          if (W instanceof RegExp) {
            if (l === null) {
              l = new Array(c);
              let ve = r[0] === "/" ? 1 : 0;
              for (let Le = 0; Le < c; Le++) l[Le] = ve, ve += a[Le].length + 1;
            }
            const me = r.substring(l[h]), mt = W.exec(me);
            if (mt) {
              if (T[U] = mt[0], S(this, J, oe).call(this, n, K, t, d(b, N), T), An(d(K, L))) {
                E(K, N, T);
                const ve = ((f = mt[0].match(/\//)) == null ? void 0 : f.length) ?? 0;
                (o[ve] || (o[ve] = [])).push(K);
              }
              continue;
            }
          }
          (W === true || W.test(u)) && (T[U] = u, p ? (S(this, J, oe).call(this, n, K, t, T, d(b, N)), d(K, L)["*"] && S(this, J, oe).call(this, n, d(K, L)["*"], t, T, d(b, N))) : (E(K, N, T), m.push(K)));
        }
      }
      const v = o.shift();
      i = v ? m.concat(v) : m;
    }
    return n.length > 1 && n.sort((h, u) => h.score - u.score), [n.map(({ handler: h, params: u }) => [h, u])];
  }
}, se = /* @__PURE__ */ new WeakMap(), L = /* @__PURE__ */ new WeakMap(), de = /* @__PURE__ */ new WeakMap(), Ae = /* @__PURE__ */ new WeakMap(), N = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakSet(), oe = /* @__PURE__ */ __name(function(t, r, n, s, i) {
  for (let a = 0, o = d(r, se).length; a < o; a++) {
    const c = d(r, se)[a], l = c[n] || c[C], f = {};
    if (l !== void 0 && (l.params = /* @__PURE__ */ Object.create(null), t.push(l), s !== Pe || i && i !== Pe)) for (let h = 0, u = l.possibleKeys.length; h < u; h++) {
      const p = l.possibleKeys[h], m = f[l.score];
      l.params[p] = i != null && i[p] && !m ? i[p] : s[p] ?? (i == null ? void 0 : i[p]), f[l.score] = true;
    }
  }
}, "oe"), ke);
var he;
var dr;
var jn = (dr = class {
  static {
    __name(this, "dr");
  }
  constructor() {
    _(this, "name", "TrieRouter");
    w(this, he);
    E(this, he, new kn());
  }
  add(e, t, r) {
    const n = mr(t);
    if (n) {
      for (let s = 0, i = n.length; s < i; s++) d(this, he).insert(e, n[s], r);
      return;
    }
    d(this, he).insert(e, t, r);
  }
  match(e, t) {
    return d(this, he).search(e, t);
  }
}, he = /* @__PURE__ */ new WeakMap(), dr);
var Dt = class extends gn {
  static {
    __name(this, "Dt");
  }
  constructor(e = {}) {
    super(e), this.router = e.router ?? new Tn({ routers: [new On(), new jn()] });
  }
};
var Cn = /* @__PURE__ */ __name((e) => {
  const r = { ...{ origin: "*", allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"], allowHeaders: [], exposeHeaders: [] }, ...e }, n = /* @__PURE__ */ ((i) => typeof i == "string" ? i === "*" ? () => i : (a) => i === a ? a : null : typeof i == "function" ? i : (a) => i.includes(a) ? a : null)(r.origin), s = ((i) => typeof i == "function" ? i : Array.isArray(i) ? () => i : () => [])(r.allowMethods);
  return async function(a, o) {
    var f;
    function c(h, u) {
      a.res.headers.set(h, u);
    }
    __name(c, "c");
    const l = await n(a.req.header("origin") || "", a);
    if (l && c("Access-Control-Allow-Origin", l), r.credentials && c("Access-Control-Allow-Credentials", "true"), (f = r.exposeHeaders) != null && f.length && c("Access-Control-Expose-Headers", r.exposeHeaders.join(",")), a.req.method === "OPTIONS") {
      r.origin !== "*" && c("Vary", "Origin"), r.maxAge != null && c("Access-Control-Max-Age", r.maxAge.toString());
      const h = await s(a.req.header("origin") || "", a);
      h.length && c("Access-Control-Allow-Methods", h.join(","));
      let u = r.allowHeaders;
      if (!(u != null && u.length)) {
        const p = a.req.header("Access-Control-Request-Headers");
        p && (u = p.split(/\s*,\s*/));
      }
      return u != null && u.length && (c("Access-Control-Allow-Headers", u.join(",")), a.res.headers.append("Vary", "Access-Control-Request-Headers")), a.res.headers.delete("Content-Length"), a.res.headers.delete("Content-Type"), new Response(null, { headers: a.res.headers, status: 204, statusText: "No Content" });
    }
    await o(), r.origin !== "*" && a.header("Vary", "Origin", { append: true });
  };
}, "Cn");
var A = new Dt();
A.use("*", Cn());
function z() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
__name(z, "z");
function Dn(e) {
  const t = (e || "").trim();
  if (!t) return { packQty: 1, packUnit: "Each" };
  const r = "(?:kg|g|lb|lbs|l|ml|oz|fl\\s*oz|gal)", n = t.match(new RegExp(`^([\\d.]+)\\s*[\xD7xX]\\s*([\\d.]+)\\s*(${r})\\b`, "i"));
  if (n) {
    const a = parseFloat(n[1]) || 1, o = parseFloat(n[2]) || 1;
    return { packQty: Math.round(a * o * 1e3) / 1e3, packUnit: n[3].trim() };
  }
  const s = t.match(new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${r})\\b`, "i"));
  if (s) return { packQty: parseFloat(s[2]) || 1, packUnit: s[3].trim() };
  const i = t.match(/^([\d.]+)\s*(.*)$/);
  if (i) {
    const a = parseFloat(i[1]) || 1, o = (i[2] || "Each").trim();
    return { packQty: a, packUnit: o };
  }
  return { packQty: 1, packUnit: t || "Each" };
}
__name(Dn, "Dn");
function Nn(e) {
  const t = e.toLowerCase(), r = [["Linen", ["napkin", "towel", "apron", "cloth", "uniform", "rag", "linen"]], ["Disposables", ["glove", "cup", "plate", "fork", "spoon", "tissue", "straw", "cutlery", "bio cont", "container"]], ["Packaging", ["box", "bag", "wrap", "film", "pail", "jar", "bottle", "packaging"]], ["Non-Alcoholic Beverages", ["juice", "water", "soda", "coffee", "tea", "syrup", "drink", "beverage"]], ["Alcohol", ["wine", "beer", "spirit", "liquor", "vodka", "whiskey", "rum", "gin", "alcohol"]], ["Cleaning & Sanitation", ["cleaner", "sanitizer", "soap", "detergent", "bleach", "disinfectant", "cleaning"]]];
  for (const [n, s] of r) if (s.some((i) => t.includes(i))) return n;
  return "Ingredients";
}
__name(Nn, "Nn");
var De = ["suppliers", "generic_products", "product_entries", "recipes", "recipe_items", "finished_products", "finished_product_items", "inventory", "stock_log", "invoices", "invoice_lines", "staff", "certification_types", "staff_certifications", "product_mappings", "units"];
A.get("/api/tables/:table", async (e) => {
  const t = e.req.param("table");
  if (!De.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const { page: r, limit: n, ...s } = e.req.query(), i = Math.max(1, parseInt(r || "1")), a = Math.min(500, parseInt(n || "500")), o = (i - 1) * a;
  let c = "";
  const l = [], f = Object.entries(s);
  f.length && (c = "WHERE " + f.map(([u]) => `${u} = ?`).join(" AND "), f.forEach(([, u]) => l.push(u)));
  const h = await e.env.DB.prepare(`SELECT * FROM ${t} ${c} ORDER BY rowid DESC LIMIT ? OFFSET ?`).bind(...l, a, o).all();
  return e.json({ data: h.results, total: h.results.length });
});
A.get("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!De.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.env.DB.prepare(`SELECT * FROM ${t} WHERE id = ?`).bind(r).first();
  return n ? e.json(n) : e.json({ error: "Not found" }, 404);
});
var zt = ["units"];
A.post("/api/tables/:table", async (e) => {
  const t = e.req.param("table");
  if (!De.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const r = await e.req.json();
  !r.id && !zt.includes(t) && (r.id = z());
  const n = Object.keys(r), s = Object.values(r), i = await e.env.DB.prepare(`INSERT INTO ${t} (${n.join(",")}) VALUES (${n.map(() => "?").join(",")})`).bind(...s).run(), a = zt.includes(t) ? i.meta.last_row_id : r.id;
  return e.json({ id: a, ...r }, 201);
});
A.put("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!De.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.req.json();
  n.id = r;
  const s = Object.keys(n), i = Object.values(n), a = s.map((o) => `${o} = ?`).join(", ");
  return await e.env.DB.prepare(`UPDATE ${t} SET ${a} WHERE id = ?`).bind(...i, r).run(), e.json({ id: r, ...n });
});
A.patch("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!De.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.req.json(), s = Object.keys(n);
  if (!s.length) return e.json({ error: "No fields to update" }, 400);
  const i = s.map((a) => `${a} = ?`).join(", ");
  return await e.env.DB.prepare(`UPDATE ${t} SET ${i} WHERE id = ?`).bind(...Object.values(n), r).run(), e.json({ id: r, ...n });
});
A.delete("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  return De.includes(t) ? (await e.env.DB.prepare(`DELETE FROM ${t} WHERE id = ?`).bind(r).run(), e.body(null, 204)) : e.json({ error: "Unknown table" }, 400);
});
A.post("/api/upload", async (e) => {
  var i;
  const r = (await e.req.formData()).get("file");
  if (!r) return e.json({ error: "No file provided" }, 400);
  const n = ((i = r.name.split(".").pop()) == null ? void 0 : i.toLowerCase()) || "bin", s = `uploads/${z()}.${n}`;
  return await e.env.FILES.put(s, r.stream(), { httpMetadata: { contentType: r.type || "application/octet-stream" }, customMetadata: { originalName: r.name } }), e.json({ key: s, name: r.name, size: r.size, type: r.type, url: `/api/files/${s}` });
});
A.get("/api/files/:prefix{.+}", async (e) => {
  var i;
  const t = e.req.param("prefix"), r = await e.env.FILES.get(t);
  if (!r) return e.json({ error: "File not found" }, 404);
  const n = new Headers();
  r.writeHttpMetadata(n), n.set("etag", r.httpEtag);
  const s = (i = r.customMetadata) == null ? void 0 : i.originalName;
  return s && n.set("Content-Disposition", `inline; filename="${s}"`), new Response(r.body, { headers: n });
});
A.post("/api/invoice-lines/:invoice_id/replace", async (e) => {
  const t = e.req.param("invoice_id"), r = await e.req.json();
  await e.env.DB.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(t).run();
  for (const n of r.lines || []) {
    const s = z(), i = parseFloat(n.qty) || 0, a = parseFloat(n.price) || 0;
    await e.env.DB.prepare(`INSERT INTO invoice_lines (id, invoice_id, product_name, vendor_item, category, item_code, packaging, price, qty, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(s, t, n.product_name || "", n.vendor_item || "", n.category || "", n.item_code || "", n.packaging || "", a, i, parseFloat(n.line_total) || a * i).run();
  }
  return await e.env.DB.prepare("UPDATE invoices SET tax_pst=?, tax_gst=?, delivery=?, fuel_surcharge=0, deposit=?, credit=?, other_cost=?, other_desc=? WHERE id=?").bind(r.tax_pst ?? 0, r.tax_gst ?? 0, r.delivery ?? 0, r.deposit ?? 0, r.credit ?? 0, r.other_cost ?? 0, r.other_desc ?? "", t).run(), e.json({ saved: (r.lines || []).length });
});
A.get("/api/vendor-fee-template", async (e) => {
  const t = (e.req.query("vendor") || "").trim();
  if (!t) return e.json({ error: "vendor required" }, 400);
  const r = await e.env.DB.prepare("SELECT * FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))").bind(t).first();
  return r ? e.json({ found: true, template: r }) : e.json({ found: false });
});
A.post("/api/vendor-fee-template", async (e) => {
  var s;
  const t = await e.req.json();
  if (!((s = t.vendor_name) != null && s.trim())) return e.json({ error: "vendor_name required" }, 400);
  const r = await e.env.DB.prepare("SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))").bind(t.vendor_name.trim()).first(), n = (/* @__PURE__ */ new Date()).toISOString();
  if (r) return await e.env.DB.prepare(`UPDATE vendor_fee_templates SET
         delivery=?, fuel_surcharge=?, tax_gst=?, tax_pst=?,
         other_cost=?, other_desc=?, use_percent=?, notes=?, updated_at=?
       WHERE id=?`).bind(t.delivery ?? 0, t.fuel_surcharge ?? 0, t.tax_gst ?? 0, t.tax_pst ?? 0, t.other_cost ?? 0, t.other_desc ?? "", t.use_percent ?? 0, t.notes ?? "", n, r.id).run(), e.json({ saved: true, id: r.id, created: false });
  {
    const i = z();
    return await e.env.DB.prepare(`INSERT INTO vendor_fee_templates
         (id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst,
          other_cost, other_desc, use_percent, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(i, t.vendor_name.trim(), t.delivery ?? 0, t.fuel_surcharge ?? 0, t.tax_gst ?? 0, t.tax_pst ?? 0, t.other_cost ?? 0, t.other_desc ?? "", t.use_percent ?? 0, t.notes ?? "", n).run(), e.json({ saved: true, id: i, created: true });
  }
});
A.post("/api/ensure-invoice", async (e) => {
  const t = await e.req.json();
  if (!t.file_key) return e.json({ error: "file_key required" }, 400);
  const r = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), n = await e.env.DB.prepare("SELECT id FROM invoices WHERE file_key = ?").bind(t.file_key).first();
  if (n) return e.json({ id: n.id, created: false });
  const s = z();
  return await e.env.DB.prepare(`INSERT INTO invoices (id, vendor, invoice_number, invoice_date, upload_date, total,
       status, payment_account, file_name, file_key, file_url, notes,
       tax_gst, tax_pst, delivery, fuel_surcharge, deposit, credit, other_cost, other_desc)
     VALUES (?, ?, ?, ?, ?, ?, 'In Processing', 'A/P', ?, ?, ?, '',
             ?, ?, ?, 0, ?, ?, ?, ?)`).bind(s, t.vendor || "", t.invoice_number || "", t.invoice_date || r, r, t.total ?? 0, t.file_name || "", t.file_key, `/api/files/${t.file_key}`, t.tax_gst ?? 0, t.tax_pst ?? 0, t.delivery ?? 0, t.deposit ?? 0, t.credit ?? 0, t.other_cost ?? 0, t.other_desc || "").run(), e.json({ id: s, created: true });
});
A.post("/api/bulk/products", async (e) => {
  const { products: t } = await e.req.json();
  if (!Array.isArray(t)) return e.json({ error: "products array required" }, 400);
  const r = [];
  for (const n of t) {
    n.id || (n.id = z());
    const s = Object.keys(n), i = Object.values(n);
    await e.env.DB.prepare(`INSERT OR REPLACE INTO product_entries (${s.join(",")}) VALUES (${s.map(() => "?").join(",")})`).bind(...i).run(), r.push(n.id);
  }
  return e.json({ saved: r });
});
A.post("/api/bulk/upsert-products", async (e) => {
  const t = await e.req.json();
  if (!Array.isArray(t.products)) return e.json({ error: "products array required" }, 400);
  let r = "", n = "", s = false;
  const i = (t.vendor_name || "").trim();
  if (i) {
    const l = await e.env.DB.prepare("SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))").bind(i).first();
    l ? (r = l.id, n = l.name) : (r = z(), n = i, await e.env.DB.prepare("INSERT INTO suppliers (id, name, contact, email, notes) VALUES (?, ?, '', '', '')").bind(r, i).run(), s = true);
  }
  let a = 0, o = 0, c = 0;
  for (const l of t.products) {
    const f = (l.name || "").trim();
    if (!f) continue;
    const h = await e.env.DB.prepare("SELECT id FROM generic_products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))").bind(f).first();
    let u;
    if (h) u = h.id, c++;
    else {
      u = z();
      const U = (l.category || "").trim(), W = U && U !== "Ingredients" ? U : Nn(f);
      await e.env.DB.prepare(`INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty)
         VALUES (?, ?, ?, ?, ?)`).bind(u, f, W, l.sub_unit_name || "", l.sub_unit_qty ?? null).run(), o++;
    }
    const p = z(), m = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), v = parseFloat(l.cost) || 0, g = parseFloat(l.unit_price) || v, { packQty: y, packUnit: b } = Dn(l.pack_size || ""), O = ["kg", "g", "lb", "lbs", "l", "ml", "oz", "fl oz", "gal"].includes(b.toLowerCase().replace(/\.$/, "")) && y > 1 ? Math.round(g / y * 100) / 100 : g;
    let x = null;
    if (l.expiry_date) {
      const U = new Date(l.expiry_date), W = /* @__PURE__ */ new Date();
      W.setHours(0, 0, 0, 0), x = Math.floor((U.getTime() - W.getTime()) / 864e5);
    }
    const T = l.supplier_id || r, F = l.supplier_name || n;
    await e.env.DB.prepare(`INSERT INTO product_entries
         (id, generic_product_id, generic_product_name, supplier_id, supplier_name,
          vendor_item_name, sku, pack_qty, pack_unit, cost, cost_per_unit,
          purchase_date, expiry_date, days_left, invoice_ref,
          invoice_id, invoice_file_key, invoice_file_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(p, u, f, T, F, l.vendor_item_name || f, l.sku || "", y, b, v, O, l.invoice_date || l.purchase_date || m, l.expiry_date || "", x, l.invoice_ref || "", l.invoice_id || "", l.invoice_file_key || "", l.invoice_file_name || "").run(), a++;
  }
  return e.json({ saved: a, created_generics: o, reused_generics: c, supplier_id: r, supplier_name: n, supplier_created: s });
});
A.get("/api/stats/certifications", async (e) => {
  const t = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), r = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), n = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications").first(), s = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ?").bind(t).first(), i = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ? AND expiry_date <= ?").bind(t, r).first(), a = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date <= ?").bind(t).first(), o = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff").first();
  return e.json({ total: (n == null ? void 0 : n.n) || 0, valid: (s == null ? void 0 : s.n) || 0, expiring: (i == null ? void 0 : i.n) || 0, expired: (a == null ? void 0 : a.n) || 0, staffCount: (o == null ? void 0 : o.n) || 0 });
});
A.get("/api/price-movers", async (e) => {
  const t = (e.req.query("from") || "").trim(), r = (e.req.query("to") || "").trim();
  let n = `
    SELECT pe.generic_product_id AS product_id,
           pe.generic_product_name AS product_name,
           pe.supplier_name,
           pe.purchase_date,
           pe.pack_qty,
           pe.pack_unit,
           pe.cost,
           pe.cost_per_unit,
           pe.invoice_ref
    FROM product_entries pe
    WHERE pe.purchase_date IS NOT NULL AND pe.purchase_date != ''
      AND pe.generic_product_id IS NOT NULL AND pe.generic_product_id != ''
  `;
  const s = [];
  t && (n += " AND pe.purchase_date >= ?", s.push(t)), r && (n += " AND pe.purchase_date <= ?", s.push(r)), n += " ORDER BY pe.purchase_date DESC, pe.created_at DESC";
  const i = await e.env.DB.prepare(n).bind(...s).all(), a = /* @__PURE__ */ new Map();
  for (const c of i.results) {
    const l = String(c.product_id || "");
    if (!l) continue;
    let f = a.get(l);
    f || (f = { product_id: l, product_name: String(c.product_name || ""), unit: String(c.pack_unit || ""), purchases: [] }, a.set(l, f)), f.purchases.push({ date: String(c.purchase_date || ""), vendor: String(c.supplier_name || ""), pack_qty: Number(c.pack_qty || 0), pack_unit: String(c.pack_unit || ""), cost: Number(c.cost || 0), cost_per_unit: Number(c.cost_per_unit || 0), invoice_ref: String(c.invoice_ref || "") });
  }
  const o = Array.from(a.values()).map((c) => {
    const l = c.purchases.slice(0, 10);
    let f = null;
    if (l.length >= 2) {
      const h = l[0].cost_per_unit, u = l[1].cost_per_unit;
      u > 0 && (f = Math.round((h - u) / u * 1e3) / 10);
    }
    return { product_id: c.product_id, product_name: c.product_name, unit: c.unit, purchase_count: c.purchases.length, pct_change: f, purchases: l };
  });
  return o.sort((c, l) => {
    const f = c.pct_change === null ? -1 : Math.abs(c.pct_change);
    return (l.pct_change === null ? -1 : Math.abs(l.pct_change)) - f;
  }), e.json({ data: o });
});
A.get("/api/ai/status", async (e) => {
  const t = !!e.env.OPENAI_API_KEY;
  return e.json({ configured: t });
});
A.get("/api/ai/azure-status", async (e) => {
  const t = !!e.env.AZURE_DOC_INTEL_KEY, r = !!e.env.AZURE_DOC_INTEL_ENDPOINT;
  return e.json({ configured: t && r });
});
A.post("/api/ai/parse-invoice", async (e) => {
  var a, o, c, l, f, h;
  const t = e.env.OPENAI_API_KEY;
  if (!t) return e.json({ error: "OpenAI API key is not configured on the server. Please add it in Settings." }, 400);
  const r = `{
  "vendor": "supplier/company name from the invoice header",
  "invoice_number": "invoice number or empty string",
  "invoice_date": "YYYY-MM-DD or empty string",
  "total": 0.00,
  "payment_account": "A/P",
  "tax_gst": 0.00,
  "tax_pst": 0.00,
  "delivery": 0.00,
  "credit": 0.00,
  "other_cost": 0.00,
  "other_desc": "",
  "items": [
    {
      "name": "generic product name (e.g. Grana Padano, Olive Oil, Cardboard Box)",
      "original_ocr": "exact original OCR text for this line item \u2014 copy it character-for-character from the input, do not clean or modify it",
      "brand": "brand name if visible or empty string",
      "sku": "SKU/item code/barcode if visible or empty string",
      "pack_size": "weight or volume only e.g. '1 kg', '500 ml', '2 LB'. Use case count or Each only if no weight or volume is available",
      "qty": 1,
      "unit_price": 0.00,
      "cost": 0.00,
      "expiry_date": "YYYY-MM-DD or empty string"
    }
  ]
}`, n = `Rules:
- Extract EVERY product line item in the text \u2014 do not skip any
- For 'original_ocr': copy the exact original OCR text for each product line item, character-for-character, without cleaning or modifying it. This is used for product matching.
- Do NOT include delivery fees, fuel surcharges, or taxes as items[] entries \u2014 put them in the dedicated fields (delivery, tax_gst, tax_pst) instead
- For 'name': use the generic product name, not the vendor-specific SKU description
- For 'qty': the quantity ordered (number of units, cases, bags, etc. as shown on the invoice). Must be a number, not text
- For 'unit_price': the price per single unit as shown on the invoice (e.g. $13.35 per bag). This is NOT the line total
- For 'cost': the line total (qty \xD7 unit_price). Verify the math: cost should equal qty \xD7 unit_price
- For 'pack_size': prioritize the unit weight or volume over the case count. For example, '20CS of 50KG' should be saved as '50KG'. Only use case count or 'Each' if there is no weight or volume available
- For 'tax_gst': GST, HST, or any federal/harmonized sales tax amount (dollar value, not %)
- For 'tax_pst': PST, QST, or any provincial sales tax amount (dollar value, not %)
- For 'delivery': the combined total of any delivery fee, freight charge, shipping cost, fuel surcharge, energy surcharge, or environmental fee that are actual charges applied to this specific invoice's total. Add them together into this single field. Do NOT extract amounts mentioned only in general policy text, terms and conditions, fine print, or minimum order notices (e.g. "Free delivery on orders over $X"). Only extract actual line item charges that affect the invoice total
- - For 'credit': only extract a credit/discount if the line item prices are at FULL (undiscounted) price and the discount is applied separately at the bottom of the invoice. If the line item prices already reflect the discounted price (i.e. the discounted unit price \xD7 qty = the line total shown), set credit to 0.00
- For 'other_cost': any other fee not covered above (handling fee, etc.)
- For 'other_desc': description of the other_cost if applicable
- For dates: convert any format to YYYY-MM-DD
- Use 0.00 for numeric fields you cannot find
- Use empty string '' for text fields you cannot find
- If any field is unclear or ambiguous, mark it as 'needs review' instead of guessing
- If any part of the invoice is in a language other than English, translate it to English
- When a tax, fee, or charge seems unusually high or low, cross-check it against the invoice total. For example, if the subtotal is $814.51 and the total is $814.66, the tax should be $0.15 not $15.00. Use the total as the source of truth to validate individual charges. If you correct a decimal error, add '(decimal corrected)' next to the field value
- Return ONLY the JSON object, nothing else`;
  let s;
  if ((e.req.header("content-type") || "").includes("multipart/form-data")) {
    const p = (await e.req.formData()).get("file");
    if (!p) return e.json({ error: "No file provided" }, 400);
    const m = p.type || "image/jpeg", v = await p.arrayBuffer(), g = btoa(String.fromCharCode(...new Uint8Array(v)));
    s = [{ role: "user", content: [{ type: "text", text: `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}` }, { type: "image_url", image_url: { url: `data:${m};base64,${g}`, detail: "high" } }] }];
  } else {
    const u = await e.req.json();
    if (u.ocrText) {
      const p = `You are an expert invoice parser. Below is the raw text extracted from an invoice by OCR. The OCR text is accurate for product line items, but the totals/charges section (taxes, fees, deposits, surcharges) may have broken formatting where labels and values appear on separate lines or are misassociated.${(a = u.base64Images) != null && a.length ? " You also have the original invoice image(s) \u2014 use them to VISUALLY VERIFY all charges in the totals section. When the OCR text is ambiguous about which value belongs to which label, trust the image layout over the OCR text." : " Always cross-check individual amounts against the invoice total to catch these errors."}

Parse this text carefully and extract ALL line items AND all additional charges. Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}

--- INVOICE OCR TEXT START ---
${u.ocrText}
--- INVOICE OCR TEXT END ---`;
      if ((o = u.base64Images) != null && o.length) {
        const m = [{ type: "text", text: p }];
        for (const v of u.base64Images) {
          const g = v.mimeType || "image/jpeg";
          m.push({ type: "image_url", image_url: { url: `data:${g};base64,${v.base64}`, detail: "high" } });
        }
        s = [{ role: "user", content: m }];
      } else s = [{ role: "user", content: p }];
    } else if (u.base64) {
      const p = u.mimeType || "image/jpeg";
      s = [{ role: "user", content: [{ type: "text", text: `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}` }, { type: "image_url", image_url: { url: `data:${p};base64,${u.base64}`, detail: "high" } }] }];
    } else return e.json({ error: "Provide either ocrText or base64 in the request body." }, 400);
  }
  try {
    const u = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ model: "gpt-4o", max_tokens: 3e3, messages: s }) });
    if (!u.ok) {
      const y = await u.json().catch(() => ({}));
      return e.json({ error: ((c = y == null ? void 0 : y.error) == null ? void 0 : c.message) || `OpenAI API error ${u.status}` }, 502);
    }
    const v = (((h = (f = (l = (await u.json()).choices) == null ? void 0 : l[0]) == null ? void 0 : f.message) == null ? void 0 : h.content) || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim(), g = JSON.parse(v);
    return e.json({ success: true, result: g, rawText: v });
  } catch (u) {
    const p = u instanceof Error ? u.message : String(u);
    return e.json({ error: "AI parsing failed: " + p }, 500);
  }
});
A.post("/api/ai/azure-analyze", async (e) => {
  var p;
  const t = (e.env.AZURE_DOC_INTEL_ENDPOINT || "").replace(/\/$/, ""), r = e.env.AZURE_DOC_INTEL_KEY;
  if (!t || !r) return e.json({ error: "Azure Document Intelligence is not configured on the server." }, 503);
  if (!(e.req.header("content-type") || "").includes("multipart/form-data")) return e.json({ error: 'Send the invoice as multipart/form-data with field name "file".' }, 400);
  const i = (await e.req.formData()).get("file");
  if (!i) return e.json({ error: "No file provided." }, 400);
  const a = await i.arrayBuffer(), o = i.type || "application/octet-stream", c = a.byteLength / (1024 * 1024);
  if (c > 50) return e.json({ error: `File is too large for Azure OCR (${c.toFixed(1)} MB). Maximum supported size is 50 MB. Please reduce the file size and try again.` }, 413);
  const l = `${t}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`, f = await fetch(l, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": r, "Content-Type": o }, body: a });
  if (!f.ok) {
    const m = await f.text();
    return e.json({ error: `Azure submission failed (${f.status}): ${m}` }, 502);
  }
  const h = f.headers.get("operation-location");
  if (!h) return e.json({ error: "Azure did not return an operation-location header." }, 502);
  const u = 60;
  for (let m = 0; m < u; m++) {
    await new Promise((y) => setTimeout(y, 1e3));
    const v = await fetch(h, { headers: { "Ocp-Apim-Subscription-Key": r } });
    if (!v.ok) {
      const y = await v.text();
      return e.json({ error: `Azure polling failed (${v.status}): ${y}` }, 502);
    }
    const g = await v.json();
    if (g.status === "succeeded") {
      const y = g.analyzeResult, b = [];
      if (y != null && y.pages && y.pages.length > 0) for (const k of y.pages) {
        const R = k.pageNumber ?? b.length + 1, O = (k.lines || []).map((x) => x.content || "").filter(Boolean);
        b.push({ pageNumber: R, text: O.join(`
`) });
      }
      else y != null && y.content && b.push({ pageNumber: 1, text: y.content });
      return e.json({ success: true, analyzeResult: g.analyzeResult, pageTexts: b, fullText: (y == null ? void 0 : y.content) || b.map((k) => k.text).join(`

--- Page break ---

`) });
    }
    if (g.status === "failed") return e.json({ error: "Azure analysis failed: " + (((p = g.error) == null ? void 0 : p.message) || "unknown error") }, 502);
  }
  return e.json({ error: "Azure analysis timed out after 60 seconds. The file may be too complex or Azure may be under load. Please try again." }, 504);
});
A.get("/api/product-mappings", async (e) => {
  const t = (e.req.query("vendor") || "").trim();
  if (!t) {
    const n = await e.env.DB.prepare("SELECT * FROM product_mappings ORDER BY updated_at DESC").all();
    return e.json({ data: n.results });
  }
  const r = await e.env.DB.prepare("SELECT * FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) ORDER BY updated_at DESC").bind(t).all();
  return e.json({ data: r.results });
});
A.post("/api/product-mappings", async (e) => {
  var i, a, o, c, l, f, h, u, p;
  const t = await e.req.json();
  if (!((i = t.vendor_name) != null && i.trim()) || !((a = t.raw_ocr_text) != null && a.trim()) || !((o = t.corrected_name) != null && o.trim())) return e.json({ error: "vendor_name, raw_ocr_text, and corrected_name are required" }, 400);
  const r = (/* @__PURE__ */ new Date()).toISOString(), n = await e.env.DB.prepare("SELECT id FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(raw_ocr_text)) = LOWER(TRIM(?))").bind(t.vendor_name.trim(), t.raw_ocr_text.trim()).first();
  if (n) return await e.env.DB.prepare("UPDATE product_mappings SET corrected_name=?, corrected_brand=?, corrected_sku=?, corrected_pack_size=?, updated_at=? WHERE id=?").bind(t.corrected_name.trim(), ((c = t.corrected_brand) == null ? void 0 : c.trim()) || "", ((l = t.corrected_sku) == null ? void 0 : l.trim()) || "", ((f = t.corrected_pack_size) == null ? void 0 : f.trim()) || "", r, n.id).run(), e.json({ id: n.id, created: false });
  const s = z();
  return await e.env.DB.prepare("INSERT INTO product_mappings (id, vendor_name, raw_ocr_text, corrected_name, corrected_brand, corrected_sku, corrected_pack_size, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(s, t.vendor_name.trim(), t.raw_ocr_text.trim(), t.corrected_name.trim(), ((h = t.corrected_brand) == null ? void 0 : h.trim()) || "", ((u = t.corrected_sku) == null ? void 0 : u.trim()) || "", ((p = t.corrected_pack_size) == null ? void 0 : p.trim()) || "", r, r).run(), e.json({ id: s, created: true });
});
A.delete("/api/units/:id", async (e) => {
  const t = e.req.param("id"), r = e.req.query("force") === "true", n = await e.env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(t).first();
  if (!n) return e.json({ error: "Not found" }, 404);
  if (!r) {
    const s = await e.env.DB.prepare("SELECT COUNT(*) as count FROM product_entries WHERE pack_unit = ?").bind(n.name).first(), i = (s == null ? void 0 : s.count) ?? 0;
    if (i > 0) return e.json({ warning: true, count: i, message: `Used by ${i} product entries` });
  }
  return await e.env.DB.prepare("DELETE FROM units WHERE id = ?").bind(t).run(), e.body(null, 204);
});
var Ln = /* @__PURE__ */ __name((e, ...t) => {
  const r = [""];
  for (let n = 0, s = e.length - 1; n < s; n++) {
    r[0] += e[n];
    const i = Array.isArray(t[n]) ? t[n].flat(1 / 0) : [t[n]];
    for (let a = 0, o = i.length; a < o; a++) {
      const c = i[a];
      if (typeof c == "string") ie(c, r);
      else if (typeof c == "number") r[0] += c;
      else {
        if (typeof c == "boolean" || c === null || c === void 0) continue;
        if (typeof c == "object" && c.isEscaped) if (c.callbacks) r.unshift("", c);
        else {
          const l = c.toString();
          l instanceof Promise ? r.unshift("", l) : r[0] += l;
        }
        else c instanceof Promise ? r.unshift("", c) : ie(c.toString(), r);
      }
    }
  }
  return r[0] += e.at(-1), r.length === 1 ? "callbacks" in r ? P(wr(P(r[0], r.callbacks))) : P(r[0]) : br(r, r.callbacks);
}, "Ln");
var Nt = /* @__PURE__ */ Symbol("RENDERER");
var Tt = /* @__PURE__ */ Symbol("ERROR_HANDLER");
var j = /* @__PURE__ */ Symbol("STASH");
var kr = /* @__PURE__ */ Symbol("INTERNAL");
var In = /* @__PURE__ */ Symbol("MEMO");
var ut = /* @__PURE__ */ Symbol("PERMALINK");
var Kt = /* @__PURE__ */ __name((e) => (e[kr] = true, e), "Kt");
var jr = /* @__PURE__ */ __name((e) => ({ value: t, children: r }) => {
  if (!r) return;
  const n = { children: [{ tag: Kt(() => {
    e.push(t);
  }), props: {} }] };
  Array.isArray(r) ? n.children.push(...r.flat()) : n.children.push(r), n.children.push({ tag: Kt(() => {
    e.pop();
  }), props: {} });
  const s = { tag: "", props: n, type: "" };
  return s[Tt] = (i) => {
    throw e.pop(), i;
  }, s;
}, "jr");
var Cr = /* @__PURE__ */ __name((e) => {
  const t = [e], r = jr(t);
  return r.values = t, r.Provider = r, je.push(r), r;
}, "Cr");
var je = [];
var Lt = /* @__PURE__ */ __name((e) => {
  const t = [e], r = /* @__PURE__ */ __name(((n) => {
    t.push(n.value);
    let s;
    try {
      s = n.children ? (Array.isArray(n.children) ? new $r("", {}, n.children) : n.children).toString() : "";
    } catch (i) {
      throw t.pop(), i;
    }
    return s instanceof Promise ? s.finally(() => t.pop()).then((i) => P(i, i.callbacks)) : (t.pop(), P(s));
  }), "r");
  return r.values = t, r.Provider = r, r[Nt] = jr(t), je.push(r), r;
}, "Lt");
var Ne = /* @__PURE__ */ __name((e) => e.values.at(-1), "Ne");
var ft = { title: [], script: ["src"], style: ["data-href"], link: ["href"], meta: ["name", "httpEquiv", "charset", "itemProp"] };
var At = {};
var ce = "data-precedence";
var Dr = /* @__PURE__ */ __name((e) => e.rel === "stylesheet" && "precedence" in e, "Dr");
var Nr = /* @__PURE__ */ __name((e, t) => e === "link" ? t : ft[e].length > 0, "Nr");
var Xe = /* @__PURE__ */ __name((e) => Array.isArray(e) ? e : [e], "Xe");
var Yt = /* @__PURE__ */ new WeakMap();
var Vt = /* @__PURE__ */ __name((e, t, r, n) => ({ buffer: s, context: i }) => {
  if (!s) return;
  const a = Yt.get(i) || {};
  Yt.set(i, a);
  const o = a[e] || (a[e] = []);
  let c = false;
  const l = ft[e], f = Nr(e, n !== void 0);
  if (f) {
    e: for (const [, h] of o) if (!(e === "link" && !(h.rel === "stylesheet" && h[ce] !== void 0))) {
      for (const u of l) if (((h == null ? void 0 : h[u]) ?? null) === (r == null ? void 0 : r[u])) {
        c = true;
        break e;
      }
    }
  }
  if (c ? s[0] = s[0].replaceAll(t, "") : f || e === "link" ? o.push([t, r, n]) : o.unshift([t, r, n]), s[0].indexOf("</head>") !== -1) {
    let h;
    if (e === "link" || n !== void 0) {
      const u = [];
      h = o.map(([p, , m], v) => {
        if (m === void 0) return [p, Number.MAX_SAFE_INTEGER, v];
        let g = u.indexOf(m);
        return g === -1 && (u.push(m), g = u.length - 1), [p, g, v];
      }).sort((p, m) => p[1] - m[1] || p[2] - m[2]).map(([p]) => p);
    } else h = o.map(([u]) => u);
    h.forEach((u) => {
      s[0] = s[0].replaceAll(u, "");
    }), s[0] = s[0].replace(/(?=<\/head>)/, h.join(""));
  }
}, "Vt");
var Je = /* @__PURE__ */ __name((e, t, r) => P(new M(e, r, Xe(t ?? [])).toString()), "Je");
var Ze = /* @__PURE__ */ __name((e, t, r, n) => {
  if ("itemProp" in r) return Je(e, t, r);
  let { precedence: s, blocking: i, ...a } = r;
  s = n ? s ?? "" : void 0, n && (a[ce] = s);
  const o = new M(e, a, Xe(t || [])).toString();
  return o instanceof Promise ? o.then((c) => P(o, [...c.callbacks || [], Vt(e, c, a, s)])) : P(o, [Vt(e, o, a, s)]);
}, "Ze");
var Pn = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = It();
  if (r) {
    const n = Ne(r);
    if (n === "svg" || n === "head") return new M("title", t, Xe(e ?? []));
  }
  return Ze("title", e, t, false);
}, "Pn");
var $n = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = It();
  return ["src", "async"].some((n) => !t[n]) || r && Ne(r) === "head" ? Je("script", e, t) : Ze("script", e, t, false);
}, "$n");
var Mn = /* @__PURE__ */ __name(({ children: e, ...t }) => ["href", "precedence"].every((r) => r in t) ? (t["data-href"] = t.href, delete t.href, Ze("style", e, t, true)) : Je("style", e, t), "Mn");
var Fn = /* @__PURE__ */ __name(({ children: e, ...t }) => ["onLoad", "onError"].some((r) => r in t) || t.rel === "stylesheet" && (!("precedence" in t) || "disabled" in t) ? Je("link", e, t) : Ze("link", e, t, Dr(t)), "Fn");
var qn = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = It();
  return r && Ne(r) === "head" ? Je("meta", e, t) : Ze("meta", e, t, false);
}, "qn");
var Lr = /* @__PURE__ */ __name((e, { children: t, ...r }) => new M(e, r, Xe(t ?? [])), "Lr");
var Hn = /* @__PURE__ */ __name((e) => (typeof e.action == "function" && (e.action = ut in e.action ? e.action[ut] : void 0), Lr("form", e)), "Hn");
var Ir = /* @__PURE__ */ __name((e, t) => (typeof t.formAction == "function" && (t.formAction = ut in t.formAction ? t.formAction[ut] : void 0), Lr(e, t)), "Ir");
var Bn = /* @__PURE__ */ __name((e) => Ir("input", e), "Bn");
var Un = /* @__PURE__ */ __name((e) => Ir("button", e), "Un");
var _t = Object.freeze(Object.defineProperty({ __proto__: null, button: Un, form: Hn, input: Bn, link: Fn, meta: qn, script: $n, style: Mn, title: Pn }, Symbol.toStringTag, { value: "Module" }));
var Wn = /* @__PURE__ */ new Map([["className", "class"], ["htmlFor", "for"], ["crossOrigin", "crossorigin"], ["httpEquiv", "http-equiv"], ["itemProp", "itemprop"], ["fetchPriority", "fetchpriority"], ["noModule", "nomodule"], ["formAction", "formaction"]]);
var dt = /* @__PURE__ */ __name((e) => Wn.get(e) || e, "dt");
var Pr = /* @__PURE__ */ __name((e, t) => {
  for (const [r, n] of Object.entries(e)) {
    const s = r[0] === "-" || !/[A-Z]/.test(r) ? r : r.replace(/[A-Z]/g, (i) => `-${i.toLowerCase()}`);
    t(s, n == null ? null : typeof n == "number" ? s.match(/^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/) ? `${n}` : `${n}px` : n);
  }
}, "Pr");
var He = void 0;
var It = /* @__PURE__ */ __name(() => He, "It");
var zn = /* @__PURE__ */ __name((e) => /[A-Z]/.test(e) && e.match(/^(?:al|basel|clip(?:Path|Rule)$|co|do|fill|fl|fo|gl|let|lig|i|marker[EMS]|o|pai|pointe|sh|st[or]|text[^L]|tr|u|ve|w)/) ? e.replace(/([A-Z])/g, "-$1").toLowerCase() : e, "zn");
var Kn = ["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"];
var Yn = ["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "download", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"];
var Pt = /* @__PURE__ */ __name((e, t) => {
  for (let r = 0, n = e.length; r < n; r++) {
    const s = e[r];
    if (typeof s == "string") ie(s, t);
    else {
      if (typeof s == "boolean" || s === null || s === void 0) continue;
      s instanceof M ? s.toStringToBuffer(t) : typeof s == "number" || s.isEscaped ? t[0] += s : s instanceof Promise ? t.unshift("", s) : Pt(s, t);
    }
  }
}, "Pt");
var M = class {
  static {
    __name(this, "M");
  }
  constructor(e, t, r) {
    _(this, "tag");
    _(this, "props");
    _(this, "key");
    _(this, "children");
    _(this, "isEscaped", true);
    _(this, "localContexts");
    this.tag = e, this.props = t, this.children = r;
  }
  get type() {
    return this.tag;
  }
  get ref() {
    return this.props.ref || null;
  }
  toString() {
    var t, r;
    const e = [""];
    (t = this.localContexts) == null || t.forEach(([n, s]) => {
      n.values.push(s);
    });
    try {
      this.toStringToBuffer(e);
    } finally {
      (r = this.localContexts) == null || r.forEach(([n]) => {
        n.values.pop();
      });
    }
    return e.length === 1 ? "callbacks" in e ? wr(P(e[0], e.callbacks)).toString() : e[0] : br(e, e.callbacks);
  }
  toStringToBuffer(e) {
    const t = this.tag, r = this.props;
    let { children: n } = this;
    e[0] += `<${t}`;
    const s = He && Ne(He) === "svg" ? (i) => zn(dt(i)) : (i) => dt(i);
    for (let [i, a] of Object.entries(r)) if (i = s(i), i !== "children") {
      if (i === "style" && typeof a == "object") {
        let o = "";
        Pr(a, (c, l) => {
          l != null && (o += `${o ? ";" : ""}${c}:${l}`);
        }), e[0] += ' style="', ie(o, e), e[0] += '"';
      } else if (typeof a == "string") e[0] += ` ${i}="`, ie(a, e), e[0] += '"';
      else if (a != null) if (typeof a == "number" || a.isEscaped) e[0] += ` ${i}="${a}"`;
      else if (typeof a == "boolean" && Yn.includes(i)) a && (e[0] += ` ${i}=""`);
      else if (i === "dangerouslySetInnerHTML") {
        if (n.length > 0) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
        n = [P(a.__html)];
      } else if (a instanceof Promise) e[0] += ` ${i}="`, e.unshift('"', a);
      else if (typeof a == "function") {
        if (!i.startsWith("on") && i !== "ref") throw new Error(`Invalid prop '${i}' of type 'function' supplied to '${t}'.`);
      } else e[0] += ` ${i}="`, ie(a.toString(), e), e[0] += '"';
    }
    if (Kn.includes(t) && n.length === 0) {
      e[0] += "/>";
      return;
    }
    e[0] += ">", Pt(n, e), e[0] += `</${t}>`;
  }
};
var Et = class extends M {
  static {
    __name(this, "Et");
  }
  toStringToBuffer(e) {
    const { children: t } = this, r = { ...this.props };
    t.length && (r.children = t.length === 1 ? t[0] : t);
    const n = this.tag.call(null, r);
    if (!(typeof n == "boolean" || n == null)) if (n instanceof Promise) if (je.length === 0) e.unshift("", n);
    else {
      const s = je.map((i) => [i, i.values.at(-1)]);
      e.unshift("", n.then((i) => (i instanceof M && (i.localContexts = s), i)));
    }
    else n instanceof M ? n.toStringToBuffer(e) : typeof n == "number" || n.isEscaped ? (e[0] += n, n.callbacks && (e.callbacks || (e.callbacks = []), e.callbacks.push(...n.callbacks))) : ie(n, e);
  }
};
var $r = class extends M {
  static {
    __name(this, "$r");
  }
  toStringToBuffer(e) {
    Pt(this.children, e);
  }
};
var Gt = /* @__PURE__ */ __name((e, t, ...r) => {
  t ?? (t = {}), r.length && (t.children = r.length === 1 ? r[0] : r);
  const n = t.key;
  delete t.key;
  const s = it(e, t, r);
  return s.key = n, s;
}, "Gt");
var Xt = false;
var it = /* @__PURE__ */ __name((e, t, r) => {
  if (!Xt) {
    for (const n in At) _t[n][Nt] = At[n];
    Xt = true;
  }
  return typeof e == "function" ? new Et(e, t, r) : _t[e] ? new Et(_t[e], t, r) : e === "svg" || e === "head" ? (He || (He = Lt("")), new M(e, t, [new Et(He, { value: e }, r)])) : new M(e, t, r);
}, "it");
var Vn = /* @__PURE__ */ __name(({ children: e }) => new $r("", { children: e }, Array.isArray(e) ? e : e ? [e] : []), "Vn");
function $e(e, t, r) {
  let n;
  if (!t || !("children" in t)) n = it(e, t, []);
  else {
    const s = t.children;
    n = Array.isArray(s) ? it(e, t, s) : it(e, t, [s]);
  }
  return n.key = r, n;
}
__name($e, "$e");
var Be = "_hp";
var Gn = { Change: "Input", DoubleClick: "DblClick" };
var Xn = { svg: "2000/svg", math: "1998/Math/MathML" };
var Ue = [];
var kt = /* @__PURE__ */ new WeakMap();
var Ce = void 0;
var Jn = /* @__PURE__ */ __name(() => Ce, "Jn");
var Y = /* @__PURE__ */ __name((e) => "t" in e, "Y");
var bt = { onClick: ["click", false] };
var Jt = /* @__PURE__ */ __name((e) => {
  if (!e.startsWith("on")) return;
  if (bt[e]) return bt[e];
  const t = e.match(/^on([A-Z][a-zA-Z]+?(?:PointerCapture)?)(Capture)?$/);
  if (t) {
    const [, r, n] = t;
    return bt[e] = [(Gn[r] || r).toLowerCase(), !!n];
  }
}, "Jt");
var Zt = /* @__PURE__ */ __name((e, t) => Ce && e instanceof SVGElement && /[A-Z]/.test(t) && (t in e.style || t.match(/^(?:o|pai|str|u|ve)/)) ? t.replace(/([A-Z])/g, "-$1").toLowerCase() : t, "Zt");
var Zn = /* @__PURE__ */ __name((e, t, r) => {
  var n;
  t || (t = {});
  for (let s in t) {
    const i = t[s];
    if (s !== "children" && (!r || r[s] !== i)) {
      s = dt(s);
      const a = Jt(s);
      if (a) {
        if ((r == null ? void 0 : r[s]) !== i && (r && e.removeEventListener(a[0], r[s], a[1]), i != null)) {
          if (typeof i != "function") throw new Error(`Event handler for "${s}" is not a function`);
          e.addEventListener(a[0], i, a[1]);
        }
      } else if (s === "dangerouslySetInnerHTML" && i) e.innerHTML = i.__html;
      else if (s === "ref") {
        let o;
        typeof i == "function" ? o = i(e) || (() => i(null)) : i && "current" in i && (i.current = e, o = /* @__PURE__ */ __name(() => i.current = null, "o")), kt.set(e, o);
      } else if (s === "style") {
        const o = e.style;
        typeof i == "string" ? o.cssText = i : (o.cssText = "", i != null && Pr(i, o.setProperty.bind(o)));
      } else {
        if (s === "value") {
          const c = e.nodeName;
          if (c === "INPUT" || c === "TEXTAREA" || c === "SELECT") {
            if (e.value = i == null || i === false ? null : i, c === "TEXTAREA") {
              e.textContent = i;
              continue;
            } else if (c === "SELECT") {
              e.selectedIndex === -1 && (e.selectedIndex = 0);
              continue;
            }
          }
        } else (s === "checked" && e.nodeName === "INPUT" || s === "selected" && e.nodeName === "OPTION") && (e[s] = i);
        const o = Zt(e, s);
        i == null || i === false ? e.removeAttribute(o) : i === true ? e.setAttribute(o, "") : typeof i == "string" || typeof i == "number" ? e.setAttribute(o, i) : e.setAttribute(o, i.toString());
      }
    }
  }
  if (r) for (let s in r) {
    const i = r[s];
    if (s !== "children" && !(s in t)) {
      s = dt(s);
      const a = Jt(s);
      a ? e.removeEventListener(a[0], i, a[1]) : s === "ref" ? (n = kt.get(e)) == null || n() : e.removeAttribute(Zt(e, s));
    }
  }
}, "Zn");
var Qn = /* @__PURE__ */ __name((e, t) => {
  t[j][0] = 0, Ue.push([e, t]);
  const r = t.tag[Nt] || t.tag, n = r.defaultProps ? { ...r.defaultProps, ...t.props } : t.props;
  try {
    return [r.call(null, n)];
  } finally {
    Ue.pop();
  }
}, "Qn");
var Mr = /* @__PURE__ */ __name((e, t, r, n, s) => {
  var i, a;
  (i = e.vR) != null && i.length && (n.push(...e.vR), delete e.vR), typeof e.tag == "function" && ((a = e[j][1][Br]) == null || a.forEach((o) => s.push(o))), e.vC.forEach((o) => {
    var c;
    if (Y(o)) r.push(o);
    else if (typeof o.tag == "function" || o.tag === "") {
      o.c = t;
      const l = r.length;
      if (Mr(o, t, r, n, s), o.s) {
        for (let f = l; f < r.length; f++) r[f].s = true;
        o.s = false;
      }
    } else r.push(o), (c = o.vR) != null && c.length && (n.push(...o.vR), delete o.vR);
  });
}, "Mr");
var es = /* @__PURE__ */ __name((e) => {
  var t;
  for (; e && (e.tag === Be || !e.e); ) e = e.tag === Be || !((t = e.vC) != null && t[0]) ? e.nN : e.vC[0];
  return e == null ? void 0 : e.e;
}, "es");
var Fr = /* @__PURE__ */ __name((e) => {
  var t, r, n, s, i, a;
  Y(e) || ((r = (t = e[j]) == null ? void 0 : t[1][Br]) == null || r.forEach((o) => {
    var c;
    return (c = o[2]) == null ? void 0 : c.call(o);
  }), (n = kt.get(e.e)) == null || n(), e.p === 2 && ((s = e.vC) == null || s.forEach((o) => o.p = 2)), (i = e.vC) == null || i.forEach(Fr)), e.p || ((a = e.e) == null || a.remove(), delete e.e), typeof e.tag == "function" && (Me.delete(e), at.delete(e), delete e[j][3], e.a = true);
}, "Fr");
var qr = /* @__PURE__ */ __name((e, t, r) => {
  e.c = t, Hr(e, t, r);
}, "qr");
var Qt = /* @__PURE__ */ __name((e, t) => {
  if (t) {
    for (let r = 0, n = e.length; r < n; r++) if (e[r] === t) return r;
  }
}, "Qt");
var er = /* @__PURE__ */ Symbol();
var Hr = /* @__PURE__ */ __name((e, t, r) => {
  var l;
  const n = [], s = [], i = [];
  Mr(e, t, n, s, i), s.forEach(Fr);
  const a = r ? void 0 : t.childNodes;
  let o, c = null;
  if (r) o = -1;
  else if (!a.length) o = 0;
  else {
    const f = Qt(a, es(e.nN));
    f !== void 0 ? (c = a[f], o = f) : o = Qt(a, (l = n.find((h) => h.tag !== Be && h.e)) == null ? void 0 : l.e) ?? -1, o === -1 && (r = true);
  }
  for (let f = 0, h = n.length; f < h; f++, o++) {
    const u = n[f];
    let p;
    if (u.s && u.e) p = u.e, u.s = false;
    else {
      const m = r || !u.e;
      Y(u) ? (u.e && u.d && (u.e.textContent = u.t), u.d = false, p = u.e || (u.e = document.createTextNode(u.t))) : (p = u.e || (u.e = u.n ? document.createElementNS(u.n, u.tag) : document.createElement(u.tag)), Zn(p, u.props, u.pP), Hr(u, p, m));
    }
    u.tag === Be ? o-- : r ? p.parentNode || t.appendChild(p) : a[o] !== p && a[o - 1] !== p && (a[o + 1] === p ? t.appendChild(a[o]) : t.insertBefore(p, c || a[o] || null));
  }
  if (e.pP && (e.pP = void 0), i.length) {
    const f = [], h = [];
    i.forEach(([, u, , p, m]) => {
      u && f.push(u), p && h.push(p), m == null || m();
    }), f.forEach((u) => u()), h.length && requestAnimationFrame(() => {
      h.forEach((u) => u());
    });
  }
}, "Hr");
var ts = /* @__PURE__ */ __name((e, t) => !!(e && e.length === t.length && e.every((r, n) => r[1] === t[n][1])), "ts");
var at = /* @__PURE__ */ new WeakMap();
var jt = /* @__PURE__ */ __name((e, t, r) => {
  var i, a, o, c, l, f;
  const n = !r && t.pC;
  r && (t.pC || (t.pC = t.vC));
  let s;
  try {
    r || (r = typeof t.tag == "function" ? Qn(e, t) : Xe(t.props.children)), ((i = r[0]) == null ? void 0 : i.tag) === "" && r[0][Tt] && (s = r[0][Tt], e[5].push([e, s, t]));
    const h = n ? [...t.pC] : t.vC ? [...t.vC] : void 0, u = [];
    let p;
    for (let m = 0; m < r.length; m++) {
      if (Array.isArray(r[m])) {
        r.splice(m, 1, ...r[m].flat(1 / 0)), m--;
        continue;
      }
      let v = rs(r[m]);
      if (v) {
        typeof v.tag == "function" && !v.tag[kr] && (je.length > 0 && (v[j][2] = je.map((y) => [y, y.values.at(-1)])), (a = e[5]) != null && a.length && (v[j][3] = e[5].at(-1)));
        let g;
        if (h && h.length) {
          const y = h.findIndex(Y(v) ? (b) => Y(b) : v.key !== void 0 ? (b) => b.key === v.key && b.tag === v.tag : (b) => b.tag === v.tag);
          y !== -1 && (g = h[y], h.splice(y, 1));
        }
        if (g) if (Y(v)) g.t !== v.t && (g.t = v.t, g.d = true), v = g;
        else {
          const y = g.pP = g.props;
          if (g.props = v.props, g.f || (g.f = v.f || t.f), typeof v.tag == "function") {
            const b = g[j][2];
            g[j][2] = v[j][2] || [], g[j][3] = v[j][3], !g.f && ((g.o || g) === v.o || (c = (o = g.tag)[In]) != null && c.call(o, y, g.props)) && ts(b, g[j][2]) && (g.s = true);
          }
          v = g;
        }
        else if (!Y(v) && Ce) {
          const y = Ne(Ce);
          y && (v.n = y);
        }
        if (!Y(v) && !v.s && (jt(e, v), delete v.f), u.push(v), p && !p.s && !v.s) for (let y = p; y && !Y(y); y = (l = y.vC) == null ? void 0 : l.at(-1)) y.nN = v;
        p = v;
      }
    }
    t.vR = n ? [...t.vC, ...h || []] : h || [], t.vC = u, n && delete t.pC;
  } catch (h) {
    if (t.f = true, h === er) {
      if (s) return;
      throw h;
    }
    const [u, p, m] = ((f = t[j]) == null ? void 0 : f[3]) || [];
    if (p) {
      const v = /* @__PURE__ */ __name(() => ot([0, false, e[2]], m), "v"), g = at.get(m) || [];
      g.push(v), at.set(m, g);
      const y = p(h, () => {
        const b = at.get(m);
        if (b) {
          const k = b.indexOf(v);
          if (k !== -1) return b.splice(k, 1), v();
        }
      });
      if (y) {
        if (e[0] === 1) e[1] = true;
        else if (jt(e, m, [y]), (p.length === 1 || e !== u) && m.c) {
          qr(m, m.c, false);
          return;
        }
        throw er;
      }
    }
    throw h;
  } finally {
    s && e[5].pop();
  }
}, "jt");
var rs = /* @__PURE__ */ __name((e) => {
  if (!(e == null || typeof e == "boolean")) {
    if (typeof e == "string" || typeof e == "number") return { t: e.toString(), d: true };
    if ("vR" in e && (e = { tag: e.tag, props: e.props, key: e.key, f: e.f, type: e.tag, ref: e.props.ref, o: e.o || e }), typeof e.tag == "function") e[j] = [0, []];
    else {
      const t = Xn[e.tag];
      t && (Ce || (Ce = Cr("")), e.props.children = [{ tag: Ce, props: { value: e.n = `http://www.w3.org/${t}`, children: e.props.children } }]);
    }
    return e;
  }
}, "rs");
var tr = /* @__PURE__ */ __name((e, t) => {
  var r, n;
  (r = t[j][2]) == null || r.forEach(([s, i]) => {
    s.values.push(i);
  });
  try {
    jt(e, t, void 0);
  } catch {
    return;
  }
  if (t.a) {
    delete t.a;
    return;
  }
  (n = t[j][2]) == null || n.forEach(([s]) => {
    s.values.pop();
  }), (e[0] !== 1 || !e[1]) && qr(t, t.c, false);
}, "tr");
var Me = /* @__PURE__ */ new WeakMap();
var rr = [];
var ot = /* @__PURE__ */ __name(async (e, t) => {
  e[5] || (e[5] = []);
  const r = Me.get(t);
  r && r[0](void 0);
  let n;
  const s = new Promise((i) => n = i);
  if (Me.set(t, [n, () => {
    e[2] ? e[2](e, t, (i) => {
      tr(i, t);
    }).then(() => n(t)) : (tr(e, t), n(t));
  }]), rr.length) rr.at(-1).add(t);
  else {
    await Promise.resolve();
    const i = Me.get(t);
    i && (Me.delete(t), i[1]());
  }
  return s;
}, "ot");
var ns = /* @__PURE__ */ __name((e, t, r) => ({ tag: Be, props: { children: e }, key: r, e: t, p: 1 }), "ns");
var wt = 0;
var Br = 1;
var xt = 2;
var Rt = 3;
var St = /* @__PURE__ */ new WeakMap();
var Ur = /* @__PURE__ */ __name((e, t) => !e || !t || e.length !== t.length || t.some((r, n) => r !== e[n]), "Ur");
var ss = void 0;
var nr = [];
var is = /* @__PURE__ */ __name((e) => {
  var a;
  const t = /* @__PURE__ */ __name(() => typeof e == "function" ? e() : e, "t"), r = Ue.at(-1);
  if (!r) return [t(), () => {
  }];
  const [, n] = r, s = (a = n[j][1])[wt] || (a[wt] = []), i = n[j][0]++;
  return s[i] || (s[i] = [t(), (o) => {
    const c = ss, l = s[i];
    if (typeof o == "function" && (o = o(l[0])), !Object.is(o, l[0])) if (l[0] = o, nr.length) {
      const [f, h] = nr.at(-1);
      Promise.all([f === 3 ? n : ot([f, false, c], n), h]).then(([u]) => {
        if (!u || !(f === 2 || f === 3)) return;
        const p = u.vC;
        requestAnimationFrame(() => {
          setTimeout(() => {
            p === u.vC && ot([f === 3 ? 1 : 0, false, c], u);
          });
        });
      });
    } else ot([0, false, c], n);
  }]);
}, "is");
var $t = /* @__PURE__ */ __name((e, t) => {
  var o;
  const r = Ue.at(-1);
  if (!r) return e;
  const [, n] = r, s = (o = n[j][1])[xt] || (o[xt] = []), i = n[j][0]++, a = s[i];
  return Ur(a == null ? void 0 : a[1], t) ? s[i] = [e, t] : e = s[i][0], e;
}, "$t");
var as = /* @__PURE__ */ __name((e) => {
  const t = St.get(e);
  if (t) {
    if (t.length === 2) throw t[1];
    return t[0];
  }
  throw e.then((r) => St.set(e, [r]), (r) => St.set(e, [void 0, r])), e;
}, "as");
var os = /* @__PURE__ */ __name((e, t) => {
  var o;
  const r = Ue.at(-1);
  if (!r) return e();
  const [, n] = r, s = (o = n[j][1])[Rt] || (o[Rt] = []), i = n[j][0]++, a = s[i];
  return Ur(a == null ? void 0 : a[1], t) && (s[i] = [e(), t]), s[i][0];
}, "os");
var cs = Cr({ pending: false, data: null, method: null, action: null });
var sr = /* @__PURE__ */ new Set();
var ls = /* @__PURE__ */ __name((e) => {
  sr.add(e), e.finally(() => sr.delete(e));
}, "ls");
var Mt = /* @__PURE__ */ __name((e, t) => os(() => (r) => {
  let n;
  e && (typeof e == "function" ? n = e(r) || (() => {
    e(null);
  }) : e && "current" in e && (e.current = r, n = /* @__PURE__ */ __name(() => {
    e.current = null;
  }, "n")));
  const s = t(r);
  return () => {
    s == null || s(), n == null || n();
  };
}, [e]), "Mt");
var ye = /* @__PURE__ */ Object.create(null);
var tt = /* @__PURE__ */ Object.create(null);
var Qe = /* @__PURE__ */ __name((e, t, r, n, s) => {
  if (t != null && t.itemProp) return { tag: e, props: t, type: e, ref: t.ref };
  const i = document.head;
  let { onLoad: a, onError: o, precedence: c, blocking: l, ...f } = t, h = null, u = false;
  const p = ft[e], m = Nr(e, n), v = /* @__PURE__ */ __name((R) => R.getAttribute("rel") === "stylesheet" && R.getAttribute(ce) !== null, "v");
  let g;
  if (m) {
    const R = i.querySelectorAll(e);
    e: for (const O of R) if (!(e === "link" && !v(O))) {
      for (const x of p) if (O.getAttribute(x) === t[x]) {
        h = O;
        break e;
      }
    }
    if (!h) {
      const O = p.reduce((x, T) => t[T] === void 0 ? x : `${x}-${T}-${t[T]}`, e);
      u = !tt[O], h = tt[O] || (tt[O] = (() => {
        const x = document.createElement(e);
        for (const T of p) t[T] !== void 0 && x.setAttribute(T, t[T]);
        return t.rel && x.setAttribute("rel", t.rel), x;
      })());
    }
  } else g = i.querySelectorAll(e);
  c = n ? c ?? "" : void 0, n && (f[ce] = c);
  const y = $t((R) => {
    if (m) {
      if (e === "link" && c !== void 0) {
        let x = false;
        for (const T of i.querySelectorAll(e)) {
          const F = T.getAttribute(ce);
          if (F === null) {
            i.insertBefore(R, T);
            return;
          }
          if (x && F !== c) {
            i.insertBefore(R, T);
            return;
          }
          F === c && (x = true);
        }
        i.appendChild(R);
        return;
      }
      let O = false;
      for (const x of i.querySelectorAll(e)) {
        if (O && x.getAttribute(ce) !== c) {
          i.insertBefore(R, x);
          return;
        }
        x.getAttribute(ce) === c && (O = true);
      }
      i.appendChild(R);
    } else if (e === "link") i.contains(R) || i.appendChild(R);
    else if (g) {
      let O = false;
      for (const x of g) if (x === R) {
        O = true;
        break;
      }
      O || i.insertBefore(R, i.contains(g[0]) ? g[0] : i.querySelector(e)), g = void 0;
    }
  }, [m, c, e]), b = Mt(t.ref, (R) => {
    var T;
    const O = p[0];
    if (r === 2 && (R.innerHTML = ""), (u || g) && y(R), !o && !a || !O) return;
    let x = ye[T = R.getAttribute(O)] || (ye[T] = new Promise((F, U) => {
      R.addEventListener("load", F), R.addEventListener("error", U);
    }));
    a && (x = x.then(a)), o && (x = x.catch(o)), x.catch(() => {
    });
  });
  if (s && l === "render") {
    const R = ft[e][0];
    if (R && t[R]) {
      const O = t[R], x = ye[O] || (ye[O] = new Promise((T, F) => {
        y(h), h.addEventListener("load", T), h.addEventListener("error", F);
      }));
      as(x);
    }
  }
  const k = { tag: e, type: e, props: { ...f, ref: b }, ref: b };
  return k.p = r, h && (k.e = h), ns(k, i);
}, "Qe");
var us = /* @__PURE__ */ __name((e) => {
  const t = Jn(), r = t && Ne(t);
  return r != null && r.endsWith("svg") ? { tag: "title", props: e, type: "title", ref: e.ref } : Qe("title", e, void 0, false, false);
}, "us");
var fs = /* @__PURE__ */ __name((e) => !e || ["src", "async"].some((t) => !e[t]) ? { tag: "script", props: e, type: "script", ref: e.ref } : Qe("script", e, 1, false, true), "fs");
var ds = /* @__PURE__ */ __name((e) => !e || !["href", "precedence"].every((t) => t in e) ? { tag: "style", props: e, type: "style", ref: e.ref } : (e["data-href"] = e.href, delete e.href, Qe("style", e, 2, true, true)), "ds");
var hs = /* @__PURE__ */ __name((e) => !e || ["onLoad", "onError"].some((t) => t in e) || e.rel === "stylesheet" && (!("precedence" in e) || "disabled" in e) ? { tag: "link", props: e, type: "link", ref: e.ref } : Qe("link", e, 1, Dr(e), true), "hs");
var ps = /* @__PURE__ */ __name((e) => Qe("meta", e, void 0, false, false), "ps");
var Wr = /* @__PURE__ */ Symbol();
var ms = /* @__PURE__ */ __name((e) => {
  const { action: t, ...r } = e;
  typeof t != "function" && (r.action = t);
  const [n, s] = is([null, false]), i = $t(async (l) => {
    const f = l.isTrusted ? t : l.detail[Wr];
    if (typeof f != "function") return;
    l.preventDefault();
    const h = new FormData(l.target);
    s([h, true]);
    const u = f(h);
    u instanceof Promise && (ls(u), await u), s([null, true]);
  }, []), a = Mt(e.ref, (l) => (l.addEventListener("submit", i), () => {
    l.removeEventListener("submit", i);
  })), [o, c] = n;
  return n[1] = false, { tag: cs, props: { value: { pending: o !== null, data: o, method: o ? "post" : null, action: o ? t : null }, children: { tag: "form", props: { ...r, ref: a }, type: "form", ref: a } }, f: c };
}, "ms");
var zr = /* @__PURE__ */ __name((e, { formAction: t, ...r }) => {
  if (typeof t == "function") {
    const n = $t((s) => {
      s.preventDefault(), s.currentTarget.form.dispatchEvent(new CustomEvent("submit", { detail: { [Wr]: t } }));
    }, []);
    r.ref = Mt(r.ref, (s) => (s.addEventListener("click", n), () => {
      s.removeEventListener("click", n);
    }));
  }
  return { tag: e, props: r, type: e, ref: r.ref };
}, "zr");
var vs = /* @__PURE__ */ __name((e) => zr("input", e), "vs");
var gs = /* @__PURE__ */ __name((e) => zr("button", e), "gs");
Object.assign(At, { title: us, script: fs, style: ds, link: hs, meta: ps, form: ms, input: vs, button: gs });
Lt(null);
var ir = new TextEncoder();
var ys = /* @__PURE__ */ __name((e, t = console.trace) => {
  let r = false;
  return new ReadableStream({ async start(s) {
    var i;
    try {
      e instanceof M && (e = e.toString());
      const a = typeof e == "object" ? e : {}, o = await ct(e, we.BeforeStream, true, a);
      r || s.enqueue(ir.encode(o));
      let c = 0;
      const l = [], f = /* @__PURE__ */ __name((h) => {
        l.push(h.catch((u) => (console.log(u), t(u), "")).then(async (u) => {
          var p;
          u = await ct(u, we.BeforeStream, true, a), (p = u.callbacks) == null || p.map((m) => m({ phase: we.Stream, context: a })).filter(Boolean).forEach(f), c++, r || s.enqueue(ir.encode(u));
        }));
      }, "f");
      for ((i = o.callbacks) == null || i.map((h) => h({ phase: we.Stream, context: a })).filter(Boolean).forEach(f); c !== l.length; ) await Promise.all(l);
    } catch (a) {
      t(a);
    }
    r || s.close();
  }, cancel() {
    r = true;
  } });
}, "ys");
var _s = Lt(null);
var Es = /* @__PURE__ */ __name((e, t, r, n) => (s, i) => {
  n = typeof n == "function" ? n(e) : n;
  const a = typeof (n == null ? void 0 : n.docType) == "string" ? n.docType : (n == null ? void 0 : n.docType) === false ? "" : "<!DOCTYPE html>", o = r ? Gt((l) => r(l, e), { Layout: t, ...i }, s) : s, c = Ln`${P(a)}${Gt(_s.Provider, { value: e }, o)}`;
  if (n != null && n.stream) {
    if (n.stream === true) e.header("Transfer-Encoding", "chunked"), e.header("Content-Type", "text/html; charset=UTF-8"), e.header("Content-Encoding", "Identity");
    else for (const [l, f] of Object.entries(n.stream)) e.header(l, f);
    return e.body(ys(c));
  } else return e.html(c);
}, "Es");
var bs = /* @__PURE__ */ __name((e, t) => function(n, s) {
  const i = n.getLayout() ?? Vn;
  return e && n.setLayout((a) => e({ ...a, Layout: i }, n)), n.setRenderer(Es(n, i, e, t)), s();
}, "bs");
var ws = bs(({ children: e }) => $e("html", { children: [$e("head", { children: $e("link", { href: "/static/style.css", rel: "stylesheet" }) }), $e("body", { children: e })] }));
var Ft = new Dt();
Ft.use(ws);
Ft.get("/", (e) => e.render($e("h1", { children: "Hello!" })));
var ar = new Dt();
var xs = Object.assign({ "/src/index.ts": A, "/src/index.tsx": Ft });
var Kr = false;
for (const [, e] of Object.entries(xs)) e && (ar.all("*", (t) => {
  let r;
  try {
    r = t.executionCtx;
  } catch {
  }
  return e.fetch(t.req.raw, t.env, r);
}), ar.notFound((t) => {
  let r;
  try {
    r = t.executionCtx;
  } catch {
  }
  return e.fetch(t.req.raw, t.env, r);
}), Kr = true);
if (!Kr) throw new Error("Can't import modules from ['/src/index.ts','/src/index.tsx','/app/server.ts']");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-fmnnQj/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = ar;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-fmnnQj/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=bundledWorker-0.4114241824880899.mjs.map
