import net from 'net';
import { URL } from 'url';
import { once } from 'events';
import { IncomingHttpHeaders } from 'http';
import crypto from 'crypto';
import { promisify } from 'util';
import { PathLike, promises as fs } from 'fs';
import { pipeline } from 'stream';
import { TextDecoder as TD } from 'util';

import fetch from 'node-fetch';

import { base64 } from 'rfc4648';

import { asyncReadable } from 'async-readable';

import { bind } from 'proxy-bind';

import memo from 'memoizerific';

import PKG_ip from 'ip';
const { isPrivate, cidrSubnet, isEqual: eqIP } = PKG_ip;

import {
    eq as Eq,
    date as D,
    either as E,
    task as T,
    taskEither as TE,
    io as IO,
    option as O,
    string as Str,
    state as S,
    predicate as P,
    separated as Sp,
    refinement as Rf,
    reader as Rd,
    monoid as Md,
    tuple as Tp,
    function as F,
    chainRec as CR,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import {
    string as stdStr,
    readonlyArray as stdA,
    either as stdE,
    boolean as stdB,
    number as stdNum,
    url as stdURL,
    function as stdF,
} from 'fp-ts-std';

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





export const rxOf = <T> (v: T) => Rx.of(v);





export function rxTap <T> (fn: (arg: T) => void) {
    return Rx.tap({ next: fn });
}





export const Undefined = F.constUndefined();





export const eqErrorWithCode = Eq.fromEquals<ErrorWithCode>((a, b) =>
    a === b
    || a instanceof ErrorWithCode
    && b instanceof ErrorWithCode
    && a.code === b.code
    && a.code != null,
);





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

    const through = F.flow(
        A.map(R.cond([
            [
                Str.startsWith('CIDR,'), F.flow(
                    Str.replace('CIDR,', ''),
                    cidrSubnet,
                    ({ contains }) => stdB.both (isIP) (contains),
                ),
            ],
            [
                Str.startsWith('REG,'), F.flow(
                    Str.replace('REG,', ''),
                    F.tuple,
                    stdF.construct(RegExp),
                    stdStr.test,
                ),
            ],
            [
                Str.startsWith('FULL,'), F.flow(
                    Str.replace('FULL,', ''),
                    stdF.curry2(Str.Eq.equals),
                ),
            ],
            [
                Str.startsWith('END,'), F.flow(
                    Str.replace('END,', ''),
                    Str.endsWith,
                ),
            ],
            [
                Str.startsWith('BEGIN,'), F.flow(
                    Str.replace('BEGIN,', ''),
                    Str.startsWith,
                ),
            ],
            [
                F.constTrue, R.unary(Str.includes),
            ],
        ])),
        testWith,
    );

    const NOT = F.flow(
        A.partition(Str.startsWith('NOT,')),
        Sp.map(A.map(Str.replace('NOT,', ''))),
        Sp.bimap(through, through),
        F.pipe(
            Rd.Do,
            Rd.apS('yes', Rd.asks<Sp.Separated<Test, Test>, Test>(Sp.left)),
            Rd.apS('not', Rd.asks<Sp.Separated<Test, Test>, Test>(Sp.right)),
        ),
    );

    return { through, NOT };

});





export const noop = F.constVoid;





export const onceF = <T extends unknown[]> (
    event: string,
    emitter: NodeJS.EventEmitter,
) => once(emitter, event) as Promise<T>;

export const onceTE = catchKToError(onceF);

export const onceTEC = stdF.curry2(onceTE);

export const onceSndTE = F.flow(
    onceTE,
    TE.map(Tp.snd as never),
) as <T> (...args: Parameters<typeof onceF>) => TE.TaskEither<Error, T>;

export const onceSndTEC = stdF.curry2(onceSndTE);





export class ErrorWithCode extends Error {

    constructor (public code?: string, message?: string) {
        super(message);
    }

}





export const monoidBuffer: Md.Monoid<Uint8Array> = {
    empty: Uint8Array.of(),
    concat: (x, y) => Uint8Array.from(Buffer.concat([ x, y ])),
};





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

    Md.concatAll (monoidBuffer) ([

        Uint8Array.of(0x05, 0x01, 0x00, 0x03, host.length),

        Buffer.from(host),

        numberToUInt16BE(port),

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





export const elapsed = (cb: Fn<number, IO.IO<unknown>>) => F.flow(
    T.bindTo('result'),
    T.apS('start', T.fromIO(D.now)),
    T.bind('end', ({ start }) => F.pipe(
        T.fromIO(D.now),
        T.map(stdNum.subtract(start)),
    )),
    T.chainFirstIOK(({ end }) => cb(end)),
    T.map(({ result }) => result),
);





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





export const bracket: <EE, AA, BB> (
    acquire: TE.TaskEither<EE, AA>,
    use: (a: AA) => TE.TaskEither<EE, BB>,
    release: (a: AA, e: E.Either<EE, BB>) => TE.TaskEither<EE, unknown>,
) => TE.TaskEither<EE, BB> = TE.bracket as never;





export function raceTaskByTimeout (ms: number, e: string | Error) {

    return <M> (...tasks: ReadonlyArray<TE.TaskEither<Error, M>>) => () => {

        let ref: NodeJS.Timeout;

        return Promise.race([

            ...tasks.map(run),

            new Promise<E.Either<Error, never>>(resolve => {

                ref = setTimeout(F.flow(
                    E.toError,
                    E.left,
                    resolve,
                ), ms, e);

            }),

        ]).finally(() => clearTimeout(ref));

    };

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





export const numberToUInt16BE = stdF.guard ([

    [    R.equals(443), F.constant(Uint8Array.of(0x01, 0xBB)) ],
    [     R.equals(80), F.constant(Uint8Array.of(0x00, 0x50)) ],
    [ R.equals(0x3FFF), F.constant(Uint8Array.of(0x3F, 0xFF)) ],

    [ R.lte(0xFFFF), F.constant(Uint8Array.of(0xFF, 0xFF)) ],
    [      R.gte(0), F.constant(Uint8Array.of(0x00, 0x00)) ],

]) (mem.in100((num: number) => Uint8Array.of(num >>> 8, num)));





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





export const bufferToString = run(function () {

    const td = new TD();

    type Param = Parameters<typeof TD.prototype.decode>;

    return (...rest: Param) => td.decode(...rest);

});





export const trimBase64URI = (raw: string) => F.pipe(
    readOptionalString(raw),
    O.map(Str.split('://')),
    O.chain(A.lookup(1)),
    O.chain(readOptionalString),
    O.map(Str.split('#')),
    O.map(NA.head),
    O.chain(readOptionalString),
    O.chain(base => F.pipe(
        O.tryCatch(() => base64.parse(base)),
        O.map(bufferToString),
        O.map(after => Str.replace (base, after) (raw)),
        O.chainFirst(stdURL.parseO),
    )),
    O.getOrElse(F.constant(raw)),
);





export const readURL = F.pipe(

    readTrimmedNonEmptyString,

    Dc.map(trimBase64URI),

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





type TE_E <T> = TE.TaskEither<Error, T>;

export function readFile (filename: PathLike): TE_E<Buffer>;
export function readFile (filename: PathLike, encoding: string): TE_E<string>;
export function readFile (filename: PathLike, encoding?: string) {
    return tryCatchToError(() => fs.readFile(filename, encoding));
}

export const readFileInStringOf =
    (encoding: BufferEncoding) =>
        (filename: PathLike) =>
            readFile(filename, encoding)
;





export const fetchGet = F.flow(

    catchKToError((url: string) => fetch(url)),

    TE.mapLeft(IO.of),

    TE.filterOrElse(
        res => res.ok,
        res => () => {
            res.body.resume();
            return new Error(`code ${ res.status }`);
        },
    ),

    TE.mapLeft(run),

    TE.chain(res => tryCatchToError(() => res.text())),

);




export const loadPath = stdF.uncurry3 (stdF.ifElse) ([
    fetchGet,
    readFileInStringOf('utf8'),
    stdStr.test(/^https?:\/\//),
]);

export const loadPathObs = F.flow(
    loadPath,
    Rx.defer,
    Rx.map(stdE.unsafeUnwrap),
);





export const groupBy = R.groupBy;





export function sieve (list: string) {

    type Has = (domain: string) => boolean;

    return Rx.defer(() => import(list) as Promise<{ has: Has }>).pipe(
        Rx.map(R.prop('has')),
        Rx.catchError(R.always(rxOf(R.F as Has))),
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

