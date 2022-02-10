import { PassThrough } from 'stream';

import {
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { asyncReadable } from 'async-readable';

import pino from 'pino';

import * as u from '../../src/utils/index.js';

import {
    chain,
    memHash,
    makeHead,
} from '../../src/servers/trojan.js';





jest.mock('tls', () => ({

    connect: jest.fn(),

}));

import { connect } from 'tls';





describe('chain', () => {

    beforeAll(() => {
        jest.useRealTimers();
    });

    test('', () => {

        const password = 'foobar';
        const host = 'localhost';
        const port = 8080;

        const sink = new PassThrough({
            allowHalfOpen: false,
        });

        (connect as jest.Mock).mockImplementationOnce(() => {

            setTimeout(() => sink.emit('secureConnect'), 10);

            return Object.assign(sink, {
                setNoDelay: jest.fn(() => sink),
            });

        });

        expect.assertions(2);

        return u.run(F.pipe(

            TE.of(chain({
                host,
                port,
                password,
                protocol: 'trojan' as const,
                tags: new Set<string>([]),
                ssl: {
                    verify: false,
                    verify_hostname: false,
                },
            })),

            TE.flap({
                host,
                port,
                abort: F.constVoid,
                logger: pino(),
                hook: TE.fromIOK(socket => () => expect(socket).toBe(sink)),
            }),

            TE.flatten,

            TE.apSecond(u.try2TE(() => {

                const head = makeHead(password, host, port);

                return expect(

                    asyncReadable(sink).read(head.length),

                ).resolves.toStrictEqual(head);

            })),

        ));

    }, 100);

});





describe('memHash', () => {

    test.each([

        [ '123', '78d8045d684abd2eece923758f3cd781489df3a48e1278982466017f' ],
        [ 'wat', 'ac50789f2e2563245cd93ca1fd58a286e0668d401b03e06be8a30266' ],
        [ 'lol', 'edef97a036c86f6d7ab1e07f12c83bffab9b2d381f0f07a43c3fb2ff' ],

    ])('%s - %s', (raw, hash) => {

        expect(memHash(raw)).toStrictEqual(Buffer.from(hash));

    });

});

