import { Readable } from 'stream';

import {
    option as O,
} from 'fp-ts';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import * as R from 'ramda';

import fetch from 'node-fetch';

import {
    establish,
} from '../../src/services/api';

import type { API } from '../../src/config';
import * as u from '../../src/utils';





jest.retryTimes(0);

jest.mock('v8', () => {

    return {

        getHeapSnapshot () {
            return Readable.from('foobar');
        },

    };

});





describe('api', () => {

    const api: API = {
        host: '127.0.0.1',
        port: 0,
        cors: true,
        shared: false,
    };

    const done$ = new Rx.Subject<boolean>();

    const { address$, ...routes } = establish(Rx.of(O.some(api)));

    const addr$ = address$.pipe(
        o.shareReplay({ bufferSize: 1, refCount: true }),
    );



    test.each([

        'GET     /404',

        'GET     /health',
        'GET     /metrics',
        'GET     /dump',

        'POST    /test-domain',
        'POST    /reload',
        'POST    /exit',

        'OPTIONS /cors',

    ])('%s', async entry => {

        const [ method = 'GET', path = '/404' ] = u.str2arr(entry);

        await expect(

            Rx.firstValueFrom(

                addr$.pipe(
                    o.map(addr => addr.to(path)),
                    o.mergeMap(url => fetch(url, { method })),
                    o.first(({ ok }) => path === '/404' ? true : ok === true),
                ),

            ),

        ).resolves.not.toThrowError();

    });



    beforeAll(() => {

        const { metrics$, test_domain$, ...rest } = routes;

        Rx.merge(

            ...R.values(rest),

            metrics$.pipe(u.rxTap(({ write }) => { write({ a: 1 }) })),
            test_domain$.pipe(u.rxTap(({ write }) => { write('foobar') })),

        ).pipe(

            o.ignoreElements(),
            o.takeUntil(done$),

        ).subscribe();

    });



    afterAll(() => {

        done$.next(true);

    });


});




describe('api', () => {

    test('disabled', async () => {

        const { health$ } = establish(Rx.of(O.none));

        await expect(

            Rx.firstValueFrom(
                health$.pipe(
                    o.first(),
                ),
            ),

        ).rejects.toThrowError();

    });



    test('enabled - smoking', async () => {

        const api: API = {
            host: '0.0.0.0',
            port: 0,
            cors: true,
            shared: true,
        };

        const origin = 'http://localhost:8080';

        const { health$, address$ } = establish(Rx.of(O.some(api)));

        await expect(

            Rx.firstValueFrom(

                Rx.merge(

                    health$.pipe(
                        o.ignoreElements(),
                    ),

                    address$.pipe(
                        o.tap(({ address }) => expect(address).toBe(api.host)),
                        o.map(addr => addr.to('/health')),
                        o.mergeMap(url => fetch(url, { headers: { origin } })),
                        o.first(({ ok }) => ok === true),
                        o.mergeMap(res => {

                            const allowed = res.headers.get(
                                'Access-Control-Allow-Origin',
                            );

                            const pass = R.either(
                                R.equals('*'),
                                R.equals(origin),
                            );

                            expect(pass(allowed)).toBe(true);

                            return res.text();

                        }),
                    ),

                ),

            ),

        ).resolves.toBe('Still Alive\n');

    });

});

