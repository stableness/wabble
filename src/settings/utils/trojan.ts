import * as R from 'ramda';

import {
    option as O,
    function as F,
    array as A,
    nonEmptyArray as NEA,
} from 'fp-ts';

import { Fn, readOptionalString } from '../../utils';





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

