import * as R from 'ramda';

import {
    either as E,
    option as O,
    function as F,
} from 'fp-ts';

import * as Dc from 'io-ts/Decoder';

import type { Config, Remote } from '../config';

import * as u from '../utils';

import * as Trojan from './utils/trojan';
import * as ShadowSocks from './utils/shadowsocks';





const baseURI = Dc.type({ uri: u.readURL });





export const CF_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query' as HttpOrHttps;

export type HttpOrHttps = string & { readonly HttpOrHttps: unique symbol };

export const trimmedStartsWithHttpOrHttps = F.pipe(
    u.readTrimmedNonEmptyString,
    Dc.refine(
        R.either(
            R.startsWith('http://'),
            R.startsWith('https://'),
        ) as (str: string) => str is HttpOrHttps,
        'HttpOrHttps',
    ),
);

const flagOnToCloudFlare = F.pipe(
    Dc.boolean,
    Dc.map(on => on ? CF_DOH_ENDPOINT : void 0),
);

export const decodeDoH = Dc.union(
    flagOnToCloudFlare,
    trimmedStartsWithHttpOrHttps,
);





const decodeServices = F.pipe(

    baseURI,

    Dc.parse(({ uri: { protocol, port, hostname, username, password } }) => {

        const proto = R.init(protocol);

        const auth = F.pipe(
            O.some(u.eqBasic({ username, password })),
            O.filter(test => test({ username: '', password: '' }) === false),
        );

        if (proto === 'socks5' || proto === 'http') {

            return Dc.success({
                auth,
                port: R.subtract(+port, +(process.env.DEV_PORT_MINUS ?? 0)),
                host: hostname,
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                protocol: proto as typeof proto,
            });

        }

        return Dc.failure(protocol, 'invalid service');

    }),

    u.decoderNonEmptyArrayOf,

);





const decodeServers = F.pipe(

    baseURI,

    Dc.intersect(Dc.partial({
        tags: u.readTrimmedNonEmptyStringArr,
        key: u.readTrimmedNonEmptyString,
        alg: u.readTrimmedNonEmptyString,
        password: u.readTrimmedNonEmptyString,
        ssl: Dc.UnknownRecord,
    })),

    Dc.parse(server => {

        const { uri, tags = [] } = server;

        const { protocol, hostname, username, password } = uri;
        const port = u.portNormalize(uri);
        const proto = R.init(protocol);

        const hasAuth = F.constant(R.not(u.eqBasic(
            { username, password },
            { username: '', password: '' },
        )));

        const baseWith = R.mergeLeft({
            host: hostname,
            port: +port,
            tags: new Set([ ...tags, proto ]),
        });

        let result;
        let error = 'invalid server';

        if (proto === 'ss') {

            const config = ShadowSocks.parse(server);

            if (config) {
                result = baseWith({ ...config, protocol: proto } as const);
            } else {
                error = 'non supported cipher';
            }

        }

        if (proto === 'trojan') {

            F.pipe(

                Trojan.parse({ ssl: {}, ...server }),

                E.mapLeft(Dc.draw),

                E.map(opt => baseWith({ ...opt, protocol: proto } as const)),

                E.fold(
                    msg => {
                        error = msg;
                    },
                    opt => {
                        result = opt;
                    },
                ),

            );

        }

        if (proto === 'socks5') {

            const auth = F.pipe(
                O.some({ username, password }),
                O.filter(hasAuth),
            );

            result = baseWith({ protocol: proto, auth } as const);

        }

        if (proto === 'http' || proto === 'https') {

            const verify = R.pathOr(true, [ 'ssl', 'verify' ], server);

            const auth = F.pipe(
                O.some(R.join(':', [ username, password ])),
                O.filter(hasAuth),
            );

            result = baseWith({
                protocol: proto,
                ssl: { verify },
                auth,
            } as const);

        }

        if (result != null) {
            return Dc.success(result);
        }

        return Dc.failure(uri, error);

    }),

    u.decoderNonEmptyArrayOf,

);





const decodeRules = Dc.type({
    proxy: u.readTrimmedNonEmptyStringArr,
    direct: u.readTrimmedNonEmptyStringArr,
    reject: u.readTrimmedNonEmptyStringArr,
});





export const decodeAPI = F.pipe(

    Dc.type({
        port: Dc.number,
    }),

    Dc.intersect(Dc.partial({
        cors: Dc.boolean,
        shared: Dc.boolean,
    })),

    Dc.map(({ port, cors = false, shared = false }) => ({
        shared,
        cors,
        host: shared ? '0.0.0.0' : '127.0.0.1',
        port: R.subtract(port, +(process.env.DEV_PORT_MINUS ?? 0)),
    })),

);





const { MAX_SAFE_INTEGER: MAX_INT } = Number;

export const decodeResolver = F.pipe(

    Dc.partial({

        ttl: Dc.partial({
            min: Dc.number,
            max: Dc.number,
        }),

        list: F.pipe(

            baseURI,

            Dc.parse(({ uri }) => {

                const proto = Dc.union(
                    Dc.literal('https'),
                    Dc.literal('udp'),
                    Dc.literal('tls'),
                );

                return F.pipe(

                    R.init(uri.protocol),

                    proto.decode,

                    E.fold(
                        () => Dc.failure(uri.protocol, 'invalid NS resolver'),
                        protocol => Dc.success({ uri, protocol }),
                    ),

                );

            }),

            u.decoderNonEmptyArrayOf,

        ),

    }),

    Dc.map(({ ttl, list }) => {

        return {

            ttl: F.pipe(
                O.fromNullable(ttl),
                O.map(opts => {

                    const min = R.max(0, opts.min ?? 0);
                    const max = R.clamp(min, MAX_INT, opts.max ?? MAX_INT);

                    const calc = R.clamp(min, max);

                    return { min, max, calc };

                }),
            ),

            list: O.fromNullable(list),

        };

    }),

);





export const { decode: decodeConfig } = F.pipe(

    Dc.type({

        servers: decodeServers,
        services: decodeServices,
        rules: decodeRules,

    }),

    Dc.intersect(Dc.partial({

        api: decodeAPI,
        doh: decodeDoH,
        tags: u.readTrimmedNonEmptyStringArr,

        sieve: Dc.partial({
            direct: u.readTrimmedNonEmptyString,
            reject: u.readTrimmedNonEmptyString,
        }),

    })),

);





export const convert: u.Fn<unknown, Config> = F.flow(

    decodeConfig,

    E.mapLeft(Dc.draw),

    E.map(({ services, doh, servers, rules, tags, sieve, api }) => ({

        rules,
        services,

        servers: filterTags(servers, tags),

        doh: O.fromNullable(doh),

        api: O.fromNullable(api),

        sieve: {
            direct: O.fromNullable(sieve?.direct),
            reject: O.fromNullable(sieve?.reject),
        },

    })),

    E.fold(
        e => { throw new Error(e) },
        F.identity,
    ),

);





type TagsOnlyRemote = Partial<Remote> & Pick<Remote, 'tags'>;

export function filterTags
<T extends TagsOnlyRemote> (servers: T[], tags?: string[]) {

    // tags
    const t = R.uniq(tags ?? []);

    if (t.length < 1) {
        return servers;
    }

    // Include
    const i = R.reject(R.startsWith('-'), t);

    // Exclude
    const e = R.map(R.tail as u.Fn<string>, R.symmetricDifference(i, t));

    // tags to array
    const t2a = R.o(
        Array.from,
        R.prop('tags') as () => T['tags'],
    ) as u.Fn<T, string[]>;

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




