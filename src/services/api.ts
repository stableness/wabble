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
import type { CurryT } from '../utils';





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

            S.map(Rx.pipe(
                o.tap({
                    next ({ res }) {
                        res.writeHead(200, { Via: 'potato' });
                        res.write('Still Alive\n');
                        res.end();
                    },
                }),
            )),

        ),

        metrics$: F.pipe(

            stateOfReq('GET /metrics'),

            S.map(Rx.pipe(
                o.map(({ res }) => ({
                    write (data: Record<string, unknown>) {
                        res.writeHead(200, {
                            'Cache-Control': 'private, no-cache, no-store',
                            'Content-Type': 'application/json; charset=utf-8',
                        });
                        res.write(JSON.stringify(data));
                        res.end();
                    },
                })),
            )),

        ),

        test_domain$: F.pipe(

            stateOfReq('POST /test-domain'),

            S.map(Rx.pipe(
                o.mergeMap(({ req, res }) => Rx.from(req).pipe(
                    o.toArray(),
                    o.map(R.o(R.toString, Buffer.concat)),
                    o.map(domain => ({
                        domain,
                        write (text: string) {
                            res.write(text);
                            res.end();
                        },
                    })),
                )),
            )),

        ),

        reload$: F.pipe(

            stateOfReq('POST /reload'),

            S.map(Rx.pipe(
                o.tap({
                    next ({ res }) {
                        res.writeHead(204).end();
                    },
                }),
            )),

        ),

        exit$: F.pipe(

            stateOfReq('POST /exit'),

            S.map(Rx.pipe(
                o.tap({
                    next ({ res }) {
                        res.writeHead(204).end();
                    },
                }),
            )),

        ),

        notFound$: S.gets<ObsJob, ObsJob>(o.tap({
            next ({ res }) {
                res.writeHead(404).end();
            },
        })),

    }));

}





type Job = { req: IncomingMessage, res: ServerResponse };
type ObsJob = Rx.Observable<Job>;



type Req = `${ 'GET' | 'POST' | 'HEAD' | 'PUT' | 'PATCH' } /${ string }`;

const stateOfReq: CurryT<[ Req, S.State<ObsJob, ObsJob> ]> =
    r => s => Rx.partition(s, reqEq(r))
;

const reqEq: CurryT<[ Req, Job, boolean ]> = R.useWith(
    R.whereEq, [
        R.o(([ method, url ]) => ({ method, url }), R.split(' ')),
        R.prop('req'),
    ],
);



const sequenceState = apply.sequenceS(S.state);

const optionToSetup = O.fold(F.constant(Rx.EMPTY), setup);





function setup ({ port, host }: API) {

    return new Rx.Observable<Job>(subject => {

        const { next, error, complete } = bind(subject);

        function onRequest (req: IncomingMessage, res: ServerResponse) {
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

