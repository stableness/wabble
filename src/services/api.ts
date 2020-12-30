import { createServer, IncomingMessage, ServerResponse } from 'http';

import { pipeline } from 'stream';
import { getHeapSnapshot } from 'v8';

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
import * as u from '../utils';





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

            S.map(u.rxTap(({ res }) => {
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

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        ),

        dump$: F.pipe(

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

        ),

        exit$: F.pipe(

            stateOfReq('POST /exit'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204).end();
            })),

        ),

        cors$: F.pipe(

            stateOfReq('OPTIONS /*'),

            S.map(u.rxTap(({ res }) => {
                res.writeHead(204, {
                    'Access-Control-Max-Age': 3_600,
                    'Access-Control-Allow-Methods': R.join(',', METHODS),
                    'Access-Control-Allow-Headers': R.join(',', HEADERS),
                }).end();
            })),

        ),

        notFound$: S.gets<ObsJob, ObsJob>(
            u.rxTap(({ res }) => {
                res.writeHead(404).end();
            }),
        ),

    }));

}





type Job = { req: IncomingMessage, res: ServerResponse };
type ObsJob = Rx.Observable<Job>;



type Req = `${ 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' } /${ string }`;

const stateOfReq: u.CurryT<[ Req, S.State<ObsJob, ObsJob> ]> =
    r => s => Rx.partition(s, reqEq(r))
;

const reqEq: u.CurryT<[ Req, Job, boolean ]> = R.useWith(
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
const from = F.flow(u.collectAsyncIterable, Rx.from);

const sequenceState = apply.sequenceS(S.state);

const optionToSetup = O.fold(F.constant(Rx.EMPTY), setup);



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

