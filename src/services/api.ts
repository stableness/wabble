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

    const compute = S.evaluate(api$.pipe(
        o.switchMap(O.fold(F.constant(Rx.EMPTY), setup)),
        o.shareReplay({ bufferSize: 1, refCount: false }),
    ));

    return compute(apply.sequenceS(S.state)({

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

        notFound$: S.gets<ObsJob, ObsJob>(o.tap({
            next ({ res }) {
                res.writeHead(404).end();
            },
        })),

    }));

}





type Job = { req: IncomingMessage, res: ServerResponse };
type ObsJob = Rx.Observable<Job>;



const reqEq: CurryT<[ string, Job, boolean ]> = R.useWith(
    R.whereEq, [
        R.o(([ method, url ]) => ({ method, url }), R.split(' ')),
        R.prop('req'),
    ],
);



type Req = `${ 'GET' | 'POST' | 'HEAD' | 'PUT' | 'PATCH' } /${ string }`;

const stateOfReq: CurryT<[ Req, S.State<ObsJob, ObsJob> ]> =
    r => s => Rx.partition(s, reqEq(r))
;





export function setup ({ port, host }: API) {

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

