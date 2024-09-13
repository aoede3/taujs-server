import { describe, it, expect, vi } from 'vitest';
import { matchRoute, callServiceMethod, fetchData, collectStyle, renderPreloadLinks, renderPreloadLink, getCssLinks, overrideCSSHMRConsoleError } from './';

import type { ServiceRegistry } from '../';

describe('collectStyle', () => {
  // it('should collect and return styles with correct comments and transformed code', async () => {
  //   const server = {
  //     transformRequest: vi.fn((url) => {
  //       if (url.includes('entry.css')) return Promise.resolve({ code: '/* mockCode for entry.css */' });
  //       if (url.includes('module1.css')) return Promise.resolve({ code: '/* mockCode for module1.css */' });
  //       if (url.includes('module2.css')) return Promise.resolve({ code: '/* mockCode for module2.css */' });
  //       return Promise.resolve(null);
  //     }),
  //     moduleGraph: {
  //       resolveUrl: vi.fn((url) => Promise.resolve([null, `${url}-id`])),
  //       getModuleById: vi.fn((id) => {
  //         if (id.includes('entry.css-id')) {
  //           return {
  //             importedModules: new Set([{ url: 'module1.css' }, { url: 'module2.css' }]),
  //           };
  //         }
  //         return null;
  //       }),
  //     },
  //   };
  //   const entries = ['entry.css'];
  //   const result = await collectStyle(server, entries);

  //   expect(result).toContain('/* [collectStyle] entry.css */');
  //   expect(result).toContain('/* mockCode for entry.css */');
  //   expect(result).toContain('/* [collectStyle] module1.css */');
  //   expect(result).toContain('/* mockCode for module1.css */');
  //   expect(result).toContain('/* [collectStyle] module2.css */');
  //   expect(result).toContain('/* mockCode for module2.css */');
  // });

  it('should return an empty string if no CSS files are found', async () => {
    const server = {
      transformRequest: vi.fn(() => Promise.resolve(null)),
      moduleGraph: {
        resolveUrl: vi.fn(() => Promise.resolve([null, 'entry.css-id'])),
        getModuleById: vi.fn(() => null),
      },
    };
    const entries = ['entry.css'];
    const result = await collectStyle(server, entries);

    expect(result).toBe('');
  });

  it('should not traverse or transform if modules have already been visited', async () => {
    const server = {
      transformRequest: vi.fn(() => Promise.resolve(null)),
      moduleGraph: {
        resolveUrl: vi.fn(() => Promise.resolve([null, 'entry.css-id'])),
        getModuleById: vi.fn(() => ({
          importedModules: new Set([{ url: 'module1.css' }, { url: 'module1.css' }]),
        })),
      },
    };
    const entries = ['entry.css'];
    const result = await collectStyle(server, entries);

    expect(result).toBe('');
  });
});

describe('renderPreloadLinks', () => {
  it('should render preload links for modules', () => {
    const manifest = {
      module1: ['file1.js', 'file1.css'],
      module2: ['file2.js'],
    };
    const modules = ['module1', 'module2'];
    const result = renderPreloadLinks(modules, manifest);

    expect(result).toContain('<link rel="modulepreload" href="file1.js">');
    expect(result).toContain('<link rel="stylesheet" href="file1.css">');
    expect(result).toContain('<link rel="modulepreload" href="file2.js">');
  });
});

describe('renderPreloadLink', () => {
  it('should return appropriate preload link based on file type', () => {
    expect(renderPreloadLink('file.js')).toBe('<link rel="modulepreload" href="file.js">');
    expect(renderPreloadLink('file.css')).toBe('<link rel="stylesheet" href="file.css">');
    expect(renderPreloadLink('file.png')).toBe('<link rel="preload" href="file.png" as="image" type="image/png">');
  });

  it('should return an empty string for unsupported file types', () => {
    expect(renderPreloadLink('file.txt')).toBe('');
  });

  it('should return correct preload link for woff font files', () => {
    const result = renderPreloadLink('font.woff');

    expect(result).toBe('<link rel="preload" href="font.woff" as="font" type="font/woff" crossorigin>');
  });

  it('should return correct preload link for woff2 font files', () => {
    const result = renderPreloadLink('font.woff2');

    expect(result).toBe('<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>');
  });

  it('should return correct preload link for gif image files', () => {
    const result = renderPreloadLink('image.gif');

    expect(result).toBe('<link rel="preload" href="image.gif" as="image" type="image/gif">');
  });

  it('should return correct preload link for jpeg image files', () => {
    const result = renderPreloadLink('image.jpeg');

    expect(result).toBe('<link rel="preload" href="image.jpeg" as="image" type="image/jpeg">');
  });

  it('should return correct preload link for jpg image files', () => {
    const result = renderPreloadLink('image.jpg');

    expect(result).toBe('<link rel="preload" href="image.jpg" as="image" type="image/jpg">');
  });

  it('should return correct preload link for png image files', () => {
    const result = renderPreloadLink('image.png');

    expect(result).toBe('<link rel="preload" href="image.png" as="image" type="image/png">');
  });

  it('should return correct preload link for svg image files', () => {
    const result = renderPreloadLink('image.svg');

    expect(result).toBe('<link rel="preload" href="image.svg" as="image" type="image/svg+xml">');
  });

  it('should return an empty string for unsupported file types', () => {
    const result = renderPreloadLink('file.txt');

    expect(result).toBe('');
  });
});

describe('callServiceMethod', () => {
  it('should call the specified service method and return data', async () => {
    const mockMethod = vi.fn().mockResolvedValue({ data: 'test' });
    const serviceRegistry: ServiceRegistry = {
      myService: {
        myMethod: mockMethod,
      },
    };
    const result = await callServiceMethod(serviceRegistry, 'myService', 'myMethod', {});

    expect(mockMethod).toHaveBeenCalledWith({});
    expect(result).toEqual({ data: 'test' });
  });

  it('should throw an error if service method does not exist', async () => {
    const serviceRegistry: ServiceRegistry = {
      myService: {},
    };

    await expect(callServiceMethod(serviceRegistry, 'myService', 'nonexistentMethod', {})).rejects.toThrow(
      'Service method nonexistentMethod does not exist on myService',
    );
  });

  it('should throw an error if the response is not an object', async () => {
    const mockMethod = vi.fn().mockResolvedValue('not-an-object');
    const serviceRegistry: ServiceRegistry = {
      myService: {
        myMethod: mockMethod,
      },
    };

    await expect(callServiceMethod(serviceRegistry, 'myService', 'myMethod', {})).rejects.toThrow(
      'Expected object response from service method myMethod on myService, but got string',
    );
  });

  it('should throw an error if the response is null', async () => {
    const mockMethod = vi.fn().mockResolvedValue(null);
    const serviceRegistry: ServiceRegistry = {
      myService: {
        myMethod: mockMethod,
      },
    };

    await expect(callServiceMethod(serviceRegistry, 'myService', 'myMethod', {})).rejects.toThrow(
      'Expected object response from service method myMethod on myService, but got object',
    );
  });

  it('should not throw an error if the response is a valid object', async () => {
    const mockMethod = vi.fn().mockResolvedValue({ success: true });
    const serviceRegistry: ServiceRegistry = {
      myService: {
        myMethod: mockMethod,
      },
    };
    const result = await callServiceMethod(serviceRegistry, 'myService', 'myMethod', {});

    expect(result).toEqual({ success: true });
  });
});

describe('fetchData', () => {
  it('should fetch data from a URL and return the parsed JSON', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      }),
    );
    const result = await fetchData({ url: 'https://example.com', options: {} });

    expect(result).toEqual({ data: 'test' });
  });

  it('should throw an error if the fetch fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
      }),
    );

    await expect(fetchData({ url: 'https://example.com', options: {} })).rejects.toThrow('Failed to fetch data from https://example.com');
  });

  it('should throw an error if the fetched data is not an object', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve('not-an-object'),
      }),
    );
    const fetchConfig = { url: 'https://example.com', options: {} };

    await expect(fetchData(fetchConfig)).rejects.toThrow('Expected object response from https://example.com, but got string');
  });

  it('should throw an error if the fetched data is null', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(null),
      }),
    );
    const fetchConfig = { url: 'https://example.com', options: {} };

    await expect(fetchData(fetchConfig)).rejects.toThrow('Expected object response from https://example.com, but got object');
  });

  it('should throw an error if URL is not provided', async () => {
    const fetchConfig = { url: '', options: {} };

    await expect(fetchData(fetchConfig)).rejects.toThrow('URL must be provided to fetch data');
  });

  it('should throw an error if the fetch request fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
      }),
    );
    const fetchConfig = { url: 'https://example.com', options: {} };

    await expect(fetchData(fetchConfig)).rejects.toThrow('Failed to fetch data from https://example.com');
  });

  it('should return the fetched data if it is a valid object', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      }),
    );
    const fetchConfig = { url: 'https://example.com', options: {} };
    const result = await fetchData(fetchConfig);

    expect(result).toEqual({ success: true });
  });
});

describe('matchRoute', () => {
  it('should match a URL to a route', () => {
    const routes = [{ path: '/test' }];
    const result = matchRoute('/test', routes);

    expect(result).toBeTruthy();
    expect(result?.route.path).toBe('/test');
  });

  it('should return null if no route matches', () => {
    const routes = [{ path: '/test' }];
    const result = matchRoute('/nomatch', routes);

    expect(result).toBeNull();
  });
});

describe('getCssLinks', () => {
  it('should return a list of preload CSS links from the manifest', () => {
    const manifest = {
      module1: { css: ['style1.css', 'style2.css'] },
    };
    const result = getCssLinks(manifest);

    expect(result).toContain('<link rel="preload stylesheet" as="style" type="text/css" href="/style1.css">');
    expect(result).toContain('<link rel="preload stylesheet" as="style" type="text/css" href="/style2.css">');
  });
});

describe('overrideCSSHMRConsoleError', () => {
  it('should suppress specific HMR CSS errors', () => {
    const originalConsoleError = console.error;
    const spy = vi.spyOn(console, 'error');

    overrideCSSHMRConsoleError();

    console.error('css hmr is not supported in runtime mode');
    expect(spy).not.toHaveBeenCalledWith('css hmr is not supported in runtime mode');

    console.error('some other error');
    expect(spy).toHaveBeenCalledWith('some other error');

    console.error = originalConsoleError;
  });
});
