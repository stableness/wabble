import net from 'net';

import type { Logger } from 'pino';

import * as R from 'ramda';

import {
    monoid,
    task as T,
    taskEither as TE,
    readerTaskEither as RTE,
    readonlyMap as M,
    io as IO,
    either as E,
    option as O,
    function as F,
    string as Str,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import type { Remote } from '../config.js';
import * as u from '../utils/index.js';
import type { DoH_query, DNS_query, DoT_query } from '../utils/resolver.js';
import { logLevel, Resolver, HashMap } from '../model.js';
import type { Hook } from '../services/index.js';

import { chain as chainHttp } from './http.js';
import { chain as chainSocks5 } from './socks5.js';
import { chain as chainTrojan } from './trojan.js';
import { chain as chainSS } from './shadowsocks.js';





type Opts = {
    host: string;
    port: number;
    hook: (...args: Parameters<Hook>) => TE.TaskEither<Error, void>;
    abort: () => void;
    resolver: Resolver;
    logger: Logger;
};

export type ChainOpts = Omit<Opts, 'resolver'>;

export type RTE_O_E_V = RTE.ReaderTaskEither<ChainOpts, Error, void>;





/*#__NOINLINE__*/
export function connect (opts: Opts, server: Remote | 'origin') {

    const { abort, hook, port } = opts;

    return F.pipe(

        /*#__NOINLINE__*/ resolve(opts),

        TE.mapLeft(R.tap(abort)),

        TE.chain(host => {

            if (server === 'origin') {
                return hook(netConnectTo({ host, port }));
            }

            return select (server) (opts);

        }),

    );

}





const race = F.flow(
    A.compact,
    <T> (queue: readonly T[]) =>
        // bailout if only have the timeout task in queue
        queue.length < 2 ? O.none : O.some(queue.flat() as never),
    O.map(monoid.concatAll(T.getRaceMonoid<E.Either<Error, string>>())),
);





export function resolve (opts: Opts) {

    const { host, resolver: { cache, timeout, doh, dot, dns } } = opts;

    return F.pipe(

        isIP(host),

        O.alt(F.pipe(
            cache.read,
            IO.map(M.lookup (Str.Eq) (host)),
        )),

        O.map(TE.right),

        O.alt(() => race([
            O.some(NA.of(T.delay (timeout) (timeoutTE))),
            O.map (NA.map(fromDoH(opts))) (doh),
            O.map (NA.map(fromDoT(opts))) (dot),
            O.map (NA.map(fromDNS(opts))) (dns),
        ])),

        TE.fromOption(no_cache_nor_DoH_DoT_DNS),
        TE.flatten,
        TE.alt(() => TE.right(host)),

        checkBlockingHost,

    );

}





type Query = DoH_query | DoT_query;

const from_DoH_DoT = (type: string) => (opts: Opts) => (query: Query) => {

    const { host, logger } = opts;

    return F.pipe(

        query(host),

        TE.map(/*#__NOINLINE__*/ A.findFirst(R.where({
            type: R.equals('A'),
            data: R.is(String),
        }))),

        TE.chain(TE.fromOption(no_valid_entries)),

        TE.chainFirstW(({ data, ttl }) => {
            return updateCache (data) (ttl) (opts);
        }),

        TE.chainFirst(({ data: ip }) => TE.fromIO(() => {

            if (logLevel.on.trace) {
                logger.child({ ip }).trace(type);
            }

        })),

        TE.map(R.prop('data')),

    );

};

const fromDoH = from_DoH_DoT('DoH');
const fromDoT = from_DoH_DoT('DoT');





/*#__NOINLINE__*/
const fromDNS = (opts: Opts) => (query: DNS_query) => {

    const { host, logger } = opts;

    return F.pipe(

        query(host),

        TE.map(/*#__NOINLINE__*/ A.findFirst(R.where({
            address: R.is(String),
        }))),

        TE.chain(TE.fromOption(no_valid_entries)),

        TE.chainFirstW(({ address, ttl }) => {
            return updateCache (address) (ttl) (opts);
        }),

        TE.chainFirst(({ address: ip }) => TE.fromIO(() => {

            if (logLevel.on.trace) {
                logger.child({ ip }).trace('DNS');
            }

        })),

        TE.map(R.prop('address')),

    );

};





export const updateCache: u.CurryT<[

    string,
    number,
    Pick<Opts, 'host' | 'resolver'>,
    TE.TaskEither<void, HashMap>,

]> = ip => seconds => opts => {

    const { host, resolver: { ttl, cache: { read, modify } } } = opts;

    return F.pipe(
        TE.rightIO(read),
        TE.chain(TE.fromPredicate(
            F.not(M.member (Str.Eq) (host)),
            F.constVoid,
        )),
        TE.chainFirstIOK(() => modify(M.upsertAt (Str.Eq) (host, ip))),
        TE.chainFirstIOK(() => () => {
            void u.run(F.pipe(
                T.fromIO(modify(M.deleteAt (Str.Eq) (host))),
                T.delay(1000 * F.pipe(
                    ttl,
                    O.map(({ calc }) => calc(seconds)),
                    O.getOrElse(() => seconds),
                )),
            ));
        }),
    );

};





export const netConnectTo: u.Fn<net.TcpNetConnectOpts, net.Socket> = R.compose(

    R.tap(socket => socket
        .setNoDelay(true)
        .setTimeout(1000 * 5)
        .setKeepAlive(true, 1000 * 60),
    ),

    net.connect as u.Fn<net.NetConnectOpts, net.Socket>,

    R.mergeRight({
        allowHalfOpen: true,
    }),

);





const unknownRemote = ({ protocol }: Remote) => {
    return new Error(`Non supported protocol [${ protocol }]`);
};

const protocolEq = R.propEq('protocol');

const select: u.Fn<Remote, RTE_O_E_V> = R.cond([
    [ protocolEq('ss'        ), chainSS ],
    [ protocolEq('http'    ), chainHttp ],
    [ protocolEq('https'   ), chainHttp ],
    [ protocolEq('socks5'), chainSocks5 ],
    [ protocolEq('trojan'), chainTrojan ],
    [ R.T, R.o(RTE.left, unknownRemote) ],
]);





const isIP = O.fromPredicate(u.isIP);



const checkBlockingHost = TE.filterOrElse(
    F.not(u.isBlockedIP),
    F.constant(new u.ErrorWithCode('BLOCKED_HOST', 'Blocked via DoH or DNS')),
);



const timeoutTE = TE.left(new Error('timeout'));



const no_cache_nor_DoH_DoT_DNS = F.constant(
    new Error('No cache nor DoH, DoT or DNS'),
);



const no_valid_entries = F.constant(
    new Error('No valid entries'),
);

