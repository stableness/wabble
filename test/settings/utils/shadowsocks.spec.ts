import {
    describe, test, expect,
} from '@jest/globals';

import { URL } from 'url';

import { base64url } from 'rfc4648';

import {
    option as O,
    function as F,
    reader as Rd,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import * as R from 'ramda';

import {
    readBasic,
    readAlgKey,
} from '../../../src/settings/utils/shadowsocks.js';

import * as u from '../../../src/utils/index.js';





describe('readBasic', () => {

    const _____ = 'x';

    test.each([

        [ 'foo:bar', 'foo', 'bar' ],
        [     'foo', _____, 'foo' ],
        [    'foo:', _____, 'foo' ],
        [    ':bar', _____, 'bar' ],
        [        '', _____, _____ ],

    ])('%s', (raw, ur, ps) => {

        const or = O.getOrElse(F.constant(_____));

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { user, pass } = readBasic([ username, password ]);

        expect(or(user)).toBe(ur);
        expect(or(pass)).toBe(ps);

    });

});





describe('readAlgKey', () => {

    const _____ = 'x';

    const mk = F.pipe(
        Rd.sequenceArray<Uint8Array, string>([
            b => base64url.stringify(b),
            b => base64url.stringify(b, { pad: false }),
            b => Buffer.from(b).toString('base64url'),
        ]),
        Rd.local(u.stringToBuffer),
        Rd.chain(F.flip(A.prepend)),
        Rd.local(([ x ]: NA.ReadonlyNonEmptyArray<string>) => x),
        Rd.chain(arr => ([ _, ...xs ]) => F.pipe(
            arr,
            A.map(F.flip (A.prepend) (xs)),
        )),
    );

    test.each(A.flatten<ReadonlyArray<string>>([

        mk([ 'foo:bar', 'foo', 'bar' ]),
        mk([ 'foo',     _____, 'foo' ]),
        mk([ 'foo:',    _____, 'foo' ]),
        mk([ ':bar',    _____, 'bar' ]),
        mk([ '',        _____, _____ ]),

    ]))('%s', (raw, ur, ps) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    });

    test.each(A.flatten<ReadonlyArray<string>>([

        mk([ 'foo:bar', 'alg', 'bar', 'alg' ]),
        mk([ 'foo',     'alg', 'foo', 'alg' ]),
        mk([ 'foo:',    'alg', 'foo', 'alg' ]),
        mk([ ':bar',    'alg', 'bar', 'alg' ]),
        mk([ '',        'alg', _____, 'alg' ]),

    ]))('%s', (raw, ur, ps, alg_) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password, alg: alg_ });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    });

    test.each(A.flatten<ReadonlyArray<string>>([

        mk([ 'foo:bar', 'foo', 'key', 'key' ]),
        mk([ 'foo',     _____, 'key', 'key' ]),
        mk([ 'foo:',    _____, 'key', 'key' ]),
        mk([ ':bar',    _____, 'key', 'key' ]),
        mk([ '',        _____, 'key', 'key' ]),

    ]))('%s', (raw, ur, ps, key_) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password, key: key_ });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    });

    test.each([

        [   'cmM0LW1kNTpwYXNzd2Q',
            'rc4-md5', 'passwd',
        ],

        [   'YWVzLTEyOC1nY206dGVzdA',
            'aes-128-gcm', 'test',
        ],
        [   'YWVzLTEyOC1nY206dGVzdA=',
            'aes-128-gcm', 'test',
        ],

        [   'YWVzLTEyOC1nY206c2hhZG93c29ja3M',
            'aes-128-gcm', 'shadowsocks',
        ],
        [   'YWVzLTEyOC1nY206c2hhZG93c29ja3M=',
            'aes-128-gcm', 'shadowsocks',
        ],

        [   'Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpHIXlCd1BXSDNWYW8=',
            'chacha20-ietf-poly1305', 'G!yBwPWH3Vao',
        ],
        [   'Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpHIXlCd1BXSDNWYW8',
            'chacha20-ietf-poly1305', 'G!yBwPWH3Vao',
        ],

    ])('base64 auth - %s', (raw, user, pass) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@foobar`);

        const { alg, key } = readAlgKey({ username, password });

        expect(or(alg)).toBe(user);
        expect(or(key)).toBe(pass);

    });

});

