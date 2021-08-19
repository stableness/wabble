import crypto from 'crypto';
import { once } from 'events';
import { Transform, TransformCallback } from 'stream';

import * as R from 'ramda';

import {
    either as E,
    ioRef as Ref,
    state as S,
    readonlyArray as A,
    taskEither as TE,
    io as IO,
    ioEither as IoE,
    function as F,
} from 'fp-ts';

import { toTransform } from 'buffer-pond';

import type { ShadowSocks } from '../config.js';
import * as u from '../utils/index.js';

import type { AEAD, Stream } from '../settings/utils/shadowsocks.js';

import { netConnectTo, RTE_O_E_V, destroyBy } from './index.js';





export const chain: u.Fn<ShadowSocks, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => u.socks5Handshake(host, port).subarray(3)),

        TE.chainEitherK(cryptoPairsCE(remote)),

        TE.apS('socket', F.pipe(

            tunnel(remote),

            u.elapsed(ping => () => {

                const proxy = F.pipe(
                    remote,
                    R.converge(R.mergeLeft, [
                        R.pick([ 'host', 'port', 'protocol' ]),
                        R.o(R.pick([ 'type', 'algorithm' ]), R.prop('cipher')),
                    ]),
                    R.mergeLeft({ ping }),
                );

                logger.child({ proxy }).trace('Elapsed');

            }),

        )),

        TE.mapLeft(R.tap(abort)),

        TE.chain(({ enc, socket, dec }) => hook(enc, socket, dec)),

    );

};





const timeoutError = new u.ErrorWithCode(
    'SERVER_SOCKET_TIMEOUT',
    'shadowsocks server timeout',
);

const race = u.raceTaskByTimeout(1000 * 5, timeoutError);

type ConnOpts = Pick<ShadowSocks, 'host' | 'port'>;

export const tunnel = (remote: ConnOpts) => u.bracket(

    TE.rightIO(() => netConnectTo(remote)),

    socket => race(u.tryCatchToError(async () => {

        await once(socket, 'connect');

        return socket;

    })),

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





export function EncryptAEAD (
        algorithm: AEAD,
        key: Buffer,
        keySize: number,
        nonceSize: number,
        tagSize: number,
        saltSize: number,
        head: Uint8Array,
) {

    const salt = crypto.randomBytes(saltSize);
    const subKey = u.HKDF_SHA1(key, salt, keySize);

    const pack = F.flow(
        S.gets(F.flow(
            A.size as never as u.Fn<Uint8Array, number>,
            u.numberToUInt16BE,
        )),
        A.map(genAEADEncrypt(algorithm, subKey, nonceSize, tagSize)),
    );

    const init = R.tap((readable: Transform) => {

        readable.push(F.pipe(
            pack(head),
            A.prepend(salt),
            Buffer.concat,
        ));

    });

    return init(new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

            u.run(F.pipe(
                chop(chunk),
                A.chain(pack),
                IO.traverseArray(data => () => this.push(data)),
                IO.apSecond(cb),
            ));

        },

    }));

}

const chop = u.chunksOf(0x3FFF);

function genAEADEncrypt (
        algorithm: AEAD,
        subKey: Uint8Array,
        nonceSize: number,
        authTagLength: number,
) {

    const ref = u.run(Ref.newIORef(new Uint8Array(nonceSize)));

    return function (chunk: Uint8Array) {

        const cipher = crypto.createCipheriv(
            algorithm as crypto.CipherGCMTypes,
            subKey,
            ref.read(),
            { authTagLength },
        );

        u.run(ref.modify(u.incrementLE2));

        return Buffer.concat([
            cipher.update(chunk),
            cipher.final(),
            cipher.getAuthTag(),
        ]);

    };

}





export function DecryptAEAD (
        algorithm: AEAD,
        key: Buffer,
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
        key: Buffer,
        keySize: number,
        nonceSize: number,
        authTagLength: number,
        salt: Buffer,
) {

    const subKey = u.HKDF_SHA1(key, salt, keySize);

    const ref = u.run(Ref.newIORef(new Uint8Array(nonceSize)));

    return function ([ data, tag ]: [ Uint8Array, Uint8Array ]) {

        const decipher = crypto.createDecipheriv(
            algorithm as crypto.CipherCCMTypes,
            subKey,
            ref.read(),
            { authTagLength },
        );

        decipher.setAuthTag(tag);

        u.run(ref.modify(u.incrementLE2));

        return Buffer.concat([ decipher.update(data), decipher.final() ]);

    };

}





export function EncryptStream (
        algorithm: Stream,
        key: Uint8Array,
        ivLength: number,
        initBuffer: Uint8Array,
) {

    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const init = R.tap((readable: Transform) => {
        readable.push(iv);
        readable.push(cipher.update(initBuffer));
    });

    return init(new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {
            cb(u.Undefined, cipher.update(chunk));
        },

    }));

}





export function DecryptStream (
        alg: Stream,
        key: Uint8Array,
        ivLength: number,
) {

    type State = E.Either<Uint8Array, crypto.Decipher>;

    const ref = u.run(Ref.newIORef<State>(E.left(Uint8Array.of())));

    return new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

            const push = IoE.tryCatchK(R.unary(F.flip(cb)), E.toError);

            u.run(F.pipe(
                ref.read,
                IoE.chainFirstIOK(decipher => push(decipher.update(chunk))),
                IoE.mapLeft(data => Buffer.concat([ data, chunk ])),
                IoE.swap,
                IoE.chainFirstIOK(data => {

                    if (data.length < ivLength) {
                        return F.pipe(
                            ref.write(E.left(data)),
                            IO.apFirst(cb),
                        );
                    }

                    const [ iv, remain ] = u.split ({ at: ivLength }) (data);

                    const decipher = crypto.createDecipheriv(alg, key, iv);

                    return F.pipe(
                        ref.write(E.right(decipher)),
                        IO.apFirst(push(decipher.update(remain))),
                    );

                }),
            ));

        },

    });

}

