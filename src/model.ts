import pino from 'pino';

import { safeLoad } from 'js-yaml';

import * as R from 'ramda';

import {
    either as E,
    option as O,
    function as F,
    pipeable as P,
} from 'fp-ts';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import { bind } from 'proxy-bind';

import type { Options } from './bin';

import { connect } from './servers/index';
import { combine } from './services/index';
import { convert } from './settings/index';

import * as u from './utils';







export const VERSION = '<%=VERSION=>' as string;

process.env.NODE_ENV = R.ifElse(
    R.startsWith('<%='),
    R.always('dev'),
    R.identity,
)(process.env.NODE_ENV || '<%=NODE_ENV=>');





export const readLevel = R.converge(
    R.defaultTo, [
        R.ifElse(
            R.propEq('NODE_ENV', 'production'),
            R.always('error'),
            R.always('debug'),
        ),
        R.o(
            R.ifElse(
                R.flip(R.includes)(R.append('silent', Object.keys(pino.levels.values))),
                R.identity,
                R.always(undefined),
            ),
            R.prop('LOG_LEVEL'),
        ),
    ],
) as u.Fn<object, string>;





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





process.on('uncaughtException', R.cond([

    [
        R.propEq('code', 'ECONNRESET'),
        R.when(() => logLevel.on.error === true, bind(logger).error),
    ],

    [ R.T, F.constVoid ],

]) as unknown as u.Fn<Error, void>);





const loader$ = new Rx.ReplaySubject<string>(1);

const config$ = loader$.pipe(
    o.switchMap(R.curry(u.readFile)(R.__, 'utf8')),
    o.map(R.unary(safeLoad)),
    o.map(convert),
    o.catchError(R.o(R.always(Rx.EMPTY), bind(logger).error)),
    o.publishReplay(1, Number.POSITIVE_INFINITY, Rx.asyncScheduler),
    o.refCount(),
);

const directList$ = config$.pipe(
    o.pluck('sieve', 'direct'),
    o.map(O.getOrElse(F.constant('@stableness/sieve-tray/lib/china-list'))),
    o.flatMap(u.sieve),
    o.shareReplay({ bufferSize: 1, refCount: false }),
);

const rejectList$ = config$.pipe(
    o.pluck('sieve', 'reject'),
    o.map(O.getOrElse(F.constant('@stableness/sieve-tray/lib/block-list'))),
    o.flatMap(u.sieve),
    o.shareReplay({ bufferSize: 1, refCount: false }),
);

const rules$ = config$.pipe(
    o.pluck('rules'),
    o.map(R.evolve({
        proxy: u.rules.DOH,
        direct: u.rules.DOH,
        reject: u.rules.NOT,
    })),
    o.delayWhen(R.always(Rx.combineLatest(directList$, rejectList$))),
    o.withLatestFrom(rejectList$, directList$, (rules, reject, direct) => ({
        reject: R.either(
            rules.reject.yes,
            R.both(
                R.complement(rules.reject.not),
                reject,
            ),
        ),
        direct: R.both(
            R.complement(rules.proxy.all),
            R.anyPass([ rules.direct.all, direct, u.isPrivateIP ]),
        ),
        doh: R.either(rules.direct.doh, rules.proxy.doh),
    })),
);

const dealer$ = config$.pipe(
    o.pluck('servers'),
    o.map(list => {

        const next = u.loopNext(list);

        return {
            hit: () => O.fromNullable(next()),
        };

    }),
);

const dns$ = config$.pipe(
    o.pluck('doh'),
    o.map(O.map(R.unary(u.DoH))),
);

const services$ = config$.pipe(
    o.pluck('services'),
);





export function load ({ version, setting, logging = '', quiet = false }: Options) {

    if (version === true) {
        return console.info(VERSION);
    }

    if (logging.length > 0) {
        logger.level = readLevel({ ...process.env, LOG_LEVEL: logging });
    }

    if (quiet === true) {
        logger.level = 'silent';
    }

    runner$.subscribe(u.noop, bind(logger).error);

    loader$.next(setting);

}





const runner$ = services$.pipe(

    o.tap(() => {
        console.info('ver. %s', VERSION);
        console.info('LOG_LEVEL in [%s]', logger.level);
    }),

    o.tap(R.forEach(({ host, port, protocol }) => {
        console.info('listening on [%s:%d] by [%s]', host, port, protocol);
    })),

    o.switchMap(combine(logging)),

    o.publish(Rx.pipe(

        o.withLatestFrom(rules$, dns$, (
                { host, port, hook },
                { direct, reject, doh },
                dns,
        ) => {

            const log = logger.child({ host, port });

            const rejection = reject(host);
            const direction = direct(host);

            const hopTo = connect({ host, port, hook, dns, doh, logger: log });

            return { log, rejection, direction, hopTo, hook };

        }),

        o.filter(({ rejection, direction, hook, hopTo, log }) => {

            if (rejection) {

                log.info('Reject');
                hook();
                return false;

            }

            if (direction) {

                u.tryCatchToError(async () => {

                    const conn = await hopTo('nothing');

                    log.info('Direct');

                    return conn();

                })();

                return false;

            }

            return true;

        }),

        o.withLatestFrom(dealer$, ({ log, hopTo }, dealer) => {

            const task = u.tryCatchToError(async () => {

                const conn = await hopTo(dealer.hit());

                log.info('Proxy');

                return conn();

            });

            return { task, log };

        }),

        o.flatMap(async ({ task, log }) => P.pipe(
            await task(),
            E.mapLeft(err => ({ err, log })),
        )),

        o.tap(E.fold(({ err, log }) => {

            if (err instanceof Error) {

                const code = R.propOr('unknown', 'code', err) as string;

                if (errToIgnoresBy(code)) {
                    logLevel.on.trace && log.trace(err);
                    return;
                }

            }

            log.error(err as any);

        }, F.constVoid)),

        o.ignoreElements(),

        o.retryWhen(Rx.pipe(o.delay(1))),

    )),

);





export const { has: errToIgnoresBy } = bind(new Set([
    'EPIPE',
    'ECONNRESET',
    'ERR_STREAM_DESTROYED',
    'ERR_STREAM_WRITE_AFTER_END',
    'ERR_STREAM_PREMATURE_CLOSE',
]));

