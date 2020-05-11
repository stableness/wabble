import * as R from 'ramda';

import { option as O } from 'fp-ts';

import {

    filterTags,
    readDoH,
    CF_DOH_ENDPOINT,

} from '../../src/settings/reading';





describe('readDoH', () => {

    test.each([
        42,
        'wat',
        null,
        undefined,
        false,
    ])('%s', value => {
        expect(readDoH(value)).toBe(O.none);
    });

    test('true', () => {
        expect(readDoH(true)).toStrictEqual(O.some(CF_DOH_ENDPOINT));
    })

    test('custom', () => {
        const DOH = 'https://ecs-doh.dnswarden.com/uncensored-ecs';
        expect(readDoH(DOH)).toStrictEqual(O.some(DOH));
    })

});





describe('filterTags', () => {

    test.each([

        [   [  ],
            [ 'ab', 'abc', 'b' ],
            [ 'ab', 'abc', 'b' ],
        ],

        [   [ 'a', 'b' ],
            [ 'ab', 'abc', 'b', 'a', 'cd' ],
            [ 'ab', 'abc'                 ],
        ],

        [   [ 'a', 'b', 'c' ],
            [ 'ab', 'abc', 'b', 'a', 'cd' ],
            [       'abc'                 ],
        ],

        [   [ 'a', 'b', 'c' ],
            [ 'ab', 'abc', 'b', 'a', 'cd', 'aNbMc' ],
            [       'abc',                 'aNbMc' ],
        ],

        [   [ 'a', 'a', 'b' ],
            [ 'ab', 'abc', 'b' ],
            [ 'ab', 'abc'      ],
        ],

    ])('%p', (left, right, result) => {
        expect(unwrap(filterTags(left, wrap(right)))).toEqual(result);
    });

    test.each([

        [   [ 'a', '-b', 'c' ],
            [ 'ab', 'abc', 'ac', 'aNc' ],
            [              'ac', 'aNc' ],
        ],

        [   [ 'a', '-b', 'c', '-d' ],
            [ 'ab', 'abc', 'ac', 'c', 'cd', 'ace' ],
            [              'ac',            'ace' ],
        ],

        [   [ '-a' ],
            [ 'ab', 'abc', 'ac', 'c', 'cd', 'ace' ],
            [                    'c', 'cd'        ],
        ],

    ])('%p', (left, right, result) => {
        expect(unwrap(filterTags(left, wrap(right)))).toEqual(result);
    });



    const SetC = R.constructN<[string], Set<string>>(1, Set);

    const wrap = R.map(R.o(R.objOf('tags'), SetC));
    // @ts-ignore
    const unwrap = R.map(R.compose(R.join(''), Array.from, R.prop('tags')));

});

