import { type Socket } from 'net';
import cpt from 'crypto';
import { Transform, TransformCallback } from 'stream';

import * as R from 'ramda';

import {
    either as E,
    ioRef as Ref,
    readonlyArray as A,
    reader as Rd,
    taskEither as TE,
    io as IO,
    ioEither as IoE,
    identity as Id,
    function as F,
} from 'fp-ts';

import { toTransform } from 'buffer-pond';

import type { ShadowSocks } from '../config.js';
import * as u from '../utils/index.js';

import type { AEAD, Stream } from '../settings/utils/shadowsocks.js';

import { connect_tcp, RTE_O_E_V, destroyBy, by_race } from './index.js';





export const chain: u.Fn<ShadowSocks, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => u.socks5Handshake(host, port).subarray(3)),

        TE.chainEitherK(cryptoPairsCE(remote)),

        TE.apS('socket', F.pipe(

            tunnel(remote),

            u.elapsed(ping => () => {

                const { cipher: { type, algorithm } } = remote;
                const base = R.pick([ 'host', 'port', 'protocol' ], remote);

                logger
                    .child({ ...base, type, algorithm, ping })
                    .trace('Elapsed')
                ;

            }),

        )),

        TE.orElseFirstIOK(F.constant(abort)),

        TE.chain(({ enc, socket, dec }) => hook(enc, socket, dec)),

    );

};





const timeoutError = new u.ErrorWithCode(
    'SERVER_SOCKET_TIMEOUT',
    'shadowsocks server timeout',
);

type ConnOpts = Pick<ShadowSocks, 'host' | 'port' | 'timeout'>;

export const tunnel = (remote: ConnOpts) => u.bracket(

    TE.rightIO(connect_tcp(remote)),

    (socket: Socket) => F.pipe(
        u.onceTE('connect', socket),
        F.pipe(timeoutError, by_race (remote.timeout ?? 5_000)),
        TE.map(F.constant(socket)),
    ),

    destroyBy(timeoutError),

);





export const cryptoPairsE = E.tryCatchK(cryptoPairs, E.toError);

export const cryptoPairsCE = u.curry2(cryptoPairsE);

export function cryptoPairs (
        info: Pick<ShadowSocks, 'key' | 'cipher'>,
        head: Uint8Array,
) {

    type RWS = NodeJS.ReadWriteStream;

    const { key, cipher } = info;

    if (cipher.type === 'Stream') {

        const { algorithm, ivLength } = cipher;

        return {
            enc: EncryptStream(algorithm, key, ivLength, head) as RWS,
            dec: DecryptStream(algorithm, key, ivLength) as RWS,
        };

    }

    if (cipher.type === 'AEAD') {

        const { algorithm, keySize, nonceSize, tagSize, saltSize } = cipher;

        return {

            enc: EncryptAEAD(
                algorithm, key, keySize, nonceSize, tagSize, saltSize, head,
            ) as RWS,

            dec: DecryptAEAD(
                algorithm, key, keySize, nonceSize, tagSize, saltSize,
            ) as RWS,

        };

    }

    throw new Error(`Non supported cipher [${ cipher }]`);

}





const SS_SUBKEY = 'ss-subkey';

export function EncryptAEAD (
        algorithm: AEAD,
        key: Uint8Array,
        keySize: number,
        nonceSize: number,
        tagSize: number,
        saltSize: number,
        head: Uint8Array,
) {

    const salt = cpt.randomBytes(saltSize);
    const subKey = u.HKDF_SHA1(key, salt, SS_SUBKEY, keySize);

    const pack = F.flow(
        u.std.Tp.toFst((data: Uint8Array) => u.numberToUInt16BE(data.length)),
        A.map(genAEADEncrypt(algorithm, subKey, nonceSize, tagSize)),
    );

    return F.pipe(

        Id.of(new Transform({

            transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

                u.run(F.pipe(
                    chop(chunk),
                    A.chain(pack),
                    IO.traverseArray(data => () => this.push(data)),
                    IO.apSecond(cb),
                ));

            },

        })),

        Id.chainFirst(readable => {

            readable.push(salt);
            readable.push(u.foldBytes(pack(head)));

        }),

    );

}

const chop = u.chunksOf(0x3FFF);

const new_uint8_mem_10 = u.mem.in10((n: number) => new Uint8Array(n));

const increment_LE_mem_10 = u.mem.in10(u.incrementLE2);

function genAEADEncrypt (
        algorithm: AEAD,
        subKey: Uint8Array,
        nonceSize: number,
        authTagLength: number,
) {

    const { read, modify } = u.run(Ref.newIORef(new_uint8_mem_10(nonceSize)));

    return F.pipe(

        Rd.asks((data: Uint8Array) => ({ data })),

        Rd.apSW('cipher', F.pipe(

            Rd.asks(read),

            Rd.map(iv => cpt.createCipheriv(
                algorithm as cpt.CipherGCMTypes,
                subKey,
                iv,
                { authTagLength },
            )),

            Rd.apFirst(modify(increment_LE_mem_10)),

        )),

        Rd.map(({ cipher, data }) => Buffer.concat([
            cipher.update(data),
            cipher.final(),
            cipher.getAuthTag(),
        ])),

    );

}





export function DecryptAEAD (
        algorithm: AEAD,
        key: Uint8Array,
        keySize: number,
        nonceSize: number,
        tagSize: number,
        saltSize: number,
) {

    return toTransform (async function* ({ read }) {

        const salt = await read(saltSize);

        const decrypt = genAEADDecrypt(
            algorithm,
            key,
            keySize,
            nonceSize,
            tagSize,
            salt,
        );

        while (true) {

            // eslint-disable-next-line no-await-in-loop
            const buffer = decrypt(u.splitAt2(await read(2 + tagSize)));
            const length = buffer.readUInt16BE(0);

            const slice = u.split({ at: length });

            // eslint-disable-next-line no-await-in-loop
            yield decrypt(slice(await read(length + tagSize)));

        }

    }) ({ objectMode: false });

}

function genAEADDecrypt (
        algorithm: AEAD,
        key: Uint8Array,
        keySize: number,
        nonceSize: number,
        authTagLength: number,
        salt: Uint8Array,
) {

    const subKey = u.HKDF_SHA1(key, salt, SS_SUBKEY, keySize);

    const { read, modify } = u.run(Ref.newIORef(new_uint8_mem_10(nonceSize)));

    return F.pipe(

        Rd.asks(([ data, tag ]: [ Uint8Array, Uint8Array ]) => ({ data, tag })),

        Rd.apSW('decipher', F.pipe(

            Rd.asks(read),

            Rd.map(iv => cpt.createDecipheriv(
                algorithm as cpt.CipherCCMTypes,
                subKey,
                iv,
                { authTagLength },
            )),

            Rd.apFirst(modify(increment_LE_mem_10)),

        )),

        Rd.chainFirst(({ decipher, tag }) => Rd.of(decipher.setAuthTag(tag))),

        Rd.map(({ decipher, data }) => Buffer.concat([
            decipher.update(data),
            decipher.final(),
        ])),

    );

}





const RC4 = 'rc4';

const { empty: EMPTY, concat, concatF } = u.monoidBuffer;

export function EncryptStream (
        algorithm: Stream,
        key: Uint8Array,
        ivLength: number,
        head: Uint8Array,
) {

    const iv = cpt.randomBytes(ivLength);

    const isRC4 = algorithm.startsWith(RC4);

    const cipher = cpt.createCipheriv(
        isRC4 ? RC4 : algorithm,
        isRC4 ? u.hash.md5(concat(key, iv)) : key,
        isRC4 ? EMPTY : iv,
    );

    return F.pipe(

        Id.of(new Transform({

            transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {
                cb(u.Undefined, cipher.update(chunk));
            },

        })),

        Id.chainFirst(readable => {

            readable.push(iv);
            readable.push(cipher.update(head));

        }),

    );

}





export function DecryptStream (
        algorithm: Stream,
        key: Uint8Array,
        ivLength: number,
) {

    type State = E.Either<Uint8Array, cpt.Decipher>;

    const { read, write } = u.run(Ref.newIORef<State>(E.left(EMPTY)));

    return new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

            const push = IoE.tryCatchK(d => cb(u.Undefined, d), E.toError);

            u.run(F.pipe(
                read,
                IoE.chainFirstIOK(decipher => push(decipher.update(chunk))),
                IoE.mapLeft(concatF(chunk)),
                IoE.swap,
                IoE.chainFirstIOK(data => {

                    if (data.length < ivLength) {
                        return F.pipe(
                            write(E.left(data)),
                            IO.apFirst(cb),
                        );
                    }

                    const [ iv, remain ] = u.split ({ at: ivLength }) (data);

                    const isRC4 = algorithm.startsWith(RC4);

                    const decipher = cpt.createDecipheriv(
                        isRC4 ? RC4 : algorithm,
                        isRC4 ? u.hash.md5(concat(key, iv)) : key,
                        isRC4 ? EMPTY : iv,
                    );

                    return F.pipe(
                        write(E.right(decipher)),
                        IO.apFirst(push(decipher.update(remain))),
                    );

                }),
            ));

        },

    });

}

