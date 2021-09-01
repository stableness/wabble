import {
    taskEither as TE,
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

    const origin: Record<string, unknown> = jest.requireActual(
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
    ])('%p', (a, b) => {

        const env: Env = {
            endpoint: 'https://github.com/whatwg/url/blob/main/README.md',
            base64: true,
        };

        const task = crawlRowsStartsBy ('ss://', 'https://') (env);

        const fn = loadPath as jest.MockedFunction<typeof loadPath>;

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

    ])('%s', (endpoint, arr) => {

        const env: Env = {
            endpoint,
            retry: 0,
            refresh: 0,
        };

        const task = crawlRowsStartsBy ('ss://') (env);

        const fn = loadPath as jest.MockedFunction<typeof loadPath>;

        fn.mockReturnValue(TE.of(R.join('\n', arr)));

        return expect(Rx.firstValueFrom(task)).rejects.toThrowError();

    }, 500);

});

