import type { Socket } from 'net';
import https from 'https';
import http, { IncomingMessage } from 'http';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    pipeable as P,
} from 'fp-ts';

import { logLevel } from '../model';
import type { Http } from '../config';
import { tryCatchToError } from '../utils';

import type { ChainOpts } from './index';





export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: Http) {

    return P.pipe(

        TE.right(R.join(':', [ ipOrHost, port ])),

        TE.map(R.tap(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through http')
            ;

        })),

        TE.chain(path => tryCatchToError(async () => {
            return hook(await tunnel(remote, path));
        })),

        TE.mapLeft(R.tap(() => hook())),

    );

}





export function tunnel ({ protocol, host, port }: Http, path: string) {

    const connect = protocol === 'http' ? http.request : https.request;

    const req = connect({
        host,
        port,
        path,
        method: 'CONNECT',
        headers: {
            Host: path,
            'Proxy-Connection': 'Keep-Alive',
        },
    });

    req.setNoDelay(true);
    req.setTimeout(1000 * 5);
    req.setSocketKeepAlive(true, 1000 * 60);

    req.flushHeaders();

    const socket = once(req, 'connect') as Promise<[ IncomingMessage, Socket ]>;

    return socket.then(R.nth(1) as <_0, _1> (args: [ _0, _1 ]) => _1);

}

