import * as R from 'ramda';

import {
    either as E,
} from 'fp-ts';

import {

    convert,
    filterTags,
    decodeDoH,
    CF_DOH_ENDPOINT,

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





describe('convert', () => {

    test.each([
        null,
        [],
        {},
        [ {} ],
        [ 42 ],
        [ null ],
        {
            services: [
                { uri: '' },
                { uri: 'wat://0.0.0.0:8080' },
            ],
            servers: [
                { uri: 'wat://0.0.0.0:8080' },
                { uri: 'ss://127.0.0.1', key: 'foobar', alg: 'wat' },
                { uri: 'trojan://127.0.0.1', password: 'foobar', ssl: { cipher: 'wat' } },
            ],
        },
    ])('invalid: %p', value => {
        expect(() => convert(value)).toThrowError();
    });

    test('simple', () => {

        const setting = {
            services: [
                { uri:   'http://0.0.0.0:8080' },
                { uri:   'http://foo:bar@0.0.0.0:8080' },
                { uri: 'socks5://0.0.0.0:8080' },
                { uri: 'socks5://foo:bar@0.0.0.0:8080' },
            ],
            doh: true,
            tags: [ 'http' ],
            servers: [
                { uri: 'socks5://127.0.0.1:8080' },
                { uri: 'socks5://foo:bar@127.0.0.1:8080' },
                { uri: 'http://127.0.0.1:8080' },
                { uri: 'http://foo:bar@127.0.0.1:8080' },
                { uri: 'ss://127.0.0.1', key: 'foobar' },
                { uri: 'ss://127.0.0.1', key: 'foobar', alg: 'aes-128-ctr' },
                { uri: 'trojan://127.0.0.1', password: 'foobar', ssl: { verify: true } },
                { uri: 'trojan://127.0.0.1', password: 'foobar', ssl: { sni: 'localhost' } },
            ],
            rules: {
                proxy: [
                    'doodle.',
                ],
                direct: [
                    'FULL,localhost',
                ],
                reject: [
                    'doubleclick',
                ],
            },
            sieve: {
                direct: 'pkg',
            },
        };

        expect(() => convert(setting)).not.toThrow();

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

    ])('%p', (bar, source, result) => {
        expect(unwrap(filterTags(wrap(source), bar))).toEqual(result);
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

    ])('%p', (bar, source, result) => {
        expect(unwrap(filterTags(wrap(source), bar))).toEqual(result);
    });



    const SetC = R.constructN<[string], Set<string>>(1, Set);

    const wrap = R.map(R.o(R.objOf('tags'), SetC));
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const unwrap = R.map(R.compose(R.join(''), Array.from, R.prop('tags')));

});

