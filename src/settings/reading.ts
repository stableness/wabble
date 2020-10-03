import { URL } from 'url';
import { AssertionError } from 'assert';

import * as R from 'ramda';

import { eq as Eq, option as O, function as F } from 'fp-ts';

import * as Dc from 'io-ts/Decoder';

import type { Config, Basic, Remote } from '../config';

import { Fn, readOptionalString, portNormalize, readTrimmedNonEmptyString } from '../utils';

import { ShadowSocks, Trojan } from './utils';





export function convert (obj: unknown): Config {

    assertObject(obj);

    const raw = obj as Record<'services' | 'doh' | 'servers' | 'rules' | 'tags', unknown>;

    assertBaseArray(raw.servers);
    assertBaseArray(raw.services);

    const services = R.map(({ uri }) => {

        const { protocol, port, hostname, username, password } = new URL(uri);
        const proto = R.init(protocol);

        const { equals: eqBasic } = Eq.getStructEq<Basic>({
            password: Eq.eqString,
            username: Eq.eqString,
        });

        const justAuth = O.some(R.curry(eqBasic)({ username, password }));

        const auth = F.pipe(
            justAuth,
            O.chain(auth => auth({ username: '', password: '' }) ? O.none : justAuth),
        );

        if (proto === 'socks5' || proto === 'http') {
            if (hostname.length > 0) {

                return {
                    auth,
                    port: R.subtract(+port, +(process.env.DEV_PORT_MINUS || 0)),
                    host: hostname,
                    protocol: proto as typeof proto,
                };

            }
        }

        fail('invalid service');

    }, raw.services);

    const servers = filterTags(raw.tags, raw.servers.map(server => {

        const { uri, tags } = { tags: [], ...server };

        const url = new URL(uri);

        const { protocol, hostname, username, password } = url;
        const port = portNormalize(url);
        const proto = R.init(protocol);

        const baseWith = R.mergeLeft({
            host: hostname,
            port: +port,
            tags: new Set([ ...tags, proto ]),
        });

        if (proto === 'ss') {

            const config = ShadowSocks.parse(server);

            if (config) {
                return baseWith({ ...config, protocol: proto } as const);
            }

        }

        if (proto === 'trojan') {

            const config = Trojan.parse(server);

            if (config) {
                return baseWith({ ...config, protocol: proto } as const);
            }

        }

        if (proto === 'socks5') {

            const auth = username === password && password === ''
                ? O.none
                : O.some({ username, password })
            ;

            return baseWith({ protocol: proto, auth } as const);

        }

        if (proto === 'http' || proto === 'https') {

            const verify = R.pathOr(true, [ 'ssl', 'verify' ], server);

            const auth = username === password && password === ''
                ? O.none
                : O.some(R.join(':', [ username, password ]))
            ;

            return baseWith({ protocol: proto, ssl: { verify }, auth } as const);

        }

        fail('invalid server');

    }));

    const rules = (function (raw: unknown) {

        type Rules = Partial<Config['rules']>;
        const obj = R.defaultTo({}, raw) as Rules;

        const { direct = [], reject = [], proxy = [] } = obj;

        return { direct, reject, proxy };

    }(raw.rules));

    const sieve = {
        direct: readOptionalString(R.path([ 'sieve', 'direct' ], raw)),
        reject: readOptionalString(R.path([ 'sieve', 'reject' ], raw)),
    };

    const doh = O.fromEither(decodeDoH.decode(raw.doh));

    return { services, doh, servers, rules, sieve } as const;

}





export const CF_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query' as HttpOrHttps;

export type HttpOrHttps = string & { readonly HttpOrHttps: unique symbol };

export const trimmedStartsWithHttpOrHttps = F.pipe(
    readTrimmedNonEmptyString,
    Dc.refine(
        R.either(
            R.startsWith('http://'),
            R.startsWith('https://'),
        ) as (str: string) => str is HttpOrHttps,
        'HttpOrHttps',
    ),
);

export const flagOnToCloudFlare = F.pipe(
    Dc.boolean,
    Dc.parse(on => on ? Dc.success(CF_DOH_ENDPOINT) : Dc.failure(on, 'off')),
);

export const decodeDoH = Dc.union(
    flagOnToCloudFlare,
    trimmedStartsWithHttpOrHttps,
);





type TagsOnlyRemote = Partial<Remote> & Pick<Remote, 'tags'>;

export function filterTags <T extends TagsOnlyRemote> (tags: unknown, servers: T[]) {

    // tags
    const t = R.o(
        R.uniq,
        R.unless(R.is(Array), R.always([])),
    )(tags) as unknown as string[];

    if (t.length < 1) {
        return servers;
    }

    // Include
    const i = R.reject(R.startsWith('-'), t);

    // Exclude
    const e = R.map(R.tail as Fn<string>, R.symmetricDifference(i, t));

    // tags to array
    const t2a = R.o(
        Array.from,
        R.prop('tags') as () => T['tags'],
    ) as Fn<T, string[]>;

    const isSubset = R.o(
        R.isEmpty,
        R.difference(i),
    );

    const isExclude = R.o(
        R.isEmpty,
        R.intersection(e),
    );

    return R.filter(R.o(R.both(isSubset, isExclude), t2a), servers);

}





function fail (message = 'unknown'): never {
    throw new AssertionError({ message });
}





function assertObject (obj: unknown): asserts obj is object {

    if (obj == null) {
        fail('null or undefined');
    }

    if (typeof obj !== 'object') {
        fail('not object');
    }

}





export function assertBaseArray (obj: unknown): asserts obj is Base[] {

    if (!(obj instanceof Array) || obj == null) {
        fail('not array');
    }

    if (obj.length < 1) {
        fail('empty array');
    }

    for (const item of obj) {
        assertBase(item);
    }

}





interface Base {
    uri: string;
}

function assertBase (obj: unknown): asserts obj is Base {

    assertObject(obj);

    if (R.not('uri' in obj)) {
        fail('no uri');
    }

}

