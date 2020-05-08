import * as R from 'ramda';

import { EVP_BytesToKey, Fn } from '../utils';





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



    const trim = R.o(
        R.evolve({
            alg: alias,
        }),
        // @ts-ignore
        R.mergeRight({
            alg: 'chacha20-ietf-poly1305',
            key: '',
        }),
    ) as unknown as Fn<object, { key: string, alg: string }>;



    const bytesToKey = R.curry(EVP_BytesToKey);



    export function parse (obj: object) {

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

                const [ keySize, saltSize, nonceSize, tagSize ] = AEAD[algorithm];

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

