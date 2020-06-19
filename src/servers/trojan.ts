import { connect } from 'tls';

import { once } from 'events';

import * as R from 'ramda';

import {
    taskEither as TE,
    pipeable as P,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model';
import type { Trojan } from '../config';
import * as u from '../utils';

import type { ChainOpts } from './index';





export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: Trojan) {

    return P.pipe(

        TE.right(makeHead(remote.password, ipOrHost, port)),

        TE.map(R.tap(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through trojan')
            ;

        })),

        TE.chain(head => u.tryCatchToError(async () => {

            const socket = await tunnel(remote);

            socket.write(head);

            return hook(socket);

        })),

        TE.mapLeft(R.tap(() => hook())),

    );

}





const TIMEOUT = 1000 * 5;

export async function tunnel ({ host, port, ssl }: Trojan) {

    const {
                ciphers,
        sni:    servername = host,
        alpn:   ALPNProtocols,
        verify: rejectUnauthorized,
                verify_hostname,
    } = ssl;

    const tls = connect({

        host,
        port,

        ciphers,
        servername,
        ALPNProtocols,
        rejectUnauthorized,

        ...( R.not(verify_hostname) && { checkServerIdentity: F.constUndefined }),

    });

    tls.setNoDelay(true);
    tls.setTimeout(TIMEOUT);
    tls.setKeepAlive(true, 1000 * 60);

    try {

        await Promise.race([
            once(tls, 'secureConnect'),
            new Promise((_res, rej) =>
                setTimeout(() =>
                    rej(new Error('timeout')), TIMEOUT)
            ),
        ]);

    } catch (err) {
        tls.destroy();
        throw err;
    }

    return tls;

}





export const memHash = R.memoizeWith(
    R.identity,
    R.compose(
        Buffer.from,
        R.invoker(1, 'toString')('hex'),
        u.hash.sha224,
    ) as u.Fn<string, Buffer>,
);





export function makeHead (password: string, host: string, port: number) {

    return Uint8Array.from([

        ...memHash(password),

        0x0D, 0x0A,

        0x01, ...u.socks5Handshake(host, port).subarray(3),

        0x0D, 0x0A,

    ]);

}

