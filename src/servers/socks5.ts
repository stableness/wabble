import * as R from 'ramda';

import {
    taskEither as TE,
    option as O,
    function as F,
    pipeable as P,
} from 'fp-ts';

import { asyncReadable } from 'async-readable';

import { logLevel } from '../model';
import type { Socks5, Basic } from '../config';
import { socks5Handshake, tryCatchToError, Fn } from '../utils';

import { ChainOpts, netConnectTo } from './index';





export function chain ({ ipOrHost, port, logger, hook }: ChainOpts, remote: Socks5) {

    return P.pipe(

        TE.right(socks5Handshake(ipOrHost, port)),

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

        TE.chain(knock => tryCatchToError(async () => {
            return hook(await tunnel(remote, knock));
        })),

        TE.mapLeft(R.tap(() => hook())),

    );

}





export async function tunnel ({ host, port, auth }: Socks5, head: Uint8Array) {

    const socket = netConnectTo({ host, port });

    const { read, off } = asyncReadable(socket);
    const exit = R.o(Error, R.tap(off));

    auth: {

        socket.write(make(auth));

        const [ VER, METHOD ] = await read(2);

        if (VER !== 0x05 || METHOD === 0xFF) {
            throw exit(`VER [${ VER }] METHOD [${ METHOD }]`);
        }

        if (METHOD === 0x00) {
            break auth;
        }

        if (METHOD === 0x02 && O.isSome(auth)) {

            socket.write(encode(auth));

            const [ VER, STATUS ] = await read(2);

            if (VER !== 0x01 || STATUS !== 0x00) {
                throw exit(`VER [${ VER }] STATUS [${ STATUS }]`);
            }

            break auth;

        }

        throw exit(`METHOD [${ METHOD }]`);

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





const make = O.fold(
    F.constant(Buffer.from([ 0x05, 0x01, 0x00 ])),
    F.constant(Buffer.from([ 0x05, 0x02, 0x00, 0x02 ])),
);

export const encode = O.fold(Uint8Array.of, R.memoizeWith(

    R.o(
        R.join(':'),
        R.props([ 'username', 'password' ]) as Fn<Basic, string[]>,
    ),

    ({ username, password }: Basic) => Uint8Array.from([
        0x01,
        username.length, ...Buffer.from(username),
        password.length, ...Buffer.from(password),
    ]),

));

