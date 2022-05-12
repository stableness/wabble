import {
    describe, test, expect,
} from '@jest/globals';

import * as R from 'ramda';

import {
    either as E,
    option as O,
    readonlyArray as A,
    function as F,
} from 'fp-ts';

import {

    convert,
    filterTags,
    decodeResolver,
    decodeTimesUnion,
    decodeAPI,

} from '../../src/settings/reading.js';

import * as u from '../../src/utils/index.js';





describe('decodeAPI', () => {

    const { decode: readAPI } = decodeAPI;

    test.each([
        42,
        'wat',
        null,
        undefined,
        true,
        false,
    ])('%s', value => {
        expect(E.isLeft(readAPI(value))).toBe(true);
    });

    test('optional shared', () => {

        const origin = { port: 8080 };
        const result = { port: 8080, cors: false, shared: false, host: '127.0.0.1' }; // eslint-disable-line max-len

        expect(readAPI(origin)).toStrictEqual(E.right(result));

    });

    test('with shared', () => {

        const origin = { port: 8080, cors: true, shared: true };
        const result = { port: 8080, cors: true, shared: true, host: '0.0.0.0' }; // eslint-disable-line max-len

        expect(readAPI(origin)).toStrictEqual(E.right(result));

    });

});





describe('decodeResolver', () => {

    const { decode: readResolver } = decodeResolver;

    test.each([
        42,
        'wat',
        null,
        undefined,
        true,
        false,
        [],
    ])('%s', value => {
        expect(E.isLeft(readResolver(value))).toBe(true);
    });

    test('uri', () => {

        const decodeURIs = R.pipe(
            u.str2arr,
            R.map(R.objOf('uri')),
            R.objOf('upstream'),
            readResolver,
        );

        expect(E.isRight(decodeURIs(`

            https://cloudflare-dns.com/dns-query
              udp://127.0.0.1:5354
              tls://1.1.1.1:853

        `))).toBe(true);

        expect(E.isRight(decodeURIs(`

            http://cloudflare-dns.com/dns-query
             tcp://127.0.0.1:5354
              ss:foobar

        `))).not.toBe(true);

    });

    test.each([
        [    '0ms',  0 ],
        [  '-99ms',  0 ],
        [   '42ms', 42 ],
        [ void 0, 80 ],
    ])('timeout - %d %d', (timeout: string, result: number) => {

        const either = readResolver(timeout == null ? {} : { timeout });

        if (E.isLeft(either)) {
            return expect(E.isRight(either)).toBe(true);
        }

        expect(either.right.timeout).toBe(result);

    });

    type Bound_IN  = { min?: string, max?: string };
    type Bound_OUT = { min:  number, max:  number };

    test.each([

        [
            { },
            { min: 0, max: Number.MAX_SAFE_INTEGER },
        ],

        [
            { min: '500ms' },
            { min:  500, max: Number.MAX_SAFE_INTEGER },
        ],

        [
            {         max: '900ms' },
            { min: 0, max:  900 },
        ],

        [
            { min: '-5s', max: '9s' },
            { min:    0, max: 9000 },
        ],

        [
            { min: '1s', max: '9s' },
            { min: 1000, max: 9000 },
        ],

        [
            { min: '9s', max: '1s' },
            { min: 9000, max: 9000 },
        ],

    ])('ttl - %p', (origin: Bound_IN, result: Bound_OUT) => {

        const either = readResolver({ ttl: origin });

        if (E.isLeft(either)) {
            return expect(E.isRight(either)).toBe(true);
        }

        const ttl = F.pipe(
            either.right.ttl,
            O.map(R.pick([ 'min', 'max' ])),
        );

        expect(ttl).toStrictEqual(O.some(result));

    });

});





describe('decodeTimesUnion', () => {

    test.each([

        [  '5s', 5000 ],
        [  '2m', 2000 * 60 ],
        [ '1ms',    1 ],

    ])('%s', (a, b) => {

        expect(
            decodeTimesUnion.decode(a),
        ).toStrictEqual(
            E.of(b),
        );

    });

    test('fails', () => {

        expect(E.isLeft(decodeTimesUnion.decode('waaat'))).toBe(true);

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
                { uri: 'ss://YTpiQGxvY2FsaG9zdA==#foobar' },
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
                { uri: 'ss://127.0.0.1' },
                { uri: 'ss://127.0.0.1', key: 'foobar' },
                { uri: 'ss://127.0.0.1', key: 'foobar', alg: 'aes-128-ctr' },
                { uri: 'ss://YWVzLTE5Mi1nY206a2V5QGV4YW1wbGUuY29t#foobar' },
                { uri: 'ss://YWVzLTEyOC1jdHI6Zm9vYmFy@127.0.0.1:8080' },
                { uri: 'ss://YWVzLTEyOC1jdHI6Zm9vYmFy@127.0.0.1', key: 'hello' },
                { uri: 'ss://YWVzLTEyOC1jdHI6Zm9vYmFy@127.0.0.1', alg: 'aes-256-ctr' },
                { uri: 'trojan://foobar@127.0.0.1', ssl: { verify: true } },
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

    ])('%p', (bar: string[], source: string[], result: string[]) => {
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

    ])('%p', (bar: string[], source: string[], result: string[]) => {
        expect(unwrap(filterTags(wrap(source), bar))).toEqual(result);
    });



    const SetC = R.constructN<[string], Set<string>>(1, Set);

    const wrap = A.map(F.flow(
        SetC,
        R.objOf('tags'),
    ));

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const unwrap = A.map(F.flow(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        R.prop('tags'),
        Array.from,
        R.join(''),
    ));

});

