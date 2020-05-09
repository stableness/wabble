import * as R from 'ramda';

import {
    either as E,
    taskEither as TE,
    pipeable as P,
} from 'fp-ts';

import { asyncReadable } from 'async-readable';

import { logLevel } from '../model';
import type { Socks5 } from '../config';
import { socks5Handshake } from '../utils';

import { ChainOpts, netConnectTo } from './index';





export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: Socks5) {

    const knock = socks5Handshake(ipOrHost, port);

    return P.pipe(

        TE.tryCatch(
            () => encase(netConnectTo(remote), knock),
            E.toError,
        ),

        TE.map(R.tap(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through socks5')
            ;

        })),

        TE.chain(conn =>
            TE.tryCatch(
                () => hook(conn),
                E.toError,
            ),
        ),

        TE.mapLeft(R.tap(() => hook())),

    );

}





const noAuth = Buffer.from([ 0x05, 0x01, 0x00 ]);

export async function encase (socket: NodeJS.ReadWriteStream, head: Uint8Array) {

    const { read, off } = asyncReadable(socket);
    const exit = R.o(Error, R.tap(off));

    auth: {

        socket.write(noAuth);

        const [ VER, METHOD ] = await read(2);

        if (VER !== 0x05 || METHOD !== 0x00) {
            throw exit(`VER [${ VER }] METHOD [${ METHOD }]`);
        }

    }

    request: {

        socket.write(head);

        const [ VER, REP,    , ATYP, LEN ] = await read(5);

        if (VER !== 0x05 || REP !== 0x00) {
            throw exit(`VER [${ VER }] REP [${ REP }]`);
        }

        let step = -1;

        switch (ATYP) {
            case 1: step += 4; break;
            case 4: step += 16; break;
            case 3: step += LEN + 1; break;
            default: throw exit(`ATYP [${ ATYP }]`);
        }

        await read(step + 2);

    }

    off();

    return socket;

}

