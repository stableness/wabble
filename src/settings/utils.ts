import * as R from 'ramda';

import {
    option as O,
    function as F,
    array as A,
    nonEmptyArray as NEA,
} from 'fp-ts';

import { EVP_BytesToKey, Fn, readOptionalString } from '../utils';





export namespace ShadowSocks {

    export interface CipherType {
        Stream: keyof typeof cipher.Stream;
        AEAD: keyof typeof cipher.AEAD;
    }



    const cipher = {

        Stream: {
            // algorithm: [ key, iv ]
            'chacha20':         [ 32, 12 ],
            'aes-128-ctr':      [ 16, 16 ],
            'aes-192-ctr':      [ 24, 16 ],
            'aes-256-ctr':      [ 32, 16 ],
            'aes-128-cfb':      [ 16, 16 ],
            'aes-192-cfb':      [ 24, 16 ],
            'aes-256-cfb':      [ 32, 16 ],
            'camellia-128-cfb': [ 16, 16 ],
            'camellia-192-cfb': [ 24, 16 ],
            'camellia-256-cfb': [ 32, 16 ],
        },

        AEAD: {
            // algorithm: [ key, salt, nonce, tag ]
            'aes-128-gcm':       [ 16, 16, 12, 16 ],
            'aes-192-gcm':       [ 24, 24, 12, 16 ],
            'aes-256-gcm':       [ 32, 32, 12, 16 ],
            'chacha20-poly1305': [ 32, 32, 12, 16 ],
        },

    } as const;



    const alias = R.cond([
        [ R.equals('chacha20-ietf-poly1305'), R.always('chacha20-poly1305') ],
        [ R.equals('chacha20-ietf'),          R.always('chacha20') ],
        [ R.T,                                R.identity ],
    ]) as Fn<string>;



    const trim: Fn<Record<string, unknown>, { key: string, alg: string }> = R.o(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        R.evolve({
            alg: alias,
        }),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        R.mergeRight({
            alg: 'chacha20-ietf-poly1305',
            key: '',
        }),
    );



    const bytesToKey = R.curry(EVP_BytesToKey);



    export function parse (obj: Record<string, unknown>) {

        const { key, alg } = trim(obj);
        const divideBy = bytesToKey(key);

        if (key.length > 0) {

            const { Stream, AEAD } = cipher;

            if (alg in Stream) {

                const algorithm = alg as CipherType['Stream'];

                const [ keySize, ivLength ] = Stream[algorithm];

                return {
                    key: divideBy(keySize),
                    cipher: {
                        type: 'Stream',
                        algorithm,
                        keySize,
                        ivLength,
                    },
                } as const;

            }

            if (alg in AEAD) {

                const algorithm = alg as CipherType['AEAD'];

                const [
                    keySize,
                    saltSize,
                    nonceSize,
                    tagSize,
                ] = AEAD[algorithm];

                return {
                    key: divideBy(keySize),
                    cipher: {
                        type: 'AEAD',
                        algorithm,
                        keySize,
                        saltSize,
                        nonceSize,
                        tagSize,
                    },
                } as const;

            }

        }

        return undefined;

    }

}





export namespace Trojan {

    const list = R.o(R.split(/\s+/), R.trim);

    const CIPHER = list(`
        ECDHE-ECDSA-AES256-GCM-SHA384
        ECDHE-ECDSA-CHACHA20-POLY1305
        ECDHE-RSA-AES256-GCM-SHA384
        ECDHE-RSA-CHACHA20-POLY1305
        ECDHE-ECDSA-AES256-SHA
        ECDHE-RSA-AES256-SHA
        DHE-RSA-AES256-SHA
        AES256-SHA
    `);

    const CIPHER_TLS13 = list(`
        TLS_AES_128_GCM_SHA256
        TLS_CHACHA20_POLY1305_SHA256
        TLS_AES_256_GCM_SHA384
    `);



    export function parse (obj: Record<string, unknown>) {

        const {
            ssl = {},
            password = '',
        } = obj as Record<'ssl' | 'password', never>;

        const sslProp = R.prop(R.__, ssl) as Fn<string, never>;

        const verify = gets('verify', true);
        const verify_hostname = gets('verify_hostname', true);
        const sni = gets('sni', undefined);

        const alpn = F.pipe(
            gets('alpn', [ 'h2', 'http/1.1' ]),
            A.map(readOptionalString),
            A.compact,
            NEA.fromArray,
            O.toUndefined,
        );

        const ciphers = F.pipe(
            A.flatten([
                gets('cipher', CIPHER),
                gets('cipher_tls13', CIPHER_TLS13),
            ]),
            A.map(readOptionalString),
            A.compact,
            NEA.fromArray,
            O.map(R.join(':')),
            O.toUndefined,
        );



        return {
            password,
            ssl: { verify, verify_hostname, sni, alpn, ciphers },
        };



        function gets <T> (key: string, val: T) {
            return F.pipe(
                sslProp(key),
                O.fromNullable,
                O.getOrElse(F.constant(val)),
            );
        }

    }

}

