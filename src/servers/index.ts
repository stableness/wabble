import net from 'net';

import type { Logger } from 'pino';

import * as R from 'ramda';

import {
    taskEither as TE,
    either as E,
    map as fpMap,
    eq as Eq,
    option as O,
    pipeable as P,
    function as F,
    readonlyArray as A,
} from 'fp-ts';

import type { Remote } from '../config';
import { DoH, Fn, tryCatchToError } from '../utils';
import { logLevel } from '../model';
import type { Hook } from '../services/index';

import { chain as chainHttp } from './http';
import { chain as chainSocks5 } from './socks5';
import { chain as chainTrojan } from './trojan';
import { chain as chainShadowSocks } from './shadowsocks';





type Opts = {
    host: string,
    port: number,
    hook: Hook,
    dns: O.Option<ReturnType<typeof DoH>>,
    doh: Fn<string, boolean>,
    logger: Logger,
};

export type ChainOpts = Pick<Opts, 'port' | 'logger' | 'hook'> & {
    ipOrHost: string,
};





const dnsCache = new Map<string, string>();
const nsLookup = (host: string) => fpMap.lookup (Eq.eqString) (host, dnsCache);

const hostCache = R.memoizeWith(F.identity, O.some as Fn<string, O.Option<string>>);





export function connect ({ host, port, hook, dns, doh, logger }: Opts) {

    const ipCache = nsLookup(host);
    const justHost = hostCache(host);

    const mergeOpts = R.mergeRight({ port, logger, hook });



    return async function toServer (server: O.Option<Remote> | 'nothing') {

        const ip = await P.pipe(
            host,
            O.fromPredicate(doh),
            O.chain(F.constant(dns)),
            O.ap(justHost),
            O.map(task => P.pipe(
                ipCache,
                O.map(data => [ { data, name: host, TTL: 1, type: 1 as 1 } ]),
                TE.fromOption(Error),
                TE.alt(F.constant(task)),
            )),
            O.map(TE.map(F.flow(
                A.findFirst(R.where({
                    type: R.equals(1),
                    data: R.is(String),
                })),
                O.map(R.tap(({ data, TTL }) => {

                    if (O.isNone(ipCache)) {
                        dnsCache.set(host, data);
                        setTimeout(() => dnsCache.delete(host), TTL * 1000);
                    }

                })),
                O.map(R.prop('data')),
                O.map(R.tap(ip => {

                    if (R.not(logLevel.on.trace)) {
                        return;
                    }

                    logger.child({ ip }).trace('DoH');

                })),
            ))),
            O.map(R.applyTo(0)),
            O.toNullable,
        );



        const ipOrHost = P.pipe(
            ip,
            E.fromNullable(Error('Non DoH')),
            E.flatten,
            O.fromEither,
            O.flatten,
            O.getOrElse(F.constant(host)),
        );



        if (server === 'nothing') {

            return P.pipe(
                tryCatchToError(() =>
                    hook(netConnectTo({ port, host: ipOrHost })),
                ),
                TE.mapLeft(R.tap(() => hook())),
            );

        }



        return P.pipe(

            server,

            E.fromOption(F.constant(Error('Has no server to connect'))),

            E.map(remote => ({ remote, opts: mergeOpts({ ipOrHost }) })),

            TE.fromEither,

            TE.chain(({ remote, opts }) => {

                if (remote.protocol === 'socks5') {
                    return chainSocks5(opts, remote);
                }

                if (remote.protocol === 'trojan') {
                    return chainTrojan(opts, remote);
                }

                if (remote.protocol === 'ss') {
                    return chainShadowSocks(opts, remote);
                }

                if (remote.protocol === 'http' || remote.protocol === 'https') {
                    return chainHttp(opts, remote);
                }

                return TE.left(Error(`Non supported protocol [${ remote.protocol }]`));

            }),

            TE.mapLeft(R.tap(() => hook())),

        );

    };

}





export const netConnectTo = R.compose(

    R.tap(socket => socket
        .setNoDelay(true)
        .setTimeout(1000 * 5)
        .setKeepAlive(true, 1000 * 60)
    ),

    net.connect as Fn<net.NetConnectOpts, net.Socket>,

    R.mergeRight({
        allowHalfOpen: true,
    }),

) as Fn<net.TcpNetConnectOpts, net.Socket>;

