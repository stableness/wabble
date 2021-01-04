import pino from 'pino';

import { load as loadYAML } from 'js-yaml';

import * as R from 'ramda';

import {
    either as E,
    option as O,
    taskEither as TE,
    function as F,
    readonlyNonEmptyArray as RNEA,
} from 'fp-ts';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import { bind } from 'proxy-bind';

import type { Options } from './bin';

import { connect } from './servers/index';
import { combine, establish } from './services/index';
import { convert } from './settings/index';

import * as u from './utils';







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
    o.publishReplay(1, Number.POSITIVE_INFINITY, Rx.asyncScheduler),
    o.refCount(),
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
        doh: R.either(rules.direct.doh, rules.proxy.doh),
    })),
);

const dealer$ = config$.pipe(
    o.pluck('servers'),
    o.map(u.loopNext),
    o.map(next => ({
        hit: () => O.fromNullable(next()),
    })),
);

const doh$ = config$.pipe(
    o.pluck('doh'),
    o.map(O.map(R.unary(u.genDoH))),
);

const services$ = config$.pipe(
    o.pluck('services'),
);

const api$ = config$.pipe(
    o.pluck('api'),
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

    o.publish(Rx.pipe(

        o.withLatestFrom(rules$, doh$, (
                { host, port, hook },
                rules, doh,
        ) => {

            const log = logger.child({ host, port });

            const rejection = rules.reject(host);
            const direction = rules.direct(host);

            const hopTo = /*#__NOINLINE__*/ connect({
                host, port, hook, doh, testDoH: rules.doh, logger: log,
            });

            return { log, rejection, direction, hopTo, hook };

        }),

        o.filter(({ rejection, direction, hook, hopTo, log }) => {

            if (rejection) {

                log.info('Reject');
                void hook();
                return false;

            }

            if (direction) {

                void u.run(F.pipe(
                    hopTo('nothing'),
                    TE.apFirst(TE.fromIO(() => log.info('Direct'))),
                ));

                return false;

            }

            return true;

        }),

        o.withLatestFrom(dealer$, ({ log, hopTo }, dealer) => {

            const task = F.pipe(
                hopTo(dealer.hit()),
                TE.apFirst(TE.fromIO(() => log.info('Proxy'))),
            );

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
]));

