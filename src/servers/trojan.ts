import { connect } from 'tls';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model.js';
import type { Trojan } from '../config.js';

import * as u from '../utils/index.js';

import { RTE_O_E_V, destroyBy } from './index.js';





export const chain: u.Fn<Trojan, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => makeHead(remote.password, host, port)),

        TE.apFirst(TE.fromIO(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through trojan')
            ;

        })),

        TE.chain(tunnel(remote)),

        TE.mapLeft(R.tap(abort)),

        TE.chain(hook),

    );

};





const timeoutError = new u.ErrorWithCode(
    'SERVER_SOCKET_TIMEOUT',
    'trojan server timeout',
);

const race = u.raceTaskByTimeout(1000 * 5, timeoutError);

export const tunnel = (opts: Trojan) => (head: Uint8Array) => u.bracket(

    TE.rightIO(() => {

        const { host, port, ssl } = opts;

        /* eslint-disable indent */
        const {
                    ciphers,
            sni:    servername = host,
            alpn:   ALPNProtocols,
            verify: rejectUnauthorized,
                    verify_hostname,
        } = ssl;
        /* eslint-enable indent */

        const socket = connect({

            host,
            port,

            ciphers,
            servername,
            ALPNProtocols,
            rejectUnauthorized,

            ...(
                R.not(verify_hostname)
                && { checkServerIdentity: F.constUndefined }
            ),

        });

        return socket.setNoDelay(true);

    }),

    socket => race(u.tryCatchToError(async () => {

        await once(socket, 'secureConnect');

        if (socket.write(head) !== true) {
            await once(socket, 'drain');
        }

        return socket;

    })),

    destroyBy(timeoutError),

);





export const memHash: u.Fn<string, Buffer> = R.compose(
    Buffer.from,
    R.invoker(1, 'toString')('hex'),
    u.hash.sha224,
);





export const makeHead = u.mem.in10((
        password: string,
        host: string,
        port: number,
) => {

    return Uint8Array.from([

        ...memHash(password),

        0x0D, 0x0A,

        0x01, ...u.socks5Handshake(host, port).subarray(3),

        0x0D, 0x0A,

    ]);

});

