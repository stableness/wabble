import { promises as pDNS } from 'dns';

import {
    either as E,
    taskEither as TE,
    function as F,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import {
    run,
    try2TE,
} from './index.js';





const io_error_empty_result = () => new Error('empty result');





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

    const doh = run(try2TE(async () => {
        const pkg = await import(path) as { DNSoverHTTPS: ResolverDoH };
        return new pkg.DNSoverHTTPS({ url: endpoint, preferPost: false });
    }));

    return (name: string) => F.pipe(

        () => doh,

        TE.chain(dns => try2TE(() => dns.lookup(name, { json: false }))),

        TE.chain(({ answers }) => F.pipe(
            NA.fromArray(answers),
            TE.fromOption(io_error_empty_result),
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

    const dot = run(try2TE(async () => {
        const pkg = await import(path) as { DNSoverTLS: ResolverDoT };
        return new pkg.DNSoverTLS({ host, port });
    }));

    return (name: string, opts?: LookupOpts) => F.pipe(

        () => dot,

        TE.chain(dns => try2TE(() => dns.lookup(name, opts))),

        TE.chain(({ answers }) => F.pipe(
            NA.fromArray(answers),
            TE.fromOption(io_error_empty_result),
        )),

    );

}





export type DNS_query = ReturnType<typeof genDNS>;

export function genDNS (servers: string | readonly string[]) {

    const arr = typeof servers === 'string' ? [ servers ] : servers;

    const setServers = F.pipe(

        NA.fromReadonlyArray(arr),
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

    try2TE(() => resolver.resolve4(name, { ttl: true })),

    TE.chain(F.flow(
        NA.fromArray,
        TE.fromOption(io_error_empty_result),
    )),

);

