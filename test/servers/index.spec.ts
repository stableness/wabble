import {
    describe, test, expect,
} from '@jest/globals';

import pino from 'pino';

import * as R from 'ramda';

import {
    readonlyMap as M,
    readonlyNonEmptyArray as NA,
    readonlyRecord as Rc,
    either as E,
    option as O,
    task as T,
    taskEither as TE,
    ioRef as Ref,
    function as F,
} from 'fp-ts';

import {
    number as stdNum,
} from 'fp-ts-std';

import * as u from '../../src/utils/index.js';

import {
    race,
    resolve,
    updateCache,
    by_race,
} from '../../src/servers/index.js';





describe('race', () => {

    const fst = 'fst';
    const snd = 'snd';

    const error = new Error('timeout');
    const race80ms = race (error) (80);

    test('empty', () => {

        expect(race80ms([        ])).toBe(O.none);
        expect(race80ms([ O.none ])).toBe(O.none);

    });

    test('on time', () => {

        expect.assertions(1);

        return u.run(F.pipe(

            race80ms([
                O.some([ T.delay (10) (TE.of(fst)) ] ),
                O.some([ T.delay (60) (TE.of(snd)) ] ),
            ]),

            TE.fromOption(() => new Error('empty')),

            TE.flatten,

            TE.bimap(expect, expect),

            TE.matchW(
                e => e.toBeUndefined(),
                a => a.toBe(fst),
            ),

        ));

    }, 100);

    test('over time', () => {

        expect.assertions(1);

        return u.run(F.pipe(

            race80ms([
                O.some([ T.delay (85) (TE.of(fst)) ] ),
                O.none,
                O.some([ T.delay (95) (TE.of(snd)) ] ),
            ]),

            TE.fromOption(() => new Error('empty')),

            TE.flatten,

            TE.bimap(expect, expect),

            TE.matchW(
                e => e.toBe(error),
                a => a.toBeUndefined(),
            ),

        ));

    }, 100);

});





describe('by_race', () => {

    test.each([

        0,
        -1,
        2.3,
        -3.5,
        -42,
        'string',
        null,
        undefined,

    ])('invalid timeout - %p', n => {

        const te = TE.right('data');

        expect(by_race (n) ('wat') (te)).toBe(te);

    });

    test('on time', async () => {

        const te = F.pipe(
            TE.right('foo'),
            T.delay(50),
        );

        await expect(u.unwrapTaskEither(
            by_race (5_000) ('timeout') (te),
        )).resolves.toBe('foo');

    }, 200);

    test('over time', async () => {

        const te = F.pipe(
            TE.right('foo'),
            T.delay(100),
        );

        await expect(u.unwrapTaskEither(
            by_race (20) ('timeout') (te),
        )).rejects.toThrowError('timeout');

    }, 150);

});





const mkMS_s = u.mkMillisecond('s');
const mkMS_ms = u.mkMillisecond('ms');

describe('resolve', () => {

    const init = {
        abort: u.noop,
        hook: () => TE.of(u.run(F.constVoid)),
        logger: pino({
            base: null,
            level: 'silent',
        }),
        port: 443,
        host: 'example.com',
        resolver: {
            timeout: mkMS_ms(10),
            dns: O.none,
            doh: O.none,
            dot: O.none,
            ttl: O.none,
            cache: u.run(Ref.newIORef(M.empty)),
            hosts: Rc.empty,
        },
    };

    test('ip', async () => {

        const host = '1.2.3.4';
        const opts = { ...init, host };

        F.pipe(
            await u.run(resolve(opts)),
            E.match(
                e => expect(e).toBeUndefined(),
                ip => expect(ip).toBe(host),
            ),
        );

    });

    test('blocked', async () => {

        const opts = { ...init, host: '0.0.0.0' };

        F.pipe(
            await u.run(resolve(opts)),
            E.match(
                e => expect(e.code).toBe('BLOCKED_HOST'),
                ip => expect(ip).toBeUndefined(),
            ),
        );

    });

    test('cached', async () => {

        const address = '192.168.0.1';
        const cache = u.run(Ref.newIORef(M.singleton(init.host, address)));

        const resolver = { ...init.resolver, cache };
        const opts = { ...init, resolver };

        F.pipe(
            await u.run(resolve(opts)),
            E.match(
                e => expect(e).toBeUndefined(),
                ip => expect(ip).toBe(address),
            ),
        );

    });

    test('race bailout', async () => {

        F.pipe(
            await u.run(resolve(init)),
            E.match(
                e => expect(e).toBeUndefined(),
                ip => expect(ip).toBe(init.host),
            ),
        );

    });

    test('timeout', async () => {

        const cache = u.run(Ref.newIORef(M.empty));

        const dns = O.some(NA.of((_: string) => F.pipe(
            TE.left(new Error('late')),
            T.delay(stdNum.add (init.resolver.timeout) (mkMS_ms(5))),
        )));

        const resolver = { ...init.resolver, dns, cache };
        const opts = { ...init, resolver };

        F.pipe(
            await u.run(resolve(opts)),
            E.match(
                e => expect(e).toBeUndefined(),
                ip => expect(ip).toBe(init.host),
            ),
        );

    }, 20);

    test('dns', async () => {

        const address = '1.2.3.4';

        const dns = O.some(NA.of((_: string) => F.pipe(
            TE.right(NA.of({ address, ttl: 10 / 1000 })),
            T.delay(init.resolver.timeout - mkMS_ms(5)),
        )));

        const resolver = { ...init.resolver, dns };
        const opts = { ...init, resolver };

        F.pipe(
            await u.run(resolve(opts)),
            E.match(
                e => expect(e).toBeUndefined(),
                ip => expect(ip).toBe(address),
            ),
        );

    }, 20);

});





describe('updateCache', () => {

    const key = 'key';
    const val = 'val';

    const init = {
        timeout: mkMS_ms(80),
        dns: O.none,
        doh: O.none,
        dot: O.none,
        ttl: O.none,
        hosts: Rc.empty,
    };

    test('cached', async () => {

        const cache = u.run(Ref.newIORef(M.singleton(key, val)));

        const task = updateCache (val) (mkMS_s(10)) ({
            host: key,
            resolver: { ...init, cache },
        });

        const result = await task();

        expect(E.isLeft(result)).toBe(true);

    });

    test('empty', async () => {

        const delay = mkMS_ms(100);

        {

            const cache = u.run(Ref.newIORef(M.empty));

            const task = updateCache (val) (delay) ({
                host: key,
                resolver: { ...init, cache },
            });

            const result = await task();

            expect(E.isRight(result)).toBe(true);
            expect(cache.read().has(key as never)).toBe(true);
            expect(cache.read().get(key as never)).toBe(val);

            await new Promise(res => setTimeout(() => res(0), delay));

            expect(cache.read().has(key as never)).toBe(false);

        }

        {

            const cache = u.run(Ref.newIORef(M.empty));

            const ttl = {
                min: mkMS_ms(10),
                max: mkMS_ms(50),
                calc: R.clamp(mkMS_ms(10), mkMS_ms(50)),
            };

            const task = updateCache (val) (delay) ({
                host: key,
                resolver: { ...init, cache, ttl: O.some(ttl) },
            });

            const result = await task();

            expect(E.isRight(result)).toBe(true);
            expect(cache.read().has(key as never)).toBe(true);
            expect(cache.read().get(key as never)).toBe(val);

            await new Promise(res => setTimeout(() => res(0), ttl.max));

            expect(cache.read().has(key as never)).toBe(false);

        }

    });

});

