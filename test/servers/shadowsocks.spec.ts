import { Socket } from 'net';
import { PassThrough, Readable, Transform } from 'stream';

import {
    either as E,
    taskEither as TE,
    io as IO,
    function as F,
} from 'fp-ts';

import {
    function as stdF,
    taskEither as stdTE,
} from 'fp-ts-std';

import * as R from 'ramda';

import pino from 'pino';

import * as u from '../../src/utils/index.js';

import type { ShadowSocks } from '../../src/config.js';

import { parse } from '../../src/settings/utils/shadowsocks.js';

jest.retryTimes(0);

jest.mock('../../src/servers/index.js', () => {

    const origin: Record<string, unknown> = jest.requireActual(
        '../../src/servers/index.js',
    );

    return {
        ...origin,
        netConnectTo: jest.fn(),
    };

});

import {
    chain,
    tunnel,
    cryptoPairsCE,
} from '../../src/servers/shadowsocks.js';

import {
    netConnectTo,
} from '../../src/servers/index.js';





describe('tunnel', () => {

    afterAll(() => {
        jest.useRealTimers();
    });

    test('timeout', () => {

        jest.useFakeTimers('legacy');

        (netConnectTo as jest.Mock).mockImplementationOnce(() => {
            return new Socket();
        });

        const timeoutError = new u.ErrorWithCode('SERVER_SOCKET_TIMEOUT');

        const task = u.run(F.pipe(
            tunnel({ host: 'localhost', port: 8080 }),
            TE.mapLeft(err => u.eqErrorWithCode.equals(err, timeoutError)),
            TE.toUnion,
        ));

        setImmediate(() => {
            jest.runAllTimers();
        });

        return expect(task).resolves.toBe(true);

    }, 50);

});





describe('cryptoPairsCE', () => {

    test('wrong cipher', () => {

        const cipher = { type: 'waaaaaaat' };

        const server = { cipher } as unknown as ShadowSocks;

        const result = cryptoPairsCE (server) (Uint8Array.of(1));

        expect(E.isLeft(result)).toBe(true);

    });

});





describe('encrypt & decrypt', () => {

    beforeAll(() => {
        jest.useRealTimers();
    });

    const host = 'localhost';
    const port = 8080;

    const head = u.socks5Handshake(host, port).subarray(3);
    const body = Buffer.allocUnsafe(42);
    const data = Buffer.concat([ head, body ]);

    test.each([

        'rc4',
        'rc4-md5',
        'aes-128-ctr',
        'aes-192-ctr',
        'aes-256-ctr',
        'aes-128-cfb',
        'aes-192-cfb',
        'aes-256-cfb',

        'aes-128-gcm',
        'aes-192-gcm',
        'aes-256-gcm',
        'chacha20-poly1305',

    ])('alg: %s', alg => {

        const sink = new PassThrough({
            allowHalfOpen: false,
        });

        (netConnectTo as jest.Mock).mockImplementationOnce(() => {

            const source = genChopper(2);
            setTimeout(() => source.emit('connect'), 10);
            return source;

        });

        return expect(F.pipe(

            stdF.uncurry5 (through) ([
                host, port, body, sink, { alg, key: 'foobar' },
            ]),

            TE.chain(() => u.try2TE(() => {
                return u.collectAsyncIterable<Uint8Array>(sink);
            })),

            TE.map(Buffer.concat),

            stdTE.unsafeUnwrap,

        )).resolves.toStrictEqual(data);

    }, 500);

});





const through: u.CurryT<[

    string,
    number,
    Uint8Array,
    NodeJS.ReadWriteStream,
    Record<string, unknown>,
    TE.TaskEither<Error, void>,

]> = host => port => data => sink => F.flow(

    parse,

    E.map(R.mergeLeft({
        host,
        port,
        protocol: 'ss' as const,
        tags: new Set<string>([]),
    })),

    E.map(chain),

    E.flap({
        host,
        port,
        abort: F.constVoid,
        logger: pino({
            base: null,
            prettyPrint: false,
            enabled: true,
        }),
        hook: u.catchKToError(async (...rest: NodeJS.ReadWriteStream[]) => {

            try {

                await Promise.race([
                    u.pump(genSource(data), ...rest, sink),
                    u.timeout(50),
                ]);

            } catch { }

        }),
    }),

    TE.fromEither,

    TE.flatten,

);



const genSource = (data: Uint8Array) => new Readable({

    read () {
        this.push(data);
        this.push(null);
    },

});



const genChopper = (n: number) => new Transform({

    transform (chunk: Uint8Array, _enc, cb) {

        u.run(F.pipe(
            u.chunksOf (n) (chunk),
            IO.traverseArray(data => () => this.push(data)),
            IO.apSecond(cb),
        ));

    },

});

