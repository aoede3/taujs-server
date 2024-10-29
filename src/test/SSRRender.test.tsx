import { ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import React from 'react';
import { renderToPipeableStream, renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createRenderer, createRenderStream, resolveHeadContent } from '../SSRRender';

import type { Mock } from 'vitest';

vi.mock('react-dom/server', () => ({
  renderToPipeableStream: vi.fn(),
  renderToString: vi.fn(),
}));

describe('resolveHeadContent', () => {
  it('should return the headContent string when headContent is a string', () => {
    const headContent = '<title>Test</title>';
    const initialDataResolved = { data: 'test' };
    expect(resolveHeadContent(headContent, initialDataResolved)).toBe(headContent);
  });

  it('should return the result of calling headContent function when headContent is a function', () => {
    const headContentFn = vi.fn((data) => `<title>${data.title}</title>`);
    const initialDataResolved = { title: 'Test Title' };
    expect(resolveHeadContent(headContentFn, initialDataResolved)).toBe('<title>Test Title</title>');
    expect(headContentFn).toHaveBeenCalledWith(initialDataResolved);
  });
});

describe('createRenderer', () => {
  describe('renderSSR', () => {
    it('should render the app to string and return headContent, appHtml, and initialDataScript', async () => {
      const mockAppComponent = () => <div>Test</div>;
      const mockHeadContent = '<title>Test</title>';
      const mockInitialData = { data: 'test' };

      const renderToStringMock = vi.fn().mockReturnValue('<div>Rendered App</div>');
      (renderToString as Mock).mockImplementation(renderToStringMock);

      const { renderSSR } = createRenderer({
        appComponent: mockAppComponent,
        headContent: mockHeadContent,
      });

      const result = await renderSSR(mockInitialData, '/test');

      expect(renderToStringMock).toHaveBeenCalled();
      expect(result).toEqual({
        headContent: mockHeadContent,
        appHtml: '<div>Rendered App</div>',
        initialDataScript: `<script>window.__INITIAL_DATA__ = ${JSON.stringify(mockInitialData).replace(/</g, '\\u003c')}</script>`,
      });
    });

    it('should handle headContent as a function', async () => {
      const mockAppComponent = () => <div>Test</div>;
      const headContentFn = vi.fn((data) => `<title>${data.title}</title>`);
      const mockInitialData = { title: 'Test Title' };

      const renderToStringMock = vi.fn().mockReturnValue('<div>Rendered App</div>');
      (renderToString as Mock).mockImplementation(renderToStringMock);

      const { renderSSR } = createRenderer({
        appComponent: mockAppComponent,
        headContent: headContentFn,
      });

      const result = await renderSSR(mockInitialData, '/test');

      expect(renderToStringMock).toHaveBeenCalled();
      expect(headContentFn).toHaveBeenCalledWith(mockInitialData);
      expect(result).toEqual({
        headContent: '<title>Test Title</title>',
        appHtml: '<div>Rendered App</div>',
        initialDataScript: `<script>window.__INITIAL_DATA__ = ${JSON.stringify(mockInitialData).replace(/</g, '\\u003c')}</script>`,
      });
    });

    it('should use initialDataResolved when it has properties', async () => {
      const mockAppComponent = () => <div>Test</div>;
      const mockHeadContent = vi.fn((data) => `<title>${data.title}</title>`);
      const initialDataResolved = { title: 'Initial Data Title' };
      const meta = { title: 'Meta Title' };

      const { renderSSR } = createRenderer({
        appComponent: mockAppComponent,
        headContent: mockHeadContent,
      });

      await renderSSR(initialDataResolved, '/test', meta);

      expect(mockHeadContent).toHaveBeenCalledWith(initialDataResolved);
    });

    it('should use meta when initialDataResolved is empty', async () => {
      const mockAppComponent = () => <div>Test</div>;
      const mockHeadContent = vi.fn((data) => `<title>${data.title}</title>`);
      const initialDataResolved = {};
      const meta = { title: 'Meta Title' };

      const { renderSSR } = createRenderer({
        appComponent: mockAppComponent,
        headContent: mockHeadContent,
      });

      await renderSSR(initialDataResolved, '/test', meta);

      expect(mockHeadContent).toHaveBeenCalledWith(meta);
    });
  });

  describe('renderStream', () => {
    it('should render the stream and call callbacks correctly', async () => {
      const mockAppComponent = () => <div>Test</div>;
      const mockHeadContent = '<title>Test</title>';
      const mockInitialData = { data: 'test' };
      const mockBootstrapModules = 'test-module';

      const onHead = vi.fn();
      const onFinish = vi.fn();
      const onError = vi.fn();

      const serverResponse = new Writable({
        write(_chunk, _encoding, callback) {
          setImmediate(callback);
        },
      });

      const writeSpy = vi.spyOn(serverResponse, 'write');

      const onFinishPromise = new Promise<void>((resolve) => {
        onFinish.mockImplementation(() => {
          resolve();
        });
      });

      const renderToPipeableStreamMock = vi.fn((_appElement: React.JSX.Element, options: any) => {
        const stream = {
          pipe: (writable: Writable) => {
            writable.write(Buffer.from('Test chunk'), (err) => {
              if (err) throw err;
              writable.end();
            });
          },
        };

        setImmediate(() => {
          options.onShellReady();
          options.onAllReady();
        });

        return stream;
      });

      (renderToPipeableStream as Mock).mockImplementation(renderToPipeableStreamMock);

      const { renderStream } = createRenderer({
        appComponent: mockAppComponent,
        headContent: mockHeadContent,
      });

      renderStream(serverResponse as any, { onHead, onFinish, onError }, mockInitialData, '/test', mockBootstrapModules);

      await onFinishPromise;

      expect(renderToPipeableStreamMock).toHaveBeenCalled();
      expect(onHead).toHaveBeenCalledWith(mockHeadContent);

      const chunk = Buffer.from('Test chunk');
      expect(writeSpy).toHaveBeenCalledWith(chunk, expect.any(Function));

      expect(onFinish).toHaveBeenCalledWith(mockInitialData);
    });

    it('should handle errors in rendering', () => {
      const mockAppComponent = () => <div>Test</div>;
      const mockHeadContent = '<title>Test</title>';
      const mockInitialData = { data: 'test' };

      const serverResponse = {
        write: vi.fn(),
      } as unknown as ServerResponse;

      const onHead = vi.fn();
      const onFinish = vi.fn();
      const onError = vi.fn();

      (renderToPipeableStream as any).mockImplementation((_appElement: JSX.Element, { onError }: any) => {
        onError(new Error('Test Error'));
        return { pipe: vi.fn() };
      });

      const { renderStream } = createRenderer({
        appComponent: mockAppComponent,
        headContent: mockHeadContent,
      });

      renderStream(serverResponse, { onHead, onFinish, onError }, mockInitialData, '/test');

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0]?.[0].message).toBe('Test Error');
    });

    it('should handle headContent as a function', async () => {
      const mockAppComponent = ({ location }: { location: string }) => <div>Location: {location}</div>;
      const headContentFn = vi.fn((data) => `<title>${data.title}</title>`);
      const mockInitialData = { title: 'Test Title' };
      const mockLocation = 'test';
      const mockBootstrapModules = 'test-module';

      const onHead = vi.fn();
      const onFinish = vi.fn();
      const onError = vi.fn();

      const serverResponse = new Writable({
        write(_chunk, _encoding, callback) {
          setImmediate(callback);
        },
      });

      const writeSpy = vi.spyOn(serverResponse, 'write');

      const onFinishPromise = new Promise<void>((resolve) => {
        onFinish.mockImplementation(() => {
          resolve();
        });
      });

      const renderToPipeableStreamMock = vi.fn((_appElement: React.JSX.Element, options: any) => {
        const stream = {
          pipe: (writable: Writable) => {
            writable.write(Buffer.from('Test chunk'), (err) => {
              if (err) throw err;
              writable.end();
            });
          },
        };

        setImmediate(() => {
          options.onShellReady();
          options.onAllReady();
        });

        return stream;
      });

      (renderToPipeableStream as Mock).mockImplementation(renderToPipeableStreamMock);

      createRenderStream(
        serverResponse as any,
        { onHead, onFinish, onError },
        {
          appComponent: mockAppComponent,
          headContent: headContentFn,
          initialDataResolved: mockInitialData,
          location: mockLocation,
          bootstrapModules: mockBootstrapModules,
        },
      );

      await onFinishPromise;

      expect(renderToPipeableStreamMock).toHaveBeenCalled();
      expect(headContentFn).toHaveBeenCalledWith(mockInitialData);
      expect(onHead).toHaveBeenCalledWith('<title>Test Title</title>');

      const chunk = Buffer.from('Test chunk');
      expect(writeSpy).toHaveBeenCalledWith(chunk, expect.any(Function));

      expect(onFinish).toHaveBeenCalledWith(mockInitialData);
    });
  });
});
