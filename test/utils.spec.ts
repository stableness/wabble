import { URL } from 'url';
import { Writable, Readable } from 'stream';
import fs from 'fs';

import nock from 'nock';

import { bind } from 'proxy-bind';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import {
    option as O,
    either as E,
    task as T,
    taskEither as TE,
    function as F,
    eq as Eq,
} from 'fp-ts';

import {

    mem,
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
    HKDF_SHA1,
    Fn,
    constErr,
    toBasicCredentials,
    readOptionalString,
    readURL,
    split,
    loopNext,
    genLooping,
    DoH,
    sieve,
    run as force,
    rxTap,
    unwrapTaskEither,
    tryCatchToError,
    writeToTaskEither,
    timeout,
    str2arr,
    readFile,
    readFileInStringOf,
    collectAsyncIterable,
    loadPath,
    basicInfo,

} from '../src/utils';

import { CF_DOH_ENDPOINT } from '../src/settings/reading';





jest.mock('fs');





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
                : item.toString(16).padStart(4, '0'),
        );

    });

    test('overflow', () => {
        expect(numberToUInt16BE(0xFFFF + 1)).toEqual(h('FFFF'));
    });

    test('negative', () => {
        expect(numberToUInt16BE(-1)).toEqual(h('0000'));
    });



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





describe('collectAsyncIterable', () => {

    // eslint-disable-next-line @typescript-eslint/require-await
    const gen = async function* () {
        yield* [ 1, 2, 3 ];
    };

    const stream = Readable.from(gen());

    test('', async () => {

        const a = await collectAsyncIterable(gen());
        const b = await collectAsyncIterable(stream);

        expect(a).toStrictEqual(b);

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





describe('rules', () => {

    describe('DOH', () => {

        const tests = rules.DOH([
            'DOH,foo.com',
            'bar.com',
        ]);


        expect(tests.all('foo.com')).toBe(true);
        expect(tests.all('bar.com')).toBe(true);

        expect(tests.doh('foo.com')).toBe(true);
        expect(tests.doh('bar.com')).toBe(false);

    });

    describe('NOT', () => {

        const tests = rules.NOT([
            'NOT,foo.com',
            'bar.com',
        ]);


        expect(tests.not('foo.com')).toBe(true);
        expect(tests.not('bar.com')).toBe(false);

        expect(tests.yes('foo.com')).toBe(false);
        expect(tests.yes('bar.com')).toBe(true);

    });

});





describe('basicInfo', () => {

    test.each([

        [ 'aaa', 'bbb' ],
        [ 'foo', 'bar' ],
        [ '111', '222' ],

    ])('%s', (name, pass) => {

        const basic = stringify([ name, pass ]);
        const info = O.some({ name, pass });

        expect(

            F.pipe(
                basicInfo.auth({ authorization: basic }),
                O.map(pluck),
            ),

        ).toStrictEqual(info);

        expect(

            F.pipe(
                basicInfo.proxyAuth({ 'proxy-authorization': basic }),
                O.map(pluck),
            ),

        ).toStrictEqual(info);

    });



    const stringify = R.o(toBasicCredentials, R.join(':'));
    const pluck = R.pick([ 'name', 'pass' ]);

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

    ])('%d / %d', (max, chunk, result) => {

        const store = [] as Uint8Array[];

        for (const slice of chop(max, new Uint8Array(chunk).fill(0))) {
            store.push(slice);
        }

        expect(store).toEqual(result.map(size => new Uint8Array(size).fill(0)));

    });

});





describe('split', () => {

    const buffer = Buffer.allocUnsafe(10);

    test.each([
        0,
        2,
        3,
        4,
        5,
        10,
    ])('by %d', num => {

        const slice = split({ at: num });
        const [ head, tail ] = slice(buffer);

        expect(head.length).toBe(num);
        expect(tail.length).toBe(buffer.length - num);
        expect(Buffer.concat([ head, tail ])).toEqual(buffer);

    });

});





describe('unwrapTaskEither', () => {

    test('resolve', async () => {

        const wat = 42;
        const task = tryCatchToError(T.of(wat));

        await expect(unwrapTaskEither(task)).resolves.toBe(wat);

    });

    test('reject', async () => {

        const wat = new Error('wat');
        const task = TE.throwError(wat);

        await expect(unwrapTaskEither(task)).rejects.toThrow(wat);

    });

    test('reject non error', async () => {

        const wat = 'wat';
        const task = TE.throwError(wat);

        await expect(unwrapTaskEither(task)).rejects.toThrow(wat);

    });

});





describe('writeToTaskEither', () => {

    const stream = new Writable({

        highWaterMark: 1,

        write ([ flag ], _enc, cb) {

            if (flag === 0x30 + 0) {
                return cb();
            }

            if (flag === 0x30 + 1) {
                return setImmediate(cb);
            }

            return cb(Error('wat'));

        },

    });

    const write = writeToTaskEither(stream);

    test('', async () => {

        await expect(unwrapTaskEither(write('0'))).resolves.toBe(void 0);
        await expect(unwrapTaskEither(write('1'))).resolves.toBe(void 0);
        await expect(unwrapTaskEither(write('2'))).rejects.toThrow('wat');

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





describe('str2arr', () => {

    test('', () => {

        const list = str2arr(`
            foo
            bar
        `);

        expect(list).toStrictEqual([ 'foo', 'bar' ]);

    });

});





describe('mem', () => {

    test('', () => {

        const hook = jest.fn(R.add(1));
        const add1 = mem.in256(hook);

        expect(add1(42)).toBe(43);
        expect(add1(42)).toBe(43);
        expect(hook).toHaveBeenCalledWith(42);
        expect(hook).toHaveBeenCalledTimes(1);

        R.map(add1, R.range(256, 256 * 2));

        expect(add1(999)).toBe(1000);
        expect(hook).toHaveBeenLastCalledWith(999);

        expect(add1(42)).toBe(43);
        expect(hook).toHaveBeenLastCalledWith(42);

    });

});





describe('timeout', () => {

    test('', async () => {

        jest.useFakeTimers();

        const future = timeout(900);

        jest.runOnlyPendingTimers();

        await expect(future).rejects.toThrow();

    }, 10);

});





describe('constErr', () => {

    const msg = 'o_O';
    const lazyErr = constErr(msg);

    test('', () => {
        expect(lazyErr).not.toThrow();
        expect(lazyErr).toBeInstanceOf(Function);
        expect(lazyErr()).toStrictEqual(new Error(msg));
    });

});





describe('toBasicCredentials', () => {

    test.each([
        [ 'a:b', 'YTpi' ],
        [ 'a:',  'YTo=' ],
        [  ':b', 'OmI=' ],
    ])('%p', (auth, result) => {
        expect(toBasicCredentials(auth)).toBe(R.concat('Basic ', result));
    });

});





describe('readOptionalString', () => {

    test.each([

        [  'foo',  O.some('foo') ],
        [ ' foo',  O.some('foo') ],
        [  'foo ', O.some('foo') ],

        [     '', O.none ],
        [    ' ', O.none ],
        [ void 0, O.none ],
        [   null, O.none ],
        [    123, O.none ],
        [     {}, O.none ],
        [     [], O.none ],

    ])('%p', (raw, result) => {

        expect(equals(readOptionalString(raw), result)).toBe(true);

    });

    const { equals } = O.getEq(Eq.eqString);

});





describe('readURL', () => {

    test.each([

        'foobar',
        ' ',
        null,
        42,
        [],

    ])('%p', raw => {

        expect(E.isLeft(decodeURL(raw))).toBe(true);

    });

    test.each([

        'http://127.0.1:8080',
        ' tcp://127.0.1:8080',
        '  ss://127.0.1:8080',

    ])('%p', raw => {

        expect(E.isRight(decodeURL(raw))).toBe(true);

    });

    const { decode: decodeURL } = readURL;

});





describe('sieve', () => {

    const block = sieve('../test/__fixtures__/sieve/block');

    test.each([

        [ 'doodle-analytics', R.T ],
        [ 'double-blink',     R.T ],

        [ 'Y-O-L-O',          R.F ],

    ])('%s', async (domain, result) => {

        await expect(

            Rx.lastValueFrom(

                block.pipe(
                    o.map(R.applyTo(domain)),
                ),

            ),

        ).resolves.toBe(result());

    });



    test('(__wat__)', async () => {

        const __wat = sieve('__wat');

        await expect(

            Rx.lastValueFrom(

                __wat.pipe(
                    o.map(R.applyTo('O_o')),
                ),

            ),

        ).resolves.toBe(R.F());

    });

});





describe('DoH', () => {

    test('invalid endpoint', async () => {

        const doh = DoH('waaaaaaaaaaaaaaaaat');

        const results = await force(doh('example.com'));

        expect(E.isLeft(results)).toBe(true);

    });

    test('invalid path', async () => {

        const doh = DoH(CF_DOH_ENDPOINT, 'waaaaaaaaaaaaaaaaat');

        const results = await force(doh('example.com'));

        expect(E.isLeft(results)).toBe(true);

    });

    // TODO: network mocking
    const condTest = process.env.NO_SKIP === 'on' ? test : test.skip;

    condTest('valid', async () => {

        const doh = DoH(CF_DOH_ENDPOINT);

        const results = await force(doh('example.com'));

        expect(E.isRight(results)).toBe(true);

    });

});





describe('readFile', () => {

    const mapping = {
        hello: 'world',
    };

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    fs.__setMockFiles(mapping);

    test('in String of utf8', async () => {

        await expect(

            Rx.lastValueFrom(readFileInStringOf('utf8')('hello')),

        ).resolves.toBe(mapping.hello);

    });

    test('in Buffer', async () => {

        await expect(

            Rx.lastValueFrom(readFile('hello')),

        ).resolves.toStrictEqual(Buffer.from(mapping.hello));

    });

    test('404', async () => {

        await expect(

            Rx.lastValueFrom(readFile('wat')),

        ).rejects.toThrowError();

    });

});





describe('loadPath', () => {

    test('File: hello', async () => {

        const mapping = {
            hello: 'world',
        };

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        fs.__setMockFiles(mapping);

        await expect(

            Rx.lastValueFrom(loadPath('hello')),

        ).resolves.toBe(mapping.hello);

    });



    test('GET /foo', async () => {

        nock('https://example.com').get('/foo').reply(200, 'bar');

        await expect(

            Rx.lastValueFrom(loadPath('https://example.com/foo')),

        ).resolves.toBe('bar');

    });



    test('HTTP 500', async () => {

        nock('http://example.com').get('/error').reply(500);

        await expect(

            Rx.lastValueFrom(loadPath('http://example.com/error')),

        ).rejects.toThrow();

    });

});





describe('rxTap', () => {

    test('', () => {

        const value = 42;
        const foo = jest.fn();
        const bar = jest.fn();

        Rx.of(value).pipe(rxTap(foo)).subscribe(bar);

        expect(foo).toHaveBeenCalledWith(value);
        expect(bar).toHaveBeenCalledWith(value);

    });

});





describe('Looping', () => {

    test('genLooping empty', () => {

        const { done, value } = genLooping([] as string[]).next();

        expect(done).toBe(true);
        expect(value).toBeUndefined();

    });

    test('loopNext', async () => {

        const step = Math.round(5 + Math.random() * 10);
        const io = loopNext([ 1 ]);

        const loop = Rx.range(0, step).pipe(
            o.map(() => R.defaultTo(0, io())),
            o.reduce<number, number>(R.add, 0),
        );

        await expect(

            Rx.lastValueFrom(loop),

        ).resolves.toBe(step);

    });

});





describe('HKDF_SHA1', () => {

    test.each([

        [   42,
            '0b0b0b0b0b0b0b0b0b0b0b',
            '000102030405060708090a0b0c',
            'f0f1f2f3f4f5f6f7f8f9',
            // eslint-disable-next-line max-len
            '085a01ea1b10f36933068b56efa5ad81a4f14b822f5b091568a9cdd4f155fda2c22e422478d305f3f896',
        ],

    ])('%i - %s', (length, key, salt, info, hash) => {
        expect(
            HKDF_SHA1(h(key), h(salt), length, h(info)),
        ).toStrictEqual(h(hash));
    });

    const h = R.o(
        R.curryN(2, Buffer.from)(R.__, 'hex') as Fn<string, Buffer>,
        R.replace(/\s+/g, ''),
    );

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

