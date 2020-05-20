import crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';

import * as R from 'ramda';

import {
    either as E,
    io as IO,
    taskEither as TE,
    pipeable as P,
} from 'fp-ts';

import { toTransform } from 'buffer-pond';

import { logLevel } from '../model';
import type { ShadowSocks as SS } from '../config';
import * as u from '../utils';
import type { ShadowSocks } from '../settings/utils';

import { ChainOpts, netConnectTo } from './index';






export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: SS) {

    return P.pipe(

        IO.of(u.socks5Handshake(ipOrHost, port).subarray(3)),
        IO.map(knock => cryptoPairs(remote, knock)),
        IO.map(E.fromNullable(Error('Has no crypto to perform'))),

        TE.fromIOEither,

        TE.map(R.tap(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.converge(R.mergeLeft, [
                R.pick([ 'host', 'port', 'protocol' ]),
                R.o(R.pick([ 'type', 'algorithm' ]), R.prop('cipher')),
            ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through ss')
            ;

        })),

        TE.chain(({ enc, dec }) => u.tryCatchToError(() => {
            return hook(enc, netConnectTo(remote), dec);
        })),

        TE.mapLeft(R.tap(() => hook())),

    );

}





export function cryptoPairs (server: SS, head: Uint8Array) {

    type RWS = NodeJS.ReadWriteStream;

    const { key, cipher } = server;

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
            enc: EncryptAEAD(algorithm, key, keySize, nonceSize, tagSize, saltSize, head) as RWS,
            dec: DecryptAEAD(algorithm, key, keySize, nonceSize, tagSize, saltSize) as RWS,
        };

    }

    return undefined;

}





export function EncryptAEAD (
        algorithm: ShadowSocks.CipherType['AEAD'],
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

    const MAX = 0x3FFF;

    return init(new Transform({

        async transform (chunk: Buffer, _enc: string, cb: TransformCallback) {

            if (chunk.length <= MAX) {
                return cb(undefined, pack(chunk));
            }

            for await (const slice of u.chop(MAX, chunk)) {
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
        algorithm: ShadowSocks.CipherType['AEAD'],
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

        const cipherText = Buffer.concat([ cipher.update(chunk), cipher.final() ]);
        const authTag = cipher.getAuthTag();

        u.incrementLE(nonce);

        return Buffer.concat([ cipherText, authTag ]);

    };

}





export function DecryptAEAD (
        algorithm: ShadowSocks.CipherType['AEAD'],
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

            const sizing = await read(2 + tagSize);
            const lengthBuffer = decrypt(sizing.subarray(0, 2), sizing.subarray(2));

            const length = lengthBuffer.readUInt16BE(0);

            const data = await read(length + tagSize);
            const plainText = decrypt(data.subarray(0, length), data.subarray(length));

            yield plainText;

        }

    })({ objectMode: false });

}

function genAEADDecrypt (
        algorithm: ShadowSocks.CipherType['AEAD'],
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
        algorithm: ShadowSocks.CipherType['Stream'],
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
        algorithm: ShadowSocks.CipherType['Stream'],
        key: Buffer,
        ivLength: number,
) {

    let prevChunk = Buffer.alloc(0);
    let decipher: crypto.Decipher | undefined;

    return new Transform({

        transform (chunk: Buffer, _enc: string, cb: TransformCallback) {

            if (decipher == null) {

                if (prevChunk.length > 0) {
                    chunk = Buffer.concat([ prevChunk, chunk ]);
                }

                if (chunk.length < ivLength) {
                    prevChunk = chunk;
                    return cb();
                }

                decipher = crypto.createDecipheriv(algorithm, key, chunk.subarray(0, ivLength));

                if (chunk.length === ivLength) {
                    return cb();
                }

                chunk = chunk.subarray(ivLength);

            }

            cb(undefined, decipher.update(chunk));

        },

    });

}

