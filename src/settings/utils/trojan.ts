import * as R from 'ramda';

import {
    function as F,
} from 'fp-ts';

import * as Dc from 'io-ts/lib/Decoder.js';

import * as u from '../../utils/index.js';





const list = u.str2arr;





const ALPN = list(`
    h2
    http/1.1
`);

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





const codec = Dc.struct({

    password: u.readTrimmedNonEmptyString,

    ssl: F.pipe(

        Dc.struct({

            verify: Dc.boolean,
            verify_hostname: Dc.boolean,
            alpn: u.readTrimmedNonEmptyStringArr,
            cipher: u.readTrimmedNonEmptyStringArr,
            cipher_tls13: u.readTrimmedNonEmptyStringArr,

        }),

        Dc.intersect(Dc.partial({

            sni: u.readTrimmedNonEmptyString,

        })),

        Dc.map(({ cipher, cipher_tls13, ...rest }) => ({

            ...rest,

            ciphers: F.pipe(
                R.concat(cipher, cipher_tls13),
                R.filter(Boolean),
                R.join(':'),
            ),

        })),

    ),

});





export const parse = F.flow(

    R.evolve({

        ssl: R.mergeRight({

            verify: true,
            verify_hostname: true,
            sni: void 0,
            alpn: ALPN,
            cipher: CIPHER,
            cipher_tls13: CIPHER_TLS13,

        }),

    }),

    codec.decode,

);

