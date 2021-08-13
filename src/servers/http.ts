import https from 'https';
import http from 'http';
import type { Socket } from 'net';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    option as O,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model.js';
import type { Http } from '../config.js';

import * as u from '../utils/index.js';

import type { RTE_O_E_V } from './index.js';





export const chain: u.Fn<Http, RTE_O_E_V> = remote => opts => {

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

        TE.chain(tunnel(remote)),

        TE.mapLeft(R.tap(abort)),

        TE.chain(hook),

    );

};





const race = u.raceTaskByTimeout<Socket>(1000 * 5, 'http server timeout');

export const tunnel = (opts: Http) => (path: string) => TE.bracket(

    TE.rightIO(() => {

        const { protocol, host, port, ssl, auth } = opts;

        const hasAuth = u.option2B(auth);

        const headers = {
            'Proxy-Connection': 'Keep-Alive',
            ...(hasAuth && { 'Proxy-Authorization': authToCredentials(auth) }),
        };

        const connect = protocol === 'http' ? http.request : https.request;

        const req = connect({

            host,
            port,
            path,
            headers,
            method: 'CONNECT',
            rejectUnauthorized: ssl.verify,

        });

        req.setNoDelay(true);
        req.flushHeaders();

        return req;

    }),

    req => race(u.tryCatchToError(async () => {

        await once(req, 'connect');

        return req.socket;

    })),

    (req, e) => F.pipe(
        TE.fromEither(e),
        TE.mapLeft(R.tap(err => req.destroy(err))),
        TE.apSecond(TE.rightIO(F.constVoid)),
    ),

);





export const authToCredentials = O.fold<string, string>(
    F.constant(''),
    u.toBasicCredentials,
);

