import * as R from 'ramda';

import {
    either as E,
} from 'fp-ts';

import {

    filterTags,
    decodeDoH,
    CF_DOH_ENDPOINT,
    assertBaseArray,

} from '../../src/settings/reading';





describe('readDoH', () => {

    const { decode: readDoH } = decodeDoH;

    test.each([
        42,
        'wat',
        null,
        undefined,
        false,
    ])('%s', value => {
        expect(E.isLeft(readDoH(value))).toBe(true);
    });

    test('true', () => {
        expect(readDoH(true)).toStrictEqual(E.right(CF_DOH_ENDPOINT));
    });

    test('custom', () => {

        const DOH = '     https://ecs-doh.dnswarden.com/uncensored-ecs     ';

        expect(readDoH(DOH)).toStrictEqual(E.right(DOH.trim()));

    });

});





describe('assertBaseArray', () => {

    test.each([
        null,
        [],
        {},
        [ {} ],
        [ 42 ],
        [ null ],
    ])('invalid: %p', value => {
        expect(() => assertBaseArray(value)).toThrow();
    });

    test('valid', () => {
        expect(() => assertBaseArray([ { uri: 'http://localhost' } ])).not.toThrow();
    });

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

