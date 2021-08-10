import net from 'net';
import { URL } from 'url';
import { once } from 'events';
import { IncomingHttpHeaders } from 'http';
import crypto from 'crypto';
import { promisify } from 'util';
import { PathLike, promises as fs } from 'fs';
import { pipeline } from 'stream';

import fetch from 'node-fetch';

import { asyncReadable } from 'async-readable';

import { bind } from 'proxy-bind';

import memo from 'memoizerific';

import PKG_ip from 'ip';
const { isPrivate, cidrSubnet, isEqual: eqIP } = PKG_ip;

import {
    eq as Eq,
    either as E,
    task as T,
    taskEither as TE,
    option as O,
    string as Str,
    state as S,
    predicate as P,
    refinement as Rf,
    function as F,
    chainRec as CR,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import * as stdStr from 'fp-ts-std/String.js';
import * as stdA from 'fp-ts-std/ReadonlyArray.js';
import * as stdE from 'fp-ts-std/Either.js';
import * as stdB from 'fp-ts-std/Boolean.js';
import * as stdF from 'fp-ts-std/Function.js';

import * as Dc from 'io-ts/lib/Decoder.js';

import { parse as parseBasicAuth } from '@stableness/basic-auth';

import HKDF from 'futoin-hkdf';

import * as R from 'ramda';

import * as Rx from 'rxjs';

import type { Basic } from '../config.js';

export * from './curries.js';





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
    return Rx.tap({ next: fn });
}





export const Undefined = F.constUndefined();





export const mem = {

    in10: memo(10),
    in50: memo(50),
    in100: memo(100),
    in256: memo(256),
    in512: memo(512),
    in1000: memo(1000),

} as const;





export const isIP = R.o(
    P.not(R.equals(0)),
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

    const NOT = R.pipe(
        R.partition(R.startsWith('NOT,')),
        R.adjust(0, R.map(R.replace('NOT,', ''))) as typeof R.identity,
        R.map(through),
        R.applySpec({
            not: R.head as Fn<unknown, Test>,
            yes: R.last as Fn<unknown, Test>,
        }),
    );

    return { through, NOT };

});





export const noop = F.constVoid;





export class ErrorWithCode extends Error {

    constructor (public code?: string, message?: string) {
        super(message);
    }

}





export const chunksOf = (at: number) => (chunk: Uint8Array) => {

    return A.unfold(chunk, F.flow(

        O.fromPredicate(xs => xs.length > 0),

        O.map(buf => F.tuple(
            buf.subarray(0, at),
            buf.subarray(at),
        )),

    ));

};





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

    return Undefined;

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
export const unwrapTaskEither = F.flow(
    TE.mapLeft(E.toError),
    T.map(stdE.unsafeUnwrap),
    run,
);





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





// :: ReadableStream -> number -> TaskEither Error Buffer
export function readToTaskEither (stream: NodeJS.ReadableStream) {

    return catchKToError(asyncReadable(stream).read);

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

    const sample = F.flow(
        NA.of as Fn<Buffer, [ Buffer ]>,
        A.append(Buffer.from(password)),
        Buffer.concat,
        hash.md5,
    );

    const head = sample(Buffer.alloc(0));

    const init = {
        len: head.length,
        acc: NA.of(head),
    };

    return CR.tailRec(init, ({ len, acc }) => {

        if (len >= keySize) {
            return E.right(Buffer.concat(acc, keySize));
        }

        const chunk = sample(NA.last(acc));

        return E.left({
            len: len + chunk.length,
            acc: A.append (chunk) (acc),
        });

    });

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





export const isBlockedIP = run(function () {

    const eqIPc = stdF.curry2(eqIP);
    const eqStr = stdF.curry2(Str.Eq.equals);

    return stdB.anyPass([
        eqStr('0.0.0.0'),
        stdB.allPass([
            isIP,
            stdB.anyPass([
                eqIPc('0.0.0.0'),
                eqIPc('0:0:0:0:0:0:0:0'),
            ]),
        ]),
    ]);

});





export const str2arr = R.o(R.split(/\s+/), R.trim);





export const toByteArray = R.unary(bind(Uint8Array).from);





export type NonEmptyString = string & {
    readonly NonEmptyString: unique symbol;
};

export const readTrimmedNonEmptyString = F.pipe(
    Dc.string,
    Dc.map(R.trim),
    Dc.refine(
        P.not(R.equals('')) as Rf.Refinement<string, NonEmptyString>,
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
    Dc.map(NA.fromArray),
    Dc.refine(O.isSome, 'NonEmptyArray'),
    Dc.map(R.prop('value')),
);





export const either2B = E.fold(F.constFalse, F.constTrue);
export const option2B = O.fold(F.constFalse, F.constTrue);





export const eqBasic = stdF.curry2(

    Eq.struct<Basic>({
        password: Str.Eq,
        username: Str.Eq,
    }).equals,

);





export const toBasicCredentials = R.memoizeWith(
    R.identity as typeof String,
    R.compose(
        R.concat('Basic '),
        R.invoker(1, 'toString')('base64'),
        Buffer.from,
    ),
);





export const headerJoin = F.flow(
    stdA.join('\r\n'),
    stdStr.append('\r\n\r\n'),
);





export const genLevel: CurryT<[

    ReadonlyArray<string>,
    Record<string, string | undefined>,
    string,

]> = levels => ({ NODE_ENV, LOG_LEVEL }) => {

    const defaulted = NODE_ENV === 'production' ? 'error' : 'debug';

    if (LOG_LEVEL == null) {
        return defaulted;
    }

    return levels.includes(LOG_LEVEL) ? LOG_LEVEL : defaulted;

};





export const incrementLE2 = F.flow(
    R.unary(Array.from) as Fn<Uint8Array, ReadonlyArray<number>>,
    S.traverseArray<number, boolean, number>(n => carry => {

        const next = carry ? F.increment(n) : n;
        const _carry = next > 0xFF;
        const _next = _carry ? 0x00 : next;

        return [ _next, _carry ];

    }),
    S.evaluate(true),
    toByteArray,
);





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





export const groupBy = R.groupBy;





export function sieve (list: string) {

    type Has = (domain: string) => boolean;

    return Rx.defer(() => import(list) as Promise<{ has: Has }>).pipe(
        Rx.map(R.prop('has')),
        Rx.catchError(R.always(Rx.of(R.F as Has))),
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

