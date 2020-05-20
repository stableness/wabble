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

        TE.rightIO(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through trojan')
            ;

        }),

        TE.chain(() => u.tryCatchToError(async () => {

            const socket = await tunnel(remote);

            socket.write(makeHead(remote.password, ipOrHost, port));

            return hook(socket);

        })),

        TE.mapLeft(R.tap(() => hook())),

    );

}





export function tunnel ({ host, port, ssl }: Trojan) {

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

    return once(tls, 'secureConnect').then(F.constant(tls));

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

    return Buffer.from([

        ...memHash(password),

        0x0D, 0x0A,

        0x01, ...u.socks5Handshake(host, port).subarray(3),

        0x0D, 0x0A,

    ]);

}

