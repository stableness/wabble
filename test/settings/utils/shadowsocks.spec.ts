import {
    describe, test, expect,
} from '@jest/globals';

import { URL } from 'url';

import { base64url } from 'rfc4648';

import {
    option as O,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import {
    readBasic,
    readAlgKey,
} from '../../../src/settings/utils/shadowsocks.js';





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

    const a = F.identity;

    const b = F.flow(
        Buffer.from,
        base64url.stringify,
        Buffer.from,
        R.toString,
    );

    type CB = F.FunctionN<[ string, string, string, string ], void>;

    test.each([

        [ a('foo:bar'), 'foo', 'bar' ],
        [ b('foo:bar'), 'foo', 'bar' ],

        [ a('foo'), _____, 'foo' ],
        [ b('foo'), _____, 'foo' ],

        [ a('foo:'), _____, 'foo' ],
        [ b('foo:'), _____, 'foo' ],

        [ a(':bar'), _____, 'bar' ],
        [ b(':bar'), _____, 'bar' ],

        [ a(''), _____, _____ ],
        [ b(''), _____, _____ ],

    ])('%s', ((raw, ur, ps) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    }) as CB);

    test.each([

        [ a('foo:bar'), 'alg', 'bar', 'alg' ],
        [ b('foo:bar'), 'alg', 'bar', 'alg' ],

        [ a('foo'), 'alg', 'foo', 'alg' ],
        [ b('foo'), 'alg', 'foo', 'alg' ],

        [ a('foo:'), 'alg', 'foo', 'alg' ],
        [ b('foo:'), 'alg', 'foo', 'alg' ],

        [ a(':bar'), 'alg', 'bar', 'alg' ],
        [ b(':bar'), 'alg', 'bar', 'alg' ],

        [ a(''), 'alg', _____, 'alg' ],
        [ b(''), 'alg', _____, 'alg' ],

    ])('%s', ((raw, ur, ps, alg_) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password, alg: alg_ });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    }) as CB);

    test.each([

        [ a('foo:bar'), 'foo', 'key', 'key' ],
        [ b('foo:bar'), 'foo', 'key', 'key' ],

        [ a('foo'), _____, 'key', 'key' ],
        [ b('foo'), _____, 'key', 'key' ],

        [ a('foo:'), _____, 'key', 'key' ],
        [ b('foo:'), _____, 'key', 'key' ],

        [ a(':bar'), _____, 'key', 'key' ],
        [ b(':bar'), _____, 'key', 'key' ],

        [ a(''), _____, 'key', 'key' ],
        [ b(''), _____, 'key', 'key' ],

    ])('%s', ((raw, ur, ps, key_) => {

        const or = R.defaultTo(_____);

        const { username, password } = new URL(`http://${ raw }@localhost.com`);

        const { alg, key } = readAlgKey({ username, password, key: key_ });

        expect(or(alg)).toBe(ur);
        expect(or(key)).toBe(ps);

    }) as CB);

});

