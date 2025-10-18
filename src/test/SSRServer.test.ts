// @vitest-environment node

import fastify from 'fastify';
import { beforeEach, afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';

const {
  AppErrorFake,
  mockLogger,
  maps,
  processConfigsMock,
  loadAssetsMock,
  routeMatchersMock,
  // authHookFn,
  createAuthHookMock,
  cspPluginMock,
  cspReportPluginMock,
  devRef,
  handleRenderMock,
  handleNotFoundMock,
  setupDevServerMock,
  toHttpMock,
} = vi.hoisted(() => {
  class AppErrorFake {
    message!: string;
    kind = 'infra';
    httpStatus = 500;
    code?: string;
    details?: unknown;
    stack = 'stack';
    safeMessage?: string;
    static from = vi.fn((err: any) =>
      Object.assign(new AppErrorFake(), {
        message: err?.message ?? 'boom',
        httpStatus: err?.httpStatus ?? 500,
        details: err?.details,
      }),
    );
  }

  const mockLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

  const maps = {
    bootstrapModules: new Map<string, string>(),
    cssLinks: new Map<string, string>(),
    manifests: new Map<string, string>(),
    preloadLinks: new Map<string, string>(),
    renderModules: new Map<string, string>(),
    ssrManifests: new Map<string, string>(),
    templates: new Map<string, string>(),
  };

  const processConfigsMock = vi.fn((configs: any[], baseClientRoot: string, TEMPLATE: unknown) =>
    configs.map((c: any) => ({ ...c, clientRoot: baseClientRoot, template: TEMPLATE })),
  );
  const loadAssetsMock = vi.fn(async () => {});
  const routeMatchersMock = { match: vi.fn() };
  const authHookFn = vi.fn((_req: any, _reply: any, done: any) => done && done());
  const createAuthHookMock = vi.fn(() => authHookFn);
  const cspPluginMock = vi.fn(async (_instance: any, _opts: any, done?: () => void) => done?.());
  const cspReportPluginMock = vi.fn(async (_instance: any, _opts: any, done?: () => void) => done?.());
  const devRef = { value: false };
  const handleRenderMock = vi.fn(async (_req: any, reply: any) => {
    reply.status(200).send('OK:handleRender');
  });
  const handleNotFoundMock = vi.fn(async (_req: any, reply: any) => {
    reply.status(200).send('OK:notFound');
  });
  const setupDevServerMock = vi.fn(async () => ({ name: 'vite-dev' }));
  const toHttpMock = vi.fn((_e: any) => ({ status: 499, body: { message: 'safe' } }));

  return {
    AppErrorFake,
    mockLogger,
    maps,
    processConfigsMock,
    loadAssetsMock,
    routeMatchersMock,
    authHookFn,
    createAuthHookMock,
    cspPluginMock,
    cspReportPluginMock,
    devRef,
    handleRenderMock,
    handleNotFoundMock,
    setupDevServerMock,
    toHttpMock,
  };
});

vi.mock('../logging/Logger', () => ({ createLogger: vi.fn(() => mockLogger) }));

vi.mock('../utils/AssetManager', () => ({
  createMaps: vi.fn(() => maps),
  loadAssets: loadAssetsMock,
  processConfigs: processConfigsMock,
}));

vi.mock('../utils/DataRoutes', () => ({ createRouteMatchers: vi.fn(() => routeMatchersMock) }));

vi.mock('../security/Auth', () => ({ createAuthHook: createAuthHookMock }));

vi.mock('../security/CSP', () => ({ cspPlugin: cspPluginMock }));

vi.mock('../security/CSPReporting', () => ({ cspReportPlugin: cspReportPluginMock }));

vi.mock('../utils/System', () => ({
  get isDevelopment() {
    return devRef.value;
  },
}));

vi.mock('../utils/HandleRender', () => ({ handleRender: handleRenderMock }));

vi.mock('../utils/HandleNotFound', () => ({ handleNotFound: handleNotFoundMock }));

vi.mock('../utils/DevServer', () => ({ setupDevServer: setupDevServerMock }));

vi.mock('../logging/utils', () => ({ toHttp: toHttpMock }));

vi.mock('../logging/AppError', () => ({ AppError: AppErrorFake }));

import { SSRServer, TEMPLATE } from '../SSRServer';
import { loadAssets } from '../utils/AssetManager';
import { createAuthHook } from '../security/Auth';
import { createLogger } from '../logging/Logger';

describe('SSRServer (new wiring) - Fastify integration with mocks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    devRef.value = false;
    app = fastify();

    // Shim: some path-to-regexp versions dislike '/*' - translate to '*' during test
    const origGet = (app.get as any).bind(app) as (...args: any[]) => any;
    (app as any).get = (path: string, ...rest: any[]) => {
      if (path === '/*') {
        return origGet.apply(app, ['*', ...rest]);
      }
      return origGet.apply(app, [path, ...rest]);
    };
  });

  afterEach(async () => {
    await app.close();
  });

  it('re-exports TEMPLATE', () => {
    expect(TEMPLATE).toBeDefined();
  });

  it('basic registration wires assets, CSP, auth, GET, notFound', async () => {
    const addHookSpy = vi.spyOn(app, 'addHook');

    await app.register(SSRServer as any, {
      alias: {},
      configs: [{ appId: 'a', entryPoint: '.' }],
      routes: [{ path: '/*' }],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: false,
      security: {},
    });

    // Assets wired
    expect(processConfigsMock).toHaveBeenCalledWith(expect.any(Array), '/client', TEMPLATE);
    expect(loadAssets).toHaveBeenCalledWith(
      expect.any(Array),
      '/client',
      maps.bootstrapModules,
      maps.cssLinks,
      maps.manifests,
      maps.preloadLinks,
      maps.renderModules,
      maps.ssrManifests,
      maps.templates,
      expect.objectContaining({ logger: mockLogger, debug: false }),
    );

    // CSP plugin called with route matchers + debug
    const cspCall = cspPluginMock.mock.calls[0];
    expect(cspCall?.[1]).toEqual(
      expect.objectContaining({
        directives: undefined,
        generateCSP: undefined,
        routeMatchers: routeMatchersMock,
        debug: false,
      }),
    );

    // Auth hook added and executes
    expect(addHookSpy).toHaveBeenCalledWith('onRequest', expect.any(Function));
    expect(createAuthHook).toHaveBeenCalledWith(expect.any(Object), mockLogger);

    // GET route triggers handleRender
    const res = await app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('OK:handleRender');

    // notFound is set - exercise by hitting an unmapped verb/path
    const res2 = await app.inject({ method: 'DELETE', url: '/nope' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toBe('OK:notFound');

    // ensure notFound called with expected maps subset
    expect(handleNotFoundMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.any(Array),
      {
        cssLinks: maps.cssLinks,
        bootstrapModules: maps.bootstrapModules,
        templates: maps.templates,
      },
      expect.objectContaining({ logger: mockLogger, debug: false }),
    );
  });

  it('registers static assets when provided as object', async () => {
    const staticPlugin: FastifyPluginCallback<any> = (inst, _opts, done) => {
      inst.get('/static-check', async (_req, reply) => reply.send('static-ok'));
      done();
    };

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/pub',
      debug: true,
      registerStaticAssets: { plugin: staticPlugin, options: { foo: 'bar' } },
    });

    const res = await app.inject({ method: 'GET', url: '/static-check' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('static-ok');
  });

  it('registers CSP reporting when configured', async () => {
    const onViolation = vi.fn();

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: ['errors'],
      security: { csp: { reporting: { endpoint: '/csp-end', onViolation } } },
    });

    expect(cspReportPluginMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        path: '/csp-end',
        debug: ['errors'],
        logger: mockLogger,
        onViolation,
      }),
      expect.any(Function),
    );
  });

  it('starts dev server only when isDevelopment = true and passes it to handleRender', async () => {
    devRef.value = true;

    await app.register(SSRServer as any, {
      alias: { '@': '/src' },
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: { all: true },
      devNet: { host: 'localhost', hmrPort: 5173 },
    });

    expect(setupDevServerMock).toHaveBeenCalledWith(expect.any(Object), '/client', { '@': '/src' }, { all: true }, { host: 'localhost', hmrPort: 5173 });

    await app.inject({ method: 'GET', url: '/x' });

    const lastCall = handleRenderMock.mock.calls[handleRenderMock.mock.calls.length - 1] as any[] | undefined;
    const opts = lastCall?.[6] as any;
    expect(opts?.viteDevServer).toBeDefined();
  });

  it('non-dev mode does not set viteDevServer', async () => {
    devRef.value = false;

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: false,
    });

    await app.inject({ method: 'GET', url: '/x' });

    const lastCall = handleRenderMock.mock.calls[handleRenderMock.mock.calls.length - 1] as any[] | undefined;
    const opts = lastCall?.[6] as any;
    expect(opts?.viteDevServer).toBeUndefined();
  });

  it('error handler: logs + uses toHttp when headers not sent', async () => {
    handleRenderMock.mockImplementationOnce(async () => {
      const err: any = new Error('render-fail');
      err.httpStatus = 418;
      err.details = { a: 1 };
      throw err;
    });

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
    });

    const res = await app.inject({ method: 'GET', url: '/err' });

    expect(AppErrorFake.from).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        httpStatus: 418,
        method: 'GET',
        url: '/err',
        route: expect.anything(),
        stack: 'stack',
      }),
    );
    expect(toHttpMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(499);
    expect(res.json()).toEqual({ message: 'safe' });
  });

  it('error handler: ends raw stream if headers already sent', async () => {
    let errorHandlerFn: any;

    const setErrorHandlerSpy = vi.spyOn(app, 'setErrorHandler');

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
    });

    errorHandlerFn = setErrorHandlerSpy.mock.calls[0]?.[0];
    expect(errorHandlerFn).toBeDefined();

    const mockReq = { method: 'GET', url: '/test', routeOptions: { url: '/test' } };
    const mockReply = {
      raw: {
        headersSent: true,
        end: vi.fn(),
      },
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    const testError = new Error('test-error');

    errorHandlerFn(testError, mockReq, mockReply);

    expect(AppErrorFake.from).toHaveBeenCalledWith(testError);
    expect(toHttpMock).not.toHaveBeenCalled();
    expect(mockReply.raw.end).toHaveBeenCalled();
    expect(mockReply.status).not.toHaveBeenCalled();
    expect(mockReply.send).not.toHaveBeenCalled();
  });

  it('uses minLevel "debug" when not in production', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: false,
    });

    const args = (createLogger as unknown as Mock).mock.calls[0]![0];
    expect(args.minLevel).toBe('debug');

    process.env.NODE_ENV = orig;
  });

  it('uses minLevel "info" when NODE_ENV=production', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
      debug: false,
    });

    const args = (createLogger as unknown as Mock).mock.calls[0]![0];
    expect(args.minLevel).toBe('info');

    process.env.NODE_ENV = orig;
  });

  it('registers static assets with default empty options when options is undefined', async () => {
    let capturedOpts: any;
    const staticPlugin: FastifyPluginCallback<any> = (inst, opts, done) => {
      capturedOpts = opts;
      inst.get('/static-default', async (_req, reply) => reply.send('ok-default'));
      done();
    };

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/pub',
      debug: false,
      registerStaticAssets: { plugin: staticPlugin }, // <-- no options
    });

    // plugin should have received our base fields + spread of {} (no crash)
    expect(capturedOpts).toEqual(
      expect.objectContaining({
        root: '/pub',
        prefix: '/',
        index: false,
        wildcard: false,
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/static-default' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok-default');
  });

  it('error handler includes {code} only when e.code is truthy', async () => {
    const originalFrom = (AppErrorFake.from as Mock).mockImplementation;

    // Make from() return a truthy code this time
    (AppErrorFake.from as Mock).mockImplementation((err: any) =>
      Object.assign(new AppErrorFake(), {
        message: err?.message ?? 'boom',
        httpStatus: 500,
        details: { x: 1 },
        code: 'E42',
      }),
    );

    handleRenderMock.mockImplementationOnce(async () => {
      throw new Error('kaboom');
    });

    await app.register(SSRServer as any, {
      alias: {},
      configs: [],
      routes: [],
      serviceRegistry: {},
      clientRoot: '/client',
    });

    await app.inject({ method: 'GET', url: '/err2' });

    expect(mockLogger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'E42' }));
  });
});
