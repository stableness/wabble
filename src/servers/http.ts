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
import { tryCatchToError, option2B, toBasicCredentials } from '../utils';

import type { ChainOpts } from './index';





export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: Http) {

    return F.pipe(

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





const TIMEOUT = 1000 * 5;

export async function tunnel ({ protocol, host, port, ssl, auth }: Http, path: string) {

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
            new Promise((_res, rej) =>
                setTimeout(() =>
                    rej(new Error('timeout')), TIMEOUT)
            ),
        ]);

    } catch (err) {
        req.abort();
        throw err;
    }

    return req.socket;

}





export const authToCredentials = O.fold(
    F.constant(''),
    toBasicCredentials,
);

