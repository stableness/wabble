import net from 'net';
import type { Writable } from 'stream';

import type { Logger } from 'pino';

import * as R from 'ramda';

import {
    monoid,
    task as T,
    taskEither as TE,
    readerTaskEither as RTE,
    readonlyMap as M,
    reader as Rd,
    readerIO as RI,
    number as Num,
    io as IO,
    either as E,
    option as O,
    predicate as P,
    function as F,
    string as Str,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
    readonlyRecord as Rc,
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
                return F.pipe(
                    TE.rightIO(connect_tcp({ host, port })),
                    TE.chain(hook),
                );
            }

            const { protocol } = server;

            /* eslint-disable indent */
            const go =
                  protocol === 'ss'     ? chainSS(server)
                : protocol === 'http'   ? chainHttp(server)
                : protocol === 'https'  ? chainHttp(server)
                : protocol === 'socks5' ? chainSocks5(server)
                : protocol === 'trojan' ? chainTrojan(server)
                :                         RTE.left(unknownRemote(server))
            ;
            /* eslint-enable indent */

            return go(opts);

        }),

    );

}





const raceTill = race(new Error('DNS resolving timeout'));

export function race (err: Error) {

    return u.std.F.memoize (Num.Eq) (ms => F.flow(

        monoid.concatAll(
            O.getMonoid(
                A.getMonoid<TE.TaskEither<Error, string>>(),
            ),
        ),

        O.chain(NA.fromReadonlyArray),

        O.map(
            F.tupled(
                u.raceTaskByTimeout(ms, err),
            ),
        ),

    ));

}





export function resolve (opts: Opts) {

    const { host, resolver: { cache, timeout, hosts, doh, dot, dns } } = opts;

    return F.pipe(

        isIP(host),

        O.alt(() => Rc.lookup (host) (hosts)),

        O.alt(F.pipe(
            cache.read,
            IO.map(M.lookup (Str.Eq) (host)),
        )),

        O.map(TE.right),

        O.alt(() => raceTill (timeout) ([
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

        TE.chainFirst(({ data, ttl }) => {
            return updateCache (data) (mkMillisecondInS(ttl)) (opts);
        }),

        TE.chainFirstIOK(({ data: ip }) => () => {

            if (logLevel.on.trace) {
                logger.child({ ip }).trace(type);
            }

        }),

        TE.map(d => d.data),

    );

};

const fromDoH = from_DoH_DoT('DoH');
const fromDoT = from_DoH_DoT('DoT');




const mkMillisecondInS = u.mkMillisecond('s');

/*#__NOINLINE__*/
const fromDNS = (opts: Opts) => (query: DNS_query) => {

    const { host, logger } = opts;

    return F.pipe(

        query(host),

        TE.map(/*#__NOINLINE__*/ A.findFirst(R.where({
            address: R.is(String),
        }))),

        TE.chain(TE.fromOption(no_valid_entries)),

        TE.chainFirst(({ address, ttl }) => {
            return updateCache (address) (mkMillisecondInS(ttl)) (opts);
        }),

        TE.chainFirstIOK(({ address: ip }) => () => {

            if (logLevel.on.trace) {
                logger.child({ ip }).trace('DNS');
            }

        }),

        TE.map(d => d.address),

    );

};





export const updateCache: u.CurryT<[

    string,
    u.Millisecond,
    Pick<Opts, 'host' | 'resolver'>,
    TE.TaskEither<Error, HashMap>,

]> = ip => ms => opts => {

    const { host, resolver: { ttl, cache: { read, modify } } } = opts;

    return F.pipe(
        TE.rightIO(read),
        TE.filterOrElse(
            P.not(M.member (Str.Eq) (host)),
            no_valid_entries,
        ),
        TE.chainFirstIOK(() => modify(M.upsertAt (Str.Eq) (host, ip))),
        TE.chainFirstIOK(() => () => {
            void u.run(F.pipe(
                T.fromIO(modify(M.deleteAt (Str.Eq) (host))),
                T.delay(F.pipe(
                    ttl,
                    O.map(({ calc }) => calc(ms)),
                    O.getOrElse(() => ms),
                )),
            ));
        }),
    );

};





/**
 * @deprecated use connect_tcp instead
 */
export const netConnectTo = F.pipe(

    Rd.asks(net.connect as u.Fn<net.TcpNetConnectOpts, net.Socket>),

    Rd.chainFirst(socket => () => {
        socket.setNoDelay(true);
    }),

);





export const connect_tcp = F.pipe(

    RI.ask<net.TcpNetConnectOpts>(),

    RI.chainIOK(opts => () => net.connect(opts)),

    RI.chainFirstIOK(socket => () => {
        socket.setNoDelay(true);
    }),

);





export const destroyBy: Rd.Reader<

    u.ErrorWithCode,

    F.FunctionN<
        [
            Pick<Writable, 'destroy'>,
            E.Either<Error, unknown>,
        ],
        TE.TaskEither<never, unknown>
    >

> = error => (req, e) => F.pipe(

    E.swap(e),
    O.fromEither,
    O.filter(u.curry2 (u.eqErrorWithCode.equals) (error)),
    O.map(err => () => {
        req.destroy(err);
    }),
    O.getOrElse(F.constant(F.constVoid)),
    TE.rightIO,

);





export function elapsed (remote: Remote, { logger }: ChainOpts) {

    return u.elapsed(ping => () => {

        const proxy = F.pipe(
            remote,
            R.pick([ 'host', 'port', 'protocol' ]),
            R.mergeLeft({ ping }),
        );

        logger.child({ proxy }).trace('Elapsed');

    });

}





const unknownRemote = ({ protocol }: Remote) => {
    return new Error(`Non supported protocol [${ protocol }]`);
};





const isIP = O.fromPredicate(u.isIP);



const checkBlockingHost = TE.filterOrElse(
    P.not(u.isBlockedIP),
    F.constant(new u.ErrorWithCode('BLOCKED_HOST', 'Blocked via DoH or DNS')),
);



const no_cache_nor_DoH_DoT_DNS = F.constant(
    new Error('No cache nor DoH, DoT or DNS'),
);



const no_valid_entries = F.constant(
    new Error('No valid entries'),
);

