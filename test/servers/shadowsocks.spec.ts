import { PassThrough, Readable, Transform } from 'stream';

import {
    either as E,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as u from '../../src/utils/index.js';

import type { ShadowSocks } from '../../src/config.js';

import { parse } from '../../src/settings/utils/shadowsocks.js';

import {
    cryptoPairsCE,
} from '../../src/servers/shadowsocks.js';





describe('cryptoPairsCE', () => {

    test('wrong cipher', () => {

        const cipher = { type: 'waaaaaaat' };

        const server = { cipher } as unknown as ShadowSocks;

        const result = cryptoPairsCE (server) (Uint8Array.of(1));

        expect(E.isLeft(result)).toBe(true);

    });

});





describe('encrypt & decrypt', () => {

    const head = Buffer.allocUnsafe(10);
    const tail = Buffer.allocUnsafe(42);
    const data = Buffer.concat([ head, tail ]);

    test.each([

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

    ])('alg: %s', async (alg) => {

        const info = { alg, key: 'foobar' };

        const sink = await u.run(through (head) (tail) (info));

        expect(sink).toStrictEqual(E.right(data));

    }, 500);

});





const through = (head: Uint8Array) => (tail: Uint8Array) => F.flow(
    E.fromNullableK (new Error('parsing wrong')) (parse),
    E.map(R.mergeLeft({
        protocol: 'ss' as const,
        host: 'localhost',
        port: 0,
        tags: new Set<string>(),
    })),
    E.map(cryptoPairsCE),
    E.ap(E.of(head)),
    E.flatten,
    TE.fromEither,
    TE.chain(({ enc, dec }) => u.tryCatchToError(async () => {

        const sink = new PassThrough();

        const source = new Readable({

            read () {
                this.push(tail);
                this.push(null);
            },

        });

        const chopper = new Transform({

            transform (chunk, _enc, cb) {

                const [ one, two ] = u.splitAt2(chunk);

                this.push(one);
                this.push(two);

                cb();

            },

        });

        try {

            await Promise.race([
                u.pump(source, enc, chopper, dec, sink),
                u.timeout(400),
            ]);

        } catch { }

        return u.collectAsyncIterable<Uint8Array>(sink);

    })),
    TE.map(Buffer.concat),
);
