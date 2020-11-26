import { createServer, IncomingMessage, ServerResponse } from 'http';

import {
    apply,
    option as O,
    state as S,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import { bind } from 'proxy-bind';

import type { Config, API } from '../config';
import { CurryT, rxTap, str2arr, collectAsyncIterable } from '../utils';





export function establish (api$: Rx.Observable<Config['api']>) {

    const compute = S.evaluate(
        api$.pipe(
            o.switchMap(optionToSetup),
            o.share(),
        ),
    );

    return compute(sequenceState({

        health$: F.pipe(

            stateOfReq('GET /health'),

            S.map(rxTap(({ res }) => {
                res.writeHead(200, { Via: 'potato' });
                res.write('Still Alive\n');
                res.end();
            })),

        ),

        metrics$: F.pipe(

            stateOfReq('GET /metrics'),

            S.map(o.map(({ res }) => ({
                write (data: Record<string, unknown>) {
                    res.writeHead(200, {
                        'Cache-Control': 'private, no-cache, no-store',
                        'Content-Type': 'application/json; charset=utf-8',
                    });
                    res.write(JSON.stringify(data));
                    res.end();
                },
            }))),

        ),

        test_domain$: F.pipe(

            stateOfReq('POST /test-domain'),

            S.map(o.mergeMap(({ req, res }) => from(req).pipe(
                o.map(R.o(R.toString, Buffer.concat)),
                o.map(domain => ({
                    domain,
                    write (text: string) {
                        res.write(text);
                        res.end();
                    },
                })),
            ))),

        ),

        reload$: F.pipe(

            stateOfReq('POST /reload'),

            S.map(rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        ),

        exit$: F.pipe(

            stateOfReq('POST /exit'),

            S.map(rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        ),

        cors$: F.pipe(

            stateOfReq('OPTIONS /*'),

            S.map(rxTap(({ res }) => {
                res.writeHead(204, {
                    'Access-Control-Max-Age': 3_600,
                    'Access-Control-Allow-Methods': R.join(',', METHODS),
                    'Access-Control-Allow-Headers': R.join(',', HEADERS),
                }).end();
            })),

        ),

        notFound$: S.gets<ObsJob, ObsJob>(
            rxTap(({ res }) => {
                res.writeHead(404).end();
            }),
        ),

    }));

}





type Job = { req: IncomingMessage, res: ServerResponse };
type ObsJob = Rx.Observable<Job>;



type Req = `${ 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' } /${ string }`;

const stateOfReq: CurryT<[ Req, S.State<ObsJob, ObsJob> ]> =
    r => s => Rx.partition(s, reqEq(r))
;

const reqEq: CurryT<[ Req, Job, boolean ]> = R.useWith(
    R.where, [
        F.flow(
            R.split(' '),
            ([ method, url = '' ]) => ({ method, url }),
            R.evolve({
                method: R.equals,
                url: R.ifElse(
                    R.endsWith('*'),
                    R.o(R.startsWith, R.init),
                    R.equals,
                ),
            }),
        ),
        R.prop('req'),
    ],
);



// eslint-disable-next-line deprecation/deprecation
const from = F.flow(collectAsyncIterable, Rx.from);

const sequenceState = apply.sequenceS(S.state);

const optionToSetup = O.fold(F.constant(Rx.EMPTY), setup);



const METHODS = str2arr(`
    GET
    POST
    PUT
    DELETE
    PATCH
    OPTIONS
`);

const HEADERS = str2arr(`
    Authorization
    Content-Type
    X-Requested-With
`);





function setup ({ port, host, cors }: API) {

    return new Rx.Observable<Job>(subject => {

        const { next, error, complete } = bind(subject);

        function onRequest (req: IncomingMessage, res: ServerResponse) {

            if (cors === true && Boolean(req.headers.origin)) {
                res.setHeader('Access-Control-Allow-Origin', '*');
            }

            next({ req, res });

        }

        const server = createServer()

            .addListener('request', onRequest)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(port, host)

        ;

        return function () {

            server

                .removeListener('request', onRequest)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    });

}

