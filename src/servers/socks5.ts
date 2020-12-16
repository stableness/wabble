import * as R from 'ramda';

import {
    taskEither as TE,
    option as O,
    function as F,
} from 'fp-ts';

import { asyncReadable } from 'async-readable';

import { logLevel } from '../model';
import type { Socks5, Basic } from '../config';
import {
    mem,
    socks5Handshake,
    catchKToError,
    writeToTaskEither,
} from '../utils';

import { ChainOpts, netConnectTo } from './index';





export function chain (opts: ChainOpts, remote: Socks5) {

    const { ipOrHost, port, logger, hook } = opts;

    return F.pipe(

        TE.rightIO(() => socks5Handshake(ipOrHost, port)),

        TE.apFirst(TE.fromIO(() => {

            if (R.not(logLevel.on.trace)) {
                return;
            }

            const merge = R.pick([ 'host', 'port', 'protocol' ]);

            logger
                .child({ proxy: merge(remote) })
                .trace('proxy through socks5')
            ;

        })),

        TE.chain(tunnel(remote)),

        TE.chain(catchKToError(hook)),

        TE.mapLeft(R.tap(() => hook())),

    );

}





/* eslint-disable indent */

export const tunnel =
    ({ host, port, auth }: Pick<Socks5, 'host' | 'port' | 'auth'>) =>
        (head: Uint8Array) => {

    const socket = netConnectTo({ host, port });

    const { read: readPromise } = asyncReadable(socket);

    const read = catchKToError(readPromise);
    const write = writeToTaskEither(socket);

    return F.pipe(

        write(make(auth)),

        TE.chain(() => read(1)),
        TE.chain(([ VER ]) =>
            VER === 0x05 ? read(1) : TE.leftIO(() => Error(`VER [${ VER }]`)),
        ),
        TE.chain(([ METHOD ]) => {

            if (METHOD === 0x00) {
                return TE.fromIO(F.constVoid);
            }

            if (METHOD === 0x02 && O.isSome(auth)) {
                return F.pipe(

                    write(encode(auth)),

                    TE.chain(() => read(2)),
                    TE.chain(([ VER, STATUS ]) => {

                        if (VER !== 0x01 || STATUS !== 0x00) {
                            return TE.leftIO(() => Error(`VER [${ VER }] STATUS [${ STATUS }]`));
                        }

                        return TE.fromIO(F.constVoid);

                    }),

                );
            }

            return TE.leftIO(() => Error(`METHOD [${ METHOD }]`));

        }),

        TE.chain(() => write(head)),

        TE.chain(() => read(5)),
        TE.chain(([ VER, REP, _, ATYP, LEN = 0 ]) => {

            if (VER !== 0x05 || REP !== 0x00) {
                return TE.leftIO(() => Error(`VER [${ VER }] REP [${ REP }]`));
            }

            let step = -1;

            switch (ATYP) {
                case 1: step += 4; break;
                case 4: step += 16; break;
                case 3: step += LEN + 1; break;
                default: return TE.leftIO(() => Error(`ATYP [${ ATYP }]`));
            }

            return read(step + 2);

        }),

        TE.map(F.constant(socket)),

    );

};

/* eslint-enable indent */





const make = O.fold(
    F.constant(Uint8Array.from([ 0x05, 0x01, 0x00 ])),
    F.constant(Uint8Array.from([ 0x05, 0x02, 0x00, 0x02 ])),
);

export const encode = O.fold(

    Uint8Array.of,

    mem.in10(({ username, password }: Basic) => Uint8Array.from([
        0x01,
        username.length, ...Buffer.from(username),
        password.length, ...Buffer.from(password),
    ])),

);

