import net from 'net';
import { URL } from 'url';
import { once } from 'events';
import { IncomingHttpHeaders } from 'http';
import crypto from 'crypto';
import { promisify } from 'util';
import { PathLike, promises as fs } from 'fs';
import { pipeline } from 'stream';

import fetch from 'node-fetch';

import memo from 'memoizerific';

import { isPrivate, cidrSubnet, isEqual as eqIP } from 'ip';

import {
    eq as Eq,
    either as E,
    taskEither as TE,
    option as O,
    function as F,
    nonEmptyArray as NEA,
} from 'fp-ts';

import * as Dc from 'io-ts/Decoder';

import { parse as parseBasicAuth } from '@stableness/basic-auth';

import HKDF from 'futoin-hkdf';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import type { Basic } from '../config';





export type Fn <I, O = I> = (i: I) => O;

export type CurryT <T extends readonly unknown[]> =
      T extends [                     ] ? () => void
    : T extends [ infer U             ] ? Fn<U, U>
    : T extends [ infer I,    infer O ] ? Fn<I, O>
    : T extends [ infer H, ...infer R ] ? Fn<H, CurryT<R>>
    : never
;





export function run <F extends (...arg: unknown[]) => unknown> (fn: F) {
    return fn() as ReturnType<F>;
}





export function rxTap <T> (fn: (arg: T) => void) {
    return o.tap({ next: fn });
}





export const mem = {

    in10: memo(10),
    in50: memo(50),
    in100: memo(100),
    in256: memo(256),
    in512: memo(512),
    in1000: memo(1000),

} as const;





export const isIP = R.o(
    F.not(R.equals(0)),
    net.isIP,
);





export function testWith (list: Iterable<Fn<string, boolean>>) {

    return R.memoizeWith(R.identity, test);

    function test (str: string) {

        for (const check of list) {
            if (check(str)) {
                return true;
            }
        }

        return false;

    }

}





export const rules = run(function () {

    type Test = (name: string) => boolean;

    const through = R.o(
        testWith,
        R.map(R.cond([
            [
                R.startsWith('CIDR,'), R.pipe(
                    R.replace('CIDR,', ''),
                    cidrSubnet,
                    R.prop('contains'),
                    R.both(isIP),
                ),
            ],
            [
                R.startsWith('REG,'), R.pipe(
                    R.replace('REG,', ''),
                    R.constructN(1, RegExp),
                    R.test,
                ),
            ],
            [
                R.startsWith('FULL,'), R.pipe(
                    R.replace('FULL,', ''),
                    R.equals,
                ),
            ],
            [
                R.startsWith('END,'), R.pipe(
                    R.replace('END,', ''),
                    R.endsWith,
                ),
            ],
            [
                R.startsWith('BEGIN,'), R.pipe(
                    R.replace('BEGIN,', ''),
                    R.startsWith,
                ),
            ],
            [
                R.T, R.includes,
            ],
        ])),
    );

    const DOH = (list: readonly string[]) => {

        const map = R.pipe(
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            R.applySpec({
                doh: R.filter(R.startsWith('DOH,')),
                all: R.identity,
            }),
            R.map(R.map(R.replace('DOH,', ''))),
            R.map(through),
        );

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return map(list) as Record<'doh' | 'all', Test>;

    };

    const NOT = R.pipe(
        R.partition(R.startsWith('NOT,')),
        R.adjust(0, R.map(R.replace('NOT,', ''))) as typeof R.identity,
        R.map(through),
        R.applySpec({
            not: R.head as Fn<unknown, Test>,
            yes: R.last as Fn<unknown, Test>,
        }),
    );

    return { through, DOH, NOT };

});





export const noop = F.constVoid;





export function* chop (max: number, chunk: Uint8Array) {

    let buffer = chunk;

    while (buffer.length > max) {
        yield buffer.subarray(0, max);
        buffer = buffer.subarray(max);
    }

    if (buffer.length > 0) {
        yield buffer;
    }

}





export const socks5Handshake = mem.in50((host: string, port: number) =>

    Uint8Array.from([
        0x05, 0x01, 0x00,
        3, host.length, ...Buffer.from(host),
        ...numberToUInt16BE(port),
    ]),

);





export function* genLooping <T> (array: ArrayLike<T>) {

    while (array.length > 0) {
        yield* Array.from(array);
    }

    return undefined;

}





export function loopNext <T> (list: ArrayLike<T>) {

    const gen = genLooping(list);

    return () => gen.next().value;

}





export async function collectAsyncIterable <T> (source: AsyncIterable<T>) {

    const list: T[] = [];

    for await (const chunk of source) {
        list.push(chunk);
    }

    return list;

}





type List <T> =
    T extends Buffer ? [ Buffer, Buffer ]
    : T extends Uint8Array ? [ Uint8Array, Uint8Array ]
    : never
;

export const splitAt2 = split({ at: 2 });

export function split ({ at }: { at: number }) {

    return function <T extends Uint8Array | Buffer> (list: T) {

        return [ list.subarray(0, at), list.subarray(at) ] as List<T>;

    };

}





// :: (() -> Promise a) -> TaskEither Error a
export function tryCatchToError <A> (fn: F.Lazy<Promise<A>>) {
    return TE.tryCatch(fn, E.toError);
}





// :: (a -> Promise b) -> a -> TaskEither Error b
export function catchKToError <A extends ReadonlyArray<unknown>, B>
(fn: (...args: A) => Promise<B>) {
    return TE.tryCatchK(fn, E.toError);
}





// :: TaskEither e a -> Promise a
export async function unwrapTaskEither <E, A> (task: TE.TaskEither<E, A>) {

    const result = await task();

    if (E.isRight(result)) {
        return result.right;
    }

    throw E.toError(result.left);

}





// :: WritableStream -> Uint8Array | string -> TaskEither Error void
export function writeToTaskEither (stream: NodeJS.WritableStream) {

    return catchKToError((data: Uint8Array | string) => {

        return new Promise<void>((resolve, reject) => {

            const succeed = stream.write(data, err => {
                err ? reject(err) : resolve();
            });

            if (succeed !== true) {
                once(stream, 'drain').then(() => resolve(), reject);
            }

        });

    });

}





export const hash = run(function () {

    type Alg = 'md4' | 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha512';

    return {
        md5: hashFactor('md5'),
        sha1: hashFactor('sha1'),
        sha224: hashFactor('sha224'),
    };

    function hashFactor (algorithm: Alg) {

        type Data = string | Buffer | NodeJS.TypedArray | DataView;

        return function digest (data: Data) {

            return crypto.createHash(algorithm).update(data).digest();

        };

    }

});




export function EVP_BytesToKey (password: string, keySize: number) {

    const sample = Buffer.from(password);
    const buffer = [] as Buffer[];

    let chuck = Buffer.alloc(0);

    while (buffer.length * chuck.length < keySize) {
        chuck = hash.md5(Buffer.concat([ chuck, sample ]));
        buffer.push(chuck);
    }

    return Buffer.concat(buffer, keySize);

}





export function HKDF_SHA1 (
        key: Buffer | string,
        salt: Buffer,
        length: number,
        info: Buffer | string = 'ss-subkey',
) {
    return HKDF(key, length, { info, salt, hash: 'sha1' });
}





export const numberToUInt16BE = R.cond([

    [    R.equals(443), R.always(Buffer.from([ 0x01, 0xBB ])) ],
    [     R.equals(80), R.always(Buffer.from([ 0x00, 0x50 ])) ],
    [ R.equals(0x3FFF), R.always(Buffer.from([ 0x3F, 0xFF ])) ],

    [ R.lte(0xFFFF), R.always(Buffer.from([ 0xFF, 0xFF ])) ],
    [      R.gte(0), R.always(Buffer.from([ 0x00, 0x00 ])) ],

    [ R.T, mem.in100(_numberToUInt16BE) ],

]) as Fn<number, Buffer>;

function _numberToUInt16BE (num: number) {

    const buffer = Buffer.allocUnsafe(2);
    buffer.writeUInt16BE(num, 0);
    return buffer;

}





export function portNormalize ({ port, protocol }: URL) {
    return +port || (protocol === 'http:' ? 80 : 443);
}





export const isPrivateIP = R.both(
    isIP,
    isPrivate,
);




export const isBlockedIP: Fn<string, boolean> = R.either(
    R.equals('0.0.0.0'),
    R.both(
        isIP,
        R.anyPass([
            (ip: string) => eqIP(ip, '0.0.0.0'),
            (ip: string) => eqIP(ip, '0:0:0:0:0:0:0:0'),
        ]),
    ),
);





export const str2arr = R.o(R.split(/\s+/), R.trim);





export type NonEmptyString = string & {
    readonly NonEmptyString: unique symbol;
};

export const readTrimmedNonEmptyString = F.pipe(
    Dc.string,
    Dc.map(R.trim),
    Dc.refine(
        F.not(R.equals('')) as F.Refinement<string, NonEmptyString>,
        'NonEmptyString',
    ),
);

export const readTrimmedNonEmptyStringArr = F.pipe(
    readTrimmedNonEmptyString,
    Dc.array,
);





export const readOptionalString = F.flow(
    readTrimmedNonEmptyString.decode,
    O.fromEither,
);





export const readURL = F.pipe(

    readTrimmedNonEmptyString,

    Dc.parse(str => {

        try {
            return Dc.success(new URL(str));
        } catch { }

        return Dc.failure(str, 'invalid URL');

    }),

);





export const basicInfo = run(function () {

    return {
        auth: infoBy('authorization'),
        proxyAuth: infoBy('proxy-authorization'),
    };

    type Authorizations = Pick<
        IncomingHttpHeaders, 'authorization' | 'proxy-authorization'
    >;

    function infoBy (field: keyof Authorizations) {

        return function (headers: IncomingHttpHeaders) {

            return F.pipe(
                O.fromNullable(headers[field]),
                O.chainNullableK(parseBasicAuth),
            );

        };

    }

});





export const decoderNonEmptyArrayOf = F.flow(
    Dc.array,
    Dc.map(NEA.fromArray),
    Dc.refine(O.isSome, 'NonEmptyArray'),
    Dc.map(R.prop('value')),
);





export const either2B = E.fold(F.constFalse, F.constTrue);
export const option2B = O.fold(F.constFalse, F.constTrue);





export const eqBasic = F.pipe(

    Eq.getStructEq<Basic>({
        password: Eq.eqString,
        username: Eq.eqString,
    }),

    R.prop('equals'),

    R.curry,

);





export const toBasicCredentials = R.memoizeWith(
    R.identity as typeof String,
    R.compose(
        R.concat('Basic '),
        R.invoker(1, 'toString')('base64'),
        Buffer.from,
    ),
);





export const headerJoin = R.o(
    R.flip(R.concat)('\r\n\r\n'),
    R.join('\r\n'),
);





export function incrementLE (buffer: Uint8Array) {

    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i]++ < 255) {
            break;
        }
    }

}





type Obs <T> = Rx.Observable<T>;

export function readFile (filename: PathLike): Obs<Buffer>;
export function readFile (filename: PathLike, encoding: string): Obs<string>;
export function readFile (filename: PathLike, encoding?: string) {
    return Rx.defer(() => fs.readFile(filename, encoding));
}

export const readFileInStringOf =
    (encoding: BufferEncoding) =>
        (filename: PathLike) =>
            readFile(filename, encoding)
;





export function ObsGet (path: string) {

    return Rx.defer(async () => {

        const res = await fetch(path);

        if (res.ok !== true) {
            res.body.resume();
            throw new Error(`code ${ res.status }`);
        }

        return res.text();

    });

}





export const loadPath: Fn<string, Rx.Observable<string>> = R.ifElse(
    R.test(/^https?:\/\//),
    ObsGet,
    readFileInStringOf('utf8'),
);





export const groupBy = function <T, R extends string> (fn: (v: T) => R) {

    return function (list: readonly T[]): { [key in R]: T[] } {

        return R.groupBy(fn, list) as never;

    };

};





export function sieve (list: string) {

    type Has = (domain: string) => boolean;

    return Rx.defer(() => import(list) as Promise<{ has: Has }>).pipe(
        o.map(R.prop('has')),
        o.catchError(R.always(Rx.of(R.F as Has))),
    );

}





export function timeout (ms: number) {

    return new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(Error('timeout')), ms);
    });

}





export const constErr = R.o(R.always, Error);





export const onceErr: Fn<NodeJS.EventEmitter, Promise<[ Error ]>>
    = R.flip(once)('error') as never;





type RS = NodeJS.ReadableStream;
type WS = NodeJS.WritableStream;
type RWS = NodeJS.ReadWriteStream;

// TODO: https://github.com/microsoft/TypeScript/pull/41544
interface Pump {
    (readable: RS, writable: WS): Promise<void>;
    (readable: RS, ...trans: RWS[]): Promise<void>;
}

export const pump: Pump = promisify(pipeline);

