import net from 'net';
import type { URL } from 'url';
import { once } from 'events';
import type { IncomingHttpHeaders } from 'http';
import crypto from 'crypto';
import { promisify } from 'util';
import { PathLike, promises as fs } from 'fs';
import { pipeline } from 'stream';

import { isPrivate } from 'ip';

import {
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

import { bind } from 'proxy-bind';





export type Fn <I, O = I> = (i: I) => O;





export function testWith (list: Iterable<Fn<string, boolean>>) {

    return R.memoizeWith(R.identity, test);

    function test (str: string) {

        for (const test of list) {
            if (test(str)) {
                return true;
            }
        }

        return false;

    }

}





export namespace rules {

    type Test = (name: string) => boolean;

    export const through = R.o(
        testWith,
        R.map(R.cond([
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

    export const DOH = (list: readonly string[]) => {

        const map = R.pipe(
            // @ts-ignore
            R.applySpec({
                doh: R.filter(R.startsWith('DOH,')),
                all: R.identity,
            }),
            R.map(R.map(R.replace('DOH,', ''))),
            R.map(through),
        );

        // @ts-ignore
        return map(list) as Record<'doh' | 'all', Test>;

    };

    export const NOT = R.pipe(
        R.partition(R.startsWith('NOT,')),
        R.adjust(0, R.map(R.replace('NOT,', ''))) as typeof R.identity,
        R.map(through),
        R.applySpec({
            not: R.head as Fn<any, Test>,
            yes: R.last as Fn<any, Test>,
        }),
    );

}





export const noop = F.constVoid;





export async function* chop (max: number, chunk: Uint8Array) {

    while (chunk.length > max) {
        yield chunk.subarray(0, max);
        chunk = chunk.subarray(max);
    }

    if (chunk.length > 0) {
        yield chunk;
    }

}





export const socks5Handshake = R.memoizeWith(

    (host, port) => `${ host }: ${ port }`,
    _socks5Handshake,

);

function _socks5Handshake (host: string, port: number) {

    return Uint8Array.from([
        0x05, 0x01, 0x00,
        3, host.length, ...Buffer.from(host),
        ...numberToUInt16BE(port),
    ]);

}





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





type List <T> =
    T extends Buffer ? [ Buffer, Buffer ]
    : T extends Uint8Array ? [ Uint8Array, Uint8Array ]
    : never
;

export const splitBy2 = splitBy(2);

export function splitBy (at: number) {

    return function <T extends Uint8Array | Buffer> (list: T) {

        return [ list.subarray(0, at), list.subarray(at) ] as List<T>;

    };

}





export namespace hash {

    type Alg = 'md4' | 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha512';

    export const md5 = hashFactor('md5');
    export const sha1 = hashFactor('sha1');
    export const sha224 = hashFactor('sha224');

    function hashFactor (algorithm: Alg) {

        type Data = string | Buffer | NodeJS.TypedArray | DataView;

        return function digest (data: Data) {

            return crypto.createHash(algorithm).update(data).digest();

        }

    }

}





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

    [ R.T, _numberToUInt16BE ],

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
    R.o(R.complement(R.equals(0)), net.isIP),
    isPrivate,
);





export type NonEmptyString = string & { readonly NonEmptyString: unique symbol };

export const readTrimmedNonEmptyString = F.pipe(
    Dc.string,
    Dc.map(R.trim),
    Dc.refine(
        R.complement(R.equals('')) as (str: string) => str is NonEmptyString,
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





export namespace basicInfo {

    export const auth = infoBy('authorization');
    export const proxyAuth = infoBy('proxy-authorization');

    type Authorizations = Pick<
        IncomingHttpHeaders, 'authorization' | 'proxy-authorization'
    >;

    function infoBy (field: keyof Authorizations) {

        return function (headers: IncomingHttpHeaders) {

            return F.pipe(
                O.fromNullable(headers[field]),
                O.mapNullable(parseBasicAuth),
            );

        };

    }

}





export const decoderNonEmptyArrayOf = F.flow(
    Dc.array,
    Dc.map(NEA.fromArray),
    Dc.refine(O.isSome, 'NonEmptyArray'),
    Dc.map(R.prop('value')),
);





export const either2B = E.fold(F.constFalse, F.constTrue);
export const option2B = O.fold(F.constFalse, F.constTrue);





export const toBasicCredentials = R.memoizeWith(R.identity as typeof String, R.compose(
    R.concat('Basic '),
    R.invoker(1, 'toString')('base64'),
    Buffer.from,
));





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





export function readFile (filename: PathLike): Rx.Observable<Buffer>;
export function readFile (filename: PathLike, encoding: string): Rx.Observable<string>;
export function readFile (filename: PathLike, encoding?: string) {
    return Rx.defer(() => fs.readFile(filename, encoding));
}

export const readFileInStringOf = (encoding: BufferEncoding) => (filename: PathLike) => {
    return readFile(filename, encoding);
}





export function sieve (list: string) {

    type Has = (domain: string) => boolean;

    return Rx.defer(() => import(list)).pipe(
        o.map((list: { has: Has }) => list.has),
        o.catchError(R.always(Rx.of(R.F as Has))),
    );

}





export function DoH (endpoint: string, path = '@stableness/dohdec') {

    type Result = { name: string, type: 1 | 28 | 5, TTL: number, data: string };
    type Response = Partial<Record<'answers' | 'Answer', Result[]>>;

    interface Class {
        new (opts?: { url?: string }): Class;
        getJSON (opts: { name: string }): Promise<Response>;
    }

    const doh = tryCatchToError(async () => {
        const pkg: { DNSoverHTTPS: Class } = await import(path);
        return new pkg.DNSoverHTTPS({ url: endpoint });
    })();

    return function (name: string) {

        return tryCatchToError(async () => {

            const dns = F.pipe(
                await doh,
                E.fold(err => { throw err }, F.identity),
            );

            const { answers, Answer } = await dns.getJSON({ name });

            const list = answers || Answer || [];

            if (R.isEmpty(list)) {
                throw new Error('empty');
            }

            return list;

        });

    };

}





export const constErr = R.o(R.always, Error);





export const tryCatchToError = <A> (f: F.Lazy<Promise<A>>) => TE.tryCatch(f, E.toError);





export const onceErr: Fn<NodeJS.EventEmitter, Promise<[ Error ]>>
    = R.flip(once)('error') as any;





const { has: errSetHas, add: errSetAdd, delete: errSetDel } = bind(new WeakSet());

export const mountErrOf = R.unless(
    errSetHas,
    R.o(
        R.tap(errSetAdd),
        R.tap((socket: NodeJS.EventEmitter) => {
            socket.once('error', _err => errSetDel(socket));
        }),
    ),
) as <T extends NodeJS.EventEmitter> (v: T) => T;





export const onceErrInSocketsFrom = R.o(
    R.map(onceErr),
    R.filter<any, 'array'>(R.is(net.Socket)),
);





type RS = NodeJS.ReadableStream;
type WS = NodeJS.WritableStream;
type RWS = NodeJS.ReadWriteStream;

// TODO: https://github.com/microsoft/TypeScript/pull/39094
interface Pump {
    (readable: RS, writable: WS): Promise<void>;
    (readable: RS, ...trans: RWS[]): Promise<void>;
}

export const pump: Pump = promisify(pipeline);

