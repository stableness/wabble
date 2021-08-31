import { TextDecoder as TD } from 'util';

import { base64url } from 'rfc4648';

import { bind } from 'proxy-bind';

import {
    struct,
    monoid as Md,
    semigroup as Sg,
    either as E,
    readonlyArray as A,
    reader as Rd,
    string as Str,
    option as O,
    function as F,
} from 'fp-ts';

import {
    function as stdF,
} from 'fp-ts-std';

import * as R from 'ramda';

import * as u from '../../utils/index.js';





export type Stream = keyof typeof cipher.Stream;
export type AEAD = keyof typeof cipher.AEAD;





export const DEFAULT_ALG = 'chacha20-poly1305';

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





const alias = stdF.guard ([
    [ R.equals('chacha20-ietf-poly1305'), R.always('chacha20-poly1305') ],
    [ R.equals('chacha20-ietf'),          R.always('chacha20') ],
]) (F.identity);





const bytesToKey = u.curry2(u.EVP_BytesToKey);

const firstOf = F.untupled(Md.concatAll(O.getMonoid<string>(Sg.first())));

const at = <T> (i: number) => (as: readonly T[]) => F.pipe(
    A.lookup(i, as),
    O.chain(u.readOptionalString),
);





export const readBasic = F.pipe(
    Rd.Do,
    Rd.apS('user', Rd.asks(at<string>(0))),
    Rd.apS('pass', Rd.asks(at<string>(1))),
    Rd.bind('both', ({ user, pass }) => Rd.of(F.pipe(
        O.Do,
        O.apS('ur', user),
        O.apS('ps', pass),
    ))),
    Rd.map(({ user, pass, both }) => ({
        user: F.pipe(
            both,
            O.map(({ ur }) => ur),
        ),
        pass: F.pipe(
            both,
            O.map(({ ps }) => ps),
            O.alt(() => user),
            O.alt(() => pass),
        ),
    })),
);




type OptStr = string | undefined;
type AlgKey = Record<'alg' | 'key', OptStr>;
type UserPass = Record<'username' | 'password', string>;

type Opts = Partial<AlgKey & UserPass>;

export function readAlgKey (opts: Opts): AlgKey {

    const { alg, key, username = '', password = '' } = opts;

    const userEscaped = decodeURIComponent(username);
    const passEscaped = decodeURIComponent(password);

    return F.pipe(
        u.readOptionalString(userEscaped),
        O.chain(O.tryCatchK(base64url.parse)),
        O.map(bind(new TD()).decode),
        O.chain(u.readOptionalString),
        O.map(Str.split(':')),
        O.getOrElseW(() => [ userEscaped, passEscaped ]),
        readBasic,
        ({ user, pass }) => ({
            alg: firstOf(
                u.readOptionalString(alg),
                user,
            ),
            key: firstOf(
                u.readOptionalString(key),
                pass,
                user,
            ),
        }),
        struct.evolve({
            alg: O.getOrElse<OptStr>(F.constUndefined),
            key: O.getOrElse<OptStr>(F.constUndefined),
        }),
    );

}





export const parse = E.tryCatchK((obj: Opts) => {

    const { key = '', alg: algOrigin } = readAlgKey(obj);
    const alg = alias(algOrigin ?? DEFAULT_ALG);
    const divideBy = bytesToKey(key);

    const { Stream, AEAD } = cipher;

    if (alg in Stream) {

        const algorithm = alg as Stream;

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

        const algorithm = alg as AEAD;

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

    throw new Error(`non supported alg [${ alg }]`);

}, E.toError);

