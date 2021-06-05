import pino from 'pino';

import * as R from 'ramda';

import {
    readonlyMap as M,
    readonlyNonEmptyArray as NA,
    either as E,
    option as O,
    task as T,
    taskEither as TE,
    ioRef as Ref,
    function as F,
} from 'fp-ts';

import * as u from '../../src/utils/index';

import {
    resolve,
    updateCache,
} from '../../src/servers/index';





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
            timeout: 10,
            dns: O.none,
            doh: O.none,
            dot: O.none,
            ttl: O.none,
            cache: u.run(Ref.newIORef(M.empty)),
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

        const dns = O.some(NA.of(F.constant(F.pipe(
            TE.left(new Error('late')),
            T.delay(init.resolver.timeout + 5),
        ))));

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

        const dns = O.some(NA.of(F.constant(F.pipe(
            TE.right(NA.of({ address, ttl: 10 })),
            T.delay(init.resolver.timeout - 5),
        ))));

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
        timeout: 80,
        dns: O.none,
        doh: O.none,
        dot: O.none,
        ttl: O.none,
    };

    test('cached', async () => {

        const cache = u.run(Ref.newIORef(M.singleton(key, val)));

        const task = updateCache (val) (10) ({
            host: key,
            resolver: { ...init, cache },
        });

        const result = await task();

        expect(E.isLeft(result)).toBe(true);

    });

    test('empty', async () => {

        const cache = u.run(Ref.newIORef(M.empty));
        const delay = 10;

        jest.useFakeTimers();

        {

            const task = updateCache (val) (delay) ({
                host: key,
                resolver: { ...init, cache },
            });

            const result = await task();

            expect(E.isRight(result)).toBe(true);
            expect(cache.read().has(key as never)).toBe(true);
            expect(cache.read().get(key as never)).toBe(val);

            jest.advanceTimersByTime(delay * 1000);

            expect(cache.read().has(key as never)).toBe(false);

        }

        {

            const ttl = {
                min: 1,
                max: 5,
                calc: R.clamp(1, 5),
            };

            const task = updateCache (val) (delay) ({
                host: key,
                resolver: { ...init, cache, ttl: O.some(ttl) },
            });

            const result = await task();

            expect(E.isRight(result)).toBe(true);
            expect(cache.read().has(key as never)).toBe(true);
            expect(cache.read().get(key as never)).toBe(val);

            jest.advanceTimersByTime(ttl.max * 1000);

            expect(cache.read().has(key as never)).toBe(false);

        }

    });

});

