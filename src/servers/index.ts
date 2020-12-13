import net from 'net';

import type { Logger } from 'pino';

import * as R from 'ramda';

import {
    task as T,
    taskEither as TE,
    map as fpMap,
    eq as Eq,
    option as O,
    function as F,
    readonlyArray as A,
} from 'fp-ts';

import type { Remote } from '../config';
import { genDoH, Fn } from '../utils';
import { logLevel } from '../model';
import type { Hook } from '../services/index';

import { chain as chainHttp } from './http';
import { chain as chainSocks5 } from './socks5';
import { chain as chainTrojan } from './trojan';
import { chain as chainShadowSocks } from './shadowsocks';





type Opts = {
    host: string;
    port: number;
    hook: (...args: Parameters<Hook>) => TE.TaskEither<Error, void>;
    doh: O.Option<ReturnType<typeof genDoH>>;
    testDoH: Fn<string, boolean>;
    logger: Logger;
};

export type ChainOpts = Pick<Opts, 'host' | 'port' | 'logger' | 'hook'>;





const dnsCache = new Map<string, string>();
const nsLookup = (host: string) => fpMap.lookup (Eq.eqString) (host) (dnsCache);





/*#__NOINLINE__*/
export function connect (connOpts: Opts) {

    const { port, host, testDoH, hook, logger } = connOpts;

    /*#__NOINLINE__*/
    return function toServer (server: O.Option<Remote> | 'nothing') {

        const fetchIP = testDoH(host)
            ? /*#__NOINLINE__*/ query(connOpts)
            : T.of(host)
        ;

        if (server === 'nothing') {

            return F.pipe(
                TE.fromTask<never, string>(fetchIP),
                TE.map(ipOrHost => netConnectTo({ port, host: ipOrHost })),
                TE.chain(hook),
                TE.mapLeft(R.tap(hook())),
            );

        }

        return F.pipe(

            server,

            TE.fromOption(() => new Error('Has no server to connect')),

            TE.chain(remote => {

                const opts = { host, port, logger, hook };

                if (remote.protocol === 'socks5') {
                    return chainSocks5(opts, remote);
                }

                if (remote.protocol === 'trojan') {
                    return chainTrojan(opts, remote);
                }

                if (remote.protocol === 'ss') {
                    return chainShadowSocks(opts, remote);
                }

                if (remote.protocol === 'http'
                ||  remote.protocol === 'https' as string) {
                    return chainHttp(opts, remote);
                }

                return TE.left(
                    new Error(`Non supported protocol [${ remote.protocol }]`),
                );

            }),

            TE.mapLeft(R.tap(hook())),

        );

    };

}





/*#__NOINLINE__*/
function query ({ doh, host, logger }: Opts) {

    return F.pipe(

        nsLookup(host),
        TE.fromOption(() => Error('No cache')),
        TE.alt(() => F.pipe(

            doh,
            O.ap(O.some(host)),
            TE.fromOption(() => Error('No DoH')),
            TE.flatten,

            TE.map(/*#__NOINLINE__*/ A.findFirst(R.where({
                type: R.equals(1),
                data: R.is(String),
            }))),

            TE.chain(TE.fromOption(() => Error('No valid entries'))),

            TE.chainFirst(({ data: ip, TTL }) => TE.fromIO(() => {

                if (dnsCache.has(host) === false) {
                    dnsCache.set(host, ip);
                    setTimeout(() => dnsCache.delete(host), TTL * 1000);
                }

                if (R.not(logLevel.on.trace)) {
                    return;
                }

                logger.child({ ip }).trace('DoH');

            })),

            TE.map(R.prop('data')),

        )),

        TE.getOrElse(() => T.of(host)),

    );

}





export const netConnectTo: Fn<net.TcpNetConnectOpts, net.Socket> = R.compose(

    R.tap(socket => socket
        .setNoDelay(true)
        .setTimeout(1000 * 5)
        .setKeepAlive(true, 1000 * 60),
    ),

    net.connect as Fn<net.NetConnectOpts, net.Socket>,

    R.mergeRight({
        allowHalfOpen: true,
    }),

);

