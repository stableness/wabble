import { URL } from 'url';
import * as QS from 'querystring';
import { createServer, IncomingMessage, ServerResponse } from 'http';

import { pipeline } from 'stream';
import { getHeapSnapshot } from 'v8';

import {
    option as O,
    state as S,
    string as Str,
    eq as Eq,
    predicate as P,
    function as F,
} from 'fp-ts';

import {
    string as stdStr,
    function as stdF,
} from 'fp-ts-std';

import * as R from 'ramda';

import * as Rx from 'rxjs';

import { bind } from 'proxy-bind';

import type { Config, API } from '../config.js';
import * as u from '../utils/index.js';





export function establish (api$: Rx.Observable<Config['api']>) {

    const [ address$, job$ ] = split(
        api$.pipe(
            Rx.switchMap(O.fold(F.constant(Rx.EMPTY), setup)),
            Rx.share(),
        ),
    );

    return S.evaluate (job$) (F.pipe(

        S.of({}) as never,

        S.apS('health$', F.pipe(

            stateOfReq('GET /health'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(200, { Via: 'potato' });
                res.write('Still Alive\n');
                res.end();
            })),

        )),

        S.apS('metrics$', F.pipe(

            stateOfReq('GET /metrics'),

            S.map(Rx.map(({ res }) => ({
                write (data: Record<string, unknown>) {
                    res.writeHead(200, {
                        'Cache-Control': 'private, no-cache, no-store',
                        'Content-Type': 'application/json; charset=utf-8',
                    });
                    res.write(JSON.stringify(data));
                    res.end();
                },
            }))),

        )),

        S.apS('test_domain$', F.pipe(

            stateOfReq('POST /test-domain'),

            S.map(Rx.mergeMap(({ req, res }) => from(req).pipe(
                Rx.map(F.flow(
                    R.ifElse(
                        R.propEq('length', 1),
                        R.head,
                        Buffer.concat,
                    ) as u.Fn<Buffer[], Buffer>,
                    R.toString,
                    R.unary(QS.parse),
                    R.propOr('', 'host') as u.Fn<unknown, string | string[]>,
                    R.unless(
                        R.is(String),
                        R.head,
                    ) as u.Fn<string | string[], string | undefined>,
                )),
                Rx.map((domain = '') => ({
                    domain,
                    write (text: string) {
                        res.write(domain === '' ? 'unknown' : text);
                        res.end();
                    },
                })),
            ))),
        )),

        S.apS('reload$', F.pipe(

            stateOfReq('POST /reload'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        )),

        S.apS('flush_DNS$', F.pipe(

            stateOfReq('POST /flush-dns'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        )),

        S.apS('dump$', F.pipe(

            stateOfReq('GET /dump'),

            S.map(u.rxTap(({ res }) => {

                const format = R.pipe(
                    R.dropLast(5),
                    R.replace(/-/g, ''),
                    R.replace(/:/g, ''),
                    R.split('T'),
                    R.prepend('Heap'),
                    R.append(process.pid),
                    R.join('-'),
                );

                const name = format(new Date().toISOString())
                    .concat('.heapsnapshot')
                ;

                res.writeHead(200, {
                    'Content-Disposition': `attachment; filename="${ name }"`,
                });

                pipeline(getHeapSnapshot(), res, u.noop);

            })),

        )),

        S.apS('exit$', F.pipe(

            stateOfReq('POST /exit'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        )),

        S.apS('cors$', F.pipe(

            stateOfReq('OPTIONS /*'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204, {
                    'Access-Control-Max-Age': 3_600,
                    'Access-Control-Allow-Methods': R.join(',', METHODS),
                    'Access-Control-Allow-Headers': R.join(',', HEADERS),
                }).end();
            })),

        )),

        S.apS('notFound$', S.gets(u.rxTap(({ res }) => {
            res.writeHead(404).end();
        }))),

        S.apS('address$', S.gets(F.constant(
            address$.pipe(
                Rx.first(),
                Rx.map(addr => ({
                    ...addr,
                    to (path: string) {
                        return new URL(
                            path,
                            `http://${ addr.address }:${ addr.port }`,
                        );
                    },
                })),
            ),
        ))),

    ));

}





type Obs <T> = Rx.Observable<T>;

type Address = { address: string, family: string, port: number };
type Address$ = Obs<Address>;

type Job = { req: IncomingMessage, res: ServerResponse };
type Job$ = Obs<Job>;



export const split: u.Fn<Obs<Address | Job>, [ Address$, Job$ ]> =
    s => Rx.partition(s, R.propSatisfies(R.is(Number), 'port')) as never
;

type Req = `${ 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' } /${ string }`;

const stateOfReq: u.Fn<Req, S.State<Job$, Job$>> =
    r => s => Rx.partition(s, reqEq(r))
;

function reqEq (path: Req) {

    const not_space: P.Predicate<string> = s => s !== ' ';

    const split_in_space = stdF.fork([
        stdStr.takeLeftWhile(not_space),
        stdStr.takeRightWhile(not_space),
    ]);

    const eq_uri = Eq.tuple(
        Str.Eq,
        Eq.fromEquals<string>((a, b) => a.endsWith('*')
            ? b.startsWith(stdStr.dropRight (1) (a))
            : Str.Eq.equals(a, b),
        ),
    );

    const [ method, url ] = split_in_space(path);

    return ({ req }: Job) => eq_uri.equals(
        [     method,           url       ],
        [ req.method ?? '', req.url ?? '' ],
    );

}


// eslint-disable-next-line deprecation/deprecation
const from = F.flow(u.collectAsyncIterable, Rx.from);



const METHODS = u.str2arr(`
    GET
    POST
    PUT
    DELETE
    PATCH
    OPTIONS
`);

const HEADERS = u.str2arr(`
    Authorization
    Content-Type
    X-Requested-With
`);





function setup ({ port, host, cors }: API) {

    return new Rx.Observable<Address | Job>(subject => {

        const { next, error, complete } = bind(subject);

        function onRequest (req: IncomingMessage, res: ServerResponse) {

            if (cors === true && Boolean(req.headers.origin)) {
                res.setHeader('Access-Control-Allow-Origin', '*');
            }

            next({ req, res });

        }

        function onListening () {

            const address = server.address();

            if (address != null && typeof address !== 'string') {
                next(address);
            }

        }

        const server = createServer()

            .addListener('request', onRequest)
            .addListener('listening', onListening)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(port, host)

        ;

        return function () {

            server

                .removeListener('request', onRequest)
                .removeListener('listening', onListening)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    });

}

