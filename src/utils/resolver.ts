import { promises as pDNS } from 'dns';

import {
    either as E,
    task as T,
    taskEither as TE,
    function as F,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import { run, tryCatchToError } from './index';





export type DoH_query = ReturnType<typeof genDoH>;

export function genDoH (endpoint: string, path = '@stableness/dohdec') {

    type Result = { name: string, type: 'A', ttl: number, data: string };
    type Response = Record<'answers', Result[]>;

    interface Class {
        new(opts?: { url?: string, preferPost?: boolean }): this;
        lookup(name: string, opts?: { json?: boolean }): Promise<Response>;
    }

    const doh = run(tryCatchToError(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const pkg: { DNSoverHTTPS: Class } = await import(path);
        return new pkg.DNSoverHTTPS({ url: endpoint, preferPost: false });
    }));

    return (name: string) => F.pipe(

        T.fromTask(() => doh),

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

