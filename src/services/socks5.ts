import net from 'net';

import { bind } from 'proxy-bind';

import { asyncReadable } from 'async-readable';

import { fromLong as ipFromLong, toString as ipToString } from 'ip';

import {
    apply as Ap,
    option as O,
    taskEither as TE,
    function as F,
} from 'fp-ts';

import * as R from 'ramda';

import * as Rx from 'rxjs';
import * as o from 'rxjs/operators';

import type { Logging } from '../model';
import type { Service } from '../config';
import { pump, mountErrOf, unwrapTaskEither } from '../utils';

import {
    readFrame,
    do_not_require,
    do_not_have_authentication,
} from './utils';





const reply = [ 0, 1, 0, 0, 0, 0, 0, 0 ];

const AUTH_NOT  = Uint8Array.from([ 0x05, 0x00 ]);
const AUTH_YES  = Uint8Array.from([ 0x05, 0x02 ]);
const AUTH_ERR  = Uint8Array.from([ 0x01, 0xFF ]);
const AUTH_SUC  = Uint8Array.from([ 0x01, 0x00 ]);
const E_METHOD  = Uint8Array.from([ 0x05, 0xFF ]);
const E_COMMAND = Uint8Array.from([ 0x05, 0x07, ...reply ]);
const E_ATYP    = Uint8Array.from([ 0x05, 0x08, ...reply ]);
const CONTINUE  = Uint8Array.from([ 0x05, 0x00, ...reply ]);





export const socks5Proxy = (service: Service) => (logging: Logging) => {

    const { logLevel, logger } = logging;
    const { auth, port: servicePort, host: serviceHost } = service;

    const is_admission_free = do_not_require(auth);

    return new Rx.Observable<net.Socket>(subject => {

        const { next, error, complete } = bind(subject);

        const server = net.createServer()

            .addListener('connection', next)
            .addListener('error', error)
            .addListener('close', complete)

            .listen(servicePort, serviceHost)

        ;

        return function () {

            server

                .removeListener('connection', next)
                .removeListener('error', error)
                .removeListener('close', complete)

                .close()

            ;

        };

    }).pipe(

        o.mergeMap(async socket => {

            try {

                const { read } = asyncReadable(socket);

                const frame = F.pipe(
                    readFrame(read),
                    TE.map(R.toString),
                );

                const exit = R.construct(Error);

                init: {

                    const [ VER, LEN = 0 ] = await read(2);

                    if (VER !== 0x05 || LEN < 1) {
                        socket.end(E_METHOD);
                        throw exit(`VER [${ VER }] LEN [${ LEN }]`);
                    }

                    const methods = Array.from(await read(LEN));

                    if (is_admission_free) {
                        socket.write(AUTH_NOT);
                        break init;
                    }

                    if (do_not_have_authentication(methods)) {
                        socket.end(E_METHOD);
                        throw exit(`METHODS [${ methods }]`);
                    }

                    auth: {

                        socket.write(AUTH_YES);

                        const [ VER_AUTH ] = await read(1);

                        if (VER_AUTH !== 0x01) {
                            socket.end(AUTH_ERR);
                            throw exit(`VER [${ VER_AUTH }]`);
                        }

                        const info = await unwrapTaskEither(
                            sequenceSTE({
                                username: frame,
                                password: frame,
                            }),
                        );

                        const result = F.pipe(
                            auth,
                            O.ap(O.some(info)),
                            O.getOrElse(F.constFalse),
                        );

                        if (result === true) {
                            socket.write(AUTH_SUC);
                            break auth;
                        }

                        socket.end(AUTH_ERR);

                        const { username, password } = info;
                        throw exit(`user [${ username }] pass [${ password }]`);

                    }

                }

                // eslint-disable-next-line no-unused-labels
                request: {

                    const [ VER, CMD,    , ATYP ] = await read(4);

                    if (VER !== 0x05 || CMD !== 0x01) {
                        socket.end(E_COMMAND);
                        throw exit(`VER [${ VER }] CMD [${ CMD }]`);
                    }

                    let host = '';

                    switch (ATYP) {
                        case 1:
                            host = ipFromLong((await read(4)).readUInt32BE(0));
                            break;
                        case 4:
                            host = ipToString(await read(16));
                            break;
                        case 3:
                            host = await unwrapTaskEither(frame);
                            break;
                    }

                    if (host.length < 1) {
                        socket.end(E_ATYP);
                        throw exit(`ATYP [${ ATYP }]`);
                    }

                    const port = (await read(2)).readUInt16BE(0);

                    return { socket, host, port };

                }

            } catch (error) {

                if (logLevel.on.debug) {

                    logger.debug({
                        msg: 'SOCKS5_HANDSHAKE_ERROR',
                        message: R.propOr('unknown', 'message')(error),
                    });

                }

                socket.destroy();

                return undefined;

            }

        }),

        o.filter(Boolean),

        o.map(({ host, port, socket }) => ({

            host,
            port,

            async hook (...duplex: NodeJS.ReadWriteStream[]) {

                if (R.isEmpty(duplex)) {
                    mountErrOf(socket);
                    return socket.destroy();
                }

                socket.write(CONTINUE);

                await pump(socket, ...duplex, socket);

            },

        })),

    );

};





const sequenceSTE = Ap.sequenceS(TE.taskEither);

