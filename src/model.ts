import pino from 'pino';

import { load as loadYAML } from 'js-yaml';

import * as R from 'ramda';

import {
    either as E,
    option as O,
    readerTaskEither as RTE,
    function as F,
    readonlyArray as A,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import { bind } from 'proxy-bind';

import type { Options } from './bin';

import { connect } from './servers/index';
import { combine, establish } from './services/index';
import { convert } from './settings/index';

import type { NSResolver } from './config';

import * as u from './utils/index';
import { genDNS, genDoH, genDoT } from './utils/resolver';







export const VERSION = '<%=VERSION=>' as string;

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
process.env.NODE_ENV = R.ifElse(
    R.startsWith('<%='),
    R.always('dev'),
    R.identity,
)(process.env.NODE_ENV ?? '<%=NODE_ENV=>');





export const readLevel = R.converge(
    R.defaultTo, [
        R.ifElse(
            R.propEq('NODE_ENV', 'production'),
            R.always('error'),
            R.always('debug'),
        ),
        R.o(
            R.ifElse(
                R.flip(R.includes)(R.append(
                    'silent', Object.keys(pino.levels.values),
                )),
                R.identity,
                R.always(undefined),
            ),
            R.prop('LOG_LEVEL'),
        ),
    ],
) as u.Fn<Record<string, unknown>, string>;





export const logger = pino({
    base: null,
    prettyPrint: false,
    level: readLevel(process.env),
});

export const logLevel = {

    on: {
        get trace () { return logger.isLevelEnabled('trace') },
        get debug () { return logger.isLevelEnabled('debug') },
        get info () { return logger.isLevelEnabled('info') },
        get warn () { return logger.isLevelEnabled('warn') },
        get error () { return logger.isLevelEnabled('error') },
        get fatal () { return logger.isLevelEnabled('fatal') },
        get silent () { return logger.isLevelEnabled('silent') },
    },

};

export type Logging = typeof logging;

export const logging = { logger, logLevel };





export function catchException () {

    process.on('uncaughtException', R.cond([

        [
            R.propEq('code', 'ECONNRESET'),
            R.when(() => logLevel.on.error === true, bind(logger).error),
        ],

        [ R.T, F.constVoid ],

    ]) as unknown as u.Fn<Error, void>);

}





const loader$ = new Rx.ReplaySubject<string>(1);

const config$ = loader$.pipe(
    o.switchMap(u.loadPath),
    o.map(R.unary(loadYAML)),
    o.map(convert),
    o.catchError(err => {
        const { message } = E.toError(err);
        logger.error(message);
        return Rx.EMPTY;
    }),
    o.shareReplay({ bufferSize: 1, refCount: false }),
);

const directList$ = config$.pipe(
    o.pluck('sieve', 'direct'),
    o.map(O.getOrElse(F.constant('@stableness/sieve-tray/lib/china-list'))),
    o.mergeMap(u.sieve),
    o.shareReplay({ bufferSize: 1, refCount: false }),
);

const rejectList$ = config$.pipe(
    o.pluck('sieve', 'reject'),
    o.map(O.getOrElse(F.constant('@stableness/sieve-tray/lib/block-list'))),
    o.mergeMap(u.sieve),
    o.shareReplay({ bufferSize: 1, refCount: false }),
);

const rules$ = config$.pipe(
    o.pluck('rules'),
    o.map(R.evolve({
        proxy: u.rules.DOH,
        direct: u.rules.DOH,
        reject: u.rules.NOT,
    })),
    o.delayWhen(R.always(Rx.combineLatest([ directList$, rejectList$ ]))),
    o.withLatestFrom(rejectList$, directList$, (rules, reject, direct) => ({
        reject: R.either(
            rules.reject.yes,
            R.both(
                F.not(rules.reject.not),
                reject,
            ),
        ),
        direct: R.both(
            F.not(rules.proxy.all),
            R.anyPass([ rules.direct.all, direct, u.isPrivateIP ]),
        ),
    })),
);

const dealer$ = config$.pipe(
    o.pluck('servers'),
    o.map(u.loopNext),
    o.map(hit => ({ hit })),
);

const services$ = config$.pipe(
    o.pluck('services'),
);

const api$ = config$.pipe(
    o.pluck('api'),
);

export type Resolver = Rx.ObservedValueOf<typeof resolver$>;

const resolver$ = config$.pipe(
    o.pluck('resolver'),
    o.map(R.evolve({
        upstream: O.map(R.o(
            R.evolve({
                https: A.map(({ uri }: NSResolver) => genDoH(uri.href)),
                tls: A.map(({ uri }: NSResolver) => genDoT(uri)),
                udp: A.map(({ uri }: NSResolver) => genDNS(uri.host)),
            }),
            u.groupBy(R.prop('protocol')),
        )),
    })),
    o.map(({ ttl, upstream, timeout }) => {

        const trim = O.chain(
            <T> (arr: readonly T[] = []) => RNEA.fromReadonlyArray(arr),
        );

        const doh = trim(O.map (R.prop('https')) (upstream));
        const dot = trim(O.map (R.prop('tls')) (upstream));
        const dns = trim(O.map (R.prop('udp')) (upstream));

        return { ttl, timeout, doh, dot, dns };

    }),
);





export const load = R.once(_load);

function _load (
        { version, setting, logging: level = '', quiet = false }: Options,
) {

    if (version === true) {
        return console.info(VERSION);
    }

    if (level.length > 0) {
        logger.level = readLevel({ ...process.env, LOG_LEVEL: level });
    }

    if (quiet === true) {
        logger.level = 'silent';
    }

    construct(setting).subscribe({

        error (err) {
            logger.error(err);
        },

        complete () {
            setImmediate(() => {
                process.exit(0);
            });
        },

    });

    catchException();

}





const runner$ = services$.pipe(

    u.rxTap(() => {
        console.info('ver. %s', VERSION);
        console.info('LOG_LEVEL in [%s]', logger.level);
    }),

    u.rxTap(RNEA.map(({ host, port, protocol }) => {
        console.info('listening on [%s:%d] by [%s]', host, port, protocol);
    })),

    o.switchMap(combine(logging)),

    o.connect(Rx.pipe(

        o.withLatestFrom(rules$, resolver$, (
                { host, port, hook, abort },
                rules, resolver,
        ) => ({
            host,
            port,
            resolver,
            abort,
            hook: u.catchKToError(hook),
            logger: logger.child({ host, port }),
            rejection: rules.reject(host),
            direction: rules.direct(host),
        })),

        o.filter(opts => {

            const { abort, rejection, direction, logger: log } = opts;

            if (rejection) {

                log.info('Reject');
                abort();

                return false;

            }

            if (direction) {

                void u.run(R.applyTo(opts, F.pipe(
                    connect('origin'),
                    RTE.apFirst(RTE.fromIO(() => log.info('Direct'))),
                )));

                return false;

            }

            return true;

        }),

        o.withLatestFrom(dealer$, (opts, dealer) => {

            const { abort, logger: log } = opts;

            // try 3 times
            const server = dealer.hit() ?? dealer.hit() ?? dealer.hit();

            if (server == null) {
                abort();
                throw new Error('no remote available');
            }

            const task = R.applyTo(opts, F.pipe(
                connect(server),
                RTE.apFirst(RTE.fromIO(() => log.info('Proxy'))),
            ));

            return { task, log };

        }),

        o.mergeMap(async ({ task, log }) => F.pipe(
            await task(),
            E.mapLeft(err => ({ err, log })),
        )),

        u.rxTap(E.fold(({ err, log }) => {

            if (err instanceof Error) {

                const code: string = R.propOr('unknown', 'code', err);

                if (errToIgnoresBy(code)) {
                    logLevel.on.trace && log.trace(err);
                    return;
                }

            }

            log.error(err);

        }, F.constVoid)),

        o.ignoreElements(),

        o.retry({ count: 5, resetOnSuccess: true }),

    )),

);





function construct (setting: string) {

    const {

        cors$,
        health$,
        reload$,
        test_domain$,
        exit$,
        metrics$,
        dump$,
        notFound$,

    } = establish(api$);

    return Rx.merge(

        runner$,

        cors$,
        health$,
        dump$,
        notFound$,

        reload$.pipe(
            o.mapTo(setting),
            o.startWith(setting),
            o.tap(loader$),
        ),

        metrics$.pipe(
            o.map(({ write }) => {
                write({ ...process.memoryUsage() });
            }),
        ),

        test_domain$.pipe(
            o.withLatestFrom(rules$, (
                    { domain, write },
                    { direct, reject },
            ) => {
                write(
                    reject(domain) ?       'reject'
                        : direct(domain) ? 'direct'
                            :              'proxy',
                );
            }),
        ),

    ).pipe(

        o.ignoreElements(),
        o.takeUntil(exit$),

    );

}





export const { has: errToIgnoresBy } = bind(new Set([
    'EPIPE',
    'ECONNRESET',
    'ERR_STREAM_DESTROYED',
    'ERR_STREAM_WRITE_AFTER_END',
    'ERR_STREAM_PREMATURE_CLOSE',
    'BLOCKED_HOST',
]));

