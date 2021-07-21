import * as R from 'ramda';

import {
    taskEither as TE,
    option as O,
    function as F,
} from 'fp-ts';

import { logLevel } from '../model.js';
import type { Socks5, Basic } from '../config.js';
import * as u from '../utils/index.js';

import { netConnectTo, RTE_O_E_V } from './index.js';





export const chain: u.Fn<Socks5, RTE_O_E_V> = remote => opts => {

    const { host, port, logger, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => u.socks5Handshake(host, port)),

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

        TE.mapLeft(R.tap(abort)),

        TE.chain(hook),

    );

};





/* eslint-disable indent */

export const tunnel =
    ({ host, port, auth }: Pick<Socks5, 'host' | 'port' | 'auth'>) =>
        (head: Uint8Array) => {

    const socket = netConnectTo({ host, port });

    const read = u.readToTaskEither(socket);
    const write = u.writeToTaskEither(socket);

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

            const step = -1;

            if (ATYP === 1) return read(2 + step + 4);
            if (ATYP === 4) return read(2 + step + 16);
            if (ATYP === 3) return read(2 + step + LEN + 1);

            return TE.leftIO(() => Error(`ATYP [${ ATYP }]`));

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

    u.mem.in10(({ username, password }: Basic) => Uint8Array.from([
        0x01,
        username.length, ...Buffer.from(username),
        password.length, ...Buffer.from(password),
    ])),

);

