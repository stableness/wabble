import crypto from 'crypto';
import { Transform, TransformCallback, Readable } from 'stream';

import * as R from 'ramda';

import {
    either as E,
    io as IO,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { toTransform } from 'buffer-pond';

import { logLevel } from '../model';
import type { ShadowSocks } from '../config';
import * as u from '../utils/index';

import type { AEAD, Stream } from '../settings/utils/shadowsocks';

import { netConnectTo, RTE_O_E_V } from './index';





export const chain: u.Fn<ShadowSocks, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        IO.fromIO(() => u.socks5Handshake(host, port).subarray(3)),
        IO.map(cryptoPairsC(remote)),
        IO.map(E.fromNullable(Error('Has no crypto to perform'))),

        TE.fromIOEither,

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

    return undefined;

}





const MAX = 0x3FFF;
const chop = u.chunksOf(MAX);

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

    const encrypt = genAEADEncrypt(
        algorithm,
        subKey,
        nonceSize,
        tagSize,
    );

    const init = R.tap((readable: Transform) => {
        readable.push(Buffer.concat([ salt, pack(head) ]));
    });

    return init(new Transform({

        transform (
                this: Readable,
                chunk: Buffer,
                _enc: string,
                cb: TransformCallback,
        ) {

            if (chunk.length <= MAX) {
                return cb(undefined, pack(chunk));
            }

            for (const slice of chop(chunk)) {
                this.push(pack(slice));
            }

            cb();

        },

    }));



    function pack (chunk: Uint8Array) {

        if (chunk.length < 1) {
            return Buffer.alloc(0);
        }

        return Buffer.concat([
            encrypt(u.numberToUInt16BE(chunk.length)),
            encrypt(chunk),
        ]);

    }

}

function genAEADEncrypt (
        algorithm: AEAD,
        subKey: Buffer,
        nonceSize: number,
        authTagLength: number,
) {

    const nonce = Buffer.alloc(nonceSize);

    return function (chunk: Uint8Array) {

        const cipher = crypto.createCipheriv(
            algorithm as crypto.CipherGCMTypes,
            subKey,
            nonce,
            { authTagLength },
        );

        const _4 = cipher.update(chunk);
        const _5 = cipher.final();
        const _1 = cipher.getAuthTag();

        u.incrementLE(nonce);

        return Buffer.concat([ _4, _5, _1 ]);

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

    return toTransform(async function* ({ read }) {

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
            const buffer = decrypt(...u.splitAt2(await read(2 + tagSize)));
            const length = buffer.readUInt16BE(0);

            const slice = u.split({ at: length });

            // eslint-disable-next-line no-await-in-loop
            yield decrypt(...slice(await read(length + tagSize)));

        }

    })({ objectMode: false });

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
    const nonce = Buffer.alloc(nonceSize);

    return function (data: Buffer, tag: Buffer) {

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
        key: Buffer,
        ivLength: number,
        initBuffer = Uint8Array.of(),
) {

    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const init = R.tap((readable: Transform) => {
        readable.push(Buffer.concat([ iv, cipher.update(initBuffer) ]));
    });

    return init(new Transform({

        transform (chunk: Buffer, _enc: string, cb: TransformCallback) {
            cb(undefined, cipher.update(chunk));
        },

    }));

}





export function DecryptStream (
        algorithm: Stream,
        key: Buffer,
        ivLength: number,
) {

    let prevChunk = Buffer.alloc(0);
    let decipher: crypto.Decipher | undefined;

    return new Transform({

        transform (chunk: Buffer, _enc: string, cb: TransformCallback) {

            let buffer = chunk;

            if (decipher == null) {

                if (prevChunk.length > 0) {
                    buffer = Buffer.concat([ prevChunk, buffer ]);
                }

                if (buffer.length < ivLength) {
                    prevChunk = buffer;
                    return cb();
                }

                decipher = crypto.createDecipheriv(
                    algorithm, key, buffer.subarray(0, ivLength),
                );

                if (buffer.length === ivLength) {
                    return cb();
                }

                buffer = buffer.subarray(ivLength);

            }

            cb(undefined, decipher.update(buffer));

        },

    });

}

