import { connect } from 'tls';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model';
import type { Trojan } from '../config';

import * as u from '../utils/index';

import type { RTE_O_E_V } from './index';





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

        TE.chain(u.catchKToError(tunnel(remote))),

        TE.mapLeft(R.tap(abort)),

        TE.chain(hook),

    );

};





const TIMEOUT = 1000 * 5;

export const tunnel = (opts: Trojan) => async (head: Uint8Array) => {

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
            R.not(verify_hostname) && { checkServerIdentity: F.constUndefined }
        ),

    });

    socket.setNoDelay(true);
    socket.setTimeout(TIMEOUT);
    socket.setKeepAlive(true, 1000 * 60);

    try {

        await Promise.race([
            once(socket, 'secureConnect'),
            u.timeout(TIMEOUT),
        ]);

        if (socket.write(head) !== true) {
            await once(socket, 'drain');
        }

    } catch (err) {
        socket.destroy();
        // eslint-disable-next-line functional/no-throw-statement
        throw err;
    }

    return socket;

};





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

