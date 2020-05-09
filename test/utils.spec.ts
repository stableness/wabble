import { URL } from 'url';

import { EventEmitter } from 'events';

import { bind } from 'proxy-bind';

import * as R from 'ramda';

import {

    noop,
    chop,
    numberToUInt16BE,
    EVP_BytesToKey,
    portNormalize,
    isPrivateIP,
    headerJoin,
    socks5Handshake,
    incrementLE,
    rules,
    mountErrOf,

} from '../src/utils';





describe('noop', () => {

    test('', () => {
        expect(noop).toBeInstanceOf(Function);
        expect(noop()).toBe(void 0);
    });

});





describe('numberToUInt16BE', () => {

    test.each([
        '0011',
        '0080',
        443,
        80,
        8080,
    ])('%s', item => {

        run(
            typeof item === 'string'
                ? item
                : item.toString(16).padStart(4, '0')
        );

    });

    test('overflow', () => {
        expect(numberToUInt16BE(0xFFFF + 1)).toEqual(h('FFFF'));
    })

    test('negative', () => {
        expect(numberToUInt16BE(-1)).toEqual(h('0000'));
    })



    const h = R.curryN(2, Buffer.from)(R.__, 'hex');

    const run = R.converge(
        (a: Buffer, b: Buffer) => expect(a).toEqual(b), [
            R.o(numberToUInt16BE, R.curry(parseInt)(R.__, 16)),
            h,
        ],
    );

});





describe('EVP_BytesToKey', () => {

    test.each([

        [ 32, 'a', `
            0cc175b9c0f1b6a831c399e269772661
            cec520ea51ea0a47e87295fa3245a605
        ` ],

        [ 24, 'hello', `
            5d41402abc4b2a76b9719d911017c592
            28b46ed3c111e851
        ` ],

        [ 16, 'world', `
            7d793037a0760186574b0282f2f435e7
        ` ],

    ])('[%i] %s', (size, pass, hex) => {
        expect(EVP_BytesToKey(pass, size)).toEqual(h(hex));
    });



    const h = R.o(
        R.curryN(2, Buffer.from)(R.__, 'hex'),
        R.replace(/\s+/g, ''),
    );

});





describe('portNormalize', () => {

    const run = R.o(portNormalize, R.constructN(1, URL));

    test.each([

        [ 'http://example.com', 80 ],
        [ 'https://example.com', 443 ],

        [ 'http://example.com:80', 80 ],
        [ 'https://example.com:443', 443 ],

        [ 'http://example.com:443', 443 ],
        [ 'https://example.com:80', 80 ],

    ])('%s - %i', (url, port) => {
        expect(run(url)).toBe(port);
    });

});





describe('headerJoin', () => {

    test.each([

        [ [ 'HTTP/1.0 200' ] ],
        [ [ 'HTTP/1.1 407 Proxy', 'Auth: Basic' ] ],

    ])('%p', fields => {
        expect(headerJoin(fields)).toMatch(/\r\n\r\n$/);
    });

});





describe('through', () => {

    const tests = rules.through([
        'foobar',
        'hello',
        'FULL,www.example.xyz',
        'REG,\\.cn$',
        'REG,google\\.',
        'END,.io',
        'BEGIN,mobile.',
    ]);

    test.each([

        'foobar.com',
        'hello-world.xyz',
        'www.example.xyz',
        'z.cn',
        'api.google.xyz',
        'example.io',
        'mobile.example.xyz',

    ])('yes - %s', item => {
        expect(tests(item)).toBe(true);
    });

    test.each([

        'fooba',
        'hallo-world.xyz',
        'www.example.org',
        'z.cn.org',
        'api.googleeeeeeee.xyz',
        'example.ioo',
        'v1.mobile.example.com',

    ])('not - %s', item => {
        expect(tests(item)).toBe(false);
    });

});





describe('incrementLE', () => {

    test.each([

        [ [ 0x01 ], [ 0x02 ] ],
        [ [ 0xFF ], [ 0x00 ] ],
        [ [ 0xFF, 0x00 ], [ 0x00, 0x01 ] ],
        [ [ 0xFF, 0xFF ], [ 0x00, 0x00 ] ],

    ])('%p', (before, after) => {
        expect(add(Uint8Array.from(before))).toEqual(Uint8Array.from(after));
    });

    const add = R.tap(incrementLE);

});





describe('chop', () => {

    test.each([

        [ 2, 0, [ ] ],
        [ 2, 1, [ 1 ] ],
        [ 2, 3, [ 2, 1 ] ],
        [ 2, 3, [ 2, 1 ] ],
        [ 2, 5, [ 2, 2, 1 ] ],
        [ 0x3FFF, 0x3FFF, [ 0x3FFF ] ],

    ])('%d / %d', async (max, chunk, result) => {

        const store = [] as Uint8Array[];

        for await (const slice of chop(max, new Uint8Array(chunk).fill(0))) {
            store.push(slice);
        }

        expect(store).toEqual(result.map(size => new Uint8Array(size).fill(0)));

    });

});





describe('socks5Handshake', () => {

    test.each([

        [  80, 'foo' ],
        [ 443, 'bar' ],
        [ 111, '1.2.3.4' ],
        [ 222, 'example.com' ],

    ])('[%s] %s', (port, host) => {
        expect(socks5Handshake(host, port)).toEqual(concat(domain(host, port)));
    });

    const name = R.converge(
        R.prepend, [
            R.length,
            R.o(Array.from, Buffer.from),
        ],
    );

    const concat = R.o(
        bind(Uint8Array).from,
        R.concat([ 0x05, 0x01, 0x00, 0x03 ]),
    );

    const domain = R.useWith(
        R.concat, [
            name,
            R.o(Array.from, numberToUInt16BE),
        ],
    );

});





describe('mountErrOf', () => {

    const emitter = new EventEmitter();

    test('identical returning', () => {
        expect(mountErrOf(emitter)).toBe(emitter);
        expect(mountErrOf(emitter)).toBe(emitter);
    });

});





describe('loopNext', () => {

    test.todo('');

});





describe('genLooping', () => {

    test.todo('');

});





describe('HKDF_SHA1', () => {

    test.todo('');

});





describe('isPrivateIP', () => {

    test.each([

        '10.0.0.0',
        '127.0.0.1',
        '192.168.0.1',
        '::ffff:192.168.1.1',

    ])('yes - %s', item => {
        expect(isPrivateIP(item)).toBe(true);
    });

    test.each([

        '191.1.1.1',
        'localhost',
        'example.com',

    ])('not - %s', item => {
        expect(isPrivateIP(item)).toBe(false);
    });

});

