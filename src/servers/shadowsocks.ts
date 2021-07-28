import crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';

import * as R from 'ramda';

import {
    either as E,
    ioRef as Ref,
    state as S,
    readonlyArray as A,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { toTransform } from 'buffer-pond';

import { logLevel } from '../model.js';
import type { ShadowSocks } from '../config.js';
import * as u from '../utils/index.js';

import type { AEAD, Stream } from '../settings/utils/shadowsocks.js';

import { netConnectTo, RTE_O_E_V } from './index.js';





export const chain: u.Fn<ShadowSocks, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => u.socks5Handshake(host, port).subarray(3)),
        TE.chainEitherK(cryptoPairsCE(remote)),

        TE.mapLeft(R.tap(abort)),

        TE.apFirst(TE.fromIO(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.converge(R.mergeLeft, [
                R.pick([ 'host', 'port', 'protocol' ]),
                R.o(R.pick([ 'type', 'algorithm' ]), R.prop('cipher')),
            ]);

            logger
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                .child({ proxy: merge(remote) })
                .trace('proxy through ss')
            ;

        })),

        TE.chain(({ enc, dec }) => hook(enc, netConnectTo(remote), dec)),

    );

};





export const cryptoPairsC =
    (server: ShadowSocks) =>
        (head: Uint8Array) =>
            cryptoPairs(server, head)
;

export const cryptoPairsCE = F.flow(
    cryptoPairsC,
    E.fromNullableK(new Error('Has no crypto to perform')),
);

export function cryptoPairs (server: ShadowSocks, head: Uint8Array) {

    type RWS = NodeJS.ReadWriteStream;

    const { key, cipher } = server;

    if (cipher.type === 'Stream') {

        const { algorithm, ivLength } = cipher;

        return {
            enc: EncryptStream(algorithm, key, ivLength, head) as RWS,
            dec: DecryptStream(algorithm, key, ivLength) as RWS,
        };

    }

    if (cipher.type === 'AEAD' as string) {

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

    return u.Undefined;

}





export function EncryptAEAD (
        algorithm: AEAD,
        key: Buffer,
        keySize: number,
        nonceSize: number,
        tagSize: number,
        saltSize: number,
        head = Uint8Array.of(),
) {

    const salt = crypto.randomBytes(saltSize);
    const subKey = u.HKDF_SHA1(key, salt, keySize);

    const pack = F.flow(
        S.gets(F.flow(
            A.size as never as u.Fn<Uint8Array, number>,
            u.numberToUInt16BE,
        )),
        A.chain(genAEADEncrypt(algorithm, subKey, nonceSize, tagSize)),
    );

    const init = R.tap((readable: Transform) => {
        readable.push(salt);
        readable.push(Buffer.concat(pack(head)));
    });

    return init(new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

            cb(u.Undefined, F.pipe(
                chop(chunk),
                A.chain(pack),
                Buffer.concat,
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

    const nonce = new Uint8Array(nonceSize);

    return function (chunk: Uint8Array) {

        const cipher = crypto.createCipheriv(
            algorithm as crypto.CipherGCMTypes,
            subKey,
            nonce,
            { authTagLength },
        );

        u.incrementLE(nonce);

        return [
            cipher.update(chunk),
            cipher.final(),
            cipher.getAuthTag(),
        ] as const;

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
    const nonce = new Uint8Array(nonceSize);

    return function ([ data, tag ]: [ Uint8Array, Uint8Array ]) {

        const decipher = crypto.createDecipheriv(
            algorithm as crypto.CipherCCMTypes,
            subKey,
            nonce,
            { authTagLength },
        );

        decipher.setAuthTag(tag);

        u.incrementLE(nonce);

        return Buffer.concat([ decipher.update(data), decipher.final() ]);

    };

}





export function EncryptStream (
        algorithm: Stream,
        key: Uint8Array,
        ivLength: number,
        initBuffer = Uint8Array.of(),
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
        algorithm: Stream,
        key: Uint8Array,
        ivLength: number,
) {

    type State = ReturnType<typeof read>;

    const { read, write } = u.run(Ref.newIORef({
        remain: Uint8Array.of(),
        decipher: u.Undefined as crypto.Decipher | undefined,
    }));

    const mixin = (chunk: Uint8Array) => (state: State) => {

        const { decipher, remain: prev } = state;

        const remain = prev.length > 0
            ? Buffer.concat([ prev, chunk ])
            : chunk
        ;

        if (decipher || remain.length < ivLength) {
            return { decipher, remain };
        }

        return {

            reset: remain.length > ivLength,

            remain: remain.subarray(ivLength),

            decipher: crypto.createDecipheriv(
                algorithm, key, remain.subarray(0, ivLength),
            ),

        };

    };

    return new Transform({

        transform (chunk: Uint8Array, _enc: string, cb: TransformCallback) {

            const { decipher, remain, reset } = mixin (chunk) (read());

            if (decipher == null) {

                u.run(write({ decipher, remain }));

            } else {

                this.push(decipher.update(remain));

                if (reset === true) {
                    u.run(write({
                        decipher,
                        remain: Uint8Array.of(),
                    }));
                }

            }

            cb();

        },

    });

}

