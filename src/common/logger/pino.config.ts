import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Params } from 'nestjs-pino';
import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type StreamEntry,
} from 'pino';
import type { Options } from 'pino-http';
import { createStream } from 'rotating-file-stream';

const LOG_RETENTION_DAYS = 7;
const LOG_DIR = join(process.cwd(), 'logs');
const APP_LOG_DIR = join(LOG_DIR, 'app');
const ERROR_LOG_DIR = join(LOG_DIR, 'error');

function ensureLogDirectories(): void {
  mkdirSync(APP_LOG_DIR, { recursive: true });
  mkdirSync(ERROR_LOG_DIR, { recursive: true });
}

function createRotatingStream(filename: string, directory: string) {
  return createStream(filename, {
    path: directory,
    interval: '1d',
    intervalBoundary: true,
    maxFiles: LOG_RETENTION_DAYS,
    compress: 'gzip',
  });
}

export function createPinoHttpConfig(level: string): Params {
  ensureLogDirectories();

  const streams: StreamEntry[] = [
    {
      level: 'trace',
      stream: createRotatingStream('app.log', APP_LOG_DIR),
    },
    {
      level: 'error',
      stream: createRotatingStream('error.log', ERROR_LOG_DIR),
    },
  ];

  if (process.env.NODE_ENV !== 'production') {
    const prettyTransport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        levelFirst: true,
        singleLine: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat:
          '[{context}] {msg} {req.method} {req.url} {res.statusCode}',
      },
    });

    streams.push({
      level: 'trace',
      stream: prettyTransport,
    });
  }

  const destination = pino.multistream(streams) as DestinationStream;

  const options: Options = {
    level: level as LevelWithSilent,
    customProps: (
      req: IncomingMessage & { id?: string | number },
      res: ServerResponse,
    ) => {
      void res;

      return {
        context: 'HTTP',
        requestId: req.id,
      };
    },
    customLogLevel: (
      _req: unknown,
      res: { statusCode?: number },
      err?: Error,
    ) => {
      if (err || (res.statusCode ?? 200) >= 500) {
        return 'error';
      }

      if ((res.statusCode ?? 200) >= 400) {
        return 'warn';
      }

      return 'info';
    },
    serializers: {
      req: (req: {
        id?: string | number;
        method?: string;
        url?: string;
        query?: unknown;
        params?: unknown;
      }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
      }),
      res: (res: { statusCode?: number }) => ({
        statusCode: res.statusCode,
      }),
      err: pino.stdSerializers.err,
    },
  };

  return {
    pinoHttp: [options, destination] as [typeof options, DestinationStream],
  };
}
