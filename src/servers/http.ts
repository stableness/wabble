import https from 'https';
import http from 'http';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    option as O,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model';
import type { Http } from '../config';

import {
    Fn,
    timeout,
    option2B,
    catchKToError,
    toBasicCredentials,
} from '../utils/index';

import type { RTE_O_E_V } from './index';





export const chain: Fn<Http, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => R.join(':', [ host, port ])),

        TE.apFirst(TE.fromIO(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through http')
            ;

        })),

        TE.chain(catchKToError(tunnel(remote))),

        TE.mapLeft(R.tap(abort)),

        TE.chain(hook),

    );

};





const TIMEOUT = 1000 * 5;

export const tunnel = (opts: Http) => async (path: string) => {

    const { protocol, host, port, ssl, auth } = opts;

    const hasAuth = option2B(auth);

    const connect = protocol === 'http' ? http.request : https.request;

    const req = connect({

        host,
        port,
        path,
        rejectUnauthorized: ssl.verify,
        method: 'CONNECT',
        headers: {
            'Proxy-Connection': 'Keep-Alive',
            ...(hasAuth && { 'Proxy-Authorization': authToCredentials(auth) } ),
        },
    });

    req.setNoDelay(true);
    req.setTimeout(TIMEOUT);
    req.setSocketKeepAlive(true, 1000 * 60);

    req.flushHeaders();

    try {

        await Promise.race([
            once(req, 'connect'),
            timeout(TIMEOUT),
        ]);

    } catch (err) {
        req.abort();
        throw err;
    }

    return req.socket;

};





export const authToCredentials = O.fold(
    F.constant(''),
    toBasicCredentials,
);

