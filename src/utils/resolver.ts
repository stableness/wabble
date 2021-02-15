import { promises as pDNS } from 'dns';

import {
    either as E,
    taskEither as TE,
    function as F,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import { run, tryCatchToError } from './index';





interface Result_DoH_DoT {
    name: string;
    type: 'A' | 'AAAA';
    ttl: number;
    data: string;
}

interface Res_DoH_DoT {
    answers: Result_DoH_DoT[];
}



export type DoH_query = ReturnType<typeof genDoH>;

export function genDoH (endpoint: string, path = '@stableness/dohdec') {

    interface ResolverDoH {
        new(opts?: { url?: string, preferPost?: boolean }): this;
        lookup(name: string, opts?: { json?: boolean }): Promise<Res_DoH_DoT>;
    }

    const doh = run(tryCatchToError(async () => {
        const pkg = await import(path) as { DNSoverHTTPS: ResolverDoH };
        return new pkg.DNSoverHTTPS({ url: endpoint, preferPost: false });
    }));

    return (name: string) => F.pipe(

        () => doh,

        TE.chain(dns => {
            return tryCatchToError(() => {
                return dns.lookup(name, { json: false });
            });
        }),

        TE.chain(({ answers }) => F.pipe(
            RNEA.fromArray(answers),
            TE.fromOption(() => new Error('empty result')),
        )),

    );

}



type Conn = { hostname: string, port?: string };

export type DoT_query = ReturnType<typeof genDoT>;

export function genDoT (conn: Conn, path = '@stableness/dohdec') {

    type ConstructOpts = Partial<{
        host: string;
        port: number;
        verbose: boolean;
    }>;

    type LookupOpts = Partial<{
        decode: boolean;
        id: number;
    }>;

    interface ResolverDoT {
        new(opts?: ConstructOpts): this;
        lookup(name: string, opts?: LookupOpts): Promise<Res_DoH_DoT>;
    }

    const { hostname: host, port: portS = '' } = conn;

    const port = +portS || 853;

    const dot = run(tryCatchToError(async () => {
        const pkg = await import(path) as { DNSoverTLS: ResolverDoT };
        return new pkg.DNSoverTLS({ host, port });
    }));

    return (name: string, opts?: LookupOpts) => F.pipe(

        () => dot,

        TE.chain(dns => {
            return tryCatchToError(() => {
                return dns.lookup(name, opts);
            });
        }),

        TE.chain(({ answers }) => F.pipe(
            RNEA.fromArray(answers),
            TE.fromOption(() => new Error('empty result')),
        )),

    );

}





export type DNS_query = ReturnType<typeof genDNS>;

export function genDNS (servers: string | readonly string[]) {

    const arr = typeof servers === 'string' ? [ servers ] : servers;

    const setServers = F.pipe(

        RNEA.fromReadonlyArray(arr),
        E.fromOption(() => new Error('empty resolver')),
        E.chain(list => E.tryCatch(() => {

            const resolver = new pDNS.Resolver();
            resolver.setServers(list);

            return resolver;

        }, E.toError)),

    );

    return (name: string) => F.pipe(

        TE.fromEither(setServers),
        TE.chain(resolve4(name)),

    );

}

export const resolve4 = (name: string) => (resolver: pDNS.Resolver) => F.pipe(

    tryCatchToError(() => {
        return resolver.resolve4(name, { ttl: true });
    }),

    TE.chain(F.flow(
        RNEA.fromArray,
        TE.fromOption(() => new Error('empty result')),
    )),

);

