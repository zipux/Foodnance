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
  cursorTo(x2, y, callback) {
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
var Vr = Object.defineProperty;
var Ht = /* @__PURE__ */ __name((e) => {
  throw TypeError(e);
}, "Ht");
var Kr = /* @__PURE__ */ __name((e, t, r) => t in e ? Vr(e, t, { enumerable: true, configurable: true, writable: true, value: r }) : e[t] = r, "Kr");
var _ = /* @__PURE__ */ __name((e, t, r) => Kr(e, typeof t != "symbol" ? t + "" : t, r), "_");
var vt = /* @__PURE__ */ __name((e, t, r) => t.has(e) || Ht("Cannot " + r), "vt");
var p = /* @__PURE__ */ __name((e, t, r) => (vt(e, t, "read from private field"), r ? r.call(e) : t.get(e)), "p");
var R = /* @__PURE__ */ __name((e, t, r) => t.has(e) ? Ht("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, r), "R");
var b = /* @__PURE__ */ __name((e, t, r, n) => (vt(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r), "b");
var x = /* @__PURE__ */ __name((e, t, r) => (vt(e, t, "access private method"), r), "x");
var qt = /* @__PURE__ */ __name((e, t, r, n) => ({ set _(i) {
  b(e, t, i, r);
}, get _() {
  return p(e, t, n);
} }), "qt");
var Ft = /* @__PURE__ */ __name((e, t, r) => (n, i) => {
  let s = -1;
  return a(0);
  async function a(c) {
    if (c <= s) throw new Error("next() called multiple times");
    s = c;
    let o, u = false, l;
    if (e[c] ? (l = e[c][0][0], n.req.routeIndex = c) : l = c === e.length && i || void 0, l) try {
      o = await l(n, () => a(c + 1));
    } catch (f) {
      if (f instanceof Error && t) n.error = f, o = await t(f, n), u = true;
      else throw f;
    }
    else n.finalized === false && r && (o = await r(n));
    return o && (n.finalized === false || u) && (n.res = o), n;
  }
  __name(a, "a");
}, "Ft");
var Gr = /* @__PURE__ */ Symbol();
var Jr = /* @__PURE__ */ __name(async (e, t = /* @__PURE__ */ Object.create(null)) => {
  const { all: r = false, dot: n = false } = t, s = (e instanceof yr ? e.raw.headers : e.headers).get("Content-Type");
  return s != null && s.startsWith("multipart/form-data") || s != null && s.startsWith("application/x-www-form-urlencoded") ? Xr(e, { all: r, dot: n }) : {};
}, "Jr");
async function Xr(e, t) {
  const r = await e.formData();
  return r ? Zr(r, t) : {};
}
__name(Xr, "Xr");
function Zr(e, t) {
  const r = /* @__PURE__ */ Object.create(null);
  return e.forEach((n, i) => {
    t.all || i.endsWith("[]") ? Qr(r, i, n) : r[i] = n;
  }), t.dot && Object.entries(r).forEach(([n, i]) => {
    n.includes(".") && (en(r, n, i), delete r[n]);
  }), r;
}
__name(Zr, "Zr");
var Qr = /* @__PURE__ */ __name((e, t, r) => {
  e[t] !== void 0 ? Array.isArray(e[t]) ? e[t].push(r) : e[t] = [e[t], r] : t.endsWith("[]") ? e[t] = [r] : e[t] = r;
}, "Qr");
var en = /* @__PURE__ */ __name((e, t, r) => {
  if (/(?:^|\.)__proto__\./.test(t)) return;
  let n = e;
  const i = t.split(".");
  i.forEach((s, a) => {
    a === i.length - 1 ? n[s] = r : ((!n[s] || typeof n[s] != "object" || Array.isArray(n[s]) || n[s] instanceof File) && (n[s] = /* @__PURE__ */ Object.create(null)), n = n[s]);
  });
}, "en");
var pr = /* @__PURE__ */ __name((e) => {
  const t = e.split("/");
  return t[0] === "" && t.shift(), t;
}, "pr");
var tn = /* @__PURE__ */ __name((e) => {
  const { groups: t, path: r } = rn(e), n = pr(r);
  return nn(n, t);
}, "tn");
var rn = /* @__PURE__ */ __name((e) => {
  const t = [];
  return e = e.replace(/\{[^}]+\}/g, (r, n) => {
    const i = `@${n}`;
    return t.push([i, r]), i;
  }), { groups: t, path: e };
}, "rn");
var nn = /* @__PURE__ */ __name((e, t) => {
  for (let r = t.length - 1; r >= 0; r--) {
    const [n] = t[r];
    for (let i = e.length - 1; i >= 0; i--) if (e[i].includes(n)) {
      e[i] = e[i].replace(n, t[r][1]);
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
var hr = /* @__PURE__ */ __name((e) => {
  const t = e.url, r = t.indexOf("/", t.indexOf(":") + 4);
  let n = r;
  for (; n < t.length; n++) {
    const i = t.charCodeAt(n);
    if (i === 37) {
      const s = t.indexOf("?", n), a = t.indexOf("#", n), c = s === -1 ? a === -1 ? void 0 : a : a === -1 ? s : Math.min(s, a), o = t.slice(r, c);
      return an(o.includes("%25") ? o.replace(/%25/g, "%2525") : o);
    } else if (i === 63 || i === 35) break;
  }
  return t.slice(r, n);
}, "hr");
var on2 = /* @__PURE__ */ __name((e) => {
  const t = hr(e);
  return t.length > 1 && t.at(-1) === "/" ? t.slice(0, -1) : t;
}, "on");
var _e = /* @__PURE__ */ __name((e, t, ...r) => (r.length && (t = _e(t, ...r)), `${(e == null ? void 0 : e[0]) === "/" ? "" : "/"}${e}${t === "/" ? "" : `${(e == null ? void 0 : e.at(-1)) === "/" ? "" : "/"}${(t == null ? void 0 : t[0]) === "/" ? t.slice(1) : t}`}`), "_e");
var mr = /* @__PURE__ */ __name((e) => {
  if (e.charCodeAt(e.length - 1) !== 63 || !e.includes(":")) return null;
  const t = e.split("/"), r = [];
  let n = "";
  return t.forEach((i) => {
    if (i !== "" && !/\:/.test(i)) n += "/" + i;
    else if (/\:/.test(i)) if (/\?/.test(i)) {
      r.length === 0 && n === "" ? r.push("/") : r.push(n);
      const s = i.replace("?", "");
      n += "/" + s, r.push(n);
    } else n += "/" + i;
  }), r.filter((i, s, a) => a.indexOf(i) === s);
}, "mr");
var gt = /* @__PURE__ */ __name((e) => /[%+]/.test(e) ? (e.indexOf("+") !== -1 && (e = e.replace(/\+/g, " ")), e.indexOf("%") !== -1 ? Ct(e, gr) : e) : e, "gt");
var vr = /* @__PURE__ */ __name((e, t, r) => {
  let n;
  if (!r && t && !/[%+]/.test(t)) {
    let a = e.indexOf("?", 8);
    if (a === -1) return;
    for (e.startsWith(t, a + 1) || (a = e.indexOf(`&${t}`, a + 1)); a !== -1; ) {
      const c = e.charCodeAt(a + t.length + 1);
      if (c === 61) {
        const o = a + t.length + 2, u = e.indexOf("&", o);
        return gt(e.slice(o, u === -1 ? void 0 : u));
      } else if (c == 38 || isNaN(c)) return "";
      a = e.indexOf(`&${t}`, a + 1);
    }
    if (n = /[%+]/.test(e), !n) return;
  }
  const i = {};
  n ?? (n = /[%+]/.test(e));
  let s = e.indexOf("?", 8);
  for (; s !== -1; ) {
    const a = e.indexOf("&", s + 1);
    let c = e.indexOf("=", s);
    c > a && a !== -1 && (c = -1);
    let o = e.slice(s + 1, c === -1 ? a === -1 ? void 0 : a : c);
    if (n && (o = gt(o)), s = a, o === "") continue;
    let u;
    c === -1 ? u = "" : (u = e.slice(c + 1, a === -1 ? void 0 : a), n && (u = gt(u))), r ? (i[o] && Array.isArray(i[o]) || (i[o] = []), i[o].push(u)) : i[o] ?? (i[o] = u);
  }
  return t ? i[t] : i;
}, "vr");
var cn = vr;
var ln = /* @__PURE__ */ __name((e, t) => vr(e, t, true), "ln");
var gr = decodeURIComponent;
var Ut = /* @__PURE__ */ __name((e) => Ct(e, gr), "Ut");
var Re;
var B;
var Z;
var _r;
var Er;
var Tt;
var Q;
var or;
var yr = (or = class {
  static {
    __name(this, "or");
  }
  constructor(e, t = "/", r = [[]]) {
    R(this, Z);
    _(this, "raw");
    R(this, Re);
    R(this, B);
    _(this, "routeIndex", 0);
    _(this, "path");
    _(this, "bodyCache", {});
    R(this, Q, (e2) => {
      const { bodyCache: t2, raw: r2 } = this, n = t2[e2];
      if (n) return n;
      const i = Object.keys(t2)[0];
      return i ? t2[i].then((s) => (i === "json" && (s = JSON.stringify(s)), new Response(s)[e2]())) : t2[e2] = r2[e2]();
    });
    this.raw = e, this.path = t, b(this, B, r), b(this, Re, {});
  }
  param(e) {
    return e ? x(this, Z, _r).call(this, e) : x(this, Z, Er).call(this);
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
    return (t = this.bodyCache).parsedBody ?? (t.parsedBody = await Jr(this, e));
  }
  json() {
    return p(this, Q).call(this, "text").then((e) => JSON.parse(e));
  }
  text() {
    return p(this, Q).call(this, "text");
  }
  arrayBuffer() {
    return p(this, Q).call(this, "arrayBuffer");
  }
  blob() {
    return p(this, Q).call(this, "blob");
  }
  formData() {
    return p(this, Q).call(this, "formData");
  }
  addValidatedData(e, t) {
    p(this, Re)[e] = t;
  }
  valid(e) {
    return p(this, Re)[e];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [Gr]() {
    return p(this, B);
  }
  get matchedRoutes() {
    return p(this, B)[0].map(([[, e]]) => e);
  }
  get routePath() {
    return p(this, B)[0].map(([[, e]]) => e)[this.routeIndex].path;
  }
}, Re = /* @__PURE__ */ new WeakMap(), B = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakSet(), _r = /* @__PURE__ */ __name(function(e) {
  const t = p(this, B)[0][this.routeIndex][1][e], r = x(this, Z, Tt).call(this, t);
  return r && /\%/.test(r) ? Ut(r) : r;
}, "_r"), Er = /* @__PURE__ */ __name(function() {
  const e = {}, t = Object.keys(p(this, B)[0][this.routeIndex][1]);
  for (const r of t) {
    const n = x(this, Z, Tt).call(this, p(this, B)[0][this.routeIndex][1][r]);
    n !== void 0 && (e[r] = /\%/.test(n) ? Ut(n) : n);
  }
  return e;
}, "Er"), Tt = /* @__PURE__ */ __name(function(e) {
  return p(this, B)[1] ? p(this, B)[1][e] : e;
}, "Tt"), Q = /* @__PURE__ */ new WeakMap(), or);
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
  for (let i = n.length - 1; r += n[i], i--, !(i < 0); i--) {
    let s = n[i];
    typeof s == "object" && t.push(...s.callbacks || []);
    const a = s.isEscaped;
    if (s = await (typeof s == "object" ? s.toString() : s), typeof s == "object" && t.push(...s.callbacks || []), s.isEscaped ?? a) r += s;
    else {
      const c = [r];
      se(s, c), r = c[0];
    }
  }
  return P(r, t);
}, "br");
var se = /* @__PURE__ */ __name((e, t) => {
  const r = e.search(un);
  if (r === -1) {
    t[0] += e;
    return;
  }
  let n, i, s = 0;
  for (i = r; i < e.length; i++) {
    switch (e.charCodeAt(i)) {
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
    t[0] += e.substring(s, i) + n, s = i + 1;
  }
  t[0] += e.substring(s, i);
}, "se");
var wr = /* @__PURE__ */ __name((e) => {
  const t = e.callbacks;
  if (!(t != null && t.length)) return e;
  const r = [e], n = {};
  return t.forEach((i) => i({ phase: we.Stringify, buffer: r, context: n })), r[0];
}, "wr");
var ct = /* @__PURE__ */ __name(async (e, t, r, n, i) => {
  typeof e == "object" && !(e instanceof String) && (e instanceof Promise || (e = e.toString()), e instanceof Promise && (e = await e));
  const s = e.callbacks;
  if (!(s != null && s.length)) return Promise.resolve(e);
  i ? i[0] += e : i = [e];
  const a = Promise.all(s.map((c) => c({ phase: t, buffer: i, context: n }))).then((c) => Promise.all(c.filter(Boolean).map((o) => ct(o, t, false, n, i))).then(() => i[0]));
  return r ? P(await a, s) : a;
}, "ct");
var dn = "text/plain; charset=UTF-8";
var yt = /* @__PURE__ */ __name((e, t) => ({ "Content-Type": e, ...t }), "yt");
var Ne = /* @__PURE__ */ __name((e, t) => new Response(e, t), "Ne");
var We;
var ze;
var K;
var Se;
var G;
var N;
var Ye;
var ke;
var Te;
var le;
var Ve;
var Ke;
var ee;
var Ee;
var cr;
var fn = (cr = class {
  static {
    __name(this, "cr");
  }
  constructor(e, t) {
    R(this, ee);
    R(this, We);
    R(this, ze);
    _(this, "env", {});
    R(this, K);
    _(this, "finalized", false);
    _(this, "error");
    R(this, Se);
    R(this, G);
    R(this, N);
    R(this, Ye);
    R(this, ke);
    R(this, Te);
    R(this, le);
    R(this, Ve);
    R(this, Ke);
    _(this, "render", (...e2) => (p(this, ke) ?? b(this, ke, (t2) => this.html(t2)), p(this, ke).call(this, ...e2)));
    _(this, "setLayout", (e2) => b(this, Ye, e2));
    _(this, "getLayout", () => p(this, Ye));
    _(this, "setRenderer", (e2) => {
      b(this, ke, e2);
    });
    _(this, "header", (e2, t2, r) => {
      this.finalized && b(this, N, Ne(p(this, N).body, p(this, N)));
      const n = p(this, N) ? p(this, N).headers : p(this, le) ?? b(this, le, new Headers());
      t2 === void 0 ? n.delete(e2) : r != null && r.append ? n.append(e2, t2) : n.set(e2, t2);
    });
    _(this, "status", (e2) => {
      b(this, Se, e2);
    });
    _(this, "set", (e2, t2) => {
      p(this, K) ?? b(this, K, /* @__PURE__ */ new Map()), p(this, K).set(e2, t2);
    });
    _(this, "get", (e2) => p(this, K) ? p(this, K).get(e2) : void 0);
    _(this, "newResponse", (...e2) => x(this, ee, Ee).call(this, ...e2));
    _(this, "body", (e2, t2, r) => x(this, ee, Ee).call(this, e2, t2, r));
    _(this, "text", (e2, t2, r) => !p(this, le) && !p(this, Se) && !t2 && !r && !this.finalized ? new Response(e2) : x(this, ee, Ee).call(this, e2, t2, yt(dn, r)));
    _(this, "json", (e2, t2, r) => x(this, ee, Ee).call(this, JSON.stringify(e2), t2, yt("application/json", r)));
    _(this, "html", (e2, t2, r) => {
      const n = /* @__PURE__ */ __name((i) => x(this, ee, Ee).call(this, i, t2, yt("text/html; charset=UTF-8", r)), "n");
      return typeof e2 == "object" ? ct(e2, we.Stringify, false, {}).then(n) : n(e2);
    });
    _(this, "redirect", (e2, t2) => {
      const r = String(e2);
      return this.header("Location", /[^\x00-\xFF]/.test(r) ? encodeURI(r) : r), this.newResponse(null, t2 ?? 302);
    });
    _(this, "notFound", () => (p(this, Te) ?? b(this, Te, () => Ne()), p(this, Te).call(this, this)));
    b(this, We, e), t && (b(this, G, t.executionCtx), this.env = t.env, b(this, Te, t.notFoundHandler), b(this, Ke, t.path), b(this, Ve, t.matchResult));
  }
  get req() {
    return p(this, ze) ?? b(this, ze, new yr(p(this, We), p(this, Ke), p(this, Ve))), p(this, ze);
  }
  get event() {
    if (p(this, G) && "respondWith" in p(this, G)) return p(this, G);
    throw Error("This context has no FetchEvent");
  }
  get executionCtx() {
    if (p(this, G)) return p(this, G);
    throw Error("This context has no ExecutionContext");
  }
  get res() {
    return p(this, N) || b(this, N, Ne(null, { headers: p(this, le) ?? b(this, le, new Headers()) }));
  }
  set res(e) {
    if (p(this, N) && e) {
      e = Ne(e.body, e);
      for (const [t, r] of p(this, N).headers.entries()) if (t !== "content-type") if (t === "set-cookie") {
        const n = p(this, N).headers.getSetCookie();
        e.headers.delete("set-cookie");
        for (const i of n) e.headers.append("set-cookie", i);
      } else e.headers.set(t, r);
    }
    b(this, N, e), this.finalized = true;
  }
  get var() {
    return p(this, K) ? Object.fromEntries(p(this, K)) : {};
  }
}, We = /* @__PURE__ */ new WeakMap(), ze = /* @__PURE__ */ new WeakMap(), K = /* @__PURE__ */ new WeakMap(), Se = /* @__PURE__ */ new WeakMap(), G = /* @__PURE__ */ new WeakMap(), N = /* @__PURE__ */ new WeakMap(), Ye = /* @__PURE__ */ new WeakMap(), ke = /* @__PURE__ */ new WeakMap(), Te = /* @__PURE__ */ new WeakMap(), le = /* @__PURE__ */ new WeakMap(), Ve = /* @__PURE__ */ new WeakMap(), Ke = /* @__PURE__ */ new WeakMap(), ee = /* @__PURE__ */ new WeakSet(), Ee = /* @__PURE__ */ __name(function(e, t, r) {
  const n = p(this, N) ? new Headers(p(this, N).headers) : p(this, le) ?? new Headers();
  if (typeof t == "object" && "headers" in t) {
    const s = t.headers instanceof Headers ? t.headers : new Headers(t.headers);
    for (const [a, c] of s) a.toLowerCase() === "set-cookie" ? n.append(a, c) : n.set(a, c);
  }
  if (r) for (const [s, a] of Object.entries(r)) if (typeof a == "string") n.set(s, a);
  else {
    n.delete(s);
    for (const c of a) n.append(s, c);
  }
  const i = typeof t == "number" ? t : (t == null ? void 0 : t.status) ?? p(this, Se);
  return Ne(e, { status: i, headers: n });
}, "Ee"), cr);
var C = "ALL";
var pn = "all";
var hn = ["get", "post", "put", "delete", "options", "patch"];
var Rr = "Can not add a route since the matcher is already built.";
var Sr = class extends Error {
  static {
    __name(this, "Sr");
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
var F;
var L;
var kr;
var U;
var ae;
var rt;
var nt;
var Oe;
var gn = (Oe = class {
  static {
    __name(this, "Oe");
  }
  constructor(t = {}) {
    R(this, L);
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
    R(this, F, "/");
    _(this, "routes", []);
    R(this, U, vn);
    _(this, "errorHandler", Wt);
    _(this, "onError", (t2) => (this.errorHandler = t2, this));
    _(this, "notFound", (t2) => (b(this, U, t2), this));
    _(this, "fetch", (t2, ...r) => x(this, L, nt).call(this, t2, r[1], r[0], t2.method));
    _(this, "request", (t2, r, n2, i2) => t2 instanceof Request ? this.fetch(r ? new Request(t2, r) : t2, n2, i2) : (t2 = t2.toString(), this.fetch(new Request(/^https?:\/\//.test(t2) ? t2 : `http://localhost${_e("/", t2)}`, r), n2, i2)));
    _(this, "fire", () => {
      addEventListener("fetch", (t2) => {
        t2.respondWith(x(this, L, nt).call(this, t2.request, t2, void 0, t2.request.method));
      });
    });
    [...hn, pn].forEach((s) => {
      this[s] = (a, ...c) => (typeof a == "string" ? b(this, F, a) : x(this, L, ae).call(this, s, p(this, F), a), c.forEach((o) => {
        x(this, L, ae).call(this, s, p(this, F), o);
      }), this);
    }), this.on = (s, a, ...c) => {
      for (const o of [a].flat()) {
        b(this, F, o);
        for (const u of [s].flat()) c.map((l) => {
          x(this, L, ae).call(this, u.toUpperCase(), p(this, F), l);
        });
      }
      return this;
    }, this.use = (s, ...a) => (typeof s == "string" ? b(this, F, s) : (b(this, F, "*"), a.unshift(s)), a.forEach((c) => {
      x(this, L, ae).call(this, C, p(this, F), c);
    }), this);
    const { strict: n, ...i } = t;
    Object.assign(this, i), this.getPath = n ?? true ? t.getPath ?? hr : on2;
  }
  route(t, r) {
    const n = this.basePath(t);
    return r.routes.map((i) => {
      var a;
      let s;
      r.errorHandler === Wt ? s = i.handler : (s = /* @__PURE__ */ __name(async (c, o) => (await Ft([], r.errorHandler)(c, () => i.handler(c, o))).res, "s"), s[mn] = i.handler), x(a = n, L, ae).call(a, i.method, i.path, s);
    }), this;
  }
  basePath(t) {
    const r = x(this, L, kr).call(this);
    return r._basePath = _e(this._basePath, t), r;
  }
  mount(t, r, n) {
    let i, s;
    n && (typeof n == "function" ? s = n : (s = n.optionHandler, n.replaceRequest === false ? i = /* @__PURE__ */ __name((o) => o, "i") : i = n.replaceRequest));
    const a = s ? (o) => {
      const u = s(o);
      return Array.isArray(u) ? u : [u];
    } : (o) => {
      let u;
      try {
        u = o.executionCtx;
      } catch {
      }
      return [o.env, u];
    };
    i || (i = (() => {
      const o = _e(this._basePath, t), u = o === "/" ? 0 : o.length;
      return (l) => {
        const f = new URL(l.url);
        return f.pathname = f.pathname.slice(u) || "/", new Request(f, l);
      };
    })());
    const c = /* @__PURE__ */ __name(async (o, u) => {
      const l = await r(i(o.req.raw), ...a(o));
      if (l) return l;
      await u();
    }, "c");
    return x(this, L, ae).call(this, C, _e(t, "*"), c), this;
  }
}, F = /* @__PURE__ */ new WeakMap(), L = /* @__PURE__ */ new WeakSet(), kr = /* @__PURE__ */ __name(function() {
  const t = new Oe({ router: this.router, getPath: this.getPath });
  return t.errorHandler = this.errorHandler, b(t, U, p(this, U)), t.routes = this.routes, t;
}, "kr"), U = /* @__PURE__ */ new WeakMap(), ae = /* @__PURE__ */ __name(function(t, r, n) {
  t = t.toUpperCase(), r = _e(this._basePath, r);
  const i = { basePath: this._basePath, path: r, method: t, handler: n };
  this.router.add(t, r, [n, i]), this.routes.push(i);
}, "ae"), rt = /* @__PURE__ */ __name(function(t, r) {
  if (t instanceof Error) return this.errorHandler(t, r);
  throw t;
}, "rt"), nt = /* @__PURE__ */ __name(function(t, r, n, i) {
  if (i === "HEAD") return (async () => new Response(null, await x(this, L, nt).call(this, t, r, n, "GET")))();
  const s = this.getPath(t, { env: n }), a = this.router.match(i, s), c = new fn(t, { path: s, matchResult: a, env: n, executionCtx: r, notFoundHandler: p(this, U) });
  if (a[0].length === 1) {
    let u;
    try {
      u = a[0][0][0][0](c, async () => {
        c.res = await p(this, U).call(this, c);
      });
    } catch (l) {
      return x(this, L, rt).call(this, l, c);
    }
    return u instanceof Promise ? u.then((l) => l || (c.finalized ? c.res : p(this, U).call(this, c))).catch((l) => x(this, L, rt).call(this, l, c)) : u ?? p(this, U).call(this, c);
  }
  const o = Ft(a[0], this.errorHandler, p(this, U));
  return (async () => {
    try {
      const u = await o(c);
      if (!u.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
      return u.res;
    } catch (u) {
      return x(this, L, rt).call(this, u, c);
    }
  })();
}, "nt"), Oe);
var Tr = [];
function yn(e, t) {
  const r = this.buildAllMatchers(), n = /* @__PURE__ */ __name(((i, s) => {
    const a = r[i] || r[C], c = a[2][s];
    if (c) return c;
    const o = s.match(a[0]);
    if (!o) return [[], Tr];
    const u = o.indexOf("", 1);
    return [a[1][u], o];
  }), "n");
  return this.match = n, n(e, t);
}
__name(yn, "yn");
var lt = "[^/]+";
var Be = ".*";
var He = "(?:|/.*)";
var be = /* @__PURE__ */ Symbol();
var _n = new Set(".\\+*[^]$()");
function En(e, t) {
  return e.length === 1 ? t.length === 1 ? e < t ? -1 : 1 : -1 : t.length === 1 || e === Be || e === He ? 1 : t === Be || t === He ? -1 : e === lt ? 1 : t === lt ? -1 : e.length === t.length ? e < t ? -1 : 1 : t.length - e.length;
}
__name(En, "En");
var ue;
var de;
var W;
var he;
var bn = (he = class {
  static {
    __name(this, "he");
  }
  constructor() {
    R(this, ue);
    R(this, de);
    R(this, W, /* @__PURE__ */ Object.create(null));
  }
  insert(t, r, n, i, s) {
    if (t.length === 0) {
      if (p(this, ue) !== void 0) throw be;
      if (s) return;
      b(this, ue, r);
      return;
    }
    const [a, ...c] = t, o = a === "*" ? c.length === 0 ? ["", "", Be] : ["", "", lt] : a === "/*" ? ["", "", He] : a.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let u;
    if (o) {
      const l = o[1];
      let f = o[2] || lt;
      if (l && o[2] && (f === ".*" || (f = f.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:"), /\((?!\?:)/.test(f)))) throw be;
      if (u = p(this, W)[f], !u) {
        if (Object.keys(p(this, W)).some((d) => d !== Be && d !== He)) throw be;
        if (s) return;
        u = p(this, W)[f] = new he(), l !== "" && b(u, de, i.varIndex++);
      }
      !s && l !== "" && n.push([l, p(u, de)]);
    } else if (u = p(this, W)[a], !u) {
      if (Object.keys(p(this, W)).some((l) => l.length > 1 && l !== Be && l !== He)) throw be;
      if (s) return;
      u = p(this, W)[a] = new he();
    }
    u.insert(c, r, n, i, s);
  }
  buildRegExpStr() {
    const r = Object.keys(p(this, W)).sort(En).map((n) => {
      const i = p(this, W)[n];
      return (typeof p(i, de) == "number" ? `(${n})@${p(i, de)}` : _n.has(n) ? `\\${n}` : n) + i.buildRegExpStr();
    });
    return typeof p(this, ue) == "number" && r.unshift(`#${p(this, ue)}`), r.length === 0 ? "" : r.length === 1 ? r[0] : "(?:" + r.join("|") + ")";
  }
}, ue = /* @__PURE__ */ new WeakMap(), de = /* @__PURE__ */ new WeakMap(), W = /* @__PURE__ */ new WeakMap(), he);
var pt;
var Ge;
var lr;
var wn = (lr = class {
  static {
    __name(this, "lr");
  }
  constructor() {
    R(this, pt, { varIndex: 0 });
    R(this, Ge, new bn());
  }
  insert(e, t, r) {
    const n = [], i = [];
    for (let a = 0; ; ) {
      let c = false;
      if (e = e.replace(/\{[^}]+\}/g, (o) => {
        const u = `@\\${a}`;
        return i[a] = [u, o], a++, c = true, u;
      }), !c) break;
    }
    const s = e.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let a = i.length - 1; a >= 0; a--) {
      const [c] = i[a];
      for (let o = s.length - 1; o >= 0; o--) if (s[o].indexOf(c) !== -1) {
        s[o] = s[o].replace(c, i[a][1]);
        break;
      }
    }
    return p(this, Ge).insert(s, t, n, p(this, pt), r), n;
  }
  buildRegExp() {
    let e = p(this, Ge).buildRegExpStr();
    if (e === "") return [/^$/, [], []];
    let t = 0;
    const r = [], n = [];
    return e = e.replace(/#(\d+)|@(\d+)|\.\*\$/g, (i, s, a) => s !== void 0 ? (r[++t] = Number(s), "$()") : (a !== void 0 && (n[Number(a)] = ++t), "")), [new RegExp(`^${e}`), r, n];
  }
}, pt = /* @__PURE__ */ new WeakMap(), Ge = /* @__PURE__ */ new WeakMap(), lr);
var Rn = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var it = /* @__PURE__ */ Object.create(null);
function Or(e) {
  return it[e] ?? (it[e] = new RegExp(e === "*" ? "" : `^${e.replace(/\/\*$|([.\\+*[^\]$()])/g, (t, r) => r ? `\\${r}` : "(?:|/.*)")}$`));
}
__name(Or, "Or");
function Sn() {
  it = /* @__PURE__ */ Object.create(null);
}
__name(Sn, "Sn");
function kn(e) {
  var u;
  const t = new wn(), r = [];
  if (e.length === 0) return Rn;
  const n = e.map((l) => [!/\*|\/:/.test(l[0]), ...l]).sort(([l, f], [d, h]) => l ? 1 : d ? -1 : f.length - h.length), i = /* @__PURE__ */ Object.create(null);
  for (let l = 0, f = -1, d = n.length; l < d; l++) {
    const [h, v, m] = n[l];
    h ? i[v] = [m.map(([y]) => [y, /* @__PURE__ */ Object.create(null)]), Tr] : f++;
    let g;
    try {
      g = t.insert(v, f, h);
    } catch (y) {
      throw y === be ? new Sr(v) : y;
    }
    h || (r[f] = m.map(([y, E]) => {
      const w = /* @__PURE__ */ Object.create(null);
      for (E -= 1; E >= 0; E--) {
        const [S, O] = g[E];
        w[S] = O;
      }
      return [y, w];
    }));
  }
  const [s, a, c] = t.buildRegExp();
  for (let l = 0, f = r.length; l < f; l++) for (let d = 0, h = r[l].length; d < h; d++) {
    const v = (u = r[l][d]) == null ? void 0 : u[1];
    if (!v) continue;
    const m = Object.keys(v);
    for (let g = 0, y = m.length; g < y; g++) v[m[g]] = c[v[m[g]]];
  }
  const o = [];
  for (const l in a) o[l] = r[a[l]];
  return [s, o, i];
}
__name(kn, "kn");
function ge(e, t) {
  if (e) {
    for (const r of Object.keys(e).sort((n, i) => i.length - n.length)) if (Or(r).test(t)) return [...e[r]];
  }
}
__name(ge, "ge");
var te;
var re;
var ht;
var xr;
var ur;
var Tn = (ur = class {
  static {
    __name(this, "ur");
  }
  constructor() {
    R(this, ht);
    _(this, "name", "RegExpRouter");
    R(this, te);
    R(this, re);
    _(this, "match", yn);
    b(this, te, { [C]: /* @__PURE__ */ Object.create(null) }), b(this, re, { [C]: /* @__PURE__ */ Object.create(null) });
  }
  add(e, t, r) {
    var c;
    const n = p(this, te), i = p(this, re);
    if (!n || !i) throw new Error(Rr);
    n[e] || [n, i].forEach((o) => {
      o[e] = /* @__PURE__ */ Object.create(null), Object.keys(o[C]).forEach((u) => {
        o[e][u] = [...o[C][u]];
      });
    }), t === "/*" && (t = "*");
    const s = (t.match(/\/:/g) || []).length;
    if (/\*$/.test(t)) {
      const o = Or(t);
      e === C ? Object.keys(n).forEach((u) => {
        var l;
        (l = n[u])[t] || (l[t] = ge(n[u], t) || ge(n[C], t) || []);
      }) : (c = n[e])[t] || (c[t] = ge(n[e], t) || ge(n[C], t) || []), Object.keys(n).forEach((u) => {
        (e === C || e === u) && Object.keys(n[u]).forEach((l) => {
          o.test(l) && n[u][l].push([r, s]);
        });
      }), Object.keys(i).forEach((u) => {
        (e === C || e === u) && Object.keys(i[u]).forEach((l) => o.test(l) && i[u][l].push([r, s]));
      });
      return;
    }
    const a = mr(t) || [t];
    for (let o = 0, u = a.length; o < u; o++) {
      const l = a[o];
      Object.keys(i).forEach((f) => {
        var d;
        (e === C || e === f) && ((d = i[f])[l] || (d[l] = [...ge(n[f], l) || ge(n[C], l) || []]), i[f][l].push([r, s - u + o + 1]));
      });
    }
  }
  buildAllMatchers() {
    const e = /* @__PURE__ */ Object.create(null);
    return Object.keys(p(this, re)).concat(Object.keys(p(this, te))).forEach((t) => {
      e[t] || (e[t] = x(this, ht, xr).call(this, t));
    }), b(this, te, b(this, re, void 0)), Sn(), e;
  }
}, te = /* @__PURE__ */ new WeakMap(), re = /* @__PURE__ */ new WeakMap(), ht = /* @__PURE__ */ new WeakSet(), xr = /* @__PURE__ */ __name(function(e) {
  const t = [];
  let r = e === C;
  return [p(this, te), p(this, re)].forEach((n) => {
    const i = n[e] ? Object.keys(n[e]).map((s) => [s, n[e][s]]) : [];
    i.length !== 0 ? (r || (r = true), t.push(...i)) : e !== C && t.push(...Object.keys(n[C]).map((s) => [s, n[C][s]]));
  }), r ? kn(t) : null;
}, "xr"), ur);
var ne;
var J;
var dr;
var On = (dr = class {
  static {
    __name(this, "dr");
  }
  constructor(e) {
    _(this, "name", "SmartRouter");
    R(this, ne, []);
    R(this, J, []);
    b(this, ne, e.routers);
  }
  add(e, t, r) {
    if (!p(this, J)) throw new Error(Rr);
    p(this, J).push([e, t, r]);
  }
  match(e, t) {
    if (!p(this, J)) throw new Error("Fatal error");
    const r = p(this, ne), n = p(this, J), i = r.length;
    let s = 0, a;
    for (; s < i; s++) {
      const c = r[s];
      try {
        for (let o = 0, u = n.length; o < u; o++) c.add(...n[o]);
        a = c.match(e, t);
      } catch (o) {
        if (o instanceof Sr) continue;
        throw o;
      }
      this.match = c.match.bind(c), b(this, ne, [c]), b(this, J, void 0);
      break;
    }
    if (s === i) throw new Error("Fatal error");
    return this.name = `SmartRouter + ${this.activeRouter.name}`, a;
  }
  get activeRouter() {
    if (p(this, J) || p(this, ne).length !== 1) throw new Error("No active router has been determined yet.");
    return p(this, ne)[0];
  }
}, ne = /* @__PURE__ */ new WeakMap(), J = /* @__PURE__ */ new WeakMap(), dr);
var Ie = /* @__PURE__ */ Object.create(null);
var xn = /* @__PURE__ */ __name((e) => {
  for (const t in e) return true;
  return false;
}, "xn");
var ie;
var M;
var fe;
var xe;
var j;
var X;
var oe;
var De;
var Dn = (De = class {
  static {
    __name(this, "De");
  }
  constructor(t, r, n) {
    R(this, X);
    R(this, ie);
    R(this, M);
    R(this, fe);
    R(this, xe, 0);
    R(this, j, Ie);
    if (b(this, M, n || /* @__PURE__ */ Object.create(null)), b(this, ie, []), t && r) {
      const i = /* @__PURE__ */ Object.create(null);
      i[t] = { handler: r, possibleKeys: [], score: 0 }, b(this, ie, [i]);
    }
    b(this, fe, []);
  }
  insert(t, r, n) {
    b(this, xe, ++qt(this, xe)._);
    let i = this;
    const s = tn(r), a = [];
    for (let c = 0, o = s.length; c < o; c++) {
      const u = s[c], l = s[c + 1], f = sn(u, l), d = Array.isArray(f) ? f[0] : u;
      if (d in p(i, M)) {
        i = p(i, M)[d], f && a.push(f[1]);
        continue;
      }
      p(i, M)[d] = new De(), f && (p(i, fe).push(f), a.push(f[1])), i = p(i, M)[d];
    }
    return p(i, ie).push({ [t]: { handler: n, possibleKeys: a.filter((c, o, u) => u.indexOf(c) === o), score: p(this, xe) } }), i;
  }
  search(t, r) {
    var l;
    const n = [];
    b(this, j, Ie);
    let s = [this];
    const a = pr(r), c = [], o = a.length;
    let u = null;
    for (let f = 0; f < o; f++) {
      const d = a[f], h = f === o - 1, v = [];
      for (let g = 0, y = s.length; g < y; g++) {
        const E = s[g], w = p(E, M)[d];
        w && (b(w, j, p(E, j)), h ? (p(w, M)["*"] && x(this, X, oe).call(this, n, p(w, M)["*"], t, p(E, j)), x(this, X, oe).call(this, n, w, t, p(E, j))) : v.push(w));
        for (let S = 0, O = p(E, fe).length; S < O; S++) {
          const k = p(E, fe)[S], D = p(E, j) === Ie ? {} : { ...p(E, j) };
          if (k === "*") {
            const me = p(E, M)["*"];
            me && (x(this, X, oe).call(this, n, me, t, p(E, j)), b(me, j, D), v.push(me));
            continue;
          }
          const [q, I, z] = k;
          if (!d && !(z instanceof RegExp)) continue;
          const Y = p(E, M)[q];
          if (z instanceof RegExp) {
            if (u === null) {
              u = new Array(o);
              let ve = r[0] === "/" ? 1 : 0;
              for (let Me = 0; Me < o; Me++) u[Me] = ve, ve += a[Me].length + 1;
            }
            const me = r.substring(u[f]), mt = z.exec(me);
            if (mt) {
              if (D[I] = mt[0], x(this, X, oe).call(this, n, Y, t, p(E, j), D), xn(p(Y, M))) {
                b(Y, j, D);
                const ve = ((l = mt[0].match(/\//)) == null ? void 0 : l.length) ?? 0;
                (c[ve] || (c[ve] = [])).push(Y);
              }
              continue;
            }
          }
          (z === true || z.test(d)) && (D[I] = d, h ? (x(this, X, oe).call(this, n, Y, t, D, p(E, j)), p(Y, M)["*"] && x(this, X, oe).call(this, n, p(Y, M)["*"], t, D, p(E, j))) : (b(Y, j, D), v.push(Y)));
        }
      }
      const m = c.shift();
      s = m ? v.concat(m) : v;
    }
    return n.length > 1 && n.sort((f, d) => f.score - d.score), [n.map(({ handler: f, params: d }) => [f, d])];
  }
}, ie = /* @__PURE__ */ new WeakMap(), M = /* @__PURE__ */ new WeakMap(), fe = /* @__PURE__ */ new WeakMap(), xe = /* @__PURE__ */ new WeakMap(), j = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakSet(), oe = /* @__PURE__ */ __name(function(t, r, n, i, s) {
  for (let a = 0, c = p(r, ie).length; a < c; a++) {
    const o = p(r, ie)[a], u = o[n] || o[C], l = {};
    if (u !== void 0 && (u.params = /* @__PURE__ */ Object.create(null), t.push(u), i !== Ie || s && s !== Ie)) for (let f = 0, d = u.possibleKeys.length; f < d; f++) {
      const h = u.possibleKeys[f], v = l[u.score];
      u.params[h] = s != null && s[h] && !v ? s[h] : i[h] ?? (s == null ? void 0 : s[h]), l[u.score] = true;
    }
  }
}, "oe"), De);
var pe;
var fr;
var An = (fr = class {
  static {
    __name(this, "fr");
  }
  constructor() {
    _(this, "name", "TrieRouter");
    R(this, pe);
    b(this, pe, new Dn());
  }
  add(e, t, r) {
    const n = mr(t);
    if (n) {
      for (let i = 0, s = n.length; i < s; i++) p(this, pe).insert(e, n[i], r);
      return;
    }
    p(this, pe).insert(e, t, r);
  }
  match(e, t) {
    return p(this, pe).search(e, t);
  }
}, pe = /* @__PURE__ */ new WeakMap(), fr);
var Lt = class extends gn {
  static {
    __name(this, "Lt");
  }
  constructor(e = {}) {
    super(e), this.router = e.router ?? new On({ routers: [new Tn(), new An()] });
  }
};
var Cn = /* @__PURE__ */ __name((e) => {
  const r = { ...{ origin: "*", allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"], allowHeaders: [], exposeHeaders: [] }, ...e }, n = /* @__PURE__ */ ((s) => typeof s == "string" ? s === "*" ? () => s : (a) => s === a ? a : null : typeof s == "function" ? s : (a) => s.includes(a) ? a : null)(r.origin), i = ((s) => typeof s == "function" ? s : Array.isArray(s) ? () => s : () => [])(r.allowMethods);
  return async function(a, c) {
    var l;
    function o(f, d) {
      a.res.headers.set(f, d);
    }
    __name(o, "o");
    const u = await n(a.req.header("origin") || "", a);
    if (u && o("Access-Control-Allow-Origin", u), r.credentials && o("Access-Control-Allow-Credentials", "true"), (l = r.exposeHeaders) != null && l.length && o("Access-Control-Expose-Headers", r.exposeHeaders.join(",")), a.req.method === "OPTIONS") {
      r.origin !== "*" && o("Vary", "Origin"), r.maxAge != null && o("Access-Control-Max-Age", r.maxAge.toString());
      const f = await i(a.req.header("origin") || "", a);
      f.length && o("Access-Control-Allow-Methods", f.join(","));
      let d = r.allowHeaders;
      if (!(d != null && d.length)) {
        const h = a.req.header("Access-Control-Request-Headers");
        h && (d = h.split(/\s*,\s*/));
      }
      return d != null && d.length && (o("Access-Control-Allow-Headers", d.join(",")), a.res.headers.append("Vary", "Access-Control-Request-Headers")), a.res.headers.delete("Content-Length"), a.res.headers.delete("Content-Type"), new Response(null, { headers: a.res.headers, status: 204, statusText: "No Content" });
    }
    await c(), r.origin !== "*" && a.header("Vary", "Origin", { append: true });
  };
}, "Cn");
var T = new Lt();
T.use("*", Cn());
function $() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
__name($, "$");
function Ln(e) {
  const t = (e || "").trim();
  if (!t) return { packQty: 1, packUnit: "Each" };
  const r = "(?:kg|g|lb|lbs|l|ml|oz|fl\\s*oz|gal)", n = t.match(new RegExp(`^([\\d.]+)\\s*[\xD7xX]\\s*([\\d.]+)\\s*(${r})\\b`, "i"));
  if (n) {
    const a = parseFloat(n[1]) || 1, c = parseFloat(n[2]) || 1;
    return { packQty: Math.round(a * c * 1e3) / 1e3, packUnit: n[3].trim() };
  }
  const i = t.match(new RegExp(`^([\\d.]+)\\s*/\\s*([\\d.]+)\\s*(${r})\\b`, "i"));
  if (i) return { packQty: parseFloat(i[2]) || 1, packUnit: i[3].trim() };
  const s = t.match(/^([\d.]+)\s*(.*)$/);
  if (s) {
    const a = parseFloat(s[1]) || 1, c = (s[2] || "Each").trim();
    return { packQty: a, packUnit: c };
  }
  return { packQty: 1, packUnit: t || "Each" };
}
__name(Ln, "Ln");
function jn(e) {
  const t = e.toLowerCase(), r = [["Linen", ["napkin", "towel", "apron", "cloth", "uniform", "rag", "linen"]], ["Disposables", ["glove", "cup", "plate", "fork", "spoon", "tissue", "straw", "cutlery", "bio cont", "container"]], ["Packaging", ["box", "bag", "wrap", "film", "pail", "jar", "bottle", "packaging"]], ["Non-Alcoholic Beverages", ["juice", "water", "soda", "coffee", "tea", "syrup", "drink", "beverage"]], ["Alcohol", ["wine", "beer", "spirit", "liquor", "vodka", "whiskey", "rum", "gin", "alcohol"]], ["Cleaning & Sanitation", ["cleaner", "sanitizer", "soap", "detergent", "bleach", "disinfectant", "cleaning"]]];
  for (const [n, i] of r) if (i.some((s) => t.includes(s))) return n;
  return "Ingredients";
}
__name(jn, "jn");
var Le = ["suppliers", "generic_products", "product_entries", "recipes", "recipe_items", "finished_products", "finished_product_items", "inventory", "stock_log", "invoices", "invoice_lines", "staff", "certification_types", "staff_certifications", "product_mappings", "units", "product_aliases", "stock_takes", "stock_take_items"];
T.get("/api/tables/:table", async (e) => {
  const t = e.req.param("table");
  if (!Le.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const { page: r, limit: n, ...i } = e.req.query(), s = Math.max(1, parseInt(r || "1")), a = Math.min(500, parseInt(n || "500")), c = (s - 1) * a;
  let o = "";
  const u = [], l = Object.entries(i);
  l.length && (o = "WHERE " + l.map(([d]) => `${d} = ?`).join(" AND "), l.forEach(([, d]) => u.push(d)));
  const f = await e.env.DB.prepare(`SELECT * FROM ${t} ${o} ORDER BY rowid DESC LIMIT ? OFFSET ?`).bind(...u, a, c).all();
  return e.json({ data: f.results, total: f.results.length });
});
T.get("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!Le.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.env.DB.prepare(`SELECT * FROM ${t} WHERE id = ?`).bind(r).first();
  return n ? e.json(n) : e.json({ error: "Not found" }, 404);
});
var zt = ["units"];
T.post("/api/tables/:table", async (e) => {
  const t = e.req.param("table");
  if (!Le.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const r = await e.req.json();
  !r.id && !zt.includes(t) && (r.id = $());
  const n = Object.keys(r), i = Object.values(r), s = await e.env.DB.prepare(`INSERT INTO ${t} (${n.join(",")}) VALUES (${n.map(() => "?").join(",")})`).bind(...i).run(), a = zt.includes(t) ? s.meta.last_row_id : r.id;
  return e.json({ id: a, ...r }, 201);
});
T.put("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!Le.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.req.json();
  n.id = r;
  const i = Object.keys(n), s = Object.values(n), a = i.map((c) => `${c} = ?`).join(", ");
  return await e.env.DB.prepare(`UPDATE ${t} SET ${a} WHERE id = ?`).bind(...s, r).run(), e.json({ id: r, ...n });
});
T.patch("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  if (!Le.includes(t)) return e.json({ error: "Unknown table" }, 400);
  const n = await e.req.json(), i = Object.keys(n);
  if (!i.length) return e.json({ error: "No fields to update" }, 400);
  const s = i.map((a) => `${a} = ?`).join(", ");
  return await e.env.DB.prepare(`UPDATE ${t} SET ${s} WHERE id = ?`).bind(...Object.values(n), r).run(), e.json({ id: r, ...n });
});
T.delete("/api/tables/generic_products/:id", async (e) => {
  const { id: t } = e.req.param();
  return await e.env.DB.batch([e.env.DB.prepare("UPDATE product_entries SET generic_product_id = NULL WHERE generic_product_id = ?").bind(t), e.env.DB.prepare("DELETE FROM product_aliases WHERE generic_product_id = ?").bind(t), e.env.DB.prepare("DELETE FROM inventory WHERE item_id = ?").bind(t), e.env.DB.prepare("DELETE FROM recipe_items WHERE product_id = ?").bind(t), e.env.DB.prepare("DELETE FROM generic_products WHERE id = ?").bind(t)]), e.body(null, 204);
});
T.delete("/api/tables/:table/:id", async (e) => {
  const { table: t, id: r } = e.req.param();
  return Le.includes(t) ? (await e.env.DB.prepare(`DELETE FROM ${t} WHERE id = ?`).bind(r).run(), e.body(null, 204)) : e.json({ error: "Unknown table" }, 400);
});
T.post("/api/upload", async (e) => {
  var s;
  const r = (await e.req.formData()).get("file");
  if (!r) return e.json({ error: "No file provided" }, 400);
  const n = ((s = r.name.split(".").pop()) == null ? void 0 : s.toLowerCase()) || "bin", i = `uploads/${$()}.${n}`;
  return await e.env.FILES.put(i, r.stream(), { httpMetadata: { contentType: r.type || "application/octet-stream" }, customMetadata: { originalName: r.name } }), e.json({ key: i, name: r.name, size: r.size, type: r.type, url: `/api/files/${i}` });
});
T.get("/api/files/:prefix{.+}", async (e) => {
  var s;
  const t = e.req.param("prefix"), r = await e.env.FILES.get(t);
  if (!r) return e.json({ error: "File not found" }, 404);
  const n = new Headers();
  r.writeHttpMetadata(n), n.set("etag", r.httpEtag);
  const i = (s = r.customMetadata) == null ? void 0 : s.originalName;
  return i && n.set("Content-Disposition", `inline; filename="${i}"`), new Response(r.body, { headers: n });
});
T.post("/api/invoice-lines/:invoice_id/replace", async (e) => {
  const t = e.req.param("invoice_id"), r = await e.req.json();
  await e.env.DB.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(t).run();
  for (const n of r.lines || []) {
    const i = $(), s = parseFloat(n.qty) || 0, a = parseFloat(n.price) || 0;
    await e.env.DB.prepare(`INSERT INTO invoice_lines (id, invoice_id, product_name, vendor_item, category, item_code, packaging, price, qty, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(i, t, n.product_name || "", n.vendor_item || "", n.category || "", n.item_code || "", n.packaging || "", a, s, parseFloat(n.line_total) || a * s).run();
  }
  return await e.env.DB.prepare("UPDATE invoices SET tax_pst=?, tax_gst=?, delivery=?, fuel_surcharge=0, deposit=?, credit=?, other_cost=?, other_desc=? WHERE id=?").bind(r.tax_pst ?? 0, r.tax_gst ?? 0, r.delivery ?? 0, r.deposit ?? 0, r.credit ?? 0, r.other_cost ?? 0, r.other_desc ?? "", t).run(), e.json({ saved: (r.lines || []).length });
});
T.get("/api/vendor-fee-template", async (e) => {
  const t = (e.req.query("vendor") || "").trim();
  if (!t) return e.json({ error: "vendor required" }, 400);
  const r = await e.env.DB.prepare("SELECT * FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))").bind(t).first();
  return r ? e.json({ found: true, template: r }) : e.json({ found: false });
});
T.post("/api/vendor-fee-template", async (e) => {
  var i;
  const t = await e.req.json();
  if (!((i = t.vendor_name) != null && i.trim())) return e.json({ error: "vendor_name required" }, 400);
  const r = await e.env.DB.prepare("SELECT id FROM vendor_fee_templates WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))").bind(t.vendor_name.trim()).first(), n = (/* @__PURE__ */ new Date()).toISOString();
  if (r) return await e.env.DB.prepare(`UPDATE vendor_fee_templates SET
         delivery=?, fuel_surcharge=?, tax_gst=?, tax_pst=?,
         other_cost=?, other_desc=?, use_percent=?, notes=?, updated_at=?
       WHERE id=?`).bind(t.delivery ?? 0, t.fuel_surcharge ?? 0, t.tax_gst ?? 0, t.tax_pst ?? 0, t.other_cost ?? 0, t.other_desc ?? "", t.use_percent ?? 0, t.notes ?? "", n, r.id).run(), e.json({ saved: true, id: r.id, created: false });
  {
    const s = $();
    return await e.env.DB.prepare(`INSERT INTO vendor_fee_templates
         (id, vendor_name, delivery, fuel_surcharge, tax_gst, tax_pst,
          other_cost, other_desc, use_percent, notes, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(s, t.vendor_name.trim(), t.delivery ?? 0, t.fuel_surcharge ?? 0, t.tax_gst ?? 0, t.tax_pst ?? 0, t.other_cost ?? 0, t.other_desc ?? "", t.use_percent ?? 0, t.notes ?? "", n).run(), e.json({ saved: true, id: s, created: true });
  }
});
T.post("/api/ensure-invoice", async (e) => {
  const t = await e.req.json();
  if (!t.file_key) return e.json({ error: "file_key required" }, 400);
  const r = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), n = await e.env.DB.prepare("SELECT id FROM invoices WHERE file_key = ?").bind(t.file_key).first();
  if (n) return e.json({ id: n.id, created: false });
  const i = $();
  return await e.env.DB.prepare(`INSERT INTO invoices (id, vendor, invoice_number, invoice_date, upload_date, total,
       status, payment_account, file_name, file_key, file_url, notes,
       tax_gst, tax_pst, delivery, fuel_surcharge, deposit, credit, other_cost, other_desc)
     VALUES (?, ?, ?, ?, ?, ?, 'In Processing', 'A/P', ?, ?, ?, '',
             ?, ?, ?, 0, ?, ?, ?, ?)`).bind(i, t.vendor || "", t.invoice_number || "", t.invoice_date || r, r, t.total ?? 0, t.file_name || "", t.file_key, `/api/files/${t.file_key}`, t.tax_gst ?? 0, t.tax_pst ?? 0, t.delivery ?? 0, t.deposit ?? 0, t.credit ?? 0, t.other_cost ?? 0, t.other_desc || "").run(), e.json({ id: i, created: true });
});
T.post("/api/bulk/products", async (e) => {
  const { products: t } = await e.req.json();
  if (!Array.isArray(t)) return e.json({ error: "products array required" }, 400);
  const r = [];
  for (const n of t) {
    n.id || (n.id = $());
    const i = Object.keys(n), s = Object.values(n);
    await e.env.DB.prepare(`INSERT OR REPLACE INTO product_entries (${i.join(",")}) VALUES (${i.map(() => "?").join(",")})`).bind(...s).run(), r.push(n.id);
  }
  return e.json({ saved: r });
});
T.post("/api/bulk/upsert-products", async (e) => {
  const t = await e.req.json();
  if (!Array.isArray(t.products)) return e.json({ error: "products array required" }, 400);
  let r = "", n = "", i = false;
  const s = (t.vendor_name || "").trim();
  if (s) {
    const l = await e.env.DB.prepare("SELECT id, name FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))").bind(s).first();
    l ? (r = l.id, n = l.name) : (r = $(), n = s, await e.env.DB.prepare("INSERT INTO suppliers (id, name, contact, email, notes) VALUES (?, ?, '', '', '')").bind(r, s).run(), i = true);
  }
  let a = 0, c = 0, o = 0;
  const u = [];
  for (const l of t.products) {
    const f = (l.name || "").trim();
    if (!f) continue;
    let d = await e.env.DB.prepare("SELECT id FROM generic_products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL").bind(f).first();
    if (!d) {
      const I = await e.env.DB.prepare(`SELECT pa.generic_product_id AS id FROM product_aliases pa
         JOIN generic_products gp ON gp.id = pa.generic_product_id
         WHERE LOWER(TRIM(pa.alias_name)) = LOWER(TRIM(?)) AND gp.deleted_at IS NULL`).bind(f).first();
      I && (d = I);
    }
    let h;
    if (d) h = d.id, o++;
    else {
      h = $();
      const I = (l.category || "").trim(), z = I && I !== "Ingredients" ? I : jn(f);
      await e.env.DB.prepare(`INSERT INTO generic_products (id, name, category, sub_unit_name, sub_unit_qty)
         VALUES (?, ?, ?, ?, ?)`).bind(h, f, z, l.sub_unit_name || "", l.sub_unit_qty ?? null).run(), c++;
    }
    const v = $(), m = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), g = parseFloat(l.cost) || 0, y = parseFloat(l.qty) || 1, { packQty: E, packUnit: w } = Ln(l.pack_size || ""), S = E * y, O = S > 0 ? Math.round(g / S * 100) / 100 : g;
    let k = null;
    if (l.expiry_date) {
      const I = new Date(l.expiry_date), z = /* @__PURE__ */ new Date();
      z.setHours(0, 0, 0, 0), k = Math.floor((I.getTime() - z.getTime()) / 864e5);
    }
    const D = l.supplier_id || r, q = l.supplier_name || n;
    await e.env.DB.prepare(`INSERT INTO product_entries
         (id, generic_product_id, generic_product_name, supplier_id, supplier_name,
          vendor_item_name, sku, pack_qty, pack_unit, cost, cost_per_unit,
          purchase_date, expiry_date, days_left, invoice_ref,
          invoice_id, invoice_file_key, invoice_file_name, qty_ordered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(v, h, f, D, q, l.vendor_item_name || f, l.sku || "", E, w, g, O, l.invoice_date || l.purchase_date || m, l.expiry_date || "", k, l.invoice_ref || "", l.invoice_id || "", l.invoice_file_key || "", l.invoice_file_name || "", y).run(), u.push({ name: f, received_cost: l.cost, received_unit_price: l.unit_price, received_qty: l.qty, received_pack_size: l.pack_size, parsed_pack_qty: E, parsed_pack_unit: w, saved_cost: g, saved_cost_per_unit: O }), a++;
  }
  return e.json({ saved: a, created_generics: c, reused_generics: o, supplier_id: r, supplier_name: n, supplier_created: i, debug: u });
});
T.post("/api/products/merge", async (e) => {
  const t = await e.req.json(), { merged_id: r, surviving_id: n } = t;
  if (!r || !n) return e.json({ error: "merged_id and surviving_id required" }, 400);
  if (r === n) return e.json({ error: "Cannot merge a product with itself" }, 400);
  const i = await e.env.DB.prepare("SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL").bind(r).first(), s = await e.env.DB.prepare("SELECT id, name FROM generic_products WHERE id = ? AND deleted_at IS NULL").bind(n).first();
  if (!i) return e.json({ error: "Merged product not found" }, 404);
  if (!s) return e.json({ error: "Surviving product not found" }, 404);
  await e.env.DB.prepare("UPDATE product_entries SET generic_product_id = ?, generic_product_name = ? WHERE generic_product_id = ?").bind(n, s.name, r).run();
  const a = await e.env.DB.prepare("SELECT id, quantity FROM inventory WHERE item_id = ?").bind(r).first();
  return a && (await e.env.DB.prepare("SELECT id FROM inventory WHERE item_id = ?").bind(n).first() ? (await e.env.DB.prepare("UPDATE inventory SET quantity = quantity + ? WHERE item_id = ?").bind(a.quantity, n).run(), await e.env.DB.prepare("DELETE FROM inventory WHERE item_id = ?").bind(r).run()) : await e.env.DB.prepare("UPDATE inventory SET item_id = ?, item_name = ? WHERE item_id = ?").bind(n, s.name, r).run()), await e.env.DB.prepare("UPDATE recipe_items SET product_id = ?, product_name = ? WHERE product_id = ?").bind(n, s.name, r).run(), await e.env.DB.prepare("UPDATE generic_products SET deleted_at = datetime('now') WHERE id = ?").bind(r).run(), e.json({ ok: true, merged_name: i.name, surviving_name: s.name });
});
T.get("/api/stats/certifications", async (e) => {
  const t = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), r = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), n = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications").first(), i = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ?").bind(t).first(), s = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date > ? AND expiry_date <= ?").bind(t, r).first(), a = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff_certifications WHERE expiry_date <= ?").bind(t).first(), c = await e.env.DB.prepare("SELECT COUNT(*) as n FROM staff").first();
  return e.json({ total: (n == null ? void 0 : n.n) || 0, valid: (i == null ? void 0 : i.n) || 0, expiring: (s == null ? void 0 : s.n) || 0, expired: (a == null ? void 0 : a.n) || 0, staffCount: (c == null ? void 0 : c.n) || 0 });
});
T.get("/api/price-movers", async (e) => {
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
           pe.invoice_ref,
           pe.invoice_id
    FROM product_entries pe
    WHERE pe.purchase_date IS NOT NULL AND pe.purchase_date != ''
      AND pe.generic_product_id IS NOT NULL AND pe.generic_product_id != ''
  `;
  const i = [];
  t && (n += " AND pe.purchase_date >= ?", i.push(t)), r && (n += " AND pe.purchase_date <= ?", i.push(r)), n += " ORDER BY pe.purchase_date DESC, pe.created_at DESC";
  const s = await e.env.DB.prepare(n).bind(...i).all(), a = /* @__PURE__ */ new Map();
  for (const o of s.results) {
    const u = String(o.product_id || "");
    if (!u) continue;
    let l = a.get(u);
    l || (l = { product_id: u, product_name: String(o.product_name || ""), unit: String(o.pack_unit || ""), purchases: [] }, a.set(u, l)), l.purchases.push({ date: String(o.purchase_date || ""), vendor: String(o.supplier_name || ""), pack_qty: Number(o.pack_qty || 0), pack_unit: String(o.pack_unit || ""), cost: Number(o.cost || 0), cost_per_unit: Number(o.cost_per_unit || 0), invoice_ref: String(o.invoice_ref || ""), invoice_id: String(o.invoice_id || "") });
  }
  const c = Array.from(a.values()).map((o) => {
    const u = o.purchases.slice(0, 10);
    let l = null;
    if (u.length >= 2) {
      const f = u[0].cost_per_unit, d = u[1].cost_per_unit;
      d > 0 && (l = Math.round((f - d) / d * 1e3) / 10);
    }
    return { product_id: o.product_id, product_name: o.product_name, unit: o.unit, purchase_count: o.purchases.length, pct_change: l, purchases: u };
  });
  return c.sort((o, u) => {
    const l = o.pct_change === null ? -1 : Math.abs(o.pct_change);
    return (u.pct_change === null ? -1 : Math.abs(u.pct_change)) - l;
  }), e.json({ data: c });
});
T.get("/api/stock-take/active", async (e) => {
  const t = await e.env.DB.prepare("SELECT * FROM stock_takes WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1").first();
  if (!t) return e.json({ active: null });
  const r = await e.env.DB.prepare("SELECT * FROM stock_take_items WHERE stock_take_id = ?").bind(t.id).all();
  return e.json({ active: t, items: r.results });
});
T.post("/api/stock-take/start", async (e) => {
  const t = await e.env.DB.prepare("SELECT * FROM stock_takes WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1").first();
  if (t) {
    const o = await e.env.DB.prepare("SELECT * FROM stock_take_items WHERE stock_take_id = ?").bind(t.id).all();
    return e.json({ stock_take: t, items: o.results, resumed: true });
  }
  const r = $(), i = (await e.env.DB.prepare("SELECT id, item_id, item_type, item_name, category, quantity, unit FROM inventory").all()).results || [];
  await e.env.DB.prepare("INSERT INTO stock_takes (id, status, total_items, counted_items) VALUES (?, 'in_progress', ?, 0)").bind(r, i.length).run();
  const s = i.map((o) => e.env.DB.prepare(`INSERT INTO stock_take_items
         (id, stock_take_id, inventory_id, item_id, item_type, item_name, category, unit, expected_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind($(), r, o.id, o.item_id, o.item_type, o.item_name, o.category || "", o.unit || "", o.quantity || 0));
  s.length && await e.env.DB.batch(s);
  const a = await e.env.DB.prepare("SELECT * FROM stock_takes WHERE id = ?").bind(r).first(), c = await e.env.DB.prepare("SELECT * FROM stock_take_items WHERE stock_take_id = ?").bind(r).all();
  return e.json({ stock_take: a, items: c.results, resumed: false }, 201);
});
T.post("/api/stock-take/:id/submit", async (e) => {
  const t = e.req.param("id"), r = await e.req.json(), n = await e.env.DB.prepare("SELECT * FROM stock_takes WHERE id = ?").bind(t).first();
  if (!n) return e.json({ error: "Stock take not found" }, 404);
  if (n.status !== "in_progress") return e.json({ error: "Stock take is not in progress" }, 400);
  const i = await e.env.DB.prepare("SELECT * FROM stock_take_items WHERE stock_take_id = ?").bind(t).all(), s = new Map((i.results || []).map((u) => [u.id, u])), a = (/* @__PURE__ */ new Date()).toISOString();
  let c = 0;
  const o = [];
  for (const u of r.items || []) {
    const l = s.get(u.stock_take_item_id);
    if (!l || u.counted_qty === null || u.counted_qty === void 0) continue;
    const f = Number(u.counted_qty), d = Number(l.expected_qty) || 0, h = f - d, v = (u.reason || "").trim();
    c++, o.push(e.env.DB.prepare("UPDATE inventory SET quantity = ? WHERE id = ?").bind(f, l.inventory_id)), o.push(e.env.DB.prepare(`UPDATE stock_take_items
           SET counted_qty = ?, variance = ?, reason = ?, counted_at = ?
         WHERE id = ?`).bind(f, h, v, a, l.id)), h !== 0 && o.push(e.env.DB.prepare(`INSERT INTO stock_log
             (id, inventory_id, item_id, item_type, item_name, change, reason, note, lot_number, moved_at, stock_take_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`).bind($(), l.inventory_id, l.item_id, l.item_type, l.item_name, h, v || "Stock take", `Stock take: expected ${d}, counted ${f}`, a, t));
  }
  return o.push(e.env.DB.prepare("UPDATE stock_takes SET status = 'submitted', submitted_at = ?, counted_items = ? WHERE id = ?").bind(a, c, t)), o.length && await e.env.DB.batch(o), e.json({ ok: true, counted: c });
});
T.patch("/api/stock-take/items/:id", async (e) => {
  const t = e.req.param("id"), r = await e.req.json();
  return await e.env.DB.prepare(`UPDATE stock_take_items
        SET counted_qty = ?, reason = ?, counted_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
      WHERE id = ?`).bind(r.counted_qty ?? null, r.reason ?? "", r.counted_qty ?? null, t).run(), e.json({ ok: true });
});
T.post("/api/stock-take/:id/cancel", async (e) => {
  const t = e.req.param("id");
  return await e.env.DB.prepare("DELETE FROM stock_takes WHERE id = ? AND status = 'in_progress'").bind(t).run(), e.json({ ok: true });
});
T.get("/api/stock-take/latest-statuses", async (e) => {
  const t = await e.env.DB.prepare("SELECT id, submitted_at FROM stock_takes WHERE status = 'submitted' ORDER BY submitted_at DESC LIMIT 1").first();
  if (!t) return e.json({ stock_take_id: null, statuses: {} });
  const r = await e.env.DB.prepare("SELECT inventory_id, counted_qty FROM stock_take_items WHERE stock_take_id = ?").bind(t.id).all(), n = {};
  for (const i of r.results || []) n[i.inventory_id] = i.counted_qty === null || i.counted_qty === void 0 ? "not_counted" : "counted";
  return e.json({ stock_take_id: t.id, submitted_at: t.submitted_at, statuses: n });
});
T.get("/api/ai/status", async (e) => {
  const t = !!e.env.OPENAI_API_KEY;
  return e.json({ configured: t });
});
T.get("/api/ai/azure-status", async (e) => {
  const t = !!e.env.AZURE_DOC_INTEL_KEY, r = !!e.env.AZURE_DOC_INTEL_ENDPOINT;
  return e.json({ configured: t && r });
});
T.post("/api/ai/parse-invoice", async (e) => {
  var a, c, o, u, l, f;
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
  let i;
  if ((e.req.header("content-type") || "").includes("multipart/form-data")) {
    const h = (await e.req.formData()).get("file");
    if (!h) return e.json({ error: "No file provided" }, 400);
    const v = h.type || "image/jpeg", m = await h.arrayBuffer(), g = btoa(String.fromCharCode(...new Uint8Array(m)));
    i = [{ role: "user", content: [{ type: "text", text: `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}` }, { type: "image_url", image_url: { url: `data:${v};base64,${g}`, detail: "high" } }] }];
  } else {
    const d = await e.req.json();
    if (d.ocrText) {
      const h = `You are an expert invoice parser. Below is the raw text extracted from an invoice by OCR. The OCR text is accurate for product line items, but the totals/charges section (taxes, fees, deposits, surcharges) may have broken formatting where labels and values appear on separate lines or are misassociated.${(a = d.base64Images) != null && a.length ? " You also have the original invoice image(s) \u2014 use them to VISUALLY VERIFY all charges in the totals section. When the OCR text is ambiguous about which value belongs to which label, trust the image layout over the OCR text." : " Always cross-check individual amounts against the invoice total to catch these errors."}

Parse this text carefully and extract ALL line items AND all additional charges. Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}

--- INVOICE OCR TEXT START ---
${d.ocrText}
--- INVOICE OCR TEXT END ---`;
      if ((c = d.base64Images) != null && c.length) {
        const v = [{ type: "text", text: h }];
        for (const m of d.base64Images) {
          const g = m.mimeType || "image/jpeg";
          v.push({ type: "image_url", image_url: { url: `data:${g};base64,${m.base64}`, detail: "high" } });
        }
        i = [{ role: "user", content: v }];
      } else i = [{ role: "user", content: h }];
    } else if (d.base64) {
      const h = d.mimeType || "image/jpeg";
      i = [{ role: "user", content: [{ type: "text", text: `You are an expert invoice parser. Analyse this invoice image carefully and extract ALL line items AND all additional charges. If any value looks like a decimal error (e.g. a tax that is far too large relative to the total), correct it and add '(decimal corrected)' next to the value. If any field is unclear or ambiguous, mark it as 'needs review'.
Return ONLY a valid JSON object in this exact format (no markdown, no explanation, no code fences):
${r}
${n}` }, { type: "image_url", image_url: { url: `data:${h};base64,${d.base64}`, detail: "high" } }] }];
    } else return e.json({ error: "Provide either ocrText or base64 in the request body." }, 400);
  }
  try {
    const d = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ model: "gpt-4o", max_tokens: 3e3, messages: i }) });
    if (!d.ok) {
      const y = await d.json().catch(() => ({}));
      return e.json({ error: ((o = y == null ? void 0 : y.error) == null ? void 0 : o.message) || `OpenAI API error ${d.status}` }, 502);
    }
    const m = (((f = (l = (u = (await d.json()).choices) == null ? void 0 : u[0]) == null ? void 0 : l.message) == null ? void 0 : f.content) || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim(), g = JSON.parse(m);
    return e.json({ success: true, result: g, rawText: m });
  } catch (d) {
    const h = d instanceof Error ? d.message : String(d);
    return e.json({ error: "AI parsing failed: " + h }, 500);
  }
});
T.post("/api/ai/azure-analyze", async (e) => {
  var h;
  const t = (e.env.AZURE_DOC_INTEL_ENDPOINT || "").replace(/\/$/, ""), r = e.env.AZURE_DOC_INTEL_KEY;
  if (!t || !r) return e.json({ error: "Azure Document Intelligence is not configured on the server." }, 503);
  if (!(e.req.header("content-type") || "").includes("multipart/form-data")) return e.json({ error: 'Send the invoice as multipart/form-data with field name "file".' }, 400);
  const s = (await e.req.formData()).get("file");
  if (!s) return e.json({ error: "No file provided." }, 400);
  const a = await s.arrayBuffer(), c = s.type || "application/octet-stream", o = a.byteLength / (1024 * 1024);
  if (o > 50) return e.json({ error: `File is too large for Azure OCR (${o.toFixed(1)} MB). Maximum supported size is 50 MB. Please reduce the file size and try again.` }, 413);
  const u = `${t}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`, l = await fetch(u, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": r, "Content-Type": c }, body: a });
  if (!l.ok) {
    const v = await l.text();
    return e.json({ error: `Azure submission failed (${l.status}): ${v}` }, 502);
  }
  const f = l.headers.get("operation-location");
  if (!f) return e.json({ error: "Azure did not return an operation-location header." }, 502);
  const d = 60;
  for (let v = 0; v < d; v++) {
    await new Promise((y) => setTimeout(y, 1e3));
    const m = await fetch(f, { headers: { "Ocp-Apim-Subscription-Key": r } });
    if (!m.ok) {
      const y = await m.text();
      return e.json({ error: `Azure polling failed (${m.status}): ${y}` }, 502);
    }
    const g = await m.json();
    if (g.status === "succeeded") {
      const y = g.analyzeResult, E = [];
      if (y != null && y.pages && y.pages.length > 0) for (const w of y.pages) {
        const S = w.pageNumber ?? E.length + 1, O = (w.lines || []).map((k) => k.content || "").filter(Boolean);
        E.push({ pageNumber: S, text: O.join(`
`) });
      }
      else y != null && y.content && E.push({ pageNumber: 1, text: y.content });
      return e.json({ success: true, analyzeResult: g.analyzeResult, pageTexts: E, fullText: (y == null ? void 0 : y.content) || E.map((w) => w.text).join(`

--- Page break ---

`) });
    }
    if (g.status === "failed") return e.json({ error: "Azure analysis failed: " + (((h = g.error) == null ? void 0 : h.message) || "unknown error") }, 502);
  }
  return e.json({ error: "Azure analysis timed out after 60 seconds. The file may be too complex or Azure may be under load. Please try again." }, 504);
});
T.get("/api/product-mappings", async (e) => {
  const t = (e.req.query("vendor") || "").trim();
  if (!t) {
    const n = await e.env.DB.prepare("SELECT * FROM product_mappings ORDER BY updated_at DESC").all();
    return e.json({ data: n.results });
  }
  const r = await e.env.DB.prepare("SELECT * FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) ORDER BY updated_at DESC").bind(t).all();
  return e.json({ data: r.results });
});
T.post("/api/product-mappings", async (e) => {
  var s, a, c, o, u, l, f, d, h;
  const t = await e.req.json();
  if (!((s = t.vendor_name) != null && s.trim()) || !((a = t.raw_ocr_text) != null && a.trim()) || !((c = t.corrected_name) != null && c.trim())) return e.json({ error: "vendor_name, raw_ocr_text, and corrected_name are required" }, 400);
  const r = (/* @__PURE__ */ new Date()).toISOString(), n = await e.env.DB.prepare("SELECT id FROM product_mappings WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(raw_ocr_text)) = LOWER(TRIM(?))").bind(t.vendor_name.trim(), t.raw_ocr_text.trim()).first();
  if (n) return await e.env.DB.prepare("UPDATE product_mappings SET corrected_name=?, corrected_brand=?, corrected_sku=?, corrected_pack_size=?, updated_at=? WHERE id=?").bind(t.corrected_name.trim(), ((o = t.corrected_brand) == null ? void 0 : o.trim()) || "", ((u = t.corrected_sku) == null ? void 0 : u.trim()) || "", ((l = t.corrected_pack_size) == null ? void 0 : l.trim()) || "", r, n.id).run(), e.json({ id: n.id, created: false });
  const i = $();
  return await e.env.DB.prepare("INSERT INTO product_mappings (id, vendor_name, raw_ocr_text, corrected_name, corrected_brand, corrected_sku, corrected_pack_size, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(i, t.vendor_name.trim(), t.raw_ocr_text.trim(), t.corrected_name.trim(), ((f = t.corrected_brand) == null ? void 0 : f.trim()) || "", ((d = t.corrected_sku) == null ? void 0 : d.trim()) || "", ((h = t.corrected_pack_size) == null ? void 0 : h.trim()) || "", r, r).run(), e.json({ id: i, created: true });
});
T.delete("/api/units/:id", async (e) => {
  const t = e.req.param("id"), r = e.req.query("force") === "true", n = await e.env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(t).first();
  if (!n) return e.json({ error: "Not found" }, 404);
  if (!r) {
    const i = await e.env.DB.prepare("SELECT COUNT(*) as count FROM product_entries WHERE pack_unit = ?").bind(n.name).first(), s = (i == null ? void 0 : i.count) ?? 0;
    if (s > 0) return e.json({ warning: true, count: s, message: `Used by ${s} product entries` });
  }
  return await e.env.DB.prepare("DELETE FROM units WHERE id = ?").bind(t).run(), e.body(null, 204);
});
T.get("/api/spending-breakdown", async (e) => {
  const t = /* @__PURE__ */ new Date(), r = t.toISOString().split("T")[0], n = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`, i = /^\d{4}-\d{2}-\d{2}$/, s = /* @__PURE__ */ __name((w) => i.test(w) && !isNaN(Date.parse(w)), "s"), a = (e.req.query("from") || "").trim(), c = (e.req.query("to") || "").trim();
  if (a && !s(a)) return e.json({ error: `Invalid 'from' date: "${a}". Use YYYY-MM-DD.` }, 400);
  if (c && !s(c)) return e.json({ error: `Invalid 'to' date: "${c}". Use YYYY-MM-DD.` }, 400);
  const o = a || n, u = c || r, l = await e.env.DB.prepare(`
    SELECT
      COUNT(*)                                              AS invoice_count,
      SUM(COALESCE(total, 0))                              AS grand_total,
      SUM(COALESCE(tax_gst, 0) + COALESCE(tax_pst, 0))    AS taxes,
      SUM(COALESCE(deposit, 0))                            AS deposits,
      SUM(COALESCE(delivery, 0))                           AS delivery,
      SUM(COALESCE(fuel_surcharge, 0))                     AS fuel_surcharge
    FROM invoices
    WHERE status = 'Closed'
      AND invoice_date >= ?
      AND invoice_date <= ?
  `).bind(o, u).first(), f = (l == null ? void 0 : l.grand_total) ?? 0, d = (l == null ? void 0 : l.invoice_count) ?? 0, h = await e.env.DB.prepare(`
    SELECT vendor, SUM(COALESCE(total, 0)) AS amount
    FROM invoices
    WHERE status = 'Closed'
      AND invoice_date >= ?
      AND invoice_date <= ?
    GROUP BY vendor
    ORDER BY amount DESC
  `).bind(o, u).all(), v = await e.env.DB.prepare(`
    WITH line_cats AS (
      SELECT
        il.line_total,
        COALESCE(
          (SELECT gp.category
           FROM product_entries pe
           JOIN generic_products gp ON gp.id = pe.generic_product_id
           WHERE LOWER(TRIM(pe.generic_product_name)) = LOWER(TRIM(il.product_name))
           LIMIT 1),
          (SELECT gp.category
           FROM generic_products gp
           WHERE LOWER(TRIM(gp.name)) = LOWER(TRIM(il.product_name))
           LIMIT 1),
          'Uncategorized'
        ) AS category
      FROM invoice_lines il
      JOIN invoices i ON il.invoice_id = i.id
      WHERE i.status = 'Closed'
        AND i.invoice_date >= ?
        AND i.invoice_date <= ?
    )
    SELECT category, SUM(COALESCE(line_total, 0)) AS amount
    FROM line_cats
    GROUP BY category
    ORDER BY amount DESC
  `).bind(o, u).all(), m = /* @__PURE__ */ __name((w) => Math.round(w * 100) / 100, "m"), g = /* @__PURE__ */ __name((w) => f > 0 ? Math.round(w / f * 1e3) / 10 : 0, "g"), y = (h.results ?? []).map((w) => ({ vendor: w.vendor ?? "", amount: m(w.amount ?? 0), percentage: g(w.amount ?? 0) })), E = (v.results ?? []).map((w) => ({ category: w.category ?? "", amount: m(w.amount ?? 0), percentage: g(w.amount ?? 0) }));
  return e.json({ date_range: { from: o, to: u }, total: m(f), invoice_count: d, by_category: E, by_vendor: y, other_charges_breakdown: { taxes: m((l == null ? void 0 : l.taxes) ?? 0), deposits: m((l == null ? void 0 : l.deposits) ?? 0), delivery: m((l == null ? void 0 : l.delivery) ?? 0), fuel_surcharge: m((l == null ? void 0 : l.fuel_surcharge) ?? 0) } });
});
var Mn = /* @__PURE__ */ __name((e, ...t) => {
  const r = [""];
  for (let n = 0, i = e.length - 1; n < i; n++) {
    r[0] += e[n];
    const s = Array.isArray(t[n]) ? t[n].flat(1 / 0) : [t[n]];
    for (let a = 0, c = s.length; a < c; a++) {
      const o = s[a];
      if (typeof o == "string") se(o, r);
      else if (typeof o == "number") r[0] += o;
      else {
        if (typeof o == "boolean" || o === null || o === void 0) continue;
        if (typeof o == "object" && o.isEscaped) if (o.callbacks) r.unshift("", o);
        else {
          const u = o.toString();
          u instanceof Promise ? r.unshift("", u) : r[0] += u;
        }
        else o instanceof Promise ? r.unshift("", o) : se(o.toString(), r);
      }
    }
  }
  return r[0] += e.at(-1), r.length === 1 ? "callbacks" in r ? P(wr(P(r[0], r.callbacks))) : P(r[0]) : br(r, r.callbacks);
}, "Mn");
var jt = /* @__PURE__ */ Symbol("RENDERER");
var Ot = /* @__PURE__ */ Symbol("ERROR_HANDLER");
var A = /* @__PURE__ */ Symbol("STASH");
var Dr = /* @__PURE__ */ Symbol("INTERNAL");
var Nn = /* @__PURE__ */ Symbol("MEMO");
var ut = /* @__PURE__ */ Symbol("PERMALINK");
var Yt = /* @__PURE__ */ __name((e) => (e[Dr] = true, e), "Yt");
var Ar = /* @__PURE__ */ __name((e) => ({ value: t, children: r }) => {
  if (!r) return;
  const n = { children: [{ tag: Yt(() => {
    e.push(t);
  }), props: {} }] };
  Array.isArray(r) ? n.children.push(...r.flat()) : n.children.push(r), n.children.push({ tag: Yt(() => {
    e.pop();
  }), props: {} });
  const i = { tag: "", props: n, type: "" };
  return i[Ot] = (s) => {
    throw e.pop(), s;
  }, i;
}, "Ar");
var Cr = /* @__PURE__ */ __name((e) => {
  const t = [e], r = Ar(t);
  return r.values = t, r.Provider = r, Ae.push(r), r;
}, "Cr");
var Ae = [];
var Mt = /* @__PURE__ */ __name((e) => {
  const t = [e], r = /* @__PURE__ */ __name(((n) => {
    t.push(n.value);
    let i;
    try {
      i = n.children ? (Array.isArray(n.children) ? new Pr("", {}, n.children) : n.children).toString() : "";
    } catch (s) {
      throw t.pop(), s;
    }
    return i instanceof Promise ? i.finally(() => t.pop()).then((s) => P(s, s.callbacks)) : (t.pop(), P(i));
  }), "r");
  return r.values = t, r.Provider = r, r[jt] = Ar(t), Ae.push(r), r;
}, "Mt");
var je = /* @__PURE__ */ __name((e) => e.values.at(-1), "je");
var dt = { title: [], script: ["src"], style: ["data-href"], link: ["href"], meta: ["name", "httpEquiv", "charset", "itemProp"] };
var xt = {};
var ce = "data-precedence";
var Lr = /* @__PURE__ */ __name((e) => e.rel === "stylesheet" && "precedence" in e, "Lr");
var jr = /* @__PURE__ */ __name((e, t) => e === "link" ? t : dt[e].length > 0, "jr");
var Je = /* @__PURE__ */ __name((e) => Array.isArray(e) ? e : [e], "Je");
var Vt = /* @__PURE__ */ new WeakMap();
var Kt = /* @__PURE__ */ __name((e, t, r, n) => ({ buffer: i, context: s }) => {
  if (!i) return;
  const a = Vt.get(s) || {};
  Vt.set(s, a);
  const c = a[e] || (a[e] = []);
  let o = false;
  const u = dt[e], l = jr(e, n !== void 0);
  if (l) {
    e: for (const [, f] of c) if (!(e === "link" && !(f.rel === "stylesheet" && f[ce] !== void 0))) {
      for (const d of u) if (((f == null ? void 0 : f[d]) ?? null) === (r == null ? void 0 : r[d])) {
        o = true;
        break e;
      }
    }
  }
  if (o ? i[0] = i[0].replaceAll(t, "") : l || e === "link" ? c.push([t, r, n]) : c.unshift([t, r, n]), i[0].indexOf("</head>") !== -1) {
    let f;
    if (e === "link" || n !== void 0) {
      const d = [];
      f = c.map(([h, , v], m) => {
        if (v === void 0) return [h, Number.MAX_SAFE_INTEGER, m];
        let g = d.indexOf(v);
        return g === -1 && (d.push(v), g = d.length - 1), [h, g, m];
      }).sort((h, v) => h[1] - v[1] || h[2] - v[2]).map(([h]) => h);
    } else f = c.map(([d]) => d);
    f.forEach((d) => {
      i[0] = i[0].replaceAll(d, "");
    }), i[0] = i[0].replace(/(?=<\/head>)/, f.join(""));
  }
}, "Kt");
var Xe = /* @__PURE__ */ __name((e, t, r) => P(new H(e, r, Je(t ?? [])).toString()), "Xe");
var Ze = /* @__PURE__ */ __name((e, t, r, n) => {
  if ("itemProp" in r) return Xe(e, t, r);
  let { precedence: i, blocking: s, ...a } = r;
  i = n ? i ?? "" : void 0, n && (a[ce] = i);
  const c = new H(e, a, Je(t || [])).toString();
  return c instanceof Promise ? c.then((o) => P(c, [...o.callbacks || [], Kt(e, o, a, i)])) : P(c, [Kt(e, c, a, i)]);
}, "Ze");
var In = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = Nt();
  if (r) {
    const n = je(r);
    if (n === "svg" || n === "head") return new H("title", t, Je(e ?? []));
  }
  return Ze("title", e, t, false);
}, "In");
var Pn = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = Nt();
  return ["src", "async"].some((n) => !t[n]) || r && je(r) === "head" ? Xe("script", e, t) : Ze("script", e, t, false);
}, "Pn");
var $n = /* @__PURE__ */ __name(({ children: e, ...t }) => ["href", "precedence"].every((r) => r in t) ? (t["data-href"] = t.href, delete t.href, Ze("style", e, t, true)) : Xe("style", e, t), "$n");
var Bn = /* @__PURE__ */ __name(({ children: e, ...t }) => ["onLoad", "onError"].some((r) => r in t) || t.rel === "stylesheet" && (!("precedence" in t) || "disabled" in t) ? Xe("link", e, t) : Ze("link", e, t, Lr(t)), "Bn");
var Hn = /* @__PURE__ */ __name(({ children: e, ...t }) => {
  const r = Nt();
  return r && je(r) === "head" ? Xe("meta", e, t) : Ze("meta", e, t, false);
}, "Hn");
var Mr = /* @__PURE__ */ __name((e, { children: t, ...r }) => new H(e, r, Je(t ?? [])), "Mr");
var qn = /* @__PURE__ */ __name((e) => (typeof e.action == "function" && (e.action = ut in e.action ? e.action[ut] : void 0), Mr("form", e)), "qn");
var Nr = /* @__PURE__ */ __name((e, t) => (typeof t.formAction == "function" && (t.formAction = ut in t.formAction ? t.formAction[ut] : void 0), Mr(e, t)), "Nr");
var Fn = /* @__PURE__ */ __name((e) => Nr("input", e), "Fn");
var Un = /* @__PURE__ */ __name((e) => Nr("button", e), "Un");
var _t = Object.freeze(Object.defineProperty({ __proto__: null, button: Un, form: qn, input: Fn, link: Bn, meta: Hn, script: Pn, style: $n, title: In }, Symbol.toStringTag, { value: "Module" }));
var Wn = /* @__PURE__ */ new Map([["className", "class"], ["htmlFor", "for"], ["crossOrigin", "crossorigin"], ["httpEquiv", "http-equiv"], ["itemProp", "itemprop"], ["fetchPriority", "fetchpriority"], ["noModule", "nomodule"], ["formAction", "formaction"]]);
var ft = /* @__PURE__ */ __name((e) => Wn.get(e) || e, "ft");
var Ir = /* @__PURE__ */ __name((e, t) => {
  for (const [r, n] of Object.entries(e)) {
    const i = r[0] === "-" || !/[A-Z]/.test(r) ? r : r.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`);
    t(i, n == null ? null : typeof n == "number" ? i.match(/^(?:a|border-im|column(?:-c|s)|flex(?:$|-[^b])|grid-(?:ar|[^a])|font-w|li|or|sca|st|ta|wido|z)|ty$/) ? `${n}` : `${n}px` : n);
  }
}, "Ir");
var qe = void 0;
var Nt = /* @__PURE__ */ __name(() => qe, "Nt");
var zn = /* @__PURE__ */ __name((e) => /[A-Z]/.test(e) && e.match(/^(?:al|basel|clip(?:Path|Rule)$|co|do|fill|fl|fo|gl|let|lig|i|marker[EMS]|o|pai|pointe|sh|st[or]|text[^L]|tr|u|ve|w)/) ? e.replace(/([A-Z])/g, "-$1").toLowerCase() : e, "zn");
var Yn = ["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"];
var Vn = ["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "download", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"];
var It = /* @__PURE__ */ __name((e, t) => {
  for (let r = 0, n = e.length; r < n; r++) {
    const i = e[r];
    if (typeof i == "string") se(i, t);
    else {
      if (typeof i == "boolean" || i === null || i === void 0) continue;
      i instanceof H ? i.toStringToBuffer(t) : typeof i == "number" || i.isEscaped ? t[0] += i : i instanceof Promise ? t.unshift("", i) : It(i, t);
    }
  }
}, "It");
var H = class {
  static {
    __name(this, "H");
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
    (t = this.localContexts) == null || t.forEach(([n, i]) => {
      n.values.push(i);
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
    const i = qe && je(qe) === "svg" ? (s) => zn(ft(s)) : (s) => ft(s);
    for (let [s, a] of Object.entries(r)) if (s = i(s), s !== "children") {
      if (s === "style" && typeof a == "object") {
        let c = "";
        Ir(a, (o, u) => {
          u != null && (c += `${c ? ";" : ""}${o}:${u}`);
        }), e[0] += ' style="', se(c, e), e[0] += '"';
      } else if (typeof a == "string") e[0] += ` ${s}="`, se(a, e), e[0] += '"';
      else if (a != null) if (typeof a == "number" || a.isEscaped) e[0] += ` ${s}="${a}"`;
      else if (typeof a == "boolean" && Vn.includes(s)) a && (e[0] += ` ${s}=""`);
      else if (s === "dangerouslySetInnerHTML") {
        if (n.length > 0) throw new Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
        n = [P(a.__html)];
      } else if (a instanceof Promise) e[0] += ` ${s}="`, e.unshift('"', a);
      else if (typeof a == "function") {
        if (!s.startsWith("on") && s !== "ref") throw new Error(`Invalid prop '${s}' of type 'function' supplied to '${t}'.`);
      } else e[0] += ` ${s}="`, se(a.toString(), e), e[0] += '"';
    }
    if (Yn.includes(t) && n.length === 0) {
      e[0] += "/>";
      return;
    }
    e[0] += ">", It(n, e), e[0] += `</${t}>`;
  }
};
var Et = class extends H {
  static {
    __name(this, "Et");
  }
  toStringToBuffer(e) {
    const { children: t } = this, r = { ...this.props };
    t.length && (r.children = t.length === 1 ? t[0] : t);
    const n = this.tag.call(null, r);
    if (!(typeof n == "boolean" || n == null)) if (n instanceof Promise) if (Ae.length === 0) e.unshift("", n);
    else {
      const i = Ae.map((s) => [s, s.values.at(-1)]);
      e.unshift("", n.then((s) => (s instanceof H && (s.localContexts = i), s)));
    }
    else n instanceof H ? n.toStringToBuffer(e) : typeof n == "number" || n.isEscaped ? (e[0] += n, n.callbacks && (e.callbacks || (e.callbacks = []), e.callbacks.push(...n.callbacks))) : se(n, e);
  }
};
var Pr = class extends H {
  static {
    __name(this, "Pr");
  }
  toStringToBuffer(e) {
    It(this.children, e);
  }
};
var Gt = /* @__PURE__ */ __name((e, t, ...r) => {
  t ?? (t = {}), r.length && (t.children = r.length === 1 ? r[0] : r);
  const n = t.key;
  delete t.key;
  const i = st(e, t, r);
  return i.key = n, i;
}, "Gt");
var Jt = false;
var st = /* @__PURE__ */ __name((e, t, r) => {
  if (!Jt) {
    for (const n in xt) _t[n][jt] = xt[n];
    Jt = true;
  }
  return typeof e == "function" ? new Et(e, t, r) : _t[e] ? new Et(_t[e], t, r) : e === "svg" || e === "head" ? (qe || (qe = Mt("")), new H(e, t, [new Et(qe, { value: e }, r)])) : new H(e, t, r);
}, "st");
var Kn = /* @__PURE__ */ __name(({ children: e }) => new Pr("", { children: e }, Array.isArray(e) ? e : e ? [e] : []), "Kn");
function Pe(e, t, r) {
  let n;
  if (!t || !("children" in t)) n = st(e, t, []);
  else {
    const i = t.children;
    n = Array.isArray(i) ? st(e, t, i) : st(e, t, [i]);
  }
  return n.key = r, n;
}
__name(Pe, "Pe");
var Fe = "_hp";
var Gn = { Change: "Input", DoubleClick: "DblClick" };
var Jn = { svg: "2000/svg", math: "1998/Math/MathML" };
var Ue = [];
var Dt = /* @__PURE__ */ new WeakMap();
var Ce = void 0;
var Xn = /* @__PURE__ */ __name(() => Ce, "Xn");
var V = /* @__PURE__ */ __name((e) => "t" in e, "V");
var bt = { onClick: ["click", false] };
var Xt = /* @__PURE__ */ __name((e) => {
  if (!e.startsWith("on")) return;
  if (bt[e]) return bt[e];
  const t = e.match(/^on([A-Z][a-zA-Z]+?(?:PointerCapture)?)(Capture)?$/);
  if (t) {
    const [, r, n] = t;
    return bt[e] = [(Gn[r] || r).toLowerCase(), !!n];
  }
}, "Xt");
var Zt = /* @__PURE__ */ __name((e, t) => Ce && e instanceof SVGElement && /[A-Z]/.test(t) && (t in e.style || t.match(/^(?:o|pai|str|u|ve)/)) ? t.replace(/([A-Z])/g, "-$1").toLowerCase() : t, "Zt");
var Zn = /* @__PURE__ */ __name((e, t, r) => {
  var n;
  t || (t = {});
  for (let i in t) {
    const s = t[i];
    if (i !== "children" && (!r || r[i] !== s)) {
      i = ft(i);
      const a = Xt(i);
      if (a) {
        if ((r == null ? void 0 : r[i]) !== s && (r && e.removeEventListener(a[0], r[i], a[1]), s != null)) {
          if (typeof s != "function") throw new Error(`Event handler for "${i}" is not a function`);
          e.addEventListener(a[0], s, a[1]);
        }
      } else if (i === "dangerouslySetInnerHTML" && s) e.innerHTML = s.__html;
      else if (i === "ref") {
        let c;
        typeof s == "function" ? c = s(e) || (() => s(null)) : s && "current" in s && (s.current = e, c = /* @__PURE__ */ __name(() => s.current = null, "c")), Dt.set(e, c);
      } else if (i === "style") {
        const c = e.style;
        typeof s == "string" ? c.cssText = s : (c.cssText = "", s != null && Ir(s, c.setProperty.bind(c)));
      } else {
        if (i === "value") {
          const o = e.nodeName;
          if (o === "INPUT" || o === "TEXTAREA" || o === "SELECT") {
            if (e.value = s == null || s === false ? null : s, o === "TEXTAREA") {
              e.textContent = s;
              continue;
            } else if (o === "SELECT") {
              e.selectedIndex === -1 && (e.selectedIndex = 0);
              continue;
            }
          }
        } else (i === "checked" && e.nodeName === "INPUT" || i === "selected" && e.nodeName === "OPTION") && (e[i] = s);
        const c = Zt(e, i);
        s == null || s === false ? e.removeAttribute(c) : s === true ? e.setAttribute(c, "") : typeof s == "string" || typeof s == "number" ? e.setAttribute(c, s) : e.setAttribute(c, s.toString());
      }
    }
  }
  if (r) for (let i in r) {
    const s = r[i];
    if (i !== "children" && !(i in t)) {
      i = ft(i);
      const a = Xt(i);
      a ? e.removeEventListener(a[0], s, a[1]) : i === "ref" ? (n = Dt.get(e)) == null || n() : e.removeAttribute(Zt(e, i));
    }
  }
}, "Zn");
var Qn = /* @__PURE__ */ __name((e, t) => {
  t[A][0] = 0, Ue.push([e, t]);
  const r = t.tag[jt] || t.tag, n = r.defaultProps ? { ...r.defaultProps, ...t.props } : t.props;
  try {
    return [r.call(null, n)];
  } finally {
    Ue.pop();
  }
}, "Qn");
var $r = /* @__PURE__ */ __name((e, t, r, n, i) => {
  var s, a;
  (s = e.vR) != null && s.length && (n.push(...e.vR), delete e.vR), typeof e.tag == "function" && ((a = e[A][1][Fr]) == null || a.forEach((c) => i.push(c))), e.vC.forEach((c) => {
    var o;
    if (V(c)) r.push(c);
    else if (typeof c.tag == "function" || c.tag === "") {
      c.c = t;
      const u = r.length;
      if ($r(c, t, r, n, i), c.s) {
        for (let l = u; l < r.length; l++) r[l].s = true;
        c.s = false;
      }
    } else r.push(c), (o = c.vR) != null && o.length && (n.push(...c.vR), delete c.vR);
  });
}, "$r");
var ei = /* @__PURE__ */ __name((e) => {
  var t;
  for (; e && (e.tag === Fe || !e.e); ) e = e.tag === Fe || !((t = e.vC) != null && t[0]) ? e.nN : e.vC[0];
  return e == null ? void 0 : e.e;
}, "ei");
var Br = /* @__PURE__ */ __name((e) => {
  var t, r, n, i, s, a;
  V(e) || ((r = (t = e[A]) == null ? void 0 : t[1][Fr]) == null || r.forEach((c) => {
    var o;
    return (o = c[2]) == null ? void 0 : o.call(c);
  }), (n = Dt.get(e.e)) == null || n(), e.p === 2 && ((i = e.vC) == null || i.forEach((c) => c.p = 2)), (s = e.vC) == null || s.forEach(Br)), e.p || ((a = e.e) == null || a.remove(), delete e.e), typeof e.tag == "function" && ($e.delete(e), at.delete(e), delete e[A][3], e.a = true);
}, "Br");
var Hr = /* @__PURE__ */ __name((e, t, r) => {
  e.c = t, qr(e, t, r);
}, "Hr");
var Qt = /* @__PURE__ */ __name((e, t) => {
  if (t) {
    for (let r = 0, n = e.length; r < n; r++) if (e[r] === t) return r;
  }
}, "Qt");
var er = /* @__PURE__ */ Symbol();
var qr = /* @__PURE__ */ __name((e, t, r) => {
  var u;
  const n = [], i = [], s = [];
  $r(e, t, n, i, s), i.forEach(Br);
  const a = r ? void 0 : t.childNodes;
  let c, o = null;
  if (r) c = -1;
  else if (!a.length) c = 0;
  else {
    const l = Qt(a, ei(e.nN));
    l !== void 0 ? (o = a[l], c = l) : c = Qt(a, (u = n.find((f) => f.tag !== Fe && f.e)) == null ? void 0 : u.e) ?? -1, c === -1 && (r = true);
  }
  for (let l = 0, f = n.length; l < f; l++, c++) {
    const d = n[l];
    let h;
    if (d.s && d.e) h = d.e, d.s = false;
    else {
      const v = r || !d.e;
      V(d) ? (d.e && d.d && (d.e.textContent = d.t), d.d = false, h = d.e || (d.e = document.createTextNode(d.t))) : (h = d.e || (d.e = d.n ? document.createElementNS(d.n, d.tag) : document.createElement(d.tag)), Zn(h, d.props, d.pP), qr(d, h, v));
    }
    d.tag === Fe ? c-- : r ? h.parentNode || t.appendChild(h) : a[c] !== h && a[c - 1] !== h && (a[c + 1] === h ? t.appendChild(a[c]) : t.insertBefore(h, o || a[c] || null));
  }
  if (e.pP && (e.pP = void 0), s.length) {
    const l = [], f = [];
    s.forEach(([, d, , h, v]) => {
      d && l.push(d), h && f.push(h), v == null || v();
    }), l.forEach((d) => d()), f.length && requestAnimationFrame(() => {
      f.forEach((d) => d());
    });
  }
}, "qr");
var ti = /* @__PURE__ */ __name((e, t) => !!(e && e.length === t.length && e.every((r, n) => r[1] === t[n][1])), "ti");
var at = /* @__PURE__ */ new WeakMap();
var At = /* @__PURE__ */ __name((e, t, r) => {
  var s, a, c, o, u, l;
  const n = !r && t.pC;
  r && (t.pC || (t.pC = t.vC));
  let i;
  try {
    r || (r = typeof t.tag == "function" ? Qn(e, t) : Je(t.props.children)), ((s = r[0]) == null ? void 0 : s.tag) === "" && r[0][Ot] && (i = r[0][Ot], e[5].push([e, i, t]));
    const f = n ? [...t.pC] : t.vC ? [...t.vC] : void 0, d = [];
    let h;
    for (let v = 0; v < r.length; v++) {
      if (Array.isArray(r[v])) {
        r.splice(v, 1, ...r[v].flat(1 / 0)), v--;
        continue;
      }
      let m = ri(r[v]);
      if (m) {
        typeof m.tag == "function" && !m.tag[Dr] && (Ae.length > 0 && (m[A][2] = Ae.map((y) => [y, y.values.at(-1)])), (a = e[5]) != null && a.length && (m[A][3] = e[5].at(-1)));
        let g;
        if (f && f.length) {
          const y = f.findIndex(V(m) ? (E) => V(E) : m.key !== void 0 ? (E) => E.key === m.key && E.tag === m.tag : (E) => E.tag === m.tag);
          y !== -1 && (g = f[y], f.splice(y, 1));
        }
        if (g) if (V(m)) g.t !== m.t && (g.t = m.t, g.d = true), m = g;
        else {
          const y = g.pP = g.props;
          if (g.props = m.props, g.f || (g.f = m.f || t.f), typeof m.tag == "function") {
            const E = g[A][2];
            g[A][2] = m[A][2] || [], g[A][3] = m[A][3], !g.f && ((g.o || g) === m.o || (o = (c = g.tag)[Nn]) != null && o.call(c, y, g.props)) && ti(E, g[A][2]) && (g.s = true);
          }
          m = g;
        }
        else if (!V(m) && Ce) {
          const y = je(Ce);
          y && (m.n = y);
        }
        if (!V(m) && !m.s && (At(e, m), delete m.f), d.push(m), h && !h.s && !m.s) for (let y = h; y && !V(y); y = (u = y.vC) == null ? void 0 : u.at(-1)) y.nN = m;
        h = m;
      }
    }
    t.vR = n ? [...t.vC, ...f || []] : f || [], t.vC = d, n && delete t.pC;
  } catch (f) {
    if (t.f = true, f === er) {
      if (i) return;
      throw f;
    }
    const [d, h, v] = ((l = t[A]) == null ? void 0 : l[3]) || [];
    if (h) {
      const m = /* @__PURE__ */ __name(() => ot([0, false, e[2]], v), "m"), g = at.get(v) || [];
      g.push(m), at.set(v, g);
      const y = h(f, () => {
        const E = at.get(v);
        if (E) {
          const w = E.indexOf(m);
          if (w !== -1) return E.splice(w, 1), m();
        }
      });
      if (y) {
        if (e[0] === 1) e[1] = true;
        else if (At(e, v, [y]), (h.length === 1 || e !== d) && v.c) {
          Hr(v, v.c, false);
          return;
        }
        throw er;
      }
    }
    throw f;
  } finally {
    i && e[5].pop();
  }
}, "At");
var ri = /* @__PURE__ */ __name((e) => {
  if (!(e == null || typeof e == "boolean")) {
    if (typeof e == "string" || typeof e == "number") return { t: e.toString(), d: true };
    if ("vR" in e && (e = { tag: e.tag, props: e.props, key: e.key, f: e.f, type: e.tag, ref: e.props.ref, o: e.o || e }), typeof e.tag == "function") e[A] = [0, []];
    else {
      const t = Jn[e.tag];
      t && (Ce || (Ce = Cr("")), e.props.children = [{ tag: Ce, props: { value: e.n = `http://www.w3.org/${t}`, children: e.props.children } }]);
    }
    return e;
  }
}, "ri");
var tr = /* @__PURE__ */ __name((e, t) => {
  var r, n;
  (r = t[A][2]) == null || r.forEach(([i, s]) => {
    i.values.push(s);
  });
  try {
    At(e, t, void 0);
  } catch {
    return;
  }
  if (t.a) {
    delete t.a;
    return;
  }
  (n = t[A][2]) == null || n.forEach(([i]) => {
    i.values.pop();
  }), (e[0] !== 1 || !e[1]) && Hr(t, t.c, false);
}, "tr");
var $e = /* @__PURE__ */ new WeakMap();
var rr = [];
var ot = /* @__PURE__ */ __name(async (e, t) => {
  e[5] || (e[5] = []);
  const r = $e.get(t);
  r && r[0](void 0);
  let n;
  const i = new Promise((s) => n = s);
  if ($e.set(t, [n, () => {
    e[2] ? e[2](e, t, (s) => {
      tr(s, t);
    }).then(() => n(t)) : (tr(e, t), n(t));
  }]), rr.length) rr.at(-1).add(t);
  else {
    await Promise.resolve();
    const s = $e.get(t);
    s && ($e.delete(t), s[1]());
  }
  return i;
}, "ot");
var ni = /* @__PURE__ */ __name((e, t, r) => ({ tag: Fe, props: { children: e }, key: r, e: t, p: 1 }), "ni");
var wt = 0;
var Fr = 1;
var Rt = 2;
var St = 3;
var kt = /* @__PURE__ */ new WeakMap();
var Ur = /* @__PURE__ */ __name((e, t) => !e || !t || e.length !== t.length || t.some((r, n) => r !== e[n]), "Ur");
var ii = void 0;
var nr = [];
var si = /* @__PURE__ */ __name((e) => {
  var a;
  const t = /* @__PURE__ */ __name(() => typeof e == "function" ? e() : e, "t"), r = Ue.at(-1);
  if (!r) return [t(), () => {
  }];
  const [, n] = r, i = (a = n[A][1])[wt] || (a[wt] = []), s = n[A][0]++;
  return i[s] || (i[s] = [t(), (c) => {
    const o = ii, u = i[s];
    if (typeof c == "function" && (c = c(u[0])), !Object.is(c, u[0])) if (u[0] = c, nr.length) {
      const [l, f] = nr.at(-1);
      Promise.all([l === 3 ? n : ot([l, false, o], n), f]).then(([d]) => {
        if (!d || !(l === 2 || l === 3)) return;
        const h = d.vC;
        requestAnimationFrame(() => {
          setTimeout(() => {
            h === d.vC && ot([l === 3 ? 1 : 0, false, o], d);
          });
        });
      });
    } else ot([0, false, o], n);
  }]);
}, "si");
var Pt = /* @__PURE__ */ __name((e, t) => {
  var c;
  const r = Ue.at(-1);
  if (!r) return e;
  const [, n] = r, i = (c = n[A][1])[Rt] || (c[Rt] = []), s = n[A][0]++, a = i[s];
  return Ur(a == null ? void 0 : a[1], t) ? i[s] = [e, t] : e = i[s][0], e;
}, "Pt");
var ai = /* @__PURE__ */ __name((e) => {
  const t = kt.get(e);
  if (t) {
    if (t.length === 2) throw t[1];
    return t[0];
  }
  throw e.then((r) => kt.set(e, [r]), (r) => kt.set(e, [void 0, r])), e;
}, "ai");
var oi = /* @__PURE__ */ __name((e, t) => {
  var c;
  const r = Ue.at(-1);
  if (!r) return e();
  const [, n] = r, i = (c = n[A][1])[St] || (c[St] = []), s = n[A][0]++, a = i[s];
  return Ur(a == null ? void 0 : a[1], t) && (i[s] = [e(), t]), i[s][0];
}, "oi");
var ci = Cr({ pending: false, data: null, method: null, action: null });
var ir = /* @__PURE__ */ new Set();
var li = /* @__PURE__ */ __name((e) => {
  ir.add(e), e.finally(() => ir.delete(e));
}, "li");
var $t = /* @__PURE__ */ __name((e, t) => oi(() => (r) => {
  let n;
  e && (typeof e == "function" ? n = e(r) || (() => {
    e(null);
  }) : e && "current" in e && (e.current = r, n = /* @__PURE__ */ __name(() => {
    e.current = null;
  }, "n")));
  const i = t(r);
  return () => {
    i == null || i(), n == null || n();
  };
}, [e]), "$t");
var ye = /* @__PURE__ */ Object.create(null);
var tt = /* @__PURE__ */ Object.create(null);
var Qe = /* @__PURE__ */ __name((e, t, r, n, i) => {
  if (t != null && t.itemProp) return { tag: e, props: t, type: e, ref: t.ref };
  const s = document.head;
  let { onLoad: a, onError: c, precedence: o, blocking: u, ...l } = t, f = null, d = false;
  const h = dt[e], v = jr(e, n), m = /* @__PURE__ */ __name((S) => S.getAttribute("rel") === "stylesheet" && S.getAttribute(ce) !== null, "m");
  let g;
  if (v) {
    const S = s.querySelectorAll(e);
    e: for (const O of S) if (!(e === "link" && !m(O))) {
      for (const k of h) if (O.getAttribute(k) === t[k]) {
        f = O;
        break e;
      }
    }
    if (!f) {
      const O = h.reduce((k, D) => t[D] === void 0 ? k : `${k}-${D}-${t[D]}`, e);
      d = !tt[O], f = tt[O] || (tt[O] = (() => {
        const k = document.createElement(e);
        for (const D of h) t[D] !== void 0 && k.setAttribute(D, t[D]);
        return t.rel && k.setAttribute("rel", t.rel), k;
      })());
    }
  } else g = s.querySelectorAll(e);
  o = n ? o ?? "" : void 0, n && (l[ce] = o);
  const y = Pt((S) => {
    if (v) {
      if (e === "link" && o !== void 0) {
        let k = false;
        for (const D of s.querySelectorAll(e)) {
          const q = D.getAttribute(ce);
          if (q === null) {
            s.insertBefore(S, D);
            return;
          }
          if (k && q !== o) {
            s.insertBefore(S, D);
            return;
          }
          q === o && (k = true);
        }
        s.appendChild(S);
        return;
      }
      let O = false;
      for (const k of s.querySelectorAll(e)) {
        if (O && k.getAttribute(ce) !== o) {
          s.insertBefore(S, k);
          return;
        }
        k.getAttribute(ce) === o && (O = true);
      }
      s.appendChild(S);
    } else if (e === "link") s.contains(S) || s.appendChild(S);
    else if (g) {
      let O = false;
      for (const k of g) if (k === S) {
        O = true;
        break;
      }
      O || s.insertBefore(S, s.contains(g[0]) ? g[0] : s.querySelector(e)), g = void 0;
    }
  }, [v, o, e]), E = $t(t.ref, (S) => {
    var D;
    const O = h[0];
    if (r === 2 && (S.innerHTML = ""), (d || g) && y(S), !c && !a || !O) return;
    let k = ye[D = S.getAttribute(O)] || (ye[D] = new Promise((q, I) => {
      S.addEventListener("load", q), S.addEventListener("error", I);
    }));
    a && (k = k.then(a)), c && (k = k.catch(c)), k.catch(() => {
    });
  });
  if (i && u === "render") {
    const S = dt[e][0];
    if (S && t[S]) {
      const O = t[S], k = ye[O] || (ye[O] = new Promise((D, q) => {
        y(f), f.addEventListener("load", D), f.addEventListener("error", q);
      }));
      ai(k);
    }
  }
  const w = { tag: e, type: e, props: { ...l, ref: E }, ref: E };
  return w.p = r, f && (w.e = f), ni(w, s);
}, "Qe");
var ui = /* @__PURE__ */ __name((e) => {
  const t = Xn(), r = t && je(t);
  return r != null && r.endsWith("svg") ? { tag: "title", props: e, type: "title", ref: e.ref } : Qe("title", e, void 0, false, false);
}, "ui");
var di = /* @__PURE__ */ __name((e) => !e || ["src", "async"].some((t) => !e[t]) ? { tag: "script", props: e, type: "script", ref: e.ref } : Qe("script", e, 1, false, true), "di");
var fi = /* @__PURE__ */ __name((e) => !e || !["href", "precedence"].every((t) => t in e) ? { tag: "style", props: e, type: "style", ref: e.ref } : (e["data-href"] = e.href, delete e.href, Qe("style", e, 2, true, true)), "fi");
var pi = /* @__PURE__ */ __name((e) => !e || ["onLoad", "onError"].some((t) => t in e) || e.rel === "stylesheet" && (!("precedence" in e) || "disabled" in e) ? { tag: "link", props: e, type: "link", ref: e.ref } : Qe("link", e, 1, Lr(e), true), "pi");
var hi = /* @__PURE__ */ __name((e) => Qe("meta", e, void 0, false, false), "hi");
var Wr = /* @__PURE__ */ Symbol();
var mi = /* @__PURE__ */ __name((e) => {
  const { action: t, ...r } = e;
  typeof t != "function" && (r.action = t);
  const [n, i] = si([null, false]), s = Pt(async (u) => {
    const l = u.isTrusted ? t : u.detail[Wr];
    if (typeof l != "function") return;
    u.preventDefault();
    const f = new FormData(u.target);
    i([f, true]);
    const d = l(f);
    d instanceof Promise && (li(d), await d), i([null, true]);
  }, []), a = $t(e.ref, (u) => (u.addEventListener("submit", s), () => {
    u.removeEventListener("submit", s);
  })), [c, o] = n;
  return n[1] = false, { tag: ci, props: { value: { pending: c !== null, data: c, method: c ? "post" : null, action: c ? t : null }, children: { tag: "form", props: { ...r, ref: a }, type: "form", ref: a } }, f: o };
}, "mi");
var zr = /* @__PURE__ */ __name((e, { formAction: t, ...r }) => {
  if (typeof t == "function") {
    const n = Pt((i) => {
      i.preventDefault(), i.currentTarget.form.dispatchEvent(new CustomEvent("submit", { detail: { [Wr]: t } }));
    }, []);
    r.ref = $t(r.ref, (i) => (i.addEventListener("click", n), () => {
      i.removeEventListener("click", n);
    }));
  }
  return { tag: e, props: r, type: e, ref: r.ref };
}, "zr");
var vi = /* @__PURE__ */ __name((e) => zr("input", e), "vi");
var gi = /* @__PURE__ */ __name((e) => zr("button", e), "gi");
Object.assign(xt, { title: ui, script: di, style: fi, link: pi, meta: hi, form: mi, input: vi, button: gi });
Mt(null);
var sr = new TextEncoder();
var yi = /* @__PURE__ */ __name((e, t = console.trace) => {
  let r = false;
  return new ReadableStream({ async start(i) {
    var s;
    try {
      e instanceof H && (e = e.toString());
      const a = typeof e == "object" ? e : {}, c = await ct(e, we.BeforeStream, true, a);
      r || i.enqueue(sr.encode(c));
      let o = 0;
      const u = [], l = /* @__PURE__ */ __name((f) => {
        u.push(f.catch((d) => (console.log(d), t(d), "")).then(async (d) => {
          var h;
          d = await ct(d, we.BeforeStream, true, a), (h = d.callbacks) == null || h.map((v) => v({ phase: we.Stream, context: a })).filter(Boolean).forEach(l), o++, r || i.enqueue(sr.encode(d));
        }));
      }, "l");
      for ((s = c.callbacks) == null || s.map((f) => f({ phase: we.Stream, context: a })).filter(Boolean).forEach(l); o !== u.length; ) await Promise.all(u);
    } catch (a) {
      t(a);
    }
    r || i.close();
  }, cancel() {
    r = true;
  } });
}, "yi");
var _i = Mt(null);
var Ei = /* @__PURE__ */ __name((e, t, r, n) => (i, s) => {
  n = typeof n == "function" ? n(e) : n;
  const a = typeof (n == null ? void 0 : n.docType) == "string" ? n.docType : (n == null ? void 0 : n.docType) === false ? "" : "<!DOCTYPE html>", c = r ? Gt((u) => r(u, e), { Layout: t, ...s }, i) : i, o = Mn`${P(a)}${Gt(_i.Provider, { value: e }, c)}`;
  if (n != null && n.stream) {
    if (n.stream === true) e.header("Transfer-Encoding", "chunked"), e.header("Content-Type", "text/html; charset=UTF-8"), e.header("Content-Encoding", "Identity");
    else for (const [u, l] of Object.entries(n.stream)) e.header(u, l);
    return e.body(yi(o));
  } else return e.html(o);
}, "Ei");
var bi = /* @__PURE__ */ __name((e, t) => function(n, i) {
  const s = n.getLayout() ?? Kn;
  return e && n.setLayout((a) => e({ ...a, Layout: s }, n)), n.setRenderer(Ei(n, s, e, t)), i();
}, "bi");
var wi = bi(({ children: e }) => Pe("html", { children: [Pe("head", { children: Pe("link", { href: "/static/style.css", rel: "stylesheet" }) }), Pe("body", { children: e })] }));
var Bt = new Lt();
Bt.use(wi);
Bt.get("/", (e) => e.render(Pe("h1", { children: "Hello!" })));
var ar = new Lt();
var Ri = Object.assign({ "/src/index.ts": T, "/src/index.tsx": Bt });
var Yr = false;
for (const [, e] of Object.entries(Ri)) e && (ar.all("*", (t) => {
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
}), Yr = true);
if (!Yr) throw new Error("Can't import modules from ['/src/index.ts','/src/index.tsx','/app/server.ts']");

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

// ../.wrangler/tmp/bundle-8LRmp5/middleware-insertion-facade.js
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

// ../.wrangler/tmp/bundle-8LRmp5/middleware-loader.entry.ts
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
//# sourceMappingURL=bundledWorker-0.7392340247969004.mjs.map
