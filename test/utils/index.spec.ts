import { URL } from 'url';
import { Writable, Readable } from 'stream';

import nock from 'nock';

import { bind } from 'proxy-bind';

import * as R from 'ramda';

import * as Rx from 'rxjs';

import {
    option as O,
    either as E,
    task as T,
    taskEither as TE,
    function as F,
    string as Str,
} from 'fp-ts';

import {

    run,
    mem,
    noop,
    chunksOf,
    numberToUInt16BE,
    EVP_BytesToKey,
    portNormalize,
    isPrivateIP,
    isBlockedIP,
    eqBasic,
    headerJoin,
    socks5Handshake,
    incrementLE2,
    rules,
    HKDF_SHA1,
    Fn,
    Undefined,
    constErr,
    toBasicCredentials,
    readOptionalString,
    readURL,
    split,
    loopNext,
    genLooping,
    sieve,
    elapsed,
    rxTap,
    unwrapTaskEither,
    tryCatchToError,
    writeToTaskEither,
    timeout,
    raceTaskByTimeout,
    str2arr,
    toByteArray,
    readFile,
    readFileInStringOf,
    collectAsyncIterable,
    loadPath,
    basicInfo,
    groupBy,
    ErrorWithCode,
    eqErrorWithCode,
    genLevel,

} from '../../src/utils/index.js';

import {
    paths,
} from '../__helpers__/index.js';





describe('noop', () => {

    test('', () => {
        expect(noop).toBeInstanceOf(Function);
        expect(noop()).toBe(void 0);
    });

});





describe('Undefined', () => {

    test('', () => {
        expect(Undefined).toBeUndefined();
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

        check(
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

    const check = R.converge(
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

    const read = R.o(portNormalize, R.constructN(1, URL));

    test.each([

        [ 'http://example.com', 80 ],
        [ 'https://example.com', 443 ],

        [ 'http://example.com:80', 80 ],
        [ 'https://example.com:443', 443 ],

        [ 'http://example.com:443', 443 ],
        [ 'https://example.com:80', 80 ],

    ])('%s - %i', (url, port) => {
        expect(read(url)).toBe(port);
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





describe('eqBasic', () => {

    test.each([

        [ [ 'a', 'b' ], [ 'a', 'b' ] ],
        [ [ 'a',  '' ], [ 'a',  '' ] ],
        [ [  '', 'b' ], [  '', 'b' ] ],

    ] as const)('%p %p', (foo, bar) => {

        const x = { username: foo[0], password: foo[1] };
        const y = { username: bar[0], password: bar[1] };

        expect(eqBasic(x)(y)).toBe(true);

    });

    test.each([

        [ [ 'a', 'b' ], [ 'a', 'c' ] ],
        [ [ 'a',  '' ], [  '', 'a' ] ],
        [ [  '', 'b' ], [ 'b',  '' ] ],

    ] as const)('%p %p', (foo, bar) => {

        const x = { username: foo[0], password: foo[1] };
        const y = { username: bar[0], password: bar[1] };

        expect(eqBasic(x)(y)).toBe(false);

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





describe('rules', () => {

    describe('through', () => {

        const tests = rules.through([
            'foobar',
            'hello',
            'FULL,www.example.xyz',
            'REG,\\.cn$',
            'REG,google\\.',
            'END,.io',
            'BEGIN,mobile.',
            'CIDR,192.168.0.1/16',
            'CIDR,178.0.0.1/24',
        ]);

        test.each([

            'foobar.com',
            'hello-world.xyz',
            'www.example.xyz',
            'z.cn',
            'api.google.xyz',
            'example.io',
            'mobile.example.xyz',
            '192.168.1.2',
            '192.168.255.1',
            '178.0.0.2',
            '178.0.0.128',

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
            '192.167.1.2',
            '178.0.1.2',

        ])('not - %s', item => {
            expect(tests(item)).toBe(false);
        });

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





describe('incrementLE2', () => {

    test.each([

        [ [ 0x01 ], [ 0x02 ] ],
        [ [ 0xFF ], [ 0x00 ] ],
        [ [ 0x01, 0x00 ], [ 0x02, 0x00 ] ],
        [ [ 0xFF, 0x00 ], [ 0x00, 0x01 ] ],
        [ [ 0xFF, 0xFF ], [ 0x00, 0x00 ] ],
        [ [ 0xFF, 0xFF, 0x01, 0xFF ], [ 0x00, 0x00, 0x02, 0xFF ] ],

    ])('%p', (before, after) => {
        expect(incrementLE2(toByteArray(before))).toEqual(toByteArray(after));
    });

});





describe('genLevel', () => {

    const  __ = void 0;
    const ___ = void 0;

    const PRO = 'production';
    const DEV = 'dev';

    const De = 'debug';
    const Er = 'error';
    const In = 'info';
    const Wa = 'waaaaaaaat';

    const read = genLevel([ De, Er, In ]);

    test.each([

        [ PRO, De, De ],
        [ PRO, Er, Er ],

        [ DEV, In, In ],

        [ PRO, Wa, Er ],
        [ DEV, Wa, De ],

        [ ___, __, De ],
        [ ___, In, In ],
        [ DEV, __, De ],

    ])('%s | %s = %s', (NODE_ENV, LOG_LEVEL, result) => {

        expect(read({ NODE_ENV, LOG_LEVEL })).toBe(result);

    });

});





describe('chunksOf', () => {

    test.each([

        [ 2, 0, [ ] ],
        [ 2, 1, [ 1 ] ],
        [ 2, 3, [ 2, 1 ] ],
        [ 2, 3, [ 2, 1 ] ],
        [ 2, 5, [ 2, 2, 1 ] ],
        [ 0x3FFF, 0x3FFF, [ 0x3FFF ] ],

    ])('%d / %d', (max, chunk, result) => {

        expect(

            chunksOf (max) (new Uint8Array(chunk).fill(0)),

        ).toEqual(

            result.map(size => new Uint8Array(size).fill(0)),

        );

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
        R.concat([ 0x05, 0x01, 0x00, 0x03 ]) as unknown as Fn<Uint8Array>,
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





describe('toByteArray', () => {

    const raw = R.range(0, 3);
    const arr = Uint8Array.from(raw);

    test('from array', () => {

        expect(toByteArray(raw)).toStrictEqual(arr);

    });

    test('from generator', () => {

        const gen = function* () {
            yield* raw;
        };

        expect(toByteArray(gen())).toStrictEqual(arr);

    });

});





describe('ErrorWithCode', () => {

    test('extends Error', () => {
        expect(new ErrorWithCode()).toBeInstanceOf(Error);
    });

    test('has code', () => {
        expect(new ErrorWithCode('foo')).toHaveProperty('code', 'foo');
    });

});





describe('eqErrorWithCode', () => {

    test('', () => {

        {
            const error = new ErrorWithCode();
            expect(eqErrorWithCode.equals(error, error)).toBe(true);
        }

        expect(eqErrorWithCode.equals(
            new ErrorWithCode('err', 'foo'),
            new ErrorWithCode('err', 'bar'),
        )).toBe(true);

        expect(eqErrorWithCode.equals(
            new ErrorWithCode(''),
            new ErrorWithCode(''),
        )).toBe(true);

        expect(eqErrorWithCode.equals(
            new ErrorWithCode(),
            new ErrorWithCode(),
        )).toBe(false);

        expect(eqErrorWithCode.equals(
            new ErrorWithCode('foo', 'wat'),
            new ErrorWithCode('bar', 'wat'),
        )).toBe(false);

        expect(eqErrorWithCode.equals(
            new Error(),
            new ErrorWithCode(),
        )).toBe(false);

        expect(eqErrorWithCode.equals(
            new Error(        'foo'),
            new ErrorWithCode('foo', 'wat'),
        )).toBe(false);

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

        jest.useFakeTimers('legacy');

        const future = timeout(900);

        jest.runOnlyPendingTimers();

        await expect(future).rejects.toThrow();

    }, 10);

});





describe('elapsed', () => {

    test('', () => {

        jest.useRealTimers();

        const delay = 50;
        const data = 'foobar';

        return run(F.pipe(
            T.delay (delay) (TE.of(data)),
            elapsed(time => () => {
                expect(time).toBeGreaterThan(delay * 0.8);
                expect(time).toBeLessThan(delay * 1.2);
            }),
            TE.match(
                e => expect(e).toBeUndefined(),
                a => expect(a).toBe(data),
            ),
        ));

    }, 100);

});





describe('raceTaskByTimeout', () => {

    beforeEach(() => {
        jest.useRealTimers();
    });

    const data = 'foobar';

    test('on time', () => {

        const race500ms = raceTaskByTimeout(40, 'times out');

        const task = F.pipe(
            race500ms(
                T.delay(10) (TE.of(data)),
                T.delay(25) (TE.of('wat')),
            ),
            TE.toUnion,
        );

        return expect(task()).resolves.toStrictEqual(data);

    }, 50);

    test('over time', () => {

        const error = new Error('times out');

        const race500ms = raceTaskByTimeout(10, error);

        const task = F.pipe(
            TE.of(data),
            T.delay(40),
            race500ms,
            TE.toUnion,
        );

        return expect(task()).resolves.toBe(error);

    }, 50);

});





describe('groupBy', () => {

    test('', () => {

        const list = [

            { n: 10, shape: 'triangle' as const },

            { n: 20, shape: 'square' as const },
            { n: 21, shape: 'square' as const },

            { n: 30, shape: 'circular' as const },
            { n: 31, shape: 'circular' as const },
            { n: 32, shape: 'circular' as const },

        ];

        const { triangle, square, circular } = F.pipe(
            list,
            groupBy(R.prop('shape')),
        );

        expect(triangle.length).toBe(1);
        expect(square.length).toBe(2);
        expect(circular.length).toBe(3);

    });

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

    const { equals } = O.getEq(Str.Eq);

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

    test.each([

        [ 'doodle-analytics', R.T ],
        [ 'double-blink',     R.T ],

        [ 'Y-O-L-O',          R.F ],

    ])('%s', async (domain, result) => {

        const block = sieve(fixtures('sieve/block'));

        await expect(

            Rx.lastValueFrom(

                block.pipe(
                    Rx.map(R.applyTo(domain)),
                ),

            ),

        ).resolves.toBe(result());

    });



    test('(__wat__)', async () => {

        const __wat = sieve('__wat');

        await expect(

            Rx.lastValueFrom(

                __wat.pipe(
                    Rx.map(R.applyTo('O_o')),
                ),

            ),

        ).resolves.toBe(R.F());

    });

});





describe('readFile', () => {

    let hello = '';
    const world = 'world';

    beforeAll(() => {
        hello = fixtures('files/hello');
    });

    test('in String of utf8', async () => {

        await expect(

            Rx.lastValueFrom(readFileInStringOf('utf8')(hello)),

        ).resolves.toBe(world);

    });

    test('in Buffer', async () => {

        await expect(

            Rx.lastValueFrom(readFile(hello)),

        ).resolves.toStrictEqual(Buffer.from(world));

    });

    test('404', async () => {

        await expect(

            Rx.lastValueFrom(readFile('wat')),

        ).rejects.toThrowError();

    });

});





describe('loadPath', () => {

    test('File: hello', async () => {

        const hello = fixtures('files/hello');
        const world = 'world';

        await expect(

            Rx.lastValueFrom(loadPath(hello)),

        ).resolves.toBe(world);

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
            Rx.map(() => R.defaultTo(0, io())),
            Rx.reduce<number, number>(R.add, 0),
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





describe('isBlockedIP', () => {

    test.each([

        '0.0.0.0',
        '0:0:0:0:0:0:0:0',
        '::',

    ])('yes - %s', item => {
        expect(isBlockedIP(item)).toBe(true);
    });

    test.each([

        '',
        'foobar',
        '191.1.1.1',
        '127.0.0.1',

    ])('not - %s', item => {
        expect(isBlockedIP(item)).toBe(false);
    });

});





const fixtures = paths(__dirname, '../__fixtures__');

