import {
    monoid as Md,
    string as Str,
    either as E,
    taskEither as TE,
    predicate as P,
    reader as Rd,
    function as F,
    readonlyArray as A,
    readonlyNonEmptyArray as NA,
} from 'fp-ts';

import * as Rx from 'rxjs';

import * as u from '../utils/index.js';





type LoadEnv = Pick<Env, 'base64' | 'endpoint' | 'timeout'>;

export const load = (env: Required<LoadEnv>) => F.pipe(
    u.readOptionalString(env.endpoint),
    TE.fromOption(() => new Error('empty path')),
    TE.chain(u.loadPath),
    u.raceTaskByTimeout(
        env.timeout,
        new Error(`load timeout in ${ env.timeout }`),
    ),
    TE.map(u.uncurry2 (u.std.F.when) ([
        F.constant(env.base64),
        u.decodeBase._64Recovered,
    ])),
);





export type Env = {
    endpoint: string;
    base64?: boolean;
    timeout?: number;
    refresh?: number;
    retry?: number;
};





export const mkCrawler = <A> (f: (d: string) => E.Either<Error, A>) => F.pipe(

    Rd.asks((env: Required<Env>) => load(env)),

    Rd.map(Rx.defer),

    Rd.chain(obs => Rd.asks(env => obs.pipe(

        Rx.map(F.flow(
            E.chain(f),
            u.std.E.unsafeUnwrap,
        )),

        env.retry > 0
            ? Rx.retry({ count: env.retry, resetOnSuccess: true })
            : Rx.identity
        ,

        env.refresh > 0
            ? Rx.repeat({ delay: env.refresh })
            : Rx.identity
        ,

    ))),

    Rd.local((env: Env) => ({
        retry: 3,
        timeout:  5_000,
        refresh: 60_000,
        base64: false,
        ...env,
    })),

);





export const crawlRows = (grep: P.Predicate<string>) => mkCrawler(F.flow(
    Str.trim,
    u.std.Str.lines,
    A.filterMap(u.readOptionalString),
    E.fromOptionK  (() => new Error('empty list'))   (NA.fromReadonlyArray),
    E.chainOptionK (() => new Error('empty result')) (NA.filter(grep)),
));

export const crawlRowsStartsBy = F.flow(
    F.untupled(A.map(Str.startsWith)),
    Md.concatAll(P.getMonoidAny()),
    crawlRows,
);

