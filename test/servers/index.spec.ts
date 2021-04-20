import * as R from 'ramda';

import {
    readonlyMap as M,
    either as E,
    option as O,
    ioRef as Ref,
} from 'fp-ts';

import * as u from '../../src/utils/index';

import { updateCache } from '../../src/servers/index';





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

