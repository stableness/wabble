import { type Socket } from 'net';

import {
    taskEither as TE,
    option as O,
    function as F,
} from 'fp-ts';

import type { Socks5, Basic } from '../config.js';
import * as u from '../utils/index.js';

import { destroyBy, connect_tcp, RTE_O_E_V, elapsed } from './index.js';





export const chain: u.Fn<Socks5, RTE_O_E_V> = remote => opts => {

    const { host, port, hook, abort } = opts;

    return F.pipe(

        TE.rightIO(() => u.socks5Handshake(host, port)),

        TE.chain(tunnel(remote)),

        elapsed(remote, opts),

        TE.orElseFirstIOK(F.constant(abort)),

        TE.chain(hook),

    );

};





const timeoutError = new u.ErrorWithCode(
    'SERVER_SOCKET_TIMEOUT',
    'socks5 server timeout',
);

const race = u.raceTaskByTimeout(1000 * 5, timeoutError);

type ConnOpts = Pick<Socks5, 'host' | 'port' | 'auth'>;

export const tunnel = (remote: ConnOpts) => (head: Uint8Array) => u.bracket(

    TE.rightIO(connect_tcp(remote)),

    (socket: Socket) => {

        const { auth } = remote;

        const read = u.readToTaskEither(socket);
        const write = u.writeToTaskEither(socket);

        return F.pipe(

            race(u.onceTE('connect', socket)),

            TE.chain(() => write(make(auth))),

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

    },

    destroyBy(timeoutError),

);





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

