import {
    jest, describe, test, expect,
} from '@jest/globals';

import {
    taskEither as TE,
    readonlyArray as A,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';

import { base64 } from 'rfc4648';

import {
    Env,
    crawlRowsStartsBy,
} from '../../src/settings/crawler.js';





jest.mock('../../src/utils/index.js', () => {

    const origin = jest.requireActual<Record<string, unknown>>(
        '../../src/utils/index.js',
    );

    return {
        ...origin,
        loadPath: jest.fn(),
    };

});

import {
    loadPath,
} from '../../src/utils/index.js';





describe('crawler', () => {

    const h = F.flow(
        Buffer.from,
        base64.stringify,
        Buffer.from,
        R.toString,
    );

    test.each([
        [   [ 'ss://foo', 'ss://bar', 'wat' ],
            [ 'ss://foo', 'ss://bar'        ],
        ],
        [   [ 'aa://foo', 'ss://bar', 'https://foo' ],
            [             'ss://bar', 'https://foo' ],
        ],
        [   [ 'ss://{}==wef' ],
            [ 'ss://{}==wef' ],
        ],
        [   [ h('ss://foobar') ],
            [   'ss://foobar' ],
        ],
    ])('%p', (a: string[], b: string[]) => {

        const env: Env = {
            endpoint: 'https://github.com/whatwg/url/blob/main/README.md',
            base64: true,
        };

        const task = crawlRowsStartsBy ('ss://', 'https://') (env);

        const fn = jest.mocked(loadPath);

        fn.mockReturnValue(TE.of(R.join('\n', a)));

        expect.assertions(2);

        return expect(

            Rx.firstValueFrom(task.pipe(Rx.tap(() => {

                expect(fn).toBeCalledWith(env.endpoint);

            }))),

        ).resolves.toStrictEqual(b);

    }, 500);



    test.each([

        [ '             ', [                       ] ],
        [ 'http://foobar', [                       ] ],
        [ 'http://foobar', [ 'wat://aa', 'waaaaat' ] ],

    ])('%s', (endpoint: string, arr: string[]) => {

        const env: Env = {
            endpoint,
            retry: 0,
            refresh: 0,
        };

        const task = crawlRowsStartsBy ('ss://') (env);

        const fn = jest.mocked(loadPath);

        fn.mockReturnValue(TE.of(R.join('\n', arr)));

        return expect(Rx.firstValueFrom(task)).rejects.toThrowError();

    }, 500);



    test('repeat', () => {

        const env: Env = {
            endpoint: 'https://github.com/whatwg/url/blob/main/README.md',
            refresh: 10,
        };

        const first  = 'ss://foo';
        const second = 'ss://bar';

        const fn = jest.mocked(loadPath)
            .mockReturnValueOnce(TE.of(first))
            .mockReturnValueOnce(TE.of(second))
        ;

        const task = crawlRowsStartsBy ('ss://') (env);

        expect.assertions(3);

        return expect(Rx.firstValueFrom(task.pipe(

            Rx.tap(() => expect(fn).toBeCalledWith(env.endpoint)),
            Rx.take(2),
            Rx.toArray(),
            Rx.map(A.flatten),

        ))).resolves.toStrictEqual([ first, second ]);

    }, 500);

});

